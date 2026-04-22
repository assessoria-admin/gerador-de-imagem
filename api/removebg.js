// Vercel Serverless Function — POST /api/removebg
// Recebe { imageUrl } ou { imageBase64 }, passa pelo Remove.bg e retorna PNG transparente em base64

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido.' });
  }

  const REMOVEBG_KEY = process.env.REMOVEBG_KEY;
  if (!REMOVEBG_KEY) {
    return res.status(500).json({ message: 'REMOVEBG_KEY não configurada no .env' });
  }

  const { imageUrl, imageBase64 } = req.body || {};
  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ message: 'Informe imageUrl ou imageBase64.' });
  }

  try {
    const formData = new FormData();
    formData.append('size', 'auto');

    if (imageUrl) {
      formData.append('image_url', imageUrl);
    } else {
      // Remove o prefixo data:image/...;base64, se presente
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
      console.error('[removebg] erro:', rbRes.status, errText.slice(0, 200));
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
};
