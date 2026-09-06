// =========================================================================
// DATA LAYER — SEMUA AKSES SUPABASE LEWAT FILE INI
// Urutan include: 1) CDN supabase-js  2) config.js  3) db.js
// =========================================================================

const supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Bangun URL publik foto di bucket
function getFoto(pathFoto) {
    if (!pathFoto) return "";
    if (pathFoto.startsWith("http")) return pathFoto;
    return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${pathFoto}`;
}

// =========================================================================
// CACHE — SWR (stale-while-revalidate) biar instant
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
        } catch { return null; }
    },
    set(key, data) {
        try { localStorage.setItem(Cache.key(key), JSON.stringify({ data, t: Date.now(), v: Cache.version })); } catch {}
    },
    del(key) {
        try { localStorage.removeItem(Cache.key(key)); } catch {}
    },
    delMany(keys) {
        keys.forEach(key => Cache.del(key));
    }
};

// =========================================================================
// DEVICE ID — id unik per perangkat (buat limit harian & visitor)
// Disimpan dobel: localStorage + cookie (2 tahun). Kalo salah satunya
// kehapus (clear data, dll), id lamanya masih kebaca — anti nambah
// kunjungan palsu dari perangkat yang sama.
// =========================================================================

const DEVICE_COOKIE = "osis_did";

function bacaCookie(nama) {
    const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + nama + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
}

function simpanCookie(nama, nilai) {
    document.cookie = nama + "=" + encodeURIComponent(nilai) +
        ";max-age=63072000;path=/;SameSite=Lax";
}

function getDeviceId() {
    let id = localStorage.getItem("osis_device_id") || bacaCookie(DEVICE_COOKIE);
    if (!id) {
        id = "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
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
        const br = /Edg\//i.test(ua) ? "Edge"
            : /OPR\//i.test(ua) ? "Opera"
            : /Chrome/i.test(ua) ? "Chrome"
            : /Firefox/i.test(ua) ? "Firefox" : "";
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
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) ||
        (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
        tipe = "Tablet";
    } else if (/Mobi|iPhone|iPod|Android/i.test(ua)) {
        tipe = "Mobile";
    }
    return {
        tipe: tipe,
        ua: ua,
        resolusi: window.screen ? window.screen.width + "x" + window.screen.height : ""
    };
}

// Nama buat kolom name di tabel visitor:
// - login OSIS -> nama anggota
// - login guest -> nickname
// - anonim -> kosong (biar ga ngehapus nama lama yang udah kesimpen)
function getVisitorName() {
    try {
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser)
            ? OsisAuth.getUser() : null;
        if (!u) return "";
        if (u.mode === "osis") return String(u.nama || "").trim();
        return String(u.nickname || "").trim(); // guest
    } catch { return ""; }
}

// =========================================================================
// AUTH — akun OSIS dari tabel osis_users
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
        // kolom foto/bio belum ada — pakai kolom lama
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

// Update profil OSIS (nama + bio + foto PP) — validasi akun di server
async function updateOsisProfil(userId, nama, bio, foto) {
    const { data, error } = await supa.rpc("update_osis_profil", {
        p_user_id: userId, p_nama: nama, p_bio: bio, p_foto: foto
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
}

// Ganti username OSIS (harus unik) — return OK atau throw ERR_TAKEN/ERR_INVALID
async function gantiOsisUsername(userId, username) {
    const { data, error } = await supa.rpc("ganti_osis_username", {
        p_user_id: userId, p_username: username
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
}

// Ganti password OSIS (verifikasi lama di server) — throw ERR_WRONG/ERR_INVALID
async function gantiOsisPassword(userId, oldPw, newPw) {
    const { data, error } = await supa.rpc("ganti_osis_password", {
        p_user_id: userId, p_old: oldPw, p_new: newPw
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
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

// Kirim aspirasi siswa — lewat RPC biar bisa dilimit per device per hari
async function kirimAspirasi(nama, kelas, isi, isPrivate = false) {
    const { data, error } = await supa.rpc("kirim_aspirasi_terbatas", {
        p_device_id: getDeviceId(),
        p_nama: nama,
        p_kelas: kelas,
        p_isi: isi,
        p_is_private: !!isPrivate
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
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
        p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
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

// Kirim request lagu (radio jam istirahat) — lewat RPC biar bisa dilimit
async function kirimRequestLagu(judul, penyanyi, pesan, nama) {
    const { data, error } = await supa.rpc("kirim_lagu_terbatas", {
        p_device_id: getDeviceId(),
        p_judul: judul,
        p_penyanyi: penyanyi,
        p_pesan: pesan,
        p_nama: nama
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
}

// Catat kunjungan unik per perangkat (1x per hari WIB), return total kunjungan
async function catatVisitor() {
    const info = infoPerangkat();
    const { data, error } = await supa.rpc("tambah_visitor_unik", {
        p_key: getDeviceId(),
        p_label: namaPerangkat(),
        p_tipe: info.tipe,
        p_ua: info.ua,
        p_resolusi: info.resolusi,
        p_name: getVisitorName()
    });
    if (error) throw error;
    return data || 0;
}

// Ambil request lagu terbaru (terbaru di atas, maks 30)
async function getRequestLagu() {
    const { data, error } = await supa
        .from("lagu_requests")
        .select("id, device_id, judul, penyanyi, pesan, nama, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
    if (error) throw error;
    return data || [];
}

// Hapus request lagu milik sendiri (device_id dicek di server)
async function hapusLaguSendiri(id) {
    const { data, error } = await supa.rpc("hapus_lagu_own", {
        p_device_id: getDeviceId(),
        p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
}

// Hapus aspirasi/lagu oleh OSIS (boleh hapus punya siapa aja)
async function hapusAspirasiOsis(userId, id) {
    const { data, error } = await supa.rpc("hapus_aspirasi_osis", {
        p_user_id: userId,
        p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
}
async function hapusLaguOsis(userId, id) {
    const { data, error } = await supa.rpc("hapus_lagu_osis", {
        p_user_id: userId,
        p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
}

// =========================================================================
// PRESTASI — home (DB-driven, multi-foto, display_order)
// =========================================================================
async function getPrestasi() {
    const { data, error } = await supa
        .from("prestasi")
        .select("id, tag, caption, fotos, display_order, created_at")
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(50);
    if (error) throw error;
    return data || [];
}
async function buatPrestasi(userId, tag, caption, fotos, order = 99) {
    const { data, error } = await supa.rpc("buat_prestasi", {
        p_user_id: userId, p_tag: tag, p_caption: caption, p_fotos: fotos, p_display_order: order
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("prestasi");
    return data;
}
async function updatePrestasi(userId, id, tag, caption, fotos, order) {
    const { data, error } = await supa.rpc("update_prestasi", {
        p_user_id: userId, p_id: id, p_tag: tag, p_caption: caption, p_fotos: fotos, p_display_order: order
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("prestasi");
}
async function hapusPrestasi(userId, id) {
    const { data, error } = await supa.rpc("hapus_prestasi", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("prestasi");
}

// =========================================================================
// KEGIATAN HOME — DB-driven (judul, deskripsi, badge, fotos jsonb, order)
// =========================================================================
async function getKegiatan() {
    const { data, error } = await supa
        .from("kegiatan")
        .select("id, judul, deskripsi, badge, fotos, display_order, created_at")
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(50);
    if (error) throw error;
    return data || [];
}
async function buatKegiatan(userId, judul, deskripsi, badge, fotos, order = 99) {
    const { data, error } = await supa.rpc("buat_kegiatan", {
        p_user_id: userId, p_judul: judul, p_deskripsi: deskripsi, p_badge: badge, p_fotos: fotos, p_display_order: order
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("kegiatan");
    return data;
}
async function updateKegiatan(userId, id, judul, deskripsi, badge, fotos, order) {
    const { data, error } = await supa.rpc("update_kegiatan", {
        p_user_id: userId, p_id: id, p_judul: judul, p_deskripsi: deskripsi, p_badge: badge, p_fotos: fotos, p_display_order: order
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("kegiatan");
}
async function hapusKegiatan(userId, id) {
    const { data, error } = await supa.rpc("hapus_kegiatan", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("kegiatan");
}

// =========================================================================
// NOTULENSI RAPAT — DB-driven (halaman osis/notulensi)
// =========================================================================
async function getNotulensi() {
    const { data, error } = await supa
        .from("rapat_notulensi")
        .select("id, judul, tanggal, waktu_mulai, waktu_selesai, lokasi, divisi, pimpinan, notulis, peserta, agenda_topik, isi_pembahasan, keputusan, tindak_lanjut, lampiran, status, created_at")
        .order("tanggal", { ascending: false })
        .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
}
async function buatNotulensi(userId, f) {
    const { data, error } = await supa.rpc("buat_notulensi", {
        p_user_id: userId, p_judul: f.judul, p_tanggal: f.tanggal, p_waktu_mulai: f.waktu_mulai, p_waktu_selesai: f.waktu_selesai,
        p_lokasi: f.lokasi, p_divisi: f.divisi, p_pimpinan: f.pimpinan, p_notulis: f.notulis, p_peserta: f.peserta,
        p_agenda_topik: f.agenda_topik, p_isi_pembahasan: f.isi_pembahasan, p_keputusan: f.keputusan,
        p_tindak_lanjut: f.tindak_lanjut, p_lampiran: f.lampiran, p_status: f.status
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("notulensi");
    return data;
}
async function updateNotulensi(userId, id, f) {
    const { data, error } = await supa.rpc("update_notulensi", {
        p_user_id: userId, p_id: id, p_judul: f.judul, p_tanggal: f.tanggal, p_waktu_mulai: f.waktu_mulai, p_waktu_selesai: f.waktu_selesai,
        p_lokasi: f.lokasi, p_divisi: f.divisi, p_pimpinan: f.pimpinan, p_notulis: f.notulis, p_peserta: f.peserta,
        p_agenda_topik: f.agenda_topik, p_isi_pembahasan: f.isi_pembahasan, p_keputusan: f.keputusan,
        p_tindak_lanjut: f.tindak_lanjut, p_lampiran: f.lampiran, p_status: f.status
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("notulensi");
}
async function hapusNotulensi(userId, id) {
    const { data, error } = await supa.rpc("hapus_notulensi", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("notulensi");
}

// =========================================================================
// PROGRAM KERJA — DB-driven (halaman osis/proker)
// =========================================================================
async function getProker() {
    const { data, error } = await supa
        .from("proker")
        .select("id, nama, deskripsi, divisi, pj, periode, tgl_mulai, tgl_selesai, lokasi, target_peserta, status, progress, catatan, agenda_ids, tugas, evaluasi_hasil, evaluasi_kendala, evaluasi_solusi, evaluasi_lanjut, dokumentasi, created_at")
        .order("periode", { ascending: false })
        .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
}
async function buatProker(userId, f) {
    const { data, error } = await supa.rpc("buat_proker", {
        p_user_id: userId, p_nama: f.nama, p_deskripsi: f.deskripsi, p_divisi: f.divisi, p_pj: f.pj, p_periode: f.periode,
        p_tgl_mulai: f.tgl_mulai, p_tgl_selesai: f.tgl_selesai, p_lokasi: f.lokasi, p_target_peserta: f.target_peserta,
        p_status: f.status, p_progress: f.progress, p_catatan: f.catatan, p_agenda_ids: f.agenda_ids, p_tugas: f.tugas,
        p_evaluasi_hasil: f.evaluasi_hasil, p_evaluasi_kendala: f.evaluasi_kendala, p_evaluasi_solusi: f.evaluasi_solusi,
        p_evaluasi_lanjut: f.evaluasi_lanjut, p_dokumentasi: f.dokumentasi
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("proker");
    return data;
}
async function updateProker(userId, id, f) {
    const { data, error } = await supa.rpc("update_proker", {
        p_user_id: userId, p_id: id, p_nama: f.nama, p_deskripsi: f.deskripsi, p_divisi: f.divisi, p_pj: f.pj, p_periode: f.periode,
        p_tgl_mulai: f.tgl_mulai, p_tgl_selesai: f.tgl_selesai, p_lokasi: f.lokasi, p_target_peserta: f.target_peserta,
        p_status: f.status, p_progress: f.progress, p_catatan: f.catatan, p_agenda_ids: f.agenda_ids, p_tugas: f.tugas,
        p_evaluasi_hasil: f.evaluasi_hasil, p_evaluasi_kendala: f.evaluasi_kendala, p_evaluasi_solusi: f.evaluasi_solusi,
        p_evaluasi_lanjut: f.evaluasi_lanjut, p_dokumentasi: f.dokumentasi
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("proker");
}
async function hapusProker(userId, id) {
    const { data, error } = await supa.rpc("hapus_proker", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("proker");
}

// =========================================================================
// DOKUMEN OSIS — DB-driven (halaman osis/dokumen)
// =========================================================================
async function getDokumen() {
    const { data, error } = await supa
        .from("osis_dokumen")
        .select("id, nama, kategori, tahun, divisi, deskripsi, file_path, file_type, mime, ukuran_bytes, pengunggah, created_by, created_at")
        .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
}
async function buatDokumen(userId, f) {
    const { data, error } = await supa.rpc("buat_dokumen", {
        p_user_id: userId, p_nama: f.nama, p_kategori: f.kategori, p_tahun: f.tahun, p_divisi: f.divisi,
        p_deskripsi: f.deskripsi, p_file_path: f.file_path, p_file_type: f.file_type, p_mime: f.mime,
        p_ukuran_bytes: f.ukuran_bytes, p_pengunggah: f.pengunggah
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("dokumen");
    return data;
}
async function updateDokumen(userId, id, f) {
    const { data, error } = await supa.rpc("update_dokumen", {
        p_user_id: userId, p_id: id, p_nama: f.nama, p_kategori: f.kategori, p_tahun: f.tahun, p_divisi: f.divisi,
        p_deskripsi: f.deskripsi, p_file_path: f.file_path, p_file_type: f.file_type, p_mime: f.mime,
        p_ukuran_bytes: f.ukuran_bytes, p_pengunggah: f.pengunggah
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("dokumen");
}
async function hapusDokumen(userId, id) {
    const { data, error } = await supa.rpc("hapus_dokumen", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("dokumen");
}

// =========================================================================
// TASK — DB-driven (halaman osis/task, kanban)
// =========================================================================
async function getTask() {
    const { data, error } = await supa
        .from("osis_task")
        .select("id, judul, deskripsi, pic, divisi, priority, deadline, status, proker_id, agenda_id, catatan, created_by, created_at, updated_at")
        .order("deadline", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
}
async function buatTask(userId, f) {
    const { data, error } = await supa.rpc("buat_task", {
        p_user_id: userId, p_judul: f.judul, p_deskripsi: f.deskripsi, p_pic: f.pic, p_divisi: f.divisi,
        p_priority: f.priority, p_deadline: f.deadline, p_status: f.status,
        p_proker_id: f.proker_id, p_agenda_id: f.agenda_id, p_catatan: f.catatan
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("task");
    return data;
}
async function updateTask(userId, id, f) {
    const { data, error } = await supa.rpc("update_task", {
        p_user_id: userId, p_id: id, p_judul: f.judul, p_deskripsi: f.deskripsi, p_pic: f.pic, p_divisi: f.divisi,
        p_priority: f.priority, p_deadline: f.deadline, p_status: f.status,
        p_proker_id: f.proker_id, p_agenda_id: f.agenda_id, p_catatan: f.catatan
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("task");
}
async function pindahTask(userId, id, status) {
    const { data, error } = await supa.rpc("pindah_task", {
        p_user_id: userId, p_id: id, p_status: status
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("task");
}
async function hapusTask(userId, id) {
    const { data, error } = await supa.rpc("hapus_task", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("task");
}

// =========================================================================
// KEUANGAN — DB-driven (halaman osis/keuangan, kas + saldo awal)
// =========================================================================
async function getKas() {
    const { data, error } = await supa
        .from("osis_kas")
        .select("id, jenis, tanggal, keterangan, kategori, nominal, divisi, pic, proker_id, agenda_id, catatan, bukti_path, created_by, created_at, updated_at")
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
        p_user_id: userId, p_jenis: f.jenis, p_tanggal: f.tanggal, p_keterangan: f.keterangan, p_kategori: f.kategori,
        p_nominal: f.nominal, p_divisi: f.divisi, p_pic: f.pic, p_proker_id: f.proker_id, p_agenda_id: f.agenda_id,
        p_catatan: f.catatan, p_bukti_path: f.bukti_path
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("kas");
    return data;
}
async function updateKas(userId, id, f) {
    const { data, error } = await supa.rpc("update_kas", {
        p_user_id: userId, p_id: id, p_jenis: f.jenis, p_tanggal: f.tanggal, p_keterangan: f.keterangan, p_kategori: f.kategori,
        p_nominal: f.nominal, p_divisi: f.divisi, p_pic: f.pic, p_proker_id: f.proker_id, p_agenda_id: f.agenda_id,
        p_catatan: f.catatan, p_bukti_path: f.bukti_path
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("kas");
}
async function hapusKas(userId, id) {
    const { data, error } = await supa.rpc("hapus_kas", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("kas");
}
async function setSaldoAwal(userId, periode, nominal) {
    const { data, error } = await supa.rpc("set_saldo_awal", {
        p_user_id: userId, p_periode: periode, p_nominal: nominal
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
}

// =========================================================================
// EVALUASI — DB-driven (halaman osis/evaluasi)
// =========================================================================
async function getEvaluasi() {
    const { data, error } = await supa
        .from("osis_evaluasi")
        .select("id, nama_kegiatan, agenda_id, proker_id, tgl_kegiatan, divisi, pj, status, rating_total, r_persiapan, r_pelaksanaan, r_koordinasi, r_waktu, r_anggaran, baik, kendala, penyebab, solusi, perbaiki, rekomendasi, dokumentasi, tugas, created_by, created_at, updated_at")
        .order("tgl_kegiatan", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
}
async function buatEvaluasi(userId, f) {
    const { data, error } = await supa.rpc("buat_evaluasi", {
        p_user_id: userId, p_nama_kegiatan: f.nama_kegiatan, p_agenda_id: f.agenda_id, p_proker_id: f.proker_id,
        p_tgl_kegiatan: f.tgl_kegiatan, p_divisi: f.divisi, p_pj: f.pj, p_status: f.status,
        p_rating_total: f.rating_total, p_r_persiapan: f.r_persiapan, p_r_pelaksanaan: f.r_pelaksanaan,
        p_r_koordinasi: f.r_koordinasi, p_r_waktu: f.r_waktu, p_r_anggaran: f.r_anggaran,
        p_baik: f.baik, p_kendala: f.kendala, p_penyebab: f.penyebab, p_solusi: f.solusi,
        p_perbaiki: f.perbaiki, p_rekomendasi: f.rekomendasi, p_dokumentasi: f.dokumentasi, p_tugas: f.tugas
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("evaluasi");
    return data;
}
async function updateEvaluasi(userId, id, f) {
    const { data, error } = await supa.rpc("update_evaluasi", {
        p_user_id: userId, p_id: id, p_nama_kegiatan: f.nama_kegiatan, p_agenda_id: f.agenda_id, p_proker_id: f.proker_id,
        p_tgl_kegiatan: f.tgl_kegiatan, p_divisi: f.divisi, p_pj: f.pj, p_status: f.status,
        p_rating_total: f.rating_total, p_r_persiapan: f.r_persiapan, p_r_pelaksanaan: f.r_pelaksanaan,
        p_r_koordinasi: f.r_koordinasi, p_r_waktu: f.r_waktu, p_r_anggaran: f.r_anggaran,
        p_baik: f.baik, p_kendala: f.kendala, p_penyebab: f.penyebab, p_solusi: f.solusi,
        p_perbaiki: f.perbaiki, p_rekomendasi: f.rekomendasi, p_dokumentasi: f.dokumentasi, p_tugas: f.tugas
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("evaluasi");
}
async function hapusEvaluasi(userId, id) {
    const { data, error } = await supa.rpc("hapus_evaluasi", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("evaluasi");
}

// =========================================================================
// FORMULIR — DB-driven form builder (halaman osis/formulir)
// =========================================================================
async function getFormulir() {
    const { data, error } = await supa
        .from("osis_formulir")
        .select("id, judul, deskripsi, status, settings, created_by, created_at, updated_at")
        .order("updated_at", { ascending: false });
    if (error) throw error;
    return data || [];
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
async function simpanFormulir(userId, id, judul, deskripsi, status, settings, pertanyaan) {
    const { data, error } = await supa.rpc("simpan_formulir", {
        p_user_id: userId, p_id: id, p_judul: judul, p_deskripsi: deskripsi,
        p_status: status, p_settings: settings, p_pertanyaan: pertanyaan
    });
    if (error) throw error;
    if (!data || data <= 0) throw new Error(String(data));
    Cache.del("formulir");
    return data;
}
async function hapusFormulir(userId, id) {
    const { data, error } = await supa.rpc("hapus_formulir", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("formulir");
}
async function kirimRespons(formId, jawaban, userId) {
    const { data, error } = await supa.rpc("kirim_respons", {
        p_form_id: formId, p_jawaban: jawaban, p_user_id: userId || null
    });
    if (error) throw error;
    if (!data || data <= 0) throw new Error(String(data));
    Cache.del("formulir");
    return data;
}

// =========================================================================
// AGENDA PER SEKBID — DB-driven (judul, deskripsi, tanggal, lokasi, status, fotos)
// =========================================================================
async function getAgendaBySekbid(sekbidId) {
    const { data, error } = await supa
        .from("sekbid_agenda")
        .select("id, sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, display_order, created_at")
        .eq("sekbid_id", sekbidId)
        .order("display_order", { ascending: true })
        .order("tanggal", { ascending: false })
        .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
}
async function getAllAgenda() {
    const { data, error } = await supa
        .from("sekbid_agenda")
        .select("id, sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, display_order, created_at")
        .order("tanggal", { ascending: false })
        .order("display_order", { ascending: true });
    if (error) throw error;
    return data || [];
}
async function buatAgenda(userId, sekbidId, judul, deskripsi, tanggal, lokasi, status, fotos, order = 99) {
    const { data, error } = await supa.rpc("buat_agenda", {
        p_user_id: userId, p_sekbid_id: sekbidId, p_judul: judul, p_deskripsi: deskripsi, p_tanggal: tanggal, p_lokasi: lokasi, p_status: status, p_fotos: fotos, p_display_order: order
    });
    if (error) throw error;
    if (data <= 0) throw new Error(String(data));
    Cache.del("agenda_" + sekbidId);
    Cache.del("agenda_all");
    return data;
}
async function updateAgenda(userId, id, judul, deskripsi, tanggal, lokasi, status, fotos, order) {
    const { data, error } = await supa.rpc("update_agenda", {
        p_user_id: userId, p_id: id, p_judul: judul, p_deskripsi: deskripsi, p_tanggal: tanggal, p_lokasi: lokasi, p_status: status, p_fotos: fotos, p_display_order: order
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    // invalidate all agenda caches (simple)
    Cache.del("agenda_all");
    // need to know sekbid_id to del specific, but we del all with prefix
    try { Object.keys(localStorage).forEach(k => { if (k.startsWith(Cache.prefix + "agenda_")) localStorage.removeItem(k); }); } catch {}
}
async function hapusAgenda(userId, id) {
    const { data, error } = await supa.rpc("hapus_agenda", {
        p_user_id: userId, p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("agenda_all");
    try { Object.keys(localStorage).forEach(k => { if (k.startsWith(Cache.prefix + "agenda_")) localStorage.removeItem(k); }); } catch {}
}

// =========================================================================
// GALLERY — dokumentasi kegiatan (judul + foto, khusus akun OSIS)
// =========================================================================

// Ambil semua kegiatan (terbaru di atas)
async function getGallery() {
    const { data, error } = await supa
        .from("gallery")
        .select("id, judul, deskripsi, fotos, created_by, created_at")
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
        p_fotos: fotos
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
        p_path: path
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("gallery");
}

// Update judul & deskripsi kegiatan
async function galeriUpdateMeta(userId, id, judul, deskripsi) {
    const { data, error } = await supa.rpc("galeri_update_meta", {
        p_user_id: userId,
        p_id: id,
        p_judul: judul,
        p_deskripsi: deskripsi
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("gallery");
}

// Update fotos galeri (hapus 1 foto)
async function galeriUpdateFotos(userId, id, fotos) {
    const { data, error } = await supa.rpc("galeri_update_fotos", {
        p_user_id: userId,
        p_id: id,
        p_fotos: fotos
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("gallery");
}

// Hapus kegiatan (server validasi id OSIS)
async function hapusGallery(userId, id) {
    const { data, error } = await supa.rpc("hapus_gallery", {
        p_user_id: userId,
        p_id: id
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("gallery");
}

// =========================================================================
// SITE CONTENT — teks editable (hero/visi/misi/pembina/dll)
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
        p_value: nilai
    });
    if (error) throw error;
    if (data !== "OK") throw new Error(data);
    Cache.del("site_content");
}

// =========================================================================
// ADMIN — CRUD & STORAGE
// =========================================================================

async function getSemuaPengaturan() {
    const { data, error } = await supa
        .from("pengaturan")
        .select("kunci, nilai");
    if (error) throw error;
    const hasil = {};
    (data || []).forEach(p => { hasil[p.kunci] = p.nilai; });
    return hasil;
}

async function simpanPengaturan(kunci, nilai) {
    const { error } = await supa
        .from("pengaturan")
        .upsert({ kunci: kunci, nilai: nilai, updated_at: new Date().toISOString() }, { onConflict: "kunci" });
    if (error) throw error;
}

async function simpanPimpinan(row) {
    const { error } = await supa
        .from("pimpinan")
        .upsert(row, { onConflict: "tahun" });
    if (error) throw error;
    Cache.del("pimpinan");
}

async function hapusPimpinan(tahun) {
    const { error } = await supa.from("pimpinan").delete().eq("tahun", tahun);
    if (error) throw error;
    Cache.del("pimpinan");
}

async function tambahAnggota(row) {
    const { error } = await supa.from("anggota").insert(row);
    if (error) throw error;
    Cache.del("anggota");
}

async function updateAnggota(id, row) {
    const { error } = await supa.from("anggota").update(row).eq("id", id);
    if (error) throw error;
    Cache.del("anggota");
}

async function hapusAnggota(id) {
    const { error } = await supa.from("anggota").delete().eq("id", id);
    if (error) throw error;
    Cache.del("anggota");
}

async function tambahSekbid(row) {
    const { error } = await supa.from("sekbid").insert(row);
    if (error) throw error;
    Cache.del("sekbid");
}

async function updateSekbid(id, row) {
    const { error } = await supa.from("sekbid").update(row).eq("id", id);
    if (error) throw error;
    Cache.del("sekbid");
}

async function hapusSekbid(id) {
    const { error } = await supa.from("sekbid").delete().eq("id", id);
    if (error) throw error;
    Cache.del("sekbid");
}

async function simpanWebFoto(kunci, path) {
    const { error } = await supa
        .from("web_foto")
        .upsert({ kunci: kunci, path: path, updated_at: new Date().toISOString() });
    if (error) throw error;
    Cache.del("web_foto");
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

    const loadImg = () => new Promise((res, rej) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); res(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
        img.src = url;
    });

    let img;
    try { img = await loadImg(); } catch { return file; }

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

    const toBlob = (q, type) => new Promise(res => canvas.toBlob(b => res(b), type, q));

    // coba JPEG dulu (paling efisien), kalo PNG kecil dan butuh transparansi tetep JPEG aja gapapa
    let targetType = file.type === "image/png" && file.size > 1024 * 1024 ? "image/jpeg" : file.type;
    if (targetType !== "image/jpeg" && targetType !== "image/webp") targetType = "image/jpeg";

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
        if (file.type === "image/png") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w2, h2); }
        ctx.drawImage(img, 0, 0, w2, h2);
        blob = await toBlob(0.72, targetType);
    }
    if (!blob) return file;
    if (blob.size >= file.size) return file; // kompres malah gede, pake asli
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: targetType, lastModified: Date.now() });
}

async function uploadFotoStorage(file, path) {
    let toUpload = file;
    if (file && file.type && file.type.startsWith("image/")) {
        try { toUpload = await compressImage(file); } catch (e) { console.warn("compress gagal, pakai asli:", e); }
    }
    // kalau path masih .png tapi file jadi jpeg, biarin aja — storage ga ngecek ekstensi
    const { error } = await supa.storage
        .from(STORAGE_BUCKET)
        .upload(path, toUpload, { upsert: true, cacheControl: "3600" });
    if (error) throw error;
    return path;
}

async function hapusFotoStorage(path) {
    if (!path) return;
    const { error } = await supa.storage
        .from(STORAGE_BUCKET)
        .remove([path]);
    if (error) throw error;
}
