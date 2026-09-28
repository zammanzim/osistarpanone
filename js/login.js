// =========================================================================
// LOGIN — 1 form username + password buat 2 tipe akun (otomatis):
// OSIS (hak penuh) / biasa (publik terdaftar, tanpa hak OSIS).
// Form bawah buat daftar akun biasa (username + nama + password).
// Username unik global lawan osis_users (dicek server, anti-penyamaran).
// =========================================================================

const Login = {
    back: "index",
    sibuk: false,

    init() {
        // Tujuan balik disimpan di sessionStorage (biar URL login tetap bersih)
        try {
            const back = sessionStorage.getItem("osis_login_back");
            if (back) Login.back = back;
            sessionStorage.removeItem("osis_login_back");
        } catch (e) {}

        const cur = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        if (cur && (cur.mode === "osis" || cur.mode === "biasa")) {
            location.replace(Login.back);
            return;
        }
        // Sisa cache guest legacy (sistem lama): buang, wajib daftar/masuk ulang.
        try { if (cur) OsisAuth.buangCacheOsis(); } catch {}

        document.getElementById("loginUsername").addEventListener("keydown", (e) => {
            if (e.key === "Enter") document.getElementById("loginPassword").focus();
        });
        document.getElementById("loginPassword").addEventListener("keydown", (e) => {
            if (e.key === "Enter") Login.masuk();
        });
        document.getElementById("daftarUsername").addEventListener("keydown", (e) => {
            if (e.key === "Enter") document.getElementById("daftarNama").focus();
        });
        document.getElementById("daftarNama").addEventListener("keydown", (e) => {
            if (e.key === "Enter") document.getElementById("daftarPassword").focus();
        });
        document.getElementById("daftarPassword").addEventListener("keydown", (e) => {
            if (e.key === "Enter") Login.daftar();
        });

        // Link "daftar" dari halaman lain bisa pakai login#daftar.
        try {
            if (String(location.hash || "").toLowerCase() === "#daftar") Login.pilih("daftar");
        } catch {}

        Login.aturTinggi();
        window.addEventListener("resize", () => Login.aturTinggi());
    },

    // Kunci tinggi window slider ngikutin step yang aktif (masuk/daftar
    // beda tinggi — tanpa ini step pendek nyisain ruang kosong).
    aturTinggi() {
        try {
            const win = document.querySelector(".login-card .slider-window");
            const slider = document.getElementById("mainSlider");
            if (!win || !slider || !slider.children.length) return;
            const aktif = slider.classList.contains("step-1")
                ? slider.children[1] : slider.children[0];
            if (aktif) win.style.height = aktif.offsetHeight + "px";
        } catch {}
    },

    pilih(mode) {
        Login.bersihError();
        const slider = document.getElementById("mainSlider");
        slider.classList.toggle("step-1", mode === "daftar");
        Login.aturTinggi();

        setTimeout(() => {
            if (mode === "daftar") document.getElementById("daftarUsername").focus();
            else document.getElementById("loginUsername").focus();
        }, 260);
    },

    setSibuk(sibuk) {
        Login.sibuk = sibuk;
        const b1 = document.getElementById("btnMasuk");
        const b2 = document.getElementById("btnDaftar");
        if (b1) b1.disabled = sibuk;
        if (b2) b2.disabled = sibuk;
    },

    // ============ MASUK (OSIS dulu, lalu akun biasa) ============
    async masuk() {
        if (Login.sibuk) return;
        const username = document.getElementById("loginUsername").value.trim();
        const pw = document.getElementById("loginPassword").value;
        Login.bersihError();

        if (!username) return Login.tampilError("Username diisi dulu yaa.");
        if (!pw) return Login.tampilError("Password diisi dulu yaa.");

        Login.setSibuk(true);
        try {
            // 1) Coba sebagai OSIS (prioritas — username OSIS tidak bisa
            //    dipakai akun biasa, jadi tidak ada ambiguitas).
            let row = null;
            try {
                row = await getOsisUser(username);
            } catch (err) {
                console.error(err);
                return Login.tampilError("Gagal cek akun. Cek koneksi.");
            }
            if (row) {
                await Login.masukOsisFlow(row, username, pw);
                return;
            }

            // 2) Coba sebagai akun biasa.
            let biasa = null;
            try {
                biasa = await getBiasaUser(username);
            } catch (err) {
                console.error(err);
                return Login.tampilError("Gagal cek akun. Cek koneksi.");
            }
            if (!biasa) {
                return Login.tampilError("Akun tidak ditemukan. Belum punya akun? Daftar dulu di bawah.");
            }
            await Login.masukBiasaFlow(biasa, pw);
        } finally {
            Login.setSibuk(false);
        }
    },

    // Alur OSIS lama (pindah dari masukOsis): signIn, fallback email klaim,
    // klaim mandiri via migrasi_link_auth buat yang belum termigrasi.
    async masukOsisFlow(row, username, pw) {
        // Email tersimpan (<nama>@domain); klaim mandiri pakai fallback id.
        const email = emailUntukOsis(row);
        const emailKlaim = emailKlaimOsis(row.id);
        try {
            // 1) Coba login normal (akun sudah termigrasi ke Auth).
            const s1 = await supa.auth.signInWithPassword({ email, password: pw });
            if (!s1.error) {
                await Login.lanjutSesudahSignInOsis(row, username, pw, s1);
                return;
            }
            if (s1.error) console.warn("signIn OSIS gagal:", (s1.error && s1.error.message) || s1.error);
            // 1b) Email tersimpan tidak cocok tapi fallback id mungkin bisa
            // (mis. auth_email belum tersinkron). Coba sekali sebelum klaim.
            if (email !== emailKlaim) {
                const s1b = await supa.auth.signInWithPassword({ email: emailKlaim, password: pw });
                if (!s1b.error) {
                    await Login.lanjutSesudahSignInOsis(row, username, pw, s1b);
                    return;
                }
                if (s1b.error) console.warn("signIn OSIS fallback gagal:", (s1b.error && s1b.error.message) || s1b.error);
            }
            // Baris sudah tertaut ke akun Auth: berarti password salah — JANGAN
            // lanjut ke signUp (bakal bikin akun yatim osis-<id>@ yang mengacaukan
            // login berikutnya). Langsung tolak di sini.
            if (row.auth_id) return Login.tampilError("Password salah, coba lagi!");
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
            await Login.lanjutMasukOsis(row.id);
        } catch (err) {
            console.error(err);
            try { await supa.auth.signOut(); } catch {}
            return Login.tampilError("Gagal masuk. Cek koneksi.");
        }
    },

    // Setelah signIn OSIS sukses: pastikan sesi tertaut ke baris ini.
    // Kalau belum (klaim kepotong di percobaan lama: Auth jadi, link gagal),
    // tautkan ulang pakai password yang baru diketik. Tanpa ini user sempat
    // ke-redirect lalu dibuang diam-diam oleh syncAuth ("pendaftar liar").
    async lanjutSesudahSignInOsis(row, username, pw, s) {
        const sesi = s && s.data && s.data.session;
        const uid = (sesi && sesi.user && sesi.user.id) || "";
        const mailSesi = String((sesi && sesi.user && sesi.user.email) || "").toLowerCase();
        if (row.auth_id && uid && row.auth_id === uid) {
            await Login.lanjutMasukOsis(row.id);
            return;
        }
        // Heal hanya kalau sesi berasal dari email klaim pola osis-<id>@...
        // (sesi email lain yang tidak tertaut = urusan admin, jangan diutak-atik
        // biar tidak merusak akun yang sudah jalan).
        if (uid && mailSesi && mailSesi === emailKlaimOsis(row.id).toLowerCase()) {
            try {
                const { data: hasil, error: eLink } = await supa.rpc("migrasi_link_auth", {
                    p_username: username, p_password: pw, p_email: emailKlaimOsis(row.id),
                });
                if (!eLink && hasil === "OK") {
                    await Login.lanjutMasukOsis(row.id);
                    return;
                }
                console.warn("heal tautan OSIS gagal:", (eLink && eLink.message) || hasil);
                // ERR_SUDAH = baris ini milik akun Auth lain: user masuk pakai
                // password akun yatim/duplikat. Jangan diam — kasih tahu jelas.
                if (hasil === "ERR_SUDAH") {
                    try { await supa.auth.signOut(); } catch {}
                    return Login.tampilError("Kamu masuk pakai akun duplikat. Pakai password aslimu, atau hubungi admin.");
                }
            } catch (err) {
                console.warn("heal tautan OSIS gagal:", err);
            }
        }
        try { await supa.auth.signOut(); } catch {}
        return Login.tampilError("Akun login belum tertaut ke data OSIS. Hubungi admin untuk reset.");
    },

    // Alur akun biasa: signIn + self-heal link (kalau daftar kepotong di tengah).
    async masukBiasaFlow(row, pw) {
        const email = emailUntukBiasa(row);
        const emailKlaim = emailKlaimBiasa(row.id);
        try {
            let s = null;
            try {
                s = await supa.auth.signInWithPassword({ email, password: pw });
            } catch (err) {
                console.error(err);
                return Login.tampilError("Gagal masuk. Cek koneksi.");
            }
            if (s.error && email !== emailKlaim) {
                try {
                    const s2 = await supa.auth.signInWithPassword({ email: emailKlaim, password: pw });
                    if (!s2.error) s = s2;
                } catch {}
            }
            if (s.error) return Login.tampilError("Password salah, coba lagi!");
            // Self-heal: baris belum terlink (daftar kepotong pas link) -> link ulang.
            // Heal hanya kalau sesi berasal dari email klaim pola biasa-<id>@...
            const sesi = s.data && s.data.session;
            const sesiUid = (sesi && sesi.user && sesi.user.id) || "";
            const sesiMail = String((sesi && sesi.user && sesi.user.email) || "").toLowerCase();
            if (row.auth_id && sesiUid && row.auth_id === sesiUid) {
                await Login.lanjutMasukBiasa(row.id);
                return;
            }
            if (sesiUid && sesiMail && sesiMail === emailKlaim.toLowerCase()) {
                try {
                    const { data: hasil, error: eLink } = await supa.rpc("link_auth_biasa", {
                        p_user_id: row.id, p_email: emailKlaim,
                    });
                    if (eLink) throw eLink;
                    if (hasil !== "OK") throw new Error(hasil);
                    await Login.lanjutMasukBiasa(row.id);
                    return;
                } catch (err) {
                    console.error(err);
                }
            }
            try { await supa.auth.signOut(); } catch {}
            return Login.tampilError("Akun login belum tertaut. Coba daftar ulang atau hubungi admin.");
        } catch (err) {
            console.error(err);
            try { await supa.auth.signOut(); } catch {}
            return Login.tampilError("Gagal masuk. Cek koneksi.");
        }
    },

    // ============ DAFTAR AKUN BIASA ============
    async daftar() {
        if (Login.sibuk) return;
        const username = document.getElementById("daftarUsername").value.trim();
        const nama = document.getElementById("daftarNama").value.trim();
        const pw = document.getElementById("daftarPassword").value;
        Login.bersihError();

        if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
            return Login.tampilError("Username 3-30 karakter: huruf, angka, titik, _ atau -.");
        }
        if (!nama) return Login.tampilError("Nama diisi dulu yaa.");
        if (pw.length < 6) return Login.tampilError("Password minimal 6 karakter.");

        Login.setSibuk(true);
        try {
            // 1) Pesan slot username (cek unik global di server).
            let id = 0;
            try {
                const { data, error } = await supa.rpc("daftar_biasa", {
                    p_username: username, p_nama: nama,
                });
                if (error) throw error;
                const hasil = String(data || "");
                if (hasil === "ERR_TAKEN") {
                    return Login.tampilError("Username sudah dipakai. Coba yang lain atau masuk di form atas.");
                }
                if (hasil === "ERR_INVALID") {
                    return Login.tampilError("Username 3-30 karakter: huruf, angka, titik, _ atau -.");
                }
                if (hasil === "ERR_NO_NAMA") {
                    return Login.tampilError("Nama diisi dulu yaa.");
                }
                id = parseInt(hasil, 10);
                if (!Number.isFinite(id) || id <= 0) throw new Error(hasil);
            } catch (err) {
                console.error(err);
                if (!document.getElementById("loginError").textContent) {
                    return Login.tampilError("Gagal daftar. Cek koneksi.");
                }
                return;
            }

            // 2) Buat akun Auth. Butuh dashboard: Auth "Confirm email" = OFF.
            const email = emailKlaimBiasa(id);
            let sesi = null;
            try {
                const su = await supa.auth.signUp({ email, password: pw });
                const sudahAda = su.error && /already|registered|exists|duplicate/i.test(su.error.message || "");
                if (su.error && !sudahAda) {
                    console.error(su.error);
                    if (/at least|too short|minimum|password.*length|length.*password/i.test(su.error.message || "")) {
                        return Login.tampilError("Password minimal 6 karakter.");
                    }
                    return Login.tampilError("Gagal daftar. Coba lagi.");
                }
                sesi = su.data && su.data.session;
                if (sudahAda || !sesi) {
                    // Email bentrok / session tertunda: coba login langsung.
                    // Kalau password cocok berarti ini percobaan dobel -> heal + masuk.
                    const s2 = await supa.auth.signInWithPassword({ email, password: pw });
                    if (s2.error || !s2.data.session) {
                        try { await supa.auth.signOut(); } catch {}
                        return Login.tampilError("Username sudah terdaftar. Masuk aja di form atas.");
                    }
                    sesi = s2.data.session;
                }
            } catch (err) {
                console.error(err);
                return Login.tampilError("Gagal daftar. Cek koneksi.");
            }

            // 3) Link baris ke Auth.
            try {
                const { data: hasil, error: eLink } = await supa.rpc("link_auth_biasa", {
                    p_user_id: id, p_email: email,
                });
                if (eLink) throw eLink;
                if (hasil !== "OK") throw new Error(hasil);
            } catch (err) {
                console.error(err);
                // Auth sudah jadi: suruh masuk (login bakal self-heal link).
                try { await supa.auth.signOut(); } catch {}
                Login.pilih("");
                return Login.tampilError("Akun dibuat! Sekarang masuk pakai username + password barumu.");
            }

            await Login.lanjutMasukBiasa(id);
        } finally {
            Login.setSibuk(false);
        }
    },

    // Ambil baris OSIS terbaru, simpan cache, muat hak, lalu redirect.
    async lanjutMasukOsis(osisId) {
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

    // Ambil baris biasa terbaru, simpan cache, lalu redirect (tanpa hak).
    async lanjutMasukBiasa(biasaId) {
        let fresh = null;
        try {
            fresh = await getBiasaUserById(biasaId);
        } catch (err) {
            console.error(err);
            try { await supa.auth.signOut(); } catch {}
            return Login.tampilError("Gagal masuk. Cek koneksi.");
        }
        if (!fresh) {
            try { await supa.auth.signOut(); } catch {}
            return Login.tampilError("Akun tidak ditemukan.");
        }
        OsisAuth.loginBiasa(fresh);
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
