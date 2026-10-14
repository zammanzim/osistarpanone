# AGENTS.md — OSIS TARPAN ONE

> Halo AI. Ini proyek web sekolah, bukan proyek Node build. Baca file ini dulu sebelum ngapa-ngapain.

## 1. Ini proyek apa

**OSIS TARPAN ONE** — web manajemen OSIS SMK Taruna Harapan 1 Cipatat.
Domain: `osistarpanone.my.id`. Hosting: **GitHub Pages** (push ke `main` = deploy).

Dua sisi, arsitektur beda:
- **Situs publik** = SPA hash-router di `index.html` (11 rute: home, pengurus, galeri, feed, polling, dll).
- **Dashboard OSIS** = MPA di `osis/*.html` (15+ halaman, wajib login).

Stack: **vanilla HTML/CSS/JS murni, tanpa framework, tanpa build step.** Backend = Supabase Postgres + Auth. Media = Cloudflare R2 via Worker presigned URL. PWA + offline-first (Service Worker + IndexedDB outbox).

## 2. Struktur penting

```
index.html          # SPA publik
login.html          # login + daftar
polling.html        # e-voting
osis/*.html         # dashboard (auth-gated)
css/style.css       # design system (2300+ baris, neo-brutalism)
js/config.js        # URL Supabase + R2 + key publik (20 baris, baca ini dulu)
js/db.js            # layer DB (3000+ baris, CRUD via RPC, SWR cache, presign R2)
js/osis-auth.js     # auth dual-tier + RBAC
js/outbox.js        # antrian offline IndexedDB
js/app.js           # router SPA publik
sw.js               # Service Worker (ingat bump versi cache tiap ubah precache)
manifest.webmanifest
worker/osis-media-presign.js  # Worker R2 presign, zero-dep SigV4
tools/*.mjs         # script CLI admin (Node)
db/                 # file migrasi SQL
```

Detail lengkap tiap modul ada di `project-analysis.md`. Kalau butuh peta 53 file JS, baca itu.

## 3. Cara jalanin & workflow

- **Gak ada `npm run dev` / `npm run build`.** Ini static site. Jalanin lokal pakai server statis, contoh: `python -m http.server 8000` atau Live Server VSCode, dari root repo.
- **Gak ada unit test otomatis.** Verifikasi = buka di browser, cek console, cek network ke Supabase/R2.
- **Deploy** = commit + push ke `main`. GitHub Pages yang serve. Jangan bikin folder `dist/` atau proses build.
- **PWA:** kalau nambah/rename file yang di-precache `sw.js`, langsung aja precache + wajib naikkan versi cache (`tarpan-vXX`) biar user gak stuck di cache lama. Gak perlu tanya dulu.
- **Versi:** ikuti aturan di `CHANGELOG.md` — patch `vX.X.1` (fix kecil), minor `vX.1.0` (1 fitur/modul), major `vX.0.0` (breaking / restruktur / ganti auth). Tiap rilis update `CHANGELOG.md` + `changelog.json` / tabel changelog di DB.

## 4. Aturan kerja AI (wajib)

1. **Baca dulu baru ngomong.** Jangan nebak isi file. Pakai `read`/`grep` buat cek file asli sebelum jawab atau edit. Kalau belum baca, bilang belum baca.
2. **Sering konfirmasi.** Ini settingan owner: tiap langkah besar (ubah auth, ubah skema, hapus file, refactor >2 file, deploy) — berhenti, jelasin rencana, tanya setuju atau tidak. Jangan langsung gas.
3. **Edit kecil & presisi.** Pakai `edit` dengan `oldString` sekecil mungkin. Jangan rewrite 1 file gede kalau cuma ubah 5 baris. Jangan bikin file baru kalau edit file lama cukup.
4. **Verifikasi tiap selesai.** Habis edit JS, minimal: cek sintaks (`node --check js/namafile.js` kalau bisa), buka logikanya ulang, pastiin gak ada import yang hilang. Klaim "beres" hanya kalau sudah dicek.
5. **Jangan halu URL / API.** Jangan karang endpoint, nama tabel, atau nama RPC. Cek `js/db.js`, `js/config.js`, atau `db/` dulu.
6. **Bahasa:** jawab santai bahasa Indonesia (gaya owner: `gw` / `lu`), singkat, to-the-point. Komen kode juga singkat, jangan curhat di komen.

