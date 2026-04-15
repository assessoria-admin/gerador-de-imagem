// Vercel Serverless Function — GET /api/generate/:taskId
// Polling de status da tarefa na Freepik API

const FREEPIK_KEY  = process.env.FREEPIK_KEY;
const FREEPIK_EDIT = process.env.FREEPIK_EDIT;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { taskId } = req.query;

  if (!taskId) {
    return res.status(400).json({ message: 'taskId ausente.' });
  }

  try {
    const freepikRes = await fetch(`${FREEPIK_EDIT}/${taskId}`, {
      headers: { 'x-freepik-api-key': FREEPIK_KEY }
    });

    const data = await freepikRes.json();
    console.log('[poll]', taskId, '→', data?.data?.status || data?.status);
    res.status(freepikRes.status).json(data);

  } catch (err) {
    console.error('[poll] erro:', err.message);
    res.status(500).json({ message: err.message });
  }
};
