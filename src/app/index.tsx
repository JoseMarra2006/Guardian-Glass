/**
 * @file src/app/index.tsx
 * @description HUD Principal do PetroGate AR — Realidade Aumentada
 *
 * Tela principal exibida após autenticação do operador.
 * Simula o overlay de Realidade Aumentada de um Smart Glass industrial:
 *   - Status do sistema em tempo real (barra superior)
 *   - Área central de conteúdo AR (câmera ou fundo escuro)
 *   - Legenda de transcrição em tempo real (estilo closed caption)
 *   - VoiceInterface integrada na barra inferior
 *
 * INTEGRAÇÃO DE SEGURANÇA:
 *   Toda consulta de voz passa pelo pipeline:
 *   [Microfone] → [VoiceService] → [DLP Scanner] → [AI Gateway] → [HUD]
 *
 * USO:
 *   Importar como <HudScreen /> no App.tsx ou via expo-router (src/app/index.tsx)
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  Animated,
  StyleSheet,
  Platform,
  Pressable,
  SafeAreaView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { useAuth } from '../context/AuthContext';
import VoiceInterface from '../components/VoiceInterface';
import { type AiGateResponse } from '../services/aiGate';

// ─── Tokens de Design ─────────────────────────────────────────────────────────

const C = {
  dark:    '#050C11',
  panel:   '#0D1F2D',
  mid:     '#1A3A4A',
  neon:    '#00FFB2',
  neonDim: '#00FFB230',
  text:    '#8BBCCC',
  white:   '#E8F4F8',
  error:   '#FF4560',
  warning: '#FFB800',
  border:  '#1A3A4A',
} as const;

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AiSession {
  transcript: string;
  response: AiGateResponse;
  timestamp: string;
}

// ─── Componentes Auxiliares do HUD ────────────────────────────────────────────

function SystemBadge({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={hud.badge}>
      <Text style={hud.badgeLabel}>{label}</Text>
      <Text style={[hud.badgeValue, { color: color ?? C.neon }]}>{value}</Text>
    </View>
  );
}

/** Relógio em tempo real atualizado a cada segundo */
function LiveClock() {
  const [time, setTime] = useState(() => formatTime(new Date()));

  useEffect(() => {
    const id = setInterval(() => setTime(formatTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return <Text style={hud.clockText}>{time}</Text>;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Grade de pontos que simula o HUD overlay de um Smart Glass.
 * Puramente decorativo — renderiza uma grade de pontos no fundo.
 */
function ArGrid() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Linhas horizontais */}
      {[0.2, 0.4, 0.6, 0.8].map((pct) => (
        <View
          key={`h-${pct}`}
          style={[
            arGrid.line,
            { top: `${pct * 100}%`, width: '100%', height: 1 },
          ]}
        />
      ))}
      {/* Linhas verticais */}
      {[0.25, 0.5, 0.75].map((pct) => (
        <View
          key={`v-${pct}`}
          style={[
            arGrid.line,
            { left: `${pct * 100}%`, height: '100%', width: 1 },
          ]}
        />
      ))}
      {/* Canto superior esquerdo */}
      <View style={[arGrid.corner, { top: 16, left: 16 }]}>
        <View style={[arGrid.cornerH, { marginBottom: 0 }]} />
        <View style={arGrid.cornerV} />
      </View>
      {/* Canto superior direito */}
      <View style={[arGrid.corner, { top: 16, right: 16, alignItems: 'flex-end' }]}>
        <View style={[arGrid.cornerH, { marginBottom: 0 }]} />
        <View style={arGrid.cornerV} />
      </View>
      {/* Canto inferior esquerdo */}
      <View style={[arGrid.corner, { bottom: 16, left: 16, justifyContent: 'flex-end' }]}>
        <View style={arGrid.cornerV} />
        <View style={arGrid.cornerH} />
      </View>
      {/* Canto inferior direito */}
      <View style={[arGrid.corner, { bottom: 16, right: 16, justifyContent: 'flex-end', alignItems: 'flex-end' }]}>
        <View style={arGrid.cornerV} />
        <View style={arGrid.cornerH} />
      </View>
    </View>
  );
}

/** Legenda de transcrição em tempo real estilo closed caption */
function TranscriptCaption({
  text,
  visible,
}: {
  text: string;
  visible: boolean;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  return (
    <Animated.View style={[caption.container, { opacity }]}>
      <View style={caption.pill}>
        <View style={caption.dot} />
        <Text style={caption.text} numberOfLines={3}>
          {text}
        </Text>
      </View>
    </Animated.View>
  );
}

// ─── Tela Principal do HUD ────────────────────────────────────────────────────

export default function HudScreen() {
  const { userName, userEmail, userRole, deviceId, signOut } = useAuth();

  const [liveTranscript, setLiveTranscript] = useState('');
  const [showCaption, setShowCaption]       = useState(false);
  const [sessions, setSessions]             = useState<AiSession[]>([]);
  const [sessionCount, setSessionCount]     = useState(0);

  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recebe transcrição em tempo real do VoiceInterface → exibe como legenda
  const handleTranscriptUpdate = useCallback((text: string) => {
    setLiveTranscript(text);
    setShowCaption(true);

    // Esconde a legenda após 4 segundos de inatividade
    if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
    captionTimerRef.current = setTimeout(() => setShowCaption(false), 4000);
  }, []);

  useEffect(() => () => {
    if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
  }, []);

  // Recebe resposta completa do pipeline DLP/AI
  const handleAiResponse = useCallback(
    (response: AiGateResponse, transcript: string) => {
      setShowCaption(false);
      setSessionCount((c) => c + 1);
      setSessions((prev) => [
        {
          transcript,
          response,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
        },
        ...prev.slice(0, 9), // Mantém últimas 10 sessões
      ]);
    },
    []
  );

  const requestContext = {
    userEmail,
    deviceId,
    module: 'hud-ar-voice',
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor={C.dark} />

      {/* ── Grade AR de fundo ── */}
      <ArGrid />

      {/* ── Barra Superior: Status do Sistema ── */}
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <View style={styles.logoDiamond}>
            <Text style={styles.logoText}>P</Text>
          </View>
          <View>
            <Text style={styles.appTitle}>PETROGATE AR</Text>
            <Text style={styles.appSubtitle}>MODO OPERACIONAL</Text>
          </View>
        </View>

        <View style={styles.topRight}>
          <LiveClock />
          <View style={styles.onlineDot} />
        </View>
      </View>

      <View style={styles.divider} />

      {/* ── Badges de Status ── */}
      <View style={styles.badgeRow}>
        <SystemBadge label="DLP"     value="ATIVO"   />
        <SystemBadge label="GATEWAY" value="ONLINE"  />
        <SystemBadge label="SESSÕES" value={String(sessionCount)} />
        <SystemBadge label="ROLE"    value={userRole.split(' ')[0]} />
      </View>

      <View style={styles.divider} />

      {/* ── Área Central: Histórico de Sessões ── */}
      <ScrollView
        style={styles.sessionsScroll}
        contentContainerStyle={styles.sessionsContent}
        showsVerticalScrollIndicator={false}
      >
        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            {/* Crosshair central estilo AR */}
            <View style={styles.crosshair}>
              <View style={[styles.crossLine, styles.crossH]} />
              <View style={[styles.crossLine, styles.crossV]} />
              <View style={styles.crossCenter} />
            </View>
            <Text style={styles.emptyTitle}>SISTEMA PRONTO</Text>
            <Text style={styles.emptySubtitle}>
              Pressione o microfone abaixo{'\n'}para fazer uma consulta por voz
            </Text>
          </View>
        ) : (
          sessions.map((session, index) => (
            <SessionCard key={index} session={session} />
          ))
        )}
      </ScrollView>

      {/* ── Legenda de Transcrição (Closed Caption) ── */}
      <TranscriptCaption
        text={liveTranscript}
        visible={showCaption}
      />

      <View style={styles.divider} />

      {/* ── Barra Inferior: Interface de Voz ── */}
      <View style={styles.bottomBar}>
        <View style={styles.operatorInfo}>
          <Text style={styles.operatorLabel}>OPERADOR</Text>
          <Text style={styles.operatorName} numberOfLines={1}>{userName}</Text>
        </View>

        <VoiceInterface
          requestContext={requestContext}
          onAiResponse={handleAiResponse}
          onTranscriptUpdate={handleTranscriptUpdate}
          containerStyle={styles.voiceInterfaceContainer}
        />

        <Pressable
          onPress={signOut}
          style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.5 }]}
          accessibilityLabel="Encerrar sessão"
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>SAIR</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Card de Sessão de IA ─────────────────────────────────────────────────────

