// tools/backfill-thumb.mjs — generate thumb (-thumb.jpg, 400px) buat foto lama di R2.
// Sumber path dari DB (jsonb arsip/galeri/dll + kolom foto tunggal).
// File yatim (DB nyantol tapi objek ga ada di R2) di-SKIP + dilaporkan.
//
// PAKAI:
//   npm i @supabase/supabase-js @aws-sdk/client-s3 sharp
//   # isi env (PowerShell: $env:NAMA="..."), lalu:
//   DRY_RUN=1 node tools/backfill-thumb.mjs   # cek dulu tanpa upload
//   node tools/backfill-thumb.mjs             # jalan beneran
//
// ENV WAJIB:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (service_role, JANGAN commit!),
//   R2_ENDPOINT (https://<ACCOUNT>.r2.cloudflarestorage.com),
//   R2_BUCKET, R2_ACCESS_KEY, R2_SECRET_KEY
// ENV OPSIONAL: R2_REGION (default "auto"), DRY_RUN=1, CONCURRENCY (default 5),
//   ONLY (koma nama tabel, cth: ONLY=arsip,pelantikan)

import { createClient } from "@supabase/supabase-js";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp belum diinstal. Jalanin dulu: npm i sharp");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET || "osis-media";
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_REGION = process.env.R2_REGION || "auto";
const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 5));
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

for (const [nama, val] of Object.entries({
  SUPABASE_URL, SUPABASE_SERVICE_KEY, R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY, R2_SECRET_KEY,
})) {
  if (!val) {
    console.error(`ENV hilang: ${nama}`);
    process.exit(1);
  }
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  forcePathStyle: false,
});

const FOTO_EXT = /\.(jpg|jpeg|png|webp|gif)$/i;
const pathThumb = (key) => {
  const i = key.lastIndexOf(".");
  return i < 0 ? key + "-thumb" : key.slice(0, i) + "-thumb" + key.slice(i);
};
// Elemen fotos jsonb bisa string ("gallery/x.jpg") atau objek ({path}).
const pathDariElemen = (el) => {
  if (typeof el === "string") return el.replace(/^\/+/, "");
  if (el && typeof el.path === "string") return el.path.replace(/^\/+/, "");
  return "";
};

async function kumpulPath() {
  const semua = new Set();
  const ambilArray = async (tabel) => {
    if (ONLY.length && !ONLY.includes(tabel)) return;
    const { data, error } = await supa.from(tabel).select("fotos");
    if (error) throw new Error(`baca ${tabel}: ${error.message}`);
    for (const r of data || []) {
      for (const el of Array.isArray(r.fotos) ? r.fotos : []) {
        const p = pathDariElemen(el);
        if (p && FOTO_EXT.test(p)) semua.add(p);
      }
    }
    console.log(`  ${tabel}: ${data ? data.length : 0} baris`);
  };
  const ambilKolom = async (tabel, kolom) => {
    if (ONLY.length && !ONLY.includes(tabel)) return;
    const { data, error } = await supa.from(tabel).select(kolom);
    if (error) throw new Error(`baca ${tabel}: ${error.message}`);
    for (const r of data || []) {
      const p = String(r[kolom] || "").replace(/^\/+/, "");
      if (p && !p.startsWith("http") && FOTO_EXT.test(p)) semua.add(p);
    }
  };
  for (const t of ["gallery", "arsip", "kegiatan", "prestasi", "pelantikan"]) await ambilArray(t);
  await ambilKolom("poster", "foto");
  await ambilKolom("pengurus", "foto");
  await ambilKolom("web_foto", "path");
  if (!ONLY.length || ONLY.includes("feed_posts")) {
    const { data, error } = await supa.from("feed_posts").select("media_key");
    if (error) throw new Error(`baca feed_posts: ${error.message}`);
    for (const r of data || []) {
      const p = String(r.media_key || "").replace(/^\/+/, "");
      if (p && !p.startsWith("http") && FOTO_EXT.test(p)) semua.add(p);
    }
  }
  if (!ONLY.length || ONLY.includes("moments")) {
    const { data, error } = await supa.from("moments").select("media_key");
    if (error) throw new Error(`baca moments: ${error.message}`);
    for (const r of data || []) {
      const p = String(r.media_key || "").replace(/^\/+/, "");
      if (p && !p.startsWith("http") && FOTO_EXT.test(p)) semua.add(p);
    }
  }
  return [...semua];
}

async function adaDiR2(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function unduh(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const chunks = [];
  for await (const c of r.Body) chunks.push(c);
  return Buffer.concat(chunks);
}

const hasil = { total: 0, dibuat: 0, sudahAda: 0, dilewatiKecil: 0, yatim: 0, gagal: 0, yatimDaftar: [], gagalDaftar: [] };

async function prosesSatu(key) {
  const thumb = pathThumb(key);
  if (await adaDiR2(thumb)) { hasil.sudahAda++; return; }
  if (!(await adaDiR2(key))) { hasil.yatim++; if (hasil.yatimDaftar.length < 50) hasil.yatimDaftar.push(key); return; }
  if (DRY_RUN) { hasil.dibuat++; return; }
  try {
    const buf = await unduh(key);
    const meta = await sharp(buf).metadata();
    if ((meta.width || 0) <= 400 && (meta.height || 0) <= 400) { hasil.dilewatiKecil++; return; }
    const kecil = await sharp(buf)
      .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 68 })
      .toBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: thumb,
      Body: kecil,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }));
    hasil.dibuat++;
  } catch (e) {
    hasil.gagal++;
    if (hasil.gagalDaftar.length < 50) hasil.gagalDaftar.push(`${key} :: ${e.message}`);
  }
}

console.log("Kumpul path foto dari DB...");
const daftar = await kumpulPath();
hasil.total = daftar.length;
console.log(`Total path foto unik: ${daftar.length}${DRY_RUN ? " (DRY-RUN, tanpa upload)" : ""}`);

let jalan = 0;
async function pekerja() {
  for (;;) {
    const i = jalan++;
    if (i >= daftar.length) return;
    await prosesSatu(daftar[i]);
    if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${daftar.length}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, daftar.length) }, pekerja));

console.log("\n== HASIL ==");
console.log(`total: ${hasil.total}, thumb dibuat: ${hasil.dibuat}, sudah ada: ${hasil.sudahAda}, kecil dilewati: ${hasil.dilewatiKecil}, yatim: ${hasil.yatim}, gagal: ${hasil.gagal}`);
if (hasil.yatimDaftar.length) console.log("contoh yatim:\n  " + hasil.yatimDaftar.join("\n  "));
if (hasil.gagalDaftar.length) console.log("contoh gagal:\n  " + hasil.gagalDaftar.join("\n  "));
