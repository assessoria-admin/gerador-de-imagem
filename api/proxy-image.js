// Vercel Serverless Function — GET /api/proxy-image?url=...
// Baixa imagem de URL externa e repassa ao browser (evita CORS no canvas)

module.exports = async (req, res) => {
  const { url } = req.query;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ message: 'URL inválida.' });
  }

  try {
    const imgRes = await fetch(url);

    if (!imgRes.ok) {
      return res.status(imgRes.status).json({ message: 'Erro ao buscar imagem.' });
    }

    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const buffer      = await imgRes.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('[proxy-image] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
};
