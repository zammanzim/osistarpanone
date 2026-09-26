// tools/changelog-tambah.mjs — tambah 1 entri versi tanpa ngetik manual JSON/MD
//
// PAKAI (jalankan dari root repo):
//   node tools/changelog-tambah.mjs --tipe minor --judul "Fitur X" --deskripsi "Penjelasan singkat"
//   node tools/changelog-tambah.mjs --tipe patch --judul "Fix Y" --deskripsi "..." --kering
//
// OPSI:
//   --tipe patch|minor|major   (wajib) — patch=fix kecil, minor=fitur sedang, major=gede/breaking
//   --judul "..."              (wajib) — judul pendek Indonesia, cth: "Fitur Arsip"
//   --deskripsi "..."          (wajib) — 1-2 kalimat penjelasan user-friendly
//   --versi vX.Y.Z             (opsional) — kalau kosong, OTOMATIS naik dari entri teratas changelog.json
//   --komit HEAD               (opsional) — hash/ref commit sumber stat (default: HEAD)
//   --pesan "..."              (opsional) — default: subject commit --komit
//   --tanggal YYYY-MM-DD       (opsional) — default: tanggal commit, fallback hari ini
//   --kering                   (opsional) — dry-run: tampilkan entri tanpa menulis file
//
// KERJA: baca changelog.json (index 0 = versi terbaru) → hitung versi berikut →
// ambil stat (files/+/-) via `git show --shortstat` (fallback: `git diff HEAD --shortstat`) →
// prepend ke changelog.json → generate ulang CHANGELOG.md → print langkah commit+tag.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function pakai() {
  console.log(`Pakai:
  node tools/changelog-tambah.mjs --tipe minor --judul "Fitur X" --deskripsi "..."
  node tools/changelog-tambah.mjs --tipe patch --judul "Fix Y" --deskripsi "..." --kering
  node tools/changelog-tambah.mjs --help`);
}

const raw = process.argv.slice(2);
if (raw.includes("--help") || raw.includes("-h")) { pakai(); process.exit(0); }

function ambil(nama, pendek = null) {
  const i = raw.findIndex((a) => a === nama || (pendek && a === pendek));
  if (i === -1 || i + 1 >= raw.length) return null;
  return raw[i + 1];
}
const TIPE = ambil("--tipe", "-t");
const JUDUL = ambil("--judul", "-j");
const DESKRIPSI = ambil("--deskripsi", "-d");
const VERSI_MANUAL = ambil("--versi", "-v");
const KOMIT = ambil("--komit") || "HEAD";
const PESAN_MANUAL = ambil("--pesan");
const TGL_MANUAL = ambil("--tanggal");
const KERING = raw.includes("--kering") || raw.includes("--dry-run");

if (!["patch", "minor", "major"].includes(TIPE || "")) {
  console.error('Wajib: --tipe patch|minor|major  (contoh: --tipe minor)');
  process.exit(1);
}
if (!JUDUL || !DESKRIPSI) {
  console.error('Wajib: --judul "..." dan --deskripsi "..."');
  process.exit(1);
}

function git(cmd, fallback = "") {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return fallback; }
}

