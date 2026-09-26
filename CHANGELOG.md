# Changelog — OSIS TARPAN ONE

Aturan versi (SemVer sederhana):
- `vX.X.1` (patch) — fix kecil: typo, CSS 1-2 baris, config `robots.txt` / `manifest` / `sitemap`, toggle kecil.
- `vX.1.0` (minor) — fitur sedang, non-breaking: 1 halaman / 1 modul baru, migrasi SQL non-breaking.
- `vX.0.0` (major) — perubahan besar / breaking: restruktur direktori, ganti sistem auth, hapus kode duplikat, modul inti baru.

Versi berjalan: **v6.2.0** (2026-09-26). Total 41 commit, 41 tag (v1.0.0 → v6.2.0).

> Catatan: pesan commit asli banyak yang singkat (`mmm`, `serius`, `112`), jadi ringkasan di bawah diambil dari diff stat + daftar file, bukan cuma pesan commit.

## [v6.2.0] — 2026-09-26 — minor
- Commit: `1c63574` — `unreleased`
- 32 files, +1944 / -132
- Fitur Arsip (`js/arsip.js` 684 baris, `migrasi-arsip.sql`) + Notifikasi (`js/notice.js` 192 baris). Update `agenda`, `galeri`, `kegiatan`, `prestasi`.

## [v6.1.4] — 2026-09-25 — patch
- Commit: `9cf91b7` — `ee`
- 3 files, +4 / -7
- Fix kecil `index.html` + `js/pengurus.js` + `sw.js`.

## [v6.1.3] — 2026-09-25 — patch
- Commit: `c232fab` — `Sembunyikan periode masa depan di dropdown pengurus`
- 3 files, +7 / -4
- Filter dropdown pengurus agar periode masa depan tidak muncul.

## [v6.1.2] — 2026-09-24 — patch
- Commit: `0fed47b` — `Chip user header klik ke profil`
- 19 files, +26 / -20
- UX kecil: chip user di header sekarang link ke halaman profil.

## [v6.1.1] — 2026-09-24 — patch
- Commit: `39a5995` — `Toggle super admin di halaman Akses`
- 4 files, +35 / -3
- Toggle role super admin di `osis/akses.html` (`js/akses.js`, `js/db.js`).

## [v6.1.0] — 2026-09-24 — minor
- Commit: `4379f69` — `Halaman Profil Saya + menu sidebar + precache`
- 5 files, +312 / -3
- Halaman `osis/profil.html` baru + update sidebar + precache SW. Tool `tools/reset-password.mjs`.

## [v6.0.2] — 2026-09-24 — patch
- Commit: `478bc30` — `1123`
- 23 files, +230 / -135
- Fixup lanjutan migrasi auth (login, `osis-auth`, `profil`, template OSIS).

## [v6.0.1] — 2026-09-24 — patch
- Commit: `316fc7e` — `112`
- 16 files, +56 / -56
- Normalisasi massal 16 file HTML (header/template).

## [v6.0.0] — 2026-09-24 — major
- Commit: `509a514` — `Migrasi login ke Supabase Auth + presign R2 per hak akses`
- 27 files, +540 / -107
- BREAKING: ganti sistem login ke Supabase Auth, presign R2 per hak akses. Migrasi `migrasi-auth-1-fondasi.sql`, `migrasi-auth-2-kunci.sql`. Tool `tools/migrasi-auth-bulk.mjs`.

## [v5.1.0] — 2026-09-24 — minor
- Commit: `0fdcd35` — `dbr2`
- 6 files, +541 / -7
- Tooling: `package.json` / `package-lock.json`, `tools/migrate-supabase-to-r2.mjs`, `worker/osis-media-presign.js`.

## [v5.0.0] — 2026-09-24 — major
- Commit: `0ce348e` — `dbr2`
- 56 files, +492 / -23167
- BREAKING cleanup: hapus duplikat `jsbin/` (31 file) + `osisbin/` (12 file). Arsitektur storage baru: Worker R2 presign (`worker/osis-media-presign.js`, `wrangler.toml`).

