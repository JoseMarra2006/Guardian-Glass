/**
 * @file groqService.ts
 * @description Serviço de chat com IA usando a API do Groq.
 * Cada sessão é mantida apenas em memória — nenhum histórico é salvo.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `Você é o PetroGate IA, assistente especializado da Petrobras.

Você possui profundo conhecimento sobre:
- Petrobras: história, estrutura organizacional, valores, missão e visão
- Operações de exploração e produção de petróleo e gás (E&P)
- Refino, transporte e comercialização de derivados
- Plataformas offshore (FPSO, semi-submersíveis, fixas)
- Normas de segurança: NR-10, NR-33, NR-35, OSHA, ISO 45001
- Procedimentos operacionais padrão (POPs), permissão de trabalho (PT)
- Meio ambiente e sustentabilidade no setor de óleo e gás
- Legislação brasileira do setor (ANP, IBAMA, CONAMA)
- Programas internos da Petrobras: PEGASO, SIRI, SMS
- Terminologia técnica em português e inglês do setor

Você pode responder perguntas sobre qualquer assunto, mas sempre prioriza e aprofunda temas relacionados à Petrobras e ao setor de óleo e gás.

Responda sempre em português brasileiro, de forma clara, objetiva e técnica quando aplicável.
Nunca solicite, armazene ou processe dados pessoais de funcionários.`;

/**
 * Envia uma mensagem para o Groq e retorna a resposta.
 * O histórico é passado como parâmetro para manter o contexto da conversa.
 */
export async function sendGroqMessage(
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY;

  if (!apiKey) {
    throw new Error('GROQ_API_KEY não configurada. Adicione EXPO_PUBLIC_GROQ_API_KEY no .env');
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.6,
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API erro ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Resposta vazia da Groq API.');
  }

  return content;
}
