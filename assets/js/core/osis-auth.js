// =========================================================================
// AUTH — login 2 tipe: OSIS (hak penuh) / BIASA (publik terdaftar, tanpa hak).
// Keduanya via Supabase Auth (JWT = sumber kebenaran); baris user dipetakan
// via kolom auth_id (osis_users / biasa_users). localStorage.osis_user hanya
// CACHE (offline + cepat) dan disinkronkan tiap halaman dimuat (syncAuth):
// session hilang -> cache dibuang, session ada tapi cache kosong/basi ->
// diambil ulang dari server.
// Guest nickname (mode "guest"/"tamu") = LEGACY yang sudah dihapus: cache-nya
// dibuang paksa di syncAuth biar pemiliknya daftar/masuk ulang.
// =========================================================================

const OsisAuth = {
    KEY: "osis_user",
    AKSES_KEY: "osis_akses",
    ANGKATAN_AKTIF_KEY: "osis_angkatan_aktif",
    ANGKATAN_LIST_KEY: "osis_angkatan_list",

    getUser() {
        try { return JSON.parse(localStorage.getItem(OsisAuth.KEY) || "null"); }
        catch { return null; }
    },

    // Cache hak kendali per halaman {halaman:[], sekbid_id, sekbid_nama, super, angkatan_id, angkatan, lintas_angkatan}.
    // null = belum dimuat -> dianggap TIDAK BOLEH kendali (fail closed).
    getAkses() {
        try { return JSON.parse(localStorage.getItem(OsisAuth.AKSES_KEY) || "null"); }
        catch { return null; }
    },

    async refreshAkses() {
        const u = OsisAuth.getUser();
        if (!u || u.mode !== "osis" || !u.id || typeof aksesSaya !== "function") {
            try { localStorage.removeItem(OsisAuth.AKSES_KEY); } catch {}
            return null;
        }
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return OsisAuth.getAkses();
        }
        try {
            const a = await aksesSaya(u.id);
            try { localStorage.setItem(OsisAuth.AKSES_KEY, JSON.stringify(a || null)); } catch {}
            if (a) {
                try {
                    const cur = OsisAuth.getUser();
                    if (cur && Number(cur.id) === Number(u.id)) {
                        let dirty = false;
                        if ("angkatan_id" in a && cur.angkatan_id !== a.angkatan_id) {
                            cur.angkatan_id = a.angkatan_id;
                            dirty = true;
                        }
                        if ("angkatan" in a && a.angkatan && cur.angkatan !== a.angkatan) {
                            cur.angkatan = a.angkatan;
                            dirty = true;
                        }
                        if ("lintas_angkatan" in a && cur.lintas_angkatan !== !!a.lintas_angkatan) {
                            cur.lintas_angkatan = !!a.lintas_angkatan;
                            dirty = true;
                        }
                        if (dirty) localStorage.setItem(OsisAuth.KEY, JSON.stringify(cur));
                    }
                } catch {}
            }
            return a;
        } catch (err) {
            console.error("Gagal muat hak akses:", err);
            return OsisAuth.getAkses();
        }
    },

    getAngkatanList() {
        try {
            const arr = JSON.parse(localStorage.getItem(OsisAuth.ANGKATAN_LIST_KEY) || "[]");
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    },

    setAngkatanList(list) {
        try {
            localStorage.setItem(OsisAuth.ANGKATAN_LIST_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        } catch {}
    },

    isLintasAngkatan() {
        const u = OsisAuth.getUser();
        if (!u || u.mode !== "osis") return false;
        const a = OsisAuth.getAkses();
        if (a && typeof a.lintas_angkatan === "boolean") return a.lintas_angkatan;
        if (a && a.super) return true;
        if (typeof u.lintas_angkatan === "boolean") return u.lintas_angkatan;
        const jab = String(u.jabatan || "").trim().toUpperCase();
        const ang = String(u.angkatan || "").trim().toUpperCase();
        return jab === "PEMBINA" || ang === "PEMBINA";
    },

    getAngkatanAktif() {
        const u = OsisAuth.getUser();
        if (!u || u.mode !== "osis") return null;
        if (!OsisAuth.isLintasAngkatan()) {
            return u.angkatan_id ? Number(u.angkatan_id) : null;
        }
        const list = OsisAuth.getAngkatanList();
        let saved = 0;
        try { saved = Number(localStorage.getItem(OsisAuth.ANGKATAN_AKTIF_KEY) || 0); } catch {}
        if (saved > 0 && (list.length === 0 || list.some((x) => Number(x.id) === saved))) {
            return saved;
        }
        if (u.angkatan_id) {
            const uid = Number(u.angkatan_id);
            if (uid > 0) return uid;
        }
        if (list.length > 0) {
            const yr = new Date().getFullYear();
            const pick = list.find((x) => x.aktif && Number(x.tahun) === yr)
                || list.find((x) => x.aktif)
                || list[0];
            if (pick && pick.id) return Number(pick.id);
        }
        return null;
    },

    getAngkatanAktifObj() {
        const id = OsisAuth.getAngkatanAktif();
        const list = OsisAuth.getAngkatanList();
        if (id) {
            const hit = list.find((x) => Number(x.id) === Number(id));
            if (hit) return hit;
        }
        const u = OsisAuth.getUser();
        if (u && u.mode === "osis") {
            return {
                id: u.angkatan_id || id || null,
                nama: String(u.angkatan || "").trim(),
                kode: "",
            };
        }
        return null;
    },

    setAngkatanAktif(id) {
        if (!OsisAuth.isLintasAngkatan()) return OsisAuth.getAngkatanAktif();
        const num = Number(id || 0);
        try {
            if (num > 0) localStorage.setItem(OsisAuth.ANGKATAN_AKTIF_KEY, String(num));
            else localStorage.removeItem(OsisAuth.ANGKATAN_AKTIF_KEY);
        } catch {}
        OsisAuth.clearScopedCache();
        return OsisAuth.getAngkatanAktif();
    },

    clearScopedCache() {
        try {
            const rm = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k.startsWith("osis_cache_") && (
                    /_ang_/.test(k) ||
                    /_(kas|saldo_awal|absensi|tabungan|anggota|agenda_|program|notulensi|informasi|dokumen|poster|osis_visitor|osis_users|akses_matriks|wawancara_|tes_)/.test(k)
                )) {
                    rm.push(k);
                }
            }
            rm.forEach((k) => localStorage.removeItem(k));
        } catch {}
    },

    // Punya kendali atas halaman? super/'*' -> semua true.
    bisa(halaman) {
        const u = OsisAuth.getUser();
        if (!u || u.mode !== "osis") return false;
        const a = OsisAuth.getAkses();
        if (!a) return false;
        if (a.super) return true;
        const list = Array.isArray(a.halaman) ? a.halaman : [];
        return list.includes(halaman) || list.includes("*");
    },

    isSuper() {
        const u = OsisAuth.getUser();
        const a = OsisAuth.getAkses();
        return !!(u && u.mode === "osis" && a && a.super);
    },

    // Guard aksi tulis: false + toast kalau tidak boleh.
    butuh(halaman, pesan) {
        if (OsisAuth.bisa(halaman)) return true;
        if (typeof showToast === "function") {
            showToast(pesan || "Kamu tidak punya kendali atas halaman ini.", "error");
        }
        return false;
    },

    // Cek user itu guest LEGACY (mode "guest" baru, "tamu" = sisa sesi lama).
    // Guest sudah dihapus — sisa cache-nya dibuang paksa di syncAuth.
    isGuest(user) {
        return !!user && (user.mode === "guest" || user.mode === "tamu");
    },

    // Cek user itu akun biasa (publik terdaftar, tanpa hak OSIS).
    isBiasa(user) {
        return !!user && user.mode === "biasa";
    },

    // Masuk sebagai guest LEGACY — SUDAH DIHAPUS, jangan dipakai kode baru.
    // Dipertahankan biar file lama yang manggil tidak pecah; isinya langsung
    // dibuang (syncAuth juga membuang cache guest saat halaman dimuat).
    loginGuest(nickname) {
        OsisAuth.buangCacheOsis();
    },

    // Masuk sebagai anggota OSIS (dipanggil setelah signIn Auth sukses).
    // userObj = baris osis_users TANPA password. Session JWT dipegang supabase-js.
    loginOsis(userObj) {
        const prev = OsisAuth.getUser();
        const aman = { ...userObj };
        delete aman.password;
        aman.mode = "osis";
        if (prev && Number(prev.id) !== Number(aman.id)) {
            try { localStorage.removeItem(OsisAuth.ANGKATAN_AKTIF_KEY); } catch {}
            OsisAuth.clearScopedCache();
        }
        localStorage.setItem(OsisAuth.KEY, JSON.stringify(aman));
    },

    // Masuk sebagai akun biasa (dipanggil setelah signIn Auth sukses).
    // userObj = baris biasa_users. Tanpa hak OSIS apa pun.
    loginBiasa(userObj) {
        const aman = { ...userObj };
        delete aman.password;
        aman.mode = "biasa";
        localStorage.setItem(OsisAuth.KEY, JSON.stringify(aman));
    },

    buangCacheOsis() {
        try { localStorage.removeItem(OsisAuth.KEY); } catch {}
        try { localStorage.removeItem(OsisAuth.AKSES_KEY); } catch {}
        try { localStorage.removeItem(OsisAuth.ANGKATAN_AKTIF_KEY); } catch {}
        OsisAuth.clearScopedCache();
    },

    // Sinkronkan cache dengan session Auth. Dipanggil tiap halaman dimuat
    // sebelum renderHeader. Offline/gagal baca session: pertahankan cache.
    async syncAuth() {
        const cached = OsisAuth.getUser();
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            if (cached && OsisAuth.isGuest(cached)) OsisAuth.buangCacheOsis();
            return;
        }
        let session = null;
        let errSession = null;
        try {
            const r = await supa.auth.getSession();
            session = r && r.data ? r.data.session : null;
            errSession = r ? r.error : null;
        } catch {
            return; // CDN belum termuat / offline total — jangan utak-atik cache
        }
        if (!session) {
            // Saat JWT >1 jam dan koneksi putus/lemot, getSession() gagal refresh
            // token lalu mengembalikan { session: null, error } tanpa melempar catch.
            // Jangan buang cache login/data supaya mode offline tetap jalan.
            if (errSession) {
                const msg = String(errSession.message || errSession.name || errSession || "");
                const status = Number(errSession.status || 0);
                const gagalJaringan =
                    (typeof navigator !== "undefined" && navigator.onLine === false) ||
                    errSession.name === "AuthRetryableFetchError" ||
                    (!status && /offline|fetch|network|abort|timeout|retryable/i.test(msg));
                if (gagalJaringan) {
                    if (cached && OsisAuth.isGuest(cached)) OsisAuth.buangCacheOsis();
                    return;
                }
            }
            // Tidak ada session tapi cache bilang login (OSIS/biasa = basi:
            // logout di tab lain / token dicabut; guest = legacy dihapus) ->
            // buang biar tidak dikira login.
            if (cached && (cached.mode === "osis" || cached.mode === "biasa" || OsisAuth.isGuest(cached))) {
                OsisAuth.buangCacheOsis();
            }
            return;
        }
        if (cached && cached.mode === "osis" && cached.auth_id === session.user.id && cached.id && cached.auth_email && ("angkatan_id" in cached)) {
            return; // sudah sinkron
        }
        if (cached && cached.mode === "biasa" && cached.auth_id === session.user.id && cached.id) {
            return; // sudah sinkron
        }
        // Cache guest legacy: buang lalu lanjut resolve session di bawah
        // (biar tidak return dini).
        if (cached && OsisAuth.isGuest(cached)) OsisAuth.buangCacheOsis();
        try {
            const rowOsis = (typeof getOsisUserByAuthId === "function")
                ? await getOsisUserByAuthId(session.user.id) : null;
            if (rowOsis) {
                OsisAuth.loginOsis(rowOsis);
                try { await OsisAuth.refreshAkses(); } catch {}
                return;
            }
            const rowBiasa = (typeof getBiasaUserByAuthId === "function")
                ? await getBiasaUserByAuthId(session.user.id) : null;
            if (rowBiasa) {
                OsisAuth.loginBiasa(rowBiasa);
                return;
            }
            // Session valid tapi tidak terlink ke akun mana pun (pendaftar liar)
            // -> keluar paksa.
            try { await supa.auth.signOut(); } catch {}
            OsisAuth.buangCacheOsis();
        } catch {
            // Offline saat fetch baris: pertahankan cache lama apa adanya.
        }
    },

    async logout() {
        // Catat dulu selagi identitas masih ada (fire-and-forget), baru buang cache.
        try { catatAksi("logout", ""); } catch {}
        // Cache dibuang DULU secara sinkron (pemanggil sync langsung lihat logout),
        // session Auth dicabut setelahnya.
        OsisAuth.buangCacheOsis();
        try { await supa.auth.signOut(); } catch {}
    },

    async confirmLogout() {
        const yakin = await OsisAuth.tanya("Yakin mau logout?");
        if (!yakin) return;
        OsisAuth.logout();
        OsisAuth.renderHeader();
        // Reload biar tidak ada tampilan basi (gate polling, form terisi nama, dsb.).
        try { location.reload(); } catch {}
    },

    // Konfirmasi universal: showPopup kalau ada, fallback native confirm.
    // (Semua halaman areaAuth memuat show-popup.js — fallback cuma jaga-jaga.)
    async tanya(pesan) {
        try {
            if (typeof showPopup === "function") return !!(await showPopup(pesan, "confirm"));
        } catch {}
        return true;
    },

    // Nama buat ditampilin: OSIS -> nama anggota, biasa -> nama akun.
    displayName(user) {
        if (!user) return "";
        if (user.mode === "osis") return String(user.nama || user.username || "").trim();
        if (user.mode === "biasa") return String(user.nama || user.username || "").trim();
        return String(user.nickname || "").trim();
    },

    // Render area auth di header publik
    renderHeader() {
        const area = document.getElementById("areaAuth");
        if (!area) return;
        // Hangatkan cache hak kendali tiap buka halaman (fire-and-forget)
        try {
            const u0 = OsisAuth.getUser();
            if (u0 && u0.mode === "osis") OsisAuth.refreshAkses().catch(() => {});
        } catch {}
        const user = OsisAuth.getUser();

        if (!user) {
            const diSub = /(^|\/)osis\//.test(String(location.pathname || "").replace(/\\/g, "/"));
            area.innerHTML = `
                <a href="${diSub ? "../" : ""}login" class="btn btn-red btn-sm" onclick="OsisAuth.simpanBack()"><i class="fa-solid fa-right-to-bracket"></i> Masuk</a>`;
            return;
        }

        const isOsis = user.mode === "osis";
        const isBiasa = user.mode === "biasa";
        const ikon = isOsis ? '<i class="fa-solid fa-id-card"></i>' : '<i class="fa-solid fa-user"></i>';
        const judul = isOsis ? (user.jabatan || "Anggota OSIS") : (isBiasa ? "Akun Biasa" : "Tamu");
        const namaChip = escapeHtml(OsisAuth.displayName(user)) || escapeHtml(user.username || "Akun");
        const tombolKeluar = `
            <button class="icon-btn" title="Keluar" onclick="OsisAuth.confirmLogout()">
                <i class="fa-solid fa-arrow-right-from-bracket"></i>
            </button>`;
        // OSIS: chip link ke profil. Akun biasa: chip teks saja (tanpa halaman
        // profil) + tombol keluar. Guest legacy: sama, tinggal dipurge.
        if (isOsis) {
            // Link relatif terhadap posisi halaman: root -> osis/profil,
            // dalam /osis/* -> profil.
            const diSub = /(^|\/)osis\//.test(String(location.pathname || "").replace(/\\/g, "/"));
            const hrefChip = ((diSub ? "" : "osis/") + "profil");
            area.innerHTML = `
                <a href="${hrefChip}" class="user-chip" title="${escapeHtml(judul)} — klik untuk buka profil">
                    ${ikon}
                    ${namaChip}
                </a>
                ${tombolKeluar}`;
            return;
        }
        area.innerHTML = `
            <span class="user-chip ${isBiasa ? "" : "chip-guest"}" title="${escapeHtml(judul)}">
                ${ikon}
                ${namaChip}
            </span>
            ${tombolKeluar}`;
    },

    // Simpan halaman sekarang biar login bisa balik ke sini (URL login tetap bersih)
    simpanBack() {
        try { sessionStorage.setItem("osis_login_back", "index" + location.hash); }
        catch (e) {}
    }
};

async function OsisAuthInit() {
  try {
    await OsisAuth.syncAuth();
  } catch {}
  OsisAuth.renderHeader();
}

if (typeof onReady === "function") {
  onReady(() => OsisAuthInit());
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => OsisAuthInit());
} else {
  OsisAuthInit();
}
