/**
 * @file VoiceInterface.tsx
 * @description Componente de Interface de Voz — PetroGate AR Fase 2
 *
 * Interface visual estilo Smart Glass com animações de microfone/onda sonora.
 * Gerencia o ciclo completo: Gravação → Transcrição → Pipeline DLP/AI.
 *
 * ESTADOS VISUAIS:
 *   IDLE        → Microfone estático com pulso suave (aguardando interação)
 *   LISTENING   → Anéis de onda pulsante radiando do centro (gravando)
 *   PROCESSING  → Anel giratório + texto "PROCESSANDO VOZ..." (transcrevendo)
 *   SUCCESS     → Flash verde + texto transcrito (transcrição concluída)
 *   AI_RESPONSE → Exibe resposta da IA (pipeline concluído)
 *   ERROR       → Pulso vermelho + mensagem de erro diagnóstica
 *
 * FLUXO DE SEGURANÇA:
 *   Áudio → [VoiceService: gravação local] → [Transcrição] → Texto
 *   Texto → [DLP Scanner] → [AI Gateway] → Resposta filtrada
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Audio } from 'expo-av';

import {
  startRecording,
  stopRecording,
  transcribeAudio,
  VoiceServiceError,
  type TranscriptionResult,
} from '../services/voiceService';
import {
  processSecureAiRequest,
  type AiGateResponse,
  type RequestContext,
} from '../services/aiGate';

// ─── Tokens de Design (Smart Glass / Petro-Neon) ─────────────────────────────

const C = {
  dark:       '#050C11',
  panel:      '#0D1F2D',
  mid:        '#1A3A4A',
  neon:       '#00FFB2',
  neonDim:    '#00FFB240',
  neonMid:    '#00FFB280',
  text:       '#8BBCCC',
  white:      '#E8F4F8',
  error:      '#FF4560',
  errorDim:   '#FF456040',
  warning:    '#FFB800',
  border:     '#1A3A4A90',
} as const;

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type VoiceState =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'AI_RESPONSE'
  | 'ERROR';

interface VoiceInterfaceProps {
  /** Contexto do dispositivo/usuário para o AI Gateway */
  requestContext: RequestContext;
  /**
   * Callback chamado quando o pipeline DLP/AI completa com sucesso.
   * Útil para exibir a resposta em camadas superiores do HUD.
   */
  onAiResponse?: (response: AiGateResponse, transcript: string) => void;
  /** Callback para atualização em tempo real do texto transcrito (estilo legenda) */
  onTranscriptUpdate?: (text: string) => void;
  /** Estilo opcional do container raiz */
  containerStyle?: object;
}

// ─── Hook: Animações de Estado ────────────────────────────────────────────────

