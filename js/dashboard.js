// =========================================================================
// DASHBOARD OSIS — command center (folder /osis)
// Dipakai di osis/index.html — ringkasan halaman yang ADA: agenda, anggota,
// keuangan, tabungan, absensi, dokumen. Semua fetch fail-silent + empty
// state per section. Sidebar tidak disentuh.
// =========================================================================

const Dashboard = {
    sekbidMap: {},

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        // Segarkan hak kendali (biar panel hak + menu selalu akurat)
        try {
            if (typeof OsisAuth.refreshAkses === "function") await OsisAuth.refreshAkses();
        } catch {}
        document.getElementById("osisHello").textContent = `Halo, ${(u.nama || u.username || "OSIS").split(" ")[0]}! 👋`;
        document.getElementById("osisSub").textContent = "Berikut ringkasan aktivitas OSIS saat ini.";
        const meta = document.getElementById("osisMeta");
        if (meta) {
            meta.innerHTML = `
                <span class="osis-badge red"><i class="fa-solid fa-id-card"></i> ${escapeHtml(u.jabatan || "OSIS")}</span>
                <span class="osis-badge">@${escapeHtml(u.username || "-")}</span>`;
        }
        Dashboard.renderAvatar(u);
        Dashboard.renderHak();
        Dashboard.tickJam();
        setInterval(() => Dashboard.tickJam(), 1000);
        // refresh foto PP terbaru (fail silent)
        if (typeof getOsisUserById === "function" && u.id) {
            getOsisUserById(u.id).then(fresh => {
                if (fresh && fresh.foto) {
                    Dashboard.renderAvatar({ ...u, foto: fresh.foto });
                    try {
                        const cur = OsisAuth.getUser() || {};
                        localStorage.setItem(OsisAuth.KEY, JSON.stringify({ ...cur, foto: fresh.foto }));
                    } catch {}
                }
            }).catch(() => {});
        }

        const [agenda, anggota, kas, tabungan, absensi, dokumen, sekbid] = await Promise.all([
            (typeof getAllAgenda === "function" ? getAllAgenda() : Promise.resolve([])).catch(() => []),
            (typeof getAnggota === "function" ? getAnggota() : Promise.resolve([])).catch(() => []),
            (typeof getKas === "function" ? getKas() : Promise.resolve([])).catch(() => []),
            (typeof getTabungan === "function" ? getTabungan() : Promise.resolve([])).catch(() => []),
            (typeof getAbsensi === "function" ? getAbsensi() : Promise.resolve([])).catch(() => []),
            (typeof getDokumen === "function" ? getDokumen() : Promise.resolve([])).catch(() => []),
            (typeof getSekbid === "function" ? getSekbid() : Promise.resolve([])).catch(() => [])
        ]);
        (sekbid || []).forEach(s => { Dashboard.sekbidMap[String(s.id)] = s.nama || ""; });

        Dashboard.renderStats(agenda, anggota, kas, tabungan);
        Dashboard.renderAgenda(agenda);
        Dashboard.renderKas(kas);
        Dashboard.renderAbsensi(absensi);
        Dashboard.renderDokumen(dokumen);
        Dashboard.renderAktivitas(agenda, kas, tabungan, absensi, dokumen);
    },

    // ============ HAK KENDALI SAYA (khusus halaman baru osis/index) ============
    // Guard element: halaman lama (osisbin) tidak punya panel ini -> skip.
    renderHak() {
        const chips = document.getElementById("hakChips");
        if (!chips) return;
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        const superUser = (typeof OsisAuth !== "undefined" && OsisAuth.isSuper) ? OsisAuth.isSuper() : false;
        const list = a && Array.isArray(a.halaman) ? a.halaman : [];
        if (superUser) {
            chips.innerHTML = `<span class="hak-chip super"><i class="fa-solid fa-crown"></i> Super Admin — semua halaman</span>`;
        } else if (!list.length) {
            chips.innerHTML = `<span class="hak-note">Belum ada hak kendali. Lihat tetap bisa, ubah perlu izin admin.</span>`;
        } else {
            chips.innerHTML = list.map(h => `<span class="hak-chip">${escapeHtml(h)}</span>`).join("");
        }
        const sekEl = document.getElementById("hakSekbid");
        if (sekEl) {
            sekEl.textContent = a && a.sekbid_nama
                ? `Sekbid kamu: ${a.sekbid_nama} (agenda terkunci ke sekbid ini)`
                : "";
        }
        const menuAkses = document.getElementById("menuAksesCard");
        if (menuAkses) menuAkses.style.display = superUser ? "" : "none";
    },

    inisial(nama) {
        const parts = String(nama || "").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "O";
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    },

    renderAvatar(u) {
        const box = document.getElementById("osisAvatar");
        if (!box) return;
        const inisial = Dashboard.inisial(u && (u.nama || u.username));
        if (u && u.foto) {
            box.innerHTML = `<img src="${getFoto(u.foto)}" alt="" onerror="this.remove()">`;
            if (!box.querySelector("img")) box.textContent = inisial;
        } else {
            box.textContent = inisial;
        }
    },

    tickJam() {
        try {
            const now = new Date();
            const tgl = document.getElementById("dashTanggal");
            const jam = document.getElementById("dashJam");
            if (tgl) {
                tgl.textContent = now.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" });
            }
            if (jam) {
                jam.textContent = now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\./g, ":");
            }
        } catch {}
    },

    hariIni() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },

    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return t; }
    },

    relatif(t) {
        if (!t) return "";
        const ms = Date.now() - new Date(t).getTime();
        if (isNaN(ms) || ms < 0) return "baru saja";
        const mnt = Math.floor(ms / 60000);
        if (mnt < 1) return "baru saja";
        if (mnt < 60) return mnt + " mnt lalu";
        const jam = Math.floor(mnt / 60);
        if (jam < 24) return jam + " jam lalu";
        const hari = Math.floor(jam / 24);
        if (hari === 1) return "kemarin";
        if (hari < 7) return hari + " hari lalu";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
        } catch { return ""; }
    },

    selisihDeadline(t) {
        if (!t) return null;
        const ms = new Date(t) - new Date(Dashboard.hariIni());
        if (isNaN(ms)) return null;
        return Math.round(ms / 86400000);
    },

    rp(n) {
        return "Rp" + (parseInt(n, 10) || 0).toLocaleString("id-ID");
    },

    // ============ STATS ============
    renderStats(agenda, anggota, kas, tabungan) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        agenda = agenda || [];
        anggota = anggota || [];
        kas = kas || [];
        tabungan = tabungan || [];

        set("statAgenda", String(agenda.length));
        const blnIni = Dashboard.hariIni().slice(0, 7);
        const agBulan = agenda.filter(a => String(a.tanggal || "").slice(0, 7) === blnIni).length;
        set("statAgendaSub", agBulan ? agBulan + " bulan ini" : "tidak ada bulan ini");

        // Anggota periode terbaru (fallback: semua)
        const thns = [...new Set(anggota.map(a => parseInt(a.tahun, 10)).filter(Number.isFinite))].sort((a, b) => b - a);
        const angAktif = thns.length ? anggota.filter(a => parseInt(a.tahun, 10) === thns[0]) : anggota;
        set("statAnggota", String(angAktif.length));
        set("statAnggotaSub", thns.length ? "periode " + thns[0] : "belum ada data");

        const masuk = kas.filter(t => t.jenis === "masuk").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
        const keluar = kas.filter(t => t.jenis === "keluar").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
        set("statKas", Dashboard.rp(masuk - keluar));
        set("statKasSub", kas.length ? kas.length + " transaksi" : "belum ada transaksi");

        const nilaiTab = (r) => {
            const n = parseInt(r.nominal, 10) || 0;
            return r.jenis === "keluar" ? -n : n;
        };
        const totalTab = tabungan.reduce((a, r) => a + nilaiTab(r), 0);
        const penabung = new Set(tabungan.map(r => String(r.nama || "").trim().toLowerCase()).filter(Boolean)).size;
        set("statTabungan", Dashboard.rp(totalTab));
        set("statTabunganSub", penabung ? penabung + " penabung" : "belum ada data");
    },

    // ============ AGENDA TERDEKAT ============
    renderAgenda(agenda) {
        const wrap = document.getElementById("agendaDekat");
        if (!wrap) return;
        const today = Dashboard.hariIni();
        const rows = (agenda || [])
            .filter(a => (a.tanggal || "") >= today)
            .sort((a, b) => String(a.tanggal || "") < String(b.tanggal || "") ? -1 : 1)
            .slice(0, 4);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada agenda terdekat.</div>`;
            return;
        }
        const stLbl = { rencana: "Rencana", proses: "Proses", selesai: "Selesai", batal: "Batal" };
        wrap.innerHTML = rows.map(a => {
            const sekbid = Dashboard.sekbidMap[String(a.sekbid_id)] || "";
            return `<div class="dash-item">
                <div class="di"><i class="fa-solid fa-calendar-days"></i></div>
                <div class="db"><b>${escapeHtml(a.judul || "Tanpa judul")}</b>
                    <small>${Dashboard.fmtTanggal(a.tanggal)}${a.lokasi ? " · " + escapeHtml(a.lokasi) : ""}${sekbid ? " · " + escapeHtml(sekbid) : ""}</small></div>
                <span class="tag ${a.status === "selesai" ? "green" : a.status === "rencana" ? "yellow" : "gray"}">${escapeHtml(stLbl[a.status] || a.status || "-")}</span>
            </div>`;
        }).join("");
    },

    // ============ KEUANGAN TERAKHIR ============
    renderKas(kas) {
        const wrap = document.getElementById("kasTerakhir");
        if (!wrap) return;
        const rows = [...(kas || [])]
            .sort((a, b) => String(b.tanggal || "") < String(a.tanggal || "") ? -1 : 1)
            .slice(0, 4);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada transaksi.</div>`;
            return;
        }
        wrap.innerHTML = rows.map(t => {
            const keluar = t.jenis === "keluar";
            return `<div class="dash-item">
                <div class="di"><i class="fa-solid ${keluar ? "fa-arrow-trend-down" : "fa-arrow-trend-up"}"></i></div>
                <div class="db"><b>${escapeHtml(t.keterangan || "Tanpa keterangan")}</b>
                    <small>${Dashboard.fmtTanggal(t.tanggal)}${t.kategori ? " · " + escapeHtml(t.kategori) : ""}</small></div>
                <span class="tag ${keluar ? "red" : "green"}">${keluar ? "−" : "+"}${Dashboard.rp(t.nominal)}</span>
            </div>`;
        }).join("");
    },

    // ============ ABSENSI TERAKHIR ============
    labelAbsen(s) {
        return s === "izin" ? "Izin" : s === "sakit" ? "Sakit" : s === "hadir" ? "Hadir" : "Alpha";
    },

    renderAbsensi(absensi) {
        const wrap = document.getElementById("absensiTerakhir");
        if (!wrap) return;
        const semua = absensi || [];
        if (!semua.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada data absensi.</div>`;
            return;
        }
        const tTerakhir = semua.map(r => String(r.tanggal || "")).filter(Boolean).sort().reverse()[0];
        const hari = semua.filter(r => String(r.tanggal) === String(tTerakhir));
        const takHadir = hari.filter(r => r.status !== "hadir")
            .sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")));
        const nHadir = hari.length - takHadir.length;
        const sub = `${takHadir.length} tidak hadir${nHadir ? ` · ${nHadir} hadir` : ""} · ${Dashboard.fmtTanggal(tTerakhir)}`;
        if (!takHadir.length) {
            wrap.innerHTML = `<div class="dash-empty">✅ ${escapeHtml(sub)} — semua hadir!</div>`;
            return;
        }
        wrap.innerHTML = `<div class="dash-empty" style="padding-bottom:2px">${escapeHtml(sub)}</div>` + takHadir.slice(0, 4).map(r => `
            <div class="dash-item">
                <div class="di"><i class="fa-solid fa-user-xmark"></i></div>
                <div class="db"><b>${escapeHtml(r.nama || "-")}</b>
                    <small>${escapeHtml(r.kegiatan || "-")}</small></div>
                <span class="tag ${r.status === "alpha" ? "red" : r.status === "sakit" ? "green" : "yellow"}">${Dashboard.labelAbsen(r.status)}</span>
            </div>`).join("")
            + (takHadir.length > 4 ? `<div class="dash-empty">+${takHadir.length - 4} lainnya…</div>` : "");
    },

    // ============ DOKUMEN TERBARU ============
    renderDokumen(dokumen) {
        const wrap = document.getElementById("dokBaru");
        if (!wrap) return;
        const rows = [...(dokumen || [])]
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
            .slice(0, 4);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada dokumen.</div>`;
            return;
        }
        const ikon = { pdf: "fa-solid fa-file-pdf", doc: "fa-solid fa-file-word", docx: "fa-solid fa-file-word", xls: "fa-solid fa-file-excel", xlsx: "fa-solid fa-file-excel", ppt: "fa-solid fa-file-powerpoint", pptx: "fa-solid fa-file-powerpoint", zip: "fa-solid fa-file-zipper" };
        wrap.innerHTML = rows.map(d => {
            const ext = String(d.file_type || "").toLowerCase();
            return `<div class="dash-item">
                <div class="di"><i class="${ikon[ext] || "fa-solid fa-file"}"></i></div>
                <div class="db"><b>${escapeHtml(d.nama || "Tanpa nama")}</b>
                    <small>${ext.toUpperCase() || "FILE"} · ${Dashboard.fmtTanggal((d.created_at || "").slice(0, 10))} · ${escapeHtml(d.pengunggah || "-")}</small></div>
            </div>`;
        }).join("");
    },

    // ============ AKTIVITAS ============
    renderAktivitas(agenda, kas, tabungan, absensi, dokumen) {
        const wrap = document.getElementById("aktivitasList");
        if (!wrap) return;
        const ev = [];
        const kapan = (r) => r.created_at || r.updated_at || r.tanggal || null;
        (agenda || []).forEach(a => {
            if (a.created_at) ev.push({ t: a.created_at, html: `<b>Agenda baru:</b> ${escapeHtml(a.judul || "Tanpa judul")}` });
        });
        (dokumen || []).forEach(d => {
            if (d.created_at) ev.push({ t: d.created_at, html: `<b>Dokumen diupload:</b> ${escapeHtml(d.nama || "Tanpa nama")}` });
        });
        (kas || []).forEach(t => {
            const k = kapan(t);
            if (k) ev.push({ t: k, html: `<b>Kas ${t.jenis === "keluar" ? "keluar" : "masuk"}:</b> ${escapeHtml(t.keterangan || "Tanpa keterangan")} (${(t.jenis === "keluar" ? "−" : "+")}${Dashboard.rp(t.nominal)})` });
        });
        (tabungan || []).forEach(r => {
            const k = kapan(r);
            if (k) ev.push({ t: k, html: `<b>Tabungan ${r.jenis === "keluar" ? "diambil" : ""}:</b> ${escapeHtml(r.nama || "-")} (${r.jenis === "keluar" ? "−" : "+"}${Dashboard.rp(r.nominal)})` });
        });
        (absensi || []).forEach(r => {
            if (r.tanggal && r.status !== "hadir") ev.push({ t: r.tanggal, html: `<b>Absensi:</b> ${escapeHtml(r.nama || "-")} (${Dashboard.labelAbsen(r.status)})` });
        });
        ev.sort((a, b) => new Date(b.t) - new Date(a.t));
        const rows = ev.slice(0, 8);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada aktivitas tercatat.</div>`;
            return;
        }
        wrap.innerHTML = rows.map(e => `
            <div class="tl-item"><span class="tl-dot"></span><div class="tb">${e.html}</div><time>${Dashboard.relatif(e.t)}</time></div>`).join("");
    }
};

document.addEventListener("DOMContentLoaded", () => Dashboard.init());
