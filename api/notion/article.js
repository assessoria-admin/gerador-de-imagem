// Vercel Serverless Function — GET /api/notion/article?name=...
// Busca a página "ARTIGO - REDE LÍDERES (Nome)" e retorna título (CAPS) + texto limpo

const NOTION_KEY = process.env.NOTION_KEY;

const headers = {
  'Authorization':  `Bearer ${NOTION_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type':   'application/json'
};

const INSTRUCAO_REVISAO = 'Segue o seu artigo para revisão';

function richTextToPlain(arr) {
  return (arr || []).map(t => t.plain_text).join('');
}

// Título em CAPS LOCK: >80% letras maiúsculas, mínimo 10 chars
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
    const resp = await fetch(url.toString(), { headers });
    const data = await resp.json();
    if (data.object === 'error') break;
    blocks.push(...(data.results || []));
    cursor = data.next_cursor;
  } while (cursor);
  return blocks;
}

async function fetchBlocksText(blockId) {
  let text = '';
  const blocks = await fetchBlocks(blockId);
  for (const block of blocks) {
    const type = block.type;
    const content = block[type];
    if (!content) continue;
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

module.exports = async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Parâmetro name obrigatório' });

  try {
    const NOTION_COAUTORES_DB = process.env.NOTION_COAUTORES_DB;
    const nameLower = name.toLowerCase();

    // Passo 1: encontra a página da pessoa no banco COAUTORES
    let personPageId = null;
    for (const filterType of ['title', 'rich_text']) {
      const dbResp = await fetch(`https://api.notion.com/v1/databases/${NOTION_COAUTORES_DB}/query`, {
        method: 'POST',
        headers,
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

    // Passo 2: lista filhos da página da pessoa e acha o ARTIGO
    const childrenResp = await fetch(
      `https://api.notion.com/v1/blocks/${personPageId}/children?page_size=50`,
      { headers }
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

    // Percorre blocos extraindo título CAPS e corpo
    const allBlocks = await fetchBlocks(articlePageId);
    let articleTitle = '';
    let articleText = '';

    for (const block of allBlocks) {
      const type = block.type;
      const content = block[type];
      if (!content) continue;

      if (type === 'callout') {
        const calloutText = richTextToPlain(content.rich_text);
        if (calloutText.includes(INSTRUCAO_REVISAO)) continue;
      }

      const richTypes = ['paragraph','heading_1','heading_2','heading_3','bulleted_list_item','numbered_list_item','quote','callout'];
      if (richTypes.includes(type)) {
        const line = richTextToPlain(content.rich_text).trim();
        if (!line) continue;
        if (!articleTitle && isAllCapsTitle(line)) {
          articleTitle = line;
          continue;
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
};