## 5. Batasan & safety (jangan dilanggar)

- **JANGAN sentuh / baca isi secret:** `.env`, `.env.*`, `worker/.dev.vars`, `opencode.json`. Ini di `.gitignore`. Kalau butuh config, baca `js/config.js` aja (itu key publik, aman).
- **JANGAN commit secret.** Key private, service_role, VAPID private, S3 secret — hanya di Worker secret / env, gak pernah di frontend.
- **JANGAN edit vendor:** `js/supabase.min.js`. Itu file vendor.
- **Hati-hati dengan:** `js/config.js`, `worker/`, `sw.js`, `js/db.js`, `js/osis-auth.js`. Ini tulang punggung. Ubah hanya kalau diminta eksplisit + sudah konfirmasi. Pengecualian: precache di `sw.js` langsung aja, gak perlu konfirmasi.
- **Storage:** upload baru WAJIB via R2 presign (`R2_ENABLED = true`). Bucket Supabase `osis-media` itu LEGACY, cuma fallback baca, jangan dipakai buat upload baru.
- **CSS:** jaga design system neo-brutalism — border tebal `2.5-3px solid var(--ink)`, hard shadow `5px 5px 0`, radius bento `22px`, font Outfit. Jangan ganti palet seenaknya. Variabel ada di `:root` di `css/style.css`.
- **UI wajib pakai bawaan:** toast (`js/toast.js`), notice (`js/notice.js`), modal (`js/show-popup.js`), draft form (`js/form-persist.js`). Jangan bikin modal / toast / alert sendiri.

## 6. Aturan database (Supabase)

- **Read bebas:** boleh `SELECT` / inspect tabel / cek skema via MCP Supabase kapan aja buat jawab pertanyaan.
- **Write wajib tanya dulu:** `INSERT`, `UPDATE`, `DELETE`, DDL (`CREATE/ALTER/DROP`), RPC yang nulis, atau merge branch — SELALU konfirmasi ke owner dulu, jelasin SQL-nya apa.
- **Jangan DDL langsung dari chat kalau bisa dihindari.** Prefer bikin file migrasi di `db/migrasi-xxx.sql` biar ketrack, terus owner yang apply.
- **Setiap RPC kirim `p_user_id`.** Itu pola auth di `db.js` — PostgreSQL yang verify permission. Jangan hapus parameter itu.
- **Auth dual-tier, jangan dicampur:**
  - Pengurus → `osis_users` → email sintetis `osis-<id>@osistarpanone.my.id` → `mode: osis`.
  - Siswa umum → `biasa_users` → email sintetis `biasa-<id>@...` → `mode: biasa` (cuma fitur publik).
  - RBAC via `OsisAuth.bisa(halaman)` / `OsisAuth.butuh(halaman)`, sumber `osis_akses`. Jangan bypass guard ini.

## 7. Checklist sebelum bilang "selesai"

- [ ] File yang diubah sudah dibaca dulu & edit-nya minimal?
- [ ] Gak ada secret yang kebaca / ke-commit?
- [ ] Kalau ubah precache, versi `sw.js` sudah naik?
- [ ] Kalau nambah halaman `osis/`, guard `OsisAuth.butuh()` + entri sidebar sudah ada?
- [ ] Kalau nambah tabel/kolom, file migrasi SQL sudah dibuat?
- [ ] Sudah verifikasi (cek sintaks / buka di browser / cek console)?
- [ ] Kalau langkah besar, sudah tanya owner dulu?
