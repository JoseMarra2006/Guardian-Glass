/**
 * @file voiceService.ts
 * @description Serviço de Captura e Transcrição de Voz — PetroGate AR Fase 2
 *
 * ─── REGRA DE OURO (Segurança de Dados de Voz) ───────────────────────────────
 * O áudio bruto gravado pelo microfone do Smart Glass NUNCA sai do dispositivo
 * para nuvens de terceiros diretamente. O pipeline seguro é:
 *
 *   [Microfone] → [Armazenamento Local] → [Transcrição On-Device ou Edge Proxy]
 *                                                     │
 *                                              [Apenas Texto]
 *                                                     │
 *                                               → [DLP Scanner]
 *                                               → [AI Gateway]
 *
 * Em produção, a transcrição deve usar:
 *   OPÇÃO 1 (Privacidade máxima): Modelo local Whisper.cpp executado no dispositivo
 *   OPÇÃO 2 (Qualidade máxima): Supabase Edge Function → OpenAI Whisper API
 *              (o Edge Function valida o JWT + device_id ANTES de encaminhar o áudio)
 *
 * ─── FLUXO DE USO ─────────────────────────────────────────────────────────────
 * 1. requestMicrophonePermission() — solicita permissão do SO
 * 2. startRecording()             — inicia gravação no armazenamento local
 * 3. stopRecording(recording)     — encerra gravação, retorna URI + duração
 * 4. transcribeAudio(result)      — converte áudio local em texto
 */

import { Audio } from 'expo-av';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Códigos de erro padronizados do VoiceService */
export type VoiceServiceErrorCode =
  | 'PERMISSION_DENIED'
  | 'RECORDING_FAILED'
  | 'STOP_FAILED'
  | 'TRANSCRIPTION_FAILED'
  | 'NO_AUDIO_CAPTURED'
  | 'MAX_DURATION_EXCEEDED';

/** Erro estruturado com código e mensagem amigável */
export class VoiceServiceError extends Error {
  constructor(
    public readonly code: VoiceServiceErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'VoiceServiceError';
  }
}

/** Resultado bruto da gravação (armazenado apenas no dispositivo) */
export interface VoiceRecordingResult {
  /** URI do arquivo de áudio — aponta para FileSystem local, NUNCA para nuvem */
  uri: string;
  /** Duração em milissegundos */
  durationMs: number;
}

/** Resultado da transcrição (único dado que sai do dispositivo) */
export interface TranscriptionResult {
  /** Texto transcrito — ÚNICO dado que entra no pipeline DLP/AI */
  text: string;
  /** Confiança da transcrição de 0 a 1 */
  confidence: number;
  /** Tempo de processamento em milissegundos */
  processingTimeMs: number;
  /** Flag indicando que esta é uma resposta simulada (remover em produção) */
  isSimulated?: boolean;
}

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Duração máxima de uma gravação (30 segundos) */
const MAX_RECORDING_DURATION_MS = 30_000;

/** Duração mínima para aceitar uma gravação (500ms) */
const MIN_RECORDING_DURATION_MS = 500;

/**
 * Opções de gravação otimizadas para transcrição de fala.
 * 16kHz mono é o formato ideal para modelos de fala (Whisper, Google STT).
 * Bitrate baixo (64kbps) reduz tamanho do arquivo sem impactar reconhecimento de fala.
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16_000,
    numberOfChannels: 1,
    bitRate: 64_000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16_000,
    numberOfChannels: 1,
    bitRate: 64_000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64_000,
  },
};

/**
 * Queries de exemplo do contexto petróleo/gás para simulação de transcrição.
 * Cobre cenários reais de operação em plataformas e refinarias.
 */
const PETROLEUM_SAMPLE_QUERIES: readonly string[] = [
  'Qual é o procedimento de segurança para abertura de válvula no manifold de alta pressão?',
  'Mostre o histórico de produção do poço mais ativo no último trimestre.',
  'Qual a temperatura atual do separador de produção desta plataforma?',
  'Verifique o status dos equipamentos de segurança na área de risco classe A.',
  'Quais são os limites operacionais para a pressão do riser nesta configuração?',
  'Há alertas de manutenção preventiva pendentes nos compressores principais?',
  'Qual o volume atual nos tanques de armazenamento da unidade de processo?',
  'Explique o procedimento de parada de emergência para este sistema.',
  'Quais normas ABNT se aplicam à inspeção de dutos nesta zona?',
  'Mostre os indicadores de eficiência energética do turno atual.',
] as const;