// 1) Versi berikut (otomatis kalau --versi kosong)
const fJson = "changelog.json";
if (!existsSync(fJson)) { console.error("changelog.json tidak ketemu (jalankan dari root repo)."); process.exit(1); }
const daftar = JSON.parse(readFileSync(fJson, "utf8"));
const terakhir = daftar[0]?.version || "v1.0.0";
function naikkan(versi, tipe) {
  const m = String(versi).match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Versi terakhir tidak valid: ${versi}`);
  let [x, y, z] = [+m[1], +m[2], +m[3]];
  if (tipe === "major") return `v${x + 1}.0.0`;
  if (tipe === "minor") return `v${x}.${y + 1}.0`;
  return `v${x}.${y}.${z + 1}`;
}
const VERSI = VERSI_MANUAL || naikkan(terakhir, TIPE);
if (daftar.some((r) => r.version === VERSI)) {
  console.error(`Versi ${VERSI} sudah ada di changelog.json (terakhir: ${terakhir}). Isi --versi lain atau cek tipenya.`);
  process.exit(1);
}

// 2) Hash + pesan + tanggal (otomatis dari git)
const HASH = git(`git rev-parse ${KOMIT}`, "");
const PESAN = PESAN_MANUAL || git(`git log -1 --pretty=%s ${KOMIT}`, "");
const TANGGAL = TGL_MANUAL || git(`git log -1 --date=short --pretty=%ad ${KOMIT}`, "") || new Date().toISOString().slice(0, 10);

// 3) Stat files/+/- : kalau working tree kotor (ada yg belum di-commit),
// pakai diff kerja — karena itulah yg mau diberi versi. Kalau bersih, pakai commit.
function statDari(teks) {
  const m = String(teks).match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
  if (!m) return null;
  return { filesChanged: +m[1], insertions: +(m[2] || 0), deletions: +(m[3] || 0) };
}
const kotor = git(`git status --porcelain`) !== "";
const statDiff = statDari(git(`git diff HEAD --shortstat`));
const statKomit = statDari(git(`git show --shortstat --format= ${KOMIT}`));
const stat = (kotor && statDiff) ? statDiff : (statKomit || statDiff || { filesChanged: 0, insertions: 0, deletions: 0 });
const hashEfektif = (kotor && KOMIT === "HEAD") ? "" : HASH;

const entri = {
  version: VERSI,
  date: TANGGAL,
  type: TIPE,
  commit: hashEfektif,
  message: PESAN,
  title: JUDUL,
  description: DESKRIPSI,
  filesChanged: stat.filesChanged,
  insertions: stat.insertions,
  deletions: stat.deletions,
};

if (KERING) {
  console.log(JSON.stringify(entri, null, 2));
  console.log(`\n(kering: tidak menulis file — ${terakhir} → ${VERSI})`);
  process.exit(0);
}

// 4) Tulis changelog.json (prepend, newest-first)
daftar.unshift(entri);
writeFileSync(fJson, JSON.stringify(daftar, null, 2) + "\n");

// 5) Generate ulang CHANGELOG.md dari JSON (biar JSON = sumber tunggal)
const labelTipe = { major: "major", minor: "minor", patch: "patch" };
const blok = daftar.map((r) => {
  const short = String(r.commit || "").slice(0, 7);
  return `## [${r.version}] — ${r.date} — ${labelTipe[r.type] || r.type}\n` +
    `- Commit: \`${short}\` — \`${r.message}\`\n` +
    `- ${r.filesChanged} files, +${r.insertions} / -${r.deletions}\n` +
    `- ${r.title}: ${r.description}\n`;
}).join("\n");
const md = `# Changelog — OSIS TARPAN ONE\n\n` +
  `Aturan versi (SemVer sederhana):\n` +
  `- \`vX.X.1\` (patch) — fix kecil: typo, CSS 1-2 baris, config \`robots.txt\` / \`manifest\` / \`sitemap\`, toggle kecil.\n` +
  `- \`vX.1.0\` (minor) — fitur sedang, non-breaking: 1 halaman / 1 modul baru, migrasi SQL non-breaking.\n` +
  `- \`vX.0.0\` (major) — perubahan besar / breaking: restruktur direktori, ganti sistem auth, hapus kode duplikat, modul inti baru.\n\n` +
  `Versi berjalan: **${daftar[0].version}** (${daftar[0].date}). Total ${daftar.length} entri.\n\n` +
  `> JSON (\`changelog.json\`) adalah sumber tunggal — file ini digenerate otomatis via \`node tools/changelog-tambah.mjs\`. Jangan edit manual.\n\n` + blok;
writeFileSync("CHANGELOG.md", md);

console.log(`OK: ${terakhir} → ${VERSI} (${TIPE}) — ${JUDUL}`);
console.log(`Stat: ${stat.filesChanged} files, +${stat.insertions} / -${stat.deletions} @ ${hashEfektif ? hashEfektif.slice(0, 7) : "(hash diisi setelah commit — edit manual / jalanin ulang)"}`);
console.log(`\nLangkah lanjut:\n  git add changelog.json CHANGELOG.md\n  git commit -m "${VERSI}: ${JUDUL}"\n  git tag -a ${VERSI} -m "${VERSI} ${JUDUL}"`);
