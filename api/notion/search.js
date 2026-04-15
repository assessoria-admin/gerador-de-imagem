// Vercel Serverless Function — GET /api/notion/search?q=...
// Busca pessoas na base Notion pelo campo "user"

const NOTION_KEY = process.env.NOTION_KEY;
const NOTION_DB  = process.env.NOTION_DB;

// Extrai valor de qualquer tipo de propriedade do Notion
function extractProp(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':        return (prop.title        || []).map(t => t.plain_text).join('');
    case 'rich_text':    return (prop.rich_text     || []).map(t => t.plain_text).join('');
    case 'select':       return prop.select?.name  || '';
    case 'multi_select': return (prop.multi_select || []).map(s => s.name).join(', ');
    case 'url':          return prop.url           || '';
    case 'email':        return prop.email         || '';
    case 'phone_number': return prop.phone_number  || '';
    default:             return '';
  }
}

module.exports = async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });

  const headers = {
    'Authorization':  `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json'
  };

  // Tenta filtrar pelo campo "user" como title ou rich_text
  let data = null;
  for (const filterType of ['title', 'rich_text']) {
    try {
      const resp = await fetch(
        `https://api.notion.com/v1/databases/${NOTION_DB}/query`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filter:    { property: 'user', [filterType]: { contains: q } },
            page_size: 10,
            sorts:     [{ property: 'user', direction: 'ascending' }]
          })
        }
      );
      data = await resp.json();
      if (data.object !== 'error') break; // sucesso
    } catch (_) { /* continua para o próximo tipo */ }
  }

  if (!data || data.object === 'error') {
    console.error('[notion-search] erro:', data?.message);
    return res.json({ results: [] });
  }

  const results = (data.results || []).map(page => {
    const props = page.properties || {};

    // Procura LinkedIn: qualquer propriedade com "linkedin" no nome
    let linkedin = '';
    for (const [key, val] of Object.entries(props)) {
      if (key.toLowerCase().includes('linkedin')) {
        linkedin = extractProp(val);
        if (linkedin) break;
      }
    }

    return {
      id:       page.id,
      name:     extractProp(props.user),
      cargo:    extractProp(props.cargo_rede),
      empresas: extractProp(props.ultimas_empresa),
      linkedin
    };
  }).filter(r => r.name);

  console.log(`[notion-search] "${q}" → ${results.length} resultado(s)`);
  res.json({ results });
};
