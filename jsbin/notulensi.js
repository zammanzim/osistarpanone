// =========================================================================
// NOTULENSI RAPAT — halaman khusus OSIS (folder /osis)
// Dipakai di osis/notulensi.html — catat, lihat, edit, hapus, cetak
// notulensi rapat. Visual ikut design system halaman Agenda.
// Lampiran drag & drop kayak agenda. Cetak/export via print CSS.
// =========================================================================

const Notulensi = {
    cache: [],
    filter: { q: "", divisi: "", status: "", tanggal: "" },
    editingId: null,
    detailId: null,
    pendingFiles: [],
    existingLampiran: [],
    _previewUrls: [],

    STATUS_LABEL: { rencana: "Rencana", selesai: "Selesai", belum_tindaklanjut: "Belum TL", batal: "Batal" },

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
            const nd = document.getElementById("notDivisi");
            if (nd) nd.innerHTML = `<option value="">— Pilih —</option>` + opts;
        } catch {}

        document.getElementById("btnBuatNotulensi")?.addEventListener("click", () => Notulensi.bukaForm());
        document.getElementById("btnBatalNotulensi")?.addEventListener("click", () => Notulensi.tutupForm());
        document.getElementById("btnSimpanNotulensi")?.addEventListener("click", () => Notulensi.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Notulensi.resetFilter());
        document.getElementById("btnTambahTl")?.addEventListener("click", () => Notulensi.tambahTlRow());
        document.getElementById("btnCetakNotulensi")?.addEventListener("click", () => Notulensi.cetak());
        document.getElementById("btnPdfNotulensi")?.addEventListener("click", () => Notulensi.exportPdf());

        ["filterQ", "filterDivisi", "filterStatus", "filterTanggal"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Notulensi.bacaFilter());
        });

        // lampiran drag & drop (pola agenda)
        const drop = document.getElementById("notDrop");
        const fileInput = document.getElementById("notLampiran");
        if (drop && fileInput) {
            drop.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", (e) => {
                Notulensi.handleFiles(e.target.files);
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
                if (files && files.length) Notulensi.handleFiles(files);
            });
        }

        // backdrop + ESC
        ["notulensiForm", "notulensiDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "notulensiForm") Notulensi.tutupForm();
                    else Notulensi.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("notulensiForm")?.classList.contains("open")) Notulensi.tutupForm();
            if (document.getElementById("notulensiDetail")?.classList.contains("open")) Notulensi.tutupDetail();
        });

        await Notulensi.muat();
    },

    // ============ DATA ============
    async muat() {
        const listEl = document.getElementById("notulensiList");
        if (listEl) listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat notulensi...</div>`;
        try {
            const cached = Cache.get("notulensi");
            if (cached) {
                Notulensi.cache = cached;
                Notulensi.render();
                getNotulensi().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("notulensi", fresh);
                        Notulensi.cache = fresh || [];
                        Notulensi.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getNotulensi();
            Cache.set("notulensi", data);
            Notulensi.cache = data || [];
            Notulensi.render();
        } catch (err) {
            console.error(err);
            if (listEl) listEl.innerHTML = `<div class="pesan-empty">Gagal memuat notulensi.</div>`;
        }
    },

    jumlahPeserta(peserta) {
        if (!peserta) return 0;
        return String(peserta).split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length;
    },

    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        } catch { return t; }
    },

    fmtWaktu(mulai, selesai) {
        if (mulai && selesai) return `${mulai}–${selesai}`;
        return mulai || selesai || "-";
    },

    // ============ STATISTIK + LIST ============
    render() {
        const all = Notulensi.cache || [];
        // statistik
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const bulanIni = all.filter(a => (a.tanggal || "").slice(0, 7) === ym).length;
        const belum = all.filter(a => a.status === "belum_tindaklanjut").length;
        const terbaru = all[0] || null;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("statTotal", String(all.length));
        set("statBulan", String(bulanIni));
        set("statBulanLbl", now.toLocaleDateString("id-ID", { month: "long", year: "numeric" }));
        set("statBelum", String(belum));
        set("statBaruCount", terbaru ? Notulensi.fmtTanggal(terbaru.tanggal) : "—");
        set("statBaru", terbaru ? terbaru.judul : "belum ada");

        // filter
        const f = Notulensi.filter;
        const q = f.q.trim().toLowerCase();
        const data = all.filter(a => {
            if (q && !(`${a.judul || ""} ${a.agenda_topik || ""}`.toLowerCase().includes(q))) return false;
            if (f.divisi && (a.divisi || "") !== f.divisi) return false;
            if (f.status && (a.status || "") !== f.status) return false;
            if (f.tanggal && (a.tanggal || "") !== f.tanggal) return false;
            return true;
        });

        const listEl = document.getElementById("notulensiList");
        if (!listEl) return;
        if (!all.length) {
            listEl.innerHTML = `<div class="pesan-empty" style="background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:28px 16px; text-align:center"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-clipboard-list" style="color:var(--red)"></i></div><b>Belum ada notulensi</b><p style="font-size:0.8rem; color:var(--gray); margin-top:4px">Klik <b>+ Buat Notulensi</b> buat mencatat hasil rapat pertama.</p></div>`;
            return;
        }
        if (!data.length) {
            listEl.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Notulensi.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            return;
        }
        listEl.innerHTML = data.map(a => {
            const lbl = Notulensi.STATUS_LABEL[a.status] || a.status || "-";
            return `
                <div class="notulensi-card">
                    <h4>${escapeHtml(a.judul || "Tanpa judul")}</h4>
                    <div class="notulensi-meta">
                        <span><i class="fa-solid fa-calendar"></i> ${Notulensi.fmtTanggal(a.tanggal)}</span>
                        <span><i class="fa-solid fa-clock"></i> ${escapeHtml(Notulensi.fmtWaktu(a.waktu_mulai, a.waktu_selesai))}</span>
                        <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(a.lokasi || "-")}</span>
                        <span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(a.divisi || "-")}</span>
                    </div>
                    <div class="notulensi-meta">
                        <span><i class="fa-solid fa-gavel"></i> ${escapeHtml(a.pimpinan || "-")}</span>
                        <span><i class="fa-solid fa-pen"></i> ${escapeHtml(a.notulis || "-")}</span>
                        <span><i class="fa-solid fa-users"></i> ${Notulensi.jumlahPeserta(a.peserta)} peserta</span>
                        <span class="agenda-status ${a.status}">${escapeHtml(lbl)}</span>
                    </div>
                    <div class="notulensi-actions">
                        <button class="btn btn-white btn-sm" onclick="Notulensi.detail(${a.id})"><i class="fa-solid fa-eye"></i> Lihat</button>
                        <button class="btn btn-white btn-sm" onclick="Notulensi.edit(${a.id})"><i class="fa-solid fa-pen"></i> Edit</button>
                        <button class="btn btn-red btn-sm" onclick="Notulensi.hapus(${a.id})"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                    </div>
                </div>`;
        }).join("");
    },

    bacaFilter() {
        Notulensi.filter = {
            q: document.getElementById("filterQ").value || "",
            divisi: document.getElementById("filterDivisi").value || "",
            status: document.getElementById("filterStatus").value || "",
            tanggal: document.getElementById("filterTanggal").value || ""
        };
        Notulensi.render();
    },

    resetFilter() {
        document.getElementById("filterQ").value = "";
        document.getElementById("filterDivisi").value = "";
        document.getElementById("filterStatus").value = "";
        document.getElementById("filterTanggal").value = "";
        Notulensi.bacaFilter();
    },

    // ============ FORM ============
    bukaForm() {
        Notulensi.editingId = null;
        Notulensi.pendingFiles = [];
        Notulensi.existingLampiran = [];
        Notulensi._revokePreviewUrls();
        ["notId", "notJudul", "notTanggal", "notWaktuMulai", "notWaktuSelesai", "notLokasi", "notPimpinan", "notNotulis"].forEach(id => {
            document.getElementById(id).value = "";
        });
        document.getElementById("notDivisi").value = "";
        document.getElementById("notPeserta").value = "";
        document.getElementById("notAgendaTopik").value = "";
        document.getElementById("notIsi").value = "";
        document.getElementById("notKeputusan").value = "";
        document.getElementById("notStatus").value = "selesai";
        const fi = document.getElementById("notLampiran");
        if (fi) fi.value = "";
        document.getElementById("notulensiFormTitle").textContent = "Buat Notulensi";
        Notulensi.renderTlRows([Notulensi.blankTl()]);
        Notulensi.renderPreview();
        document.getElementById("notulensiForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("notJudul")?.focus(), 80);
    },

    edit(id) {
        const item = Notulensi.cache.find(a => String(a.id) === String(id));
        if (!item) return;
        Notulensi.editingId = id;
        Notulensi.pendingFiles = [];
        Notulensi._revokePreviewUrls();
        const lamp = Array.isArray(item.lampiran) ? item.lampiran : [];
        Notulensi.existingLampiran = lamp.map(f => typeof f === "string" ? { path: f, caption: "" } : { path: f.path, caption: f.caption || "" }).filter(f => f.path);
        const set = (idEl, v) => { document.getElementById(idEl).value = v || ""; };
        set("notId", id);
        set("notJudul", item.judul);
        set("notTanggal", item.tanggal);
        set("notWaktuMulai", item.waktu_mulai);
        set("notWaktuSelesai", item.waktu_selesai);
        set("notLokasi", item.lokasi);
        set("notPimpinan", item.pimpinan);
        set("notNotulis", item.notulis);
        set("notPeserta", item.peserta);
        set("notAgendaTopik", item.agenda_topik);
        set("notIsi", item.isi_pembahasan);
        set("notKeputusan", item.keputusan);
        const dv = document.getElementById("notDivisi");
        if (dv) {
            if (item.divisi && ![...dv.options].some(o => o.value === item.divisi)) {
                const op = document.createElement("option");
                op.value = item.divisi;
                op.textContent = item.divisi;
                dv.appendChild(op);
            }
            dv.value = item.divisi || "";
        }
        document.getElementById("notStatus").value = item.status || "selesai";
        const fi = document.getElementById("notLampiran");
        if (fi) fi.value = "";
        document.getElementById("notulensiFormTitle").textContent = "Edit Notulensi";
        const tls = Array.isArray(item.tindak_lanjut) && item.tindak_lanjut.length ? item.tindak_lanjut : [Notulensi.blankTl()];
        Notulensi.renderTlRows(tls);
        Notulensi.renderPreview();
        document.getElementById("notulensiForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("notJudul")?.focus(), 80);
    },

    tutupForm() {
        document.getElementById("notulensiForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Notulensi.editingId = null;
        Notulensi.pendingFiles = [];
        Notulensi.existingLampiran = [];
        Notulensi._revokePreviewUrls();
        const pv = document.getElementById("notPreview");
        if (pv) { pv.innerHTML = ""; pv.style.display = "none"; }
        const fi = document.getElementById("notLampiran");
        if (fi) fi.value = "";
        const drop = document.getElementById("notDrop");
        if (drop) drop.classList.remove("dragover");
    },

    // ——— tindak lanjut dinamis ———
    blankTl() {
        return { tugas: "", pic: "", deadline: "", status: "belum" };
    },

    bacaTlRows() {
        const rows = [];
        document.querySelectorAll("#notTlList .tl-row").forEach(r => {
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
        const wrap = document.getElementById("notTlList");
        if (!wrap) return;
        wrap.innerHTML = (list && list.length ? list : [Notulensi.blankTl()]).map((t, i) => `
            <div class="tl-row" data-i="${i}">
                <div class="tl-head"><span>Tugas ${i + 1}</span><button type="button" class="tl-del" onclick="Notulensi.hapusTlRow(${i})" title="Hapus tugas"><i class="fa-solid fa-xmark"></i></button></div>
                <div class="full"><input type="text" data-tl="tugas" placeholder="Tugas / tindak lanjut" maxlength="200" value="${escapeHtml(t.tugas || "")}"></div>
                <div><input type="text" data-tl="pic" placeholder="PIC" maxlength="80" value="${escapeHtml(t.pic || "")}"></div>
                <div><input type="date" data-tl="deadline" value="${escapeHtml(t.deadline || "")}"></div>
                <div class="full"><select data-tl="status">
                    <option value="belum" ${t.status !== "selesai" ? "selected" : ""}>Belum dikerjakan</option>
                    <option value="selesai" ${t.status === "selesai" ? "selected" : ""}>Selesai</option>
                </select></div>
            </div>`).join("");
    },

    tambahTlRow() {
        const cur = Notulensi.bacaTlRows();
        cur.push(Notulensi.blankTl());
        Notulensi.renderTlRows(cur);
    },

    hapusTlRow(i) {
        const cur = Notulensi.bacaTlRows();
        cur.splice(i, 1);
        Notulensi.renderTlRows(cur.length ? cur : [Notulensi.blankTl()]);
    },

    // ——— lampiran (pola agenda) ———
    handleFiles(fileList) {
        if (!fileList || !fileList.length) return;
        let added = 0;
        for (const f of fileList) {
            if (!f.type || !f.type.startsWith("image/")) {
                showToast(`"${f.name}" bukan gambar`, "error");
                continue;
            }
            Notulensi.pendingFiles.push(f);
            added++;
        }
        if (added) Notulensi.renderPreview();
    },

    renderPreview() {
        const preview = document.getElementById("notPreview");
        if (!preview) return;
        Notulensi._revokePreviewUrls();
        preview.innerHTML = "";
        const existing = Notulensi.existingLampiran || [];
        const pending = Notulensi.pendingFiles || [];
        if (!existing.length && !pending.length) { preview.style.display = "none"; return; }
        preview.style.display = "flex";
        existing.forEach((f, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "notulensi-preview-item";
            wrap.innerHTML = `<img src="${getFoto(f.path)}" alt=""><button type="button" class="notulensi-preview-del" title="Hapus"><i class="fa-solid fa-xmark"></i></button>`;
            wrap.querySelector(".notulensi-preview-del").addEventListener("click", () => {
                Notulensi.existingLampiran.splice(idx, 1);
                Notulensi.renderPreview();
            });
            preview.appendChild(wrap);
        });
        pending.forEach((file, idx) => {
            if (!file.type.startsWith("image/")) return;
            const url = URL.createObjectURL(file);
            Notulensi._previewUrls.push(url);
            const wrap = document.createElement("div");
            wrap.className = "notulensi-preview-item";
            wrap.innerHTML = `<img src="${url}" alt=""><button type="button" class="notulensi-preview-del" title="Hapus"><i class="fa-solid fa-xmark"></i></button>`;
            wrap.querySelector(".notulensi-preview-del").addEventListener("click", () => {
                Notulensi.pendingFiles.splice(idx, 1);
                Notulensi.renderPreview();
            });
            preview.appendChild(wrap);
        });
    },

    _revokePreviewUrls() {
        (Notulensi._previewUrls || []).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        Notulensi._previewUrls = [];
    },

    kumpulkanForm() {
        const v = (id) => document.getElementById(id).value.trim();
        const tls = Notulensi.bacaTlRows().filter(t => t.tugas || t.pic);
        return {
            judul: v("notJudul"),
            tanggal: document.getElementById("notTanggal").value || null,
            waktu_mulai: v("notWaktuMulai"),
            waktu_selesai: v("notWaktuSelesai"),
            lokasi: v("notLokasi"),
            divisi: v("notDivisi"),
            pimpinan: v("notPimpinan"),
            notulis: v("notNotulis"),
            peserta: v("notPeserta"),
            agenda_topik: v("notAgendaTopik"),
            isi_pembahasan: v("notIsi"),
            keputusan: v("notKeputusan"),
            tindak_lanjut: tls,
            status: v("notStatus") || "selesai"
        };
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const f = Notulensi.kumpulkanForm();
        const id = document.getElementById("notId").value ? parseInt(document.getElementById("notId").value, 10) : null;
        if (!f.judul) { showToast("Judul rapat wajib diisi", "error"); return; }
        if (!f.tanggal) { showToast("Tanggal wajib diisi", "error"); return; }

        const btn = document.getElementById("btnSimpanNotulensi");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            let lampiran = [...(Notulensi.existingLampiran || [])];
            const files = Notulensi.pendingFiles || [];
            for (let i = 0; i < files.length; i++) {
                const fl = files[i];
                if (!fl.type.startsWith("image/")) continue;
                const ext = (fl.name.split(".").pop() || "jpg").toLowerCase();
                const path = `notulensi/notulensi-${u.id}-${Date.now()}-${i}.${ext}`;
                await uploadFotoStorage(fl, path);
                lampiran.push({ path, caption: "" });
            }
            f.lampiran = lampiran;
            if (id) {
                await updateNotulensi(u.id, id, f);
                showToast("Notulensi diperbarui!", "success");
            } else {
                const newId = await buatNotulensi(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Notulensi tersimpan!", "success");
            }
            Notulensi.tutupForm();
            await Notulensi.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Notulensi.cache.find(a => String(a.id) === String(id));
        const yakin = await showPopup(`Hapus notulensi "${item ? item.judul : ""}"? Lampirannya ikut terhapus.`, "confirm");
        if (!yakin) return;
        try {
            await hapusNotulensi(u.id, id);
            if (item && Array.isArray(item.lampiran)) {
                for (const l of item.lampiran) {
                    const p = typeof l === "string" ? l : l.path;
                    if (p) try { await hapusFotoStorage(p); } catch {}
                }
            }
            showToast("Notulensi dihapus", "success");
            await Notulensi.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ DETAIL + CETAK ============
    detail(id) {
        const a = Notulensi.cache.find(x => String(x.id) === String(id));
        if (!a) return;
        Notulensi.detailId = id;
        const tls = Array.isArray(a.tindak_lanjut) ? a.tindak_lanjut : [];
        const tlHtml = tls.length ? `<table class="tl-tabel"><thead><tr><th>Tugas</th><th>PIC</th><th>Deadline</th><th>Status</th></tr></thead><tbody>${tls.map(t => `
            <tr><td>${escapeHtml(t.tugas || "-")}</td><td>${escapeHtml(t.pic || "-")}</td><td>${t.deadline ? Notulensi.fmtTanggal(t.deadline) : "-"}</td><td><span class="tl-status ${t.status === "selesai" ? "selesai" : "belum"}">${t.status === "selesai" ? "Selesai" : "Belum"}</span></td></tr>`).join("")}</tbody></table>`
            : `<div class="detail-text">Tidak ada tindak lanjut.</div>`;
        const lamp = Array.isArray(a.lampiran) ? a.lampiran : [];
        const lampHtml = lamp.length ? `<div class="notulensi-fotos">${lamp.map(l => {
            const p = typeof l === "string" ? l : l.path;
            return `<img src="${getFoto(p)}" alt="" loading="lazy" style="width:110px; height:110px; object-fit:cover; border:2px solid var(--ink); border-radius:10px" onclick="Home && Home.bukaFotoPopup && Home.bukaFotoPopup(this, '${escapeHtml(a.judul).replace(/'/g, "\\'")}', '')">`;
        }).join("")}</div>` : `<div class="detail-text">Tidak ada lampiran.</div>`;
        const lbl = Notulensi.STATUS_LABEL[a.status] || a.status || "-";
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        document.getElementById("notDetailBody").innerHTML = `
            <h4 style="font-size:1.05rem; font-weight:900; overflow-wrap:anywhere">${escapeHtml(a.judul || "Tanpa judul")}</h4>
            <div style="margin:6px 0 2px"><span class="agenda-status ${a.status}">${escapeHtml(lbl)}</span></div>
            <div class="detail-sec"><h5>Informasi Rapat</h5>
                <div class="detail-info">
                    ${info("Tanggal", Notulensi.fmtTanggal(a.tanggal))}
                    ${info("Waktu", escapeHtml(Notulensi.fmtWaktu(a.waktu_mulai, a.waktu_selesai)))}
                    ${info("Lokasi", escapeHtml(a.lokasi))}
                    ${info("Divisi", escapeHtml(a.divisi))}
                    ${info("Pimpinan", escapeHtml(a.pimpinan))}
                    ${info("Notulis", escapeHtml(a.notulis))}
                    ${info("Peserta", Notulensi.jumlahPeserta(a.peserta) + " orang")}
                </div>
                ${a.peserta ? `<div class="detail-text" style="margin-top:8px">${escapeHtml(a.peserta)}</div>` : ""}
            </div>
            ${a.agenda_topik ? `<div class="detail-sec"><h5>Agenda Pembahasan</h5><div class="detail-text">${escapeHtml(a.agenda_topik)}</div></div>` : ""}
            ${a.isi_pembahasan ? `<div class="detail-sec"><h5>Hasil Pembahasan</h5><div class="detail-text">${escapeHtml(a.isi_pembahasan)}</div></div>` : ""}
            ${a.keputusan ? `<div class="detail-sec"><h5>Keputusan Rapat</h5><div class="detail-text">${escapeHtml(a.keputusan)}</div></div>` : ""}
            <div class="detail-sec"><h5>Tindak Lanjut</h5>${tlHtml}</div>
            <div class="detail-sec"><h5>Lampiran</h5>${lampHtml}</div>`;
        document.getElementById("notulensiDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("notulensiDetail")?.classList.remove("open");
        // jangan buka scroll kalau form masih kebuka
        if (!document.getElementById("notulensiForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Notulensi.detailId = null;
    },

    isiPrint() {
        const a = Notulensi.cache.find(x => String(x.id) === String(Notulensi.detailId));
        if (!a) return null;
        const tls = Array.isArray(a.tindak_lanjut) ? a.tindak_lanjut : [];
        const lamp = Array.isArray(a.lampiran) ? a.lampiran : [];
        const esc = (s) => escapeHtml(s || "-");
        return `
            <div style="font-family:Arial,Helvetica,sans-serif; color:#111; max-width:700px; margin:0 auto">
                <div style="text-align:center; border-bottom:3px solid #111; padding-bottom:10px; margin-bottom:14px">
                    <div style="font-size:18px; font-weight:900">OSIS TARPAN ONE</div>
                    <div style="font-size:12px">SMK Taruna Harapan 1 Cipatat — Notulensi Rapat</div>
                </div>
                <h2 style="font-size:20px; margin:0 0 4px">${escapeHtml(a.judul || "Tanpa judul")}</h2>
                <p style="font-size:12px; color:#444; margin:0 0 12px">${Notulensi.fmtTanggal(a.tanggal)} · ${escapeHtml(Notulensi.fmtWaktu(a.waktu_mulai, a.waktu_selesai))} · ${esc(a.lokasi)} · ${esc(a.divisi)} · Status: ${esc(Notulensi.STATUS_LABEL[a.status] || a.status)}</p>
                <p style="font-size:12px"><b>Pimpinan:</b> ${esc(a.pimpinan)} &nbsp; <b>Notulis:</b> ${esc(a.notulis)}</p>
                <p style="font-size:12px"><b>Peserta (${Notulensi.jumlahPeserta(a.peserta)}):</b><br>${escapeHtml(a.peserta || "-").replace(/\n/g, "<br>")}</p>
                ${a.agenda_topik ? `<h4>Agenda Pembahasan</h4><p style="font-size:13px; white-space:pre-wrap">${escapeHtml(a.agenda_topik)}</p>` : ""}
                ${a.isi_pembahasan ? `<h4>Hasil Pembahasan</h4><p style="font-size:13px; white-space:pre-wrap">${escapeHtml(a.isi_pembahasan)}</p>` : ""}
                ${a.keputusan ? `<h4>Keputusan Rapat</h4><p style="font-size:13px; white-space:pre-wrap">${escapeHtml(a.keputusan)}</p>` : ""}
                <h4>Tindak Lanjut</h4>
                ${tls.length ? `<table border="1" cellspacing="0" cellpadding="6" style="width:100%; font-size:12px; border-collapse:collapse"><thead><tr><th>Tugas</th><th>PIC</th><th>Deadline</th><th>Status</th></tr></thead><tbody>${tls.map(t => `<tr><td>${escapeHtml(t.tugas || "-")}</td><td>${escapeHtml(t.pic || "-")}</td><td>${t.deadline ? Notulensi.fmtTanggal(t.deadline) : "-"}</td><td>${t.status === "selesai" ? "Selesai" : "Belum"}</td></tr>`).join("")}</tbody></table>` : `<p style="font-size:12px">Tidak ada tindak lanjut.</p>`}
                ${lamp.length ? `<h4>Lampiran</h4><div>${lamp.map(l => { const p = typeof l === "string" ? l : l.path; return `<img src="${getFoto(p)}" style="width:220px; margin:0 8px 8px 0">`; }).join("")}</div>` : ""}
                <p style="font-size:11px; color:#666; margin-top:16px">Dicetak ${new Date().toLocaleString("id-ID")} dari website OSIS Tarpan One.</p>
            </div>`;
    },

    cetak() {
        const html = Notulensi.isiPrint();
        if (!html) return;
        const pa = document.getElementById("printArea");
        pa.innerHTML = html;
        document.getElementById("notulensiDetail").classList.add("print-mode");
        window.print();
    },

    exportPdf() {
        const a = Notulensi.cache.find(x => String(x.id) === String(Notulensi.detailId));
        const html = Notulensi.isiPrint();
        if (!html) return;
        const pa = document.getElementById("printArea");
        pa.innerHTML = html;
        const oldTitle = document.title;
        document.title = "Notulensi - " + (a.judul || "rapat");
        showToast("Pilih 'Save as PDF' di dialog print", "info");
        window.print();
        setTimeout(() => { document.title = oldTitle; }, 500);
    }
};

document.addEventListener("DOMContentLoaded", () => Notulensi.init());
