// tools/reset-password.mjs — admin mengganti password user OSIS
// Password sekarang disimpan di Supabase Auth (bcrypt, tak terbaca), bukan
// lagi kolom osis_users.password. User ganti sendiri lewat halaman Profil;
// skrip ini untuk admin saat user lupa password / butuh reset paksa.
//
// PAKAI:
//   npm i @supabase/supabase-js
//   $env:SUPABASE_URL="https://..."; $env:SUPABASE_SERVICE_KEY="..."  # service_role!
//   $env:USERNAME="mizammm"; $env:PASSWORD_BARU="rahasia-baru-123"
//   node tools/reset-password.mjs
// Lalu beritahu password baru ke user via chat pribadi, suruh ganti sendiri
// di halaman Profil setelah login.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const USERNAME = (process.env.USERNAME || "").trim();
const PASSWORD_BARU = process.env.PASSWORD_BARU || "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ENV hilang: SUPABASE_URL / SUPABASE_SERVICE_KEY");
  process.exit(1);
}
if (!USERNAME) {
  console.error("Isi USERNAME dulu: $env:USERNAME=\"username\"");
  process.exit(1);
}
if (PASSWORD_BARU.length < 6) {
  console.error("PASSWORD_BARU minimal 6 karakter.");
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY);

const { data: row, error: e1 } = await supa.from("osis_users")
  .select("id, username, auth_id, auth_email")
  .eq("username", USERNAME)
  .maybeSingle();
if (e1) {
  console.error("Gagal baca user:", e1.message);
  process.exit(1);
}
if (!row || !row.auth_id) {
  console.error(`@${USERNAME} belum punya akun Auth (belum migrasi / belum pernah login).`);
  process.exit(1);
}

const { error: e2 } = await supa.auth.admin.updateUserById(row.auth_id, { password: PASSWORD_BARU });
if (e2) {
  console.error("Gagal reset:", e2.message);
  process.exit(1);
}
console.log(`OK: password @${USERNAME} (<${row.auth_email}>) sudah diganti.`);
