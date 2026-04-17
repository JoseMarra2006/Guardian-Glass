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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { sendGroqMessage, ChatMessage } from '../services/groqService';

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

  const flatListRef  = useRef<FlatList>(null);
  const chatHistory  = useRef<ChatMessage[]>([]);

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

  // Rola para o final quando novas mensagens chegam
  useEffect(() => {
    const t = setTimeout(
      () => flatListRef.current?.scrollToEnd({ animated: true }),
      120
    );
    return () => clearTimeout(t);
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    setInputText('');
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

        {/* Typing indicator */}
        {isLoading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={C.neon} />
            <Text style={styles.loadingTxt}>PetroGate IA digitando...</Text>
          </View>
        )}

        {/* Error */}
        {error !== '' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTxt} numberOfLines={3}>⚠ {error}</Text>
          </View>
        )}

        {/* Input — paddingBottom ajustado dinamicamente pelo teclado */}
        <View style={[styles.inputRow, { paddingBottom: inputBottomPad }]}>
          <TextInput
            style={[styles.input, { fontSize: fontBase }]}
            placeholder="Pergunte algo..."
            placeholderTextColor={`${C.text}60`}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
            editable={!isLoading}
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={handleSend}
          />
          <Pressable
            onPress={handleSend}
            disabled={isLoading || inputText.trim() === ''}
            android_ripple={{ color: 'rgba(255, 255, 255, 0.6)' }}
            style={({ pressed }) => [
              styles.sendBtn,
              (isLoading || inputText.trim() === '') && styles.sendDisabled,
              pressed && Platform.OS === 'ios' && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.sendTxt}>▶</Text>
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
  sendBtn: {
    backgroundColor: C.neon,
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sendDisabled: { backgroundColor: `${C.neon}40` },
  sendTxt: { color: C.dark, fontSize: 16, fontWeight: '900' },
});
