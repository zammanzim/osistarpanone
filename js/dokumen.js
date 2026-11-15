// =========================================================================
// DOKUMEN OSIS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/dokumen.html — arsip digital: upload, cari, filter, sort,
// buka (preview PDF/gambar), download, edit, hapus. File fisik di bucket
// osis-foto folder dokumen/. Visual ikut design system Agenda.
// =========================================================================

const Dokumen = {
    cache: [],
    offset: 0,
    habis: false,
    loading: false,
    perPage: 20,
    filter: { q: "", kategori: "", tahun: "", divisi: "", sort: "baru" },
    editingId: null,
    detailId: null,
    stagedFile: null,   // File baru di popup (upload atau edit)
    existingPath: "",   // file_path lama pas edit
    viewMode: "grid",   // "grid" | "list"
    VIEW_KEY: "osis_dokumen_view",

    KATEGORI: [
        ["semua", "Semua", "fa-solid fa-folder"],
        ["proposal", "Proposal", "fa-solid fa-file-lines"],
        ["lpj", "LPJ", "fa-solid fa-file-circle-check"],
        ["surat", "Surat", "fa-solid fa-envelope-open-text"],
        ["sk", "SK", "fa-solid fa-award"],
        ["notulensi", "Notulensi", "fa-solid fa-clipboard-list"],
        ["administrasi", "Administrasi", "fa-solid fa-briefcase"],
        ["laporan", "Laporan", "fa-solid fa-chart-line"],
        ["lainnya", "Lainnya", "fa-solid fa-folder-open"]
    ],

    MAX_BYTES: 20 * 1024 * 1024,

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        try {
            const v = localStorage.getItem(Dokumen.VIEW_KEY);
            if (v === "list" || v === "grid") Dokumen.viewMode = v;
        } catch {}
        Dokumen.syncViewBtns();

        // Segarkan hak kendali (biar perubahan akses langsung berlaku)
        try { await OsisAuth.refreshAkses(); } catch {}
        Dokumen.terapkanAkses();

        // opsi kategori (form + filter)
        const katOpts = Dokumen.KATEGORI.filter(k => k[0] !== "semua")
            .map(k => `<option value="${k[0]}">${k[1]}</option>`).join("");
        const dk = document.getElementById("dokKategori");
        if (dk) dk.innerHTML = katOpts;
        const fk = document.getElementById("filterKategori");
        if (fk) fk.innerHTML = `<option value="">Semua</option>` + katOpts;

        // opsi divisi: BPH + Umum + sekbid (fail silent)
        try {
            const list = await getSekbid();
            const names = [...new Set((list || []).map(s => s.nama).filter(Boolean))];
            const opts = ["BPH", "Umum", ...names].map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
            const dd = document.getElementById("dokDivisi");
            if (dd) dd.innerHTML = `<option value="">— Pilih —</option>` + opts;
            const fd = document.getElementById("filterDivisi");
            if (fd) fd.innerHTML = `<option value="">Semua</option>` + opts;
        } catch {}
        try { window.Dropdown?.segarkanSemua?.(); } catch {}

        document.getElementById("btnUploadDokumen")?.addEventListener("click", () => Dokumen.bukaForm());
        document.getElementById("btnBatalDokumen")?.addEventListener("click", () => Dokumen.tutupForm());
        document.getElementById("btnSimpanDokumen")?.addEventListener("click", () => Dokumen.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Dokumen.resetFilter());
        document.getElementById("btnViewGrid")?.addEventListener("click", () => Dokumen.setView("grid"));
        document.getElementById("btnViewList")?.addEventListener("click", () => Dokumen.setView("list"));
        document.getElementById("btnClearQ")?.addEventListener("click", () => Dokumen.hapusFilter("q"));
        document.getElementById("btnDownloadDetail")?.addEventListener("click", () => Dokumen.downloadAktif());
        document.getElementById("btnEditDariDetail")?.addEventListener("click", () => {
            const id = Dokumen.detailId;
            Dokumen.tutupDetail();
            if (id) Dokumen.edit(id);
        });
        document.getElementById("btnHapusDariDetail")?.addEventListener("click", () => {
            const id = Dokumen.detailId;
            if (id) Dokumen.hapus(id, true);
        });

        ["filterQ", "filterKategori", "filterTahun", "filterDivisi", "filterSort"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Dokumen.bacaFilter());
        });

        // Draft otomatis form tambah dokumen
        if (typeof FormPersist !== "undefined") {
            FormPersist.watch("dokumenForm", {
                fields: ["dokNama", "dokKategori", "dokTahun", "dokDivisi", "dokDeskripsi"],
                isEditing: () => !!Dokumen.editingId
            });
        }

        // drop zone upload (semua tipe file, bukan cuma gambar)
        const drop = document.getElementById("dokDrop");
        const fileInput = document.getElementById("dokFile");
        if (drop && fileInput) {
            drop.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", (e) => {
                Dokumen.handleFile(e.target.files && e.target.files[0]);
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
                if (f) Dokumen.handleFile(f);
            });
        }

        ["dokumenForm", "dokumenDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "dokumenForm") Dokumen.tutupForm();
                    else Dokumen.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("dokumenForm")?.classList.contains("open")) Dokumen.tutupForm();
            if (document.getElementById("dokumenDetail")?.classList.contains("open")) Dokumen.tutupDetail();
        });

        await Dokumen.muat(true);
    },

    // Sembunyikan tombol aksi kalau tidak punya kendali atas halaman ini
    terapkanAkses() {
        const boleh = OsisAuth.bisa("dokumen");
        ["btnUploadDokumen", "btnEditDariDetail", "btnHapusDariDetail"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = boleh ? "" : "none";
        });
    },

    // ============ HELPERS ============
    extOf(d) {
        const t = String(d.file_type || "").toLowerCase();
        if (t) return t;
        const m = String(d.nama || "").match(/\.([a-z0-9]{2,5})$/i);
        return m ? m[1].toLowerCase() : "";
    },

    isContoh(d) {
        return !d.file_path;
    },

    fileIcon(ext) {
        if (ext === "pdf") return ["pdf", "fa-solid fa-file-pdf"];
        if (["doc", "docx", "odt", "rtf", "txt"].includes(ext)) return ["doc", "fa-solid fa-file-word"];
        if (["xls", "xlsx", "ods", "csv"].includes(ext)) return ["xls", "fa-solid fa-file-excel"];
        if (["ppt", "pptx", "odp"].includes(ext)) return ["ppt", "fa-solid fa-file-powerpoint"];
        if (["zip", "rar", "7z"].includes(ext)) return ["zip", "fa-solid fa-file-zipper"];
        if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return ["img", "fa-solid fa-file-image"];
        return ["", "fa-solid fa-file"];
    },

    fmtBytes(b) {
        b = parseInt(b, 10) || 0;
        if (!b) return "—";
        if (b < 1024) return b + " B";
        if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + " KB";
        return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB";
    },

    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        } catch { return "-"; }
    },

    katLabel(k) {
        const f = Dokumen.KATEGORI.find(x => x[0] === k);
        return f ? f[1] : k;
    },

    bisaPreview(d) {
        const ext = Dokumen.extOf(d);
        if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "img";
        if (ext === "pdf") return "pdf";
        return "";
    },

    // ============ DATA (paginasi hemat egress: 20/halaman + sentinel) ============
    async muat(awal = true) {
        if (Dokumen.loading) return;
        if (!awal && Dokumen.habis) return;
        Dokumen.loading = true;
        const listEl = document.getElementById("dokumenList");
        if (awal) {
            Dokumen.offset = 0;
            Dokumen.cache = [];
            Dokumen.habis = false;
            // render instan dari cache persisten (tanpa fetch)
            let instan = false;
            try {
                const c = Cache.get("dokumen");
                if (c && c.length) {
                    Dokumen.cache = [...c];
                    Dokumen.render();
                    instan = true;
                    Dokumen.cache = [];
                    Dokumen.offset = 0;
                    Dokumen.habis = false;
                }
            } catch {}
            if (!instan && listEl) listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat dokumen...</div>`;
        }
        try {
            const rows = await getDokumen(Dokumen.perPage, Dokumen.offset);
            const ada = new Set(Dokumen.cache.map(d => String(d.id)));
            (rows || []).forEach(r => {
                if (!ada.has(String(r.id))) { Dokumen.cache.push(r); ada.add(String(r.id)); }
            });
            Dokumen.offset = Dokumen.cache.length;
            if (!rows || rows.length < Dokumen.perPage) {
                Dokumen.habis = true;
                try { Cache.set("dokumen", Dokumen.cache); } catch {}
            }
            Dokumen.render();
        } catch (err) {
            console.error(err);
            if (awal && listEl && !Dokumen.cache.length) listEl.innerHTML = `<div class="pesan-empty">Gagal memuat dokumen.</div>`;
            else if (typeof showToast === "function") showToast("Gagal muat lanjutan.", "error");
        } finally {
            Dokumen.loading = false;
        }
    },

    dataTampil() {
        const all = Dokumen.cache || [];
        const f = Dokumen.filter;
        const q = f.q.trim().toLowerCase();
        let data = all.filter(d => {
            if (f.kategori && f.kategori !== "semua" && (d.kategori || "") !== f.kategori) return false;
            if (q && !(`${d.nama || ""} ${d.deskripsi || ""}`.toLowerCase().includes(q))) return false;
            if (f.tahun && String(d.tahun) !== String(f.tahun)) return false;
            if (f.divisi && (d.divisi || "") !== f.divisi) return false;
            return true;
        });
        if (f.sort === "lama") data = [...data].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        else if (f.sort === "nama") data = [...data].sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || ""), "id"));
        else if (f.sort === "besar") data = [...data].sort((a, b) => (parseInt(b.ukuran_bytes, 10) || 0) - (parseInt(a.ukuran_bytes, 10) || 0));
        else data = [...data].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        return data;
    },

    setView(mode) {
        Dokumen.viewMode = mode === "list" ? "list" : "grid";
        try { localStorage.setItem(Dokumen.VIEW_KEY, Dokumen.viewMode); } catch {}
        Dokumen.syncViewBtns();
        Dokumen.render();
    },

    syncViewBtns() {
        const g = document.getElementById("btnViewGrid");
        const l = document.getElementById("btnViewList");
        if (g) g.classList.toggle("active", Dokumen.viewMode === "grid");
        if (l) l.classList.toggle("active", Dokumen.viewMode === "list");
    },

    renderResultBar(total, tampil) {
        const bar = document.getElementById("dokResultBar");
        if (!bar) return;
        if (!total) { bar.style.display = "none"; bar.innerHTML = ""; return; }
        const f = Dokumen.filter;
        const chips = [];
        if ((f.q || "").trim()) chips.push(["q", `Cari: "${f.q.trim().slice(0, 24)}"`]);
        if (f.kategori && f.kategori !== "semua") chips.push(["kategori", `Kategori: ${Dokumen.katLabel(f.kategori)}`]);
        if (f.tahun) chips.push(["tahun", `Tahun: ${f.tahun}`]);
        if (f.divisi) chips.push(["divisi", `Divisi: ${f.divisi}`]);
        const countTxt = tampil === total
            ? `Menampilkan <b>${total}</b> dokumen`
            : `Menampilkan <b>${tampil}</b> dari <b>${total}</b> dokumen`;
        bar.style.display = "";
        bar.innerHTML = `<span class="dok-bar-count">${countTxt}</span>`
            + (chips.length
                ? `<div class="dok-chips">${chips.map(([k, lbl]) =>
                    `<button type="button" class="dok-chip" onclick="Dokumen.hapusFilter('${k}')">${escapeHtml(lbl)} <i class="fa-solid fa-xmark"></i></button>`
                ).join("")}</div>`
                : "");
    },

    render() {
        const all = Dokumen.cache || [];
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        set("statTotal", String(all.length));
        set("statBulan", String(all.filter(d => (d.created_at || "").slice(0, 7) === ym).length));
        set("statBulanLbl", now.toLocaleDateString("id-ID", { month: "long", year: "numeric" }));
        set("statProposal", String(all.filter(d => d.kategori === "proposal").length));
        set("statLpj", String(all.filter(d => d.kategori === "lpj").length));
        set("folderTotalBadge", String(all.length));

        const clrQ = document.getElementById("btnClearQ");
        if (clrQ) clrQ.style.display = (Dokumen.filter.q || "").trim() ? "" : "none";

        // opsi tahun dinamis
        const years = [...new Set(all.map(d => parseInt(d.tahun, 10)).filter(Number.isFinite))].sort((a, b) => b - a);
        const ft = document.getElementById("filterTahun");
        if (ft) {
            const cur = ft.value || Dokumen.filter.tahun || "";
            ft.innerHTML = `<option value="">Semua</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
            ft.value = cur;
            Dokumen.filter.tahun = cur;
        }
        try { window.Dropdown?.segarkanSemua?.(); } catch {}

        // folder + count
        const fg = document.getElementById("folderGrid");
        if (fg) {
            const katAktif = Dokumen.filter.kategori || "semua";
            fg.innerHTML = Dokumen.KATEGORI.map(k => {
                const n = k[0] === "semua" ? all.length : all.filter(d => (d.kategori || "") === k[0]).length;
                return `<button type="button" class="folder-card ${katAktif === k[0] ? "active" : ""}" onclick="Dokumen.pilihKategori('${k[0]}')"><span class="fic"><i class="${k[2]}"></i></span><b>${k[1]}</b><small>${n}</small></button>`;
            }).join("");
        }

        // list
        const listEl = document.getElementById("dokumenList");
        const footEl = document.getElementById("dokumenFooter");
        if (!listEl) return;
        listEl.classList.toggle("dok-grid", Dokumen.viewMode !== "list");
        listEl.classList.toggle("dok-list", Dokumen.viewMode === "list");
        Dokumen.syncViewBtns();

        const boleh = OsisAuth.bisa("dokumen");
        const data = Dokumen.dataTampil();
        Dokumen.renderResultBar(all.length, data.length);
        try { window.OsisSearch?.sync?.("dokTopSearch"); } catch {}

        if (!all.length) {
            listEl.innerHTML = `<div class="pesan-empty dok-empty-box"><div class="dok-empty-ico"><i class="fa-solid fa-folder-open"></i></div><b>Belum ada dokumen</b><p>Dokumen pada arsip ini akan muncul di sini.</p>${boleh ? `<button class="btn btn-red btn-sm" onclick="Dokumen.bukaForm()"><i class="fa-solid fa-plus"></i> Upload Dokumen</button>` : ""}</div>`;
            if (footEl) footEl.innerHTML = "";
            return;
        }
        if (!data.length) {
            const kat = Dokumen.filter.kategori && Dokumen.filter.kategori !== "semua" ? ` pada kategori <b>${escapeHtml(Dokumen.katLabel(Dokumen.filter.kategori))}</b>` : "";
            listEl.innerHTML = `<div class="pesan-empty dok-empty-box"><div class="dok-empty-ico"><i class="fa-solid fa-magnifying-glass"></i></div><b>Tidak ada dokumen yang cocok</b><p>Coba ubah kata kunci atau reset filter${kat}.</p><button type="button" class="btn btn-white btn-sm" onclick="Dokumen.resetFilter()"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button></div>`;
            if (footEl) {
                footEl.innerHTML = Dokumen.habis ? "" : `<div style="text-align:center; padding:12px 4px"><button class="btn btn-white btn-sm" onclick="Dokumen.muat(false)"><i class="fa-solid fa-angles-down"></i> Muat lagi</button></div><div id="dokumenSentinel" style="height:8px"></div>`;
                try { pasangSentinel("dokumenSentinel", () => Dokumen.muat(false)); } catch {}
            }
            return;
        }

        listEl.innerHTML = data.map(d => {
            const ext = Dokumen.extOf(d);
            const [cls, icon] = Dokumen.fileIcon(ext);
            const contoh = Dokumen.isContoh(d);
            const extLbl = (ext || "FILE").toUpperCase();
            return `
                <article class="dok-item">
                    <button type="button" class="dok-card-hit" onclick="Dokumen.detail(${d.id})">
                        <div class="dok-ico ${cls}"><i class="${icon}"></i><span class="dok-ext-pill">${escapeHtml(extLbl)}</span></div>
                        <div class="dok-body">
                            <div class="dok-badges">
                                <span class="dok-kat-pill">${escapeHtml(Dokumen.katLabel(d.kategori))}</span>
                                <span class="dok-tahun-pill">${escapeHtml(String(d.tahun || "-"))}</span>
                                ${contoh ? `<span class="dok-tag-contoh">Contoh</span>` : ""}
                            </div>
                            <h4>${escapeHtml(d.nama || "Tanpa nama")}</h4>
                            ${d.deskripsi ? `<p class="dok-desc">${escapeHtml(d.deskripsi)}</p>` : ""}
                            <div class="dok-meta">
                                <span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(d.divisi || "Umum")}</span>
                                <span><i class="fa-solid fa-user"></i> ${escapeHtml(d.pengunggah || "-")}</span>
                            </div>
                        </div>
                    </button>
                    <div class="dok-card-foot">
                        <span class="dok-foot-info">${Dokumen.fmtBytes(d.ukuran_bytes)} · ${Dokumen.fmtTanggal(d.created_at)}</span>
                        <div class="dok-actions">
                            <button type="button" class="btn btn-yellow btn-sm" onclick="Dokumen.detail(${d.id})"><i class="fa-solid fa-eye"></i> Buka</button>
                            <button type="button" class="btn btn-white btn-sm" onclick="Dokumen.download(${d.id})" title="Download"><i class="fa-solid fa-download"></i></button>
                            ${boleh ? `<button type="button" class="btn btn-white btn-sm" onclick="Dokumen.edit(${d.id})" title="Edit"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="btn btn-red btn-sm" onclick="Dokumen.hapus(${d.id})" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                        </div>
                    </div>
                </article>`;
        }).join("");

        if (footEl) {
            footEl.innerHTML = `<div style="text-align:center; padding:12px 4px">`
                + (Dokumen.habis
                    ? `<small style="color:var(--gray); font-weight:700">— Udah paling bawah —</small>`
                    : `<button class="btn btn-white btn-sm" onclick="Dokumen.muat(false)"><i class="fa-solid fa-angles-down"></i> Muat lagi</button>`)
                + `</div><div id="dokumenSentinel" style="height:8px"></div>`;
            try { pasangSentinel("dokumenSentinel", () => Dokumen.muat(false)); } catch {}
        }
    },

    pilihKategori(k) {
        Dokumen.filter.kategori = (k === "semua") ? "" : k;
        const fk = document.getElementById("filterKategori");
        if (fk) fk.value = Dokumen.filter.kategori;
        try { window.Dropdown?.segarkanSemua?.(); } catch {}
        Dokumen.render();
    },

    hapusFilter(key) {
        const map = { q: "filterQ", kategori: "filterKategori", tahun: "filterTahun", divisi: "filterDivisi" };
        const el = document.getElementById(map[key]);
        if (el) el.value = "";
        try { window.Dropdown?.segarkanSemua?.(); } catch {}
        Dokumen.bacaFilter();
    },

    bacaFilter() {
        Dokumen.filter = {
            q: document.getElementById("filterQ").value || "",
            kategori: document.getElementById("filterKategori").value || "",
            tahun: document.getElementById("filterTahun").value || "",
            divisi: document.getElementById("filterDivisi").value || "",
            sort: document.getElementById("filterSort").value || "baru"
        };
        Dokumen.render();
    },

    resetFilter() {
        document.getElementById("filterQ").value = "";
        document.getElementById("filterKategori").value = "";
        document.getElementById("filterTahun").value = "";
        document.getElementById("filterDivisi").value = "";
        document.getElementById("filterSort").value = "baru";
        try { window.Dropdown?.segarkanSemua?.(); } catch {}
        Dokumen.bacaFilter();
    },

    // ============ FORM ============
    bukaForm() {
        if (!OsisAuth.butuh("dokumen")) return;
        Dokumen.editingId = null;
        Dokumen.stagedFile = null;
        Dokumen.existingPath = "";
        document.getElementById("dokId").value = "";
        document.getElementById("dokNama").value = "";
        document.getElementById("dokKategori").value = (Dokumen.filter.kategori && Dokumen.filter.kategori !== "semua") ? Dokumen.filter.kategori : "proposal";
        const _angTh = OsisAuth.getAngkatanAktifObj?.()?.tahun;
        document.getElementById("dokTahun").value = String(_angTh || new Date().getFullYear());
        document.getElementById("dokDivisi").value = "";
        document.getElementById("dokDeskripsi").value = "";
        if (typeof FormPersist !== "undefined") {
            const draft = FormPersist.load("dokumenForm");
            const adaIsi = draft && (String(draft.dokNama || "").trim() || String(draft.dokDeskripsi || "").trim() || String(draft.dokDivisi || "").trim());
            if (adaIsi) FormPersist.fillFields(draft);
        }
        try { window.Dropdown?.segarkanSemua?.(); } catch {}
        const fi = document.getElementById("dokFile");
        if (fi) fi.value = "";
        document.getElementById("dokumenFormTitle").textContent = "Upload Dokumen";
        Dokumen.renderFileInfo();
        document.getElementById("dokumenForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    edit(id) {
        const item = Dokumen.cache.find(d => String(d.id) === String(id));
        if (!item) return;
        if (!OsisAuth.butuh("dokumen")) return;
        Dokumen.editingId = id;
        Dokumen.stagedFile = null;
        Dokumen.existingPath = item.file_path || "";
        document.getElementById("dokId").value = id;
        document.getElementById("dokNama").value = item.nama || "";
        document.getElementById("dokKategori").value = item.kategori || "lainnya";
        document.getElementById("dokTahun").value = item.tahun || new Date().getFullYear();
        const dv = document.getElementById("dokDivisi");
        if (dv) {
            if (item.divisi && ![...dv.options].some(o => o.value === item.divisi)) {
                const op = document.createElement("option");
                op.value = item.divisi;
                op.textContent = item.divisi;
                dv.appendChild(op);
            }
            dv.value = item.divisi || "";
        }
        document.getElementById("dokDeskripsi").value = item.deskripsi || "";
        try { window.Dropdown?.segarkanSemua?.(); } catch {}
        const fi = document.getElementById("dokFile");
        if (fi) fi.value = "";
        document.getElementById("dokumenFormTitle").textContent = "Edit Dokumen";
        Dokumen.renderFileInfo(item);
        document.getElementById("dokumenForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupForm() {
        document.getElementById("dokumenForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Dokumen.editingId = null;
        Dokumen.stagedFile = null;
        Dokumen.existingPath = "";
        const fi = document.getElementById("dokFile");
        if (fi) fi.value = "";
        const drop = document.getElementById("dokDrop");
        if (drop) drop.classList.remove("dragover");
    },

    clearStagedFile() {
        Dokumen.stagedFile = null;
        const fi = document.getElementById("dokFile");
        if (fi) fi.value = "";
        const existing = Dokumen.editingId ? Dokumen.cache.find(d => String(d.id) === String(Dokumen.editingId)) : null;
        Dokumen.renderFileInfo(existing);
    },

    handleFile(file) {
        if (!file) return;
        if (file.size > Dokumen.MAX_BYTES) {
            showToast("File maksimal 20MB", "error");
            return;
        }
        Dokumen.stagedFile = file;
        // auto-isi nama dari filename kalau masih kosong
        const namaInp = document.getElementById("dokNama");
        if (namaInp && !namaInp.value.trim()) {
            namaInp.value = file.name.replace(/\.[^.]+$/, "").slice(0, 160);
        }
        Dokumen.renderFileInfo();
    },

    renderFileInfo(existing) {
        const box = document.getElementById("dokFileInfo");
        const drop = document.getElementById("dokDrop");
        if (!box || !drop) return;
        const f = Dokumen.stagedFile;
        if (f) {
            const ext = (f.name.split(".").pop() || "").toLowerCase();
            const [, icon] = Dokumen.fileIcon(ext);
            box.style.display = "";
            box.innerHTML = `<div class="dok-file-info"><i class="${icon}"></i><div style="min-width:0; flex:1"><div style="overflow-wrap:anywhere">${escapeHtml(f.name)}</div><small>${escapeHtml(ext.toUpperCase() || "FILE")} · ${Dokumen.fmtBytes(f.size)}${Dokumen.editingId ? " — ganti file lama pas Simpan" : ""}</small></div><button type="button" class="btn btn-white btn-sm dok-file-clear" onclick="Dokumen.clearStagedFile()" title="Batal pilih file"><i class="fa-solid fa-xmark"></i></button></div>`;
            drop.style.display = "none";
        } else if (existing && existing.file_path) {
            const ext = Dokumen.extOf(existing);
            const [, icon] = Dokumen.fileIcon(ext);
            box.style.display = "";
            box.innerHTML = `<div class="dok-file-info"><i class="${icon}"></i><div style="min-width:0; flex:1"><div>File saat ini tersimpan</div><small>${escapeHtml(ext.toUpperCase() || "FILE")} · ${Dokumen.fmtBytes(existing.ukuran_bytes)} — drop/klik kotak di atas buat ganti</small></div></div>`;
            drop.style.display = "";
        } else {
            box.style.display = "none";
            box.innerHTML = "";
            drop.style.display = "";
        }
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (!OsisAuth.butuh("dokumen")) return;
        const nama = document.getElementById("dokNama").value.trim();
        const kategori = document.getElementById("dokKategori").value || "lainnya";
        let tahun = parseInt(document.getElementById("dokTahun").value, 10);
        if (!Number.isFinite(tahun)) tahun = new Date().getFullYear();
        const divisi = document.getElementById("dokDivisi").value || "";
        const deskripsi = document.getElementById("dokDeskripsi").value.trim();
        const id = document.getElementById("dokId").value ? parseInt(document.getElementById("dokId").value, 10) : null;
        if (!nama) { showToast("Nama dokumen wajib diisi", "error"); return; }
        if (!id && !Dokumen.stagedFile) { showToast("Pilih file dulu", "error"); return; }
        const cur0 = id ? Dokumen.cache.find(d => String(d.id) === String(id)) : null;
        const __spec = () => {
            const fl = Dokumen.stagedFile;
            return { modul: "dokumen", op: id ? "update" : "create",
                label: "Dokumen: " + String(nama).slice(0, 42),
                payload: { id: id || null,
                    f: { nama, kategori, tahun, divisi, deskripsi,
                        file_path: cur0 ? (cur0.file_path || "") : "",
                        file_type: cur0 ? Dokumen.extOf(cur0) : "",
                        mime: cur0 ? (cur0.mime || "") : "",
                        ukuran_bytes: cur0 ? (parseInt(cur0.ukuran_bytes, 10) || 0) : 0,
                        pengunggah: (typeof OsisAuth.displayName === "function" ? OsisAuth.displayName(u) : (u.nama || u.username || "")) || "" },
                    existingPath: cur0 ? (cur0.file_path || "") : "" },
                files: fl ? [{ slot: "file", file: fl, name: fl.name, type: fl.type }] : [],
                cacheKeys: ["dokumen"] };
        };
        const __sesudahAntre = () => {
            if (!id && typeof FormPersist !== "undefined") FormPersist.clear("dokumenForm");
            Dokumen.tutupForm();
        };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
            return;
        }

        const btn = document.getElementById("btnSimpanDokumen");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            let file_path = Dokumen.existingPath || "";
            let file_type = "";
            let mime = "";
            let ukuran_bytes = 0;
            if (id && !Dokumen.stagedFile) {
                const cur = Dokumen.cache.find(d => String(d.id) === String(id));
                file_type = cur ? Dokumen.extOf(cur) : "";
                mime = cur ? (cur.mime || "") : "";
                ukuran_bytes = cur ? (parseInt(cur.ukuran_bytes, 10) || 0) : 0;
            }
            if (Dokumen.stagedFile) {
                const fl = Dokumen.stagedFile;
                const ext = (fl.name.split(".").pop() || "bin").toLowerCase();
                const safeExt = ext.replace(/[^a-z0-9]/g, "") || "bin";
                const path = `dokumen/dokumen-${u.id}-${Date.now()}.${safeExt}`;
                await uploadFotoStorage(fl, path);
                if (file_path && file_path !== path) { try { await hapusFotoStorage(file_path); } catch {} }
                file_path = path;
                file_type = safeExt;
                mime = fl.type || "";
                ukuran_bytes = fl.size || 0;
            }
            const pengunggah = (typeof OsisAuth.displayName === "function" ? OsisAuth.displayName(u) : (u.nama || u.username || "")) || "";
            const f = { nama, kategori, tahun, divisi, deskripsi, file_path, file_type, mime, ukuran_bytes, pengunggah };
            if (id) {
                const cur = Dokumen.cache.find(d => String(d.id) === String(id));
                if (cur && cur.pengunggah && !f.pengunggah) f.pengunggah = cur.pengunggah;
                await updateDokumen(u.id, id, f);
                showToast("Dokumen diperbarui!", "success");
                catatAksi("simpan_dokumen", "edit " + String(nama || "").slice(0, 60));
            } else {
                const newId = await buatDokumen(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                if (typeof FormPersist !== "undefined") FormPersist.clear("dokumenForm");
                showToast("Dokumen tersimpan!", "success");
                catatAksi("simpan_dokumen", String(nama || "").slice(0, 60));
            }
            Dokumen.tutupForm();
            await Dokumen.muat(true);
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
                Outbox.sesudahAntre(__sesudahAntre);
                return;
            }
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async hapus(id, dariDetail) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("dokumen")) return;
        const item = Dokumen.cache.find(d => String(d.id) === String(id));
        const yakin = await showPopup(`Hapus dokumen "${item ? item.nama : ""}"? Dokumen ini akan dihapus dan tidak dapat dikembalikan.`, "confirm");
        if (!yakin) return;
        try {
            await hapusDokumen(u.id, id);
            if (item && item.file_path) { try { await hapusFotoStorage(item.file_path); } catch {} }
            if (dariDetail) Dokumen.tutupDetail();
            showToast("Dokumen dihapus", "success");
            await Dokumen.muat(true);
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ BUKA / DOWNLOAD / DETAIL ============
    fileUrl(d) {
        return d.file_path ? getFoto(d.file_path) : "";
    },

    download(id) {
        const d = typeof id === "object" ? id : Dokumen.cache.find(x => String(x.id) === String(id));
        if (!d) return;
        if (Dokumen.isContoh(d)) { showToast("Data contoh — belum ada file. Edit buat lampirkan file asli.", "info"); return; }
        const a = document.createElement("a");
        a.href = Dokumen.fileUrl(d);
        a.download = d.nama || "dokumen";
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    },

    downloadAktif() {
        const d = Dokumen.cache.find(x => String(x.id) === String(Dokumen.detailId));
        if (d) Dokumen.download(d);
    },

    detail(id) {
        const d = Dokumen.cache.find(x => String(x.id) === String(id));
        if (!d) return;
        Dokumen.detailId = id;
        const ext = Dokumen.extOf(d);
        const [cls, icon] = Dokumen.fileIcon(ext);
        const contoh = Dokumen.isContoh(d);
        const url = contoh ? "" : Dokumen.fileUrl(d);

        const tabBtn = document.getElementById("btnBukaTabDetail");
        if (tabBtn) {
            if (url) { tabBtn.href = url; tabBtn.style.display = ""; }
            else { tabBtn.href = "#"; tabBtn.style.display = "none"; }
        }

        let preview = "";
        if (contoh) {
            preview = `<div class="dok-preview-empty"><i class="fa-solid fa-file-circle-question"></i>Belum ada file fisik — ini data contoh tampilan. Klik <b>Edit</b> buat lampirkan file asli.</div>`;
        } else {
            const pv = Dokumen.bisaPreview(d);
            if (pv === "img") preview = `<div class="dok-preview-box media-muat media-muat-tinggi"><img src="${url}" alt="" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span></div>`;
            else if (pv === "pdf") preview = `<div class="dok-preview-box"><iframe src="${url}" title="Preview PDF"></iframe></div>`;
            else preview = `<div class="dok-preview-empty"><i class="${icon}"></i>Preview langsung belum tersedia untuk tipe <b>.${escapeHtml(ext || "?")}</b> — klik <b>Download</b> untuk membuka file.</div>`;
        }
        const info = (k, v) => `<div class="detail-kv"><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        document.getElementById("dokDetailBody").innerHTML = `
            <div class="dok-detail-head">
                <div class="dok-ico ${cls}"><i class="${icon}"></i><span class="dok-ext-pill">${escapeHtml((ext || "FILE").toUpperCase())}</span></div>
                <div style="flex:1; min-width:0">
                    <div class="dok-badges">
                        <span class="dok-kat-pill">${escapeHtml(Dokumen.katLabel(d.kategori))}</span>
                        <span class="dok-tahun-pill">${escapeHtml(String(d.tahun || "-"))}</span>
                        ${contoh ? `<span class="dok-tag-contoh">Contoh</span>` : ""}
                    </div>
                    <h4>${escapeHtml(d.nama || "Tanpa nama")}</h4>
                </div>
            </div>
            ${preview}
            <div class="detail-info">
                ${info("Kategori", escapeHtml(Dokumen.katLabel(d.kategori)))}
                ${info("Divisi", escapeHtml(d.divisi || "Umum"))}
                ${info("Ukuran", Dokumen.fmtBytes(d.ukuran_bytes))}
                ${info("Tahun", escapeHtml(String(d.tahun || "-")))}
                ${info("Pengunggah", escapeHtml(d.pengunggah || "-"))}
                ${info("Diunggah", Dokumen.fmtTanggal(d.created_at))}
            </div>
            ${d.deskripsi ? `<div class="detail-desc-wrap"><div class="detail-desc-lbl">Deskripsi</div><div class="detail-text">${escapeHtml(d.deskripsi)}</div></div>` : ""}`;
        document.getElementById("dokumenDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("dokumenDetail")?.classList.remove("open");
        if (!document.getElementById("dokumenForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Dokumen.detailId = null;
    }
};

document.addEventListener("DOMContentLoaded", () => Dokumen.init());
