/**
 * @file aiGate.ts
 * @description Gateway de IA Seguro — PetroGate AR Fase 3
 *
 * ─── PIPELINE DE SEGURANÇA ZERO TRUST ────────────────────────────────────────
 *
 *   [Smart Glass / Operador]
 *          │
 *          ▼
 *   [1. DLP Scanner]     ── Detecta e mascara PII/dados sensíveis
 *          │                Calcula Score de Risco (0-100)
 *          ▼
 *   [2. Risk Evaluator]  ── Decide: CLEAN | SANITIZED | BLOCKED
 *          │                Considera severidade individual + combinações
 *          ▼
 *   [3. Audit Logger]    ── Persiste SEMPRE no Supabase via auditService
 *          │                Fail Secure: retry queue + console fallback
 *          ▼
 *   [4. Gate Decision]   ── Retorna erro se BLOCKED (nunca chama IA)
 *          │
 *          ▼
 *   [5. AI Gateway]      ── Envia APENAS o prompt MASCARADO à IA externa
 *          │
 *          ▼
 *   [6. Response Filter] ── Segunda passagem DLP na resposta da IA
 *          │
 *          ▼
 *   [7. Return]          ── Resposta filtrada + metadados ao chamador
 *
 * ─── PRINCÍPIOS APLICADOS ────────────────────────────────────────────────────
 * • Least Privilege:   A IA externa NUNCA vê dados reais — apenas placeholders
 * • Defense in Depth:  DLP na entrada + DLP na saída
 * • Immutable Audit:   Logs sempre gravados, mesmo em requisições bloqueadas
 * • Fail Secure:       Em caso de falha, bloqueia em vez de liberar
 * • Data Sovereignty:  Todos os logs permanecem no Supabase da organização
 *
 * ─── SEGURANÇA DA API KEY ────────────────────────────────────────────────────
 * EXPO_PUBLIC_AI_API_KEY só deve ser usada em DESENVOLVIMENTO LOCAL.
 *
 * EM PRODUÇÃO, a API Key NUNCA deve estar no bundle do app móvel.
 * O fluxo seguro é:
 *
 *   App → [JWT Supabase] → Supabase Edge Function (Deno)
 *                                    │
 *                             valida JWT + device_id
 *                             aplica rate limiting
 *                                    │
 *                             → API Gemini/GPT (key no servidor)
 *
 * Assim, a API Key fica apenas no ambiente serverless do Supabase,
 * nunca exposta no bundle JavaScript do aplicativo React Native.
 * Configure EXPO_PUBLIC_AI_EDGE_URL para apontar ao Edge Function.
 */

import {
  scanAndSanitize,
  detectSensitiveKeywords,
  DlpScanResult,
  DLP_RULES,
} from '../utils/dlpScanner';
import {
  persistAuditLog,
  AuditLogPayload,
} from './auditService';

// ─── Interfaces ───────────────────────────────────────────────────────────────

/**
 * Contexto do dispositivo e operador que originou a requisição.
 * Preenchido pelo AuthContext e obrigatório em toda chamada ao gateway.
 */
export interface RequestContext {
  /** E-mail corporativo do operador autenticado (do AuthContext) */
  userEmail: string;
  /**
   * ID único do Smart Glass (do AuthContext via expo-application).
   * Em produção: MDM enrollment ID para garantia de hardware binding.
   */
  deviceId: string;
  /** Módulo/tela da aplicação que originou a requisição */
  module?: string;
}

/**
 * Resposta retornada pelo AI Gateway ao módulo solicitante (ex: VoiceInterface).
 */
export interface AiGateResponse {
  success: boolean;
  aiResponse?: string;
  errorMessage?: string;
  /**
   * Status da decisão DLP:
   * - CLEAN:     Nenhum dado sensível detectado
   * - SANITIZED: Dados mascarados, resposta da IA retornada
   * - BLOCKED:   Tentativa de exfiltração detectada, requisição bloqueada
   */
  dlpStatus: 'CLEAN' | 'SANITIZED' | 'BLOCKED';
  /** Pontuação de risco calculada (0-100) — visível no HUD para o operador */
  riskScore: number;
  /** Nível de risco: NONE | LOW | MEDIUM | HIGH | CRITICAL */
  riskLevel: string;
  /** ID do log de auditoria no Supabase (para rastreabilidade) */
  auditLogId?: string;
  /** IDs das regras DLP acionadas */
  triggeredRules?: string[];
  /** Descrições legíveis das categorias de dados bloqueados */
  blockedDataCategories?: string[];
}

