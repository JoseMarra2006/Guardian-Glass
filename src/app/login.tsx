import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Alert,
} from 'react-native';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';
import Constants from 'expo-constants';

const { width } = Dimensions.get('window');

const C = {
  bg:     '#050C11',
  mid:    '#1A3A4A',
  neon:   '#00FFB2',
  text:   '#8BBCCC',
  white:  '#E8F4F8',
  error:  '#FF4560',
} as const;

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [wsStatus, setWsStatus] = useState<'off' | 'on'>('off');
  
  const { signInWithRFID } = useAuth();

  const handlePasswordLogin = useCallback(async () => {
    setErrorMsg('');
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMsg('ID ou Senha inválidos. Verifique as credenciais.');
      }
    } catch (err) {
      setErrorMsg('Erro de conexão. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }, [email, password]);

  const handleRFIDLogin = useCallback(async () => {
    setErrorMsg('');
    setIsLoading(true);
    console.log('[PetroGate Login] Aguardando leitura RFID...');
    
    // Simulação: UID fixo para teste
    const success = await signInWithRFID('A1B2C3D4');
    if (!success) {
      setErrorMsg('Cartão RFID não reconhecido ou não vinculado.');
    }
    setIsLoading(false);
  }, [signInWithRFID]);

  // AUTO-LISTENER: Escuta o RFID via WebSocket (Ponte com o PC)
  React.useEffect(() => {
    const debuggerHost = Constants.expoConfig?.hostUri;
    const pcIp = debuggerHost?.split(':')[0] || '10.112.48.48';
    
    console.log(`[PetroGate RFID] Conectando na ponte em: ws://${pcIp}:8082`);
    const ws = new WebSocket(`ws://${pcIp}:8082`);

    ws.onopen = () => {
      console.log('[PetroGate RFID] Conectado à ponte serial do PC.');
      setWsStatus('on');
    };

    ws.onmessage = async (e) => {
      const uid = e.data;
      // Só tenta logar se já não estiver carregando
      if (uid && !isLoading) {
        setIsLoading(true);
        try {
          const ok = await signInWithRFID(uid);
          if (!ok) {
            Alert.alert('Acesso Negado', `O cartão ${uid} não possui vínculo no Supabase.`);
          }
        } finally {
          setIsLoading(false);
        }
      }
    };

    ws.onerror = () => {
      setWsStatus('off');
    };

    return () => ws.close();
  }, [signInWithRFID, isLoading]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.brand}>GUARDIAN GLASS</Text>
        <Text style={styles.subtitle}>SISTEMA DE ACESSO RFID</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>EMAIL CORPORATIVO</Text>
        <TextInput
          style={styles.input}
          placeholder="ex: operador@petrobras.com.br"
          placeholderTextColor={`${C.text}60`}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!isLoading}
        />

        <Text style={styles.label}>CHAVE DE ACESSO</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor={`${C.text}60`}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!isLoading}
        />

        {errorMsg !== '' && <Text style={styles.errorText}>{errorMsg}</Text>}

        <Pressable
          onPress={handlePasswordLogin}
          disabled={isLoading}
          style={({ pressed }) => [
            styles.loginBtn,
            pressed && { opacity: 0.8 },
            isLoading && { opacity: 0.6 },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <Text style={styles.loginBtnText}>ENTRAR COM SENHA</Text>
          )}
        </Pressable>

        <View style={styles.divider} />

        <Pressable
          onPress={handleRFIDLogin}
          disabled={isLoading}
          style={({ pressed }) => [
            styles.rfidBtn,
            pressed && { opacity: 0.8 },
            isLoading && { opacity: 0.6 },
          ]}
        >
          <Text style={styles.rfidBtnText}>
            {wsStatus === 'on' ? '🟢 AGUARDANDO CARTÃO...' : 'APROXIMAR CARTÃO RFID'}
          </Text>
        </Pressable>
        
        <Text style={styles.info}>
          Aproxime o cartão do leitor Arduino para autenticação rápida.
        </Text>
      </View>

      <Text style={styles.footer}>
        ZERO TRUST · RFID ACTIVE · AUDITORIA
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    padding: 30,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  brand: {
    fontSize: 28,
    fontWeight: '900',
    color: C.neon,
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 10,
    color: C.text,
    letterSpacing: 2,
    marginTop: 5,
    fontFamily: MONO,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 9,
    color: C.text,
    marginBottom: 8,
    fontFamily: MONO,
    letterSpacing: 1.5,
  },
  input: {
    backgroundColor: C.mid,
    borderRadius: 4,
    padding: 15,
    color: C.white,
    marginBottom: 20,
    fontFamily: MONO,
    fontSize: 14,
  },
  loginBtn: {
    backgroundColor: C.neon,
    paddingVertical: 16,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 10,
  },
  loginBtnText: {
    color: C.bg,
    fontWeight: '900',
    letterSpacing: 1.5,
    fontSize: 13,
  },
  rfidBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.neon,
    paddingVertical: 14,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 10,
  },
  rfidBtnText: {
    color: C.neon,
    fontWeight: '700',
    letterSpacing: 1,
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: C.mid,
    marginVertical: 25,
  },
  errorText: {
    color: C.error,
    fontSize: 11,
    fontFamily: MONO,
    marginBottom: 15,
    textAlign: 'center',
  },
  info: {
    color: `${C.text}60`,
    fontSize: 9,
    textAlign: 'center',
    marginTop: 15,
    fontFamily: MONO,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: `${C.text}40`,
    fontSize: 8,
    letterSpacing: 2,
    fontFamily: MONO,
  },
});
