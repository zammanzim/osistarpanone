// =========================================================================
// ANGGOTA & PENGURUS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/anggota.html — 3 tab:
// - Anggota: grid kartu per tahun + popup tambah/edit (foto drag&drop)
// - Pengurus: ketua/wakil + foto per periode (upsert by tahun)
// - Sekbid: grid kartu BPH + seksi bidang + popup tambah/edit
// Tulis langsung via helper db.js (pola lama, bukan RPC).
// =========================================================================

const Anggota = {
    tahun: null,
    tahunList: [],
    anggotaCache: [],
    pimpinanCache: [],
    sekbidCache: [],
    tab: "anggota",
    fotoTarget: null, // { kind: "pengurus", field } — buat 1 file input bersama
    pfFiles: {},      // staged pengurus: { ketua_foto: File, wakil_foto: File, foto_angkatan: File }
    pfPreview: {},    // preview URL per field (dibuat sekali pas pilih file)
    aggForm: { id: null, fotoPath: "", pendingFile: null, pendingUrl: null },
    sekForm: { id: null, fotoPath: "", pendingFile: null, pendingUrl: null },

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }

        // tabs
        document.querySelectorAll(".angg-tab").forEach(btn => {
            btn.addEventListener("click", () => Anggota.gantiTab(btn.dataset.tab));
        });

        // tahun + periode
        document.getElementById("pilihTahun")?.addEventListener("change", (e) => {
            Anggota.tahun = parseInt(e.target.value, 10);
            Anggota.renderAnggota();
            Anggota.renderPengurus();
        });
        document.getElementById("btnTambahTahun")?.addEventListener("click", () => Anggota.tambahPeriode());

        // pengurus
        document.getElementById("btnSimpanPimpinan")?.addEventListener("click", () => Anggota.simpanPengurus());
        ["pfKetua", "pfWakil", "pfAngkatan"].forEach(id => {
            const box = document.getElementById(id);
            if (!box) return;
            const field = id === "pfKetua" ? "ketua_foto" : id === "pfWakil" ? "wakil_foto" : "foto_angkatan";
            box.addEventListener("click", () => {
                Anggota.fotoTarget = { kind: "pengurus", field };
                document.getElementById("anggotaFile").click();
            });
            ["dragenter", "dragover"].forEach(ev => {
                box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add("dragover"); });
            });
            ["dragleave", "drop"].forEach(ev => {
                box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.remove("dragover"); });
            });
            box.addEventListener("drop", (e) => {
                const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (f) Anggota.handlePengurusFile(f, field);
            });
        });

        // 1 file input bersama buat kotak foto pengurus
        document.getElementById("anggotaFile")?.addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            const target = Anggota.fotoTarget;
            Anggota.fotoTarget = null;
            e.target.value = "";
            if (f && target && target.kind === "pengurus") Anggota.handlePengurusFile(f, target.field);
        });

        // grid anggota: tambah / edit / hapus (delegasi)
        document.getElementById("anggotaTable")?.addEventListener("click", (e) => {
            const add = e.target.closest("[data-agg-add]");
            if (add) { Anggota.bukaPopupAnggota(); return; }
            const edit = e.target.closest("[data-agg-edit]");
            if (edit) { Anggota.editAnggota(edit.dataset.aggEdit); return; }
            const del = e.target.closest("[data-agg-del]");
            if (del) { Anggota.hapusAnggota(del.dataset.aggDel); return; }
        });

        // grid sekbid: tambah / edit / hapus (delegasi)
        document.getElementById("sekbidTable")?.addEventListener("click", (e) => {
            const add = e.target.closest("[data-sek-add]");
            if (add) { Anggota.bukaPopupSekbid(); return; }
            const edit = e.target.closest("[data-sek-edit]");
            if (edit) { Anggota.editSekbid(edit.dataset.sekEdit); return; }
            const del = e.target.closest("[data-sek-del]");
            if (del) { Anggota.hapusSekbid(del.dataset.sekDel); return; }
        });

        // popup anggota: drop + input + simpan + backdrop/ESC
        Anggota.bindPopupDrop("anggotaDrop", "anggotaPopupFile", (f) => Anggota.handlePopupFile("agg", f));
        document.getElementById("btnSimpanAnggotaPopup")?.addEventListener("click", () => Anggota.simpanPopupAnggota());
        document.getElementById("anggotaPopup")?.addEventListener("click", (e) => {
            if (e.target.id === "anggotaPopup") Anggota.tutupPopupAnggota();
        });

        // popup sekbid: drop + input + simpan + backdrop/ESC
        Anggota.bindPopupDrop("sekbidDrop", "sekbidPopupFile", (f) => Anggota.handlePopupFile("sek", f));
        document.getElementById("btnSimpanSekbidPopup")?.addEventListener("click", () => Anggota.simpanPopupSekbid());
        document.getElementById("sekbidPopup")?.addEventListener("click", (e) => {
            if (e.target.id === "sekbidPopup") Anggota.tutupPopupSekbid();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("anggotaPopup")?.classList.contains("open")) Anggota.tutupPopupAnggota();
            if (document.getElementById("sekbidPopup")?.classList.contains("open")) Anggota.tutupPopupSekbid();
        });

        await Anggota.muatSemua();
    },

    bindPopupDrop(dropId, inputId, onFile) {
        const drop = document.getElementById(dropId);
        const input = document.getElementById(inputId);
        if (!drop || !input) return;
        drop.addEventListener("click", () => input.click());
        input.addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = "";
            if (f) onFile(f);
        });
        ["dragenter", "dragover"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
        });
        ["dragleave", "drop"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
        });
        drop.addEventListener("drop", (e) => {
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) onFile(f);
        });
    },

    // ============ MUAT ============
    async muatSemua() {
        try {
            const [pimp, agg, sek] = await Promise.all([getPimpinan(), getAnggota(), getSekbid()]);
            Anggota.pimpinanCache = pimp || [];
            Anggota.anggotaCache = agg || [];
            Anggota.sekbidCache = sek || [];
            // daftar tahun = gabungan pimpinan + anggota, terbaru dulu
            const setTahun = new Set();
            Anggota.pimpinanCache.forEach(p => { if (p.tahun) setTahun.add(parseInt(p.tahun, 10)); });
            Anggota.anggotaCache.forEach(a => { if (a.tahun) setTahun.add(parseInt(a.tahun, 10)); });
            Anggota.tahunList = [...setTahun].filter(Number.isFinite).sort((a, b) => b - a);
            if (!Anggota.tahunList.length) {
                Anggota.tahunList = [new Date().getFullYear()];
            }
            if (!Anggota.tahun || !Anggota.tahunList.includes(Anggota.tahun)) {
                Anggota.tahun = Anggota.tahunList[0];
            }
            Anggota._revokePfUrls();
            Anggota.pfFiles = {};
            Anggota.renderTahun();
            Anggota.renderAnggota();
            Anggota.renderPengurus();
            Anggota.renderSekbid();
        } catch (err) {
            console.error(err);
            document.getElementById("anggotaTable").innerHTML = `<div class="pesan-empty">Gagal memuat data.</div>`;
            showToast("Gagal memuat: " + err.message, "error");
        }
    },

    renderTahun() {
        const sel = document.getElementById("pilihTahun");
        if (!sel) return;
        sel.innerHTML = Anggota.tahunList.map(t => `<option value="${t}" ${t === Anggota.tahun ? "selected" : ""}>Periode ${t}</option>`).join("");
        const pt = document.getElementById("pengurusTahun");
        if (pt) pt.textContent = Anggota.tahun;
    },

    gantiTab(tab) {
        Anggota.tab = tab;
        document.querySelectorAll(".angg-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
        document.getElementById("panelAnggota").style.display = tab === "anggota" ? "" : "none";
        document.getElementById("panelPengurus").style.display = tab === "pengurus" ? "" : "none";
        document.getElementById("panelSekbid").style.display = tab === "sekbid" ? "" : "none";
        document.getElementById("pilihTahun").style.visibility = tab === "sekbid" ? "hidden" : "";
        document.getElementById("btnTambahTahun").style.visibility = tab === "sekbid" ? "hidden" : "";
    },

    async tambahPeriode() {
        const res = await showPopup("Tambah periode", "form", {
            title: "Periode Baru",
            fields: [{ name: "tahun", label: "Tahun (cth: 2026)", type: "text", placeholder: "2026", value: "" }]
        });
        if (!res) return;
        const thn = parseInt(String(res.tahun || "").trim(), 10);
        if (!Number.isFinite(thn) || thn < 2000 || thn > 2100) {
            showToast("Tahun 2000-2100", "error");
            return;
        }
        if (!Anggota.tahunList.includes(thn)) {
            Anggota.tahunList.push(thn);
            Anggota.tahunList.sort((a, b) => b - a);
        }
        Anggota.tahun = thn;
        Anggota._revokePfUrls();
        Anggota.pfFiles = {};
        Anggota.renderTahun();
        Anggota.renderAnggota();
        Anggota.renderPengurus();
        Anggota.gantiTab("pengurus");
        showToast(`Periode ${thn} siap — isi pengurus lalu Simpan`, "info");
    },

    // ============ ANGGOTA (kartu + popup) ============
    rowsTahun() {
        return (Anggota.anggotaCache || [])
            .filter(a => parseInt(a.tahun, 10) === Anggota.tahun)
            .sort((a, b) => (a.urutan || 99) - (b.urutan || 99));
    },

    initial(nama) {
        const c = String(nama || "?").trim().charAt(0).toUpperCase();
        return c || "?";
    },

    renderAnggota() {
        const wrap = document.getElementById("anggotaTable");
        if (!wrap) return;
        const rows = Anggota.rowsTahun();
        const cnt = document.getElementById("anggotaCount");
        if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : "";
        const cards = rows.map(a => {
            const foto = a.foto
                ? `<img src="${getFoto(a.foto)}" alt="" loading="lazy" onerror="this.remove()">`
                : Anggota.initial(a.nama);
            return `
                <div class="angg-card">
                    <div class="angg-foto">${foto}</div>
                    <h4>${escapeHtml(a.nama || "-")}</h4>
                    <span class="jabatan">${escapeHtml(a.jabatan || "-")}</span>
                    <div class="angg-actions">
                        <button class="btn btn-white btn-sm" data-agg-edit="${a.id}"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-red btn-sm" data-agg-del="${a.id}"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>`;
        }).join("");
        wrap.innerHTML = `
            <div class="angg-grid">
                <div class="angg-card angg-add" data-agg-add><i class="fa-solid fa-plus"></i><span>Tambah Anggota</span></div>
                ${cards || ""}
            </div>
            ${rows.length ? "" : `<div class="pesan-empty" style="margin-top:10px">Belum ada anggota periode ${Anggota.tahun}.</div>`}`;
    },

    bukaPopupAnggota() {
        Anggota._revokePopupUrl("agg");
        Anggota.aggForm = { id: null, fotoPath: "", pendingFile: null, pendingUrl: null };
        document.getElementById("anggotaPopupId").value = "";
        document.getElementById("anggotaNama").value = "";
        document.getElementById("anggotaJabatan").value = "";
        // urutan otomatis: max + 1 biar di paling bawah
        const rows = Anggota.rowsTahun();
        const nextNo = rows.length ? Math.max(...rows.map(a => parseInt(a.urutan, 10) || 0)) + 1 : 1;
        document.getElementById("anggotaUrutan").value = String(Math.min(nextNo, 999));
        document.getElementById("anggotaPopupTitle").textContent = "Tambah Anggota";
        Anggota.renderPopupFoto("agg");
        document.getElementById("anggotaPopup").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("anggotaNama")?.focus(), 80);
    },

    editAnggota(id) {
        const item = Anggota.anggotaCache.find(a => String(a.id) === String(id));
        if (!item) return;
        Anggota._revokePopupUrl("agg");
        Anggota.aggForm = { id, fotoPath: item.foto || "", pendingFile: null, pendingUrl: null };
        document.getElementById("anggotaPopupId").value = id;
        document.getElementById("anggotaNama").value = item.nama || "";
        document.getElementById("anggotaJabatan").value = item.jabatan || "";
        document.getElementById("anggotaUrutan").value = item.urutan ?? 99;
        document.getElementById("anggotaPopupTitle").textContent = "Edit Anggota";
        Anggota.renderPopupFoto("agg");
        document.getElementById("anggotaPopup").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("anggotaNama")?.focus(), 80);
    },

    tutupPopupAnggota() {
        document.getElementById("anggotaPopup")?.classList.remove("open");
        document.body.style.overflow = "";
        Anggota._revokePopupUrl("agg");
        Anggota.aggForm = { id: null, fotoPath: "", pendingFile: null, pendingUrl: null };
    },

    handlePopupFile(which, file) {
        if (!file || !file.type || !file.type.startsWith("image/")) {
            showToast("File harus gambar", "error");
            return;
        }
        Anggota._revokePopupUrl(which);
        const form = which === "agg" ? Anggota.aggForm : Anggota.sekForm;
        form.pendingFile = file;
        form.pendingUrl = URL.createObjectURL(file);
        Anggota.renderPopupFoto(which);
    },

    _revokePopupUrl(which) {
        const form = which === "agg" ? Anggota.aggForm : Anggota.sekForm;
        if (form && form.pendingUrl) { try { URL.revokeObjectURL(form.pendingUrl); } catch {} }
        if (form) { form.pendingFile = null; form.pendingUrl = null; }
    },

    renderPopupFoto(which) {
        const isAgg = which === "agg";
        const drop = document.getElementById(isAgg ? "anggotaDrop" : "sekbidDrop");
        const inner = document.getElementById(isAgg ? "anggotaDropInner" : "sekbidDropInner");
        const form = isAgg ? Anggota.aggForm : Anggota.sekForm;
        if (!drop) return;
        drop.querySelectorAll("img").forEach(i => i.remove());
        let src = "";
        if (form.pendingFile && form.pendingUrl) src = form.pendingUrl;
        else if (form.fotoPath) src = getFoto(form.fotoPath);
        if (src) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            drop.prepend(img);
            if (inner) inner.style.display = "none";
        } else if (inner) {
            inner.style.display = "";
        }
    },

    async simpanPopupAnggota() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const nama = document.getElementById("anggotaNama").value.trim();
        const jabatan = document.getElementById("anggotaJabatan").value.trim();
        let urutan = parseInt(document.getElementById("anggotaUrutan").value, 10);
        if (!Number.isFinite(urutan) || urutan < 1) urutan = 99;
        const id = document.getElementById("anggotaPopupId").value || null;
        if (!nama) { showToast("Nama wajib diisi", "error"); return; }

        const btn = document.getElementById("btnSimpanAnggotaPopup");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            let foto = Anggota.aggForm.fotoPath || "";
            if (Anggota.aggForm.pendingFile) {
                const f = Anggota.aggForm.pendingFile;
                const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
                const path = `anggota/anggota-${Anggota.tahun}-${Date.now()}.${ext}`;
                await uploadFotoStorage(f, path);
                if (foto && foto !== path) { try { await hapusFotoStorage(foto); } catch {} }
                foto = path;
            }
            const colFotoMissing = (e) => String((e && e.message) || e || "").match(/foto/i);
            if (id) {
                try {
                    await updateAnggota(id, { nama, jabatan, urutan, foto });
                } catch (e) {
                    // kolom foto belum ada (migrasi belum di-run) — simpan tanpa foto
                    if (!foto || !colFotoMissing(e)) throw e;
                    await updateAnggota(id, { nama, jabatan, urutan });
                    showToast("Tersimpan tanpa foto (run migrasi blok 13 dulu)", "info");
                    Anggota.tutupPopupAnggota();
                    const fresh0 = await getAnggota();
                    Anggota.anggotaCache = fresh0 || [];
                    Anggota.renderAnggota();
                    return;
                }
                showToast("Anggota diperbarui!", "success");
            } else {
                try {
                    const { error } = await supa.from("anggota").insert({ tahun: Anggota.tahun, nama, jabatan, urutan, foto });
                    if (error) throw error;
                } catch (e) {
                    if (!foto || !colFotoMissing(e)) throw e;
                    const { error } = await supa.from("anggota").insert({ tahun: Anggota.tahun, nama, jabatan, urutan });
                    if (error) throw error;
                    showToast("Ditambah tanpa foto (run migrasi blok 13 dulu)", "info");
                    Anggota.tutupPopupAnggota();
                    const fresh0 = await getAnggota();
                    Anggota.anggotaCache = fresh0 || [];
                    Anggota.renderAnggota();
                    return;
                }
                Cache.del("anggota");
                showToast("Anggota ditambah!", "success");
            }
            Anggota.tutupPopupAnggota();
            const fresh = await getAnggota();
            Anggota.anggotaCache = fresh || [];
            Anggota.renderAnggota();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async hapusAnggota(id) {
        const item = Anggota.anggotaCache.find(a => String(a.id) === String(id));
        const yakin = await showPopup(`Hapus ${item ? item.nama : "anggota ini"} dari periode ${Anggota.tahun}?`, "confirm");
        if (!yakin) return;
        try {
            await hapusAnggota(id);
            if (item && item.foto) { try { await hapusFotoStorage(item.foto); } catch {} }
            Anggota.anggotaCache = Anggota.anggotaCache.filter(a => String(a.id) !== String(id));
            showToast("Anggota dihapus", "success");
            Anggota.renderAnggota();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ PENGURUS ============
    pimpTahun() {
        return (Anggota.pimpinanCache || []).find(p => parseInt(p.tahun, 10) === Anggota.tahun) || null;
    },

    renderPengurus() {
        const p = Anggota.pimpTahun() || {};
        document.getElementById("pimpKetuaNama").value = p.ketua_nama || "";
        document.getElementById("pimpWakilNama").value = p.wakil_nama || "";
        const pt = document.getElementById("pengurusTahun");
        if (pt) pt.textContent = Anggota.tahun;
        Anggota.renderPfBox("pfKetua", "ketua_foto", p.ketua_foto);
        Anggota.renderPfBox("pfWakil", "wakil_foto", p.wakil_foto);
        Anggota.renderPfBox("pfAngkatan", "foto_angkatan", p.foto_angkatan);
    },

    renderPfBox(boxId, field, savedPath) {
        const box = document.getElementById(boxId);
        if (!box) return;
        box.querySelectorAll("img").forEach(i => i.remove());
        let src = "";
        if (Anggota.pfFiles[field]) src = Anggota.pfPreview[field] || "";
        else if (savedPath) src = getFoto(savedPath);
        const label = box.querySelector("span");
        const icon = box.querySelector("i");
        if (src) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            box.prepend(img);
            if (label) label.style.display = "none";
            if (icon) icon.style.display = "none";
        } else {
            if (label) label.style.display = "";
            if (icon) icon.style.display = "";
        }
    },

    handlePengurusFile(file, field) {
        if (!file || !file.type || !file.type.startsWith("image/")) {
            showToast("File harus gambar", "error");
            return;
        }
        if (Anggota.pfPreview[field]) {
            try { URL.revokeObjectURL(Anggota.pfPreview[field]); } catch {}
        }
        Anggota.pfFiles[field] = file;
        Anggota.pfPreview[field] = URL.createObjectURL(file);
        const p = Anggota.pimpTahun() || {};
        Anggota.renderPfBox(
            field === "ketua_foto" ? "pfKetua" : field === "wakil_foto" ? "pfWakil" : "pfAngkatan",
            field,
            p[field]
        );
        showToast("Foto staged — klik Simpan Pengurus", "info");
    },

    async simpanPengurus() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const ketuaNama = document.getElementById("pimpKetuaNama").value.trim();
        const wakilNama = document.getElementById("pimpWakilNama").value.trim();
        const lama = Anggota.pimpTahun() || {};
        const btn = document.getElementById("btnSimpanPimpinan");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            const next = {
                tahun: Anggota.tahun,
                ketua_nama: ketuaNama,
                wakil_nama: wakilNama,
                ketua_foto: lama.ketua_foto || "",
                wakil_foto: lama.wakil_foto || "",
                foto_angkatan: lama.foto_angkatan || ""
            };
            const up = async (field, prefix, folder) => {
                const f = Anggota.pfFiles[field];
                if (!f) return;
                const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
                const path = `${folder}/${prefix}${Anggota.tahun}-${Date.now()}.${ext}`;
                await uploadFotoStorage(f, path);
                if (next[field] && next[field] !== path) { try { await hapusFotoStorage(next[field]); } catch {} }
                next[field] = path;
            };
            await up("ketua_foto", "ketos", "pimpinan");
            await up("wakil_foto", "waketos", "pimpinan");
            await up("foto_angkatan", "foto-", "angkatan");
            await simpanPimpinan(next);
            showToast("Pengurus tersimpan!", "success");
            Anggota.pfFiles = {};
            Anggota._revokePfUrls();
            const fresh = await getPimpinan();
            Anggota.pimpinanCache = fresh || [];
            if (!Anggota.tahunList.includes(Anggota.tahun)) {
                Anggota.tahunList.push(Anggota.tahun);
                Anggota.tahunList.sort((a, b) => b - a);
                Anggota.renderTahun();
            }
            Anggota.renderPengurus();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Pengurus'; }
        }
    },

    // ============ SEKBID (kartu + popup) ============
    renderSekbid() {
        const wrap = document.getElementById("sekbidTable");
        if (!wrap) return;
        const data = [...(Anggota.sekbidCache || [])].sort((a, b) => {
            const ka = a.kategori === "BPH" ? 0 : 1;
            const kb = b.kategori === "BPH" ? 0 : 1;
            if (ka !== kb) return ka - kb;
            return (a.urutan || 99) - (b.urutan || 99);
        });
        const cnt = document.getElementById("sekbidCount");
        if (cnt) cnt.textContent = data.length ? `(${data.length})` : "";
        let lastKat = "";
        let html = `<div class="angg-grid"><div class="angg-card angg-add" data-sek-add><i class="fa-solid fa-plus"></i><span>Tambah Sekbid</span></div>`;
        data.forEach(s => {
            if (s.kategori !== lastKat) {
                lastKat = s.kategori;
                html += `</div><div class="angg-grup">${escapeHtml(s.kategori === "BPH" ? "Badan Pengurus Harian" : "Seksi Bidang")}</div><div class="angg-grid">`;
            }
            const foto = s.foto
                ? `<img src="${getFoto(s.foto)}" alt="" loading="lazy" onerror="this.remove()">`
                : `<i class="fa-solid fa-layer-group"></i>`;
            html += `
                <div class="angg-card">
                    <div class="angg-foto-l">${foto}</div>
                    <h4>${escapeHtml(s.nama || "-")}</h4>
                    <span class="jabatan">${escapeHtml(s.kategori || "SEKBID")}</span>
                    ${s.deskripsi ? `<p>${escapeHtml(s.deskripsi)}</p>` : ""}
                    <div class="angg-actions">
                        <button class="btn btn-white btn-sm" data-sek-edit="${s.id}"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-red btn-sm" data-sek-del="${s.id}"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>`;
        });
        html += `</div>`;
        wrap.innerHTML = html || `<div class="pesan-empty">Belum ada data sekbid.</div>`;
    },

    bukaPopupSekbid() {
        Anggota._revokePopupUrl("sek");
        Anggota.sekForm = { id: null, fotoPath: "", pendingFile: null, pendingUrl: null };
        document.getElementById("sekbidPopupId").value = "";
        document.getElementById("sekbidNama").value = "";
        document.getElementById("sekbidKategori").value = "SEKBID";
        document.getElementById("sekbidIcon").value = "";
        document.getElementById("sekbidDeskripsi").value = "";
        const list = Anggota.sekbidCache || [];
        const nextNo = list.length ? Math.max(...list.map(s => parseInt(s.urutan, 10) || 0)) + 1 : 1;
        document.getElementById("sekbidUrutan").value = String(Math.min(nextNo, 999));
        document.getElementById("sekbidPopupTitle").textContent = "Tambah Sekbid";
        Anggota.renderPopupFoto("sek");
        document.getElementById("sekbidPopup").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("sekbidNama")?.focus(), 80);
    },

    editSekbid(id) {
        const item = Anggota.sekbidCache.find(s => String(s.id) === String(id));
        if (!item) return;
        Anggota._revokePopupUrl("sek");
        Anggota.sekForm = { id, fotoPath: item.foto || "", pendingFile: null, pendingUrl: null };
        document.getElementById("sekbidPopupId").value = id;
        document.getElementById("sekbidNama").value = item.nama || "";
        document.getElementById("sekbidKategori").value = item.kategori || "SEKBID";
        document.getElementById("sekbidIcon").value = item.icon || "";
        document.getElementById("sekbidDeskripsi").value = item.deskripsi || "";
        document.getElementById("sekbidUrutan").value = item.urutan ?? 99;
        document.getElementById("sekbidPopupTitle").textContent = "Edit Sekbid";
        Anggota.renderPopupFoto("sek");
        document.getElementById("sekbidPopup").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("sekbidNama")?.focus(), 80);
    },

    tutupPopupSekbid() {
        document.getElementById("sekbidPopup")?.classList.remove("open");
        document.body.style.overflow = "";
        Anggota._revokePopupUrl("sek");
        Anggota.sekForm = { id: null, fotoPath: "", pendingFile: null, pendingUrl: null };
    },

    async simpanPopupSekbid() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const nama = document.getElementById("sekbidNama").value.trim();
        const kategori = document.getElementById("sekbidKategori").value;
        const icon = document.getElementById("sekbidIcon").value.trim() || "fa-solid fa-users";
        const deskripsi = document.getElementById("sekbidDeskripsi").value.trim();
        let urutan = parseInt(document.getElementById("sekbidUrutan").value, 10);
        if (!Number.isFinite(urutan) || urutan < 1) urutan = 99;
        const id = document.getElementById("sekbidPopupId").value || null;
        if (!nama) { showToast("Nama wajib diisi", "error"); return; }

        const btn = document.getElementById("btnSimpanSekbidPopup");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            let foto = Anggota.sekForm.fotoPath || "";
            if (Anggota.sekForm.pendingFile) {
                const f = Anggota.sekForm.pendingFile;
                const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
                const path = `sekbid/sekbid-${Date.now()}.${ext}`;
                await uploadFotoStorage(f, path);
                if (foto && foto !== path) { try { await hapusFotoStorage(foto); } catch {} }
                foto = path;
            }
            if (id) {
                await updateSekbid(id, { nama, kategori, icon, deskripsi, urutan, foto });
                showToast("Sekbid diperbarui!", "success");
            } else {
                await tambahSekbid({ nama, kategori, icon, deskripsi, urutan, foto });
                showToast("Sekbid ditambah!", "success");
            }
            Anggota.tutupPopupSekbid();
            const fresh = await getSekbid();
            Anggota.sekbidCache = fresh || [];
            Anggota.renderSekbid();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async hapusSekbid(id) {
        const item = Anggota.sekbidCache.find(s => String(s.id) === String(id));
        try {
            const all = await getAllAgenda();
            const punya = (all || []).filter(a => String(a.sekbid_id) === String(id));
            if (punya.length) {
                showPopup(`Sekbid ini punya ${punya.length} agenda. Hapus/pindahkan agendanya dulu di halaman Agenda.`, "error");
                return;
            }
        } catch {}
        const yakin = await showPopup(`Hapus ${item ? item.nama : "sekbid ini"}?`, "confirm");
        if (!yakin) return;
        try {
            await hapusSekbid(id);
            if (item && item.foto) { try { await hapusFotoStorage(item.foto); } catch {} }
            Anggota.sekbidCache = Anggota.sekbidCache.filter(s => String(s.id) !== String(id));
            showToast("Sekbid dihapus", "success");
            Anggota.renderSekbid();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    _revokePfUrls() {
        Object.values(Anggota.pfPreview || {}).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        Anggota.pfPreview = {};
    }
};

document.addEventListener("DOMContentLoaded", () => Anggota.init());
