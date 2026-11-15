// =========================================================================
// KEUANGAN - halaman khusus OSIS (folder /osis)
// Dipakai di osis2/keuangan.html - kas masuk/keluar, saldo = masuk - keluar (dihitung client). Bukti foto drag & drop folder kas/.
// Export/cetak laporan via print CSS. Visual ikut design system Agenda.
// =========================================================================

const Keuangan = {
  cache: [],
  agendaCache: [],
  // Paging hemat egress: 20/halaman + sentinel. Statistik/rekap TIDAK dari
  // cache parsial melainkan RPC ringkas (benar walau belum discroll habis).
  offset: 0,
  habis: false,
  loading: false,
  perPage: 20,
  defaultLimit: 5,
  tampilLimit: 5,
  stepTampil: 15,
  ringkas: null,
  filter: {
    q: "",
    jenis: "",
    kategori: "",
    divisi: "",
    periode: "",
    sort: "baru",
  },
  editingId: null,
  detailId: null,
  jenisForm: "keluar",
  stagedFile: null,
  stagedUrl: null,
  existingBukti: "",

  KAT_MASUK: [
    "Kas",
    "Sponsorship",
    "Donasi",
    "Dana Sekolah",
    "Penjualan",
    "Lainnya",
  ],
  KAT_KELUAR: [
    "Konsumsi",
    "Perlengkapan",
    "Transportasi",
    "Administrasi",
    "Dokumentasi",
    "Acara",
    "Lainnya",
  ],

  async init() {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") {
      location.replace("../login");
      return;
    }
    // Segarkan hak kendali (biar perubahan akses langsung berlaku)
    try {
      await OsisAuth.refreshAkses();
    } catch {}
    Keuangan.terapkanAkses();

    // opsi divisi: BPH + Umum + sekbid (fail silent)
    try {
      const list = await getSekbid();
      const names = [
        ...new Set((list || []).map((s) => s.nama).filter(Boolean)),
      ];
      const opts = ["BPH", "Umum", ...names]
        .map(
          (n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`,
        )
        .join("");
      const dd = document.getElementById("kasDivisi");
      if (dd) dd.innerHTML = `<option value="">- Pilih -</option>` + opts;
      const fd = document.getElementById("filterDivisi");
      if (fd) fd.innerHTML = `<option value="">Semua</option>` + opts;
      Keuangan.segarkanDropdown();
    } catch {}

    document
      .getElementById("btnTambahKas")
      ?.addEventListener("click", () => Keuangan.bukaForm());
    document
      .getElementById("btnBatalKas")
      ?.addEventListener("click", () => Keuangan.tutupForm());
    document
      .getElementById("btnSimpanKas")
      ?.addEventListener("click", () => Keuangan.simpan());
    document
      .getElementById("btnResetFilter")
      ?.addEventListener("click", () => Keuangan.resetFilter());
    document
      .getElementById("btnClearQ")
      ?.addEventListener("click", () => {
        const q = document.getElementById("filterQ");
        if (q) q.value = "";
        Keuangan.bacaFilter();
      });
    document
      .getElementById("jenisFilterPills")
      ?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-jenis-pill]");
        if (!btn) return;
        const fj = document.getElementById("filterJenis");
        if (fj) fj.value = btn.dataset.jenisPill || "";
        Keuangan.bacaFilter();
      });
    document
      .getElementById("btnMuatSemua")
      ?.addEventListener("click", () => Keuangan.tampilSemua());
    document
      .getElementById("katSummaryBody")
      ?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-kat-pick]");
        if (!btn) return;
        const fk = document.getElementById("filterKategori");
        if (!fk) return;
        const picked = btn.dataset.katPick || "";
        fk.value = fk.value === picked ? "" : picked;
        Keuangan.segarkanDropdown();
        Keuangan.bacaFilter();
      });
    document
      .getElementById("filterChips")
      ?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-clear-filter]");
        if (!btn) return;
        const key = btn.dataset.clearFilter;
        const map = {
          q: "filterQ",
          jenis: "filterJenis",
          kategori: "filterKategori",
          divisi: "filterDivisi",
          periode: "filterPeriode",
          sort: "filterSort",
        };
        const el = document.getElementById(map[key]);
        if (el) el.value = key === "sort" ? "baru" : "";
        Keuangan.segarkanDropdown();
        Keuangan.bacaFilter();
      });

    document
      .getElementById("btnExport")
      ?.addEventListener("click", () => Keuangan.exportPdf());
    document
      .getElementById("btnCetak")
      ?.addEventListener("click", () => Keuangan.cetak());
    document
      .getElementById("btnDownloadBukti")
      ?.addEventListener("click", () => Keuangan.downloadBukti());
    document
      .getElementById("btnEditDariDetail")
      ?.addEventListener("click", () => {
        const id = Keuangan.detailId;
        Keuangan.tutupDetail();
        if (id) Keuangan.edit(id);
      });
    document
      .getElementById("btnHapusDariDetail")
      ?.addEventListener("click", () => {
        const id = Keuangan.detailId;
        if (id) Keuangan.hapus(id, true);
      });

    [
      "filterQ",
      "filterJenis",
      "filterKategori",
      "filterDivisi",
      "filterPeriode",
      "filterSort",
    ].forEach((id) => {
      document
        .getElementById(id)
        ?.addEventListener("input", () => Keuangan.bacaFilter());
    });

    // Nominal: ketik angka -> tampil titik ribuan otomatis
    if (typeof ikatRupiah === "function") ikatRupiah("kasNominal");

    // bukti drag & drop (gambar)
    const drop = document.getElementById("kasDrop");
    const fileInput = document.getElementById("kasBukti");
    if (drop && fileInput) {
      drop.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", (e) => {
        Keuangan.handleFile(e.target.files && e.target.files[0]);
        e.target.value = "";
      });
      ["dragenter", "dragover"].forEach((ev) => {
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach((ev) => {
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove("dragover");
        });
      });
      drop.addEventListener("drop", (e) => {
        const f =
          e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) Keuangan.handleFile(f);
      });
    }

    document.getElementById("kasWrap")?.addEventListener("click", (e) => {
      const row = e.target.closest("[data-kas-row]");
      if (row) Keuangan.detail(row.dataset.kasRow);
    });

    ["kasForm", "kasDetail"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", (e) => {
        if (e.target.id === id) {
          if (id === "kasForm") Keuangan.tutupForm();
          else Keuangan.tutupDetail();
        }
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (document.getElementById("kasForm")?.classList.contains("open"))
        Keuangan.tutupForm();
      if (document.getElementById("kasDetail")?.classList.contains("open"))
        Keuangan.tutupDetail();
    });
    // Draft otomatis: ketikan belum disubmit tetap ada walau popup ditutup / refresh
    if (typeof FormPersist !== "undefined") {
      FormPersist.watch("kasForm", {
        fields: [
          "kasTanggal",
          "kasNominal",
          "kasKeterangan",
          "kasKategori",
          "kasDivisi",
          "kasPic",
          "kasAgenda",
          "kasCatatan",
        ],
        isEditing: () => !!Keuangan.editingId,
        collect: () => ({ jenis: Keuangan.jenisForm }),
      });
    }

    await Keuangan.muat();
  },

  // ============ HELPERS ============
  rp(n) {
    return "Rp" + (parseInt(n, 10) || 0).toLocaleString("id-ID");
  },

  fmtTanggal(t) {
    if (!t) return "-";
    try {
      return new Date(t).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return t;
    }
  },

  fmtTanggalWaktu(t) {
    if (!t) return "-";
    try {
      return new Date(t).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "-";
    }
  },

  periodeOf(t) {
    return (t.tanggal || "").slice(0, 4);
  },

  agendaName(id) {
    if (!id) return "";
    const a = (Keuangan.agendaCache || []).find(
      (x) => String(x.id) === String(id),
    );
    return a ? a.judul : `#${id} (dihapus)`;
  },

  // Scope server = filter aktif (tahun/jenis/kategori/divisi/cari). Halaman
  // yang di-fetch selalu pas dengan filter, statistik ikut scope via RPC.
  scopeDariFilter() {
    const f = Keuangan.filter;
    return { tahun: f.periode, jenis: f.jenis, kategori: f.kategori, divisi: f.divisi, q: f.q };
  },

  scopeKosong() {
    const s = Keuangan.scopeDariFilter();
    return !s.tahun && !s.jenis && !s.kategori && !s.divisi && !String(s.q || "").trim();
  },

  uidSaya() {
    try {
      const u = OsisAuth.getUser && OsisAuth.getUser();
      if (u && u.mode === "osis" && u.id) return u.id;
    } catch {}
    return null;
  },

  segarkanDropdown() {
    try {
      if (window.Dropdown && Dropdown.segarkanSemua) Dropdown.segarkanSemua();
    } catch {}
  },

  // ============ DATA ============
  // muat() tanpa argumen = refresh penuh (dipakai outbox + pasca simpan/hapus)
  async muat(awal = true) {
    if (Keuangan.loading) return;
    if (!awal && Keuangan.habis) return;
    Keuangan.loading = true;
    try {
      const scope = Keuangan.scopeDariFilter();
      const uid = Keuangan.uidSaya();
      if (awal) {
        Keuangan.offset = 0;
        Keuangan.cache = [];
        Keuangan.habis = false;
        Keuangan.ringkas = null;
        Keuangan.tampilLimit = Keuangan.defaultLimit;
        // Render cache persisten DULU (hanya bila tanpa filter) biar offline langsung tampil.
        if (Keuangan.scopeKosong()) {
          const cached = Cache.get("kas");
          if (cached) {
            Keuangan.agendaCache = Cache.get("agenda_all") || [];
            try { Keuangan.buildOptions(); } catch {}
            Keuangan.cache = cached;
            Keuangan.render();
          }
        }
      }
      const [ringkas, rows] = await Promise.all([
        (typeof osisKasRingkas === "function" ? osisKasRingkas(uid, scope) : Promise.resolve(null)).catch(() => null),
        getKas(Keuangan.perPage, Keuangan.offset, scope),
      ]);
      // Lookup agenda tetap full (kecil) buat opsi form + tampilan nama.
      try {
        const ag = await getAllAgenda().catch(() => null);
        if (ag) { Keuangan.agendaCache = ag; try { Cache.set("agenda_all", ag); } catch {} }
      } catch {}
      if (ringkas) Keuangan.ringkas = ringkas;
      if (awal) {
        Keuangan.cache = rows || [];
      } else {
        const ada = new Set((Keuangan.cache || []).map((t) => String(t.id)));
        (rows || []).forEach((t) => { if (!ada.has(String(t.id))) { ada.add(String(t.id)); Keuangan.cache.push(t); } });
      }
      Keuangan.offset = (Keuangan.cache || []).length;
      Keuangan.habis = (rows || []).length < Keuangan.perPage;
      // Cache persisten hanya bila lengkap + tanpa filter.
      if (Keuangan.habis && Keuangan.scopeKosong()) {
        try { Cache.set("kas", Keuangan.cache); } catch {}
      }
      try { Keuangan.buildOptions(); } catch {}
      Keuangan.render();
    } catch (err) {
      console.error(err);
      if (awal && !(Keuangan.cache || []).length) {
        document.getElementById("kasWrap").innerHTML =
          `<div class="pesan-empty">Gagal memuat transaksi.</div>`;
      } else if (typeof showToast === "function") {
        showToast("Gagal muat lanjutan transaksi.", "error");
      }
    } finally {
      Keuangan.loading = false;
    }
  },

  async muatSemua() {
    if (Keuangan.loading) return;
    Keuangan.loading = true;
    const btn = document.getElementById("btnMuatSemua");
    const oldHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...';
    }
    try {
      const scope = Keuangan.scopeDariFilter();
      const rows = await getKas(null, 0, scope);
      Keuangan.cache = rows || [];
      Keuangan.offset = Keuangan.cache.length;
      Keuangan.habis = true;
      if (Keuangan.scopeKosong()) {
        try { Cache.set("kas", Keuangan.cache); } catch {}
      }
      try { Keuangan.buildOptions(); } catch {}
      Keuangan.render();
    } catch (err) {
      console.error(err);
      if (btn && oldHtml) btn.innerHTML = oldHtml;
      if (typeof showToast === "function") {
        showToast("Gagal memuat semua transaksi.", "error");
      }
    } finally {
      Keuangan.loading = false;
      if (btn) btn.disabled = false;
    }
  },

  async tampilLebihBanyak() {
    const data = Keuangan.dataTampil();
    const cur = Keuangan.tampilLimit;
    if (data.length > cur) {
      Keuangan.tampilLimit = cur + Keuangan.stepTampil;
      Keuangan.render();
      return;
    }
    if (!Keuangan.habis) {
      Keuangan.tampilLimit = cur + Keuangan.perPage;
      await Keuangan.muat(false);
    }
  },

  async tampilSemua() {
    Keuangan.tampilLimit = Infinity;
    if (!Keuangan.habis) {
      await Keuangan.muatSemua();
      return;
    }
    Keuangan.render();
  },

  ringkasTampil() {
    Keuangan.tampilLimit = Keuangan.defaultLimit;
    Keuangan.render();
  },

  buildOptions() {
    // Opsi tahun & kategori: dari RPC ringkas (lengkap) bila ada, fallback cache.
    const R = Keuangan.ringkas;
    const pers = (R && Array.isArray(R.tahuns) && R.tahuns.length
      ? R.tahuns.map(String)
      : [
        ...new Set(
          (Keuangan.cache || [])
            .map((t) => Keuangan.periodeOf(t))
            .filter(Boolean),
        ),
      ].sort().reverse()
    );
    const fp = document.getElementById("filterPeriode");
    if (fp) {
      const cur = fp.value || Keuangan.filter.periode || "";
      fp.innerHTML =
        `<option value="">Semua</option>` +
        pers.map((p) => `<option value="${p}">${p}</option>`).join("");
      fp.value = cur;
      Keuangan.filter.periode = cur;
    }
    const kats = (R && Array.isArray(R.kategoris) && R.kategoris.length
      ? R.kategoris.map(String)
      : [
        ...new Set((Keuangan.cache || []).map((t) => t.kategori).filter(Boolean)),
      ].sort()
    );
    const fk = document.getElementById("filterKategori");
    if (fk) {
      const cur = fk.value || Keuangan.filter.kategori || "";
      fk.innerHTML =
        `<option value="">Semua</option>` +
        kats
          .map(
            (k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`,
          )
          .join("");
      fk.value = cur;
      Keuangan.filter.kategori = cur;
    }
    const ta = document.getElementById("kasAgenda");
    if (ta) {
      const list = [...(Keuangan.agendaCache || [])].sort((a, b) =>
        String(b.tanggal || "") < String(a.tanggal || "") ? -1 : 1,
      );
      ta.innerHTML =
        `<option value="">- Tidak ada -</option>` +
        list
          .map((a) => {
            const tgl = a.tanggal
              ? new Date(a.tanggal).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "short",
                })
              : "";
            return `<option value="${a.id}">${escapeHtml(a.judul || "Tanpa judul")}${tgl ? " · " + tgl : ""}</option>`;
          })
          .join("");
    }
    Keuangan.segarkanDropdown();
  },

  dataTampil() {
    const all = Keuangan.cache || [];
    const f = Keuangan.filter;
    const q = f.q.trim().toLowerCase();
    let data = all.filter((t) => {
      if (
        q &&
        !`${t.keterangan || ""} ${t.catatan || ""} ${t.pic || ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      if (f.jenis && (t.jenis || "") !== f.jenis) return false;
      if (f.kategori && (t.kategori || "") !== f.kategori) return false;
      if (f.divisi && (t.divisi || "") !== f.divisi) return false;
      if (f.periode && Keuangan.periodeOf(t) !== String(f.periode))
        return false;
      return true;
    });
    if (f.sort === "lama")
      data = [...data].sort((a, b) =>
        String(a.tanggal || "") > String(b.tanggal || "") ? 1 : -1,
      );
    else if (f.sort === "besar")
      data = [...data].sort(
        (a, b) =>
          (parseInt(b.nominal, 10) || 0) - (parseInt(a.nominal, 10) || 0),
      );
    else if (f.sort === "kecil")
      data = [...data].sort(
        (a, b) =>
          (parseInt(a.nominal, 10) || 0) - (parseInt(b.nominal, 10) || 0),
      );
    else
      data = [...data].sort((a, b) =>
        String(a.tanggal || "") < String(b.tanggal || "") ? 1 : -1,
      );
    return data;
  },

  // Baris laporan = scope filter PENUH (fetch khusus sekali saat export,
  // bukan cache parsial). Gagal -> fallback data tampil + toast.
  async barisLaporan() {
    try {
      const full = await getKas(null, 0, Keuangan.scopeDariFilter());
      if (full && full.length) {
        const f = Keuangan.filter;
        const data = [...full];
        if (f.sort === "lama")
          data.sort((a, b) =>
            String(a.tanggal || "") > String(b.tanggal || "") ? 1 : -1,
          );
        else if (f.sort === "besar")
          data.sort(
            (a, b) =>
              (parseInt(b.nominal, 10) || 0) - (parseInt(a.nominal, 10) || 0),
          );
        else if (f.sort === "kecil")
          data.sort(
            (a, b) =>
              (parseInt(a.nominal, 10) || 0) - (parseInt(b.nominal, 10) || 0),
          );
        else
          data.sort((a, b) =>
            String(a.tanggal || "") < String(b.tanggal || "") ? 1 : -1,
          );
        return data;
      }
    } catch (err) { console.error(err); }
    try { if (typeof showToast === "function") showToast("Pakai data yang sudah dimuat (belum lengkap).", "info"); } catch {}
    return Keuangan.dataTampil();
  },

  // ============ RENDER ============
  sinkronKontrolFilter(dataCount, totalServer) {
    const f = Keuangan.filter;
    const clearBtn = document.getElementById("btnClearQ");
    if (clearBtn) clearBtn.style.display = String(f.q || "").trim() ? "" : "none";

    document.querySelectorAll("#jenisFilterPills [data-jenis-pill]").forEach((btn) => {
      btn.classList.toggle("on", (btn.dataset.jenisPill || "") === (f.jenis || ""));
    });

    const chipsEl = document.getElementById("filterChips");
    if (chipsEl) {
      const chips = [];
      if (String(f.q || "").trim())
        chips.push({ k: "q", l: `Cari: "${String(f.q).trim()}"` });
      if (f.jenis)
        chips.push({ k: "jenis", l: f.jenis === "masuk" ? "Pemasukan" : "Pengeluaran" });
      if (f.kategori)
        chips.push({ k: "kategori", l: "Kategori: " + f.kategori });
      if (f.divisi)
        chips.push({ k: "divisi", l: "Divisi: " + f.divisi });
      if (f.periode)
        chips.push({ k: "periode", l: "Periode: " + f.periode });
      if (f.sort && f.sort !== "baru") {
        const sortLbl = {
          lama: "Terlama",
          besar: "Nominal terbesar",
          kecil: "Nominal terkecil",
        }[f.sort] || f.sort;
        chips.push({ k: "sort", l: "Urutan: " + sortLbl });
      }
      chipsEl.innerHTML = chips
        .map(
          (c) =>
            `<button type="button" class="filter-chip" data-clear-filter="${c.k}" title="Hapus filter ini">${escapeHtml(c.l)} <i class="fa-solid fa-xmark"></i></button>`,
        )
        .join("");
    }

    const cntEl = document.getElementById("filterCountInfo");
    if (cntEl && typeof dataCount === "number") {
      const total = typeof totalServer === "number" && totalServer > dataCount ? totalServer : dataCount;
      cntEl.textContent =
        total > dataCount
          ? `Menampilkan ${dataCount} dari ${total} transaksi`
          : `Menampilkan ${dataCount} transaksi`;
    }
    try { window.OsisSearch?.sync?.("keuTopSearch"); } catch {}
  },

  render() {
    const data = Keuangan.dataTampil();
    const f = Keuangan.filter;
    // Angka dari RPC ringkas (benar walau tabel belum discroll habis).
    // RPC belum ada (migrasi belum di-run) -> fallback hitung dari data tampil.
    const R = Keuangan.ringkas;
    const sum = (jenis) =>
      data
        .filter((t) => (t.jenis || "") === jenis)
        .reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
    const masuk = R ? parseInt(R.masuk, 10) || 0 : sum("masuk");
    const keluar = R ? parseInt(R.keluar, 10) || 0 : sum("keluar");
    const nTrans = R && R.n != null ? parseInt(R.n, 10) || 0 : data.length;
    const saldo = masuk - keluar;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    // Hero badges & status saldo
    const statusTxt = saldo > 0 ? "Surplus" : saldo < 0 ? "Defisit" : "Seimbang";
    const statusCls = saldo > 0 ? "surplus" : saldo < 0 ? "defisit" : "";
    const hbTrans = document.getElementById("heroTransBadge");
    if (hbTrans)
      hbTrans.innerHTML = `<i class="fa-solid fa-receipt"></i> ${nTrans} transaksi`;
    const hbPer = document.getElementById("heroPeriodeBadge");
    if (hbPer)
      hbPer.innerHTML = `<i class="fa-solid fa-calendar-days"></i> ${escapeHtml(f.periode ? "Periode " + f.periode : "Semua Periode")}`;
    const hbStat = document.getElementById("heroStatusBadge");
    if (hbStat) {
      hbStat.className = "osis-badge kas-badge-status" + (statusCls ? " " + statusCls : "");
      hbStat.innerHTML = `<i class="fa-solid fa-scale-balanced"></i> ${statusTxt}`;
    }

    // Kartu Saldo Dark-Ink + Rasio Arus Kas
    set("saldoAkhir", (saldo < 0 ? "- " : "") + Keuangan.rp(Math.abs(saldo)));
    set("rumusMasuk", "+ " + Keuangan.rp(masuk));
    set("rumusKeluar", "- " + Keuangan.rp(keluar));
    set(
      "saldoPeriodeLbl",
      f.periode ? `· Periode ${f.periode}` : "· Semua periode",
    );
    const sp = document.getElementById("saldoStatusPill");
    if (sp) {
      sp.textContent = statusTxt;
      sp.className = "saldo-status-pill" + (statusCls ? " " + statusCls : "");
    }
    const totalFlow = masuk + keluar;
    const pctIn = totalFlow > 0 ? Math.round((masuk / totalFlow) * 100) : 50;
    const pctOut = totalFlow > 0 ? 100 - pctIn : 50;
    const rIn = document.getElementById("saldoRatioIn");
    const rOut = document.getElementById("saldoRatioOut");
    if (rIn) rIn.style.width = pctIn + "%";
    if (rOut) rOut.style.width = pctOut + "%";
    const rasioKeluar = masuk > 0 ? Math.round((keluar / masuk) * 100) : (keluar > 0 ? 100 : 0);
    set(
      "saldoRatioPct",
      totalFlow > 0 ? `Porsi keluar: ${rasioKeluar}% dari masuk` : "Belum ada arus kas",
    );
    const nBukti = (Keuangan.cache || []).filter((t) => !!t.bukti_path).length;
    set(
      "saldoBuktiInfo",
      nBukti > 0 ? `${nBukti} nota dimuat` : "Tanpa filter nota",
    );

    // 4 Stat Cards
    set("statMasuk", Keuangan.rp(masuk));
    set(
      "statMasukSub",
      totalFlow > 0 ? `${pctIn}% dari total perputaran` : "arus kas masuk",
    );
    set("statKeluar", Keuangan.rp(keluar));
    set(
      "statKeluarSub",
      masuk > 0 ? `${rasioKeluar}% dari pemasukan` : "arus kas keluar",
    );
    set("statCount", nTrans + " transaksi");
    set(
      "statCountSub",
      `${(Keuangan.cache || []).length} dimuat di layar`,
    );
    set(
      "statSelisih",
      (saldo < 0 ? "- " : saldo > 0 ? "+ " : "") + Keuangan.rp(Math.abs(saldo)),
    );
    const selCard = document.getElementById("statSelisih")?.closest(".stat-card");
    if (selCard) {
      selCard.classList.toggle("positif", saldo > 0);
      selCard.classList.toggle("negatif", saldo < 0);
    }
    set(
      "statSelisihSub",
      saldo > 0 ? "surplus periode aktif" : saldo < 0 ? "defisit periode aktif" : "masuk = keluar",
    );

    // rekap per bulan (dari RPC bila ada, fallback data tampil)
    const byBulan = {};
    let keys;
    if (R && Array.isArray(R.per_bulan)) {
      R.per_bulan.forEach((b) => {
        if (!b || !b.ym) return;
        byBulan[b.ym] = { masuk: parseInt(b.masuk, 10) || 0, keluar: parseInt(b.keluar, 10) || 0 };
      });
      keys = R.per_bulan.map((b) => b.ym).filter(Boolean);
    } else {
      data.forEach((t) => {
        const ym = (t.tanggal || "").slice(0, 7);
        if (!ym) return;
        if (!byBulan[ym]) byBulan[ym] = { masuk: 0, keluar: 0 };
        byBulan[ym][t.jenis === "masuk" ? "masuk" : "keluar"] +=
          parseInt(t.nominal, 10) || 0;
      });
      keys = Object.keys(byBulan).sort().reverse().slice(0, 6);
    }
    set("rekapCount", keys.length + " bln");
    const rb = document.getElementById("rekapBody");
    if (rb) {
      if (!keys.length) {
        rb.innerHTML = `<div class="pesan-empty">Belum ada data rekap.</div>`;
      } else {
        const max = Math.max(
          ...keys.map((k) => Math.max(byBulan[k].masuk, byBulan[k].keluar)),
          1,
        );
        const namaBulan = (ym) => {
          try {
            return new Date(ym + "-01").toLocaleDateString("id-ID", {
              month: "short",
              year: "numeric",
            });
          } catch {
            return ym;
          }
        };
        rb.innerHTML = keys
          .map((ym) => {
            const b = byBulan[ym];
            const net = b.masuk - b.keluar;
            const netCls = net >= 0 ? "plus" : "minus";
            const netStr = (net >= 0 ? "+" : "-") + Keuangan.rp(Math.abs(net));
            return `<div class="rekap-row">
                        <div class="top"><span>${namaBulan(ym)}</span><span class="rekap-net ${netCls}">${netStr}</span></div>
                        <div class="rekap-nums"><span class="m">+${Keuangan.rp(b.masuk)}</span><span class="k">-${Keuangan.rp(b.keluar)}</span></div>
                        <div class="rekap-bars">
                          <div class="bar masuk"><span style="width:${Math.round((b.masuk / max) * 100)}%"></span></div>
                          <div class="bar keluar"><span style="width:${Math.round((b.keluar / max) * 100)}%"></span></div>
                        </div>
                    </div>`;
          })
          .join("");
      }
      const rt = document.getElementById("rekapTitle");
      if (rt)
        rt.textContent = f.periode
          ? `Rekap Periode ${f.periode}`
          : "Rekap Per Bulan";
    }

    // Ringkasan Top Kategori interaktif (rail kiri)
    const katMap = {};
    (Keuangan.cache || []).forEach((t) => {
      const k = t.kategori || "Lainnya";
      if (!katMap[k]) katMap[k] = { name: k, masuk: 0, keluar: 0, n: 0 };
      katMap[k].n++;
      if (t.jenis === "masuk") katMap[k].masuk += parseInt(t.nominal, 10) || 0;
      else katMap[k].keluar += parseInt(t.nominal, 10) || 0;
    });
    const katList = Object.values(katMap)
      .map((x) => ({
        ...x,
        total: x.masuk + x.keluar,
        dom: x.masuk >= x.keluar ? "masuk" : "keluar",
      }))
      .sort((a, b) => b.total - a.total);
    set("katCount", katList.length);
    const kb = document.getElementById("katSummaryBody");
    if (kb) {
      if (!katList.length) {
        kb.innerHTML = `<div class="pesan-empty">Belum ada data kategori.</div>`;
      } else {
        const maxKat = Math.max(...katList.map((k) => k.total), 1);
        const top = katList.slice(0, 7);
        kb.innerHTML = `<div class="kat-list">${top
          .map((k) => {
            const on = f.kategori === k.name ? " on" : "";
            return `<button type="button" class="kat-item${on}" data-kat-pick="${escapeHtml(k.name)}" title="${on ? "Klik untuk lepas filter" : "Klik untuk filter kategori ini"}">
              <div class="kat-item-top">
                <span>${escapeHtml(k.name)}</span>
                <span class="kat-item-amt ${k.dom}">${Keuangan.rp(k.total)}</span>
              </div>
              <div class="kat-item-sub">
                <span>${k.n} transaksi</span>
                <span>${k.dom === "masuk" ? "Dominan masuk" : "Dominan keluar"}</span>
              </div>
              <div class="kat-bar ${k.dom}"><span style="width:${Math.round((k.total / maxKat) * 100)}%"></span></div>
            </button>`;
          })
          .join("")}</div>${!Keuangan.habis ? `<div class="kat-note">Dihitung dari ${(Keuangan.cache || []).length} transaksi termuat.</div>` : ""}`;
      }
    }

    // Header ledger counter & Tampilkan Semua + Sinkron filter bar
    const totalDiketahui = nTrans > data.length ? nTrans : data.length;
    const tampil = data.slice(0, Keuangan.tampilLimit);
    const adaLagi = tampil.length < data.length || !Keuangan.habis;

    set(
      "kasLoadedInfo",
      totalDiketahui > tampil.length
        ? `${tampil.length} / ${totalDiketahui} tampil`
        : `${tampil.length} transaksi`,
    );
    const btnAll = document.getElementById("btnMuatSemua");
    if (btnAll) {
      const showAll = adaLagi && (Keuangan.cache || []).length > 0;
      btnAll.style.display = showAll ? "" : "none";
      if (showAll) {
        btnAll.innerHTML =
          totalDiketahui > tampil.length
            ? `<i class="fa-solid fa-layer-group"></i> Tampilkan Semua (${totalDiketahui})`
            : `<i class="fa-solid fa-layer-group"></i> Tampilkan Semua`;
      }
    }
    Keuangan.sinkronKontrolFilter(tampil.length, totalDiketahui);

    // tabel / ledger (default 5 baris, sisanya muncul saat diklik)
    const wrap = document.getElementById("kasWrap");
    if (!wrap) return;
    if (!(Keuangan.cache || []).length) {
      wrap.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-wallet" style="color:var(--red)"></i></div><b>Belum ada transaksi</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">${Keuangan.scopeKosong() ? "Tambahkan transaksi pertama untuk mulai mencatat keuangan OSIS." : "Tidak ada transaksi untuk filter saat ini."}</p>${!Keuangan.scopeKosong() ? `<button class="btn btn-white btn-sm" onclick="Keuangan.resetFilter()" style="margin-right:6px"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button>` : ""}${OsisAuth.bisa("keuangan") ? `<button class="btn btn-red btn-sm" onclick="Keuangan.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Transaksi</button>` : ""}</div>`;
      return;
    }
    if (!data.length) {
      wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Keuangan.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
      return;
    }
    const sisaTersimpan = Math.max(0, data.length - tampil.length);
    const tambahanKlik = sisaTersimpan > 0 ? Math.min(sisaTersimpan, Keuangan.stepTampil) : Keuangan.perPage;
    const sisaTotal = Math.max(0, totalDiketahui - tampil.length);

    wrap.innerHTML = `<table class="kas-tabel"><thead><tr><th>Tanggal</th><th>Transaksi</th><th>Jenis</th><th>Kategori</th><th class="num">Nominal</th></tr></thead><tbody>${tampil
      .map((t) => {
        const divTag = t.divisi
          ? `<span class="kas-mini-tag"><i class="fa-solid fa-users"></i> ${escapeHtml(t.divisi)}</span>`
          : "";
        const buktiTag = t.bukti_path
          ? `<span class="kas-mini-tag bukti"><i class="fa-solid fa-image"></i> Nota</span>`
          : "";
        const agendaTag = t.agenda_id
          ? `<span class="kas-mini-tag agenda"><i class="fa-solid fa-calendar-check"></i> ${escapeHtml(Keuangan.agendaName(t.agenda_id))}</span>`
          : "";
        return `
            <tr data-kas-row="${t.id}">
                <td class="col-tgl"><span class="kas-tgl-pill">${Keuangan.fmtTanggal(t.tanggal)}</span></td>
                <td class="col-ket">
                  <div class="kas-desc-title">${escapeHtml(t.keterangan || "Tanpa keterangan")}</div>
                  <div class="kas-meta-line">
                    <span><i class="fa-regular fa-user"></i> ${escapeHtml(t.pic || "-")}</span>
                    ${divTag}${buktiTag}${agendaTag}
                    <span>${olehLabel(t)}</span>
                  </div>
                </td>
                <td class="col-jenis"><span class="jenis ${t.jenis}">${t.jenis === "masuk" ? "Pemasukan" : "Pengeluaran"}</span></td>
                <td class="col-kat"><span class="kat-chip">${escapeHtml(t.kategori || "-")}</span></td>
                <td class="nominal ${t.jenis}">${t.jenis === "masuk" ? "+" : "-"} ${Keuangan.rp(t.nominal)}</td>
            </tr>`;
      })
      .join("")}</tbody></table>`
      + `<div class="kas-expand-bar">`
      + (adaLagi
        ? `<button type="button" class="btn btn-white btn-sm" onclick="Keuangan.tampilLebihBanyak()"><i class="fa-solid fa-angles-down"></i> Tampilkan Lebih Banyak (+${tambahanKlik})</button>`
          + (sisaTotal > tambahanKlik || !Keuangan.habis
            ? `<button type="button" class="btn btn-red btn-sm" onclick="Keuangan.tampilSemua()"><i class="fa-solid fa-layer-group"></i> Lihat Semua (${totalDiketahui})</button>`
            : "")
        : `<small style="color:var(--gray); font-weight:700">— Semua ${tampil.length} transaksi ditampilkan —</small>`)
      + (tampil.length > Keuangan.defaultLimit
        ? `<button type="button" class="btn btn-white btn-sm" onclick="Keuangan.ringkasTampil()"><i class="fa-solid fa-compress"></i> Ringkas (${Keuangan.defaultLimit})</button>`
        : "")
      + `</div>`;
  },

  bacaFilter() {
    const baru = {
      q: document.getElementById("filterQ").value || "",
      jenis: document.getElementById("filterJenis").value || "",
      kategori: document.getElementById("filterKategori").value || "",
      divisi: document.getElementById("filterDivisi").value || "",
      periode: document.getElementById("filterPeriode").value || "",
      sort: document.getElementById("filterSort").value || "baru",
    };
    const lama = Keuangan.filter;
    // Scope server berubah -> fetch ulang dari halaman 1 (ketikan di-debounce).
    // Cuma sort yang berubah -> render ulang saja (tanpa fetch).
    const scopeBerubah = ["q", "jenis", "kategori", "divisi", "periode"]
      .some((k) => (baru[k] || "") !== (lama[k] || ""));
    Keuangan.filter = baru;
    Keuangan.sinkronKontrolFilter();
    if (!scopeBerubah) { Keuangan.render(); return; }
    try { clearTimeout(Keuangan._filterT); } catch {}
    if (baru.q) Keuangan._filterT = setTimeout(() => { Keuangan.muat(true); }, 400);
    else Keuangan.muat(true);
  },

  resetFilter() {
    [
      "filterQ",
      "filterJenis",
      "filterKategori",
      "filterDivisi",
      "filterPeriode",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const fs = document.getElementById("filterSort");
    if (fs) fs.value = "baru";
    Keuangan.segarkanDropdown();
    Keuangan.bacaFilter();
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
      ks.innerHTML = list
        .map((c) => `<option value="${c}">${c}</option>`)
        .join("");
      if (list.includes(cur)) ks.value = cur;
      Keuangan.segarkanDropdown();
    }
    if (typeof FormPersist !== "undefined") FormPersist.touch("kasForm");
  },

  // Sembunyikan tombol aksi kalau tidak punya kendali atas halaman ini
  terapkanAkses() {
    const boleh = OsisAuth.bisa("keuangan");
    ["btnTambahKas", "btnEditDariDetail", "btnHapusDariDetail"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = boleh ? "" : "none";
      },
    );
  },

  bukaForm() {
    if (!OsisAuth.butuh("keuangan")) return;
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
    document.getElementById("kasAgenda").value = "";
    document.getElementById("kasCatatan").value = "";
    const fi = document.getElementById("kasBukti");
    if (fi) fi.value = "";
    document.getElementById("kasFormTitle").textContent = "Tambah Transaksi";
    Keuangan.renderBukti();
    // Pulihkan draft kalau ada (tutup form / refresh tidak sengaja). Foto tidak ikut.
    try {
      const d =
        typeof FormPersist !== "undefined" ? FormPersist.load("kasForm") : null;
      const adaIsi =
        d &&
        (String(d.kasKeterangan || "").trim() ||
          String(d.kasNominal || "").trim() ||
          String(d.kasPic || "").trim() ||
          String(d.kasCatatan || "").trim());
      if (adaIsi) {
        if (d.jenis) Keuangan.setJenis(d.jenis);
        FormPersist.fillFields(d);
        if (typeof formatRupiah === "function") formatRupiah(document.getElementById("kasNominal"));
      }
    } catch {}
    document.getElementById("kasForm").classList.add("open");
    document.body.style.overflow = "hidden";
    Keuangan.segarkanDropdown();
  },

  edit(id) {
    if (!OsisAuth.butuh("keuangan")) return;
    const item = Keuangan.cache.find((t) => String(t.id) === String(id));
    if (!item) return;
    Keuangan.editingId = id;
    Keuangan.stagedFile = null;
    Keuangan._revokeStaged();
    Keuangan.existingBukti = item.bukti_path || "";
    document.getElementById("kasId").value = id;
    Keuangan.setJenis(item.jenis === "masuk" ? "masuk" : "keluar");
    const ks = document.getElementById("kasKategori");
    if (
      ks &&
      item.kategori &&
      ![...ks.options].some((o) => o.value === item.kategori)
    ) {
      const op = document.createElement("option");
      op.value = item.kategori;
      op.textContent = item.kategori;
      ks.appendChild(op);
    }
    document.getElementById("kasTanggal").value = item.tanggal || "";
    document.getElementById("kasNominal").value = item.nominal ?? "";
    if (typeof formatRupiah === "function") formatRupiah(document.getElementById("kasNominal"));
    document.getElementById("kasKeterangan").value = item.keterangan || "";
    if (ks) ks.value = item.kategori || "Lainnya";
    const dv = document.getElementById("kasDivisi");
    if (dv) {
      if (
        item.divisi &&
        ![...dv.options].some((o) => o.value === item.divisi)
      ) {
        const op = document.createElement("option");
        op.value = item.divisi;
        op.textContent = item.divisi;
        dv.appendChild(op);
      }
      dv.value = item.divisi || "";
    }
    document.getElementById("kasPic").value = item.pic || "";
    document.getElementById("kasAgenda").value = item.agenda_id || "";
    document.getElementById("kasCatatan").value = item.catatan || "";
    const fi = document.getElementById("kasBukti");
    if (fi) fi.value = "";
    document.getElementById("kasFormTitle").textContent = "Edit Transaksi";
    Keuangan.renderBukti();
    Keuangan.segarkanDropdown();
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
    if (Keuangan.stagedUrl) {
      try {
        URL.revokeObjectURL(Keuangan.stagedUrl);
      } catch {}
    }
    Keuangan.stagedUrl = null;
  },

  renderBukti() {
    const drop = document.getElementById("kasDrop");
    const inner = document.getElementById("kasDropInner");
    if (!drop) return;
    drop.querySelectorAll("img").forEach((i) => i.remove());
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
      nominal: (typeof parseRupiah === "function"
        ? parseRupiah(document.getElementById("kasNominal").value)
        : parseInt(document.getElementById("kasNominal").value, 10) || 0),
      divisi: v("kasDivisi"),
      pic: v("kasPic"),
      proker_id: null,
      agenda_id: num("kasAgenda"),
      catatan: v("kasCatatan"),
    };
  },

  async simpan() {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") {
      showPopup("Cuma OSIS", "error");
      return;
    }
    if (!OsisAuth.butuh("keuangan")) return;
    const f = Keuangan.kumpulkanForm();
    const id = document.getElementById("kasId").value
      ? parseInt(document.getElementById("kasId").value, 10)
      : null;
    if (!f.tanggal) {
      showToast("Tanggal wajib diisi", "error");
      return;
    }
    if (!f.keterangan) {
      showToast("Keterangan wajib diisi", "error");
      return;
    }
    if (!f.nominal || f.nominal <= 0) {
      showToast("Nominal harus lebih dari 0", "error");
      return;
    }

    const __spec = () => ({ modul: "keuangan", op: id ? "update" : "create",
      label: (f.jenis === "keluar" ? "Kas keluar: " : "Kas masuk: ") + String(f.keterangan || "").slice(0, 40),
      payload: { id: id || null, f, existingBukti: Keuangan.existingBukti || "" },
      files: Keuangan.stagedFile ? [{ slot: "bukti", file: Keuangan.stagedFile, name: Keuangan.stagedFile.name, type: Keuangan.stagedFile.type }] : [],
      cacheKeys: ["kas"] });
    const __sesudahAntre = () => {
      if (typeof FormPersist !== "undefined") FormPersist.clear("kasForm");
      Keuangan.tutupForm();
    };
    if (typeof Outbox !== "undefined" && Outbox.offline()) {
      try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
      Outbox.sesudahAntre(__sesudahAntre);
      return;
    }

    const btn = document.getElementById("btnSimpanKas");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    }
    try {
      let bukti = Keuangan.existingBukti || "";
      if (Keuangan.stagedFile) {
        const fl = Keuangan.stagedFile;
        const ext = (fl.name.split(".").pop() || "jpg").toLowerCase();
        const path = `kas/kas-${u.id}-${Date.now()}.${ext}`;
        await uploadFotoStorage(fl, path);
        if (bukti && bukti !== path) {
          try {
            await hapusFotoStorage(bukti);
          } catch {}
        }
        bukti = path;
      }
      f.bukti_path = bukti;
      if (id) {
        await updateKas(u.id, id, f);
        showToast("Transaksi diperbarui! Saldo otomatis update.", "success");
        catatAksi("simpan_keuangan", "edit " + String(f.keterangan || "").slice(0, 60));
      } else {
        const newId = await buatKas(u.id, f);
        if (!newId || newId <= 0)
          throw new Error("Gagal simpan (" + newId + ")");
        showToast("Transaksi tersimpan! Saldo otomatis update.", "success");
        catatAksi("simpan_keuangan", String(f.keterangan || "").slice(0, 60) + " " + Keuangan.rp(f.nominal));
      }
      if (typeof FormPersist !== "undefined") FormPersist.clear("kasForm");
      Keuangan.tutupForm();
      await Keuangan.muat();
    } catch (err) {
      console.error(err);
      if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
        Outbox.sesudahAntre(__sesudahAntre);
        return;
      }
      showToast("Gagal simpan: " + err.message, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
      }
    }
  },

  async hapus(id, dariDetail) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    if (!OsisAuth.butuh("keuangan")) return;
    const item = Keuangan.cache.find((t) => String(t.id) === String(id));
    const yakin = await showPopup(
      `Hapus transaksi "${item ? item.keterangan : ""}" (${item ? Keuangan.rp(item.nominal) : ""})? Saldo ikut berubah.`,
      "confirm",
    );
    if (!yakin) return;
    try {
      await hapusKas(u.id, id);
      if (item && item.bukti_path) {
        try {
          await hapusFotoStorage(item.bukti_path);
        } catch {}
      }
      if (dariDetail) Keuangan.tutupDetail();
      showToast("Transaksi dihapus, saldo diperbarui", "success");
      catatAksi("hapus_keuangan", String((item && item.keterangan) || "").slice(0, 60));
      await Keuangan.muat();
    } catch (err) {
      console.error(err);
      showPopup("Gagal hapus: " + err.message, "error");
    }
  },

  // ============ DETAIL ============
  detail(id) {
    const t = Keuangan.cache.find((x) => String(x.id) === String(id));
    if (!t) return;
    Keuangan.detailId = id;
    const masuk = t.jenis === "masuk";
    const info = (k, v) =>
      `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
    document.getElementById("kasDetailBody").innerHTML = `
            <h4 style="font-size:1rem; font-weight:900; overflow-wrap:anywhere">${escapeHtml(t.keterangan || "Tanpa keterangan")}</h4>
            <div style="margin:6px 0 2px; display:flex; gap:6px; align-items:center; flex-wrap:wrap">
                <span class="jenis ${t.jenis}">${masuk ? "Pemasukan" : "Pengeluaran"}</span>
                <span class="nominal ${t.jenis}" style="font-size:1.1rem">${masuk ? "+" : "-"} ${Keuangan.rp(t.nominal)}</span>
            </div>
            <div class="detail-info">
                ${info("Tanggal", Keuangan.fmtTanggal(t.tanggal))}
                ${info("Kategori", escapeHtml(t.kategori))}
                ${info("Divisi", escapeHtml(t.divisi))}
                ${info("PIC", escapeHtml(t.pic))}
                ${info("Agenda", escapeHtml(t.agenda_id ? Keuangan.agendaName(t.agenda_id) : ""))}
                ${info("Dibuat", Keuangan.fmtTanggalWaktu(t.created_at))}
                ${info("Diupload oleh", escapeHtml(t.pengunggah || "-"))}
                ${info("Diubah", Keuangan.fmtTanggalWaktu(t.updated_at))}
            </div>
            ${t.catatan ? `<div class="detail-text">${escapeHtml(t.catatan)}</div>` : ""}
            ${t.bukti_path ? `<div class="detail-sec" style="margin-top:10px"><h5 style="font-size:.72rem; font-weight:900; letter-spacing:.06em; text-transform:uppercase; color:var(--red)">Bukti Transaksi</h5><div class="bukti-box media-muat media-muat-tinggi"><img src="${getFoto(t.bukti_path)}" alt="Bukti" loading="lazy" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')" onclick="Home && Home.bukaFotoPopup && Home.bukaFotoPopup(this, 'Bukti transaksi', '')"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span></div></div>` : ""}`;
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
    const t = Keuangan.cache.find(
      (x) => String(x.id) === String(Keuangan.detailId),
    );
    if (!t || !t.bukti_path) {
      showToast("Tidak ada bukti", "info");
      return;
    }
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
  isiLaporan(baris) {
    const data = baris || Keuangan.dataTampil();
    const f = Keuangan.filter;
    const masuk = data
      .filter((t) => t.jenis === "masuk")
      .reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
    const keluar = data
      .filter((t) => t.jenis === "keluar")
      .reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
    const judul = f.periode ? `Periode ${f.periode}` : "Semua Periode";
    const esc = (s) => escapeHtml(s || "-");
    return `
            <div style="font-family:Arial,Helvetica,sans-serif; color:#111; max-width:700px; margin:0 auto">
                <div style="text-align:center; border-bottom:3px solid #111; padding-bottom:10px; margin-bottom:14px">
                    <div style="font-size:18px; font-weight:900">LAPORAN KEUANGAN OSIS</div>
                    <div style="font-size:12px">SMK Taruna Harapan 1 Cipatat - ${judul}</div>
                </div>
                <table style="font-size:13px; margin-bottom:12px">
                    <tr><td>Total Pemasukan (${data.filter((t) => t.jenis === "masuk").length})</td><td style="text-align:right"><b>${Keuangan.rp(masuk)}</b></td></tr>
                    <tr><td>Total Pengeluaran (${data.filter((t) => t.jenis === "keluar").length})</td><td style="text-align:right"><b>${Keuangan.rp(keluar)}</b></td></tr>
                    <tr><td><b>Saldo Akhir</b></td><td style="text-align:right"><b>${Keuangan.rp(masuk - keluar)}</b></td></tr>
                </table>
                <table border="1" cellspacing="0" cellpadding="6" style="width:100%; font-size:12px; border-collapse:collapse">
                    <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Jenis</th><th>Kategori</th><th>Nominal</th></tr></thead>
                    <tbody>${data.map((t) => `<tr><td>${Keuangan.fmtTanggal(t.tanggal)}</td><td>${esc(t.keterangan)}</td><td>${t.jenis === "masuk" ? "Masuk" : "Keluar"}</td><td>${esc(t.kategori)}</td><td style="text-align:right">${t.jenis === "masuk" ? "+" : "-"}${Keuangan.rp(t.nominal)}</td></tr>`).join("") || `<tr><td colspan="5">Tidak ada transaksi.</td></tr>`}</tbody>
                </table>
                <p style="font-size:11px; color:#666; margin-top:12px">Dicetak ${new Date().toLocaleString("id-ID")} dari website OSIS Tarpan One.</p>
            </div>`;
  },

  async cetak() {
    document.getElementById("printArea").innerHTML = Keuangan.isiLaporan(await Keuangan.barisLaporan());
    window.print();
  },

  async exportPdf() {
    document.getElementById("printArea").innerHTML = Keuangan.isiLaporan(await Keuangan.barisLaporan());
    const oldTitle = document.title;
    const f = Keuangan.filter;
    document.title = `Laporan-Keuangan-${f.periode || "semua"}`;
    showToast("Pilih 'Save as PDF' di dialog print", "info");
    window.print();
    setTimeout(() => {
      document.title = oldTitle;
    }, 500);
  },
};

document.addEventListener("DOMContentLoaded", () => Keuangan.init());
