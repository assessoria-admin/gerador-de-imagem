// ─── Profile Image Generator — Serverless API ───────────────────────────────
// Para Vercel: use api/index.js, não server.js
require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();

const FREEPIK_KEY = process.env.FREEPIK_KEY;
const FREEPIK_EDIT = process.env.FREEPIK_EDIT;

const NOTION_KEY = process.env.NOTION_KEY;
const NOTION_DB = process.env.NOTION_DB;

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '30mb' })); // suporta fotos grandes
app.use(express.static(path.join(__dirname, '..'))); // serve HTML da pasta pai

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
        filter: {
          or: [
            {
              property: 'Name',
              title: { contains: q }
            }
          ]
        },
        page_size: 10
      })
    });

    if (!notionRes.ok) {
      console.error('[notion-search] erro Notion:', notionRes.status);
      return res.json({ results: [] });
    }

    const data = await notionRes.json();

    const results = (data.results || []).map(page => {
      const props = page.properties || {};
      return {
        id: page.id,
        name: props.Name?.title?.[0]?.plain_text || '',
        cargo: props.Cargo?.rich_text?.[0]?.plain_text || '',
        empresas: props.Empresas?.rich_text?.[0]?.plain_text || '',
        linkedin: props.LinkedIn?.url || ''
      };
    }).filter(r => r.name);

    res.json({ results });

  } catch (err) {
    console.error('[notion-search] erro:', err.message);
    res.json({ results: [] });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Export para Vercel
module.exports = app;
