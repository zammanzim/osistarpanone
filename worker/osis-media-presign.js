// =========================================================================
// WORKER: osis-media-presign — penerbit presigned URL R2 untuk frontend statis
// Arsitektur: browser -> Worker (/presign, validasi + allowlist folder)
// -> dapat URL PUT/DELETE -> browser upload langsung ke R2.
// Secret (R2 + service_role) TIDAK PERNAH ke frontend. Baca publik via domain R2.
//
// AUTH (login app = Supabase Auth, dipetakan ke osis_users via kolom auth_id):
// - PUT formulir/f-<id>-<ts>.<ext>: PUBLIK (responden form tanpa login).
// - Lainnya: JWT valid + auth_id terlink ke osis_users. Akun liar hasil
//   signUp bebas = 403. Hak per modul dicek RPC masing-masing saat simpan.
//
// DEPLOY (sekali):
//   1. R2: buat bucket (mis. osis-media), pasang custom domain
//      (mis. https://media.osistarpanone.my.id), atur CORS:
//      AllowOrigin=https://osistarpanone.my.id,
//      AllowMethods=GET,PUT,DELETE,HEAD, AllowHeaders=Content-Type.
//   2. R2 API token (S3-compatible): simpan sebagai secret worker.
//   3. cd worker && npx wrangler secret put R2_ACCESS_KEY (dst, lihat
//      wrangler.toml) && npx wrangler deploy
//   4. Isi R2_PRESIGN_URL di js/config.js dengan URL worker ini + /presign.
// =========================================================================

// Folder yang boleh ditulis/dihapus — SAMA dengan folder di bucket lama
// osis-foto, plus "moments" (halaman Moments, migrasi-moments.sql)
// dan "feed" (halaman Feed, migrasi-feed.sql).
// Key R2 dipertahankan identik (gallery/xxx.jpg) agar isi DB
// (path relatif) tidak perlu diubah.
const FOLDER_BOLEH = new Set([
  "gallery", "web", "angkatan", "prestasi", "kegiatan", "agenda",
  "profil", "anggota", "pengurus", "sekbid", "pimpinan", "notulensi", "proker",
  "program", "dokumen", "kas", "evaluasi", "formulir", "polling", "poster",
  "moments", "feed", "arsip", "informasi",
]);

// Tipe konten yang boleh diupload. Tolak executable/script.
const CONTENT_BOLEH = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
  "video/mp4", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/webm",
]);

const UMUR_PRESIGN_DETIK = 90;
const MAKS_PATH = 512;

function originBoleh(origin, env) {
  if (!origin || origin === "null") return true; // "null" = dibuka via file:// saat testing lokal
  const daftar = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (daftar.length === 0 || daftar.includes("*") || daftar.includes(origin)) return true;
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  // localhost / 127.0.0.1 (port berapa pun) selalu boleh — buat testing lokal.
  if (host === "localhost" || host === "127.0.0.1") return true;
  // Skema lain (http vs https) atau subdomain dari domain yang sama tetap boleh.
  return daftar.some((d) => {
    try {
      const h = new URL(d).hostname;
      return host === h || host.endsWith("." + h);
    } catch {
      return false;
    }
  });
}

function corsHeaders(env, req) {
  const origin = req.headers.get("Origin") || "";
  const boleh = originBoleh(origin, env);
  return {
    "Access-Control-Allow-Origin": boleh ? (origin || "*") : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(obj, status, env, req) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env, req) },
  });
}

function validasiPath(path) {
  if (typeof path !== "string" || !path || path.length > MAKS_PATH) return false;
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
  const seg = path.split("/");
  if (seg.length < 2) return false; // wajib folder/namafile
  if (!FOLDER_BOLEH.has(seg[0])) return false;
  if (seg.some((s) => !s || s === "." || s === "..")) return false;
  return /^[A-Za-z0-9._\/-]+$/.test(path);
}

// --- Minimal SigV4 (Web Crypto, tanpa dependensi) untuk presign S3/R2 ---
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(d);
}

async function hmacBytes(keyBuf, text) {
  const k = await crypto.subtle.importKey("raw", keyBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
}

async function signingKey(secret, dateStamp, region, service) {
  const kDate = await hmacBytes(new TextEncoder().encode("AWS4" + secret), dateStamp);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, service);
  return hmacBytes(kService, "aws4_request");
}

