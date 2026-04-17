// ─── Local development server ────────────────────────────────────────────────
// Para rodar localmente: npm start
// Para Vercel: use api/index.js (serverless)
require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const FREEPIK_KEY = process.env.FREEPIK_KEY;
const FREEPIK_EDIT = process.env.FREEPIK_EDIT;

const NOTION_KEY = process.env.NOTION_KEY;
const NOTION_DB = process.env.NOTION_DB;

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname)));

// ── POST /api/generate — inicia a geração ─────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  try {
    console.log('[generate] enviando para Freepik...');

    if (!FREEPIK_KEY || !FREEPIK_EDIT) {
      return res.status(500).json({
        message: 'Variáveis de ambiente FREEPIK_KEY ou FREEPIK_EDIT não configuradas'
      });
    }

    const freepikRes = await fetch(FREEPIK_EDIT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-freepik-api-key': FREEPIK_KEY
      },
      body: JSON.stringify(req.body)
    });

    const data = await freepikRes.json();
    console.log('[generate] status Freepik:', freepikRes.status, JSON.stringify(data));
    res.status(freepikRes.status).json(data);

  } catch (err) {
    console.error('[generate] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/generate/:taskId — polling de status ─────────────────────────────
app.get('/api/generate/:taskId', async (req, res) => {
  try {
    if (!FREEPIK_KEY || !FREEPIK_EDIT) {
      return res.status(500).json({
        message: 'Variáveis de ambiente não configuradas'
      });
    }

    const freepikRes = await fetch(`${FREEPIK_EDIT}/${req.params.taskId}`, {
      headers: { 'x-freepik-api-key': FREEPIK_KEY }
    });

    const data = await freepikRes.json();
    console.log('[poll] taskId:', req.params.taskId, '— status:', data?.data?.status || data?.status);
    res.status(freepikRes.status).json(data);

  } catch (err) {
    console.error('[poll] erro:', err.message);
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
      if ((k === 'foto' || k === 'photo') && !fotoProp) {
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
