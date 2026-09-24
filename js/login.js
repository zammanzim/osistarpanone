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

        // Baris akun dicari by username (tanpa password — verifikasi via Auth API).
        let row;
        try {
            row = await getOsisUser(username);
        } catch (err) {
            console.error(err);
            return Login.tampilError("Gagal cek akun. Cek koneksi.");
        }
        if (!row) return Login.tampilError("Akun tidak ditemukan.");

        // Email tersimpan (<nama>@domain); klaim mandiri pakai fallback id.
        const email = emailUntukOsis(row);
        const emailKlaim = emailKlaimOsis(row.id);
        try {
            // 1) Coba login normal (akun sudah termigrasi ke Auth).
            const s1 = await supa.auth.signInWithPassword({ email, password: pw });
            if (!s1.error) {
                await Login.lanjutMasuk(row.id);
                return;
            }
            // 1b) Email tersimpan tidak cocok tapi fallback id mungkin bisa
            // (mis. auth_email belum tersinkron). Coba sekali sebelum klaim.
            if (email !== emailKlaim) {
                const s1b = await supa.auth.signInWithPassword({ email: emailKlaim, password: pw });
                if (!s1b.error) {
                    await Login.lanjutMasuk(row.id);
                    return;
                }
            }
            // 2) Belum termigrasi: daftar + klaim akun via RPC (verifikasi
            //    password lama di server, lalu password plaintext dihapus).
            //    Butuh dashboard: Auth "Confirm email" = OFF.
            const su = await supa.auth.signUp({ email: emailKlaim, password: pw });
            const sudahAda = su.error && /already|registered|exists|duplicate/i.test(su.error.message || "");
            if (su.error && !sudahAda) {
                console.error(su.error);
                // Password lama lebih pendek dari minimum dashboard: user ini
                // harus dimigrasi via bulk script (dapat password sementara).
                if (/at least|too short|minimum|password.*length|length.*password/i.test(su.error.message || "")) {
                    return Login.tampilError("Password lamamu terlalu pendek untuk sistem baru. Hubungi admin untuk reset.");
                }
                return Login.tampilError("Gagal mengaktifkan akun. Hubungi admin.");
            }
            if (sudahAda) return Login.tampilError("Password salah, coba lagi!");
            // signUp kadang tidak langsung memberi session — coba login lagi.
            let sesi = su.data && su.data.session;
            if (!sesi) {
                const s2 = await supa.auth.signInWithPassword({ email: emailKlaim, password: pw });
                if (s2.error || !s2.data.session) {
                    console.error(s2.error);
                    return Login.tampilError("Gagal mengaktifkan akun. Hubungi admin.");
                }
            }
            const { data: hasil, error: eLink } = await supa.rpc("migrasi_link_auth", {
                p_username: username, p_password: pw, p_email: emailKlaim,
            });
            if (eLink) {
                console.error(eLink);
                try { await supa.auth.signOut(); } catch {}
                return Login.tampilError("Gagal mengaktifkan akun. Hubungi admin.");
            }
            if (hasil === "ERR_SUDAH") {
                // Baris milik akun auth lain — kemungkinan password Auth beda.
                try { await supa.auth.signOut(); } catch {}
                return Login.tampilError("Password salah, coba lagi!");
            }
            if (hasil !== "OK") {
                try { await supa.auth.signOut(); } catch {}
                return Login.tampilError("Password salah, coba lagi!");
            }
            await Login.lanjutMasuk(row.id);
        } catch (err) {
            console.error(err);
            try { await supa.auth.signOut(); } catch {}
            return Login.tampilError("Gagal masuk. Cek koneksi.");
        }
    },

    // Ambil baris terbaru, simpan cache, muat hak, lalu redirect.
    async lanjutMasuk(osisId) {
        const fresh = await getOsisUserById(osisId);
        if (!fresh) {
            try { await supa.auth.signOut(); } catch {}
            return Login.tampilError("Akun tidak terdaftar sebagai OSIS.");
        }
        OsisAuth.loginOsis(fresh);
        // Muat hak kendali sebelum masuk (biar tombol aksi langsung benar)
        try { await OsisAuth.refreshAkses(); } catch {}
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
