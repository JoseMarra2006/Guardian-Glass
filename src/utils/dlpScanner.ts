/**
 * @file dlpScanner.ts
 * @description Data Loss Prevention (DLP) Scanner — PetroGate AR Fase 3
 *
 * ARQUITETURA ZERO TRUST:
 * Este módulo implementa "never trust, always verify & sanitize":
 * - Todo prompt é tratado como potencialmente contendo dados sensíveis
 * - A sanitização ocorre ANTES de qualquer transmissão externa
 * - Cada padrão identificado é substituído por um placeholder auditável
 * - O Score de Risco detecta tentativas de exfiltração em massa
 *
 * CONFORMIDADE: LGPD (Lei 13.709/2018), ISO/IEC 27001, NIST SP 800-188
 *
 * ─── DECISÃO DE DESIGN: Score de Risco ───────────────────────────────────────
 * Regras individuais capturam dados pontuais. O Score de Risco detecta
 * padrões compostos que indicam intenção de exfiltração:
 *
 *   Nome + Salário = tentativa de exfiltração de folha de pessoal
 *   CPF + Nome    = exfiltração de cadastro completo de funcionário
 *   Matrícula + Valor = consulta de remuneração de colaborador específico
 *
 * Cada combinação ganha pontos extras ("combination bonus") que podem
 * elevar o score ao limiar de bloqueio mesmo sem nenhuma regra HIGH.
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Regra DLP individual */
export interface DlpRule {
  id: string;
  description: string;
  pattern: RegExp;
  placeholder: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** Nível de risco calculado pelo Score de Risco */
export type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Decisão de roteamento baseada no score */
export type RiskDecision = 'ALLOW' | 'SANITIZE' | 'BLOCK';

/**
 * Score de Risco calculado para um texto varrido.
 * Combina pontuação individual por regra + bônus por combinações perigosas.
 */
export interface RiskScore {
  /** Pontuação de 0 a 100 */
  score: number;
  /** Nível de risco calculado */
  level: RiskLevel;
  /** Decisão de roteamento recomendada */
  decision: RiskDecision;
  /** Total de ocorrências de dados sensíveis encontradas */
  matchCount: number;
  /** Quantas regras HIGH foram acionadas */
  highSeverityCount: number;
  /** Fatores que contribuíram para o score (para log de auditoria) */
  factors: string[];
}

/** Resultado completo da varredura DLP */
export interface DlpScanResult {
  originalText: string;
  sanitizedText: string;
  triggeredRules: string[];
  hasHighSeverityMatch: boolean;
  /** Score de Risco composto — considera regras individuais + combinações */
  riskScore: RiskScore;
  scannedAt: string;
}

// ─── Limiares de Score ────────────────────────────────────────────────────────

export const RISK_SCORE_THRESHOLDS = {
  /**
   * Score >= BLOCK: requisição bloqueada independentemente de ter regra HIGH.
   * Captura exfiltração via múltiplos dados MEDIUM (ex: 4+ valores financeiros).
   */
  BLOCK: 60,
  /**
   * Score >= SANITIZE: dados mascarados, requisição prossegue para a IA.
   */
  SANITIZE: 1,
} as const;

// ─── Regras DLP ───────────────────────────────────────────────────────────────

/**
 * Regras declaradas como constante imutável para evitar adulteração em runtime.
 * ORDEM IMPORTA: regras mais específicas devem vir antes das mais genéricas
 * para evitar double-masking e falsos negativos.
 */
export const DLP_RULES: readonly DlpRule[] = [

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO 1: IDENTIFICADORES PESSOAIS (PII) — Severidade HIGH
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'CPF',
    description: 'CPF — Cadastro de Pessoa Física',
    // Formatos: 000.000.000-00 | 00000000000
    pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
    placeholder: '[CPF_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'CNPJ',
    description: 'CNPJ — Cadastro Nacional de Pessoa Jurídica',
    // Formatos: 00.000.000/0000-00 | 00000000000000
    pattern: /\b\d{2}\.?\d{3}\.?\d{3}\/?0001-?\d{2}\b/g,
    placeholder: '[CNPJ_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'RG',
    description: 'RG — Registro Geral (documento de identidade)',
    pattern: /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]\b/g,
    placeholder: '[RG_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'PIS_PASEP',
    description: 'PIS/PASEP — Programa de Integração Social / Servidor Público',
    // Formato: 000.00000.00-0 (11 dígitos com pontos e hífen opcionais)
    pattern: /\b\d{3}\.?\d{5}\.?\d{2}-?\d{1}\b/g,
    placeholder: '[PIS_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'CTPS',
    description: 'CTPS — Carteira de Trabalho e Previdência Social',
    // Formatos: "CTPS: 1234567-0" | "carteira de trabalho: 12345678"
    pattern: /\bCTPS\s*(?:n[°º]?\.?\s*|n[uú]mero\s*:?\s*)?\d{7,8}\b|\bcarteira\s*de\s*trabalho\s*:?\s*\d{6,8}\b/gi,
    placeholder: '[CTPS_CONFIDENCIAL]',
    severity: 'HIGH',
  },

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO 2: MATRÍCULAS DE FUNCIONÁRIOS PETROBRAS — Severidade HIGH
  // Pluralidade de formatos internos exige múltiplas regras.
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'PETROBRAS_BADGE',
    description: 'Matrícula Petrobras formato petro-XXXX / PBR-XXXX',
    // Formatos: petro-1234 | PETRO-12345 | PBR-1234 | petro1234
    pattern: /\bpetro-?\d{4,6}\b|\bPBR-?\d{4,6}\b/gi,
    placeholder: '[MATRÍCULA_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'EMPLOYEE_BADGE',
    description: 'Matrícula Petrobras formato F-XXXXXXXX / matrícula: XXXXXX',
    // Formatos: F-0123456 | f0123456 | matrícula: 123456
    pattern: /\b[Ff]-?\d{5,8}\b|\bmatr[íi]cula\s*:?\s*\d{5,8}\b/gi,
    placeholder: '[MATRÍCULA_CONFIDENCIAL]',
    severity: 'HIGH',
  },

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO 3: DADOS DE RECURSOS HUMANOS — Severidade HIGH
  // Foco: consultas que expõem identidade e remuneração de funcionários.
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'SALARY_LIST_QUERY',
    description: 'Consulta de lista/folha de salários (exfiltração em massa de RH)',
    // Captura intenções de extração em bulk: "lista de salários", "folha de pagamento"
    // Qualquer prompt com esses termos representa risco CRÍTICO de exfiltração de RH.
    pattern: /\b(lista\s*de\s*sal[aá]rios?|folha\s*de\s*pagamento|planilha\s*(salarial|de\s*remunera[cç][aã]o)|tabela\s*(salarial|de\s*sal[aá]rios?)|rela[cç][aã]o\s*de\s*funcion[aá]rios?|quadro\s*de\s*pessoal|holerites?\s*de|contracheques?\s*de)\b/gi,
    placeholder: '[CONSULTA_RH_BLOQUEADA]',
    severity: 'HIGH',
  },
  {
    id: 'SALARY_MENTION',
    description: 'Menção a salário/remuneração com valor monetário explícito',
    // Captura: "salário: R$ 5.000" | "remuneração bruta: 8.000" | "vencimento mensal R$3.500"
    // NÃO captura: "aumento de salário" | "salário mínimo de X" (gap de palavras quebra o padrão)
    pattern: /\b(sal[aá]rio|remunera[cç][aã]o|vencimento|provento|pagamento)\s*(bruto|l[íi]quido|base|mensal|anual|total)?\s*:?\s*(R\$\s*)?\d[\d.,]*/gi,
    placeholder: '[SALÁRIO_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'FULL_NAME_HR',
    description: 'Nome completo em contexto de RH (nome do funcionário explicitado)',
    // Captura: "nome completo: João da Silva" | "colaborador: Maria Oliveira Santos"
    // DIFERENTE de EMPLOYEE_NAME: exige o prefixo de contexto para reduzir falsos positivos
    pattern: /\b(nome\s*(?:completo|do\s*(?:funcion[aá]rio|colaborador|empregado))|colaborador|funcion[aá]rio|empregado)\s*:?\s*([A-ZÀ-Ú][a-zà-ú]{1,}(?:\s+(?:d[aeo]\s+)?[A-ZÀ-Ú][a-zà-ú]{1,}){1,4})\b/gi,
    placeholder: '[NOME_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'EMPLOYEE_NAME',
    description: 'Nome de funcionário com prefixo de referência funcional',
    // Captura: "funcionário João Silva" | "matrícula 12345 - Maria"
    pattern: /\b(funcion[aá]rio|colaborador|matr[íi]cula|empregado)\s+[A-ZÀ-Ú][a-zà-ú]+(\s+[A-ZÀ-Ú][a-zà-ú]+){1,3}\b/gi,
    placeholder: '[COLABORADOR_ANÔNIMO]',
    severity: 'HIGH',
  },

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO 4: DADOS DE LOCALIZAÇÃO — Severidade HIGH
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'GPS_COORDINATE',
    description: 'Coordenadas GPS decimais (latitude/longitude)',
    pattern: /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g,
    placeholder: '[COORDENADA_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'GPS_DMS',
    description: 'Coordenadas GPS graus-minutos-segundos',
    // Formato: 23°33'01.9"S 46°38'00"W
    pattern: /\d{1,3}°\d{1,2}'\d{1,2}(\.\d+)?"\s*[NSns]\s*\d{1,3}°\d{1,2}'\d{1,2}(\.\d+)?"\s*[EWew]/g,
    placeholder: '[COORDENADA_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'OFFSHORE_BLOCK',
    description: 'Bloco exploratório offshore Petrobras',
    // Formato: BM-S-11, BM-C-33 (Bacia de Santos, Campos)
    pattern: /\bBM-[A-Z]-\d{1,3}\b/gi,
    placeholder: '[BLOCO_CONFIDENCIAL]',
    severity: 'HIGH',
  },

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO 5: DADOS DE INFRAESTRUTURA — Severidade HIGH
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'IP_ADDRESS_PRIVATE',
    description: 'Endereço IP de rede interna',
    // Faixas: 10.x.x.x | 172.16-31.x.x | 192.168.x.x
    pattern: /\b(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
    placeholder: '[IP_INTERNO_CONFIDENCIAL]',
    severity: 'HIGH',
  },
  {
    id: 'WELL_IDENTIFIER',
    description: 'Identificador de poço petrolífero (ANSI/API)',
    // Formato: 1-RJS-628-RJ | 3-BRSA-1234-RJS
    pattern: /\b\d-[A-Z]{2,4}-\d{1,4}-[A-Z]{2,3}\b/g,
    placeholder: '[POÇO_CONFIDENCIAL]',
    severity: 'HIGH',
  },

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO 6: DADOS FINANCEIROS — Severidade MEDIUM
  // Valores monetários isolados são mascarados mas não bloqueiam.
  // O bloqueio ocorre via Score de Risco quando combinados com PII.
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'CURRENCY_BRL',
    description: 'Valor monetário em Reais (BRL)',
    // Captura: R$ 1.000.000,00 | R$1000000
    pattern: /R\$\s?\d{1,3}(\.\d{3})*(,\d{2})?/g,
    placeholder: '[VALOR_CONFIDENCIAL]',
    severity: 'MEDIUM',
  },
  {
    id: 'CURRENCY_USD',
    description: 'Valor monetário em Dólares (USD)',
    pattern: /\$\s?\d{1,3}(,\d{3})*(\.\d{2})?|\bUSD\s?\d+(\.\d+)?\b/g,
    placeholder: '[VALOR_CONFIDENCIAL]',
    severity: 'MEDIUM',
  },
  {
    id: 'FINANCIAL_CONTRACT',
    description: 'Número de contrato financeiro interno',
    // Formato: CTR-2024-00001 | CONT/2024/12345
    pattern: /\b(CTR|CONT|CONTRACT)-?\/?2\d{3}-?\/?0*\d{4,6}\b/gi,
    placeholder: '[CONTRATO_CONFIDENCIAL]',
    severity: 'MEDIUM',
  },

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO 7: DADOS DE COMUNICAÇÃO — Severidade MEDIUM / LOW
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'EMAIL_CORPORATE',
    description: 'E-mail corporativo Petrobras / IBAMA / ANP',
    pattern: /\b[A-Za-z0-9._%+-]+@(petrobras\.com\.br|ibama\.gov\.br|anp\.gov\.br)\b/gi,
    placeholder: '[EMAIL_CONFIDENCIAL]',
    severity: 'MEDIUM',
  },
  {
    id: 'PHONE_BR',
    description: 'Número de telefone brasileiro',
    // Formatos: (21) 99999-9999 | +55 21 99999-9999 | 2199999999
    pattern: /(\+55\s?)?\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/g,
    placeholder: '[TELEFONE_CONFIDENCIAL]',
    severity: 'LOW',
  },
] as const;

