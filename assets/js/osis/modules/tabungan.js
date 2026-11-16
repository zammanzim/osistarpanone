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
    filter: { q: "", status: "", sort: "nama", orang: "" },
    defaultGrupLimit: 12,
    grupLimit: 12,
    stepGrupLimit: 15,
    defaultHariLimit: 3,
    openGrups: new Set(),
    expandedGrups: new Set(),
    // Tanpa hak kelola: default cuma lihat milik sendiri, bisa intip semua
    // lewat tombol di atas/bawah. Pemegang hak langsung lihat semua.
    hanyaSaya: false,
    editingId: null,
    detailId: null,
    jenisForm: "masuk",
    // Roster nama dari data anggota (periode aktif), buat pilih penabung.
    anggota: [],
    periodeTahun: [],
    namaQ: "",
    // Nama-nama milik user login (akun + anggota + pengurus) — boleh ceklis sendiri.
    namaSaya: [],

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        // Segarkan hak kendali (biar perubahan akses langsung berlaku)
        try { await OsisAuth.refreshAkses(); } catch {}
        try { Tabungan.hanyaSaya = !OsisAuth.bisa("tabungan"); } catch {}
        Tabungan.terapkanAkses();

        document.getElementById("btnTambahTabungan")?.addEventListener("click", () => Tabungan.bukaForm());
        document.getElementById("btnToggleLingkupHero")?.addEventListener("click", () => Tabungan.toggleLingkup());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Tabungan.resetFilter());
        document.getElementById("filterQ")?.addEventListener("input", () => Tabungan.bacaFilter());
        document.getElementById("filterSort")?.addEventListener("input", () => Tabungan.bacaFilter());
        document.getElementById("btnClearQ")?.addEventListener("click", () => {
            const el = document.getElementById("filterQ");
            if (el) el.value = "";
            Tabungan.bacaFilter();
        });
        document.getElementById("statusFilterPills")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-status-pill]");
            if (!b) return;
            Tabungan.filter.status = b.dataset.statusPill || "";
            Tabungan.grupLimit = Tabungan.defaultGrupLimit;
            Tabungan.render();
        });
        document.getElementById("tbRosterList")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-pick-orang]");
            if (!b) return;
            const k = decodeURIComponent(b.dataset.pickOrang || "");
            Tabungan.filter.orang = Tabungan.filter.orang === k ? "" : k;
            if (Tabungan.filter.orang) Tabungan.openGrups.add(Tabungan.filter.orang);
            Tabungan.grupLimit = Tabungan.defaultGrupLimit;
            Tabungan.render();
        });
        document.getElementById("filterChips")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-clear-filter]");
            if (!b) return;
            const key = b.dataset.clearFilter;
            if (key === "q") {
                const el = document.getElementById("filterQ");
                if (el) el.value = "";
                Tabungan.filter.q = "";
            } else if (key === "status") {
                Tabungan.filter.status = "";
            } else if (key === "orang") {
                Tabungan.filter.orang = "";
            } else if (key === "sort") {
                const fs = document.getElementById("filterSort");
                if (fs) fs.value = "nama";
                Tabungan.filter.sort = "nama";
                Tabungan.segarkanDropdown();
            }
            Tabungan.grupLimit = Tabungan.defaultGrupLimit;
            Tabungan.render();
        });
        document.getElementById("btnBatalTabungan")?.addEventListener("click", () => Tabungan.tutupForm());
        document.getElementById("btnSimpanTabungan")?.addEventListener("click", () => Tabungan.simpan());
        // Pilih nama dari data anggota (ketuk, bukan ketik bebas)
        document.getElementById("tabNamaSearch")?.addEventListener("input", () => {
            Tabungan.namaQ = document.getElementById("tabNamaSearch").value || "";
            Tabungan.renderNamaList();
        });
        document.getElementById("tabNamaListBox")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-pilih-nama]");
            if (b) Tabungan.pilihNama(decodeURIComponent(b.dataset.pilihNama || ""));
        });
        // Nominal: ketik angka -> tampil titik ribuan otomatis
        if (typeof ikatRupiah === "function") ikatRupiah("tabNominal");
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
            const mr = e.target.closest("[data-tab-more]");
            if (mr) { e.stopPropagation(); Tabungan.toggleMenu(mr); return; }
            const tb = e.target.closest("[data-tab-tambah]");
            if (tb) { Tabungan.bukaForm(decodeURIComponent(tb.dataset.tabTambah || "")); return; }
            const ex = e.target.closest("[data-tab-expand-rows]");
            if (ex) {
                const k = decodeURIComponent(ex.dataset.tabExpandRows || "");
                if (Tabungan.expandedGrups.has(k)) Tabungan.expandedGrups.delete(k);
                else Tabungan.expandedGrups.add(k);
                Tabungan.render();
                return;
            }
            const pf = e.target.closest("[data-tab-pdf]");
            if (pf) { e.stopPropagation(); Tabungan.tutupSemuaMenu(); Tabungan.exportSatu(decodeURIComponent(pf.dataset.tabPdf || "")); return; }
            // Klik di dalam menu tapi bukan tombol: jangan tembus ke detail baris atau toggle kartu
            if (e.target.closest(".tb-menu-wrap")) { e.stopPropagation(); return; }
            const tgCard = e.target.closest("[data-tab-toggle-card]");
            if (tgCard) {
                const k = decodeURIComponent(tgCard.dataset.tabToggleCard || "");
                if (Tabungan.openGrups.has(k)) Tabungan.openGrups.delete(k);
                else Tabungan.openGrups.add(k);
                Tabungan.render();
                return;
            }
            const row = e.target.closest("[data-tab-row]");
            if (row) { Tabungan.detail(row.dataset.tabRow); return; }
        });
        document.getElementById("tabunganWrap")?.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            if (e.target.closest(".tb-menu-wrap, button, a, input")) return;
            const tgCard = e.target.closest("[data-tab-toggle-card]");
            if (!tgCard) return;
            e.preventDefault();
            const k = decodeURIComponent(tgCard.dataset.tabToggleCard || "");
            if (Tabungan.openGrups.has(k)) Tabungan.openGrups.delete(k);
            else Tabungan.openGrups.add(k);
            Tabungan.render();
        });
        // Klik di luar menu: tutup semua menu titik-tiga yang terbuka
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".tb-menu-wrap")) Tabungan.tutupSemuaMenu();
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
            Tabungan.tutupSemuaMenu();
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
        // Nama milik sendiri (buat ceklis tanpa akses kelola) — fail silent
        Tabungan.muatNamaSaya();
        Tabungan.muat();
    },

    // Nama-nama milik user login: nama akun + nama anggota/pengurus yang
    // tertaut username-nya. Cocok salah satu = baris milik sendiri.
    async muatNamaSaya() {
        const set = new Set();
        const tambah = (n) => { n = String(n || "").trim().toLowerCase(); if (n) set.add(n); };
        try {
            const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
            if (u) tambah(u.nama);
        } catch {}
        try {
            const [a, p] = await Promise.all([
                (typeof getAnggotaSaya === "function" ? getAnggotaSaya() : Promise.resolve(null)).catch(() => null),
                (typeof getPengurusSaya === "function" ? getPengurusSaya() : Promise.resolve(null)).catch(() => null)
            ]);
            if (a) tambah(a.nama);
            if (p) tambah(p.nama);
        } catch {}
        Tabungan.namaSaya = [...set];
        try { Tabungan.render(); } catch {}
    },

    // Baris ini milik user login?
    milikSaya(r) {
        if (!r) return false;
        const k = String(r.nama || "").trim().toLowerCase();
        return !!k && (Tabungan.namaSaya || []).includes(k);
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

    fmtTanggalHari(t) {
        if (!t) return "-";
        const d = new Date(t + "T00:00:00");
        if (isNaN(d)) return t;
        try {
            return d.toLocaleDateString("id-ID", {
                weekday: "long",
                day: "numeric",
                month: "short",
                year: "numeric",
            });
        } catch {
            return Tabungan.fmtTanggalPendek(t);
        }
    },

    fmtTanggalWaktu(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch { return "-"; }
    },

    hariIni() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },

    // Kelompokkan transaksi milik satu orang per hari (tanggal YYYY-MM-DD),
    // urutkan hari terbaru paling atas & transaksi terbaru dalam hari di atas.
    grupPerHari(rows) {
        const map = new Map();
        (rows || []).forEach(r => {
            const tgl = String(r.tanggal || "").slice(0, 10) || "tanpa-tanggal";
            if (!map.has(tgl)) map.set(tgl, { tanggal: tgl, items: [], net: 0, belum: 0 });
            const h = map.get(tgl);
            h.items.push(r);
            h.net += Tabungan.nilai(r);
            if (!r.cek) h.belum++;
        });
        const list = [...map.values()].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
        list.forEach(h => {
            h.items.sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0));
        });
        return list;
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

    // Lingkup tampil: milik sendiri saja atau semua (tombol intip).
    // Statistik ikut lingkup ini (bukan filter cari) biar total orang lain
    // tidak bocor ke yang tidak punya hak.
    dataLingkup() {
        const all = Tabungan.cache || [];
        if (!Tabungan.hanyaSaya) return all;
        return all.filter(r => Tabungan.milikSaya(r));
    },

    segarkanDropdown() {
        try {
            if (window.Dropdown && Dropdown.segarkanSemua) Dropdown.segarkanSemua();
        } catch {}
    },

    dataTampil() {
        const f = Tabungan.filter;
        const q = String(f.q || "").trim().toLowerCase();
        const orang = String(f.orang || "").trim().toLowerCase();
        return Tabungan.dataLingkup().filter(r => {
            const nm = String(r.nama || "").trim().toLowerCase();
            if (q && !nm.includes(q)) return false;
            if (orang && nm !== orang) return false;
            return true;
        });
    },

    toggleLingkup() {
        Tabungan.hanyaSaya = !Tabungan.hanyaSaya;
        Tabungan.filter.orang = "";
        Tabungan.grupLimit = Tabungan.defaultGrupLimit;
        Tabungan.render();
    },

    tampilGrupLebihBanyak() {
        Tabungan.grupLimit += Tabungan.stepGrupLimit;
        Tabungan.render();
    },

    tampilSemuaGrup() {
        Tabungan.grupLimit = Infinity;
        Tabungan.render();
    },

    ringkasGrup() {
        Tabungan.grupLimit = Tabungan.defaultGrupLimit;
        Tabungan.render();
    },

    // Kelompokkan per orang (key = lower(nama)), urut nama A-Z.
    // Baris per orang urut tanggal naik lalu id naik (buat running total).
    grupPerOrang(data) {
        const grup = {};
        (data || []).forEach(r => {
            const kunci = String(r.nama || "").trim().toLowerCase();
            if (!kunci) return;
            if (!grup[kunci]) grup[kunci] = { kunci, nama: String(r.nama).trim(), rows: [] };
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
                g.sudah = g.rows.filter(r => !!r.cek).length;
                g.belum = g.rows.length - g.sudah;
                return g;
            })
            .sort((a, b) => a.nama.localeCompare(b.nama));
    },

    urutDanSaringGrup(grups) {
        const f = Tabungan.filter;
        let list = (grups || []).slice();
        if (f.status === "belum") list = list.filter(g => g.belum > 0);
        else if (f.status === "lunas") list = list.filter(g => g.rows.length > 0 && g.belum === 0);

        if (f.sort === "saldo") {
            list.sort((a, b) => (b.total - a.total) || a.nama.localeCompare(b.nama));
        } else if (f.sort === "belum") {
            list.sort((a, b) => (b.belum - a.belum) || a.nama.localeCompare(b.nama));
        } else {
            // Milik sendiri selalu paling atas pada urutan default, sisanya A-Z
            list.sort((a, b) =>
                ((Tabungan.milikSaya({ nama: b.nama }) ? 1 : 0) - (Tabungan.milikSaya({ nama: a.nama }) ? 1 : 0)) ||
                a.nama.localeCompare(b.nama));
        }
        return list;
    },

    sinkronKontrolFilter(shownCards, totalCards, shownRows, totalRows) {
        const f = Tabungan.filter;
        const clearBtn = document.getElementById("btnClearQ");
        if (clearBtn) clearBtn.style.display = String(f.q || "").trim() ? "" : "none";

        document.querySelectorAll("#statusFilterPills [data-status-pill]").forEach(btn => {
            btn.classList.toggle("on", (btn.dataset.statusPill || "") === (f.status || ""));
        });

        const chipsEl = document.getElementById("filterChips");
        if (chipsEl) {
            const chips = [];
            if (String(f.q || "").trim()) chips.push({ k: "q", l: `Cari: "${String(f.q).trim()}"` });
            if (f.orang) chips.push({ k: "orang", l: `Penabung: ${f.orang}` });
            if (f.status === "belum") chips.push({ k: "status", l: "Status: Belum Ceklis" });
            else if (f.status === "lunas") chips.push({ k: "status", l: "Status: Lunas ✓" });
            if (f.sort && f.sort !== "nama") {
                const sLbl = f.sort === "saldo" ? "Saldo tertinggi" : "Belum ceklis terbanyak";
                chips.push({ k: "sort", l: `Urutan: ${sLbl}` });
            }
            chipsEl.innerHTML = chips.map(c =>
                `<button type="button" class="filter-chip" data-clear-filter="${c.k}" title="Hapus filter ini">${escapeHtml(c.l)} <i class="fa-solid fa-xmark"></i></button>`
            ).join("");
        }

        const cntEl = document.getElementById("filterCountInfo");
        if (cntEl && typeof shownCards === "number") {
            cntEl.textContent = totalCards > shownCards
                ? `${shownCards}/${totalCards} penabung · ${shownRows} baris`
                : `${shownCards} penabung · ${totalRows} setoran`;
        }

        if (window.OsisSearch && OsisSearch.setCount) {
            const activeDrawer =
                (f.status ? 1 : 0) +
                (f.orang ? 1 : 0) +
                (f.sort && f.sort !== "nama" ? 1 : 0);
            OsisSearch.setCount("#tbTopSearch", activeDrawer);
        }
    },

    // ============ RENDER ============
    render() {
        const data = Tabungan.dataTampil();
        const lingkup = Tabungan.dataLingkup();
        const boleh = OsisAuth.bisa("tabungan");
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const setStat = (id, count, suffix) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = String(count) + `<span class="stat-suffix"> ${suffix}</span>`;
        };
        const orang = new Set(lingkup.map(r => String(r.nama || "").trim().toLowerCase()).filter(Boolean)).size;
        const totalSemua = lingkup.reduce((a, r) => a + Tabungan.nilai(r), 0);
        const totalMasuk = lingkup.reduce((a, r) => a + (!Tabungan.isKeluar(r) ? (parseInt(r.nominal, 10) || 0) : 0), 0);
        const totalKeluar = lingkup.reduce((a, r) => a + (Tabungan.isKeluar(r) ? (parseInt(r.nominal, 10) || 0) : 0), 0);
        const sudah = lingkup.filter(r => !!r.cek).length;
        const belum = lingkup.length - sudah;
        const pctCek = lingkup.length ? Math.round((sudah / lingkup.length) * 100) : 0;

        // Hero badges & toggle lingkup
        const hbOrg = document.getElementById("heroPenabungBadge");
        if (hbOrg) hbOrg.innerHTML = `<i class="fa-solid fa-users"></i> ${orang} penabung`;
        const hbSet = document.getElementById("heroSetoranBadge");
        if (hbSet) hbSet.innerHTML = `<i class="fa-solid fa-list-check"></i> ${lingkup.length} setoran`;
        const hbLing = document.getElementById("heroLingkupBadge");
        const btnHeroLing = document.getElementById("btnToggleLingkupHero");
        const showLing = !boleh && (Tabungan.cache || []).length > 0;
        if (hbLing) {
            hbLing.style.display = showLing ? "" : "none";
            if (showLing) {
                hbLing.innerHTML = `<i class="fa-solid ${Tabungan.hanyaSaya ? "fa-user-check" : "fa-users"}"></i> ${Tabungan.hanyaSaya ? "Tabunganku" : "Semua Penabung"}`;
            }
        }
        if (btnHeroLing) {
            btnHeroLing.style.display = showLing ? "" : "none";
            if (showLing) {
                btnHeroLing.innerHTML = `<i class="fa-solid ${Tabungan.hanyaSaya ? "fa-users" : "fa-user-check"}"></i> ${Tabungan.hanyaSaya ? "Lihat Semua Penabung" : "Kembali ke Tabunganku"}`;
            }
        }

        // Dark Total Hero card
        set("statTotal", Tabungan.rp(totalSemua));
        set("tbCekPill", `${pctCek}% ceklis`);
        const vb = document.getElementById("tbVerifBar");
        if (vb) vb.style.width = pctCek + "%";
        set("tbVerifLbl", `${sudah} / ${lingkup.length} terverifikasi`);
        set("tbBelumPct", `${belum} belum`);
        set("tbRumusMasuk", "+ " + Tabungan.rp(totalMasuk));
        set("tbRumusKeluar", "− " + Tabungan.rp(totalKeluar));

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
        const rows = lingkup;
        const strHariIni = keStr(now);
        const totalHarian = rows.reduce((a, r) => a + (String(r.tanggal || "") === strHariIni ? Tabungan.nilai(r) : 0), 0);
        const nHarian = rows.filter(r => String(r.tanggal || "") === strHariIni).length;
        const totalMinggu = rows.reduce((a, r) => {
            const t = String(r.tanggal || "");
            return a + ((t >= strSenin && t <= strMinggu) ? Tabungan.nilai(r) : 0);
        }, 0);
        const nMinggu = rows.filter(r => {
            const t = String(r.tanggal || "");
            return t >= strSenin && t <= strMinggu;
        }).length;
        const totalBulan = rows.reduce((a, r) => a + (String(r.tanggal || "").slice(0, 7) === blnIni ? Tabungan.nilai(r) : 0), 0);
        const nBulan = rows.filter(r => String(r.tanggal || "").slice(0, 7) === blnIni).length;

        set("statBulan", Tabungan.rp(totalBulan));
        set("statBulanSub", nBulan ? `${nBulan} setoran bulan ini` : "bulan berjalan");
        set("statMinggu", Tabungan.rp(totalMinggu));
        set("statMingguSub", nMinggu ? `${nMinggu} setoran minggu ini` : "Senin - Minggu");
        set("statHarian", Tabungan.rp(totalHarian));
        set("statHarianSub", nHarian ? `${nHarian} setoran hari ini` : "hari ini");
        setStat("statOrang", orang, "orang");
        set("statOrangSub", orang ? `rata-rata ${Tabungan.rp(Math.round(totalSemua / orang))}` : "pengurus aktif");
        setStat("statSudah", sudah, "setoran");
        set("statSudahSub", `${pctCek}% dari total setoran`);
        setStat("statBelum", belum, "setoran");
        set("statBelumSub", belum ? `${100 - pctCek}% menunggu ceklis` : "semua sudah terverifikasi");

        // Rail Kiri: Daftar Penabung interaktif (dari lingkup aktif)
        const rosterGrups = Tabungan.urutDanSaringGrup(Tabungan.grupPerOrang(lingkup));
        set("tbRosterCount", rosterGrups.length);
        const rl = document.getElementById("tbRosterList");
        if (rl) {
            if (!rosterGrups.length) {
                rl.innerHTML = `<div class="pesan-empty">Belum ada penabung.</div>`;
            } else {
                rl.innerHTML = rosterGrups.map(g => {
                    const on = Tabungan.filter.orang === g.kunci ? " on" : "";
                    const badgeCls = g.belum === 0 ? "lunas" : "belum";
                    const badgeTxt = g.belum === 0 ? "Lunas ✓" : `${g.belum} blm`;
                    return `<button type="button" class="tb-roster-item${on}" data-pick-orang="${encodeURIComponent(g.kunci)}" title="${on ? "Klik untuk tampilkan semua" : "Klik untuk fokus penabung ini"}">
                        <div style="min-width:0; flex:1">
                            <div class="tb-roster-name">${escapeHtml(g.nama)}</div>
                            <div class="tb-roster-sub">${g.rows.length} transaksi</div>
                        </div>
                        <div class="tb-roster-right">
                            <span class="tb-roster-amt">${Tabungan.rp(g.total)}</span>
                            <span class="tb-roster-badge ${badgeCls}">${badgeTxt}</span>
                        </div>
                    </button>`;
                }).join("");
            }
        }

        const wrap = document.getElementById("tabunganWrap");
        if (!wrap) return;
        if (!(Tabungan.cache || []).length) {
            Tabungan.sinkronKontrolFilter(0, 0, 0, 0);
            wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-piggy-bank" style="color:var(--red)"></i></div><b>Belum ada data tabungan</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Catat setoran tabungan per pengurus.</p>${boleh ? `<button class="btn btn-red btn-sm" onclick="Tabungan.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Data</button>` : ""}</div>`;
            return;
        }
        const grups = Tabungan.urutDanSaringGrup(Tabungan.grupPerOrang(data));
        // Tombol intip di bawah: khusus yang tanpa hak kelola.
        const tombolLingkup = (!boleh && (Tabungan.cache || []).length)
            ? `<div style="text-align:center;margin-top:8px"><button class="btn btn-white btn-sm" onclick="Tabungan.toggleLingkup()"><i class="fa-solid ${Tabungan.hanyaSaya ? "fa-users" : "fa-user-check"}"></i> ${Tabungan.hanyaSaya ? "Lihat tabungan orang lain" : "Kembali ke tabunganku"}</button></div>` : "";
        if (!grups.length) {
            Tabungan.sinkronKontrolFilter(0, 0, 0, data.length);
            const q = Tabungan.filter.q.trim();
            wrap.innerHTML = (Tabungan.hanyaSaya && !q && !Tabungan.filter.status && !Tabungan.filter.orang)
                ? `<div class="pesan-empty"><i class="fa-solid fa-piggy-bank"></i> Belum ada tabungan atas namamu.</div>` + tombolLingkup
                : `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Tabungan.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            return;
        }

        const grupsTampil = grups.slice(0, Tabungan.grupLimit);
        const totalRowsTampil = grupsTampil.reduce((a, g) => a + g.rows.length, 0);
        const totalRowsCocok = grups.reduce((a, g) => a + g.rows.length, 0);
        Tabungan.sinkronKontrolFilter(grupsTampil.length, grups.length, totalRowsTampil, totalRowsCocok);

        const sisaGrup = Math.max(0, grups.length - grupsTampil.length);
        const tambahGrup = Math.min(sisaGrup, Tabungan.stepGrupLimit);

        wrap.innerHTML = grupsTampil.map(g => {
            const sudahSemua = g.rows.length > 0 && g.belum === 0;
            // Label hijau "Milik sendiri" tampil di kanan bawah (footer card)
            const milik = Tabungan.milikSaya({ nama: g.nama });
            const namaEnc = encodeURIComponent(g.nama);
            const kunciEnc = encodeURIComponent(g.kunci);
            const isOpen = Tabungan.openGrups.has(g.kunci);
            const isExpanded = Tabungan.expandedGrups.has(g.kunci);
            const hariSemua = Tabungan.grupPerHari(g.rows);
            const bisaRingkasHari = hariSemua.length > Tabungan.defaultHariLimit;
            const hariTampil = (!bisaRingkasHari || isExpanded)
                ? hariSemua
                : hariSemua.slice(0, Tabungan.defaultHariLimit);

            const hariHtml = isOpen
                ? `<div class="tb-card-body">
                    <div class="tb-submeta">
                        <span class="tb-meta-pill"><i class="fa-solid fa-receipt"></i> ${g.rows.length} transaksi</span>
                        <span class="tb-meta-pill"><i class="fa-solid fa-calendar-day"></i> ${hariSemua.length} hari</span>
                        <span class="tb-meta-pill ${sudahSemua ? "ok" : "warn"}"><i class="fa-solid ${sudahSemua ? "fa-circle-check" : "fa-clock"}"></i> ${sudahSemua ? "Semua sudah ceklis" : `${g.belum} belum ceklis`}</span>
                        ${bisaRingkasHari && !isExpanded ? `<span class="tb-meta-pill"><i class="fa-solid fa-eye"></i> ${hariTampil.length} hari terbaru</span>` : ""}
                    </div>
                    <div class="tb-days-list">
                        ${hariTampil.map(h => {
                            const netPos = h.net >= 0;
                            return `<section class="tb-day-group">
                                <header class="tb-day-head">
                                    <span class="tb-day-date"><i class="fa-regular fa-calendar"></i> ${escapeHtml(h.tanggal === "tanpa-tanggal" ? "Tanpa tanggal" : Tabungan.fmtTanggalHari(h.tanggal))}</span>
                                    <span class="tb-day-meta">
                                        <span class="tb-day-net ${netPos ? "plus" : "minus"}">${netPos ? "+" : "−"} ${Tabungan.rp(Math.abs(h.net))}</span>
                                        <span class="tb-day-cnt">${h.items.length}×</span>
                                    </span>
                                </header>
                                <div class="tb-day-rows">
                                    ${h.items.map(r => {
                                        const bisaCek = boleh || Tabungan.milikSaya(r);
                                        const keluar = Tabungan.isKeluar(r);
                                        return `<div class="tb-day-row" data-tab-row="${r.id}">
                                            <div class="tb-day-cek">
                                                ${bisaCek
                                                    ? `<button type="button" class="cek-btn ${r.cek ? "on" : ""}" data-tab-toggle="${r.id}" title="${r.cek ? "Sudah diceklis — klik untuk batalkan" : "Belum diceklis — klik untuk tandai"}"><i class="fa-solid ${r.cek ? "fa-check" : "fa-minus"}"></i></button>`
                                                    : `<span class="cek-btn ${r.cek ? "on" : ""}" style="cursor:default"><i class="fa-solid ${r.cek ? "fa-check" : "fa-minus"}"></i></span>`}
                                            </div>
                                            <div class="tb-day-info">
                                                <div class="tb-day-top">
                                                    <span class="jenis ${keluar ? "keluar" : "masuk"}">${keluar ? "−" : "+"} ${Tabungan.rp(r.nominal)}</span>
                                                    <span class="tb-day-saldo">Saldo: <b>${Tabungan.rp(r._total)}</b></span>
                                                </div>
                                                ${olehLabel(r) ? `<div class="tb-day-by">${olehLabel(r)}</div>` : ""}
                                            </div>
                                            ${boleh ? `<div class="row-act">
                                                <button type="button" class="icon-btn" data-tab-edit="${r.id}" title="Edit" style="width:30px; height:30px; font-size:0.75rem; border-width:2px"><i class="fa-solid fa-pen"></i></button>
                                                <button type="button" class="icon-btn" data-tab-del="${r.id}" title="Hapus" style="width:30px; height:30px; font-size:0.75rem; background:var(--red); color:#fff; border-width:2px"><i class="fa-solid fa-trash-can"></i></button>
                                            </div>` : ""}
                                        </div>`;
                                    }).join("")}
                                </div>
                            </section>`;
                        }).join("")}
                    </div>
                    ${(boleh || milik || bisaRingkasHari) ? `<div class="tb-foot">
                        <div class="tb-foot-actions">
                            ${boleh ? `<button class="btn btn-white btn-sm" data-tab-tambah="${namaEnc}"><i class="fa-solid fa-plus"></i> Tambah Setoran</button>` : ""}
                            ${bisaRingkasHari ? `<button type="button" class="btn btn-white btn-sm" data-tab-expand-rows="${kunciEnc}"><i class="fa-solid ${isExpanded ? "fa-compress" : "fa-angles-down"}"></i> ${isExpanded ? `Ringkas (${Tabungan.defaultHariLimit} hari)` : `Lihat semua (${hariSemua.length} hari)`}</button>` : ""}
                        </div>
                        ${milik ? `<span class="jenis milik"><i class="fa-solid fa-user-check"></i> Milik sendiri</span>` : ""}
                    </div>` : ""}
                </div>`
                : "";

            return `<div class="rekap-card tb-person-card${isOpen ? " is-open" : ""}" style="margin-bottom:10px">
                <div class="tb-head tb-head-toggle" role="button" tabindex="0" aria-expanded="${isOpen ? "true" : "false"}" data-tab-toggle-card="${kunciEnc}">
                    <div class="tb-head-left">
                        <div class="tb-head-title-row">
                            <i class="fa-solid fa-piggy-bank tb-head-ico"></i>
                            <span class="tb-title">${escapeHtml(g.nama)}</span>
                            ${milik && !isOpen ? `<span class="tb-milik-mini"><i class="fa-solid fa-user-check"></i> Saya</span>` : ""}
                        </div>
                        <div class="tb-head-sub">
                            <span>${g.rows.length} transaksi · ${hariSemua.length} hari</span>
                            <span class="tb-head-status ${sudahSemua ? "ok" : "warn"}">${sudahSemua ? "Lunas ✓" : `${g.belum} blm ceklis`}</span>
                        </div>
                    </div>
                    <span class="jenis total">${Tabungan.rp(g.total)}${sudahSemua ? " ✓" : ""}</span>
                    <div class="tb-menu-wrap">
                        <button type="button" class="tb-more-btn" data-tab-more="${namaEnc}" title="Menu lainnya"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                        <div class="tb-menu" hidden>
                            <button type="button" data-tab-pdf="${namaEnc}"><i class="fa-solid fa-file-pdf"></i> Export PDF</button>
                        </div>
                    </div>
                    <span class="tb-chev" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span>
                </div>
                ${hariHtml}
            </div>`;
        }).join("")
        + ((sisaGrup > 0 || (grups.length > Tabungan.defaultGrupLimit && grupsTampil.length > Tabungan.defaultGrupLimit))
            ? `<div class="tb-expand-bar">
                ${sisaGrup > 0 ? `<button type="button" class="btn btn-white btn-sm" onclick="Tabungan.tampilGrupLebihBanyak()"><i class="fa-solid fa-angles-down"></i> Tampilkan Lebih Banyak (+${tambahGrup})</button>` : ""}
                ${sisaGrup > tambahGrup ? `<button type="button" class="btn btn-red btn-sm" onclick="Tabungan.tampilSemuaGrup()"><i class="fa-solid fa-layer-group"></i> Lihat Semua (${grups.length})</button>` : ""}
                ${grupsTampil.length > Tabungan.defaultGrupLimit ? `<button type="button" class="btn btn-white btn-sm" onclick="Tabungan.ringkasGrup()"><i class="fa-solid fa-compress"></i> Ringkas (${Tabungan.defaultGrupLimit})</button>` : ""}
            </div>`
            : "")
        + tombolLingkup;
    },

    toggleMenu(btn) {
        try {
            const wrap = btn.closest(".tb-menu-wrap");
            const menu = wrap?.querySelector(".tb-menu");
            if (!menu) return;
            const sedangBuka = !menu.hidden;
            Tabungan.tutupSemuaMenu();
            if (!sedangBuka) menu.hidden = false;
        } catch {}
    },

    tutupSemuaMenu() {
        try {
            document.querySelectorAll("#tabunganWrap .tb-menu").forEach(m => { m.hidden = true; });
        } catch {}
    },

    bacaFilter() {
        Tabungan.filter = {
            ...Tabungan.filter,
            q: document.getElementById("filterQ")?.value || "",
            sort: document.getElementById("filterSort")?.value || "nama",
        };
        Tabungan.grupLimit = Tabungan.defaultGrupLimit;
        Tabungan.render();
    },

    resetFilter() {
        const el = document.getElementById("filterQ");
        if (el) el.value = "";
        const fs = document.getElementById("filterSort");
        if (fs) fs.value = "nama";
        Tabungan.filter = { q: "", status: "", sort: "nama", orang: "" };
        Tabungan.grupLimit = Tabungan.defaultGrupLimit;
        Tabungan.segarkanDropdown();
        Tabungan.render();
    },

    // ============ NAMA DARI DATA ANGGOTA (ketuk, bukan ketik bebas) ============
    // Roster = anggota periode AKTIF (tabel periode), fallback periode terbaru.
    norm(s) {
        return String(s || "").trim().toLowerCase();
    },

    // Cari per token: tiap kata kunci harus terkandung di nama.
    cocokQuery(nama, q) {
        const toks = Tabungan.norm(q).split(/\s+/).filter(Boolean);
        if (!toks.length) return true;
        const t = Tabungan.norm(nama);
        return toks.every(k => t.includes(k));
    },

    async muatPeriode() {
        try {
            if (typeof getPeriode !== "function") return;
            const cached = (typeof Cache !== "undefined") ? Cache.get("periode") : null;
            if (cached && cached.length) {
                Tabungan.pakaiPeriode(cached);
                getPeriode().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("periode", fresh);
                        Tabungan.pakaiPeriode(fresh);
                        if (Tabungan.anggota._cacheList) Tabungan.pakaiAnggota(Tabungan.anggota._cacheList);
                        Tabungan.renderNamaList();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getPeriode();
            if (typeof Cache !== "undefined") Cache.set("periode", fresh);
            Tabungan.pakaiPeriode(fresh);
        } catch (err) { console.error(err); }
    },

    pakaiPeriode(list) {
        Tabungan.periodeTahun = (list || [])
            .filter(p => p && p.aktif)
            .map(p => parseInt(p.tahun, 10))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
    },

    async muatAnggota() {
        try {
            await Tabungan.muatPeriode();
            const cached = (typeof Cache !== "undefined") ? Cache.get("anggota") : null;
            if (cached && cached.length) {
                Tabungan.pakaiAnggota(cached);
                getAnggota().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("anggota", fresh);
                        Tabungan.pakaiAnggota(fresh);
                        Tabungan.renderNamaList();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getAnggota();
            if (typeof Cache !== "undefined") Cache.set("anggota", fresh);
            Tabungan.pakaiAnggota(fresh);
        } catch (err) {
            console.error(err);
            showToast("Gagal memuat anggota: " + err.message, "error");
        }
    },

    // Nama unik per tahun, urut tahun lalu A-Z (tetap scoped ke angkatan aktif)
    pakaiAnggota(list) {
        const bersih = (list || []).filter(a => a && String(a.nama || "").trim());
        const angId = (typeof DbScope !== "undefined" && DbScope.angkatanId) ? DbScope.angkatanId() : null;
        const scoped = (angId && bersih.some(a => a.angkatan_id != null))
            ? bersih.filter(a => Number(a.angkatan_id) === Number(angId))
            : bersih;
        const aktif = (Tabungan.periodeTahun || []).filter(Number.isFinite);
        let pakai;
        if (aktif.length) {
            const cocok = scoped.filter(a => aktif.includes(parseInt(a.tahun, 10)));
            pakai = cocok.length ? cocok : scoped;
        } else {
            const thns = [...new Set(scoped.map(a => parseInt(a.tahun, 10)).filter(Number.isFinite))].sort((a, b) => b - a);
            const th = thns.length ? thns[0] : null;
            pakai = th !== null ? scoped.filter(a => parseInt(a.tahun, 10) === th) : scoped;
        }
        const temu = new Set();
        const jadi = [];
        pakai.forEach(a => {
            const nama = String(a.nama).trim();
            const t = parseInt(a.tahun, 10);
            const kunci = (Number.isFinite(t) ? t : "?") + "|" + nama.toLowerCase();
            if (!nama || temu.has(kunci)) return;
            temu.add(kunci);
            jadi.push({ nama, tahun: Number.isFinite(t) ? t : null });
        });
        jadi.sort((x, y) => (x.tahun ?? 9999) - (y.tahun ?? 9999) || x.nama.localeCompare(y.nama));
        Tabungan.anggota = jadi;
        Tabungan.anggota._cacheList = list;
    },

    pilihNama(nama) {
        nama = String(nama || "").trim();
        if (!nama) return;
        document.getElementById("tabNama").value = nama;
        Tabungan.renderNamaList();
        if (typeof FormPersist !== "undefined") FormPersist.touch("tabForm");
    },

    renderNamaList() {
        const box = document.getElementById("tabNamaListBox");
        if (!box) return;
        if (!document.getElementById("tabForm")?.classList.contains("open")) return;
        const dipilih = (document.getElementById("tabNama")?.value || "").trim();
        const q = Tabungan.namaQ || "";
        const saring = Tabungan.anggota.filter(o => Tabungan.cocokQuery(o.nama, q));
        // Banner pilihan
        const dp = document.getElementById("tabNamaDipilih");
        if (dp) {
            if (dipilih) {
                const ketemu = Tabungan.anggota.find(o => Tabungan.norm(o.nama) === Tabungan.norm(dipilih));
                dp.className = "tb-dipilih";
                dp.innerHTML = `<span class="dot"><i class="fa-solid fa-check"></i></span> ${escapeHtml(dipilih)}<small>${ketemu && ketemu.tahun != null ? ketemu.tahun : "riwayat"}</small>`;
            } else {
                dp.className = "tb-dipilih kosong";
                dp.innerHTML = `<span class="dot">○</span> Belum dipilih — ketuk nama di bawah`;
            }
        }
        if (!saring.length) {
            box.innerHTML = `<div class="pesan-empty">${Tabungan.anggota.length ? "Tidak ada nama yang cocok." : "Memuat anggota..."}</div>`;
            return;
        }
        // Kelompok per tahun
        const m = new Map();
        saring.forEach(o => {
            const t = o.tahun != null ? o.tahun : "?";
            if (!m.has(t)) m.set(t, []);
            m.get(t).push(o.nama);
        });
        box.innerHTML = [...m.entries()]
            .sort((a, b) => (a[0] === "?" ? 9999 : a[0]) - (b[0] === "?" ? 9999 : b[0]))
            .map(([t, names]) =>
                `<div class="tb-tahun"><i class="fa-solid fa-calendar"></i> ${t === "?" ? "Tanpa tahun" : t}<span class="cnt">${names.length}</span></div>` +
                names.map(n => `<button type="button" class="tb-item${Tabungan.norm(n) === Tabungan.norm(dipilih) ? " pilih" : ""}" data-pilih-nama="${encodeURIComponent(n)}"><span class="dot">${Tabungan.norm(n) === Tabungan.norm(dipilih) ? '<i class="fa-solid fa-check"></i>' : "○"}</span> ${escapeHtml(n)}</button>`).join("")
            ).join("");
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
        // Via "Tambah Setoran" per orang: nama sudah pasti — kunci, langsung
        // tampil tanpa picker. Dibuka manual: picker seperti biasa.
        const terkunci = !!prefillNama;
        document.getElementById("tabNamaSearchWrap").style.display = terkunci ? "none" : "";
        document.getElementById("tabNamaListBox").style.display = terkunci ? "none" : "";
        Tabungan.namaQ = "";
        document.getElementById("tabNamaSearch").value = "";
        document.getElementById("tabTanggal").value = Tabungan.hariIni();
        document.getElementById("tabNominal").value = "";
        Tabungan.renderNamaList();
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
                    if (d.tabNominal !== undefined && d.tabNominal !== null) {
                        document.getElementById("tabNominal").value = d.tabNominal;
                        if (typeof formatRupiah === "function") formatRupiah(document.getElementById("tabNominal"));
                    }
                    showToast("Draft dipulihkan.", "info");
                }
            } catch {}
        }
        document.getElementById("tabForm").classList.add("open");
        document.body.style.overflow = "hidden";
        Tabungan.renderNamaList();
        // Roster anggota buat daftar ketuk (cache dulu, segarkan background)
        Tabungan.muatAnggota().then(() => Tabungan.renderNamaList()).catch(() => {});
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
        // Mode edit: picker tetap tampil (boleh ganti nama)
        document.getElementById("tabNamaSearchWrap").style.display = "";
        document.getElementById("tabNamaListBox").style.display = "";
        Tabungan.namaQ = "";
        document.getElementById("tabNamaSearch").value = "";
        document.getElementById("tabTanggal").value = item.tanggal || "";
        document.getElementById("tabNominal").value = item.nominal ?? "";
        if (typeof formatRupiah === "function") formatRupiah(document.getElementById("tabNominal"));
        document.getElementById("tabForm").classList.add("open");
        document.body.style.overflow = "hidden";
        Tabungan.renderNamaList();
        Tabungan.muatAnggota().then(() => Tabungan.renderNamaList()).catch(() => {});
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
        // Angka murni tanpa titik (tampilan "10.000" -> 10000 ke DB)
        const nominal = (typeof parseRupiah === "function")
            ? parseRupiah(document.getElementById("tabNominal").value)
            : (parseInt(document.getElementById("tabNominal").value, 10) || 0);
        const jenis = Tabungan.jenisForm;
        if (!nama) { showToast("Pilih nama penabung dari daftar.", "error"); return; }
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        if (!nominal || nominal <= 0) { showToast("Nominal harus lebih dari 0.", "error"); return; }
        const id = Tabungan.editingId || (document.getElementById("tabId").value ? parseInt(document.getElementById("tabId").value, 10) : null);
        const __spec = () => ({ modul: "tabungan", op: id ? "update" : "create",
            label: (jenis === "keluar" ? "Penarikan " : "Setoran ") + nama,
            payload: { id: id || null, nama, tanggal, nominal, jenis },
            files: [], cacheKeys: ["tabungan"] });
        const __sesudahAntre = () => {
            Tabungan.openGrups.add(Tabungan.norm(nama));
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
                catatAksi("simpan_tabungan", "edit " + nama + " " + Tabungan.rp(nominal));
            } else {
                await buatTabungan(u.id, { nama, tanggal, nominal, jenis });
                showToast(jenis === "keluar" ? "Penarikan tersimpan!" : "Setoran tersimpan!", "success");
                catatAksi("simpan_tabungan", nama + " " + Tabungan.rp(nominal));
            }
            Tabungan.openGrups.add(Tabungan.norm(nama));
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
        const key = String(id);
        const item = (Tabungan.cache || []).find(r => String(r.id) === key);
        if (!item) return;
        // Kelola (akses tabungan) boleh ceklis siapa saja; lainnya cuma milik sendiri
        if (!(OsisAuth.bisa("tabungan") || Tabungan.milikSaya(item))) {
            showToast("Kamu cuma bisa ceklis tabungan sendiri.", "error");
            return;
        }
        // Cegah double-tap saat request sebelumnya belum selesai
        if (!Tabungan._pendingCek) Tabungan._pendingCek = new Set();
        if (Tabungan._pendingCek.has(key)) return;
        const nilaiAwal = !!item.cek;
        const nilaiBaru = !nilaiAwal;
        // 1) Optimis: ubah UI seketika, urusan kirim belakangan
        item.cek = nilaiBaru;
        try { if (typeof Cache !== "undefined") Cache.set("tabungan", Tabungan.cache); } catch {}
        try { Tabungan.render(); } catch {}
        Tabungan._pendingCek.add(key);
        try {
            await toggleTabunganCek(u.id, id, nilaiBaru);
            showToast(nilaiBaru ? "Ditandai sudah diceklis." : "Ceklis dibatalkan.", "success");
            catatAksi("cek_tabungan", (nilaiBaru ? "✓ " : "batal ") + (item.nama || ""));
            Tabungan.segarkan();
        } catch (err) {
            console.error(err);
            // 2) Gagal: kembalikan UI ke nilai awal
            try {
                const cur = (Tabungan.cache || []).find(r => String(r.id) === key);
                if (cur) cur.cek = nilaiAwal;
                if (typeof Cache !== "undefined") Cache.set("tabungan", Tabungan.cache);
                Tabungan.render();
            } catch {}
            const msg = String((err && err.message) || err || "");
            showToast("Gagal update ceklis: " + (/ERR_NO_AUTH/i.test(msg) ? "kamu cuma bisa ceklis tabungan sendiri" : msg), "error");
            Tabungan.segarkan();
        } finally {
            Tabungan._pendingCek.delete(key);
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
            catatAksi("hapus_tabungan", (item.nama || "") + " " + Tabungan.rp(item.nominal));
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
        const kv = (k, v, ico, tone, wide) => `
            <div class="osis-det-kv${wide ? " wide" : ""}">
                <div class="osis-det-kv-top">
                    <span class="osis-det-kv-ico ${tone || ""}"><i class="fa-solid ${ico}"></i></span>
                    <span class="k">${k}</span>
                </div>
                <div class="v">${v || "-"}</div>
            </div>`;
        document.getElementById("tabDetailBody").innerHTML = `
            <div class="osis-det-hero ${keluar ? "tone-keluar" : "tone-masuk"}">
                <div class="osis-det-chips">
                    <span class="osis-det-chip ${keluar ? "red" : "green"}"><i class="fa-solid fa-arrow-${keluar ? "up" : "down"}"></i> ${keluar ? "Penarikan" : "Setoran"}</span>
                    <span class="osis-det-chip ${r.cek ? "green" : "yellow"}"><i class="fa-solid ${r.cek ? "fa-circle-check" : "fa-hourglass-half"}"></i> ${r.cek ? "Sudah diceklis" : "Belum diceklis"}</span>
                </div>
                <h4 class="osis-det-title">${escapeHtml(r.nama || "Tanpa nama")}</h4>
                <div class="osis-det-amount ${keluar ? "keluar" : "masuk"}">${keluar ? "−" : "+"} ${Tabungan.rp(r.nominal)}</div>
            </div>
            <div class="osis-det-grid">
                ${kv("Tanggal", Tabungan.fmtTanggalPendek(r.tanggal), "fa-calendar-days", "t-amber")}
                ${kv("Status Ceklis", r.cek ? "Sudah diceklis ✓" : "Belum diceklis", r.cek ? "fa-circle-check" : "fa-hourglass-half", r.cek ? "t-green" : "t-red")}
                ${kv("Dibuat", Tabungan.fmtTanggalWaktu(r.created_at), "fa-clock", "t-blue")}
                ${kv("Diubah", Tabungan.fmtTanggalWaktu(r.updated_at), "fa-clock-rotate-left", "t-purple")}
                ${kv("Diupload oleh", escapeHtml(r.pengunggah || "-"), "fa-cloud-arrow-up", "t-ink", true)}
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

    // ============ EXPORT PDF (via dialog print → Save as PDF) ============
    cariGrup(nama) {
        const kunci = String(nama || "").trim().toLowerCase();
        return Tabungan.grupPerOrang(Tabungan.dataTampil()).find(g => String(g.nama || "").trim().toLowerCase() === kunci) || null;
    },

    isiLaporanSatu(g) {
        const esc = (s) => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s ?? "-"));
        const masuk = g.rows.filter(r => !Tabungan.isKeluar(r)).reduce((a, r) => a + (parseInt(r.nominal, 10) || 0), 0);
        const keluar = g.rows.filter(r => Tabungan.isKeluar(r)).reduce((a, r) => a + (parseInt(r.nominal, 10) || 0), 0);
        const sudah = g.rows.filter(r => !!r.cek).length;
        return `
            <div style="font-family:Arial,Helvetica,sans-serif; color:#111; max-width:700px; margin:0 auto">
                <div style="text-align:center; border-bottom:3px solid #111; padding-bottom:10px; margin-bottom:14px">
                    <div style="font-size:18px; font-weight:900">TABUNGAN PENGURUS OSIS</div>
                    <div style="font-size:12px">SMK Taruna Harapan 1 Cipatat — ${esc(g.nama)}</div>
                </div>
                <table style="font-size:13px; margin-bottom:12px">
                    <tr><td>Total Setoran (${g.rows.filter(r => !Tabungan.isKeluar(r)).length})</td><td style="text-align:right"><b>${Tabungan.rp(masuk)}</b></td></tr>
                    <tr><td>Total Penarikan (${g.rows.filter(r => Tabungan.isKeluar(r)).length})</td><td style="text-align:right"><b>${Tabungan.rp(keluar)}</b></td></tr>
                    <tr><td><b>Saldo Akhir</b></td><td style="text-align:right"><b>${Tabungan.rp(g.total)}</b></td></tr>
                    <tr><td>Ceklis</td><td style="text-align:right">${sudah}/${g.rows.length} sudah diceklis</td></tr>
                </table>
                <table border="1" cellspacing="0" cellpadding="6" style="width:100%; font-size:12px; border-collapse:collapse">
                    <thead><tr><th>No</th><th>Ceklis</th><th>Tanggal</th><th>Setoran</th><th>Penarikan</th><th>Saldo Jalan</th></tr></thead>
                    <tbody>${g.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.cek ? "Sudah" : "Belum"}</td><td>${esc(Tabungan.fmtTanggalPendek(r.tanggal))}</td><td style="text-align:right">${Tabungan.isKeluar(r) ? "-" : Tabungan.rp(r.nominal)}</td><td style="text-align:right">${Tabungan.isKeluar(r) ? Tabungan.rp(r.nominal) : "-"}</td><td style="text-align:right">${Tabungan.rp(r._total)}</td></tr>`).join("") || `<tr><td colspan="6">Tidak ada data.</td></tr>`}</tbody>
                </table>
                <p style="font-size:11px; color:#666; margin-top:12px">Dicetak ${new Date().toLocaleString("id-ID")} dari website OSIS Tarpan One.</p>
            </div>`;
    },

    cetakHtml(html, judulFile) {
        const pa = document.getElementById("printArea");
        if (!pa) { showToast("Area cetak tidak ditemukan.", "error"); return; }
        pa.innerHTML = html;
        const oldTitle = document.title;
        document.title = judulFile;
        showToast("Pilih 'Save as PDF' di dialog print", "info");
        window.print();
        setTimeout(() => { document.title = oldTitle; }, 500);
    },

    exportSatu(nama) {
        const g = Tabungan.cariGrup(nama);
        if (!g) { showToast("Data penabung tidak ditemukan.", "error"); return; }
        const aman = String(g.nama || "tabungan").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "tabungan";
        Tabungan.cetakHtml(Tabungan.isiLaporanSatu(g), `Tabungan-${aman}`);
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
