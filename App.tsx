/**
 * @file App.tsx
 * @description Entry point do PetroGate AR.
 *
 * FLUXO DE AUTENTICAÇÃO:
 *   Carregando        → Tela de splash (ActivityIndicator)
 *   Não autenticado   → <LoginScreen />
 *   Autenticado       → <HudScreen />  (HUD de Realidade Aumentada + Interface de Voz)
 */

import React from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/app/login';
import HudScreen from './src/app/index';

// ─── Roteador de Autenticação ─────────────────────────────────────────────────

function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#00FFB2" />
      </View>
    );
  }

  return isAuthenticated ? <HudScreen /> : <LoginScreen />;
}

// ─── Root Component ───────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#050C11',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