// ─── Bônus por Combinações Perigosas ─────────────────────────────────────────

/**
 * Combinações de regras que indicam intenção de exfiltração de dados de RH.
 * Cada combinação detectada adiciona pontos extras ao score de risco,
 * podendo elevar ao limiar de bloqueio mesmo sem regras de severidade HIGH.
 *
 * FUNDAMENTO (LGPD Art. 5°, I): O tratamento combinado de dados pessoais
 * (nome + salário + matrícula) é mais sensível do que cada dado isolado.
 */
const COMBINATION_BONUSES: ReadonlyArray<{
  rules: readonly string[];
  bonus: number;
  factor: string;
}> = [
  {
    rules: ['EMPLOYEE_NAME', 'CURRENCY_BRL'],
    bonus: 25,
    factor: 'Combinação: Nome de funcionário + valor monetário (possível consulta de salário)',
  },
  {
    rules: ['FULL_NAME_HR', 'CURRENCY_BRL'],
    bonus: 30,
    factor: 'Combinação crítica: Nome em contexto RH + valor monetário',
  },
  {
    rules: ['EMPLOYEE_BADGE', 'SALARY_MENTION'],
    bonus: 35,
    factor: 'Combinação crítica: Matrícula + menção a salário (exfiltração de remuneração)',
  },
  {
    rules: ['PETROBRAS_BADGE', 'SALARY_MENTION'],
    bonus: 35,
    factor: 'Combinação crítica: Matrícula Petrobras + salário (exfiltração de remuneração)',
  },
  {
    rules: ['CPF', 'FULL_NAME_HR'],
    bonus: 35,
    factor: 'Combinação crítica: CPF + nome completo (cadastro pessoal completo)',
  },
  {
    rules: ['CPF', 'EMPLOYEE_NAME'],
    bonus: 30,
    factor: 'Combinação crítica: CPF + referência nominal a funcionário',
  },
  {
    rules: ['PETROBRAS_BADGE', 'CURRENCY_BRL'],
    bonus: 30,
    factor: 'Combinação: Matrícula Petrobras + valor financeiro',
  },
  {
    rules: ['EMPLOYEE_BADGE', 'CURRENCY_BRL'],
    bonus: 25,
    factor: 'Combinação: Matrícula + valor financeiro',
  },
  {
    rules: ['PIS_PASEP', 'EMPLOYEE_NAME'],
    bonus: 40,
    factor: 'Combinação CRÍTICA: PIS/PASEP + nome (identificação fiscal completa)',
  },
] as const;

