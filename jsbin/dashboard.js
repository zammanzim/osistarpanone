// =========================================================================
// DASHBOARD OSIS — command center (folder /osis)
// Dipakai di osis/index.html — ringkasan dari modul agenda, proker, task,
// dokumen, notulensi. Semua fetch fail-silent + empty state per section.
// Sidebar tidak disentuh.
// =========================================================================

const Dashboard = {
    sekbidMap: {},

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        document.getElementById("osisHello").textContent = `Halo, ${(u.nama || u.username || "OSIS").split(" ")[0]}! 👋`;
        document.getElementById("osisSub").textContent = "Berikut ringkasan aktivitas OSIS saat ini.";
        const meta = document.getElementById("osisMeta");
        if (meta) {
            meta.innerHTML = `
                <span class="osis-badge red"><i class="fa-solid fa-id-card"></i> ${escapeHtml(u.jabatan || "OSIS")}</span>
                <span class="osis-badge">@${escapeHtml(u.username || "-")}</span>`;
        }
        Dashboard.renderAvatar(u);
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

        const [agenda, proker, task, dokumen, notulensi, sekbid] = await Promise.all([
            (typeof getAllAgenda === "function" ? getAllAgenda() : Promise.resolve([])).catch(() => []),
            (typeof getProker === "function" ? getProker() : Promise.resolve([])).catch(() => []),
            (typeof getTask === "function" ? getTask() : Promise.resolve([])).catch(() => []),
            (typeof getDokumen === "function" ? getDokumen() : Promise.resolve([])).catch(() => []),
            (typeof getNotulensi === "function" ? getNotulensi() : Promise.resolve([])).catch(() => []),
            (typeof getSekbid === "function" ? getSekbid() : Promise.resolve([])).catch(() => [])
        ]);
        (sekbid || []).forEach(s => { Dashboard.sekbidMap[String(s.id)] = s.nama || ""; });

        Dashboard.renderStats(agenda, proker, task, notulensi);
        Dashboard.renderAgenda(agenda);
        Dashboard.renderTask(task);
        Dashboard.renderProker(proker);
        Dashboard.renderDokumen(dokumen);
        Dashboard.renderAktivitas(agenda, proker, task, dokumen, notulensi);
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

    // ============ STATS ============
    renderStats(agenda, proker, task, notulensi) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        agenda = agenda || [];
        proker = proker || [];
        task = task || [];
        notulensi = notulensi || [];

        set("statAgenda", String(agenda.length));
        const blm = agenda.filter(a => a.status === "rencana").length;
        set("statAgendaSub", blm ? blm + " masih rencana" : "semua sudah jalan");

        const aktif = proker.filter(p => p.status === "berjalan");
        set("statProker", String(aktif.length));
        set("statProkerSub", proker.length ? `dari ${proker.length} proker` : "belum ada proker");

        const terbuka = task.filter(t => (t.status || "todo") !== "done");
        set("statTask", String(terbuka.length));
        const telat = terbuka.filter(t => {
            const s = Dashboard.selisihDeadline(t.deadline);
            return s !== null && s < 0;
        }).length;
        set("statTaskSub", telat ? telat + " terlambat!" : "tidak ada yang telat");

        const terbaru = notulensi[0] || null;
        set("statRapat", terbaru ? Dashboard.fmtTanggal(terbaru.tanggal) : "—");
        set("statRapatSub", terbaru ? (terbaru.judul || "Tanpa judul") : "belum ada notulensi");
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

    // ============ TASK PERHATIAN ============
    renderTask(task) {
        const wrap = document.getElementById("taskPerhatian");
        if (!wrap) return;
        const bobot = { urgent: 0, high: 1, medium: 2, low: 3 };
        const rows = (task || [])
            .filter(t => (t.status || "todo") !== "done")
            .map(t => {
                const s = Dashboard.selisihDeadline(t.deadline);
                return { t, telat: s !== null && s < 0, sisa: s === null ? 9999 : s };
            })
            .sort((a, b) => {
                if (a.telat !== b.telat) return a.telat ? -1 : 1;
                if (a.sisa !== b.sisa) return a.sisa - b.sisa;
                return (bobot[a.t.priority] ?? 2) - (bobot[b.t.priority] ?? 2);
            })
            .slice(0, 5);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Tidak ada task terbuka. Kerja bagus!</div>`;
            return;
        }
        const prioLbl = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
        wrap.innerHTML = rows.map(({ t, telat, sisa }) => {
            const prio = t.priority || "medium";
            let dl = `<small><i class="fa-solid fa-calendar" style="color:var(--red); margin-right:3px"></i>${Dashboard.fmtTanggal(t.deadline)}</small>`;
            if (telat) dl = `<small style="color:var(--red-dark); font-weight:900">⚠ Terlambat ${Math.abs(sisa)} hari</small>`;
            else if (sisa === 0) dl = `<small style="font-weight:900">Deadline hari ini</small>`;
            else if (sisa === 1) dl = `<small style="font-weight:900">Deadline besok</small>`;
            return `<div class="dash-item">
                <div class="di"><i class="fa-solid fa-clipboard-check"></i></div>
                <div class="db"><b>${escapeHtml(t.judul || "Tanpa judul")}</b>
                    <small>${escapeHtml(t.pic || "-")}</small>${dl}</div>
                <span class="prio ${prio}">${prioLbl[prio] || prio}</span>
            </div>`;
        }).join("");
    },

    // ============ PROKER BERJALAN ============
    renderProker(proker) {
        const wrap = document.getElementById("prokerJalan");
        if (!wrap) return;
        const rows = (proker || []).filter(p => p.status === "berjalan").slice(0, 4);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Tidak ada proker yang sedang berjalan.</div>`;
            return;
        }
        wrap.innerHTML = rows.map(p => {
            const prog = Math.max(0, Math.min(100, parseInt(p.progress, 10) || 0));
            return `<div class="dash-item" style="display:block">
                <div style="display:flex; align-items:center; gap:8px">
                    <div class="db" style="flex:1"><b>${escapeHtml(p.nama || "Tanpa nama")}</b>
                        <small>${escapeHtml(p.divisi || "-")}</small></div>
                    <span class="tag red">${prog}%</span>
                </div>
                <div class="dash-bar"><span style="width:${prog}%"></span></div>
            </div>`;
        }).join("");
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
    renderAktivitas(agenda, proker, task, dokumen, notulensi) {
        const wrap = document.getElementById("aktivitasList");
        if (!wrap) return;
        const ev = [];
        (agenda || []).forEach(a => {
            if (a.created_at) ev.push({ t: a.created_at, html: `<b>Agenda baru:</b> ${escapeHtml(a.judul || "Tanpa judul")}` });
        });
        (task || []).forEach(t => {
            if ((t.status || "") === "done" && t.updated_at) {
                ev.push({ t: t.updated_at, html: `<b>Task selesai:</b> ${escapeHtml(t.judul || "Tanpa judul")}` });
            } else if (t.created_at) {
                ev.push({ t: t.created_at, html: `<b>Task baru:</b> ${escapeHtml(t.judul || "Tanpa judul")}` });
            }
        });
        (dokumen || []).forEach(d => {
            if (d.created_at) ev.push({ t: d.created_at, html: `<b>Dokumen diupload:</b> ${escapeHtml(d.nama || "Tanpa nama")}` });
        });
        (notulensi || []).forEach(n => {
            if (n.created_at) ev.push({ t: n.created_at, html: `<b>Notulensi dibuat:</b> ${escapeHtml(n.judul || "Tanpa judul")}` });
        });
        (proker || []).forEach(p => {
            if (p.created_at) ev.push({ t: p.created_at, html: `<b>Proker baru:</b> ${escapeHtml(p.nama || "Tanpa nama")}` });
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
