// ─── Local development server ────────────────────────────────────────────────
// Para rodar localmente: npm start
// Para Vercel: use api/index.js (serverless)
require('dotenv').config();
const express = require('express');
const path    = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const NOTION_KEY         = process.env.NOTION_KEY;
const NOTION_DB          = process.env.NOTION_DB;
const NOTION_COAUTORES_DB = process.env.NOTION_COAUTORES_DB;

const PB_BASE_URL        = process.env.PB_BASE_URL;
const PB_ADMIN_EMAIL     = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD  = process.env.PB_ADMIN_PASSWORD;

let _pbToken = null;
let _pbTokenExpiry = 0;

async function getPbToken() {
  if (_pbToken && Date.now() < _pbTokenExpiry) return _pbToken;

  // PocketBase v0.23+ usa _superusers; versões anteriores usam /api/admins
  const endpoints = [
    `${PB_BASE_URL}/api/collections/_superusers/auth-with-password`,
    `${PB_BASE_URL}/api/admins/auth-with-password`
  ];

  for (const url of endpoints) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD })
    });
    const d = await r.json();
    if (d.token) {
      console.log('[pb-auth] autenticado via', url);
      _pbToken = d.token;
      _pbTokenExpiry = Date.now() + 50 * 60 * 1000;
      return _pbToken;
    }
    console.warn('[pb-auth] falhou em', url, JSON.stringify(d).slice(0, 120));
  }
  throw new Error('PocketBase auth falhou em todos os endpoints');
}

const FREEPIK_KEY     = process.env.FREEPIK_KEY;
const MYSTIC_URL      = 'https://api.magnific.com/v1/ai/mystic';
const OPENCODE_KEY         = process.env.OPENCODE_KEY;
const OPENCODE_URL         = 'https://opencode.ai/zen/go/v1/chat/completions';
const OPENCODE_MODEL       = 'deepseek-v4-flash';  // copywrite
const OPENCODE_FAST_MODEL  = 'deepseek-v4-flash';  // keywords

const GEMINI_KEY           = process.env.GEMINI_API_KEY;
const GEMINI_URL           = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;

const GROQ_KEY             = process.env.GROQ_KEY;
const GROQ_URL             = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL           = 'llama-3.3-70b-versatile';

const ANTHROPIC_KEY        = process.env.ANTHROPIC_KEY;
const ANTHROPIC_URL        = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL      = 'claude-haiku-4-5-20251001';

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname)));

// ── POST /api/generate — geração de imagem via Freepik Mystic ────────────────
app.post('/api/generate', async (req, res) => {
  if (!FREEPIK_KEY) {
    return res.status(500).json({ message: 'FREEPIK_KEY não configurada no .env' });
  }

  const { prompt, reference_images } = req.body || {};
  if (!prompt) return res.status(400).json({ message: 'Campo "prompt" é obrigatório.' });

  try {
    console.log('[generate] enviando para Mystic...');

    const body = {
      prompt,
      model:        'realism',
      resolution:   '2k',
      aspect_ratio: 'traditional_3_4'
    };

    if (Array.isArray(reference_images) && reference_images.length > 0) {
      body.structure_reference = reference_images[0].image;
      body.structure_strength  = 80;
    }

    const startRes  = await fetch(MYSTIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-freepik-api-key': FREEPIK_KEY },
      body: JSON.stringify(body)
    });

    const startData = await startRes.json();
    console.log('[generate] Mystic start:', startRes.status, JSON.stringify(startData).slice(0, 200));

    if (!startRes.ok) {
      return res.status(startRes.status).json({ message: startData?.message || startRes.statusText });
    }

    const taskId = startData?.data?.task_id || startData?.task_id;
    if (!taskId) throw new Error('Mystic não retornou task_id.');

    console.log('[generate] task_id:', taskId, '— aguardando...');

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 4000));
      const pollRes = await fetch(`${MYSTIC_URL}/${taskId}`, {
        headers: { 'x-freepik-api-key': FREEPIK_KEY }
      });
      const poll   = await pollRes.json();
      const status = poll?.data?.status || poll?.status;
      console.log(`[generate] poll ${i + 1} — status: ${status}`);

      if (status === 'COMPLETED' || status === 'SUCCESS') {
        const generated = poll?.data?.generated || poll?.generated || [];
        const img = generated[0];
        const url = img?.url || img?.base64 || img;
        if (!url) throw new Error('Mystic retornou COMPLETED mas sem imagem.');
        return res.json({ data: { generated: [url] } });
      }
      if (status === 'FAILED' || status === 'ERROR') {
        throw new Error(`Mystic falhou: ${JSON.stringify(poll).slice(0, 200)}`);
      }
    }

    throw new Error('Timeout: Mystic não retornou imagem em 80s.');

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

