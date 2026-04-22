// Vercel Serverless Function — POST /api/generate
// Proxy para Gemini Imagen (resolve CORS do browser)

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

const handler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!GEMINI_KEY) {
    return res.status(500).json({ message: 'Variável de ambiente GEMINI_API_KEY não configurada.' });
  }

  const { prompt, reference_images } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ message: 'Campo "prompt" é obrigatório.' });
  }

  const parts = [{ text: prompt }];

  if (Array.isArray(reference_images) && reference_images.length > 0) {
    for (const ref of reference_images) {
      parts.push({
        inlineData: {
          mimeType: ref.mime_type || 'image/jpeg',
          data: ref.image
        }
      });
    }
  }

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT']
        }
      })
    });

    const data = await geminiRes.json();
    console.log('[generate] status:', geminiRes.status);

    if (!geminiRes.ok) {
      const msg = data?.error?.message || geminiRes.statusText;
      console.error('[generate] erro Gemini:', msg);
      return res.status(geminiRes.status).json({ message: msg });
    }

    const parts_out = data?.candidates?.[0]?.content?.parts || [];
    const imgPart   = parts_out.find(p => p.inlineData?.data);

    if (!imgPart) {
      console.error('[generate] sem imagem na resposta:', JSON.stringify(data).slice(0, 500));
      return res.status(500).json({ message: 'Gemini não retornou imagem. Verifique o prompt ou a chave da API.' });
    }

    const { mimeType, data: b64 } = imgPart.inlineData;
    const dataUrl = `data:${mimeType};base64,${b64}`;

    // Mantém o mesmo contrato de resposta "immediate" esperado pelo frontend
    res.status(200).json({ data: { generated: [dataUrl] } });

  } catch (err) {
    console.error('[generate] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
};

handler.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

module.exports = handler;
module.exports.config = handler.config;
