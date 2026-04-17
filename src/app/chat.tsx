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
  SafeAreaView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { sendGroqMessage, ChatMessage } from '../services/groqService';

const C = {
  dark:    '#050C11',
  panel:   '#0D1F2D',
  mid:     '#1A3A4A',
  neon:    '#00FFB2',
  text:    '#8BBCCC',
  white:   '#E8F4F8',
  error:   '#FF4560',
  userBg:  '#0A3A2A',
  aiBg:    '#0D1F2D',
} as const;

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

interface DisplayMessage extends ChatMessage {
  id: string;
}

export default function ChatScreen() {
  const { userEmail, userName } = useAuth();

  // Histórico em memória — separado por usuário via estado local do componente
  // (cada montagem de tela = sessão nova, sem persistência)
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Olá, **${userName || 'Operador'}**! 👋\n\nSou o **PetroGate IA**, seu assistente especializado em Petrobras e operações de óleo e gás.\n\nPosso te ajudar com:\n• Normas de segurança (NR-10, NR-33, NR-35)\n• Procedimentos operacionais\n• Informações sobre a Petrobras\n• Terminologia técnica do setor\n• E muito mais!\n\nComo posso te ajudar hoje?`,
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const flatListRef = useRef<FlatList>(null);

  // Histórico puro para enviar à API (sem a mensagem de boas-vindas)
  const chatHistory = useRef<ChatMessage[]>([]);

  useEffect(() => {
    // Rola para o final quando novas mensagens chegam
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
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

      // Atualiza o histórico interno (sem a msg de boas-vindas)
      chatHistory.current = [
        ...chatHistory.current,
        { role: 'user', content: text },
        { role: 'assistant', content: aiText },
      ];

      const aiMsg: DisplayMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: aiText,
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar com a IA. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isLoading]);

  const renderMessage = ({ item }: { item: DisplayMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
        {!isUser && (
          <Text style={styles.aiLabel}>⬡ PETROGATE IA</Text>
        )}
        <Text style={[styles.messageText, isUser ? styles.userText : styles.aiText]}>
          {item.content}
        </Text>
        {isUser && (
          <Text style={styles.userLabel}>{(userName || 'VOCÊ').toUpperCase()}</Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>PETROGATE IA</Text>
          <Text style={styles.headerSub}>GROQ · LLAMA 3.3 · 70B</Text>
        </View>
        <View style={styles.statusDot} />
      </View>

      {/* Session info */}
      <View style={styles.sessionBanner}>
        <Text style={styles.sessionText}>
          🔒 Sessão de {userEmail} · Histórico local — não persiste
        </Text>
      </View>

      {/* Message list */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
      />

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={C.neon} />
          <Text style={styles.loadingText}>PetroGate IA digitando...</Text>
        </View>
      )}

      {/* Error message */}
      {error !== '' && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠ {error}</Text>
        </View>
      )}

      {/* Input area */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Pergunte algo..."
            placeholderTextColor={`${C.text}60`}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
            editable={!isLoading}
            onSubmitEditing={handleSend}
          />
          <Pressable
            onPress={handleSend}
            disabled={isLoading || inputText.trim() === ''}
            style={({ pressed }) => [
              styles.sendBtn,
              (isLoading || inputText.trim() === '') && styles.sendBtnDisabled,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.sendBtnText}>▶</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: `${C.mid}80`,
    backgroundColor: C.panel,
  },
  headerLeft: { gap: 2 },
  headerTitle: {
    color: C.neon,
    fontFamily: MONO,
    fontSize: 14,
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
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: `${C.mid}40`,
  },
  sessionText: {
    color: `${C.text}70`,
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 0.5,
  },
  messageList: {
    padding: 16,
    gap: 12,
    paddingBottom: 8,
  },
  messageBubble: {
    maxWidth: '88%',
    borderRadius: 8,
    padding: 12,
    marginBottom: 4,
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
    marginBottom: 6,
    fontWeight: '700',
  },
  userLabel: {
    color: `${C.neon}80`,
    fontFamily: MONO,
    fontSize: 7,
    letterSpacing: 1,
    marginTop: 6,
    textAlign: 'right',
  },
  messageText: {
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 20,
  },
  userText: {
    color: C.white,
  },
  aiText: {
    color: C.white,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingText: {
    color: `${C.text}80`,
    fontFamily: MONO,
    fontSize: 10,
  },
  errorBanner: {
    backgroundColor: `${C.error}20`,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 4,
    padding: 10,
    borderWidth: 1,
    borderColor: `${C.error}50`,
  },
  errorText: {
    color: C.error,
    fontFamily: MONO,
    fontSize: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: `${C.mid}80`,
    backgroundColor: C.panel,
  },
  input: {
    flex: 1,
    backgroundColor: C.mid,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.white,
    fontFamily: MONO,
    fontSize: 13,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: C.neon,
    width: 44,
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: `${C.neon}40`,
  },
  sendBtnText: {
    color: C.dark,
    fontSize: 16,
    fontWeight: '900',
  },
});
