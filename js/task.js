// =========================================================================
// TASK — halaman khusus OSIS (folder /osis)
// Dipakai di osis/task.html — kanban todo/in_progress/review/done.
// Pindah status via panah kartu & detail (RPC pindah_task). Deadline
// terlambat dihitung client. Link proker/agenda read-only dari tabelnya.
// Visual ikut design system Agenda.
// =========================================================================

const Task = {
    cache: [],
    prokerCache: [],
    agendaCache: [],
    filter: { q: "", pic: "", divisi: "", priority: "", status: "", proker: "", sort: "deadline" },
    editingId: null,
    detailId: null,

    KOLOM: [
        ["todo", "colTodo", "countTodo"],
        ["in_progress", "colProg", "countProg"],
        ["review", "colReview", "countReview"],
        ["done", "colDone", "countDone"]
    ],
    PRIO_LABEL: { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" },
    PRIO_BOBOT: { urgent: 0, high: 1, medium: 2, low: 3 },
    STATUS_LABEL: { todo: "Todo", in_progress: "In Progress", review: "Review", done: "Done" },

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }

        // opsi divisi: BPH + Umum + sekbid (fail silent)
        try {
            const list = await getSekbid();
            const names = [...new Set((list || []).map(s => s.nama).filter(Boolean))];
            const opts = ["BPH", "Umum", ...names].map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
            const dd = document.getElementById("taskDivisi");
            if (dd) dd.innerHTML = `<option value="">— Pilih —</option>` + opts;
            const fd = document.getElementById("filterDivisi");
            if (fd) fd.innerHTML = `<option value="">Semua</option>` + opts;
        } catch {}

        document.getElementById("btnTambahTask")?.addEventListener("click", () => Task.bukaForm());
        document.getElementById("btnBatalTask")?.addEventListener("click", () => Task.tutupForm());
        document.getElementById("btnSimpanTask")?.addEventListener("click", () => Task.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Task.resetFilter());
        document.getElementById("btnEditDariDetail")?.addEventListener("click", () => {
            const id = Task.detailId;
            Task.tutupDetail();
            if (id) Task.edit(id);
        });
        document.getElementById("btnSelesaiDariDetail")?.addEventListener("click", () => Task.tandaiSelesai());
        document.getElementById("btnHapusDariDetail")?.addEventListener("click", () => {
            const id = Task.detailId;
            if (id) Task.hapus(id, true);
        });

        ["filterQ", "filterPic", "filterDivisi", "filterPriority", "filterStatus", "filterProker", "filterSort"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Task.bacaFilter());
        });

        document.getElementById("kanban")?.addEventListener("click", (e) => {
            const mv = e.target.closest("[data-move]");
            if (mv) {
                e.stopPropagation();
                Task.pindah(mv.dataset.move, mv.dataset.ke);
                return;
            }
            const card = e.target.closest("[data-task-card]");
            if (card) Task.detail(card.dataset.taskCard);
        });

        ["taskForm", "taskDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "taskForm") Task.tutupForm();
                    else Task.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("taskForm")?.classList.contains("open")) Task.tutupForm();
            if (document.getElementById("taskDetail")?.classList.contains("open")) Task.tutupDetail();
        });

        await Task.muat();
    },

    // ============ HELPERS ============
    hariIni() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },

    // null kalau tidak terlambat; 0 = hari ini; >0 = jumlah hari telat; <0 = sisa hari
    selisihDeadline(t) {
        if (!t) return null;
        const a = new Date(Task.hariIni());
        const b = new Date(t);
        if (isNaN(b)) return null;
        return Math.round((a - b) / 86400000);
    },

    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        } catch { return t; }
    },

    fmtTanggalWaktu(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch { return "-"; }
    },

    prokerName(id) {
        if (!id) return "";
        const p = (Task.prokerCache || []).find(x => String(x.id) === String(id));
        return p ? p.nama : `#${id} (dihapus)`;
    },

    agendaName(id) {
        if (!id) return "";
        const a = (Task.agendaCache || []).find(x => String(x.id) === String(id));
        return a ? a.judul : `#${id} (dihapus)`;
    },

    // ============ DATA ============
    async muat() {
        try {
            const cached = Cache.get("task");
            const [pk, ag] = await Promise.all([getProker().catch(() => []), getAllAgenda().catch(() => [])]);
            Task.prokerCache = pk || [];
            Task.agendaCache = ag || [];
            Task.buildFilterOptions();
            if (cached) {
                Task.cache = cached;
                Task.render();
                getTask().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("task", fresh);
                        Task.cache = fresh || [];
                        Task.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getTask();
            Cache.set("task", data);
            Task.cache = data || [];
            Task.render();
        } catch (err) {
            console.error(err);
            showToast("Gagal memuat task: " + err.message, "error");
        }
    },

    buildFilterOptions() {
        const pics = [...new Set((Task.cache || []).map(t => (t.pic || "").trim()).filter(Boolean))].sort();
        const fp = document.getElementById("filterPic");
        if (fp) {
            const cur = fp.value || Task.filter.pic || "";
            fp.innerHTML = `<option value="">Semua</option>` + pics.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
            fp.value = cur;
            Task.filter.pic = cur;
        }
        const fpr = document.getElementById("filterProker");
        if (fpr) {
            const cur = fpr.value || Task.filter.proker || "";
            fpr.innerHTML = `<option value="">Semua</option>` + (Task.prokerCache || []).map(p => `<option value="${p.id}">${escapeHtml(p.nama || "Tanpa nama")}</option>`).join("");
            fpr.value = cur;
            Task.filter.proker = cur;
        }
        const tp = document.getElementById("taskProker");
        if (tp) {
            tp.innerHTML = `<option value="">— Tidak ada —</option>` + (Task.prokerCache || []).map(p => `<option value="${p.id}">${escapeHtml(p.nama || "Tanpa nama")}</option>`).join("");
        }
        const ta = document.getElementById("taskAgenda");
        if (ta) {
            const list = [...(Task.agendaCache || [])].sort((a, b) => String(b.tanggal || "") < String(a.tanggal || "") ? -1 : 1);
            ta.innerHTML = `<option value="">— Tidak ada —</option>` + list.map(a => {
                const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "";
                return `<option value="${a.id}">${escapeHtml(a.judul || "Tanpa judul")}${tgl ? " · " + tgl : ""}</option>`;
            }).join("");
        }
    },

    dataTampil() {
        const all = Task.cache || [];
        const f = Task.filter;
        const q = f.q.trim().toLowerCase();
        let data = all.filter(t => {
            if (q && !(`${t.judul || ""} ${t.deskripsi || ""}`.toLowerCase().includes(q))) return false;
            if (f.pic && (t.pic || "") !== f.pic) return false;
            if (f.divisi && (t.divisi || "") !== f.divisi) return false;
            if (f.priority && (t.priority || "") !== f.priority) return false;
            if (f.status && (t.status || "") !== f.status) return false;
            if (f.proker && String(t.proker_id || "") !== String(f.proker)) return false;
            return true;
        });
        if (f.sort === "baru") data = [...data].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        else if (f.sort === "prioritas") data = [...data].sort((a, b) => (Task.PRIO_BOBOT[a.priority] ?? 2) - (Task.PRIO_BOBOT[b.priority] ?? 2));
        else data = [...data].sort((a, b) => String(a.deadline || "9999") < String(b.deadline || "9999") ? -1 : 1);
        return data;
    },

    // ============ RENDER ============
    render() {
        const all = Task.cache || [];
        const telat = (t) => {
            const s = Task.selisihDeadline(t.deadline);
            return s !== null && s > 0 && t.status !== "done";
        };
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("statTotal", String(all.length));
        set("statTodo", String(all.filter(t => t.status === "todo").length));
        set("statJalan", String(all.filter(t => t.status === "in_progress").length));
        set("statSelesai", String(all.filter(t => t.status === "done").length));
        set("statTelat", String(all.filter(telat).length));

        const data = Task.dataTampil();
        Task.KOLOM.forEach(([st, colId, countId]) => {
            const box = document.getElementById(colId);
            const cnt = document.getElementById(countId);
            const rows = data.filter(t => (t.status || "todo") === st);
            if (cnt) cnt.textContent = rows.length;
            if (!box) return;
            box.innerHTML = rows.length ? rows.map(t => Task.kartu(t)).join("")
                : `<div class="kanban-empty">Kosong</div>`;
        });

        if (!all.length) {
            const kanban = document.getElementById("kanban");
            if (kanban) kanban.innerHTML = `<div class="pesan-empty" style="grid-column:1/-1; background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:28px 16px; text-align:center; width:100%"><div style="font-size:2rem; margin-bottom:8px; color:#146314"><i class="fa-solid fa-circle-check"></i></div><b>Belum ada task</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Tambahkan tugas untuk mulai mengatur pekerjaan OSIS.</p><button class="btn btn-red btn-sm" onclick="Task.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Task</button></div>`;
        }
    },

    kartu(t) {
        const order = ["todo", "in_progress", "review", "done"];
        const i = Math.max(0, order.indexOf(t.status || "todo"));
        const prev = order[i - 1] || null;
        const next = order[i + 1] || null;
        const sel = Task.selisihDeadline(t.deadline);
        const isTelat = sel !== null && sel > 0 && t.status !== "done";
        let badgeDl = "";
        if (isTelat) badgeDl = `<span class="telat"><i class="fa-solid fa-triangle-exclamation"></i> Terlambat ${sel} hari</span>`;
        else if (sel === 0 && t.status !== "done") badgeDl = `<span class="deadline-dekat">Deadline hari ini</span>`;
        else if (sel === -1 && t.status !== "done") badgeDl = `<span class="deadline-dekat">Deadline besok</span>`;
        const prio = t.priority || "medium";
        const pk = t.proker_id ? `<div class="task-link"><i class="fa-solid fa-list-check"></i> ${escapeHtml(Task.prokerName(t.proker_id))}</div>` : "";
        const ag = t.agenda_id ? `<div class="task-link"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Task.agendaName(t.agenda_id))}</div>` : "";
        const dlText = t.deadline ? Task.fmtTanggal(t.deadline) : "-";
        return `
            <div class="task-card ${isTelat ? "overdue" : ""}" data-task-card="${t.id}">
                <h4>${escapeHtml(t.judul || "Tanpa judul")}</h4>
                ${t.deskripsi ? `<div class="desc">${escapeHtml(t.deskripsi)}</div>` : ""}
                <div class="task-badges">
                    <span class="prio ${prio}">${escapeHtml(Task.PRIO_LABEL[prio] || prio)}</span>
                    ${badgeDl}
                </div>
                <div class="task-meta">
                    <span><i class="fa-solid fa-user"></i>${escapeHtml(t.pic || "-")}</span>
                    <span class="${isTelat ? "telat-text" : ""}"><i class="fa-solid fa-calendar"></i>${escapeHtml(dlText)}</span>
                </div>
                ${pk}${ag}
                <div class="task-move">
                    <button data-move="${t.id}" data-ke="${prev || ""}" ${prev ? "" : "disabled"} title="Mundur">◀</button>
                    <button data-move="${t.id}" data-ke="${next || ""}" ${next ? "" : "disabled"} title="Maju">▶</button>
                </div>
            </div>`;
    },

    bacaFilter() {
        Task.filter = {
            q: document.getElementById("filterQ").value || "",
            pic: document.getElementById("filterPic").value || "",
            divisi: document.getElementById("filterDivisi").value || "",
            priority: document.getElementById("filterPriority").value || "",
            status: document.getElementById("filterStatus").value || "",
            proker: document.getElementById("filterProker").value || "",
            sort: document.getElementById("filterSort").value || "deadline"
        };
        Task.render();
    },

    resetFilter() {
        ["filterQ", "filterPic", "filterDivisi", "filterPriority", "filterStatus", "filterProker"].forEach(id => {
            document.getElementById(id).value = "";
        });
        document.getElementById("filterSort").value = "deadline";
        Task.bacaFilter();
    },

    // ============ PINDAH STATUS ============
    async pindah(id, ke) {
        if (!ke) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        try {
            await pindahTask(u.id, id, ke);
            const item = Task.cache.find(t => String(t.id) === String(id));
            if (item) item.status = ke;
            Task.render();
        } catch (err) {
            console.error(err);
            showToast("Gagal pindah: " + err.message, "error");
            await Task.muat();
        }
    },

    async tandaiSelesai() {
        const id = Task.detailId;
        if (!id) return;
        const item = Task.cache.find(t => String(t.id) === String(id));
        const ke = item && item.status === "done" ? "todo" : "done";
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        try {
            await pindahTask(u.id, id, ke);
            if (item) item.status = ke;
            showToast(ke === "done" ? "Task selesai!" : "Task dibuka lagi", "success");
            Task.tutupDetail();
            Task.render();
        } catch (err) {
            console.error(err);
            showToast("Gagal update: " + err.message, "error");
        }
    },

    // ============ FORM ============
    bukaForm() {
        Task.editingId = null;
        const set = (id, v) => { document.getElementById(id).value = v; };
        set("taskId", "");
        set("taskJudul", "");
        set("taskDeskripsi", "");
        set("taskPic", "");
        set("taskDivisi", "");
        set("taskPriority", "medium");
        set("taskDeadline", "");
        set("taskStatus", "todo");
        set("taskProker", "");
        set("taskAgenda", "");
        set("taskCatatan", "");
        document.getElementById("taskFormTitle").textContent = "Tambah Task";
        document.getElementById("taskForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("taskJudul")?.focus(), 80);
    },

    edit(id) {
        const item = Task.cache.find(t => String(t.id) === String(id));
        if (!item) return;
        Task.editingId = id;
        const set = (idEl, v) => { document.getElementById(idEl).value = v ?? ""; };
        set("taskId", id);
        set("taskJudul", item.judul);
        set("taskDeskripsi", item.deskripsi);
        set("taskPic", item.pic);
        const dv = document.getElementById("taskDivisi");
        if (dv) {
            if (item.divisi && ![...dv.options].some(o => o.value === item.divisi)) {
                const op = document.createElement("option");
                op.value = item.divisi;
                op.textContent = item.divisi;
                dv.appendChild(op);
            }
            dv.value = item.divisi || "";
        }
        set("taskPriority", item.priority || "medium");
        set("taskDeadline", item.deadline || "");
        set("taskStatus", item.status || "todo");
        set("taskProker", item.proker_id || "");
        set("taskAgenda", item.agenda_id || "");
        set("taskCatatan", item.catatan);
        document.getElementById("taskFormTitle").textContent = "Edit Task";
        document.getElementById("taskForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("taskJudul")?.focus(), 80);
    },

    tutupForm() {
        document.getElementById("taskForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Task.editingId = null;
    },

    kumpulkanForm() {
        const v = (id) => document.getElementById(id).value.trim();
        const num = (id) => {
            const n = parseInt(document.getElementById(id).value, 10);
            return Number.isFinite(n) ? n : null;
        };
        return {
            judul: v("taskJudul"),
            deskripsi: v("taskDeskripsi"),
            pic: v("taskPic"),
            divisi: v("taskDivisi"),
            priority: v("taskPriority") || "medium",
            deadline: document.getElementById("taskDeadline").value || null,
            status: v("taskStatus") || "todo",
            proker_id: num("taskProker"),
            agenda_id: num("taskAgenda"),
            catatan: v("taskCatatan")
        };
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const f = Task.kumpulkanForm();
        const id = document.getElementById("taskId").value ? parseInt(document.getElementById("taskId").value, 10) : null;
        if (!f.judul) { showToast("Judul task wajib diisi", "error"); return; }

        const btn = document.getElementById("btnSimpanTask");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            if (id) {
                await updateTask(u.id, id, f);
                showToast("Task diperbarui!", "success");
            } else {
                const newId = await buatTask(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Task ditambah!", "success");
            }
            Task.tutupForm();
            await Task.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Task'; }
        }
    },

    async hapus(id, dariDetail) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Task.cache.find(t => String(t.id) === String(id));
        const yakin = await showPopup(`Hapus task "${item ? item.judul : ""}"?`, "confirm");
        if (!yakin) return;
        try {
            await hapusTask(u.id, id);
            if (dariDetail) Task.tutupDetail();
            showToast("Task dihapus", "success");
            await Task.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ DETAIL ============
    detail(id) {
        const t = Task.cache.find(x => String(x.id) === String(id));
        if (!t) return;
        Task.detailId = id;
        const prio = t.priority || "medium";
        const sel = Task.selisihDeadline(t.deadline);
        const isTelat = sel !== null && sel > 0 && t.status !== "done";
        let dlBox = `<div class="v">${Task.fmtTanggal(t.deadline)}</div>`;
        if (isTelat) dlBox = `<div class="v" style="color:var(--red-dark); font-weight:900">⚠ TERLAMBAT ${sel} HARI <span style="font-weight:600; color:var(--gray)">(${Task.fmtTanggal(t.deadline)})</span></div>`;
        else if (sel === 0 && t.status !== "done") dlBox = `<div class="v">Hari ini <span style="color:var(--gray)">(${Task.fmtTanggal(t.deadline)})</span></div>`;
        else if (sel === -1 && t.status !== "done") dlBox = `<div class="v">Besok <span style="color:var(--gray)">(${Task.fmtTanggal(t.deadline)})</span></div>`;
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        const btnSelesai = document.getElementById("btnSelesaiDariDetail");
        if (btnSelesai) btnSelesai.innerHTML = t.status === "done" ? '<i class="fa-solid fa-rotate-left"></i> Buka Lagi' : '<i class="fa-solid fa-check"></i> Tandai Selesai';
        document.getElementById("taskDetailBody").innerHTML = `
            <h4 style="font-size:1rem; font-weight:900; overflow-wrap:anywhere">${escapeHtml(t.judul || "Tanpa judul")}</h4>
            <div class="task-badges">
                <span class="prio ${prio}">${escapeHtml(Task.PRIO_LABEL[prio] || prio)}</span>
                ${isTelat ? `<span class="telat">Terlambat ${sel} hari</span>` : ""}
                <span class="agenda-status ${t.status === "done" ? "selesai" : t.status === "todo" ? "rencana" : "proses"}">${escapeHtml(Task.STATUS_LABEL[t.status] || t.status)}</span>
            </div>
            ${t.deskripsi ? `<div class="detail-text">${escapeHtml(t.deskripsi)}</div>` : ""}
            <div class="detail-info">
                ${info("PIC", escapeHtml(t.pic))}
                ${info("Divisi", escapeHtml(t.divisi))}
            </div>
            <div class="detail-sec"><h5>Deadline</h5>${dlBox}</div>
            <div class="detail-info" style="margin-top:6px">
                ${info("Program Kerja", escapeHtml(t.proker_id ? Task.prokerName(t.proker_id) : ""))}
                ${info("Agenda", escapeHtml(t.agenda_id ? Task.agendaName(t.agenda_id) : ""))}
            </div>
            ${t.catatan ? `<div class="detail-sec"><h5>Catatan</h5><div class="detail-text">${escapeHtml(t.catatan)}</div></div>` : ""}
            <div class="detail-info" style="margin-top:10px">
                ${info("Dibuat", Task.fmtTanggalWaktu(t.created_at))}
                ${info("Diubah", Task.fmtTanggalWaktu(t.updated_at))}
            </div>`;
        document.getElementById("taskDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("taskDetail")?.classList.remove("open");
        if (!document.getElementById("taskForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Task.detailId = null;
    }
};

document.addEventListener("DOMContentLoaded", () => Task.init());
