// ─── Profile Image Generator — Proxy Server ──────────────────────────────────
// Resolve CORS: o browser não pode chamar api.freepik.com diretamente.
// Este servidor faz as chamadas server-side e repassa o resultado ao frontend.
// Requisito: Node.js >= 18  (fetch nativo)
// Uso: npm install  →  npm start  →  abra http://localhost:3000
require('dotenv').config();
const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const FREEPIK_KEY  = process.env.FREEPIK_KEY;
const FREEPIK_EDIT = process.env.FREEPIK_EDIT;

const NOTION_KEY = process.env.NOTION_KEY;
const NOTION_DB  = process.env.NOTION_DB;

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '30mb' }));          // suporta fotos grandes
app.use(express.static(path.join(__dirname)));      // serve index.html etc.

// ── POST /api/generate — inicia a geração ─────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  try {
    console.log('[generate] enviando para Freepik...');

    const freepikRes = await fetch(FREEPIK_EDIT, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
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
    const imgRes      = await fetch(url);
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const buffer      = await imgRes.arrayBuffer();

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('[proxy-image] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n─────────────────────────────────────────');
  console.log(`  Profile Generator → http://localhost:${PORT}`);
  console.log('─────────────────────────────────────────\n');
});
