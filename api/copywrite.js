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
Tom: direto, editorial, premium. Nunca corporativo engessado. Nunca genérico.
Sem hashtags. Sem emojis.
Escreva em português brasileiro formal-moderno.

TAREFA: Escreva APENAS a legenda para LINKEDIN.
- Mais longa e elaborada. Entre 600 e 1300 caracteres.
- OBRIGATÓRIO: abra com as empresas anteriores do histórico — cite as últimas 3 pelo nome em uma frase de abertura forte.
- Depois apresente o novo cargo e empresa.
- Adicione um parágrafo de reflexão ou insight editorial sobre o que essa trajetória representa.
- Encerre com parabéns e www.redelideres.com na última linha.

EXEMPLOS:
INPUT: Líder: Glauco Sampaio | Cargo atual: CEO | Empresas anteriores (histórico): Santander, Banco Votorantim, Cielo | Contexto: Parabenização por nova posição: CEO na BeePhish
SAÍDA: Uma carreira construída em grandes instituições — Santander, Banco Votorantim e Cielo — agora abre um novo capítulo.\\n\\nGlauco Sampaio assume como CEO da BeePhish, levando para o empreendedorismo em cibersegurança toda a visão acumulada em anos de mercado financeiro.\\n\\nEssa movimentação reforça um padrão que vemos com frequência na Rede Líderes: líderes forjados em ambientes de alta exigência tendem a criar as empresas mais relevantes do próximo ciclo.\\n\\nParabéns, Glauco.\\n\\nwww.redelideres.com

INPUT: Líder: Ana Carvalho | Cargo atual: Diretora de Operações | Empresas anteriores (histórico): Ambev, Unilever, P&G | Contexto: Parabenização por nova posição: Diretora de Operações na Nestlé
SAÍDA: P&G, Unilever e Ambev — uma trajetória construída nas maiores operações do mundo.\\n\\nAgora, Ana Carvalho assume como Diretora de Operações na Nestlé, levando consigo um histórico que poucos líderes no Brasil podem apresentar.\\n\\nEsse movimento reforça o que vemos com frequência na Rede Líderes: líderes com trajetória sólida em grandes organizações são disputados pelos melhores ambientes.\\n\\nParabéns, Ana.\\n\\nwww.redelideres.com

AGORA GERE PARA:
${lines}

Retorne APENAS o texto puro da legenda, sem JSON, sem aspas, sem markdown.`;
}

async function callGemini(prompt) {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      contents:         [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 800, temperature: 0.75 }
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

    console.log('[copywrite] ok — tipo:', tipo, l ? `| líder: ${l.name}` : '');
    res.json({ instagram, linkedin });

  } catch (err) {
    console.error('[copywrite] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
};
