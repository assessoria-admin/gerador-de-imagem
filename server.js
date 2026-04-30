// ─── Local development server ────────────────────────────────────────────────
// Para rodar localmente: npm start
// Para Vercel: use api/index.js (serverless)
require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const NOTION_KEY         = process.env.NOTION_KEY;
const NOTION_DB          = process.env.NOTION_DB;
const NOTION_COAUTORES_DB = process.env.NOTION_COAUTORES_DB;

const GEMINI_KEY      = process.env.GEMINI_API_KEY;
const GEMINI_IMG_URL  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';
const GROQ_KEY        = process.env.GROQ_KEY;
const GROQ_URL        = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL      = 'llama-3.3-70b-versatile';

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname)));

// ── POST /api/generate — geração de imagem via Gemini ────────────────────────
app.post('/api/generate', async (req, res) => {
  if (!GEMINI_KEY) {
    return res.status(500).json({ message: 'GEMINI_API_KEY não configurada no .env' });
  }

  const { prompt, reference_images } = req.body || {};
  if (!prompt) return res.status(400).json({ message: 'Campo "prompt" é obrigatório.' });

  const parts = [{ text: prompt }];
  if (Array.isArray(reference_images) && reference_images.length > 0) {
    for (const ref of reference_images) {
      parts.push({ inlineData: { mimeType: ref.mime_type || 'image/jpeg', data: ref.image } });
    }
  }

  try {
    console.log('[generate] enviando para Gemini...');
    const geminiRes = await fetch(`${GEMINI_IMG_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      })
    });

    const data = await geminiRes.json();
    console.log('[generate] status Gemini:', geminiRes.status);

    if (!geminiRes.ok) {
      const msg = data?.error?.message || geminiRes.statusText;
      console.error('[generate] erro Gemini:', msg);
      return res.status(geminiRes.status).json({ message: msg });
    }

    const parts_out = data?.candidates?.[0]?.content?.parts || [];
    const imgPart   = parts_out.find(p => p.inlineData?.data);

    if (!imgPart) {
      console.error('[generate] sem imagem na resposta:', JSON.stringify(data).slice(0, 500));
      return res.status(500).json({ message: 'Gemini não retornou imagem. Verifique o prompt ou a chave da API.' });
    }

    const { mimeType, data: b64 } = imgPart.inlineData;
    const dataUrl = `data:${mimeType};base64,${b64}`;
    console.log('[generate] imagem gerada —', mimeType, Math.round(b64.length / 1024), 'KB base64');

    res.status(200).json({ data: { generated: [dataUrl] } });

  } catch (err) {
    console.error('[generate] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/proxy-image?url=... — proxy de imagem (evita CORS no canvas) ─────
app.get('/api/proxy-image', async (req, res) => {
  const { url } = req.query;

  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ message: 'URL inválida.' });
  }

  try {
    console.log('[proxy-image] baixando:', url.slice(0, 80));
    const imgRes = await fetch(url);
    if (!imgRes.ok) {
      console.error('[proxy-image] resposta não-ok:', imgRes.status, url.slice(0, 80));
      return res.status(502).json({ message: `Imagem retornou status ${imgRes.status}` });
    }
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const buffer = await imgRes.arrayBuffer();

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('[proxy-image] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/notion/search — busca pessoas no Notion ──────────────────────────
app.get('/api/notion/search', async (req, res) => {
  const { q } = req.query;

  if (!q || q.length < 2) {
    return res.json({ results: [] });
  }

  try {
    if (!NOTION_KEY || !NOTION_DB) {
      return res.json({ results: [] });
    }

    console.log('[notion-search] buscando:', q);

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: { property: 'user', title: { contains: q } },
        page_size: 10,
        sorts: [{ property: 'user', direction: 'ascending' }]
      })
    });

    if (!notionRes.ok) {
      // Fallback: tenta como rich_text
      const notionRes2 = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filter: { property: 'user', rich_text: { contains: q } },
          page_size: 10
        })
      });
      if (!notionRes2.ok) return res.json({ results: [] });
      const data2 = await notionRes2.json();
      return res.json({ results: mapNotionResults(data2.results || []) });
    }

    const data = await notionRes.json();

    const results = mapNotionResults(data.results || []);

    res.json({ results });

  } catch (err) {
    console.error('[notion-search] erro:', err.message);
    res.json({ results: [] });
  }
});

// ── Helper: mapeia resultados do Notion ───────────────────────────────────────
function extractProp(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':        return (prop.title        || []).map(t => t.plain_text).join('');
    case 'rich_text':    return (prop.rich_text     || []).map(t => t.plain_text).join('');
    case 'select':       return prop.select?.name  || '';
    case 'multi_select': return (prop.multi_select || []).map(s => s.name).join(', ');
    case 'url':          return prop.url           || '';
    case 'email':        return prop.email         || '';
    default:             return '';
  }
}

function extractPhotoUrl(prop) {
  if (!prop || prop.type !== 'files') return '';
  const file = (prop.files || [])[0];
  if (!file) return '';
  return file.type === 'external' ? (file.external?.url || '') : (file.file?.url || '');
}

function mapNotionResults(pages) {
  return pages.map(page => {
    const props = page.properties || {};
    let linkedin = '';
    let fotoProp = null;

    for (const [key, val] of Object.entries(props)) {
      const k = key.toLowerCase();
      if (k.includes('linkedin') && !linkedin) {
        linkedin = extractProp(val);
      }
      if (k === 'foto_ia') {
        fotoProp = val; // foto_ia tem prioridade
        console.log(`[notion-debug] prop foto_ia raw:`, JSON.stringify(val).slice(0, 300));
      } else if ((k === 'foto' || k === 'photo') && !fotoProp) {
        fotoProp = val;
        console.log(`[notion-debug] prop foto raw:`, JSON.stringify(val).slice(0, 300));
      }
    }

    const photoUrl = extractPhotoUrl(fotoProp);
    const name = extractProp(props.user);
    console.log(`[notion] ${name || '?'} — fotoType: ${fotoProp?.type || 'NÃO ENCONTRADO'} — photoUrl: ${photoUrl ? photoUrl.slice(0, 60) + '…' : 'VAZIO'}`);

    return {
      id:       page.id,
      name,
      cargo:    extractProp(props.cargo_rede),
      empresas: extractProp(props.ultimas_empresa),
      linkedin,
      photoUrl
    };
  }).filter(r => r.name);
}

// ── GET /api/notion/debug — diagnóstico temporário ───────────────────────────
app.get('/api/notion/debug', async (req, res) => {
  const name = (req.query.name || '').trim();
  const notionHeaders = {
    'Authorization':  `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json'
  };
  const out = {};

  // 1. Query do banco NOTION_DB pelo nome
  for (const filterType of ['title', 'rich_text']) {
    const r = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
      method: 'POST', headers: notionHeaders,
      body: JSON.stringify({ filter: { property: 'user', [filterType]: { contains: name } }, page_size: 5 })
    });
    const d = await r.json();
    out[`db_query_${filterType}`] = { status: r.status, object: d.object, error: d.message, count: d.results?.length, ids: d.results?.map(p => ({ id: p.id, title: Object.values(p.properties || {}).find(v => v.type === 'title')?.title?.map(t=>t.plain_text).join('') })) };
    if (d.object !== 'error' && d.results?.length) {
      // 2. Lista filhos da primeira página encontrada
      const pid = d.results[0].id;
      const cr = await fetch(`https://api.notion.com/v1/blocks/${pid}/children?page_size=50`, { headers: notionHeaders });
      const cd = await cr.json();
      out.children = { parentId: pid, status: cr.status, object: cd.object, error: cd.message, blocks: cd.results?.map(b => ({ type: b.type, title: b.child_page?.title || b.child_database?.title || '' })) };
      break;
    }
  }

  // 3. Notion /v1/search direto pelo título
  const sr = await fetch('https://api.notion.com/v1/search', {
    method: 'POST', headers: notionHeaders,
    body: JSON.stringify({ query: `ARTIGO - REDE LÍDERES (${name})`, filter: { value: 'page', property: 'object' }, page_size: 10 })
  });
  const sd = await sr.json();
  out.notion_search = { status: sr.status, object: sd.object, error: sd.message, count: sd.results?.length, titles: sd.results?.map(p => ({ id: p.id, title: p.properties?.title?.title?.map(t=>t.plain_text).join('') })) };

  res.json(out);
});

