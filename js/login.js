// =========================================================================
// LOGIN — 2 mode: Guest (nickname) / OSIS (username + password)
// =========================================================================

const Login = {
    back: "index",

    init() {
        // Tujuan balik disimpan di sessionStorage (biar URL login tetap bersih)
        try {
            const back = sessionStorage.getItem("osis_login_back");
            if (back) Login.back = back;
            sessionStorage.removeItem("osis_login_back");
        } catch (e) {}

        if (OsisAuth.getUser()) {
            location.replace("index.z");
            return;
        }

        document.getElementById("guestNickname").addEventListener("keydown", (e) => {
            if (e.key === "Enter") Login.masukGuest();
        });
        document.getElementById("osisUsername").addEventListener("keydown", (e) => {
            if (e.key === "Enter") document.getElementById("osisPassword").focus();
        });
        document.getElementById("osisPassword").addEventListener("keydown", (e) => {
            if (e.key === "Enter") Login.masukOsis();
        });
    },

    pilih(mode) {
        Login.bersihError();
        const slider = document.getElementById("mainSlider");
        slider.classList.toggle("step-1", mode === "osis");

        setTimeout(() => {
            if (mode === "osis") document.getElementById("osisUsername").focus();
            if (mode === "") document.getElementById("guestNickname").focus();
        }, 260);
    },

    masukGuest() {
        const nickname = document.getElementById("guestNickname").value.trim();
        Login.bersihError();
        if (!nickname) return Login.tampilError("Nama panggilan diisi dulu yaa.");

        // Nama kecatet ke tabel visitor pas index kebuka lagi (catatVisitor)
        OsisAuth.loginGuest(nickname);
        location.replace(Login.back);
    },

    async masukOsis() {
        const username = document.getElementById("osisUsername").value.trim();
        const pw = document.getElementById("osisPassword").value;
        Login.bersihError();

        if (!username) return Login.tampilError("Username diisi dulu yaa.");
        if (!pw) return Login.tampilError("Password diisi dulu yaa.");

        let user;
        try {
            user = await getOsisUser(username);
        } catch (err) {
            console.error(err);
            return Login.tampilError("Gagal cek akun. Cek koneksi.");
        }

        if (!user) return Login.tampilError("Akun tidak ditemukan.");
        if (pw !== user.password) return Login.tampilError("Password salah, coba lagi!");

        OsisAuth.loginOsis(user);
        location.replace(Login.back);
    },

    tampilError(pesan) {
        const el = document.getElementById("loginError");
        el.textContent = pesan;
        el.style.display = "block";
    },

    bersihError() {
        const el = document.getElementById("loginError");
        el.textContent = "";
        el.style.display = "none";
    }
};

document.addEventListener("DOMContentLoaded", () => Login.init());
