import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabaseClient';

const SESSION_STORAGE_KEY = 'petrogate.auth.session.v1';
const BIOMETRIC_ENABLED_KEY = 'petrogate.auth.biometric.enabled.v1';

export interface StoredSession {
  access_token: string;
  refresh_token: string;
}

export async function isBiometricAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) {
    return false;
  }

  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return isEnrolled;
}

export async function authenticateBiometric(): Promise<boolean> {
  const available = await isBiometricAvailable();
  if (!available) {
    console.warn('[PetroGate Biometric] Biometrics unavailable on this device.');
    return false;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Desbloquear PetroGate AR',
    cancelLabel: 'Usar senha',
    fallbackLabel: 'Usar senha',
    disableDeviceFallback: false,
  });

  if (!result.success) {
    console.warn('[PetroGate Biometric] Authentication failed:', result.error);
  }

  return result.success;
}

export async function saveSession(session: Session): Promise<void> {
  if (!session.access_token || !session.refresh_token) {
    throw new Error('[PetroGate Biometric] Cannot save incomplete session.');
  }

  const serialized = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  } satisfies StoredSession);

  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, serialized);
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
}

export async function getStoredSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.access_token || !parsed.refresh_token) {
      return null;
    }

    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
    };
  } catch (error) {
    console.error('[PetroGate Biometric] Invalid stored session payload.', error);
    return null;
  }
}

export async function getBiometricEnabled(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return value === 'true';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function biometricLogin(): Promise<Session | null> {
  const authenticated = await authenticateBiometric();
  if (!authenticated) {
    return null;
  }

  const stored = await getStoredSession();
  if (!stored) {
    console.warn('[PetroGate Biometric] No stored session found.');
    return null;
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
  });

  if (error) {
    console.error('[PetroGate Biometric] Session restore failed:', error.message);
    await clearStoredSession();
    return null;
  }

  if (data.session) {
    await saveSession(data.session);
  }

  return data.session;
}
