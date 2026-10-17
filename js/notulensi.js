// =========================================================================
// NOTULENSI RAPAT — halaman khusus OSIS, gaya halaman Informasi.
// Daftar = baris arsip (klik -> ?id=), single = artikel terhias + cetak/PDF.
// Form tambah/ubah tetap popup. Kelola butuh hak "notulensi".
// =========================================================================

const Notulensi = {
    cache: [],
    offset: 0,
    habis: false,
    loading: false,
    perPage: 20,
    filter: { q: "", divisi: "", status: "", tanggal: "" },
    editingId: null,
    singleId: null,
    singleItem: null,
    pendingFiles: [],
    existingLampiran: [],
    _previewUrls: [],
    terinisialisasi: false,

    STATUS_LABEL: { rencana: "Rencana", selesai: "Selesai", belum_tindaklanjut: "Belum TL", batal: "Batal" },

    init() {
        if (Notulensi.terinisialisasi) return;
        Notulensi.terinisialisasi = true;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }

        // opsi divisi: BPH + Umum + daftar sekbid (fail silent)
        try {
            getSekbid().then(list => {
                const names = [...new Set((list || []).map(s => s.nama).filter(Boolean))];
                const opts = ["BPH", "Umum", ...names].map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
                const fd = document.getElementById("filterDivisi");
                if (fd) fd.innerHTML = `<option value="">Semua divisi</option>` + opts;
                const nd = document.getElementById("notDivisi");
                if (nd) nd.innerHTML = `<option value="">— Pilih —</option>` + opts;
            }).catch(() => {});
        } catch {}

        document.getElementById("btnBuatNotulensi")?.addEventListener("click", () => Notulensi.bukaForm());
        document.getElementById("btnBatalNotulensi")?.addEventListener("click", () => Notulensi.tutupForm());
        document.getElementById("btnSimpanNotulensi")?.addEventListener("click", () => Notulensi.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Notulensi.resetFilter());
        document.getElementById("btnTambahTl")?.addEventListener("click", () => Notulensi.tambahTlRow());

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

        // backdrop form + ESC
        document.getElementById("notulensiForm")?.addEventListener("click", (e) => {
            if (e.target.id === "notulensiForm") Notulensi.tutupForm();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("notulensiForm")?.classList.contains("open")) Notulensi.tutupForm();
        });

        if (typeof OsisAuth.refreshAkses === "function") {
            OsisAuth.refreshAkses().then(() => { Notulensi.cekKelola(); Notulensi.muat(); }).catch(() => {});
        }
        Notulensi.cekKelola();
        Notulensi.muat();
    },

    bolehKelola() {
        return !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("notulensi"));
    },

    cekKelola() {
        const btn = document.getElementById("btnBuatNotulensi");
        if (btn) btn.style.display = Notulensi.bolehKelola() ? "" : "none";
    },

    idDariUrl() {
        try {
            const v = new URLSearchParams(location.search).get("id");
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch { return null; }
    },

    linkUntuk(id) {
        return location.origin + location.pathname + "?id=" + id;
    },

    // ============ MUAT: single (?id=) atau daftar ============
    async muat() {
        const id = Notulensi.idDariUrl();
        if (id) { await Notulensi.muatSatu(id); return; }
        Notulensi.singleId = null;
        Notulensi.singleItem = null;
        const fc = document.getElementById("notulensiFilter");
        if (fc) fc.style.display = "";
        await Notulensi.muatDaftar(true);
    },

    async muatSatu(id) {
        const wrap = document.getElementById("notulensiWrap");
        if (!wrap) return;
        Notulensi.singleId = id;
        const fc = document.getElementById("notulensiFilter");
        if (fc) fc.style.display = "none";
        document.getElementById("btnBuatNotulensi")?.style.setProperty("display", "none");
        const kunci = "notulensi-" + id;
        const cached = (Notulensi.cache || []).find(x => String(x.id) === String(id))
            || (function () { try { return Cache.get(kunci); } catch { return null; } })();
        if (cached) {
            Notulensi.tampilSatu(cached);
            getNotulensiSatu(id).then(fresh => {
                if (fresh && JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    try { Cache.set(kunci, fresh); } catch {}
                    Notulensi.tampilSatu(fresh);
                }
            }).catch(() => {});
            return;
        }
        wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat notulensi...</div>`;
        try {
            const item = await getNotulensiSatu(id);
            if (item) { try { Cache.set(kunci, item); } catch {} }
            Notulensi.tampilSatu(item);
        } catch (err) {
            console.error(err);
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat. Cek koneksi.</div>
                <div style="text-align:center;margin-top:12px"><a class="btn btn-white btn-sm" href="notulensi"><i class="fa-solid fa-list"></i> Daftar notulensi</a></div>`;
        }
    },

    tampilSatu(a) {
        const wrap = document.getElementById("notulensiWrap");
        if (!wrap) return;
        document.querySelector(".notulensi-cols")?.classList.add("notulensi-view");
        if (!a) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-circle-info"></i> Notulensi tidak ditemukan (mungkin sudah dihapus).</div>
                <div style="text-align:center;margin-top:12px"><a class="btn btn-white btn-sm" href="notulensi"><i class="fa-solid fa-list"></i> Daftar notulensi</a></div>`;
            return;
        }
        Notulensi.singleItem = a;
        try { document.title = (a.judul || "Notulensi") + " — Notulensi OSIS TARPAN ONE"; } catch {}
        const kelola = Notulensi.bolehKelola();
        const lbl = Notulensi.STATUS_LABEL[a.status] || a.status || "-";
        const tls = Array.isArray(a.tindak_lanjut) ? a.tindak_lanjut : [];
        const lamp = Array.isArray(a.lampiran) ? a.lampiran : [];
        const nPeserta = Notulensi.jumlahPeserta(a.peserta);
        const grid = (a.tanggal || a.waktu_mulai || a.lokasi || a.divisi) ? `
                <div class="not-grid">
                    ${a.tanggal ? `<div class="ng-cell"><span class="ng-ico ng-blue"><i class="fa-solid fa-calendar-days"></i></span><span class="ng-lbl">Tanggal</span><b>${Notulensi.fmtTanggal(a.tanggal)}</b></div>` : ""}
                    ${(a.waktu_mulai || a.waktu_selesai) ? `<div class="ng-cell"><span class="ng-ico ng-pink"><i class="fa-regular fa-clock"></i></span><span class="ng-lbl">Waktu</span><b>${escapeHtml(Notulensi.fmtWaktu(a.waktu_mulai, a.waktu_selesai))}</b></div>` : ""}
                    ${a.lokasi ? `<div class="ng-cell"><span class="ng-ico ng-green"><i class="fa-solid fa-location-dot"></i></span><span class="ng-lbl">Tempat</span><b>${escapeHtml(a.lokasi)}</b></div>` : ""}
                    ${a.divisi ? `<div class="ng-cell"><span class="ng-ico ng-orange"><i class="fa-solid fa-layer-group"></i></span><span class="ng-lbl">Divisi</span><b>${escapeHtml(a.divisi)}</b></div>` : ""}
                </div>` : "";
        const orang = (a.pimpinan || a.notulis || nPeserta) ? `
                <div class="not-orang">
                    ${a.pimpinan ? `<span><i class="fa-solid fa-gavel"></i> Pimpinan: <b>${escapeHtml(a.pimpinan)}</b></span>` : ""}
                    ${a.notulis ? `<span><i class="fa-solid fa-pen"></i> Notulis: <b>${escapeHtml(a.notulis)}</b></span>` : ""}
                    ${nPeserta ? `<span><i class="fa-solid fa-users"></i> <b>${nPeserta} peserta</b></span>` : ""}
                </div>` : "";
        const pesertaBox = a.peserta ? `<div class="detail-sec"><h5><i class="fa-solid fa-users"></i> Peserta (${nPeserta})</h5><div class="detail-text">${escapeHtml(a.peserta)}</div></div>` : "";
        const tlHtml = tls.length ? `<div class="detail-sec"><h5><i class="fa-solid fa-list-check"></i> Tindak Lanjut</h5><table class="tl-tabel"><thead><tr><th>Tugas</th><th>PIC</th><th>Deadline</th><th>Status</th></tr></thead><tbody>${tls.map(t => `
            <tr><td>${escapeHtml(t.tugas || "-")}</td><td>${escapeHtml(t.pic || "-")}</td><td>${t.deadline ? Notulensi.fmtTanggal(t.deadline) : "-"}</td><td><span class="tl-status ${t.status === "selesai" ? "selesai" : "belum"}">${t.status === "selesai" ? "Selesai" : "Belum"}</span></td></tr>`).join("")}</tbody></table></div>` : "";
        const lampHtml = lamp.length ? `<div class="detail-sec"><h5><i class="fa-solid fa-paperclip"></i> Lampiran</h5><div class="notulensi-fotos">${lamp.map(l => {
            const p = typeof l === "string" ? l : l.path;
            return `<a href="${getFoto(p)}" target="_blank" rel="noopener"><img src="${getFoto(p)}" alt="Lampiran" loading="lazy"></a>`;
        }).join("")}</div></div>` : "";
        wrap.innerHTML = `
            <div style="margin-bottom:10px"><button class="btn btn-white btn-sm" onclick="Notulensi.kembali()"><i class="fa-solid fa-arrow-left"></i> Kembali</button></div>
            <article class="not-card">
                <div class="not-top">
                    <span class="not-kicker"><i class="fa-solid fa-thumbtack"></i> NOTULENSI RAPAT</span>
                    <span class="agenda-status ${a.status}">${escapeHtml(lbl)}</span>
                </div>
                <h1 class="not-judul">${escapeHtml(a.judul || "Tanpa judul")}</h1>
                ${a.agenda_topik ? `<div class="not-sub">Topik bahasan</div><p class="not-text">${escapeHtml(a.agenda_topik)}</p>` : ""}
                ${grid}
                ${orang}
                ${a.isi_pembahasan ? `<div class="detail-sec"><h5><i class="fa-solid fa-comments"></i> Hasil Pembahasan</h5><div class="detail-text">${escapeHtml(a.isi_pembahasan)}</div></div>` : ""}
                ${a.keputusan ? `<div class="not-keputusan"><i class="fa-solid fa-gavel"></i><div><b>Keputusan Rapat</b><p>${escapeHtml(a.keputusan)}</p></div></div>` : ""}
                ${tlHtml}
                ${pesertaBox}
                ${lampHtml}
                <div class="not-foot">
                    <span class="not-ava"><i class="fa-solid fa-user"></i></span>
                    <span class="not-terbit">Dicatat ${a.created_at ? escapeHtml(new Date(a.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })) : "-"}<br>OSIS TARPAN ONE</span>
                    <div class="not-actions">
                        <button class="btn btn-red btn-sm" onclick="Notulensi.salinLink(${a.id})"><i class="fa-solid fa-link"></i> Salin Link</button>
                        <button class="btn btn-white btn-sm" onclick="Notulensi.cetak()"><i class="fa-solid fa-print"></i> Cetak</button>
                        <button class="btn btn-white btn-sm" onclick="Notulensi.exportPdf()"><i class="fa-solid fa-file-pdf"></i> PDF</button>
                        ${kelola ? `<button class="btn btn-white btn-sm" onclick="Notulensi.edit(${a.id})"><i class="fa-solid fa-pen"></i> Ubah</button>` : ""}
                        ${kelola ? `<button class="btn btn-white btn-sm" onclick="Notulensi.hapus(${a.id})"><i class="fa-solid fa-trash-can"></i> Hapus</button>` : ""}
                    </div>
                </div>
            </article>
            <div style="text-align:center;margin-top:12px"><a class="btn btn-white btn-sm" href="notulensi"><i class="fa-solid fa-list"></i> Daftar notulensi</a></div>`;
    },

    // ============ DAFTAR (paginasi hemat egress: 20/halaman + sentinel) ============
    async muatDaftar(awal = true) {
        const wrap = document.getElementById("notulensiWrap");
        if (!wrap) return;
        if (Notulensi.loading) return;
        if (!awal && Notulensi.habis) return;
        Notulensi.loading = true;
        if (awal) {
            Notulensi.offset = 0;
            Notulensi.habis = false;
            const cached = (function () { try { return Cache.get("notulensi"); } catch { return null; } })();
            if (cached && cached.length) {
                Notulensi.cache = cached.slice();
                try { Notulensi.tampilDaftar(); } catch {}
            } else {
                Notulensi.cache = [];
                wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat notulensi...</div>`;
            }
        } else {
            const btn = document.getElementById("notLagi");
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...'; }
        }
        try {
            const rows = await getNotulensi(Notulensi.perPage, Notulensi.offset);
            if (awal) Notulensi.cache = [];
            const ada = new Set(Notulensi.cache.map(a => String(a.id)));
            (rows || []).forEach(r => {
                if (!ada.has(String(r.id))) { Notulensi.cache.push(r); ada.add(String(r.id)); }
            });
            Notulensi.offset = Notulensi.cache.length;
            if (!rows || rows.length < Notulensi.perPage) {
                Notulensi.habis = true;
                try { Cache.set("notulensi", Notulensi.cache); } catch {}
            }
            Notulensi.tampilDaftar();
        } catch (err) {
            console.error(err);
            if (awal && !Notulensi.cache.length) {
                wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat. Cek koneksi.<br><br><button class="btn btn-red btn-sm" onclick="Notulensi.muat()"><i class="fa-solid fa-rotate-right"></i> Coba Lagi</button></div>`;
            } else if (awal) {
                showToast("Gagal refresh, tampil data lama.", "error");
            } else {
                showToast("Gagal muat lanjutan.", "error");
                try { Notulensi.tampilDaftar(); } catch {}
            }
        } finally {
            Notulensi.loading = false;
        }
    },

    jejaki() {
        try { if (Notulensi._io) Notulensi._io.disconnect(); } catch {}
        Notulensi._io = null;
        let io = null;
        try {
            if (!Notulensi.habis && typeof pasangSentinel === "function") {
                io = pasangSentinel("notSentinel", () => Notulensi.muatDaftar(false));
            }
        } catch { io = null; }
        Notulensi._io = io;
        const btn = document.getElementById("notLagi");
        if (btn) btn.style.display = (!io && !Notulensi.habis && (Notulensi.cache || []).length) ? "" : "none";
    },

    tampilDaftar() {
        const wrap = document.getElementById("notulensiWrap");
        if (!wrap) return;
        document.querySelector(".notulensi-cols")?.classList.remove("notulensi-view");
        const kelola = Notulensi.bolehKelola();
        const f = Notulensi.filter;
        const q = (f.q || "").trim().toLowerCase();
        const data = (Notulensi.cache || []).filter(a => {
            if (q && !(`${a.judul || ""} ${a.agenda_topik || ""}`.toLowerCase().includes(q))) return false;
            if (f.divisi && (a.divisi || "") !== f.divisi) return false;
            if (f.status && (a.status || "") !== f.status) return false;
            if (f.tanggal && (a.tanggal || "") !== f.tanggal) return false;
            return true;
        });
        const ekor = `<div id="notSentinel" aria-hidden="true" style="height:2px"></div>
            <div style="text-align:center;margin:6px 0 2px"><button id="notLagi" class="btn btn-white btn-sm" style="display:none" onclick="Notulensi.muatDaftar(false)"><i class="fa-solid fa-rotate-right"></i> Muat lagi</button></div>`;
        if (!(Notulensi.cache || []).length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-clipboard-list"></i> Belum ada notulensi.${kelola ? " Klik <b>Buat Notulensi</b> buat mencatat hasil rapat pertama." : ""}</div>` + ekor;
            Notulensi.jejaki();
            return;
        }
        if (!data.length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Notulensi.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>` + ekor;
            Notulensi.jejaki();
            return;
        }
        wrap.innerHTML = data.map(a => {
            const lbl = Notulensi.STATUS_LABEL[a.status] || a.status || "-";
            return `
            <div class="not-row">
                <a class="not-row-main" href="notulensi?id=${a.id}">
                    <span class="not-row-date"><b>${escapeHtml((a.tanggal || "").slice(8, 10) || "•")}</b><small>${escapeHtml(Notulensi.blnSingkat(a.tanggal))}</small></span>
                    <span style="min-width:0">
                        <span class="not-row-judul">${escapeHtml(a.judul || "Tanpa judul")}</span>
                        <span class="not-row-sub">${escapeHtml(a.lokasi || "-")} · ${escapeHtml(Notulensi.fmtWaktu(a.waktu_mulai, a.waktu_selesai))} · ${Notulensi.jumlahPeserta(a.peserta)} peserta</span>
                    </span>
                    <span class="agenda-status ${a.status}">${escapeHtml(lbl)}</span>
                    <i class="fa-solid fa-chevron-right chev"></i>
                </a>
                <div class="not-row-ops">
                    <button class="btn btn-white btn-sm" onclick="Notulensi.salinLink(${a.id})" title="Salin link share"><i class="fa-solid fa-link"></i></button>
                    ${kelola ? `<button class="btn btn-white btn-sm" onclick="Notulensi.edit(${a.id})" title="Ubah"><i class="fa-solid fa-pen"></i></button>` : ""}
                    ${kelola ? `<button class="btn btn-white btn-sm" onclick="Notulensi.hapus(${a.id})" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                </div>
            </div>`;
        }).join("") + ekor;
        Notulensi.jejaki();
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

    blnSingkat(t) {
        if (!t) return "";
        try {
            return new Date(t).toLocaleDateString("id-ID", { month: "short", year: "2-digit" });
        } catch { return ""; }
    },

    fmtWaktu(mulai, selesai) {
        if (mulai && selesai) return `${mulai}–${selesai}`;
        return mulai || selesai || "-";
    },

    bacaFilter() {
        Notulensi.filter = {
            q: document.getElementById("filterQ")?.value || "",
            divisi: document.getElementById("filterDivisi")?.value || "",
            status: document.getElementById("filterStatus")?.value || "",
            tanggal: document.getElementById("filterTanggal")?.value || ""
        };
        Notulensi.tampilDaftar();
    },

    resetFilter() {
        ["filterQ", "filterDivisi", "filterStatus", "filterTanggal"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        Notulensi.bacaFilter();
    },

    kembali() {
        try {
            if (document.referrer && document.referrer.includes("notulensi")) {
                history.back();
                return;
            }
        } catch {}
        location.replace("notulensi");
    },

    async salinLink(id) {
        const link = Notulensi.linkUntuk(id);
        try {
            await navigator.clipboard.writeText(link);
            showToast("Link tersalin, tinggal tempel di grup!", "success");
        } catch {
            const ta = document.createElement("textarea");
            ta.value = link;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); showToast("Link tersalin!", "success"); }
            catch { showPopup(link, "info"); }
            ta.remove();
        }
    },

    // ============ FORM (popup tambah/ubah, tidak berubah) ============
    bukaForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (typeof OsisAuth.butuh === "function" && !OsisAuth.butuh("notulensi")) return;
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
    },

    edit(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (typeof OsisAuth.butuh === "function" && !OsisAuth.butuh("notulensi")) return;
        const item = (Notulensi.cache || []).find(a => String(a.id) === String(id))
            || (Notulensi.singleItem && String(Notulensi.singleItem.id) === String(id) ? Notulensi.singleItem : null);
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
        if (typeof OsisAuth.butuh === "function" && !OsisAuth.butuh("notulensi")) return;
        const f = Notulensi.kumpulkanForm();
        const id = document.getElementById("notId").value ? parseInt(document.getElementById("notId").value, 10) : null;
        if (!f.judul) { showToast("Judul rapat wajib diisi", "error"); return; }
        if (!f.tanggal) { showToast("Tanggal wajib diisi", "error"); return; }

        const __spec = () => {
            const { lampiran, ...rest } = f;
            return { modul: "notulensi", op: id ? "update" : "create",
                label: "Notulensi: " + String(f.judul).slice(0, 42),
                payload: { id: id || null, f: rest, existing: [...(Notulensi.existingLampiran || [])] },
                files: (Notulensi.pendingFiles || []).filter(fl => fl.type && fl.type.startsWith("image/"))
                    .map((fl, i) => ({ slot: "lampiran" + i, file: fl, name: fl.name, type: fl.type })),
                cacheKeys: ["notulensi"] };
        };
        const __sesudahAntre = () => { Notulensi.tutupForm(); };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
            return;
        }

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
                Notulensi.tutupForm();
                try { Cache.del("notulensi-" + id); } catch {}
                if (Notulensi.singleId) await Notulensi.muatSatu(Notulensi.singleId);
                else await Notulensi.muatDaftar(true);
            } else {
                const newId = await buatNotulensi(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Notulensi terbit! Link siap dibagikan.", "success");
                Notulensi.tutupForm();
                try { Cache.del("notulensi"); } catch {}
                location.replace("notulensi?id=" + newId);
            }
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

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (typeof OsisAuth.butuh === "function" && !OsisAuth.butuh("notulensi")) return;
        const item = (Notulensi.cache || []).find(a => String(a.id) === String(id)) || Notulensi.singleItem;
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
            try { Cache.del("notulensi"); Cache.del("notulensi-" + id); } catch {}
            Notulensi.cache = (Notulensi.cache || []).filter(a => String(a.id) !== String(id));
            if (Notulensi.singleId) location.replace("notulensi");
            else await Notulensi.muatDaftar(true);
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ CETAK / PDF (dari artikel single) ============
    isiPrint() {
        const a = Notulensi.singleItem;
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
        document.getElementById("printArea").innerHTML = html;
        window.print();
    },

    exportPdf() {
        const a = Notulensi.singleItem;
        const html = Notulensi.isiPrint();
        if (!html) return;
        document.getElementById("printArea").innerHTML = html;
        const oldTitle = document.title;
        document.title = "Notulensi - " + (a.judul || "rapat");
        showToast("Pilih 'Save as PDF' di dialog print", "info");
        window.print();
        setTimeout(() => { document.title = oldTitle; }, 500);
    }
};

document.addEventListener("DOMContentLoaded", () => Notulensi.init());
