// ─── Local development server ────────────────────────────────────────────────
// Para rodar localmente: npm start
// Para Vercel: use api/index.js (serverless)
require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const FREEPIK_KEY  = process.env.FREEPIK_KEY;
const FREEPIK_EDIT = process.env.FREEPIK_EDIT;

const NOTION_KEY         = process.env.NOTION_KEY;
const NOTION_DB          = process.env.NOTION_DB;
const NOTION_COAUTORES_DB = process.env.NOTION_COAUTORES_DB;

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent';

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
    const nameLower = name.toLowerCase();

    // Passo 1: encontra a página da pessoa no banco COAUTORES (NOTION_COAUTORES_DB)
    let personPageId = null;
    for (const filterType of ['title', 'rich_text']) {
      const dbResp = await fetch(`https://api.notion.com/v1/databases/${NOTION_COAUTORES_DB}/query`, {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify({
          filter: { property: 'user', [filterType]: { contains: name } },
          page_size: 5
        })
      });
      const dbData = await dbResp.json();
      if (dbData.object === 'error') continue;
      const match = (dbData.results || []).find(p => {
        const arr = p.properties?.user?.title || p.properties?.user?.rich_text || [];
        return richTextToPlain(arr).toLowerCase().includes(nameLower);
      });
      if (match) { personPageId = match.id; break; }
    }

    if (!personPageId) {
      return res.status(404).json({ error: `Pessoa "${name}" não encontrada no banco COAUTORES` });
    }

    // Passo 2: lista os blocos filhos da página da pessoa e acha o ARTIGO
    const childrenResp = await fetch(
      `https://api.notion.com/v1/blocks/${personPageId}/children?page_size=50`,
      { headers: notionHeaders }
    );
    const childrenData = await childrenResp.json();

    const artBlock = (childrenData.results || []).find(block =>
      block.type === 'child_page' &&
      (block.child_page?.title || '').toUpperCase().includes('ARTIGO')
    );

    if (!artBlock) {
      return res.status(404).json({ error: `Subpágina de artigo não encontrada para "${name}"` });
    }

    const articlePageId = artBlock.id;
    const pageTitle = artBlock.child_page?.title || '';

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

