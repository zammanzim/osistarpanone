// =========================================================================
// DATA LAYER - SEMUA AKSES SUPABASE LEWAT FILE INI
// Urutan include: 1) CDN supabase-js  2) config.js  3) db.js
// =========================================================================

const supa = (() => {
  try {
    return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    // CDN gagal dimuat (offline sebelum sempat cache) — JANGAN matikan file ini.
    // Cache/DeviceId/getter lokal tetap jalan; semua akses network lempar error
    // ramah yang ditangkap UI (adapterOffline di bawah) jadi daftar cache tetap tampil.
    console.warn("Supabase CDN belum termuat, mode baca-cache.", e);
    const t = new Error("Offline — data live tidak tersedia.");
    return new Proxy(
      {},
      {
        get() {
          throw t;
        },
      },
    );
  }
})();

// Normalisasi error RPC tulis: penolakan hak akses jadi pesan yang ramah.
// Dipakai semua wrapper di bawah (cekOk = hasil "OK", cekId = hasil id baru).
function cekOk(data) {
  if (data === "OK") return;
  throw new Error(data === "ERR_NO_AUTH" ? "Kamu tidak punya kendali atas halaman ini." : data);
}
function cekId(data) {
  if (data && Number(data) > 0) return data;
  if (Number(data) === -1) throw new Error("Kamu tidak punya kendali atas halaman ini.");
  throw new Error("Gagal simpan (" + data + ")");
}

// Nama pengupload untuk kolom snapshot `pengunggah` (semua modul konten).
// Catatan: trigger DB `isi_pengunggah` otomatis mengisi dari osis_users.nama
// saat insert bila kolom dikosongkan, jadi helper ini opsional / eksplisit.
function namaPengunggah() {
  try {
    const u = typeof OsisAuth !== "undefined" && OsisAuth.getUser ? OsisAuth.getUser() : null;
    if (!u) return "";
    if (typeof OsisAuth.displayName === "function") {
      const n = String(OsisAuth.displayName(u) || "").trim();
      if (n) return n.slice(0, 80);
    }
    return String(u.nama || u.username || "").trim().slice(0, 80);
  } catch { return ""; }
}

