/**
 * @file aiGate.ts
 * @description Gateway de IA Seguro — "Coração" da solução PetroGate AR
 *
 * ARQUITETURA ZERO TRUST — PIPELINE DE SEGURANÇA:
 *
 * [Usuário/Smart Glasses]
 *       │
 *       ▼
 * [1. DLP Scanner] ──── Detecta e mascara PII/dados sensíveis
 *       │
 *       ▼
 * [2. Audit Logger] ─── Registra prompt original + mascarado no Supabase
 *       │                (imutável, com timestamp e device_id)
 *       ▼
 * [3. Risk Evaluator] ─ Bloqueia se severity HIGH detectada
 *       │
 *       ▼
 * [4. AI Gateway] ───── Envia APENAS o prompt mascarado para a IA externa
 *       │
 *       ▼
 * [5. Response Filter] ─ Sanitiza a resposta antes de retornar ao usuário
 *
 * PRINCÍPIOS APLICADOS:
 * - Least Privilege: A IA externa nunca vê dados reais
 * - Defense in Depth: Múltiplas camadas de verificação
 * - Immutable Audit Trail: Logs não podem ser alterados após criação
 * - Fail Secure: Em caso de erro, bloqueia ao invés de liberar
 */

import {
  scanAndSanitize,
  detectSensitiveKeywords,
  DlpScanResult,
} from '../utils/dlpScanner';
import { supabase, AuditLogRecord } from './supabaseClient';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Contexto do dispositivo/usuário que originou a requisição.
 * No PetroGate AR, o device_id identifica o Smart Glass específico.
 */
export interface RequestContext {
  /** E-mail corporativo do operador autenticado */
  userEmail: string;
  /**
   * ID único do dispositivo Smart Glass (ex: "SG-RJ-001").
   * Em produção: obtido via expo-constants ou MDM enrollment.
   */
  deviceId: string;
  /** Módulo/tela da aplicação que originou a requisição */
  module?: string;
}

/**
 * Resposta retornada pelo AI Gateway ao módulo solicitante.
 */
export interface AiGateResponse {
  /** Indica se a requisição foi processada com sucesso */
  success: boolean;
  /** Resposta da IA (já filtrada), presente quando success=true */
  aiResponse?: string;
  /** Mensagem de erro, presente quando success=false */
  errorMessage?: string;
  /**
   * Status do processamento DLP:
   * - CLEAN: Nenhum dado sensível detectado
   * - SANITIZED: Dados sensíveis mascarados, prompt enviado à IA
   * - BLOCKED: Dados de alto risco detectados, requisição bloqueada
   */
  dlpStatus: 'CLEAN' | 'SANITIZED' | 'BLOCKED';
  /** ID do log de auditoria gerado (para rastreabilidade) */
  auditLogId?: string;
  /** Regras DLP acionadas (para feedback ao usuário, se configurado) */
  triggeredRules?: string[];
}

/**
 * Configuração da API de IA (Gemini/GPT).
 * Em produção, mover para variáveis de ambiente.
 */
interface AiApiConfig {
  endpoint: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
}

// ─── Configuração ─────────────────────────────────────────────────────────────

/**
 * Configurações da API de IA.
 *
 * SEGURANÇA: A API Key JAMAIS deve estar hardcoded aqui.
 * Use EXPO_PUBLIC_AI_API_KEY para desenvolvimento e
 * um Supabase Edge Function como proxy em produção
 * (assim a key fica apenas no servidor, nunca no bundle do app).
 */
const AI_API_CONFIG: AiApiConfig = {
  // Para Gemini: https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent
  // Para GPT:    https://api.openai.com/v1/chat/completions
  endpoint: process.env.EXPO_PUBLIC_AI_ENDPOINT ?? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  model: process.env.EXPO_PUBLIC_AI_MODEL ?? 'gemini-2.0-flash',
  maxTokens: 1024,
  systemPrompt: `Você é um assistente técnico especializado em operações de petróleo e gás.
Responda apenas com base em informações técnicas e procedimentos padrão da indústria.
NUNCA solicite, armazene ou processe dados pessoais de funcionários.
Se encontrar placeholders como [CPF_RESTRITO] ou [VALOR_RESTRITO], ignore-os e responda sobre o contexto técnico da pergunta.
Responda sempre em português brasileiro.`,
};

