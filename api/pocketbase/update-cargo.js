// Vercel Serverless Function — POST /api/pb/update-cargo
// Atualiza cargo e histórico de empresas no PocketBase e Notion

const PB_BASE_URL  = process.env.PB_BASE_URL;
const PB_ADMIN_EMAIL    = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;
const NOTION_KEY   = process.env.NOTION_KEY;
const NOTION_DB    = process.env.NOTION_DB;

let _token = null;
let _tokenExpiry = 0;

async function getPbToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
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
      _token = d.token;
      _tokenExpiry = Date.now() + 50 * 60 * 1000;
      return _token;
    }
  }
  throw new Error('PocketBase auth falhou');
}

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
          page_size: 10
        })
      });
      const data = await resp.json();
      if (data.object !== 'error') {
        return (data.results || []).map(p => {
          const props = p.properties || {};
          const name = (props.user?.title || props.user?.rich_text || []).map(t => t.plain_text).join('');
          return { id: p.id, name };
        }).filter(r => r.name);
      }
    } catch (_) {}
  }
  return [];
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pbId, notionId, nome, cargo, empresa, empresasFull } = req.body || {};
  if (!pbId && !notionId) return res.status(400).json({ error: 'pbId ou notionId obrigatório' });
  if (!cargo || !empresa)  return res.status(400).json({ error: 'cargo e empresa obrigatórios' });

  const oldList     = (empresasFull || '').split(',').map(s => s.trim()).filter(Boolean);
  const newEmpresas = [empresa, ...oldList.slice(0, 2)].join(', ');
  const notionHeaders = {
    'Authorization':  `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json'
  };

  const errors = [];

  if (pbId && PB_BASE_URL) {
    try {
      const token = await getPbToken();
      const pbRes = await fetch(`${PB_BASE_URL}/api/collections/lideres/records/${pbId}`, {
        method:  'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cargo_atual: cargo, ultimas_empresa: newEmpresas })
      });
      const data = await pbRes.json();
      if (!pbRes.ok) throw new Error(`PB ${pbRes.status}: ${JSON.stringify(data).slice(0, 200)}`);
      console.log(`[update-cargo] PB atualizado id=${pbId}`);
    } catch (err) {
      console.error('[update-cargo] PB erro:', err.message);
      errors.push(`PocketBase: ${err.message}`);
    }
  }

  let resolvedNotionId = notionId;
  if (!resolvedNotionId && nome && NOTION_KEY && NOTION_DB) {
    try {
      const results = await searchNotion(nome.trim().split(/\s+/)[0]);
      const match = results.find(r => r.name.toLowerCase().includes(nome.trim().split(/\s+/)[0].toLowerCase()));
      if (match) resolvedNotionId = match.id;
    } catch (_) {}
  }

  if (resolvedNotionId && NOTION_KEY) {
    try {
      const pageRes = await fetch(`https://api.notion.com/v1/pages/${resolvedNotionId}`, {
        headers: notionHeaders
      });
      const page  = await pageRes.json();
      const props = page.properties || {};
      const updates = {};

      if (props.ultimas_empresa) {
        const type = props.ultimas_empresa.type;
        updates.ultimas_empresa = type === 'multi_select'
          ? { multi_select: newEmpresas.split(',').map(s => ({ name: s.trim() })).filter(s => s.name) }
          : { rich_text: [{ text: { content: newEmpresas } }] };
      }

      const notionRes = await fetch(`https://api.notion.com/v1/pages/${resolvedNotionId}`, {
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

  if (errors.length >= 2) return res.status(500).json({ error: errors.join(' | ') });
  res.json({ ok: true, newEmpresas, errors: errors.length ? errors : undefined });
};
