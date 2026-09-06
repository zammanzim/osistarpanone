// =========================================================================
// EVALUASI — halaman khusus OSIS (folder /osis)
// Dipakai di osis/evaluasi.html — nilai kegiatan 1-5, hasil, tindak lanjut,
// dokumentasi drag & drop. Relasi agenda/proker/keuangan read-only dari
// tabelnya masing-masing. Visual ikut design system Agenda.
// =========================================================================

const Evaluasi = {
    cache: [],
    agendaCache: [],
    prokerCache: [],
    kasCache: [],
    filter: { q: "", divisi: "", proker: "", status: "", periode: "", sort: "baru" },
    editingId: null,
    detailId: null,
    pendingFiles: [],
    existingDok: [],
    _previewUrls: [],
    rating: { total: 5, persiapan: 5, pelaksanaan: 5, koordinasi: 5, waktu: 5, anggaran: 5 },

    ASPEK: [
        ["persiapan", "Persiapan"],
        ["pelaksanaan", "Pelaksanaan"],
        ["koordinasi", "Koordinasi"],
        ["waktu", "Ketepatan waktu"],
        ["anggaran", "Penggunaan anggaran"]
    ],
    STATUS_LABEL: { belum: "Belum Dievaluasi", draft: "Draft", selesai: "Selesai" },

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
            const dd = document.getElementById("evDivisi");
            if (dd) dd.innerHTML = `<option value="">— Pilih —</option>` + opts;
            const fd = document.getElementById("filterDivisi");
            if (fd) fd.innerHTML = `<option value="">Semua</option>` + opts;
        } catch {}

        document.getElementById("btnBuatEvaluasi")?.addEventListener("click", () => Evaluasi.bukaForm());
        document.getElementById("btnBatalEvaluasi")?.addEventListener("click", () => Evaluasi.tutupForm());
        document.getElementById("btnSimpanEvaluasi")?.addEventListener("click", () => Evaluasi.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Evaluasi.resetFilter());
        document.getElementById("btnTambahTl")?.addEventListener("click", () => Evaluasi.tambahTlRow());
        document.getElementById("btnEditDariDetail")?.addEventListener("click", () => {
            const id = Evaluasi.detailId;
            Evaluasi.tutupDetail();
            if (id) Evaluasi.edit(id);
        });
        document.getElementById("btnCetakDetail")?.addEventListener("click", () => Evaluasi.cetak());
        document.getElementById("btnHapusDariDetail")?.addEventListener("click", () => {
            const id = Evaluasi.detailId;
            if (id) Evaluasi.hapus(id, true);
        });

        ["filterQ", "filterDivisi", "filterProker", "filterStatus", "filterPeriode", "filterSort"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Evaluasi.bacaFilter());
        });

        // pilih agenda → auto-isi nama + tanggal (kalau masih kosong)
        document.getElementById("evAgenda")?.addEventListener("change", (e) => {
            const a = (Evaluasi.agendaCache || []).find(x => String(x.id) === String(e.target.value));
            if (!a) return;
            const nm = document.getElementById("evNama");
            if (nm && !nm.value.trim()) nm.value = a.judul || "";
            const tg = document.getElementById("evTanggal");
            if (tg && !tg.value && a.tanggal) tg.value = a.tanggal;
        });

        // dokumentasi drag & drop (pola agenda)
        const drop = document.getElementById("evDrop");
        const fileInput = document.getElementById("evDokInput");
        if (drop && fileInput) {
            drop.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", (e) => {
                Evaluasi.handleFiles(e.target.files);
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
                if (files && files.length) Evaluasi.handleFiles(files);
            });
        }

        ["evaluasiForm", "evaluasiDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "evaluasiForm") Evaluasi.tutupForm();
                    else Evaluasi.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("evaluasiForm")?.classList.contains("open")) Evaluasi.tutupForm();
            if (document.getElementById("evaluasiDetail")?.classList.contains("open")) Evaluasi.tutupDetail();
        });

        await Evaluasi.muat();
    },

    // ============ HELPERS ============
    rp(n) {
        return "Rp" + (parseInt(n, 10) || 0).toLocaleString("id-ID");
    },

    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        } catch { return t; }
    },

    stars(n, max) {
        n = Math.max(0, Math.min(max || 5, parseInt(n, 10) || 0));
        let s = "";
        for (let i = 1; i <= (max || 5); i++) {
            s += `<span class="${i <= n ? "" : "off"}">★</span>`;
        }
        return `<span class="stars-show">${s}</span>`;
    },

    prokerName(id) {
        if (!id) return "";
        const p = (Evaluasi.prokerCache || []).find(x => String(x.id) === String(id));
        return p ? (p.nama || "Tanpa nama") : `#${id} (dihapus)`;
    },

    agendaName(id) {
        if (!id) return "";
        const a = (Evaluasi.agendaCache || []).find(x => String(x.id) === String(id));
        return a ? (a.judul || "Tanpa judul") : `#${id} (dihapus)`;
    },

    // ============ DATA ============
    async muat() {
        const listEl = document.getElementById("evaluasiList");
        if (listEl) listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat evaluasi...</div>`;
        try {
            const [pk, ag, kas] = await Promise.all([
                getProker().catch(() => []),
                getAllAgenda().catch(() => []),
                getKas().catch(() => [])
            ]);
            Evaluasi.prokerCache = pk || [];
            Evaluasi.agendaCache = ag || [];
            Evaluasi.kasCache = kas || [];
            Evaluasi.buildOptions();
            const cached = Cache.get("evaluasi");
            if (cached) {
                Evaluasi.cache = cached;
                Evaluasi.render();
                getEvaluasi().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("evaluasi", fresh);
                        Evaluasi.cache = fresh || [];
                        Evaluasi.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getEvaluasi();
            Cache.set("evaluasi", data);
            Evaluasi.cache = data || [];
            Evaluasi.render();
        } catch (err) {
            console.error(err);
            if (listEl) listEl.innerHTML = `<div class="pesan-empty">Gagal memuat evaluasi.</div>`;
        }
    },

    buildOptions() {
        const tp = document.getElementById("evProker");
        if (tp) {
            tp.innerHTML = `<option value="">— Tidak ada —</option>` + (Evaluasi.prokerCache || []).map(p => `<option value="${p.id}">${escapeHtml(p.nama || "Tanpa nama")}</option>`).join("");
        }
        const ta = document.getElementById("evAgenda");
        if (ta) {
            const list = [...(Evaluasi.agendaCache || [])].sort((a, b) => String(b.tanggal || "") < String(a.tanggal || "") ? -1 : 1);
            ta.innerHTML = `<option value="">— Ketik manual —</option>` + list.map(a => {
                const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "";
                return `<option value="${a.id}">${escapeHtml(a.judul || "Tanpa judul")}${tgl ? " · " + tgl : ""}</option>`;
            }).join("");
        }
        const fp = document.getElementById("filterProker");
        if (fp) {
            const cur = fp.value || Evaluasi.filter.proker || "";
            fp.innerHTML = `<option value="">Semua</option>` + (Evaluasi.prokerCache || []).map(p => `<option value="${p.id}">${escapeHtml(p.nama || "Tanpa nama")}</option>`).join("");
            fp.value = cur;
            Evaluasi.filter.proker = cur;
        }
        const pers = [...new Set((Evaluasi.cache || []).map(e => (e.tgl_kegiatan || "").slice(0, 4)).filter(Boolean))].sort().reverse();
        const fper = document.getElementById("filterPeriode");
        if (fper) {
            const cur = fper.value || Evaluasi.filter.periode || "";
            fper.innerHTML = `<option value="">Semua</option>` + pers.map(p => `<option value="${p}">${p}</option>`).join("");
            fper.value = cur;
            Evaluasi.filter.periode = cur;
        }
    },

    // ============ RENDER ============
    render() {
        const all = Evaluasi.cache || [];
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("statTotal", String(all.length));
        set("statBulan", String(all.filter(e => (e.created_at || "").slice(0, 7) === ym).length));
        set("statBulanLbl", now.toLocaleDateString("id-ID", { month: "long", year: "numeric" }));
        const agendaSelesai = (Evaluasi.agendaCache || []).filter(a => a.status === "selesai");
        set("statKegiatan", String(agendaSelesai.length));
        const evAgenda = new Set(all.map(e => String(e.agenda_id || "")).filter(Boolean));
        const evProker = new Set(all.map(e => String(e.proker_id || "")).filter(Boolean));
        const belum = agendaSelesai.filter(a => !evAgenda.has(String(a.id))).length
            + (Evaluasi.prokerCache || []).filter(p => p.status === "selesai" && !evProker.has(String(p.id))).length;
        set("statBelum", String(belum));

        const f = Evaluasi.filter;
        const q = f.q.trim().toLowerCase();
        let data = all.filter(e => {
            if (q && !(`${e.nama_kegiatan || ""}`.toLowerCase().includes(q))) return false;
            if (f.divisi && (e.divisi || "") !== f.divisi) return false;
            if (f.proker && String(e.proker_id || "") !== String(f.proker)) return false;
            if (f.status && (e.status || "") !== f.status) return false;
            if (f.periode && (e.tgl_kegiatan || "").slice(0, 4) !== String(f.periode)) return false;
            return true;
        });
        if (f.sort === "lama") data = [...data].sort((a, b) => String(a.tgl_kegiatan || "") > String(b.tgl_kegiatan || "") ? 1 : -1);
        else if (f.sort === "rating_tinggi") data = [...data].sort((a, b) => (parseInt(b.rating_total, 10) || 0) - (parseInt(a.rating_total, 10) || 0));
        else if (f.sort === "rating_rendah") data = [...data].sort((a, b) => (parseInt(a.rating_total, 10) || 0) - (parseInt(b.rating_total, 10) || 0));
        else data = [...data].sort((a, b) => String(a.tgl_kegiatan || "") < String(b.tgl_kegiatan || "") ? 1 : -1);

        const listEl = document.getElementById("evaluasiList");
        if (!listEl) return;
        if (!all.length) {
            listEl.innerHTML = `<div class="pesan-empty" style="grid-column:1/-1; background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:28px 16px; text-align:center"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-star-half-stroke" style="color:var(--red)"></i></div><b>Belum ada evaluasi</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Evaluasi kegiatan akan muncul di sini setelah dibuat.</p><button class="btn btn-red btn-sm" onclick="Evaluasi.bukaForm()"><i class="fa-solid fa-plus"></i> Buat Evaluasi</button></div>`;
            return;
        }
        if (!data.length) {
            listEl.innerHTML = `<div class="pesan-empty" style="grid-column:1/-1"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Evaluasi.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            return;
        }
        listEl.innerHTML = data.map(e => {
            const lbl = Evaluasi.STATUS_LABEL[e.status] || e.status || "-";
            const pk = e.proker_id ? `<div class="evaluasi-meta"><span><i class="fa-solid fa-list-check"></i> ${escapeHtml(Evaluasi.prokerName(e.proker_id))}</span></div>` : "";
            return `
                <div class="evaluasi-card">
                    <div class="top">
                        <h4>${escapeHtml(e.nama_kegiatan || "Tanpa nama")}</h4>
                        <span class="rating-pill">★ ${parseInt(e.rating_total, 10) || 0}/5</span>
                    </div>
                    ${pk}
                    <div class="evaluasi-meta">
                        <span><i class="fa-solid fa-calendar"></i> ${Evaluasi.fmtTanggal(e.tgl_kegiatan)}</span>
                        <span><i class="fa-solid fa-user"></i> ${escapeHtml(e.pj || "-")}</span>
                        <span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(e.divisi || "-")}</span>
                    </div>
                    <div class="evaluasi-meta">
                        <span class="agenda-status ${e.status}">${escapeHtml(lbl)}</span>
                        <span style="margin-left:auto">dievaluasi ${Evaluasi.fmtTanggal((e.created_at || "").slice(0, 10))}</span>
                    </div>
                    <div class="evaluasi-actions">
                        <button class="btn btn-white btn-sm" onclick="Evaluasi.detail(${e.id})"><i class="fa-solid fa-eye"></i> Lihat Evaluasi</button>
                        <button class="btn btn-white btn-sm" onclick="Evaluasi.edit(${e.id})"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-red btn-sm" onclick="Evaluasi.hapus(${e.id})"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>`;
        }).join("");
    },

    bacaFilter() {
        Evaluasi.filter = {
            q: document.getElementById("filterQ").value || "",
            divisi: document.getElementById("filterDivisi").value || "",
            proker: document.getElementById("filterProker").value || "",
            status: document.getElementById("filterStatus").value || "",
            periode: document.getElementById("filterPeriode").value || "",
            sort: document.getElementById("filterSort").value || "baru"
        };
        Evaluasi.render();
    },

    resetFilter() {
        ["filterQ", "filterDivisi", "filterProker", "filterStatus", "filterPeriode"].forEach(id => {
            document.getElementById(id).value = "";
        });
        document.getElementById("filterSort").value = "baru";
        Evaluasi.bacaFilter();
    },

    // ============ RATING PICKER ============
    renderRating() {
        const starBtns = (key) => {
            let h = "";
            for (let i = 1; i <= 5; i++) {
                h += `<button type="button" data-rate="${key}" data-val="${i}" class="${i <= (Evaluasi.rating[key] || 0) ? "on" : ""}">★</button>`;
            }
            return h;
        };
        const rt = document.getElementById("rateTotal");
        if (rt) rt.innerHTML = starBtns("total");
        const ra = document.getElementById("rateAspek");
        if (ra) {
            ra.innerHTML = Evaluasi.ASPEK.map(([key, lbl]) => `
                <div class="rate-row"><span>${lbl}</span><div class="stars">${starBtns(key)}</div></div>`).join("");
        }
        document.querySelectorAll("[data-rate]").forEach(btn => {
            btn.onclick = () => {
                Evaluasi.rating[btn.dataset.rate] = parseInt(btn.dataset.val, 10);
                Evaluasi.renderRating();
            };
        });
    },

    // ============ FORM ============
    bukaForm() {
        Evaluasi.editingId = null;
        Evaluasi.pendingFiles = [];
        Evaluasi.existingDok = [];
        Evaluasi._revokePreviewUrls();
        Evaluasi.rating = { total: 5, persiapan: 5, pelaksanaan: 5, koordinasi: 5, waktu: 5, anggaran: 5 };
        ["evId", "evNama", "evTanggal", "evPj", "evBaik", "evKendala", "evPenyebab", "evSolusi", "evPerbaiki", "evRekomendasi"].forEach(id => {
            document.getElementById(id).value = "";
        });
        document.getElementById("evAgenda").value = "";
        document.getElementById("evProker").value = "";
        document.getElementById("evDivisi").value = "";
        document.getElementById("evStatus").value = "draft";
        const fi = document.getElementById("evDokInput");
        if (fi) fi.value = "";
        document.getElementById("evaluasiFormTitle").textContent = "Buat Evaluasi";
        Evaluasi.renderRating();
        Evaluasi.renderTlRows([Evaluasi.blankTl()]);
        Evaluasi.renderPreview();
        document.getElementById("evaluasiForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("evNama")?.focus(), 80);
    },

    edit(id) {
        const item = Evaluasi.cache.find(e => String(e.id) === String(id));
        if (!item) return;
        Evaluasi.editingId = id;
        Evaluasi.pendingFiles = [];
        Evaluasi._revokePreviewUrls();
        const dok = Array.isArray(item.dokumentasi) ? item.dokumentasi : [];
        Evaluasi.existingDok = dok.map(d => typeof d === "string" ? { path: d, caption: "" } : { path: d.path, caption: d.caption || "" }).filter(d => d.path);
        Evaluasi.rating = {
            total: parseInt(item.rating_total, 10) || 5,
            persiapan: parseInt(item.r_persiapan, 10) || 5,
            pelaksanaan: parseInt(item.r_pelaksanaan, 10) || 5,
            koordinasi: parseInt(item.r_koordinasi, 10) || 5,
            waktu: parseInt(item.r_waktu, 10) || 5,
            anggaran: parseInt(item.r_anggaran, 10) || 5
        };
        const set = (idEl, v) => { document.getElementById(idEl).value = v ?? ""; };
        set("evId", id);
        set("evNama", item.nama_kegiatan);
        set("evTanggal", item.tgl_kegiatan);
        set("evPj", item.pj);
        set("evBaik", item.baik);
        set("evKendala", item.kendala);
        set("evPenyebab", item.penyebab);
        set("evSolusi", item.solusi);
        set("evPerbaiki", item.perbaiki);
        set("evRekomendasi", item.rekomendasi);
        set("evAgenda", item.agenda_id || "");
        set("evProker", item.proker_id || "");
        const dv = document.getElementById("evDivisi");
        if (dv) {
            if (item.divisi && ![...dv.options].some(o => o.value === item.divisi)) {
                const op = document.createElement("option");
                op.value = item.divisi;
                op.textContent = item.divisi;
                dv.appendChild(op);
            }
            dv.value = item.divisi || "";
        }
        set("evStatus", item.status || "draft");
        const fi = document.getElementById("evDokInput");
        if (fi) fi.value = "";
        document.getElementById("evaluasiFormTitle").textContent = "Edit Evaluasi";
        Evaluasi.renderRating();
        const tls = Array.isArray(item.tugas) && item.tugas.length ? item.tugas : [Evaluasi.blankTl()];
        Evaluasi.renderTlRows(tls);
        Evaluasi.renderPreview();
        document.getElementById("evaluasiForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("evNama")?.focus(), 80);
    },

    tutupForm() {
        document.getElementById("evaluasiForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Evaluasi.editingId = null;
        Evaluasi.pendingFiles = [];
        Evaluasi.existingDok = [];
        Evaluasi._revokePreviewUrls();
        const pv = document.getElementById("evPreview");
        if (pv) { pv.innerHTML = ""; pv.style.display = "none"; }
        const fi = document.getElementById("evDokInput");
        if (fi) fi.value = "";
        const drop = document.getElementById("evDrop");
        if (drop) drop.classList.remove("dragover");
    },

    // ——— tugas dinamis ———
    blankTl() {
        return { tugas: "", pic: "", deadline: "", status: "belum" };
    },

    bacaTlRows() {
        const rows = [];
        document.querySelectorAll("#evTlList .tl-row").forEach(r => {
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
        const wrap = document.getElementById("evTlList");
        if (!wrap) return;
        wrap.innerHTML = (list && list.length ? list : [Evaluasi.blankTl()]).map((t, i) => `
            <div class="tl-row" data-i="${i}">
                <div class="tl-head"><span>Tugas ${i + 1}</span><button type="button" class="tl-del" onclick="Evaluasi.hapusTlRow(${i})" title="Hapus tugas"><i class="fa-solid fa-xmark"></i></button></div>
                <div class="full"><input type="text" data-tl="tugas" placeholder="Tugas / perbaikan" maxlength="200" value="${escapeHtml(t.tugas || "")}"></div>
                <div><input type="text" data-tl="pic" placeholder="PIC" maxlength="80" value="${escapeHtml(t.pic || "")}"></div>
                <div><input type="date" data-tl="deadline" value="${escapeHtml(t.deadline || "")}"></div>
                <div class="full"><select data-tl="status">
                    <option value="belum" ${t.status !== "selesai" ? "selected" : ""}>Belum dikerjakan</option>
                    <option value="selesai" ${t.status === "selesai" ? "selected" : ""}>Selesai</option>
                </select></div>
            </div>`).join("");
    },

    tambahTlRow() {
        const cur = Evaluasi.bacaTlRows();
        cur.push(Evaluasi.blankTl());
        Evaluasi.renderTlRows(cur);
    },

    hapusTlRow(i) {
        const cur = Evaluasi.bacaTlRows();
        cur.splice(i, 1);
        Evaluasi.renderTlRows(cur.length ? cur : [Evaluasi.blankTl()]);
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
            Evaluasi.pendingFiles.push(f);
            added++;
        }
        if (added) Evaluasi.renderPreview();
    },

    renderPreview() {
        const preview = document.getElementById("evPreview");
        if (!preview) return;
        Evaluasi._revokePreviewUrls();
        preview.innerHTML = "";
        const existing = Evaluasi.existingDok || [];
        const pending = Evaluasi.pendingFiles || [];
        if (!existing.length && !pending.length) { preview.style.display = "none"; return; }
        preview.style.display = "flex";
        existing.forEach((d, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "evaluasi-preview-item";
            wrap.innerHTML = `<img src="${getFoto(d.path)}" alt=""><button type="button" class="evaluasi-preview-del" title="Hapus"><i class="fa-solid fa-xmark"></i></button>`;
            wrap.querySelector(".evaluasi-preview-del").addEventListener("click", () => {
                Evaluasi.existingDok.splice(idx, 1);
                Evaluasi.renderPreview();
            });
            preview.appendChild(wrap);
        });
        pending.forEach((file, idx) => {
            if (!file.type.startsWith("image/")) return;
            const url = URL.createObjectURL(file);
            Evaluasi._previewUrls.push(url);
            const wrap = document.createElement("div");
            wrap.className = "evaluasi-preview-item";
            wrap.innerHTML = `<img src="${url}" alt=""><button type="button" class="evaluasi-preview-del" title="Hapus"><i class="fa-solid fa-xmark"></i></button>`;
            wrap.querySelector(".evaluasi-preview-del").addEventListener("click", () => {
                Evaluasi.pendingFiles.splice(idx, 1);
                Evaluasi.renderPreview();
            });
            preview.appendChild(wrap);
        });
    },

    _revokePreviewUrls() {
        (Evaluasi._previewUrls || []).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        Evaluasi._previewUrls = [];
    },

    kumpulkanForm() {
        const v = (id) => document.getElementById(id).value.trim();
        const num = (id) => {
            const n = parseInt(document.getElementById(id).value, 10);
            return Number.isFinite(n) ? n : null;
        };
        const clampRate = (n) => Math.max(1, Math.min(5, parseInt(n, 10) || 5));
        const r = Evaluasi.rating;
        return {
            nama_kegiatan: v("evNama"),
            agenda_id: num("evAgenda"),
            proker_id: num("evProker"),
            tgl_kegiatan: document.getElementById("evTanggal").value || null,
            divisi: v("evDivisi"),
            pj: v("evPj"),
            status: v("evStatus") || "draft",
            rating_total: clampRate(r.total),
            r_persiapan: clampRate(r.persiapan),
            r_pelaksanaan: clampRate(r.pelaksanaan),
            r_koordinasi: clampRate(r.koordinasi),
            r_waktu: clampRate(r.waktu),
            r_anggaran: clampRate(r.anggaran),
            baik: v("evBaik"),
            kendala: v("evKendala"),
            penyebab: v("evPenyebab"),
            solusi: v("evSolusi"),
            perbaiki: v("evPerbaiki"),
            rekomendasi: v("evRekomendasi"),
            tugas: Evaluasi.bacaTlRows().filter(t => t.tugas || t.pic)
        };
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const f = Evaluasi.kumpulkanForm();
        const id = document.getElementById("evId").value ? parseInt(document.getElementById("evId").value, 10) : null;
        if (!f.nama_kegiatan) { showToast("Nama kegiatan wajib diisi", "error"); return; }

        const btn = document.getElementById("btnSimpanEvaluasi");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            let dok = [...(Evaluasi.existingDok || [])];
            const files = Evaluasi.pendingFiles || [];
            for (let i = 0; i < files.length; i++) {
                const fl = files[i];
                if (!fl.type.startsWith("image/")) continue;
                const ext = (fl.name.split(".").pop() || "jpg").toLowerCase();
                const path = `evaluasi/evaluasi-${u.id}-${Date.now()}-${i}.${ext}`;
                await uploadFotoStorage(fl, path);
                dok.push({ path, caption: "" });
            }
            f.dokumentasi = dok;
            if (id) {
                await updateEvaluasi(u.id, id, f);
                showToast("Evaluasi diperbarui!", "success");
            } else {
                const newId = await buatEvaluasi(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Evaluasi tersimpan!", "success");
            }
            Evaluasi.tutupForm();
            await Evaluasi.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Evaluasi'; }
        }
    },

    async hapus(id, dariDetail) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Evaluasi.cache.find(e => String(e.id) === String(id));
        const yakin = await showPopup(`Hapus evaluasi "${item ? item.nama_kegiatan : ""}"? Dokumentasinya ikut terhapus.`, "confirm");
        if (!yakin) return;
        try {
            await hapusEvaluasi(u.id, id);
            if (item && Array.isArray(item.dokumentasi)) {
                for (const d of item.dokumentasi) {
                    const p = typeof d === "string" ? d : d.path;
                    if (p) try { await hapusFotoStorage(p); } catch {}
                }
            }
            if (dariDetail) Evaluasi.tutupDetail();
            showToast("Evaluasi dihapus", "success");
            await Evaluasi.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ DETAIL ============
    detail(id) {
        const e = Evaluasi.cache.find(x => String(x.id) === String(id));
        if (!e) return;
        Evaluasi.detailId = id;
        const lbl = Evaluasi.STATUS_LABEL[e.status] || e.status || "-";
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        const teks = (v) => v ? `<div class="detail-text">${escapeHtml(v)}</div>` : "";

        const aspek = [
            ["Persiapan", e.r_persiapan],
            ["Pelaksanaan", e.r_pelaksanaan],
            ["Koordinasi", e.r_koordinasi],
            ["Ketepatan waktu", e.r_waktu],
            ["Anggaran", e.r_anggaran]
        ].map(([l, v]) => `<div class="rate-break"><span>${l}</span>${Evaluasi.stars(v)}</div>`).join("");

        const tls = Array.isArray(e.tugas) ? e.tugas : [];
        const tlHtml = tls.length ? `<table class="tl-tabel"><thead><tr><th>Tugas</th><th>PIC</th><th>Deadline</th><th>Status</th></tr></thead><tbody>${tls.map(t => `
            <tr><td>${escapeHtml(t.tugas || "-")}</td><td>${escapeHtml(t.pic || "-")}</td><td>${t.deadline ? Evaluasi.fmtTanggal(t.deadline) : "-"}</td><td><span class="tl-status ${t.status === "selesai" ? "selesai" : "belum"}">${t.status === "selesai" ? "Selesai" : "Belum"}</span></td></tr>`).join("")}</tbody></table>`
            : `<div class="detail-text" style="opacity:.6">Tidak ada tindak lanjut.</div>`;

        const dok = Array.isArray(e.dokumentasi) ? e.dokumentasi : [];
        const dokHtml = dok.length ? `<div class="evaluasi-fotos">${dok.map(d => {
            const p = typeof d === "string" ? d : d.path;
            return `<img src="${getFoto(p)}" alt="" loading="lazy" style="width:110px; height:110px; object-fit:cover; border:2px solid var(--ink); border-radius:10px" onclick="Home && Home.bukaFotoPopup && Home.bukaFotoPopup(this, '${escapeHtml(e.nama_kegiatan).replace(/'/g, "\\'")}', '')">`;
        }).join("")}</div>` : `<div class="detail-text" style="opacity:.6">Tidak ada dokumentasi.</div>`;

        // ringkasan keuangan dari modul kas (read-only, kalau proker dikaitkan)
        let kasHtml = "";
        if (e.proker_id) {
            const rows = (Evaluasi.kasCache || []).filter(t => String(t.proker_id) === String(e.proker_id));
            const masuk = rows.filter(t => t.jenis === "masuk").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
            const keluar = rows.filter(t => t.jenis === "keluar").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
            kasHtml = `<div class="detail-sec"><h5>Keuangan Terkait</h5>
                <div class="kas-mini"><span>Anggaran ${Evaluasi.rp(masuk)}</span><span>Pengeluaran ${Evaluasi.rp(keluar)}</span><span>Sisa ${Evaluasi.rp(masuk - keluar)}</span></div>
                <div class="detail-text" style="opacity:.7; font-size:.74rem; margin-top:6px">Dari modul Keuangan (${rows.length} transaksi proker ini).</div></div>`;
        }

        const hasilAda = e.baik || e.kendala || e.penyebab || e.solusi || e.perbaiki;
        document.getElementById("evDetailBody").innerHTML = `
            <h4 style="font-size:1.05rem; font-weight:900; text-transform:uppercase; overflow-wrap:anywhere">${escapeHtml(e.nama_kegiatan || "Tanpa nama")}</h4>
            <div style="margin:6px 0 2px"><span class="agenda-status ${e.status}">${escapeHtml(lbl)}</span></div>
            <div class="detail-sec"><h5>Informasi Kegiatan</h5>
                <div class="detail-info">
                    ${info("Program Kerja", escapeHtml(e.proker_id ? Evaluasi.prokerName(e.proker_id) : ""))}
                    ${info("Kegiatan / Agenda", escapeHtml(e.agenda_id ? Evaluasi.agendaName(e.agenda_id) : ""))}
                    ${info("Tanggal", Evaluasi.fmtTanggal(e.tgl_kegiatan))}
                    ${info("Divisi", escapeHtml(e.divisi))}
                    ${info("PJ", escapeHtml(e.pj))}
                </div>
            </div>
            <div class="detail-sec"><h5>Penilaian — ★ ${parseInt(e.rating_total, 10) || 0}/5</h5>${aspek}</div>
            ${hasilAda ? `<div class="detail-sec"><h5>Hasil</h5>
                ${e.baik ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Berjalan baik</div><div class="detail-text" style="margin-top:4px">${escapeHtml(e.baik)}</div>` : ""}
                ${e.kendala ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Kendala</div><div class="detail-text" style="margin-top:4px">${escapeHtml(e.kendala)}</div>` : ""}
                ${e.penyebab ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Penyebab</div><div class="detail-text" style="margin-top:4px">${escapeHtml(e.penyebab)}</div>` : ""}
                ${e.solusi ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Solusi</div><div class="detail-text" style="margin-top:4px">${escapeHtml(e.solusi)}</div>` : ""}
                ${e.perbaiki ? `<div class="k" style="font-size:.66rem; font-weight:800; text-transform:uppercase; color:var(--gray); margin-top:6px">Perlu diperbaiki</div><div class="detail-text" style="margin-top:4px">${escapeHtml(e.perbaiki)}</div>` : ""}
            </div>` : ""}
            ${e.rekomendasi ? `<div class="detail-sec"><h5>Rekomendasi</h5>${teks(e.rekomendasi)}</div>` : ""}
            <div class="detail-sec"><h5>Tindak Lanjut</h5>${tlHtml}</div>
            <div class="detail-sec"><h5>Dokumentasi</h5>${dokHtml}</div>
            ${kasHtml}`;
        document.getElementById("evaluasiDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("evaluasiDetail")?.classList.remove("open");
        if (!document.getElementById("evaluasiForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Evaluasi.detailId = null;
    },

    // ============ CETAK ============
    isiPrint() {
        const e = Evaluasi.cache.find(x => String(x.id) === String(Evaluasi.detailId));
        if (!e) return null;
        const esc = (s) => escapeHtml(s || "-");
        const baris = (l, v) => v ? `<p style="font-size:13px"><b>${l}:</b> ${escapeHtml(v).replace(/\n/g, "<br>")}</p>` : "";
        const stars = (n) => "★".repeat(Math.max(0, Math.min(5, parseInt(n, 10) || 0))) + "☆".repeat(5 - Math.max(0, Math.min(5, parseInt(n, 10) || 0)));
        const tls = Array.isArray(e.tugas) ? e.tugas : [];
        return `
            <div style="font-family:Arial,Helvetica,sans-serif; color:#111; max-width:700px; margin:0 auto">
                <div style="text-align:center; border-bottom:3px solid #111; padding-bottom:10px; margin-bottom:14px">
                    <div style="font-size:18px; font-weight:900">EVALUASI KEGIATAN OSIS</div>
                    <div style="font-size:12px">SMK Taruna Harapan 1 Cipatat</div>
                </div>
                <h2 style="font-size:20px; margin:0 0 4px">${escapeHtml(e.nama_kegiatan || "Tanpa nama")}</h2>
                <p style="font-size:12px; color:#444; margin:0 0 12px">${Evaluasi.fmtTanggal(e.tgl_kegiatan)} · ${esc(e.divisi)} · PJ: ${esc(e.pj)} · Rating: ${parseInt(e.rating_total, 10) || 0}/5</p>
                <p style="font-size:12px"><b>Persiapan:</b> ${stars(e.r_persiapan)} &nbsp; <b>Pelaksanaan:</b> ${stars(e.r_pelaksanaan)} &nbsp; <b>Koordinasi:</b> ${stars(e.r_koordinasi)}<br><b>Ketepatan waktu:</b> ${stars(e.r_waktu)} &nbsp; <b>Anggaran:</b> ${stars(e.r_anggaran)}</p>
                ${baris("Berjalan baik", e.baik)}${baris("Kendala", e.kendala)}${baris("Penyebab", e.penyebab)}${baris("Solusi", e.solusi)}${baris("Perlu diperbaiki", e.perbaiki)}${baris("Rekomendasi", e.rekomendasi)}
                ${tls.length ? `<h4>Tindak Lanjut</h4><table border="1" cellspacing="0" cellpadding="6" style="width:100%; font-size:12px; border-collapse:collapse"><thead><tr><th>Tugas</th><th>PIC</th><th>Deadline</th><th>Status</th></tr></thead><tbody>${tls.map(t => `<tr><td>${escapeHtml(t.tugas || "-")}</td><td>${escapeHtml(t.pic || "-")}</td><td>${t.deadline ? Evaluasi.fmtTanggal(t.deadline) : "-"}</td><td>${t.status === "selesai" ? "Selesai" : "Belum"}</td></tr>`).join("")}</tbody></table>` : ""}
                <p style="font-size:11px; color:#666; margin-top:16px">Dicetak ${new Date().toLocaleString("id-ID")} dari website OSIS Tarpan One.</p>
            </div>`;
    },

    cetak() {
        const html = Evaluasi.isiPrint();
        if (!html) return;
        document.getElementById("printArea").innerHTML = html;
        window.print();
    }
};

document.addEventListener("DOMContentLoaded", () => Evaluasi.init());