// ── GET /api/notion/members — lista todos os membros com artigo ───────────────
let _membersCache = null;
let _membersCacheTime = 0;

const LIVRO_DB = '2a26cfa6dfd7812b9dd9e36c273e8bd7'; // Livro Produto e Tech

app.get('/api/notion/members', async (req, res) => {
  if (!NOTION_KEY) return res.json({ members: [] });

  // Cache de 5 minutos
  if (_membersCache && Date.now() - _membersCacheTime < 5 * 60 * 1000) {
    return res.json({ members: _membersCache });
  }

  const notionHeaders = {
    'Authorization': `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    const members = [];
    let cursor = undefined;
    do {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Nome', direction: 'ascending' }],
        filter: { property: 'Artigo Finalizado', checkbox: { equals: true } }
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`https://api.notion.com/v1/databases/${LIVRO_DB}/query`, {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (data.object === 'error') throw new Error(data.message);
      for (const page of data.results || []) {
        const props = page.properties || {};
        const name = (props.Nome?.title || []).map(t => t.plain_text).join('').trim();
        if (!name) continue;
        members.push({ id: page.id, name });
      }
      cursor = data.next_cursor;
    } while (cursor);

    // Filtra líderes que já têm carrossel_feito = true no PocketBase
    let filtered = members;
    if (PB_BASE_URL && PB_ADMIN_EMAIL) {
      try {
        const token = await getPbToken();
        const pbFilter = encodeURIComponent('carrossel_feito = true');
        const pbRes = await fetch(
          `${PB_BASE_URL}/api/collections/lideres/records?filter=${pbFilter}&fields=nome&perPage=500`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const pbData = await pbRes.json();
        const done = new Set(
          (pbData.items || []).map(r => r.nome?.trim().toLowerCase()).filter(Boolean)
        );
        filtered = members.filter(m => !done.has(m.name.trim().toLowerCase()));
        console.log(`[notion/members] ${members.length} total → ${filtered.length} sem carrossel`);
      } catch (pbErr) {
        console.warn('[notion/members] falha ao filtrar PocketBase:', pbErr.message);
      }
    }

    _membersCache = filtered;
    _membersCacheTime = Date.now();
    res.json({ members: filtered });
  } catch (err) {
    console.error('[notion/members] erro:', err.message);
    res.json({ members: [] });
  }
});