// ── POST /api/summarize — resume artigo com Gemini ────────────────────────────
app.post('/api/summarize', async (req, res) => {
  const { article, title } = req.body || {};
  if (!article) return res.status(400).json({ message: 'Campo article obrigatório.' });
  if (!GEMINI_KEY) return res.status(500).json({ message: 'GEMINI_API_KEY não configurada no .env' });

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

    const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parts = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).slice(0, 3);
    if (parts.length < 3) throw new Error('Gemini não retornou 3 blocos. Tente novamente.');

    console.log('[summarize] ok —', parts.length, 'blocos gerados');
    res.json({ parts });
  } catch (err) {
    console.error('[summarize] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/copywrite — gera legendas IG + LI com Gemini ───────────────────
app.post('/api/copywrite', async (req, res) => {
  const TIPOS_VALIDOS = ['imagem-perfil', 'carrossel-artigo', 'parabenizacao', 'mudanca-cargo', 'livre'];
  const COPY_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent';

  if (!GEMINI_KEY) return res.status(500).json({ message: 'GEMINI_API_KEY não configurada no .env' });

  const { tipo, lider, contexto, avoid } = req.body || {};

  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Campo "tipo" inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (!contexto || typeof contexto !== 'string' || !contexto.trim()) {
    return res.status(400).json({ message: 'Campo "contexto" é obrigatório.' });
  }

  const persona = `Você é o redator editorial da Rede Líderes — uma comunidade premium B2B de líderes empresariais do Brasil.
Seu tom é direto, editorial e premium. Nunca corporativo engessado. Nunca genérico.
Nunca use hashtags. Nunca use emojis excessivos (máximo 0, prefira zero).
Escreva sempre em português brasileiro formal-moderno.
Instagram: curto-médio, CTA editorial tipográfico, máximo 600 caracteres.
LinkedIn: insight ou dado primeiro, convite à reflexão no final, máximo 1300 caracteres.

INSTRUÇÕES ESPECÍFICAS POR TIPO:
- mudanca-cargo: escreva APENAS uma legenda de parabenização (Instagram). Parabenize o líder pelo ingresso na nova empresa e nova posição. Mencione o nome completo, o cargo e a empresa. Tom caloroso mas editorial. Sem reflexão profunda, sem história de carreira. Frase de abertura celebratória, frase de fechamento curta convidando a rede a parabenizar ou desejar sucesso. Máximo 350 caracteres. O campo "linkedin" no JSON deve conter o mesmo texto do instagram.`;

  const exemplos = `EXEMPLO 1:
INPUT: Líder: Glauco Sampaio | Cargo: CEO | Empresas: BeePhish, Santander, Banco Votorantim, Cielo | Contexto: Trajetória em cibersegurança, cofundador e CEO da BeePhish
RESPOSTA JSON: {"instagram":"Com uma ampla carreira em grandes empresas como Santander, Banco Votorantim e Cielo, hoje Glauco Sampaio, líder de cibersegurança, é cofundador e CEO da BeePhish, empresa com foco em minimizar o risco humano dentro de negócios de todos os portes.\\n\\nConheça um pouco da sua trajetória e as novidades que estão por vir.","linkedin":"Com uma ampla carreira em grandes empresas como Santander, Banco Votorantim e Cielo, hoje Glauco Sampaio, líder de cibersegurança, é cofundador e CEO da BeePhish, empresa com foco em minimizar o risco humano dentro de negócios de todos os portes.\\n\\nConheça um pouco da sua trajetória e as novidades que estão por vir."}

EXEMPLO 2:
INPUT: Líder: Marli Matos | Cargo: Líder de Finanças | Contexto: Lançamento de livro autoral pela Editora da Rede Líderes
RESPOSTA JSON: {"instagram":"Temos mais um lançamento em nossa Editora. Parabéns, Marli Matos!\\n\\nA Marli é líder de finanças e agora terá sua trajetória posicionada para todo o mercado.","linkedin":"Temos mais um lançamento em nossa Editora. Parabéns, Marli Matos!\\n\\nA Marli é líder de finanças e agora terá sua trajetória posicionada para todo o mercado.\\n\\nDesta vez, com um livro totalmente autoral pela Editora da Rede Líderes. Não é um capítulo. É um livro inteiro dedicado a uma única líder.\\n\\nSua carreira, suas decisões reais, sua visão estratégica sobre o papel de finanças nas organizações e como a tecnologia e vendas podem mudar essa área. O tipo de conteúdo que só quem viveu consegue compartilhar.\\n\\nEm breve, mais detalhes sobre a data de lançamento.\\n\\nwww.redelideres.com"}

EXEMPLO 3:
INPUT: Contexto: Reunião do Conselho sobre gestão de pessoas, premiação Líder Destaque do Ano
RESPOSTA JSON: {"instagram":"Reunimos diversas lideranças em mais uma Reunião de Conselho.\\n\\nO encontro foi dedicado à análise de movimentos que vêm redesenhando a gestão de pessoas nas organizações.","linkedin":"Reunimos diversas lideranças em mais uma Reunião de Conselho.\\n\\nO encontro foi dedicado à análise de movimentos que vêm redesenhando a gestão de pessoas nas organizações.\\n\\nAo reunir diferentes perspectivas em um mesmo espaço de reflexão, ampliamos a leitura sobre os desafios e oportunidades que atravessam as empresas e as carreiras.\\n\\nEncerramos o encontro com a premiação de Líder Destaque do Ano, reconhecendo algumas das lideranças de RH."}

EXEMPLO 4 (mudanca-cargo):
INPUT: Tipo: mudanca-cargo | Líder: Rafael Torres | Cargo: VP de Operações | Empresas: Loggi | Contexto: Parabenização por nova posição: VP de Operações na Loggi
RESPOSTA JSON: {"instagram":"Parabéns, Rafael Torres!\\n\\nRafael acaba de assumir a posição de VP de Operações na Loggi. Desejamos muito sucesso nessa nova jornada.","linkedin":"Parabéns, Rafael Torres!\\n\\nRafael acaba de assumir a posição de VP de Operações na Loggi. Desejamos muito sucesso nessa nova jornada."}`;

  const liderLine = lider
    ? `Líder: ${lider.name}${lider.cargo ? ` | Cargo: ${lider.cargo}` : ''}${lider.empresas ? ` | Empresas: ${lider.empresas}` : ''}`
    : null;

  const requestLines = [
    `Tipo: ${tipo}`,
    liderLine,
    `Contexto: ${contexto.trim()}`,
    avoid ? `Evite repetir: ${avoid}` : null
  ].filter(Boolean).join('\n');

  const prompt = `${persona}\n\n${exemplos}\n\nAGORA GERE PARA:\n${requestLines}\n\nRetorne APENAS o JSON, sem markdown, sem explicações: {"instagram":"...","linkedin":"..."}`;

  try {
    const response = await fetch(`${COPY_URL}?key=${GEMINI_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || response.statusText);

    const raw      = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const match    = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Resposta do Gemini não contém JSON válido.');
    const result = JSON.parse(match[0]);

    if (!result.instagram || !result.linkedin) throw new Error('JSON retornado pelo Gemini está incompleto.');

    console.log('[copywrite] ok — tipo:', tipo, lider ? `| líder: ${lider.name}` : '');
    res.json({ instagram: result.instagram, linkedin: result.linkedin });

  } catch (err) {
    console.error('[copywrite] erro:', err.message);
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