function encodeKey(key) {
  return key.split("/").map((s) => encodeURIComponent(s)).join("/");
}

// Presign GET/PUT/DELETE tanpa signed content-type (pakai UNSIGNED-PAYLOAD)
// supaya browser bebas kirim Content-Type apa pun yang diizinkan.
async function presignUrl({ method, endpoint, bucket, key, accessKey, secretKey, region, expiresIn }) {
  const ep = new URL(endpoint);
  const host = ep.host;
  const canonicalUri = "/" + bucket + "/" + encodeKey(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"; // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  });
  const sortedQuery = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonicalHeaders = `host:${host}\n`;
  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalRequest = [method, canonicalUri, sortedQuery, canonicalHeaders, "host", payloadHash].join("\n");
  const hashedCanonical = await sha256Hex(canonicalRequest);
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hashedCanonical].join("\n");
  const key2 = await signingKey(secretKey, dateStamp, region, "s3");
  const k = await crypto.subtle.importKey("raw", key2, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = toHex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(stringToSign)));
  return `${endpoint.replace(/\/$/, "")}${canonicalUri}?${sortedQuery}&X-Amz-Signature=${sig}`;
}

// Upload jawaban form publik (responden tanpa login) memakai path berpola
// formulir/f-<idform>-<timestamp>.<ext> — SATU-SATUNYA presign publik (PUT saja).
// Hapus di folder itu + semua folder lain wajib JWT + akun OSIS + punya hak.
const POLA_PUBLIK = /^formulir\/f-\d+-\d+\.[a-z0-9]+$/;

// Validasi JWT via Supabase Auth API. return {state, authUserId}.
// state: "ok" | "tanpa-token" | "token-basi"
async function jwtValid(env, req) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.length < 20) return { state: "tanpa-token", authUserId: null };
  try {
    // Validasi via Supabase Auth API — tanpa perlu JWT secret di Worker.
    const r = await fetch(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        "apikey": env.SUPABASE_ANON_KEY,
        "Authorization": auth,
      },
    });
    if (!r.ok) return { state: "token-basi", authUserId: null };
    const me = await r.json();
    return { state: "ok", authUserId: (me && me.id) || null };
  } catch {
    return { state: "token-basi", authUserId: null };
  }
}

// Cek akun OSIS terlink (pakai service_role, tetap di Worker).
// Syarat upload = linked saja (ada baris osis_users untuk auth_id ini).
// Alasan: hak per modul (mis. agenda sekbid sendiri) dimengerti RPC
// masing-masing, bukan Worker — file yatim tanpa baris data tidak berdampak.
// return osis user id (>0) atau 0 = tidak berhak.
async function cekHakOsis(env, authUserId) {
  if (!authUserId || !env.SUPABASE_SERVICE_KEY) return 0;
  try {
    const base = String(env.SUPABASE_URL).replace(/\/$/, "");
    const h = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY };
    const r1 = await fetch(`${base}/rest/v1/osis_users?auth_id=eq.${authUserId}&select=id`, { headers: h });
    if (!r1.ok) return 0;
    const arr = await r1.json();
    const osisId = arr && arr[0] && arr[0].id;
    return osisId || 0; // JWT valid tapi bukan anggota OSIS (pendaftar liar) = 0
  } catch {
    return 0;
  }
}

// Cek super admin (tabel osis_super_admins, kolom username).
// return true kalau username OSIS pengirim terdaftar sebagai super admin.
async function cekSuper(env, authUserId) {
  if (!authUserId || !env.SUPABASE_SERVICE_KEY) return false;
  try {
    const base = String(env.SUPABASE_URL).replace(/\/$/, "");
    const h = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY };
    const r1 = await fetch(`${base}/rest/v1/osis_users?auth_id=eq.${authUserId}&select=username`, { headers: h });
    if (!r1.ok) return false;
    const arr = await r1.json();
    const uname = arr && arr[0] && String(arr[0].username || "").trim();
    if (!uname) return false;
    const r2 = await fetch(`${base}/rest/v1/osis_super_admins?username=eq.${encodeURIComponent(uname)}&select=username`, { headers: h });
    if (!r2.ok) return false;
    const arr2 = await r2.json();
    return Array.isArray(arr2) && arr2.length > 0;
  } catch {
    return false;
  }
}

