// =========================================================================
// LOGS — halaman khusus super_admin: pantau aktivitas semua user.
// Statistik + strip online + filter + list 100 terbaru + muat lagi.
// Baca lewat RPC aktivitas_list / tabel visitor (SWR manual, tanpa cache).
// =========================================================================

const Logs = {
    cache: [],
    limit: 100,
    offset: 0,
    habis: false,
    loading: false,
    filter: { q: "", aksi: "" },
    online: [],
    timerOnline: null,
    _fmtWib: null,

    LABEL_AKSI: {
        buka_halaman: "Buka halaman", upload_feed: "Upload feed",
        like_feed: "Like feed", komen_feed: "Komen feed",
        share_feed: "Bagikan feed", hapus_feed: "Hapus feed",
        simpan_tabungan: "Catat tabungan", cek_tabungan: "Ceklis tabungan",
        hapus_tabungan: "Hapus tabungan", simpan_keuangan: "Catat keuangan",
        hapus_keuangan: "Hapus keuangan", simpan_absensi: "Catat absensi",
        vote_polling: "Vote polling", kirim_lagu: "Request lagu",
        kirim_aspirasi: "Kirim aspirasi", simpan_dokumen: "Upload dokumen",
        login: "Login", logout: "Logout",
    },

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        try { await OsisAuth.refreshAkses(); } catch {}
        if (!OsisAuth.isSuper()) {
            document.getElementById("logsWrap").innerHTML =
                `<div class="logs-card" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-lock" style="color:var(--red)"></i></div><b>Halaman ini khusus super admin.</b></div>`;
            return;
        }
        document.getElementById("btnRefreshLogs")?.addEventListener("click", () => Logs.segarkan());
        document.getElementById("filterQ")?.addEventListener("input", () => Logs.bacaFilter());
        document.getElementById("filterAksi")?.addEventListener("change", () => Logs.bacaFilter());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Logs.resetFilter());
        document.getElementById("btnLagi")?.addEventListener("click", () => Logs.muat(false));
        await Logs.muat(true);
        Logs.muatOnline();
        try { Logs.timerOnline = setInterval(() => Logs.muatOnline(), 60000); } catch {}
    },

    async segarkan() {
        await Logs.muat(true);
        Logs.muatOnline();
    },

    // Online = detak presence < 3 menit (heartbeat jalan tiap 60 detik)
    isOnline(v) {
        try {
            const ms = Date.now() - new Date(v.last_seen).getTime();
            return ms >= 0 && ms < 3 * 60 * 1000;
        } catch { return false; }
    },

    async muatOnline() {
        try {
            const { data, error } = await supa
                .from("visitor")
                .select("device_id, name, user_key, halaman, last_seen");
            if (error) throw error;
            Logs.online = (data || [])
                .filter(r => Logs.isOnline(r))
                .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
        } catch {
            Logs.online = [];
        }
        Logs.renderOnline();
        Logs.renderStats();
    },

    async muat(awal) {
        if (Logs.loading) return;
        if (!awal && Logs.habis) return;
        Logs.loading = true;
        const wrap = document.getElementById("logsWrap");
        if (awal) {
            Logs.offset = 0;
            Logs.cache = [];
            Logs.habis = false;
            if (wrap) wrap.innerHTML = `<div class="logs-card"><div class="loading-block"><div class="spinner"></div>Memuat logs...</div></div>`;
        }
        try {
            const rows = await aktivitasList(Logs.limit, Logs.offset);
            (rows || []).forEach(r => Logs.cache.push(r));
            Logs.offset = Logs.cache.length;
            if (!rows || rows.length < Logs.limit) Logs.habis = true;
            Logs.render();
        } catch (err) {
            console.error(err);
            if (awal && wrap) wrap.innerHTML = `<div class="pesan-empty">Gagal memuat logs.<br><br><button class="btn btn-red btn-sm" onclick="Logs.muat(true)"><i class="fa-solid fa-rotate-right"></i> Coba Lagi</button></div>`;
            else showToast("Gagal muat lanjutan logs.", "error");
        } finally {
            Logs.loading = false;
        }
    },

    // Tanggal YYYY-MM-DD versi WIB
    tanggalWib(t) {
        try {
            if (!Logs._fmtWib) {
                Logs._fmtWib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
            }
            return Logs._fmtWib.format(new Date(t));
        } catch { return ""; }
    },

    dataTampil() {
        const q = Logs.filter.q.trim().toLowerCase();
        const fa = Logs.filter.aksi;
        return (Logs.cache || []).filter(a => {
            if (fa && String(a.aksi || "").toLowerCase() !== fa) return false;
            if (q) {
                const hay = [a.nama, a.aksi, a.halaman, a.detail, a.user_key]
                    .map(x => String(x || "").toLowerCase()).join(" ");
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    },

    bacaFilter() {
        Logs.filter = {
            q: document.getElementById("filterQ")?.value || "",
            aksi: document.getElementById("filterAksi")?.value || "",
        };
        Logs.render();
    },

    resetFilter() {
        const q = document.getElementById("filterQ");
        const a = document.getElementById("filterAksi");
        if (q) q.value = "";
        if (a) a.value = "";
        Logs.bacaFilter();
    },

    renderStats() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const hariIni = Logs.tanggalWib(Date.now());
        const aksiHari = (Logs.cache || []).filter(a => Logs.tanggalWib(a.created_at) === hariIni);
        const kunciUser = new Set(aksiHari.map(a => String(a.user_key || "").trim() || ("nama:" + String(a.nama || "").trim().toLowerCase()) || ("dev:" + String(a.device_id || ""))).filter(Boolean));
        set("statOnline", String(Logs.online.length));
        set("statAksiHari", String(aksiHari.length));
        set("statUserHari", String(kunciUser.size));
        set("statTotal", String((Logs.cache || []).length));
    },

    renderOnline() {
        const cnt = document.getElementById("onlineCount");
        if (cnt) cnt.textContent = String(Logs.online.length);
        const box = document.getElementById("onlineStrip");
        if (!box) return;
        if (!Logs.online.length) {
            box.innerHTML = `<span class="logs-online-empty">Tidak ada yang online.</span>`;
            return;
        }
        box.innerHTML = Logs.online.map(v => {
            const nama = escapeHtml(((v.name || "").trim()) || "Anonim");
            const hal = escapeHtml(((v.halaman || "").trim()) || "-");
            return `<span class="logs-chip"><span class="vdot on"></span> ${nama} · di <b>${hal}</b></span>`;
        }).join("");
    },

    render() {
        Logs.renderStats();
        // Opsi filter aksi dari data yang sudah dimuat
        const sel = document.getElementById("filterAksi");
        if (sel) {
            const ada = new Set((Logs.cache || []).map(a => String(a.aksi || "").toLowerCase()).filter(Boolean));
            const pilih = Logs.filter.aksi;
            sel.innerHTML = `<option value="">Semua aksi</option>` + [...ada].sort().map(k =>
                `<option value="${k}"${k === pilih ? " selected" : ""}>${escapeHtml(Logs.labelAksi(k))}</option>`
            ).join("");
        }
        const wrap = document.getElementById("logsWrap");
        if (!wrap) return;
        const rows = Logs.dataTampil();
        if (!rows.length) {
            wrap.innerHTML = (Logs.cache || []).length
                ? `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Logs.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`
                : `<div class="pesan-empty"><i class="fa-solid fa-clock-rotate-left"></i> Belum ada aktivitas tercatat.</div>`;
        } else {
            wrap.innerHTML = rows.map(a => {
                const siapa = escapeHtml(((a.nama || "").trim()) || "Anonim");
                const key = escapeHtml(((a.user_key || "").trim()) || "-");
                const di = escapeHtml(((a.halaman || "").trim()) || "-");
                const det = ((a.detail || "").trim())
                    ? `<div class="logs-det">${escapeHtml(a.detail)}</div>` : "";
                return `<div class="logs-item">
                    <div class="logs-item-head"><span class="logs-nama"><i class="fa-solid fa-user"></i> ${siapa}</span><span class="logs-waktu">${Logs.fmtWaktu(a.created_at)}</span></div>
                    <div class="logs-bar"><span class="logs-badge">${escapeHtml(Logs.labelAksi(a.aksi))}</span><span class="logs-hal">di <b>${di}</b></span><span class="logs-rel">${Logs.waktuLalu(a.created_at)}</span></div>
                    ${det}
                    <div class="logs-key">${key}</div>
                </div>`;
            }).join("");
        }
        const lagi = document.getElementById("btnLagiWrap");
        if (lagi) lagi.style.display = (!Logs.habis && (Logs.cache || []).length) ? "" : "none";
    },

    labelAksi(aksi) {
        const k = String(aksi || "").toLowerCase();
        return Logs.LABEL_AKSI[k] || (String(aksi || "Aktivitas").replace(/_/g, " "));
    },

    fmtWaktu(iso) {
        try {
            return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch { return "-"; }
    },

    waktuLalu(t) {
        try {
            const ms = Date.now() - new Date(t).getTime();
            if (ms < 0 || ms < 60000) return "baru saja";
            const mnt = Math.floor(ms / 60000);
            if (mnt < 60) return mnt + " mnt lalu";
            const jam = Math.floor(mnt / 60);
            if (jam < 24) return jam + " jam lalu";
            const hari = Math.floor(jam / 24);
            if (hari === 1) return "kemarin";
            return hari + " hari lalu";
        } catch { return "-"; }
    },
};

document.addEventListener("DOMContentLoaded", () => Logs.init());
