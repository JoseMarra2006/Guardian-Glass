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

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  userName: string;
  userEmail: string;
  userId: string;
  userRole: string; // Adicionado de volta para o HUD
  deviceId: string; // Adicionado de volta para o HUD
  registeredAccounts: string[];
  signInWithRFID: (uid: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  // Placeholders para biometria (legado)
  signInWithFaceRecognition: () => Promise<boolean>;
  isFaceRecognitionAvailable: boolean;
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
      setIsLoading(false);
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    hydrateUser(null);
  }, [hydrateUser]);

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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  return context;
};
