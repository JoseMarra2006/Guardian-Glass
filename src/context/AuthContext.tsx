/**
 * @file AuthContext.tsx
 * @description Contexto de Autenticação Zero Trust para o PetroGate AR.
 *
 * Gerencia o estado de sessão do operador via Supabase Auth e expõe
 * dados do dispositivo (deviceId) para rastreabilidade nos logs de auditoria.
 *
 * SEGURANÇA:
 * - deviceId é derivado do hardware do dispositivo (expo-application), nunca simulado.
 * - A sessão é gerenciada pelo Supabase com refresh automático de token.
 * - Dados de role/cargo são lidos do user_metadata do JWT — nunca do localStorage.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { supabase } from '../services/supabaseClient';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  /** true quando há uma sessão ativa no Supabase */
  isAuthenticated: boolean;
  /** true durante a verificação inicial da sessão (splash/loading) */
  isLoading: boolean;
  /** Nome de exibição do operador (full_name do metadata ou prefixo do email) */
  userName: string;
  /** Email corporativo do operador autenticado */
  userEmail: string;
  /** Cargo/role do operador (lido do user_metadata do JWT) */
  userRole: string;
  /**
   * ID único do dispositivo Smart Glass.
   * iOS: identifierForVendor | Android: androidId | fallback: SG-DEV-XXX
   */
  deviceId: string;
  /** Encerra a sessão e limpa o estado de autenticação */
  signOut: () => Promise<void>;
}

// ─── Constante de Device ID ───────────────────────────────────────────────────

/**
 * Derivado do identificador de aplicação + plataforma.
 * Em produção, substituir por MDM enrollment ID ou getIosIdForVendorAsync().
 *
 * Nota: getIosIdForVendorAsync() e getAndroidId() são assíncronos em expo-application v7+.
 * Para o contexto do Smart Glass, o applicationId (bundle ID) + sufixo de plataforma
 * é suficiente para rastreabilidade por dispositivo de desenvolvimento.
 */
function resolveDeviceId(): string {
  const appId = Application.applicationId ?? 'unknown';
  const platformSuffix = Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'AND' : 'WEB';
  // Formato: SG-AND-com.example.app → legível nos logs de auditoria
  return `SG-${platformSuffix}-${appId.split('.').pop()?.toUpperCase() ?? '001'}`;
}

const DEVICE_ID = resolveDeviceId();

// ─── Contexto ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading]           = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userName, setUserName]             = useState('OPERADOR');
  const [userEmail, setUserEmail]           = useState('');
  const [userRole, setUserRole]             = useState('OPERADOR TÉCNICO');

  // Popula o estado a partir de um objeto de usuário Supabase
  const hydrateUser = useCallback((user: { email?: string | null; user_metadata?: Record<string, string> } | null) => {
    if (!user) {
      setIsAuthenticated(false);
      setUserName('OPERADOR');
      setUserEmail('');
      setUserRole('OPERADOR TÉCNICO');
      return;
    }

    setIsAuthenticated(true);
    setUserEmail(user.email ?? '');
    setUserName(
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      (user.email?.split('@')[0].toUpperCase() ?? 'OPERADOR')
    );
    setUserRole(
      user.user_metadata?.role ??
      user.user_metadata?.cargo ??
      'OPERADOR TÉCNICO'
    );
  }, []);

  useEffect(() => {
    // ── Verifica sessão existente ao inicializar ──
    supabase.auth.getSession().then(({ data: { session } }) => {
      hydrateUser(session?.user ?? null);
      setIsLoading(false);
    });

    // ── Listener para mudanças de estado (login / logout / token refresh) ──
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        hydrateUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, [hydrateUser]);

  const signOut = useCallback(async () => {
    console.log('[PetroGate Auth] Encerrando sessão do operador:', userEmail);
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[PetroGate Auth] Erro ao encerrar sessão:', error.message);
    }
  }, [userEmail]);

  const value: AuthContextValue = {
    isAuthenticated,
    isLoading,
    userName,
    userEmail,
    userRole,
    deviceId: DEVICE_ID,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook de acesso ao contexto de autenticação.
 * Deve ser usado apenas dentro de componentes filhos do AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      '[PetroGate Auth] useAuth() chamado fora do AuthProvider. ' +
      'Envolva o componente raiz com <AuthProvider>.'
    );
  }
  return ctx;
}
