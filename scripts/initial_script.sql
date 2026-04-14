-- ==========================================================
-- SCRIPT DE INFRAESTRUTURA DE SEGURANÇA - PETROGATE AR
-- FOCO: AUDITORIA, COMPLIANCE (LGPD) E ZERO TRUST
-- ==========================================================

-- 1. Criação da Tabela de Logs de Auditoria
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    
    -- Identificação do Contexto (Zero Trust)
    user_email text NOT NULL,
    device_id text NOT NULL,
    ip_address text, -- Opcional: para auditoria de rede
    
    -- Dados do Middleware DLP
    original_prompt text NOT NULL,      -- O que o usuário disse (privado)
    masked_prompt text NOT NULL,        -- O que foi enviado para a IA (seguro)
    security_score float4 DEFAULT 1.0,  -- Nível de confiança da transação
    
    -- Status do Gate
    status text CHECK (status IN ('SECURE', 'FLAGGED', 'BLOCKED')) DEFAULT 'SECURE',
    ai_response text,                   -- Resposta retornada pela IA
    
    -- Metadados
    app_version text DEFAULT '1.0.0'
);

-- 2. Performance: Índices para busca rápida em auditoria
-- Útil para o painel de controle mostrar logs por data ou por usuário rapidamente
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- 3. Segurança: Ativar Row Level Security (RLS)
-- Isso impede que qualquer um acesse os logs, mesmo que tenha a chave do banco
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de Acesso (Policies)
-- Política: Apenas o backend (ou o próprio usuário logado) pode inserir logs
CREATE POLICY "Enable insert for authenticated users only" 
ON public.audit_logs 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Política: Apenas administradores (service_role) podem ler todos os logs
-- No MVP, vamos permitir que o usuário veja seus próprios logs para demonstração
CREATE POLICY "Users can view their own audit trail" 
ON public.audit_logs 
FOR SELECT 
TO authenticated 
USING (auth.jwt() ->> 'email' = user_email);

-- 5. Comentário de Tabela (Para documentação no Supabase)
COMMENT ON TABLE public.audit_logs IS 'Registros de auditoria do Middleware DLP para conformidade com políticas de segurança da Petrobras.';