// ── GET /api/pb/artigos-disponiveis — lista artigos pendentes de carrossel ───
app.get('/api/pb/artigos-disponiveis', async (req, res) => {
  if (!PB_BASE_URL || !PB_ADMIN_EMAIL) return res.json({ artigos: [] });
  try {
    const token = await getPbToken();
    const filter = encodeURIComponent('carrossel_criado = false');
    const expand = 'co_autor';

    // Fetch a small batch and pick 1 randomly (fast + variety)
    const url = `${PB_BASE_URL}/api/collections/db_artigos/records?filter=${filter}&expand=${expand}&perPage=10`;
    const pbRes = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await pbRes.json();
    if (!pbRes.ok) throw new Error(`PB ${pbRes.status}: ${JSON.stringify(data).slice(0, 200)}`);

    const raw = data.items || [];
    const validos = raw.map(r => {
      const coAutor = r.expand?.co_autor;
      if (!coAutor || !coAutor.foto_ia) return null;
      return {
        id:     r.id,
        artigo: r.artigo || '',
        texto:  r.texto || '',
        lider:  {
          id:         coAutor.id,
          name:       coAutor.nome || '',
          cargo:      coAutor.cargo_rede || coAutor.cargo_atual || '',
          cargo_rede: coAutor.cargo_rede || '',
          empresas:   coAutor.ultimas_empresa || '',
          linkedin:   coAutor.url_linkedin || '',
          photoUrl:   `${PB_BASE_URL}/api/files/lideres/${coAutor.id}/${coAutor.foto_ia}`
        }
      };
    }).filter(a => a && a.artigo && a.lider?.photoUrl);

    // Pick 1 randomly
    const artigos = validos.length > 0 ? [validos[Math.floor(Math.random() * validos.length)]] : [];
    console.log(`[artigos-disponiveis] ${validos.length} válidos → sorteou 1`);

    const artigos = raw.map(r => {
      const coAutor = r.expand?.co_autor;
      if (!coAutor || !coAutor.foto_ia) return null;
      return {
        id:     r.id,
        artigo: r.artigo || '',
        texto:  r.texto || '',
        lider:  {
          id:         coAutor.id,
          name:       coAutor.nome || '',
          cargo:      coAutor.cargo_rede || coAutor.cargo_atual || '',
          cargo_rede: coAutor.cargo_rede || '',
          empresas:   coAutor.ultimas_empresa || '',
          linkedin:   coAutor.url_linkedin || '',
          photoUrl:   `${PB_BASE_URL}/api/files/lideres/${coAutor.id}/${coAutor.foto_ia}`
        }
      };
    }).filter(a => {
      if (!a) return false;
      if (!a.artigo) { console.log(`[artigos-disponiveis] drop: empty artigo`); return false; }
      if (!a.lider?.photoUrl) { console.log(`[artigos-disponiveis] drop: no photoUrl`); return false; }
      return true;
    });

    console.log(`[artigos-disponiveis] ${artigos.length} artigos pendentes`);
    res.json({ artigos });
  } catch (err) {
    console.error('[artigos-disponiveis] erro:', err.message);
    res.json({ artigos: [] });
  }
});

