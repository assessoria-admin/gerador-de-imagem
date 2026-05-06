// Vercel Serverless Function — GET /api/pocketbase/search?q=...
// Busca líderes na coleção "lideres" do PocketBase

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
  _tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 min
  return _token;
}

module.exports = async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });

  try {
    const token = await getToken();
    const filter = encodeURIComponent(`nome ~ "${q}"`);
    const resp = await fetch(
      `${PB_BASE_URL}/api/collections/lideres/records?filter=${filter}&perPage=10&sort=nome`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await resp.json();

    const results = (data.items || []).map(r => {
      const cargoRede = Array.isArray(r.cargo_rede) ? r.cargo_rede[0] : r.cargo_rede;
      let photoUrl = '';
      if (r.foto_ia) {
        photoUrl = `${PB_BASE_URL}/api/files/lideres/${r.id}/${r.foto_ia}`;
      } else if (Array.isArray(r.foto) && r.foto.length > 0) {
        photoUrl = `${PB_BASE_URL}/api/files/lideres/${r.id}/${r.foto[0]}`;
      }

      return {
        id:       r.id,
        name:     r.nome || '',
        cargo:    cargoRede || r.cargo_atual || '',
        empresas: r.ultimas_empresa || r.nome_empresa_atual || '',
        photoUrl
      };
    }).filter(r => r.name);

    console.log(`[pb-search] "${q}" → ${results.length} resultado(s)`);
    res.json({ results });
  } catch (err) {
    console.error('[pb-search] erro:', err.message);
    res.json({ results: [] });
  }
};
