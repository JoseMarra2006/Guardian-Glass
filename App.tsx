import React from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/app/login';
import HudScreen from './src/app/index';

/**
 * @file App.tsx
 * @description Roteador de Autenticação simplificado para RFID e Senha.
 */

function AppRouter() {
  const {
    isAuthenticated,
    isLoading,
  } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#00FFB2" />
      </View>
    );
  }

  return isAuthenticated ? <HudScreen /> : <LoginScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#050C11',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