// ─── Permissão ────────────────────────────────────────────────────────────────

/**
 * Solicita permissão de microfone ao Sistema Operacional.
 *
 * Deve ser chamado antes de qualquer tentativa de gravação.
 * Configura o modo de áudio do dispositivo para gravação (crítico no iOS).
 *
 * @returns true se a permissão foi concedida, false caso contrário
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const { status } = await Audio.requestPermissionsAsync();

    if (status !== 'granted') {
      console.warn('[VoiceService] AVISO: Permissão de microfone NEGADA pelo usuário.', {
        status,
        orientacao: 'Usuário deve habilitar em Configurações > Privacidade > Microfone',
      });
      return false;
    }

    // iOS OBRIGATÓRIO: Habilitar gravação no modo de áudio do sistema
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false, // Smart Glass: não gravar em background
    });

    console.log('[VoiceService] Permissão de microfone concedida. Modo de áudio configurado.');
    return true;

  } catch (error) {
    console.error('[VoiceService] ERRO ao solicitar permissão de microfone:', error);
    return false;
  }
}

// ─── Gravação ─────────────────────────────────────────────────────────────────

/**
 * Inicia a gravação de áudio no armazenamento local do dispositivo.
 *
 * @param onStatusUpdate - Callback opcional para monitorar o status e metering
 * @throws VoiceServiceError com código PERMISSION_DENIED ou RECORDING_FAILED
 * @returns Instância de Audio.Recording ativa
 */
export async function startRecording(
  onStatusUpdate?: (status: Audio.RecordingStatus) => void
): Promise<Audio.Recording> {
  const hasPermission = await requestMicrophonePermission();

  if (!hasPermission) {
    throw new VoiceServiceError(
      'PERMISSION_DENIED',
      'Permissão de microfone não concedida. Habilite nas configurações do dispositivo.'
    );
  }

  try {
    console.log('[VoiceService] Iniciando gravação de áudio...');

    // Habilita metering (essencial para detecção de silêncio e waveforms)
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const recordingOptions: any = {
      ...RECORDING_OPTIONS,
      android: {
        ...RECORDING_OPTIONS.android,
        meteringEnabled: true,
      },
      ios: {
        ...RECORDING_OPTIONS.ios,
        meteringEnabled: true,
      },
    };

    const { recording } = await Audio.Recording.createAsync(
      recordingOptions,
      onStatusUpdate,
      100 // Frequência de atualização de status: 100ms
    );

    console.log('[VoiceService] Gravação iniciada. Áudio sendo salvo localmente no dispositivo.');
    return recording;

  } catch (error) {
    console.error('[VoiceService] ERRO ao iniciar gravação:', error);
    throw new VoiceServiceError(
      'RECORDING_FAILED',
      'Falha ao iniciar a gravação. Verifique se o microfone está disponível.',
      error
    );
  }
}

/**
 * Encerra a gravação e retorna o resultado com URI local.
 *
 * SEGURANÇA: O URI retornado aponta para o FileSystem LOCAL do dispositivo.
 * Este URI nunca deve ser enviado diretamente para APIs externas —
 * apenas o texto da transcrição deve sair do dispositivo.
 *
 * @param recording - Instância ativa retornada por startRecording()
 * @throws VoiceServiceError se a parada falhar ou nenhum áudio for capturado
 */
