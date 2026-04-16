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
  getStoredSession,
  getRegisteredAccounts,
  clearSession,
  type StoredSession
} from '../services/sessionService';
import { signInWithRFID as performRFIDLogin } from '../services/rfidAuthService';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  userName: string;
  userEmail: string;
  userId: string;
  registeredAccounts: string[];
  signInWithRFID: (uid: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userId, setUserId] = useState('');
  const [registeredAccounts, setRegisteredAccounts] = useState<string[]>([]);

  // Popula o estado a partir de um objeto de usuário Supabase
  const hydrateUser = useCallback((user: any) => {
    if (user) {
      setUserId(user.id);
      setUserEmail(user.email || '');
      setUserName(user.user_metadata?.full_name || user.email?.split('@')[0] || 'Operador');
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
      
      const [accounts, { data: { session } }] = await Promise.all([
        getRegisteredAccounts(),
        supabase.auth.getSession()
      ]);

      setRegisteredAccounts(accounts);

      if (session) {
        hydrateUser(session.user);
        await saveSession(session, session.user.email);
      } else {
        hydrateUser(null);
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
      setIsLoading(false); // <--- SEMPRE desliga o loading aqui
    });

    return () => subscription.unsubscribe();
  }, [initializeAuth, hydrateUser]);

  const signInWithRFID = useCallback(async (uid: string) => {
    try {
      setIsLoading(true);
      const session = await performRFIDLogin(uid);
      if (!session) {
        setIsLoading(false);
        return false;
      }
      // O evento SIGNED_IN do listener cuidará de salvar a sessão
      return true;
    } catch (error) {
      console.error('[PetroGate Auth] Erro no login RFID:', error);
      setIsLoading(false);
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (userEmail) {
        // Para RFID, o logout apenas limpa o estado local
        // Mas o Supabase também deve ser notificado se for um logout total
        await supabase.auth.signOut();
        // Não limpamos obrigatoriamente a conta da lista, 
        // para permitir re-login via RFID depois.
      }
      hydrateUser(null);
    } catch (error) {
      console.error('[PetroGate Auth] Erro ao sair:', error);
      hydrateUser(null);
    }
  }, [userEmail, hydrateUser]);

  const value: AuthContextValue = {
    isAuthenticated,
    isLoading,
    userName,
    userEmail,
    userId,
    registeredAccounts,
    signInWithRFID,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  return context;
}
