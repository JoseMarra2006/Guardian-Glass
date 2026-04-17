import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { sendGroqMessage, ChatMessage } from '../services/groqService';

const C = {
  dark:   '#050C11',
  panel:  '#0D1F2D',
  mid:    '#1A3A4A',
  neon:   '#00FFB2',
  text:   '#8BBCCC',
  white:  '#E8F4F8',
  error:  '#FF4560',
  userBg: '#0A3A2A',
  aiBg:   '#0D1F2D',
} as const;

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

interface DisplayMessage extends ChatMessage {
  id: string;
}

export default function ChatScreen() {
  const { userEmail, userName } = useAuth();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Olá, ${userName || 'Operador'}! 👋\n\nSou o PetroGate IA, seu assistente especializado em Petrobras e operações de óleo e gás.\n\nPosso te ajudar com:\n• Normas de segurança (NR-10, NR-33, NR-35)\n• Procedimentos operacionais\n• Informações sobre a Petrobras\n• Terminologia técnica do setor\n• E muito mais!\n\nComo posso te ajudar hoje?`,
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const flatListRef = useRef<FlatList>(null);
  const chatHistory = useRef<ChatMessage[]>([]);

  // Tamanhos responsivos baseados na largura da tela
  const isSmall = width < 380;
  const fontBase = isSmall ? 12 : 13;
  const headerFontSize = isSmall ? 13 : 14;
  const bubbleMaxWidth = width * 0.86;

  useEffect(() => {
    const timer = setTimeout(
      () => flatListRef.current?.scrollToEnd({ animated: true }),
      120
    );
    return () => clearTimeout(timer);
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
          styles.messageBubble,
          { maxWidth: bubbleMaxWidth },
          isUser ? styles.userBubble : styles.aiBubble,
        ]}
      >
        {!isUser && <Text style={styles.aiLabel}>⬡ PETROGATE IA</Text>}
        <Text style={[styles.messageText, { fontSize: fontBase }]}>
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

  return (
    // KeyboardAvoidingView deve ser o elemento MAIS EXTERNO para funcionar no Android
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.dark }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="light-content" backgroundColor={C.panel} />

        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.backBtnText, { fontSize: headerFontSize }]}>←</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { fontSize: headerFontSize }]}>
              PETROGATE IA
            </Text>
            <Text style={styles.headerSub}>GROQ · LLAMA 3.3 · 70B</Text>
          </View>
          <View style={styles.statusDot} />
        </View>

        {/* Session banner */}
        <View style={styles.sessionBanner}>
          <Text style={styles.sessionText} numberOfLines={1}>
            🔒 {userEmail} · sem persistência
          </Text>
        </View>

        {/* Message list — flex: 1 garante que ocupa o espaço disponível */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          onLayout={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
        />

        {/* Typing indicator */}
        {isLoading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={C.neon} />
            <Text style={styles.loadingText}>PetroGate IA digitando...</Text>
          </View>
        )}

        {/* Error banner */}
        {error !== '' && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText} numberOfLines={2}>
              ⚠ {error}
            </Text>
          </View>
        )}

        {/* Input row — dentro do SafeAreaView com insets bottom */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 12) }]}>
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
            style={({ pressed }) => [
              styles.sendBtn,
              (isLoading || inputText.trim() === '') && styles.sendBtnDisabled,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={styles.sendBtnText}>▶</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.dark,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: `${C.mid}80`,
    backgroundColor: C.panel,
    gap: 10,
  },
  backBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  backBtnText: {
    color: C.neon,
    fontFamily: MONO,
    fontWeight: '700',
  },
  headerCenter: {
    flex: 1,
    gap: 1,
  },
  headerTitle: {
    color: C.neon,
    fontFamily: MONO,
    fontWeight: '900',
    letterSpacing: 2,
  },
  headerSub: {
    color: `${C.text}80`,
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.neon,
  },
  sessionBanner: {
    backgroundColor: `${C.mid}40`,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: `${C.mid}40`,
  },
  sessionText: {
    color: `${C.text}70`,
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 0.4,
  },
  messageList: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 10,
  },
  messageBubble: {
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
  messageText: {
    fontFamily: MONO,
    color: '#E8F4F8',
    lineHeight: 20,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  loadingText: {
    color: `${C.text}80`,
    fontFamily: MONO,
    fontSize: 10,
  },
  errorBanner: {
    backgroundColor: '#FF456020',
    marginHorizontal: 14,
    marginBottom: 6,
    borderRadius: 5,
    padding: 9,
    borderWidth: 1,
    borderColor: '#FF456050',
  },
  errorText: {
    color: '#FF4560',
    fontFamily: MONO,
    fontSize: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: `${C.mid}80`,
    backgroundColor: C.panel,
  },
  input: {
    flex: 1,
    backgroundColor: C.mid,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
    color: '#E8F4F8',
    fontFamily: MONO,
    maxHeight: 110,
    minHeight: 44,
  },
  sendBtn: {
    backgroundColor: '#00FFB2',
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#00FFB240',
  },
  sendBtnText: {
    color: '#050C11',
    fontSize: 16,
    fontWeight: '900',
  },
});