function SessionCard({ session }: { session: AiSession }) {
  const [expanded, setExpanded] = useState(false);
  const { response, transcript, timestamp } = session;

  const dlpColor =
    response.dlpStatus === 'BLOCKED'   ? C.error   :
    response.dlpStatus === 'SANITIZED' ? C.warning :
    C.neon;

  return (
    <Pressable
      onPress={() => setExpanded((e) => !e)}
      style={({ pressed }) => [card.container, pressed && { opacity: 0.85 }]}
    >
      {/* Header da sessão */}
      <View style={card.header}>
        <Text style={card.timestamp}>{timestamp}</Text>
        <View style={[card.dlpBadge, { borderColor: `${dlpColor}60` }]}>
          <Text style={[card.dlpText, { color: dlpColor }]}>
            {response.dlpStatus}
          </Text>
        </View>
        <Text style={card.expandIcon}>{expanded ? '▲' : '▼'}</Text>
      </View>

      {/* Transcrição */}
      <Text style={card.transcript} numberOfLines={expanded ? undefined : 1}>
        ❝ {transcript} ❞
      </Text>

      {/* Resposta expandida */}
      {expanded && (
        <View style={card.responseArea}>
          <View style={card.responseDivider} />
          {response.success ? (
            <Text style={card.responseText}>{response.aiResponse}</Text>
          ) : (
            <Text style={card.responseBlocked}>{response.errorMessage}</Text>
          )}
          {response.auditLogId && (
            <Text style={card.auditId}>
              AUDIT LOG: {response.auditLogId.slice(0, 16).toUpperCase()}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.dark,
  },

  // Barra superior
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 12 : 8,
    paddingBottom: 12,
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoDiamond: {
    width: 34,
    height: 34,
    backgroundColor: C.neon,
    transform: [{ rotate: '45deg' }],
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    color: C.dark,
    fontSize: 15,
    fontWeight: '900',
    transform: [{ rotate: '-45deg' }],
    fontFamily: MONO,
  },
  appTitle: {
    color: C.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 4,
    fontFamily: MONO,
  },
  appSubtitle: {
    color: C.neon,
    fontSize: 8,
    letterSpacing: 2.5,
    fontFamily: MONO,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.neon,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: `${C.mid}80`,
    marginHorizontal: 0,
  },

  // Badges
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  // Área de sessões
  sessionsScroll: {
    flex: 1,
  },
  sessionsContent: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingVertical: 40,
  },
  crosshair: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  crossLine: {
    position: 'absolute',
    backgroundColor: `${C.neon}50`,
  },
  crossH: {
    width: 60,
    height: 1,
  },
  crossV: {
    width: 1,
    height: 60,
  },
  crossCenter: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: C.neon,
  },
  emptyTitle: {
    fontFamily: MONO,
    fontSize: 14,
    color: C.neon,
    letterSpacing: 4,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.text,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.5,
  },

  // Barra inferior
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: `${C.panel}CC`,
    gap: 8,
  },
  operatorInfo: {
    flex: 1,
    gap: 2,
  },
  operatorLabel: {
    fontFamily: MONO,
    fontSize: 7,
    color: C.text,
    letterSpacing: 2,
  },
  operatorName: {
    fontFamily: MONO,
    fontSize: 10,
    color: C.white,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  voiceInterfaceContainer: {
    flex: 2,
    paddingVertical: 0,
    gap: 8,
  },
  signOutBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: `${C.mid}80`,
    paddingVertical: 10,
    borderRadius: 2,
    alignItems: 'center',
  },
  signOutText: {
    fontFamily: MONO,
    fontSize: 9,
    color: C.text,
    letterSpacing: 2,
  },
});