interface AiApiConfig {
  endpoint: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
}

// ─── Configuração da API de IA ────────────────────────────────────────────────

const AI_API_CONFIG: AiApiConfig = {
  // ── DESENVOLVIMENTO: endpoint direto (requer EXPO_PUBLIC_AI_API_KEY) ──
  // ── PRODUÇÃO:        substituir por EXPO_PUBLIC_AI_EDGE_URL (Edge Function) ──
  endpoint: process.env.EXPO_PUBLIC_AI_ENDPOINT
    ?? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  model: process.env.EXPO_PUBLIC_AI_MODEL ?? 'gemini-2.0-flash',
  maxTokens: 1024,
  systemPrompt: `Você é um assistente técnico especializado em operações de petróleo e gás.
Responda apenas com base em informações técnicas e procedimentos padrão da indústria.
NUNCA solicite, armazene ou processe dados pessoais de funcionários.
Se encontrar placeholders como [CPF_CONFIDENCIAL] ou [MATRÍCULA_CONFIDENCIAL],
ignore-os completamente e responda sobre o contexto técnico da pergunta.
Responda sempre em português brasileiro, de forma objetiva e técnica.`,
};

// ─── Lógica de Decisão DLP ────────────────────────────────────────────────────

/**
 * Determina o status DLP com base no resultado da varredura e no Score de Risco.
 *
 * REGRAS DE BLOQUEIO (qualquer uma é suficiente):
 * 1. Regra individual de severidade HIGH foi acionada
 * 2. Score de Risco >= 60 (múltiplas ocorrências MEDIUM ou combinações perigosas)
 * 3. Nível de risco é HIGH ou CRITICAL
 *
 * Esta abordagem multi-camada captura tanto exfiltração direta (CPF explícito)
 * quanto exfiltração indireta por acumulação (4 valores financeiros + nome + cargo).
 */
function determineDlpStatus(
  scanResult: DlpScanResult
): 'CLEAN' | 'SANITIZED' | 'BLOCKED' {
  const { riskScore } = scanResult;

  // Bloqueio por regra HIGH individual ou score/nível crítico
  if (
    scanResult.hasHighSeverityMatch ||
    riskScore.decision === 'BLOCK' ||
    riskScore.level === 'CRITICAL' ||
    riskScore.level === 'HIGH'
  ) {
    return 'BLOCKED';
  }

  // Sanitização para dados MEDIUM/LOW
  if (scanResult.triggeredRules.length > 0) {
    return 'SANITIZED';
  }

  return 'CLEAN';
}

/**
 * Mapeia IDs de regras para descrições legíveis para exibição no HUD.
 * Exemplos: "CPF" → "CPF — Cadastro de Pessoa Física"
 */
function resolveRuleDescriptions(ruleIds: string[]): string[] {
  return ruleIds.map((id) => {
    const rule = DLP_RULES.find((r) => r.id === id);
    return rule ? `${id}: ${rule.description}` : id;
  });
}

// ─── Chamada à API de IA ──────────────────────────────────────────────────────

