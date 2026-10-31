// =====================================================================
// Centime — relais Enable Banking (Cloudflare Worker, gratuit)
// À coller tel quel dans Cloudflare : Workers & Pages → ton Worker → Modifier le code.
// Variables à ajouter dans Paramètres → Variables et secrets :
//   APP_ID       (Texte)   l'identifiant de ton application Enable Banking
//   PRIVATE_KEY  (Secret)  tout le contenu du fichier .pem
//   RELAY_TOKEN  (Secret)  un mot de passe long que tu inventes (le même dans Centime)
//   ALLOWED_ORIGIN (Texte, facultatif) https://laurentureta.github.io
// =====================================================================
const API = 'https://api.enablebanking.com';
const ALLOWED = [/^\/aspsps$/, /^\/auth$/, /^\/sessions(\/[\w-]+)?$/, /^\/accounts\/[\w-]+\/(transactions|balances|details)$/];

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = s => b64u(new TextEncoder().encode(s));
function derLen(n) { if (n < 128) return [n]; const b = []; while (n) { b.unshift(n & 255); n >>= 8; } return [0x80 | b.length, ...b]; }
function pkcs1to8(der) {
  const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const oct = [0x04, ...derLen(der.length), ...der], body = [0x02, 0x01, 0x00, ...algo, ...oct];
  return new Uint8Array([0x30, ...derLen(body.length), ...body]);
}
let cached = null;
async function key(pem) {
  if (cached && cached.pem === pem) return cached.key;
  let der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) der = pkcs1to8([...der]);
  const k = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  cached = { pem, key: k };
  return k;
}
async function jwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64uStr(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: env.APP_ID.trim() }));
  const p = b64uStr(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await key(env.PRIVATE_KEY), new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(s);
}

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type, x-relay-token', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Vary': 'Origin' };
    const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.RELAY_TOKEN || req.headers.get('x-relay-token') !== env.RELAY_TOKEN) return reply({ message: 'mot de passe du relais incorrect' }, 403);
    if (!env.APP_ID || !env.PRIVATE_KEY) return reply({ message: 'APP_ID ou PRIVATE_KEY manquant dans les variables du Worker' }, 500);
    const u = new URL(req.url);
    if (!ALLOWED.some(r => r.test(u.pathname))) return reply({ message: 'chemin non autorisé' }, 404);
    try {
      const r = await fetch(API + u.pathname + u.search, {
        method: req.method,
        headers: { Authorization: 'Bearer ' + await jwt(env), 'Content-Type': 'application/json' },
        body: req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text(),
      });
      return reply(await r.text(), r.status);
    } catch (e) {
      return reply({ message: 'relais : ' + e.message }, 502);
    }
  },
};