// ─── Pesos por Severidade ─────────────────────────────────────────────────────

const SEVERITY_POINTS: Record<DlpRule['severity'], number> = {
  HIGH:   30,
  MEDIUM: 15,
  LOW:     5,
};

// ─── Keywords Sensíveis ───────────────────────────────────────────────────────

/**
 * Palavras-chave que, sem acionar regras regex, indicam contexto de risco elevado.
 * Usadas exclusivamente em logs de auditoria e boost do score de risco.
 * Cada keyword adiciona +5 ao score (captura intenções não estruturadas).
 */
export const SENSITIVE_KEYWORDS: readonly string[] = [
  // Classificação de informação
  'confidencial',
  'secreto',
  'restrito',
  'classificado',
  'sigiloso',

  // Recursos humanos e folha de pagamento
  'folha de pagamento',
  'holerite',
  'contracheque',
  'quadro de pessoal',
  'lista de funcionários',
  'lista de salários',
  'remuneração total',
  'benefícios salariais',
  'plano de carreira',

  // Operações de petróleo (dados estratégicos)
  'pré-sal',
  'reservatório',
  'reserva provada',
  'plano de produção',
  'bid round',
  'licitação',
  'concorrência',
  'proposta técnica',

  // LGPD
  'dados pessoais',
  'dados sensíveis',
] as const;