// =========================================================================
// WEB PUSH (/push-kirim) — kirim notif ke HP subscriber (PWA).
// Secret baru (npx wrangler secret put ...):
//   VAPID_PUBLIC  (65-byte uncompressed P-256, base64url, 87 char)
//   VAPID_PRIVATE (32-byte, base64url, 43 char)
//   VAPID_SUBJECT (mailto:..., default mailto:admin@osistarpanone.my.id)
// Enkripsi: RFC8291 aes128gcm (ECDH P-256 + HKDF-SHA256 + AES-GCM), tanpa deps.
// =========================================================================

function b64uKeBytes(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesKeB64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, ikm);
  return new Uint8Array(sig);
}

async function hkdfExpand(prk, info, len) {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const out = [];
  let prev = new Uint8Array(0);
  let i = 1;
  while (out.length * 32 < len) {
    const data = new Uint8Array(prev.length + info.length + 1);
    data.set(prev, 0);
    data.set(info, prev.length);
    data[data.length - 1] = i;
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
    out.push(sig);
    prev = sig;
    i++;
    if (i > 10) break;
  }
  const flat = new Uint8Array(out.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of out) { flat.set(c, o); o += c.length; }
  return flat.slice(0, len);
}

// JWT VAPID (ES256) untuk satu push-service origin (aud = https://fcm.googleapis.com).
async function vapidJwt(asalPush, env) {
  const pub = b64uKeBytes(env.VAPID_PUBLIC);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC salah format.");
  const x = bytesKeB64u(pub.slice(1, 33));
  const y = bytesKeB64u(pub.slice(33, 65));
  const jwk = { kty: "EC", crv: "P-256", x, y, d: String(env.VAPID_PRIVATE).trim() };
  const kunci = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = bytesKeB64u(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const sub = String(env.VAPID_SUBJECT || "mailto:admin@osistarpanone.my.id");
  const pay = bytesKeB64u(new TextEncoder().encode(JSON.stringify({ aud: asalPush, exp, sub })));
  const data = new TextEncoder().encode(head + "." + pay);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kunci, data));
  // DER -> raw r||s (64 byte) untuk JWT
  function derKeRaw(der) {
    let o = 2; // skip 0x30 len
    if (der[1] & 0x80) o = 2 + (der[1] & 0x7f);
    o += 1; // 0x02
    let lenR = der[o]; o += 1;
    let r = der.slice(o, o + lenR); o += lenR;
    o += 1; // 0x02
    let lenS = der[o]; o += 1;
    let s = der.slice(o, o + lenS);
    const pad = (b) => { while (b.length > 32) b = b.slice(b.length - 32); while (b.length < 32) b = new Uint8Array([0, ...b]); return b.slice(-32); };
    const out = new Uint8Array(64);
    out.set(pad(r), 0); out.set(pad(s), 32);
    return out;
  }
  const sig = bytesKeB64u(derKeRaw(raw));
  return head + "." + pay + "." + sig;
}

// Enkripsi payload untuk satu subscription (RFC8291 aes128gcm, 1 record).
async function enkripsiPush(p256dhB64, authB64, payloadBytes) {
  const clientPub = b64uKeBytes(p256dhB64);
  const auth = b64uKeBytes(authB64);
  if (clientPub.length !== 65 || auth.length !== 16) throw new Error("Subscription key salah.");
  const clientKey = await crypto.subtle.importKey("raw", clientPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, eph.privateKey, 256));
  const prk1 = await hkdfExtract(auth, shared);
  const infoTeks = new TextEncoder().encode("WebPush: info\0");
  const keyInfo = new Uint8Array(infoTeks.length + 65 + 65);
  keyInfo.set(infoTeks, 0);
  keyInfo.set(clientPub, infoTeks.length);
  keyInfo.set(ephPubRaw, infoTeks.length + 65);
  const ikm2 = await hkdfExpand(prk1, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk2 = await hkdfExtract(salt, ikm2);
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const cek = await hkdfExpand(prk2, cekInfo, 16);
  const nonce = await hkdfExpand(prk2, nonceInfo, 12);
  // Plaintext: payload + delimiter 0x02 (single record, tanpa padding tambahan)
  const plain = new Uint8Array(payloadBytes.length + 1);
  plain.set(payloadBytes, 0);
  plain[payloadBytes.length] = 2;
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plain));
  // Body: salt(16) + rs(4, BE 4096) + idlen(1)=65 + ephPub(65) + ciphertext
  const body = new Uint8Array(16 + 4 + 1 + 65 + ct.length);
  body.set(salt, 0);
  body[16] = 0; body[17] = 0; body[18] = 16; body[19] = 0; // rs = 4096
  body[20] = 65;
  body.set(ephPubRaw, 21);
  body.set(ct, 21 + 65);
  return body;
}

