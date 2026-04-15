// Vercel Serverless Function — POST /api/generate
// Proxy para a Freepik API (resolve CORS do browser)

const FREEPIK_KEY  = process.env.FREEPIK_KEY;
const FREEPIK_EDIT = process.env.FREEPIK_EDIT;

// Aumenta o limite do body parser para suportar imagens base64
module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!FREEPIK_KEY || !FREEPIK_EDIT) {
    return res.status(500).json({ message: 'Variáveis de ambiente FREEPIK_KEY / FREEPIK_EDIT não configuradas no Vercel.' });
  }

  try {
    const freepikRes = await fetch(FREEPIK_EDIT, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-freepik-api-key': FREEPIK_KEY
      },
      body: JSON.stringify(req.body)
    });

    const data = await freepikRes.json();
    console.log('[generate]', freepikRes.status, JSON.stringify(data).slice(0, 300));
    res.status(freepikRes.status).json(data);

  } catch (err) {
    console.error('[generate] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
};