// Bangun URL publik media. DB menyimpan path relatif (mis. gallery/abc.jpg)
// yang identik di R2 dan di bucket Supabase lama — cukup ganti base URL.
// File lama dibulk-pindah ke R2 dengan key yang sama, jadi tanpa migrasi DB.
function getFoto(pathFoto) {
  if (!pathFoto) return "";
  if (pathFoto.startsWith("http")) return pathFoto;
  const bersih = String(pathFoto).replace(/^\/+/, "");
  if (typeof R2_ENABLED !== "undefined" && R2_ENABLED && typeof R2_PUBLIC_BASE === "string" && R2_PUBLIC_BASE.startsWith("http")) {
    return `${R2_PUBLIC_BASE.replace(/\/$/, "")}/${bersih}`;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${bersih}`;
}

// Minta presigned URL ke Worker (auth via JWT Supabase dari session aktif).
async function r2MintaPresign(op, path, contentType) {
  let token = "";
  try {
    const { data } = await supa.auth.getSession();
    token = (data && data.session && data.session.access_token) || "";
  } catch {}
  if (!token) {
    throw new Error("Kamu belum login — login dulu biar bisa upload.");
  }
  const res = await fetch(R2_PRESIGN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(op === "delete"
      ? { op, path }
      : { op, path, contentType }),
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const pesan = (body && body.error) || `Presign gagal (${res.status})`;
    throw new Error(res.status === 401 ? "Sesi habis — login ulang dulu." : pesan);
  }
  if (!body || !body.url) throw new Error("Presign tidak mengembalikan URL.");
  return body;
}

function r2Aktif() {
  return typeof R2_ENABLED !== "undefined" && R2_ENABLED
    && typeof R2_PRESIGN_URL === "string" && R2_PRESIGN_URL.startsWith("http");
}

// =========================================================================
// CACHE - SWR (stale-while-revalidate) biar instant
// Simpen hasil fetch di localStorage, tampilin cache dulu, revalidasi
// di background. Key: osis_cache_<nama>
// =========================================================================
const Cache = {
  version: "v2",
  prefix: "osis_cache_",
  key(key) {
    return Cache.prefix + Cache.version + "_" + key;
  },
  get(key) {
    try {
      const raw = localStorage.getItem(Cache.key(key));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj.data;
    } catch {
      return null;
    }
  },
  set(key, data) {
    try {
      localStorage.setItem(
        Cache.key(key),
        JSON.stringify({ data, t: Date.now(), v: Cache.version }),
      );
    } catch {}
  },
  del(key) {
    try {
      localStorage.removeItem(Cache.key(key));
    } catch {}
  },
  delMany(keys) {
    keys.forEach((key) => Cache.del(key));
  },
};

// =========================================================================
// DEVICE ID - id unik per perangkat (buat limit harian & visitor)
// Disimpan dobel: localStorage + cookie (2 tahun). Kalo salah satunya
// kehapus (clear data, dll), id lamanya masih kebaca - anti nambah
// kunjungan palsu dari perangkat yang sama.
// =========================================================================

const DEVICE_COOKIE = "osis_did";

function bacaCookie(nama) {
  const m = document.cookie.match(
    new RegExp("(?:^|;\\s*)" + nama + "=([^;]*)"),
  );
  return m ? decodeURIComponent(m[1]) : "";
}

function simpanCookie(nama, nilai) {
  document.cookie =
    nama +
    "=" +
    encodeURIComponent(nilai) +
    ";max-age=63072000;path=/;SameSite=Lax";
}

function getDeviceId() {
  let id = localStorage.getItem("osis_device_id") || bacaCookie(DEVICE_COOKIE);
  if (!id) {
    id =
      "dev_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10);
  }
  localStorage.setItem("osis_device_id", id);
  simpanCookie(DEVICE_COOKIE, id);
  return id;
}

// Nama perangkat friendly dari user-agent (buat list di popup visitor)
function namaPerangkat() {
  const ua = navigator.userAgent || "";
  let m;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  // Android: model HP sering kebawa di UA (cth: SM-A155F, Redmi Note 12)
  m = ua.match(/Android[\s\d.]*;\s*([^;)]+?)\s*(?:Build\/|\))/i);
  if (m) {
    const model = m[1].trim().replace(/\s+/g, " ");
    if (!model || model.toLowerCase() === "k") return "Android";
    return model.slice(0, 32);
  }
  m = ua.match(/Android\s([\d.]+)/i);
  if (m) return "Android " + m[1];
  if (/Windows/i.test(ua)) {
    const br = /Edg\//i.test(ua)
      ? "Edge"
      : /OPR\//i.test(ua)
        ? "Opera"
        : /Chrome/i.test(ua)
          ? "Chrome"
          : /Firefox/i.test(ua)
            ? "Firefox"
            : "";
    return br ? "Windows · " + br : "Windows";
  }
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}

// Info perangkat buat dicatat: tipe, user-agent mentah, resolusi layar
function infoPerangkat() {
  const ua = navigator.userAgent || "";
  let tipe = "Desktop";
  if (
    /iPad|Tablet|PlayBook|Silk/i.test(ua) ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua))
  ) {
    tipe = "Tablet";
  } else if (/Mobi|iPhone|iPod|Android/i.test(ua)) {
    tipe = "Mobile";
  }
  return {
    tipe: tipe,
    ua: ua,
    resolusi: window.screen
      ? window.screen.width + "x" + window.screen.height
      : "",
  };
}

// Nama buat kolom name di tabel visitor:
// - login OSIS -> nama anggota
// - login guest -> nickname
// - anonim -> kosong (biar ga ngehapus nama lama yang udah kesimpen)
function getVisitorName() {
  try {
    const u =
      typeof OsisAuth !== "undefined" && OsisAuth.getUser
        ? OsisAuth.getUser()
        : null;
    if (!u) return "";
    if (u.mode === "osis") return String(u.nama || "").trim();
    return String(u.nickname || "").trim(); // guest
  } catch {
    return "";
  }
}

// Kunci identitas login buat kolom user_key di tabel visitor:
// - login OSIS -> "osis:<id>" (stabil walau nama diganti)
// - login guest -> "guest:<nickname-lower>" (nickname dianggap identitas)
// - anonim -> "" (tetap dihitung per device, ga digabung)
// Dipake server buat nimpa: 1 user = 1 baris walau pindah device.
function getVisitorKey() {
  try {
    const u =
      typeof OsisAuth !== "undefined" && OsisAuth.getUser
        ? OsisAuth.getUser()
        : null;
    if (!u) return "";
    if (u.mode === "osis") {
      const id = String(u.id ?? u.username ?? "")
        .trim()
        .toLowerCase();
      return id ? "osis:" + id : "";
    }
    const nick = String(u.nickname || "")
      .trim()
      .toLowerCase();
    return nick ? "guest:" + nick : "";
  } catch {
    return "";
  }
}

// =========================================================================
// AUTH - akun OSIS dari tabel osis_users
// =========================================================================

// Ambil akun OSIS by username (password dicompare di client, pola e-learniz)
// Fallback ke kolom lama kalau migrasi foto/bio belum di-run di Supabase
async function getOsisUser(username) {
  try {
    const { data, error } = await supa
      .from("osis_users")
      .select("id, username, password, nama, jabatan, foto, bio")
      .eq("username", username)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (err) {
    // kolom foto/bio belum ada - pakai kolom lama
    if (!String(err.message || "").match(/foto|bio|column/i)) throw err;
    const { data, error } = await supa
      .from("osis_users")
      .select("id, username, password, nama, jabatan")
      .eq("username", username)
      .maybeSingle();
    if (error) throw error;
    return data ? { ...data, foto: "", bio: "" } : null;
  }
}

// Ambil akun OSIS by id (buat refresh profil, termasuk password buat verifikasi)
async function getOsisUserById(id) {
  try {
    const { data, error } = await supa
      .from("osis_users")
      .select("id, username, password, nama, jabatan, foto, bio")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (err) {
    if (!String(err.message || "").match(/foto|bio|column/i)) throw err;
    const { data, error } = await supa
      .from("osis_users")
      .select("id, username, password, nama, jabatan")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? { ...data, foto: "", bio: "" } : null;
  }
}

// Update profil OSIS (nama + bio + foto PP) - validasi akun di server
async function updateOsisProfil(userId, nama, bio, foto) {
  const { data, error } = await supa.rpc("update_osis_profil", {
    p_user_id: userId,
    p_nama: nama,
    p_bio: bio,
    p_foto: foto,
  });
  if (error) throw error;
  cekOk(data);
}

// Ganti username OSIS (harus unik) - return OK atau throw ERR_TAKEN/ERR_INVALID
async function gantiOsisUsername(userId, username) {
  const { data, error } = await supa.rpc("ganti_osis_username", {
    p_user_id: userId,
    p_username: username,
  });
  if (error) throw error;
  cekOk(data);
}

// Ganti password OSIS (verifikasi lama di server) - throw ERR_WRONG/ERR_INVALID
async function gantiOsisPassword(userId, oldPw, newPw) {
  const { data, error } = await supa.rpc("ganti_osis_password", {
    p_user_id: userId,
    p_old: oldPw,
    p_new: newPw,
  });
  if (error) throw error;
  cekOk(data);
}

// =========================================================================
// PUBLIC
// =========================================================================

// Ketua & wakil semua tahun
async function getPimpinan() {
  const { data, error } = await supa
    .from("pimpinan")
    .select("*")
    .order("tahun", { ascending: true });
  if (error) throw error;
  return data;
}

// Anggota semua tahun, urut jabatan
async function getAnggota() {
  const { data, error } = await supa
    .from("anggota")
    .select("*")
    .order("tahun", { ascending: true })
    .order("urutan", { ascending: true });
  if (error) throw error;
  return data;
}

// Seksi bidang & BPH
async function getSekbid() {
  const { data, error } = await supa
    .from("sekbid")
    .select("*")
    .order("urutan", { ascending: true });
  if (error) throw error;
  return data;
}

// Foto halaman web (tabel web_foto)
async function getWebFoto() {
  const { data, error } = await supa
    .from("web_foto")
    .select("*")
    .order("kunci", { ascending: true });
  if (error) throw error;
  return data;
}

// Kirim aspirasi siswa - lewat RPC biar bisa dilimit per device per hari
async function kirimAspirasi(nama, kelas, isi, isPrivate = false) {
  const { data, error } = await supa.rpc("kirim_aspirasi_terbatas", {
    p_device_id: getDeviceId(),
    p_nama: nama,
    p_kelas: kelas,
    p_isi: isi,
    p_is_private: !!isPrivate,
  });
  if (error) throw error;
  cekOk(data);
}

// Ambil aspirasi terbaru buat ditampilkan (terbaru di atas, maks 50)
async function getAspirasi() {
  const { data, error } = await supa
    .from("aspirasi")
    .select("id, device_id, nama, kelas, isi, is_private, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

// Hapus aspirasi milik sendiri (device_id dicek di server)
async function hapusAspirasiSendiri(id) {
  const { data, error } = await supa.rpc("hapus_aspirasi_own", {
    p_device_id: getDeviceId(),
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
}

// Cek sakelar buka/tutup aspirasi
async function cekStatusAspirasi() {
  try {
    const { data, error } = await supa
      .from("pengaturan")
      .select("nilai")
      .eq("kunci", "status_aspirasi")
      .maybeSingle();
    if (error) throw error;
    return data ? String(data.nilai).trim().toUpperCase() : "BUKA";
  } catch (err) {
    console.error("Gagal baca sakelar aspirasi, default BUKA", err);
    return "BUKA";
  }
}

// Kirim request lagu (radio jam istirahat) - lewat RPC biar bisa dilimit
async function kirimRequestLagu(judul, penyanyi, pesan, nama) {
  const { data, error } = await supa.rpc("kirim_lagu_terbatas", {
    p_device_id: getDeviceId(),
    p_judul: judul,
    p_penyanyi: penyanyi,
    p_pesan: pesan,
    p_nama: nama,
  });
  if (error) throw error;
  cekOk(data);
}

// Catat kunjungan unik per perangkat (1x per hari WIB), return total kunjungan.
// Kalo login, kirim user_key juga biar server bisa nimpa: user sama di
// device lain ga jadi dobel, disatuin ke device terbaru (jumlah digabung).
async function catatVisitor() {
  const info = infoPerangkat();
  const payload = {
    p_key: getDeviceId(),
    p_label: namaPerangkat(),
    p_tipe: info.tipe,
    p_ua: info.ua,
    p_resolusi: info.resolusi,
    p_name: getVisitorName(),
    p_user_key: getVisitorKey(),
  };
  let { data, error } = await supa.rpc("tambah_visitor_unik", payload);
  // Fallback: kalo function baru (7 param) belum di-run di Supabase,
  // ulangi tanpa p_user_key biar kunjungan tetap kecatet.
  if (
    error &&
    String(error.message || "").match(/p_user_key|function|signature|argument/i)
  ) {
    const fb = await supa.rpc("tambah_visitor_unik", {
      p_key: payload.p_key,
      p_label: payload.p_label,
      p_tipe: payload.p_tipe,
      p_ua: payload.p_ua,
      p_resolusi: payload.p_resolusi,
      p_name: payload.p_name,
    });
    data = fb.data;
    error = fb.error;
  }
  if (error) throw error;
  return data || 0;
}

// Ambil request lagu terbaru (terbaru di atas, maks 30)
async function getRequestLagu() {
  const kolom = "id, device_id, judul, penyanyi, pesan, nama, selesai, created_at";
  let { data, error } = await supa
    .from("lagu_requests")
    .select(kolom)
    .order("created_at", { ascending: false })
    .limit(30);
  // Fallback: DB belum dimigrasi (kolom selesai belum ada) -> select lama.
  if (error && String(error.message || "").match(/selesai|schema cache|column/i)) {
    const fb = await supa
      .from("lagu_requests")
      .select("id, device_id, judul, penyanyi, pesan, nama, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (fb.error) throw fb.error;
    return (fb.data || []).map(r => ({ ...r, selesai: false }));
  }
  if (error) throw error;
  return data || [];
}

// Hapus request lagu milik sendiri (device_id dicek di server)
async function hapusLaguSendiri(id) {
  const { data, error } = await supa.rpc("hapus_lagu_own", {
    p_device_id: getDeviceId(),
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
}

// Hapus aspirasi/lagu oleh OSIS (boleh hapus punya siapa aja)
async function hapusAspirasiOsis(userId, id) {
  const { data, error } = await supa.rpc("hapus_aspirasi_osis", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
}
async function hapusLaguOsis(userId, id) {
  const { data, error } = await supa.rpc("hapus_lagu_osis", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
}

// Edit aspirasi milik sendiri (device_id + 1 jam dicek di server)
async function editAspirasiSendiri(id, nama, kelas, isi) {
  const { data, error } = await supa.rpc("edit_aspirasi_own", {
    p_device_id: getDeviceId(),
    p_id: id,
    p_nama: nama,
    p_kelas: kelas,
    p_isi: isi,
  });
  if (error) throw error;
  cekOk(data);
}

// Edit request lagu milik sendiri (device_id + 1 jam dicek di server)
async function editLaguSendiri(id, judul, penyanyi, pesan, nama) {
  const { data, error } = await supa.rpc("edit_lagu_own", {
    p_device_id: getDeviceId(),
    p_id: id,
    p_judul: judul,
    p_penyanyi: penyanyi,
    p_pesan: pesan,
    p_nama: nama,
  });
  if (error) throw error;
  cekOk(data);
}

// Edit aspirasi/lagu oleh OSIS (boleh ubah punya siapa aja)
async function editAspirasiOsis(userId, id, nama, kelas, isi) {
  const { data, error } = await supa.rpc("edit_aspirasi_osis", {
    p_user_id: userId,
    p_id: id,
    p_nama: nama,
    p_kelas: kelas,
    p_isi: isi,
  });
  if (error) throw error;
  cekOk(data);
}
async function editLaguOsis(userId, id, judul, penyanyi, pesan, nama) {
  const { data, error } = await supa.rpc("edit_lagu_osis", {
    p_user_id: userId,
    p_id: id,
    p_judul: judul,
    p_penyanyi: penyanyi,
    p_pesan: pesan,
    p_nama: nama,
  });
  if (error) throw error;
  cekOk(data);
}

// Tandai selesai / batalkan request lagu (KHUSUS super_admin)
async function tandaiLaguSelesai(userId, id, selesai = true) {
  const { data, error } = await supa.rpc("tandai_lagu_selesai", {
    p_user_id: userId,
    p_id: id,
    p_selesai: !!selesai,
  });
  if (error) throw error;
  cekOk(data);
}

// =========================================================================
// POLLING WAKETOS - kandidat publik + vote 1x (wajib login) + hasil live
// Vote TIDAK masuk Outbox (wajib online biar tidak dobel). Kelola kandidat
// + buka/tutup + reset butuh hak "polling" (diatur super_admin di Akses).
// =========================================================================
async function getPollingKandidat() {
  const { data, error } = await supa
    .from("polling_kandidat")
    .select("id, nomor, nama, kelas, foto, visi, misi, display_order, pengunggah, created_at")
    .order("display_order", { ascending: true })
    .order("nomor", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Hasil live: { perKandidat: {id: jumlah}, total }
// Sekali panggil (RPC polling_hasil_total). Kalau DB belum dimigrasi,
// otomatis fallback ke 2 RPC lama dan diingat untuk tick berikutnya.
let _pollingHasilTotalOK = null;
async function getPollingHasil() {
  if (_pollingHasilTotalOK !== false) {
    try {
      const { data, error } = await supa.rpc("polling_hasil_total");
      if (error) throw error;
      _pollingHasilTotalOK = true;
      const map = {};
      ((data && data.hasil) || []).forEach((h) => {
        map[String(h.kandidat_id)] = Number(h.jumlah) || 0;
      });
      return { perKandidat: map, total: Number((data && data.total) || 0) };
    } catch (err) {
      const msg = String((err && err.message) || "");
      const hilang =
        (err && (err.code === "PGRST202" || err.code === "42883")) ||
        /not found|does not exist/i.test(msg);
      if (!hilang) throw err;
      _pollingHasilTotalOK = false;
    }
  }
  const [hasil, total] = await Promise.all([
    supa.rpc("polling_hasil").then((r) => {
      if (r.error) throw r.error;
      return r.data || [];
    }),
    supa.rpc("polling_total").then((r) => {
      if (r.error) throw r.error;
      return Number(r.data) || 0;
    }),
  ]);
  const map = {};
  (hasil || []).forEach((h) => {
    map[String(h.kandidat_id)] = Number(h.jumlah) || 0;
  });
  return { perKandidat: map, total };
}

// Kandidat yang dipilih perangkat ini (id / null kalau belum vote)
async function getPollingSuaraSaya() {
  const { data, error } = await supa.rpc("polling_suara_saya", {
    p_device_id: getDeviceId(),
  });
  if (error) throw error;
  return data == null ? null : Number(data);
}

// Vote. userKey/nama diambil dari sesi login (guest / OSIS).
// Return: "OK" (baru) / "OK_GANTI" (pindah pilihan) / "OK_SAMA".
async function votePolling(kandidatId) {
  const u =
    typeof OsisAuth !== "undefined" && OsisAuth.getUser
      ? OsisAuth.getUser()
      : null;
  if (!u) throw new Error("ERR_NO_LOGIN");
  let key = "";
  let nama = "";
  if (u.mode === "osis" && u.id) {
    key = "osis:" + u.id;
    nama = u.nama || u.username || "";
  } else if (
    typeof OsisAuth.isGuest === "function" &&
    OsisAuth.isGuest(u) &&
    String(u.nickname || "").trim()
  ) {
    key = "guest:" + String(u.nickname).trim().toLowerCase();
    nama = String(u.nickname).trim();
  } else {
    throw new Error("ERR_NO_LOGIN");
  }
  const { data, error } = await supa.rpc("vote_polling", {
    p_device_id: getDeviceId(),
    p_user_key: key,
    p_nama: nama,
    p_kandidat_id: kandidatId,
  });
  if (error) throw error;
  if (data === "OK" || data === "OK_GANTI" || data === "OK_SAMA") {
    Cache.del("polling_hasil");
    Cache.del("polling_saya");
    return data;
  }
  throw new Error(data);
}

// Sakelar buka/tutup (site_content.polling_status, default BUKA)
async function cekStatusPolling() {
  try {
    const { data, error } = await supa
      .from("site_content")
      .select("nilai")
      .eq("kunci", "polling_status")
      .maybeSingle();
    if (error) throw error;
    return data ? String(data.nilai).trim().toUpperCase() : "BUKA";
  } catch (err) {
    console.error("Gagal baca status polling, default BUKA", err);
    return "BUKA";
  }
}

async function getPollingJudul() {
  try {
    const { data, error } = await supa
      .from("site_content")
      .select("nilai")
      .eq("kunci", "polling_judul")
      .maybeSingle();
    if (error) throw error;
    return data && data.nilai ? String(data.nilai) : "Polling Wakil Ketua OSIS";
  } catch {
    return "Polling Wakil Ketua OSIS";
  }
}

async function tambahPollingKandidat(userId, f) {
  const { data, error } = await supa.rpc("polling_kandidat_tambah", {
    p_user_id: userId,
    p_nomor: f.nomor ?? 1,
    p_nama: f.nama || "",
    p_kelas: f.kelas || "",
    p_foto: f.foto || "",
    p_visi: f.visi || "",
    p_misi: f.misi || "",
    p_order: f.order ?? 99,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("polling_kandidat");
  return data;
}

async function ubahPollingKandidat(userId, id, f) {
  const { data, error } = await supa.rpc("polling_kandidat_ubah", {
    p_user_id: userId,
    p_id: id,
    p_nomor: f.nomor ?? 1,
    p_nama: f.nama || "",
    p_kelas: f.kelas || "",
    p_foto: f.foto || "",
    p_visi: f.visi || "",
    p_misi: f.misi || "",
    p_order: f.order ?? 99,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("polling_kandidat");
}

async function hapusPollingKandidat(userId, id) {
  const { data, error } = await supa.rpc("polling_kandidat_hapus", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("polling_kandidat");
  Cache.del("polling_hasil");
}

async function setPollingStatus(userId, status) {
  const { data, error } = await supa.rpc("set_polling_status", {
    p_user_id: userId,
    p_status: status,
  });
  if (error) throw error;
  cekOk(data);
}

async function resetPollingSuara(userId) {
  const { data, error } = await supa.rpc("polling_reset", {
    p_user_id: userId,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("polling_hasil");
  Cache.del("polling_saya");
}

// =========================================================================
// PRESTASI - home (DB-driven, multi-foto, display_order)
// =========================================================================
async function getPrestasi() {
  const { data, error } = await supa
    .from("prestasi")
    .select("id, tag, caption, fotos, display_order, pengunggah, created_at")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}
async function buatPrestasi(userId, tag, caption, fotos, order = 99) {
  const { data, error } = await supa.rpc("buat_prestasi", {
    p_user_id: userId,
    p_tag: tag,
    p_caption: caption,
    p_fotos: fotos,
    p_display_order: order,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("prestasi");
  return data;
}
async function updatePrestasi(userId, id, tag, caption, fotos, order) {
  const { data, error } = await supa.rpc("update_prestasi", {
    p_user_id: userId,
    p_id: id,
    p_tag: tag,
    p_caption: caption,
    p_fotos: fotos,
    p_display_order: order,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("prestasi");
}
async function hapusPrestasi(userId, id) {
  const { data, error } = await supa.rpc("hapus_prestasi", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("prestasi");
}

// =========================================================================
// POSTER - feed foto + caption (arsip peringatan), 1 foto per poster
// =========================================================================
async function getPoster() {
  const { data, error } = await supa
    .from("poster")
    .select("id, judul, caption, foto, created_by, pengunggah, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}
async function buatPoster(userId, judul, caption, foto) {
  const { data, error } = await supa.rpc("buat_poster", {
    p_user_id: userId,
    p_judul: judul,
    p_caption: caption,
    p_foto: foto,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("poster");
  return data;
}
async function updatePoster(userId, id, judul, caption, foto) {
  const { data, error } = await supa.rpc("update_poster", {
    p_user_id: userId,
    p_id: id,
    p_judul: judul,
    p_caption: caption,
    p_foto: foto,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("poster");
}
async function hapusPoster(userId, id) {
  const { data, error } = await supa.rpc("hapus_poster", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("poster");
}

// =========================================================================
// INFORMASI HARIAN - pengganti broadcast grup (/osis/informasi)
// Card shareable via ?id=. Kelola butuh hak "informasi".
// =========================================================================
const INFO_KOLOM = "id, judul, subjudul, kepada, pembuka, tanggal, jam, tempat, bawaan, penutup, created_by, pengunggah, created_at";
async function getInformasiList() {
  const { data, error } = await supa
    .from("informasi")
    .select(INFO_KOLOM)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}
async function getInformasi(id) {
  const { data, error } = await supa
    .from("informasi")
    .select(INFO_KOLOM)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
async function buatInformasi(userId, f) {
  const { data, error } = await supa.rpc("buat_informasi", {
    p_user_id: userId,
    p_judul: f.judul,
    p_subjudul: f.subjudul || "",
    p_kepada: f.kepada || "",
    p_pembuka: f.pembuka || "",
    p_tanggal: f.tanggal || "",
    p_jam: f.jam || "",
    p_tempat: f.tempat || "",
    p_bawaan: f.bawaan || "",
    p_penutup: f.penutup || "",
  });
  if (error) throw error;
  cekId(data);
  Cache.del("informasi");
  return data;
}
async function updateInformasi(userId, id, f) {
  const { data, error } = await supa.rpc("update_informasi", {
    p_user_id: userId,
    p_id: id,
    p_judul: f.judul,
    p_subjudul: f.subjudul ?? null,
    p_kepada: f.kepada ?? null,
    p_pembuka: f.pembuka ?? null,
    p_tanggal: f.tanggal ?? null,
    p_jam: f.jam ?? null,
    p_tempat: f.tempat ?? null,
    p_bawaan: f.bawaan ?? null,
    p_penutup: f.penutup ?? null,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("informasi");
}
async function hapusInformasi(userId, id) {
  const { data, error } = await supa.rpc("hapus_informasi", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("informasi");
}

// =========================================================================
// KEGIATAN HOME - DB-driven (judul, deskripsi, badge, fotos jsonb, order)
// =========================================================================
async function getKegiatan() {
  const { data, error } = await supa
    .from("kegiatan")
    .select("id, judul, deskripsi, badge, fotos, display_order, pengunggah, created_at")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}
async function buatKegiatan(
  userId,
  judul,
  deskripsi,
  badge,
  fotos,
  order = 99,
) {
  const { data, error } = await supa.rpc("buat_kegiatan", {
    p_user_id: userId,
    p_judul: judul,
    p_deskripsi: deskripsi,
    p_badge: badge,
    p_fotos: fotos,
    p_display_order: order,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("kegiatan");
  return data;
}
async function updateKegiatan(
  userId,
  id,
  judul,
  deskripsi,
  badge,
  fotos,
  order,
) {
  const { data, error } = await supa.rpc("update_kegiatan", {
    p_user_id: userId,
    p_id: id,
    p_judul: judul,
    p_deskripsi: deskripsi,
    p_badge: badge,
    p_fotos: fotos,
    p_display_order: order,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("kegiatan");
}
async function hapusKegiatan(userId, id) {
  const { data, error } = await supa.rpc("hapus_kegiatan", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("kegiatan");
}

// =========================================================================
// NOTULENSI RAPAT - DB-driven (halaman osis/notulensi)
// =========================================================================
async function getNotulensi() {
  const { data, error } = await supa
    .from("rapat_notulensi")
    .select(
      "id, judul, tanggal, waktu_mulai, waktu_selesai, lokasi, divisi, pimpinan, notulis, peserta, agenda_topik, isi_pembahasan, keputusan, tindak_lanjut, lampiran, status, pengunggah, created_at",
    )
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function buatNotulensi(userId, f) {
  const { data, error } = await supa.rpc("buat_notulensi", {
    p_user_id: userId,
    p_judul: f.judul,
    p_tanggal: f.tanggal,
    p_waktu_mulai: f.waktu_mulai,
    p_waktu_selesai: f.waktu_selesai,
    p_lokasi: f.lokasi,
    p_divisi: f.divisi,
    p_pimpinan: f.pimpinan,
    p_notulis: f.notulis,
    p_peserta: f.peserta,
    p_agenda_topik: f.agenda_topik,
    p_isi_pembahasan: f.isi_pembahasan,
    p_keputusan: f.keputusan,
    p_tindak_lanjut: f.tindak_lanjut,
    p_lampiran: f.lampiran,
    p_status: f.status,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("notulensi");
  return data;
}
async function updateNotulensi(userId, id, f) {
  const { data, error } = await supa.rpc("update_notulensi", {
    p_user_id: userId,
    p_id: id,
    p_judul: f.judul,
    p_tanggal: f.tanggal,
    p_waktu_mulai: f.waktu_mulai,
    p_waktu_selesai: f.waktu_selesai,
    p_lokasi: f.lokasi,
    p_divisi: f.divisi,
    p_pimpinan: f.pimpinan,
    p_notulis: f.notulis,
    p_peserta: f.peserta,
    p_agenda_topik: f.agenda_topik,
    p_isi_pembahasan: f.isi_pembahasan,
    p_keputusan: f.keputusan,
    p_tindak_lanjut: f.tindak_lanjut,
    p_lampiran: f.lampiran,
    p_status: f.status,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("notulensi");
}
async function hapusNotulensi(userId, id) {
  const { data, error } = await supa.rpc("hapus_notulensi", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("notulensi");
}

// =========================================================================
// PROGRAM KERJA - DB-driven (halaman osis/proker)
// =========================================================================
async function getProker() {
  const { data, error } = await supa
    .from("proker")
    .select(
      "id, nama, deskripsi, divisi, pj, periode, tgl_mulai, tgl_selesai, lokasi, target_peserta, status, progress, catatan, agenda_ids, tugas, evaluasi_hasil, evaluasi_kendala, evaluasi_solusi, evaluasi_lanjut, dokumentasi, pengunggah, created_at",
    )
    .order("periode", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function buatProker(userId, f) {
  const { data, error } = await supa.rpc("buat_proker", {
    p_user_id: userId,
    p_nama: f.nama,
    p_deskripsi: f.deskripsi,
    p_divisi: f.divisi,
    p_pj: f.pj,
    p_periode: f.periode,
    p_tgl_mulai: f.tgl_mulai,
    p_tgl_selesai: f.tgl_selesai,
    p_lokasi: f.lokasi,
    p_target_peserta: f.target_peserta,
    p_status: f.status,
    p_progress: f.progress,
    p_catatan: f.catatan,
    p_agenda_ids: f.agenda_ids,
    p_tugas: f.tugas,
    p_evaluasi_hasil: f.evaluasi_hasil,
    p_evaluasi_kendala: f.evaluasi_kendala,
    p_evaluasi_solusi: f.evaluasi_solusi,
    p_evaluasi_lanjut: f.evaluasi_lanjut,
    p_dokumentasi: f.dokumentasi,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("proker");
  return data;
}
async function updateProker(userId, id, f) {
  const { data, error } = await supa.rpc("update_proker", {
    p_user_id: userId,
    p_id: id,
    p_nama: f.nama,
    p_deskripsi: f.deskripsi,
    p_divisi: f.divisi,
    p_pj: f.pj,
    p_periode: f.periode,
    p_tgl_mulai: f.tgl_mulai,
    p_tgl_selesai: f.tgl_selesai,
    p_lokasi: f.lokasi,
    p_target_peserta: f.target_peserta,
    p_status: f.status,
    p_progress: f.progress,
    p_catatan: f.catatan,
    p_agenda_ids: f.agenda_ids,
    p_tugas: f.tugas,
    p_evaluasi_hasil: f.evaluasi_hasil,
    p_evaluasi_kendala: f.evaluasi_kendala,
    p_evaluasi_solusi: f.evaluasi_solusi,
    p_evaluasi_lanjut: f.evaluasi_lanjut,
    p_dokumentasi: f.dokumentasi,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("proker");
}
async function hapusProker(userId, id) {
  const { data, error } = await supa.rpc("hapus_proker", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("proker");
}

// =========================================================================
// PROGRAM OSIS — Tahunan & Bulanan (halaman osis/program)
// =========================================================================
async function getProgram() {
  const { data, error } = await supa
    .from("program")
    .select("id, sekbid_id, nama, tipe, deskripsi, pj, tgl_mulai, tgl_selesai, lokasi, target_peserta, status, progress, catatan, pengunggah, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function buatProgram(userId, f) {
  const { data, error } = await supa.rpc("buat_program", {
    p_user_id: userId,
    p_sekbid_id: f.sekbid_id,
    p_tipe: f.tipe,
    p_nama: f.nama,
    p_deskripsi: f.deskripsi,
    p_pj: f.pj,
    p_tgl_mulai: f.tgl_mulai,
    p_tgl_selesai: f.tgl_selesai,
    p_lokasi: f.lokasi,
    p_target_peserta: f.target_peserta,
    p_status: f.status,
    p_progress: f.progress,
    p_catatan: f.catatan
  });
  if (error) throw error;
  cekId(data);
  Cache.del("program");
  return data;
}

async function updateProgram(userId, id, f) {
  const { data, error } = await supa.rpc("update_program", {
    p_user_id: userId,
    p_id: id,
    p_sekbid_id: f.sekbid_id,
    p_tipe: f.tipe,
    p_nama: f.nama,
    p_deskripsi: f.deskripsi,
    p_pj: f.pj,
    p_tgl_mulai: f.tgl_mulai,
    p_tgl_selesai: f.tgl_selesai,
    p_lokasi: f.lokasi,
    p_target_peserta: f.target_peserta,
    p_status: f.status,
    p_progress: f.progress,
    p_catatan: f.catatan
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("program");
}

async function hapusProgram(userId, id) {
  const { data, error } = await supa.rpc("hapus_program", {
    p_user_id: userId,
    p_id: id
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("program");
}

// =========================================================================
// DOKUMEN OSIS - DB-driven (halaman osis/dokumen)
// =========================================================================
async function getDokumen() {
  const { data, error } = await supa
    .from("osis_dokumen")
    .select(
      "id, nama, kategori, tahun, divisi, deskripsi, file_path, file_type, mime, ukuran_bytes, pengunggah, created_by, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function buatDokumen(userId, f) {
  const { data, error } = await supa.rpc("buat_dokumen", {
    p_user_id: userId,
    p_nama: f.nama,
    p_kategori: f.kategori,
    p_tahun: f.tahun,
    p_divisi: f.divisi,
    p_deskripsi: f.deskripsi,
    p_file_path: f.file_path,
    p_file_type: f.file_type,
    p_mime: f.mime,
    p_ukuran_bytes: f.ukuran_bytes,
    p_pengunggah: f.pengunggah,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("dokumen");
  return data;
}
async function updateDokumen(userId, id, f) {
  const { data, error } = await supa.rpc("update_dokumen", {
    p_user_id: userId,
    p_id: id,
    p_nama: f.nama,
    p_kategori: f.kategori,
    p_tahun: f.tahun,
    p_divisi: f.divisi,
    p_deskripsi: f.deskripsi,
    p_file_path: f.file_path,
    p_file_type: f.file_type,
    p_mime: f.mime,
    p_ukuran_bytes: f.ukuran_bytes,
    p_pengunggah: f.pengunggah,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("dokumen");
}
async function hapusDokumen(userId, id) {
  const { data, error } = await supa.rpc("hapus_dokumen", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("dokumen");
}

// =========================================================================
// TASK - DB-driven (halaman osis/task, kanban)
// =========================================================================
async function getTask() {
  const { data, error } = await supa
    .from("osis_task")
    .select(
      "id, judul, deskripsi, pic, divisi, priority, deadline, status, proker_id, agenda_id, catatan, created_by, pengunggah, created_at, updated_at",
    )
    .order("deadline", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function buatTask(userId, f) {
  const { data, error } = await supa.rpc("buat_task", {
    p_user_id: userId,
    p_judul: f.judul,
    p_deskripsi: f.deskripsi,
    p_pic: f.pic,
    p_divisi: f.divisi,
    p_priority: f.priority,
    p_deadline: f.deadline,
    p_status: f.status,
    p_proker_id: f.proker_id,
    p_agenda_id: f.agenda_id,
    p_catatan: f.catatan,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("task");
  return data;
}
async function updateTask(userId, id, f) {
  const { data, error } = await supa.rpc("update_task", {
    p_user_id: userId,
    p_id: id,
    p_judul: f.judul,
    p_deskripsi: f.deskripsi,
    p_pic: f.pic,
    p_divisi: f.divisi,
    p_priority: f.priority,
    p_deadline: f.deadline,
    p_status: f.status,
    p_proker_id: f.proker_id,
    p_agenda_id: f.agenda_id,
    p_catatan: f.catatan,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("task");
}
async function pindahTask(userId, id, status) {
  const { data, error } = await supa.rpc("pindah_task", {
    p_user_id: userId,
    p_id: id,
    p_status: status,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("task");
}
async function hapusTask(userId, id) {
  const { data, error } = await supa.rpc("hapus_task", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("task");
}

// =========================================================================
// KEUANGAN - DB-driven (halaman osis/keuangan, kas + saldo awal)
// =========================================================================
async function getKas() {
  const { data, error } = await supa
    .from("osis_kas")
    .select(
      "id, jenis, tanggal, keterangan, kategori, nominal, divisi, pic, proker_id, agenda_id, catatan, bukti_path, created_by, pengunggah, created_at, updated_at",
    )
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function getSaldoAwal() {
  const { data, error } = await supa
    .from("osis_saldo_awal")
    .select("periode, nominal");
  if (error) throw error;
  return data || [];
}
async function buatKas(userId, f) {
  const { data, error } = await supa.rpc("buat_kas", {
    p_user_id: userId,
    p_jenis: f.jenis,
    p_tanggal: f.tanggal,
    p_keterangan: f.keterangan,
    p_kategori: f.kategori,
    p_nominal: f.nominal,
    p_divisi: f.divisi,
    p_pic: f.pic,
    p_proker_id: f.proker_id,
    p_agenda_id: f.agenda_id,
    p_catatan: f.catatan,
    p_bukti_path: f.bukti_path,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("kas");
  return data;
}
async function updateKas(userId, id, f) {
  const { data, error } = await supa.rpc("update_kas", {
    p_user_id: userId,
    p_id: id,
    p_jenis: f.jenis,
    p_tanggal: f.tanggal,
    p_keterangan: f.keterangan,
    p_kategori: f.kategori,
    p_nominal: f.nominal,
    p_divisi: f.divisi,
    p_pic: f.pic,
    p_proker_id: f.proker_id,
    p_agenda_id: f.agenda_id,
    p_catatan: f.catatan,
    p_bukti_path: f.bukti_path,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("kas");
}
async function hapusKas(userId, id) {
  const { data, error } = await supa.rpc("hapus_kas", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("kas");
}
async function setSaldoAwal(userId, periode, nominal) {
  const { data, error } = await supa.rpc("set_saldo_awal", {
    p_user_id: userId,
    p_periode: periode,
    p_nominal: nominal,
  });
  if (error) throw error;
  cekOk(data);
}

// =========================================================================
// ABSENSI PENGURUS - izin/sakit/alpha + hadir per tanggal (halaman osis/absensi)
// Nama diketik manual (hadir memakai nama dari tabel anggota). Tulis via RPC
// (cek osis_users + UNIQUE tanggal+lower(nama) anti dobel/bentrok).
// =========================================================================
async function getAbsensi() {
  try {
    const { data, error } = await supa
      .from("osis_absensi")
      .select(
        "id, tanggal, nama, status, alasan, kegiatan, created_by, pengunggah, created_at, updated_at",
      )
      .order("tanggal", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    // kolom kegiatan belum ada (migrasi belum di-run) — pakai kolom lama
    if (!String(err.message || "").match(/kegiatan|column/i)) throw err;
    const { data, error } = await supa
      .from("osis_absensi")
      .select(
        "id, tanggal, nama, status, alasan, created_by, pengunggah, created_at, updated_at",
      )
      .order("tanggal", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({ ...r, kegiatan: "" }));
  }
}
async function buatAbsensi(userId, f) {
  const payload = {
    p_user_id: userId,
    p_tanggal: f.tanggal,
    p_nama: f.nama,
    p_status: f.status,
    p_alasan: f.alasan,
    p_kegiatan: f.kegiatan || "",
  };
  let { data, error } = await supa.rpc("buat_absensi", payload);
  // Fallback: function 6-param belum di-run di Supabase — ulangi tanpa p_kegiatan
  if (
    error &&
    String(error.message || "").match(/p_kegiatan|function|signature|argument/i)
  ) {
    const fb = await supa.rpc("buat_absensi", {
      p_user_id: payload.p_user_id,
      p_tanggal: payload.p_tanggal,
      p_nama: payload.p_nama,
      p_status: payload.p_status,
      p_alasan: payload.p_alasan,
    });
    data = fb.data;
    error = fb.error;
  }
  if (error) throw error;
  cekId(data);
  Cache.del("absensi");
  return data;
}
async function updateAbsensi(userId, id, f) {
  const payload = {
    p_user_id: userId,
    p_id: id,
    p_tanggal: f.tanggal,
    p_nama: f.nama,
    p_status: f.status,
    p_alasan: f.alasan,
    p_kegiatan: f.kegiatan || "",
  };
  let { data, error } = await supa.rpc("update_absensi", payload);
  if (
    error &&
    String(error.message || "").match(/p_kegiatan|function|signature|argument/i)
  ) {
    const fb = await supa.rpc("update_absensi", {
      p_user_id: payload.p_user_id,
      p_id: payload.p_id,
      p_tanggal: payload.p_tanggal,
      p_nama: payload.p_nama,
      p_status: payload.p_status,
      p_alasan: payload.p_alasan,
    });
    data = fb.data;
    error = fb.error;
  }
  if (error) throw error;
  cekOk(data);
  Cache.del("absensi");
}
async function hapusAbsensi(userId, id) {
  const { data, error } = await supa.rpc("hapus_absensi", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("absensi");
}

// =========================================================================
// TABUNGAN PENGURUS - setoran per orang (halaman osis/tabungan)
// Tampil satu tabel per orang + running total per orang (dihitung client).
// =========================================================================
async function getTabungan() {
  try {
    const { data, error } = await supa
      .from("osis_tabungan")
      .select(
        "id, nama, tanggal, nominal, jenis, cek, created_by, pengunggah, created_at, updated_at",
      )
      .order("tanggal", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    // kolom jenis belum ada (migrasi belum di-run) — pakai kolom lama
    if (!String(err.message || "").match(/jenis|column/i)) throw err;
    const { data, error } = await supa
      .from("osis_tabungan")
      .select(
        "id, nama, tanggal, nominal, cek, created_by, pengunggah, created_at, updated_at",
      )
      .order("tanggal", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({ ...r, jenis: "masuk" }));
  }
}
async function buatTabungan(userId, f) {
  const { data, error } = await supa.rpc("buat_tabungan", {
    p_user_id: userId,
    p_nama: f.nama,
    p_tanggal: f.tanggal,
    p_nominal: f.nominal,
    p_jenis: f.jenis === "keluar" ? "keluar" : "masuk",
  });
  if (error) throw error;
  cekId(data);
  Cache.del("tabungan");
  return data;
}
async function updateTabungan(userId, id, f) {
  const { data, error } = await supa.rpc("update_tabungan", {
    p_user_id: userId,
    p_id: id,
    p_nama: f.nama,
    p_tanggal: f.tanggal,
    p_nominal: f.nominal,
    p_jenis: f.jenis === "keluar" ? "keluar" : "masuk",
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("tabungan");
}
async function toggleTabunganCek(userId, id, cek) {
  const { data, error } = await supa.rpc("toggle_tabungan_cek", {
    p_user_id: userId,
    p_id: id,
    p_cek: !!cek,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("tabungan");
}
async function hapusTabungan(userId, id) {
  const { data, error } = await supa.rpc("hapus_tabungan", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("tabungan");
}

// =========================================================================
// EVALUASI - DB-driven (halaman osis/evaluasi)
// =========================================================================
async function getEvaluasi() {
  const { data, error } = await supa
    .from("osis_evaluasi")
    .select(
      "id, nama_kegiatan, agenda_id, proker_id, tgl_kegiatan, divisi, pj, status, rating_total, r_persiapan, r_pelaksanaan, r_koordinasi, r_waktu, r_anggaran, baik, kendala, penyebab, solusi, perbaiki, rekomendasi, dokumentasi, tugas, created_by, pengunggah, created_at, updated_at",
    )
    .order("tgl_kegiatan", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function buatEvaluasi(userId, f) {
  const { data, error } = await supa.rpc("buat_evaluasi", {
    p_user_id: userId,
    p_nama_kegiatan: f.nama_kegiatan,
    p_agenda_id: f.agenda_id,
    p_proker_id: f.proker_id,
    p_tgl_kegiatan: f.tgl_kegiatan,
    p_divisi: f.divisi,
    p_pj: f.pj,
    p_status: f.status,
    p_rating_total: f.rating_total,
    p_r_persiapan: f.r_persiapan,
    p_r_pelaksanaan: f.r_pelaksanaan,
    p_r_koordinasi: f.r_koordinasi,
    p_r_waktu: f.r_waktu,
    p_r_anggaran: f.r_anggaran,
    p_baik: f.baik,
    p_kendala: f.kendala,
    p_penyebab: f.penyebab,
    p_solusi: f.solusi,
    p_perbaiki: f.perbaiki,
    p_rekomendasi: f.rekomendasi,
    p_dokumentasi: f.dokumentasi,
    p_tugas: f.tugas,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("evaluasi");
  return data;
}
async function updateEvaluasi(userId, id, f) {
  const { data, error } = await supa.rpc("update_evaluasi", {
    p_user_id: userId,
    p_id: id,
    p_nama_kegiatan: f.nama_kegiatan,
    p_agenda_id: f.agenda_id,
    p_proker_id: f.proker_id,
    p_tgl_kegiatan: f.tgl_kegiatan,
    p_divisi: f.divisi,
    p_pj: f.pj,
    p_status: f.status,
    p_rating_total: f.rating_total,
    p_r_persiapan: f.r_persiapan,
    p_r_pelaksanaan: f.r_pelaksanaan,
    p_r_koordinasi: f.r_koordinasi,
    p_r_waktu: f.r_waktu,
    p_r_anggaran: f.r_anggaran,
    p_baik: f.baik,
    p_kendala: f.kendala,
    p_penyebab: f.penyebab,
    p_solusi: f.solusi,
    p_perbaiki: f.perbaiki,
    p_rekomendasi: f.rekomendasi,
    p_dokumentasi: f.dokumentasi,
    p_tugas: f.tugas,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("evaluasi");
}
async function hapusEvaluasi(userId, id) {
  const { data, error } = await supa.rpc("hapus_evaluasi", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("evaluasi");
}

// =========================================================================
// FORMULIR - DB-driven form builder (halaman osis/formulir)
// =========================================================================
async function getFormulir() {
  try {
    const { data, error } = await supa
      .from("osis_formulir")
      .select(
        "id, judul, deskripsi, status, settings, slug, created_by, pengunggah, created_at, updated_at",
      )
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    if (!String(err.message || "").match(/slug|column/i)) throw err;
    const { data, error } = await supa
      .from("osis_formulir")
      .select(
        "id, judul, deskripsi, status, settings, created_by, pengunggah, created_at, updated_at",
      )
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((f) => ({ ...f, slug: "" }));
  }
}
async function setFormulirSlug(userId, id, slug) {
  const { data, error } = await supa.rpc("set_formulir_slug", {
    p_user_id: userId,
    p_id: id,
    p_slug: slug,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("formulir");
}
async function getPertanyaan(formId) {
  const { data, error } = await supa
    .from("osis_pertanyaan")
    .select("id, form_id, tipe, teks, opsi, wajib, config, urutan")
    .eq("form_id", formId)
    .order("urutan", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function getRespons(formId) {
  const { data, error } = await supa
    .from("osis_respons")
    .select("id, form_id, jawaban, created_by, created_at")
    .eq("form_id", formId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function simpanFormulir(
  userId,
  id,
  judul,
  deskripsi,
  status,
  settings,
  pertanyaan,
) {
  const { data, error } = await supa.rpc("simpan_formulir", {
    p_user_id: userId,
    p_id: id,
    p_judul: judul,
    p_deskripsi: deskripsi,
    p_status: status,
    p_settings: settings,
    p_pertanyaan: pertanyaan,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("formulir");
  return data;
}
async function hapusFormulir(userId, id) {
  const { data, error } = await supa.rpc("hapus_formulir", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("formulir");
}
async function kirimRespons(formId, jawaban, userId) {
  const { data, error } = await supa.rpc("kirim_respons", {
    p_form_id: formId,
    p_jawaban: jawaban,
    p_user_id: userId || null,
  });
  if (error) throw error;
  cekId(data);
  Cache.del("formulir");
  return data;
}

// =========================================================================
// AGENDA PER SEKBID - DB-driven (judul, deskripsi, tanggal, lokasi, status, fotos)
// =========================================================================
async function getAgendaBySekbid(sekbidId) {
  const { data, error } = await supa
    .from("sekbid_agenda")
    .select(
      "id, sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, display_order, pelaksana, pengunggah, created_at",
    )
    .eq("sekbid_id", sekbidId)
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function getAllAgenda() {
  const { data, error } = await supa
    .from("sekbid_agenda")
    .select(
      "id, sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, display_order, pelaksana, pengunggah, created_at",
    )
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function buatAgenda(
  userId,
  sekbidId,
  judul,
  deskripsi,
  tanggal,
  lokasi,
  status,
  fotos,
  order = 99,
  pelaksana = "",
) {
  const { data, error } = await supa.rpc("buat_agenda", {
    p_user_id: userId,
    p_sekbid_id: sekbidId,
    p_judul: judul,
    p_deskripsi: deskripsi,
    p_tanggal: tanggal,
    p_lokasi: lokasi,
    p_status: status,
    p_fotos: fotos,
    p_display_order: order,
    p_pelaksana: pelaksana || "",
  });
  if (error) throw error;
  cekId(data);
  Cache.del("agenda_" + sekbidId);
  Cache.del("agenda_all");
  return data;
}
async function updateAgenda(
  userId,
  id,
  judul,
  deskripsi,
  tanggal,
  lokasi,
  status,
  fotos,
  order,
  pelaksana = "",
) {
  const { data, error } = await supa.rpc("update_agenda", {
    p_user_id: userId,
    p_id: id,
    p_judul: judul,
    p_deskripsi: deskripsi,
    p_tanggal: tanggal,
    p_lokasi: lokasi,
    p_status: status,
    p_fotos: fotos,
    p_display_order: order,
    p_pelaksana: pelaksana || "",
  });
  if (error) throw error;
  cekOk(data);
  // invalidate all agenda caches (simple)
  Cache.del("agenda_all");
  // need to know sekbid_id to del specific, but we del all with prefix
  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(Cache.prefix + "agenda_")) localStorage.removeItem(k);
    });
  } catch {}
}
async function hapusAgenda(userId, id) {
  const { data, error } = await supa.rpc("hapus_agenda", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("agenda_all");
  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(Cache.prefix + "agenda_")) localStorage.removeItem(k);
    });
  } catch {}
}

// =========================================================================
// GALLERY - dokumentasi kegiatan (judul + foto, khusus akun OSIS)
// =========================================================================

// Ambil semua kegiatan (terbaru di atas)
async function getGallery() {
  const { data, error } = await supa
    .from("gallery")
    .select("id, judul, deskripsi, fotos, created_by, pengunggah, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

// Tambah kegiatan, balikin id barunya (<=0 = gagal, server validasi)
async function buatGallery(userId, judul, deskripsi, fotos) {
  const { data, error } = await supa.rpc("buat_gallery", {
    p_user_id: userId,
    p_judul: judul,
    p_deskripsi: deskripsi,
    p_fotos: fotos,
  });
  if (error) throw error;
  Cache.del("gallery");
  return data || 0;
}

// Append 1 foto ke kegiatan yang udah ada
async function galeriAddFoto(userId, id, path) {
  const { data, error } = await supa.rpc("galeri_add_foto", {
    p_user_id: userId,
    p_id: id,
    p_path: path,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("gallery");
}

// Update judul & deskripsi kegiatan
async function galeriUpdateMeta(userId, id, judul, deskripsi) {
  const { data, error } = await supa.rpc("galeri_update_meta", {
    p_user_id: userId,
    p_id: id,
    p_judul: judul,
    p_deskripsi: deskripsi,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("gallery");
}

// Update fotos galeri (hapus 1 foto)
async function galeriUpdateFotos(userId, id, fotos) {
  const { data, error } = await supa.rpc("galeri_update_fotos", {
    p_user_id: userId,
    p_id: id,
    p_fotos: fotos,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("gallery");
}

// Hapus kegiatan (server validasi id OSIS)
async function hapusGallery(userId, id) {
  const { data, error } = await supa.rpc("hapus_gallery", {
    p_user_id: userId,
    p_id: id,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("gallery");
}

// =========================================================================
// SITE CONTENT - teks editable (hero/visi/misi/pembina/dll)
// =========================================================================

async function getSiteContent() {
  const { data, error } = await supa
    .from("site_content")
    .select("kunci, nilai");
  if (error) throw error;
  return data || [];
}

async function saveSiteText(userId, kunci, nilai) {
  const { data, error } = await supa.rpc("save_site_text", {
    p_user_id: userId,
    p_key: kunci,
    p_value: nilai,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("site_content");
}

// =========================================================================
// SIDEBAR DINAMIS - config pusat milik super_admin (site_content).
// Baca publik, tulis hanya pengelola Site (termasuk super_admin).
// Kunci: "sidebar_menu" (folder /osis). "sidebar_menu_bin" legacy
// (folder /osisbin yang sudah dihapus) — diabaikan, jangan dipakai baru.
// =========================================================================
async function getSidebarMenu(kunci) {
  const { data, error } = await supa
    .from("site_content")
    .select("nilai")
    .eq("kunci", kunci)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.nilai) return null;
  try {
    const arr = JSON.parse(data.nilai);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function simpanSidebarMenu(userId, kunci, menu) {
  const { data, error } = await supa.rpc("simpan_sidebar", {
    p_user_id: userId,
    p_key: kunci,
    p_menu: menu,
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("sidebar_" + kunci);
}

// =========================================================================
// ADMIN - CRUD & STORAGE
// =========================================================================

async function getSemuaPengaturan() {
  const { data, error } = await supa.from("pengaturan").select("kunci, nilai");
  if (error) throw error;
  const hasil = {};
  (data || []).forEach((p) => {
    hasil[p.kunci] = p.nilai;
  });
  return hasil;
}

async function simpanPengaturan(kunci, nilai) {
  const { error } = await supa
    .from("pengaturan")
    .upsert(
      { kunci: kunci, nilai: nilai, updated_at: new Date().toISOString() },
      { onConflict: "kunci" },
    );
  if (error) throw error;
}

// userId diambil dari sesi login (biar signature lama tetap kompatibel).
function _uid() {
  try {
    const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
    return (u && u.mode === "osis" && u.id) ? u.id : null;
  } catch { return null; }
}

async function simpanPimpinan(row) {
  const { data, error } = await supa.rpc("simpan_pimpinan", {
    p_user_id: _uid(), p_tahun: row.tahun, p_ketua_nama: row.ketua_nama || "",
    p_wakil_nama: row.wakil_nama || "", p_ketua_foto: row.ketua_foto || "",
    p_wakil_foto: row.wakil_foto || "", p_foto_angkatan: row.foto_angkatan || ""
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("pimpinan");
}

async function hapusPimpinan(tahun) {
  const { data, error } = await supa.rpc("hapus_pimpinan", {
    p_user_id: _uid(), p_tahun: tahun
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("pimpinan");
}

async function tambahAnggota(row) {
  const args = {
    p_user_id: _uid(), p_tahun: row.tahun, p_nama: row.nama || "",
    p_jabatan: row.jabatan || "", p_urutan: row.urutan ?? 99, p_foto: row.foto || "",
    p_panggilan: row.panggilan || "", p_ttl: row.ttl || "",
    p_visi: row.visi || "", p_misi: row.misi || "",
    p_ig: row.ig || "", p_wa: row.wa || "", p_tiktok: row.tiktok || "",
    p_motto: row.motto || "", p_kelas: row.kelas || "", p_username: row.username || ""
  };
  let data, error;
  ({ data, error } = await supa.rpc("tambah_anggota", args));
  if (error && /p_(panggilan|ttl|visi|misi|ig|wa|tiktok|motto|kelas|username)/i.test(error.message || "")) {
    // Migrasi biodata belum di-run — simpan field lama saja
    ["p_panggilan", "p_ttl", "p_visi", "p_misi", "p_ig", "p_wa", "p_tiktok", "p_motto", "p_kelas", "p_username"].forEach(k => delete args[k]);
    ({ data, error } = await supa.rpc("tambah_anggota", args));
  }
  if (error) throw error;
  cekId(data);
  Cache.del("anggota");
  return data;
}

async function updateAnggota(id, row) {
  // Field biodata yang TIDAK disertakan dikirim null = jangan ubah.
  // (Lindungi pemanggil parsial cth. site-edit dari menghapus data.)
  const bio = (k) => (k in row ? row[k] || "" : null);
  const args = {
    p_user_id: _uid(), p_id: id, p_nama: row.nama || "",
    p_jabatan: row.jabatan || "", p_urutan: row.urutan ?? 99,
    p_foto: ("foto" in row) ? (row.foto || "") : null,
    p_panggilan: bio("panggilan"), p_ttl: bio("ttl"),
    p_visi: bio("visi"), p_misi: bio("misi"),
    p_ig: bio("ig"), p_wa: bio("wa"), p_tiktok: bio("tiktok"),
    p_motto: bio("motto"), p_kelas: bio("kelas"), p_username: bio("username")
  };
  let data, error;
  ({ data, error } = await supa.rpc("update_anggota", args));
  if (error && /p_(panggilan|ttl|visi|misi|ig|wa|tiktok|motto|kelas|username)/i.test(error.message || "")) {
    // Migrasi biodata belum di-run — simpan field lama saja
    ["p_panggilan", "p_ttl", "p_visi", "p_misi", "p_ig", "p_wa", "p_tiktok", "p_motto", "p_kelas", "p_username"].forEach(k => delete args[k]);
    ({ data, error } = await supa.rpc("update_anggota", args));
  }
  if (error) throw error;
  cekOk(data);
  Cache.del("anggota");
}

async function hapusAnggota(id) {
  const { data, error } = await supa.rpc("hapus_anggota", {
    p_user_id: _uid(), p_id: id
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("anggota");
}

// Baris anggota milik user yang login (cocok username). null kalau tidak ada.
async function getAnggotaSaya() {
  const uid = _uid();
  if (!uid) return null;
  const { data, error } = await supa.rpc("anggota_saya", { p_user_id: uid });
  if (error) throw error;
  return data || null;
}

// Update biodata MILIK SENDIRI (nama & jabatan dikunci di server).
async function updateAnggotaSendiri(id, row) {
  const { data, error } = await supa.rpc("update_anggota_sendiri", {
    p_user_id: _uid(), p_id: id,
    p_panggilan: row.panggilan || "", p_ttl: row.ttl || "", p_kelas: row.kelas || "",
    p_visi: row.visi || "", p_misi: row.misi || "",
    p_ig: row.ig || "", p_wa: row.wa || "", p_tiktok: row.tiktok || "",
    p_motto: row.motto || "", p_foto: row.foto || ""
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("anggota");
}

async function tambahSekbid(row) {
  const { data, error } = await supa.rpc("tambah_sekbid", {
    p_user_id: _uid(), p_nama: row.nama || "", p_kategori: row.kategori || "",
    p_icon: row.icon || "", p_deskripsi: row.deskripsi || "",
    p_urutan: row.urutan ?? 99, p_foto: row.foto || ""
  });
  if (error) throw error;
  cekId(data);
  Cache.del("sekbid");
  return data;
}

async function updateSekbid(id, row) {
  const { data, error } = await supa.rpc("update_sekbid", {
    p_user_id: _uid(), p_id: id, p_nama: row.nama || "", p_kategori: row.kategori || "",
    p_icon: row.icon || "", p_deskripsi: row.deskripsi || "",
    p_urutan: row.urutan ?? 99, p_foto: row.foto || ""
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("sekbid");
}

async function hapusSekbid(id) {
  const { data, error } = await supa.rpc("hapus_sekbid", {
    p_user_id: _uid(), p_id: id
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("sekbid");
}

async function simpanWebFoto(kunci, path) {
  const { data, error } = await supa.rpc("simpan_web_foto", {
    p_user_id: _uid(), p_kunci: kunci, p_path: path
  });
  if (error) throw error;
  cekOk(data);
  Cache.del("web_foto");
}

// Daftar halaman yang boleh dikendalikan user (buat sweeping tombol).
// {halaman:[], sekbid_id, sekbid_nama, super} — null kalau belum dimuat.
async function aksesSaya(userId) {
  const { data, error } = await supa.rpc("akses_saya", { p_user_id: userId });
  if (error) throw error;
  return data || { halaman: [], sekbid_id: null, sekbid_nama: null, super: false };
}

// Bagi/cabut akses (hanya super_admin). Param sekbid LEGACY (sekbid otomatis
// dari jabatan) — selalu kirim null/false, dipertahankan biar cocok RPC.
async function setAkses(adminId, targetId, halaman, sekbidId = null, ubahSekbid = false) {
  const { data, error } = await supa.rpc("set_akses", {
    p_admin: adminId, p_target: targetId, p_halaman: halaman || [],
    p_sekbid_id: sekbidId, p_ubah_sekbid: !!ubahSekbid
  });
  if (error) throw error;
  cekOk(data);
  return data;
}

// Matriks semua user + haknya (hanya super_admin). Tanpa password.
async function aksesMatriks(adminId) {
  const { data, error } = await supa.rpc("akses_matriks", { p_admin: adminId });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data || [];
}

// Kompres gambar di browser biar <1MB sebelum upload
// - resize max 1920px, iterative quality 0.85 -> 0.4
async function compressImage(file, maxMB = 0.95, maxDim = 1920) {
  if (!file.type.startsWith("image/")) return file;
  // kalau udah kecil dan dimensi ga gede, skip
  if (file.size <= maxMB * 1024 * 1024) {
    // cek dimensi tetep, kalo kecil skip biar cepet
    try {
      const bmp = await createImageBitmap(file);
      if (bmp.width <= maxDim && bmp.height <= maxDim) {
        bmp.close && bmp.close();
        return file;
      }
      bmp.close && bmp.close();
    } catch {}
  }

  const loadImg = () =>
    new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        res(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        rej(e);
      };
      img.src = url;
    });

  let img;
  try {
    img = await loadImg();
  } catch {
    return file;
  }

  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  // PNG transparan -> kasih background putih biar JPEG ga hitam
  if (file.type === "image/png") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);

  const toBlob = (q, type) =>
    new Promise((res) => canvas.toBlob((b) => res(b), type, q));

  // coba JPEG dulu (paling efisien), kalo PNG kecil dan butuh transparansi tetep JPEG aja gapapa
  let targetType =
    file.type === "image/png" && file.size > 1024 * 1024
      ? "image/jpeg"
      : file.type;
  if (targetType !== "image/jpeg" && targetType !== "image/webp")
    targetType = "image/jpeg";

  let quality = 0.85;
  let blob = await toBlob(quality, targetType);
  // turunin quality kalo masih kegedean
  while (blob && blob.size > maxMB * 1024 * 1024 && quality > 0.42) {
    quality -= 0.12;
    blob = await toBlob(quality, targetType);
  }
  // kalo masih kegedean, kecilin dimensi lagi 15% dan coba lagi sekali
  if (blob && blob.size > maxMB * 1024 * 1024) {
    const w2 = Math.round(w * 0.75);
    const h2 = Math.round(h * 0.75);
    canvas.width = w2;
    canvas.height = h2;
    if (file.type === "image/png") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w2, h2);
    }
    ctx.drawImage(img, 0, 0, w2, h2);
    blob = await toBlob(0.72, targetType);
  }
  if (!blob) return file;
  if (blob.size >= file.size) return file; // kompres malah gede, pake asli
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: targetType,
    lastModified: Date.now(),
  });
}

async function uploadFotoStorage(file, path) {
  let toUpload = file;
  if (file && file.type && file.type.startsWith("image/")) {
    try {
      toUpload = await compressImage(file);
    } catch (e) {
      console.warn("compress gagal, pakai asli:", e);
    }
  }
  const key = String(path).replace(/^\/+/, "");
  // Jalur utama: presigned PUT langsung browser -> R2.
  if (r2Aktif()) {
    const tipe = (toUpload && toUpload.type) || (file && file.type) || "application/octet-stream";
    const pres = await r2MintaPresign("put", key, tipe);
    const up = await fetch(pres.url, {
      method: "PUT",
      headers: { "Content-Type": tipe },
      body: toUpload,
    });
    if (!up.ok) throw new Error(`Upload R2 gagal (${up.status})`);
    return key;
  }
  // Fallback legacy (sebelum Worker live): bucket Supabase lama.
  // kalau path masih .png tapi file jadi jpeg, biarin aja - storage ga ngecek ekstensi
  const { error } = await supa.storage
    .from(STORAGE_BUCKET)
    .upload(key, toUpload, { upsert: true, cacheControl: "3600" });
  if (error) throw error;
  return key;
}

async function hapusFotoStorage(path) {
  if (!path) return;
  const key = String(path).replace(/^\/+/, "");
  if (r2Aktif()) {
    const pres = await r2MintaPresign("delete", key);
    const del = await fetch(pres.url, { method: "DELETE" });
    // 404 = file memang sudah tidak ada, anggap sukses biar data DB tetap bisa dibersihkan.
    if (!del.ok && del.status !== 404) throw new Error(`Hapus R2 gagal (${del.status})`);
    return;
  }
  const { error } = await supa.storage.from(STORAGE_BUCKET).remove([key]);
  if (error) throw error;
}
