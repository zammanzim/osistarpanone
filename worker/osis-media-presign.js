// =========================================================================
// WORKER: osis-media-presign — penerbit presigned URL R2 untuk frontend statis
// Arsitektur: browser -> Worker (/presign, validasi JWT Supabase + allowlist
// folder) -> dapat URL PUT/DELETE -> browser upload langsung ke R2.
// Secret R2 TIDAK PERNAH ke frontend. Baca publik via custom domain R2.
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
// osis-foto. Key R2 dipertahankan identik (gallery/xxx.jpg) agar isi DB
// (path relatif) tidak perlu diubah.
const FOLDER_BOLEH = new Set([
  "gallery", "web", "angkatan", "prestasi", "kegiatan", "agenda",
  "profil", "anggota", "sekbid", "pimpinan", "notulensi", "proker",
  "program", "dokumen", "kas", "evaluasi", "formulir", "polling", "poster",
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

async function jwtValid(env, req) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  try {
    // Validasi via Supabase Auth API — tanpa perlu JWT secret di Worker.
    const r = await fetch(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        "apikey": env.SUPABASE_ANON_KEY,
        "Authorization": auth,
      },
    });
    return r.ok;
  } catch {
    return false;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, req) });
    }

    if (url.pathname !== "/presign" || req.method !== "POST") {
      return jsonResponse({ error: "Not found. Gunakan POST /presign." }, 404, env, req);
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

    // Wajib login Supabase untuk tulis/hapus (baca publik bebas via domain R2).
    if (!(await jwtValid(env, req))) {
      return jsonResponse({ error: "Unauthorized — login dulu." }, 401, env, req);
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
