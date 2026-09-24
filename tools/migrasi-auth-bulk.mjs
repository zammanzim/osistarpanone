// tools/migrasi-auth-bulk.mjs — pindahkan akun osis_users ke Supabase Auth
// Email utama: <nama.lengkap>@<domain> (mis. budi.santoso@...), disimpan di
// kolom auth_email. Nama kembar otomatis bernomor (budi.santoso2@...).
// Fallback deterministik osis-<id>@<domain> dipakai alur klaim mandiri.
// Setelah link, kolom password dikosongkan. Idempotent + bisa upgrade:
// user yg sudah terlink tapi emailnya masih pola lama akan diganti ke
// email nama (Auth + kolom sekaligus).
//
// PAKAI (butuh migrasi-auth-1-fondasi.sql versi terbaru sudah di-run):
//   npm i @supabase/supabase-js
//   $env:SUPABASE_URL="https://..."; $env:SUPABASE_SERVICE_KEY="..."  # service_role!
//   $env:AUTH_EMAIL_DOMAIN="osistarpanone.my.id"
//   node tools/migrasi-auth-bulk.mjs            # semua user
//   $env:USERNAME="mizammm"; node tools/migrasi-auth-bulk.mjs   # satu user saja
//
// PRA-SYARAT dashboard (wajib): Auth > "Confirm email" = OFF,
// password minimum = nilai terkecil yg dibolehkan (user berpassword pendek
// otomatis dapat password sementara yg tercatat di ringkasan).

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
const emailId = (id) => `osis-${id}@${DOMAIN}`;
// Email fallback alur klaim (deterministik, anti-bentrok).
const POLA_ID = /^osis-\d+@[^@]+$/;
const hasil = { total: 0, dibuat: 0, dilink: 0, diupgrade: 0, dilewati: 0, gagal: 0, gagalDaftar: [], sementara: [] };

// "Mizam Ahmad" -> "mizam.ahmad" (aman untuk local-part email).
function dasarEmail(nama, username, id) {
  let s = String(nama || username || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").replace(/\.{2,}/g, ".");
  if (s.length > 40) s = s.slice(0, 40).replace(/\.+$/g, "");
  if (!s) s = `osis-${id}`;
  return s;
}

async function kumpulkanEmailAuth() {
  const semua = new Set();
  const idByEmail = new Map();
  let page = 1;
  for (;;) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("listUsers: " + error.message);
    for (const u of data.users || []) {
      const em = String(u.email || "").toLowerCase();
      if (em) {
        semua.add(em);
        idByEmail.set(em, u.id);
      }
    }
    if (!data.users || data.users.length < 1000) break;
    page++;
  }
  return { semua, idByEmail };
}

function emailUnik(base, terpakai) {
  let cand = `${base}@${DOMAIN}`.toLowerCase(), n = 2;
  while (terpakai.has(cand)) {
    cand = `${base}${n}@${DOMAIN}`.toLowerCase();
    n++;
  }
  terpakai.add(cand);
  return cand;
}

let q = supa.from("osis_users").select("id, username, nama, password, auth_id, auth_email").order("id");
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

const { semua: emailAuth, idByEmail } = await kumpulkanEmailAuth();
const terpakai = new Set(emailAuth);
for (const r of rows) if (r.auth_email) terpakai.add(String(r.auth_email).toLowerCase());

for (const [i, u] of rows.entries()) {
  const tag = `[${i + 1}/${rows.length}]`;
  hasil.total++;
  try {
    const sudahCantik = u.auth_email && !POLA_ID.test(u.auth_email);
    if (u.auth_id && sudahCantik) {
      hasil.dilewati++;
      console.log(`  ${tag} SKIP (sudah link) @${u.username} <${u.auth_email}>`);
      continue;
    }
    if (!u.password && !u.auth_id) {
      hasil.gagal++;
      hasil.gagalDaftar.push(`@${u.username}: password kosong di DB — set password sementara via SQL lalu run ulang dengan USERNAME=${u.username}`);
      console.log(`  ${tag} GAGAL @${u.username}: password kosong`);
      continue;
    }

    // Tentukan email target: pertahankan yg cantik, atau buat dari nama.
    let email = sudahCantik ? u.auth_email : emailUnik(dasarEmail(u.nama, u.username, u.id), terpakai);

    if (!u.auth_id) {
      // Akun baru Auth.
      let passwordDipakai = u.password;
      const cobaCreate = async (pw) => supa.auth.admin.createUser({
        email,
        password: pw,
        email_confirm: true,
        user_metadata: { osis_user_id: u.id, username: u.username },
      });
      let { data: created, error: e1 } = await cobaCreate(passwordDipakai);
      if (e1 && /at least|too short|minimum|password.*length|length.*password/i.test(e1.message)) {
        passwordDipakai = "tarpan-" + Math.random().toString(36).slice(2, 6) + Math.floor(100 + Math.random() * 900);
        ({ data: created, error: e1 } = await cobaCreate(passwordDipakai));
        if (!e1) {
          hasil.sementara.push(`@${u.username}: ${passwordDipakai}`);
          console.log(`  ${tag} OK + PW SEMENTARA @${u.username} <${email}> (beri tahu user, suruh ganti di Profil)`);
        }
      }
      let authId = null;
      if (e1) {
        if (/already|exists|registered|duplicate/i.test(e1.message)) {
          authId = idByEmail.get(email.toLowerCase()) || null;
          if (!authId) throw new Error("email bentrok tapi auth user tidak ketemu: " + e1.message);
          hasil.dilink++;
          console.log(`  ${tag} LINK (auth sudah ada) @${u.username} <${email}>`);
        } else {
          throw new Error(e1.message);
        }
      } else {
        authId = created.user.id;
        hasil.dibuat++;
        if (!hasil.sementara.some((s) => s.startsWith(`@${u.username}:`))) {
          console.log(`  ${tag} OK @${u.username} <${email}>`);
        }
      }
      const { error: e2 } = await supa.from("osis_users")
        .update({ auth_id: authId, auth_email: email, password: "" })
        .eq("id", u.id);
      if (e2) throw new Error("update link: " + e2.message);
    } else {
      // Sudah terlink tapi email masih pola lama -> upgrade ke email nama.
      const { error: e3 } = await supa.auth.admin.updateUserById(u.auth_id, { email });
      if (e3) throw new Error("update email Auth: " + e3.message);
      const { error: e4 } = await supa.from("osis_users")
        .update({ auth_email: email })
        .eq("id", u.id);
      if (e4) throw new Error("update kolom: " + e4.message);
      hasil.diupgrade++;
      console.log(`  ${tag} UPGRADE @${u.username} <${email}>`);
    }
  } catch (e) {
    hasil.gagal++;
    hasil.gagalDaftar.push(`@${u.username}: ${e.message}`);
    console.error(`  ${tag} GAGAL @${u.username}: ${e.message}`);
  }
}

console.log("\n==== RINGKASAN ====");
console.log(`total=${hasil.total} dibuat=${hasil.dibuat} dilink=${hasil.dilink} diupgrade=${hasil.diupgrade} dilewati=${hasil.dilewati} gagal=${hasil.gagal}`);
if (hasil.sementara.length) {
  console.log("PASSWORD SEMENTARA (bagikan ke user ybs, suruh ganti di halaman Profil):");
  for (const s of hasil.sementara) console.log(" - " + s);
}
if (hasil.gagalDaftar.length) {
  console.log("Perlu tindakan manual:");
  for (const g of hasil.gagalDaftar) console.log(" - " + g);
}