function useVoiceAnimations() {
  // Pulso do IDLE — oscilação suave do brilho
  const idlePulse = useRef(new Animated.Value(0)).current;

  // Anéis de onda do LISTENING (3 anéis com delay escalonado)
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  // Rotação do PROCESSING
  const spinner = useRef(new Animated.Value(0)).current;

  // Pulso do ERROR
  const errorPulse = useRef(new Animated.Value(0)).current;

  // Flash do SUCCESS
  const successFlash = useRef(new Animated.Value(0)).current;

  const animationsRef = useRef<Animated.CompositeAnimation[]>([]);

  const stopAll = useCallback(() => {
    animationsRef.current.forEach((a) => a.stop());
    animationsRef.current = [];
    [idlePulse, ring1, ring2, ring3, spinner, errorPulse, successFlash].forEach(
      (v) => v.setValue(0)
    );
  }, [idlePulse, ring1, ring2, ring3, spinner, errorPulse, successFlash]);

  const startIdleAnim = useCallback(() => {
    stopAll();
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(idlePulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(idlePulse, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    animationsRef.current.push(anim);
    anim.start();
  }, [idlePulse, stopAll]);

  const startListeningAnim = useCallback(() => {
    stopAll();
    const makeRingAnim = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(value, { toValue: 1, duration: 1400, useNativeDriver: true }),
          ]),
          Animated.timing(value, { toValue: 0, duration: 50, useNativeDriver: true }),
          Animated.delay(Math.max(0, 1400 - delay - 50)),
        ])
      );

    const anim = Animated.parallel([
      makeRingAnim(ring1, 0),
      makeRingAnim(ring2, 460),
      makeRingAnim(ring3, 920),
    ]);
    animationsRef.current.push(anim);
    anim.start();
  }, [ring1, ring2, ring3, stopAll]);

  const startProcessingAnim = useCallback(() => {
    stopAll();
    const anim = Animated.loop(
      Animated.timing(spinner, { toValue: 1, duration: 1100, useNativeDriver: true })
    );
    animationsRef.current.push(anim);
    anim.start();
  }, [spinner, stopAll]);

  const startErrorAnim = useCallback(() => {
    stopAll();
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(errorPulse, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(errorPulse, { toValue: 0, duration: 400, useNativeDriver: true }),
      ])
    );
    animationsRef.current.push(anim);
    anim.start();
  }, [errorPulse, stopAll]);

  const triggerSuccessFlash = useCallback(() => {
    stopAll();
    Animated.sequence([
      Animated.timing(successFlash, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(successFlash, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [successFlash, stopAll]);

  useEffect(() => () => stopAll(), [stopAll]);

  return {
    idlePulse,
    ring1, ring2, ring3,
    spinner,
    errorPulse,
    successFlash,
    startIdleAnim,
    startListeningAnim,
    startProcessingAnim,
    startErrorAnim,
    triggerSuccessFlash,
    stopAll,
  };
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function VoiceInterface({
  requestContext,
  onAiResponse,
  onTranscriptUpdate,
  containerStyle,
}: VoiceInterfaceProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>('IDLE');
  const [transcript, setTranscript]         = useState('');
  const [aiResponse, setAiResponse]         = useState<AiGateResponse | null>(null);
  const [errorMessage, setErrorMessage]     = useState('');
  const [recordingDuration, setRecordingDuration] = useState(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const anim = useVoiceAnimations();

  // ── Sincronizar animações com o estado ──
  useEffect(() => {
    switch (voiceState) {
      case 'IDLE':        anim.startIdleAnim();        break;
      case 'LISTENING':   anim.startListeningAnim();   break;
      case 'PROCESSING':  anim.startProcessingAnim();  break;
      case 'SUCCESS':     anim.triggerSuccessFlash();  break;
      case 'AI_RESPONSE': anim.stopAll();              break;
      case 'ERROR':       anim.startErrorAnim();       break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // ── Timer de duração da gravação ──
  const startDurationTimer = useCallback(() => {
    setRecordingDuration(0);
    durationTimerRef.current = setInterval(() => {
      setRecordingDuration((d) => d + 1);
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopDurationTimer(), [stopDurationTimer]);

  // ── Handler: Iniciar Gravação ──
  const handleStartRecording = useCallback(async () => {
    setErrorMessage('');
    setTranscript('');
    setAiResponse(null);
    setVoiceState('LISTENING');
    startDurationTimer();

    try {
      const recording = await startRecording();
      recordingRef.current = recording;
    } catch (error) {
      stopDurationTimer();
      const msg = error instanceof VoiceServiceError
        ? error.message
        : 'Erro inesperado ao iniciar gravação.';
      console.error('[VoiceInterface] Erro ao iniciar gravação:', error);
      setErrorMessage(msg);
      setVoiceState('ERROR');
    }
  }, [startDurationTimer, stopDurationTimer]);

  // ── Handler: Parar Gravação e Processar ──
  const handleStopRecording = useCallback(async () => {
    if (!recordingRef.current || voiceState !== 'LISTENING') return;

    stopDurationTimer();
    setVoiceState('PROCESSING');

    const recording = recordingRef.current;
    recordingRef.current = null;

    try {
      // ETAPA 1: Encerrar gravação (áudio salvo localmente)
      const recordingResult = await stopRecording(recording);

      // ETAPA 2: Transcrever áudio → texto (único dado que sai do dispositivo)
      const transcriptionResult: TranscriptionResult = await transcribeAudio(recordingResult);

      const transcribedText = transcriptionResult.text;
      setTranscript(transcribedText);
      onTranscriptUpdate?.(transcribedText);

      console.log('[VoiceInterface] Transcrição recebida. Enviando para pipeline DLP/AI...', {
        texto: transcribedText,
        confianca: transcriptionResult.confidence,
        simulacao: transcriptionResult.isSimulated,
      });

      setVoiceState('SUCCESS');

      // Breve pausa para mostrar o estado SUCCESS antes de chamar a IA
      await new Promise<void>((resolve) => setTimeout(resolve, 600));

      // ETAPA 3: Pipeline de segurança DLP → AI Gateway
      setVoiceState('PROCESSING');
      const gateResponse = await processSecureAiRequest(transcribedText, requestContext);

      setAiResponse(gateResponse);
      onAiResponse?.(gateResponse, transcribedText);
      setVoiceState('AI_RESPONSE');

    } catch (error) {
      const msg = error instanceof VoiceServiceError
        ? error.message
        : 'Erro inesperado no processamento de voz.';
      console.error('[VoiceInterface] Erro no pipeline de voz:', error);
      setErrorMessage(msg);
      setVoiceState('ERROR');
    }
  }, [voiceState, stopDurationTimer, requestContext, onAiResponse, onTranscriptUpdate]);

  // ── Handler: Reset ──
  const handleReset = useCallback(() => {
    setVoiceState('IDLE');
    setTranscript('');
    setAiResponse(null);
    setErrorMessage('');
    setRecordingDuration(0);
  }, []);

  // ── Handler: Pressionar botão principal ──
  const handleMicPress = useCallback(() => {
    switch (voiceState) {
      case 'IDLE':        handleStartRecording(); break;
      case 'LISTENING':   handleStopRecording();  break;
      case 'AI_RESPONSE':
      case 'ERROR':       handleReset();          break;
      // PROCESSING / SUCCESS: ignorar toques
    }
  }, [voiceState, handleStartRecording, handleStopRecording, handleReset]);

  // ── Interpolações de animação ──
  const spinInterpolate = anim.spinner.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const makeRingStyle = (ring: Animated.Value) => ({
    transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
    opacity:   ring.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.7, 0] }),
  });

  const idleGlowOpacity = anim.idlePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.45],
  });

  const errorOpacity = anim.errorPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1],
  });

  // ── Dados de estado visual ──
  const isListening   = voiceState === 'LISTENING';
  const isProcessing  = voiceState === 'PROCESSING';
  const isError       = voiceState === 'ERROR';
  const isAiResponse  = voiceState === 'AI_RESPONSE';
  const isInteractive = ['IDLE', 'LISTENING', 'AI_RESPONSE', 'ERROR'].includes(voiceState);

  const btnColor      = isError ? C.error : isListening ? C.neon : C.neonMid;
  const statusLabel   = getStatusLabel(voiceState, recordingDuration);
  const dlpBadgeColor = getDlpBadgeColor(aiResponse?.dlpStatus);

  return (
    <View style={[styles.container, containerStyle]}>

      {/* ── Label de Status ── */}
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: btnColor }]} />
        <Text style={[styles.statusLabel, { color: isError ? C.error : C.neon }]}>
          {statusLabel}
        </Text>
      </View>

      {/* ── Área do Microfone com Anéis ── */}
      <View style={styles.micArea}>

        {/* Anéis de LISTENING */}
        {isListening && (
          <>
            <Animated.View style={[styles.ring, styles.ring3, makeRingStyle(anim.ring3)]} />
            <Animated.View style={[styles.ring, styles.ring2, makeRingStyle(anim.ring2)]} />
            <Animated.View style={[styles.ring, styles.ring1, makeRingStyle(anim.ring1)]} />
          </>
        )}

        {/* Anel de IDLE (brilho estático) */}
        {voiceState === 'IDLE' && (
          <Animated.View style={[styles.ring, styles.ring1, { opacity: idleGlowOpacity }]} />
        )}

        {/* Anel de ERROR */}
        {isError && (
          <Animated.View style={[styles.ring, styles.ring1, styles.ringError, { opacity: errorOpacity }]} />
        )}

        {/* Spinner de PROCESSING */}
        {isProcessing && (
          <Animated.View style={[
            styles.spinnerRing,
            { transform: [{ rotate: spinInterpolate }] },
          ]} />
        )}

        {/* Botão central do microfone */}
        <Pressable
          onPress={handleMicPress}
          disabled={!isInteractive}
          style={({ pressed }) => [
            styles.micButton,
            { borderColor: btnColor, backgroundColor: isListening ? `${C.neon}18` : C.panel },
            pressed && isInteractive && { opacity: 0.75, transform: [{ scale: 0.95 }] },
          ]}
          accessibilityLabel={isListening ? 'Parar gravação' : 'Iniciar gravação de voz'}
          accessibilityRole="button"
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={C.neon} />
          ) : (
            <MicIcon state={voiceState} />
          )}
        </Pressable>
      </View>

      {/* ── Texto Transcrito (Legenda em Tempo Real) ── */}
      {transcript !== '' && voiceState !== 'IDLE' && (
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptLabel}>TRANSCRIÇÃO</Text>
          <Text style={styles.transcriptText}>{transcript}</Text>
        </View>
      )}

      {/* ── Resposta da IA ── */}
      {isAiResponse && aiResponse && (
        <View style={styles.aiResponseBox}>
          {/* Header com DLP Status */}
          <View style={styles.aiResponseHeader}>
            <Text style={styles.aiResponseLabel}>RESPOSTA DA IA</Text>
            <View style={[styles.dlpBadge, { backgroundColor: dlpBadgeColor }]}>
              <Text style={styles.dlpBadgeText}>{aiResponse.dlpStatus}</Text>
            </View>
          </View>

          {aiResponse.success ? (
            <Text style={styles.aiResponseText}>
              {aiResponse.aiResponse}
            </Text>
          ) : (
            <Text style={styles.aiBlockedText}>
              {aiResponse.errorMessage}
            </Text>
          )}

          {/* Audit Log ID */}
          {aiResponse.auditLogId && (
            <Text style={styles.auditId}>
              LOG#{aiResponse.auditLogId.slice(0, 8).toUpperCase()}
            </Text>
          )}

          {/* Botão Nova Consulta */}
          <Pressable
            onPress={handleReset}
            style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.resetBtnText}>[ NOVA CONSULTA ]</Text>
          </Pressable>
        </View>
      )}

      {/* ── Mensagem de Erro ── */}
      {isError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorLabel}>ERRO DE SISTEMA</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable
            onPress={handleReset}
            style={({ pressed }) => [styles.resetBtn, styles.resetBtnError, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.resetBtnText, { color: C.error }]}>[ TENTAR NOVAMENTE ]</Text>
          </Pressable>
        </View>
      )}

      {/* ── Dica de Uso (apenas IDLE) ── */}
      {voiceState === 'IDLE' && (
        <Text style={styles.hint}>
          TOQUE PARA CONSULTAR A IA POR VOZ
        </Text>
      )}
    </View>
  );
}

