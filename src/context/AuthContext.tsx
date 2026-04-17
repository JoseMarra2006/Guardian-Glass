import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { supabase } from '../services/supabaseClient';
import {
  saveSession,
  getRegisteredAccounts,
} from '../services/sessionService';
import { signInWithRFID as performRFIDLogin } from '../services/rfidAuthService';
import Constants from 'expo-constants';
import { Alert, Platform, AppState, AppStateStatus } from 'react-native';
import { useRef } from 'react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  userName: string;
  userEmail: string;
  userId: string;
  userRole: string;
  deviceId: string;
  registeredAccounts: string[];
  signInWithRFID: (uid: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  signInWithFaceRecognition: () => Promise<boolean>;
  isFaceRecognitionAvailable: boolean;
  // Memória do Chat (Persistência em sessão)
  messages: any[];
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  chatHistory: any[];
  setChatHistory: React.Dispatch<React.SetStateAction<any[]>>;
  clearChat: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userId, setUserId] = useState('');
  const [userRole, setUserRole] = useState('Operador');
  const [deviceId, setDeviceId] = useState('GATE-PRO-001');
  const [registeredAccounts, setRegisteredAccounts] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  const hydrateUser = useCallback((user: any) => {
    if (user) {
      setUserId(user.id);
      setUserEmail(user.email || '');
      setUserName(user.user_metadata?.full_name || user.email?.split('@')[0] || 'Operador');
      setUserRole(user.user_metadata?.role || 'Especialista');
      setIsAuthenticated(true);
    } else {
      setUserId('');
      setUserEmail('');
      setUserName('');
      setIsAuthenticated(false);
    }
  }, []);

  const initializeAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const accounts = await getRegisteredAccounts();
      setRegisteredAccounts(accounts);

      if (session) {
        hydrateUser(session.user);
      }
    } catch (error) {
      console.error('[PetroGate Auth] Erro ao inicializar:', error);
    } finally {
      setIsLoading(false);
    }
  }, [hydrateUser]);

  useEffect(() => {
    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[PetroGate Auth] Evento Auth:', event);
      if (session) {
        hydrateUser(session.user);
        await saveSession(session, session.user.email);
        const accounts = await getRegisteredAccounts();
        setRegisteredAccounts(accounts);
      } else {
        hydrateUser(null);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [initializeAuth, hydrateUser]);

  const signInWithRFID = useCallback(async (uid: string) => {
    try {
      setIsLoading(true);
      const session = await performRFIDLogin(uid);
      return !!session;
    } catch (error) {
      console.error('[PetroGate Auth] Erro no signInWithRFID:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Memória em sessão para o Chat
  const [messages, setMessages] = useState<any[]>([]);
  const [chatHistory, setChatHistory] = useState<any[]>([]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setChatHistory([]);
  }, []);

  // Refs para manter valores atualizados dentro do WebSocket estável
  const isAuthenticatedRef = useRef(isAuthenticated);
  const isLoadingRef = useRef(isLoading);

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
    isLoadingRef.current = isLoading;
  }, [isAuthenticated, isLoading]);

  const signOut = useCallback(async () => {
    try {
      setIsLoading(true);
      await supabase.auth.signOut();
    } catch (error) {
      console.error('[PetroGate Auth] Erro ao sair do Supabase:', error);
    } finally {
      // SEMPRE limpa o estado, mesmo se a chamada de rede falhar
      hydrateUser(null);
      clearChat(); // Limpa chat ao deslogar
      setIsLoading(false);
    }
  }, [hydrateUser, clearChat]);

  // --- Conexão Persistente e Resiliente com a Ponte RFID (WebSocket) ---
  const connectRFID = useCallback(() => {
    // Limpa timers e conexões anteriores
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }

    const debuggerHost = Constants.expoConfig?.hostUri;
    const pcIp = debuggerHost?.split(':')[0] || '10.112.48.48';
    
    console.log(`[PetroGate Auth] Conectando na ponte RFID: ws://${pcIp}:8082`);
    
    try {
      const ws = new WebSocket(`ws://${pcIp}:8082`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[PetroGate Auth] ✅ Conectado à ponte RFID.');
      };

      ws.onmessage = async (e) => {
        const uid = e.data;
        // Usa as REFS para não depender do estado reativo do hook (estabilidade)
        if (uid && !isAuthenticatedRef.current && !isLoadingRef.current) {
          console.log(`[PetroGate Auth] RFID Lido: ${uid}. Autenticando...`);
          try {
            const ok = await signInWithRFID(uid);
            if (!ok) {
              Alert.alert('Acesso Negado', `O cartão ${uid} não possui vínculo no sistema.`);
            }
          } catch (error) {
            console.error('[PetroGate Auth] Falha crítica no login RFID:', error);
          }
        }
      };

      ws.onerror = (err) => {
        // Log discreto de erro para evitar spam
        console.log('[PetroGate Auth] Ponte RFID offline ou inacessível.');
      };

      ws.onclose = () => {
        // Tenta reconectar a cada 5s em caso de queda
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(connectRFID, 5000);
        }
      };

    } catch (err) {
      reconnectTimerRef.current = setTimeout(connectRFID, 5000);
    }
  }, [signInWithRFID]);

  useEffect(() => {
    connectRFID();

    // Re-conecta quando o app volta para o foco (foreground)
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[PetroGate Auth] App em foco. Validando conexão RFID...');
        connectRFID();
      }
    });

    return () => {
      subscription.remove();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectRFID]);

  const value: AuthContextValue = {
    isAuthenticated,
    isLoading,
    userName,
    userEmail,
    userId,
    userRole,
    deviceId,
    registeredAccounts,
    signInWithRFID,
    signOut,
    signInWithFaceRecognition: async () => false, // Mock
    isFaceRecognitionAvailable: false, // Mock
    messages,
    setMessages,
    chatHistory,
    setChatHistory,
    clearChat,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  return context;
};
