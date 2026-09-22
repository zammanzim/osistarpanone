// =========================================================================
// POLLING WAKETOS - vote 1x (wajib login guest/OSIS) + hasil live
// Halaman standalone: polling.html. Kelola kandidat butuh hak "polling".
// Vote wajib online (tidak masuk Outbox) biar tidak dobel.
// =========================================================================

const Polling = {
    kandidat: [],
    hasil: { perKandidat: {}, total: 0 },
    saya: null,
    status: "BUKA",
    judul: "Polling Wakil Ketua OSIS",
    editingId: null,
    pendingFile: null,
    fotoLama: "",
    timer: null,

    async init() {
        // Login dari halaman ini harus balik ke polling, bukan ke index.
        try {
            if (typeof OsisAuth !== "undefined") {
                OsisAuth.simpanBack = function () {
                    try { sessionStorage.setItem("osis_login_back", "polling"); } catch (e) {}
                };
                OsisAuth.renderHeader();
            }
        } catch (e) {}
        Polling.bind();
        try {
            if (typeof OsisAuth.refreshAkses === "function") await OsisAuth.refreshAkses();
        } catch (e) {}
        await Polling.muatSemua();
        Polling.mulaiTimer();
        try {
            document.addEventListener("visibilitychange", () => Polling.onVisibility());
        } catch (e) {}
    },

    bind() {
        const link = document.getElementById("polKeLoginOsis");
        if (link && !link._bound) {
            link._bound = true;
            link.addEventListener("click", () => {
                try { sessionStorage.setItem("osis_login_back", "polling"); } catch (e) {}
            });
        }
        const fi = document.getElementById("polFileInput");
        if (fi && !fi._bound) {
            fi._bound = true;
            fi.addEventListener("change", () => Polling.fotoDipilih(fi));
        }
    },

    bisaKelola() {
        try { return !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("polling")); }
        catch (e) { return false; }
    },

    // Refresh 20 detik, tapi hanya saat tab terlihat. Saat tab hidden,
    // timer dimatikan total (bukan sekadar skip) biar tidak ada request
    // nyangkut; pas tab dibuka lagi langsung refresh + timer jalan lagi.
    mulaiTimer() {
        try {
            if (Polling.timer) clearInterval(Polling.timer);
            Polling.timer = setInterval(() => {
                if (!document.hidden) Polling.muatHasil().catch(() => {});
            }, 20000);
        } catch (e) {}
    },

    onVisibility() {
        try {
            if (document.hidden) {
                if (Polling.timer) { clearInterval(Polling.timer); Polling.timer = null; }
            } else {
                Polling.mulaiTimer();
                Polling.muatHasil().catch(() => {});
            }
        } catch (e) {}
    },

    // ============ MUAT ============
    async muatSemua() {
        Polling.renderGate();
        const cached = (typeof Cache !== "undefined" && Cache.get("polling_kandidat")) || null;
        if (cached && cached.length) {
            Polling.kandidat = cached;
            Polling.render();
        }
        try {
            const [list, hasil, saya, status, judul] = await Promise.all([
                getPollingKandidat().catch(() => cached || []),
                getPollingHasil().catch(() => null),
                getPollingSuaraSaya().catch(() => null),
                cekStatusPolling().catch(() => "BUKA"),
                getPollingJudul().catch(() => "Polling Wakil Ketua OSIS"),
            ]);
            Polling.kandidat = list || [];
            try { Cache.set("polling_kandidat", Polling.kandidat); } catch (e) {}
            if (hasil) {
                Polling.hasil = hasil;
                try { Cache.set("polling_hasil", hasil); } catch (e) {}
            } else {
                const ch = (typeof Cache !== "undefined" && Cache.get("polling_hasil")) || null;
                if (ch) Polling.hasil = ch;
            }
            Polling.saya = saya;
            Polling.status = status || "BUKA";
            if (judul) Polling.judul = judul;
        } catch (err) {
            console.error(err);
        }
        Polling.render();
    },

    async muatHasil(manual) {
        try {
            const [hasil, saya, status] = await Promise.all([
                getPollingHasil(),
                getPollingSuaraSaya().catch(() => Polling.saya),
                cekStatusPolling().catch(() => Polling.status),
            ]);
            Polling.hasil = hasil;
            Polling.saya = saya;
            Polling.status = status || "BUKA";
            try { Cache.set("polling_hasil", hasil); } catch (e) {}
            Polling.render();
            if (manual) showToast("Hasil diperbarui.", "success");
        } catch (err) {
            console.error(err);
            if (manual) showToast("Gagal muat hasil. Cek koneksi.", "error");
        }
    },

    async muatKandidat() {
        try {
            Polling.kandidat = await getPollingKandidat();
            try { Cache.set("polling_kandidat", Polling.kandidat); } catch (e) {}
        } catch (err) {
            console.error(err);
        }
        Polling.render();
    },

    // ============ RENDER ============
    render() {
        document.getElementById("polJudul").textContent = Polling.judul;
        document.title = Polling.judul + " - OSIS TARPAN ONE";
        const tutup = Polling.status === "TUTUP";
        const badge = document.getElementById("polStatusBadge");
        if (badge) {
            badge.textContent = tutup ? "Ditutup" : "Dibuka";
            badge.style.background = tutup ? "#ffe1e4" : "#d6f5d6";
            badge.style.color = tutup ? "#a31220" : "#146314";
        }
        const banner = document.getElementById("polClosedBanner");
        if (banner) banner.style.display = tutup ? "" : "none";
        document.getElementById("polTotal").textContent = Polling.hasil.total || 0;
        document.getElementById("polCount").textContent = (Polling.kandidat || []).length;
        const chip = document.getElementById("polSayaChip");
        if (chip) chip.style.display = Polling.saya != null ? "" : "none";
        Polling.renderGate();
        Polling.renderGrid();
        Polling.renderHasil();
        Polling.renderAdmin();
    },

    renderGate() {
        const body = document.getElementById("polGateBody");
        const title = document.getElementById("polGateTitle");
        if (!body) return;
        let u = null;
        try { u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null; }
        catch (e) { u = null; }
        if (!u) {
            if (title) title.textContent = "Masuk dulu untuk vote";
            body.innerHTML =
                "<label class=\"lbl\">Nama Panggilan</label>" +
                "<div class=\"pol-gate-row\">" +
                "<input id=\"polNickname\" class=\"admin-input\" maxlength=\"30\" placeholder=\"Nama kamu\" autocomplete=\"off\">" +
                "<button class=\"btn btn-red\" onclick=\"Polling.masukGuest()\"><i class=\"fa-solid fa-arrow-right\"></i> Masuk & Vote</button>" +
                "</div>" +
                "<a class=\"login-back login-center\" id=\"polKeLoginOsis\" href=\"login\"><i class=\"fa-solid fa-id-card\"></i> Masuk sebagai OSIS</a>";
            const nick = document.getElementById("polNickname");
            if (nick) nick.addEventListener("keydown", (e) => { if (e.key === "Enter") Polling.masukGuest(); });
            Polling.bind();
            return;
        }
        const nama = escapeHtml(OsisAuth.displayName(u) || "-");
        const peran = OsisAuth.isGuest(u) ? "Tamu" : escapeHtml(u.jabatan || "Anggota OSIS");
        if (title) title.textContent = "Kamu sudah masuk";
        body.innerHTML =
            "<div class=\"pol-login-info\"><i class=\"fa-solid fa-circle-check\" style=\"color:#146314\"></i>" +
            "<span>Vote sebagai <b>" + nama + "</b> (" + peran + ")</span>" +
            "<button class=\"btn btn-white btn-sm\" onclick=\"Polling.keluar()\"><i class=\"fa-solid fa-arrow-right-from-bracket\"></i> Keluar</button></div>";
    },

    suaraKandidat(id) {
        return Number((Polling.hasil.perKandidat || {})[String(id)] || 0);
    },

    renderGrid() {
        const grid = document.getElementById("polGrid");
        if (!grid) return;
        const list = Polling.kandidat || [];
        if (!list.length) {
            grid.innerHTML = "<div class=\"pol-card\"><div class=\"pesan-empty\"><i class=\"fa-solid fa-users\"></i> Belum ada kandidat. " +
                (Polling.bisaKelola() ? "Tambahkan kandidat pertama di panel kelola bawah." : "Tunggu info dari pengurus OSIS.") + "</div></div>";
            return;
        }
        let u = null;
        try { u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null; } catch (e) {}
        const tutup = Polling.status === "TUTUP";
        const total = Polling.hasil.total || 0;
        grid.innerHTML = list.map((k) => {
            const jml = Polling.suaraKandidat(k.id);
            const pct = total > 0 ? Math.round((jml / total) * 100) : 0;
            const mine = Polling.saya != null && String(Polling.saya) === String(k.id);
            const foto = k.foto
                ? "<img class=\"pol-foto\" src=\"" + escapeHtml(getFoto(k.foto)) + "\" alt=\"Foto " + escapeHtml(k.nama || "") + "\" loading=\"lazy\">"
                : "<div class=\"pol-foto-ph\">" + escapeHtml(String(k.nomor || "?")) + "</div>";
            const visi = (k.visi || k.misi)
                ? "<details class=\"pol-visi\"><summary><i class=\"fa-solid fa-bullseye\"></i> Visi & Misi</summary><div style=\"margin-top:6px\"><b>Visi:</b><br>" + escapeHtml(k.visi || "-") + "<br><br><b>Misi:</b><br>" + escapeHtml(k.misi || "-") + "</div></details>"
                : "";
            let tombol;
            if (!u) tombol = "<button class=\"btn btn-white\" onclick=\"Polling.perluLogin()\"><i class=\"fa-solid fa-lock\"></i> Masuk untuk vote</button>";
            else if (tutup) tombol = "<button class=\"btn btn-white\" disabled><i class=\"fa-solid fa-lock\"></i> Ditutup</button>";
            else if (mine) tombol = "<button class=\"btn btn-white\" disabled><i class=\"fa-solid fa-check\"></i> Pilihanmu</button>";
            else if (Polling.saya != null) tombol = "<button class=\"btn btn-red\" onclick=\"Polling.vote(" + k.id + ")\"><i class=\"fa-solid fa-repeat\"></i> Pindah ke sini</button>";
            else tombol = "<button class=\"btn btn-red\" onclick=\"Polling.vote(" + k.id + ")\"><i class=\"fa-solid fa-check-to-slot\"></i> Vote</button>";
            return "<article class=\"pol-kartu" + (mine ? " pilihan" : "") + "\">" +
                "<span class=\"pol-nomor\">" + escapeHtml(String(k.nomor || "?")) + "</span>" + foto +
                "<div class=\"pol-body\">" +
                (mine ? "<span class=\"pol-badge-pilih\"><i class=\"fa-solid fa-check\"></i> Pilihanmu</span>" : "") +
                "<div class=\"pol-nama\">" + escapeHtml(k.nama || "Tanpa Nama") + "</div>" +
                (k.kelas ? "<div class=\"pol-kelas\"><i class=\"fa-solid fa-graduation-cap\"></i> " + escapeHtml(k.kelas) + "</div>" : "") +
                visi +
                "<div class=\"pol-bar\"><span style=\"width:" + pct + "%\"></span></div>" +
                "<div class=\"pol-vote-row\">" + tombol + "<span class=\"pol-suara\">" + jml + " suara (" + pct + "%)</span></div>" +
                "</div></article>";
        }).join("");
    },

    renderHasil() {
        const box = document.getElementById("polHasil");
        if (!box) return;
        const list = (Polling.kandidat || []).slice().sort((a, b) => Polling.suaraKandidat(b.id) - Polling.suaraKandidat(a.id));
        const total = Polling.hasil.total || 0;
        if (!list.length) {
            box.innerHTML = "<div class=\"pesan-empty\"><i class=\"fa-solid fa-chart-simple\"></i> Belum ada kandidat.</div>";
            return;
        }
        box.innerHTML = list.map((k) => {
            const jml = Polling.suaraKandidat(k.id);
            const pct = total > 0 ? Math.round((jml / total) * 100) : 0;
            const mine = Polling.saya != null && String(Polling.saya) === String(k.id);
            return "<div class=\"pol-hasil-row\">" +
                "<div class=\"pol-hasil-top\"><span>" + escapeHtml(String(k.nomor || "?")) + ". " + escapeHtml(k.nama || "-") + (mine ? " <i class=\"fa-solid fa-check\" style=\"color:var(--red)\"></i>" : "") + "</span>" +
                "<span class=\"pct\">" + pct + "% &middot; " + jml + "</span></div>" +
                "<div class=\"pol-bar\"><span style=\"width:" + pct + "%\"></span></div></div>";
        }).join("") + (total > 0 ? "" : "<div class=\"pesan-empty\"><i class=\"fa-solid fa-inbox\"></i> Belum ada suara masuk.</div>");
    },

    renderAdmin() {
        const panel = document.getElementById("polAdmin");
        if (!panel) return;
        const boleh = Polling.bisaKelola();
        panel.style.display = boleh ? "" : "none";
        if (!boleh) return;
        const tutup = Polling.status === "TUTUP";
        const bBuka = document.getElementById("polBtnBuka");
        const bTutup = document.getElementById("polBtnTutup");
        if (bBuka) bBuka.className = tutup ? "" : "on buka";
        if (bTutup) bTutup.className = tutup ? "on tutup" : "";
        const kelola = document.getElementById("polKelola");
        const list = Polling.kandidat || [];
        if (kelola) {
            kelola.innerHTML = list.length ? list.map((k) => {
                const img = k.foto ? "<img src=\"" + escapeHtml(getFoto(k.foto)) + "\" alt=\"\">" : "";
                return "<div class=\"pol-kelola-item\">" + img +
                    "<span class=\"nm\">" + escapeHtml(String(k.nomor || "?")) + ". " + escapeHtml(k.nama || "-") + " &middot; " + Polling.suaraKandidat(k.id) + " suara</span>" +
                    "<button onclick=\"Polling.editKandidat(" + k.id + ")\"><i class=\"fa-solid fa-pen\"></i></button>" +
                    "<button onclick=\"Polling.hapusKandidat(" + k.id + ")\"><i class=\"fa-solid fa-trash-can\"></i></button></div>";
            }).join("") : "<div class=\"pesan-empty\">Belum ada kandidat.</div>";
        }
        const btnSimpan = document.getElementById("polBtnSimpan");
        if (btnSimpan) btnSimpan.innerHTML = Polling.editingId
            ? "<i class=\"fa-solid fa-floppy-disk\"></i> Simpan perubahan"
            : "<i class=\"fa-solid fa-plus\"></i> Simpan kandidat";
        const btnBatal = document.getElementById("polBtnBatal");
        if (btnBatal) btnBatal.style.display = Polling.editingId ? "" : "none";
    },

    // ============ AUTH GATE ============
    masukGuest() {
        const el = document.getElementById("polNickname");
        const nick = ((el && el.value) || "").trim();
        if (!nick) {
            showToast("Nama panggilan diisi dulu yaa.", "error");
            if (el) el.focus();
            return;
        }
        try { OsisAuth.loginGuest(nick); } catch (e) { showToast("Gagal masuk. Coba lagi.", "error"); return; }
        try { OsisAuth.renderHeader(); } catch (e) {}
        Polling.render();
        Polling.muatHasil().catch(() => {});
        showToast("Masuk sebagai " + nick + ". Silakan vote!", "success");
    },

    perluLogin() {
        showToast("Masuk dulu yaa sebelum vote.", "error");
        const nick = document.getElementById("polNickname");
        if (nick) {
            nick.focus();
            nick.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    },

    async keluar() {
        let yakin = true;
        try { yakin = await showPopup("Keluar? Suaramu yang sudah masuk tetap tercatat.", "confirm"); }
        catch (e) { yakin = true; }
        if (!yakin) return;
        try { OsisAuth.logout(); OsisAuth.renderHeader(); } catch (e) {}
        Polling.saya = null;
        Polling.render();
        Polling.muatHasil().catch(() => {});
    },

    // ============ VOTE ============
    async vote(id) {
        let u = null;
        try { u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null; } catch (e) {}
        if (!u) { Polling.perluLogin(); return; }
        if (Polling.status === "TUTUP") {
            showToast("Polling sedang ditutup.", "error");
            return;
        }
        if (Polling.saya != null && String(Polling.saya) === String(id)) {
            showToast("Ini sudah pilihanmu.", "info");
            return;
        }
        const k = (Polling.kandidat || []).find((x) => String(x.id) === String(id));
        const nama = (k && k.nama) || "kandidat ini";
        const ganti = Polling.saya != null;
        let yakin = true;
        try { yakin = await showPopup((ganti ? "Pindah pilihan ke " : "Vote untuk ") + nama + "?", "confirm"); }
        catch (e) { yakin = true; }
        if (!yakin) return;
        try {
            const r = await votePolling(id);
            Polling.saya = id;
            showToast(r === "OK_GANTI" ? "Pilihanmu dipindah. Makasih!" : "Suaramu tercatat. Makasih!", "success");
            Polling.muatHasil().catch(() => {});
        } catch (err) {
            Polling.petaError(err);
        }
    },

    petaError(err) {
        const m = String((err && err.message) || err || "");
        if (m === "ERR_NO_LOGIN") showToast("Masuk dulu yaa sebelum vote.", "error");
        else if (m === "ERR_CLOSED") {
            showToast("Polling sudah ditutup.", "error");
            Polling.status = "TUTUP";
            Polling.render();
        }
        else if (m === "ERR_VOTED") showPopup("Nickname ini sudah dipakai vote di perangkat lain. Pakai nickname lain.", "error");
        else if (m === "ERR_NOT_FOUND") showToast("Kandidat tidak ditemukan.", "error");
        else showToast("Gagal vote. Cek koneksi lalu coba lagi.", "error");
    },

    // ============ ADMIN: STATUS + RESET ============
    async setStatus(s) {
        if (!Polling.bisaKelola()) return;
        let u = null;
        try { u = OsisAuth.getUser(); } catch (e) {}
        if (!u || !u.id) { showToast("Sesi OSIS tidak valid.", "error"); return; }
        try {
            await setPollingStatus(u.id, s);
            Polling.status = s;
            Polling.render();
            showToast(s === "TUTUP" ? "Polling ditutup." : "Polling dibuka.", "success");
        } catch (err) {
            console.error(err);
            showToast("Gagal ubah status.", "error");
        }
    },

    async reset() {
        if (!Polling.bisaKelola()) return;
        let yakin = false;
        try { yakin = await showPopup("Reset menghapus SEMUA suara (mulai ronde baru). Kandidat tidak ikut terhapus. Lanjut?", "confirm"); }
        catch (e) { yakin = false; }
        if (!yakin) return;
        let u = null;
        try { u = OsisAuth.getUser(); } catch (e) {}
        try {
            await resetPollingSuara(u.id);
            Polling.saya = null;
            showToast("Semua suara dihapus.", "success");
            Polling.muatHasil().catch(() => {});
        } catch (err) {
            console.error(err);
            showToast("Gagal reset suara.", "error");
        }
    },

    // ============ ADMIN: FORM KANDIDAT ============
    formBaru() {
        Polling.editingId = null;
        Polling.pendingFile = null;
        Polling.fotoLama = "";
        ["polNomor", "polNama", "polKelas", "polVisi", "polMisi"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = id === "polNomor" ? "1" : "";
        });
        const order = document.getElementById("polOrder");
        if (order) order.value = "99";
        const prev = document.getElementById("polFotoPrev");
        if (prev) { prev.style.display = "none"; prev.removeAttribute("src"); }
        const fi = document.getElementById("polFileInput");
        if (fi) fi.value = "";
        Polling.renderAdmin();
    },

    editKandidat(id) {
        const k = (Polling.kandidat || []).find((x) => String(x.id) === String(id));
        if (!k) { showToast("Kandidat tidak ketemu.", "error"); return; }
        Polling.editingId = id;
        Polling.pendingFile = null;
        Polling.fotoLama = k.foto || "";
        const isi = (eid, val) => { const el = document.getElementById(eid); if (el) el.value = val; };
        isi("polNomor", k.nomor ?? 1);
        isi("polOrder", k.display_order ?? 99);
        isi("polNama", k.nama || "");
        isi("polKelas", k.kelas || "");
        isi("polVisi", k.visi || "");
        isi("polMisi", k.misi || "");
        const prev = document.getElementById("polFotoPrev");
        if (prev) {
            if (k.foto) { prev.src = getFoto(k.foto); prev.style.display = ""; }
            else { prev.style.display = "none"; prev.removeAttribute("src"); }
        }
        Polling.renderAdmin();
        const kartu = document.getElementById("polAdmin");
        if (kartu && kartu.scrollIntoView) kartu.scrollIntoView({ behavior: "smooth", block: "start" });
    },

    fotoDipilih(input) {
        const f = (input.files && input.files[0]) || null;
        if (!f) return;
        Polling.pendingFile = f;
        const prev = document.getElementById("polFotoPrev");
        if (prev) {
            try { prev.src = URL.createObjectURL(f); } catch (e) {}
            prev.style.display = "";
        }
    },

    bacaForm() {
        const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
        return {
            nomor: parseInt(val("polNomor"), 10) || 1,
            order: parseInt(val("polOrder"), 10) || 99,
            nama: val("polNama"),
            kelas: val("polKelas"),
            visi: val("polVisi"),
            misi: val("polMisi"),
            foto: Polling.fotoLama || "",
        };
    },

    async simpanKandidat() {
        if (!Polling.bisaKelola()) return;
        let u = null;
        try { u = OsisAuth.getUser(); } catch (e) {}
        if (!u || !u.id) { showToast("Sesi OSIS tidak valid.", "error"); return; }
        const f = Polling.bacaForm();
        if (!f.nama) { showToast("Nama kandidat diisi dulu yaa.", "error"); return; }
        const btn = document.getElementById("polBtnSimpan");
        if (btn) btn.disabled = true;
        try {
            if (Polling.pendingFile) {
                const path = "polling/" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8) + ".jpg";
                await uploadFotoStorage(Polling.pendingFile, path);
                if (Polling.fotoLama && Polling.fotoLama !== path && Polling.fotoLama.indexOf("polling/") === 0) {
                    try { await hapusFotoStorage(Polling.fotoLama); } catch (e) {}
                }
                f.foto = path;
            }
            if (Polling.editingId) await ubahPollingKandidat(u.id, Polling.editingId, f);
            else await tambahPollingKandidat(u.id, f);
            showToast("Kandidat tersimpan.", "success");
            Polling.formBaru();
            Polling.muatKandidat().catch(() => {});
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan kandidat. Cek koneksi.", "error");
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async hapusKandidat(id) {
        if (!Polling.bisaKelola()) return;
        const k = (Polling.kandidat || []).find((x) => String(x.id) === String(id));
        let yakin = false;
        try { yakin = await showPopup("Hapus " + ((k && k.nama) || "kandidat ini") + " beserta suaranya?", "confirm"); }
        catch (e) { yakin = false; }
        if (!yakin) return;
        let u = null;
        try { u = OsisAuth.getUser(); } catch (e) {}
        try {
            await hapusPollingKandidat(u.id, id);
            if (k && k.foto && k.foto.indexOf("polling/") === 0) {
                try { await hapusFotoStorage(k.foto); } catch (e) {}
            }
            if (String(Polling.editingId) === String(id)) Polling.formBaru();
            showToast("Kandidat dihapus.", "success");
            Polling.muatKandidat().catch(() => {});
            Polling.muatHasil().catch(() => {});
        } catch (err) {
            console.error(err);
            showToast("Gagal hapus kandidat.", "error");
        }
    },
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Polling.init());
} else {
    Polling.init();
}
