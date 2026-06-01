// Vercel Serverless Function — POST /api/summarize
// Usa Claude Haiku para condensar artigo em blocos para slides

const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ message: 'ANTHROPIC_KEY não configurada.' });

  const { article, title } = req.body || {};
  if (!article) return res.status(400).json({ message: 'Campo article obrigatório.' });

  const prompt = `Você é um editor de conteúdo para Instagram da Rede Líderes, uma rede de executivos do Brasil.

Recebeu o seguinte artigo${title ? ` com o tema "${title}"` : ''}:

---
${article}
---

Sua tarefa é criar EXATAMENTE 3 blocos de texto para slides de carrossel do Instagram e 1 frase de capa.

Regras para os 3 blocos:
- Cada bloco captura uma ideia central diferente do artigo
- Bloco 1: NO MÁXIMO 2 frases curtas e diretas, NO MÁXIMO 220 caracteres
- Bloco 2: NO MÁXIMO 220 caracteres (sem limite mínimo de frases)
- Bloco 3: NO MÁXIMO 2 frases curtas e diretas, NO MÁXIMO 220 caracteres
- Linguagem executiva, clara e impactante — direto ao ponto
- NÃO usar bullet points, numeração ou títulos — apenas texto corrido
- OBRIGATÓRIO: cada bloco deve começar com uma abertura diferente — não repita o mesmo tipo de construção de frase entre os blocos

Regras para a frase de capa:
- Uma pergunta curta e instigante que desperte curiosidade sobre o tema do artigo
- Deve provocar reflexão imediata em quem lê — algo que faça a pessoa querer descobrir a resposta
- Máximo 80 caracteres
- NÃO use aspas na frase

Responda APENAS neste formato exato, sem introdução, sem explicação, sem numeração:

[bloco 1]

[bloco 2]

[bloco 3]

---
[frase de capa]`;

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        temperature: 0.85,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || r.statusText);

    const text = (data?.content?.[0]?.text || '').trim();
    const [bodyRaw, hookRaw] = text.split(/\n\s*---\s*\n/);
    const parts = (bodyRaw || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).slice(0, 3);
    if (parts.length < 3) throw new Error('Claude não retornou 3 blocos. Tente novamente.');
    const hook = (hookRaw || '').trim();

    return res.status(200).json({ parts, hook });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
