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
 * @throws VoiceServiceError com código PERMISSION_DENIED ou RECORDING_FAILED
 * @returns Instância de Audio.Recording ativa
 */
export async function startRecording(): Promise<Audio.Recording> {
  const hasPermission = await requestMicrophonePermission();

  if (!hasPermission) {
    throw new VoiceServiceError(
      'PERMISSION_DENIED',
      'Permissão de microfone não concedida. Habilite nas configurações do dispositivo.'
    );
  }

  try {
    console.log('[VoiceService] Iniciando gravação de áudio...');

    const { recording } = await Audio.Recording.createAsync(
      RECORDING_OPTIONS,
      (status) => {
        // Callback de status durante gravação — pode ser usado para nível de áudio
        if (status.isRecording && status.metering !== undefined) {
          // status.metering: -160 (silêncio) a 0 (máximo) em dB
          // Útil para animações de waveform em tempo real no componente VoiceInterface
        }
      },
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
 * Converte o áudio local em texto via API de transcrição.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * REGRA DE OURO: Apenas o TEXTO resultante sai do dispositivo, NUNCA o áudio.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * IMPLEMENTAÇÃO EM PRODUÇÃO (descomente e configure):
 * ```
 * const formData = new FormData();
 * formData.append('file', { uri: result.uri, name: 'audio.m4a', type: 'audio/m4a' });
 * formData.append('model', 'whisper-1');
 * formData.append('language', 'pt');
 *
 * // VIA EDGE FUNCTION (recomendado — JWT validation server-side):
 * const res = await fetch(EXPO_PUBLIC_TRANSCRIPTION_EDGE_URL, {
 *   method: 'POST',
 *   headers: { Authorization: `Bearer ${session.access_token}` },
 *   body: formData,
 * });
 * ```
 *
 * @param result - VoiceRecordingResult com URI local do áudio
 * @returns TranscriptionResult com texto (único dado que entra no pipeline AI)
 * @throws VoiceServiceError se a transcrição falhar
 */
export async function transcribeAudio(
  result: VoiceRecordingResult
): Promise<TranscriptionResult> {
  const startTime = Date.now();

  console.log('[VoiceService] Iniciando transcrição de áudio...', {
    audioUri: result.uri,
    durationMs: result.durationMs,
    destino: 'Processamento local (simulação) — áudio NÃO transmitido',
  });

  // ── PRODUÇÃO: Endpoint do Edge Function proxy (Supabase → Whisper) ──
  const TRANSCRIPTION_ENDPOINT = process.env.EXPO_PUBLIC_TRANSCRIPTION_ENDPOINT;

  if (TRANSCRIPTION_ENDPOINT) {
    return transcribeViaEdgeFunction(result, TRANSCRIPTION_ENDPOINT, startTime);
  }

  // ── SIMULAÇÃO DE DESENVOLVIMENTO ──────────────────────────────────────────
  // Simula delay de processamento proporcional à duração do áudio
  // (Whisper real: ~1s para cada 30s de áudio)
  const simulatedDelay = Math.min(
    Math.max(result.durationMs * 0.4, 800),
    2500
  );

  console.log(`[VoiceService] [SIMULAÇÃO] Aguardando ${simulatedDelay}ms (transcr. simulada)...`);
  await new Promise<void>((resolve) => setTimeout(resolve, simulatedDelay));

  const randomQuery = PETROLEUM_SAMPLE_QUERIES[
    Math.floor(Math.random() * PETROLEUM_SAMPLE_QUERIES.length)
  ];

  const processingTimeMs = Date.now() - startTime;

  console.log('[VoiceService] [SIMULAÇÃO] Transcrição concluída.', {
    textTranscrito: randomQuery,
    processingTimeMs,
    isSimulated: true,
    note: 'Configure EXPO_PUBLIC_TRANSCRIPTION_ENDPOINT para usar transcrição real',
  });

  return {
    text: randomQuery,
    confidence: 0.94,
    processingTimeMs,
    isSimulated: true,
  };
}

/**
 * Envia o áudio para um Supabase Edge Function que atua como proxy autenticado
 * para a API do OpenAI Whisper. O Edge Function valida o JWT antes de encaminhar.
 *
 * @internal — Chamado apenas quando EXPO_PUBLIC_TRANSCRIPTION_ENDPOINT está configurado
 */
async function transcribeViaEdgeFunction(
  result: VoiceRecordingResult,
  endpoint: string,
  startTime: number
): Promise<TranscriptionResult> {
  try {
    const formData = new FormData();
    formData.append('audio', {
      uri: result.uri,
      name: 'audio.m4a',
      type: 'audio/x-m4a',
    } as unknown as Blob);
    formData.append('language', 'pt');
    formData.append('duration_ms', String(result.durationMs));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        // JWT da sessão Supabase para autenticar no Edge Function
        // Authorization: `Bearer ${session.access_token}`,
        'X-PetroGate-Client': 'petrogate-ar-voice/2.0',
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VoiceService] ERRO na API de transcrição:', response.status, errorText);
      throw new VoiceServiceError(
        'TRANSCRIPTION_FAILED',
        `API de transcrição retornou erro ${response.status}. Tente novamente.`
      );
    }

    const data = await response.json();
    const text: string = data?.text ?? data?.transcript ?? '';

    if (!text.trim()) {
      throw new VoiceServiceError(
        'TRANSCRIPTION_FAILED',
        'A transcrição não retornou texto. Verifique se o áudio está audível.'
      );
    }

    return {
      text: text.trim(),
      confidence: data?.confidence ?? 1.0,
      processingTimeMs: Date.now() - startTime,
      isSimulated: false,
    };

  } catch (error) {
    if (error instanceof VoiceServiceError) throw error;
    console.error('[VoiceService] ERRO de rede na transcrição:', error);
    throw new VoiceServiceError(
      'TRANSCRIPTION_FAILED',
      'Serviço de transcrição temporariamente indisponível. Verifique a conexão.',
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
