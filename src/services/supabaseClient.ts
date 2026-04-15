/**
 * @file supabaseClient.ts
 * @description Cliente Supabase singleton para o PetroGate AR
 *
 * ARQUITETURA ZERO TRUST — DECISÕES DE DESIGN:
 *
 * 1. SINGLETON PATTERN: Um único cliente é reutilizado em toda a aplicação.
 *    Isso evita múltiplas conexões simultâneas e garante que todas as
 *    chamadas passem pelo mesmo canal auditado.
 *
 * 2. VARIÁVEIS DE AMBIENTE (EXPO_PUBLIC_*): No Expo, apenas variáveis
 *    prefixadas com EXPO_PUBLIC_ são expostas ao bundle do cliente.
 *    A chave Supabase usada aqui é a 'anon key' — segura para o cliente
 *    pois as políticas RLS (Row Level Security) no Supabase controlam
 *    o acesso real aos dados. A service_role key JAMAIS deve ir para o cliente.
 *
 * 3. RLS OBRIGATÓRIO: Este cliente opera sob o pressuposto de que todas
 *    as tabelas possuem Row Level Security habilitado no Supabase.
 *    Sem RLS, a anon key concede acesso irrestrito — violação Zero Trust.
 *
 * CONFIGURAÇÃO NECESSÁRIA (.env.local):
 *   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *
 * SQL para criar a tabela de auditoria no Supabase:
 * ```sql
 * CREATE TABLE ai_audit_logs (
 *   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *   user_email TEXT NOT NULL,
 *   device_id TEXT NOT NULL,
 *   original_prompt TEXT NOT NULL,  -- ATENÇÃO: criptografar em produção
 *   masked_prompt TEXT NOT NULL,
 *   triggered_rules TEXT[] DEFAULT '{}',
 *   sensitive_keywords TEXT[] DEFAULT '{}',
 *   status TEXT NOT NULL CHECK (status IN ('BLOCKED', 'SANITIZED', 'CLEAN')),
 *   ai_response_preview TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * -- RLS: Apenas service_role pode inserir (feito via Edge Function em produção)
 * ALTER TABLE ai_audit_logs ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "insert_audit_logs" ON ai_audit_logs
 *   FOR INSERT WITH CHECK (true);  -- Ajustar para autenticação JWT em produção
 * ```
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Validação de Configuração ───────────────────────────────────────────────

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Valida a presença das variáveis de ambiente em tempo de inicialização.
 *
 * ZERO TRUST: Falha explícita é preferível a falha silenciosa.
 * Se as credenciais não estão configuradas, o sistema não deve iniciar
 * em modo degradado — isso poderia mascarar uma configuração insegura.
 */
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[PetroGate Security] CRÍTICO: Variáveis de ambiente Supabase não configuradas.\n' +
    'Configure EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no arquivo .env.local\n' +
    'NUNCA commite credenciais no repositório — use .gitignore para proteger o .env.local'
  );
}

// ─── Database Types ──────────────────────────────────────────────────────────

/**
 * Tipagem da tabela de logs de auditoria usada em aiGate.ts.
 * Espelha exatamente o schema SQL definido no Supabase.
 */
export interface AuditLogRecord {
  id?: string;                   // UUID gerado pelo Supabase
  user_email: string;
  device_id: string;
  original_prompt: string;       // Em produção: deve ser criptografado com AES-256
  masked_prompt: string;
  triggered_rules: string[];
  sensitive_keywords: string[];
  status: 'BLOCKED' | 'SANITIZED' | 'CLEAN';
  ai_response_preview?: string | null;  // Primeiros 200 chars da resposta da IA
  created_at?: string;           // Preenchido automaticamente pelo Supabase
}

/**
 * Tipo do banco de dados para o cliente Supabase tipado.
 *
 * CORREÇÃO DE TIPAGEM (@supabase/supabase-js v2.103+):
 * A partir da versão 2.103 o cliente usa PostgrestVersion "12" internamente,
 * que exige um `type` (não `interface`) com todos os campos explicitamente
 * declarados por coluna em Row/Insert/Update, além das seções obrigatórias
 * Views, Functions, Enums e CompositeTypes. Sem isso, o compilador resolve
 * o tipo da tabela como `never`, causando erros em .insert(), .select(), etc.
 */
export type Database = {
  public: {
    Tables: {
      ai_audit_logs: {
        Row: {
          id: string;
          user_email: string;
          device_id: string;
          original_prompt: string;
          masked_prompt: string;
          triggered_rules: string[];
          sensitive_keywords: string[];
          status: 'BLOCKED' | 'SANITIZED' | 'CLEAN';
          ai_response_preview: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_email: string;
          device_id: string;
          original_prompt: string;
          masked_prompt: string;
          triggered_rules?: string[];
          sensitive_keywords?: string[];
          status: 'BLOCKED' | 'SANITIZED' | 'CLEAN';
          ai_response_preview?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_email?: string;
          device_id?: string;
          original_prompt?: string;
          masked_prompt?: string;
          triggered_rules?: string[];
          sensitive_keywords?: string[];
          status?: 'BLOCKED' | 'SANITIZED' | 'CLEAN';
          ai_response_preview?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// ─── Singleton Client ─────────────────────────────────────────────────────────

/**
 * Cliente Supabase tipado e configurado para o PetroGate AR.
 *
 * Configurações de segurança:
 * - autoRefreshToken: true — mantém sessão ativa sem expor credenciais
 * - persistSession: true — sessão persiste entre recarregamentos
 * - detectSessionInUrl: false — previne ataques de session fixation via URL
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // SEGURANÇA: desabilita leitura de token via URL
    },
    global: {
      headers: {
        // Identifica requisições do PetroGate AR nos logs do Supabase
        'x-application-name': 'petrogate-ar-mobile',
      },
    },
  }
);

export default supabase;