// ─── Ícone do Microfone ───────────────────────────────────────────────────────

function MicIcon({ state }: { state: VoiceState }): ReactNode {
  if (state === 'LISTENING') {
    return (
      <View style={micIconStyles.container}>
        {/* Cabeça do mic */}
        <View style={[micIconStyles.head, { backgroundColor: C.neon }]} />
        {/* Corpo do mic */}
        <View style={[micIconStyles.body, { backgroundColor: C.neon }]} />
        {/* Base */}
        <View style={[micIconStyles.base, { backgroundColor: C.neon }]} />
        <View style={[micIconStyles.stand, { backgroundColor: C.neon }]} />
      </View>
    );
  }

  if (state === 'ERROR') {
    return (
      <Text style={[micIconStyles.fallbackText, { color: C.error }]}>✕</Text>
    );
  }

  if (state === 'AI_RESPONSE') {
    return (
      <Text style={[micIconStyles.fallbackText, { color: C.neon }]}>↩</Text>
    );
  }

  // IDLE / SUCCESS
  return (
    <View style={micIconStyles.container}>
      <View style={[micIconStyles.head, { backgroundColor: C.neonMid }]} />
      <View style={[micIconStyles.body, { backgroundColor: C.neonMid }]} />
      <View style={[micIconStyles.base, { backgroundColor: C.neonMid }]} />
      <View style={[micIconStyles.stand, { backgroundColor: C.neonMid }]} />
    </View>
  );
}

const micIconStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
  },
  head: {
    width: 14,
    height: 18,
    borderRadius: 7,
  },
  body: {
    width: 14,
    height: 6,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
  },
  base: {
    width: 20,
    height: 2,
    borderRadius: 1,
  },
  stand: {
    width: 2,
    height: 6,
    borderRadius: 1,
  },
  fallbackText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 24,
    fontWeight: '700',
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusLabel(state: VoiceState, duration: number): string {
  switch (state) {
    case 'IDLE':        return '● AGUARDANDO';
    case 'LISTENING':   return `◉ OUVINDO... ${duration}s`;
    case 'PROCESSING':  return '◌ PROCESSANDO VOZ...';
    case 'SUCCESS':     return '✓ TRANSCRIÇÃO CONCLUÍDA';
    case 'AI_RESPONSE': return '■ RESPOSTA PRONTA';
    case 'ERROR':       return '✕ ERRO DE SISTEMA';
  }
}

function getDlpBadgeColor(status?: 'CLEAN' | 'SANITIZED' | 'BLOCKED'): string {
  switch (status) {
    case 'CLEAN':     return '#00FFB220';
    case 'SANITIZED': return '#FFB80030';
    case 'BLOCKED':   return '#FF456030';
    default:          return '#1A3A4A';
  }
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const MIC_SIZE = 80;
const RING_SIZE = MIC_SIZE;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
  },

  // Status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 2.5,
    fontWeight: '700',
  },

  // Área do microfone
  micArea: {
    width: MIC_SIZE * 3,
    height: MIC_SIZE * 3,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Anéis animados
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: C.neon,
  },
  ring1: { borderColor: C.neon },
  ring2: { borderColor: `${C.neon}AA` },
  ring3: { borderColor: `${C.neon}55` },
  ringError: { borderColor: C.error },

  // Spinner de processamento
  spinnerRing: {
    position: 'absolute',
    width: MIC_SIZE + 20,
    height: MIC_SIZE + 20,
    borderRadius: (MIC_SIZE + 20) / 2,
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: C.neon,
    borderRightColor: C.neonDim,
  },

  // Botão do microfone
  micButton: {
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.panel,
  },

  // Transcrição (legenda)
  transcriptBox: {
    width: '100%',
    backgroundColor: `${C.panel}CC`,
    borderWidth: 1,
    borderColor: `${C.neon}40`,
    borderRadius: 4,
    padding: 14,
    gap: 6,
  },
  transcriptLabel: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 3,
    color: C.text,
  },
  transcriptText: {
    fontFamily: MONO,
    fontSize: 13,
    color: C.white,
    lineHeight: 20,
  },

  // Resposta da IA
  aiResponseBox: {
    width: '100%',
    backgroundColor: `${C.panel}EE`,
    borderWidth: 1,
    borderColor: `${C.neon}60`,
    borderRadius: 4,
    padding: 16,
    gap: 10,
  },
  aiResponseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiResponseLabel: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 3,
    color: C.text,
  },
  dlpBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
  },
  dlpBadgeText: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '700',
    color: C.neon,
    letterSpacing: 1,
  },
  aiResponseText: {
    fontFamily: MONO,
    fontSize: 12,
    color: C.white,
    lineHeight: 19,
  },
  aiBlockedText: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.error,
    lineHeight: 18,
  },
  auditId: {
    fontFamily: MONO,
    fontSize: 8,
    color: C.text,
    letterSpacing: 1,
    marginTop: 4,
  },

  // Erro
  errorBox: {
    width: '100%',
    backgroundColor: `${C.errorDim}`,
    borderWidth: 1,
    borderColor: `${C.error}60`,
    borderRadius: 4,
    padding: 14,
    gap: 8,
  },
  errorLabel: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 3,
    color: C.error,
    fontWeight: '700',
  },
  errorText: {
    fontFamily: MONO,
    fontSize: 12,
    color: C.white,
    lineHeight: 18,
  },

  // Botões de ação
  resetBtn: {
    borderWidth: 1,
    borderColor: `${C.neon}50`,
    paddingVertical: 10,
    borderRadius: 2,
    alignItems: 'center',
    marginTop: 4,
  },
  resetBtnError: {
    borderColor: `${C.error}50`,
  },
  resetBtnText: {
    fontFamily: MONO,
    fontSize: 10,
    color: C.neon,
    letterSpacing: 2,
  },

  // Dica
  hint: {
    fontFamily: MONO,
    fontSize: 8,
    color: C.text,
    letterSpacing: 2,
    opacity: 0.6,
    textAlign: 'center',
  },
});