/**
 * Envia o prompt sanitizado para a API de IA configurada.
 *
 * ─── IMPORTANTE: Proteção da API Key ─────────────────────────────────────────
 * Em PRODUÇÃO, esta função NUNCA deve chamar a API da IA diretamente.
 * Use um Supabase Edge Function como proxy:
 *
 *   // Configurar EXPO_PUBLIC_AI_EDGE_URL no .env.local
 *   const EDGE_URL = process.env.EXPO_PUBLIC_AI_EDGE_URL;
 *   if (EDGE_URL) {
 *     const { data: { session } } = await supabase.auth.getSession();
 *     return fetch(EDGE_URL, {
 *       method: 'POST',
 *       headers: {
 *         'Authorization': `Bearer ${session?.access_token}`,
 *         'Content-Type': 'application/json',
 *       },
 *       body: JSON.stringify({ prompt: sanitizedPrompt, deviceId }),
 *     });
 *   }
 *
 * O Edge Function valida o JWT, aplica rate limiting por device_id e
 * encaminha para Gemini/GPT com a API Key armazenada apenas no servidor.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function callAiApi(
  sanitizedPrompt: string,
  deviceId: string
): Promise<string | null> {
  const apiKey = process.env.EXPO_PUBLIC_AI_API_KEY;

  if (!apiKey) {
    console.warn(
      '[PetroGate AI] API Key não configurada. Usando resposta simulada.\n' +
      'PRODUÇÃO: Configure EXPO_PUBLIC_AI_EDGE_URL para usar o Edge Function proxy.'
    );
    return simulateAiResponse(sanitizedPrompt);
  }

  try {
    const requestBody = {
      contents: [
        { role: 'user', parts: [{ text: sanitizedPrompt }] },
      ],
      systemInstruction: {
        parts: [{ text: AI_API_CONFIG.systemPrompt }],
      },
      generationConfig: {
        maxOutputTokens: AI_API_CONFIG.maxTokens,
        temperature: 0.3,
        topP: 0.8,
        candidateCount: 1,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_LOW_AND_ABOVE' },
      ],
    };

    const response = await fetch(
      `${AI_API_CONFIG.endpoint}?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PetroGate-Client': 'petrogate-ar-mobile/3.0',
          'X-PetroGate-Device': deviceId,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PetroGate AI] Erro HTTP na API:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const aiText: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      console.warn('[PetroGate AI] Resposta sem conteúdo texto:', JSON.stringify(data));
      return null;
    }

    return aiText;

  } catch (networkError) {
    console.error('[PetroGate AI] Erro de rede:', networkError);
    return null;
  }
}

/** Resposta simulada para desenvolvimento sem API Key configurada */
function simulateAiResponse(prompt: string): string {
  return (
    `[MODO SIMULAÇÃO — SEM API KEY]\n\n` +
    `Prompt sanitizado recebido (${prompt.length} chars):\n` +
    `"${prompt.substring(0, 120)}${prompt.length > 120 ? '...' : ''}"\n\n` +
    `Configure EXPO_PUBLIC_AI_API_KEY (dev) ou EXPO_PUBLIC_AI_EDGE_URL (produção) ` +
    `para ativar respostas reais do Gemini/GPT.`
  );
}

/**
 * Segunda passagem DLP na resposta da IA.
 * Previne que a IA "alucine" dados sensíveis a partir dos placeholders.
 */
function filterAiResponse(aiResponse: string): string {
  const responseScan = scanAndSanitize(aiResponse);

  if (responseScan.triggeredRules.length > 0) {
    console.warn(
      '[PetroGate DLP] ALERTA: IA gerou dados potencialmente sensíveis na resposta.',
      { regras: responseScan.triggeredRules, riskScore: responseScan.riskScore.score }
    );
  }

  return responseScan.sanitizedText;
}

// ─── Gateway Principal ────────────────────────────────────────────────────────

