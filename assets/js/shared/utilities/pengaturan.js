// =========================================================================
// PUSAT PENGATURAN TERPADU — OSIS TARPAN ONE (pengaturan.html)
// Dibangun dari 0 untuk melayani seluruh pengguna:
//   1. Perangkat & Akun (Lokal: semua user — tamu, akun biasa, pengurus OSIS)
//   2. Situs Publik / Root index.html (Server DB: sesuai hak site/aspirasi/lagu/polling)
//   3. Internal Dashboard osis/ (Server DB: sesuai hak modul & super_admin)
// =========================================================================

const PengaturanApp = {
  activeCat: "akun",
  searchQ: "",
  fromOsis: false,
  swVersion: "-",
  swReady: false,

  // Data server yang dimuat sesuai hak akses
  data: {
    loadedServer: false,
    siteMap: {},
    pengaturan: {},
    webFoto: {},
    pollingJudul: "Polling Wakil Ketua OSIS",
    pollingStatus: "BUKA",
    bottomnav: null,
    sidebar: null,
    angkatanList: [],
    periodeList: [],
    absensiCfg: null,
    uangKasCfg: null,
    saldoAwalList: [],
  },

  // State editor interaktif
  state: {
    photoTargetKey: null,
    bnavDraft: null,
    bnavEditKey: null,
    sideDraft: null,
    sideEditIdx: -1,
    angEditId: null,
    absTahunAktif: [],
    absTahunDefault: null,
    absPeriodeAktif: [],
    absTambahTahun: [],
    ukLibur: [],
    ukRiwayat: [],
    subOpen: { misi_1: true, logo_1: true, soc_ig: true, rule_1: true },
  },

  // Nilai default teks index.html (dipakai bila kunci belum pernah disimpan di site_content)
  SITE_DEFAULTS: {
    hero_badge: "Est. 2010 — Satu Keluarga",
    hero_line1: "OSIS",
    hero_line2: "TARPAN",
    hero_line3: "ONE",
    hero_tagline:
      "Organisasi kepemimpinan siswa yang berintegritas, beretika mulia, dan berdampak nyata untuk sekolah.",
    pembina_name: "Robi Sanusi, S.E",
    pembina_jabatan: "Masa Jabatan: 2010 — 2026",
    pembina_quote: "Bersatu kita teguh, bercerai kita runtuh.",
    prestasi_banner_title: "Generasi Emas Penuh Aksi",
    prestasi_banner_desc:
      "OSIS Taruna Harapan 1 Cipatat meraih penghargaan tingkat kabupaten.",
    footer_version: "v8.4.0",
    visi_text:
      "Menjadikan OSIS sebagai laboratorium kepemimpinan siswa yang berintegritas, beretika mulia, dan berdampak positif bagi sekolah dan masyarakat.",
    misi_1_title: "Pembinaan Kepemimpinan",
    misi_1_desc:
      "Menjadikan OSIS sebagai sarana pembinaan kepemimpinan siswa yang berlandaskan integritas dan etika mulia.",
    misi_2_title: "Tanggung Jawab & Disiplin",
    misi_2_desc:
      "Menumbuhkan sikap tanggung jawab, kedisiplinan, dan keteladanan dalam setiap peran dan aktivitas OSIS.",
    misi_3_title: "Tata Kelola Adaptif",
    misi_3_desc:
      "Mewujudkan tata kelola OSIS yang adaptif, tertib administrasi, dan menjunjung keterbukaan di setiap prosesnya.",
    misi_4_title: "Program Kerja Inovatif",
    misi_4_desc:
      "Menghadirkan program kerja yang inovatif, solutif, dan berdampak nyata bagi warga sekolah serta masyarakat.",
    logo_makna_desc:
      "Setiap elemen dalam logo OSIS Tarpan One memiliki makna yang mencerminkan nilai, semangat, dan identitas organisasi.",
    logo_1_title: "Perisai",
    logo_1_desc: "Bentuk perisai melambangkan keteguhan dan perlindungan.",
    logo_1_mdesc: "Keteguhan dan perlindungan.",
    logo_2_title: "Tulisan OSIS",
    logo_2_desc: "Identitas organisasi siswa intra sekolah.",
    logo_2_mdesc: "Identitas siswa.",
    logo_3_title: "Bintang",
    logo_3_desc: "Cita-cita, harapan, dan nilai yang menjadi pedoman.",
    logo_3_mdesc: "Cita-cita dan pedoman.",
    logo_4_title: "Padi",
    logo_4_desc:
      "Kesejahteraan, kemakmuran, dan harapan untuk berkembang bersama.",
    logo_4_mdesc: "Kesejahteraan bersama.",
    logo_5_title: "Kapas",
    logo_5_desc: "Kesucian, kejujuran, dan kebersamaan.",
    logo_5_mdesc: "Suci, jujur, kompak.",
    logo_6_title: "Obor",
    logo_6_desc: "Semangat, ilmu pengetahuan, dan penerangan.",
    logo_6_mdesc: "Semangat dan ilmu.",
    logo_7_title: "Nama Sekolah",
    logo_7_desc:
      "SMK Taruna Harapan 1 Cipatat sebagai identitas dan asal organisasi.",
    logo_7_mdesc: "SMK Taruna Harapan 1 Cipatat.",
    logo_8_title: "Sayap",
    logo_8_desc:
      "Sepasang sayap melambangkan cita-cita tinggi, kebebasan berkarya, dan gerak dinamis untuk terbang meraih masa depan.",
    logo_8_mdesc: "Cita-cita tinggi dan gerak dinamis.",
    kontak_ig_url: "https://instagram.com/osis_smktarpanone",
    kontak_ig_handle: "@osis_smktarpanone",
    kontak_tt_url: "https://tiktok.com/@osis_tarpan",
    kontak_tt_handle: "@osis_tarpan",
    kontak_yt_url: "https://youtube.com/@osisrinyuhtarpanone",
    kontak_yt_handle: "OSIS Rinyuh Tarpan One",
    kontak_wa_url: "https://whatsapp.com/channel/0029VavIK3L5a23uXQChYz02",
    kontak_wa_handle: "Saluran Resmi",
    kontak_email_url: "mailto:osisrinyuh10@gmail.com",
    kontak_email_handle: "osisrinyuh10@gmail.com",
    musik_rule_1_title: "Lagu Harus Sopan",
    musik_rule_1_desc:
      "Pastikan lagu yang direquest tidak mengandung kata-kata kasar, unsur seksual, penghinaan, atau konten tidak pantas lainnya yang tidak sesuai dengan lingkungan sekolah.",
    musik_rule_2_title: "Pemilihan Lagu",
    musik_rule_2_desc: "Lagu dipilih acak, yang lagi trend di pilih duluan.",
    musik_rule_3_title: "Masa Expired",
    musik_rule_3_desc:
      "Lagu yang udah tenggelam 3+ hari gabakal di play, karna banyak yang requestnya.",
    musik_rule_note_tag: "Catatan",
    musik_rule_note:
      "Mohon maaf kalo lagu yang direquest ga selalu bisa diputer, kuota jam istirahat terbatas.",
    hasil_wawancara_tpl_lanjut:
      "Terimakasih atas partisipasi yang anda yang telah melaksanakan tes wawancara kesiapan yang dilaksanakan pada {tanggal}.\nDan hasil anda di nyatakan\nLANJUT\n\nSemoga hasil yang di dapat hari ini, bisa memicu motivasi kedepannya, dan tetap konsisten pada pendirian. Setelah ini silahkan hubungi kakak asuh terbaru kamu yaitu {kakasuh}.",
    hasil_wawancara_tpl_gagal:
      "Terimakasih atas partisipasi yang anda yang telah melaksanakan tes wawancara kesiapan yang dilaksanakan pada {tanggal}.\nDan hasil anda di nyatakan\nGAGAL\n\nmohon maaf, anda tidak bisa melanjutkan di keorganisasian ini\n\nSemoga anda bisa lebih maju, dan termotivasi lagi di cabang extrakurikuler yang lain.",
  },

  PUBLIC_ROUTES: [
    ["home", "Home"],
    ["sekbid", "Sekbid"],
    ["galeri", "Galeri"],
    ["kontak", "Kontak"],
    ["feed", "Feed"],
    ["informasi", "Informasi"],
    ["pengurus", "Pengurus"],
    ["aspirasi", "Aspirasi"],
    ["musik", "Request Lagu"],
    ["arsip", "Arsip Galeri"],
    ["pelantikan", "Pelantikan"],
  ],

  BOTTOMNAV_DEFAULT: {
    tabs: [
      { route: "home", label: "Home", icon: "fa-solid fa-house" },
      { route: "sekbid", label: "Sekbid", icon: "fa-solid fa-folder-open" },
      { route: "galeri", label: "Galeri", icon: "fa-solid fa-images" },
      { route: "kontak", label: "Kontak", icon: "fa-solid fa-phone" },
    ],
    sheet: [
      { route: "feed", label: "Feed", sub: "Scrolling foto & video", icon: "fa-solid fa-fire", short: "Feed" },
      { route: "informasi", label: "Informasi", sub: "Pengumuman & acara", icon: "fa-solid fa-bullhorn", short: "Info" },
      { route: "pengurus", label: "Pengurus", sub: "Struktur OSIS", icon: "fa-solid fa-users", short: "Pengurus" },
      { route: "aspirasi", label: "Aspirasi", sub: "Suara siswa", icon: "fa-solid fa-inbox", short: "Aspirasi" },
      { route: "musik", label: "Request Lagu", sub: "Radio jam istirahat", icon: "fa-solid fa-music", short: "Musik" },
      { route: "arsip", label: "Arsip Galeri", sub: "Semua dokumentasi", icon: "fa-solid fa-box-archive", short: "Arsip" },
    ],
  },

  SIDEBAR_DEFAULT: [
    { href: "index", label: "Dashboard", icon: "fa-solid fa-grip", grup: "", populer: false, super: false },
    { href: "agenda", label: "Agenda", icon: "fa-solid fa-calendar-days", grup: "Umum", populer: true, super: false },
    { href: "anggota", label: "Anggota", icon: "fa-solid fa-users", grup: "Umum", populer: false, super: false },
    { href: "informasi", label: "Informasi", icon: "fa-solid fa-bullhorn", grup: "Umum", populer: false, super: false },
    { href: "wawancara", label: "Wawancara", icon: "fa-solid fa-comments", grup: "Umum", populer: false, super: false },
    { href: "hasil-wawancara", label: "Hasil Wawancara", icon: "fa-solid fa-square-poll-vertical", grup: "Umum", populer: false, super: false },
    { href: "tes", label: "Tes & Kuis", icon: "fa-solid fa-clipboard-question", grup: "Umum", populer: false, super: false },
    { href: "program-bulanan", label: "Program Bulanan", icon: "fa-solid fa-calendar-days", grup: "Umum", populer: true, super: false },
    { href: "program-tahunan", label: "Program Tahunan", icon: "fa-solid fa-calendar", grup: "Umum", populer: false, super: false },
    { href: "poster", label: "Poster", icon: "fa-solid fa-newspaper", grup: "Umum", populer: false, super: false },
    { href: "profil", label: "Profil Saya", icon: "fa-solid fa-circle-user", grup: "Umum", populer: false, super: false },
    { href: "absensi", label: "Absensi", icon: "fa-solid fa-clipboard-user", grup: "Sekretaris", populer: false, super: false },
    { href: "notulensi", label: "Notulensi", icon: "fa-solid fa-clipboard-list", grup: "Sekretaris", populer: false, super: false },
    { href: "dokumen", label: "Dokumen", icon: "fa-solid fa-folder-open", grup: "Sekretaris", populer: false, super: false },
    { href: "keuangan", label: "Keuangan", icon: "fa-solid fa-wallet", grup: "Bendahara", populer: false, super: false },
    { href: "tabungan", label: "Tabungan", icon: "fa-solid fa-piggy-bank", grup: "Bendahara", populer: true, super: false },
    { href: "uang-kas", label: "Uang Kas", icon: "fa-solid fa-coins", grup: "Bendahara", populer: true, super: false },
    { href: "akses", label: "Akses", icon: "fa-solid fa-key", super: true, grup: "Super Admin", populer: false },
    { href: "users", label: "Akun OSIS", icon: "fa-solid fa-user-gear", super: true, grup: "Super Admin", populer: false },
    { href: "logs", label: "Logs", icon: "fa-solid fa-clock-rotate-left", super: true, grup: "Super Admin", populer: false },
    { href: "notifikasi", label: "Kirim Notifikasi", icon: "fa-solid fa-paper-plane", super: true, grup: "Super Admin", populer: false },
  ],

  // ---------- HELPER DASAR ----------
  esc(s) {
    if (typeof escapeHtml === "function") return escapeHtml(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  },

  toast(msg, tipe) {
    if (typeof showToast === "function") showToast(msg, tipe || "success");
  },

  async tanya(msg) {
    if (typeof showPopup === "function") return !!(await showPopup(msg, "confirm"));
    return window.confirm(msg);
  },

  klon(v) {
    return JSON.parse(JSON.stringify(v));
  },

  user() {
    try {
      return typeof OsisAuth !== "undefined" && OsisAuth.getUser ? OsisAuth.getUser() : null;
    } catch {
      return null;
    }
  },

  isOsis() {
    const u = this.user();
    return !!(u && u.mode === "osis" && u.id);
  },

  isSuper() {
    try {
      return !!(this.isOsis() && typeof OsisAuth !== "undefined" && OsisAuth.isSuper && OsisAuth.isSuper());
    } catch {
      return false;
    }
  },

  bisa(halaman) {
    try {
      if (!this.isOsis()) return false;
      if (this.isSuper()) return true;
      return !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa(halaman));
    } catch {
      return false;
    }
  },

  siteVal(key) {
    if (Object.prototype.hasOwnProperty.call(this.data.siteMap, key)) {
      return String(this.data.siteMap[key] ?? "");
    }
    return String(this.SITE_DEFAULTS[key] ?? "");
  },

  angkatanAktifLabel() {
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanAktifObj) {
        const o = OsisAuth.getAngkatanAktifObj();
        if (o && (o.nama || o.kode)) return o.nama || o.kode;
      }
      const u = this.user();
      if (u && u.angkatan) return u.angkatan;
    } catch {}
    return "Angkatan Aktif";
  },

  seninDari(tglStr) {
    const s = String(tglStr || "").slice(0, 10);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00") : new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dt = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dt}`;
  },

  fmtBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / (1024 * 1024)).toFixed(2) + " MB";
  },

  // ---------- DAFTAR KATEGORI SESUAI HAK ----------
  kategoriTersedia() {
    const cats = [
      { id: "semua", grup: "Tampilan Cepat", label: "Semua Kategori", icon: "fa-solid fa-layer-group" },
      { id: "akun", grup: "Perangkat & Akun", label: "Akun & Sesi", icon: "fa-solid fa-circle-user" },
      { id: "tampilan", grup: "Perangkat & Akun", label: "Tampilan & Antarmuka", icon: "fa-solid fa-palette" },
      { id: "media", grup: "Perangkat & Akun", label: "Media & Kompresi", icon: "fa-solid fa-photo-film" },
      { id: "notif-pwa", grup: "Perangkat & Akun", label: "Notifikasi & Aplikasi", icon: "fa-solid fa-bell" },
      { id: "penyimpanan", grup: "Perangkat & Akun", label: "Penyimpanan & Data", icon: "fa-solid fa-database" },
    ];

    if (this.bisa("aspirasi") || this.bisa("lagu") || this.bisa("polling") || this.bisa("site")) {
      cats.push({
        id: "fitur-publik",
        grup: "Situs Publik (Root)",
        label: "Sakelar & Kuota Publik",
        icon: "fa-solid fa-toggle-on",
      });
    }
    if (this.bisa("site")) {
      cats.push(
        { id: "identitas", grup: "Situs Publik (Root)", label: "Identitas, Hero & Pembina", icon: "fa-solid fa-wand-magic-sparkles" },
        { id: "visi-logo", grup: "Situs Publik (Root)", label: "Visi, Misi & Makna Logo", icon: "fa-solid fa-shield-halved" },
        { id: "kontak-radio", grup: "Situs Publik (Root)", label: "Kontak & Aturan Radio", icon: "fa-solid fa-share-nodes" },
        { id: "nav-publik", grup: "Situs Publik (Root)", label: "Navigasi Bawah Publik", icon: "fa-solid fa-compass" },
      );
    }

    if (this.isSuper()) {
      cats.push({
        id: "angkatan",
        grup: "Internal OSIS",
        label: "Master Angkatan & Periode",
        icon: "fa-solid fa-graduation-cap",
      });
    }
    if (this.bisa("site")) {
      cats.push({
        id: "nav-osis",
        grup: "Internal OSIS",
        label: "Menu Sidebar OSIS",
        icon: "fa-solid fa-bars-staggered",
      });
    }
    if (this.bisa("absensi")) {
      cats.push({
        id: "modul-absensi",
        grup: "Internal OSIS",
        label: "Konfigurasi Absensi",
        icon: "fa-solid fa-clipboard-user",
      });
    }
    if (this.bisa("uang-kas") || this.bisa("keuangan")) {
      cats.push({
        id: "modul-kas",
        grup: "Internal OSIS",
        label: "Uang Kas & Keuangan",
        icon: "fa-solid fa-coins",
      });
    }
    if (this.bisa("wawancara")) {
      cats.push({
        id: "modul-wawancara",
        grup: "Internal OSIS",
        label: "Template Hasil Wawancara",
        icon: "fa-solid fa-comments",
      });
    }

    return cats;
  },

  // ---------- BOOTSTRAP ----------
  async init() {
    this.bacaKonteksAsal();
    this.pasangLoginBack();
    this.ikatGlobal();

    // Baca hash awal kalau ada (cth: pengaturan#media)
    const hashCat = location.hash.replace(/^#\/?/, "").trim().toLowerCase();
    if (hashCat) this.activeCat = hashCat;

    // Render instan dari state lokal dulu
    this.renderNav();
    this.renderHeroStats();
    this.renderMain();
    this.muatInfoSW();

    // Sinkronkan sesi & hak akses, lalu muat data server bila pengurus OSIS
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.syncAuth) await OsisAuth.syncAuth();
      if (this.isOsis() && typeof OsisAuth.refreshAkses === "function") {
        await OsisAuth.refreshAkses();
      }
    } catch {}

    this.sesuaikanTombolHeader();
    await this.muatSemuaData();
  },

  bacaKonteksAsal() {
    try {
      const p = new URLSearchParams(location.search);
      const from = String(p.get("from") || "").toLowerCase();
      const ref = String(document.referrer || "");
      this.fromOsis = from === "osis" || /\/osis(\/|$)/i.test(ref);
    } catch {
      this.fromOsis = false;
    }
    this.sesuaikanTombolHeader();
  },

  sesuaikanTombolHeader() {
    const isOsis = this.isOsis();
    const dashBtn = document.getElementById("stgDashTopBtn");
    const backBtn = document.getElementById("stgBackTopBtn");
    if (dashBtn) dashBtn.style.display = isOsis ? "" : "none";
    if (backBtn) {
      if (this.fromOsis && isOsis) {
        backBtn.href = "osis/index";
        backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> <span>Kembali ke OSIS</span>';
        if (dashBtn) dashBtn.style.display = "none";
      } else {
        backBtn.href = "index";
        backBtn.innerHTML = '<i class="fa-solid fa-house"></i> <span>Beranda</span>';
      }
    }
  },

  pasangLoginBack() {
    try {
      if (typeof OsisAuth !== "undefined") {
        OsisAuth.simpanBack = function () {
          try {
            sessionStorage.setItem("osis_login_back", "pengaturan");
          } catch {}
        };
        OsisAuth.renderHeader();
      }
    } catch {}
  },

  ikatGlobal() {
    const inp = document.getElementById("stgSearchInput");
    const clr = document.getElementById("stgSearchClear");
    if (inp) {
      inp.addEventListener("input", () => {
        this.searchQ = String(inp.value || "").trim();
        if (clr) clr.hidden = !this.searchQ;
        this.terapkanFilter();
      });
    }
    if (clr) {
      clr.addEventListener("click", () => {
        if (inp) inp.value = "";
        this.searchQ = "";
        clr.hidden = true;
        this.terapkanFilter();
      });
    }
    const btnRef = document.getElementById("stgBtnRefresh");
    if (btnRef) {
      btnRef.addEventListener("click", async () => {
        btnRef.disabled = true;
        await this.muatSemuaData(true);
        btnRef.disabled = false;
        this.toast("Pengaturan diperbarui dari server.", "info");
      });
    }
    const fi = document.getElementById("stgFileInput");
    if (fi) {
      fi.addEventListener("change", () => this.saatFotoDipilih(fi));
    }
    window.addEventListener("tarpan:theme-change", () => {
      this.renderHeroStats();
      const darkSeg = document.querySelectorAll("[data-stg-theme]");
      const isDark = typeof TarpanTheme !== "undefined" && TarpanTheme.isDark ? TarpanTheme.isDark() : false;
      darkSeg.forEach((b) => b.classList.toggle("on", (b.dataset.stgTheme === "dark") === isDark));
    });
  },

  async muatInfoSW() {
    try {
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        this.swReady = true;
      }
      const r = await fetch("sw.js", { cache: "no-store" });
      if (r && r.ok) {
        const t = await r.text();
        const m = String(t).match(/tarpan-v(\d+)/);
        if (m) this.swVersion = "v" + m[1];
      }
    } catch {}
    this.renderHeroStats();
    this.isiAsyncNotifDanSimpan();
  },

  // ---------- MUAT DATA SERVER SESUAI HAK ----------
  async muatSemuaData(force = false) {
    const tasks = [];

    if (this.isOsis()) {
      tasks.push(
        getAngkatanList(force)
          .then((list) => {
            this.data.angkatanList = Array.isArray(list) ? list : [];
          })
          .catch(() => {}),
      );
    }

    if (this.bisa("site") || this.bisa("polling") || this.bisa("wawancara")) {
      tasks.push(
        getSiteContent()
          .then((rows) => {
            const map = {};
            (rows || []).forEach((r) => {
              if (r && r.kunci) map[r.kunci] = r.nilai;
            });
            this.data.siteMap = map;
            if (map.polling_status) this.data.pollingStatus = String(map.polling_status).trim().toUpperCase();
            if (map.polling_judul) this.data.pollingJudul = String(map.polling_judul);
          })
          .catch(() => {}),
      );
    }

    if (this.bisa("aspirasi") || this.bisa("lagu") || this.bisa("site")) {
      tasks.push(
        getSemuaPengaturan()
          .then((p) => {
            this.data.pengaturan = p || {};
          })
          .catch(() => {}),
      );
    }

    if (this.bisa("site")) {
      tasks.push(
        getWebFoto()
          .then((rows) => {
            const map = { ...(typeof FOTO_DEFAULT !== "undefined" ? FOTO_DEFAULT : { logo1: "web/logo1.png", bg: "web/bg.png", pembina: "web/pembina.jpg" }) };
            (rows || []).forEach((r) => {
              if (r && r.kunci && r.path) map[r.kunci] = r.path;
            });
            this.data.webFoto = map;
          })
          .catch(() => {}),
        getBottomnav()
          .then((m) => {
            this.data.bottomnav = m || this.klon(this.BOTTOMNAV_DEFAULT);
            this.state.bnavDraft = this.klon(this.data.bottomnav);
          })
          .catch(() => {
            this.state.bnavDraft = this.klon(this.BOTTOMNAV_DEFAULT);
          }),
        getSidebarMenu("sidebar_menu")
          .then((arr) => {
            this.data.sidebar = Array.isArray(arr) && arr.length ? this.normalisasiSidebar(arr) : this.klon(this.SIDEBAR_DEFAULT);
            this.state.sideDraft = this.klon(this.data.sidebar);
          })
          .catch(() => {
            this.state.sideDraft = this.klon(this.SIDEBAR_DEFAULT);
          }),
      );
    }

    if (this.isSuper() || this.bisa("absensi") || this.bisa("keuangan")) {
      tasks.push(
        getPeriode()
          .then((rows) => {
            this.data.periodeList = Array.isArray(rows) ? rows : [];
            this.state.absPeriodeAktif = this.data.periodeList.filter((p) => p.aktif).map((p) => Number(p.tahun));
          })
          .catch(() => {}),
      );
    }

    if (this.bisa("absensi")) {
      tasks.push(
        getAbsensiConfig()
          .then((cfg) => {
            this.data.absensiCfg = cfg || null;
            this.state.absTahunAktif = cfg && Array.isArray(cfg.tahun_aktif) ? cfg.tahun_aktif.map(Number).filter(Number.isFinite) : [];
            this.state.absTahunDefault = cfg && cfg.tahun_default != null ? Number(cfg.tahun_default) : null;
            this.state.absTambahTahun = [];
          })
          .catch(() => {}),
      );
    }

    if (this.bisa("uang-kas")) {
      tasks.push(this.muatUangKasConfig().catch(() => {}));
    }

    if (this.bisa("keuangan")) {
      tasks.push(
        getSaldoAwal()
          .then((rows) => {
            this.data.saldoAwalList = Array.isArray(rows) ? rows : [];
          })
          .catch(() => {}),
      );
    }

    await Promise.all(tasks);
    this.data.loadedServer = true;

    // Pastikan activeCat valid untuk user saat ini
    const cats = this.kategoriTersedia();
    if (!cats.some((c) => c.id === this.activeCat)) {
      this.activeCat = "akun";
    }

    this.renderNav();
    this.renderHeroStats();
    this.renderMain();
    this.isiAsyncNotifDanSimpan();
  },

  async muatUangKasConfig() {
    const def = {
      nominal_mingguan: 2000,
      tanggal_mulai: this.seninDari(new Date().toISOString().slice(0, 10)),
      minggu_libur: [],
      tarif_riwayat: [],
      catatan: "",
    };
    const { data, error } = await DbScope.queryAngkatan((angId) => {
      let q = supa
        .from("osis_uang_kas_config")
        .select("angkatan_id, nominal_mingguan, tanggal_mulai, minggu_libur, tarif_riwayat, catatan, updated_at")
        .limit(1);
      if (angId) q = q.eq("angkatan_id", angId);
      return q;
    });
    if (error) {
      this.data.uangKasCfg = def;
    } else {
      const row = (data && data[0]) || def;
      this.data.uangKasCfg = {
        nominal_mingguan: Number(row.nominal_mingguan) || 2000,
        tanggal_mulai: row.tanggal_mulai || def.tanggal_mulai,
        minggu_libur: Array.isArray(row.minggu_libur) ? [...row.minggu_libur] : [],
        tarif_riwayat: Array.isArray(row.tarif_riwayat) ? [...row.tarif_riwayat] : [],
        catatan: String(row.catatan || ""),
      };
    }
    this.state.ukLibur = [...this.data.uangKasCfg.minggu_libur];
    this.state.ukRiwayat = this.klon(this.data.uangKasCfg.tarif_riwayat);
  },

  normalisasiSidebar(arr) {
    return (arr || [])
      .map((x) => {
        if (Array.isArray(x)) {
          return {
            href: String(x[0] || "").trim(),
            label: String(x[1] || "").trim(),
            icon: String(x[2] || "fa-solid fa-link").trim(),
            super: x[3] === "super" || x[3] === true,
            grup: "",
            populer: false,
          };
        }
        return {
          href: String((x && x.href) || "").trim(),
          label: String((x && x.label) || "").trim(),
          icon: String((x && x.icon) || "fa-solid fa-link").trim(),
          super: !!(x && (x.super === true || x.super === "super")),
          grup: String((x && x.grup) || "").trim(),
          populer: !!(x && (x.populer === true || x.populer === "true" || x.populer === 1)),
        };
      })
      .filter((x) => x.href && x.label);
  },

  // ---------- RENDER SHELL: HERO STATS & NAV ----------
  renderHeroStats() {
    const box = document.getElementById("stgHeroStats");
    if (!box) return;
    const u = this.user();
    const isDark = typeof TarpanTheme !== "undefined" && TarpanTheme.isDark ? TarpanTheme.isDark() : localStorage.getItem("tarpan_theme") === "dark";
    const chips = [];

    if (u && u.mode === "osis") {
      if (this.isSuper()) {
        chips.push(`<span class="stg-stat-chip is-super"><i class="fa-solid fa-crown"></i> Super Admin · ${this.esc(u.nama || u.username)}</span>`);
      } else {
        chips.push(`<span class="stg-stat-chip is-osis"><i class="fa-solid fa-id-card"></i> Pengurus OSIS · ${this.esc(u.nama || u.username)}</span>`);
      }
      chips.push(`<span class="stg-stat-chip"><i class="fa-solid fa-graduation-cap"></i> Fokus: ${this.esc(this.angkatanAktifLabel())}</span>`);
    } else if (u && u.mode === "biasa") {
      chips.push(`<span class="stg-stat-chip"><i class="fa-solid fa-user"></i> Akun Siswa · @${this.esc(u.username || "-")}</span>`);
    } else {
      chips.push(`<span class="stg-stat-chip"><i class="fa-solid fa-mobile-screen"></i> Mode Tamu (Tersimpan di HP ini)</span>`);
    }

    chips.push(`<span class="stg-stat-chip"><i class="fa-solid ${isDark ? "fa-moon" : "fa-sun"}"></i> Tema ${isDark ? "Gelap" : "Terang"}</span>`);
    chips.push(`<span class="stg-stat-chip"><i class="fa-solid fa-bolt"></i> Cache SW ${this.esc(this.swVersion)}</span>`);
    box.innerHTML = chips.join("");
  },

  renderNav() {
    const nav = document.getElementById("stgNav");
    if (!nav) return;
    const cats = this.kategoriTersedia();
    const groups = [];
    cats.forEach((c) => {
      let g = groups.find((x) => x.nama === c.grup);
      if (!g) {
        g = { nama: c.grup, items: [] };
        groups.push(g);
      }
      g.items.push(c);
    });

    nav.innerHTML = groups
      .map(
        (g) =>
          `<div class="stg-nav-group">` +
          `<div class="stg-nav-group-lbl">${this.esc(g.nama)}</div>` +
          g.items
            .map(
              (c) =>
                `<button type="button" class="stg-nav-btn${this.activeCat === c.id ? " active" : ""}" data-cat="${this.esc(c.id)}">` +
                `<span class="stg-nb-ico"><i class="${this.esc(c.icon)}"></i></span>` +
                `<span class="stg-nb-lbl">${this.esc(c.label)}</span>` +
                `</button>`,
            )
            .join("") +
          `</div>`,
      )
      .join("");

    nav.querySelectorAll(".stg-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.pilihKategori(btn.dataset.cat);
      });
    });
  },

  pilihKategori(catId) {
    this.activeCat = catId || "akun";
    try {
      history.replaceState(null, "", location.pathname + location.search + "#" + this.activeCat);
    } catch {}
    document.querySelectorAll("#stgNav .stg-nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.cat === this.activeCat);
    });
    if (this.searchQ) {
      const inp = document.getElementById("stgSearchInput");
      const clr = document.getElementById("stgSearchClear");
      if (inp) inp.value = "";
      if (clr) clr.hidden = true;
      this.searchQ = "";
    }
    this.terapkanFilter();
    if (window.innerWidth <= 920) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  },

  // ---------- RENDER SEMUA SECTION ----------
  renderMain() {
    const main = document.getElementById("stgMain");
    if (!main) return;

    const parts = [
      this.wrapSec("akun", this.htmlAkun()),
      this.wrapSec("tampilan", this.htmlTampilan()),
      this.wrapSec("media", this.htmlMedia()),
      this.wrapSec("notif-pwa", this.htmlNotifPwa()),
      this.wrapSec("penyimpanan", this.htmlPenyimpanan()),
    ];

    if (this.bisa("aspirasi") || this.bisa("lagu") || this.bisa("polling") || this.bisa("site")) {
      parts.push(this.wrapSec("fitur-publik", this.htmlFiturPublik()));
    }
    if (this.bisa("site")) {
      parts.push(
        this.wrapSec("identitas", this.htmlIdentitas()),
        this.wrapSec("visi-logo", this.htmlVisiLogo()),
        this.wrapSec("kontak-radio", this.htmlKontakRadio()),
        this.wrapSec("nav-publik", this.htmlNavPublik()),
      );
    }
    if (this.isSuper()) {
      parts.push(this.wrapSec("angkatan", this.htmlAngkatan()));
    }
    if (this.bisa("site")) {
      parts.push(this.wrapSec("nav-osis", this.htmlNavOsis()));
    }
    if (this.bisa("absensi")) {
      parts.push(this.wrapSec("modul-absensi", this.htmlModulAbsensi()));
    }
    if (this.bisa("uang-kas") || this.bisa("keuangan")) {
      parts.push(this.wrapSec("modul-kas", this.htmlModulKas()));
    }
    if (this.bisa("wawancara")) {
      parts.push(this.wrapSec("modul-wawancara", this.htmlModulWawancara()));
    }

    parts.push(
      `<div class="stg-empty-search" id="stgEmptySearch" hidden>` +
        `<i class="fa-solid fa-magnifying-glass"></i>` +
        `<h3>Pengaturan tidak ditemukan</h3>` +
        `<p>Tidak ada item pengaturan yang cocok dengan kata kunci tersebut.</p>` +
        `<button type="button" class="btn btn-white btn-sm" id="stgResetSearchBtn"><i class="fa-solid fa-rotate-left"></i> Tampilkan Semua</button>` +
      `</div>`,
    );

    main.innerHTML = parts.join("");
    this.ikatKontrolMain();
    this.terapkanFilter();
  },

  wrapSec(id, innerHtml) {
    return `<section class="stg-section" data-sec="${this.esc(id)}">${innerHtml}</section>`;
  },

  terapkanFilter() {
    const q = String(this.searchQ || "").toLowerCase();
    const countBadge = document.getElementById("stgSearchCount");
    const emptyEl = document.getElementById("stgEmptySearch");
    const secs = document.querySelectorAll("#stgMain .stg-section");

    if (!q) {
      if (countBadge) countBadge.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      secs.forEach((sec) => {
        const show = this.activeCat === "semua" || sec.dataset.sec === this.activeCat;
        sec.hidden = !show;
        sec.querySelectorAll(".stg-card, .stg-row").forEach((el) => {
          el.hidden = false;
        });
      });
      return;
    }

    let cocok = 0;
    secs.forEach((sec) => {
      let adaDiSec = false;
      sec.querySelectorAll(".stg-card").forEach((card) => {
        const rows = card.querySelectorAll(".stg-row");
        const headText = String(card.dataset.kw || "") + " " + String(card.querySelector(".stg-card-head")?.textContent || "");
        const cardHeadMatch = headText.toLowerCase().includes(q);

        if (rows.length > 0 && !cardHeadMatch) {
          let rowHit = 0;
          rows.forEach((r) => {
            const txt = (String(r.dataset.kw || "") + " " + String(r.textContent || "")).toLowerCase();
            const ok = txt.includes(q);
            r.hidden = !ok;
            if (ok) rowHit++;
          });
          card.hidden = rowHit === 0;
          if (rowHit > 0) {
            cocok += rowHit;
            adaDiSec = true;
          }
        } else {
          rows.forEach((r) => { r.hidden = false; });
          let inputVals = "";
          card.querySelectorAll("input[type='text'], input[type='url'], textarea").forEach((i) => {
            inputVals += " " + (i.value || "");
          });
          const fullTxt = (headText + " " + card.textContent + inputVals).toLowerCase();
          const ok = fullTxt.includes(q);
          card.hidden = !ok;
          if (ok) {
            cocok++;
            adaDiSec = true;
          }
        }
      });
      sec.hidden = !adaDiSec;
    });

    if (countBadge) {
      countBadge.hidden = false;
      countBadge.textContent = `${cocok} cocok`;
    }
    if (emptyEl) emptyEl.hidden = cocok > 0;
  },

  // =========================================================================
  // ZONA A: PERANGKAT & AKUN (SEMUA PENGGUNA)
  // =========================================================================

  // 1) AKUN & SESI
  htmlAkun() {
    const u = this.user();
    const akses = typeof OsisAuth !== "undefined" && OsisAuth.getAkses ? OsisAuth.getAkses() : null;
    const lintas = typeof OsisAuth !== "undefined" && OsisAuth.isLintasAngkatan ? OsisAuth.isLintasAngkatan() : false;
    const aktifId = typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanAktif ? OsisAuth.getAngkatanAktif() : null;

    let accHtml = "";
    if (u && u.mode === "osis") {
      const nama = u.nama || u.username || "Pengurus OSIS";
      const inisial = String(nama).trim().charAt(0).toUpperCase() || "O";
      const foto = u.foto ? `<img src="${this.esc(getFoto(u.foto))}" alt="Foto Profil" />` : this.esc(inisial);
      const daftarHak = this.isSuper()
        ? `<span class="stg-mini-tag super"><i class="fa-solid fa-crown"></i> Super Admin (Akses Penuh)</span>`
        : ((akses && Array.isArray(akses.halaman) && akses.halaman.length)
            ? akses.halaman.map((h) => `<span class="stg-mini-tag green">${this.esc(h)}</span>`).join("")
            : `<span class="stg-mini-tag muted">Akses Baca Standar</span>`);

      accHtml =
        `<div class="stg-acc-box">` +
          `<div class="stg-acc-ava">${foto}</div>` +
          `<div class="stg-acc-info">` +
            `<h3>${this.esc(nama)}</h3>` +
            `<p>@${this.esc(u.username || "-")} · ${this.esc(u.jabatan || "Pengurus OSIS")} · ${this.esc(u.angkatan || this.angkatanAktifLabel())}</p>` +
            `<div class="stg-hak-wrap">${daftarHak}</div>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            `<a href="osis/profil" class="btn btn-red btn-sm"><i class="fa-solid fa-user-pen"></i> Edit Profil & Password</a>` +
            `<a href="osis/index" class="btn btn-white btn-sm"><i class="fa-solid fa-grip"></i> Dashboard OSIS</a>` +
            `<button type="button" class="btn btn-white btn-sm" id="stgBtnLogout"><i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar</button>` +
          `</div>` +
        `</div>`;
    } else if (u && u.mode === "biasa") {
      const nama = u.nama || u.username || "Siswa";
      const inisial = String(nama).trim().charAt(0).toUpperCase() || "S";
      accHtml =
        `<div class="stg-acc-box">` +
          `<div class="stg-acc-ava">${this.esc(inisial)}</div>` +
          `<div class="stg-acc-info">` +
            `<h3>${this.esc(nama)}</h3>` +
            `<p>@${this.esc(u.username || "-")} · Akun Siswa Terdaftar (Polling, Feed, Aspirasi)</p>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            `<button type="button" class="btn btn-white btn-sm" id="stgBtnLogout"><i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar</button>` +
          `</div>` +
        `</div>`;
    } else {
      accHtml =
        `<div class="stg-acc-box">` +
          `<div class="stg-acc-ava"><i class="fa-solid fa-user-astronaut"></i></div>` +
          `<div class="stg-acc-info">` +
            `<h3>Belum Masuk Akun</h3>` +
            `<p>Preferensi tampilan, media, notifikasi, dan cache di bawah tetap tersimpan di perangkat ini.</p>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            `<a href="login" class="btn btn-red btn-sm" onclick="OsisAuth.simpanBack()"><i class="fa-solid fa-right-to-bracket"></i> Masuk / Daftar</a>` +
          `</div>` +
        `</div>`;
    }

    let lintasRow = "";
    if (this.isOsis()) {
      if (lintas && this.data.angkatanList.length > 0) {
        const opts = this.data.angkatanList
          .map((a) => {
            const lbl = `${a.nama || a.kode || "Angkatan " + a.id}${a.aktif === false ? " (Arsip)" : ""}`;
            return `<option value="${this.esc(a.id)}"${Number(a.id) === Number(aktifId) ? " selected" : ""}>${this.esc(lbl)}</option>`;
          })
          .join("");
        lintasRow =
          `<div class="stg-rows">` +
            `<div class="stg-row" data-kw="angkatan aktif fokus pindah periode super pembina">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title"><i class="fa-solid fa-layer-group"></i> Fokus Angkatan Aktif</div>` +
                `<div class="stg-row-desc">Menentukan data angkatan mana yang sedang kamu kelola di Dashboard OSIS dan pengaturan modul di halaman ini.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl">` +
                `<select class="stg-sel" id="stgSelAngkatanAktif">${opts}</select>` +
              `</div>` +
            `</div>` +
          `</div>`;
      } else {
        lintasRow =
          `<div class="stg-rows">` +
            `<div class="stg-row" data-kw="angkatan akun terkunci">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title">Angkatan Terdaftar</div>` +
                `<div class="stg-row-desc">Akunmu terikat pada angkatan ini untuk menjaga isolasi data antar-periode.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl"><span class="stg-scope-badge angkatan"><i class="fa-solid fa-lock"></i> ${this.esc(this.angkatanAktifLabel())}</span></div>` +
            `</div>` +
          `</div>`;
      }
    }

    const devId = typeof getDeviceId === "function" ? getDeviceId() : "-";
    const devName = typeof namaPerangkat === "function" ? namaPerangkat() : "Browser";

    return (
      `<article class="stg-card" data-kw="akun profil login logout password sesi angkatan">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico red"><i class="fa-solid fa-id-badge"></i></span>` +
            `<div><h2>Akun &amp; Identitas Sesi</h2><p>Status login, hak kendali halaman, dan fokus angkatan aktif.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge"><i class="fa-solid fa-mobile-screen"></i> Sesi Perangkat</span>` +
        `</div>` +
        accHtml +
        lintasRow +
        `<div class="stg-rows">` +
          `<div class="stg-row" data-kw="id perangkat device fingerprint browser">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Identitas Perangkat</div>` +
              `<div class="stg-row-desc">${this.esc(devName)} · dipakai untuk kuota harian anti-spam &amp; sinkronisasi notif.</div>` +
            `</div>` +
            `<div class="stg-row-ctrl"><span class="stg-kv-pill">ID: <b>${this.esc(String(devId).slice(0, 14))}…</b></span></div>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 2) TAMPILAN & ANTARMUKA
  htmlTampilan() {
    const isDark = typeof TarpanTheme !== "undefined" && TarpanTheme.isDark ? TarpanTheme.isDark() : localStorage.getItem("tarpan_theme") === "dark";
    const agendaView = localStorage.getItem("agenda_view_mode") === "list" ? "list" : "grid";
    const dokView = localStorage.getItem("osis_dokumen_view") === "list" ? "list" : "grid";

    let osisUiRows = "";
    if (this.isOsis()) {
      osisUiRows =
        `<div class="stg-row" data-kw="tampilan agenda grid list daftar kartu">` +
          `<div class="stg-row-info">` +
            `<div class="stg-row-title">Tampilan Bawaan Halaman Agenda</div>` +
            `<div class="stg-row-desc">Pilih gaya tampilan saat membuka halaman Agenda di Dashboard OSIS.</div>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            `<div class="stg-seg" id="stgSegAgendaView">` +
              `<button type="button" data-val="grid" class="${agendaView === "grid" ? "on" : ""}"><i class="fa-solid fa-grip"></i> Kartu Bento</button>` +
              `<button type="button" data-val="list" class="${agendaView === "list" ? "on" : ""}"><i class="fa-solid fa-list"></i> Daftar Padat</button>` +
            `</div>` +
          `</div>` +
        `</div>` +
        `<div class="stg-row" data-kw="tampilan dokumen arsip grid list">` +
          `<div class="stg-row-info">` +
            `<div class="stg-row-title">Tampilan Bawaan Arsip Dokumen</div>` +
            `<div class="stg-row-desc">Pilih tata letak default saat membuka halaman Dokumen OSIS.</div>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            `<div class="stg-seg" id="stgSegDokView">` +
              `<button type="button" data-val="grid" class="${dokView === "grid" ? "on" : ""}"><i class="fa-solid fa-table-cells-large"></i> Grid</button>` +
              `<button type="button" data-val="list" class="${dokView === "list" ? "on" : ""}"><i class="fa-solid fa-bars"></i> Baris</button>` +
            `</div>` +
          `</div>` +
        `</div>`;
    }

    return (
      `<article class="stg-card" data-kw="tampilan tema mode gelap terang dark light ui hint petunjuk">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico"><i class="fa-solid fa-palette"></i></span>` +
            `<div><h2>Tampilan &amp; Antarmuka</h2><p>Sesuaikan warna tema dan tata letak antarmuka di perangkat ini.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge"><i class="fa-solid fa-laptop-mobile"></i> Lokal</span>` +
        `</div>` +
        `<div class="stg-rows">` +
          `<div class="stg-row" data-kw="tema warna mode gelap terang dark mode obsidian">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Tema Warna Aplikasi</div>` +
              `<div class="stg-row-desc">Berlaku otomatis di Beranda publik, halaman standalone, dan seluruh halaman Dashboard OSIS.</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<div class="stg-seg">` +
                `<button type="button" data-stg-theme="light" class="${!isDark ? "on" : ""}"><i class="fa-solid fa-sun"></i> Terang</button>` +
                `<button type="button" data-stg-theme="dark" class="${isDark ? "on" : ""}"><i class="fa-solid fa-moon"></i> Gelap</button>` +
              `</div>` +
            `</div>` +
          `</div>` +
          osisUiRows +
          `<div class="stg-row" data-kw="hint geser swipe panduan menu lainnya tutorial">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Petunjuk Geser &amp; Pemandu Navigasi</div>` +
              `<div class="stg-row-desc">Munculkan kembali animasi petunjuk geser foto galeri, kartu angkatan, dan titik pemandu Menu Lainnya.</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<button type="button" class="btn btn-white btn-sm" id="stgBtnResetHints"><i class="fa-solid fa-rotate-left"></i> Munculkan Ulang</button>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 3) MEDIA, FEED & KOMPRESI
  htmlMedia() {
    const autoPlay = localStorage.getItem("feed_autoplay") !== "0";
    const suaraOn = localStorage.getItem("feed_suara") === "1";
    const adaComp = typeof TarpanCompress !== "undefined";
    const engine = adaComp ? TarpanCompress.getPref() : (localStorage.getItem("tarpan-video-compress") || "auto");
    const res = adaComp ? String(TarpanCompress.getMaxDim()) : (localStorage.getItem("tarpan-video-res") || "1280");
    const tgt = adaComp ? String(TarpanCompress.getTargetMB()) : (localStorage.getItem("tarpan-video-target") || "15");

    return (
      `<article class="stg-card" data-kw="media feed video suara bisu autoplay hemat kuota kompresi resolusi ffmpeg">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico red"><i class="fa-solid fa-photo-film"></i></span>` +
            `<div><h2>Media, Feed &amp; Kompresi Upload</h2><p>Atur pemutaran video di Feed serta kompresi saat mengunggah dokumentasi.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge"><i class="fa-solid fa-laptop-mobile"></i> Lokal</span>` +
        `</div>` +
        `<div class="stg-rows">` +
          `<div class="stg-row" data-kw="putar otomatis video feed autoplay hemat data kuota">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Putar Video Feed Otomatis</div>` +
              `<div class="stg-row-desc">Matikan jika ingin menghemat kuota data (video hanya diputar ketika diketuk).</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<label class="edit-toggle-wrap"><input type="checkbox" id="stgFeedAuto"${autoPlay ? " checked" : ""} autocomplete="off" /><span class="edit-slider"></span></label>` +
            `</div>` +
          `</div>` +
          `<div class="stg-row" data-kw="suara audio video feed mute unmute">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Suara Bawaan Video Feed</div>` +
              `<div class="stg-row-desc">Aktifkan agar video di Feed langsung bersuara saat diputar (jika diizinkan browser).</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<label class="edit-toggle-wrap"><input type="checkbox" id="stgFeedSuara"${suaraOn ? " checked" : ""} autocomplete="off" /><span class="edit-slider"></span></label>` +
            `</div>` +
          `</div>` +
          `<div class="stg-row" data-kw="metode engine kompresi video native ffmpeg mati">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Mesin Kompresi Video Upload</div>` +
              `<div class="stg-row-desc">Native ringan berjalan langsung tanpa unduhan tambahan. FFmpeg mengunduh modul ~30 MB saat pertama dipakai.</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<select class="stg-sel" id="stgCompEngine">` +
                `<option value="auto"${engine === "auto" ? " selected" : ""}>Otomatis (Disarankan)</option>` +
                `<option value="native"${engine === "native" ? " selected" : ""}>Ringan — Native Browser</option>` +
                `<option value="ffmpeg"${engine === "ffmpeg" ? " selected" : ""}>Penuh — FFmpeg WASM</option>` +
                `<option value="off"${engine === "off" ? " selected" : ""}>Mati — Upload File Asli</option>` +
              `</select>` +
            `</div>` +
          `</div>` +
          `<div class="stg-row" data-kw="resolusi video 480p 720p 1080p dimensi">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Batas Resolusi Video</div>` +
              `<div class="stg-row-desc">Ukuran sisi terpanjang hasil kompresi sebelum dikirim ke Cloudflare R2.</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<select class="stg-sel" id="stgCompRes">` +
                `<option value="854"${res === "854" ? " selected" : ""}>480p (854px — Paling Hemat)</option>` +
                `<option value="1280"${res === "1280" ? " selected" : ""}>720p (1280px — Seimbang)</option>` +
                `<option value="1920"${res === "1920" ? " selected" : ""}>1080p (1920px — Paling Tajam)</option>` +
              `</select>` +
            `</div>` +
          `</div>` +
          `<div class="stg-row" data-kw="target ukuran file video mb megabyte">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Target Ukuran Maksimal Video</div>` +
              `<div class="stg-row-desc">Batas usaha ukuran hasil kompresi (batas keras upload video asli tetap 100 MB).</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<select class="stg-sel" id="stgCompTarget">` +
                ["8", "10", "15", "20", "30", "50"]
                  .map((m) => `<option value="${m}"${tgt === m ? " selected" : ""}>Target &lt; ${m} MB</option>`)
                  .join("") +
              `</select>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 4) NOTIFIKASI & PWA
  htmlNotifPwa() {
    const canInstall = typeof PwaInstall !== "undefined" && PwaInstall.tersedia ? !!PwaInstall.tersedia() : false;
    const isStandalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;

    return (
      `<article class="stg-card" data-kw="notifikasi push webpush pwa install aplikasi service worker update changelog">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico green"><i class="fa-solid fa-bell"></i></span>` +
            `<div><h2>Notifikasi &amp; Aplikasi PWA</h2><p>Kelola izin notifikasi HP, instalasi layar utama, dan pembaruan Service Worker.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge"><i class="fa-solid fa-mobile-screen-button"></i> PWA</span>` +
        `</div>` +
        `<div id="stgNotifAsyncBox">` +
          `<div class="loading-block"><div class="spinner"></div>Memeriksa status notifikasi...</div>` +
        `</div>` +
        `<div class="stg-rows">` +
          `<div class="stg-row" data-kw="install aplikasi pwa tambah ke layar utama homescreen">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Aplikasi Layar Utama (PWA)</div>` +
              `<div class="stg-row-desc">${isStandalone ? "Kamu sedang membuka aplikasi dalam mode terinstal penuh." : "Pasang OSIS TARPAN ONE ke layar utama HP/laptop agar terbuka cepat &amp; siap offline."}</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              (isStandalone
                ? `<span class="stg-scope-badge angkatan"><i class="fa-solid fa-check"></i> Terinstal</span>`
                : canInstall
                  ? `<button type="button" class="btn btn-red btn-sm" id="stgBtnInstallPwa"><i class="fa-solid fa-download"></i> Install Aplikasi</button>`
                  : `<span class="stg-kv-pill">Gunakan menu browser: <b>Tambah ke Layar Utama</b></span>`) +
            `</div>` +
          `</div>` +
          `<div class="stg-row" data-kw="service worker versi cache update paksa changelog">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Service Worker &amp; Riwayat Versi</div>` +
              `<div class="stg-row-desc">Cache shell: <b>${this.esc(this.swVersion)}</b> · Status: ${this.swReady ? "Aktif (Siap Offline)" : "Standar Online"}.</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<button type="button" class="btn btn-white btn-sm" id="stgBtnUpdateSw"><i class="fa-solid fa-arrows-rotate"></i> Periksa Update SW</button>` +
              `<a href="changelog" class="btn btn-white btn-sm"><i class="fa-solid fa-clock-rotate-left"></i> Changelog</a>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 5) PENYIMPANAN & DATA LOKAL
  htmlPenyimpanan() {
    return (
      `<article class="stg-card" data-kw="penyimpanan cache offline antrean outbox draft formulir jepun kuis">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico dark"><i class="fa-solid fa-database"></i></span>` +
            `<div><h2>Penyimpanan, Cache &amp; Draft Lokal</h2><p>Pantau pemakaian memori lokal, antrean offline, dan draft form yang tersimpan otomatis.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge"><i class="fa-solid fa-hard-drive"></i> Storage</span>` +
        `</div>` +
        `<div id="stgStorageAsyncBox">` +
          `<div class="loading-block"><div class="spinner"></div>Menghitung rincian penyimpanan...</div>` +
        `</div>` +
      `</article>` +
      `<article class="stg-card danger-zone" data-kw="reset preferensi hapus data lokal wipe bahaya keluar">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico red"><i class="fa-solid fa-triangle-exclamation"></i></span>` +
            `<div><h2>Reset &amp; Pembersihan Perangkat</h2><p>Kembalikan setelan tampilan ke awal atau bersihkan seluruh jejak lokal di perangkat ini.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge"><i class="fa-solid fa-broom"></i> Perangkat Ini</span>` +
        `</div>` +
        `<div class="stg-rows">` +
          `<div class="stg-row" data-kw="reset preferensi tampilan kompresi default">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Kembalikan Preferensi Perangkat ke Bawaan</div>` +
              `<div class="stg-row-desc">Mereset tema, suara/autoplay feed, dan setelan kompresi video tanpa mengeluarkan akunmu.</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<button type="button" class="btn btn-white btn-sm" id="stgBtnResetPrefs"><i class="fa-solid fa-rotate-left"></i> Reset Preferensi</button>` +
            `</div>` +
          `</div>` +
          `<div class="stg-row" data-kw="hapus semua data lokal wipe indexeddb localstorage">` +
            `<div class="stg-row-info">` +
              `<div class="stg-row-title">Hapus Seluruh Data Lokal Perangkat</div>` +
              `<div class="stg-row-desc">Menghapus sesi login, semua cache offline, draft form, dan antrean Outbox di HP/browser ini (data di server tetap aman).</div>` +
            `</div>` +
            `<div class="stg-row-ctrl">` +
              `<button type="button" class="btn btn-red btn-sm" id="stgBtnWipeAll"><i class="fa-solid fa-trash-can"></i> Hapus Total Lokal</button>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // =========================================================================
  // ZONA B: PENGATURAN SITUS PUBLIK / ROOT INDEX.HTML (SERVER DB)
  // =========================================================================

  // 6) SAKELAR & KUOTA FITUR PUBLIK
  htmlFiturPublik() {
    const p = this.data.pengaturan || {};
    const aspBuka = String(p.status_aspirasi || "BUKA").toUpperCase() !== "TUTUP";
    const laguBuka = String(p.status_lagu || "BUKA").toUpperCase() !== "TUTUP";
    const batasAsp = p.batas_harian_aspirasi != null ? String(p.batas_harian_aspirasi) : "1";
    const batasLagu = p.batas_harian_lagu != null ? String(p.batas_harian_lagu) : "1";
    const polBuka = String(this.data.pollingStatus || "BUKA").toUpperCase() !== "TUTUP";
    const polJudul = this.data.pollingJudul || "Polling Wakil Ketua OSIS";

    const cards = [];

    if (this.bisa("aspirasi") || this.bisa("site")) {
      cards.push(
        `<article class="stg-card" data-kw="sakelar kotak aspirasi buka tutup batas harian kuota suara siswa">` +
          `<div class="stg-card-head">` +
            `<div class="stg-card-title-wrap">` +
              `<span class="stg-card-ico red"><i class="fa-solid fa-inbox"></i></span>` +
              `<div><h2>Kotak Aspirasi Siswa</h2><p>Atur status penerimaan aspirasi publik dan batas pengiriman harian per perangkat.</p></div>` +
            `</div>` +
            `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
          `</div>` +
          `<div class="stg-rows">` +
            `<div class="stg-row" data-kw="status kotak aspirasi buka tutup kunci formulir">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title">Status Formulir Aspirasi</div>` +
                `<div class="stg-row-desc">Jika ditutup, siswa tidak dapat mengirim aspirasi baru namun arsip aspirasi publik tetap dapat dibaca.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl">` +
                `<div class="stg-seg" id="stgSegStatusAsp">` +
                  `<button type="button" data-val="BUKA" class="${aspBuka ? "on" : ""}"><i class="fa-solid fa-unlock"></i> Dibuka</button>` +
                  `<button type="button" data-val="TUTUP" class="${!aspBuka ? "on" : ""}"><i class="fa-solid fa-lock"></i> Ditutup</button>` +
                `</div>` +
              `</div>` +
            `</div>` +
            `<div class="stg-row" data-kw="batas kuota harian aspirasi per perangkat anti spam">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title">Batas Kirim Aspirasi Harian (Per Perangkat)</div>` +
                `<div class="stg-row-desc">Jumlah maksimal aspirasi per HP dalam 1 hari WIB. Pilih "Tanpa Batas" hanya saat sesi diskusi terbuka.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl">` +
                `<select class="stg-sel" id="stgSelBatasAsp">` +
                  [["1", "1x / hari (Ketat)"], ["2", "2x / hari"], ["3", "3x / hari"], ["5", "5x / hari"], ["10", "10x / hari"], ["0", "Tanpa Batas Harian"]]
                    .map(([v, l]) => `<option value="${v}"${batasAsp === v ? " selected" : ""}>${l}</option>`)
                    .join("") +
                `</select>` +
              `</div>` +
            `</div>` +
          `</div>` +
        `</article>`,
      );
    }

    if (this.bisa("lagu") || this.bisa("site")) {
      cards.push(
        `<article class="stg-card" data-kw="sakelar request lagu radio jam istirahat buka tutup batas harian">` +
          `<div class="stg-card-head">` +
            `<div class="stg-card-title-wrap">` +
              `<span class="stg-card-ico"><i class="fa-solid fa-music"></i></span>` +
              `<div><h2>Request Lagu (Radio Istirahat)</h2><p>Atur buka/tutup antrean request lagu dan jatah request harian tiap siswa.</p></div>` +
            `</div>` +
            `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
          `</div>` +
          `<div class="stg-rows">` +
            `<div class="stg-row" data-kw="status form request lagu buka tutup">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title">Status Form Request Lagu</div>` +
                `<div class="stg-row-desc">Tutup sementara saat libur sekolah, ujian, atau ketika antrean playlist radio sedang penuh.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl">` +
                `<div class="stg-seg" id="stgSegStatusLagu">` +
                  `<button type="button" data-val="BUKA" class="${laguBuka ? "on" : ""}"><i class="fa-solid fa-unlock"></i> Dibuka</button>` +
                  `<button type="button" data-val="TUTUP" class="${!laguBuka ? "on" : ""}"><i class="fa-solid fa-lock"></i> Ditutup</button>` +
                `</div>` +
              `</div>` +
            `</div>` +
            `<div class="stg-row" data-kw="batas kuota harian request lagu per perangkat">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title">Batas Request Lagu Harian (Per Perangkat)</div>` +
                `<div class="stg-row-desc">Mencegah satu perangkat mendominasi antrean lagu jam istirahat.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl">` +
                `<select class="stg-sel" id="stgSelBatasLagu">` +
                  [["1", "1 lagu / hari (Standar)"], ["2", "2 lagu / hari"], ["3", "3 lagu / hari"], ["5", "5 lagu / hari"], ["10", "10 lagu / hari"], ["0", "Tanpa Batas Harian"]]
                    .map(([v, l]) => `<option value="${v}"${batasLagu === v ? " selected" : ""}>${l}</option>`)
                    .join("") +
                `</select>` +
              `</div>` +
            `</div>` +
          `</div>` +
        `</article>`,
      );
    }

    if (this.bisa("polling") || this.bisa("site")) {
      cards.push(
        `<article class="stg-card" data-kw="polling evoting pemilihan waketos ketua osis buka tutup judul">` +
          `<div class="stg-card-head">` +
            `<div class="stg-card-title-wrap">` +
              `<span class="stg-card-ico green"><i class="fa-solid fa-check-to-slot"></i></span>` +
              `<div><h2>E-Voting / Polling OSIS</h2><p>Kontrol bilik suara di halaman polling.html secara real-time.</p></div>` +
            `</div>` +
            `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
          `</div>` +
          `<div class="stg-rows">` +
            `<div class="stg-row" data-kw="status bilik suara polling buka tutup">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title">Status Pemungutan Suara</div>` +
                `<div class="stg-row-desc">Saat ditutup, pemilih tidak bisa memberikan atau mengubah suara lagi.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl">` +
                `<div class="stg-seg" id="stgSegStatusPol">` +
                  `<button type="button" data-val="BUKA" class="${polBuka ? "on" : ""}"><i class="fa-solid fa-unlock"></i> Dibuka</button>` +
                  `<button type="button" data-val="TUTUP" class="${!polBuka ? "on" : ""}"><i class="fa-solid fa-lock"></i> Ditutup</button>` +
                `</div>` +
              `</div>` +
            `</div>` +
          `</div>` +
          `<div class="stg-grid-2">` +
            `<div class="stg-field full">` +
              `<label for="stgInpPolJudul">Judul Halaman Polling <small>polling_judul</small></label>` +
              `<input type="text" class="stg-inp" id="stgInpPolJudul" maxlength="100" value="${this.esc(polJudul)}" />` +
            `</div>` +
          `</div>` +
          `<div class="stg-foot-bar">` +
            `<a href="polling" class="btn btn-white btn-sm"><i class="fa-solid fa-up-right-from-square"></i> Buka Halaman Polling &amp; Kandidat</a>` +
            `<div class="stg-foot-acts">` +
              `<button type="button" class="btn btn-red btn-sm" id="stgBtnSavePolJudul"><i class="fa-solid fa-floppy-disk"></i> Simpan Judul Polling</button>` +
            `</div>` +
          `</div>` +
        `</article>`,
      );
    }

    return cards.join("");
  },

  // 7) IDENTITAS VISUAL, HERO & PEMBINA
  htmlIdentitas() {
    const wf = this.data.webFoto || {};
    const fotos = [
      { key: "logo1", title: "Logo Utama OSIS", path: wf.logo1 || "web/logo1.png", cover: false },
      { key: "pembina", title: "Foto Pembina OSIS", path: wf.pembina || "web/pembina.jpg", cover: true },
      { key: "bg", title: "Gambar Latar (BG)", path: wf.bg || "web/bg.png", cover: true },
    ];

    return (
      `<article class="stg-card" data-kw="foto gambar logo pembina background r2 identitas visual">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico red"><i class="fa-solid fa-images"></i></span>` +
            `<div><h2>Foto Identitas Web Utama</h2><p>Ganti logo organisasi, foto pembina, dan latar web (diunggah otomatis ke Cloudflare R2).</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-cloud-arrow-up"></i> R2 Media</span>` +
        `</div>` +
        `<div class="stg-photo-grid">` +
          fotos
            .map(
              (f) =>
                `<div class="stg-photo-card">` +
                  `<div class="stg-photo-prev${f.cover ? " cover" : ""}"><img src="${this.esc(getFoto(f.path))}" alt="${this.esc(f.title)}" /></div>` +
                  `<div class="stg-photo-meta"><b>${this.esc(f.title)}</b><small>${this.esc(f.path)}</small></div>` +
                  `<button type="button" class="btn btn-white btn-sm" data-pick-foto="${this.esc(f.key)}"><i class="fa-solid fa-camera"></i> Ganti Foto</button>` +
                `</div>`,
            )
            .join("") +
        `</div>` +
      `</article>` +
      `<article class="stg-card" data-kw="hero beranda judul tagline badge slogan pembina prestasi footer versi">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico"><i class="fa-solid fa-wand-magic-sparkles"></i></span>` +
            `<div><h2>Teks Hero, Pembina &amp; Banner Beranda</h2><p>Seluruh teks utama yang tampil di halaman depan index.html.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
        `</div>` +
        `<div class="stg-grid-3">` +
          this.fieldSite("hero_line1", "Judul Hero Baris 1") +
          this.fieldSite("hero_line2", "Judul Hero Baris 2 (Outline)") +
          this.fieldSite("hero_line3", "Judul Hero Baris 3 (Merah)") +
        `</div>` +
        `<div class="stg-grid-2">` +
          this.fieldSite("hero_badge", "Badge Atas Hero") +
          this.fieldSite("footer_version", "Label Versi di Footer") +
          this.fieldSite("hero_tagline", "Tagline / Deskripsi Hero", true) +
        `</div>` +
        `<div class="stg-grid-2">` +
          this.fieldSite("pembina_name", "Nama Pembina OSIS") +
          this.fieldSite("pembina_jabatan", "Masa Jabatan Pembina") +
          this.fieldSite("pembina_quote", "Kutipan / Pesan Pembina", true) +
        `</div>` +
        `<div class="stg-grid-2">` +
          this.fieldSite("prestasi_banner_title", "Judul Banner Prestasi") +
          this.fieldSite("prestasi_banner_desc", "Deskripsi Banner Prestasi") +
        `</div>` +
        `<div class="stg-foot-bar">` +
          `<span class="stg-foot-hint">Perubahan langsung tampil untuk semua pengunjung beranda.</span>` +
          `<div class="stg-foot-acts">` +
            `<button type="button" class="btn btn-red btn-sm" data-save-site-group="identitas"><i class="fa-solid fa-floppy-disk"></i> Simpan Identitas &amp; Beranda</button>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 8) VISI, MISI & MAKNA LOGO
  htmlVisiLogo() {
    const misiBoxes = [1, 2, 3, 4]
      .map((n) => {
        const key = "misi_" + n;
        const open = !!this.state.subOpen[key];
        return (
          `<div class="stg-sub-box${open ? " open" : ""}" data-sub-box="${key}">` +
            `<button type="button" class="stg-sub-head" data-sub-toggle="${key}">` +
              `<span><b class="stg-sub-num">0${n}</b> Misi ${n}: ${this.esc(this.siteVal(`misi_${n}_title`))}</span>` +
              `<i class="fa-solid fa-chevron-down stg-sub-chev"></i>` +
            `</button>` +
            `<div class="stg-sub-body">` +
              `<div class="stg-grid-2">` +
                this.fieldSite(`misi_${n}_title`, `Judul Misi 0${n}`, false, "visimisi") +
                this.fieldSite(`misi_${n}_desc`, `Penjelasan Misi 0${n}`, true, "visimisi") +
              `</div>` +
            `</div>` +
          `</div>`
        );
      })
      .join("");

    const logoBoxes = [1, 2, 3, 4, 5, 6, 7, 8]
      .map((n) => {
        const key = "logo_" + n;
        const open = !!this.state.subOpen[key];
        return (
          `<div class="stg-sub-box${open ? " open" : ""}" data-sub-box="${key}">` +
            `<button type="button" class="stg-sub-head" data-sub-toggle="${key}">` +
              `<span><b class="stg-sub-num">0${n}</b> Elemen Logo ${n}: ${this.esc(this.siteVal(`logo_${n}_title`))}</span>` +
              `<i class="fa-solid fa-chevron-down stg-sub-chev"></i>` +
            `</button>` +
            `<div class="stg-sub-body">` +
              `<div class="stg-grid-2">` +
                this.fieldSite(`logo_${n}_title`, `Nama Elemen 0${n}`, false, "maknalogo") +
                this.fieldSite(`logo_${n}_mdesc`, `Deskripsi Ringkas (Layar HP)`, false, "maknalogo") +
                this.fieldSite(`logo_${n}_desc`, `Deskripsi Lengkap (Desktop)`, true, "maknalogo") +
              `</div>` +
            `</div>` +
          `</div>`
        );
      })
      .join("");

    return (
      `<article class="stg-card" data-kw="visi misi organisasi tujuan pilar">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico red"><i class="fa-solid fa-bullseye"></i></span>` +
            `<div><h2>Visi &amp; 4 Pilar Misi OSIS</h2><p>Arah tujuan dan misi utama organisasi di halaman depan.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
        `</div>` +
        `<div class="stg-grid-2">${this.fieldSite("visi_text", "Teks Visi Utama", true, "visimisi")}</div>` +
        `<div class="stg-sub-list">${misiBoxes}</div>` +
        `<div class="stg-foot-bar">` +
          `<span class="stg-foot-hint">Klik baris Misi 01–04 untuk membuka rinciannya.</span>` +
          `<div class="stg-foot-acts">` +
            `<button type="button" class="btn btn-red btn-sm" data-save-site-group="visimisi"><i class="fa-solid fa-floppy-disk"></i> Simpan Visi &amp; Misi</button>` +
          `</div>` +
        `</div>` +
      `</article>` +
      `<article class="stg-card" data-kw="makna arti filosofi logo perisai bintang padi kapas obor sayap">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico"><i class="fa-solid fa-shield-halved"></i></span>` +
            `<div><h2>Makna 8 Elemen Logo OSIS</h2><p>Ubah pengantar dan arti tiap bagian lambang OSIS (versi desktop &amp; ringkas mobile).</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
        `</div>` +
        `<div class="stg-grid-2">${this.fieldSite("logo_makna_desc", "Pengantar Seksi Makna Logo", true, "maknalogo")}</div>` +
        `<div class="stg-sub-list">${logoBoxes}</div>` +
        `<div class="stg-foot-bar">` +
          `<span class="stg-foot-hint">Tersimpan ke tabel site_content.</span>` +
          `<div class="stg-foot-acts">` +
            `<button type="button" class="btn btn-red btn-sm" data-save-site-group="maknalogo"><i class="fa-solid fa-floppy-disk"></i> Simpan Makna Logo</button>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 9) KONTAK SOSMED & ATURAN RADIO
  htmlKontakRadio() {
    const socials = [
      ["ig", "Instagram", "fa-brands fa-instagram"],
      ["tt", "TikTok", "fa-brands fa-tiktok"],
      ["yt", "YouTube", "fa-brands fa-youtube"],
      ["wa", "Saluran WhatsApp", "fa-brands fa-whatsapp"],
      ["email", "Email Resmi", "fa-solid fa-envelope"],
    ];

    const socHtml = socials
      .map(([k, lbl, ico]) => {
        const boxKey = "soc_" + k;
        const open = !!this.state.subOpen[boxKey];
        return (
          `<div class="stg-sub-box${open ? " open" : ""}" data-sub-box="${boxKey}">` +
            `<button type="button" class="stg-sub-head" data-sub-toggle="${boxKey}">` +
              `<span><i class="${ico}"></i> ${lbl} · <small>${this.esc(this.siteVal(`kontak_${k}_handle`))}</small></span>` +
              `<i class="fa-solid fa-chevron-down stg-sub-chev"></i>` +
            `</button>` +
            `<div class="stg-sub-body">` +
              `<div class="stg-grid-2">` +
                this.fieldSite(`kontak_${k}_handle`, `Teks Handle ${lbl}`, false, "kontak") +
                this.fieldSite(`kontak_${k}_url`, `URL Tautan ${lbl} (https:// atau mailto:)`, false, "kontak") +
              `</div>` +
            `</div>` +
          `</div>`
        );
      })
      .join("");

    const rulesHtml = [1, 2, 3]
      .map((n) => {
        const boxKey = "rule_" + n;
        const open = !!this.state.subOpen[boxKey];
        return (
          `<div class="stg-sub-box${open ? " open" : ""}" data-sub-box="${boxKey}">` +
            `<button type="button" class="stg-sub-head" data-sub-toggle="${boxKey}">` +
              `<span><b class="stg-sub-num">0${n}</b> ${this.esc(this.siteVal(`musik_rule_${n}_title`))}</span>` +
              `<i class="fa-solid fa-chevron-down stg-sub-chev"></i>` +
            `</button>` +
            `<div class="stg-sub-body">` +
              `<div class="stg-grid-2">` +
                this.fieldSite(`musik_rule_${n}_title`, `Judul Aturan 0${n}`, false, "radio") +
                this.fieldSite(`musik_rule_${n}_desc`, `Isi Aturan 0${n}`, true, "radio") +
              `</div>` +
            `</div>` +
          `</div>`
        );
      })
      .join("");

    return (
      `<article class="stg-card" data-kw="kontak sosial media instagram tiktok youtube whatsapp email link handle">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico green"><i class="fa-solid fa-share-nodes"></i></span>` +
            `<div><h2>Kontak &amp; Sosial Media Resmi</h2><p>Tautan dan nama akun di halaman Kontak publik.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
        `</div>` +
        `<div class="stg-sub-list">${socHtml}</div>` +
        `<div class="stg-foot-bar">` +
          `<span class="stg-foot-hint">Pastikan URL diawali https:// (atau mailto: untuk email).</span>` +
          `<div class="stg-foot-acts">` +
            `<button type="button" class="btn btn-red btn-sm" data-save-site-group="kontak"><i class="fa-solid fa-floppy-disk"></i> Simpan Kontak</button>` +
          `</div>` +
        `</div>` +
      `</article>` +
      `<article class="stg-card" data-kw="aturan radio musik request lagu sopan expired catatan">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico"><i class="fa-solid fa-tower-broadcast"></i></span>` +
            `<div><h2>Teks Aturan Radio Jam Istirahat</h2><p>Panduan yang dibaca siswa sebelum mengirim request lagu.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
        `</div>` +
        `<div class="stg-sub-list">${rulesHtml}</div>` +
        `<div class="stg-grid-2">` +
          this.fieldSite("musik_rule_note_tag", "Label Catatan Kaki", false, "radio") +
          this.fieldSite("musik_rule_note", "Isi Catatan Kaki Radio", true, "radio") +
        `</div>` +
        `<div class="stg-foot-bar">` +
          `<span class="stg-foot-hint">Berlaku di tab Request Lagu situs publik.</span>` +
          `<div class="stg-foot-acts">` +
            `<button type="button" class="btn btn-red btn-sm" data-save-site-group="radio"><i class="fa-solid fa-floppy-disk"></i> Simpan Aturan Radio</button>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  fieldSite(key, label, multiline = false, group = "identitas") {
    const val = this.siteVal(key);
    if (multiline) {
      return (
        `<div class="stg-field full">` +
          `<label>${this.esc(label)} <small>${this.esc(key)}</small></label>` +
          `<textarea class="stg-ta" data-site-key="${this.esc(key)}" data-site-grp="${this.esc(group)}" maxlength="2000">${this.esc(val)}</textarea>` +
        `</div>`
      );
    }
    return (
      `<div class="stg-field">` +
        `<label>${this.esc(label)} <small>${this.esc(key)}</small></label>` +
        `<input type="text" class="stg-inp" data-site-key="${this.esc(key)}" data-site-grp="${this.esc(group)}" maxlength="500" value="${this.esc(val)}" />` +
      `</div>`
    );
  },

  // 10) NAVIGASI BAWAH PUBLIK (BOTTOMNAV)
  htmlNavPublik() {
    const d = this.state.bnavDraft || this.klon(this.BOTTOMNAV_DEFAULT);
    return (
      `<article class="stg-card" data-kw="navigasi bawah publik bottomnav tab menu lainnya sheet">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico red"><i class="fa-solid fa-compass"></i></span>` +
            `<div><h2>Susunan Navigasi Situs Publik</h2><p>Atur 4 tab utama bawah dan daftar Menu Lainnya di index.html untuk seluruh pengunjung.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Publik Global</span>` +
        `</div>` +
        `<div class="stg-row-title"><i class="fa-solid fa-grip-lines"></i> Tab Utama Bawah (${(d.tabs || []).length}/4)</div>` +
        `<div class="stg-list">${(d.tabs || []).map((it, i) => this.htmlBnavRow(it, "tabs", i)).join("")}</div>` +
        `<div><button type="button" class="btn btn-white btn-sm" id="stgBnavAddTab"><i class="fa-solid fa-plus"></i> Tambah Tab Bawah</button></div>` +
        `<div class="stg-row-title" style="margin-top:6px"><i class="fa-solid fa-table-cells-large"></i> Sheet Menu Lainnya (${(d.sheet || []).length}/12)</div>` +
        `<div class="stg-list">${(d.sheet || []).map((it, i) => this.htmlBnavRow(it, "sheet", i)).join("")}</div>` +
        `<div class="stg-row-ctrl" style="justify-content:flex-start">` +
          `<button type="button" class="btn btn-white btn-sm" id="stgBnavAddSheetRoute"><i class="fa-solid fa-plus"></i> Tambah Rute Internal</button>` +
          `<button type="button" class="btn btn-white btn-sm" id="stgBnavAddSheetHref"><i class="fa-solid fa-link"></i> Tambah Link Luar / Halaman</button>` +
        `</div>` +
        `<div class="stg-foot-bar">` +
          `<button type="button" class="btn btn-white btn-sm" id="stgBnavReset"><i class="fa-solid fa-rotate-left"></i> Kembalikan ke Bawaan</button>` +
          `<div class="stg-foot-acts">` +
            `<button type="button" class="btn btn-red btn-sm" id="stgBnavSave"><i class="fa-solid fa-floppy-disk"></i> Simpan Navigasi Publik</button>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  htmlBnavRow(it, sek, i) {
    const list = sek === "tabs" ? this.state.bnavDraft.tabs : this.state.bnavDraft.sheet;
    const key = sek + ":" + i;
    const isEdit = this.state.bnavEditKey === key;
    const sub = it.route ? `#/${it.route}` : it.href || "";

    let editor = "";
    if (isEdit) {
      const dipakai = []
        .concat(this.state.bnavDraft.tabs || [], this.state.bnavDraft.sheet || [])
        .map((x) => x.route)
        .filter((r) => r && r !== it.route);
      const routeOpts = this.PUBLIC_ROUTES.filter(([r]) => !dipakai.includes(r))
        .map(([r, lbl]) => `<option value="${r}"${r === it.route ? " selected" : ""}>${lbl} (#/${r})</option>`)
        .join("");

      editor =
        `<div class="stg-inline-editor">` +
          `<div class="stg-grid-2">` +
            (it.href
              ? `<div class="stg-field"><label>URL Link (https:// atau mailto:)</label><input type="text" class="stg-inp" id="stgBnHref" value="${this.esc(it.href)}" /></div>`
              : `<div class="stg-field"><label>Rute View</label><select class="stg-sel" id="stgBnRoute">${routeOpts}</select></div>`) +
            `<div class="stg-field"><label>Label (maks 20 huruf)</label><input type="text" class="stg-inp" id="stgBnLabel" maxlength="20" value="${this.esc(it.label || "")}" /></div>` +
            `<div class="stg-field"><label>Kelas Ikon FontAwesome</label><input type="text" class="stg-inp" id="stgBnIcon" maxlength="80" value="${this.esc(it.icon || "fa-solid fa-link")}" /></div>` +
            (sek === "sheet"
              ? `<div class="stg-field"><label>Nama Pendek (maks 12)</label><input type="text" class="stg-inp" id="stgBnShort" maxlength="12" value="${this.esc(it.short || "")}" /></div>` +
                `<div class="stg-field full"><label>Sub-judul Kartu (maks 40)</label><input type="text" class="stg-inp" id="stgBnSub" maxlength="40" value="${this.esc(it.sub || "")}" /></div>`
              : "") +
          `</div>` +
          `<div class="stg-foot-acts" style="margin-top:10px">` +
            `<button type="button" class="btn btn-white btn-sm" data-bnav-cancel="1">Batal</button>` +
            `<button type="button" class="btn btn-red btn-sm" data-bnav-apply="${key}"><i class="fa-solid fa-check"></i> Terapkan Baris</button>` +
          `</div>` +
        `</div>`;
    }

    return (
      `<div class="stg-item">` +
        `<span class="stg-item-ico"><i class="${this.esc(it.icon || "fa-solid fa-link")}"></i></span>` +
        `<div class="stg-item-body"><b>${this.esc(it.label)}</b><small>${this.esc(sub)}${it.sub ? " · " + this.esc(it.sub) : ""}</small></div>` +
        `<div class="stg-item-acts">` +
          `<button type="button" class="stg-ico-btn" title="Geser Naik" data-bnav-move="${key}:-1" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>` +
          `<button type="button" class="stg-ico-btn" title="Geser Turun" data-bnav-move="${key}:1" ${i === list.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>` +
          `<button type="button" class="stg-ico-btn" title="Pindah ke ${sek === "tabs" ? "Menu Lainnya" : "Tab Bawah"}" data-bnav-swap="${key}"><i class="fa-solid fa-right-left"></i></button>` +
          `<button type="button" class="stg-ico-btn" title="Ubah" data-bnav-edit="${key}"><i class="fa-solid fa-pen"></i></button>` +
          `<button type="button" class="stg-ico-btn del" title="Hapus" data-bnav-del="${key}"><i class="fa-solid fa-trash"></i></button>` +
        `</div>` +
        editor +
      `</div>`
    );
  },

  // =========================================================================
  // ZONA C: PENGATURAN INTERNAL DASHBOARD OSIS (SERVER DB)
  // =========================================================================

  // 11) MASTER ANGKATAN & PERIODE (SUPER ADMIN)
  htmlAngkatan() {
    const list = this.data.angkatanList || [];
    const editObj = this.state.angEditId
      ? list.find((a) => Number(a.id) === Number(this.state.angEditId))
      : null;

    return (
      `<article class="stg-card" data-kw="master angkatan adiabi kode tahun arsip tambah hapus super admin">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico dark"><i class="fa-solid fa-graduation-cap"></i></span>` +
            `<div><h2>Master Angkatan Organisasi</h2><p>Kelola daftar angkatan kepengurusan untuk isolasi data kas, absensi, proker, dan wawancara.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge super"><i class="fa-solid fa-crown"></i> Super Admin</span>` +
        `</div>` +
        `<div class="stg-list">` +
          (list.length
            ? list
                .map(
                  (a) =>
                    `<div class="stg-item">` +
                      `<span class="stg-item-ico"><i class="fa-solid ${a.aktif ? "fa-star" : "fa-box-archive"}"></i></span>` +
                      `<div class="stg-item-body">` +
                        `<b>${this.esc(a.nama)} <span class="stg-mini-tag ${a.aktif ? "green" : "muted"}">${a.aktif ? "Aktif" : "Arsip"}</span></b>` +
                        `<small>Kode: ${this.esc(a.kode)} · Tahun: ${a.tahun || "-"} · Urutan: ${a.urutan ?? 0}</small>` +
                      `</div>` +
                      `<div class="stg-item-acts">` +
                        `<button type="button" class="stg-ico-btn" title="Edit Angkatan" data-ang-edit="${a.id}"><i class="fa-solid fa-pen"></i></button>` +
                        `<button type="button" class="stg-ico-btn del" title="Hapus Angkatan (jika kosong)" data-ang-del="${a.id}"><i class="fa-solid fa-trash"></i></button>` +
                      `</div>` +
                    `</div>`,
                )
                .join("")
            : `<div class="pesan-empty">Belum ada data angkatan.</div>`) +
        `</div>` +
        `<div class="stg-sub-box open">` +
          `<div class="stg-sub-head" style="cursor:default"><span><i class="fa-solid ${editObj ? "fa-pen" : "fa-plus"}"></i> ${editObj ? "Edit Angkatan: " + this.esc(editObj.nama) : "Tambah Angkatan Baru"}</span></div>` +
          `<div class="stg-sub-body" style="display:block">` +
            `<div class="stg-grid-2">` +
              `<div class="stg-field"><label>Kode Unik (A-Z, 0-9, strip)</label><input type="text" class="stg-inp" id="stgAngKode" placeholder="Cth: ADIABI-5" value="${this.esc(editObj ? editObj.kode : "")}" /></div>` +
              `<div class="stg-field"><label>Nama Tampil Angkatan</label><input type="text" class="stg-inp" id="stgAngNama" placeholder="Cth: ADIABI JILID 5" value="${this.esc(editObj ? editObj.nama : "")}" /></div>` +
              `<div class="stg-field"><label>Tahun Periode (opsional)</label><input type="number" class="stg-inp" id="stgAngTahun" min="2010" max="2100" placeholder="Cth: 2027" value="${this.esc(editObj && editObj.tahun ? editObj.tahun : "")}" /></div>` +
              `<div class="stg-field"><label>Urutan Tampil</label><input type="number" class="stg-inp" id="stgAngUrutan" value="${this.esc(editObj ? editObj.urutan ?? 0 : (list.length + 1))}" /></div>` +
            `</div>` +
            `<div class="stg-rows" style="margin-top:8px">` +
              `<div class="stg-row">` +
                `<div class="stg-row-info"><div class="stg-row-title">Status Angkatan Aktif</div><div class="stg-row-desc">Matikan untuk menandai angkatan lama sebagai Arsip.</div></div>` +
                `<div class="stg-row-ctrl"><label class="edit-toggle-wrap"><input type="checkbox" id="stgAngAktif"${!editObj || editObj.aktif !== false ? " checked" : ""} /><span class="edit-slider"></span></label></div>` +
              `</div>` +
            `</div>` +
            `<div class="stg-foot-acts" style="margin-top:10px">` +
              (editObj ? `<button type="button" class="btn btn-white btn-sm" id="stgAngCancel">Batal Edit</button>` : "") +
              `<button type="button" class="btn btn-red btn-sm" id="stgAngSave"><i class="fa-solid fa-floppy-disk"></i> ${editObj ? "Simpan Perubahan" : "Tambah Angkatan"}</button>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 12) MENU SIDEBAR OSIS
  htmlNavOsis() {
    const list = this.state.sideDraft || this.klon(this.SIDEBAR_DEFAULT);
    return (
      `<article class="stg-card" data-kw="sidebar menu osis drawer kiri grup populer sekretaris bendahara super admin">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico"><i class="fa-solid fa-bars-staggered"></i></span>` +
            `<div><h2>Susunan Menu Sidebar Dashboard OSIS</h2><p>Atur urutan halaman, pengelompokan divisi, dan pin Menu Populer di seluruh halaman osis/*.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-sitemap"></i> Global OSIS</span>` +
        `</div>` +
        `<div class="stg-list">` +
          list
            .map((it, idx) => {
              const isEdit = this.state.sideEditIdx === idx;
              const ed = isEdit
                ? `<div class="stg-inline-editor">` +
                    `<div class="stg-grid-2">` +
                      `<div class="stg-field"><label>Slug Halaman / Href</label><input type="text" class="stg-inp" id="stgSdHref" value="${this.esc(it.href)}" /></div>` +
                      `<div class="stg-field"><label>Label Menu</label><input type="text" class="stg-inp" id="stgSdLabel" maxlength="40" value="${this.esc(it.label)}" /></div>` +
                      `<div class="stg-field"><label>Nama Grup (kosong = Kartu Utama)</label><input type="text" class="stg-inp" id="stgSdGrup" placeholder="Umum / Sekretaris / Bendahara / Super Admin" value="${this.esc(it.grup || "")}" /></div>` +
                      `<div class="stg-field"><label>Kelas Ikon FontAwesome</label><input type="text" class="stg-inp" id="stgSdIcon" value="${this.esc(it.icon || "fa-solid fa-link")}" /></div>` +
                    `</div>` +
                    `<div class="stg-chip-cloud" style="margin-top:10px">` +
                      `<label class="stg-check-pill${it.populer ? " checked" : ""}"><input type="checkbox" id="stgSdPopuler"${it.populer ? " checked" : ""} /> Pin di Menu Populer</label>` +
                      `<label class="stg-check-pill${it.super ? " checked" : ""}"><input type="checkbox" id="stgSdSuper"${it.super ? " checked" : ""} /> Khusus Super Admin</label>` +
                    `</div>` +
                    `<div class="stg-foot-acts" style="margin-top:10px">` +
                      `<button type="button" class="btn btn-white btn-sm" data-side-cancel="1">Batal</button>` +
                      `<button type="button" class="btn btn-red btn-sm" data-side-apply="${idx}"><i class="fa-solid fa-check"></i> Terapkan Item</button>` +
                    `</div>` +
                  `</div>`
                : "";

              return (
                `<div class="stg-item">` +
                  `<span class="stg-item-ico"><i class="${this.esc(it.icon || "fa-solid fa-link")}"></i></span>` +
                  `<div class="stg-item-body">` +
                    `<b>${this.esc(it.label)} ` +
                      (it.grup ? `<span class="stg-mini-tag muted">${this.esc(it.grup)}</span>` : `<span class="stg-mini-tag">Utama</span>`) +
                      (it.populer ? `<span class="stg-mini-tag green"><i class="fa-solid fa-bolt"></i> Populer</span>` : "") +
                      (it.super ? `<span class="stg-mini-tag super">Super</span>` : "") +
                    `</b>` +
                    `<small>osis/${this.esc(it.href)}</small>` +
                  `</div>` +
                  `<div class="stg-item-acts">` +
                    `<button type="button" class="stg-ico-btn${it.populer ? " on" : ""}" title="Toggle Menu Populer" data-side-pop="${idx}"><i class="fa-solid fa-star"></i></button>` +
                    `<button type="button" class="stg-ico-btn" title="Naik" data-side-move="${idx}:-1" ${idx === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>` +
                    `<button type="button" class="stg-ico-btn" title="Turun" data-side-move="${idx}:1" ${idx === list.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>` +
                    `<button type="button" class="stg-ico-btn" title="Edit" data-side-edit="${idx}"><i class="fa-solid fa-pen"></i></button>` +
                    `<button type="button" class="stg-ico-btn del" title="Hapus" data-side-del="${idx}"><i class="fa-solid fa-trash"></i></button>` +
                  `</div>` +
                  ed +
                `</div>`
              );
            })
            .join("") +
        `</div>` +
        `<div><button type="button" class="btn btn-white btn-sm" id="stgSideAdd"><i class="fa-solid fa-plus"></i> Tambah Menu Sidebar</button></div>` +
        `<div class="stg-foot-bar">` +
          `<button type="button" class="btn btn-white btn-sm" id="stgSideReset"><i class="fa-solid fa-rotate-left"></i> Reset ke Bawaan</button>` +
          `<div class="stg-foot-acts">` +
            `<button type="button" class="btn btn-red btn-sm" id="stgSideSave"><i class="fa-solid fa-floppy-disk"></i> Simpan Sidebar OSIS</button>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 13) KONFIGURASI ABSENSI (PER ANGKATAN AKTIF)
  htmlModulAbsensi() {
    const semuaTahun = Array.from(
      new Set([
        ...this.data.periodeList.map((p) => Number(p.tahun)),
        ...this.state.absTahunAktif,
        ...this.state.absTambahTahun,
      ]),
    )
      .filter(Number.isFinite)
      .sort((a, b) => b - a);

    const aktifSet = new Set(this.state.absTahunAktif);
    const perSet = new Set(this.state.absPeriodeAktif);

    return (
      `<article class="stg-card" data-kw="absensi tahun aktif tahun default periode roster angkatan">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico green"><i class="fa-solid fa-clipboard-user"></i></span>` +
            `<div><h2>Konfigurasi Tahun &amp; Roster Absensi</h2><p>Pilih tahun anggota mana saja yang muncul pada tab absensi untuk angkatan ini.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge angkatan"><i class="fa-solid fa-graduation-cap"></i> ${this.esc(this.angkatanAktifLabel())}</span>` +
        `</div>` +
        `<div class="stg-field">` +
          `<label>Tahun Anggota Aktif di Absensi (centang minimal 1)</label>` +
          `<div class="stg-chip-cloud">` +
            semuaTahun
              .map(
                (t) =>
                  `<label class="stg-check-pill${aktifSet.has(t) ? " checked" : ""}">` +
                    `<input type="checkbox" data-abs-tahun="${t}"${aktifSet.has(t) ? " checked" : ""} /> ${t}` +
                  `</label>`,
              )
              .join("") +
          `</div>` +
        `</div>` +
        `<div class="stg-grid-2">` +
          `<div class="stg-field">` +
            `<label for="stgAbsDefault">Tahun Fokus Default Saat Buka Absensi</label>` +
            `<select class="stg-sel" id="stgAbsDefault">` +
              `<option value="">Otomatis</option>` +
              semuaTahun
                .filter((t) => aktifSet.has(t))
                .map((t) => `<option value="${t}"${Number(this.state.absTahunDefault) === t ? " selected" : ""}>Tahun ${t}</option>`)
                .join("") +
            `</select>` +
          `</div>` +
          `<div class="stg-field">` +
            `<label>Tambah Tahun Periode Baru</label>` +
            `<div style="display:flex;gap:8px">` +
              `<input type="number" class="stg-inp" id="stgAbsAddYearInp" min="2010" max="2100" placeholder="Cth: 2028" />` +
              `<button type="button" class="btn btn-white btn-sm" id="stgAbsAddYearBtn"><i class="fa-solid fa-plus"></i> Tambah</button>` +
            `</div>` +
          `</div>` +
        `</div>` +
        `<div class="stg-field">` +
          `<label>Status Aktif Master Periode Global <small>Fallback bila angkatan belum punya setting khusus</small></label>` +
          `<div class="stg-chip-cloud">` +
            semuaTahun
              .slice(0, 8)
              .map(
                (t) =>
                  `<label class="stg-check-pill${perSet.has(t) ? " checked" : ""}">` +
                    `<input type="checkbox" data-abs-per="${t}"${perSet.has(t) ? " checked" : ""} /> Periode ${t}` +
                  `</label>`,
              )
              .join("") +
          `</div>` +
        `</div>` +
        `<div class="stg-foot-bar">` +
          `<a href="osis/absensi" class="btn btn-white btn-sm"><i class="fa-solid fa-up-right-from-square"></i> Buka Halaman Absensi</a>` +
          `<div class="stg-foot-acts">` +
            `<button type="button" class="btn btn-red btn-sm" id="stgBtnSaveAbsensi"><i class="fa-solid fa-floppy-disk"></i> Simpan Konfigurasi Absensi</button>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // 14) UANG KAS & KEUANGAN (PER ANGKATAN AKTIF)
  htmlModulKas() {
    const cards = [];

    if (this.bisa("uang-kas")) {
      const cfg = this.data.uangKasCfg || { nominal_mingguan: 2000, tanggal_mulai: "", catatan: "" };
      const nomFmt = Number(cfg.nominal_mingguan || 2000).toLocaleString("id-ID");
      const liburList = this.state.ukLibur || [];

      cards.push(
        `<article class="stg-card" data-kw="uang kas tarif iuran mingguan tanggal mulai minggu libur bendahara">` +
          `<div class="stg-card-head">` +
            `<div class="stg-card-title-wrap">` +
              `<span class="stg-card-ico"><i class="fa-solid fa-coins"></i></span>` +
              `<div><h2>Pengaturan Uang Kas Mingguan</h2><p>Tarif iuran mingguan FIFO, tanggal mulai penagihan, dan daftar minggu libur kas.</p></div>` +
            `</div>` +
            `<span class="stg-scope-badge angkatan"><i class="fa-solid fa-graduation-cap"></i> ${this.esc(this.angkatanAktifLabel())}</span>` +
          `</div>` +
          `<div class="stg-grid-2">` +
            `<div class="stg-field">` +
              `<label for="stgUkNominal">Tarif Kas per Minggu (Rp)</label>` +
              `<input type="text" inputmode="numeric" class="stg-inp" id="stgUkNominal" value="${this.esc(nomFmt)}" />` +
            `</div>` +
            `<div class="stg-field">` +
              `<label for="stgUkMulai">Tanggal Mulai Kas (Otomatis Senin)</label>` +
              `<input type="date" class="stg-inp" id="stgUkMulai" value="${this.esc(cfg.tanggal_mulai || "")}" />` +
            `</div>` +
            `<div class="stg-field full">` +
              `<label for="stgUkCatatan">Catatan Buku Kas</label>` +
              `<input type="text" class="stg-inp" id="stgUkCatatan" maxlength="300" placeholder="Cth: Sesuai kesepakatan rapat bendahara..." value="${this.esc(cfg.catatan || "")}" />` +
            `</div>` +
          `</div>` +
          `<div class="stg-field">` +
            `<label>Daftar Minggu Libur Kas (${liburList.length} minggu dibebaskan tagihan)</label>` +
            `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">` +
              `<input type="date" class="stg-inp" id="stgUkAddLiburInp" style="max-width:210px" />` +
              `<button type="button" class="btn btn-white btn-sm" id="stgUkAddLiburBtn"><i class="fa-solid fa-calendar-xmark"></i> Tambah Minggu Libur</button>` +
            `</div>` +
            `<div class="stg-chip-cloud">` +
              (liburList.length
                ? liburList
                    .map(
                      (tgl) =>
                        `<span class="stg-tag-pill"><i class="fa-regular fa-calendar"></i> Senin, ${this.esc(tgl)} <button type="button" data-uk-del-libur="${this.esc(tgl)}" title="Hapus libur"><i class="fa-solid fa-xmark"></i></button></span>`,
                    )
                    .join("")
                : `<span class="stg-foot-hint">Belum ada minggu libur yang ditandai.</span>`) +
            `</div>` +
          `</div>` +
          `<div class="stg-foot-bar">` +
            `<a href="osis/uang-kas" class="btn btn-white btn-sm"><i class="fa-solid fa-up-right-from-square"></i> Buka Halaman Uang Kas</a>` +
            `<div class="stg-foot-acts">` +
              `<button type="button" class="btn btn-red btn-sm" id="stgBtnSaveUangKas"><i class="fa-solid fa-floppy-disk"></i> Simpan Pengaturan Uang Kas</button>` +
            `</div>` +
          `</div>` +
        `</article>`,
      );
    }

    if (this.bisa("keuangan")) {
      const yrNow = new Date().getFullYear();
      const tahuns = Array.from(
        new Set([yrNow, ...this.data.periodeList.map((p) => Number(p.tahun)), ...this.data.saldoAwalList.map((s) => Number(s.periode))]),
      )
        .filter(Number.isFinite)
        .sort((a, b) => b - a)
        .slice(0, 6);
      const curPer = this.data.saldoAwalList[0]?.periode || yrNow;
      const curNom = this.data.saldoAwalList.find((s) => Number(s.periode) === Number(curPer))?.nominal || 0;

      cards.push(
        `<article class="stg-card" data-kw="keuangan saldo awal kas bendahara periode rupiah">` +
          `<div class="stg-card-head">` +
            `<div class="stg-card-title-wrap">` +
              `<span class="stg-card-ico green"><i class="fa-solid fa-wallet"></i></span>` +
              `<div><h2>Saldo Awal Kas Keuangan</h2><p>Modal/saldo pindahan awal periode untuk perhitungan saldo buku kas OSIS.</p></div>` +
            `</div>` +
            `<span class="stg-scope-badge angkatan"><i class="fa-solid fa-graduation-cap"></i> ${this.esc(this.angkatanAktifLabel())}</span>` +
          `</div>` +
          `<div class="stg-grid-2">` +
            `<div class="stg-field">` +
              `<label for="stgSaldoPeriode">Tahun Periode Kas</label>` +
              `<select class="stg-sel" id="stgSaldoPeriode">` +
                tahuns.map((t) => `<option value="${t}"${Number(t) === Number(curPer) ? " selected" : ""}>Periode ${t}</option>`).join("") +
              `</select>` +
            `</div>` +
            `<div class="stg-field">` +
              `<label for="stgSaldoNominal">Nominal Saldo Awal (Rp)</label>` +
              `<input type="text" inputmode="numeric" class="stg-inp" id="stgSaldoNominal" value="${this.esc(Number(curNom).toLocaleString("id-ID"))}" />` +
            `</div>` +
          `</div>` +
          `<div class="stg-foot-bar">` +
            `<a href="osis/keuangan" class="btn btn-white btn-sm"><i class="fa-solid fa-up-right-from-square"></i> Buka Halaman Keuangan</a>` +
            `<div class="stg-foot-acts">` +
              `<button type="button" class="btn btn-red btn-sm" id="stgBtnSaveSaldo"><i class="fa-solid fa-floppy-disk"></i> Simpan Saldo Awal</button>` +
            `</div>` +
          `</div>` +
        `</article>`,
      );
    }

    return cards.join("");
  },

  // 15) TEMPLATE PENGUMUMAN WAWANCARA
  htmlModulWawancara() {
    const tplLanjut = this.siteVal("hasil_wawancara_tpl_lanjut");
    const tplGagal = this.siteVal("hasil_wawancara_tpl_gagal");

    return (
      `<article class="stg-card" data-kw="wawancara casis calon osis template pengumuman hasil lanjut gagal kakak asuh">` +
        `<div class="stg-card-head">` +
          `<div class="stg-card-title-wrap">` +
            `<span class="stg-card-ico red"><i class="fa-solid fa-comments"></i></span>` +
            `<div><h2>Template Pesan Hasil Wawancara</h2><p>Teks surat pengumuman kelulusan calon pengurus OSIS di halaman hasil-wawancara.</p></div>` +
          `</div>` +
          `<span class="stg-scope-badge server"><i class="fa-solid fa-globe"></i> Global Wawancara</span>` +
        `</div>` +
        `<div class="stg-kv-pills">` +
          `<span class="stg-kv-pill">Variabel otomatis: <b>{tanggal}</b> = Tanggal wawancara calon</span>` +
          `<span class="stg-kv-pill"><b>{kakasuh}</b> = Nama &amp; kontak Kakak Asuh</span>` +
        `</div>` +
        `<div class="stg-grid-2">` +
          `<div class="stg-field full">` +
            `<label for="stgTplLanjut">Template Hasil DINYATAKAN LANJUT</label>` +
            `<textarea class="stg-ta" id="stgTplLanjut" rows="6" maxlength="4000">${this.esc(tplLanjut)}</textarea>` +
          `</div>` +
          `<div class="stg-field full">` +
            `<label for="stgTplGagal">Template Hasil DINYATAKAN GAGAL</label>` +
            `<textarea class="stg-ta" id="stgTplGagal" rows="6" maxlength="4000">${this.esc(tplGagal)}</textarea>` +
          `</div>` +
        `</div>` +
        `<div class="stg-foot-bar">` +
          `<button type="button" class="btn btn-white btn-sm" id="stgBtnResetTplWawancara"><i class="fa-solid fa-rotate-left"></i> Isi Teks Standar</button>` +
          `<div class="stg-foot-acts">` +
            `<a href="osis/hasil-wawancara" class="btn btn-white btn-sm"><i class="fa-solid fa-up-right-from-square"></i> Halaman Hasil</a>` +
            `<button type="button" class="btn btn-red btn-sm" id="stgBtnSaveTplWawancara"><i class="fa-solid fa-floppy-disk"></i> Simpan Template Wawancara</button>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  },

  // =========================================================================
  // ASYNC WIDGETS: NOTIFIKASI PUSH & PENYIMPANAN DETAIL
  // =========================================================================
  async isiAsyncNotifDanSimpan() {
    await Promise.all([this.isiNotifBox(), this.isiStorageBox()]);
  },

  async isiNotifBox() {
    const box = document.getElementById("stgNotifAsyncBox");
    if (!box) return;
    if (typeof PushNotif === "undefined") {
      setTimeout(() => this.isiNotifBox(), 1200);
      return;
    }
    const aud = localStorage.getItem("push_audience") || (this.isOsis() ? "osis" : "publik");
    let rowHtml = "";
    try {
      if (!PushNotif.didukung || !PushNotif.didukung()) {
        rowHtml =
          `<div class="stg-rows"><div class="stg-row"><div class="stg-row-info">` +
          `<div class="stg-row-title">Notifikasi Push Belum Didukung</div>` +
          `<div class="stg-row-desc">Di iPhone/iPad: ketuk Bagikan → Tambah ke Layar Utama terlebih dahulu agar Web Push aktif.</div>` +
          `</div><div class="stg-row-ctrl"><span class="stg-mini-tag muted">Tidak Tersedia</span></div></div></div>`;
      } else {
        const st = await PushNotif.status();
        if (st === "aktif") {
          rowHtml =
            `<div class="stg-rows"><div class="stg-row" data-kw="notifikasi aktif matikan tes notif">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title">Notifikasi Push Aktif <span class="stg-mini-tag green">Kanal: ${this.esc(aud.toUpperCase())}</span></div>` +
                `<div class="stg-row-desc">Info penting tetap masuk walau browser sedang ditutup.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl">` +
                `<button type="button" class="btn btn-white btn-sm" id="stgBtnTestNotif"><i class="fa-solid fa-vial"></i> Tes Notif Lokal</button>` +
                `<button type="button" class="btn btn-white btn-sm" id="stgBtnTogglePush" data-act="off"><i class="fa-solid fa-bell-slash"></i> Matikan</button>` +
              `</div>` +
            `</div></div>`;
        } else if (st === "diblokir") {
          rowHtml =
            `<div class="stg-rows"><div class="stg-row"><div class="stg-row-info">` +
              `<div class="stg-row-title">Izin Notifikasi Diblokir Browser</div>` +
              `<div class="stg-row-desc">Buka Pengaturan Situs pada ikon gembok di address bar browser → ubah Notifikasi menjadi Izinkan.</div>` +
            `</div><div class="stg-row-ctrl"><span class="stg-mini-tag super">Diblokir</span></div></div></div>`;
        } else {
          rowHtml =
            `<div class="stg-rows"><div class="stg-row" data-kw="aktifkan nyalakan notifikasi push">` +
              `<div class="stg-row-info">` +
                `<div class="stg-row-title">Notifikasi Push Belum Aktif</div>` +
                `<div class="stg-row-desc">Nyalakan agar mendapat kabar pengumuman, agenda, dan info OSIS secara instan.</div>` +
              `</div>` +
              `<div class="stg-row-ctrl">` +
                `<button type="button" class="btn btn-red btn-sm" id="stgBtnTogglePush" data-act="on"><i class="fa-solid fa-bell"></i> Aktifkan Notifikasi</button>` +
              `</div>` +
            `</div></div>`;
        }
      }
    } catch (e) {
      rowHtml = `<div class="pesan-empty">Gagal memeriksa status notifikasi: ${this.esc(e.message)}</div>`;
    }
    box.innerHTML = rowHtml;

    document.getElementById("stgBtnTogglePush")?.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        if (btn.dataset.act === "on") await PushNotif.aktifkan();
        else await PushNotif.matikan();
      } catch (e) {
        this.toast("Gagal mengubah notifikasi: " + e.message, "error");
      }
      this.isiNotifBox();
    });

    document.getElementById("stgBtnTestNotif")?.addEventListener("click", async () => {
      try {
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification("OSIS TARPAN ONE", {
            body: "Tes notifikasi lokal berhasil! Perangkatmu siap menerima kabar.",
            icon: "assets/icons/icon-192.png",
            badge: "assets/icons/icon-192.png",
          });
          this.toast("Notifikasi uji coba dikirim!");
          return;
        }
      } catch {}
      this.toast("Gagal menampilkan notifikasi uji coba.", "error");
    });
  },

  hitungRincianLokal() {
    let cacheBytes = 0, cacheCount = 0, draftCount = 0, jepunCount = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || "";
        const val = localStorage.getItem(k) || "";
        if (k.startsWith("osis_cache_") || k === "changelog_cache" || k === "cache_papan_info") {
          cacheCount++;
          cacheBytes += val.length * 2;
        } else if (k.startsWith("osis_draft_v1_") || k.startsWith("ww_draft_") || k.startsWith("tes_draft_")) {
          draftCount++;
        } else if (k === "jepun_rekor_v1") {
          try {
            jepunCount = Object.keys(JSON.parse(val || "{}")).length;
          } catch {}
        }
      }
    } catch {}
    return { cacheBytes, cacheCount, draftCount, jepunCount };
  },

  async isiStorageBox() {
    const box = document.getElementById("stgStorageAsyncBox");
    if (!box) return;
    const r = this.hitungRincianLokal();
    let outboxCount = 0;
    try {
      if (typeof Outbox !== "undefined" && Outbox.hitung) outboxCount = await Outbox.hitung();
    } catch {}

    let usage = 0, quota = 0;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        usage = Number(est.usage) || 0;
        quota = Number(est.quota) || 0;
      }
    } catch {}
    const pct = quota > 0 ? Math.min(100, Math.max(1, (usage / quota) * 100)) : 4;

    box.innerHTML =
      `<div class="stg-meter-box">` +
        `<div class="stg-meter-top">` +
          `<span>Total Pemakaian Browser Storage</span>` +
          `<span>${usage ? this.fmtBytes(usage) : this.fmtBytes(r.cacheBytes)}${quota ? " dari " + this.fmtBytes(quota) : ""}</span>` +
        `</div>` +
        `<div class="stg-meter-track"><div class="stg-meter-fill" style="width:${pct.toFixed(1)}%"></div></div>` +
        `<div class="stg-kv-pills">` +
          `<span class="stg-kv-pill">Cache Offline: <b>${r.cacheCount} item (${this.fmtBytes(r.cacheBytes)})</b></span>` +
          `<span class="stg-kv-pill">Draft Form: <b>${r.draftCount} tersimpan</b></span>` +
          `<span class="stg-kv-pill">Antrean Outbox: <b>${outboxCount} tertunda</b></span>` +
        `</div>` +
      `</div>` +
      `<div class="stg-rows" style="margin-top:8px">` +
        `<div class="stg-row" data-kw="bersihkan hapus cache offline swr">` +
          `<div class="stg-row-info">` +
            `<div class="stg-row-title">Cache Data Offline</div>` +
            `<div class="stg-row-desc">${r.cacheCount} paket data tersimpan (${this.fmtBytes(r.cacheBytes)}). Aman dihapus kapan saja tanpa menghilangkan login.</div>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            `<button type="button" class="btn btn-white btn-sm" id="stgBtnClearCache"><i class="fa-solid fa-broom"></i> Bersihkan Cache</button>` +
          `</div>` +
        `</div>` +
        `<div class="stg-row" data-kw="antrean offline outbox kirim sinkronisasi">` +
          `<div class="stg-row-info">` +
            `<div class="stg-row-title">Antrean Pengiriman Offline (Outbox)</div>` +
            `<div class="stg-row-desc">${outboxCount > 0 ? `${outboxCount} perubahan menunggu koneksi untuk dikirim ke server.` : "Bersih — semua aksi sudah tersinkron ke server."}</div>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            (outboxCount > 0
              ? `<button type="button" class="btn btn-red btn-sm" id="stgBtnSyncOutbox"><i class="fa-solid fa-cloud-arrow-up"></i> Kirim Sekarang</button>`
              : `<span class="stg-scope-badge angkatan"><i class="fa-solid fa-check"></i> Sinkron</span>`) +
          `</div>` +
        `</div>` +
        `<div class="stg-row" data-kw="draft form otomatis tersimpan wawancara kuis">` +
          `<div class="stg-row-info">` +
            `<div class="stg-row-title">Draft Formulir Tersimpan Otomatis</div>` +
            `<div class="stg-row-desc">${r.draftCount} draft isian form belum dikirim. Bersihkan jika ingin mengosongkan sisa ketikan form lama.</div>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            `<button type="button" class="btn btn-white btn-sm" id="stgBtnClearDrafts" ${r.draftCount === 0 ? "disabled" : ""}><i class="fa-solid fa-eraser"></i> Hapus Draft (${r.draftCount})</button>` +
          `</div>` +
        `</div>` +
        `<div class="stg-row" data-kw="rekor skor kuis huruf jepang jepun">` +
          `<div class="stg-row-info">` +
            `<div class="stg-row-title">Rekor Kuis Huruf Jepang (Jepun)</div>` +
            `<div class="stg-row-desc">${r.jepunCount > 0 ? `${r.jepunCount} mode latihan tercatat memiliki skor tinggi.` : "Belum ada rekor latihan tersimpan."}</div>` +
          `</div>` +
          `<div class="stg-row-ctrl">` +
            `<a href="jepun" class="btn btn-white btn-sm"><i class="fa-solid fa-gamepad"></i> Buka Kuis</a>` +
            (r.jepunCount > 0 ? `<button type="button" class="btn btn-white btn-sm" id="stgBtnResetJepun"><i class="fa-solid fa-rotate-left"></i> Reset Skor</button>` : "") +
          `</div>` +
        `</div>` +
      `</div>`;

    document.getElementById("stgBtnClearCache")?.addEventListener("click", async () => {
      if (!(await this.tanya("Bersihkan seluruh cache data offline? Akun & preferensi tidak ikut terhapus."))) return;
      let n = 0;
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || "";
        if (k.startsWith("osis_cache_") || k === "changelog_cache" || k === "cache_papan_info") keys.push(k);
      }
      keys.forEach((k) => {
        try { localStorage.removeItem(k); n++; } catch {}
      });
      this.toast(`${n} cache offline berhasil dibersihkan.`);
      this.isiStorageBox();
    });

    document.getElementById("stgBtnSyncOutbox")?.addEventListener("click", async () => {
      try {
        if (typeof Outbox !== "undefined" && Outbox.processQueue) {
          this.toast("Mengirim antrean offline...", "info");
          await Outbox.processQueue({ manual: true });
        }
      } catch (e) {
        this.toast("Gagal sinkron: " + e.message, "error");
      }
      this.isiStorageBox();
    });

    document.getElementById("stgBtnClearDrafts")?.addEventListener("click", async () => {
      if (!(await this.tanya("Hapus semua draft formulir yang belum tersimpan?"))) return;
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || "";
        if (k.startsWith("osis_draft_v1_") || k.startsWith("ww_draft_") || k.startsWith("tes_draft_")) keys.push(k);
      }
      keys.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
      this.toast(`${keys.length} draft form dibersihkan.`);
      this.isiStorageBox();
    });

    document.getElementById("stgBtnResetJepun")?.addEventListener("click", async () => {
      if (!(await this.tanya("Reset semua rekor skor kuis huruf Jepang di perangkat ini?"))) return;
      try { localStorage.removeItem("jepun_rekor_v1"); } catch {}
      this.toast("Rekor kuis Jepun berhasil direset.");
      this.isiStorageBox();
    });
  },

  // =========================================================================
  // EVENT BINDING & AKSI SIMPAN (SEMUA ZONA)
  // =========================================================================
  ikatKontrolMain() {
    const main = document.getElementById("stgMain");
    if (!main) return;

    // Format nominal Rupiah otomatis
    if (typeof ikatRupiah === "function") {
      ikatRupiah("stgUkNominal");
      ikatRupiah("stgSaldoNominal");
    }

    // Reset pencarian dari empty state
    document.getElementById("stgResetSearchBtn")?.addEventListener("click", () => {
      const inp = document.getElementById("stgSearchInput");
      const clr = document.getElementById("stgSearchClear");
      if (inp) inp.value = "";
      if (clr) clr.hidden = true;
      this.searchQ = "";
      this.terapkanFilter();
    });

    // Logout
    document.getElementById("stgBtnLogout")?.addEventListener("click", () => {
      if (typeof OsisAuth !== "undefined" && OsisAuth.confirmLogout) OsisAuth.confirmLogout();
    });

    // Ganti Angkatan Aktif
    document.getElementById("stgSelAngkatanAktif")?.addEventListener("change", async (e) => {
      const id = Number(e.target.value || 0);
      if (!id || typeof OsisAuth === "undefined" || !OsisAuth.setAngkatanAktif) return;
      OsisAuth.setAngkatanAktif(id);
      this.toast("Fokus angkatan diubah ke " + this.angkatanAktifLabel() + ". Memuat ulang konfigurasi...", "info");
      await this.muatSemuaData(true);
    });

    // Tema Terang / Gelap
    main.querySelectorAll("[data-stg-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.stgTheme === "dark" ? "dark" : "light";
        if (typeof TarpanTheme !== "undefined" && TarpanTheme.set) TarpanTheme.set(mode);
        else {
          localStorage.setItem("tarpan_theme", mode);
          if (mode === "dark") document.documentElement.setAttribute("data-theme", "dark");
          else document.documentElement.removeAttribute("data-theme");
        }
        this.toast(mode === "dark" ? "Mode gelap diaktifkan." : "Mode terang diaktifkan.");
      });
    });

    // View mode Agenda & Dokumen
    main.querySelectorAll("#stgSegAgendaView button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.val === "list" ? "list" : "grid";
        localStorage.setItem("agenda_view_mode", v);
        main.querySelectorAll("#stgSegAgendaView button").forEach((b) => b.classList.toggle("on", b.dataset.val === v));
        this.toast("Tampilan default Agenda disimpan.");
      });
    });
    main.querySelectorAll("#stgSegDokView button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.val === "list" ? "list" : "grid";
        localStorage.setItem("osis_dokumen_view", v);
        main.querySelectorAll("#stgSegDokView button").forEach((b) => b.classList.toggle("on", b.dataset.val === v));
        this.toast("Tampilan default Dokumen disimpan.");
      });
    });

    // Reset Hints
    document.getElementById("stgBtnResetHints")?.addEventListener("click", () => {
      ["fotoSwipeHintOff", "angkatanSwipeHintOff", "navMoreOpened"].forEach((k) => {
        try { localStorage.removeItem(k); } catch {}
      });
      this.toast("Semua petunjuk geser & pemandu akan tampil kembali.");
    });

    // Media & Kompresi
    document.getElementById("stgFeedAuto")?.addEventListener("change", (e) => {
      localStorage.setItem("feed_autoplay", e.target.checked ? "1" : "0");
      this.toast(e.target.checked ? "Putar video otomatis aktif." : "Mode hemat kuota aktif (autoplay mati).");
    });
    document.getElementById("stgFeedSuara")?.addEventListener("change", (e) => {
      localStorage.setItem("feed_suara", e.target.checked ? "1" : "0");
      this.toast(e.target.checked ? "Video Feed akan dimulai dengan suara." : "Video Feed dimulai dalam mode bisu.");
    });
    document.getElementById("stgCompEngine")?.addEventListener("change", (e) => {
      if (typeof TarpanCompress !== "undefined") TarpanCompress.setPref(e.target.value);
      else localStorage.setItem("tarpan-video-compress", e.target.value);
      this.toast("Mesin kompresi video disimpan.");
    });
    document.getElementById("stgCompRes")?.addEventListener("change", (e) => {
      if (typeof TarpanCompress !== "undefined") TarpanCompress.setMaxDim(e.target.value);
      else localStorage.setItem("tarpan-video-res", e.target.value);
      this.toast("Batas resolusi video disimpan.");
    });
    document.getElementById("stgCompTarget")?.addEventListener("change", (e) => {
      if (typeof TarpanCompress !== "undefined") TarpanCompress.setTargetMB(e.target.value);
      else localStorage.setItem("tarpan-video-target", e.target.value);
      this.toast("Target ukuran video disimpan.");
    });

    // PWA Install & Update SW
    document.getElementById("stgBtnInstallPwa")?.addEventListener("click", () => {
      if (typeof PwaInstall !== "undefined" && PwaInstall.pasang) PwaInstall.pasang();
    });
    document.getElementById("stgBtnUpdateSw")?.addEventListener("click", async () => {
      try {
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.update();
            if (reg.waiting) {
              reg.waiting.postMessage("SKIP_WAITING");
              this.toast("Versi baru ditemukan, memuat ulang...", "info");
              return;
            }
          }
        }
        this.toast("Aplikasi sudah berada pada versi terbaru (" + this.swVersion + ").");
      } catch (e) {
        this.toast("Gagal cek update: " + e.message, "error");
      }
    });

    // Reset Preferensi & Wipe Lokal
    document.getElementById("stgBtnResetPrefs")?.addEventListener("click", async () => {
      if (!(await this.tanya("Kembalikan preferensi tampilan, feed, dan kompresi video ke pengaturan awal?"))) return;
      [
        "tarpan_theme",
        "feed_autoplay",
        "feed_suara",
        "tarpan-video-compress",
        "tarpan-video-res",
        "tarpan-video-target",
        "agenda_view_mode",
        "osis_dokumen_view",
      ].forEach((k) => {
        try { localStorage.removeItem(k); } catch {}
      });
      if (typeof TarpanTheme !== "undefined" && TarpanTheme.set) TarpanTheme.set("light");
      this.renderHeroStats();
      this.renderMain();
      this.isiAsyncNotifDanSimpan();
      this.toast("Preferensi perangkat dikembalikan ke bawaan.");
    });

    document.getElementById("stgBtnWipeAll")?.addEventListener("click", async () => {
      if (!(await this.tanya("Hapus SEMUA data lokal (sesi login, preferensi, cache, draft, antrean) di perangkat ini?"))) return;
      if (!(await this.tanya("Konfirmasi terakhir: Kamu harus login ulang sesudahnya. Lanjutkan?"))) return;
      try { localStorage.clear(); } catch {}
      try { if (window.indexedDB && indexedDB.deleteDatabase) indexedDB.deleteDatabase("osis_outbox"); } catch {}
      try { if (typeof supa !== "undefined" && supa.auth) await supa.auth.signOut(); } catch {}
      location.reload();
    });

    // Sub-accordions (Misi, Makna Logo, Sosmed, Radio)
    main.querySelectorAll("[data-sub-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.subToggle;
        const box = main.querySelector(`[data-sub-box="${k}"]`);
        if (!box) return;
        const next = !box.classList.contains("open");
        box.classList.toggle("open", next);
        this.state.subOpen[k] = next;
      });
    });

    // ---- ZONA B: SAKELAR & KUOTA PUBLIK ----
    main.querySelectorAll("#stgSegStatusAsp button").forEach((btn) => {
      btn.addEventListener("click", () => this.simpanKunciPengaturan("status_aspirasi", btn.dataset.val, "#stgSegStatusAsp"));
    });
    document.getElementById("stgSelBatasAsp")?.addEventListener("change", (e) => {
      this.simpanKunciPengaturan("batas_harian_aspirasi", e.target.value);
    });
    main.querySelectorAll("#stgSegStatusLagu button").forEach((btn) => {
      btn.addEventListener("click", () => this.simpanKunciPengaturan("status_lagu", btn.dataset.val, "#stgSegStatusLagu"));
    });
    document.getElementById("stgSelBatasLagu")?.addEventListener("change", (e) => {
      this.simpanKunciPengaturan("batas_harian_lagu", e.target.value);
    });
    main.querySelectorAll("#stgSegStatusPol button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const val = btn.dataset.val;
        const u = this.user();
        if (!u) return;
        try {
          await setPollingStatus(u.id, val);
          this.data.pollingStatus = val;
          Cache.del("site_content");
          main.querySelectorAll("#stgSegStatusPol button").forEach((b) => b.classList.toggle("on", b.dataset.val === val));
          this.toast(`Status Polling diubah menjadi ${val}.`);
        } catch (err) {
          this.toast("Gagal ubah status polling: " + err.message, "error");
        }
      });
    });
    document.getElementById("stgBtnSavePolJudul")?.addEventListener("click", async (ev) => {
      const val = document.getElementById("stgInpPolJudul")?.value.trim() || "";
      if (!val) { this.toast("Judul polling wajib diisi.", "error"); return; }
      const u = this.user();
      if (!u) return;
      ev.currentTarget.disabled = true;
      try {
        await saveSiteText(u.id, "polling_judul", val);
        this.data.pollingJudul = val;
        this.data.siteMap.polling_judul = val;
        this.toast("Judul Polling tersimpan!");
      } catch (err) {
        this.toast("Gagal simpan judul: " + err.message, "error");
      } finally {
        ev.currentTarget.disabled = false;
      }
    });

    // ---- ZONA B: FOTO WEB & SITE_CONTENT GROUPS ----
    main.querySelectorAll("[data-pick-foto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.photoTargetKey = btn.dataset.pickFoto;
        document.getElementById("stgFileInput")?.click();
      });
    });

    main.querySelectorAll("[data-save-site-group]").forEach((btn) => {
      btn.addEventListener("click", () => this.simpanGrupSiteContent(btn.dataset.saveSiteGroup, btn));
    });

    // ---- ZONA B: NAVIGASI BAWAH PUBLIK ----
    this.ikatNavPublik(main);

    // ---- ZONA C: MASTER ANGKATAN ----
    this.ikatMasterAngkatan(main);

    // ---- ZONA C: SIDEBAR OSIS ----
    this.ikatSidebarOsis(main);

    // ---- ZONA C: MODUL ABSENSI ----
    this.ikatModulAbsensi(main);

    // ---- ZONA C: MODUL UANG KAS & KEUANGAN ----
    this.ikatModulKas(main);

    // ---- ZONA C: TEMPLATE WAWANCARA ----
    this.ikatModulWawancara();
  },

  async simpanKunciPengaturan(kunci, nilai, segSelector) {
    try {
      await simpanPengaturan(kunci, nilai);
      this.data.pengaturan[kunci] = nilai;
      if (segSelector) {
        document.querySelectorAll(`${segSelector} button`).forEach((b) => b.classList.toggle("on", b.dataset.val === nilai));
      }
      this.toast(`Pengaturan ${kunci.replace(/_/g, " ")} disimpan (${nilai}).`);
    } catch (err) {
      const msg = String(err.message || err);
      if (/ERR_KEY|ERR_BAD|ERR_NO_AUTH/i.test(msg)) {
        this.toast("Gagal simpan (" + msg + "). Pastikan migrasi SQL terbaru sudah dijalankan jika mengatur sakelar baru.", "error");
      } else {
        this.toast("Gagal simpan: " + msg, "error");
      }
    }
  },

  async saatFotoDipilih(fi) {
    const file = fi.files && fi.files[0];
    fi.value = "";
    const key = this.state.photoTargetKey;
    if (!file || !key) return;
    if (!file.type.startsWith("image/")) {
      this.toast("File wajib berupa gambar.", "error");
      return;
    }
    const ext = ((file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 6);
    const path = `web/${key}-${Date.now()}.${ext}`;
    const lama = this.data.webFoto[key] || "";
    this.toast("Mengunggah foto ke Cloudflare R2...", "info");
    try {
      await uploadFotoStorage(file, path);
      await simpanWebFoto(key, path);
      this.data.webFoto[key] = path;
      if (typeof FotoWeb !== "undefined") {
        FotoWeb.map[key] = path;
        FotoWeb.apply();
      }
      if (lama && lama !== path && !/^web\/(logo1\.png|bg\.png|pembina\.(jpg|png))$/.test(lama)) {
        hapusFotoStorage(lama).catch(() => {});
      }
      this.renderMain();
      this.isiAsyncNotifDanSimpan();
      this.toast("Foto identitas berhasil diperbarui!");
    } catch (err) {
      this.toast("Gagal unggah foto: " + err.message, "error");
    }
  },

  async simpanGrupSiteContent(grp, btn) {
    const u = this.user();
    if (!u || !this.bisa("site")) return;
    const els = document.querySelectorAll(`[data-site-grp="${grp}"][data-site-key]`);
    const perubahan = [];
    for (const el of els) {
      const k = el.dataset.siteKey;
      const v = String(el.value || "").trim();
      if (/_url$/.test(k) && v && !/^(https?:\/\/|mailto:)/i.test(v)) {
        this.toast(`URL tidak valid pada ${k} (wajib https:// atau mailto:).`, "error");
        el.focus();
        return;
      }
      if (v !== this.siteVal(k)) {
        perubahan.push([k, v]);
      }
    }
    if (!perubahan.length) {
      this.toast("Tidak ada perubahan baru untuk disimpan.", "info");
      return;
    }
    if (btn) btn.disabled = true;
    try {
      for (const [k, v] of perubahan) {
        await saveSiteText(u.id, k, v);
        this.data.siteMap[k] = v;
      }
      Cache.del("site_content");
      this.toast(`${perubahan.length} item teks berhasil disimpan!`);
    } catch (err) {
      this.toast("Gagal menyimpan teks: " + err.message, "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  // ---------- EDITOR BOTTOMNAV ----------
  ikatNavPublik(main) {
    if (!this.bisa("site")) return;
    const rerender = () => {
      this.renderMain();
      this.isiAsyncNotifDanSimpan();
    };

    main.querySelectorAll("[data-bnav-move]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [sek, idxStr, dirStr] = btn.dataset.bnavMove.split(":");
        const i = Number(idxStr), j = i + Number(dirStr);
        const list = sek === "tabs" ? this.state.bnavDraft.tabs : this.state.bnavDraft.sheet;
        if (i < 0 || j < 0 || j >= list.length) return;
        const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
        this.state.bnavEditKey = null;
        rerender();
      });
    });

    main.querySelectorAll("[data-bnav-swap]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [sek, idxStr] = btn.dataset.bnavSwap.split(":");
        const i = Number(idxStr);
        const dari = sek === "tabs" ? this.state.bnavDraft.tabs : this.state.bnavDraft.sheet;
        const ke = sek === "tabs" ? this.state.bnavDraft.sheet : this.state.bnavDraft.tabs;
        const it = dari[i];
        if (!it) return;
        if (sek === "sheet") {
          if (!it.route) { this.toast("Link luar hanya bisa dipasang di Menu Lainnya.", "error"); return; }
          if (ke.length >= 4) { this.toast("Tab bawah maksimal 4 item.", "error"); return; }
          ke.push({ route: it.route, label: it.label, icon: it.icon });
        } else {
          if (dari.length <= 1) { this.toast("Tab bawah minimal harus 1 item.", "error"); return; }
          ke.push({ route: it.route, label: it.label, sub: "", icon: it.icon, short: String(it.label || "").slice(0, 12) });
        }
        dari.splice(i, 1);
        this.state.bnavEditKey = null;
        rerender();
      });
    });

    main.querySelectorAll("[data-bnav-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.bnavEditKey = btn.dataset.bnavEdit;
        rerender();
      });
    });

    main.querySelectorAll("[data-bnav-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.bnavEditKey = null;
        rerender();
      });
    });

    main.querySelectorAll("[data-bnav-apply]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [sek, idxStr] = btn.dataset.bnavApply.split(":");
        const list = sek === "tabs" ? this.state.bnavDraft.tabs : this.state.bnavDraft.sheet;
        const it = list[Number(idxStr)];
        if (!it) return;
        const lbl = document.getElementById("stgBnLabel")?.value.trim() || "";
        const ico = document.getElementById("stgBnIcon")?.value.trim() || "fa-solid fa-link";
        if (!lbl) { this.toast("Label wajib diisi.", "error"); return; }
        if (it.href) {
          const href = document.getElementById("stgBnHref")?.value.trim() || "";
          if (!/^(https?:\/\/|mailto:)/i.test(href)) { this.toast("Link wajib http(s):// atau mailto:.", "error"); return; }
          it.href = href;
        } else {
          it.route = document.getElementById("stgBnRoute")?.value || it.route;
        }
        it.label = lbl.slice(0, 20);
        it.icon = ico.slice(0, 80);
        if (sek === "sheet") {
          it.short = (document.getElementById("stgBnShort")?.value.trim() || "").slice(0, 12);
          it.sub = (document.getElementById("stgBnSub")?.value.trim() || "").slice(0, 40);
        }
        this.state.bnavEditKey = null;
        rerender();
      });
    });

    main.querySelectorAll("[data-bnav-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [sek, idxStr] = btn.dataset.bnavDel.split(":");
        const list = sek === "tabs" ? this.state.bnavDraft.tabs : this.state.bnavDraft.sheet;
        if (sek === "tabs" && list.length <= 1) { this.toast("Tab bawah minimal 1.", "error"); return; }
        if (!(await this.tanya("Hapus item ini dari draf navigasi?"))) return;
        list.splice(Number(idxStr), 1);
        this.state.bnavEditKey = null;
        rerender();
      });
    });

    document.getElementById("stgBnavAddTab")?.addEventListener("click", () => {
      if (this.state.bnavDraft.tabs.length >= 4) { this.toast("Tab bawah penuh (maks 4).", "error"); return; }
      const dipakai = [].concat(this.state.bnavDraft.tabs, this.state.bnavDraft.sheet).map((x) => x.route);
      const sisa = this.PUBLIC_ROUTES.find(([r]) => !dipakai.includes(r));
      if (!sisa) { this.toast("Semua rute internal sudah terpasang.", "error"); return; }
      this.state.bnavDraft.tabs.push({ route: sisa[0], label: sisa[1], icon: "fa-solid fa-link" });
      this.state.bnavEditKey = "tabs:" + (this.state.bnavDraft.tabs.length - 1);
      rerender();
    });

    document.getElementById("stgBnavAddSheetRoute")?.addEventListener("click", () => {
      if (this.state.bnavDraft.sheet.length >= 12) { this.toast("Menu Lainnya penuh (maks 12).", "error"); return; }
      const dipakai = [].concat(this.state.bnavDraft.tabs, this.state.bnavDraft.sheet).map((x) => x.route);
      const sisa = this.PUBLIC_ROUTES.find(([r]) => !dipakai.includes(r));
      if (!sisa) { this.toast("Semua rute internal sudah terpasang.", "error"); return; }
      this.state.bnavDraft.sheet.push({ route: sisa[0], label: sisa[1], sub: "", icon: "fa-solid fa-link", short: sisa[1].slice(0, 12) });
      this.state.bnavEditKey = "sheet:" + (this.state.bnavDraft.sheet.length - 1);
      rerender();
    });

    document.getElementById("stgBnavAddSheetHref")?.addEventListener("click", () => {
      if (this.state.bnavDraft.sheet.length >= 12) { this.toast("Menu Lainnya penuh (maks 12).", "error"); return; }
      this.state.bnavDraft.sheet.push({ href: "https://osistarpanone.my.id/polling", label: "Polling OSIS", sub: "E-Voting", icon: "fa-solid fa-check-to-slot", short: "Polling" });
      this.state.bnavEditKey = "sheet:" + (this.state.bnavDraft.sheet.length - 1);
      rerender();
    });

    document.getElementById("stgBnavReset")?.addEventListener("click", async () => {
      if (!(await this.tanya("Kembalikan navigasi publik ke susunan bawaan untuk semua pengunjung?"))) return;
      const u = this.user();
      const def = this.klon(this.BOTTOMNAV_DEFAULT);
      try {
        await simpanBottomnav(u.id, def);
        this.data.bottomnav = def;
        this.state.bnavDraft = this.klon(def);
        this.state.bnavEditKey = null;
        rerender();
        this.toast("Navigasi publik dikembalikan ke bawaan.");
      } catch (err) {
        this.toast("Gagal reset navigasi: " + err.message, "error");
      }
    });

    document.getElementById("stgBnavSave")?.addEventListener("click", async (ev) => {
      const u = this.user();
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await simpanBottomnav(u.id, this.state.bnavDraft);
        this.data.bottomnav = this.klon(this.state.bnavDraft);
        this.toast("Susunan navigasi publik berhasil disimpan!");
      } catch (err) {
        this.toast("Gagal simpan navigasi: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  },

  // ---------- EDITOR MASTER ANGKATAN ----------
  ikatMasterAngkatan(main) {
    if (!this.isSuper()) return;

    main.querySelectorAll("[data-ang-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.angEditId = Number(btn.dataset.angEdit);
        this.renderMain();
        this.isiAsyncNotifDanSimpan();
      });
    });

    document.getElementById("stgAngCancel")?.addEventListener("click", () => {
      this.state.angEditId = null;
      this.renderMain();
      this.isiAsyncNotifDanSimpan();
    });

    main.querySelectorAll("[data-ang-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.angDel);
        if (!(await this.tanya("Hapus angkatan ini? Angkatan yang sudah memiliki data transaksi/anggota tidak akan dihapus oleh server."))) return;
        try {
          const res = await angkatanHapus(this.user().id, id);
          if (res !== "OK") {
            const map = { ERR_DIPAKAI: "Angkatan tidak bisa dihapus karena sudah memiliki data aktif (gunakan mode Arsip)." };
            throw new Error(map[res] || res);
          }
          this.state.angEditId = null;
          await this.muatSemuaData(true);
          this.toast("Angkatan berhasil dihapus.");
        } catch (err) {
          this.toast("Gagal hapus: " + err.message, "error");
        }
      });
    });

    document.getElementById("stgAngSave")?.addEventListener("click", async (ev) => {
      const kode = document.getElementById("stgAngKode")?.value.trim().toUpperCase() || "";
      const nama = document.getElementById("stgAngNama")?.value.trim() || "";
      const tahunRaw = document.getElementById("stgAngTahun")?.value.trim() || "";
      const urutan = parseInt(document.getElementById("stgAngUrutan")?.value || "0", 10) || 0;
      const aktif = !!document.getElementById("stgAngAktif")?.checked;
      if (!/^[A-Z0-9_-]{2,40}$/.test(kode)) {
        this.toast("Kode wajib 2–40 karakter (huruf kapital, angka, strip).", "error");
        return;
      }
      if (!nama) {
        this.toast("Nama angkatan wajib diisi.", "error");
        return;
      }
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const tahun = tahunRaw ? parseInt(tahunRaw, 10) : null;
        if (tahun && this.bisa("absensi") && !this.data.periodeList.some((p) => Number(p.tahun) === tahun)) {
          await simpanAbsensiConfig(this.user().id, {
            tahun_aktif: this.state.absTahunAktif,
            tahun_default: this.state.absTahunDefault,
            tambah_tahun: [tahun],
          }).catch(() => {});
        }
        const res = await angkatanSimpan(this.user().id, {
          id: this.state.angEditId || null,
          kode,
          nama,
          urutan,
          tahun,
          aktif,
        });
        if (res !== "OK") {
          const map = {
            ERR_TAKEN: "Kode angkatan tersebut sudah dipakai.",
            ERR_TAHUN: "Tahun tersebut belum terdaftar di tabel periode.",
          };
          throw new Error(map[res] || res);
        }
        this.state.angEditId = null;
        await this.muatSemuaData(true);
        this.toast("Data angkatan berhasil disimpan!");
      } catch (err) {
        this.toast("Gagal simpan angkatan: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  },

  // ---------- EDITOR SIDEBAR OSIS ----------
  ikatSidebarOsis(main) {
    if (!this.bisa("site")) return;
    const rerender = () => {
      this.renderMain();
      this.isiAsyncNotifDanSimpan();
    };

    main.querySelectorAll("[data-side-pop]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.sidePop);
        if (this.state.sideDraft[idx]) {
          this.state.sideDraft[idx].populer = !this.state.sideDraft[idx].populer;
          rerender();
        }
      });
    });

    main.querySelectorAll("[data-side-move]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [idxStr, dirStr] = btn.dataset.sideMove.split(":");
        const i = Number(idxStr), j = i + Number(dirStr);
        const list = this.state.sideDraft;
        if (i < 0 || j < 0 || j >= list.length) return;
        const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
        this.state.sideEditIdx = -1;
        rerender();
      });
    });

    main.querySelectorAll("[data-side-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.sideEditIdx = Number(btn.dataset.sideEdit);
        rerender();
      });
    });

    main.querySelectorAll("[data-side-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.sideEditIdx = -1;
        rerender();
      });
    });

    main.querySelectorAll("[data-side-apply]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.sideApply);
        const it = this.state.sideDraft[idx];
        if (!it) return;
        const href = document.getElementById("stgSdHref")?.value.trim() || "";
        const label = document.getElementById("stgSdLabel")?.value.trim() || "";
        if (!href || !label) { this.toast("Slug halaman & label wajib diisi.", "error"); return; }
        it.href = href;
        it.label = label;
        it.grup = document.getElementById("stgSdGrup")?.value.trim() || "";
        it.icon = document.getElementById("stgSdIcon")?.value.trim() || "fa-solid fa-link";
        it.populer = !!document.getElementById("stgSdPopuler")?.checked;
        it.super = !!document.getElementById("stgSdSuper")?.checked;
        this.state.sideEditIdx = -1;
        rerender();
      });
    });

    main.querySelectorAll("[data-side-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (this.state.sideDraft.length <= 1) { this.toast("Menu sidebar minimal 1 item.", "error"); return; }
        if (!(await this.tanya("Hapus menu ini dari draf sidebar?"))) return;
        this.state.sideDraft.splice(Number(btn.dataset.sideDel), 1);
        this.state.sideEditIdx = -1;
        rerender();
      });
    });

    document.getElementById("stgSideAdd")?.addEventListener("click", () => {
      if (this.state.sideDraft.length >= 30) { this.toast("Sidebar maksimal 30 item.", "error"); return; }
      this.state.sideDraft.push({
        href: "../pengaturan?from=osis",
        label: "Pengaturan",
        icon: "fa-solid fa-sliders",
        grup: "Umum",
        populer: false,
        super: false,
      });
      this.state.sideEditIdx = this.state.sideDraft.length - 1;
      rerender();
    });

    document.getElementById("stgSideReset")?.addEventListener("click", async () => {
      if (!(await this.tanya("Kembalikan susunan Sidebar OSIS ke menu bawaan untuk seluruh pengurus?"))) return;
      const def = this.klon(this.SIDEBAR_DEFAULT);
      try {
        await simpanSidebarMenu(this.user().id, "sidebar_menu", def);
        this.data.sidebar = def;
        this.state.sideDraft = this.klon(def);
        this.state.sideEditIdx = -1;
        rerender();
        this.toast("Sidebar OSIS dikembalikan ke bawaan.");
      } catch (err) {
        this.toast("Gagal reset sidebar: " + err.message, "error");
      }
    });

    document.getElementById("stgSideSave")?.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await simpanSidebarMenu(this.user().id, "sidebar_menu", this.state.sideDraft);
        this.data.sidebar = this.klon(this.state.sideDraft);
        this.toast("Susunan Sidebar OSIS berhasil disimpan!");
      } catch (err) {
        this.toast("Gagal simpan sidebar: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  },

  // ---------- EDITOR ABSENSI ----------
  ikatModulAbsensi(main) {
    if (!this.bisa("absensi")) return;

    main.querySelectorAll("[data-abs-tahun]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const t = Number(cb.dataset.absTahun);
        const set = new Set(this.state.absTahunAktif);
        if (cb.checked) set.add(t);
        else set.delete(t);
        this.state.absTahunAktif = Array.from(set).sort((a, b) => a - b);
        this.renderMain();
        this.isiAsyncNotifDanSimpan();
      });
    });

    main.querySelectorAll("[data-abs-per]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const t = Number(cb.dataset.absPer);
        const set = new Set(this.state.absPeriodeAktif);
        if (cb.checked) set.add(t);
        else set.delete(t);
        this.state.absPeriodeAktif = Array.from(set).sort((a, b) => a - b);
        cb.closest(".stg-check-pill")?.classList.toggle("checked", cb.checked);
      });
    });

    document.getElementById("stgAbsDefault")?.addEventListener("change", (e) => {
      this.state.absTahunDefault = e.target.value ? Number(e.target.value) : null;
    });

    document.getElementById("stgAbsAddYearBtn")?.addEventListener("click", () => {
      const yr = parseInt(document.getElementById("stgAbsAddYearInp")?.value || "", 10);
      if (!Number.isFinite(yr) || yr < 2010 || yr > 2100) {
        this.toast("Masukkan tahun antara 2010 s/d 2100.", "error");
        return;
      }
      if (!this.state.absTambahTahun.includes(yr)) this.state.absTambahTahun.push(yr);
      if (!this.state.absTahunAktif.includes(yr)) this.state.absTahunAktif.push(yr);
      this.renderMain();
      this.isiAsyncNotifDanSimpan();
    });

    document.getElementById("stgBtnSaveAbsensi")?.addEventListener("click", async (ev) => {
      if (!this.state.absTahunAktif.length) {
        this.toast("Pilih minimal 1 tahun aktif untuk absensi.", "error");
        return;
      }
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await simpanAbsensiConfig(this.user().id, {
          tahun_aktif: this.state.absTahunAktif,
          tahun_default: this.state.absTahunDefault,
          periode_aktif: this.state.absPeriodeAktif,
          tambah_tahun: this.state.absTambahTahun,
        });
        this.state.absTambahTahun = [];
        this.toast("Konfigurasi absensi berhasil disimpan!");
      } catch (err) {
        this.toast("Gagal simpan konfigurasi absensi: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  },

  // ---------- EDITOR UANG KAS & KEUANGAN ----------
  ikatModulKas(main) {
    document.getElementById("stgUkAddLiburBtn")?.addEventListener("click", () => {
      const raw = document.getElementById("stgUkAddLiburInp")?.value || "";
      if (!raw) { this.toast("Pilih tanggal minggu yang ingin diliburkan.", "error"); return; }
      const senin = this.seninDari(raw);
      if (!this.state.ukLibur.includes(senin)) {
        this.state.ukLibur.push(senin);
        this.state.ukLibur.sort();
      }
      this.renderMain();
      this.isiAsyncNotifDanSimpan();
    });

    main.querySelectorAll("[data-uk-del-libur]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.ukDelLibur;
        this.state.ukLibur = this.state.ukLibur.filter((x) => x !== t);
        this.renderMain();
        this.isiAsyncNotifDanSimpan();
      });
    });

    document.getElementById("stgBtnSaveUangKas")?.addEventListener("click", async (ev) => {
      const nominal = typeof parseRupiah === "function"
        ? parseRupiah(document.getElementById("stgUkNominal")?.value)
        : parseInt(String(document.getElementById("stgUkNominal")?.value || "").replace(/\D/g, ""), 10) || 0;
      const mulaiRaw = document.getElementById("stgUkMulai")?.value || "";
      const catatan = document.getElementById("stgUkCatatan")?.value.trim() || "";
      if (nominal <= 0) { this.toast("Nominal iuran mingguan harus lebih dari 0.", "error"); return; }
      if (!mulaiRaw) { this.toast("Tanggal mulai kas wajib diisi.", "error"); return; }
      const mulai = this.seninDari(mulaiRaw);

      // Jaga riwayat tarif selaras dengan tarif aktif
      const riwayat = this.klon(this.state.ukRiwayat || []);
      if (!riwayat.length) {
        riwayat.push({ mulai, nominal });
      } else if (Number(riwayat[riwayat.length - 1].nominal) !== nominal) {
        const seninIni = this.seninDari(new Date().toISOString().slice(0, 10));
        const idx = riwayat.findIndex((r) => r.mulai === seninIni);
        if (idx >= 0) riwayat[idx].nominal = nominal;
        else riwayat.push({ mulai: seninIni, nominal });
      }

      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const { data, error } = await supa.rpc("simpan_uang_kas_config", {
          p_user_id: this.user().id,
          p_nominal_mingguan: nominal,
          p_tanggal_mulai: mulai,
          p_minggu_libur: this.state.ukLibur,
          p_tarif_riwayat: riwayat,
          p_catatan: catatan,
          p_angkatan_id: DbScope.angkatanId(),
        });
        if (error) throw error;
        cekOk(data);
        this.data.uangKasCfg = { nominal_mingguan: nominal, tanggal_mulai: mulai, minggu_libur: [...this.state.ukLibur], tarif_riwayat: riwayat, catatan };
        this.state.ukRiwayat = riwayat;
        this.toast("Pengaturan Uang Kas berhasil disimpan!");
      } catch (err) {
        this.toast("Gagal simpan uang kas: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("stgSaldoPeriode")?.addEventListener("change", (e) => {
      const per = Number(e.target.value);
      const hit = this.data.saldoAwalList.find((s) => Number(s.periode) === per);
      const inp = document.getElementById("stgSaldoNominal");
      if (inp) inp.value = Number(hit ? hit.nominal : 0).toLocaleString("id-ID");
    });

    document.getElementById("stgBtnSaveSaldo")?.addEventListener("click", async (ev) => {
      const per = parseInt(document.getElementById("stgSaldoPeriode")?.value || "", 10) || new Date().getFullYear();
      const nom = typeof parseRupiah === "function"
        ? parseRupiah(document.getElementById("stgSaldoNominal")?.value)
        : parseInt(String(document.getElementById("stgSaldoNominal")?.value || "").replace(/\D/g, ""), 10) || 0;
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await setSaldoAwal(this.user().id, per, nom);
        Cache.del("saldo_awal");
        this.data.saldoAwalList = await getSaldoAwal().catch(() => this.data.saldoAwalList);
        this.toast(`Saldo awal periode ${per} berhasil disimpan!`);
      } catch (err) {
        this.toast("Gagal simpan saldo awal: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  },

  // ---------- EDITOR TEMPLATE WAWANCARA ----------
  ikatModulWawancara() {
    document.getElementById("stgBtnResetTplWawancara")?.addEventListener("click", async () => {
      if (!(await this.tanya("Isi kolom dengan teks template standar bawaan? (Klik Simpan sesudahnya untuk menerapkan)"))) return;
      const elL = document.getElementById("stgTplLanjut");
      const elG = document.getElementById("stgTplGagal");
      if (elL) elL.value = this.SITE_DEFAULTS.hasil_wawancara_tpl_lanjut;
      if (elG) elG.value = this.SITE_DEFAULTS.hasil_wawancara_tpl_gagal;
    });

    document.getElementById("stgBtnSaveTplWawancara")?.addEventListener("click", async (ev) => {
      const tplL = document.getElementById("stgTplLanjut")?.value.trim() || "";
      const tplG = document.getElementById("stgTplGagal")?.value.trim() || "";
      if (!tplL || !tplG) {
        this.toast("Kedua template (Lanjut & Gagal) wajib diisi.", "error");
        return;
      }
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await wawancaraTemplateSimpan(this.user().id, tplL, tplG);
        this.data.siteMap.hasil_wawancara_tpl_lanjut = tplL;
        this.data.siteMap.hasil_wawancara_tpl_gagal = tplG;
        this.toast("Template pengumuman wawancara berhasil disimpan!");
      } catch (err) {
        this.toast("Gagal simpan template: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => PengaturanApp.init());
} else {
  PengaturanApp.init();
}