// ── PATCH /api/pb/mark-done — marca carrossel_criado=true ────────────────────
app.patch('/api/pb/mark-done', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });
  try {
    const token = await getPbToken();
    const pbRes = await fetch(`${PB_BASE_URL}/api/collections/db_artigos/records/${id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrossel_criado: true })
    });
    const data = await pbRes.json();
    if (!pbRes.ok) throw new Error(`PB ${pbRes.status}: ${JSON.stringify(data).slice(0, 200)}`);
    console.log(`[artigos-mark-done] carrossel_criado=true para id=${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[artigos-mark-done] erro:', err.message);
    res.status(500).json({ error: err.message });
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

// ── Helper: busca no Notion por query ────────────────────────────────────────
async function searchNotion(q) {
  if (!NOTION_KEY || !NOTION_DB) return [];
  const headers = {
    'Authorization':  `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json'
  };
  for (const filterType of ['title', 'rich_text']) {
    try {
      const resp = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter:    { property: 'user', [filterType]: { contains: q } },
          page_size: 10,
          sorts:     [{ property: 'user', direction: 'ascending' }]
        })
      });
      const data = await resp.json();
      if (data.object !== 'error') return mapNotionResults(data.results || []);
    } catch (_) {}
  }
  return [];
}

// ── GET /api/pb/search — busca líderes no PocketBase (fallback: Notion) ──────
app.get('/api/pb/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ results: [] });

  // Tenta PocketBase primeiro
  if (PB_BASE_URL && PB_ADMIN_EMAIL) {
    try {
      const token  = await getPbToken();
      const filter = encodeURIComponent(`nome ~ '${q}' && carrossel_feito = false`);
      const url = `${PB_BASE_URL}/api/collections/lideres/records?filter=${filter}&perPage=10`;
      console.log('[pb-search] GET', url);
      const pbRes = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      const data  = await pbRes.json();
      if (!pbRes.ok) throw new Error(`PB ${pbRes.status}: ${JSON.stringify(data).slice(0, 200)}`);
      const results = (data.items || []).map(r => {
        const cargoRede = Array.isArray(r.cargo_rede) ? r.cargo_rede.join(', ') : (r.cargo_rede || '');
        return {
          id:         r.id,
          source:     'pb',
          name:       r.nome            || '',
          cargo:      cargoRede,
          cargo_rede: cargoRede,
          empresas:   r.ultimas_empresa || '',
          linkedin:   r.url_linkedin    || '',
          photoUrl:   r.foto_ia
            ? `${PB_BASE_URL}/api/files/lideres/${r.id}/${r.foto_ia}`
            : ''
        };
      }).filter(r => r.name);

      if (results.length > 0) {
        console.log(`[pb-search] "${q}" → ${results.length} resultado(s)`);
        return res.json({ results });
      }
      console.log(`[pb-search] "${q}" → 0 resultados, tentando Notion...`);
    } catch (err) {
      console.error('[pb-search] erro:', err.message, '— tentando Notion...');
    }
  }

  // Fallback: Notion
  try {
    const results = await searchNotion(q);
    console.log(`[notion-fallback] "${q}" → ${results.length} resultado(s)`);
    res.json({ results, source: 'notion' });
  } catch (err) {
    console.error('[notion-fallback] erro:', err.message);
    res.json({ results: [] });
  }
});

// ── PATCH /api/pb/mark-carrossel — marca carrossel_feito=true no registro ─────
app.patch('/api/pb/mark-carrossel', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });
  try {
    const token = await getPbToken();
    const pbRes = await fetch(`${PB_BASE_URL}/api/collections/lideres/records/${id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrossel_feito: true })
    });

    const data = await pbRes.json();
    if (!pbRes.ok) throw new Error(`PB ${pbRes.status}: ${JSON.stringify(data).slice(0, 200)}`);
    console.log(`[pb-mark] carrossel_feito=true para id=${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[pb-mark] erro:', err.message);
    res.status(500).json({ error: err.message });
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
      if (k === 'foto_ia' && (val?.files?.length > 0 || val?.url)) {
        fotoProp = val; // foto_ia tem prioridade, mas só se tiver conteúdo
      } else if ((k === 'foto' || k === 'photo') && !fotoProp) {
        fotoProp = val;
      }
    }

    const photoUrl = extractPhotoUrl(fotoProp);
    const name = extractProp(props.user);
    console.log(`[notion] ${name || '?'} — fotoType: ${fotoProp?.type || 'NÃO ENCONTRADO'} — photoUrl: ${photoUrl ? photoUrl.slice(0, 60) + '…' : 'VAZIO'}`);

    return {
      id:       page.id,
      source:   'notion',
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
    const firstName = name.trim().split(/\s+/)[0];
    const lastName  = name.trim().split(/\s+/).slice(-1)[0];

    // 1. Busca o membro no LIVRO_DB pelo nome
    const memberResp = await fetch(`https://api.notion.com/v1/databases/${LIVRO_DB}/query`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: 'Nome', title: { contains: firstName } },
        page_size: 20
      })
    });
    const memberData = await memberResp.json();

    const memberPage = (memberData.results || []).find(p => {
      const title = (p.properties?.Nome?.title || []).map(t => t.plain_text).join('').toLowerCase().trim();
      return title.includes(firstName.toLowerCase()) && title.includes(lastName.toLowerCase());
    });

    if (!memberPage) {
      return res.status(404).json({ error: `Membro não encontrado para "${name}"` });
    }

    // 2. Percorre os blocos do membro procurando child_page "ARTIGOS"
    const memberBlocks = await fetchBlocks(memberPage.id);
    const artSubPage = memberBlocks.find(b =>
      b.type === 'child_page' && b.child_page?.title?.toLowerCase().includes('artigo')
    );

    let articleTitle = '';
    let articleText  = '';
    let pageTitle    = name;

    if (artSubPage) {
      // 3. Dentro da sub-página ARTIGOS, busca o parágrafo com conteúdo real
      const artBlocks = await fetchBlocks(artSubPage.id);
      for (const block of artBlocks) {
        const type = block.type;
        const content = block[type];
        if (!content) continue;
        if (type === 'callout') {
          const t = richTextToPlain(content.rich_text);
          if (t.includes(INSTRUCAO_REVISAO)) continue;
        }
        const richTypes = ['paragraph','heading_1','heading_2','heading_3','bulleted_list_item','numbered_list_item','quote','callout'];
        if (richTypes.includes(type)) {
          const line = richTextToPlain(content.rich_text).trim();
          if (!line) continue;
          // Ignora cabeçalhos de separação (ex: "ARTIGO 1:\n---")
          if (/^artigo\s+\d+\s*:/i.test(line) && line.length < 60 && !line.slice(10).trim()) continue;
          if (!articleTitle && isAllCapsTitle(line)) { articleTitle = line; continue; }
          articleText += line + '\n\n';
        }
        if (block.has_children && type !== 'child_page') {
          articleText += await fetchBlocksText(block.id) + '\n\n';
        }
      }
    } else {
      // Fallback: conteúdo direto na página do membro
      for (const block of memberBlocks) {
        const type = block.type;
        const content = block[type];
        if (!content || type === 'child_page') continue;
        const richTypes = ['paragraph','heading_1','heading_2','heading_3','bulleted_list_item','numbered_list_item','quote','callout'];
        if (richTypes.includes(type)) {
          const line = richTextToPlain(content.rich_text).trim();
          if (!line) continue;
          if (!articleTitle && isAllCapsTitle(line)) { articleTitle = line; continue; }
          articleText += line + '\n\n';
        }
        if (block.has_children) articleText += await fetchBlocksText(block.id) + '\n\n';
      }
    }

    articleText = articleText.trim();
    console.log(`[notion-article] "${name}" → título: "${articleTitle}", ${articleText.length} chars`);

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
  if (!OPENCODE_KEY) return res.status(500).json({ message: 'OPENCODE_KEY não configurada no .env' });

  const { parts, articleTitle, articleFullText, leaderCargo, leaderEmpresas } = req.body || {};
  if (!Array.isArray(parts) || parts.length === 0) {
    return res.status(400).json({ message: 'Campo "parts" (array de textos) é obrigatório.' });
  }

  // 1. Usa Groq para extrair palavras-chave visuais e específicas de cada parte
  async function extractKeywords(slideText, title, avoidKeywords = '') {
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
    console.log(`[stock-images] raw keywords response: "${raw.slice(0, 100)}"`);
    const clean = raw.replace(/[\r\n]+/g, ' ').replace(/['".,\-]/g, '').replace(/\s+/g, ' ').trim();
    return clean || 'executive business meeting';
  }

  // 2. Busca no Pexels — evita repetir fotos já usadas, escolhe aleatoriamente entre os primeiros resultados
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
    // Escolhe aleatoriamente entre os 5 primeiros resultados disponíveis
    const pool = photos.slice(0, 5);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    usedIds.add(pick.id);
    return pick.src.large2x || pick.src.large || pick.src.original;
  }

  try {
    const title = articleTitle || '';
    const imageUrls = [];
    const usedIds = new Set();

    // Imagem 1 — baseada no bloco 1 (ou título)
    const part1 = parts[0] || title;
    const keywords1 = await extractKeywords(part1, title);
    console.log(`[stock-images] keywords1: "${keywords1}"`);
    const url1 = await searchPexels(keywords1, usedIds)
      || await searchPexels(title.split(' ').slice(0, 3).join(' ') || 'business leadership', usedIds)
      || null;
    imageUrls.push(url1);

    // Imagem 2 — baseada no bloco 2, evitando temas e fotos já usados
    const part2 = parts[1] || part1;
    const keywords2 = await extractKeywords(part2, title, keywords1);
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
});