/** Pontos adicionados ao score por keyword sensível encontrada */
const KEYWORD_SCORE_BONUS = 5;

// ─── Função: Score de Risco ───────────────────────────────────────────────────

/**
 * Calcula o Score de Risco de um conjunto de regras acionadas.
 *
 * ALGORITMO:
 * 1. Soma os pontos de severidade de cada regra acionada
 * 2. Aplica bônus por combinações perigosas (pares de regras correlacionadas)
 * 3. Aplica bônus por keywords sensíveis detectadas
 * 4. Normaliza o score no intervalo [0, 100]
 * 5. Determina o nível e a decisão de roteamento
 *
 * @param triggeredRuleIds - IDs das regras DLP que foram acionadas
 * @param sensitiveKeywords - Keywords sensíveis detectadas no texto
 */
export function calculateRiskScore(
  triggeredRuleIds: string[],
  sensitiveKeywords: string[] = []
): RiskScore {
  const factors: string[] = [];
  let rawScore = 0;

  // ── Passo 1: Pontos individuais por severidade ──
  for (const ruleId of triggeredRuleIds) {
    const rule = DLP_RULES.find((r) => r.id === ruleId);
    if (!rule) continue;

    const points = SEVERITY_POINTS[rule.severity];
    rawScore += points;
    factors.push(
      `Regra ${ruleId} (${rule.severity}: +${points}pts) — ${rule.description}`
    );
  }

  // ── Passo 2: Bônus por combinações perigosas ──
  for (const combo of COMBINATION_BONUSES) {
    const allPresent = combo.rules.every((r) => triggeredRuleIds.includes(r));
    if (allPresent) {
      rawScore += combo.bonus;
      factors.push(`⚠ Combinação detectada (+${combo.bonus}pts): ${combo.factor}`);
    }
  }

  // ── Passo 3: Bônus por keywords sensíveis ──
  for (const kw of sensitiveKeywords) {
    rawScore += KEYWORD_SCORE_BONUS;
    factors.push(`Keyword sensível (+${KEYWORD_SCORE_BONUS}pts): "${kw}"`);
  }

  // ── Passo 4: Normalização [0, 100] ──
  const score = Math.min(rawScore, 100);

  // ── Passo 5: Nível e decisão ──
  const highSeverityCount = triggeredRuleIds.filter((id) => {
    const rule = DLP_RULES.find((r) => r.id === id);
    return rule?.severity === 'HIGH';
  }).length;

  const level = resolveRiskLevel(score);
  const decision = resolveRiskDecision(score, highSeverityCount > 0);

  return {
    score,
    level,
    decision,
    matchCount: triggeredRuleIds.length,
    highSeverityCount,
    factors,
  };
}

