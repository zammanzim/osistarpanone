// =========================================================================
// DOKUMEN OSIS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/dokumen.html — arsip digital: upload, cari, filter, sort,
// buka (preview PDF/gambar), download, edit, hapus. File fisik di bucket
// osis-foto folder dokumen/. Visual ikut design system Agenda.
// =========================================================================

const Dokumen = {
    cache: [],
    filter: { q: "", kategori: "", tahun: "", divisi: "", sort: "baru" },
    editingId: null,
    detailId: null,
    stagedFile: null,   // File baru di popup (upload atau edit)
    existingPath: "",   // file_path lama pas edit

    KATEGORI: [
        ["semua", "Semua Dokumen", "fa-solid fa-folder"],
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

        document.getElementById("btnUploadDokumen")?.addEventListener("click", () => Dokumen.bukaForm());
        document.getElementById("btnBatalDokumen")?.addEventListener("click", () => Dokumen.tutupForm());
        document.getElementById("btnSimpanDokumen")?.addEventListener("click", () => Dokumen.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Dokumen.resetFilter());
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

        await Dokumen.muat();
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

    // ============ DATA ============
    async muat() {
        const listEl = document.getElementById("dokumenList");
        if (listEl) listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat dokumen...</div>`;
        try {
            const cached = Cache.get("dokumen");
            if (cached) {
                Dokumen.cache = cached;
                Dokumen.render();
                getDokumen().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("dokumen", fresh);
                        Dokumen.cache = fresh || [];
                        Dokumen.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getDokumen();
            Cache.set("dokumen", data);
            Dokumen.cache = data || [];
            Dokumen.render();
        } catch (err) {
            console.error(err);
            if (listEl) listEl.innerHTML = `<div class="pesan-empty">Gagal memuat dokumen.</div>`;
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

        // opsi tahun dinamis
        const years = [...new Set(all.map(d => parseInt(d.tahun, 10)).filter(Number.isFinite))].sort((a, b) => b - a);
        const ft = document.getElementById("filterTahun");
        if (ft) {
            const cur = ft.value || Dokumen.filter.tahun || "";
            ft.innerHTML = `<option value="">Semua</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
            ft.value = cur;
            Dokumen.filter.tahun = cur;
        }

        // folder + count
        const fg = document.getElementById("folderGrid");
        if (fg) {
            const katAktif = Dokumen.filter.kategori || "semua";
            fg.innerHTML = Dokumen.KATEGORI.map(k => {
                const n = k[0] === "semua" ? all.length : all.filter(d => (d.kategori || "") === k[0]).length;
                return `<button class="folder-card ${katAktif === k[0] ? "active" : ""}" onclick="Dokumen.pilihKategori('${k[0]}')"><div class="fic"><i class="${k[2]}"></i></div><b>${k[1]}</b><small>${n} dokumen</small></button>`;
            }).join("");
        }

        // terbaru (5, yang ada file beneran dulu)
        const tb = document.getElementById("dokTerbaru");
        if (tb) {
            const latest = [...all].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 5);
            tb.innerHTML = latest.length ? latest.map(d => {
                const [, icon] = Dokumen.fileIcon(Dokumen.extOf(d));
                const tgl = d.created_at ? new Date(d.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "-";
                return `<div class="terbaru-item" onclick="Dokumen.detail(${d.id})"><i class="${icon}"></i><span>${escapeHtml(d.nama || "Tanpa nama")}</span><small>${tgl}</small></div>`;
            }).join("") : `<div class="pesan-empty" style="color:#fff">Belum ada dokumen.</div>`;
        }

        // list
        const listEl = document.getElementById("dokumenList");
        if (!listEl) return;
        const data = Dokumen.dataTampil();
        if (!all.length) {
            listEl.innerHTML = `<div class="pesan-empty" style="background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:28px 16px; text-align:center"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-folder-open" style="color:var(--red)"></i></div><b>Belum ada dokumen</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Dokumen pada arsip ini akan muncul di sini.</p><button class="btn btn-red btn-sm" onclick="Dokumen.bukaForm()"><i class="fa-solid fa-plus"></i> Upload Dokumen</button></div>`;
            return;
        }
        if (!data.length) {
            const kat = Dokumen.filter.kategori && Dokumen.filter.kategori !== "semua" ? ` pada kategori <b>${escapeHtml(Dokumen.katLabel(Dokumen.filter.kategori))}</b>` : "";
            listEl.innerHTML = `<div class="pesan-empty" style="background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:28px 16px; text-align:center"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-folder-open" style="color:var(--red)"></i></div><b>Belum ada dokumen</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Dokumen${kat} akan muncul di sini. <a href="#" onclick="event.preventDefault(); Dokumen.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></p><button class="btn btn-red btn-sm" onclick="Dokumen.bukaForm()"><i class="fa-solid fa-plus"></i> Upload Dokumen</button></div>`;
            return;
        }
        listEl.innerHTML = data.map(d => {
            const ext = Dokumen.extOf(d);
            const [cls, icon] = Dokumen.fileIcon(ext);
            const contoh = Dokumen.isContoh(d);
            return `
                <div class="dok-item">
                    <div class="dok-ico ${cls}"><i class="${icon}"></i></div>
                    <div class="dok-body">
                        <h4>${escapeHtml(d.nama || "Tanpa nama")}${contoh ? `<span class="dok-tag-contoh">Contoh</span>` : ""}</h4>
                        <div class="dok-meta"><b>${escapeHtml(Dokumen.katLabel(d.kategori))}</b> · ${escapeHtml(String(d.tahun || "-"))} · Divisi ${escapeHtml(d.divisi || "-")}</div>
                        <div class="dok-meta">Diupload ${Dokumen.fmtTanggal(d.created_at)} · ${Dokumen.fmtBytes(d.ukuran_bytes)} · oleh ${escapeHtml(d.pengunggah || "-")}</div>
                        <div class="dok-actions">
                            <button class="btn btn-white btn-sm" onclick="Dokumen.detail(${d.id})"><i class="fa-solid fa-eye"></i> Buka</button>
                            <button class="btn btn-white btn-sm" onclick="Dokumen.download(${d.id})"><i class="fa-solid fa-download"></i> Download</button>
                            <button class="btn btn-white btn-sm" onclick="Dokumen.edit(${d.id})"><i class="fa-solid fa-pen"></i></button>
                            <button class="btn btn-red btn-sm" onclick="Dokumen.hapus(${d.id})"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                    </div>
                </div>`;
        }).join("");
    },

    pilihKategori(k) {
        Dokumen.filter.kategori = (k === "semua") ? "" : k;
        const fk = document.getElementById("filterKategori");
        if (fk) fk.value = Dokumen.filter.kategori;
        Dokumen.render();
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
        Dokumen.bacaFilter();
    },

    // ============ FORM ============
    bukaForm() {
        Dokumen.editingId = null;
        Dokumen.stagedFile = null;
        Dokumen.existingPath = "";
        document.getElementById("dokId").value = "";
        document.getElementById("dokNama").value = "";
        document.getElementById("dokKategori").value = (Dokumen.filter.kategori && Dokumen.filter.kategori !== "semua") ? Dokumen.filter.kategori : "proposal";
        document.getElementById("dokTahun").value = String(new Date().getFullYear());
        document.getElementById("dokDivisi").value = "";
        document.getElementById("dokDeskripsi").value = "";
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
        const fi = document.getElementById("dokFile");
        if (fi) fi.value = "";
        document.getElementById("dokumenFormTitle").textContent = "Edit Dokumen";
        Dokumen.renderFileInfo(item);
        document.getElementById("dokumenForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("dokNama")?.focus(), 80);
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
            box.innerHTML = `<div class="dok-file-info"><i class="${icon}"></i><div style="min-width:0"><div style="overflow-wrap:anywhere">${escapeHtml(f.name)}</div><small>${ext.toUpperCase() || "FILE"} · ${Dokumen.fmtBytes(f.size)}${Dokumen.editingId ? " — ganti file lama pas Simpan" : ""}</small></div></div>`;
            drop.style.display = "none";
        } else if (existing && existing.file_path) {
            const ext = Dokumen.extOf(existing);
            const [, icon] = Dokumen.fileIcon(ext);
            box.style.display = "";
            box.innerHTML = `<div class="dok-file-info"><i class="${icon}"></i><div style="min-width:0"><div>File saat ini tersimpan</div><small>${ext.toUpperCase() || "FILE"} · ${Dokumen.fmtBytes(existing.ukuran_bytes)} — drop/klik kotak di atas buat ganti</small></div></div>`;
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
        const nama = document.getElementById("dokNama").value.trim();
        const kategori = document.getElementById("dokKategori").value || "lainnya";
        let tahun = parseInt(document.getElementById("dokTahun").value, 10);
        if (!Number.isFinite(tahun)) tahun = new Date().getFullYear();
        const divisi = document.getElementById("dokDivisi").value || "";
        const deskripsi = document.getElementById("dokDeskripsi").value.trim();
        const id = document.getElementById("dokId").value ? parseInt(document.getElementById("dokId").value, 10) : null;
        if (!nama) { showToast("Nama dokumen wajib diisi", "error"); return; }
        if (!id && !Dokumen.stagedFile) { showToast("Pilih file dulu", "error"); return; }

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
            } else {
                const newId = await buatDokumen(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Dokumen tersimpan!", "success");
            }
            Dokumen.tutupForm();
            await Dokumen.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async hapus(id, dariDetail) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Dokumen.cache.find(d => String(d.id) === String(id));
        const yakin = await showPopup(`Hapus dokumen "${item ? item.nama : ""}"? Dokumen ini akan dihapus dan tidak dapat dikembalikan.`, "confirm");
        if (!yakin) return;
        try {
            await hapusDokumen(u.id, id);
            if (item && item.file_path) { try { await hapusFotoStorage(item.file_path); } catch {} }
            if (dariDetail) Dokumen.tutupDetail();
            showToast("Dokumen dihapus", "success");
            await Dokumen.muat();
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
        const [, icon] = Dokumen.fileIcon(ext);
        const contoh = Dokumen.isContoh(d);
        let preview = "";
        if (contoh) {
            preview = `<div class="detail-text" style="opacity:.7">Belum ada file — data contoh untuk uji tampilan. Klik Edit buat lampirkan file asli.</div>`;
        } else {
            const pv = Dokumen.bisaPreview(d);
            const url = Dokumen.fileUrl(d);
            if (pv === "img") preview = `<div class="dok-preview-box"><img src="${url}" alt=""></div>`;
            else if (pv === "pdf") preview = `<div class="dok-preview-box"><iframe src="${url}" title="Preview PDF"></iframe></div>`;
            else preview = `<div class="detail-text" style="opacity:.7">Preview tidak tersedia untuk tipe .${escapeHtml(ext || "?")} — klik Download buat buka file.</div>`;
        }
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        document.getElementById("dokDetailBody").innerHTML = `
            <h4 style="font-size:1rem; font-weight:900; overflow-wrap:anywhere"><i class="${icon}" style="color:var(--red); margin-right:6px"></i>${escapeHtml(d.nama || "Tanpa nama")}${contoh ? `<span class="dok-tag-contoh">Contoh</span>` : ""}</h4>
            ${preview}
            <div class="detail-info">
                ${info("Tipe", (ext || "-").toUpperCase())}
                ${info("Ukuran", Dokumen.fmtBytes(d.ukuran_bytes))}
                ${info("Kategori", escapeHtml(Dokumen.katLabel(d.kategori)))}
                ${info("Tahun", escapeHtml(String(d.tahun || "-")))}
                ${info("Divisi", escapeHtml(d.divisi || "-"))}
                ${info("Pengunggah", escapeHtml(d.pengunggah || "-"))}
                ${info("Tanggal Upload", Dokumen.fmtTanggal(d.created_at))}
            </div>
            ${d.deskripsi ? `<div class="detail-text">${escapeHtml(d.deskripsi)}</div>` : ""}`;
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