async function kirimSatuPush(sub, payloadObj, env) {
  const ep = new URL(sub.endpoint);
  const asal = ep.origin;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const body = await enkripsiPush(sub.p256dh, sub.auth, payloadBytes);
  const jwt = await vapidJwt(asal, env);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "2419200",
      Authorization: "vapid t=" + jwt + ", k=" + String(env.VAPID_PUBLIC).trim(),
    },
    body,
  });
  return res.status;
}

async function tanganiPushKirim(req, env) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    return jsonResponse({ error: "Worker belum dikonfigurasi (VAPID hilang). Jalankan wrangler secret put VAPID_PUBLIC / VAPID_PRIVATE." }, 500, env, req);
  }
  if (!env.SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: "Worker belum dikonfigurasi (service key hilang)." }, 500, env, req);
  }
  const { state, authUserId } = await jwtValid(env, req);
  if (state === "tanpa-token") return jsonResponse({ error: "Belum login — login dulu." }, 401, env, req);
  if (state !== "ok") return jsonResponse({ error: "Sesi tidak valid — login ulang dulu." }, 401, env, req);
  const osisId = await cekHakOsis(env, authUserId);
  if (!osisId) return jsonResponse({ error: "Akun ini tidak punya hak kirim notif." }, 403, env, req);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: "Body harus JSON." }, 400, env, req); }
  // Broadcast bebas (osis/notifikasi) khusus super admin — server tolak
  // kalau bukan, walau halaman client sudah digate juga.
  if (body && body.only_super) {
    const superUser = await cekSuper(env, authUserId);
    if (!superUser) return jsonResponse({ error: "Halaman ini khusus super admin." }, 403, env, req);
  }

  const judul = String(body.judul || "").trim().slice(0, 80);
  const isi = String(body.isi || "").trim().slice(0, 180);
  let urlTarget = String(body.url || "#/informasi").trim().slice(0, 300) || "#/informasi";
  if (!/^(#\/|https?:\/\/|osis\/|polling|changelog)/i.test(urlTarget)) urlTarget = "#/informasi";
  let aud = String(body.audience || "publik").trim().toLowerCase();
  if (!["publik", "osis", "semua"].includes(aud)) aud = "publik";
  if (!judul || !isi) return jsonResponse({ error: "Judul + isi wajib diisi." }, 400, env, req);

  const base = String(env.SUPABASE_URL).replace(/\/$/, "");
  const h = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY };
  let filterAud = "";
  if (aud === "publik") filterAud = "&audience=in.(publik,semua)";
  else if (aud === "osis") filterAud = "&audience=in.(osis,semua)";
  let subs = [];
  try {
    const r = await fetch(`${base}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth${filterAud}&limit=1000`, { headers: h });
    if (!r.ok) throw new Error("DB " + r.status);
    subs = await r.json();
  } catch {
    return jsonResponse({ error: "Gagal ambil daftar subscriber." }, 500, env, req);
  }
  if (!Array.isArray(subs) || !subs.length) {
    return jsonResponse({ ok: true, total: 0, terkirim: 0, gagal: 0, info: "Belum ada HP yang aktifkan notif." }, 200, env, req);
  }

  const payload = { judul, isi, url: urlTarget, tag: "tarpan-" + Date.now() };
  let terkirim = 0, gagal = 0;
  const basi = [];
  const BATCH = 25;
  for (let i = 0; i < subs.length; i += BATCH) {
    const pot = subs.slice(i, i + BATCH);
    const hasil = await Promise.allSettled(pot.map((s) => kirimSatuPush(s, payload, env)));
    hasil.forEach((hsl, k) => {
      if (hsl.status === "fulfilled" && hsl.value >= 200 && hsl.value < 300) terkirim++;
      else {
        gagal++;
        const st = hsl.status === "fulfilled" ? hsl.value : 0;
        if (st === 404 || st === 410) basi.push(pot[k].endpoint);
      }
    });
  }
  // Bersihkan subscription basi (uninstall / kadaluarsa) — best effort.
  if (basi.length) {
    try {
      await Promise.allSettled(basi.slice(0, 100).map((ep) =>
        fetch(`${base}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, {
          method: "DELETE", headers: h,
        }),
      ));
    } catch {}
  }
  return jsonResponse({ ok: true, total: subs.length, terkirim, gagal, dibersihkan: basi.length }, 200, env, req);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, req) });
    }

    if (url.pathname === "/push-kirim" && req.method === "POST") {
      return tanganiPushKirim(req, env);
    }

    if (url.pathname !== "/presign" || req.method !== "POST") {
      return jsonResponse({ error: "Not found. Gunakan POST /presign atau POST /push-kirim." }, 404, env, req);
    }

    if (!env.R2_ENDPOINT || !env.R2_BUCKET || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY) {
      return jsonResponse({ error: "Worker belum dikonfigurasi (R2 env hilang)." }, 500, env, req);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Body harus JSON." }, 400, env, req);
    }

    const op = body.op === "delete" ? "delete" : "put";
    const path = String(body.path || "").replace(/^\/+/, "");

    if (!validasiPath(path)) {
      return jsonResponse({ error: "Path tidak diizinkan." }, 400, env, req);
    }

    // Aturan auth:
    // - PUT ke path publik formulir/* berpola: bebas (responden tanpa login).
    // - Selain itu: wajib JWT valid + terlink ke osis_users + punya hak kelola.
    //   (signUp terbuka untuk klaim akun, tapi akun tak terlink = tak berhak.)
    const publik = op === "put" && POLA_PUBLIK.test(path);
    if (!publik) {
      if (!env.SUPABASE_SERVICE_KEY) {
        return jsonResponse({ error: "Worker belum dikonfigurasi (service key hilang)." }, 500, env, req);
      }
      const { state, authUserId } = await jwtValid(env, req);
      if (state === "tanpa-token") {
        return jsonResponse({ error: "Belum login — login dulu." }, 401, env, req);
      }
      if (state !== "ok") {
        return jsonResponse({ error: "Sesi tidak valid — login ulang dulu." }, 401, env, req);
      }
      const osisId = await cekHakOsis(env, authUserId);
      if (!osisId) {
        return jsonResponse({ error: "Akun ini tidak punya hak upload." }, 403, env, req);
      }
    }

    const region = env.R2_REGION || "auto";

    try {
      if (op === "put") {
        const contentType = String(body.contentType || "application/octet-stream");
        if (!CONTENT_BOLEH.has(contentType)) {
          return jsonResponse({ error: "Tipe file tidak diizinkan." }, 400, env, req);
        }
        const signed = await presignUrl({
          method: "PUT",
          endpoint: env.R2_ENDPOINT,
          bucket: env.R2_BUCKET,
          key: path,
          accessKey: env.R2_ACCESS_KEY,
          secretKey: env.R2_SECRET_KEY,
          region,
          expiresIn: UMUR_PRESIGN_DETIK,
        });
        const publicUrl = `${String(env.PUBLIC_BASE_URL).replace(/\/$/, "")}/${encodeKey(path)}`;
        return jsonResponse({ url: signed, method: "PUT", publicUrl, path, expiresIn: UMUR_PRESIGN_DETIK }, 200, env, req);
      }

      const signed = await presignUrl({
        method: "DELETE",
        endpoint: env.R2_ENDPOINT,
        bucket: env.R2_BUCKET,
        key: path,
        accessKey: env.R2_ACCESS_KEY,
        secretKey: env.R2_SECRET_KEY,
        region,
        expiresIn: UMUR_PRESIGN_DETIK,
      });
      return jsonResponse({ url: signed, method: "DELETE", path, expiresIn: UMUR_PRESIGN_DETIK }, 200, env, req);
    } catch (e) {
      return jsonResponse({ error: "Gagal membuat presigned URL." }, 500, env, req);
    }
  },
};
