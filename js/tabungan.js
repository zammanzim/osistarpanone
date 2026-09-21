// =========================================================================
// TABUNGAN PENGURUS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/tabungan.html — catat setoran per orang, tampil satu
// tabel per orang: No | Tanggal | Nominal | Total Semua (running total
// per orang, dihitung di client) | Ceklis (toggle verifikasi per baris).
// Tulis via RPC buat_tabungan/update_tabungan/toggle_tabungan_cek/
// hapus_tabungan (cek osis_users).
// =========================================================================

const Tabungan = {
    cache: [],
    filter: { q: "" },
    editingId: null,
    detailId: null,
    jenisForm: "masuk",

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        // Segarkan hak kendali (biar perubahan akses langsung berlaku)
        try { await OsisAuth.refreshAkses(); } catch {}
        Tabungan.terapkanAkses();

        document.getElementById("btnTambahTabungan")?.addEventListener("click", () => Tabungan.bukaForm());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Tabungan.resetFilter());
        document.getElementById("filterQ")?.addEventListener("input", () => Tabungan.bacaFilter());
        document.getElementById("btnBatalTabungan")?.addEventListener("click", () => Tabungan.tutupForm());
        document.getElementById("btnSimpanTabungan")?.addEventListener("click", () => Tabungan.simpan());
        document.getElementById("btnEditDariDetail")?.addEventListener("click", () => {
            const id = Tabungan.detailId;
            Tabungan.tutupDetail();
            if (id) Tabungan.editRow(id);
        });
        document.getElementById("btnHapusDariDetail")?.addEventListener("click", () => {
            const id = Tabungan.detailId;
            if (id) Tabungan.hapusRow(id, true);
        });
        document.getElementById("tabunganWrap")?.addEventListener("click", (e) => {
            const tg = e.target.closest("[data-tab-toggle]");
            if (tg) { Tabungan.toggleCek(tg.dataset.tabToggle); return; }
            const ed = e.target.closest("[data-tab-edit]");
            if (ed) { Tabungan.editRow(ed.dataset.tabEdit); return; }
            const hb = e.target.closest("[data-tab-del]");
            if (hb) { Tabungan.hapusRow(hb.dataset.tabDel); return; }
            const tb = e.target.closest("[data-tab-tambah]");
            if (tb) { Tabungan.bukaForm(decodeURIComponent(tb.dataset.tabTambah || "")); return; }
            const row = e.target.closest("[data-tab-row]");
            if (row) { Tabungan.detail(row.dataset.tabRow); return; }
        });
        ["tabForm", "tabDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "tabForm") Tabungan.tutupForm();
                    else Tabungan.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("tabForm")?.classList.contains("open")) Tabungan.tutupForm();
            if (document.getElementById("tabDetail")?.classList.contains("open")) Tabungan.tutupDetail();
        });
        // Draft otomatis: ketikan belum disubmit tetap ada walau popup ditutup / refresh
        if (typeof FormPersist !== "undefined") {
            FormPersist.watch("tabForm", {
                fields: ["tabNama", "tabTanggal", "tabNominal"],
                isEditing: () => !!Tabungan.editingId,
                collect: () => ({ jenis: Tabungan.jenisForm })
            });
        }
        Tabungan.muat();
    },

    setJenis(j) {
        Tabungan.jenisForm = (j === "keluar") ? "keluar" : "masuk";
        const m = document.getElementById("jenisMasuk");
        const k = document.getElementById("jenisKeluar");
        if (m) m.className = Tabungan.jenisForm === "masuk" ? "on-masuk" : "";
        if (k) k.className = Tabungan.jenisForm === "keluar" ? "on-keluar" : "";
        if (typeof FormPersist !== "undefined") FormPersist.touch("tabForm");
    },

    // Nilai bertanda: setoran +, penarikan -.
    nilai(r) {
        const n = parseInt(r.nominal, 10) || 0;
        return (r.jenis === "keluar") ? -n : n;
    },

    isKeluar(r) {
        return r.jenis === "keluar";
    },

    rp(n) {
        return "Rp" + (parseInt(n, 10) || 0).toLocaleString("id-ID");
    },

    fmtTanggalPendek(t) {
        if (!t) return "-";
        const d = new Date(t + "T00:00:00");
        if (isNaN(d)) return t;
        const p = (x) => String(x).padStart(2, "0");
        return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
    },

    fmtTanggalWaktu(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch { return "-"; }
    },

    hariIni() {
        return new Date().toISOString().slice(0, 10);
    },

    // ============ DATA ============
    async muat() {
        try {
            const cached = Cache.get("tabungan");
            if (cached) {
                Tabungan.cache = cached;
                Tabungan.render();
                getTabungan().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("tabungan", fresh);
                        Tabungan.cache = fresh || [];
                        Tabungan.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getTabungan();
            Cache.set("tabungan", data);
            Tabungan.cache = data || [];
            Tabungan.render();
        } catch (err) {
            console.error(err);
            document.getElementById("tabunganWrap").innerHTML = `<div class="pesan-empty">Gagal memuat tabungan.</div>`;
        }
    },

    async segarkan() {
        // Render cache dulu biar offline langsung tampil.
        const cached = Cache.get("tabungan");
        if (cached) {
            Tabungan.cache = cached || [];
            try { Tabungan.render(); } catch {}
        }
        try {
            const data = await getTabungan();
            if (JSON.stringify(data) !== JSON.stringify(cached)) {
                Cache.set("tabungan", data);
                Tabungan.cache = data || [];
                Tabungan.render();
            }
        } catch (err) {
            console.error(err);
            if (!cached) showToast("Gagal memuat ulang: " + err.message, "error");
            try { Tabungan.render(); } catch {}
        }
    },

    dataTampil() {
        const q = Tabungan.filter.q.trim().toLowerCase();
        return (Tabungan.cache || []).filter(r => {
            if (q && !String(r.nama || "").toLowerCase().includes(q)) return false;
            return true;
        });
    },

    // Kelompokkan per orang (key = lower(nama)), urut nama A-Z.
    // Baris per orang urut tanggal naik lalu id naik (buat running total).
    grupPerOrang(data) {
        const grup = {};
        (data || []).forEach(r => {
            const kunci = String(r.nama || "").trim().toLowerCase();
            if (!kunci) return;
            if (!grup[kunci]) grup[kunci] = { nama: String(r.nama).trim(), rows: [] };
            grup[kunci].rows.push(r);
        });
        return Object.values(grup)
            .map(g => {
                g.rows.sort((a, b) =>
                    String(a.tanggal || "").localeCompare(String(b.tanggal || "")) ||
                    (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
                let jalan = 0;
                g.rows = g.rows.map(r => {
                    jalan += Tabungan.nilai(r);
                    return { ...r, _total: jalan };
                });
                g.total = jalan;
                return g;
            })
            .sort((a, b) => a.nama.localeCompare(b.nama));
    },

    // ============ RENDER ============
    render() {
        const data = Tabungan.dataTampil();
        const setStat = (id, count, suffix) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = String(count) + `<span class="stat-suffix"> ${suffix}</span>`;
        };
        const orang = new Set((Tabungan.cache || []).map(r => String(r.nama || "").trim().toLowerCase()).filter(Boolean)).size;
        const totalSemua = (Tabungan.cache || []).reduce((a, r) => a + Tabungan.nilai(r), 0);
        const sudah = (Tabungan.cache || []).filter(r => !!r.cek).length;
        const belum = (Tabungan.cache || []).length - sudah;
        // Total minggu berjalan (Senin-Minggu) + bulan berjalan dari tanggal setoran.
        const now = new Date();
        const mundur = (now.getDay() + 6) % 7; // Senin=0 ... Minggu=6
        const senin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mundur);
        const minggu = new Date(senin.getFullYear(), senin.getMonth(), senin.getDate() + 6);
        const p2 = (x) => String(x).padStart(2, "0");
        const keStr = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
        const strSenin = keStr(senin);
        const strMinggu = keStr(minggu);
        const blnIni = keStr(now).slice(0, 7);
        const rows = Tabungan.cache || [];
        const totalMinggu = rows.reduce((a, r) => {
            const t = String(r.tanggal || "");
            return a + ((t >= strSenin && t <= strMinggu) ? Tabungan.nilai(r) : 0);
        }, 0);
        const totalBulan = rows.reduce((a, r) => {
            return a + (String(r.tanggal || "").slice(0, 7) === blnIni ? Tabungan.nilai(r) : 0);
        }, 0);
        setStat("statOrang", orang, "orang");
        const elTotal = document.getElementById("statTotal");
        if (elTotal) elTotal.textContent = Tabungan.rp(totalSemua);
        const elMinggu = document.getElementById("statMinggu");
        if (elMinggu) elMinggu.textContent = Tabungan.rp(totalMinggu);
        const elBulan = document.getElementById("statBulan");
        if (elBulan) elBulan.textContent = Tabungan.rp(totalBulan);
        setStat("statSudah", sudah, "setoran");
        setStat("statBelum", belum, "setoran");

        const wrap = document.getElementById("tabunganWrap");
        if (!wrap) return;
        const boleh = OsisAuth.bisa("tabungan");
        if (!(Tabungan.cache || []).length) {
            wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-piggy-bank" style="color:var(--red)"></i></div><b>Belum ada data tabungan</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Catat setoran tabungan per pengurus.</p>${boleh ? `<button class="btn btn-red btn-sm" onclick="Tabungan.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Data</button>` : ""}</div>`;
            return;
        }
        const grups = Tabungan.grupPerOrang(data);
        if (!grups.length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Tabungan.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            return;
        }
        wrap.innerHTML = grups.map(g => {
            const sudahSemua = g.rows.length > 0 && g.rows.every(r => !!r.cek);
            return `<div class="rekap-card" style="margin-bottom:12px">
                <h3><i class="fa-solid fa-piggy-bank"></i> Tabungan — ${escapeHtml(g.nama)} <span class="jenis total" style="margin-left:auto">${Tabungan.rp(g.total)}${sudahSemua ? " ✓" : ""}</span></h3>
                <div class="kas-scroll"><table class="kas-tabel"><thead><tr><th>No</th><th>Tanggal</th><th>Nominal</th><th>Total Semua</th><th>Ceklis</th>${boleh ? `<th style="text-align:right">Aksi</th>` : ""}</tr></thead><tbody>
                ${g.rows.map((r, i) => `<tr data-tab-row="${r.id}">
                    <td>${i + 1}</td>
                    <td>${escapeHtml(Tabungan.fmtTanggalPendek(r.tanggal))}</td>
                    <td><span class="jenis ${Tabungan.isKeluar(r) ? "keluar" : "masuk"}">${Tabungan.isKeluar(r) ? "−" : "+"} ${Tabungan.rp(r.nominal)}</span></td>
                    <td class="num">${Tabungan.rp(r._total)}</td>
                    <td>${boleh
                        ? `<button type="button" class="cek-btn ${r.cek ? "on" : ""}" data-tab-toggle="${r.id}" title="${r.cek ? "Sudah diceklis — klik untuk batalkan" : "Belum diceklis — klik untuk tandai"}"><i class="fa-solid ${r.cek ? "fa-check" : "fa-minus"}"></i></button>`
                        : `<span class="cek-btn ${r.cek ? "on" : ""}" style="cursor:default"><i class="fa-solid ${r.cek ? "fa-check" : "fa-minus"}"></i></span>`}</td>
                    ${boleh ? `<td><div class="row-act">
                        <button type="button" class="icon-btn" data-tab-edit="${r.id}" title="Edit" style="width:30px; height:30px; font-size:0.75rem; border-width:2px"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="icon-btn" data-tab-del="${r.id}" title="Hapus" style="width:30px; height:30px; font-size:0.75rem; background:var(--red); color:#fff; border-width:2px"><i class="fa-solid fa-trash-can"></i></button>
                    </div></td>` : ""}
                </tr>`).join("")}
                </tbody></table></div>
                ${boleh ? `<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px">
                    <button class="btn btn-white btn-sm" data-tab-tambah="${encodeURIComponent(g.nama)}"><i class="fa-solid fa-plus"></i> Tambah Setoran</button>
                </div>` : ""}
            </div>`;
        }).join("");
    },

    bacaFilter() {
        Tabungan.filter = { q: document.getElementById("filterQ").value || "" };
        Tabungan.render();
    },

    resetFilter() {
        const el = document.getElementById("filterQ");
        if (el) el.value = "";
        Tabungan.bacaFilter();
    },

    isiDatalist() {
        const dl = document.getElementById("tabNamaList");
        if (!dl) return;
        const namaSet = [...new Set((Tabungan.cache || []).map(r => String(r.nama || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        dl.innerHTML = namaSet.map(n => `<option value="${escapeHtml(n)}">`).join("");
    },

    // Sembunyikan tombol aksi kalau tidak punya kendali atas halaman ini
    terapkanAkses() {
        const boleh = OsisAuth.bisa("tabungan");
        ["btnTambahTabungan", "btnEditDariDetail", "btnHapusDariDetail"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = boleh ? "" : "none";
        });
    },

    // ============ FORM ============
    bukaForm(prefillNama) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        Tabungan.editingId = null;
        document.getElementById("tabId").value = "";
        document.getElementById("tabFormTitle").textContent = "Tambah Setoran";
        Tabungan.setJenis("masuk");
        document.getElementById("tabNama").value = prefillNama || "";
        document.getElementById("tabTanggal").value = Tabungan.hariIni();
        document.getElementById("tabNominal").value = "";
        Tabungan.isiDatalist();
        // Pulihkan draft kalau ada (tutup form / refresh tidak sengaja).
        // Di-skip kalau dibuka via "Tambah Setoran" per orang (nama eksplisit).
        if (!prefillNama) {
            try {
                const d = (typeof FormPersist !== "undefined") ? FormPersist.load("tabForm") : null;
                const adaIsi = d && (String(d.tabNama || "").trim() || String(d.tabNominal || "").trim());
                if (adaIsi) {
                    if (d.jenis) Tabungan.setJenis(d.jenis);
                    if (typeof d.tabNama === "string") document.getElementById("tabNama").value = d.tabNama;
                    if (typeof d.tabTanggal === "string" && d.tabTanggal) document.getElementById("tabTanggal").value = d.tabTanggal;
                    if (d.tabNominal !== undefined && d.tabNominal !== null) document.getElementById("tabNominal").value = d.tabNominal;
                    showToast("Draft dipulihkan.", "info");
                }
            } catch {}
        }
        document.getElementById("tabForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById(prefillNama ? "tabNominal" : "tabNama")?.focus(), 80);
    },

    editRow(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        const item = (Tabungan.cache || []).find(r => String(r.id) === String(id));
        if (!item) return;
        Tabungan.editingId = id;
        document.getElementById("tabId").value = id;
        document.getElementById("tabFormTitle").textContent = "Edit Setoran";
        Tabungan.setJenis(item.jenis);
        document.getElementById("tabNama").value = item.nama || "";
        document.getElementById("tabTanggal").value = item.tanggal || "";
        document.getElementById("tabNominal").value = item.nominal ?? "";
        Tabungan.isiDatalist();
        document.getElementById("tabForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupForm() {
        document.getElementById("tabForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Tabungan.editingId = null;
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        const nama = (document.getElementById("tabNama").value || "").trim();
        const tanggal = document.getElementById("tabTanggal").value || "";
        const nominal = parseInt(document.getElementById("tabNominal").value, 10);
        const jenis = Tabungan.jenisForm;
        if (!nama) { showToast("Nama wajib diisi.", "error"); return; }
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        if (!nominal || nominal <= 0) { showToast("Nominal harus lebih dari 0.", "error"); return; }
        const id = Tabungan.editingId || (document.getElementById("tabId").value ? parseInt(document.getElementById("tabId").value, 10) : null);
        const __spec = () => ({ modul: "tabungan", op: id ? "update" : "create",
            label: (jenis === "keluar" ? "Penarikan " : "Setoran ") + nama,
            payload: { id: id || null, nama, tanggal, nominal, jenis },
            files: [], cacheKeys: ["tabungan"] });
        const __sesudahAntre = () => {
            if (typeof FormPersist !== "undefined") FormPersist.clear("tabForm");
            Tabungan.tutupForm();
        };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
            return;
        }
        const btn = document.getElementById("btnSimpanTabungan");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            if (id) {
                await updateTabungan(u.id, id, { nama, tanggal, nominal, jenis });
                showToast("Setoran diperbarui!", "success");
            } else {
                await buatTabungan(u.id, { nama, tanggal, nominal, jenis });
                showToast(jenis === "keluar" ? "Penarikan tersimpan!" : "Setoran tersimpan!", "success");
            }
            if (typeof FormPersist !== "undefined") FormPersist.clear("tabForm");
            Tabungan.tutupForm();
            Tabungan.segarkan();
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
                Outbox.sesudahAntre(__sesudahAntre);
                return;
            }
            showToast("Gagal simpan: " + Tabungan.pesanDb(err.message), "error");
            Tabungan.segarkan();
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async toggleCek(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        const item = (Tabungan.cache || []).find(r => String(r.id) === String(id));
        if (!item) return;
        try {
            await toggleTabunganCek(u.id, id, !item.cek);
            showToast(!item.cek ? "Ditandai sudah diceklis." : "Ceklis dibatalkan.", "success");
            Tabungan.segarkan();
        } catch (err) {
            console.error(err);
            showToast("Gagal update ceklis: " + err.message, "error");
            Tabungan.segarkan();
        }
    },

    async hapusRow(id, dariDetail) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        const item = (Tabungan.cache || []).find(r => String(r.id) === String(id));
        if (!item) return;
        const yakin = await showPopup(`Hapus ${Tabungan.isKeluar(item) ? "penarikan" : "setoran"} ${item.nama} (${Tabungan.fmtTanggalPendek(item.tanggal)}, ${Tabungan.rp(item.nominal)})?`, "confirm");
        if (!yakin) return;
        try {
            await hapusTabungan(u.id, id);
            if (dariDetail) Tabungan.tutupDetail();
            showToast("Setoran dihapus.", "success");
            Tabungan.segarkan();
        } catch (err) {
            console.error(err);
            showToast("Gagal hapus: " + err.message, "error");
            Tabungan.segarkan();
        }
    },

    // ============ DETAIL (klik baris) ============
    detail(id) {
        const r = (Tabungan.cache || []).find(x => String(x.id) === String(id));
        if (!r) return;
        Tabungan.detailId = id;
        const keluar = Tabungan.isKeluar(r);
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        document.getElementById("tabDetailBody").innerHTML = `
            <h4 style="font-size:1rem; font-weight:900; overflow-wrap:anywhere">${escapeHtml(r.nama || "Tanpa nama")}</h4>
            <div style="margin:6px 0 2px; display:flex; gap:6px; align-items:center; flex-wrap:wrap">
                <span class="jenis ${keluar ? "keluar" : "masuk"}">${keluar ? "Penarikan" : "Setoran"}</span>
                <span class="num" style="font-size:1.1rem; font-weight:900; color:${keluar ? "var(--red-dark)" : "#146314"}">${keluar ? "−" : "+"} ${Tabungan.rp(r.nominal)}</span>
            </div>
            <div class="detail-info">
                ${info("Tanggal", Tabungan.fmtTanggalPendek(r.tanggal))}
                ${info("Status", r.cek ? "Sudah diceklis ✓" : "Belum diceklis")}
                ${info("Dibuat", Tabungan.fmtTanggalWaktu(r.created_at))}
                ${info("Diubah", Tabungan.fmtTanggalWaktu(r.updated_at))}
            </div>`;
        document.getElementById("tabDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("tabDetail")?.classList.remove("open");
        if (!document.getElementById("tabForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Tabungan.detailId = null;
    },

    pesanDb(kode) {
        const m = {
            "-1": "tidak ada akses", "-3": "tanggal wajib diisi",
            "-4": "nama wajib diisi", "-6": "nominal harus lebih dari 0",
            ERR_DUPLIKAT: "data duplikat", ERR_NO_AUTH: "tidak ada akses",
            ERR_NO_TANGGAL: "tanggal wajib diisi", ERR_NO_NAMA: "nama wajib diisi",
            ERR_NOMINAL: "nominal harus lebih dari 0", ERR_NOT_FOUND: "data tidak ditemukan"
        };
        return m[String(kode)] || String(kode);
    }
};

document.addEventListener("DOMContentLoaded", () => Tabungan.init());