// ── GET /api/notion/article — busca artigo do coautor pelo nome ──────────────
app.get('/api/notion/article', async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Parâmetro name obrigatório' });

  const notionHeaders = {
    'Authorization':  `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json'
  };

  // Texto da instrução interna que deve ser removido do artigo
  const INSTRUCAO_REVISAO = 'Segue o seu artigo para revisão';

  function richTextToPlain(arr) {
    return (arr || []).map(t => t.plain_text).join('');
  }

  // Detecta se uma linha é o título do artigo: está em CAPS LOCK (>80% maiúsculas, >10 chars)
  function isAllCapsTitle(text) {
    const trimmed = text.trim();
    if (trimmed.length < 10) return false;
    const letters = trimmed.replace(/[^a-zA-ZÀ-ÿ]/g, '');
    if (!letters.length) return false;
    const upper = letters.replace(/[^A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ]/g, '');
    return (upper.length / letters.length) >= 0.8;
  }

  async function fetchBlocks(blockId) {
    const blocks = [];
    let cursor = undefined;
    do {
      const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
      url.searchParams.set('page_size', '100');
      if (cursor) url.searchParams.set('start_cursor', cursor);
      const resp = await fetch(url.toString(), { headers: notionHeaders });
      const data = await resp.json();
      if (data.object === 'error') break;
      blocks.push(...(data.results || []));
      cursor = data.next_cursor;
    } while (cursor);
    return blocks;
  }

  async function fetchBlocksText(blockId, skipInstrucao = false) {
    let text = '';
    const blocks = await fetchBlocks(blockId);
    for (const block of blocks) {
      const type = block.type;
      const content = block[type];
      if (!content) continue;

      // Ignora callouts que contenham a instrução de revisão
      if (type === 'callout') {
        const calloutText = richTextToPlain(content.rich_text);
        if (calloutText.includes(INSTRUCAO_REVISAO)) continue;
      }

      const richTypes = ['paragraph','heading_1','heading_2','heading_3','bulleted_list_item','numbered_list_item','quote','callout'];
      if (richTypes.includes(type)) {
        const line = richTextToPlain(content.rich_text);
        if (line.trim()) text += line + '\n\n';
      }
      if (block.has_children && type !== 'child_page') {
        text += await fetchBlocksText(block.id);
      }
    }
    return text.trim();
  }

  try {
    // Passo 1: busca direta pelo título "ARTIGO - REDE LÍDERES ({nome})"
    const searchResp = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        query: `ARTIGO - REDE LÍDERES (${name})`,
        filter: { value: 'page', property: 'object' },
        page_size: 10
      })
    });
    const searchData = await searchResp.json();

    const nameLower = name.toLowerCase();
    const artPage = (searchData.results || []).find(p => {
      const title = (p.properties?.title?.title || []).map(t => t.plain_text).join('').toLowerCase();
      return title.includes('artigo') && title.includes(nameLower);
    });

    if (!artPage) {
      return res.status(404).json({ error: `Página de artigo não encontrada para "${name}"` });
    }

    const articlePageId = artPage.id;
    const pageTitle = (artPage.properties?.title?.title || []).map(t => t.plain_text).join('');

    // Percorre os blocos procurando o título em CAPS LOCK e o corpo do artigo
    const allBlocks = await fetchBlocks(articlePageId);
    let articleTitle = '';
    let articleText = '';

    for (const block of allBlocks) {
      const type = block.type;
      const content = block[type];
      if (!content) continue;

      // Ignora callout de instrução de revisão
      if (type === 'callout') {
        const calloutText = richTextToPlain(content.rich_text);
        if (calloutText.includes(INSTRUCAO_REVISAO)) continue;
      }

      const richTypes = ['paragraph','heading_1','heading_2','heading_3','bulleted_list_item','numbered_list_item','quote','callout'];
      if (richTypes.includes(type)) {
        const line = richTextToPlain(content.rich_text).trim();
        if (!line) continue;

        // Detecta título em CAPS LOCK (se ainda não encontrou)
        if (!articleTitle && isAllCapsTitle(line)) {
          articleTitle = line;
          continue; // não inclui o título no corpo do artigo
        }

        articleText += line + '\n\n';
      }

      if (block.has_children && type !== 'child_page') {
        articleText += await fetchBlocksText(block.id) + '\n\n';
      }
    }

    articleText = articleText.trim();
    console.log(`[notion-article] "${pageTitle}" → título: "${articleTitle}", ${articleText.length} chars`);

    res.json({ pageTitle, articleTitle, articleText });
  } catch (err) {
    console.error('[notion-article] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/stock-images — busca imagens no Pexels por texto do artigo ──────
app.post('/api/stock-images', async (req, res) => {
  const PEXELS_KEY = process.env.PEXELS_KEY;
  if (!PEXELS_KEY) return res.status(500).json({ message: 'PEXELS_KEY não configurada no .env' });
  if (!GROQ_KEY) return res.status(500).json({ message: 'GROQ_KEY não configurada no .env' });

  const { parts, articleTitle, articleFullText, leaderCargo, leaderEmpresas } = req.body || {};
  if (!Array.isArray(parts) || parts.length === 0) {
    return res.status(400).json({ message: 'Campo "parts" (array de textos) é obrigatório.' });
  }

  // 1. Usa Groq para extrair palavras-chave visuais e específicas de cada parte
  async function extractKeywords(slideText, title) {
    const leaderContext = [leaderCargo, leaderEmpresas].filter(Boolean).join(' | ');
    const articleContext = articleFullText ? articleFullText.slice(0, 1200) : '';

    const prompt = `You are a visual content researcher for a premium Brazilian executive network (Rede Líderes).

LEADER CONTEXT: ${leaderContext || 'senior executive, business leader'}
ARTICLE TITLE: ${title || 'executive article'}
FULL ARTICLE EXCERPT: "${articleContext}"
SLIDE TEXT TO ILLUSTRATE: "${slideText.slice(0, 400)}"

Return ONLY 3-4 English keywords for a Pexels stock photo search. Rules:
- Keywords must be SPECIFIC and VISUAL — things you can actually photograph
- Match the EXACT theme of the slide text, informed by the full article context
- Incorporate the leader's industry/sector from the leader context when relevant
- Prefer concrete scenes: e.g. "CEO boardroom presentation", "tech startup team", "financial analyst charts"
- Avoid standalone abstract words like "success", "leadership", "growth"
- Return ONLY the keywords separated by spaces, nothing else

Keywords:`;

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 40,
        temperature: 0.2
      })
    });
    const d = await r.json();
    const raw = d?.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/[\r\n]+/g, ' ').replace(/['".,\-]/g, '').replace(/\s+/g, ' ').trim();
    return clean || 'executive business meeting';
  }

  // 2. Busca no Pexels — evita repetir fotos já usadas
  async function searchPexels(query, usedIds) {
    const safeQuery = query.replace(/[\r\n]/g, ' ').trim().slice(0, 100);
    if (!safeQuery) return null;
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(safeQuery)}&per_page=20&orientation=landscape`;
    const r = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.error(`[stock-images] Pexels ${r.status} para query "${safeQuery}": ${errBody.slice(0, 200)}`);
      return null;
    }
    const d = await r.json();
    const photos = (d.photos || []).filter(p => !usedIds.has(p.id));
    if (!photos.length) return null;
    const pick = photos[0];
    usedIds.add(pick.id);
    return pick.src.large2x || pick.src.large || pick.src.original;
  }

  try {
    const title = articleTitle || '';
    const imageUrls = [];
    const usedIds = new Set();

    for (const part of parts.slice(0, 3)) {
      const keywords = await extractKeywords(part, title);
      console.log(`[stock-images] keywords: "${keywords}"`);
      const url = await searchPexels(keywords, usedIds);
      if (!url) {
        const fallbackUrl = await searchPexels(title.split(' ').slice(0, 3).join(' ') || 'business leadership', usedIds);
        imageUrls.push(fallbackUrl || null);
      } else {
        imageUrls.push(url);
      }
    }

    console.log(`[stock-images] ok — ${imageUrls.filter(Boolean).length}/3 imagens encontradas`);
    res.json({ images: imageUrls });
  } catch (err) {
    console.error('[stock-images] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/summarize — resume artigo com Groq ─────────────────────────────
app.post('/api/summarize', async (req, res) => {
  const { article, title } = req.body || {};
  if (!article) return res.status(400).json({ message: 'Campo article obrigatório.' });
  if (!GROQ_KEY) return res.status(500).json({ message: 'GROQ_KEY não configurada no .env' });

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

Responda APENAS com os 3 blocos separados por uma linha em branco, sem introdução, sem explicação, sem numeração.`;

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        temperature: 0.4
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || response.statusText);

    const text  = data?.choices?.[0]?.message?.content || '';
    const parts = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).slice(0, 3);
    if (parts.length < 3) throw new Error('Groq não retornou 3 blocos. Tente novamente.');

    console.log('[summarize] ok —', parts.length, 'blocos gerados');
    res.json({ parts });
  } catch (err) {
    console.error('[summarize] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/copywrite — gera legendas IG + LI com Groq ─────────────────────
app.post('/api/copywrite', async (req, res) => {
  const TIPOS_VALIDOS = ['imagem-perfil', 'carrossel-artigo', 'parabenizacao', 'mudanca-cargo', 'livre'];

  if (!GROQ_KEY) return res.status(500).json({ message: 'GROQ_KEY não configurada no .env' });

  const { tipo, lider, contexto, avoid } = req.body || {};

  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Campo "tipo" inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (!contexto || typeof contexto !== 'string' || !contexto.trim()) {
    return res.status(400).json({ message: 'Campo "contexto" é obrigatório.' });
  }

  async function callGroq(prompt) {
    const response = await fetch(GROQ_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body:    JSON.stringify({
        model:       GROQ_MODEL,
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  1400,
        temperature: 0.75
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || response.statusText);
    return (data?.choices?.[0]?.message?.content || '').trim();
  }

  function buildLiderLine(l) {
    if (!l) return null;
    return `Líder: ${l.name}${l.cargo ? ` | Cargo atual: ${l.cargo}` : ''}${l.empresas ? ` | Empresas anteriores (histórico): ${l.empresas}` : ''}`;
  }

  const liderLine = buildLiderLine(lider);
  const inputLines = [
    liderLine,
    `Contexto: ${contexto.trim()}`,
    avoid ? `Evite repetir: ${avoid}` : null
  ].filter(Boolean).join('\n');

  const BASE = `Você é o redator editorial da Rede Líderes — comunidade premium B2B de líderes empresariais do Brasil.
Tom: direto, editorial, premium. Nunca corporativo engessado. Nunca genérico.
Sem hashtags. Sem emojis.
Escreva em português brasileiro formal-moderno.`;

  const promptIG = `${BASE}

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
${inputLines}

Retorne APENAS o texto puro da legenda, sem JSON, sem aspas, sem markdown.`;

  const promptLI = `${BASE}

TAREFA: Legenda de parabenização para LINKEDIN. LIMITE ABSOLUTO: 800 caracteres (incluindo espaços e quebras de linha). Não ultrapasse.

ESTRUTURA (3 parágrafos curtos + URL):
1. Mencione o histórico de empresas anteriores em uma frase de impacto.
2. Apresente o novo cargo e empresa. Parabenize pelo nome.
3. Uma frase editorial sobre o que essa trajetória representa.
Última linha: www.redelideres.com

EXEMPLOS:
INPUT: Líder: Glauco Sampaio | Cargo atual: CEO | Empresas anteriores (histórico): Santander, Banco Votorantim, Cielo | Contexto: Parabenização por nova posição: CEO na BeePhish
SAÍDA: Décadas construindo visão de risco e escala dentro de Santander, Banco Votorantim e Cielo formam um tipo específico de liderança — aquela que enxerga vulnerabilidade antes de virar problema.\\n\\nGlauco Sampaio assume como CEO da BeePhish, levando para o empreendedorismo em cibersegurança toda a visão acumulada em anos de mercado financeiro.\\n\\nNo momento em que cibersegurança deixou de ser pauta de TI e virou prioridade de boardroom, ter um CEO com esse histórico no setor financeiro não é coincidência — é estratégia.\\n\\nParabéns, Glauco. Essa nova fase vai longe.\\n\\nwww.redelideres.com

INPUT: Líder: Ana Carvalho | Cargo atual: Diretora de Operações | Empresas anteriores (histórico): Ambev, Unilever, P&G | Contexto: Parabenização por nova posição: Diretora de Operações na Nestlé
SAÍDA: Quem passou por P&G, Unilever e Ambev não apenas entende operação — aprendeu a escalar sem perder precisão, a entregar resultado sob pressão e a liderar times que não admitem margem de erro.\\n\\nAna Carvalho assume como Diretora de Operações na Nestlé, levando para uma das maiores operações de consumo do mundo um repertório forjado nos melhores laboratórios de execução do Brasil.\\n\\nEsse movimento diz muito sobre o que a Nestlé está priorizando: não basta ter boa estratégia — é preciso quem saiba transformar intenção em resultado no chão de fábrica e na cadeia toda.\\n\\nParabéns, Ana. Você chegou exatamente onde deveria estar.\\n\\nwww.redelideres.com

AGORA GERE PARA:
${inputLines}

Retorne APENAS o texto puro da legenda, sem JSON, sem aspas, sem markdown.`;

  try {
    const [instagram, linkedin] = await Promise.all([
      callGroq(promptIG),
      callGroq(promptLI),
    ]);

    if (!instagram || !linkedin) throw new Error('Resposta vazia do Groq.');

    const linkedinTruncado = linkedin.length > 800
      ? linkedin.slice(0, 800).replace(/\s+\S*$/, '') + '\n\nwww.redelideres.com'
      : linkedin;

    console.log('[copywrite] ok — tipo:', tipo, lider ? `| líder: ${lider.name}` : '');
    res.json({ instagram, linkedin: linkedinTruncado });

  } catch (err) {
    console.error('[copywrite] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/removebg — remove fundo via Remove.bg ──────────────────────────
app.post('/api/removebg', async (req, res) => {
  const REMOVEBG_KEY = process.env.REMOVEBG_KEY;
  if (!REMOVEBG_KEY) return res.status(500).json({ message: 'REMOVEBG_KEY não configurada no .env' });

  const { imageUrl, imageBase64 } = req.body || {};
  if (!imageUrl && !imageBase64) return res.status(400).json({ message: 'Informe imageUrl ou imageBase64.' });

  try {
    const formData = new FormData();
    formData.append('size', 'auto');

    if (imageUrl) {
      formData.append('image_url', imageUrl);
    } else {
      const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const blob   = new Blob([buffer], { type: 'image/jpeg' });
      formData.append('image_file', blob, 'image.jpg');
    }

    console.log('[removebg] enviando para Remove.bg...');
    const rbRes = await fetch('https://api.remove.bg/v1.0/removebg', {
      method:  'POST',
      headers: { 'X-Api-Key': REMOVEBG_KEY },
      body:    formData
    });

    if (!rbRes.ok) {
      const errText = await rbRes.text().catch(() => '');
      return res.status(rbRes.status).json({ message: `Remove.bg retornou ${rbRes.status}: ${errText.slice(0, 120)}` });
    }

    const buffer = await rbRes.arrayBuffer();
    const base64Result = Buffer.from(buffer).toString('base64');
    console.log('[removebg] ok —', buffer.byteLength, 'bytes');
    res.json({ base64: `data:image/png;base64,${base64Result}` });

  } catch (err) {
    console.error('[removebg] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ── Start (local only) ─────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('\n─────────────────────────────────────────');
    console.log(`  Profile Generator → http://localhost:${PORT}`);
    console.log('─────────────────────────────────────────\n');
  });
}

module.exports = app;
