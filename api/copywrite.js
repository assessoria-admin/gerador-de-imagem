// Vercel Serverless Function — POST /api/copywrite
// Gera legendas para Instagram e LinkedIn na voz editorial da Rede Líderes

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent';

const TIPOS_VALIDOS = ['imagem-perfil', 'carrossel-artigo', 'parabenizacao', 'mudanca-cargo', 'livre'];

function buildLiderLine(lider) {
  if (!lider) return null;
  return `Líder: ${lider.name}${lider.cargo ? ` | Cargo atual: ${lider.cargo}` : ''}${lider.empresas ? ` | Empresas anteriores (histórico): ${lider.empresas}` : ''}`;
}

function buildPromptInstagram(tipo, lider, contexto, avoid) {
  const liderLine = buildLiderLine(lider);
  const lines = [
    liderLine,
    `Contexto: ${contexto}`,
    avoid ? `Evite repetir: ${avoid}` : null
  ].filter(Boolean).join('\n');

  return `Você é o redator editorial da Rede Líderes — comunidade premium B2B de líderes empresariais do Brasil.
Tom: direto, editorial, premium. Nunca corporativo engessado. Nunca genérico.
Sem hashtags. Sem emojis.
Escreva em português brasileiro formal-moderno.

TAREFA: Escreva APENAS a legenda para INSTAGRAM.
- Curto, impacto imediato, máximo 600 caracteres.
- Mencione o nome do líder, o novo cargo e a empresa.
- Mencione as empresas anteriores do histórico (se houver) em uma frase de contextualização rápida.
- CTA editorial direto no final.

EXEMPLOS:
INPUT: Líder: Glauco Sampaio | Cargo atual: CEO | Empresas anteriores (histórico): Santander, Banco Votorantim, Cielo | Contexto: Parabenização por nova posição: CEO na BeePhish
SAÍDA: Com passagens por Santander, Banco Votorantim e Cielo, Glauco Sampaio assume como CEO da BeePhish — empresa com foco em minimizar o risco humano nas organizações.\\n\\nParabéns, Glauco. Nova etapa, mesmo nível de entrega.

INPUT: Líder: Ana Carvalho | Cargo atual: Diretora de Operações | Empresas anteriores (histórico): Ambev, Unilever, P&G | Contexto: Parabenização por nova posição: Diretora de Operações na Nestlé
SAÍDA: Passando por P&G, Unilever e Ambev, Ana Carvalho assume como Diretora de Operações na Nestlé.\\n\\nParabéns, Ana. Mais um passo numa trajetória que inspira.

AGORA GERE PARA:
${lines}

Retorne APENAS o texto puro da legenda, sem JSON, sem aspas, sem markdown.`;
}

function buildPromptLinkedIn(tipo, lider, contexto, avoid) {
  const liderLine = buildLiderLine(lider);
  const lines = [
    liderLine,
    `Contexto: ${contexto}`,
    avoid ? `Evite repetir: ${avoid}` : null
  ].filter(Boolean).join('\n');

  return `Você é o redator editorial da Rede Líderes — comunidade premium B2B de líderes empresariais do Brasil.
Tom: direto, editorial, caloroso. Sem hashtags. Sem emojis. Português brasileiro formal-moderno.

TAREFA: Legenda de parabenização para LINKEDIN. LIMITE ABSOLUTO: 800 caracteres (incluindo espaços e quebras de linha). Não ultrapasse.

ESTRUTURA (3 parágrafos curtos + URL):
1. Mencione o histórico de empresas anteriores em uma frase de impacto.
2. Apresente o novo cargo e empresa. Parabenize pelo nome.
3. Uma frase editorial sobre o que essa trajetória representa.
Última linha: www.redelideres.com

EXEMPLO:
INPUT: Líder: Glauco Sampaio | Cargo atual: CEO | Empresas anteriores: Santander, Banco Votorantim, Cielo | Contexto: Parabenização por nova posição: CEO na BeePhish
SAÍDA: Santander, Banco Votorantim e Cielo — uma trajetória construída nas maiores instituições financeiras do país.\\n\\nGlauco Sampaio assume como CEO da BeePhish, empresa focada em reduzir o risco humano nas organizações. Parabéns, Glauco.\\n\\nLíderes forjados em ambientes de alta exigência chegam ao empreendedorismo com visão que poucos têm.\\n\\nwww.redelideres.com

AGORA GERE PARA:
${lines}

Retorne APENAS o texto puro, sem JSON, sem aspas, sem markdown. Máximo 800 caracteres.`;
}

async function callGemini(prompt) {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      contents:         [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 600, temperature: 0.75 }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || res.statusText);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido.' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ message: 'GEMINI_API_KEY não configurada no servidor.' });
  }

  const { tipo, lider, contexto, avoid } = req.body || {};

  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({
      message: `Campo "tipo" inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.`
    });
  }

  if (!contexto || typeof contexto !== 'string' || !contexto.trim()) {
    return res.status(400).json({ message: 'Campo "contexto" é obrigatório.' });
  }

  const l = lider || null;
  const c = contexto.trim();
  const a = avoid || null;

  try {
    const [instagram, linkedin] = await Promise.all([
      callGemini(buildPromptInstagram(tipo, l, c, a)),
      callGemini(buildPromptLinkedIn(tipo, l, c, a)),
    ]);

    if (!instagram || !linkedin) {
      throw new Error('Resposta vazia do Gemini.');
    }

    const linkedinTruncado = linkedin.length > 800
      ? linkedin.slice(0, 800).replace(/\s+\S*$/, '') + '\n\nwww.redelideres.com'
      : linkedin;

    console.log('[copywrite] ok — tipo:', tipo, l ? `| líder: ${l.name}` : '');
    res.json({ instagram, linkedin: linkedinTruncado });

  } catch (err) {
    console.error('[copywrite] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
};
