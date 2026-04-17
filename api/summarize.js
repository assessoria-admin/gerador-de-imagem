// Vercel Serverless Function — POST /api/summarize
// Usa Gemini Flash (gratuito) para condensar artigo em 3 blocos para slides

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (!GEMINI_KEY) return res.status(500).json({ message: 'GEMINI_API_KEY não configurada.' });

  const { article, title } = req.body || {};
  if (!article) return res.status(400).json({ message: 'Campo article obrigatório.' });

  const prompt = `Você é um editor de conteúdo para Instagram da Rede Líderes, uma rede de executivos do Brasil.

Recebeu o seguinte artigo${title ? ` com o tema "${title}"` : ''}:

---
${article}
---

Sua tarefa é criar EXATAMENTE 3 blocos de texto para slides de carrossel do Instagram. Cada bloco deve:
- Ter entre 3 e 5 frases curtas e diretas
- Capturar uma ideia central diferente do artigo
- Ser escrito em linguagem executiva, clara e impactante
- Preservar as ideias mais relevantes do original
- NÃO usar bullet points, numeração ou títulos — apenas parágrafos corridos

Responda APENAS com os 3 blocos separados por uma linha em branco, sem introdução, sem explicação, sem numeração. Formato exato:

[bloco 1]

[bloco 2]

[bloco 3]`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.4 }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || response.statusText);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parts = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).slice(0, 3);
    if (parts.length < 3) throw new Error('Gemini não retornou 3 blocos. Tente novamente.');

    return res.status(200).json({ parts });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
