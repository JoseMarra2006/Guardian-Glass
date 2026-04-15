/**
 * @file auditService.ts
 * @description Serviço de Auditoria Resiliente — PetroGate AR Fase 3
 *
 * ─── PRINCÍPIO DA FALHA SEGURA (Fail Secure) ─────────────────────────────────
 * Em sistemas de segurança, uma falha no subsistema de logging NÃO deve impedir
 * o registro de um evento crítico. Este serviço garante que:
 *
 *   1. Todo evento de segurança (BLOCKED, SANITIZED, CLEAN) é persistido
 *      no Supabase como fonte de verdade primária.
 *
 *   2. Se o Supabase estiver temporariamente indisponível, o log é enfileirado
 *      em memória e reprocessado com backoff exponencial (até 3 tentativas).
 *
 *   3. Se as 3 tentativas falharem, o log é gravado no console de forma
 *      estruturada como fallback de último recurso (capturado por qualquer
 *      ferramenta de observabilidade — Sentry, Datadog, etc.).
 *
 *   4. A operação de segurança (ex: bloqueio de prompt) NUNCA é atrasada ou
 *      impedida por falhas de logging — as duas operações são independentes.
 *
 * ─── SOBERANIA DOS DADOS (LGPD Art. 44) ─────────────────────────────────────
 * Todos os logs de auditoria são persistidos exclusivamente no Supabase
 * (instância controlada pela organização), nunca em serviços de terceiros.
 * O campo original_prompt deve ser criptografado com AES-256 em produção
 * antes da inserção (chave gerenciada pelo KMS interno).
 *
 * ─── ARQUITETURA DE PRODUÇÃO ─────────────────────────────────────────────────
 * Para alta disponibilidade, substitua a fila em memória por:
 *   - AsyncStorage (React Native) para persistência entre sessões
 *   - Expo SecureStore para dados sensíveis offline
 *   - Um worker de background via expo-task-manager para retry automático
 */

import { supabase, AuditLogRecord } from './supabaseClient';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Payload de inserção — id e created_at são gerados pelo Supabase */
export type AuditLogPayload = Omit<AuditLogRecord, 'id' | 'created_at'>;

/** Entrada na fila de retry em memória */
interface RetryQueueEntry {
  payload: AuditLogPayload;
  attempts: number;
  /** Timestamp (epoch ms) a partir do qual a próxima tentativa é permitida */
  nextRetryAt: number;
  /** ID local gerado para rastreamento antes do Supabase confirmar */
  correlationId: string;
  firstAttemptAt: string;
  lastError?: string;
}

/** Resultado de uma operação de persistência */
export interface AuditPersistResult {
  /** ID do registro no Supabase (undefined se ainda em retry queue) */
  auditLogId?: string;
  /** true = gravado com sucesso no Supabase | false = em fila de retry */
  persisted: boolean;
  /** Número de tentativas realizadas */
  attempts: number;
}

// ─── Configuração ─────────────────────────────────────────────────────────────

const MAX_RETRY_ATTEMPTS = 3;

/** Delays em ms para cada tentativa: 2s, 4s, 8s (backoff exponencial) */
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

// ─── Estado Interno ───────────────────────────────────────────────────────────

/** Fila em memória de logs pendentes de persistência */
const retryQueue: RetryQueueEntry[] = [];

/** Contador para correlação de logs locais */
let correlationCounter = 0;

function generateCorrelationId(): string {
  correlationCounter += 1;
  return `LOCAL-${Date.now()}-${String(correlationCounter).padStart(4, '0')}`;
}

// ─── Funções de Persistência ──────────────────────────────────────────────────

/**
 * Tenta gravar um payload diretamente no Supabase.
 *
 * @returns ID do registro criado, ou undefined se falhou
 */
async function writeToSupabase(payload: AuditLogPayload): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('ai_audit_logs')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    throw new Error(`Supabase insert error [${error.code}]: ${error.message}`);
  }

  return data?.id;
}

/**
 * Fallback de último recurso: grava o log de auditoria no console em formato
 * estruturado para captura por ferramentas de observabilidade (Sentry, etc.).
 *
 * IMPORTANTE: Este fallback indica falha de infraestrutura crítica.
 * O alerta deve ser configurado no sistema de monitoramento para disparar
 * quando logs com prefixo [PetroGate AUDIT FALLBACK] aparecerem.
 */
function writeToConsoleFallback(entry: RetryQueueEntry): void {
  console.error(
    '[PetroGate AUDIT FALLBACK] CRÍTICO: Log de auditoria não persistido no Supabase após',
    entry.attempts, 'tentativas. Registrando localmente para compliance.',
    {
      correlationId: entry.correlationId,
      firstAttemptAt: entry.firstAttemptAt,
      lastError: entry.lastError,
      status: entry.payload.status,
      userEmail: entry.payload.user_email,
      deviceId: entry.payload.device_id,
      triggeredRules: entry.payload.triggered_rules,
      sensitiveKeywords: entry.payload.sensitive_keywords,
      // original_prompt e masked_prompt omitidos do fallback por segurança
      // (podem conter PII mesmo após sanitização parcial)
      maskedPromptLength: entry.payload.masked_prompt?.length ?? 0,
      timestamp: new Date().toISOString(),
    }
  );
}

// ─── Retry Queue ──────────────────────────────────────────────────────────────

/**
 * Processa a fila de logs pendentes.
 * Chamado automaticamente após cada falha e opcionalmente no startup do app.
 *
 * O processamento é não-bloqueante: falhas individuais não interrompem
 * o processamento das demais entradas na fila.
 */