function resolveRiskLevel(score: number): RiskLevel {
  if (score === 0)  return 'NONE';
  if (score < 30)   return 'LOW';
  if (score < 60)   return 'MEDIUM';
  if (score < 90)   return 'HIGH';
  return 'CRITICAL';
}

function resolveRiskDecision(score: number, hasHighSeverity: boolean): RiskDecision {
  // Qualquer regra HIGH individual → BLOCK imediato (independente do score)
  if (hasHighSeverity) return 'BLOCK';
  // Score composto elevado → BLOCK (múltiplos dados MEDIUM juntos)
  if (score >= RISK_SCORE_THRESHOLDS.BLOCK) return 'BLOCK';
  // Algum dado sensível, mas não crítico → SANITIZE
  if (score >= RISK_SCORE_THRESHOLDS.SANITIZE) return 'SANITIZE';
  return 'ALLOW';
}

// ─── Scanner Principal ────────────────────────────────────────────────────────

/**
 * Executa a varredura DLP completa em um texto.
 *
 * FLUXO:
 * 1. Aplica todas as regras DLP sequencialmente (sem short-circuit)
 * 2. Substitui cada match pelo placeholder configurado
 * 3. Calcula o Score de Risco com bônus de combinações
 * 4. Retorna texto sanitizado + metadados completos de auditoria
 *
 * @param text - Texto bruto a ser varrido
 */
export function scanAndSanitize(text: string): DlpScanResult {
  const triggeredRules: string[] = [];
  let sanitizedText = text;

  // Aplica cada regra — ordem importa: mais específicas primeiro
  for (const rule of DLP_RULES) {
    // Resetar lastIndex antes de test() e replace() com flag 'g'/'gi'
    rule.pattern.lastIndex = 0;

    if (rule.pattern.test(sanitizedText)) {
      triggeredRules.push(rule.id);
      rule.pattern.lastIndex = 0;
      sanitizedText = sanitizedText.replace(rule.pattern, rule.placeholder);
    }
  }

  const sensitiveKeywords = detectSensitiveKeywords(text);
  const riskScore = calculateRiskScore(triggeredRules, sensitiveKeywords);
  const hasHighSeverityMatch = riskScore.highSeverityCount > 0;

  return {
    originalText: text,
    sanitizedText,
    triggeredRules,
    hasHighSeverityMatch,
    riskScore,
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Detecta keywords sensíveis para fins de auditoria e boost do score.
 * Não modifica o texto — apenas sinaliza presença de termos de risco.
 *
 * @param text - Texto a ser analisado
 */
export function detectSensitiveKeywords(text: string): string[] {
  const lowerText = text.toLowerCase();
  return SENSITIVE_KEYWORDS.filter((kw) => lowerText.includes(kw.toLowerCase()));
}