// ─── Estilos do HUD ───────────────────────────────────────────────────────────

const hud = StyleSheet.create({
  badge: {
    alignItems: 'center',
    gap: 4,
  },
  badgeLabel: {
    fontFamily: MONO,
    fontSize: 7,
    color: C.text,
    letterSpacing: 1.5,
  },
  badgeValue: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    color: C.neon,
    letterSpacing: 0.5,
  },
  clockText: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.neon,
    letterSpacing: 1,
    fontWeight: '700',
  },
});

// ─── Estilos da Grade AR ──────────────────────────────────────────────────────

const arGrid = StyleSheet.create({
  line: {
    position: 'absolute',
    backgroundColor: `${C.mid}25`,
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    justifyContent: 'flex-start',
  },
  cornerH: {
    width: 20,
    height: 1.5,
    backgroundColor: `${C.neon}60`,
  },
  cornerV: {
    width: 1.5,
    height: 20,
    backgroundColor: `${C.neon}60`,
  },
});

// ─── Estilos da Legenda ───────────────────────────────────────────────────────

const caption = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 140,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: `${C.dark}E0`,
    borderWidth: 1,
    borderColor: `${C.neon}40`,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '90%',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.neon,
    marginTop: 5,
  },
  text: {
    flex: 1,
    fontFamily: MONO,
    fontSize: 13,
    color: C.white,
    lineHeight: 20,
  },
});

// ─── Estilos do Card de Sessão ────────────────────────────────────────────────

const card = StyleSheet.create({
  container: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: `${C.mid}90`,
    borderRadius: 4,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timestamp: {
    fontFamily: MONO,
    fontSize: 9,
    color: C.text,
    letterSpacing: 1,
    flex: 1,
  },
  dlpBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 2,
    borderWidth: 1,
  },
  dlpText: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1,
    fontWeight: '700',
  },
  expandIcon: {
    fontFamily: MONO,
    fontSize: 8,
    color: C.text,
  },
  transcript: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.text,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  responseArea: {
    gap: 8,
  },
  responseDivider: {
    height: 1,
    backgroundColor: `${C.mid}60`,
  },
  responseText: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.white,
    lineHeight: 18,
  },
  responseBlocked: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.error,
    lineHeight: 18,
  },
  auditId: {
    fontFamily: MONO,
    fontSize: 8,
    color: C.text,
    letterSpacing: 0.5,
    marginTop: 2,
  },
});
