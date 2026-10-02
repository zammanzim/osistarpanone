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

    getUser() {
        try { return JSON.parse(localStorage.getItem(OsisAuth.KEY) || "null"); }
        catch { return null; }
    },

    // Cache hak kendali per halaman {halaman:[], sekbid_id, sekbid_nama, super}.
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
        try {
            const a = await aksesSaya(u.id);
            try { localStorage.setItem(OsisAuth.AKSES_KEY, JSON.stringify(a || null)); } catch {}
            return a;
        } catch (err) {
            console.error("Gagal muat hak akses:", err);
            return OsisAuth.getAkses();
        }
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
        const aman = { ...userObj };
        delete aman.password;
        aman.mode = "osis";
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
    },

    // Sinkronkan cache dengan session Auth. Dipanggil tiap halaman dimuat
    // sebelum renderHeader. Offline/gagal baca session: pertahankan cache.
    async syncAuth() {
        let session = null;
        try {
            const r = await supa.auth.getSession();
            session = r && r.data ? r.data.session : null;
        } catch {
            return; // CDN belum termuat / offline total — jangan utak-atik cache
        }
        const cached = OsisAuth.getUser();
        if (!session) {
            // Tidak ada session tapi cache bilang login (OSIS/biasa = basi:
            // logout di tab lain / token dicabut; guest = legacy dihapus) ->
            // buang biar tidak dikira login.
            if (cached && (cached.mode === "osis" || cached.mode === "biasa" || OsisAuth.isGuest(cached))) {
                OsisAuth.buangCacheOsis();
            }
            return;
        }
        if (cached && cached.mode === "osis" && cached.auth_id === session.user.id && cached.id && cached.auth_email) {
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
            area.innerHTML = `
                <a href="login" class="btn btn-red btn-sm" onclick="OsisAuth.simpanBack()"><i class="fa-solid fa-right-to-bracket"></i> Masuk</a>`;
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