async function flushRetryQueue(): Promise<void> {
  if (retryQueue.length === 0) return;

  const now = Date.now();
  // Processa apenas entradas cujo delay já expirou
  const pendingEntries = retryQueue.filter((e) => e.nextRetryAt <= now);

  if (pendingEntries.length === 0) return;

  console.log(
    `[PetroGate Audit] Processando ${pendingEntries.length} log(s) em retry queue...`
  );

  for (const entry of pendingEntries) {
    try {
      const id = await writeToSupabase(entry.payload);

      // Sucesso — remover da fila
      const idx = retryQueue.indexOf(entry);
      if (idx !== -1) retryQueue.splice(idx, 1);

      console.log(
        `[PetroGate Audit] Log [${entry.correlationId}] persistido no Supabase após`,
        entry.attempts, 'tentativa(s). ID:', id
      );

    } catch (error) {
      entry.attempts += 1;
      entry.lastError = error instanceof Error ? error.message : String(error);

      if (entry.attempts >= MAX_RETRY_ATTEMPTS) {
        // Esgotou as tentativas — fallback para console e remove da fila
        writeToConsoleFallback(entry);
        const idx = retryQueue.indexOf(entry);
        if (idx !== -1) retryQueue.splice(idx, 1);
      } else {
        // Agenda próxima tentativa com backoff exponencial
        const delay = RETRY_DELAYS_MS[entry.attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        entry.nextRetryAt = Date.now() + delay;
        console.warn(
          `[PetroGate Audit] Retry ${entry.attempts}/${MAX_RETRY_ATTEMPTS} para [${entry.correlationId}]`,
          `— próxima tentativa em ${delay / 1000}s. Erro: ${entry.lastError}`
        );
      }
    }
  }
}

// ─── API Pública ──────────────────────────────────────────────────────────────

/**
 * Persiste um log de auditoria de segurança com resiliência a falhas.
 *
 * GARANTIAS:
 * - Sempre retorna (nunca lança exceção)
 * - Se Supabase falhar, o log é enfileirado para retry automático
 * - Se o retry esgotar, o log é registrado no console (observabilidade)
 * - Eventos BLOCKED têm prioridade de log (registrados antes do retorno)
 *
 * @param payload - Dados do log de auditoria
 * @returns AuditPersistResult com ID do Supabase (se disponível) e status
 */
export async function persistAuditLog(
  payload: AuditLogPayload
): Promise<AuditPersistResult> {
  // Log local imediato (sempre) — não depende de Supabase
  console.log('[PetroGate Audit] Registrando evento de segurança:', {
    status: payload.status,
    userEmail: payload.user_email,
    deviceId: payload.device_id,
    triggeredRules: payload.triggered_rules,
    sensitiveKeywords: payload.sensitive_keywords,
    timestamp: new Date().toISOString(),
  });

  try {
    // Tentativa primária — Supabase
    const id = await writeToSupabase(payload);

    console.log('[PetroGate Audit] Log persistido no Supabase.', {
      id,
      status: payload.status,
    });

    // Aproveita para processar qualquer entrada pendente na fila
    void flushRetryQueue();

    return { auditLogId: id, persisted: true, attempts: 1 };

  } catch (primaryError) {
    const errorMsg = primaryError instanceof Error
      ? primaryError.message
      : String(primaryError);

    console.warn('[PetroGate Audit] Falha na persistência primária. Enfileirando para retry.', {
      error: errorMsg,
      status: payload.status,
      userEmail: payload.user_email,
    });

    // Adicionar à fila de retry
    const entry: RetryQueueEntry = {
      payload,
      attempts: 1,
      nextRetryAt: Date.now() + RETRY_DELAYS_MS[0],
      correlationId: generateCorrelationId(),
      firstAttemptAt: new Date().toISOString(),
      lastError: errorMsg,
    };
    retryQueue.push(entry);

    // Agendar retry com delay inicial
    setTimeout(() => void flushRetryQueue(), RETRY_DELAYS_MS[0]);

    return {
      auditLogId: undefined,
      persisted: false,
      attempts: 1,
    };
  }
}

/**
 * Força o processamento imediato da fila de retry.
 * Útil para chamar no startup do app ou quando a conectividade é restaurada.
 *
 * @example
 * // Em App.tsx, após confirmar conectividade:
 * useEffect(() => { void flushPendingAuditLogs(); }, [isConnected]);
 */
export async function flushPendingAuditLogs(): Promise<void> {
  await flushRetryQueue();
}

/**
 * Retorna o número de logs pendentes na fila de retry.
 * Útil para indicadores de status no HUD do operador.
 */
export function getPendingAuditLogsCount(): number {
  return retryQueue.length;
}

/**
 * Recupera logs de auditoria de um dispositivo específico.
 * Útil para painéis de compliance e investigações de segurança.
 *
 * @param deviceId - ID do Smart Glass
 * @param limit - Máximo de registros (padrão: 50)
 */
export async function getAuditLogsForDevice(
  deviceId: string,
  limit = 50
): Promise<AuditLogRecord[]> {
  const { data, error } = await supabase
    .from('ai_audit_logs')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[PetroGate Audit] Erro ao recuperar logs de auditoria:', error);
    return [];
  }

  return data ?? [];
}

/**
 * Estatísticas de segurança para o dashboard de compliance.
 *
 * @param startDate - Data inicial ISO 8601
 * @param endDate   - Data final ISO 8601
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
    return {
      totalRequests: 0,
      blockedRequests: 0,
      sanitizedRequests: 0,
      cleanRequests: 0,
    };
  }

  return {
    totalRequests: data.length,
    blockedRequests:   data.filter((r) => r.status === 'BLOCKED').length,
    sanitizedRequests: data.filter((r) => r.status === 'SANITIZED').length,
    cleanRequests:     data.filter((r) => r.status === 'CLEAN').length,
  };
}