export async function stopRecording(
  recording: Audio.Recording
): Promise<VoiceRecordingResult> {
  try {
    console.log('[VoiceService] Encerrando gravação...');

    // Obtém a duração ANTES de descarregar o objeto
    const statusBeforeStop = await recording.getStatusAsync();
    const durationMs = statusBeforeStop.isRecording
      ? (statusBeforeStop.durationMillis ?? 0)
      : 0;

    await recording.stopAndUnloadAsync();

    // Restaura modo de áudio normal após gravação
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });

    const uri = recording.getURI();

    if (!uri) {
      throw new VoiceServiceError(
        'NO_AUDIO_CAPTURED',
        'Nenhum áudio foi capturado. O arquivo de gravação não foi criado.'
      );
    }

    if (durationMs < MIN_RECORDING_DURATION_MS) {
      throw new VoiceServiceError(
        'NO_AUDIO_CAPTURED',
        `Gravação muito curta (${durationMs}ms). Mantenha o botão pressionado enquanto fala.`
      );
    }

    console.log('[VoiceService] Gravação encerrada com sucesso.', {
      uriLocal: uri,
      durationMs,
      note: 'Arquivo de áudio armazenado apenas no dispositivo — não transmitido.',
    });

    return { uri, durationMs };

  } catch (error) {
    if (error instanceof VoiceServiceError) throw error;
    console.error('[VoiceService] ERRO ao encerrar gravação:', error);
    throw new VoiceServiceError(
      'STOP_FAILED',
      'Falha ao encerrar a gravação.',
      error
    );
  }
}

// ─── Transcrição ──────────────────────────────────────────────────────────────

/**
 * Converte o áudio local em texto via API de transcrição do Groq (Whisper).
 *
 * @param result - VoiceRecordingResult com URI local do áudio
 * @returns TranscriptionResult com texto transcrito
 * @throws VoiceServiceError se a transcrição falhar
 */
export async function transcribeAudio(
  result: VoiceRecordingResult
): Promise<TranscriptionResult> {
  const startTime = Date.now();
  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY;

  console.log('[VoiceService] Iniciando transcrição real via Groq Whisper...', {
    audioUri: result.uri,
    durationMs: result.durationMs,
  });

  if (!apiKey) {
    throw new VoiceServiceError(
      'TRANSCRIPTION_FAILED',
      'Chave de API (EXPO_PUBLIC_GROQ_API_KEY) não encontrada no ambiente.'
    );
  }

  try {
    const formData = new FormData();

    /**
     * IMPORTANTE para React Native:
     * Ao anexar arquivos em FormData, o objeto DEVE conter:
     * uri, name, type. Caso contrário o fetch não envia o blob corretamente.
     */
    formData.append('file', {
      uri: result.uri,
      name: 'recording.m4a',
      type: 'audio/m4a',
    } as any);

    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'pt');
    formData.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // Importante: Não defina Content-Type manualmente ao usar FormData no RN/fetch
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VoiceService] Erro Groq Whisper:', response.status, errorText);
      throw new VoiceServiceError(
        'TRANSCRIPTION_FAILED',
        `Erro na transcrição (${response.status}). Verifique a conexão e API Key.`
      );
    }

    const data = await response.json();
    const text = data.text || '';

    if (!text.trim()) {
      throw new VoiceServiceError(
        'TRANSCRIPTION_FAILED',
        'Nenhuma fala detectada no áudio enviado.'
      );
    }

    const processingTimeMs = Date.now() - startTime;

    console.log('[VoiceService] Transcrição concluída com sucesso:', {
      text,
      processingTimeMs,
    });

    return {
      text: text.trim(),
      confidence: 0.99,
      processingTimeMs,
      isSimulated: false,
    };

  } catch (error) {
    if (error instanceof VoiceServiceError) throw error;
    console.error('[VoiceService] Erro fatal na transcrição:', error);
    throw new VoiceServiceError(
      'TRANSCRIPTION_FAILED',
      'Falha ao conectar com o serviço de voz do Groq.',
      error
    );
  }
}

// ─── Pipeline Completo ────────────────────────────────────────────────────────

/**
 * Pipeline simplificado de gravação + transcrição.
 * Útil para gravações com tempo máximo automático (ex: 5s, 10s).
 *
 * @param maxDurationMs - Duração máxima antes do auto-stop (default: 10s)
 * @param onStateChange - Callback para atualizar UI durante o pipeline
 */
export async function recordAndTranscribe(
  maxDurationMs = 10_000,
  onStateChange?: (state: 'recording' | 'processing') => void
): Promise<TranscriptionResult> {
  onStateChange?.('recording');
  const recording = await startRecording();

  await new Promise<void>((resolve) =>
    setTimeout(resolve, Math.min(maxDurationMs, MAX_RECORDING_DURATION_MS))
  );

  const recordingResult = await stopRecording(recording);

  onStateChange?.('processing');
  return transcribeAudio(recordingResult);
}
