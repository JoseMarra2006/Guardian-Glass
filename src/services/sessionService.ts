import * as SecureStore from 'expo-secure-store';
import { Session } from '@supabase/supabase-js';

/**
 * @file sessionService.ts
 * @description Gerenciamento de persistência de sessão seguro e higienizado.
 */

const SESSION_PREFIX = 'petrogate.session.v2';
const ACCOUNTS_LIST_KEY = 'petrogate.accounts.list.v2';

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  user_email: string;
}

/**
 * Higieniza o email para ser usado como chave no SecureStore (remove @ e outros caracteres)
 */
function sanitizeKey(email: string): string {
  return email.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function saveSession(session: Session, email?: string): Promise<void> {
  const userEmail = email || session.user?.email;
  if (!userEmail) return;

  const payload: StoredSession = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user_email: userEmail,
  };

  const key = `${SESSION_PREFIX}.${sanitizeKey(userEmail)}`;
  await SecureStore.setItemAsync(key, JSON.stringify(payload));

  // Atualiza lista de contas
  const accounts = await getRegisteredAccounts();
  if (!accounts.includes(userEmail)) {
    const newList = [userEmail, ...accounts];
    await SecureStore.setItemAsync(ACCOUNTS_LIST_KEY, JSON.stringify(newList));
  }
}

export async function getStoredSession(email: string): Promise<StoredSession | null> {
  const key = `${SESSION_PREFIX}.${sanitizeKey(email)}`;
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function clearSession(email: string): Promise<void> {
  const key = `${SESSION_PREFIX}.${sanitizeKey(email)}`;
  await SecureStore.deleteItemAsync(key);
  
  const accounts = await getRegisteredAccounts();
  const filtered = accounts.filter(a => a !== email);
  await SecureStore.setItemAsync(ACCOUNTS_LIST_KEY, JSON.stringify(filtered));
}

export async function getRegisteredAccounts(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(ACCOUNTS_LIST_KEY);
  return raw ? JSON.parse(raw) : [];
}
