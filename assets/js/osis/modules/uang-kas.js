// =========================================================================
// UANG KAS MINGGUAN — halaman khusus OSIS (osis/uang-kas.html)
// List per anggota -> klik buka progress mingguan + riwayat setoran.
// Setoran masuk otomatis dialokasikan ke minggu aktif terlama yang belum
// lunas (FIFO) dan otomatis menceklis minggu yang terpenuhi.
// Mendukung tarif bebas, riwayat perubahan tarif, dan minggu libur.
// =========================================================================

const UangKas = {
  roster: [],
  periodeTahun: [],
  setoran: [],
  config: null,
  namaSaya: [],
  filter: { q: "", status: "semua", sort: "nama", tahun: null },
  defaultLimit: 5,
  tampilLimit: 5,
  stepLimit: 10,
  detailNama: "",
  editingId: null,
  namaQ: "",
  draftLibur: new Set(),
  _initialTarif: 2000,

  async init() {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") {
      location.replace("../login");
      return;
    }
    try { await OsisAuth.refreshAkses(); } catch {}
    UangKas.terapkanAkses();

    document.getElementById("btnTambahSetor")?.addEventListener("click", () => UangKas.bukaSetor());
    document.getElementById("btnAturKas")?.addEventListener("click", () => UangKas.bukaSetting());
    document.getElementById("btnResetFilter")?.addEventListener("click", () => UangKas.resetFilter());

    document.getElementById("filterQ")?.addEventListener("input", () => UangKas.bacaFilter());
    document.getElementById("btnClearQ")?.addEventListener("click", () => {
      const q = document.getElementById("filterQ");
      if (q) q.value = "";
      UangKas.bacaFilter();
    });
    document.getElementById("filterSort")?.addEventListener("change", () => UangKas.bacaFilter());
    document.getElementById("filterTahun")?.addEventListener("change", (e) => {
      UangKas.filter.tahun = parseInt(e.target.value, 10) || null;
      UangKas.tampilLimit = UangKas.defaultLimit;
      UangKas.render();
    });
    document.getElementById("ukFilterChips")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-uk-status]");
      if (!btn) return;
      UangKas.filter.status = btn.dataset.ukStatus || "semua";
      UangKas.tampilLimit = UangKas.defaultLimit;
      UangKas.render();
    });
    document.getElementById("filterChips")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-clear-filter]");
      if (!b) return;
      const key = b.dataset.clearFilter;
      if (key === "q") {
        const q = document.getElementById("filterQ");
        if (q) q.value = "";
        UangKas.filter.q = "";
      } else if (key === "status") {
        UangKas.filter.status = "semua";
      } else if (key === "sort") {
        const s = document.getElementById("filterSort");
        if (s) s.value = "nama";
        UangKas.filter.sort = "nama";
        UangKas.segarkanDropdown();
      }
      UangKas.tampilLimit = UangKas.defaultLimit;
      UangKas.render();
    });
    document.getElementById("ukSideRoster")?.addEventListener("click", (e) => {
      const item = e.target.closest("[data-uk-orang]");
      if (item) UangKas.bukaDetail(decodeURIComponent(item.dataset.ukOrang || ""));
    });
    document.getElementById("ukRuleBody")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-uk-open-setting]")) UangKas.bukaSetting();
    });

    document.getElementById("ukListWrap")?.addEventListener("click", (e) => {
      const quick = e.target.closest("[data-uk-quick]");
      if (quick) {
        e.stopPropagation();
        UangKas.bukaSetor(decodeURIComponent(quick.dataset.ukQuick || ""));
        return;
      }
      const card = e.target.closest("[data-uk-orang]");
      if (card) UangKas.bukaDetail(decodeURIComponent(card.dataset.ukOrang || ""));
    });
    document.getElementById("ukListWrap")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("[data-uk-quick]")) return;
      const card = e.target.closest("[data-uk-orang]");
      if (!card) return;
      e.preventDefault();
      UangKas.bukaDetail(decodeURIComponent(card.dataset.ukOrang || ""));
    });

    document.getElementById("btnDetSetor")?.addEventListener("click", () => {
      if (UangKas.detailNama) UangKas.bukaSetor(UangKas.detailNama);
    });
    document.getElementById("ukDetWeeks")?.addEventListener("click", (e) => {
      const w = e.target.closest("[data-uk-week-target]");
      if (!w || !UangKas.bolehKelola() || !UangKas.detailNama) return;
      const butuh = parseInt(w.dataset.ukWeekKurang || "0", 10) || 0;
      UangKas.bukaSetor(UangKas.detailNama, butuh > 0 ? butuh : null);
    });
    document.getElementById("ukDetHistory")?.addEventListener("click", (e) => {
      const ed = e.target.closest("[data-uk-edit]");
      if (ed) { UangKas.editSetor(ed.dataset.ukEdit); return; }
      const del = e.target.closest("[data-uk-del]");
      if (del) UangKas.hapusSetor(del.dataset.ukDel);
    });

    // Modal Setoran
    document.getElementById("btnBatalSetor")?.addEventListener("click", () => UangKas.tutupSetor());
    document.getElementById("btnSimpanSetor")?.addEventListener("click", () => UangKas.simpanSetor());
    document.getElementById("ukNamaSearch")?.addEventListener("input", () => {
      UangKas.namaQ = document.getElementById("ukNamaSearch").value || "";
      UangKas.renderNamaList();
    });
    document.getElementById("ukNamaListBox")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pilih-nama]");
      if (b) UangKas.pilihNama(decodeURIComponent(b.dataset.pilihNama || ""));
    });
    if (typeof ikatRupiah === "function") ikatRupiah("ukSetorNominal");
    document.getElementById("ukSetorNominal")?.addEventListener("input", () => UangKas.renderAutoPreview());
    document.getElementById("ukNomChips")?.addEventListener("click", (e) => {
      const ch = e.target.closest("[data-nom-val]");
      if (!ch) return;
      const el = document.getElementById("ukSetorNominal");
      if (!el) return;
      el.value = String(parseInt(ch.dataset.nomVal, 10) || 0);
      if (typeof formatRupiah === "function") formatRupiah(el);
      UangKas.renderAutoPreview();
    });

    // Modal Pengaturan
    document.getElementById("btnBatalSetting")?.addEventListener("click", () => UangKas.tutupSetting());
    document.getElementById("btnSimpanSetting")?.addEventListener("click", () => UangKas.simpanSetting());
    if (typeof ikatRupiah === "function") ikatRupiah("ukCfgNominal");
    document.getElementById("ukCfgNominal")?.addEventListener("input", () => UangKas.cekPerubahanTarif());
    document.getElementById("ukCfgMulai")?.addEventListener("change", () => {
      UangKas.renderCfgMulaiInfo();
      UangKas.renderLiburGrid();
    });
    document.getElementById("ukCfgLiburGrid")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-libur-senin]");
      if (!btn) return;
      const s = btn.dataset.liburSenin;
      if (!s) return;
      if (UangKas.draftLibur.has(s)) UangKas.draftLibur.delete(s);
      else UangKas.draftLibur.add(s);
      UangKas.renderLiburGrid();
    });
    document.getElementById("btnTambahLiburDate")?.addEventListener("click", () => {
      const el = document.getElementById("ukCfgLiburDate");
      const val = (el && el.value) || "";
      if (!val) { showToast("Pilih tanggal di minggu yang mau diliburkan.", "error"); return; }
      const s = UangKas.seninDari(val);
      if (s) {
        UangKas.draftLibur.add(s);
        if (el) el.value = "";
        UangKas.renderLiburGrid();
      }
    });

    ["ukDetailModal", "ukSetorModal", "ukSettingModal"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", (e) => {
        if (e.target.id !== id) return;
        if (id === "ukSettingModal") UangKas.tutupSetting();
        else if (id === "ukSetorModal") UangKas.tutupSetor();
        else UangKas.tutupDetail();
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (document.getElementById("ukSettingModal")?.classList.contains("open")) { UangKas.tutupSetting(); return; }
      if (document.getElementById("ukSetorModal")?.classList.contains("open")) { UangKas.tutupSetor(); return; }
      if (document.getElementById("ukDetailModal")?.classList.contains("open")) UangKas.tutupDetail();
    });

    UangKas.muatNamaSaya();
    await UangKas.muat();
  },

  // ============ HAK AKSES ============
  bolehKelola() {
    try {
      return !!OsisAuth.bisa("uang-kas");
    } catch { return false; }
  },

  butuhKelola() {
    if (UangKas.bolehKelola()) return true;
    showToast("Hanya pemegang akses Uang Kas yang bisa mengubah data.", "error");
    return false;
  },

  terapkanAkses() {
    const boleh = UangKas.bolehKelola();
    const acts = document.getElementById("ukHeroActs");
    if (acts) acts.style.display = boleh ? "" : "none";
    const detBtn = document.getElementById("btnDetSetor");
    if (detBtn) detBtn.style.display = boleh ? "" : "none";
  },

  // ============ TANGGAL & FORMAT (WIB-safe) ============
  norm(s) {
    return String(s || "").trim().toLowerCase();
  },

  rp(n) {
    return "Rp" + (parseInt(n, 10) || 0).toLocaleString("id-ID");
  },

  hariIni() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  },

  parseYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
  },

  fmtYmd(d) {
    const p = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  },

  tambahHari(ymd, n) {
    const d = UangKas.parseYmd(ymd);
    if (!d) return ymd;
    return UangKas.fmtYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  },

  seninDari(ymd) {
    const d = UangKas.parseYmd(ymd);
    if (!d) return "";
    const mundur = (d.getDay() + 6) % 7;
    return UangKas.fmtYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - mundur));
  },

  fmtPendek(ymd) {
    const d = UangKas.parseYmd(ymd);
    if (!d) return ymd || "-";
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
  },

  fmtRentang(seninYmd) {
    const mingguYmd = UangKas.tambahHari(seninYmd, 6);
    const a = UangKas.parseYmd(seninYmd);
    const b = UangKas.parseYmd(mingguYmd);
    if (!a || !b) return seninYmd;
    const p = (x) => String(x).padStart(2, "0");
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
      return `${p(a.getDate())}–${p(b.getDate())} ${b.toLocaleDateString("id-ID", { month: "short" })}`;
    }
    return `${UangKas.fmtPendek(seninYmd)}–${UangKas.fmtPendek(mingguYmd)}`;
  },

  fmtSlash(ymd) {
    const d = UangKas.parseYmd(ymd);
    if (!d) return ymd || "-";
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  },

  fmtBulanTahun(ymd) {
    const d = UangKas.parseYmd(ymd);
    if (!d) return "Lainnya";
    return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  },

  // ============ IDENTITAS SAYA ============
  async muatNamaSaya() {
    const set = new Set();
    const tambah = (n) => { n = UangKas.norm(n); if (n) set.add(n); };
    try {
      const u = OsisAuth.getUser ? OsisAuth.getUser() : null;
      if (u) tambah(u.nama);
    } catch {}
    try {
      const [a, p] = await Promise.all([
        (typeof getAnggotaSaya === "function" ? getAnggotaSaya() : Promise.resolve(null)).catch(() => null),
        (typeof getPengurusSaya === "function" ? getPengurusSaya() : Promise.resolve(null)).catch(() => null),
      ]);
      if (a) tambah(a.nama);
      if (p) tambah(p.nama);
    } catch {}
    UangKas.namaSaya = [...set];
    try { UangKas.render(); } catch {}
  },

  milikSaya(nama) {
    const k = UangKas.norm(nama);
    return !!k && (UangKas.namaSaya || []).includes(k);
  },

  // ============ DATA & CONFIG ============
  angKey(suffix) {
    const angId = (typeof DbScope !== "undefined" && DbScope.angkatanId) ? (DbScope.angkatanId() || 0) : 0;
    return `uang_kas_${suffix}_ang_${angId}`;
  },

  defaultConfig() {
    return {
      nominal_mingguan: 2000,
      tanggal_mulai: UangKas.seninDari(UangKas.tambahHari(UangKas.hariIni(), -21)),
      minggu_libur: [],
      tarif_riwayat: [],
      catatan: "",
    };
  },

  normalConfig(raw) {
    const def = UangKas.defaultConfig();
    const r = raw && typeof raw === "object" ? raw : {};
    const nom = parseInt(r.nominal_mingguan, 10);
    const mulai = UangKas.seninDari(r.tanggal_mulai) || def.tanggal_mulai;
    const liburArr = Array.isArray(r.minggu_libur) ? r.minggu_libur : [];
    const libur = [...new Set(liburArr.map((x) => UangKas.seninDari(x)).filter(Boolean))].sort();
    const riwRaw = Array.isArray(r.tarif_riwayat) ? r.tarif_riwayat : [];
    const riwMap = new Map();
    riwRaw.forEach((it) => {
      if (!it || typeof it !== "object") return;
      const m = UangKas.seninDari(it.mulai);
      const n = parseInt(it.nominal, 10);
      if (m && n > 0) riwMap.set(m, n);
    });
    const riw = [...riwMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mulaiKey, nominalVal]) => ({ mulai: mulaiKey, nominal: nominalVal }));
    return {
      nominal_mingguan: nom > 0 ? nom : def.nominal_mingguan,
      tanggal_mulai: mulai,
      minggu_libur: libur,
      tarif_riwayat: riw,
      catatan: String(r.catatan || "").trim(),
    };
  },

  isTabelBelumAda(err) {
    const msg = String((err && err.message) || err || "");
    const code = String((err && err.code) || "");
    return code === "42P01" || code === "PGRST205" || /osis_uang_kas|schema cache|relation .* does not exist|could not find the table|function .* does not exist|PGRST202|42883/i.test(msg);
  },

  async fetchConfigLive() {
    const { data, error } = await DbScope.queryAngkatan((angId) => {
      let q = supa
        .from("osis_uang_kas_config")
        .select("angkatan_id, nominal_mingguan, tanggal_mulai, minggu_libur, tarif_riwayat, catatan, updated_at")
        .limit(1);
      if (angId) q = q.eq("angkatan_id", angId);
      return q;
    });
    if (error) throw error;
    return (data && data[0]) ? UangKas.normalConfig(data[0]) : UangKas.defaultConfig();
  },

  async fetchSetoranLive() {
    const { data, error } = await DbScope.queryAngkatan((angId) => {
      let q = supa
        .from("osis_uang_kas_setoran")
        .select("id, nama, tanggal, nominal, catatan, created_by, pengunggah, created_at, updated_at" + (angId ? ", angkatan_id" : ""))
        .order("tanggal", { ascending: false })
        .order("id", { ascending: false });
      if (angId) q = q.eq("angkatan_id", angId);
      return q;
    });
    if (error) throw error;
    return data || [];
  },

  async muat() {
    const angId = DbScope.angkatanId();
    // 1) Roster anggota + periode (tabel sudah ada)
    try {
      const cachedAng = Cache.get(UangKas.angKey("roster"));
      if (cachedAng) UangKas.pakaiRoster(cachedAng.anggota, cachedAng.periode);
      const [ang, per] = await Promise.all([
        (typeof getAnggota === "function" ? getAnggota(angId) : Promise.resolve([])).catch(() => []),
        (typeof getPeriode === "function" ? getPeriode() : Promise.resolve([])).catch(() => []),
      ]);
      if (ang && ang.length) {
        Cache.set(UangKas.angKey("roster"), { anggota: ang, periode: per });
        UangKas.pakaiRoster(ang, per);
      }
    } catch (e) { console.error(e); }

    // 2) Config + Setoran Uang Kas
    try {
      const cachedCfg = Cache.get(UangKas.angKey("cfg"));
      const cachedSet = Cache.get(UangKas.angKey("set"));
      if (cachedCfg && cachedSet) {
        UangKas.config = UangKas.normalConfig(cachedCfg);
        UangKas.setoran = cachedSet;
        UangKas.terapkanAkses();
        UangKas.render();
      }
      const [cfg, setoran] = await Promise.all([
        UangKas.fetchConfigLive(),
        UangKas.fetchSetoranLive(),
      ]);
      UangKas.config = cfg;
      UangKas.setoran = setoran;
      Cache.set(UangKas.angKey("cfg"), cfg);
      Cache.set(UangKas.angKey("set"), setoran);
    } catch (err) {
      console.error(err);
      if (!UangKas.config) UangKas.config = UangKas.defaultConfig();
      if (!UangKas.setoran) UangKas.setoran = [];
      showToast(
        UangKas.isTabelBelumAda(err)
          ? "Tabel uang kas belum dibuat di Supabase (jalankan database/migrations/migrasi-uang-kas.sql)."
          : "Gagal memuat uang kas: " + (err.message || err),
        "error",
      );
    }
    UangKas.terapkanAkses();
    UangKas.render();
    if (UangKas.detailNama && document.getElementById("ukDetailModal")?.classList.contains("open")) {
      UangKas.renderDetailModal();
    }
  },

  pakaiRoster(anggotaList, periodeList) {
    UangKas.periodeTahun = (periodeList || [])
      .filter((p) => p && p.aktif)
      .map((p) => parseInt(p.tahun, 10))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    const bersih = (anggotaList || []).filter((a) => a && String(a.nama || "").trim());
    const tahunSet = new Set(bersih.map((a) => parseInt(a.tahun, 10)).filter(Number.isFinite));
    const tahunArr = [...tahunSet].sort((a, b) => b - a);
    const wrapTahun = document.getElementById("filterTahunWrap");
    const selTahun = document.getElementById("filterTahun");
    if (tahunArr.length > 1 && selTahun && wrapTahun) {
      const angObj = OsisAuth.getAngkatanAktifObj ? OsisAuth.getAngkatanAktifObj() : null;
      const pref = angObj && angObj.tahun ? parseInt(angObj.tahun, 10) : null;
      if (!UangKas.filter.tahun || !tahunArr.includes(UangKas.filter.tahun)) {
        UangKas.filter.tahun = (pref && tahunArr.includes(pref)) ? pref : tahunArr[0];
      }
      selTahun.innerHTML = tahunArr.map((t) => `<option value="${t}" ${t === UangKas.filter.tahun ? "selected" : ""}>${t}</option>`).join("");
      wrapTahun.style.display = "";
    } else {
      UangKas.filter.tahun = tahunArr.length ? tahunArr[0] : null;
      if (wrapTahun) wrapTahun.style.display = "none";
    }
    UangKas.roster = bersih;
    UangKas.segarkanDropdown();
  },

  // ============ LOGIKA ALOKASI MINGGUAN (OTOMATIS CEKLIS) ============
  tarifPada(seninYmd, cfg) {
    const c = cfg || UangKas.config || UangKas.defaultConfig();
    const riw = Array.isArray(c.tarif_riwayat) ? c.tarif_riwayat : [];
    if (!riw.length) return c.nominal_mingguan || 2000;
    let pilih = riw[0].nominal;
    for (let i = 0; i < riw.length; i++) {
      if (riw[i].mulai <= seninYmd) pilih = riw[i].nominal;
      else break;
    }
    return pilih > 0 ? pilih : (c.nominal_mingguan || 2000);
  },

  // Hitung daftar minggu & status per minggu untuk 1 orang berdasarkan total nominal setoran.
  hitungProgres(nama, cfgOverride, setoranOverride) {
    const cfg = cfgOverride || UangKas.config || UangKas.defaultConfig();
    const rowsAll = setoranOverride || UangKas.setoran || [];
    const k = UangKas.norm(nama);
    const milik = rowsAll
      .filter((r) => UangKas.norm(r.nama) === k)
      .sort((a, b) => String(b.tanggal || "").localeCompare(String(a.tanggal || "")) || (Number(b.id) || 0) - (Number(a.id) || 0));
    const totalSetor = milik.reduce((s, r) => s + (parseInt(r.nominal, 10) || 0), 0);

    const mulai = UangKas.seninDari(cfg.tanggal_mulai) || UangKas.seninDari(UangKas.hariIni());
    const mingguIni = UangKas.seninDari(UangKas.hariIni());
    const liburSet = new Set((cfg.minggu_libur || []).map((x) => UangKas.seninDari(x)).filter(Boolean));

    const weeks = [];
    let sisa = totalSetor;
    let cur = mulai;
    let nomorAktif = 0;
    let guard = 0;

    while (guard < 208 && (cur <= mingguIni || sisa > 0)) {
      guard++;
      const isLibur = liburSet.has(cur);
      const isMasaDepan = cur > mingguIni;
      if (isLibur) {
        weeks.push({
          senin: cur,
          nomor: null,
          status: "libur",
          tarif: 0,
          terbayar: 0,
          kurang: 0,
          masaDepan: isMasaDepan,
        });
      } else {
        nomorAktif++;
        const tarif = UangKas.tarifPada(cur, cfg);
        const terbayar = Math.min(sisa, tarif);
        sisa -= terbayar;
        const kurang = Math.max(0, tarif - terbayar);
        let status = "belum";
        if (kurang === 0) status = isMasaDepan ? "dimuka" : "lunas";
        else if (terbayar > 0) status = "cicil";
        weeks.push({
          senin: cur,
          nomor: nomorAktif,
          status,
          tarif,
          terbayar,
          kurang,
          masaDepan: isMasaDepan,
        });
      }
      cur = UangKas.tambahHari(cur, 7);
    }

    const wajibKini = weeks.filter((w) => w.status !== "libur" && !w.masaDepan);
    const lunasKini = wajibKini.filter((w) => w.status === "lunas").length;
    const dimukaCount = weeks.filter((w) => w.masaDepan && w.status === "dimuka").length;
    const tunggakanMinggu = wajibKini.filter((w) => w.status !== "lunas").length;
    const tunggakanRp = wajibKini.reduce((s, w) => s + w.kurang, 0);
    const adaCicil = wajibKini.some((w) => w.status === "cicil");
    const persen = wajibKini.length ? Math.round((lunasKini / wajibKini.length) * 100) : 100;

    let statusRingkas = "lunas";
    if (tunggakanRp > 0) statusRingkas = adaCicil ? "cicil" : "nunggak";
    else if (dimukaCount > 0) statusRingkas = "dimuka";

    const saldoLebih = weeks.filter((w) => w.masaDepan).reduce((s, w) => s + w.terbayar, 0) + sisa;

    return {
      nama,
      setoran: milik,
      totalSetor,
      weeks,
      aktifKini: wajibKini.length,
      lunasKini,
      dimukaCount,
      tunggakanMinggu,
      tunggakanRp,
      saldoLebih,
      persen,
      statusRingkas,
    };
  },

  daftarAnggota() {
    const map = new Map();
    const tahunFokus = UangKas.filter.tahun;
    (UangKas.roster || []).forEach((a) => {
      if (tahunFokus && parseInt(a.tahun, 10) !== tahunFokus) return;
      const nama = String(a.nama || "").trim();
      const k = UangKas.norm(nama);
      if (!k || map.has(k)) return;
      map.set(k, {
        nama,
        jabatan: String(a.jabatan || "").trim(),
        kelas: String(a.kelas || "").trim(),
      });
    });
    // Tetap sertakan nama yang pernah setor walau sudah tidak ada di tabel anggota
    (UangKas.setoran || []).forEach((r) => {
      const nama = String(r.nama || "").trim();
      const k = UangKas.norm(nama);
      if (!k || map.has(k)) return;
      map.set(k, { nama, jabatan: "", kelas: "" });
    });
    return [...map.values()].map((o) => ({
      ...o,
      prog: UangKas.hitungProgres(o.nama),
      saya: UangKas.milikSaya(o.nama),
    }));
  },

  // ============ HELPER FILTER & PAGINASI ============
  segarkanDropdown() {
    try {
      if (window.Dropdown && Dropdown.segarkanSemua) Dropdown.segarkanSemua();
    } catch {}
  },

  tampilLebihBanyak() {
    UangKas.tampilLimit += UangKas.stepLimit;
    UangKas.render();
  },

  tampilSemua() {
    UangKas.tampilLimit = Infinity;
    UangKas.render();
  },

  ringkasTampil() {
    UangKas.tampilLimit = UangKas.defaultLimit;
    UangKas.render();
  },

  sinkronKontrolFilter(shownCount, totalFiltered, totalAll) {
    const f = UangKas.filter;
    const clearBtn = document.getElementById("btnClearQ");
    if (clearBtn) clearBtn.style.display = String(f.q || "").trim() ? "" : "none";

    document.querySelectorAll("#ukFilterChips [data-uk-status]").forEach((btn) => {
      btn.classList.toggle("active", (btn.dataset.ukStatus || "semua") === (f.status || "semua"));
    });

    const chipsEl = document.getElementById("filterChips");
    if (chipsEl) {
      const chips = [];
      if (String(f.q || "").trim()) chips.push({ k: "q", l: `Cari: "${String(f.q).trim()}"` });
      if (f.status === "lunas") chips.push({ k: "status", l: "Status: Lunas ✓" });
      else if (f.status === "nunggak") chips.push({ k: "status", l: "Status: Ada Tunggakan" });
      if (f.sort && f.sort !== "nama") {
        const sLbl = f.sort === "tunggak" ? "Tunggakan terbanyak" : "Setoran terbesar";
        chips.push({ k: "sort", l: `Urutan: ${sLbl}` });
      }
      chipsEl.innerHTML = chips.map((c) =>
        `<button type="button" class="filter-chip" data-clear-filter="${c.k}" title="Hapus filter ini">${escapeHtml(c.l)} <i class="fa-solid fa-xmark"></i></button>`
      ).join("");
    }

    const cntEl = document.getElementById("ukListCount");
    if (cntEl) {
      if (totalFiltered > shownCount) {
        cntEl.textContent = `${shownCount}/${totalFiltered} anggota (${totalAll} total)`;
      } else if (totalFiltered !== totalAll) {
        cntEl.textContent = `${shownCount} dari ${totalAll} anggota`;
      } else {
        cntEl.textContent = `${shownCount} anggota`;
      }
    }

    if (window.OsisSearch && OsisSearch.setCount) {
      const activeDrawer =
        (f.status && f.status !== "semua" ? 1 : 0) +
        (f.sort && f.sort !== "nama" ? 1 : 0);
      OsisSearch.setCount("#ukTopSearch", activeDrawer);
    }
  },

  // ============ RENDER UTAMA ============
  render() {
    const cfg = UangKas.config || UangKas.defaultConfig();
    const orangAll = UangKas.daftarAnggota();
    const semuaSetoran = UangKas.setoran || [];
    const boleh = UangKas.bolehKelola();
    const nLibur = (cfg.minggu_libur || []).length;

    // Strip info konfigurasi aktif di hero
    const strip = document.getElementById("ukCfgStrip");
    if (strip) {
      strip.innerHTML =
        `<span class="uk-cfg-pill tarif"><i class="fa-solid fa-coins"></i> ${UangKas.rp(cfg.nominal_mingguan)}/minggu</span>` +
        `<span class="uk-cfg-pill"><i class="fa-solid fa-play"></i> Mulai ${escapeHtml(UangKas.fmtSlash(cfg.tanggal_mulai))}</span>` +
        (nLibur ? `<span class="uk-cfg-pill libur"><i class="fa-solid fa-umbrella-beach"></i> ${nLibur} mgg libur</span>` : "");
    }

    // Statistik
    const totalRp = semuaSetoran.reduce((s, r) => s + (parseInt(r.nominal, 10) || 0), 0);
    const refWeeks = orangAll[0]?.prog.weeks || UangKas.hitungProgres("__ref__").weeks;
    const mingguAktifKini = refWeeks.filter((w) => w.status !== "libur" && !w.masaDepan).length;
    const mingguLiburKini = refWeeks.filter((w) => w.status === "libur" && !w.masaDepan).length;
    const lunasCount = orangAll.filter((o) => o.prog.tunggakanRp === 0).length;
    const nunggakCount = orangAll.length - lunasCount;
    const totalTunggakRp = orangAll.reduce((s, o) => s + o.prog.tunggakanRp, 0);
    const pctLunas = orangAll.length ? Math.round((lunasCount / orangAll.length) * 100) : 0;

    const setEl = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    setEl("statTerkumpul", UangKas.rp(totalRp));
    setEl("ukLunasPill", `${pctLunas}% lunas`);
    const lunasBar = document.getElementById("ukLunasBar");
    if (lunasBar) lunasBar.style.width = `${pctLunas}%`;
    setEl("ukLunasLbl", `${lunasCount} / ${orangAll.length} anggota lunas`);
    setEl("ukNunggakInfo", nunggakCount > 0 ? `${nunggakCount} belum lunas` : "Semua lunas");
    setEl("statTransaksi", `+ ${semuaSetoran.length} setoran`);
    setEl("statTunggakanRp", totalTunggakRp > 0 ? `− Kurang ${UangKas.rp(totalTunggakRp)}` : "Tunggakan Rp0");

    setEl("statMingguAktif", `${mingguAktifKini} mgg`);
    setEl("statMingguSub", mingguLiburKini ? `${mingguLiburKini} mgg libur` : "berjalan");
    setEl("statLunas", `${lunasCount} orang`);
    setEl("statNunggak", `${nunggakCount} orang`);
    setEl("statNunggakSub", totalTunggakRp > 0 ? `kurang ${UangKas.rp(totalTunggakRp)}` : "aman semua");
    setEl("statTarif", UangKas.rp(cfg.nominal_mingguan));
    setEl("statTarifSub", `per minggu · ${orangAll.length} anggota`);

    // Rail Panel 1: Aturan Kas Aktif
    setEl("ukRuleTahun", UangKas.filter.tahun ? String(UangKas.filter.tahun) : "Aktif");
    const ruleBody = document.getElementById("ukRuleBody");
    if (ruleBody) {
      ruleBody.innerHTML = `
        <div class="uk-rule-row"><span>Tarif Mingguan</span><b>${UangKas.rp(cfg.nominal_mingguan)}</b></div>
        <div class="uk-rule-row"><span>Mulai Kas</span><b>${escapeHtml(UangKas.fmtSlash(cfg.tanggal_mulai))}</b></div>
        <div class="uk-rule-row"><span>Minggu Libur</span><b>${nLibur ? `${nLibur} minggu` : "Tidak ada"}</b></div>
        <div class="uk-rule-row"><span>Berjalan</span><b>${mingguAktifKini} mgg aktif</b></div>
        ${boleh ? `<button type="button" class="btn btn-white btn-sm uk-rule-act" data-uk-open-setting="1"><i class="fa-solid fa-sliders"></i> Atur Tarif &amp; Libur</button>` : ""}`;
    }

    // Rail Panel 2: Prioritas Tunggakan / Pintas Anggota
    const rosterTitle = document.getElementById("ukSideRosterTitle");
    if (rosterTitle) {
      rosterTitle.innerHTML = nunggakCount > 0
        ? `<i class="fa-solid fa-bolt"></i> Prioritas Tunggakan`
        : `<i class="fa-solid fa-users"></i> Pintas Anggota`;
    }
    setEl("ukSideRosterCnt", String(nunggakCount > 0 ? nunggakCount : orangAll.length));
    const sideRoster = document.getElementById("ukSideRoster");
    if (sideRoster) {
      if (!orangAll.length) {
        sideRoster.innerHTML = `<div class="pesan-empty">Belum ada anggota aktif.</div>`;
      } else {
        const prioritas = (nunggakCount > 0
          ? orangAll.filter((o) => o.prog.tunggakanRp > 0)
            .sort((a, b) => b.prog.tunggakanRp - a.prog.tunggakanRp || a.nama.localeCompare(b.nama))
          : orangAll.slice()
            .sort((a, b) => (b.saya - a.saya) || (b.prog.totalSetor - a.prog.totalSetor) || a.nama.localeCompare(b.nama))
        ).slice(0, 15);
        sideRoster.innerHTML = prioritas.map((o) => {
          const p = o.prog;
          const meta = [o.jabatan, o.kelas].filter(Boolean).join(" · ") || "Anggota OSIS";
          let rCls = "lunas";
          let rTxt = "Lunas ✓";
          if (p.statusRingkas === "dimuka") { rCls = "dimuka"; rTxt = `+${p.dimukaCount} dimuka`; }
          else if (p.statusRingkas === "cicil") { rCls = "cicil"; rTxt = `−${UangKas.rp(p.tunggakanRp)}`; }
          else if (p.statusRingkas === "nunggak") { rCls = "nunggak"; rTxt = `${p.tunggakanMinggu} mgg`; }
          return `<button type="button" class="uk-roster-item" data-uk-orang="${encodeURIComponent(o.nama)}" title="Ketuk untuk detail setoran ${escapeHtml(o.nama)}">
            <div style="min-width:0; flex:1">
              <div class="uk-roster-name">${escapeHtml(o.nama)}${o.saya ? " · Saya" : ""}</div>
              <div class="uk-roster-sub">${escapeHtml(meta)}</div>
            </div>
            <div class="uk-roster-right">
              <span class="uk-roster-amt">${UangKas.rp(p.totalSetor)}</span>
              <span class="uk-roster-badge ${rCls}">${escapeHtml(rTxt)}</span>
            </div>
          </button>`;
        }).join("");
      }
    }

    // Filter + Sort list orang
    const q = UangKas.norm(UangKas.filter.q);
    const tampil = orangAll.filter((o) => {
      if (q) {
        const hay = `${o.nama} ${o.jabatan} ${o.kelas}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (UangKas.filter.status === "lunas" && o.prog.tunggakanRp > 0) return false;
      if (UangKas.filter.status === "nunggak" && o.prog.tunggakanRp <= 0) return false;
      return true;
    });

    tampil.sort((a, b) => {
      if (a.saya !== b.saya) return a.saya ? -1 : 1;
      if (UangKas.filter.sort === "tunggak") {
        return b.prog.tunggakanRp - a.prog.tunggakanRp || a.nama.localeCompare(b.nama);
      }
      if (UangKas.filter.sort === "setor") {
        return b.prog.totalSetor - a.prog.totalSetor || a.nama.localeCompare(b.nama);
      }
      return a.nama.localeCompare(b.nama);
    });

    setEl("ukListSub", !semuaSetoran.length && orangAll.length
      ? "Belum ada setoran tercatat — ketuk anggota untuk mulai"
      : "Ketuk anggota untuk cek kalender mingguan");

    const wrap = document.getElementById("ukListWrap");
    if (!wrap) return;
    if (!orangAll.length) {
      UangKas.sinkronKontrolFilter(0, 0, 0);
      wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-users"></i> Belum ada data anggota pada angkatan ini.</div>`;
      return;
    }
    if (!tampil.length) {
      UangKas.sinkronKontrolFilter(0, 0, orangAll.length);
      wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada anggota yang cocok. <a href="#" onclick="event.preventDefault(); UangKas.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
      return;
    }

    const listTampil = tampil.slice(0, UangKas.tampilLimit);
    UangKas.sinkronKontrolFilter(listTampil.length, tampil.length, orangAll.length);
    const sisa = Math.max(0, tampil.length - listTampil.length);
    const tambah = Math.min(sisa, UangKas.stepLimit);

    wrap.innerHTML = listTampil.map((o) => {
      const p = o.prog;
      const inisial = (o.nama.charAt(0) || "?").toUpperCase();
      const meta = [o.jabatan, o.kelas].filter(Boolean).join(" · ");
      const namaEnc = encodeURIComponent(o.nama);
      let statusCls = "lunas";
      let badgeTxt = "Lunas ✓";
      if (p.statusRingkas === "dimuka") {
        statusCls = "lunas";
        badgeTxt = `+${p.dimukaCount} mgg di muka`;
      } else if (p.statusRingkas === "cicil") {
        statusCls = "cicil";
        badgeTxt = `Kurang ${UangKas.rp(p.tunggakanRp)}`;
      } else if (p.statusRingkas === "nunggak") {
        statusCls = "nunggak";
        badgeTxt = `Nunggak ${p.tunggakanMinggu} mgg`;
      }
      const badgeCls = p.statusRingkas === "dimuka" ? "dimuka" : (p.statusRingkas === "cicil" ? "cicil" : (p.tunggakanRp > 0 ? "nunggak" : "lunas"));
      const progTxt = p.aktifKini > 0
        ? `${p.lunasKini}/${p.aktifKini} mgg${p.dimukaCount ? ` (+${p.dimukaCount})` : ""}`
        : "Belum mulai";

      return `<div class="uk-person ${statusCls}${o.saya ? " saya" : ""}" role="button" tabindex="0" data-uk-orang="${namaEnc}">
        <span class="uk-ava">${escapeHtml(inisial)}</span>
        <div class="uk-pmain">
          <div class="uk-phead">
            <b>${escapeHtml(o.nama)}</b>
            ${o.saya ? `<span class="uk-tag-saya">Saya</span>` : ""}
          </div>
          ${meta ? `<div class="uk-sub">${escapeHtml(meta)}</div>` : ""}
          <div class="uk-pbar-wrap">
            <div class="uk-pbar"><span style="width:${p.persen}%"></span></div>
            <span class="uk-ptext">${escapeHtml(progTxt)}</span>
          </div>
        </div>
        <div class="uk-pright">
          <span class="uk-total">${UangKas.rp(p.totalSetor)}</span>
          <span class="uk-badge ${badgeCls}">${escapeHtml(badgeTxt)}</span>
        </div>
        ${boleh ? `<button type="button" class="uk-quick-add" data-uk-quick="${namaEnc}" title="Catat setoran ${escapeHtml(o.nama)}"><i class="fa-solid fa-plus"></i></button>` : ""}
        <i class="fa-solid fa-chevron-right uk-chev"></i>
      </div>`;
    }).join("")
    + ((sisa > 0 || (tampil.length > UangKas.defaultLimit && listTampil.length > UangKas.defaultLimit))
      ? `<div class="uk-expand-bar">
          ${sisa > 0 ? `<button type="button" class="btn btn-white btn-sm" onclick="UangKas.tampilLebihBanyak()"><i class="fa-solid fa-angles-down"></i> Tampilkan Lebih Banyak (+${tambah})</button>` : ""}
          ${sisa > tambah ? `<button type="button" class="btn btn-red btn-sm" onclick="UangKas.tampilSemua()"><i class="fa-solid fa-layer-group"></i> Lihat Semua (${tampil.length})</button>` : ""}
          ${listTampil.length > UangKas.defaultLimit ? `<button type="button" class="btn btn-white btn-sm" onclick="UangKas.ringkasTampil()"><i class="fa-solid fa-compress"></i> Ringkas (${UangKas.defaultLimit})</button>` : ""}
        </div>`
      : "");
  },

  bacaFilter() {
    UangKas.filter.q = document.getElementById("filterQ")?.value || "";
    UangKas.filter.sort = document.getElementById("filterSort")?.value || "nama";
    UangKas.tampilLimit = UangKas.defaultLimit;
    UangKas.render();
  },

  resetFilter() {
    const q = document.getElementById("filterQ");
    if (q) q.value = "";
    const s = document.getElementById("filterSort");
    if (s) s.value = "nama";
    UangKas.filter.q = "";
    UangKas.filter.sort = "nama";
    UangKas.filter.status = "semua";
    UangKas.tampilLimit = UangKas.defaultLimit;
    UangKas.segarkanDropdown();
    UangKas.render();
  },

  // ============ DETAIL PROGRES PER ORANG ============
  bukaDetail(nama) {
    if (!nama) return;
    UangKas.detailNama = nama;
    UangKas.renderDetailModal();
    document.getElementById("ukDetailModal")?.classList.add("open");
    document.body.style.overflow = "hidden";
  },

  tutupDetail() {
    document.getElementById("ukDetailModal")?.classList.remove("open");
    if (!document.querySelector("#ukSetorModal.open, #ukSettingModal.open")) {
      document.body.style.overflow = "";
    }
    UangKas.detailNama = "";
  },

  renderDetailModal() {
    const nama = UangKas.detailNama;
    if (!nama) return;
    const orang = UangKas.daftarAnggota().find((o) => UangKas.norm(o.nama) === UangKas.norm(nama));
    const prog = orang ? orang.prog : UangKas.hitungProgres(nama);
    const boleh = UangKas.bolehKelola();

    document.getElementById("ukDetNama").textContent = orang ? orang.nama : nama;
    const metaParts = [];
    if (orang && orang.jabatan) metaParts.push(orang.jabatan);
    if (orang && orang.kelas) metaParts.push(orang.kelas);
    if (!metaParts.length) metaParts.push("Anggota OSIS");
    document.getElementById("ukDetMeta").textContent = metaParts.join(" · ");
    document.getElementById("btnDetSetor").style.display = boleh ? "" : "none";

    // 4 summary box
    document.getElementById("ukDetSummary").innerHTML = `
      <div class="uk-det-box"><span>Total Disetor</span><b style="color:#146314">${UangKas.rp(prog.totalSetor)}</b></div>
      <div class="uk-det-box"><span>Minggu Lunas</span><b>${prog.lunasKini} / ${prog.aktifKini} mgg</b></div>
      <div class="uk-det-box"><span>Tunggakan</span><b style="color:${prog.tunggakanRp > 0 ? "var(--red-dark)" : "#146314"}">${prog.tunggakanRp > 0 ? UangKas.rp(prog.tunggakanRp) : "Lunas ✓"}</b></div>
      <div class="uk-det-box"><span>Di Muka / Saldo</span><b style="color:#09527a">${prog.saldoLebih > 0 ? UangKas.rp(prog.saldoLebih) : "-"}</b></div>`;

    // Kelompokkan minggu per bulan
    const perBulan = new Map();
    let kumulatifKurang = 0;
    const enrichedWeeks = prog.weeks.map((w) => {
      if (w.status !== "libur" && w.kurang > 0) kumulatifKurang += w.kurang;
      return { ...w, _kumKurang: kumulatifKurang };
    });
    enrichedWeeks.forEach((w) => {
      const key = UangKas.fmtBulanTahun(w.senin);
      if (!perBulan.has(key)) perBulan.set(key, []);
      perBulan.get(key).push(w);
    });

    const weeksEl = document.getElementById("ukDetWeeks");
    if (!enrichedWeeks.length) {
      weeksEl.innerHTML = `<div class="pesan-empty">Belum ada minggu aktif.</div>`;
    } else {
      weeksEl.innerHTML = [...perBulan.entries()].map(([bln, list]) => `
        <div class="uk-month-group">
          <div class="uk-month-lbl">${escapeHtml(bln)}</div>
          <div class="uk-week-grid">
            ${list.map((w) => {
              let ico = '<i class="fa-solid fa-xmark"></i>';
              let statTxt = `Belum (${UangKas.rp(w.tarif)})`;
              if (w.status === "lunas") {
                ico = '<i class="fa-solid fa-check"></i>';
                statTxt = `Lunas · ${UangKas.rp(w.tarif)}`;
              } else if (w.status === "dimuka") {
                ico = '<i class="fa-solid fa-check-double"></i>';
                statTxt = `Di muka · ${UangKas.rp(w.tarif)}`;
              } else if (w.status === "cicil") {
                ico = '<i class="fa-solid fa-hourglass-half"></i>';
                statTxt = `${UangKas.rp(w.terbayar)} / ${UangKas.rp(w.tarif)}`;
              } else if (w.status === "libur") {
                ico = '<i class="fa-solid fa-umbrella-beach"></i>';
                statTxt = "Libur (tidak ditagih)";
              }
              const dapatKlik = boleh && (w.status === "belum" || w.status === "cicil");
              const title = dapatKlik ? `Klik untuk setor s.d. minggu ini (${UangKas.rp(w._kumKurang)})` : "";
              return `<button type="button" class="uk-week ${w.status}${dapatKlik ? " clickable" : ""}"
                ${dapatKlik ? `data-uk-week-target="${w.senin}" data-uk-week-kurang="${w._kumKurang}"` : "disabled"}
                title="${escapeHtml(title)}">
                <div class="uk-week-top">
                  <span class="uk-week-num">${w.status === "libur" ? "Libur" : `Minggu ${w.nomor}`}</span>
                  <span class="uk-week-ico">${ico}</span>
                </div>
                <div class="uk-week-tgl">${escapeHtml(UangKas.fmtRentang(w.senin))}</div>
                <div class="uk-week-stat">${escapeHtml(statTxt)}</div>
              </button>`;
            }).join("")}
          </div>
        </div>`).join("");
    }

    // Riwayat setoran
    document.getElementById("ukDetHistCount").textContent = `${prog.setoran.length} transaksi`;
    const histEl = document.getElementById("ukDetHistory");
    if (!prog.setoran.length) {
      histEl.innerHTML = `<div class="pesan-empty">Belum ada setoran tercatat untuk ${escapeHtml(orang ? orang.nama : nama)}.</div>`;
    } else {
      histEl.innerHTML = `<div class="uk-hist-list">${prog.setoran.map((r) => `
        <div class="uk-hist-row">
          <div class="uk-hist-main">
            <b>+ ${UangKas.rp(r.nominal)}</b>
            <div class="uk-hist-meta">${escapeHtml(UangKas.fmtSlash(r.tanggal))}${r.catatan ? ` · ${escapeHtml(r.catatan)}` : ""}${olehLabel(r)}</div>
          </div>
          ${boleh ? `<div class="uk-hist-act">
            <button type="button" class="icon-btn" data-uk-edit="${r.id}" title="Edit" style="width:30px; height:30px; font-size:0.75rem; border-width:2px"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="icon-btn" data-uk-del="${r.id}" title="Hapus" style="width:30px; height:30px; font-size:0.75rem; background:var(--red); color:#fff; border-width:2px"><i class="fa-solid fa-trash-can"></i></button>
          </div>` : ""}
        </div>`).join("")}</div>`;
    }
  },

  // ============ MODAL SETORAN + PREVIEW AUTO-CEKLIS ============
  bukaSetor(prefillNama, prefillNominal) {
    if (!UangKas.butuhKelola()) return;
    UangKas.editingId = null;
    document.getElementById("ukSetorId").value = "";
    document.getElementById("ukSetorTitle").textContent = "Catat Setoran Uang Kas";
    document.getElementById("ukSetorNama").value = prefillNama || "";
    const terkunci = !!prefillNama;
    document.getElementById("ukNamaSearchWrap").style.display = terkunci ? "none" : "";
    document.getElementById("ukNamaListBox").style.display = terkunci ? "none" : "";
    UangKas.namaQ = "";
    const sEl = document.getElementById("ukNamaSearch");
    if (sEl) sEl.value = "";
    document.getElementById("ukSetorTanggal").value = UangKas.hariIni();
    const nomEl = document.getElementById("ukSetorNominal");
    if (nomEl) {
      nomEl.value = prefillNominal ? String(prefillNominal) : "";
      if (prefillNominal && typeof formatRupiah === "function") formatRupiah(nomEl);
    }
    document.getElementById("ukSetorCatatan").value = "";
    document.getElementById("ukSetorModal")?.classList.add("open");
    document.body.style.overflow = "hidden";
    UangKas.renderNamaList();
    UangKas.renderNomChips();
    UangKas.renderAutoPreview();
  },

  editSetor(id) {
    if (!UangKas.butuhKelola()) return;
    const item = (UangKas.setoran || []).find((r) => String(r.id) === String(id));
    if (!item) return;
    UangKas.editingId = item.id;
    document.getElementById("ukSetorId").value = item.id;
    document.getElementById("ukSetorTitle").textContent = "Edit Setoran";
    document.getElementById("ukSetorNama").value = item.nama || "";
    document.getElementById("ukNamaSearchWrap").style.display = "";
    document.getElementById("ukNamaListBox").style.display = "";
    UangKas.namaQ = "";
    const sEl = document.getElementById("ukNamaSearch");
    if (sEl) sEl.value = "";
    document.getElementById("ukSetorTanggal").value = item.tanggal || UangKas.hariIni();
    const nomEl = document.getElementById("ukSetorNominal");
    if (nomEl) {
      nomEl.value = String(item.nominal || "");
      if (typeof formatRupiah === "function") formatRupiah(nomEl);
    }
    document.getElementById("ukSetorCatatan").value = item.catatan || "";
    document.getElementById("ukSetorModal")?.classList.add("open");
    document.body.style.overflow = "hidden";
    UangKas.renderNamaList();
    UangKas.renderNomChips();
    UangKas.renderAutoPreview();
  },

  tutupSetor() {
    document.getElementById("ukSetorModal")?.classList.remove("open");
    if (!document.querySelector("#ukDetailModal.open, #ukSettingModal.open")) {
      document.body.style.overflow = "";
    }
    UangKas.editingId = null;
  },

  pilihNama(nama) {
    nama = String(nama || "").trim();
    if (!nama) return;
    document.getElementById("ukSetorNama").value = nama;
    UangKas.renderNamaList();
    UangKas.renderNomChips();
    UangKas.renderAutoPreview();
  },

  renderNamaList() {
    const box = document.getElementById("ukNamaListBox");
    const dp = document.getElementById("ukNamaDipilih");
    const dipilih = (document.getElementById("ukSetorNama")?.value || "").trim();
    const orangAll = UangKas.daftarAnggota();
    if (dp) {
      if (dipilih) {
        const hit = orangAll.find((o) => UangKas.norm(o.nama) === UangKas.norm(dipilih));
        const info = hit && hit.prog.tunggakanRp > 0 ? `Kurang ${UangKas.rp(hit.prog.tunggakanRp)}` : "Lunas s.d. kini";
        dp.className = "tb-dipilih";
        dp.innerHTML = `<span class="dot"><i class="fa-solid fa-check"></i></span> ${escapeHtml(dipilih)}<small>${escapeHtml(info)}</small>`;
      } else {
        dp.className = "tb-dipilih kosong";
        dp.innerHTML = `<span class="dot">○</span> Belum dipilih — ketuk nama di bawah`;
      }
    }
    if (!box || box.style.display === "none") return;
    const toks = UangKas.norm(UangKas.namaQ).split(/\s+/).filter(Boolean);
    const saring = orangAll.filter((o) => {
      if (!toks.length) return true;
      const t = UangKas.norm(o.nama);
      return toks.every((k) => t.includes(k));
    });
    if (!saring.length) {
      box.innerHTML = `<div class="pesan-empty">Tidak ada anggota yang cocok.</div>`;
      return;
    }
    box.innerHTML = saring.map((o) => {
      const sel = UangKas.norm(o.nama) === UangKas.norm(dipilih);
      return `<button type="button" class="tb-item${sel ? " pilih" : ""}" data-pilih-nama="${encodeURIComponent(o.nama)}">
        <span class="dot">${sel ? '<i class="fa-solid fa-check"></i>' : "○"}</span>
        <span style="flex:1">${escapeHtml(o.nama)}</span>
        <small style="font-size:0.68rem; color:${o.prog.tunggakanRp > 0 ? "var(--red-dark)" : "#146314"}">${o.prog.tunggakanRp > 0 ? `-${UangKas.rp(o.prog.tunggakanRp)}` : "Lunas"}</small>
      </button>`;
    }).join("");
  },

  renderNomChips() {
    const el = document.getElementById("ukNomChips");
    if (!el) return;
    const tarif = (UangKas.config && UangKas.config.nominal_mingguan) || 2000;
    const nama = (document.getElementById("ukSetorNama")?.value || "").trim();
    const chips = [
      { label: `1 mgg (${UangKas.rp(tarif)})`, val: tarif },
      { label: `2 mgg (${UangKas.rp(tarif * 2)})`, val: tarif * 2 },
      { label: `4 mgg (${UangKas.rp(tarif * 4)})`, val: tarif * 4 },
    ];
    if (nama) {
      const baseSetoran = UangKas.editingId
        ? (UangKas.setoran || []).filter((r) => String(r.id) !== String(UangKas.editingId))
        : (UangKas.setoran || []);
      const prog = UangKas.hitungProgres(nama, UangKas.config, baseSetoran);
      if (prog.tunggakanRp > 0 && !chips.some((c) => c.val === prog.tunggakanRp)) {
        chips.push({ label: `Lunasi semua (${UangKas.rp(prog.tunggakanRp)})`, val: prog.tunggakanRp });
      }
    }
    el.innerHTML = chips.map((c) => `<button type="button" class="uk-nom-chip" data-nom-val="${c.val}">${escapeHtml(c.label)}</button>`).join("");
  },

  renderAutoPreview() {
    const box = document.getElementById("ukAutoPreview");
    if (!box) return;
    const nama = (document.getElementById("ukSetorNama")?.value || "").trim();
    const nom = typeof parseRupiah === "function"
      ? parseRupiah(document.getElementById("ukSetorNominal")?.value || "")
      : (parseInt(document.getElementById("ukSetorNominal")?.value || "0", 10) || 0);
    if (!nama || nom <= 0) {
      box.className = "uk-auto-preview kosong";
      box.textContent = "Pilih anggota dan masukkan nominal untuk melihat minggu yang otomatis tercentang.";
      return;
    }
    const baseSetoran = UangKas.editingId
      ? (UangKas.setoran || []).filter((r) => String(r.id) !== String(UangKas.editingId))
      : (UangKas.setoran || []);
    const sebelum = UangKas.hitungProgres(nama, UangKas.config, baseSetoran);
    const sesudah = UangKas.hitungProgres(nama, UangKas.config, [
      ...baseSetoran,
      { id: -1, nama, tanggal: UangKas.hariIni(), nominal: nom },
    ]);

    const prevMap = new Map(sebelum.weeks.map((w) => [w.senin, w]));
    const baruLunas = sesudah.weeks.filter((w) => {
      if (w.status !== "lunas" && w.status !== "dimuka") return false;
      const p = prevMap.get(w.senin);
      return !p || (p.status !== "lunas" && p.status !== "dimuka");
    });
    const cicilBaru = sesudah.weeks.find((w) => w.status === "cicil");
    box.className = "uk-auto-preview";

    const parts = [];
    if (baruLunas.length) {
      const contoh = baruLunas.slice(0, 4).map((w) => `M${w.nomor} (${UangKas.fmtPendek(w.senin)})`).join(", ");
      const ekstra = baruLunas.length > 4 ? ` +${baruLunas.length - 4} minggu lainnya` : "";
      parts.push(`Otomatis menceklis <b>${baruLunas.length} minggu</b>: ${escapeHtml(contoh + ekstra)} ✓`);
    }
    if (cicilBaru) {
      parts.push(`Masuk cicilan <b>M${cicilBaru.nomor}</b> (${UangKas.rp(cicilBaru.terbayar)} / ${UangKas.rp(cicilBaru.tarif)})`);
    }
    if (!parts.length) {
      parts.push(`Menambah saldo kas <b>${escapeHtml(nama)}</b> sebesar <b>${UangKas.rp(nom)}</b>.`);
    }
    box.innerHTML = parts.join("<br>");
  },

  async simpanSetor() {
    if (!UangKas.butuhKelola()) return;
    const u = OsisAuth.getUser();
    const nama = (document.getElementById("ukSetorNama").value || "").trim();
    const tanggal = document.getElementById("ukSetorTanggal").value || "";
    const nominal = typeof parseRupiah === "function"
      ? parseRupiah(document.getElementById("ukSetorNominal").value)
      : (parseInt(document.getElementById("ukSetorNominal").value, 10) || 0);
    const catatan = (document.getElementById("ukSetorCatatan").value || "").trim();

    if (!nama) { showToast("Pilih nama anggota dulu.", "error"); return; }
    if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
    if (!nominal || nominal <= 0) { showToast("Nominal harus lebih dari 0.", "error"); return; }

    const id = UangKas.editingId ? Number(UangKas.editingId) : null;

    const btn = document.getElementById("btnSimpanSetor");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
    try {
      if (id) {
        const { data, error } = await supa.rpc("update_uang_kas_setoran", {
          p_user_id: u.id, p_id: id, p_nama: nama, p_tanggal: tanggal, p_nominal: nominal, p_catatan: catatan,
        });
        if (error) throw error;
        cekOk(data);
        showToast("Setoran diperbarui di Uang Kas & Keuangan!", "success");
        try { catatAksi("simpan_uang_kas", "edit " + nama + " " + UangKas.rp(nominal)); } catch {}
      } else {
        const { data, error } = await supa.rpc("buat_uang_kas_setoran", {
          p_user_id: u.id, p_nama: nama, p_tanggal: tanggal, p_nominal: nominal, p_catatan: catatan,
          p_angkatan_id: DbScope.angkatanId(),
        });
        if (error) throw error;
        cekId(data);
        showToast("Setoran tersimpan — minggu diceklis & masuk Keuangan!", "success");
        try { catatAksi("simpan_uang_kas", nama + " " + UangKas.rp(nominal)); } catch {}
      }
      Cache.del(UangKas.angKey("set"));
      Cache.del("kas");
      UangKas.tutupSetor();
      await UangKas.muat();
    } catch (err) {
      console.error(err);
      showToast("Gagal simpan: " + (err.message || err), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Setoran'; }
    }
  },

  async hapusSetor(id) {
    if (!UangKas.butuhKelola()) return;
    const item = (UangKas.setoran || []).find((r) => String(r.id) === String(id));
    if (!item) return;
    const yakin = await showPopup(`Hapus setoran ${escapeHtml(item.nama)} (${UangKas.fmtSlash(item.tanggal)}, ${UangKas.rp(item.nominal)})? Ceklis minggu akan dihitung ulang otomatis.`, "confirm");
    if (!yakin) return;
    const u = OsisAuth.getUser();
    try {
      const { data, error } = await supa.rpc("hapus_uang_kas_setoran", { p_user_id: u.id, p_id: Number(id) });
      if (error) throw error;
      cekOk(data);
      Cache.del(UangKas.angKey("set"));
      Cache.del("kas");
      showToast("Setoran dihapus dari Uang Kas & Keuangan.", "success");
      try { catatAksi("hapus_uang_kas", (item.nama || "") + " " + UangKas.rp(item.nominal)); } catch {}
      await UangKas.muat();
    } catch (err) {
      console.error(err);
      showToast("Gagal hapus: " + (err.message || err), "error");
    }
  },

  // ============ PENGATURAN: TARIF & MINGGU LIBUR ============
  bukaSetting() {
    if (!UangKas.butuhKelola()) return;
    const cfg = UangKas.config || UangKas.defaultConfig();
    UangKas._initialTarif = cfg.nominal_mingguan || 2000;
    const nomEl = document.getElementById("ukCfgNominal");
    if (nomEl) {
      nomEl.value = String(UangKas._initialTarif);
      if (typeof formatRupiah === "function") formatRupiah(nomEl);
    }
    document.getElementById("ukCfgMulai").value = cfg.tanggal_mulai;
    document.getElementById("ukCfgCatatan").value = cfg.catatan || "";
    UangKas.draftLibur = new Set((cfg.minggu_libur || []).map((x) => UangKas.seninDari(x)).filter(Boolean));
    document.getElementById("ukTarifScope").style.display = "none";
    UangKas.renderCfgMulaiInfo();
    UangKas.renderLiburGrid();
    document.getElementById("ukSettingModal")?.classList.add("open");
    document.body.style.overflow = "hidden";
  },

  tutupSetting() {
    document.getElementById("ukSettingModal")?.classList.remove("open");
    if (!document.querySelector("#ukDetailModal.open, #ukSetorModal.open")) {
      document.body.style.overflow = "";
    }
  },

  cekPerubahanTarif() {
    const scopeEl = document.getElementById("ukTarifScope");
    if (!scopeEl) return;
    const baru = typeof parseRupiah === "function"
      ? parseRupiah(document.getElementById("ukCfgNominal")?.value || "")
      : (parseInt(document.getElementById("ukCfgNominal")?.value || "0", 10) || 0);
    const berubah = baru > 0 && baru !== UangKas._initialTarif && (UangKas.setoran || []).length > 0;
    scopeEl.style.display = berubah ? "" : "none";
  },

  renderCfgMulaiInfo() {
    const el = document.getElementById("ukCfgMulaiInfo");
    const val = document.getElementById("ukCfgMulai")?.value || "";
    if (!el) return;
    const s = UangKas.seninDari(val);
    el.textContent = s ? `Minggu ke-1 dihitung mulai Senin, ${UangKas.fmtSlash(s)}` : "";
  },

  renderLiburGrid() {
    const grid = document.getElementById("ukCfgLiburGrid");
    if (!grid) return;
    const mulai = UangKas.seninDari(document.getElementById("ukCfgMulai")?.value || UangKas.config?.tanggal_mulai || UangKas.hariIni());
    const batas = UangKas.tambahHari(UangKas.seninDari(UangKas.hariIni()), 42);
    const set = new Set();
    let cur = mulai;
    let guard = 0;
    while (guard < 120 && cur <= batas) {
      guard++;
      set.add(cur);
      cur = UangKas.tambahHari(cur, 7);
    }
    UangKas.draftLibur.forEach((s) => { if (s) set.add(s); });
    const list = [...set].sort();
    grid.innerHTML = list.map((s) => {
      const on = UangKas.draftLibur.has(s);
      return `<button type="button" class="uk-libur-btn${on ? " on" : ""}" data-libur-senin="${s}">
        <span>${escapeHtml(UangKas.fmtPendek(s))}</span>
        <span class="tag">${on ? "Libur" : "Aktif"}</span>
      </button>`;
    }).join("");
  },

  async simpanSetting() {
    if (!UangKas.butuhKelola()) return;
    const nom = typeof parseRupiah === "function"
      ? parseRupiah(document.getElementById("ukCfgNominal").value)
      : (parseInt(document.getElementById("ukCfgNominal").value, 10) || 0);
    const mulaiRaw = document.getElementById("ukCfgMulai").value || "";
    const catatan = (document.getElementById("ukCfgCatatan").value || "").trim();
    if (!nom || nom <= 0) { showToast("Tarif harus lebih dari 0.", "error"); return; }
    const mulai = UangKas.seninDari(mulaiRaw);
    if (!mulai) { showToast("Tanggal mulai wajib diisi.", "error"); return; }

    const libur = [...UangKas.draftLibur].sort();
    const curCfg = UangKas.config || UangKas.defaultConfig();
    let riwayat = Array.isArray(curCfg.tarif_riwayat) ? [...curCfg.tarif_riwayat] : [];
    const scope = document.querySelector('input[name="ukTarifScope"]:checked')?.value || "minggu_ini";

    if (nom !== UangKas._initialTarif) {
      if ((UangKas.setoran || []).length > 0 && scope === "minggu_ini") {
        const mingguIni = UangKas.seninDari(UangKas.hariIni());
        if (!riwayat.length) {
          riwayat.push({ mulai: curCfg.tanggal_mulai || mulai, nominal: UangKas._initialTarif });
        }
        riwayat = riwayat.filter((x) => x.mulai !== mingguIni);
        riwayat.push({ mulai: mingguIni, nominal: nom });
        riwayat.sort((a, b) => a.mulai.localeCompare(b.mulai));
      } else {
        riwayat = [{ mulai, nominal: nom }];
      }
    } else if (!riwayat.length) {
      riwayat = [{ mulai, nominal: nom }];
    }

    const nextCfg = UangKas.normalConfig({
      nominal_mingguan: nom,
      tanggal_mulai: mulai,
      minggu_libur: libur,
      tarif_riwayat: riwayat,
      catatan,
    });

    const u = OsisAuth.getUser();
    const btn = document.getElementById("btnSimpanSetting");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
    try {
      const { data, error } = await supa.rpc("simpan_uang_kas_config", {
        p_user_id: u.id,
        p_nominal_mingguan: nextCfg.nominal_mingguan,
        p_tanggal_mulai: nextCfg.tanggal_mulai,
        p_minggu_libur: nextCfg.minggu_libur,
        p_tarif_riwayat: nextCfg.tarif_riwayat,
        p_catatan: nextCfg.catatan,
        p_angkatan_id: DbScope.angkatanId(),
      });
      if (error) throw error;
      cekOk(data);
      Cache.del(UangKas.angKey("cfg"));
      UangKas.tutupSetting();
      showToast("Pengaturan uang kas disimpan!", "success");
      try { catatAksi("atur_uang_kas", `tarif ${UangKas.rp(nextCfg.nominal_mingguan)} · ${nextCfg.minggu_libur.length} libur`); } catch {}
      await UangKas.muat();
    } catch (err) {
      console.error(err);
      showToast("Gagal simpan pengaturan: " + (err.message || err), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Pengaturan'; }
    }
  },
};

document.addEventListener("DOMContentLoaded", () => UangKas.init());
