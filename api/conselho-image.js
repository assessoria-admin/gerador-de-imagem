// Vercel Serverless Function — GET /api/conselho-image
// Retorna uma imagem aleatória da pasta do Google Drive do Conselho

module.exports = async (req, res) => {
  try {
    const folderId = process.env.CONSELHO_DRIVE_FOLDER_ID;
    if (!folderId) return res.status(503).json({ error: 'CONSELHO_DRIVE_FOLDER_ID not configured' });

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GOOGLE_API_KEY not configured' });

    const avoid = JSON.parse(req.query.avoid || '[]');

    const listUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType+contains+'image/'&fields=files(id,name,webContentLink)&key=${apiKey}&pageSize=100`;
    const listRes  = await fetch(listUrl);
    const listData = await listRes.json();
    const files    = (listData.files || []).filter(f => !avoid.includes(f.id));

    if (!files.length) return res.status(404).json({ error: 'No unused images available' });

    const chosen   = files[Math.floor(Math.random() * files.length)];
    const imageUrl = `/api/proxy-image?url=${encodeURIComponent(`https://drive.google.com/uc?export=view&id=${chosen.id}`)}`;

    res.json({ id: chosen.id, url: imageUrl });
  } catch (err) {
    console.error('[conselho-image]', err.message);
    res.status(500).json({ error: err.message });
  }
};
