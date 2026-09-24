// =========================================================================
// KONFIGURASI — OSIS TARPAN ONE
// Data tetap di Supabase Postgres. Media (foto/dokumen) di Cloudflare R2
// via presigned URL dari Worker (secret tidak pernah di frontend).
// =========================================================================
const SUPABASE_URL = "https://eefdfaqcccgpfthdidzp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZmRmYXFjY2NncGZ0aGRpZHpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NzU1NzEsImV4cCI6MjEwMTE1MTU3MX0.QupX_C_jOzgsTkDmr678gD_vEJUPpYfzKKAeY6Hrod0";
// Bucket Supabase lama — LEGACY, hanya fallback sebelum Worker R2 live.
// Jangan dipakai untuk upload baru setelah migrasi bulk selesai.
const STORAGE_BUCKET = "osis-media";
// Domain publik R2 (custom domain). Ganti saat setup Cloudflare selesai.
const R2_PUBLIC_BASE = "https://media.osistarpanone.my.id";
// URL Worker penerbit presigned URL. Ganti dengan URL deploy worker.
const R2_PRESIGN_URL = "https://osis-media-presign.nizzcuy.workers.dev/presign";
// Saklar utama media. true = baca R2 + upload via presign; false = Supabase lama.
const R2_ENABLED = true;
