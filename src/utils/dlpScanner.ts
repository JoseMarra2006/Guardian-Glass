/**
 * @file dlpScanner.ts
 * @description Data Loss Prevention (DLP) Scanner para o PetroGate AR
 *
 * ARQUITETURA ZERO TRUST:
 * No modelo Zero Trust, nenhum dado é considerado seguro por padrão.
 * Este módulo implementa o princípio "never trust, always verify & sanitize":
 * - Todo prompt do usuário é tratado como potencialmente contendo dados sensíveis
 * - A sanitização ocorre ANTES de qualquer transmissão externa
 * - Cada padrão identificado é substituído por um placeholder auditável
 *
 * CONFORMIDADE: LGPD (Lei 13.709/2018), ISO/IEC 27001, NIST SP 800-188
 */

// ─── Interfaces ─────────────────────────────────────────────────────────────

/**
 * Representa um padrão de dado sensível detectável pelo scanner.
 * Cada regra encapsula o tipo de PII/dado restrito e sua regex de detecção.
 */
export interface DlpRule {
  /** Identificador único da regra (ex: "CPF", "GPS_COORDINATE") */
  id: string;
  /** Descrição humana do tipo de dado protegido */
  description: string;
  /** Expressão regular para detecção do padrão sensível */
  pattern: RegExp;
  /** Placeholder substituto que será inserido no texto sanitizado */
  placeholder: string;
  /** Nível de criticidade: HIGH impede envio, MEDIUM/LOW apenas mascara */
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Resultado retornado após a varredura DLP de um texto.
 */
export interface DlpScanResult {
  /** Texto original, sem modificações */
  originalText: string;
  /** Texto com todos os dados sensíveis substituídos por placeholders */
  sanitizedText: string;
  /** Lista de IDs das regras que foram acionadas durante a varredura */
  triggeredRules: string[];
  /** Indica se alguma regra de severidade HIGH foi acionada */
  hasHighSeverityMatch: boolean;
  /** Timestamp ISO 8601 da varredura */
  scannedAt: string;
}

// ─── Regras DLP ──────────────────────────────────────────────────────────────

/**
 * Conjunto de regras DLP calibradas para o contexto da Petrobras.
 *
 * DECISÃO DE DESIGN:
 * As regras são declaradas como constante imutável (readonly) para evitar
 * adulteração em runtime — um vetor de ataque comum em supply chain attacks.
 */
export const DLP_RULES: readonly DlpRule[] = [
  // ── Identificadores Pessoais (PII) ──
  {
    id: 'CPF',
    description: 'Cadastro de Pessoa Física brasileiro',
    // Aceita formatos: 000.000.000-00 e 00000000000
    pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
    placeholder: '[CPF_RESTRITO]',
    severity: 'HIGH',
  },
  {
    id: 'CNPJ',
    description: 'Cadastro Nacional de Pessoa Jurídica',
    // Aceita formatos: 00.000.000/0000-00 e 00000000000000
    pattern: /\b\d{2}\.?\d{3}\.?\d{3}\/?0001-?\d{2}\b/g,
    placeholder: '[CNPJ_RESTRITO]',
    severity: 'HIGH',
  },
  {
    id: 'RG',
    description: 'Registro Geral (documento de identidade)',
    pattern: /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]\b/g,
    placeholder: '[RG_RESTRITO]',
    severity: 'HIGH',
  },
  {
    id: 'EMPLOYEE_NAME',
    description: 'Padrões de referência a nomes de funcionários',
    // Captura padrões como "funcionário João Silva" ou "matrícula 12345 - Maria"
    pattern: /\b(funcionário|colaborador|matrícula|empregado)\s+[A-ZÀ-Ú][a-zà-ú]+(\s+[A-ZÀ-Ú][a-zà-ú]+){1,3}\b/gi,
    placeholder: '[COLABORADOR_ANONIMO]',
    severity: 'HIGH',
  },
  {
    id: 'EMPLOYEE_BADGE',
    description: 'Número de matrícula de funcionário Petrobras',
    // Formato típico Petrobras: F-XXXXXXXX ou apenas sequência numérica de 8 dígitos
    pattern: /\b[Ff]-?\d{7,8}\b|\bmatrícula\s*:?\s*\d{6,8}\b/gi,
    placeholder: '[MATRICULA_RESTRITA]',
    severity: 'HIGH',
  },

  // ── Dados de Localização ──
  {
    id: 'GPS_COORDINATE',
    description: 'Coordenadas GPS precisas (latitude/longitude)',
    // Captura coordenadas decimais no formato -23.550520, -46.633309
    pattern: /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g,
    placeholder: '[GEO_ANONIMO]',
    severity: 'HIGH',
  },
  {
    id: 'GPS_DMS',
    description: 'Coordenadas GPS no formato graus-minutos-segundos',
    // Formato: 23°33'01.9"S 46°38'00"W
    pattern: /\d{1,3}°\d{1,2}'\d{1,2}(\.\d+)?"\s*[NSns]\s*\d{1,3}°\d{1,2}'\d{1,2}(\.\d+)?"\s*[EWew]/g,
    placeholder: '[GEO_ANONIMO]',
    severity: 'HIGH',
  },
  {
    id: 'OFFSHORE_BLOCK',
    description: 'Identificação de blocos exploratórios offshore',
    // Formato típico: BM-S-11, BM-C-33 (Bacia de Santos, Campos)
    pattern: /\bBM-[A-Z]-\d{1,3}\b/gi,
    placeholder: '[BLOCO_RESTRITO]',
    severity: 'HIGH',
  },

