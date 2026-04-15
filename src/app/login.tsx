/**
 * @file login.tsx
 * @description Tela de Login do PetroGate AR
 *
 * Autenticação via Supabase Auth com email + senha corporativa.
 * Fase 1 do projeto — integração com Zero Trust AuthContext.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../services/supabaseClient';

// ─── Tokens de Design ─────────────────────────────────────────────────────────

const C = {
  dark:   '#050C11',
  panel:  '#0D1F2D',
  mid:    '#1A3A4A',
  neon:   '#00FFB2',
  text:   '#8BBCCC',
  white:  '#E8F4F8',
  error:  '#FF4560',
} as const;

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

// ─── Tela de Login ────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Preencha email e senha corporativos.');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setIsLoading(false);

    if (error) {
      console.error('[PetroGate Login] Falha de autenticação:', error.message);
      setErrorMsg('Credenciais inválidas. Verifique com o administrador do sistema.');
    }
    // Sucesso: AuthContext.onAuthStateChange dispara automaticamente → App.tsx redireciona
  }, [email, password]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" backgroundColor={C.dark} />

      {/* Logo */}
      <View style={styles.logoArea}>
        <View style={styles.diamond}>
          <Text style={styles.diamondText}>P</Text>
        </View>
        <Text style={styles.title}>PETROGATE AR</Text>
        <Text style={styles.subtitle}>AUTENTICAÇÃO DE OPERADOR</Text>
      </View>

      {/* Formulário */}
      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>EMAIL CORPORATIVO</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="operador@petrobras.com.br"
            placeholderTextColor={`${C.text}60`}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!isLoading}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>SENHA</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={`${C.text}60`}
            secureTextEntry
            autoComplete="password"
            editable={!isLoading}
            onSubmitEditing={handleLogin}
          />
        </View>

        {errorMsg !== '' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        <Pressable
          onPress={handleLogin}
          disabled={isLoading}
          style={({ pressed }) => [
            styles.loginBtn,
            pressed && !isLoading && { opacity: 0.8 },
            isLoading && { opacity: 0.6 },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={C.dark} />
          ) : (
            <Text style={styles.loginBtnText}>[ AUTENTICAR ]</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.footer}>
        ZERO TRUST · DLP ATIVO · AUDITORIA CONTÍNUA
      </Text>
    </KeyboardAvoidingView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.dark,
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 40,
  },
  logoArea: {
    alignItems: 'center',
    gap: 12,
  },
  diamond: {
    width: 56,
    height: 56,
    backgroundColor: C.neon,
    transform: [{ rotate: '45deg' }],
    justifyContent: 'center',
    alignItems: 'center',
  },
  diamondText: {
    color: C.dark,
    fontSize: 24,
    fontWeight: '900',
    transform: [{ rotate: '-45deg' }],
    fontFamily: MONO,
  },
  title: {
    color: C.white,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 6,
    fontFamily: MONO,
  },
  subtitle: {
    color: C.neon,
    fontSize: 9,
    letterSpacing: 3,
    fontFamily: MONO,
  },
  form: {
    gap: 18,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: MONO,
    fontSize: 9,
    color: C.text,
    letterSpacing: 2.5,
  },
  input: {
    borderWidth: 1,
    borderColor: `${C.mid}`,
    borderRadius: 3,
    backgroundColor: C.panel,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.white,
    fontFamily: MONO,
    fontSize: 13,
  },
  errorBox: {
    backgroundColor: '#FF456020',
    borderWidth: 1,
    borderColor: '#FF456060',
    borderRadius: 3,
    padding: 12,
  },
  errorText: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.error,
    lineHeight: 17,
  },
  loginBtn: {
    backgroundColor: C.neon,
    paddingVertical: 16,
    borderRadius: 3,
    alignItems: 'center',
    marginTop: 4,
  },
  loginBtnText: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: '700',
    color: C.dark,
    letterSpacing: 3,
  },
  footer: {
    fontFamily: MONO,
    fontSize: 8,
    color: `${C.text}60`,
    textAlign: 'center',
    letterSpacing: 2,
  },
});