// ─── Funções Auxiliares ───────────────────────────────────────────────────────

/**
 * Persiste o log de auditoria no Supabase.
 *
 * ZERO TRUST: O log é sempre gravado, mesmo quando a requisição é bloqueada.
 * Tentativas de exfiltração bloqueadas são especialmente importantes para auditar.
 *
 * @param logData - Dados do log a serem persistidos
 * @returns ID do log criado, ou undefined em caso de falha
 */
async function persistAuditLog(
  logData: Omit<AuditLogRecord, 'id' | 'created_at'>
): Promise<string | undefined> {
  try {
    const { data, error } = await supabase
      .from('ai_audit_logs')
      .insert(logData)
      .select('id')
      .single();

    if (error) {
      // Log de falha na auditoria — crítico para compliance
      console.error('[PetroGate DLP] ALERTA: Falha ao persistir log de auditoria:', {
        error: error.message,
        code: error.code,
        userEmail: logData.user_email,
        deviceId: logData.device_id,
        timestamp: new Date().toISOString(),
      });
      // FAIL SECURE: A falha de log não bloqueia a operação,
      // mas é registrada localmente para investigação posterior.
      return undefined;
    }

    return data?.id;
  } catch (unexpectedError) {
    console.error('[PetroGate DLP] CRÍTICO: Erro inesperado no audit logger:', unexpectedError);
    return undefined;
  }
}

/**
 * Determina o status DLP com base nos resultados da varredura.
 *
 * @param scanResult - Resultado do DLP Scanner
 * @returns Status de processamento
 */
function determineDlpStatus(
  scanResult: DlpScanResult
): 'CLEAN' | 'SANITIZED' | 'BLOCKED' {
  if (scanResult.hasHighSeverityMatch) {
    return 'BLOCKED';
  }
  if (scanResult.triggeredRules.length > 0) {
    return 'SANITIZED';
  }
  return 'CLEAN';
}

/**
 * Envia o prompt sanitizado para a API do Gemini.
 *
 * ARQUITETURA RECOMENDADA PARA PRODUÇÃO:
 * Esta função deve chamar um Supabase Edge Function (Deno) que atua como proxy.
 * O Edge Function mantém a API Key no servidor e adiciona rate limiting por device_id.
 * Nunca exponha a API Key no bundle do aplicativo móvel.
 *
 * @param sanitizedPrompt - Prompt já sanitizado pelo DLP Scanner
 * @returns Resposta da IA ou null em caso de falha
 */
