// tools/migrate-supabase-to-r2.mjs — bulk copy osis-foto (Supabase) -> R2
// Key dipertahankan identik (gallery/xxx.jpg) agar DB tanpa perubahan.
//
// PAKAI:
//   npm i @supabase/supabase-js @aws-sdk/client-s3
//   # isi env di bawah (PowerShell: $env:NAMA="..."), lalu:
//   node tools/migrate-supabase-to-r2.mjs
//   # cek dulu tanpa upload:
//   DRY_RUN=1 node tools/migrate-supabase-to-r2.mjs
//
// ENV WAJIB:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (service_role, JANGAN commit!)
//   R2_ENDPOINT (https://<ACCOUNT>.r2.cloudflarestorage.com),
//   R2_BUCKET, R2_ACCESS_KEY, R2_SECRET_KEY
// ENV OPSIONAL: R2_REGION (default "auto"), FOLDERS (koma, default semua),
//   DRY_RUN=1 (hanya list+hitung), LIMIT per list (default 1000)

import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET || "osis-media";
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_REGION = process.env.R2_REGION || "auto";
const DRY_RUN = process.env.DRY_RUN === "1";
const BUCKET_LAMA = "osis-foto";

const SEMUA_FOLDER = [
  "gallery", "web", "angkatan", "prestasi", "kegiatan", "agenda",
  "profil", "anggota", "sekbid", "pimpinan", "notulensi", "proker",
  "program", "dokumen", "kas", "evaluasi", "formulir", "polling", "poster",
];
const FOLDERS = (process.env.FOLDERS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const TARGET = FOLDERS.length ? FOLDERS : SEMUA_FOLDER;

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

const hasil = { total: 0, disalin: 0, dilewati: 0, gagal: 0, gagalDaftar: [] };

async function listSemua(folder) {
  const semua = [];
  const LIMIT = Number(process.env.LIMIT || 1000);
  let offset = 0;
  for (;;) {
    const { data, error } = await supa.storage.from(BUCKET_LAMA).list(folder, {
      limit: LIMIT,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list ${folder}: ${error.message}`);
    if (!data || !data.length) break;
    // Entri tanpa metadata = subfolder; hanya ambil file.
    for (const e of data) {
      if (e.metadata || e.id) semua.push(`${folder}/${e.name}`);
    }
    if (data.length < LIMIT) break;
    offset += LIMIT;
  }
  return semua;
}

async function sudahAda(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

for (const folder of TARGET) {
  console.log(`\n== folder ${folder} ==`);
  const daftar = await listSemua(folder);
  console.log(`ditemukan ${daftar.length} file di Supabase`);
  for (const key of daftar) {
    hasil.total++;
    try {
      if (await sudahAda(key)) {
        hasil.dilewati++;
        continue;
      }
      if (DRY_RUN) {
        hasil.disalin++;
        continue;
      }
      const { data, error } = await supa.storage.from(BUCKET_LAMA).download(key);
      if (error || !data) throw new Error(error?.message || "download kosong");
      const buf = Buffer.from(await data.arrayBuffer());
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buf,
        ContentType: data.type || "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable",
      }));
      hasil.disalin++;
      if (hasil.disalin % 25 === 0) console.log(`  ...${hasil.disalin} tersalin`);
    } catch (e) {
      hasil.gagal++;
      hasil.gagalDaftar.push(`${key} :: ${e.message}`);
      console.error(`  GAGAL ${key}: ${e.message}`);
    }
  }
}

console.log("\n==== RINGKASAN ====");
console.log(`total=${hasil.total} disalin=${hasil.disalin} dilewati(sudah ada)=${hasil.dilewati} gagal=${hasil.gagal}`);
if (hasil.gagalDaftar.length) {
  console.log("Daftar gagal:");
  for (const g of hasil.gagalDaftar.slice(0, 50)) console.log(" - " + g);
}
console.log(DRY_RUN ? "\n(DRY_RUN aktif — tidak ada upload. Matikan DRY_RUN untuk migrasi nyata.)"
  : "\nVerifikasi: sampling GET https://<domain-r2>/<key> harus 200. Baru setelah itu privat/arsipkan bucket osis-foto.");
