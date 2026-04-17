import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  Pressable,
  Platform,
  ActivityIndicator,
  Keyboard,
  useWindowDimensions,
  StatusBar,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { sendGroqMessage, ChatMessage } from '../services/groqService';
import {
  startRecording,
  stopRecording,
  transcribeAudio,
} from '../services/voiceService';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

const C = {
  dark:   '#050C11',
  panel:  '#122737',  // mais claro que antes (#0D1F2D)
  mid:    '#2A4A5E',  // mais claro que antes (#1A3A4A) — input visível
  neon:   '#4DFFC9',  // bem mais claro (mint bright)
  text:   '#9DCCDE',  // levemente mais brilhante
  white:  '#EEF6FA',
  error:  '#FF4560',
  userBg: '#0F4530',  // bolha do usuário mais clara
  aiBg:   '#0E2030',  // bolha da IA mais clara
} as const;

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

interface DisplayMessage extends ChatMessage {
  id: string;
}

export default function ChatScreen() {
  const { userEmail, userName } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Olá, ${userName || 'Operador'}! 👋\n\nSou o PetroGate IA, seu assistente especializado em Petrobras e operações de óleo e gás.\n\nPosso te ajudar com:\n• Normas de segurança (NR-10, NR-33, NR-35)\n• Procedimentos operacionais\n• Informações sobre a Petrobras\n• Terminologia técnica do setor\n• E muito mais!\n\nComo posso te ajudar hoje?`,
    },
  ]);
  const [inputText, setInputText]     = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState('');
  // Altura real do teclado — atualizada pelos listeners
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [meteringValue, setMeteringValue] = useState(-160);
  const [waveSeed, setWaveSeed] = useState(Math.random());

  // Animação de pulsação neon
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const flatListRef  = useRef<FlatList>(null);
  const chatHistory  = useRef<ChatMessage[]>([]);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const STORAGE_KEY = `petrogate_chat_${userEmail || 'anonymous'}`;

  // Responsividade
  const isSmall       = width < 380;
  const fontBase      = isSmall ? 12 : 13;
  const headerFont    = isSmall ? 13 : 14;
  const bubbleMaxW    = width * 0.86;

  // ─── Keyboard listeners ───────────────────────────────────────────────────
  // NÃO usamos KeyboardAvoidingView — ele causa o "quadrado branco" no Android.
  // Rastreamos a altura do teclado manualmente e aplicamos como paddingBottom.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    });
    const onHide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  // Efeito de jitter para ondas sonoras fluídas
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setWaveSeed(Math.random());
      }, 80); // Atualiza visual a cada 80ms para fluidez
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  // --- Persistência Local ---
  
  // Carrega histórico ao montar
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const savedData = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedData) {
          const { messages: savedMessages, chatHistory: savedHistory } = JSON.parse(savedData);
          if (savedMessages && savedMessages.length > 0) {
            setMessages(savedMessages);
            chatHistory.current = savedHistory || [];
            console.log(`[Chat] Histórico carregado (${savedMessages.length} mensagens) para ${userEmail}`);
          }
        }
      } catch (err) {
        console.error('[Chat] Erro ao carregar histórico:', err);
      }
    };
    loadHistory();
  }, [userEmail]);

  // Salva histórico ao mudar
  useEffect(() => {
    const saveHistory = async () => {
      // Pequeno delay para garantir que o estado 'messages' foi atualizado
      try {
        if (messages.length > 1 || (messages.length === 1 && messages[0].id !== 'welcome')) {
          const data = JSON.stringify({
            messages,
            chatHistory: chatHistory.current,
          });
          await AsyncStorage.setItem(STORAGE_KEY, data);
        }
      } catch (err) {
        console.error('[Chat] Erro ao salvar histórico:', err);
      }
    };
    
    // Evita salvar se for apenas o estado inicial padrão e não houver mudança real
    if (messages.length > 0) {
      saveHistory();
    }
  }, [messages, userEmail]);

  // Controle da pulsação neon durante gravação
  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.2, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  // Rola para o final quando novas mensagens chegam
  useEffect(() => {
    const t = setTimeout(
      () => flatListRef.current?.scrollToEnd({ animated: true }),
      120
    );
    return () => clearTimeout(t);
  }, [messages]);

  const handleSend = useCallback(async (manualText?: string) => {
    const text = (typeof manualText === 'string' ? manualText : inputText).trim();
    if (!text || isLoading) return;

    if (typeof manualText !== 'string') setInputText('');
    setError('');

    const userMsg: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const aiText = await sendGroqMessage(chatHistory.current, text);
      chatHistory.current = [
        ...chatHistory.current,
        { role: 'user', content: text },
        { role: 'assistant', content: aiText },
      ];
      setMessages((prev) => [
        ...prev,
        { id: `ai-${Date.now()}`, role: 'assistant', content: aiText },
      ]);
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar com a IA. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isLoading]);

  const stopRecordingAndProcess = useCallback(async () => {
    if (!recordingRef.current) return;

    const rec = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    setRecordingDuration(0);
    setMeteringValue(-160);

    try {
      setIsTranscribing(true);
      const result = await stopRecording(rec);
      const transcription = await transcribeAudio(result);
      if (transcription.text.trim()) {
        await handleSend(transcription.text);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao processar áudio.');
    } finally {
      setIsTranscribing(false);
    }
  }, [handleSend]);

  const handleVoiceRecordToggle = useCallback(async () => {
    if (isRecording) {
      await stopRecordingAndProcess();
      return;
    }

    try {
      setError('');
      const rec = await startRecording((status) => {
        if (status.isRecording) {
          setRecordingDuration(status.durationMillis);
          const currentMetering = status.metering ?? -160;
          setMeteringValue(currentMetering);
        }
      });

      recordingRef.current = rec;
      setIsRecording(true);
    } catch (err: any) {
      setError(err.message || 'Falha ao iniciar gravação.');
    }
  }, [isRecording, stopRecordingAndProcess]);

  // Limpeza ao desmontar
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  const renderMessage = ({ item }: { item: DisplayMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View
        style={[
          styles.bubble,
          { maxWidth: bubbleMaxW },
          isUser ? styles.userBubble : styles.aiBubble,
        ]}
      >
        {!isUser && <Text style={styles.aiLabel}>⬡ PETROGATE IA</Text>}
        <Text style={[styles.msgText, { fontSize: fontBase, lineHeight: fontBase * 1.55 }]}>
          {item.content}
        </Text>
        {isUser && (
          <Text style={styles.userLabel}>
            {(userName || 'VOCÊ').toUpperCase()}
          </Text>
        )}
      </View>
    );
  };

  // Extra offset para garantir que o input fique acima do teclado no Android.
  // 24px extra em Android (gesture navigation bar do S23) + 8px de respiro visual.
  const ANDROID_EXTRA = Platform.OS === 'android' ? 24 : 0;
  const inputBottomPad =
    keyboardHeight > 0
      ? keyboardHeight - (Platform.OS === 'android' ? 0 : insets.bottom) + ANDROID_EXTRA
      : Math.max(insets.bottom, 12);

  return (
    // View raiz garante background em toda a tela, evitando o quadrado branco
    <View style={[styles.root, { backgroundColor: C.dark }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.panel} />

      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>

        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.55 }]}
          >
            <Text style={[styles.backTxt, { fontSize: headerFont }]}>←</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { fontSize: headerFont }]}>
              PETROGATE IA
            </Text>
            <Text style={styles.headerSub}>GROQ · LLAMA 3.3 · 70B</Text>
          </View>
          <View style={styles.dot} />
        </View>

        {/* Session banner */}
        <View style={styles.sessionBar}>
          <Text style={styles.sessionTxt} numberOfLines={1}>
            🔒 {userEmail} · sem persistência
          </Text>
        </View>

        {/* Message list */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />

        {/* Typing / Transcribing indicator */}
        {(isLoading || isTranscribing) && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={C.neon} />
            <Text style={styles.loadingTxt}>
              {isTranscribing ? 'Transcrevendo áudio...' : 'PetroGate IA digitando...'}
            </Text>
          </View>
        )}

        {/* Error */}
        {error !== '' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTxt} numberOfLines={3}>⚠ {error}</Text>
          </View>
        )}

        {/* Input Row — Alternância inteligente entre Voz e Texto */}
        <View style={[styles.inputRow, { paddingBottom: inputBottomPad }]}>
          {isRecording ? (
            <View style={styles.recordingArea}>
              <View style={styles.recordingInfo}>
                <Animated.View style={[styles.recordingDot, { opacity: pulseAnim }]} />
                <Text style={styles.recordingTime}>
                  {(recordingDuration / 1000).toFixed(1)}s
                </Text>
              </View>
              <View style={styles.waveContainer}>
                {Array.from({ length: 16 }).map((_, i) => {
                  // Energy calculado a partir do metering (-160 a 0)
                  const energy = Math.max(0, (meteringValue + 160) / 160); 
                  // Altura dinâmica com jitter para parecer fluido
                  const randomFactor = 0.3 + (Math.sin(waveSeed * 10 + i) * 0.2) + (Math.random() * 0.5);
                  const height = Math.min(22, 4 + (energy * 18 * randomFactor));
                  
                  return (
                    <View
                      key={i}
                      style={[
                        styles.waveBar, 
                        { 
                          height, 
                          backgroundColor: C.neon,
                          opacity: 0.4 + (energy * 0.6) 
                        }
                      ]}
                    />
                  );
                })}
              </View>
              <Text style={styles.recordingStatus}>Gravando áudio...</Text>
            </View>
          ) : (
            <TextInput
              style={[styles.input, { fontSize: fontBase }]}
              placeholder="Digite ou use o microfone..."
              placeholderTextColor={`${C.text}40`}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              editable={!isLoading && !isTranscribing}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={() => handleSend()}
            />
          )}

          <Pressable
            onPress={() => {
              if (isRecording) {
                stopRecordingAndProcess();
              } else if (inputText.trim() === '') {
                handleVoiceRecordToggle();
              } else {
                handleSend();
              }
            }}
            disabled={isLoading || isTranscribing}
            android_ripple={{ color: 'rgba(255, 255, 255, 0.4)' }}
            style={({ pressed }) => [
              styles.actionBtn,
              (isLoading || isTranscribing) && styles.btnDisabled,
              isRecording && styles.recordingBtn,
              pressed && Platform.OS === 'ios' && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.actionIcon, isRecording && { color: C.white }]}>
              {isRecording ? '■' : (inputText.trim() === '' ? '🎙' : '▶')}
            </Text>
          </Pressable>
        </View>

      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // root garante fundo escuro em toda a tela — elimina o "quadrado branco"
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
    backgroundColor: C.dark,
  },

  // ─── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: `${C.mid}80`,
    backgroundColor: C.panel,
  },
  backBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  backTxt: { color: C.neon, fontFamily: MONO, fontWeight: '700' },
  headerCenter: { flex: 1, gap: 1 },
  headerTitle: { color: C.neon, fontFamily: MONO, fontWeight: '900', letterSpacing: 2 },
  headerSub:  { color: `${C.text}80`, fontFamily: MONO, fontSize: 8, letterSpacing: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.neon },

  // ─── Session banner ────────────────────────────────────────────────────────
  sessionBar: {
    backgroundColor: `${C.mid}40`,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: `${C.mid}40`,
  },
  sessionTxt: { color: `${C.text}70`, fontFamily: MONO, fontSize: 8, letterSpacing: 0.4 },

  // ─── Message list ──────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 10,
  },
  bubble: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 13,
    marginBottom: 2,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: C.userBg,
    borderWidth: 1,
    borderColor: `${C.neon}30`,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: C.aiBg,
    borderWidth: 1,
    borderColor: `${C.mid}90`,
  },
  aiLabel: {
    color: C.neon,
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1.5,
    marginBottom: 5,
    fontWeight: '700',
  },
  userLabel: {
    color: `${C.neon}80`,
    fontFamily: MONO,
    fontSize: 7,
    letterSpacing: 1,
    marginTop: 5,
    textAlign: 'right',
  },
  msgText: { fontFamily: MONO, color: C.white },

  // ─── Feedback ──────────────────────────────────────────────────────────────
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: C.dark,
  },
  loadingTxt: { color: `${C.text}80`, fontFamily: MONO, fontSize: 10 },
  errorBox: {
    backgroundColor: `${C.error}20`,
    marginHorizontal: 14,
    marginBottom: 6,
    borderRadius: 5,
    padding: 9,
    borderWidth: 1,
    borderColor: `${C.error}50`,
  },
  errorTxt: { color: C.error, fontFamily: MONO, fontSize: 10 },

  // ─── Input row ─────────────────────────────────────────────────────────────
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: `${C.mid}80`,
    backgroundColor: C.panel,  // fundo sólido — sem transparência
  },
  input: {
    flex: 1,
    backgroundColor: C.mid,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
    color: C.white,
    fontFamily: MONO,
    maxHeight: 110,
    minHeight: 44,
  },
  actionBtn: {
    backgroundColor: C.neon,
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: C.neon,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
  recordingBtn: {
    backgroundColor: C.error,
    shadowColor: C.error,
  },
  btnDisabled: { backgroundColor: `${C.neon}40`, elevation: 0 },
  actionIcon: { color: C.dark, fontSize: 18, fontWeight: '900' },

  // ─── Recording UI ─────────────────────────────────────────────────────────
  recordingArea: {
    flex: 1,
    height: 44,
    backgroundColor: `${C.mid}60`,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: `${C.neon}40`,
  },
  recordingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 55,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.error,
  },
  recordingTime: {
    color: C.white,
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '700',
  },
  waveContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 20,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    marginHorizontal: 1,
  },
  recordingStatus: {
    color: `${C.neon}90`,
    fontFamily: MONO,
    fontSize: 8,
    position: 'absolute',
    bottom: -1,
    right: 12,
  },
});
