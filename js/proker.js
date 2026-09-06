// =========================================================================
// PROGRAM KERJA — halaman khusus OSIS (folder /osis)
// Dipakai di osis/proker.html — kelola proker per periode: CRUD, progress,
// filter, link agenda (agenda_ids di sisi proker, tabel agenda tidak diubah),
// tugas, evaluasi, dokumentasi drag & drop. Visual ikut design system Agenda.
// =========================================================================

const Proker = {
    cache: [],
    agendaCache: [],
    filter: { q: "", divisi: "", status: "", periode: "" },
    editingId: null,
    detailId: null,
    pendingFiles: [],
    existingDok: [],
    _previewUrls: [],

    STATUS_LABEL: { rencana: "Rencana", belum_dimulai: "Belum Dimulai", berjalan: "Sedang Berjalan", selesai: "Selesai", ditunda: "Ditunda", batal: "Dibatalkan" },

    fase(progress) {
        const p = parseInt(progress, 10) || 0;
        if (p <= 0) return "Belum Dimulai";
        if (p <= 25) return "Persiapan";
        if (p <= 50) return "Pelaksanaan";
        if (p <= 75) return "Tahap Akhir";
        if (p < 100) return "Hampir Selesai";
        return "Selesai";
    },

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }

        // opsi divisi: BPH + Umum + daftar sekbid (fail silent)
        try {
            const list = await getSekbid();
            const names = [...new Set((list || []).map(s => s.nama).filter(Boolean))];
            const opts = ["BPH", "Umum", ...names].map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
            const fd = document.getElementById("filterDivisi");
            if (fd) fd.innerHTML = `<option value="">Semua divisi</option>` + opts;
            const nd = document.getElementById("pkDivisi");
            if (nd) nd.innerHTML = `<option value="">— Pilih —</option>` + opts;
        } catch {}

        document.getElementById("btnTambahProker")?.addEventListener("click", () => Proker.bukaForm());
        document.getElementById("btnBatalProker")?.addEventListener("click", () => Proker.tutupForm());
        document.getElementById("btnSimpanProker")?.addEventListener("click", () => Proker.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Proker.resetFilter());
        document.getElementById("btnTambahTl")?.addEventListener("click", () => Proker.tambahTlRow());
        document.getElementById("btnEditDariDetail")?.addEventListener("click", () => {
            const id = Proker.detailId;
            Proker.tutupDetail();
            if (id) Proker.edit(id);
        });

        ["filterQ", "filterDivisi", "filterStatus", "filterPeriode"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Proker.bacaFilter());
        });
        document.getElementById("pkProgress")?.addEventListener("input", () => Proker.renderProgressEdit());

        // dokumentasi drag & drop (pola agenda)
        const drop = document.getElementById("pkDrop");
        const fileInput = document.getElementById("pkDokInput");
        if (drop && fileInput) {
            drop.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", (e) => {
                Proker.handleFiles(e.target.files);
                e.target.value = "";
            });
            ["dragenter", "dragover"].forEach(ev => {
                drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
            });
            ["dragleave", "drop"].forEach(ev => {
                drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
            });
            drop.addEventListener("drop", (e) => {
                const files = e.dataTransfer && e.dataTransfer.files;
                if (files && files.length) Proker.handleFiles(files);
            });
        }

        ["prokerForm", "prokerDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "prokerForm") Proker.tutupForm();
                    else Proker.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("prokerForm")?.classList.contains("open")) Proker.tutupForm();
            if (document.getElementById("prokerDetail")?.classList.contains("open")) Proker.tutupDetail();
        });

        await Proker.muat();
    },

    // ============ DATA ============
    async muat() {
        const listEl = document.getElementById("prokerList");
        if (listEl) listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat program kerja...</div>`;
        try {
            const cached = Cache.get("proker");
            const agendaP = getAllAgenda().catch(() => []);
            if (cached) {
                Proker.cache = cached;
                Proker.agendaCache = await agendaP;
                Proker.buildPeriodeOptions();
                Proker.render();
                Promise.all([getProker(), getAllAgenda().catch(() => [])]).then(([fresh, ag]) => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("proker", fresh);
                        Proker.cache = fresh || [];
                        Proker.agendaCache = ag || [];
                        Proker.buildPeriodeOptions();
                        Proker.render();
                    }
                }).catch(() => {});
                return;
            }
            const [data, ag] = await Promise.all([getProker(), agendaP]);
            Cache.set("proker", data);
            Proker.cache = data || [];
            Proker.agendaCache = ag || [];
            Proker.buildPeriodeOptions();
            Proker.render();
        } catch (err) {
            console.error(err);
            if (listEl) listEl.innerHTML = `<div class="pesan-empty">Gagal memuat program kerja.</div>`;
        }
    },

    buildPeriodeOptions() {
        const setP = new Set((Proker.cache || []).map(p => parseInt(p.periode, 10)).filter(Number.isFinite));
        const list = [...setP].sort((a, b) => b - a);
        const sel = document.getElementById("filterPeriode");
        if (!sel) return;
        const cur = sel.value || Proker.filter.periode || "";
        sel.innerHTML = `<option value="">Semua periode</option>` + list.map(t => `<option value="${t}">${t}/${t + 1}</option>`).join("");
        sel.value = cur;
        Proker.filter.periode = cur;
    },

    agendaById(id) {
        return (Proker.agendaCache || []).find(a => String(a.id) === String(id)) || null;
    },

    agendaIdsOf(p) {
        const arr = Array.isArray(p.agenda_ids) ? p.agenda_ids : [];
        return arr.map(x => String(x));
    },

    fmtBulan(t) {
        if (!t) return "";
        try {
            return new Date(t).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
        } catch { return ""; }
    },

    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        } catch { return t; }
    },

    targetLabel(p) {
        return Proker.fmtBulan(p.tgl_selesai) || Proker.fmtBulan(p.tgl_mulai) || "-";
    },

    // ============ STATISTIK + LIST ============
    render() {
        const all = Proker.cache || [];
        const f = Proker.filter;
        // statistik ikut filter periode (kalau dipilih), biar nyambung sama progress periode
        const statBase = f.periode ? all.filter(p => String(p.periode) === String(f.periode)) : all;
        const count = (fn) => statBase.filter(fn).length;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("statTotal", String(statBase.length));
        set("statBelum", String(count(p => ["rencana", "belum_dimulai"].includes(p.status))));
        set("statJalan", String(count(p => p.status === "berjalan")));
        set("statSelesai", String(count(p => p.status === "selesai")));
        const avg = statBase.length ? Math.round(statBase.reduce((a, p) => a + (parseInt(p.progress, 10) || 0), 0) / statBase.length) : 0;
        set("overallPct", avg + "%");
        const bar = document.getElementById("overallBar");
        if (bar) bar.style.width = avg + "%";
        const olbl = document.getElementById("overallLabel");
        if (olbl) olbl.textContent = f.periode ? `Progress Program Kerja Periode ${f.periode}/${parseInt(f.periode, 10) + 1}` : "Progress Program Kerja Periode Ini";
        const plbl = document.getElementById("periodeLabel");
        if (plbl) {
            const latest = all.length ? Math.max(...all.map(p => parseInt(p.periode, 10) || 0)) : new Date().getFullYear();
            const t = f.periode ? parseInt(f.periode, 10) : latest;
            plbl.textContent = `Program Kerja OSIS — Periode ${t}/${t + 1}`;
        }

        // filter list
        const q = f.q.trim().toLowerCase();
        const data = all.filter(p => {
            if (q && !(`${p.nama || ""} ${p.deskripsi || ""}`.toLowerCase().includes(q))) return false;
            if (f.divisi && (p.divisi || "") !== f.divisi) return false;
            if (f.status && (p.status || "") !== f.status) return false;
            if (f.periode && String(p.periode) !== String(f.periode)) return false;
            return true;
        });

        const listEl = document.getElementById("prokerList");
        if (!listEl) return;
        if (!all.length) {
            listEl.innerHTML = `<div class="pesan-empty" style="background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:28px 16px; text-align:center"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-list-check" style="color:var(--red)"></i></div><b>Belum ada program kerja</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Mulai catat rencana kegiatan OSIS periode ini.</p><button class="btn btn-red btn-sm" onclick="Proker.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Program Kerja</button></div>`;
            return;
        }
        if (!data.length) {
            listEl.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Proker.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            return;
        }
        listEl.innerHTML = data.map(p => {
            const prog = Math.max(0, Math.min(100, parseInt(p.progress, 10) || 0));
            const lbl = Proker.STATUS_LABEL[p.status] || p.status || "-";
            const nagenda = Proker.agendaIdsOf(p).length;
            return `
                <div class="proker-card">
                    <h4>${escapeHtml(p.nama || "Tanpa nama")}</h4>
                    ${p.deskripsi ? `<div class="desc">${escapeHtml(p.deskripsi.length > 140 ? p.deskripsi.slice(0, 140) + "…" : p.deskripsi)}</div>` : ""}
                    <div class="proker-meta">
                        <span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(p.divisi || "-")}</span>
                        <span><i class="fa-solid fa-user"></i> ${escapeHtml(p.pj || "-")}</span>
                        <span><i class="fa-solid fa-bullseye"></i> Target: ${escapeHtml(Proker.targetLabel(p))}</span>
                        <span class="agenda-status ${p.status}">${escapeHtml(lbl)}</span>
                    </div>
                    <div class="proker-progress">
                        <div class="row"><span>Progress — ${escapeHtml(Proker.fase(prog))}</span><b>${prog}%</b></div>
                        <div class="pk-bar"><span style="width:${prog}%"></span></div>
                    </div>
                    <div class="proker-meta" style="margin-bottom:0">
                        <span><i class="fa-solid fa-calendar-days"></i> ${nagenda} agenda terkait</span>
                        <span><i class="fa-solid fa-list-check"></i> ${(Array.isArray(p.tugas) ? p.tugas : []).length} tugas</span>
                    </div>
                    <div class="proker-actions">
                        <button class="btn btn-white btn-sm" onclick="Proker.detail(${p.id})"><i class="fa-solid fa-eye"></i> Lihat Detail</button>
                        <button class="btn btn-white btn-sm" onclick="Proker.edit(${p.id})"><i class="fa-solid fa-pen"></i> Edit</button>
                        <button class="btn btn-red btn-sm" onclick="Proker.hapus(${p.id})"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                    </div>
                </div>`;
        }).join("");
    },

    bacaFilter() {
        Proker.filter = {
            q: document.getElementById("filterQ").value || "",
            divisi: document.getElementById("filterDivisi").value || "",
            status: document.getElementById("filterStatus").value || "",
            periode: document.getElementById("filterPeriode").value || ""
        };
        Proker.render();
    },

    resetFilter() {
        document.getElementById("filterQ").value = "";
        document.getElementById("filterDivisi").value = "";
        document.getElementById("filterStatus").value = "";
        document.getElementById("filterPeriode").value = "";
        Proker.bacaFilter();
    },

    // ============ FORM ============
    bukaForm() {
        Proker.editingId = null;
        Proker.pendingFiles = [];
        Proker.existingDok = [];
        Proker._revokePreviewUrls();
        const set = (id, v) => { document.getElementById(id).value = v; };
        set("pkId", "");
        set("pkNama", "");
        set("pkDeskripsi", "");
        set("pkDivisi", "");
        set("pkPj", "");
        const all = Proker.cache || [];
        const defPeriode = Proker.filter.periode || (all.length ? Math.max(...all.map(p => parseInt(p.periode, 10) || 0)) : new Date().getFullYear());
        set("pkPeriode", String(defPeriode));
        set("pkTglMulai", "");
        set("pkTglSelesai", "");
        set("pkLokasi", "");
        set("pkTargetPeserta", "");
        set("pkStatus", "rencana");
        set("pkProgress", "0");
        set("pkCatatan", "");
        set("pkEvHasil", "");
        set("pkEvKendala", "");
        set("pkEvSolusi", "");
        set("pkEvLanjut", "");
        const fi = document.getElementById("pkDokInput");
        if (fi) fi.value = "";
        document.getElementById("prokerFormTitle").textContent = "Tambah Program Kerja";
        Proker.renderProgressEdit();
        Proker.renderTlRows([Proker.blankTl()]);
        Proker.renderAgendaCheck([]);
        Proker.renderPreview();
        document.getElementById("prokerForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("pkNama")?.focus(), 80);
    },

    edit(id) {
        const item = Proker.cache.find(p => String(p.id) === String(id));
        if (!item) return;
        Proker.editingId = id;
        Proker.pendingFiles = [];
        Proker._revokePreviewUrls();
        const dok = Array.isArray(item.dokumentasi) ? item.dokumentasi : [];
        Proker.existingDok = dok.map(d => typeof d === "string" ? { path: d, caption: "" } : { path: d.path, caption: d.caption || "" }).filter(d => d.path);
        const set = (idEl, v) => { document.getElementById(idEl).value = v ?? ""; };
        set("pkId", id);
        set("pkNama", item.nama);
        set("pkDeskripsi", item.deskripsi);
        set("pkPj", item.pj);
        set("pkPeriode", item.periode ?? new Date().getFullYear());
        set("pkTglMulai", item.tgl_mulai);
        set("pkTglSelesai", item.tgl_selesai);
        set("pkLokasi", item.lokasi);
        set("pkTargetPeserta", item.target_peserta);
        set("pkStatus", item.status || "rencana");
        set("pkProgress", String(Math.max(0, Math.min(100, parseInt(item.progress, 10) || 0))));
        set("pkCatatan", item.catatan);
        set("pkEvHasil", item.evaluasi_hasil);
        set("pkEvKendala", item.evaluasi_kendala);
        set("pkEvSolusi", item.evaluasi_solusi);
        set("pkEvLanjut", item.evaluasi_lanjut);
        const dv = document.getElementById("pkDivisi");
        if (dv) {
            if (item.divisi && ![...dv.options].some(o => o.value === item.divisi)) {
                const op = document.createElement("option");
                op.value = item.divisi;
                op.textContent = item.divisi;
                dv.appendChild(op);
            }
            dv.value = item.divisi || "";
        }
        const fi = document.getElementById("pkDokInput");
        if (fi) fi.value = "";
        document.getElementById("prokerFormTitle").textContent = "Edit Program Kerja";
        Proker.renderProgressEdit();
        const tls = Array.isArray(item.tugas) && item.tugas.length ? item.tugas : [Proker.blankTl()];
        Proker.renderTlRows(tls);
        Proker.renderAgendaCheck(Proker.agendaIdsOf(item));
        Proker.renderPreview();
        document.getElementById("prokerForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("pkNama")?.focus(), 80);
    },

    tutupForm() {
        document.getElementById("prokerForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Proker.editingId = null;
        Proker.pendingFiles = [];
        Proker.existingDok = [];
        Proker._revokePreviewUrls();
        const pv = document.getElementById("pkPreview");
        if (pv) { pv.innerHTML = ""; pv.style.display = "none"; }
        const fi = document.getElementById("pkDokInput");
        if (fi) fi.value = "";
        const drop = document.getElementById("pkDrop");
        if (drop) drop.classList.remove("dragover");
    },

    renderProgressEdit() {
        const r = document.getElementById("pkProgress");
        const v = document.getElementById("pkProgressVal");
        const f = document.getElementById("pkProgressFase");
        const p = r ? (parseInt(r.value, 10) || 0) : 0;
        if (v) v.textContent = p + "%";
        if (f) f.textContent = Proker.fase(p);
    },

    // ——— agenda terkait (checkbox) ———
    renderAgendaCheck(selected) {
        const wrap = document.getElementById("pkAgendaList");
        if (!wrap) return;
        const sel = new Set((selected || []).map(String));
        const list = [...(Proker.agendaCache || [])].sort((a, b) => String(b.tanggal || "") < String(a.tanggal || "") ? -1 : 1);
        if (!list.length) {
            wrap.innerHTML = `<div class="pesan-empty">Belum ada agenda. Buat dulu di halaman Agenda.</div>`;
            return;
        }
        wrap.innerHTML = list.map(a => {
            const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
            return `<label class="pk-agenda-item"><input type="checkbox" data-agenda-check="${a.id}" ${sel.has(String(a.id)) ? "checked" : ""}><span>${escapeHtml(a.judul || "Tanpa judul")}</span><small>${tgl}</small></label>`;
        }).join("");
    },

    bacaAgendaCheck() {
        const ids = [];
        document.querySelectorAll("[data-agenda-check]:checked").forEach(c => ids.push(c.dataset.agendaCheck));
        return ids;
    },

    // ——— tugas dinamis ———
    blankTl() {
        return { tugas: "", pic: "", deadline: "", status: "belum" };
    },

    bacaTlRows() {
        const rows = [];
        document.querySelectorAll("#pkTlList .tl-row").forEach(r => {
            rows.push({
                tugas: r.querySelector("[data-tl=tugas]").value.trim(),
                pic: r.querySelector("[data-tl=pic]").value.trim(),
                deadline: r.querySelector("[data-tl=deadline]").value || "",
                status: r.querySelector("[data-tl=status]").value || "belum"
            });
        });
        return rows;
    },

    renderTlRows(list) {
        const wrap = document.getElementById("pkTlList");
        if (!wrap) return;
        wrap.innerHTML = (list && list.length ? list : [Proker.blankTl()]).map((t, i) => `
            <div class="tl-row" data-i="${i}">
                <div class="tl-head"><span>Tugas ${i + 1}</span><button type="button" class="tl-del" onclick="Proker.hapusTlRow(${i})" title="Hapus tugas"><i class="fa-solid fa-xmark"></i></button></div>
                <div class="full"><input type="text" data-tl="tugas" placeholder="Nama tugas" maxlength="200" value="${escapeHtml(t.tugas || "")}"></div>
                <div><input type="text" data-tl="pic" placeholder="PIC" maxlength="80" value="${escapeHtml(t.pic || "")}"></div>
                <div><input type="date" data-tl="deadline" value="${escapeHtml(t.deadline || "")}"></div>
                <div class="full"><select data-tl="status">
                    <option value="belum" ${t.status !== "selesai" ? "selected" : ""}>Belum dikerjakan</option>
                    <option value="selesai" ${t.status === "selesai" ? "selected" : ""}>Selesai</option>
                </select></div>
            </div>`).join("");
    },

    tambahTlRow() {
        const cur = Proker.bacaTlRows();
        cur.push(Proker.blankTl());
        Proker.renderTlRows(cur);
    },

    hapusTlRow(i) {
        const cur = Proker.bacaTlRows();
        cur.splice(i, 1);
        Proker.renderTlRows(cur.length ? cur : [Proker.blankTl()]);
    },

    // ——— dokumentasi (pola agenda) ———
    handleFiles(fileList) {
        if (!fileList || !fileList.length) return;
        let added = 0;
        for (const f of fileList) {
            if (!f.type || !f.type.startsWith("image/")) {
                showToast(`"${f.name}" bukan gambar`, "error");
                continue;
            }
            Proker.pendingFiles.push(f);
            added++;
        }
        if (added) Proker.renderPreview();
    },

    renderPreview() {
        const preview = document.getElementById("pkPreview");
        if (!preview) return;
        Proker._revokePreviewUrls();
        preview.innerHTML = "";
        const existing = Proker.existingDok || [];
        const pending = Proker.pendingFiles || [];
        if (!existing.length && !pending.length) { preview.style.display = "none"; return; }
        preview.style.display = "flex";
        existing.forEach((d, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "proker-preview-item";
            wrap.innerHTML = `<img src="${getFoto(d.path)}" alt=""><button type="button" class="proker-preview-del" title="Hapus"><i class="fa-solid fa-xmark"></i></button>`;
            wrap.querySelector(".proker-preview-del").addEventListener("click", () => {
                Proker.existingDok.splice(idx, 1);
                Proker.renderPreview();
            });
            preview.appendChild(wrap);
        });
        pending.forEach((file, idx) => {
            if (!file.type.startsWith("image/")) return;
            const url = URL.createObjectURL(file);
            Proker._previewUrls.push(url);
            const wrap = document.createElement("div");
            wrap.className = "proker-preview-item";
            wrap.innerHTML = `<img src="${url}" alt=""><button type="button" class="proker-preview-del" title="Hapus"><i class="fa-solid fa-xmark"></i></button>`;
            wrap.querySelector(".proker-preview-del").addEventListener("click", () => {
                Proker.pendingFiles.splice(idx, 1);
                Proker.renderPreview();
            });
            preview.appendChild(wrap);
        });
    },

    _revokePreviewUrls() {
        (Proker._previewUrls || []).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        Proker._previewUrls = [];
    },

    kumpulkanForm() {
        const v = (id) => document.getElementById(id).value.trim();
        let periode = parseInt(document.getElementById("pkPeriode").value, 10);
        if (!Number.isFinite(periode)) periode = new Date().getFullYear();
        let progress = parseInt(document.getElementById("pkProgress").value, 10);
        if (!Number.isFinite(progress)) progress = 0;
        progress = Math.max(0, Math.min(100, progress));
        const tls = Proker.bacaTlRows().filter(t => t.tugas || t.pic);
        return {
            nama: v("pkNama"),
            deskripsi: v("pkDeskripsi"),
            divisi: v("pkDivisi"),
            pj: v("pkPj"),
            periode,
            tgl_mulai: document.getElementById("pkTglMulai").value || null,
            tgl_selesai: document.getElementById("pkTglSelesai").value || null,
            lokasi: v("pkLokasi"),
            target_peserta: v("pkTargetPeserta"),
            status: v("pkStatus") || "rencana",
            progress,
            catatan: v("pkCatatan"),
            agenda_ids: Proker.bacaAgendaCheck(),
            tugas: tls,
            evaluasi_hasil: v("pkEvHasil"),
            evaluasi_kendala: v("pkEvKendala"),
            evaluasi_solusi: v("pkEvSolusi"),
            evaluasi_lanjut: v("pkEvLanjut")
        };
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const f = Proker.kumpulkanForm();
        const id = document.getElementById("pkId").value ? parseInt(document.getElementById("pkId").value, 10) : null;
        if (!f.nama) { showToast("Nama program kerja wajib diisi", "error"); return; }

        const btn = document.getElementById("btnSimpanProker");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            let dok = [...(Proker.existingDok || [])];
            const files = Proker.pendingFiles || [];
            for (let i = 0; i < files.length; i++) {
                const fl = files[i];
                if (!fl.type.startsWith("image/")) continue;
                const ext = (fl.name.split(".").pop() || "jpg").toLowerCase();
                const path = `proker/proker-${u.id}-${Date.now()}-${i}.${ext}`;
                await uploadFotoStorage(fl, path);
                dok.push({ path, caption: "" });
            }
            f.dokumentasi = dok;
            if (id) {
                await updateProker(u.id, id, f);
                showToast("Program kerja diperbarui!", "success");
            } else {
                const newId = await buatProker(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Program kerja ditambah!", "success");
            }
            Proker.tutupForm();
            await Proker.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Program Kerja'; }
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Proker.cache.find(p => String(p.id) === String(id));
        const yakin = await showPopup(`Hapus proker "${item ? item.nama : ""}"? Dokumentasinya ikut terhapus. Agenda terkait tidak ikut terhapus.`, "confirm");
        if (!yakin) return;
        try {
            await hapusProker(u.id, id);
            if (item && Array.isArray(item.dokumentasi)) {
                for (const d of item.dokumentasi) {
                    const p = typeof d === "string" ? d : d.path;
                    if (p) try { await hapusFotoStorage(p); } catch {}
                }
            }
            showToast("Program kerja dihapus", "success");
            await Proker.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ DETAIL ============
    detail(id) {
        const p = Proker.cache.find(x => String(x.id) === String(id));
        if (!p) return;
        Proker.detailId = id;
        const prog = Math.max(0, Math.min(100, parseInt(p.progress, 10) || 0));
        const lbl = Proker.STATUS_LABEL[p.status] || p.status || "-";
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        const teks = (v, kosong) => v
            ? `<div class="detail-text">${escapeHtml(v)}</div>`
            : `<div class="detail-text" style="opacity:.6">${kosong}</div>`;

        const tls = Array.isArray(p.tugas) ? p.tugas : [];
        const tlHtml = tls.length ? `<table class="tl-tabel"><thead><tr><th>Tugas</th><th>PIC</th><th>Deadline</th><th>Status</th></tr></thead><tbody>${tls.map(t => `
            <tr><td>${escapeHtml(t.tugas || "-")}</td><td>${escapeHtml(t.pic || "-")}</td><td>${t.deadline ? Proker.fmtTanggal(t.deadline) : "-"}</td><td><span class="tl-status ${t.status === "selesai" ? "selesai" : "belum"}">${t.status === "selesai" ? "Selesai" : "Belum"}</span></td></tr>`).join("")}</tbody></table>`
            : `<div class="detail-text" style="opacity:.6">Belum ada tugas.</div>`;

        const ids = Proker.agendaIdsOf(p);
        const agHtml = ids.length ? ids.map(aid => {
            const a = Proker.agendaById(aid);
            if (!a) return `<div class="agenda-link-item"><i class="fa-solid fa-calendar"></i> Agenda #${escapeHtml(aid)} (dihapus)<small></small></div>`;
            const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
            return `<div class="agenda-link-item"><i class="fa-solid fa-calendar"></i> ${escapeHtml(a.judul || "Tanpa judul")}<small>${tgl}</small></div>`;
        }).join("") : `<div class="detail-text" style="opacity:.6">Belum ada agenda terkait. Edit proker buat mengaitkan agenda.</div>`;

        const dok = Array.isArray(p.dokumentasi) ? p.dokumentasi : [];
        const dokHtml = dok.length ? `<div class="proker-fotos">${dok.map(d => {
            const path = typeof d === "string" ? d : d.path;
            return `<img src="${getFoto(path)}" alt="" loading="lazy" style="width:110px; height:110px; object-fit:cover; border:2px solid var(--ink); border-radius:10px" onclick="Home && Home.bukaFotoPopup && Home.bukaFotoPopup(this, '${escapeHtml(p.nama).replace(/'/g, "\\'")}', '')">`;
        }).join("")}</div>` : `<div class="detail-text" style="opacity:.6">Belum ada dokumentasi.</div>`;

        const evAda = p.evaluasi_hasil || p.evaluasi_kendala || p.evaluasi_solusi || p.evaluasi_lanjut;
        const evHtml = evAda ? `
            ${p.evaluasi_hasil ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Hasil</div><div class="detail-text" style="margin-top:4px">${escapeHtml(p.evaluasi_hasil)}</div>` : ""}
            ${p.evaluasi_kendala ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Kendala</div><div class="detail-text" style="margin-top:4px">${escapeHtml(p.evaluasi_kendala)}</div>` : ""}
            ${p.evaluasi_solusi ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Solusi</div><div class="detail-text" style="margin-top:4px">${escapeHtml(p.evaluasi_solusi)}</div>` : ""}
            ${p.evaluasi_lanjut ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Periode Berikutnya</div><div class="detail-text" style="margin-top:4px">${escapeHtml(p.evaluasi_lanjut)}</div>` : ""}`
            : `<div class="detail-text" style="opacity:.6">Belum ada evaluasi.</div>`;

        document.getElementById("prokerDetailBody").innerHTML = `
            <h4 style="font-size:1.05rem; font-weight:900; text-transform:uppercase; overflow-wrap:anywhere">${escapeHtml(p.nama || "Tanpa nama")}</h4>
            <div style="margin:6px 0 2px"><span class="agenda-status ${p.status}">${escapeHtml(lbl)}</span></div>
            <div class="detail-sec"><h5>Informasi Program</h5>
                <div class="detail-info">
                    ${info("Divisi", escapeHtml(p.divisi))}
                    ${info("Ketua / PJ", escapeHtml(p.pj))}
                    ${info("Periode", p.periode ? `${p.periode}/${parseInt(p.periode, 10) + 1}` : "-")}
                    ${info("Target", escapeHtml(Proker.targetLabel(p)))}
                    ${info("Mulai", Proker.fmtTanggal(p.tgl_mulai))}
                    ${info("Selesai", Proker.fmtTanggal(p.tgl_selesai))}
                    ${info("Lokasi", escapeHtml(p.lokasi))}
                    ${info("Target Peserta", escapeHtml(p.target_peserta))}
                </div>
                <div class="proker-progress" style="margin-top:10px">
                    <div class="row"><span>Progress — ${escapeHtml(Proker.fase(prog))}</span><b>${prog}%</b></div>
                    <div class="pk-bar"><span style="width:${prog}%"></span></div>
                </div>
                ${p.deskripsi ? `<div class="detail-text" style="margin-top:8px">${escapeHtml(p.deskripsi)}</div>` : ""}
                ${p.catatan ? `<div class="detail-text" style="margin-top:8px"><b>Catatan:</b> ${escapeHtml(p.catatan)}</div>` : ""}
            </div>
            <div class="detail-sec"><h5>Rencana Pelaksanaan</h5>
                <div class="detail-info">
                    ${info("Tanggal Mulai", Proker.fmtTanggal(p.tgl_mulai))}
                    ${info("Tanggal Selesai", Proker.fmtTanggal(p.tgl_selesai))}
                    ${info("Lokasi", escapeHtml(p.lokasi))}
                    ${info("Target Peserta", escapeHtml(p.target_peserta))}
                </div>
            </div>
            <div class="detail-sec"><h5>Agenda Terkait (${ids.length})</h5>${agHtml}</div>
            <div class="detail-sec"><h5>Tugas / Tindak Lanjut</h5>${tlHtml}</div>
            <div class="detail-sec"><h5>Evaluasi</h5>${evHtml}</div>
            <div class="detail-sec"><h5>Dokumentasi</h5>${dokHtml}</div>`;
        document.getElementById("prokerDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("prokerDetail")?.classList.remove("open");
        if (!document.getElementById("prokerForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Proker.detailId = null;
    }
};

document.addEventListener("DOMContentLoaded", () => Proker.init());
