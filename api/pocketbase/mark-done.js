// Vercel Serverless Function — PATCH /api/pb/mark-done
// Marca carrossel_criado=true no PocketBase db_artigos

const PB_BASE_URL      = process.env.PB_BASE_URL;
const PB_ADMIN_EMAIL   = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await fetch(`${PB_BASE_URL}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD })
  });
  const data = await res.json();
  if (!data.token) throw new Error('PocketBase auth failed');
  _token = data.token;
  _tokenExpiry = Date.now() + 50 * 60 * 1000;
  return _token;
}

module.exports = async (req, res) => {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obrigatório' });
  try {
    const token = await getToken();
    const pbRes = await fetch(`${PB_BASE_URL}/api/collections/db_artigos/records/${id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrossel_criado: true })
    });
    const data = await pbRes.json();
    if (!pbRes.ok) throw new Error(`PB ${pbRes.status}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[mark-done] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
};
