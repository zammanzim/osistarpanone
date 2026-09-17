// =========================================================================
// KEUANGAN — halaman khusus OSIS (folder /osis)
// Dipakai di osis/keuangan.html — kas masuk/keluar, saldo = saldo awal +
// masuk - keluar (dihitung client). Bukti foto drag & drop folder kas/.
// Export/cetak laporan via print CSS. Visual ikut design system Agenda.
// =========================================================================

const Keuangan = {
    cache: [],
    saldoAwal: [],
    prokerCache: [],
    agendaCache: [],
    filter: { q: "", jenis: "", kategori: "", divisi: "", periode: "", sort: "baru" },
    editingId: null,
    detailId: null,
    jenisForm: "keluar",
    stagedFile: null,
    stagedUrl: null,
    existingBukti: "",

    KAT_MASUK: ["Kas", "Sponsorship", "Donasi", "Dana Sekolah", "Penjualan", "Lainnya"],
    KAT_KELUAR: ["Konsumsi", "Perlengkapan", "Transportasi", "Administrasi", "Dokumentasi", "Acara", "Lainnya"],

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
            const dd = document.getElementById("kasDivisi");
            if (dd) dd.innerHTML = `<option value="">— Pilih —</option>` + opts;
            const fd = document.getElementById("filterDivisi");
            if (fd) fd.innerHTML = `<option value="">Semua</option>` + opts;
        } catch {}

        document.getElementById("btnTambahKas")?.addEventListener("click", () => Keuangan.bukaForm());
        document.getElementById("btnBatalKas")?.addEventListener("click", () => Keuangan.tutupForm());
        document.getElementById("btnSimpanKas")?.addEventListener("click", () => Keuangan.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Keuangan.resetFilter());
        document.getElementById("btnSaldoAwal")?.addEventListener("click", () => Keuangan.editSaldoAwal());
        document.getElementById("btnExport")?.addEventListener("click", () => Keuangan.exportPdf());
        document.getElementById("btnCetak")?.addEventListener("click", () => Keuangan.cetak());
        document.getElementById("btnDownloadBukti")?.addEventListener("click", () => Keuangan.downloadBukti());
        document.getElementById("btnEditDariDetail")?.addEventListener("click", () => {
            const id = Keuangan.detailId;
            Keuangan.tutupDetail();
            if (id) Keuangan.edit(id);
        });
        document.getElementById("btnHapusDariDetail")?.addEventListener("click", () => {
            const id = Keuangan.detailId;
            if (id) Keuangan.hapus(id, true);
        });

        ["filterQ", "filterJenis", "filterKategori", "filterDivisi", "filterPeriode", "filterSort"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Keuangan.bacaFilter());
        });

        // bukti drag & drop (gambar)
        const drop = document.getElementById("kasDrop");
        const fileInput = document.getElementById("kasBukti");
        if (drop && fileInput) {
            drop.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", (e) => {
                Keuangan.handleFile(e.target.files && e.target.files[0]);
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
                if (f) Keuangan.handleFile(f);
            });
        }

        document.getElementById("kasWrap")?.addEventListener("click", (e) => {
            const row = e.target.closest("[data-kas-row]");
            if (row) Keuangan.detail(row.dataset.kasRow);
        });

        ["kasForm", "kasDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "kasForm") Keuangan.tutupForm();
                    else Keuangan.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("kasForm")?.classList.contains("open")) Keuangan.tutupForm();
            if (document.getElementById("kasDetail")?.classList.contains("open")) Keuangan.tutupDetail();
        });

        await Keuangan.muat();
    },

    // ============ HELPERS ============
    rp(n) {
        return "Rp" + (parseInt(n, 10) || 0).toLocaleString("id-ID");
    },

    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return t; }
    },

    fmtTanggalWaktu(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch { return "-"; }
    },

    periodeOf(t) {
        return (t.tanggal || "").slice(0, 4);
    },

    prokerName(id) {
        if (!id) return "";
        const p = (Keuangan.prokerCache || []).find(x => String(x.id) === String(id));
        return p ? p.nama : `#${id} (dihapus)`;
    },

    agendaName(id) {
        if (!id) return "";
        const a = (Keuangan.agendaCache || []).find(x => String(x.id) === String(id));
        return a ? a.judul : `#${id} (dihapus)`;
    },

    saldoAwalUntuk(periode) {
        if (periode) {
            const r = (Keuangan.saldoAwal || []).find(s => String(s.periode) === String(periode));
            return parseInt(r ? r.nominal : 0, 10) || 0;
        }
        return (Keuangan.saldoAwal || []).reduce((a, s) => a + (parseInt(s.nominal, 10) || 0), 0);
    },

    // ============ DATA ============
    async muat() {
        try {
            const cached = Cache.get("kas");
            const [pk, ag] = await Promise.all([
                getProker().catch(() => []),
                getAllAgenda().catch(() => [])
            ]);
            Keuangan.prokerCache = pk || [];
            Keuangan.agendaCache = ag || [];
            Keuangan.buildOptions();
            try {
                Keuangan.saldoAwal = await getSaldoAwal();
            } catch { Keuangan.saldoAwal = []; }
            if (cached) {
                Keuangan.cache = cached;
                Keuangan.render();
                getKas().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("kas", fresh);
                        Keuangan.cache = fresh || [];
                        Keuangan.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getKas();
            Cache.set("kas", data);
            Keuangan.cache = data || [];
            Keuangan.render();
        } catch (err) {
            console.error(err);
            document.getElementById("kasWrap").innerHTML = `<div class="pesan-empty">Gagal memuat transaksi.</div>`;
        }
    },

    buildOptions() {
        const pers = [...new Set((Keuangan.cache || []).map(t => Keuangan.periodeOf(t)).filter(Boolean))].sort().reverse();
        const fp = document.getElementById("filterPeriode");
        if (fp) {
            const cur = fp.value || Keuangan.filter.periode || "";
            fp.innerHTML = `<option value="">Semua</option>` + pers.map(p => `<option value="${p}">${p}</option>`).join("");
            fp.value = cur;
            Keuangan.filter.periode = cur;
        }
        const kats = [...new Set((Keuangan.cache || []).map(t => t.kategori).filter(Boolean))].sort();
        const fk = document.getElementById("filterKategori");
        if (fk) {
            const cur = fk.value || Keuangan.filter.kategori || "";
            fk.innerHTML = `<option value="">Semua</option>` + kats.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join("");
            fk.value = cur;
            Keuangan.filter.kategori = cur;
        }
        const tp = document.getElementById("kasProker");
        if (tp) {
            tp.innerHTML = `<option value="">— Tidak ada —</option>` + (Keuangan.prokerCache || []).map(p => `<option value="${p.id}">${escapeHtml(p.nama || "Tanpa nama")}</option>`).join("");
        }
        const ta = document.getElementById("kasAgenda");
        if (ta) {
            const list = [...(Keuangan.agendaCache || [])].sort((a, b) => String(b.tanggal || "") < String(a.tanggal || "") ? -1 : 1);
            ta.innerHTML = `<option value="">— Tidak ada —</option>` + list.map(a => {
                const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "";
                return `<option value="${a.id}">${escapeHtml(a.judul || "Tanpa judul")}${tgl ? " · " + tgl : ""}</option>`;
            }).join("");
        }
    },

    dataTampil() {
        const all = Keuangan.cache || [];
        const f = Keuangan.filter;
        const q = f.q.trim().toLowerCase();
        let data = all.filter(t => {
            if (q && !(`${t.keterangan || ""} ${t.catatan || ""} ${t.pic || ""}`.toLowerCase().includes(q))) return false;
            if (f.jenis && (t.jenis || "") !== f.jenis) return false;
            if (f.kategori && (t.kategori || "") !== f.kategori) return false;
            if (f.divisi && (t.divisi || "") !== f.divisi) return false;
            if (f.periode && Keuangan.periodeOf(t) !== String(f.periode)) return false;
            return true;
        });
        if (f.sort === "lama") data = [...data].sort((a, b) => String(a.tanggal || "") > String(b.tanggal || "") ? 1 : -1);
        else if (f.sort === "besar") data = [...data].sort((a, b) => (parseInt(b.nominal, 10) || 0) - (parseInt(a.nominal, 10) || 0));
        else if (f.sort === "kecil") data = [...data].sort((a, b) => (parseInt(a.nominal, 10) || 0) - (parseInt(b.nominal, 10) || 0));
        else data = [...data].sort((a, b) => String(a.tanggal || "") < String(b.tanggal || "") ? 1 : -1);
        return data;
    },

    // ============ RENDER ============
    render() {
        const data = Keuangan.dataTampil();
        const f = Keuangan.filter;
        const sum = (jenis) => data.filter(t => (t.jenis || "") === jenis).reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
        const masuk = sum("masuk");
        const keluar = sum("keluar");
        const awal = Keuangan.saldoAwalUntuk(f.periode);
        const saldo = awal + masuk - keluar;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("saldoAkhir", Keuangan.rp(saldo));
        set("saldoAwalVal", Keuangan.rp(awal));
        set("rumusMasuk", "+ " + Keuangan.rp(masuk));
        set("rumusKeluar", "− " + Keuangan.rp(keluar));
        set("saldoPeriodeLbl", f.periode ? `· Periode ${f.periode}` : "· Semua periode");
        set("statMasuk", Keuangan.rp(masuk));
        set("statKeluar", Keuangan.rp(keluar));
        set("statCount", data.length + " transaksi");
        set("statSelisih", (masuk - keluar < 0 ? "− " : "") + Keuangan.rp(Math.abs(masuk - keluar)));

        // rekap per bulan (dari data tampil)
        const byBulan = {};
        data.forEach(t => {
            const ym = (t.tanggal || "").slice(0, 7);
            if (!ym) return;
            if (!byBulan[ym]) byBulan[ym] = { masuk: 0, keluar: 0 };
            byBulan[ym][t.jenis === "masuk" ? "masuk" : "keluar"] += parseInt(t.nominal, 10) || 0;
        });
        const keys = Object.keys(byBulan).sort().reverse().slice(0, 6);
        const rb = document.getElementById("rekapBody");
        if (rb) {
            if (!keys.length) {
                rb.innerHTML = `<div class="pesan-empty">Belum ada data rekap.</div>`;
            } else {
                const max = Math.max(...keys.map(k => Math.max(byBulan[k].masuk, byBulan[k].keluar)), 1);
                const namaBulan = (ym) => {
                    try {
                        return new Date(ym + "-01").toLocaleDateString("id-ID", { month: "long", year: "numeric" });
                    } catch { return ym; }
                };
                rb.innerHTML = keys.map(ym => {
                    const b = byBulan[ym];
                    return `<div class="rekap-row">
                        <div class="top"><span>${namaBulan(ym)}</span><small>Selisih ${Keuangan.rp(b.masuk - b.keluar)}</small></div>
                        <div class="top"><small>Masuk ${Keuangan.rp(b.masuk)}</small></div>
                        <div class="bar masuk"><span style="width:${Math.round(b.masuk / max * 100)}%"></span></div>
                        <div class="top" style="margin-top:4px"><small>Keluar ${Keuangan.rp(b.keluar)}</small></div>
                        <div class="bar keluar"><span style="width:${Math.round(b.keluar / max * 100)}%"></span></div>
                    </div>`;
                }).join("");
            }
            const rt = document.getElementById("rekapTitle");
            if (rt) rt.textContent = f.periode ? `Rekap Periode ${f.periode}` : "Rekap Per Bulan";
        }

        // rekap proker — tampil kalau filter proker? (filter tidak ada proker; tampil ringkas top proker)
        const pc = document.getElementById("prokerCard");
        if (pc) {
            const byProker = {};
            (Keuangan.cache || []).forEach(t => {
                if (!t.proker_id) return;
                const k = String(t.proker_id);
                if (!byProker[k]) byProker[k] = { masuk: 0, keluar: 0 };
                byProker[k][t.jenis === "masuk" ? "masuk" : "keluar"] += parseInt(t.nominal, 10) || 0;
            });
            const pkeys = Object.keys(byProker);
            if (!pkeys.length) {
                pc.style.display = "none";
            } else {
                pc.style.display = "";
                document.getElementById("prokerBody").innerHTML = pkeys.map(k => {
                    const b = byProker[k];
                    return `<div class="rekap-row">
                        <div class="top"><span>${escapeHtml(Keuangan.prokerName(k))}</span><small>Sisa ${Keuangan.rp(b.masuk - b.keluar)}</small></div>
                        <div class="top"><small>Masuk ${Keuangan.rp(b.masuk)} · Keluar ${Keuangan.rp(b.keluar)}</small></div>
                    </div>`;
                }).join("");
            }
        }

        // tabel
        const wrap = document.getElementById("kasWrap");
        if (!wrap) return;
        if (!(Keuangan.cache || []).length) {
            wrap.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-wallet" style="color:var(--red)"></i></div><b>Belum ada transaksi</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Tambahkan transaksi pertama untuk mulai mencatat keuangan OSIS.</p><button class="btn btn-red btn-sm" onclick="Keuangan.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Transaksi</button></div>`;
            return;
        }
        if (!data.length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Keuangan.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            return;
        }
        wrap.innerHTML = `<table class="kas-tabel"><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Jenis</th><th>Kategori</th><th>Nominal</th></tr></thead><tbody>${data.map(t => `
            <tr data-kas-row="${t.id}">
                <td style="white-space:nowrap">${Keuangan.fmtTanggal(t.tanggal)}</td>
                <td><b>${escapeHtml(t.keterangan || "Tanpa keterangan")}</b><br><small style="color:var(--gray)">${escapeHtml(t.pic || "-")}</small></td>
                <td><span class="jenis ${t.jenis}">${t.jenis === "masuk" ? "Pemasukan" : "Pengeluaran"}</span></td>
                <td>${escapeHtml(t.kategori || "-")}</td>
                <td class="nominal ${t.jenis}">${t.jenis === "masuk" ? "+" : "−"} ${Keuangan.rp(t.nominal)}</td>
            </tr>`).join("")}</tbody></table>`;
    },

    bacaFilter() {
        Keuangan.filter = {
            q: document.getElementById("filterQ").value || "",
            jenis: document.getElementById("filterJenis").value || "",
            kategori: document.getElementById("filterKategori").value || "",
            divisi: document.getElementById("filterDivisi").value || "",
            periode: document.getElementById("filterPeriode").value || "",
            sort: document.getElementById("filterSort").value || "baru"
        };
        Keuangan.render();
    },

    resetFilter() {
        ["filterQ", "filterJenis", "filterKategori", "filterDivisi", "filterPeriode"].forEach(id => {
            document.getElementById(id).value = "";
        });
        document.getElementById("filterSort").value = "baru";
        Keuangan.bacaFilter();
    },

    // ============ SALDO AWAL ============
    async editSaldoAwal() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const periode = Keuangan.filter.periode || String(new Date().getFullYear());
        const cur = Keuangan.saldoAwalUntuk(periode);
        const res = await showPopup("Saldo awal", "form", {
            title: `Saldo Awal Periode ${periode}`,
            fields: [{ name: "nominal", label: "Nominal (Rp)", type: "number", placeholder: "1000000", value: String(cur) }]
        });
        if (!res && res !== 0) return;
        const val = typeof res === "object" ? res.nominal : res;
        const nominal = parseInt(val, 10);
        if (!Number.isFinite(nominal) || nominal < 0) { showToast("Nominal tidak valid", "error"); return; }
        try {
            await setSaldoAwal(u.id, parseInt(periode, 10), nominal);
            const ex = Keuangan.saldoAwal.find(s => String(s.periode) === String(periode));
            if (ex) ex.nominal = nominal;
            else Keuangan.saldoAwal.push({ periode: parseInt(periode, 10), nominal });
            showToast("Saldo awal diperbarui!", "success");
            Keuangan.render();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        }
    },

    // ============ FORM ============
    setJenis(j) {
        Keuangan.jenisForm = j;
        const m = document.getElementById("jenisMasuk");
        const k = document.getElementById("jenisKeluar");
        if (m) m.className = j === "masuk" ? "on-masuk" : "";
        if (k) k.className = j === "keluar" ? "on-keluar" : "";
        const ks = document.getElementById("kasKategori");
        if (ks) {
            const list = j === "masuk" ? Keuangan.KAT_MASUK : Keuangan.KAT_KELUAR;
            const cur = ks.value;
            ks.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join("");
            if (list.includes(cur)) ks.value = cur;
        }
    },

    bukaForm() {
        Keuangan.editingId = null;
        Keuangan.stagedFile = null;
        Keuangan.existingBukti = "";
        Keuangan._revokeStaged();
        document.getElementById("kasId").value = "";
        Keuangan.setJenis("keluar");
        document.getElementById("kasTanggal").value = Keuangan.hariIni();
        document.getElementById("kasNominal").value = "";
        document.getElementById("kasKeterangan").value = "";
        document.getElementById("kasDivisi").value = "";
        document.getElementById("kasPic").value = "";
        document.getElementById("kasProker").value = "";
        document.getElementById("kasAgenda").value = "";
        document.getElementById("kasCatatan").value = "";
        const fi = document.getElementById("kasBukti");
        if (fi) fi.value = "";
        document.getElementById("kasFormTitle").textContent = "Tambah Transaksi";
        Keuangan.renderBukti();
        document.getElementById("kasForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("kasNominal")?.focus(), 80);
    },

    edit(id) {
        const item = Keuangan.cache.find(t => String(t.id) === String(id));
        if (!item) return;
        Keuangan.editingId = id;
        Keuangan.stagedFile = null;
        Keuangan._revokeStaged();
        Keuangan.existingBukti = item.bukti_path || "";
        document.getElementById("kasId").value = id;
        Keuangan.setJenis(item.jenis === "masuk" ? "masuk" : "keluar");
        const ks = document.getElementById("kasKategori");
        if (ks && item.kategori && ![...ks.options].some(o => o.value === item.kategori)) {
            const op = document.createElement("option");
            op.value = item.kategori;
            op.textContent = item.kategori;
            ks.appendChild(op);
        }
        document.getElementById("kasTanggal").value = item.tanggal || "";
        document.getElementById("kasNominal").value = item.nominal ?? "";
        document.getElementById("kasKeterangan").value = item.keterangan || "";
        if (ks) ks.value = item.kategori || "Lainnya";
        const dv = document.getElementById("kasDivisi");
        if (dv) {
            if (item.divisi && ![...dv.options].some(o => o.value === item.divisi)) {
                const op = document.createElement("option");
                op.value = item.divisi;
                op.textContent = item.divisi;
                dv.appendChild(op);
            }
            dv.value = item.divisi || "";
        }
        document.getElementById("kasPic").value = item.pic || "";
        document.getElementById("kasProker").value = item.proker_id || "";
        document.getElementById("kasAgenda").value = item.agenda_id || "";
        document.getElementById("kasCatatan").value = item.catatan || "";
        const fi = document.getElementById("kasBukti");
        if (fi) fi.value = "";
        document.getElementById("kasFormTitle").textContent = "Edit Transaksi";
        Keuangan.renderBukti();
        document.getElementById("kasForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupForm() {
        document.getElementById("kasForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Keuangan.editingId = null;
        Keuangan.stagedFile = null;
        Keuangan.existingBukti = "";
        Keuangan._revokeStaged();
        const fi = document.getElementById("kasBukti");
        if (fi) fi.value = "";
        const drop = document.getElementById("kasDrop");
        if (drop) drop.classList.remove("dragover");
    },

    hariIni() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },

    handleFile(file) {
        if (!file) return;
        if (!file.type || !file.type.startsWith("image/")) {
            showToast("Bukti harus foto (JPG/PNG)", "error");
            return;
        }
        Keuangan._revokeStaged();
        Keuangan.stagedFile = file;
        Keuangan.stagedUrl = URL.createObjectURL(file);
        Keuangan.renderBukti();
    },

    _revokeStaged() {
        if (Keuangan.stagedUrl) { try { URL.revokeObjectURL(Keuangan.stagedUrl); } catch {} }
        Keuangan.stagedUrl = null;
    },

    renderBukti() {
        const drop = document.getElementById("kasDrop");
        const inner = document.getElementById("kasDropInner");
        if (!drop) return;
        drop.querySelectorAll("img").forEach(i => i.remove());
        let src = "";
        if (Keuangan.stagedFile && Keuangan.stagedUrl) src = Keuangan.stagedUrl;
        else if (Keuangan.existingBukti) src = getFoto(Keuangan.existingBukti);
        if (src) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "Bukti";
            drop.prepend(img);
            if (inner) inner.style.display = "none";
        } else if (inner) {
            inner.style.display = "";
        }
    },

    kumpulkanForm() {
        const v = (id) => document.getElementById(id).value.trim();
        const num = (id) => {
            const n = parseInt(document.getElementById(id).value, 10);
            return Number.isFinite(n) ? n : null;
        };
        return {
            jenis: Keuangan.jenisForm,
            tanggal: document.getElementById("kasTanggal").value || null,
            keterangan: v("kasKeterangan"),
            kategori: v("kasKategori") || "Lainnya",
            nominal: parseInt(document.getElementById("kasNominal").value, 10) || 0,
            divisi: v("kasDivisi"),
            pic: v("kasPic"),
            proker_id: num("kasProker"),
            agenda_id: num("kasAgenda"),
            catatan: v("kasCatatan")
        };
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const f = Keuangan.kumpulkanForm();
        const id = document.getElementById("kasId").value ? parseInt(document.getElementById("kasId").value, 10) : null;
        if (!f.tanggal) { showToast("Tanggal wajib diisi", "error"); return; }
        if (!f.keterangan) { showToast("Keterangan wajib diisi", "error"); return; }
        if (!f.nominal || f.nominal <= 0) { showToast("Nominal harus lebih dari 0", "error"); return; }

        const btn = document.getElementById("btnSimpanKas");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            let bukti = Keuangan.existingBukti || "";
            if (Keuangan.stagedFile) {
                const fl = Keuangan.stagedFile;
                const ext = (fl.name.split(".").pop() || "jpg").toLowerCase();
                const path = `kas/kas-${u.id}-${Date.now()}.${ext}`;
                await uploadFotoStorage(fl, path);
                if (bukti && bukti !== path) { try { await hapusFotoStorage(bukti); } catch {} }
                bukti = path;
            }
            f.bukti_path = bukti;
            if (id) {
                await updateKas(u.id, id, f);
                showToast("Transaksi diperbarui! Saldo otomatis update.", "success");
            } else {
                const newId = await buatKas(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Transaksi tersimpan! Saldo otomatis update.", "success");
            }
            Keuangan.tutupForm();
            await Keuangan.muat();
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
        const item = Keuangan.cache.find(t => String(t.id) === String(id));
        const yakin = await showPopup(`Hapus transaksi "${item ? item.keterangan : ""}" (${item ? Keuangan.rp(item.nominal) : ""})? Saldo ikut berubah.`, "confirm");
        if (!yakin) return;
        try {
            await hapusKas(u.id, id);
            if (item && item.bukti_path) { try { await hapusFotoStorage(item.bukti_path); } catch {} }
            if (dariDetail) Keuangan.tutupDetail();
            showToast("Transaksi dihapus, saldo diperbarui", "success");
            await Keuangan.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ DETAIL ============
    detail(id) {
        const t = Keuangan.cache.find(x => String(x.id) === String(id));
        if (!t) return;
        Keuangan.detailId = id;
        const masuk = t.jenis === "masuk";
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        document.getElementById("kasDetailBody").innerHTML = `
            <h4 style="font-size:1rem; font-weight:900; overflow-wrap:anywhere">${escapeHtml(t.keterangan || "Tanpa keterangan")}</h4>
            <div style="margin:6px 0 2px; display:flex; gap:6px; align-items:center; flex-wrap:wrap">
                <span class="jenis ${t.jenis}">${masuk ? "Pemasukan" : "Pengeluaran"}</span>
                <span class="nominal ${t.jenis}" style="font-size:1.1rem">${masuk ? "+" : "−"} ${Keuangan.rp(t.nominal)}</span>
            </div>
            <div class="detail-info">
                ${info("Tanggal", Keuangan.fmtTanggal(t.tanggal))}
                ${info("Kategori", escapeHtml(t.kategori))}
                ${info("Divisi", escapeHtml(t.divisi))}
                ${info("PIC", escapeHtml(t.pic))}
                ${info("Program Kerja", escapeHtml(t.proker_id ? Keuangan.prokerName(t.proker_id) : ""))}
                ${info("Agenda", escapeHtml(t.agenda_id ? Keuangan.agendaName(t.agenda_id) : ""))}
                ${info("Dibuat", Keuangan.fmtTanggalWaktu(t.created_at))}
                ${info("Diubah", Keuangan.fmtTanggalWaktu(t.updated_at))}
            </div>
            ${t.catatan ? `<div class="detail-text">${escapeHtml(t.catatan)}</div>` : ""}
            ${t.bukti_path ? `<div class="detail-sec" style="margin-top:10px"><h5 style="font-size:.72rem; font-weight:900; letter-spacing:.06em; text-transform:uppercase; color:var(--red)">Bukti Transaksi</h5><div class="bukti-box"><img src="${getFoto(t.bukti_path)}" alt="Bukti" onclick="Home && Home.bukaFotoPopup && Home.bukaFotoPopup(this, 'Bukti transaksi', '')"></div></div>` : ""}`;
        document.getElementById("kasDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("kasDetail")?.classList.remove("open");
        if (!document.getElementById("kasForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Keuangan.detailId = null;
    },

    downloadBukti() {
        const t = Keuangan.cache.find(x => String(x.id) === String(Keuangan.detailId));
        if (!t || !t.bukti_path) { showToast("Tidak ada bukti", "info"); return; }
        const a = document.createElement("a");
        a.href = getFoto(t.bukti_path);
        a.download = "bukti-" + (t.keterangan || "transaksi").slice(0, 40);
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    },

    // ============ EXPORT / CETAK ============
    isiLaporan() {
        const data = Keuangan.dataTampil();
        const f = Keuangan.filter;
        const masuk = data.filter(t => t.jenis === "masuk").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
        const keluar = data.filter(t => t.jenis === "keluar").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
        const awal = Keuangan.saldoAwalUntuk(f.periode);
        const judul = f.periode ? `Periode ${f.periode}` : "Semua Periode";
        const esc = (s) => escapeHtml(s || "-");
        return `
            <div style="font-family:Arial,Helvetica,sans-serif; color:#111; max-width:700px; margin:0 auto">
                <div style="text-align:center; border-bottom:3px solid #111; padding-bottom:10px; margin-bottom:14px">
                    <div style="font-size:18px; font-weight:900">LAPORAN KEUANGAN OSIS</div>
                    <div style="font-size:12px">SMK Taruna Harapan 1 Cipatat — ${judul}</div>
                </div>
                <table style="font-size:13px; margin-bottom:12px">
                    <tr><td>Saldo Awal</td><td style="text-align:right"><b>${Keuangan.rp(awal)}</b></td></tr>
                    <tr><td>Total Pemasukan (${data.filter(t => t.jenis === "masuk").length})</td><td style="text-align:right"><b>${Keuangan.rp(masuk)}</b></td></tr>
                    <tr><td>Total Pengeluaran (${data.filter(t => t.jenis === "keluar").length})</td><td style="text-align:right"><b>${Keuangan.rp(keluar)}</b></td></tr>
                    <tr><td><b>Saldo Akhir</b></td><td style="text-align:right"><b>${Keuangan.rp(awal + masuk - keluar)}</b></td></tr>
                </table>
                <table border="1" cellspacing="0" cellpadding="6" style="width:100%; font-size:12px; border-collapse:collapse">
                    <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Jenis</th><th>Kategori</th><th>Nominal</th></tr></thead>
                    <tbody>${data.map(t => `<tr><td>${Keuangan.fmtTanggal(t.tanggal)}</td><td>${esc(t.keterangan)}</td><td>${t.jenis === "masuk" ? "Masuk" : "Keluar"}</td><td>${esc(t.kategori)}</td><td style="text-align:right">${t.jenis === "masuk" ? "+" : "-"}${Keuangan.rp(t.nominal)}</td></tr>`).join("") || `<tr><td colspan="5">Tidak ada transaksi.</td></tr>`}</tbody>
                </table>
                <p style="font-size:11px; color:#666; margin-top:12px">Dicetak ${new Date().toLocaleString("id-ID")} dari website OSIS Tarpan One.</p>
            </div>`;
    },

    cetak() {
        document.getElementById("printArea").innerHTML = Keuangan.isiLaporan();
        window.print();
    },

    exportPdf() {
        document.getElementById("printArea").innerHTML = Keuangan.isiLaporan();
        const oldTitle = document.title;
        const f = Keuangan.filter;
        document.title = `Laporan-Keuangan-${f.periode || "semua"}`;
        showToast("Pilih 'Save as PDF' di dialog print", "info");
        window.print();
        setTimeout(() => { document.title = oldTitle; }, 500);
    }
};

document.addEventListener("DOMContentLoaded", () => Keuangan.init());
