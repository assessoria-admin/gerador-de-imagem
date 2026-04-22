// Vercel Serverless Function — POST /api/copywrite
// Gera legendas para Instagram e LinkedIn na voz editorial da Rede Líderes

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent';

const TIPOS_VALIDOS = ['imagem-perfil', 'carrossel-artigo', 'parabenizacao', 'mudanca-cargo', 'livre'];

function buildPrompt(tipo, lider, contexto, avoid) {
  const persona = `Você é o redator editorial da Rede Líderes — uma comunidade premium B2B de líderes empresariais do Brasil.
Seu tom é direto, editorial e premium. Nunca corporativo engessado. Nunca genérico.
Nunca use hashtags. Nunca use emojis excessivos (máximo 0, prefira zero).
Escreva sempre em português brasileiro formal-moderno.
Instagram: curto-médio, CTA editorial tipográfico, máximo 600 caracteres.
LinkedIn: insight ou dado primeiro, convite à reflexão no final, máximo 1300 caracteres.`;

  const exemplos = `EXEMPLO 1:
INPUT: Líder: Glauco Sampaio | Cargo: CEO | Empresas: BeePhish, Santander, Banco Votorantim, Cielo | Contexto: Trajetória em cibersegurança, cofundador e CEO da BeePhish
RESPOSTA JSON: {"instagram":"Com uma ampla carreira em grandes empresas como Santander, Banco Votorantim e Cielo, hoje Glauco Sampaio, líder de cibersegurança, é cofundador e CEO da BeePhish, empresa com foco em minimizar o risco humano dentro de negócios de todos os portes.\\n\\nConheça um pouco da sua trajetória e as novidades que estão por vir.","linkedin":"Com uma ampla carreira em grandes empresas como Santander, Banco Votorantim e Cielo, hoje Glauco Sampaio, líder de cibersegurança, é cofundador e CEO da BeePhish, empresa com foco em minimizar o risco humano dentro de negócios de todos os portes.\\n\\nConheça um pouco da sua trajetória e as novidades que estão por vir."}

EXEMPLO 2:
INPUT: Líder: Marli Matos | Cargo: Líder de Finanças | Contexto: Lançamento de livro autoral pela Editora da Rede Líderes
RESPOSTA JSON: {"instagram":"Temos mais um lançamento em nossa Editora. Parabéns, Marli Matos!\\n\\nA Marli é líder de finanças e agora terá sua trajetória posicionada para todo o mercado.","linkedin":"Temos mais um lançamento em nossa Editora. Parabéns, Marli Matos!\\n\\nA Marli é líder de finanças e agora terá sua trajetória posicionada para todo o mercado.\\n\\nDesta vez, com um livro totalmente autoral pela Editora da Rede Líderes. Não é um capítulo. É um livro inteiro dedicado a uma única líder.\\n\\nSua carreira, suas decisões reais, sua visão estratégica sobre o papel de finanças nas organizações e como a tecnologia e vendas podem mudar essa área. O tipo de conteúdo que só quem viveu consegue compartilhar.\\n\\nEm breve, mais detalhes sobre a data de lançamento.\\n\\nwww.redelideres.com"}

EXEMPLO 3:
INPUT: Contexto: Reunião do Conselho sobre gestão de pessoas, premiação Líder Destaque do Ano
RESPOSTA JSON: {"instagram":"Reunimos diversas lideranças em mais uma Reunião de Conselho.\\n\\nO encontro foi dedicado à análise de movimentos que vêm redesenhando a gestão de pessoas nas organizações.","linkedin":"Reunimos diversas lideranças em mais uma Reunião de Conselho.\\n\\nO encontro foi dedicado à análise de movimentos que vêm redesenhando a gestão de pessoas nas organizações.\\n\\nAo reunir diferentes perspectivas em um mesmo espaço de reflexão, ampliamos a leitura sobre os desafios e oportunidades que atravessam as empresas e as carreiras.\\n\\nEncerramos o encontro com a premiação de Líder Destaque do Ano, reconhecendo algumas das lideranças de RH."}`;

  const liderLine = lider
    ? `Líder: ${lider.name}${lider.cargo ? ` | Cargo: ${lider.cargo}` : ''}${lider.empresas ? ` | Empresas: ${lider.empresas}` : ''}`
    : null;

  const requestLines = [
    `Tipo: ${tipo}`,
    liderLine,
    `Contexto: ${contexto}`,
    avoid ? `Evite repetir: ${avoid}` : null
  ].filter(Boolean).join('\n');

  return `${persona}

${exemplos}

AGORA GERE PARA:
${requestLines}

Retorne APENAS o JSON, sem markdown, sem explicações: {"instagram":"...","linkedin":"..."}`;
}

function extractJSON(raw) {
  // Strip markdown code fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // Find first { ... } block
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta do Gemini não contém JSON válido.');
  return JSON.parse(match[0]);
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

  const prompt = buildPrompt(tipo, lider || null, contexto.trim(), avoid || null);

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
      })
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      const msg = data?.error?.message || geminiRes.statusText;
      console.error('[copywrite] erro Gemini:', msg);
      return res.status(500).json({ message: `Erro do Gemini: ${msg}` });
    }

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const result = extractJSON(raw);

    if (!result.instagram || !result.linkedin) {
      throw new Error('JSON retornado pelo Gemini está incompleto.');
    }

    console.log('[copywrite] ok — tipo:', tipo, lider ? `| líder: ${lider.name}` : '');
    res.json({ instagram: result.instagram, linkedin: result.linkedin });

  } catch (err) {
    console.error('[copywrite] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
};
