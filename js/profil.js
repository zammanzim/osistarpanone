// =========================================================================
// PROFIL OSIS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/profil.html — ganti nama, username, password, PP, bio.
// Tulis via RPC SECURITY DEFINER (update_osis_profil / ganti_osis_username /
// ganti_osis_password), PP via bucket osis-foto folder profil/.
// =========================================================================

const Profil = {
    userId: null,
    fotoPath: "",     // path foto yang sudah tersimpan di DB
    pendingFile: null,// File PP baru (staged, belum di-upload)
    pendingUrl: null, // objectURL preview (buat revoke)
    fotoDihapus: false,

    init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis" || !u.id) {
            location.replace("../login");
            return;
        }
        Profil.userId = u.id;

        document.getElementById("btnSimpanProfil")?.addEventListener("click", () => Profil.simpanProfil());
        document.getElementById("btnSimpanUsername")?.addEventListener("click", () => Profil.simpanUsername());
        document.getElementById("btnSimpanPassword")?.addEventListener("click", () => Profil.simpanPassword());
        document.getElementById("btnHapusFoto")?.addEventListener("click", () => Profil.hapusFotoStaged());
        document.getElementById("btnLogoutProfil")?.addEventListener("click", () => OsisAuth.confirmLogout());

        // PP: klik atau drag & drop (kayak prestasi/agenda)
        const drop = document.getElementById("profilDrop");
        const fileInput = document.getElementById("profilFile");
        if (drop && fileInput) {
            drop.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", (e) => {
                Profil.handleFile(e.target.files && e.target.files[0]);
                e.target.value = "";
            });
            ["dragenter", "dragover"].forEach(ev => {
                drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
            });
            ["dragleave", "drop"].forEach(ev => {
                drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
            });
            drop.addEventListener("drop", (e) => {
                const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (f) Profil.handleFile(f);
            });
        }

        Profil.muat();
    },

    async muat() {
        try {
            const fresh = await getOsisUserById(Profil.userId);
            if (!fresh) {
                // sesi tidak valid lagi — paksa login ulang
                OsisAuth.logout();
                location.replace("../login");
                return;
            }
            // sync localStorage biar header & dashboard ikut update (tanpa password)
            const cur = OsisAuth.getUser() || {};
            const next = { ...cur, id: fresh.id, username: fresh.username, nama: fresh.nama, jabatan: fresh.jabatan, foto: fresh.foto || "", bio: fresh.bio || "", mode: "osis" };
            delete next.password;
            localStorage.setItem(OsisAuth.KEY, JSON.stringify(next));
            if (typeof OsisAuth.renderHeader === "function") OsisAuth.renderHeader();

            Profil.fotoPath = fresh.foto || "";
            Profil.pendingFile = null;
            Profil.fotoDihapus = false;
            Profil._revokePendingUrl();

            document.getElementById("profilNama").value = fresh.nama || "";
            document.getElementById("profilBio").value = fresh.bio || "";
            document.getElementById("profilUsername").value = fresh.username || "";
            document.getElementById("profilJabatan").value = fresh.jabatan || "-";
            Profil.renderFoto();
            Profil.renderHero(fresh);
        } catch (err) {
            console.error(err);
            showToast("Gagal memuat profil: " + err.message, "error");
        }
    },

    renderHero(u) {
        const namaEl = document.getElementById("profilHeroNama");
        const userEl = document.getElementById("profilHeroUser");
        const jabEl = document.getElementById("profilHeroJabatan");
        const bioEl = document.getElementById("profilHeroBio");
        if (namaEl) namaEl.textContent = u.nama || u.username || "OSIS";
        if (userEl) userEl.textContent = "@" + (u.username || "-");
        if (jabEl) jabEl.textContent = u.jabatan || "Anggota OSIS";
        if (bioEl) {
            bioEl.textContent = u.bio || "Belum ada bio.";
            bioEl.style.opacity = u.bio ? "1" : "0.55";
        }
    },

    renderFoto() {
        const img = document.getElementById("profilImg");
        const ph = document.getElementById("profilPlaceholder");
        const hint = document.getElementById("profilFotoHint");
        if (!img) return;
        let src = "";
        if (Profil.pendingFile) src = Profil.pendingUrl || "";
        else if (!Profil.fotoDihapus && Profil.fotoPath) src = getFoto(Profil.fotoPath);
        if (src) {
            img.src = src;
            img.style.display = "block";
            if (ph) ph.style.display = "none";
        } else {
            img.removeAttribute("src");
            img.style.display = "none";
            if (ph) {
                ph.style.display = "grid";
                const u = OsisAuth.getUser() || {};
                const initial = String(u.nama || u.username || "O").trim().charAt(0).toUpperCase() || "O";
                ph.textContent = initial;
            }
        }
        if (hint) hint.style.display = Profil.pendingFile ? "" : "none";
        const delBtn = document.getElementById("btnHapusFoto");
        if (delBtn) delBtn.style.display = (Profil.pendingFile || (!Profil.fotoDihapus && Profil.fotoPath)) ? "" : "none";
    },

    handleFile(file) {
        if (!file) return;
        if (!file.type || !file.type.startsWith("image/")) {
            showToast("File harus gambar", "error");
            return;
        }
        Profil._revokePendingUrl();
        Profil.pendingFile = file;
        Profil.pendingUrl = URL.createObjectURL(file);
        Profil.fotoDihapus = false;
        Profil.renderFoto();
    },

    hapusFotoStaged() {
        Profil._revokePendingUrl();
        Profil.pendingFile = null;
        Profil.fotoDihapus = true;
        const fi = document.getElementById("profilFile");
        if (fi) fi.value = "";
        Profil.renderFoto();
        showToast("Foto dihapus — klik Simpan Profil buat permanen", "info");
    },

    _revokePendingUrl() {
        if (Profil.pendingUrl) { try { URL.revokeObjectURL(Profil.pendingUrl); } catch {} }
        Profil.pendingUrl = null;
    },

    _syncLocal(patch) {
        try {
            const cur = OsisAuth.getUser() || {};
            const next = { ...cur, ...patch, mode: "osis" };
            delete next.password;
            localStorage.setItem(OsisAuth.KEY, JSON.stringify(next));
            if (typeof OsisAuth.renderHeader === "function") OsisAuth.renderHeader();
        } catch {}
    },

    _pesanError(err, map) {
        const code = String((err && err.message) || err || "");
        for (const k of Object.keys(map)) {
            if (code.includes(k)) return map[k];
        }
        return "Gagal simpan: " + code;
    },

    async simpanProfil() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const nama = document.getElementById("profilNama").value.trim();
        const bio = document.getElementById("profilBio").value.trim();
        if (!nama) { showToast("Nama wajib diisi", "error"); return; }

        const btn = document.getElementById("btnSimpanProfil");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }

        const fotoLama = Profil.fotoPath || "";
        try {
            let fotoBaru = Profil.fotoDihapus ? "" : fotoLama;
            // upload PP baru kalau ada staged
            if (Profil.pendingFile) {
                const f = Profil.pendingFile;
                const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
                const path = `profil/profil-${Profil.userId}-${Date.now()}.${ext}`;
                await uploadFotoStorage(f, path);
                fotoBaru = path;
            }
            await updateOsisProfil(Profil.userId, nama, bio, fotoBaru);
            // hapus file lama kalau keganti / dihapus
            if (fotoLama && fotoLama !== fotoBaru) {
                try { await hapusFotoStorage(fotoLama); } catch {}
            }
            Profil.fotoPath = fotoBaru;
            Profil.pendingFile = null;
            Profil.fotoDihapus = false;
            Profil._revokePendingUrl();
            Profil._syncLocal({ nama, bio, foto: fotoBaru });
            Profil.renderFoto();
            const fresh = { ...(OsisAuth.getUser() || {}), nama, bio, foto: fotoBaru };
            Profil.renderHero(fresh);
            showToast("Profil diperbarui!", "success");
        } catch (err) {
            console.error(err);
            showToast(Profil._pesanError(err, {
                "ERR_NO_NAMA": "Nama wajib diisi",
                "ERR_NO_AUTH": "Sesi habis, login ulang ya"
            }), "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Profil'; }
        }
    },

    async simpanUsername() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const inp = document.getElementById("profilUsername");
        const username = (inp.value || "").trim();
        if (username === u.username) { showToast("Username tidak berubah", "info"); return; }

        const btn = document.getElementById("btnSimpanUsername");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
        try {
            await gantiOsisUsername(Profil.userId, username);
            Profil._syncLocal({ username });
            const heroUser = document.getElementById("profilHeroUser");
            if (heroUser) heroUser.textContent = "@" + username;
            showToast("Username diganti!", "success");
        } catch (err) {
            console.error(err);
            showToast(Profil._pesanError(err, {
                "ERR_TAKEN": "Username sudah dipakai akun lain",
                "ERR_INVALID": "Username 3-30 karakter",
                "ERR_NO_AUTH": "Sesi habis, login ulang ya"
            }), "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
        }
    },

    async simpanPassword() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const oldPw = document.getElementById("profilPwLama").value || "";
        const newPw = document.getElementById("profilPwBaru").value || "";
        const confPw = document.getElementById("profilPwKonfirm").value || "";
        if (!oldPw) { showToast("Password lama diisi dulu", "error"); return; }
        if (newPw.length < 4) { showToast("Password baru minimal 4 karakter", "error"); return; }
        if (newPw !== confPw) { showToast("Konfirmasi tidak sama", "error"); return; }

        const btn = document.getElementById("btnSimpanPassword");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
        try {
            await gantiOsisPassword(Profil.userId, oldPw, newPw);
            document.getElementById("profilPwLama").value = "";
            document.getElementById("profilPwBaru").value = "";
            document.getElementById("profilPwKonfirm").value = "";
            showToast("Password diganti! Login berikutnya pakai yang baru.", "success");
        } catch (err) {
            console.error(err);
            showToast(Profil._pesanError(err, {
                "ERR_WRONG": "Password lama salah",
                "ERR_INVALID": "Password baru 4-100 karakter",
                "ERR_NO_AUTH": "Sesi habis, login ulang ya"
            }), "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
        }
    }
};

document.addEventListener("DOMContentLoaded", () => Profil.init());