## [v4.8.0] — 2026-09-24 — minor
- Commit: `7bc60d7` — `informasi`
- 24 files, +1201 / -28
- Fitur Informasi: `js/informasi.js` + `osis/informasi.html` baru. Migrasi `migrasi-informasi.sql`, `migrasi-pengunggah.sql` (label pengunggah).

## [v4.7.0] — 2026-09-24 — minor
- Commit: `ca2c808` — `markdonesong`
- 7 files, +246 / -8
- Fitur kecil: tandai lagu selesai (`js/lagu.js`). Migrasi `migrasi-lagu-selesai.sql`.

## [v4.6.0] — 2026-09-24 — minor
- Commit: `ba2c48b` — `superadmin`
- 2 files, +208 / -4
- Role super admin. Migrasi `migrasi-super-admin.sql`.

## [v4.5.2] — 2026-09-23 — patch
- Commit: `a5f4ea6` — `seriusasli8`
- 10 files, +229 / -156
- Fix `agenda`, `akses`, `dashboard`, `sekbid`, `outbox`.

## [v4.5.1] — 2026-09-23 — patch
- Commit: `106dd83` — `polwakilang`
- 1 file, +1 / -3
- Fix kecil 1 baris di `index.html`.

## [v4.5.0] — 2026-09-23 — minor
- Commit: `61cfacc` — `seriusasli6`
- 15 files, +1447 / -468
- Perbaikan sedang `absensi`, `agenda`, `akses`, `tabungan`, `home`.

## [v4.4.0] — 2026-09-22 — minor
- Commit: `127f878` — `seriusaseli6`
- 30 files, +3233 / -32
- 2 fitur baru: Polling (`js/polling.js`, `polling.html`, `migrasi-polling.sql`) + Poster (`js/poster.js`, `osis/poster.html`, `migrasi-poster.sql`). Tambah `jepun.html`, `migrasi-limit-lagu.sql`.

## [v4.3.1] — 2026-09-21 — patch
- Commit: `d1a8d48` — `manifest`
- 7 files, +3 / -3
- Refresh icons + `manifest.webmanifest` + `sw.js`.

## [v4.3.0] — 2026-09-21 — minor
- Commit: `9725949` — `orienatation`
- 33 files, +1511 / -175
- Migrasi sidebar (`migrasi-sidebar.sql`), orientasi/layout, update template OSIS + SW.

## [v4.2.2] — 2026-09-21 — patch
- Commit: `211dc60` — `fix robots`
- 1 file, +1 / -1
- Fix `robots.txt`.

## [v4.2.1] — 2026-09-21 — patch
- Commit: `814efcf` — `pwafix`
- 4 files, +83 / -26
- Fix PWA (`js/pwa.js`, `sw.js`, CSS).

## [v4.2.0] — 2026-09-20 — minor
- Commit: `0052ba3` — `seriusasli5`
- 34 files, +3102 / -334
- Fitur Pengurus (`js/pengurus.js` baru) + kembalikan `osis/anggota.html`. Update sidebar/outbox.

## [v4.1.0] — 2026-09-20 — minor
- Commit: `93e256a` — `seriusasli4`
- 10 files, +2012 / -5
- Fitur Program: `js/program.js` + `osis/program-bulanan.html` + `osis/program-tahunan.html` baru.

## [v4.0.1] — 2026-09-19 — patch
- Commit: `5961cdc` — `seriusasli2`
- 38 files, +397 / -125
- Integrasi `js/supabase.min.js`, penyesuaian kecil tersebar (rata-rata ~10 baris/file).

## [v4.0.0] — 2026-09-19 — major
- Commit: `849b290` — `seriusasli1`
- 77 files, +9891 / -1909
- Sistem Akses (`js/akses.js`, `osis/akses.html`) + Offline outbox (`js/outbox.js` 1210 baris) + rewrite `js/db.js` (2421 baris). Refresh icons, kembalikan struktur `osis/`.

