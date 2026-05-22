// Vercel Serverless Function — GET /api/pb/artigos-disponiveis
// Lista artigos pendentes de carrossel do PocketBase db_artigos

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
  if (!PB_BASE_URL || !PB_ADMIN_EMAIL) return res.json({ artigos: [] });
  try {
    const token = await getToken();
    const filter = encodeURIComponent('carrossel_criado = false');
    const expand = 'co_autor';
    // Fetch a small batch and pick 1 randomly (fast + variety)
    const url = `${PB_BASE_URL}/api/collections/db_artigos/records?filter=${filter}&expand=${expand}&perPage=10`;
    const pbRes = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await pbRes.json();
    if (!pbRes.ok) throw new Error(`PB ${pbRes.status}`);

    const validos = (data.items || []).map(r => {
      const coAutor = r.expand?.co_autor;
      if (!coAutor || !coAutor.foto_ia) return null;
      return {
        id:     r.id,
        artigo: r.artigo || '',
        texto:  r.texto || '',
        lider:  {
          id:         coAutor.id,
          name:       coAutor.nome || '',
          cargo:      coAutor.cargo_rede || coAutor.cargo_atual || '',
          cargo_rede: coAutor.cargo_rede || '',
          empresas:   coAutor.ultimas_empresa || '',
          photoUrl:   `${PB_BASE_URL}/api/files/lideres/${coAutor.id}/${coAutor.foto_ia}`
        }
      };
    }).filter(a => a && a.artigo && a.lider?.photoUrl);

    // Pick 1 randomly
    const artigos = validos.length > 0 ? [validos[Math.floor(Math.random() * validos.length)]] : [];

    res.json({ artigos });
  } catch (err) {
    console.error('[artigos-disponiveis] erro:', err.message);
    res.json({ artigos: [] });
  }
};