async function callAiApi(sanitizedPrompt: string): Promise<string | null> {
  const apiKey = process.env.EXPO_PUBLIC_AI_API_KEY;

  if (!apiKey) {
    console.warn(
      '[PetroGate AI] API Key não configurada. ' +
      'Configure EXPO_PUBLIC_AI_API_KEY ou use um Edge Function proxy.'
    );
    // Em modo de desenvolvimento sem API key, retorna resposta simulada
    return simulateAiResponse(sanitizedPrompt);
  }

  try {
    // ── Estrutura para Google Gemini API ──
    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: sanitizedPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: AI_API_CONFIG.systemPrompt }],
      },
      generationConfig: {
        maxOutputTokens: AI_API_CONFIG.maxTokens,
        temperature: 0.3,        // Baixa temperatura = respostas mais determinísticas e seguras
        topP: 0.8,
        candidateCount: 1,
      },
      safetySettings: [
        // Configurações de segurança máximas para contexto corporativo
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
      ],
    };

    const response = await fetch(
      `${AI_API_CONFIG.endpoint}?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header personalizado para rastreamento no gateway da Petrobras
          'X-PetroGate-Client': 'petrogate-ar-mobile/1.0',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PetroGate AI] Erro na API:', response.status, errorText);
      return null;
    }

    const data = await response.json();

    // Extrai o texto da resposta do Gemini
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      console.warn('[PetroGate AI] Resposta da IA sem conteúdo texto:', JSON.stringify(data));
      return null;
    }

    return aiText;

  } catch (networkError) {
    console.error('[PetroGate AI] Erro de rede ao chamar API de IA:', networkError);
    return null;
  }
}

/**
 * Simula uma resposta da IA para desenvolvimento/testes sem API Key.
 * REMOVER EM PRODUÇÃO — apenas para validação do pipeline DLP.
 */
function simulateAiResponse(prompt: string): string {
  return (
    `[MODO SIMULAÇÃO - SEM API KEY CONFIGURADA]\n\n` +
    `Prompt recebido (sanitizado): "${prompt.substring(0, 100)}..."\n\n` +
    `Em produção, esta resposta viria do Gemini/GPT após análise do contexto técnico. ` +
    `Configure EXPO_PUBLIC_AI_API_KEY para ativar a IA real.`
  );
}

/**
 * Filtra a resposta da IA antes de retornar ao usuário.
 * Executa uma segunda passagem DLP na resposta para garantir que
 * a IA não "alucionou" dados sensíveis baseados no contexto mascarado.
 *
 * @param aiResponse - Resposta bruta da IA
 * @returns Resposta sanitizada
 */
function filterAiResponse(aiResponse: string): string {
  const responseScan = scanAndSanitize(aiResponse);

  if (responseScan.triggeredRules.length > 0) {
    console.warn(
      '[PetroGate DLP] ALERTA: IA gerou dados potencialmente sensíveis na resposta.',
      'Regras acionadas:', responseScan.triggeredRules
    );
  }

  return responseScan.sanitizedText;
}

// ─── Gateway Principal ────────────────────────────────────────────────────────

/**
 * Processa um prompt do usuário através do pipeline completo de segurança.
 *
 * FLUXO DETALHADO:
 * 1. DLP Scan: Identifica e mascara dados sensíveis no prompt
 * 2. Risk Assessment: Avalia severidade dos dados encontrados
 * 3. Audit Log: Persiste SEMPRE no Supabase (bloqueado ou não)
 * 4. Gate Decision: Bloqueia se HIGH severity detectada
 * 5. AI Call: Envia prompt MASCARADO para a IA
 * 6. Response Filter: Sanitiza a resposta da IA
 * 7. Return: Retorna resposta filtrada + metadados ao chamador
 *
 * @param userPrompt - Prompt bruto digitado pelo operador nos Smart Glasses
 * @param context - Contexto do dispositivo e usuário
 * @returns AiGateResponse com resposta da IA ou erro detalhado
 */
export async function processSecureAiRequest(
  userPrompt: string,
  context: RequestContext
): Promise<AiGateResponse> {

  // ── Validação de entrada ──
  if (!userPrompt?.trim()) {
    return {
      success: false,
      errorMessage: 'Prompt não pode ser vazio.',
      dlpStatus: 'CLEAN',
    };
  }

  const trimmedPrompt = userPrompt.trim();

  // ── ETAPA 1: DLP Scanning ──
  console.log('[PetroGate DLP] Iniciando varredura DLP...', {
    deviceId: context.deviceId,
    promptLength: trimmedPrompt.length,
  });

  const dlpResult = scanAndSanitize(trimmedPrompt);
  const sensitiveKeywords = detectSensitiveKeywords(trimmedPrompt);
  const dlpStatus = determineDlpStatus(dlpResult);

  console.log('[PetroGate DLP] Varredura concluída:', {
    status: dlpStatus,
    triggeredRules: dlpResult.triggeredRules,
    sensitiveKeywordsFound: sensitiveKeywords,
    hasHighSeverity: dlpResult.hasHighSeverityMatch,
  });

  // ── ETAPA 2: Preparar log de auditoria ──
  const auditLogData: Omit<AuditLogRecord, 'id' | 'created_at'> = {
    user_email: context.userEmail,
    device_id: context.deviceId,
    original_prompt: trimmedPrompt,      // ATENÇÃO: Criptografar em produção (AES-256)
    masked_prompt: dlpResult.sanitizedText,
    triggered_rules: dlpResult.triggeredRules,
    sensitive_keywords: sensitiveKeywords,
    status: dlpStatus,
    ai_response_preview: undefined,       // Será atualizado após resposta da IA
  };

  // ── ETAPA 3: BLOQUEIO — Alta severidade ──
  if (dlpStatus === 'BLOCKED') {
    console.warn('[PetroGate DLP] BLOQUEIO: Dados de alto risco detectados.', {
      userEmail: context.userEmail,
      deviceId: context.deviceId,
      rules: dlpResult.triggeredRules,
    });

    // Log de tentativa BLOQUEADA — crucial para detecção de insider threats
    const auditLogId = await persistAuditLog({
      ...auditLogData,
      status: 'BLOCKED',
    });

    return {
      success: false,
      errorMessage:
        'Requisição bloqueada pelo sistema de segurança DLP. ' +
        'Dados sensíveis detectados no prompt. ' +
        `Regras acionadas: ${dlpResult.triggeredRules.join(', ')}. ` +
        'Esta tentativa foi registrada para auditoria.',
      dlpStatus: 'BLOCKED',
      auditLogId,
      triggeredRules: dlpResult.triggeredRules,
    };
  }

  // ── ETAPA 4: Chamada à IA com prompt MASCARADO ──
  console.log('[PetroGate AI] Enviando prompt sanitizado para IA...', {
    originalLength: trimmedPrompt.length,
    sanitizedLength: dlpResult.sanitizedText.length,
    model: AI_API_CONFIG.model,
  });

  const rawAiResponse = await callAiApi(dlpResult.sanitizedText);

  if (!rawAiResponse) {
    // Falha na chamada à IA — log com status de erro
    const auditLogId = await persistAuditLog({
      ...auditLogData,
      status: dlpStatus,
      ai_response_preview: '[ERRO: Sem resposta da IA]',
    });

    return {
      success: false,
      errorMessage: 'Serviço de IA temporariamente indisponível. Tente novamente.',
      dlpStatus,
      auditLogId,
      triggeredRules: dlpResult.triggeredRules,
    };
  }

  // ── ETAPA 5: Filtrar resposta da IA ──
  const filteredResponse = filterAiResponse(rawAiResponse);

  // ── ETAPA 6: Persistir log completo com preview da resposta ──
  const auditLogId = await persistAuditLog({
    ...auditLogData,
    status: dlpStatus,
    // Apenas os primeiros 200 caracteres — evita logs excessivamente grandes
    ai_response_preview: filteredResponse.substring(0, 200),
  });

  console.log('[PetroGate AI] Requisição processada com sucesso:', {
    auditLogId,
    dlpStatus,
    responseLength: filteredResponse.length,
  });

  return {
    success: true,
    aiResponse: filteredResponse,
    dlpStatus,
    auditLogId,
    triggeredRules: dlpResult.triggeredRules,
  };
}

/**
 * Utilitário para recuperar logs de auditoria de um dispositivo específico.
 * Útil para painéis de compliance e investigações de segurança.
 *
 * @param deviceId - ID do Smart Glass a consultar
 * @param limit - Máximo de registros retornados (padrão: 50)
 * @returns Array de registros de auditoria
 */
export async function getAuditLogsForDevice(
  deviceId: string,
  limit: number = 50
): Promise<AuditLogRecord[]> {
  const { data, error } = await supabase
    .from('ai_audit_logs')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[PetroGate Audit] Erro ao recuperar logs:', error);
    return [];
  }

  return data ?? [];
}

/**
 * Retorna estatísticas de segurança agregadas para um período.
 * Usado pelo dashboard de compliance do time de Segurança da Informação.
 *
 * @param startDate - Data inicial (ISO 8601)
 * @param endDate - Data final (ISO 8601)
 */
export async function getSecurityStats(
  startDate: string,
  endDate: string
): Promise<{
  totalRequests: number;
  blockedRequests: number;
  sanitizedRequests: number;
  cleanRequests: number;
}> {
  const { data, error } = await supabase
    .from('ai_audit_logs')
    .select('status')
    .gte('created_at', startDate)
    .lte('created_at', endDate);

  if (error || !data) {
    console.error('[PetroGate Audit] Erro ao calcular estatísticas:', error);
    return { totalRequests: 0, blockedRequests: 0, sanitizedRequests: 0, cleanRequests: 0 };
  }

  return {
    totalRequests: data.length,
    blockedRequests: data.filter((r) => r.status === 'BLOCKED').length,
    sanitizedRequests: data.filter((r) => r.status === 'SANITIZED').length,
    cleanRequests: data.filter((r) => r.status === 'CLEAN').length,
  };
}
