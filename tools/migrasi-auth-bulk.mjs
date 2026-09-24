// tools/migrasi-auth-bulk.mjs — pindahkan akun osis_users ke Supabase Auth
// Email sintetis stabil: osis-<id>@<domain> (pakai id, bukan username, agar
// ganti username tidak merusak login). Password lama (plaintext di DB) dipakai
// ulang sebagai password Auth. Setelah link, kolom password dikosongkan.
//
// PAKAI (butuh migrasi-auth-1-fondasi.sql sudah di-run):
//   npm i @supabase/supabase-js
//   $env:SUPABASE_URL="https://..."; $env:SUPABASE_SERVICE_KEY="..."  # service_role!
//   $env:AUTH_EMAIL_DOMAIN="osistarpanone.my.id"
//   node tools/migrasi-auth-bulk.mjs            # semua user
//   $env:USERNAME="mizammm"; node tools/migrasi-auth-bulk.mjs   # satu user saja
//
// PRA-SYARAT dashboard (wajib sebelum run):
//   Auth > "Confirm email" = OFF, password minimum <= password terpendek (4).
// Idempotent: user yg sudah punya auth_id dilewati; auth user yg sudah ada
// (email bentrok) di-link ulang tanpa reset password.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DOMAIN = process.env.AUTH_EMAIL_DOMAIN || "osistarpanone.my.id";
const HANYA = (process.env.USERNAME || "").trim();

for (const [nama, val] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY: SERVICE_KEY })) {
  if (!val) {
    console.error(`ENV hilang: ${nama}`);
    process.exit(1);
  }
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY);
const emailUntuk = (id) => `osis-${id}@${DOMAIN}`;
const hasil = { total: 0, dibuat: 0, dilink: 0, dilewati: 0, gagal: 0, gagalDaftar: [], sementara: [] };

let q = supa.from("osis_users").select("id, username, password, auth_id").order("id");
if (HANYA) q = q.eq("username", HANYA);
const { data: rows, error } = await q;
if (error) {
  console.error("Gagal baca osis_users:", error.message);
  process.exit(1);
}
if (!rows.length) {
  console.log(HANYA ? `Username "${HANYA}" tidak ketemu.` : "Tidak ada user.");
  process.exit(0);
}

async function cariAuthIdByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error: e } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
    if (e) throw new Error("listUsers: " + e.message);
    const ketemu = (data.users || []).find((u) => (u.email || "").toLowerCase() === email);
    if (ketemu) return ketemu.id;
    if (!data.users || data.users.length < 1000) return null;
    page++;
  }
}

for (const [i, u] of rows.entries()) {
  const tag = `[${i + 1}/${rows.length}]`;
  hasil.total++;
  try {
    if (u.auth_id) {
      hasil.dilewati++;
      console.log(`  ${tag} SKIP (sudah link) @${u.username}`);
      continue;
    }
    if (!u.password) {
      hasil.gagal++;
      hasil.gagalDaftar.push(`@${u.username}: password kosong di DB — set password sementara via SQL lalu run ulang dengan USERNAME=${u.username}`);
      console.log(`  ${tag} GAGAL @${u.username}: password kosong`);
      continue;
    }
    const email = emailUntuk(u.id);
    let authId = null;
    let passwordDipakai = u.password;
    let passwordSementara = null;
    const cobaCreate = async (pw) => supa.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
      user_metadata: { osis_user_id: u.id, username: u.username },
    });
    let { data: created, error: e1 } = await cobaCreate(passwordDipakai);
    if (e1 && /at least|too short|minimum|password.*length|length.*password/i.test(e1.message)) {
      // Password lama lebih pendek dari minimum dashboard (min 6): pakai
      // password sementara acak, catat untuk dibagikan ke user ybs.
      passwordSementara = "tarpan-" + Math.random().toString(36).slice(2, 6) + Math.floor(100 + Math.random() * 900);
      ({ data: created, error: e1 } = await cobaCreate(passwordSementara));
      if (!e1) {
        hasil.sementara.push(`@${u.username}: ${passwordSementara}`);
        console.log(`  ${tag} OK + PW SEMENTARA @${u.username} -> ${email} (beri tahu user, suruh ganti di Profil)`);
      }
    }
    if (e1) {
      if (/already|exists|registered|duplicate/i.test(e1.message)) {
        authId = await cariAuthIdByEmail(email);
        if (!authId) throw new Error("email bentrok tapi auth user tidak ketemu: " + e1.message);
        hasil.dilink++;
        console.log(`  ${tag} LINK (auth sudah ada) @${u.username}`);
      } else {
        throw new Error(e1.message);
      }
    } else {
      authId = created.user.id;
      hasil.dibuat++;
      console.log(`  ${tag} OK @${u.username} -> ${email}`);
    }
    const { error: e2 } = await supa.from("osis_users")
      .update({ auth_id: authId, password: "" })
      .eq("id", u.id);
    if (e2) throw new Error("update link: " + e2.message);
  } catch (e) {
    hasil.gagal++;
    hasil.gagalDaftar.push(`@${u.username}: ${e.message}`);
    console.error(`  ${tag} GAGAL @${u.username}: ${e.message}`);
  }
}

console.log("\n==== RINGKASAN ====");
console.log(`total=${hasil.total} dibuat=${hasil.dibuat} dilink=${hasil.dilink} dilewati=${hasil.dilewati} gagal=${hasil.gagal}`);
if (hasil.sementara.length) {
  console.log("PASSWORD SEMENTARA (bagikan ke user ybs, suruh ganti di halaman Profil):");
  for (const s of hasil.sementara) console.log(" - " + s);
}
if (hasil.gagalDaftar.length) {
  console.log("Perlu tindakan manual:");
  for (const g of hasil.gagalDaftar) console.log(" - " + g);
}