## [v3.3.0] — 2026-09-18 — minor
- Commit: `2144a54` — `18sept`
- 8 files, +793 / -185
- Perbaikan Agenda + DB.

## [v3.2.0] — 2026-09-17 — minor
- Commit: `ca50225` — `serius3`
- 14 files, +1584 / -28
- Perbaikan `aspirasi`, `home`, `lagu`, `site-edit`, `show-popup`.

## [v3.1.0] — 2026-09-17 — minor
- Commit: `0b1d22f` — `serius2`
- 4 files, +641 / -93
- Perbaikan `galeri`, `home`, style.

## [v3.0.0] — 2026-09-17 — major
- Commit: `b5718f7` — `serius`
- 63 files, +17018 / -1048
- Restruktur besar: `osis/*.html` → `osisbin/`, duplikat `js/` → `jsbin/`. Fitur baru Absensi (`js/absensi.js`, `osis/absensi.html`) + Tabungan (`js/tabungan.js`, `osis/tabungan.html`) + rewrite `keuangan` (1500 baris).

## [v2.3.0] — 2026-09-15 — minor
- Commit: `874347a` — `visitor`
- 4 files, +273 / -59
- Fitur visitor tracking (`js/visitor.js`, `js/db.js`, `code.sql`).

## [v2.2.2] — 2026-09-09 — patch
- Commit: `836aac1` — `addsitemap`
- 1 file, +8
- Tambah `sitemap.xml`.

## [v2.2.1] — 2026-09-09 — patch
- Commit: `baf7ea2` — `deletesitemap`
- 1 file, -8
- Hapus `sitemap.xml`.

## [v2.2.0] — 2026-09-08 — minor
- Commit: `247281e` — `08sep`
- 23 files, +851 / -87
- Form publik (`js/form-publik.js`, `osis/form.html`) + SEO (`robots.txt`, `sitemap.xml`).

## [v2.1.3] — 2026-09-07 — patch
- Commit: `d2dcb09` — `Create CNAME`
- 1 file, +1
- Config domain `CNAME`.

## [v2.1.2] — 2026-09-06 — patch
- Commit: `f52d5f2` — `webkittap`
- 1 file, +4
- Fix CSS webkit-tap.

## [v2.1.1] — 2026-09-06 — patch
- Commit: `c7fcae5` — `06sepnew`
- 32 files, +38 / -21
- Hapus foto sekbid (15 file webp), penyesuaian kecil template.

## [v2.1.0] — 2026-09-06 — minor
- Commit: `b702293` — `testpwa`
- 44 files, +3406 / -841
- Fondasi PWA: `manifest.webmanifest`, `sw.js`, `offline.html`, icons. Fitur Dashboard (`js/dashboard.js`), Formulir (`js/formulir.js`, `osis/formulir.html`), Sidebar (`js/osis-sidebar.js`).

## [v2.0.0] — 2026-09-06 — major
- Commit: `b3a5935` — `06sep`
- 20 files, +11225 / -23
- Modul inti OSIS (8 modul, ~500-700 baris/modul): Anggota, Dokumen, Evaluasi, Keuangan, Notulensi, Profil, Proker, Task + 8 halaman `osis/`.

## [v1.1.0] — 2026-09-05 — minor
- Commit: `f550cca` — `mmm`
- 14 files, +2695 / -1006
- Iterasi kedua: `osis/index.html` + `js/osis-menu.js` baru, rombak modul awal.

## [v1.0.0] — 2026-09-02 — major (rilis awal)
- Commit: `3a17f16` — `domain baru`
- 22 files, +8996
- Fondasi: `index.html`, `login.html`, `css/style.css` (3145 baris), `code.sql` (834 baris), modul `agenda`, `aspirasi`, `galeri`, `kegiatan`, `lagu`, `prestasi`, `sekbid`, `visitor`, `db` (699 baris).
