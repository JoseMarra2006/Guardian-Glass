import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, Platform, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../context/AuthContext';

const C = {
  dark: '#050C11',
  panel: '#122737',
  mid: '#2A4A5E',
  neon: '#4DFFC9', // Bem mais claro (mint bright)
  text: '#9DCCDE',
  white: '#EEF6FA',
  warning: '#FFB800',
} as const;

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

function SecurityTag({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagLabel}>{label}</Text>
      <Text style={styles.tagValue}>{value}</Text>
    </View>
  );
}

export default function MobileDashboardScreen() {
  const router = useRouter();
  const {
    userName,
    userEmail,
    userRole,
    deviceId,
    signOut,
    isFaceRecognitionAvailable,
  } = useAuth();

  const roleSnapshot = useMemo(() => (userRole || 'Operador').toUpperCase(), [userRole]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor={C.dark} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.appTitle}>PETROGATE AR</Text>
          <Text style={styles.subtitle}>ZERO TRUST MOBILE CONSOLE</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sessão Ativa</Text>
          <Text style={styles.fieldLabel}>OPERADOR</Text>
          <Text style={styles.fieldValue}>{userName}</Text>
          <Text style={styles.fieldLabel}>EMAIL</Text>
          <Text style={styles.fieldValue}>{userEmail}</Text>
          <Text style={styles.fieldLabel}>ROLE (ACTIVE DIRECTORY)</Text>
          <Text style={styles.fieldValue}>{roleSnapshot}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Postura de Segurança</Text>
          <View style={styles.tagsRow}>
            <SecurityTag label="ZERO TRUST" value="ENFORCED" />
            <SecurityTag label="DLP" value="ACTIVE" />
          </View>
          <View style={styles.tagsRow}>
            <SecurityTag label="MFA" value={isFaceRecognitionAvailable ? 'FACE READY' : 'PASSWORD'} />
            <SecurityTag label="DEVICE" value={(deviceId || 'GATE-000').slice(-12).toUpperCase()} />
          </View>
        </View>

        {/* IA Chat Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>PetroGate IA</Text>
          <Text style={styles.helpText}>
            Converse com a IA especializada em Petrobras e operações de óleo e gás. Powered by Groq · LLaMA 3.3 70B.
          </Text>
          <Pressable
            onPress={() => router.push('/chat')}
            android_ripple={{ color: 'rgba(0, 0, 0, 0.2)' }}
          >
            <View style={styles.chatButton}>
              <Text style={styles.chatButtonText}>⬡ ABRIR CHAT COM IA</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable 
          onPress={async () => {
            console.log('[Dashboard] Solicitando encerramento de sessão...');
            await signOut();
          }} 
          android_ripple={{ color: 'rgba(255, 255, 255, 0.3)' }}
          style={({ pressed }) => [
            styles.signOutBtn, 
            pressed && Platform.OS === 'ios' && { opacity: 0.7 }
          ]}
        >
          <Text style={styles.signOutText}>ENCERRAR SESSÃO</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.dark },
  content: { padding: 16, gap: 12, paddingBottom: 80 },
  header: { gap: 4, marginBottom: 6 },
  appTitle: {
    color: C.white,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 3,
    fontFamily: MONO,
  },
  subtitle: {
    color: C.neon,
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: MONO,
  },
  card: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: `${C.mid}90`,
    borderRadius: 6,
    padding: 14,
    gap: 6,
  },
  sectionTitle: {
    fontFamily: MONO,
    color: C.neon,
    fontSize: 11,
    letterSpacing: 1.5,
    marginBottom: 4,
    fontWeight: '700',
  },
  fieldLabel: {
    fontFamily: MONO,
    color: C.text,
    fontSize: 8,
    letterSpacing: 1.3,
  },
  fieldValue: {
    fontFamily: MONO,
    color: C.white,
    fontSize: 12,
    marginBottom: 2,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  tag: {
    flex: 1,
    borderWidth: 1,
    borderColor: `${C.mid}90`,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 2,
  },
  tagLabel: {
    fontFamily: MONO,
    color: C.text,
    fontSize: 7,
    letterSpacing: 1,
  },
  tagValue: {
    fontFamily: MONO,
    color: C.neon,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  helpText: {
    fontFamily: MONO,
    color: C.text,
    fontSize: 10,
    lineHeight: 16,
    marginBottom: 8,
  },
  chatButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
    overflow: 'hidden',
  },
  chatButtonText: {
    fontFamily: MONO,
    color: '#000000',
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '900',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: `${C.mid}80`,
    backgroundColor: `${C.panel}CC`,
  },
  signOutBtn: {
    backgroundColor: '#1E3C4D',
    borderWidth: 1,
    borderColor: '#3A6076',
    borderRadius: 4,
    paddingVertical: 12,
    alignItems: 'center',
    overflow: 'hidden',
  },
  signOutText: {
    fontFamily: MONO,
    color: C.text,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
