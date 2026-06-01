// Vercel Serverless Function — POST /api/stock-images
// Extrai palavras-chave com Claude Haiku e busca fotos no Pexels

const PEXELS_KEY    = process.env.PEXELS_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

async function extractKeywords(slideText, title, leaderCargo, leaderEmpresas, articleFullText, avoidKeywords = '') {
  const leaderContext = [leaderCargo, leaderEmpresas].filter(Boolean).join(' | ');
  const articleContext = articleFullText ? articleFullText.slice(0, 1200) : '';
  const avoidLine = avoidKeywords
    ? `ALREADY USED KEYWORDS (do NOT repeat similar themes): "${avoidKeywords}"`
    : '';

  const prompt = `You are a visual content researcher for a premium Brazilian executive network (Rede Líderes).

LEADER CONTEXT: ${leaderContext || 'senior executive, business leader'}
ARTICLE TITLE: ${title || 'executive article'}
FULL ARTICLE EXCERPT: "${articleContext}"
SLIDE TEXT TO ILLUSTRATE: "${slideText.slice(0, 400)}"
${avoidLine}

Return ONLY 3-4 English keywords for a Pexels stock photo search. Rules:
- Keywords must be SPECIFIC and VISUAL — things you can actually photograph
- Match the EXACT theme of the slide text, informed by the full article context
- Incorporate the leader's industry/sector from the leader context when relevant
- Prefer concrete scenes: e.g. "CEO boardroom presentation", "tech startup team", "financial analyst charts"
- Avoid standalone abstract words like "success", "leadership", "growth"
- If avoid keywords are provided, choose a completely different scene/subject/setting
- Return ONLY the keywords separated by spaces, nothing else

Keywords:`;

  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 40,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const d = await r.json();
  const raw = d?.content?.[0]?.text || '';
  const clean = raw.replace(/[\r\n]+/g, ' ').replace(/['".,\-]/g, '').replace(/\s+/g, ' ').trim();
  return clean || 'executive business meeting';
}

async function searchPexels(query, usedIds) {
  const safeQuery = query.replace(/[\r\n]/g, ' ').trim().slice(0, 100);
  if (!safeQuery) return null;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(safeQuery)}&per_page=20&orientation=landscape`;
  const r = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
  if (!r.ok) {
    console.error(`[stock-images] Pexels ${r.status} para query "${safeQuery}"`);
    return null;
  }
  const d = await r.json();
  const photos = (d.photos || []).filter(p => !usedIds.has(p.id));
  if (!photos.length) return null;
  const pool = photos.slice(0, 5);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  usedIds.add(pick.id);
  return pick.src.large2x || pick.src.large || pick.src.original;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (!PEXELS_KEY)    return res.status(500).json({ message: 'PEXELS_KEY não configurada.' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ message: 'ANTHROPIC_KEY não configurada.' });

  const { parts, articleTitle, articleFullText, leaderCargo, leaderEmpresas } = req.body || {};
  if (!Array.isArray(parts) || parts.length === 0) {
    return res.status(400).json({ message: 'Campo "parts" (array de textos) é obrigatório.' });
  }

  try {
    const title = articleTitle || '';
    const imageUrls = [];
    const usedIds = new Set();

    const part1 = parts[0] || title;
    const keywords1 = await extractKeywords(part1, title, leaderCargo, leaderEmpresas, articleFullText);
    console.log(`[stock-images] keywords1: "${keywords1}"`);
    const url1 = await searchPexels(keywords1, usedIds)
      || await searchPexels(title.split(' ').slice(0, 3).join(' ') || 'business leadership', usedIds)
      || null;
    imageUrls.push(url1);

    const part2 = parts[1] || part1;
    const keywords2 = await extractKeywords(part2, title, leaderCargo, leaderEmpresas, articleFullText, keywords1);
    console.log(`[stock-images] keywords2: "${keywords2}"`);
    const url2 = await searchPexels(keywords2, usedIds)
      || await searchPexels('executive meeting strategy', usedIds)
      || null;
    imageUrls.push(url2);

    console.log(`[stock-images] ok — ${imageUrls.filter(Boolean).length}/2 imagens encontradas`);
    res.json({ images: imageUrls });
  } catch (err) {
    console.error('[stock-images] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
};