  // ── Dados Financeiros ──
  {
    id: 'CURRENCY_BRL',
    description: 'Valores monetários em Reais',
    // Captura: R$ 1.000.000,00 ou R$1000000
    pattern: /R\$\s?\d{1,3}(\.\d{3})*(,\d{2})?/g,
    placeholder: '[VALOR_RESTRITO]',
    severity: 'MEDIUM',
  },
  {
    id: 'CURRENCY_USD',
    description: 'Valores monetários em Dólares',
    pattern: /\$\s?\d{1,3}(,\d{3})*(\.\d{2})?|\bUSD\s?\d+(\.\d+)?\b/g,
    placeholder: '[VALOR_RESTRITO]',
    severity: 'MEDIUM',
  },
  {
    id: 'FINANCIAL_CONTRACT',
    description: 'Números de contratos financeiros internos',
    // Formato: CTR-2024-00001 ou CONT/2024/12345
    pattern: /\b(CTR|CONT|CONTRACT)-?\/?2\d{3}-?\/?0*\d{4,6}\b/gi,
    placeholder: '[CONTRATO_RESTRITO]',
    severity: 'MEDIUM',
  },

  // ── Dados de Infraestrutura ──
  {
    id: 'IP_ADDRESS_PRIVATE',
    description: 'Endereços IP de redes internas',
    // Faixas privadas: 10.x, 172.16-31.x, 192.168.x
    pattern: /\b(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
    placeholder: '[IP_INTERNO_RESTRITO]',
    severity: 'HIGH',
  },
  {
    id: 'WELL_IDENTIFIER',
    description: 'Identificadores de poços petrolíferos',
    // Formato ANSI/API: 1-RJS-628-RJ ou 3-BRSA-1234-RJS
    pattern: /\b\d-[A-Z]{2,4}-\d{1,4}-[A-Z]{2,3}\b/g,
    placeholder: '[POCO_RESTRITO]',
    severity: 'HIGH',
  },

  // ── Dados de Comunicação ──
  {
    id: 'EMAIL_CORPORATE',
    description: 'Endereços de e-mail corporativos',
    pattern: /\b[A-Za-z0-9._%+-]+@(petrobras\.com\.br|ibama\.gov\.br|anp\.gov\.br)\b/gi,
    placeholder: '[EMAIL_CORPORATIVO_RESTRITO]',
    severity: 'MEDIUM',
  },
  {
    id: 'PHONE_BR',
    description: 'Números de telefone brasileiros',
    // Formatos: (21) 99999-9999, +55 21 99999-9999, 2199999999
    pattern: /(\+55\s?)?\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/g,
    placeholder: '[TELEFONE_RESTRITO]',
    severity: 'LOW',
  },
] as const;

// ─── Keywords DLP ─────────────────────────────────────────────────────────────

/**
 * Palavras-chave que, quando presentes no contexto, elevam a atenção
 * do scanner para dados adjacentes.
 *
 * NOTA: Esta lista é usada para log de auditoria, não para bloqueio direto.
 * Permite identificar intenção de exfiltração mesmo sem padrões regex claros.
 */
export const SENSITIVE_KEYWORDS: readonly string[] = [
  'confidencial',
  'secreto',
  'restrito',
  'classificado',
  'pré-sal',
  'reservatório',
  'reserva provada',
  'plano de produção',
  'bid round',
  'licitação',
  'concorrência',
  'proposta técnica',
  'dados pessoais',
  'dados sensíveis',
] as const;

// ─── Scanner Principal ────────────────────────────────────────────────────────

/**
 * Executa a varredura DLP em um texto fornecido.
 *
 * FLUXO ZERO TRUST:
 * 1. Assume que o texto CONTÉM dados sensíveis (guilty until proven innocent)
 * 2. Aplica todas as regras sequencialmente — sem short-circuit
 * 3. Retorna o texto sanitizado + metadados de auditoria
 *
 * @param text - Texto bruto a ser varrido (ex: prompt do usuário)
 * @returns DlpScanResult com texto sanitizado e metadados de auditoria
 */
export function scanAndSanitize(text: string): DlpScanResult {
  const triggeredRules: string[] = [];
  let sanitizedText = text;

  // Aplica cada regra DLP — ordem importa para evitar falsos negativos
  for (const rule of DLP_RULES) {
    // Reseta o lastIndex antes de cada uso (segurança para flags 'g' e 'gi')
    rule.pattern.lastIndex = 0;

    if (rule.pattern.test(sanitizedText)) {
      triggeredRules.push(rule.id);
      // Reseta novamente antes do replace — test() avança o lastIndex
      rule.pattern.lastIndex = 0;
      sanitizedText = sanitizedText.replace(rule.pattern, rule.placeholder);
    }
  }

  const hasHighSeverityMatch = triggeredRules.some((ruleId) => {
    const rule = DLP_RULES.find((r) => r.id === ruleId);
    return rule?.severity === 'HIGH';
  });

  return {
    originalText: text,
    sanitizedText,
    triggeredRules,
    hasHighSeverityMatch,
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Detecta keywords sensíveis no texto para fins de auditoria.
 * Não modifica o texto — apenas sinaliza presença de termos de alto risco.
 *
 * @param text - Texto a ser analisado
 * @returns Array de keywords encontradas (pode ser vazio)
 */
export function detectSensitiveKeywords(text: string): string[] {
  const lowerText = text.toLowerCase();
  return SENSITIVE_KEYWORDS.filter((keyword) =>
    lowerText.includes(keyword.toLowerCase())
  );
}
