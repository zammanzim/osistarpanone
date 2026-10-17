// =========================================================================
// KEUANGAN - halaman khusus OSIS (folder /osis)
// Dipakai di osis2/keuangan.html - kas masuk/keluar, saldo = masuk - keluar (dihitung client). Bukti foto drag & drop folder kas/.
// Export/cetak laporan via print CSS. Visual ikut design system Agenda.
// =========================================================================

const Keuangan = {
  cache: [],
  prokerCache: [],
  agendaCache: [],
  // Paging hemat egress: 20/halaman + sentinel. Statistik/rekap TIDAK dari
  // cache parsial melainkan RPC ringkas (benar walau belum discroll habis).
  offset: 0,
  habis: false,
  loading: false,
  perPage: 20,
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
          "kasProker",
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

  prokerName(id) {
    if (!id) return "";
    const p = (Keuangan.prokerCache || []).find(
      (x) => String(x.id) === String(id),
    );
    return p ? p.nama : `#${id} (dihapus)`;
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
        // Render cache persisten DULU (hanya bila tanpa filter) biar offline langsung tampil.
        if (Keuangan.scopeKosong()) {
          const cached = Cache.get("kas");
          if (cached) {
            Keuangan.prokerCache = Cache.get("proker") || [];
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
      // Lookup proker/agenda tetap full (kecil) buat opsi form + tampilan nama.
      try {
        const [pk, ag] = await Promise.all([
          getProker().catch(() => null),
          getAllAgenda().catch(() => null),
        ]);
        if (pk) { Keuangan.prokerCache = pk; try { Cache.set("proker", pk); } catch {} }
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
    const tp = document.getElementById("kasProker");
    if (tp) {
      tp.innerHTML =
        `<option value="">- Tidak ada -</option>` +
        (Keuangan.prokerCache || [])
          .map(
            (p) =>
              `<option value="${p.id}">${escapeHtml(p.nama || "Tanpa nama")}</option>`,
          )
          .join("");
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
    const nTrans = R && R.n != null ? R.n : data.length;
    const saldo = masuk - keluar;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set("saldoAkhir", Keuangan.rp(saldo));
    set("rumusMasuk", "+ " + Keuangan.rp(masuk));
    set("rumusKeluar", "- " + Keuangan.rp(keluar));
    set(
      "saldoPeriodeLbl",
      f.periode ? `· Periode ${f.periode}` : "· Semua periode",
    );
    set("statMasuk", Keuangan.rp(masuk));
    set("statKeluar", Keuangan.rp(keluar));
    set("statCount", nTrans + " transaksi");
    set(
      "statSelisih",
      (masuk - keluar < 0 ? "- " : "") + Keuangan.rp(Math.abs(masuk - keluar)),
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
              month: "long",
              year: "numeric",
            });
          } catch {
            return ym;
          }
        };
        rb.innerHTML = keys
          .map((ym) => {
            const b = byBulan[ym];
            return `<div class="rekap-row">
                        <div class="top"><span>${namaBulan(ym)}</span><small>Selisih ${Keuangan.rp(b.masuk - b.keluar)}</small></div>
                        <div class="top"><small>Masuk ${Keuangan.rp(b.masuk)}</small></div>
                        <div class="bar masuk"><span style="width:${Math.round((b.masuk / max) * 100)}%"></span></div>
                        <div class="top" style="margin-top:4px"><small>Keluar ${Keuangan.rp(b.keluar)}</small></div>
                        <div class="bar keluar"><span style="width:${Math.round((b.keluar / max) * 100)}%"></span></div>
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

    // rekap proker (dari RPC bila ada, fallback cache full)
    const pc = document.getElementById("prokerCard");
    if (pc) {
      const byProker = {};
      if (R && Array.isArray(R.per_proker)) {
        R.per_proker.forEach((b) => {
          if (!b || b.proker_id == null) return;
          byProker[String(b.proker_id)] = { masuk: parseInt(b.masuk, 10) || 0, keluar: parseInt(b.keluar, 10) || 0 };
        });
      } else {
        (Keuangan.cache || []).forEach((t) => {
          if (!t.proker_id) return;
          const k = String(t.proker_id);
          if (!byProker[k]) byProker[k] = { masuk: 0, keluar: 0 };
          byProker[k][t.jenis === "masuk" ? "masuk" : "keluar"] +=
            parseInt(t.nominal, 10) || 0;
        });
      }
      const pkeys = Object.keys(byProker);
      if (!pkeys.length) {
        pc.style.display = "none";
      } else {
        pc.style.display = "";
        document.getElementById("prokerBody").innerHTML = pkeys
          .map((k) => {
            const b = byProker[k];
            return `<div class="rekap-row">
                        <div class="top"><span>${escapeHtml(Keuangan.prokerName(k))}</span><small>Sisa ${Keuangan.rp(b.masuk - b.keluar)}</small></div>
                        <div class="top"><small>Masuk ${Keuangan.rp(b.masuk)} · Keluar ${Keuangan.rp(b.keluar)}</small></div>
                    </div>`;
          })
          .join("");
      }
    }

    // tabel
    const wrap = document.getElementById("kasWrap");
    if (!wrap) return;
    if (!(Keuangan.cache || []).length) {
      wrap.innerHTML = `      <div class="pesan-empty" style="text-align:center; padding:26px 12px"><div
          style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-wallet"
          style="color:var(--red)"></i></div><b>Belum ada transaksi</b><p style="font-size:0.8rem; color:var(--gray);
          margin:6px 0 12px">Tambahkan transaksi pertama untuk mulai mencatat keuangan OSIS.</p>${OsisAuth.bisa("keuangan") ? `<button class="btn
           btn-red btn-sm" onclick="Keuangan.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah
           Transaksi</button>` : ""}</div>`;
      return;
    }
    if (!data.length) {
      wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Keuangan.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
      return;
    }
    wrap.innerHTML = `<table class="kas-tabel"><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Jenis</th><th>Kategori</th><th>Nominal</th></tr></thead><tbody>${data
      .map(
        (t) => `
            <tr data-kas-row="${t.id}">
                <td style="white-space:nowrap">${Keuangan.fmtTanggal(t.tanggal)}</td>
                <td><b>${escapeHtml(t.keterangan || "Tanpa keterangan")}</b><br><small style="color:var(--gray)">${escapeHtml(t.pic || "-")} ${olehLabel(t)}</small></td>
                <td><span class="jenis ${t.jenis}">${t.jenis === "masuk" ? "Pemasukan" : "Pengeluaran"}</span></td>
                <td>${escapeHtml(t.kategori || "-")}</td>
                <td class="nominal ${t.jenis}">${t.jenis === "masuk" ? "+" : "-"} ${Keuangan.rp(t.nominal)}</td>
            </tr>`,
      )
      .join("")}</tbody></table>`
      + `<div style="text-align:center; padding:12px 4px">`
      + (Keuangan.habis
        ? `<small style="color:var(--gray); font-weight:700">— Semua transaksi sudah dimuat —</small>`
        : `<button class="btn btn-white btn-sm" onclick="Keuangan.muat(false)"><i class="fa-solid fa-angles-down"></i> Muat lagi</button>`)
      + `</div><div id="kasSentinel" style="height:8px"></div>`;
    let io = null;
    try { if (typeof pasangSentinel === "function") io = pasangSentinel("kasSentinel", () => Keuangan.muat(false)); } catch {}
    if (!io) { const s = document.getElementById("kasSentinel"); if (s) s.style.display = "none"; }
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
      document.getElementById(id).value = "";
    });
    document.getElementById("filterSort").value = "baru";
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
    document.getElementById("kasProker").value = "";
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
      proker_id: num("kasProker"),
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
                ${info("Program Kerja", escapeHtml(t.proker_id ? Keuangan.prokerName(t.proker_id) : ""))}
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
