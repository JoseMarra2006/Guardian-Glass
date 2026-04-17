import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ActivityIndicator, View } from 'react-native';
import { useEffect, useState } from 'react';

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [isNavigationReady, setIsNavigationReady] = useState(false);

  // Monitora se o sistema de rotas está pronto
  useEffect(() => {
    const timer = setTimeout(() => setIsNavigationReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isNavigationReady || isLoading) return;

    const inAuthGroup = segments[0] === 'login';

    if (!isAuthenticated && !inAuthGroup) {
      // Se não autenticado e não está na tela de login -> vai para login
      console.log('[Layout] Redirecionando para LOGIN');
      router.replace('/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Se autenticado e está na tela de login -> vai para dashboard (index)
      console.log('[Layout] Redirecionando para DASHBOARD');
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, segments, isNavigationReady]);

  if (isLoading || !isNavigationReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#050C11', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4DFFC9" size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="index" />
      <Stack.Screen name="chat" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
