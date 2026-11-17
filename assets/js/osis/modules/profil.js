// =========================================================================
// PROFIL OSIS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/profil.html — ganti nama, username, password, PP, bio.
// Nama/username via RPC SECURITY DEFINER (update_osis_profil / ganti_osis_username),
// password via Supabase Auth API, PP via R2 folder profil/.
// =========================================================================

const Profil = {
    userId: null,
    fotoPath: "",      // path foto yang sudah tersimpan di DB
    pendingFile: null, // File PP baru (staged, belum di-upload)
    pendingUrl: null,  // objectURL preview (buat revoke)
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

        // PP: klik tombol kamera / pilih foto / area dropzone + drag & drop
        const drop = document.getElementById("profilDrop");
        const fileInput = document.getElementById("profilFile");
        const bukaPilihFoto = () => fileInput && fileInput.click();
        document.getElementById("btnAvatarCam")?.addEventListener("click", bukaPilihFoto);
        document.getElementById("btnPilihFoto")?.addEventListener("click", bukaPilihFoto);
        if (drop && fileInput) {
            drop.addEventListener("click", bukaPilihFoto);
            drop.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bukaPilihFoto(); }
            });
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

        // Live preview Nama, Bio, dan counter karakter bio
        document.getElementById("profilNama")?.addEventListener("input", () => Profil.syncLiveHero());
        document.getElementById("profilBio")?.addEventListener("input", () => Profil.syncLiveHero());

        // Toggle intip password & cek kesamaan password baru
        document.querySelectorAll("[data-pw-toggle]").forEach(btn => {
            btn.addEventListener("click", () => {
                const target = document.getElementById(btn.dataset.pwToggle);
                if (!target) return;
                const isPw = target.type === "password";
                target.type = isPw ? "text" : "password";
                const ico = btn.querySelector("i");
                if (ico) ico.className = isPw ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
                btn.title = isPw ? "Sembunyikan password" : "Tampilkan password";
            });
        });
        document.getElementById("profilPwBaru")?.addEventListener("input", () => Profil.syncPwFeedback());
        document.getElementById("profilPwKonfirm")?.addEventListener("input", () => Profil.syncPwFeedback());

        Profil.renderHero(u);
        Profil.renderAkun(u);
        Profil.syncBioCounter();
        if (typeof OsisAuth.refreshAkses === "function") {
            OsisAuth.refreshAkses().then(() => {
                Profil.renderAkun();
                Profil.renderHero();
            }).catch(() => {});
        }
        Profil.muat();
    },

    async muat() {
        try {
            const fresh = await getOsisUserById(Profil.userId);
            if (!fresh) {
                OsisAuth.logout();
                location.replace("../login");
                return;
            }
            const cur = OsisAuth.getUser() || {};
            const next = {
                ...cur,
                id: fresh.id,
                username: fresh.username,
                nama: fresh.nama,
                jabatan: fresh.jabatan,
                angkatan: ("angkatan" in fresh) ? (fresh.angkatan || "") : (cur.angkatan || ""),
                angkatan_id: ("angkatan_id" in fresh) ? fresh.angkatan_id : (cur.angkatan_id ?? null),
                lintas_angkatan: cur.lintas_angkatan,
                foto: fresh.foto || "",
                bio: fresh.bio || "",
                mode: "osis",
            };
            delete next.password;
            localStorage.setItem(OsisAuth.KEY, JSON.stringify(next));
            if (typeof OsisAuth.renderHeader === "function") OsisAuth.renderHeader();

            Profil.fotoPath = fresh.foto || "";
            Profil.pendingFile = null;
            Profil.fotoDihapus = false;
            Profil._revokePendingUrl();

            const elNama = document.getElementById("profilNama");
            const elBio = document.getElementById("profilBio");
            const elUser = document.getElementById("profilUsername");
            const elJab = document.getElementById("profilJabatan");
            if (elNama) elNama.value = fresh.nama || "";
            if (elBio) elBio.value = fresh.bio || "";
            if (elUser) elUser.value = fresh.username || "";
            if (elJab) elJab.value = fresh.jabatan || "-";

            Profil.syncBioCounter();
            Profil.renderFoto();
            Profil.renderHero(fresh);
            Profil.renderAkun(fresh);
        } catch (err) {
            console.error(err);
            showToast("Gagal memuat profil: " + err.message, "error");
        }
    },

    syncBioCounter() {
        const bioEl = document.getElementById("profilBio");
        const cntEl = document.getElementById("profBioCount");
        if (!bioEl || !cntEl) return;
        const n = (bioEl.value || "").length;
        cntEl.textContent = `${n} / 300`;
        cntEl.classList.toggle("full", n >= 280);
    },

    syncLiveHero() {
        Profil.syncBioCounter();
        const cur = OsisAuth.getUser() || {};
        const namaVal = (document.getElementById("profilNama")?.value || "").trim();
        const bioVal = (document.getElementById("profilBio")?.value || "").trim();
        Profil.renderHero({
            ...cur,
            nama: namaVal || cur.nama || cur.username || "OSIS",
            bio: bioVal
        });
        const ph = document.getElementById("profilPlaceholder");
        if (ph && ph.style.display !== "none") {
            ph.textContent = String(namaVal || cur.username || "O").trim().charAt(0).toUpperCase() || "O";
        }
    },

    syncPwFeedback() {
        const baru = document.getElementById("profilPwBaru")?.value || "";
        const konf = document.getElementById("profilPwKonfirm")?.value || "";
        const el = document.getElementById("profPwStatus");
        if (!el) return;
        if (!baru && !konf) {
            el.style.display = "none";
            return;
        }
        el.style.display = "";
        if (baru.length < 6) {
            el.className = "prof-pw-feedback err";
            el.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Password baru minimal 6 karakter (${baru.length}/6).`;
        } else if (konf && baru !== konf) {
            el.className = "prof-pw-feedback err";
            el.innerHTML = `<i class="fa-solid fa-xmark"></i> Konfirmasi password belum sama.`;
        } else if (konf && baru === konf) {
            el.className = "prof-pw-feedback ok";
            el.innerHTML = `<i class="fa-solid fa-check"></i> Password baru cocok &amp; siap disimpan.`;
        } else {
            el.style.display = "none";
        }
    },

    renderHero(u) {
        const user = u || OsisAuth.getUser() || {};
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        const namaEl = document.getElementById("profilHeroNama");
        const userEl = document.getElementById("profilHeroUser");
        const jabEl = document.getElementById("profilHeroJabatan");
        const bioEl = document.getElementById("profilHeroBio");
        const roleEl = document.getElementById("profilHeroRole");
        const sekEl = document.getElementById("profilHeroSekbid");
        const angEl = document.getElementById("profilHeroAngkatan");

        if (namaEl) namaEl.textContent = user.nama || user.username || "OSIS";
        if (userEl) userEl.textContent = "@" + (user.username || "-");
        if (jabEl) jabEl.textContent = user.jabatan || "Anggota OSIS";
        if (bioEl) {
            bioEl.textContent = user.bio || "Belum ada bio.";
            bioEl.style.opacity = user.bio ? "1" : "0.55";
        }
        if (roleEl) {
            if (a && a.super) {
                roleEl.style.display = "";
                roleEl.className = "osis-badge prof-badge-role super";
                roleEl.innerHTML = `<i class="fa-solid fa-crown"></i> Super Admin`;
            } else {
                roleEl.style.display = "none";
            }
        }
        if (sekEl) {
            const sek = a && a.sekbid_nama ? String(a.sekbid_nama).trim() : "";
            sekEl.style.display = sek ? "" : "none";
            if (sek) sekEl.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${escapeHtml(sek)}`;
        }
        if (angEl) {
            const ang = user.angkatan || (a && a.angkatan) || "";
            angEl.style.display = ang ? "" : "none";
            if (ang) angEl.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(ang)}`;
        }
    },

    // Panel "Akun & Hak Akses": email login, sekbid, angkatan, + daftar hak kelola.
    renderAkun(u) {
        const user = u || OsisAuth.getUser() || {};
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;

        const em = document.getElementById("akunEmail");
        if (em) em.value = user.auth_email || "-";

        const sekEl = document.getElementById("akunSekbid");
        if (sekEl) sekEl.textContent = (a && a.sekbid_nama) ? a.sekbid_nama : "-";

        const angEl = document.getElementById("akunAngkatan");
        if (angEl) {
            const ang = user.angkatan || (a && a.angkatan) || "-";
            angEl.textContent = ang + (a && a.lintas_angkatan ? " · Lintas" : "");
        }

        const rolePill = document.getElementById("akunRolePill");
        if (rolePill) {
            const isSuper = !!(a && a.super);
            rolePill.textContent = isSuper ? "Super Admin" : "Pengurus";
            rolePill.classList.toggle("super", isSuper);
        }

        const box = document.getElementById("akunHak");
        const cntEl = document.getElementById("akunHakCnt");
        if (!box) return;
        if (a && a.super) {
            if (cntEl) cntEl.textContent = "Penuh";
            box.innerHTML = `<span class="hak-chip super"><i class="fa-solid fa-crown"></i> Semua Halaman</span>`;
            return;
        }
        const list = a && Array.isArray(a.halaman) ? a.halaman : [];
        if (cntEl) cntEl.textContent = `${list.length} modul`;
        if (!list.length) {
            box.innerHTML = `<span class="hak-chip muted">Tanpa hak kelola khusus (hanya lihat)</span>`;
            return;
        }
        box.innerHTML = list.map(h => `<span class="hak-chip">${escapeHtml(h)}</span>`).join("");
    },

    renderFoto() {
        const img = document.getElementById("profilImg");
        const ph = document.getElementById("profilPlaceholder");
        const dropImg = document.getElementById("profilDropPreview");
        const dropPrompt = document.getElementById("profilDropPrompt");
        const badge = document.getElementById("profilFotoBadge");
        const hint = document.getElementById("profilFotoHint");
        if (!img) return;

        let src = "";
        if (Profil.pendingFile) src = Profil.pendingUrl || "";
        else if (!Profil.fotoDihapus && Profil.fotoPath) src = getFoto(Profil.fotoPath);

        if (src) {
            img.src = src;
            img.style.display = "block";
            if (ph) ph.style.display = "none";
            if (dropImg) { dropImg.src = src; dropImg.style.display = "block"; }
            if (dropPrompt) {
                const span = dropPrompt.querySelector("span");
                if (span) span.textContent = "Ketuk / seret untuk ganti foto";
            }
        } else {
            img.removeAttribute("src");
            img.style.display = "none";
            if (dropImg) { dropImg.removeAttribute("src"); dropImg.style.display = "none"; }
            if (dropPrompt) {
                const span = dropPrompt.querySelector("span");
                if (span) span.textContent = "Klik atau seret foto ke sini";
            }
            if (ph) {
                ph.style.display = "grid";
                const u = OsisAuth.getUser() || {};
                const namaVal = (document.getElementById("profilNama")?.value || "").trim();
                const initial = String(namaVal || u.nama || u.username || "O").trim().charAt(0).toUpperCase() || "O";
                ph.textContent = initial;
            }
        }

        if (badge) {
            if (Profil.pendingFile) {
                badge.className = "prof-status-pill warn";
                badge.textContent = "Siap diupload";
            } else if (Profil.fotoDihapus && Profil.fotoPath) {
                badge.className = "prof-status-pill del";
                badge.textContent = "Akan dihapus";
            } else if (Profil.fotoPath) {
                badge.className = "prof-status-pill ok";
                badge.textContent = "Tersimpan";
            } else {
                badge.className = "prof-status-pill";
                badge.textContent = "Kosong";
            }
        }

        if (hint) {
            if (Profil.pendingFile) {
                hint.style.display = "";
                hint.innerHTML = `<i class="fa-solid fa-circle-info"></i> Foto baru siap — klik <b>Simpan Profil</b> biar tersimpan permanen.`;
            } else if (Profil.fotoDihapus && Profil.fotoPath) {
                hint.style.display = "";
                hint.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Foto ditandai untuk dihapus — klik <b>Simpan Profil</b> untuk konfirmasi.`;
            } else {
                hint.style.display = "none";
            }
        }

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
        const __specProf = () => {
            const pf = Profil.pendingFile;
            return { modul: "profil", op: "update",
                label: "Profil: " + String(nama).slice(0, 42),
                payload: { nama, bio, fotoExist: Profil.fotoPath || "",
                    fotoDihapus: !!Profil.fotoDihapus },
                files: pf ? [{ slot: "foto", file: pf, name: pf.name, type: pf.type }] : [],
                cacheKeys: [] };
        };
        const __sesudahAntreProf = () => {
            Profil.pendingFile = null;
            Profil.fotoDihapus = false;
            Profil._revokePendingUrl();
            Profil.renderFoto();
        };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__specProf()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntreProf);
            return;
        }

        const btn = document.getElementById("btnSimpanProfil");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }

        const fotoLama = Profil.fotoPath || "";
        try {
            let fotoBaru = Profil.fotoDihapus ? "" : fotoLama;
            if (Profil.pendingFile) {
                const f = Profil.pendingFile;
                const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
                const path = `profil/profil-${Profil.userId}-${Date.now()}.${ext}`;
                await uploadFotoStorage(f, path);
                fotoBaru = path;
            }
            await updateOsisProfil(Profil.userId, nama, bio, fotoBaru);
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
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __specProf())) {
                Outbox.sesudahAntre(__sesudahAntreProf);
                return;
            }
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
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan Username'; }
        }
    },

    async simpanPassword() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const oldPw = document.getElementById("profilPwLama").value || "";
        const newPw = document.getElementById("profilPwBaru").value || "";
        const confPw = document.getElementById("profilPwKonfirm").value || "";
        if (!oldPw) { showToast("Password lama diisi dulu", "error"); return; }
        if (newPw.length < 6) { showToast("Password baru minimal 6 karakter", "error"); return; }
        if (newPw !== confPw) { showToast("Konfirmasi tidak sama", "error"); return; }

        const btn = document.getElementById("btnSimpanPassword");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
        try {
            let email = emailUntukOsis(u);
            if (!u.auth_email) {
                try {
                    const fresh = await getOsisUserById(Profil.userId);
                    if (fresh && fresh.auth_email) email = fresh.auth_email;
                } catch {}
            }
            const cek = await supa.auth.signInWithPassword({ email, password: oldPw });
            if (cek.error) {
                showToast("Password lama salah", "error");
                return;
            }
            const { error } = await supa.auth.updateUser({ password: newPw });
            if (error) throw error;
            document.getElementById("profilPwLama").value = "";
            document.getElementById("profilPwBaru").value = "";
            document.getElementById("profilPwKonfirm").value = "";
            Profil.syncPwFeedback();
            showToast("Password diganti! Login berikutnya pakai yang baru.", "success");
        } catch (err) {
            console.error(err);
            showToast("Gagal ganti password: " + String((err && err.message) || err), "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Ganti Password'; }
        }
    }
};

document.addEventListener("DOMContentLoaded", () => Profil.init());
