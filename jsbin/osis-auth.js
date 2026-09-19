// =========================================================================
// AUTH OSIS — login 2 mode: Guest (nickname) / OSIS (username+password)
// localStorage.osis_user (key beda dari e-learniz biar ga tabrakan)
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

    // Cek user itu guest (mode "guest" baru, "tamu" = sisa sesi lama)
    isGuest(user) {
        return !!user && (user.mode === "guest" || user.mode === "tamu");
    },

    // Masuk sebagai guest (tanpa akun, cuma nickname)
    loginGuest(nickname) {
        localStorage.setItem(OsisAuth.KEY, JSON.stringify({
            mode: "guest",
            nickname: nickname
        }));
    },

    // Masuk sebagai anggota OSIS (akun dari tabel osis_users)
    loginOsis(userObj) {
        const aman = { ...userObj };
        delete aman.password;
        aman.mode = "osis";
        localStorage.setItem(OsisAuth.KEY, JSON.stringify(aman));
    },

    logout() {
        localStorage.removeItem(OsisAuth.KEY);
        try { localStorage.removeItem(OsisAuth.AKSES_KEY); } catch {}
    },

    async confirmLogout() {
        const yakin = await showPopup("Yakin mau logout?", "confirm");
        if (!yakin) return;
        OsisAuth.logout();
        OsisAuth.renderHeader();
    },

    // Nama buat ditampilin: guest -> nickname, OSIS -> nama anggota
    displayName(user) {
        if (!user) return "";
        if (user.mode === "osis") return String(user.nama || user.username || "").trim();
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

        const guest = OsisAuth.isGuest(user);
        const ikon = guest ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-id-card"></i>';
        const judul = guest ? "Tamu" : (user.jabatan || "Anggota OSIS");

        area.innerHTML = `
            <span class="user-chip ${guest ? "chip-guest" : ""}" title="${judul}">
                ${ikon}
                ${escapeHtml(OsisAuth.displayName(user))}
            </span>
            <button class="icon-btn" title="Keluar" onclick="OsisAuth.confirmLogout()">
                <i class="fa-solid fa-arrow-right-from-bracket"></i>
            </button>`;
    },

    // Simpan halaman sekarang biar login bisa balik ke sini (URL login tetap bersih)
    simpanBack() {
        try { sessionStorage.setItem("osis_login_back", "index" + location.hash); }
        catch (e) {}
    }
};

if (typeof onReady === "function") {
    onReady(() => OsisAuth.renderHeader());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => OsisAuth.renderHeader());
} else {
    OsisAuth.renderHeader();
}