/**
 * Processa uma requisição de IA através do pipeline completo de segurança.
 *
 * INTEGRAÇÃO COM AuthContext:
 * O parâmetro `context` deve ser preenchido com os dados do useAuth():
 *
 *   const { userEmail, deviceId } = useAuth();
 *   await processSecureAiRequest(prompt, { userEmail, deviceId, module: 'hud-ar' });
 *
 * O userEmail e deviceId são gravados em CADA log de auditoria, garantindo
 * rastreabilidade completa para investigações de insider threat.
 *
 * @param userPrompt - Prompt bruto do operador (pode conter dados sensíveis)
 * @param context    - Contexto de autenticação do dispositivo e operador
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
      riskScore: 0,
      riskLevel: 'NONE',
    };
  }

  const trimmedPrompt = userPrompt.trim();

  // ── ETAPA 1: DLP Scanning + Score de Risco ──────────────────────────────────
  console.log('[PetroGate DLP] Iniciando varredura DLP...', {
    deviceId: context.deviceId,
    userEmail: context.userEmail,
    module: context.module ?? 'unknown',
    promptLength: trimmedPrompt.length,
  });

  const dlpResult      = scanAndSanitize(trimmedPrompt);
  const sensitiveKws   = detectSensitiveKeywords(trimmedPrompt);
  const dlpStatus      = determineDlpStatus(dlpResult);
  const { riskScore }  = dlpResult;

  console.log('[PetroGate DLP] Varredura concluída:', {
    status:             dlpStatus,
    riskScore:          riskScore.score,
    riskLevel:          riskScore.level,
    decision:           riskScore.decision,
    triggeredRules:     dlpResult.triggeredRules,
    highSeverityCount:  riskScore.highSeverityCount,
    sensitiveKeywords:  sensitiveKws,
    factors:            riskScore.factors,
  });

  // ── ETAPA 2: Montar payload de auditoria ────────────────────────────────────
  // deviceId e userEmail são SEMPRE incluídos para rastreabilidade completa.
  // Mesmo requisições CLEAN são auditadas (baseline de comportamento normal).
  const auditPayload: AuditLogPayload = {
    user_email:         context.userEmail,       // do AuthContext
    device_id:          context.deviceId,        // do AuthContext
    original_prompt:    trimmedPrompt,           // ATENÇÃO: criptografar com AES-256 em produção
    masked_prompt:      dlpResult.sanitizedText,
    triggered_rules:    dlpResult.triggeredRules,
    sensitive_keywords: sensitiveKws,
    status:             dlpStatus,
    ai_response_preview: null,                   // preenchido após resposta da IA
  };

  // ── ETAPA 3: BLOQUEIO — Alta severidade / Score crítico ────────────────────
  if (dlpStatus === 'BLOCKED') {
    console.warn('[PetroGate DLP] BLOQUEIO DE SEGURANÇA:', {
      userEmail:     context.userEmail,
      deviceId:      context.deviceId,
      riskScore:     riskScore.score,
      riskLevel:     riskScore.level,
      triggeredRules: dlpResult.triggeredRules,
      factors:        riskScore.factors,
    });

    // FAIL SECURE: o log é persistido antes de retornar o bloqueio.
    // O auditService garante resiliência (retry queue) se o Supabase falhar.
    const { auditLogId } = await persistAuditLog({
      ...auditPayload,
      status: 'BLOCKED',
    });

    const blockedCategories = resolveRuleDescriptions(dlpResult.triggeredRules);

    return {
      success: false,
      errorMessage:
        `POLÍTICA DE SEGURANÇA — REQUISIÇÃO BLOQUEADA\n\n` +
        `Dados sensíveis detectados no prompt.\n` +
        `Categorias identificadas: ${blockedCategories.join(' | ')}\n` +
        `Score de Risco: ${riskScore.score}/100 (${riskScore.level})\n` +
        `Operador: ${context.userEmail} · Dispositivo: ${context.deviceId}\n` +
        `Esta tentativa foi registrada para auditoria de compliance (LGPD Art. 37).`,
      dlpStatus: 'BLOCKED',
      riskScore: riskScore.score,
      riskLevel: riskScore.level,
      auditLogId,
      triggeredRules:      dlpResult.triggeredRules,
      blockedDataCategories: blockedCategories,
    };
  }

  // ── ETAPA 4: Chamada à IA com prompt MASCARADO ──────────────────────────────
  console.log('[PetroGate AI] Enviando prompt sanitizado para IA...', {
    originalLength:  trimmedPrompt.length,
    sanitizedLength: dlpResult.sanitizedText.length,
    dlpStatus,
    riskScore:       riskScore.score,
    model:           AI_API_CONFIG.model,
  });

  const rawAiResponse = await callAiApi(dlpResult.sanitizedText, context.deviceId);

  if (!rawAiResponse) {
    // IA indisponível — log com status de erro antes de retornar
    const { auditLogId } = await persistAuditLog({
      ...auditPayload,
      status: dlpStatus,
      ai_response_preview: '[ERRO: Serviço de IA indisponível]',
    });

    return {
      success: false,
      errorMessage: 'Serviço de IA temporariamente indisponível. Tente novamente.',
      dlpStatus,
      riskScore: riskScore.score,
      riskLevel: riskScore.level,
      auditLogId,
      triggeredRules: dlpResult.triggeredRules,
    };
  }

  // ── ETAPA 5: Segunda passagem DLP na resposta da IA ─────────────────────────
  const filteredResponse = filterAiResponse(rawAiResponse);

  // ── ETAPA 6: Persistir log completo com preview da resposta ─────────────────
  const { auditLogId } = await persistAuditLog({
    ...auditPayload,
    status: dlpStatus,
    ai_response_preview: filteredResponse.substring(0, 200),
  });

  console.log('[PetroGate AI] Requisição processada com sucesso:', {
    auditLogId,
    dlpStatus,
    riskScore:      riskScore.score,
    riskLevel:      riskScore.level,
    responseLength: filteredResponse.length,
  });

  return {
    success: true,
    aiResponse:     filteredResponse,
    dlpStatus,
    riskScore:      riskScore.score,
    riskLevel:      riskScore.level,
    auditLogId,
    triggeredRules: dlpResult.triggeredRules,
  };
}