// ── POST /api/summarize — resume artigo com Groq ─────────────────────────────
app.post('/api/summarize', async (req, res) => {
  const { article, title, promptOverride } = req.body || {};
  if (!article) return res.status(400).json({ message: 'Campo article obrigatório.' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ message: 'ANTHROPIC_KEY não configurada no .env' });

  async function callClaude(promptText, temperature = 0.85, maxTokens = 800) {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: promptText }]
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || r.statusText);
    return (d?.content?.[0]?.text || '').trim();
  }

  // Prompt B2B LinkedIn — retorna { hook, bloco, bloco2 }
  if (promptOverride) {
    try {
      const content = await callClaude(promptOverride, 0.72, 200);
      console.log('[summarize/override] content:', content.slice(0, 300));
      const parts = content.split(/\n\s*---\s*\n/).map(s => s.trim()).filter(Boolean);
      const hook   = parts[0] || '';
      const bloco  = parts[1] || '';
      const bloco2 = parts[2] || '';
      if (!hook || !bloco) throw new Error('Modelo não retornou hook/bloco separados por ---. Tente novamente.');


      console.log('[summarize/override] hook:', hook.slice(0, 60));
      return res.json({ hook, bloco, bloco2 });
    } catch (err) {
      console.error('[summarize/override] erro:', err.message);
      return res.status(500).json({ message: err.message });
    }
  }

  const prompt = `Você é um editor de conteúdo para Instagram da Rede Líderes, rede de executivos do Brasil.

Recebeu o artigo${title ? ` com o tema "${title}"` : ''}:

---
${article}
---

Gere EXATAMENTE 4 blocos separados por linha em branco.

BLOCO 1 — GANCHO DE CAPA:
Crie UMA frase de impacto máximo para parar o scroll. Máximo 10 palavras. Escolha UMA das técnicas abaixo e aplique com base no conteúdo do artigo:

TÉCNICAS (escolha a mais poderosa para este artigo):
A) GAP DE CURIOSIDADE — crie uma lacuna de informação irresistível. Insinue algo surpreendente sem revelar. Ex de estrutura: "O que [elemento do tema] nunca te contaram sobre [resultado inesperado]"
B) AFIRMAÇÃO CONTRAINTUITIVA — contradiga o senso comum diretamente. Ex de estrutura: "[Crença comum] é o maior erro de quem [ação do tema]"
C) PERGUNTA QUE DÓI — aponte uma dor ou medo real do leitor. Ex de estrutura: "Por que você [faz X] e ainda não [conseguiu Y]?"
D) REVELAÇÃO INCOMPLETA — comece uma história ou dado chocante e pare no cliffhanger. Ex de estrutura: "Isso mudou tudo — e ninguém estava preparado"
E) NÚMERO ESPECÍFICO COM PROMESSA — use especificidade para criar credibilidade e urgência. Ex de estrutura: "[N] coisas que separam quem [resultado A] de quem [resultado B]"

REGRAS ABSOLUTAS:
- Extraia a ideia mais surpreendente ou contraintuitiva do artigo como base
- PROIBIDO: "descubra", "aprenda", "conheça", "entenda", frases genéricas ou motivacionais vazias
- PROIBIDO: repetir literalmente palavras do título do artigo
- Sem ponto final
- A frase deve fazer o leitor pensar "preciso saber mais" em menos de 2 segundos

BLOCO 2 — PRIMEIRO SLIDE:
A frase mais instigante do artigo — uma provocação ou verdade que faz o leitor querer continuar. MÁXIMO 20 palavras. Uma ou duas frases curtas e diretas.

BLOCO 3 — SEGUNDO SLIDE:
Aprofunda outra ideia central do artigo. MÁXIMO 20 palavras. Uma ou duas frases curtas.

BLOCO 4 — TERCEIRO SLIDE:
Encerra com uma reflexão ou consequência prática. MÁXIMO 20 palavras. Uma ou duas frases curtas.

REGRA CRÍTICA DE VARIEDADE — OBRIGATÓRIA:
Os blocos 2, 3 e 4 NÃO podem começar com a mesma palavra nem com o mesmo substantivo central do tema. Se o artigo fala sobre "escrita", PROIBIDO iniciar qualquer bloco com "A escrita", "Escrever", "Escrita" ou qualquer variação da palavra-tema. Cada bloco deve abrir com uma construção completamente diferente: um pode começar com o sujeito humano (ex: "Quem escreve…"), outro com uma consequência (ex: "Ao colocar…"), outro com um contraste ou dado. A primeira palavra de cada bloco DEVE ser diferente das outras duas.

Responda APENAS com os 4 blocos separados por linha em branco. Sem introdução, sem numeração, sem títulos.`;

  try {
    const text = await callClaude(prompt, 0.92);
    const allParts = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (allParts.length < 4) throw new Error('Groq não retornou 4 blocos. Tente novamente.');
    const hook  = allParts[0];
    const parts = allParts.slice(1, 4);

    // Valida contagem de palavras dos blocos de conteúdo
    const minWords = [0, 15, 15]; // bloco 2: sem mínimo, blocos 3 e 4: 15+
    for (let i = 0; i < parts.length; i++) {
      const count = parts[i].split(/\s+/).filter(Boolean).length;
      if (count < minWords[i]) throw new Error(`Bloco ${i + 2} veio com apenas ${count} palavras (mínimo ${minWords[i]}). Tente novamente.`);
    }

    console.log('[summarize] ok —', parts.length, 'blocos + gancho:', hook.slice(0, 60));
    res.json({ hook, parts });
  } catch (err) {
    console.error('[summarize] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/copywrite — gera legendas IG + LI com Groq ─────────────────────
app.post('/api/copywrite', async (req, res) => {
  const TIPOS_VALIDOS = ['imagem-perfil', 'carrossel-artigo', 'parabenizacao', 'mudanca-cargo', 'livre'];

  if (!OPENCODE_KEY) return res.status(500).json({ message: 'OPENCODE_KEY não configurada no .env' });

  const { tipo, lider, contexto, avoid } = req.body || {};

  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Campo "tipo" inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (!contexto || typeof contexto !== 'string' || !contexto.trim()) {
    return res.status(400).json({ message: 'Campo "contexto" é obrigatório.' });
  }

  async function callGroq(prompt) {
    const response = await fetch(OPENCODE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENCODE_KEY}` },
      body:    JSON.stringify({
        model:       OPENCODE_MODEL,
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  1400,
        temperature: 0.75,
        stream: false
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

// ── Conselho Image — Google Drive ─────────────────────────────────────────────
// CONSELHO_DRIVE_FOLDER_ID: Google Drive folder ID with council meeting photos
// GOOGLE_SERVICE_ACCOUNT_JSON: path to service account JSON (or inline JSON in env)
app.get('/api/conselho-image', async (req, res) => {
  try {
    const folderId = process.env.CONSELHO_DRIVE_FOLDER_ID;
    if (!folderId) return res.status(503).json({ error: 'CONSELHO_DRIVE_FOLDER_ID not configured' });

    const avoid = JSON.parse(req.query.avoid || '[]');

    // Use Google Drive API v3 with API key or service account
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GOOGLE_API_KEY not configured' });

    const listUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType+contains+'image/'&fields=files(id,name,webContentLink)&key=${apiKey}&pageSize=100`;
    const listRes  = await fetch(listUrl);
    const listData = await listRes.json();
    const files    = (listData.files || []).filter(f => !avoid.includes(f.id));

    if (!files.length) return res.status(404).json({ error: 'No unused images available' });

    const chosen   = files[Math.floor(Math.random() * files.length)];
    const imageUrl = `/api/proxy-image?url=${encodeURIComponent(`https://drive.google.com/uc?export=view&id=${chosen.id}`)}`;

    res.json({ id: chosen.id, url: imageUrl });
  } catch (err) {
    console.error('[conselho-image]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pb/update-cargo — atualiza cargo e histórico de empresas ────────
app.post('/api/pb/update-cargo', async (req, res) => {
  const { pbId, notionId, nome, cargo, empresa, empresasFull } = req.body || {};
  if (!pbId && !notionId) return res.status(400).json({ error: 'pbId ou notionId obrigatório' });
  if (!cargo || !empresa)  return res.status(400).json({ error: 'cargo e empresa obrigatórios' });

  // Rotaciona histórico: prepend nova empresa, mantém 2 mais recentes → 3 total
  const oldList    = (empresasFull || '').split(',').map(s => s.trim()).filter(Boolean);
  const newEmpresas = [empresa, ...oldList.slice(0, 2)].join(', ');

  const errors = [];
  const notionHeaders = {
    'Authorization':  `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json'
  };

  // ── Atualiza PocketBase ───────────────────────────────────────────────────
  if (pbId && PB_BASE_URL) {
    try {
      const token  = await getPbToken();
      const pbRes  = await fetch(`${PB_BASE_URL}/api/collections/lideres/records/${pbId}`, {
        method:  'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cargo_atual: cargo, ultimas_empresa: newEmpresas })
      });
      const data = await pbRes.json();
      if (!pbRes.ok) throw new Error(`PB ${pbRes.status}: ${JSON.stringify(data).slice(0, 200)}`);
      console.log(`[update-cargo] PB atualizado id=${pbId} cargo="${cargo}" empresas="${newEmpresas}"`);
    } catch (err) {
      console.error('[update-cargo] PB erro:', err.message);
      errors.push(`PocketBase: ${err.message}`);
    }
  }

  // ── Resolve Notion page ID ────────────────────────────────────────────────
  let resolvedNotionId = notionId;
  if (!resolvedNotionId && nome && NOTION_KEY && NOTION_DB) {
    try {
      const notionResults = await searchNotion(nome.trim().split(/\s+/)[0]);
      const match = notionResults.find(r => r.name.toLowerCase().includes(nome.trim().split(/\s+/)[0].toLowerCase()));
      if (match) resolvedNotionId = match.id;
    } catch (_) {}
  }

  // ── Atualiza Notion ───────────────────────────────────────────────────────
  if (resolvedNotionId && NOTION_KEY) {
    try {
      // Lê tipos das propriedades para montar o payload correto
      const pageRes  = await fetch(`https://api.notion.com/v1/pages/${resolvedNotionId}`, {
        headers: notionHeaders
      });
      const page  = await pageRes.json();
      const props = page.properties || {};
      const updates = {};

      if (props.ultimas_empresa) {
        const type = props.ultimas_empresa.type;
        if (type === 'multi_select') {
          updates.ultimas_empresa = {
            multi_select: newEmpresas.split(',').map(s => ({ name: s.trim() })).filter(s => s.name)
          };
        } else {
          updates.ultimas_empresa = { rich_text: [{ text: { content: newEmpresas } }] };
        }
      }

      const notionRes  = await fetch(`https://api.notion.com/v1/pages/${resolvedNotionId}`, {
        method:  'PATCH',
        headers: notionHeaders,
        body:    JSON.stringify({ properties: updates })
      });
      const notionData = await notionRes.json();
      if (!notionRes.ok) throw new Error(`Notion ${notionRes.status}: ${JSON.stringify(notionData).slice(0, 200)}`);
      console.log(`[update-cargo] Notion atualizado id=${resolvedNotionId}`);
    } catch (err) {
      console.error('[update-cargo] Notion erro:', err.message);
      errors.push(`Notion: ${err.message}`);
    }
  }

  if (errors.length && errors.length >= 2) {
    return res.status(500).json({ error: errors.join(' | ') });
  }
  res.json({ ok: true, newEmpresas, errors: errors.length ? errors : undefined });
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
