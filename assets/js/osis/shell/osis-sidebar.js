// =========================================================================
// OSIS SIDEBAR - drawer kiri (folder /osis/*). Disuntik otomatis.
// CONFIG PUSAT: susunan menu disimpan di server (tabel site_content) dan
// berlaku untuk SEMUA user. Yang bisa mengatur (tombol "Atur Menu") hanya
// super_admin + pemegang hak kelola "Site". User biasa hanya melihat.
// Tambah/hapus/edit/geser urutan lewat mode Atur, tersimpan ke server.
// Offline: tampil cache terakhir / menu bawaan.
// Dev: ubah DEFAULT_MENU kalau halaman baru dibikin permanen.
// =========================================================================

const OsisSidebar = {
  // Kunci config di site_content untuk area ini.
  KUNCI: "sidebar_menu",
  // Ingatan posisi scroll sidebar (sessionStorage, per tab).
  KUNCI_SCROLL: "osis_sidebar_scroll",

  // Urutan tampil = urutan array. Item segrup wajib berurutan; header teks
  // muncul otomatis tiap nilai "grup" berubah (mis. Umum / Sekretaris).
  // grup "" di paling atas tampil sebagai kartu unggulan (Dashboard).
  // populer: true = ikut tampil di grid 2 kolom "Menu Populer" + tetap di grupnya.
  POPULER_DEFAULT: ["agenda", "tabungan", "program-bulanan", "uang-kas"],

  GRUP_META: {
    umum: { icon: "fa-solid fa-compass", warna: "#e11d2e", bg: "#ffe8ea", fg: "#9f1239" },
    sekretaris: { icon: "fa-solid fa-folder-open", warna: "#2563eb", bg: "#dbeafe", fg: "#1d4ed8" },
    bendahara: { icon: "fa-solid fa-coins", warna: "#1a7f37", bg: "#dcfce7", fg: "#166534" },
    "super admin": { icon: "fa-solid fa-crown", warna: "#ffd11a", bg: "#1a1314", fg: "#ffd11a" },
  },

  grupMeta(grup) {
    const k = String(grup || "").trim().toLowerCase();
    return (
      OsisSidebar.GRUP_META[k] || {
        icon: "fa-solid fa-layer-group",
        warna: "#f59e0b",
        bg: "#f5efea",
        fg: "#1a1314",
      }
    );
  },

  DEFAULT_MENU: [
    { href: "index", label: "Dashboard", icon: "fa-solid fa-grip", grup: "", populer: false },
    { href: "agenda", label: "Agenda", icon: "fa-solid fa-calendar-days", grup: "Umum", populer: true },
    { href: "anggota", label: "Anggota", icon: "fa-solid fa-users", grup: "Umum", populer: false },
    { href: "informasi", label: "Informasi", icon: "fa-solid fa-bullhorn", grup: "Umum", populer: false },
    { href: "wawancara", label: "Wawancara", icon: "fa-solid fa-comments", grup: "Umum", populer: false },
    { href: "hasil-wawancara", label: "Hasil Wawancara", icon: "fa-solid fa-square-poll-vertical", grup: "Umum", populer: false },
    { href: "tes", label: "Tes & Kuis", icon: "fa-solid fa-clipboard-question", grup: "Umum", populer: false },
    { href: "program-bulanan", label: "Program Bulanan", icon: "fa-solid fa-calendar-days", grup: "Umum", populer: true },
    { href: "program-tahunan", label: "Program Tahunan", icon: "fa-solid fa-calendar", grup: "Umum", populer: false },
    { href: "poster", label: "Poster", icon: "fa-solid fa-newspaper", grup: "Umum", populer: false },
    { href: "profil", label: "Profil Saya", icon: "fa-solid fa-circle-user", grup: "Umum", populer: false },
    { href: "absensi", label: "Absensi", icon: "fa-solid fa-clipboard-user", grup: "Sekretaris", populer: false },
    { href: "notulensi", label: "Notulensi", icon: "fa-solid fa-clipboard-list", grup: "Sekretaris", populer: false },
    { href: "dokumen", label: "Dokumen", icon: "fa-solid fa-folder-open", grup: "Sekretaris", populer: false },
    { href: "keuangan", label: "Keuangan", icon: "fa-solid fa-wallet", grup: "Bendahara", populer: false },
    { href: "tabungan", label: "Tabungan", icon: "fa-solid fa-piggy-bank", grup: "Bendahara", populer: true },
    { href: "uang-kas", label: "Uang Kas", icon: "fa-solid fa-coins", grup: "Bendahara", populer: true },
    { href: "akses", label: "Akses", icon: "fa-solid fa-key", super: true, grup: "Super Admin", populer: false },
    { href: "users", label: "Akun OSIS", icon: "fa-solid fa-user-gear", super: true, grup: "Super Admin", populer: false },
    { href: "logs", label: "Logs", icon: "fa-solid fa-clock-rotate-left", super: true, grup: "Super Admin", populer: false },
    { href: "notifikasi", label: "Kirim Notifikasi", icon: "fa-solid fa-paper-plane", super: true, grup: "Super Admin", populer: false },
  ],

  // Kompatibel ke belakang: kode lama baca OsisSidebar.MENU (array).
  MENU: [
    ["index", "Dashboard", "fa-solid fa-grip"],
    ["anggota", "Anggota", "fa-solid fa-users"],
    ["absensi", "Absensi", "fa-solid fa-clipboard-user"],
    ["tabungan", "Tabungan", "fa-solid fa-piggy-bank"],
    ["uang-kas", "Uang Kas", "fa-solid fa-coins"],
    ["keuangan", "Keuangan", "fa-solid fa-wallet"],
    ["agenda", "Agenda", "fa-solid fa-calendar-days"],
    ["dokumen", "Dokumen", "fa-solid fa-folder-open"],
    ["poster", "Poster", "fa-solid fa-newspaper"],
    ["informasi", "Informasi", "fa-solid fa-bullhorn"],
    ["notulensi", "Notulensi", "fa-solid fa-clipboard-list"],
    ["wawancara", "Wawancara", "fa-solid fa-comments"],
    ["hasil-wawancara", "Hasil Wawancara", "fa-solid fa-square-poll-vertical"],
    ["tes", "Tes & Kuis", "fa-solid fa-clipboard-question"],
    ["program-tahunan", "Program Tahunan", "fa-solid fa-calendar"],
    ["program-bulanan", "Program Bulanan", "fa-solid fa-calendar-days"],
    ["profil", "Profil Saya", "fa-solid fa-circle-user"],
    ["akses", "Akses", "fa-solid fa-key", "super"],
    ["users", "Akun OSIS", "fa-solid fa-user-gear", "super"],
    ["logs", "Logs", "fa-solid fa-clock-rotate-left", "super"],
    ["notifikasi", "Notifikasi", "fa-solid fa-paper-plane", "super"],
  ],

  // Daftar kelas ikon Font Awesome yang sering dipakai (referensi),
  // bisa dipakai buat isi kolom "Ikon" di form tambah/edit.
  ICONS: [
    "fa-solid fa-grip",
    "fa-solid fa-house",
    "fa-solid fa-users",
    "fa-solid fa-user",
    "fa-solid fa-clipboard-user",
    "fa-solid fa-clipboard-list",
    "fa-solid fa-clipboard-check",
    "fa-solid fa-clipboard-question",
    "fa-solid fa-piggy-bank",
    "fa-solid fa-coins",
    "fa-solid fa-wallet",
    "fa-solid fa-calendar-days",
    "fa-solid fa-calendar",
    "fa-solid fa-folder-open",
    "fa-solid fa-newspaper",
    "fa-solid fa-file-lines",
    "fa-solid fa-list-check",
    "fa-solid fa-star-half-stroke",
    "fa-solid fa-key",
    "fa-solid fa-gear",
    "fa-solid fa-link",
    "fa-solid fa-paper-plane",
    "fa-solid fa-bell",
  ],

  // Config dari server (null = belum dimuat / tidak ada -> pakai bawaan).
  serverMenu: null,
  _scrollAwal: null, // posisi scroll sidebar yang mau dipulihkan (sekali pas load)
  editMode: false,
  editIndex: -1, // -1 = tambah baru, >=0 = lagi edit item ke-N
  draft: null, // draf mode atur (disimpan ke server pas pencet "Selesai")
  _undo: [], // tumpukan undo draf (snapshot tiap aksi di mode atur)
  drag: null, // status drag & drop urutan (mode atur)
  _dragToken: 0,
  _baruDrag: 0,
  _timerTahan: null, // timer "tahan di kartu" buat drag sentuh
  _blokGulir: null, // listener touchmove penahan scroll saat drag

  cacheKey() {
    return "sidebar_" + OsisSidebar.KUNCI;
  },

  _userLokal() {
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.getUser) return OsisAuth.getUser();
      return JSON.parse(localStorage.getItem("osis_user") || "null");
    } catch (e) {
      return null;
    }
  },

  _aksesLokal() {
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) return OsisAuth.getAkses();
      return JSON.parse(localStorage.getItem("osis_akses") || "null");
    } catch (e) {
      return null;
    }
  },

  uid() {
    try {
      const u = OsisSidebar._userLokal();
      if (u && u.mode === "osis" && u.id) return u.id;
    } catch (e) {}
    return null;
  },

  // Boleh mengatur sidebar? super_admin selalu lolos (punya semua hak).
  bisaAtur() {
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.bisa) {
        return !!OsisAuth.bisa("site");
      }
      const u = OsisSidebar._userLokal();
      const a = OsisSidebar._aksesLokal();
      if (!u || u.mode !== "osis" || !a) return false;
      if (a.super) return true;
      const list = Array.isArray(a.halaman) ? a.halaman : [];
      return list.includes("site") || list.includes("*");
    } catch (e) {
      return false;
    }
  },

  // Normalisasi 1 entri: dukung format lama [href,label,icon,flag]
  // maupun format baru {href,label,icon,super,grup,populer}.
  normalizeItem(raw) {
    if (Array.isArray(raw)) {
      return {
        href: String(raw[0] || "").trim(),
        label: String(raw[1] || "").trim(),
        icon: String(raw[2] || "fa-solid fa-link").trim() || "fa-solid fa-link",
        super: raw[3] === "super" || raw[3] === true,
        grup: "",
        populer: false,
      };
    }
    const o = raw && typeof raw === "object" ? raw : {};
    return {
      href: String(o.href || "").trim(),
      label: String(o.label || "").trim(),
      icon: String(o.icon || "fa-solid fa-link").trim() || "fa-solid fa-link",
      super: o.super === true || o.super === "super",
      grup: String(o.grup || "").trim(),
      populer: o.populer === true || o.populer === "true" || o.populer === 1,
    };
  },

  // Normalisasi array menu; fallback isi populer bawaan kalau data lama belum punya field "populer".
  normalisasiDaftar(rawArr) {
    if (!Array.isArray(rawArr)) return [];
    const punyaPopuler = rawArr.some(
      (x) =>
        x &&
        typeof x === "object" &&
        !Array.isArray(x) &&
        Object.prototype.hasOwnProperty.call(x, "populer"),
    );
    const items = rawArr
      .map((x) => OsisSidebar.normalizeItem(x))
      .filter((x) => x.href && x.label);
    if (!punyaPopuler) {
      items.forEach((it) => {
        if (OsisSidebar.POPULER_DEFAULT.includes(OsisSidebar.slugHref(it.href))) {
          it.populer = true;
        }
      });
    }
    return items;
  },

  // Menu efektif: config server kalau ada, kalau tidak = bawaan.
  // Di mode atur, yang dipakai = draf lokal (belum kekirim sampai "Selesai").
  getMenu() {
    if (OsisSidebar.editMode && Array.isArray(OsisSidebar.draft))
      return OsisSidebar.draft.map((x) => ({ ...x }));
    return OsisSidebar.menuTersimpan();
  },

  // Susunan yang lagi berlaku di luar draf (server / bawaan).
  menuTersimpan() {
    if (Array.isArray(OsisSidebar.serverMenu) && OsisSidebar.serverMenu.length)
      return OsisSidebar.serverMenu.map((x) => ({ ...x }));
    return OsisSidebar.DEFAULT_MENU.map((x) => ({ ...x }));
  },

  // Ubah menu secara lokal (belum kekirim - nunggu tombol "Selesai").
  terapkanDraft(items) {
    if (OsisSidebar.editMode && Array.isArray(OsisSidebar.draft)) {
      // Simpen kondisi sebelumnya buat tombol Undo.
      OsisSidebar._undo.push(OsisSidebar.draft);
      if (OsisSidebar._undo.length > 50) OsisSidebar._undo.shift();
    }
    OsisSidebar.draft = (items || []).map((x) => OsisSidebar.normalizeItem(x));
    OsisSidebar.renderMenu();
  },

  // Balikin draf ke kondisi sebelum aksi terakhir (bisa diulang-ulang).
  undo() {
    if (!OsisSidebar.editMode) return;
    const arr = OsisSidebar._undo;
    if (!Array.isArray(arr) || !arr.length) {
      if (typeof showToast === "function")
        showToast("Belum ada yang bisa dibatalin.", "info");
      return;
    }
    OsisSidebar.draft = arr.pop().map((x) => OsisSidebar.normalizeItem(x));
    OsisSidebar.renderMenu();
  },

  // Bandingin 2 susunan menu (deteksi ada perubahan atau nggak).
  menuSama(a, b) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      const p = OsisSidebar.normalizeItem(x[i]);
      const q = OsisSidebar.normalizeItem(y[i]);
      if (
        p.href !== q.href ||
        p.label !== q.label ||
        p.icon !== q.icon ||
        p.super !== q.super ||
        p.grup !== q.grup ||
        !!p.populer !== !!q.populer
      )
        return false;
    }
    return true;
  },

  // Tombol Undo di footer (cuma muncul pas mode atur, mati kalau riwayat kosong).
  perbaruiUndo() {
    const btn = document.getElementById("osisSideUndo");
    if (!btn) return;
    btn.style.display = OsisSidebar.editMode ? "" : "none";
    btn.disabled = !OsisSidebar._undo || !OsisSidebar._undo.length;
  },

  // Tandai tombol "Selesai" kalau draf belum disimpan (titik kuning).
  tandaiKotor() {
    const btn = document.getElementById("osisSideAtur");
    if (!btn) return;
    const kotor =
      OsisSidebar.editMode &&
      Array.isArray(OsisSidebar.draft) &&
      !OsisSidebar.menuSama(OsisSidebar.draft, OsisSidebar.menuTersimpan());
    btn.classList.toggle("kotor", !!kotor);
  },

  bacaCache() {
    // Cache lokal biar sidebar langsung tampil + tetap ada saat offline
    // (tetap kebaca sinkron walau db.js / Cache belum dieksekusi).
    try {
      let arr = null;
      if (typeof Cache !== "undefined" && Cache.get) {
        arr = Cache.get(OsisSidebar.cacheKey());
      } else {
        const rawV3 = localStorage.getItem("osis_cache_v3_" + OsisSidebar.cacheKey());
        if (rawV3) {
          const obj = JSON.parse(rawV3);
          arr = obj && Array.isArray(obj.data) ? obj.data : obj;
        }
        if (!Array.isArray(arr)) {
          const raw = localStorage.getItem("osis_cache_" + OsisSidebar.cacheKey());
          arr = raw ? JSON.parse(raw) : null;
        }
      }
      if (Array.isArray(arr) && arr.length) {
        const items = OsisSidebar.normalisasiDaftar(arr);
        if (items.length) return items;
      }
    } catch (e) {}
    return null;
  },

  tulisCache(items) {
    try {
      if (typeof Cache !== "undefined" && Cache.set) {
        Cache.set(OsisSidebar.cacheKey(), items);
      } else {
        localStorage.setItem(
          "osis_cache_" + OsisSidebar.cacheKey(),
          JSON.stringify(items),
        );
      }
    } catch (e) {}
  },

  // Muat config pusat: cache dulu (instan), lalu server (segarkan bila berubah).
  async muat() {
    const sebelum = OsisSidebar.menuTersimpan();
    const cache = OsisSidebar.bacaCache();
    if (cache && !OsisSidebar._kotor) {
      OsisSidebar.serverMenu = cache;
      if (!OsisSidebar.menuSama(OsisSidebar.menuTersimpan(), sebelum)) {
        OsisSidebar.renderMenu();
      }
    }
    if (typeof getSidebarMenu !== "function") return;
    const sebelumServer = OsisSidebar.menuTersimpan();
    try {
      const arr = await getSidebarMenu(OsisSidebar.KUNCI);
      if (Array.isArray(arr) && arr.length) {
        const items = OsisSidebar.normalisasiDaftar(arr);
        // Jangan nimpa perubahan lokal yang belum kelar ke-upload.
        if (items.length && !OsisSidebar._kotor) {
          OsisSidebar.serverMenu = items;
          OsisSidebar.tulisCache(items);
        }
      }
    } catch (e) {
      // offline / gagal: tetap pakai cache atau bawaan
    }
    if (!OsisSidebar.menuSama(OsisSidebar.menuTersimpan(), sebelumServer)) {
      OsisSidebar.renderMenu();
    }
  },

  // Simpan susunan ke server (berlaku untuk semua user).
  // Tampilan + cache langsung berubah (optimis); uploadnya jalan di belakang.
  simpanKeServer(items, pesanOk) {
    const uid = OsisSidebar.uid();
    if (!uid) {
      if (typeof showToast === "function")
        showToast("Login dulu sebagai OSIS.", "error");
      return false;
    }
    const bersih = (items || [])
      .map((x) => OsisSidebar.normalizeItem(x))
      .filter((x) => x.href && x.label)
      .map((x) => ({
        href: x.href,
        label: x.label,
        icon: x.icon,
        super: !!x.super,
        grup: String(x.grup || "").trim(),
        populer: !!x.populer,
      }));
    if (!bersih.length) {
      if (typeof showToast === "function")
        showToast("Menu tidak boleh kosong semua.", "error");
      return false;
    }
    // Tampilan + cache dulu - gak nunggu server.
    OsisSidebar.serverMenu = bersih;
    OsisSidebar.tulisCache(bersih);
    OsisSidebar.renderMenu();
    OsisSidebar._kotor = true; // ada perubahan lokal yang belum kekirim
    // Upload di belakang: di-debounce (drag cepat jadi 1 kiriman) + diantre biar urut.
    OsisSidebar._pesanSimpan = pesanOk || "Sidebar diperbarui untuk semua user.";
    clearTimeout(OsisSidebar._timerSimpan);
    OsisSidebar._timerSimpan = setTimeout(() => OsisSidebar.kirimKeServer(), 300);
    return true;
  },

  // Kirim snapshot paling baru ke server di belakang layar.
  kirimKeServer() {
    const uid = OsisSidebar.uid();
    const bersih = OsisSidebar.serverMenu;
    if (!uid || !bersih) return;
    const pesan = OsisSidebar._pesanSimpan;
    OsisSidebar._pesanSimpan = "";
    OsisSidebar._antre = (OsisSidebar._antre || Promise.resolve()).then(
      async () => {
        try {
          if (typeof simpanSidebarMenu !== "function")
            throw new Error("db.js belum dimuat.");
          await simpanSidebarMenu(uid, OsisSidebar.KUNCI, bersih);
          if (pesan && typeof showToast === "function") showToast(pesan, "success");
        } catch (err) {
          if (typeof showToast === "function")
            showToast(
              "Gagal simpan: " + (err && err.message ? err.message : err),
              "error",
            );
        }
        // Kalau gak ada perubahan yang lebih baru, berarti udah sinkron.
        if (OsisSidebar.serverMenu === bersih) OsisSidebar._kotor = false;
      },
    );
  },

  async resetMenu() {
    let yakin = true;
    try {
      yakin = (typeof showPopup === "function")
        ? !!(await showPopup("Kembalikan menu sidebar ke susunan bawaan?", "confirm"))
        : true;
    } catch (e) { yakin = true; }
    if (!yakin) return;
    OsisSidebar.editIndex = -1;
    OsisSidebar.terapkanDraft(OsisSidebar.DEFAULT_MENU.map((x) => ({ ...x })));
    if (typeof showToast === "function")
      showToast("Bawaan diterapkan — tekan Selesai buat nyimpen.", "info");
  },

  // Entri super (mis. Akses) cuma tampil untuk super_admin.
  menuTampil() {
    let superUser = false;
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.isSuper) {
        superUser = !!OsisAuth.isSuper();
      } else {
        const u = OsisSidebar._userLokal();
        const a = OsisSidebar._aksesLokal();
        superUser = !!(u && u.mode === "osis" && a && a.super);
      }
    } catch (e) {}
    return OsisSidebar.getMenu().filter((m) => !m.super || superUser);
  },

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

  // Cocokkan href dengan halaman aktif (dukung "agenda", "agenda.html",
  // "../index#/", URL penuh, dsb).
  slugHref(href) {
    const h = String(href || "").trim();
    if (!h || h.startsWith("#") || h.startsWith("http") || h.includes("://"))
      return "";
    const last = h.split("?")[0].split("#")[0].split("/").pop() || "";
    return last.toLowerCase().replace(/\.html?$/, "");
  },

  toggle() {
    const sb = document.getElementById("osisSidebar");
    if (!sb) return;
    sb.classList.contains("open") ? OsisSidebar.close() : OsisSidebar.open();
  },

  open() {
    const sb = document.getElementById("osisSidebar");
    const bg = document.getElementById("osisSidebarBg");
    if (sb) sb.classList.add("open");
    if (bg) bg.classList.add("open");
    document.body.style.overflow = "hidden";
  },

  close() {
    const sb = document.getElementById("osisSidebar");
    const bg = document.getElementById("osisSidebarBg");
    if (sb) sb.classList.remove("open");
    if (bg) bg.classList.remove("open");
    if (
      !document.querySelector(
        ".agenda-form.open, .notulensi-form.open, .proker-form.open, .dokumen-form.open, .task-form.open, .kas-form.open, .evaluasi-form.open, .angg-popup.open",
      )
    ) {
      document.body.style.overflow = "";
    }
  },

  halamanAktif() {
    const seg = (location.pathname.split("/").pop() || "index")
      .toLowerCase()
      .replace(/\.html?$/, "");
    return seg || "index";
  },

  // Isi judul halaman di top-nav (desktop): ikon + nama dari menu sidebar.
  // Gak ketemu di menu (halaman baru, dsb) -> pakai judul tab.
  perbaruiJudul() {
    const el = document.querySelector(".osis-top-judul");
    if (!el) return;
    const ico = el.querySelector("i");
    const span = el.querySelector("span");
    if (!ico || !span) return;
    const hal = OsisSidebar.halamanAktif();
    const item = OsisSidebar.getMenu().find(
      (m) => OsisSidebar.slugHref(m.href) === hal,
    );
    if (item) {
      ico.className = item.icon || "fa-solid fa-file-lines";
      span.textContent = item.label || hal;
      return;
    }
    ico.className = "fa-solid fa-file-lines";
    span.textContent =
      String(document.title || "").split("—")[0].trim() || "OSIS TARPAN ONE";
  },

  pasang() {
    if (!document.body || document.getElementById("osisSidebar")) return;

    document.getElementById("osisNav")?.remove();

    if (!document.getElementById("osisSidebarStyle")) {
      const st = document.createElement("style");
      st.id = "osisSidebarStyle";
      st.textContent = `
                #osisSideBtn { flex-shrink: 0; }
                .osis-sidebar-bg { position: fixed; inset: 0; background: rgba(15,10,11,.55); z-index: 290; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .2s ease, visibility .2s ease; }
                .osis-sidebar-bg.open { opacity: 1; visibility: visible; pointer-events: auto; }
                .osis-sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: min(300px, 86vw); background: var(--white); border-right: 3px solid var(--bd); z-index: 295; transform: translateX(-105%); transition: transform .25s cubic-bezier(.34,1.2,.64,1), width .22s ease; display: flex; flex-direction: column; }
                .osis-sidebar.open { transform: none; }
                .osis-sidebar-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 2.5px solid var(--bd); background: var(--white); }
                .osis-side-head-logo { height: 46px; flex-shrink: 0; }
                .osis-side-head-logo img { height: 100%; width: auto; object-fit: contain; display: block; }
                .osis-sidebar-head .t { flex: 1; min-width: 0; }
                .osis-sidebar-head h2 { font-size: .95rem; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .osis-side-subrow { display: flex; align-items: center; gap: 6px; margin-top: 3px; min-width: 0; }
                .osis-sidebar-head p { font-size: .58rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--red); white-space: nowrap; }
                .osis-side-ang { display: inline-block; max-width: 112px; padding: 1px 6px; border: 1.5px solid var(--bd); border-radius: 999px; background: var(--yellow); color: var(--on-yellow); font-size: .56rem; font-weight: 900; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
                .osis-side-stripes { height: 5px; flex-shrink: 0; border-bottom: 2.5px solid var(--bd); background: repeating-linear-gradient(-45deg, var(--red) 0 10px, var(--inv-bg) 10px 20px, var(--yellow) 20px 30px, var(--inv-bg) 30px 40px); color: var(--on-yellow); }
                .osis-top-judul { display: none; }
                .osis-sidebar nav { flex: 1; overflow-y: auto; padding: 12px 12px 18px; display: flex; flex-direction: column; gap: 4px; }
                .osis-side-dash { display: flex; align-items: center; gap: 11px; padding: 9px 11px; margin-bottom: 8px; border: 2.5px solid var(--bd); border-radius: 14px; background: var(--white); color: var(--ink); text-decoration: none; box-shadow: 3px 3px 0 var(--sh); transition: transform .12s, box-shadow .12s, background .12s; }
                .osis-side-dash:hover { background: #fffbeb; transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--sh); }
                .osis-side-dash:active { transform: translate(1.5px, 1.5px); box-shadow: 1px 1px 0 var(--sh); }
                .osis-side-dash.active { background: var(--red); color: #fff; }
                .osis-side-dash .dic { width: 34px; height: 34px; border-radius: 10px; border: 2px solid var(--bd); background: var(--yellow); color: var(--on-yellow); display: grid; place-items: center; font-size: .95rem; flex-shrink: 0; box-shadow: 2px 2px 0 var(--sh); }
                .osis-side-dash .dt { flex: 1; min-width: 0; }
                .osis-side-dash .dt b { display: block; font-size: .9rem; font-weight: 900; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .osis-side-dash .dt small { display: block; font-size: .64rem; font-weight: 700; color: var(--gray); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .osis-side-dash.active .dt small { color: rgba(255,255,255,.86); }
                .osis-side-dash .darr { width: 22px; height: 22px; border-radius: 999px; background: var(--paper-2); border: 1.5px solid var(--bd); display: grid; place-items: center; font-size: .62rem; color: var(--ink); flex-shrink: 0; }
                .osis-side-dash.active .darr { background: var(--yellow); color: var(--on-yellow); }
                .osis-pop-box { margin-bottom: 6px; padding: 10px; border: 2.5px solid var(--bd); border-radius: 16px; background-color: var(--paper-2); background-image: radial-gradient(rgba(26,19,20,.09) 1.1px, transparent 1.1px); background-size: 10px 10px; box-shadow: 3px 3px 0 var(--sh); }
                .osis-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px; }
                .osis-pop-title { display: inline-flex; align-items: center; gap: 6px; font-size: .66rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; color: var(--ink); }
                .osis-pop-title i { color: var(--red); font-size: .76rem; }
                .osis-pop-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border: 1.5px solid var(--bd); border-radius: 999px; background: var(--yellow); color: var(--on-yellow); font-size: .54rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
                .osis-pop-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
                .osis-pop-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px 9px; border: 2px solid var(--bd); border-radius: 12px; background: var(--white); color: var(--ink); text-decoration: none; box-shadow: 2px 2px 0 var(--sh); transition: transform .12s, box-shadow .12s, background .12s; min-width: 0; }
                .osis-pop-tile:hover { background: var(--yellow); transform: translate(-1px, -1px); box-shadow: 3px 3px 0 var(--sh); color: var(--on-yellow); }
                .osis-pop-tile:active { transform: translate(1px, 1px); box-shadow: none; }
                .osis-pop-tile.active { background: var(--red); color: #fff; box-shadow: 2px 2px 0 var(--sh); }
                .osis-pop-tile .pic { width: 26px; height: 26px; border-radius: 8px; border: 1.5px solid var(--bd); background: var(--paper-2); color: var(--red); display: grid; place-items: center; font-size: .8rem; flex-shrink: 0; transition: background .12s, color .12s; }
                .osis-pop-tile:hover .pic { background: var(--white); color: var(--ink); }
                .osis-pop-tile.active .pic { background: var(--yellow); color: var(--on-yellow); }
                .osis-pop-tile .plbl { font-size: .75rem; font-weight: 800; line-height: 1.18; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
                .osis-pop-tile:last-child:nth-child(odd) { grid-column: 1 / -1; flex-direction: row; align-items: center; gap: 9px; }
                .osis-side-sec { display: flex; align-items: center; gap: 7px; font-size: .64rem; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: var(--gray); padding: 12px 4px 4px; margin-top: 6px; border-top: 2px dashed var(--line); }
                .osis-side-sec.first { margin-top: 2px; border-top: none; padding-top: 6px; }
                .osis-side-sec .sec-ico { width: 19px; height: 19px; border-radius: 6px; border: 1.5px solid var(--bd); background: var(--sec-bg, var(--paper-2)); color: var(--sec-fg, var(--ink)); display: grid; place-items: center; font-size: .56rem; flex-shrink: 0; }
                .osis-side-sec .sec-lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); opacity: .78; }
                .osis-side-sec .sec-cnt { padding: 1px 7px; border-radius: 999px; background: var(--paper-2); border: 1.5px solid rgba(26,19,20,.16); font-size: .56rem; font-weight: 900; color: var(--gray); letter-spacing: 0; }
                .osis-sidebar-link { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 2px solid transparent; border-radius: 12px; background: transparent; font-size: .85rem; font-weight: 800; text-decoration: none; color: var(--ink); box-shadow: none; transition: background .12s, border-color .12s, transform .12s, box-shadow .12s; }
                .osis-sidebar-link:hover { background: var(--paper-2); border-color: rgba(26,19,20,.2); }
                .osis-sidebar-link:active { transform: translate(1px, 1px); }
                .osis-sidebar-link.active { background: var(--red); color: #fff; border-color: var(--bd); box-shadow: 2.5px 2.5px 0 var(--sh); }
                .osis-sidebar-link .sic { width: 28px; height: 28px; border-radius: 9px; border: 1.5px solid rgba(26,19,20,.14); background: var(--paper-2); display: grid; place-items: center; flex-shrink: 0; color: var(--red); font-size: .84rem; transition: background .12s, border-color .12s, color .12s; }
                .osis-sidebar-link:hover .sic { background: var(--yellow); border-color: var(--bd); color: var(--on-yellow); }
                .osis-sidebar-link.active .sic { background: var(--yellow); border-color: var(--bd); color: var(--on-yellow); }
                .osis-sidebar-foot { padding: 10px 12px 12px; border-top: 3px solid var(--bd); background: var(--paper); display: flex; flex-direction: column; gap: 8px; }
                .osis-side-atur { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 9px 12px; border: 2.5px solid var(--bd); border-radius: 12px; background: var(--paper-2); font-size: .78rem; font-weight: 900; color: var(--ink); cursor: pointer; box-shadow: 2px 2px 0 var(--sh); font-family: inherit; }
                .osis-side-atur:active { transform: translate(1px,1px); box-shadow: none; }
                .osis-side-atur.done { background: var(--green); color: #fff; }
                .osis-side-atur.kotor::after { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--yellow); border: 2px solid var(--bd); color: var(--on-yellow); }
                .side-edit-row { display: flex; align-items: center; gap: 8px; padding: 7px 6px 7px 10px; border-radius: 12px; cursor: pointer; }
                .side-edit-row:hover { background: rgba(26, 19, 20, .06); }
                .side-edit-row .sic { width: 22px; text-align: center; color: var(--red); flex-shrink: 0; font-size: .95rem; }
                .side-edit-teks { flex: 1; min-width: 0; }
                .side-edit-teks b { display: block; font-size: .82rem; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .side-edit-teks small { display: block; font-size: .64rem; font-weight: 700; color: var(--gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .side-chip-super { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 6px; background: var(--yellow); color: var(--on-yellow); font-size: .5rem; margin-left: 6px; vertical-align: 2px; }
                .side-star { width: 28px; height: 28px; flex-shrink: 0; border: 1.5px solid transparent; border-radius: 8px; background: transparent; color: #b8afb1; display: grid; place-items: center; cursor: pointer; font-size: .76rem; transition: background .12s, color .12s, border-color .12s; }
                .side-star:hover { background: rgba(26, 19, 20, .08); color: var(--ink); }
                .side-star.on { background: var(--yellow); color: var(--on-yellow); border-color: var(--bd); box-shadow: 1.5px 1.5px 0 var(--sh); }
                .side-grip { color: var(--gray); flex-shrink: 0; padding: 8px 6px; border-radius: 8px; cursor: grab; touch-action: none; user-select: none; }
                .side-grip:hover { background: rgba(26, 19, 20, .08); color: var(--ink); }
                .side-drag { opacity: .45; background: var(--paper-2); }
                .side-hantu { background: var(--white); border: 2.5px solid var(--bd); border-radius: 12px; box-shadow: 3px 3px 0 var(--sh); overflow: hidden; }
                .side-hantu.side-edit-sec { padding: 10px 12px; }
                .side-drop-atas { box-shadow: 0 -4px 0 var(--red); }
                .side-drop-bawah { box-shadow: 0 4px 0 var(--red); }
                .osis-sidebar.editing .side-edit-row, .osis-sidebar.editing .side-edit-sec { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
                .side-edit-sec { display: flex; align-items: center; gap: 6px; font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; color: var(--gray); padding: 12px 6px 3px; }
                .side-edit-sec .cnt { margin-left: auto; background: var(--paper-2); border-radius: 999px; padding: 1px 8px; font-size: .58rem; }
                .side-grup-grip { color: var(--gray); flex-shrink: 0; padding: 6px; margin: -6px 0; border-radius: 7px; cursor: grab; touch-action: none; user-select: none; font-size: .6rem; }
                .side-grup-grip:hover { background: rgba(26, 19, 20, .08); color: var(--ink); }
                .side-sec-pen { border: none; background: none; color: var(--gray); cursor: pointer; font-size: .6rem; padding: 3px 5px; border-radius: 7px; }
                .side-sec-pen:hover { color: var(--ink); background: rgba(26, 19, 20, .08); }
                .side-add-big { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 10px; margin-bottom: 4px; border: none; border-radius: 12px; background: var(--paper-2); font-size: .8rem; font-weight: 900; color: var(--ink); cursor: pointer; font-family: inherit; }
                .side-add-big:hover { filter: brightness(.95); }
                .side-tools { display: flex; gap: 8px; margin-bottom: 4px; }
                .side-tools .side-add-big { flex: 1; width: auto; margin-bottom: 0; }
                .side-info { width: 46px; flex-shrink: 0; border: 2.5px solid var(--bd); border-radius: 12px; background: var(--paper-2); color: var(--ink); font-size: .85rem; cursor: pointer; box-shadow: 2px 2px 0 var(--sh); font-family: inherit; }
                .side-info:active { transform: translate(1px, 1px); box-shadow: none; }
                .side-atur-baris { display: flex; gap: 8px; }
                .side-atur-baris .osis-side-atur { flex: 1; width: auto; }
                .osis-side-undo { width: 46px; flex-shrink: 0; border: 2.5px solid var(--bd); border-radius: 12px; background: var(--paper-2); color: var(--ink); font-size: .85rem; cursor: pointer; box-shadow: 2px 2px 0 var(--sh); font-family: inherit; }
                .osis-side-undo:active:not(:disabled) { transform: translate(1px,1px); box-shadow: none; }
                .osis-side-undo:disabled { opacity: .35; cursor: default; box-shadow: none; }
                .side-edit-pen { color: var(--gray); flex-shrink: 0; padding: 8px 6px; border-radius: 8px; cursor: pointer; }
                .side-edit-pen:hover { color: var(--ink); background: rgba(26, 19, 20, .08); }
                .side-reset { border: none; background: none; color: var(--red-dark); font-size: .7rem; font-weight: 800; cursor: pointer; text-decoration: underline; font-family: inherit; padding: 10px 4px; margin-top: 4px; }
                .side-hint { font-size: .68rem; font-weight: 600; color: var(--gray); line-height: 1.4; }
                .uni-overlay { z-index: 320; }
                .uni-box.uni-tall .uni-form-container { flex: 1; min-height: 0; overflow-y: auto; padding: 0 18px 4px; margin-bottom: 8px; }
                .uni-box.uni-tall .uni-actions { flex-shrink: 0; margin: 0 18px 16px; }
                .uni-ikon-baris { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
                .uni-ikon-prev { width: 44px; height: 44px; flex-shrink: 0; display: grid; place-items: center; border: 2.5px solid var(--bd); border-radius: 12px; background: var(--paper); font-size: 1.05rem; color: var(--ink); }
                .uni-ikon-toggle { display: inline-flex; align-items: center; gap: 7px; border: 2.5px solid var(--bd); border-radius: 10px; background: var(--white); font-family: inherit; font-size: .74rem; font-weight: 900; color: var(--ink); padding: 9px 12px; cursor: pointer; }
                .uni-ikon-toggle:hover { background: var(--paper-2); }
                .uni-ikon-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding: 8px; background: var(--paper-2); border-radius: 12px; }
                .uni-ikon-grid[hidden] { display: none; }
                .uni-ikon-chip { width: 36px; height: 36px; border: none; border-radius: 10px; background: var(--white); cursor: pointer; display: grid; place-items: center; font-size: .82rem; color: var(--ink); }
                .uni-ikon-chip:hover { filter: brightness(.94); }
                .uni-ikon-chip.on { background: var(--inv-bg); color: var(--yellow); }
                .uni-hapus { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin-top: 14px; padding: 10px; border: 2.5px solid var(--bd); border-radius: 12px; background: #ffe9e9; color: var(--red-dark); font-family: inherit; font-size: .78rem; font-weight: 900; cursor: pointer; }
                .uni-hapus:hover { background: #ffdcdc; }
                .uni-hint { margin: 6px 0 0; font-size: .68rem; color: var(--gray); line-height: 1.35; }
                @media (min-width: 900px) {
                    body.osis-side-static { padding-left: 300px; }
                    body.osis-side-static.osis-side-anim { transition: padding-left .22s ease; }
                    body.osis-side-static.osis-side-edit-wide { padding-left: 392px; }
                    body.osis-side-static .osis-sidebar { transform: none; transition: width .22s ease; }
                    body.osis-side-static .osis-sidebar.editing { width: min(392px, 94vw); }
                    body.osis-side-static #osisSideBtn { display: none; }
                    body.osis-side-static .top-nav .brand { display: none; }
                    body.osis-side-static .top-nav { height: 76.4px; }
                    body.osis-side-static .osis-sidebar-head { height: 76.4px; flex-shrink: 0; }
                    body.osis-side-static .osis-top-judul { display: flex; align-items: center; gap: 10px; min-width: 0; }
                    body.osis-side-static .osis-top-judul i { color: var(--red); font-size: 1.25rem; }
                    body.osis-side-static .osis-top-judul span { font-size: 1.45rem; font-weight: 900; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    body.osis-side-static .osis-sidebar-bg { display: none !important; }
                    body.osis-side-static #osisSideClose { display: none; }
                }
            `;
      const darkLink = document.querySelector('link[href*="dark.css"]');
      if (darkLink && darkLink.parentNode) darkLink.parentNode.insertBefore(st, darkLink);
      else document.head.appendChild(st);
    }

    // Mode desktop dipasang duluan (sebelum sidebar dibuat) biar transform-nya
    // gak berubah di tengah jalan — mencegah animasi slide-in pas load.
    OsisSidebar.terapkanMode();

    const header = document.querySelector("header.top-nav");
    if (header && !document.getElementById("osisSideBtn")) {
      const btn = document.createElement("button");
      btn.className = "icon-btn";
      btn.id = "osisSideBtn";
      btn.title = "Menu OSIS";
      btn.innerHTML = "<i class=\"fa-solid fa-bars\"></i>";
      btn.addEventListener("click", () => OsisSidebar.toggle());
      header.prepend(btn);
    }
    // Judul halaman di top-nav (desktop): elemen disiapin di sini, isinya dari renderMenu.
    const brand = header && header.querySelector(".brand");
    if (header && brand && !header.querySelector(".osis-top-judul")) {
      const jdl = document.createElement("div");
      jdl.className = "osis-top-judul";
      jdl.innerHTML = "<i class=\"fa-solid fa-grip\"></i><span></span>";
      brand.insertAdjacentElement("afterend", jdl);
    }

    const bg = document.createElement("div");
    bg.className = "osis-sidebar-bg";
    bg.id = "osisSidebarBg";
    bg.addEventListener("click", () => OsisSidebar.close());
    const sb = document.createElement("aside");
    sb.className = "osis-sidebar";
    sb.id = "osisSidebar";
    sb.setAttribute("aria-label", "Menu OSIS");
    sb.innerHTML = `
            <div class="osis-sidebar-head">
                <div class="osis-side-head-logo"><img src="../assets/icons/icon-192.png" alt="Logo OSIS" /></div>
                <div class="t">
                    <h2>OSIS TARPAN ONE</h2>
                    <div class="osis-side-subrow">
                        <p>Panel Pengurus</p>
                        <span class="osis-side-ang" id="osisSideAng" style="display:none"></span>
                    </div>
                </div>
                <button class="icon-btn" id="osisSideClose" title="Tutup" style="width:34px; height:34px; flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="osis-side-stripes" aria-hidden="true"></div>
            <nav id="osisSideNav"></nav>
            <div class="osis-sidebar-foot">
                <a href="../index#/" class="osis-sidebar-link"><span class="sic"><i class="fa-solid fa-house"></i></span>Beranda Website</a>
                <div class="side-atur-baris">
                    <button class="osis-side-atur" id="osisSideAtur" type="button" style="display:none"><i class="fa-solid fa-gear"></i><span>Atur Menu</span></button>
                    <button class="osis-side-undo" id="osisSideUndo" type="button" title="Batalkan aksi terakhir" style="display:none"><i class="fa-solid fa-clock-rotate-left"></i></button>
                </div>
            </div>`;
    document.body.appendChild(bg);
    document.body.appendChild(sb);
    // Ingat posisi scroll sidebar (session) biar gak balik ke atas pas pindah halaman.
    const navEl = sb.querySelector("#osisSideNav");
    let tScroll = null;
    navEl.addEventListener("scroll", () => {
      clearTimeout(tScroll);
      tScroll = setTimeout(() => {
        try {
          sessionStorage.setItem(OsisSidebar.KUNCI_SCROLL, String(navEl.scrollTop));
        } catch (e) {}
      }, 120);
    });
    window.addEventListener("pagehide", () => {
      try {
        sessionStorage.setItem(OsisSidebar.KUNCI_SCROLL, String(navEl.scrollTop));
      } catch (e) {}
    });
    if (!OsisSidebar.serverMenu) {
      const awal = OsisSidebar.bacaCache();
      if (awal) OsisSidebar.serverMenu = awal;
    }
    OsisSidebar.perbaruiAngkatan();
    OsisSidebar.renderMenu();
    sb.querySelector("#osisSideClose").addEventListener("click", () =>
      OsisSidebar.close(),
    );
    sb.querySelector("#osisSideAtur").addEventListener("click", () =>
      OsisSidebar.toggleAtur(),
    );
    sb.querySelector("#osisSideUndo").addEventListener("click", () =>
      OsisSidebar.undo(),
    );
    // Long-press di HP jangan buka menu konteks pas mode atur.
    sb.addEventListener("contextmenu", (e) => {
      if (OsisSidebar.editMode) e.preventDefault();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.querySelector(".uni-overlay")) return; // biarin popup yang nutup
        if (OsisSidebar.editMode) OsisSidebar.toggleAtur(true);
        else OsisSidebar.close();
      }
    });
    if (typeof getSidebarMenu === "function") {
      OsisSidebar.sinkronAsync();
    }
    window.addEventListener("osis:angkatan-ready", () =>
      OsisSidebar.perbaruiAngkatan(),
    );
    // Animasi geser padding nyala abis frame pertama — biar pas load gak nge-slide.
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("osis-side-anim")));
    window.addEventListener("resize", () => OsisSidebar.terapkanMode());
  },

  sinkronAsync() {
    if (OsisSidebar._sudahSinkron) return;
    if (typeof getSidebarMenu !== "function") return;
    OsisSidebar._sudahSinkron = true;
    OsisSidebar.muat();
    if (typeof OsisAuth !== "undefined" && OsisAuth.refreshAkses) {
      const jmlSebelum = OsisSidebar.menuTampil().length;
      const aturSebelum = OsisSidebar.bisaAtur();
      OsisAuth.refreshAkses()
        .then(() => {
          OsisSidebar.perbaruiAngkatan();
          if (
            OsisSidebar.menuTampil().length !== jmlSebelum ||
            OsisSidebar.bisaAtur() !== aturSebelum
          ) {
            OsisSidebar.renderMenu();
          }
        })
        .catch(() => {});
    }
  },

  // Badge angkatan aktif di header sidebar (ambil dari OsisAuth atau cache lokal).
  perbaruiAngkatan() {
    const el = document.getElementById("osisSideAng");
    if (!el) return;
    let teks = "";
    try {
      let obj =
        typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanAktifObj
          ? OsisAuth.getAngkatanAktifObj()
          : null;
      if (!obj) {
        const u = OsisSidebar._userLokal();
        if (u && u.mode === "osis") {
          const a = OsisSidebar._aksesLokal();
          const list = JSON.parse(localStorage.getItem("osis_angkatan_list") || "[]");
          const jab = String(u.jabatan || "").trim().toUpperCase();
          const ang = String(u.angkatan || "").trim().toUpperCase();
          const lintas =
            a && typeof a.lintas_angkatan === "boolean"
              ? a.lintas_angkatan
              : !!(
                  (a && a.super) ||
                  (typeof u.lintas_angkatan === "boolean" ? u.lintas_angkatan : jab === "PEMBINA" || ang === "PEMBINA")
                );
          let id = !lintas ? (u.angkatan_id ? Number(u.angkatan_id) : 0) : Number(localStorage.getItem("osis_angkatan_aktif") || 0);
          if (lintas && !(id > 0 && (!Array.isArray(list) || !list.length || list.some((x) => Number(x.id) === id)))) {
            id = u.angkatan_id ? Number(u.angkatan_id) : 0;
            if (!id && Array.isArray(list) && list.length) {
              const yr = new Date().getFullYear();
              const pick = list.find((x) => x.aktif && Number(x.tahun) === yr) || list.find((x) => x.aktif) || list[0];
              if (pick && pick.id) id = Number(pick.id);
            }
          }
          const hit = id && Array.isArray(list) ? list.find((x) => Number(x.id) === id) : null;
          obj = hit || { id: id || null, nama: String(u.angkatan || "").trim(), kode: "" };
        }
      }
      teks = String((obj && (obj.nama || obj.kode)) || "").trim();
    } catch (e) {}
    const nextDisp = teks ? "" : "none";
    if (el.textContent !== teks) el.textContent = teks;
    if (el.style.display !== nextDisp) el.style.display = nextDisp;
  },

  // ---- mode atur (hanya pengelola Site / super_admin) ----
  // Masuk = mulai draf lokal. Tombol "Selesai" = simpan, Esc = batalin.
  toggleAtur(forceClose) {
    if (!forceClose && !OsisSidebar.bisaAtur()) {
      if (typeof showToast === "function")
        showToast("Hanya super_admin yang bisa mengatur sidebar.", "error");
      return;
    }
    const keluar = OsisSidebar.editMode;
    if (!keluar && forceClose) return; // Esc pas gak mode atur: gak ada yang ditutup
    const draft = Array.isArray(OsisSidebar.draft) ? OsisSidebar.draft : null;
    OsisSidebar.editMode = !keluar;
    OsisSidebar.editIndex = -1;
    OsisSidebar.draft = keluar ? null : OsisSidebar.menuTersimpan();
    OsisSidebar._undo = []; // riwayat undo cuma buat sesi atur ini
    const sb = document.getElementById("osisSidebar");
    if (sb) sb.classList.toggle("editing", OsisSidebar.editMode);
    document.body.classList.toggle("osis-side-edit-wide", OsisSidebar.editMode);
    const btn = document.getElementById("osisSideAtur");
    if (btn) {
      btn.classList.toggle("done", OsisSidebar.editMode);
      btn.innerHTML = OsisSidebar.editMode
        ? "<i class=\"fa-solid fa-check\"></i><span>Selesai</span>"
        : "<i class=\"fa-solid fa-gear\"></i><span>Atur Menu</span>";
    }
    if (keluar) {
      const berubah =
        draft && !OsisSidebar.menuSama(draft, OsisSidebar.menuTersimpan());
      if (berubah && !forceClose) {
        // Tombol "Selesai": semua perubahan draf dikirim (upload di belakang).
        OsisSidebar.simpanKeServer(draft, "Sidebar disimpan.");
        return; // simpanKeServer udah render + tandai tombol
      }
      if (berubah && typeof showToast === "function")
        showToast("Perubahan dibatalkan (belum disimpan).", "error");
    }
    OsisSidebar.renderMenu();
    OsisSidebar.tandaiKotor();
  },

  geser(i, dir) {
    const penuh = OsisSidebar.getMenu();
    const j = i + dir;
    if (i < 0 || j < 0 || j >= penuh.length) return;
    const tmp = penuh[i];
    penuh[i] = penuh[j];
    penuh[j] = tmp;
    OsisSidebar.terapkanDraft(penuh);
  },

  async hapus(i) {
    const penuh = OsisSidebar.getMenu();
    const target = penuh[i];
    if (!target) return;
    if (penuh.length <= 1) {
      if (typeof showToast === "function")
        showToast("Menu tidak boleh kosong semua.", "error");
      return;
    }
    let yakin = true;
    try {
      yakin = (typeof showPopup === "function")
        ? !!(await showPopup("Hapus menu \"" + target.label + "\" dari sidebar?", "confirm"))
        : true;
    } catch (e) { yakin = true; }
    if (!yakin) return;
    penuh.splice(i, 1);
    OsisSidebar.editIndex = -1;
    OsisSidebar.terapkanDraft(penuh);
  },

  // Form tambah/edit lewat showPopup (sama kayak ubah nama grup).
  async mulaiEdit(i) {
    if (Date.now() - (OsisSidebar._baruDrag || 0) < 350) return; // abis drag
    const items = OsisSidebar.getMenu();
    if (i >= 0 && !items[i]) return;
    if (typeof showPopup !== "function") return;
    const src = i >= 0 ? items[i] : null;
    let hasil = null;
    try {
      const janji = showPopup(
        src ? "Ubah \"" + src.label + "\"." : "Tambahkan menu baru ke sidebar.",
        "form",
        {
          title: src ? "Edit Menu" : "Tambah Menu",
          tall: true,
          icon: src
            ? "<i class=\"fa-solid fa-pen\"></i>"
            : "<i class=\"fa-solid fa-plus\"></i>",
          fields: [
            {
              name: "judul",
              label: "Nama menu",
              type: "text",
              placeholder: "cth: Notulensi",
              value: src ? src.label : "",
            },
            {
              name: "href",
              label: "Tujuan (nama file tanpa .html / link)",
              type: "text",
              placeholder: "cth: notulensi",
              value: src ? src.href : "",
            },
            {
              name: "grup",
              label: "Grup (judul pemisah, opsional)",
              type: "select",
              value: src ? String(src.grup || "") : "",
              options: OsisSidebar.opsiGrup(src ? String(src.grup || "") : ""),
            },
            {
              name: "ikon",
              label: "Ikon (class Font Awesome)",
              type: "text",
              placeholder: "cth: fa-solid fa-link",
              value: src ? src.icon : "fa-solid fa-link",
            },
            {
              name: "populer",
              label: "Menu Populer (grid 2 kolom atas)",
              type: "select",
              value: src && src.populer ? "1" : "0",
              options: [
                { value: "0", label: "Tidak (hanya tampil di grup)" },
                { value: "1", label: "Ya — sematkan ke Populer atas" },
              ],
            },
          ],
        },
      );
      // Preset ikon + dropdown grup, disuntik abis popup-nya kebentuk.
      OsisSidebar.pasangIkonPicker("uniInput_ikon");
      OsisSidebar.pasangGrupPicker();
      if (src) OsisSidebar.pasangHapusPopup(i); // tombol hapus di popup
      hasil = await janji;
    } catch (e) {
      hasil = null;
    }
    if (!hasil || typeof hasil !== "object") return; // batal
    const judul = String(hasil.judul || "").trim();
    let href = String(hasil.href || "").trim();
    const ikon = String(hasil.ikon || "").trim() || "fa-solid fa-link";
    const populer = String(hasil.populer || "") === "1";
    let grup = String(hasil.grup || "").trim();
    if (grup === "__baru__") {
      const inp = document.getElementById("uniInput_grupBaru");
      grup = inp ? String(inp.value || "").trim().slice(0, 40) : "";
      if (!grup) {
        if (typeof showToast === "function")
          showToast("Isi nama grup barunya dulu.", "error");
        return;
      }
      // Nama sama (beda kapital) = ikut grup yang sudah ada.
      const ada = OsisSidebar.getMenu().find(
        (m) =>
          String(m.grup || "").trim().toLowerCase() === grup.toLowerCase(),
      );
      if (ada) grup = String(ada.grup || "").trim();
    }
    // Khusus super admin otomatis dari grup "Super Admin".
    const superOnly = grup.toLowerCase() === "super admin";
    if (!judul) {
      if (typeof showToast === "function")
        showToast("Isi nama menu dulu.", "error");
      return;
    }
    if (!href) {
      if (typeof showToast === "function")
        showToast("Isi tujuan/link menu.", "error");
      return;
    }
    href = href.replace(/\.html?$/i, "").replace(/^\.\//, "");
    const penuh = OsisSidebar.getMenu();
    if (src) {
      const grupLama = String(src.grup || "").trim();
      penuh[i] = { href, label: judul, icon: ikon, super: superOnly, grup, populer };
      OsisSidebar.terapkanDraft(
        grup !== grupLama ? OsisSidebar.rapikanGrup(penuh, i) : penuh,
      );
    } else {
      const duplikat = penuh.some(
        (x) => String(x.href).toLowerCase() === href.toLowerCase(),
      );
      if (duplikat) {
        if (typeof showToast === "function")
          showToast("Link itu sudah ada di sidebar.", "error");
        return;
      }
      penuh.push({ href, label: judul, icon: ikon, super: superOnly, grup, populer });
      OsisSidebar.terapkanDraft(
        OsisSidebar.rapikanGrup(penuh, penuh.length - 1),
      );
    }
  },

  togglePopuler(i) {
    const penuh = OsisSidebar.getMenu();
    if (!penuh[i]) return;
    penuh[i].populer = !penuh[i].populer;
    OsisSidebar.terapkanDraft(penuh);
  },

  bukaTambah() {
    OsisSidebar.mulaiEdit(-1);
  },

  // Info cara pakai mode atur (dulu teks hint di atas list).
  infoAtur() {
    if (typeof showPopup !== "function") return;
    showPopup(
      "Mode atur — klik baris buat edit, klik bintang (★) buat sematkan ke Menu Populer di atas, tahan di kartunya buat geser urutan. Garis merah = posisi akhir item: taruh tepat di bawah kepala grup biar jadi item pertama grup itu, atau tepat di atas kepala grup biar jadi item terakhir grup sebelumnya. Perubahan disimpen pas pencet \"Selesai\".",
      "info",
    );
  },

  // Preset ikon + preview, disuntik ke grup field "Ikon" di popup form.
  // Preset-nya sengaja disembunyiin - muncul cuma kalau tombolnya diklik.
  pasangIkonPicker(idInput) {
    const inp = document.getElementById(idInput);
    if (!inp || !inp.parentNode) return;
    const wrap = document.createElement("div");
    wrap.className = "uni-ikon-wrap";
    wrap.innerHTML =
      "<div class=\"uni-ikon-baris\">" +
      "<span class=\"uni-ikon-prev\"><i class=\"fa-solid fa-link\"></i></span>" +
      "<button type=\"button\" class=\"uni-ikon-toggle\"><i class=\"fa-solid fa-grip\"></i> Pilih dari preset</button>" +
      "</div>" +
      "<div class=\"uni-ikon-grid\" hidden>" +
      OsisSidebar.ICONS.map(
        (c) =>
          "<button type=\"button\" class=\"uni-ikon-chip\" data-ikon=\"" +
          OsisSidebar.esc(c) +
          "\" title=\"" +
          OsisSidebar.esc(c) +
          "\"><i class=\"" +
          OsisSidebar.esc(c) +
          "\"></i></button>",
      ).join("") +
      "</div>";
    inp.parentNode.appendChild(wrap);
    const prev = wrap.querySelector(".uni-ikon-prev i");
    const grid = wrap.querySelector(".uni-ikon-grid");
    const perbarui = () => {
      const v = String(inp.value || "").trim() || "fa-solid fa-link";
      prev.className = v;
      grid.querySelectorAll(".uni-ikon-chip").forEach((b) =>
        b.classList.toggle("on", b.dataset.ikon === v),
      );
    };
    inp.addEventListener("input", perbarui);
    wrap
      .querySelector(".uni-ikon-toggle")
      .addEventListener("click", () => {
        grid.hidden = !grid.hidden;
      });
    grid.addEventListener("click", (e) => {
      const b =
        e.target && e.target.closest ? e.target.closest(".uni-ikon-chip") : null;
      if (!b) return;
      inp.value = b.dataset.ikon;
      perbarui();
    });
    perbarui();
  },

  // Tombol hapus di popup edit (dulu di baris; sekarang di dalem popup).
  // Klik = tutup popup, terus munculin konfirmasi hapus yang lama.
  pasangHapusPopup(i) {
    const box = document.querySelector(".uni-overlay .uni-form-container");
    if (!box) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "uni-hapus";
    btn.innerHTML =
      "<i class=\"fa-solid fa-trash\"></i> Hapus menu ini";
    btn.addEventListener("click", () => {
      if (typeof window.closePopup === "function") window.closePopup();
      OsisSidebar.hapus(i);
    });
    box.appendChild(btn);
  },

  // Opsi dropdown "Grup": tanpa grup + grup yang sudah ada (urutan draf)
  // + opsi "+ Tambah grup baru…".
  opsiGrup(nilaiSkrg) {
    const opsi = [{ value: "", label: "(Tanpa grup)" }];
    const ada = [];
    (OsisSidebar.getMenu() || []).forEach((m) => {
      const g = String((m && m.grup) || "").trim();
      if (g && ada.indexOf(g) < 0) ada.push(g);
    });
    ada.forEach((g) => opsi.push({ value: g, label: g }));
    const v = String(nilaiSkrg || "").trim();
    if (v && v !== "__baru__" && ada.indexOf(v) < 0)
      opsi.push({ value: v, label: v });
    opsi.push({ value: "__baru__", label: "+ Tambah grup baru…" });
    return opsi;
  },

  // Abis grup 1 item diubah: bikin dia nyatu sama blok grup barunya
  // (nempel di paling bawah grup itu). Grup baru/kosong = biarin di posisi.
  rapikanGrup(items, idx) {
    const it = items[idx];
    if (!it) return items;
    const g = String(it.grup || "").trim();
    if (!g) return items;
    let ada = false;
    const sisa = items.filter((m, k) => {
      if (k === idx) return false;
      if (String(m.grup || "").trim() === g) ada = true;
      return true;
    });
    if (!ada) return items;
    let pos = -1;
    sisa.forEach((m, k) => {
      if (String(m.grup || "").trim() === g) pos = k;
    });
    sisa.splice(pos + 1, 0, it);
    return sisa;
  },

  // Dropdown grup di popup form: pilih "+ Tambah grup baru…" -> muncul kolom
  // nama grup baru di bawahnya (disuntik, sama kayak preset ikon).
  pasangGrupPicker() {
    const sel = document.getElementById("uniInput_grup");
    if (!sel || !sel.closest) return;
    const wrap = sel.closest(".uni-form-group");
    if (!wrap) return;
    wrap.insertAdjacentHTML(
      "beforeend",
      "<div class=\"uni-hint\">Item di grup \"Super Admin\" cuma tampil buat super admin.</div>",
    );
    wrap.insertAdjacentHTML(
      "afterend",
      "<div class=\"uni-form-group\" id=\"uniGrupBaruWrap\" style=\"display:none\">" +
        "<label>Nama grup baru</label>" +
        "<input type=\"text\" id=\"uniInput_grupBaru\" class=\"uni-input\" placeholder=\"cth: Humas\" autocomplete=\"off\">" +
        "</div>",
    );
    const atur = () => {
      const el = document.getElementById("uniGrupBaruWrap");
      if (el) el.style.display = sel.value === "__baru__" ? "" : "none";
    };
    sel.addEventListener("change", atur);
    atur();
  },

  // Isi ulang daftar menu (tampil biasa / mode atur)
  renderMenu() {
    const nav = document.getElementById("osisSideNav");
    // Tombol Atur hanya untuk pengelola (super_admin selalu lolos).
    const atur = document.getElementById("osisSideAtur");
    if (atur && !OsisSidebar.editMode) {
      atur.style.display = OsisSidebar.bisaAtur() ? "" : "none";
    }
    OsisSidebar.tandaiKotor(); // titik kuning kalau draf belum disimpan
    OsisSidebar.perbaruiUndo(); // tombol undo di footer
    OsisSidebar.perbaruiJudul(); // judul halaman di top-nav (desktop)
    OsisSidebar.perbaruiAngkatan();
    if (!nav) return;
    if (OsisSidebar.editMode) {
      if (!OsisSidebar.bisaAtur()) {
        OsisSidebar.editMode = false;
        OsisSidebar.draft = null;
        OsisSidebar.renderMenu();
        return;
      }
      OsisSidebar.renderEditor(nav);
      return;
    }
    const cur = OsisSidebar.halamanAktif();
    const items = OsisSidebar.menuTampil();
    if (!items.length) {
      nav.innerHTML = "<div class=\"side-hint\">Menu kosong.</div>";
      return;
    }
    const isAktif = (m) => {
      const slug = OsisSidebar.slugHref(m.href);
      return !!(slug && slug === cur);
    };
    const dashHtml = (m) => {
      const aktif = isAktif(m) ? " active" : "";
      const slug = OsisSidebar.slugHref(m.href);
      const sub = slug === "index" ? "Ringkasan & pintasan" : "Menu utama";
      return (
        "<a href=\"" +
        OsisSidebar.esc(m.href) +
        "\" class=\"osis-side-dash" +
        aktif +
        "\"><span class=\"dic\"><i class=\"" +
        OsisSidebar.esc(m.icon) +
        "\"></i></span><span class=\"dt\"><b>" +
        OsisSidebar.esc(m.label) +
        "</b><small>" +
        OsisSidebar.esc(sub) +
        "</small></span><span class=\"darr\"><i class=\"fa-solid fa-arrow-right\"></i></span></a>"
      );
    };
    const popTileHtml = (m) => {
      const aktif = isAktif(m) ? " active" : "";
      return (
        "<a href=\"" +
        OsisSidebar.esc(m.href) +
        "\" class=\"osis-pop-tile" +
        aktif +
        "\"><span class=\"pic\"><i class=\"" +
        OsisSidebar.esc(m.icon) +
        "\"></i></span><span class=\"plbl\">" +
        OsisSidebar.esc(m.label) +
        "</span></a>"
      );
    };
    const linkHtml = (m) => {
      const aktif = isAktif(m) ? " active" : "";
      return (
        "<a href=\"" +
        OsisSidebar.esc(m.href) +
        "\" class=\"osis-sidebar-link" +
        aktif +
        "\"><span class=\"sic\"><i class=\"" +
        OsisSidebar.esc(m.icon) +
        "\"></i></span>" +
        OsisSidebar.esc(m.label) +
        "</a>"
      );
    };

    // 1. Bagian paling atas: Dashboard (atau item tanpa grup di posisi awal).
    const topItems = [];
    for (let i = 0; i < items.length; i++) {
      if (String(items[i].grup || "").trim()) break;
      topItems.push(items[i]);
    }
    if (!topItems.length) {
      const dash = items.find((m) => OsisSidebar.slugHref(m.href) === "index");
      if (dash) topItems.push(dash);
    }
    const topSet = new Set(topItems);

    // 2. Menu Populer (grid 2 kolom) — item tetap ada di grup aslinya di bawah.
    const popItems = items.filter((m) => m.populer && !topSet.has(m));
    const restItems = items.filter((m) => !topSet.has(m));

    const cntGrup = {};
    restItems.forEach((m) => {
      const g = String(m.grup || "").trim();
      cntGrup[g] = (cntGrup[g] || 0) + 1;
    });

    let html = topItems.map(dashHtml).join("");
    if (popItems.length) {
      html +=
        "<div class=\"osis-pop-box\">" +
        "<div class=\"osis-pop-head\">" +
        "<span class=\"osis-pop-title\"><i class=\"fa-solid fa-fire\"></i>Menu Populer</span>" +
        "<span class=\"osis-pop-tag\"><i class=\"fa-solid fa-bolt\"></i>Cepat</span>" +
        "</div>" +
        "<div class=\"osis-pop-grid\">" +
        popItems.map(popTileHtml).join("") +
        "</div></div>";
    }

    // 3. Menu Grup di bawah (selalu terbuka semua).
    let grupAkhir = null;
    let kepalaKe = 0;
    restItems.forEach((m) => {
      const grup = String(m.grup || "").trim();
      if (grup !== grupAkhir) {
        if (grup) {
          const meta = OsisSidebar.grupMeta(grup);
          const firstCls = kepalaKe === 0 ? " first" : "";
          html +=
            "<div class=\"osis-side-sec" +
            firstCls +
            "\" style=\"--sec-bg:" +
            meta.bg +
            ";--sec-fg:" +
            meta.fg +
            "\">" +
            "<span class=\"sec-ico\"><i class=\"" +
            meta.icon +
            "\"></i></span>" +
            "<span class=\"sec-lbl\">" +
            OsisSidebar.esc(grup) +
            "</span>" +
            "<span class=\"sec-cnt\">" +
            (cntGrup[grup] || 0) +
            "</span></div>";
          kepalaKe++;
        }
        grupAkhir = grup;
      }
      html += linkHtml(m);
    });
    // Pertahanin posisi scroll pas list digambar ulang (cache -> server).
    if (OsisSidebar._scrollAwal == null) {
      try {
        OsisSidebar._scrollAwal =
          parseInt(sessionStorage.getItem(OsisSidebar.KUNCI_SCROLL) || "0", 10) || 0;
      } catch (e) {
        OsisSidebar._scrollAwal = 0;
      }
    }
    const bekas = nav.scrollTop || OsisSidebar._scrollAwal || 0;
    OsisSidebar._scrollAwal = 0;
    nav.innerHTML = html;
    if (bekas > 0) nav.scrollTop = bekas;
  },

  renderEditor(nav) {
    // Editor selalu melihat daftar penuh (termasuk item khusus super).
    const items = OsisSidebar.getMenu();
    const hitungGrup = {};
    items.forEach((m) => {
      const g = String(m.grup || "").trim();
      hitungGrup[g] = (hitungGrup[g] || 0) + 1;
    });
    // Baris polos: ikon + judul + sub (grup . href) + bintang populer + pensil + grip kanan.
    // Klik baris/pensil = buka form edit (popup); geser urutan tahan di kartu.
    let grupAkhir = null;
    const rows = items
      .map((m, i) => {
        const grup = String(m.grup || "").trim();
        let kepala = "";
        if (grup !== grupAkhir) {
          kepala =
            "<div class=\"side-edit-sec\" data-grup=\"" +
            OsisSidebar.esc(grup) +
            "\" onpointerdown=\"OsisSidebar.dragGrupMulai(event, this)\"><span>" +
            OsisSidebar.esc(grup || "Tanpa grup") +
            "</span>" +
            (grup
              ? "<button type=\"button\" class=\"side-sec-pen\" title=\"Ubah nama grup\" data-grup=\"" +
                OsisSidebar.esc(grup) +
                "\" onclick=\"OsisSidebar.renameGrup(this.dataset.grup)\"><i class=\"fa-solid fa-pen\"></i></button>"
              : "") +
            "<span class=\"cnt\">" +
            (hitungGrup[grup] || 0) +
            "</span>" +
            "<span class=\"side-grup-grip\" title=\"Tahan lalu geser buat pindahin grup\" onclick=\"event.stopPropagation()\" onpointerdown=\"OsisSidebar.dragGrupMulai(event, this)\"><i class=\"fa-solid fa-grip-vertical\"></i></span>" +
            "</div>";
          grupAkhir = grup;
        }
        return (
          kepala +
          "<div class=\"side-edit-row\" data-i=\"" +
          i +
          "\" onclick=\"OsisSidebar.mulaiEdit(" +
          i +
          ")\" onpointerdown=\"OsisSidebar.dragMulai(event," +
          i +
          ")\">" +
          "<span class=\"sic\"><i class=\"" +
          OsisSidebar.esc(m.icon) +
          "\"></i></span>" +
          "<span class=\"side-edit-teks\"><b>" +
          OsisSidebar.esc(m.label) +
          (m.super
            ? "<span class=\"side-chip-super\" title=\"Khusus super admin\"><i class=\"fa-solid fa-crown\"></i></span>"
            : "") +
          "</b><small>" +
          (grup ? OsisSidebar.esc(grup) + " &bull; " : "") +
          OsisSidebar.esc(m.href) +
          "</small></span>" +
          "<button type=\"button\" class=\"side-star" +
          (m.populer ? " on" : "") +
          "\" title=\"" +
          (m.populer ? "Hapus dari Menu Populer" : "Sematkan ke Menu Populer") +
          "\" onclick=\"event.stopPropagation(); OsisSidebar.togglePopuler(" +
          i +
          ")\" onpointerdown=\"event.stopPropagation()\"><i class=\"fa-solid fa-star\"></i></button>" +
          "<span class=\"side-edit-pen\" title=\"Edit menu\"><i class=\"fa-solid fa-pen\"></i></span>" +
          "<span class=\"side-grip\" title=\"Tahan lalu geser buat atur urutan\" onclick=\"event.stopPropagation()\" onpointerdown=\"OsisSidebar.dragMulai(event," +
          i +
          ")\"><i class=\"fa-solid fa-grip-vertical\"></i></span>" +
          "</div>"
        );
      })
      .join("");
    nav.innerHTML =
      "<div class=\"side-tools\">" +
      "<button type=\"button\" class=\"side-add-big\" onclick=\"OsisSidebar.bukaTambah()\"><i class=\"fa-solid fa-plus\"></i> Tambah Menu</button>" +
      "<button type=\"button\" class=\"side-info\" title=\"Cara pakai mode atur\" aria-label=\"Cara pakai mode atur\" onclick=\"OsisSidebar.infoAtur()\"><i class=\"fa-solid fa-circle-info\"></i></button>" +
      "</div>" +
      (rows || "<div class=\"side-hint\">Belum ada menu.</div>") +
      "<button type=\"button\" class=\"side-reset\" onclick=\"OsisSidebar.resetMenu()\"><i class=\"fa-solid fa-rotate-left\"></i> Kembalikan ke bawaan</button>";
  },

  // Ganti nama 1 grup sekaligus (item segrup ikut semua). Kosong = hapus pemisah.
  async renameGrup(namaLama) {
    const lama = String(namaLama || "").trim();
    if (!lama) return;
    let baru = null;
    try {
      if (typeof showPopup === "function") {
        baru = await showPopup(
          "Ganti nama untuk semua menu di grup \"" + lama + "\". Kosongin buat hapus pemisah.",
          "form",
          {
            title: "Ubah Nama Grup",
            fields: [
              {
                name: "grup",
                label: "Nama grup",
                type: "text",
                placeholder: "cth: Sekretaris",
                value: lama,
              },
            ],
          },
        );
      }
    } catch (e) {
      baru = null;
    }
    if (baru == null) return;
    const v = String(baru).trim();
    if (v === lama) return;
    const penuh = OsisSidebar.getMenu();
    penuh.forEach((m) => {
      if (String(m.grup || "").trim() === lama) {
        m.grup = v;
        m.super = v.toLowerCase() === "super admin";
      }
    });
    OsisSidebar.terapkanDraft(penuh);
  },

  // ---- drag & drop urutan: baris item & blok grup (tahan di mana aja) ----
  // Baris item: mouse = langsung (ambang 6px), sentuh = tahan dulu.
  dragMulai(ev, i) {
    if (!OsisSidebar.editMode) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const t = ev.target;
    if (t && t.closest && t.closest(".side-star")) return;
    const dariGrip = !!(t && t.closest && t.closest(".side-grip"));
    const dasar = {
      tipe: "item",
      idx: i,
      x0: ev.clientX,
      y0: ev.clientY,
      y: ev.clientY,
      drop: null,
      aktif: false,
    };
    if (ev.pointerType !== "mouse" && !dariGrip) {
      // Layar sentuh: tahan ~380ms biar scroll list tetep jalan.
      OsisSidebar.mulaiPointer(ev, ev.currentTarget, { ...dasar, tahan: true });
      return;
    }
    OsisSidebar.mulaiPointer(ev, ev.currentTarget, dasar);
  },

  // Kepala grup: tahan di mana aja (mouse = langsung, sentuh = tahan dulu).
  dragGrupMulai(ev, el) {
    if (!OsisSidebar.editMode) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const kepala = el && el.closest ? el.closest(".side-edit-sec") : null;
    if (!kepala) return;
    const t = ev.target;
    if (t && t.closest && t.closest(".side-sec-pen")) return; // pensil ubah nama
    const nav = document.getElementById("osisSideNav");
    const headers = nav ? [...nav.querySelectorAll(".side-edit-sec")] : [];
    const hdr = headers.indexOf(kepala);
    if (hdr < 0) return;
    const dariGrip = !!(t && t.closest && t.closest(".side-grup-grip"));
    const dasar = {
      tipe: "grup",
      grup: String(kepala.dataset.grup || "").trim(),
      hdr,
      el: kepala,
      x0: ev.clientX,
      y0: ev.clientY,
      y: ev.clientY,
      drop: hdr,
      aktif: false,
    };
    if (ev.pointerType !== "mouse" && !dariGrip) {
      OsisSidebar.mulaiPointer(ev, kepala, { ...dasar, tahan: true });
      return;
    }
    OsisSidebar.mulaiPointer(ev, el, dasar);
  },

  // Catatan pointer bareng buat dua mode (item & grup).
  // Sengaja TANPA preventDefault: sentuh di kartu harus bisa jadi scroll,
  // dan klik baris (buat buka popup) tetep jalan. Anti-seleksi lewat CSS.
  mulaiPointer(ev, el, state) {
    ev.stopPropagation();
    try {
      el.setPointerCapture(ev.pointerId);
    } catch (e) {}
    OsisSidebar._dragToken++;
    state.token = OsisSidebar._dragToken;
    OsisSidebar.drag = state;
    // Sentuh di badan kartu: tunggu tahan ~380ms (gerakan = scroll, batal).
    if (state.tahan) {
      clearTimeout(OsisSidebar._timerTahan);
      OsisSidebar._timerTahan = setTimeout(() => {
        OsisSidebar._timerTahan = null;
        const d = OsisSidebar.drag;
        if (!d || d.token !== state.token || d.aktif) return;
        OsisSidebar.aktifkanDrag();
      }, 380);
    }
    const gerak = (e) => OsisSidebar.dragGerak(e);
    const lepas = () => {
      document.removeEventListener("pointermove", gerak);
      document.removeEventListener("pointerup", lepas);
      document.removeEventListener("pointercancel", lepas);
      OsisSidebar.dragLepas();
    };
    document.addEventListener("pointermove", gerak);
    document.addEventListener("pointerup", lepas);
    document.addEventListener("pointercancel", lepas);
  },

  dragGerak(e) {
    const d = OsisSidebar.drag;
    if (!d) return;
    d.y = e.clientY;
    if (d.aktif) {
      // Bayangan ikut jari/kursor (pola sama kayak wawancara).
      if (d.hantu) d.hantu.style.top = e.clientY - 24 + "px";
      return;
    }
    if (d.tahan) {
      // Tahan-di-kartu: gerakan > 10px = niat scroll, bukan drag → batalin.
      const jauh = Math.max(
        Math.abs(e.clientX - (d.x0 == null ? e.clientX : d.x0)),
        Math.abs(e.clientY - d.y0),
      );
      if (jauh > 10) OsisSidebar.batalTahan();
      return;
    }
    if (Math.abs(e.clientY - d.y0) < 6) return; // baru nempel, belum geser
    OsisSidebar.aktifkanDrag();
  },

  // Batalin calon drag (ternyata cuma scroll / bukan drag).
  batalTahan() {
    clearTimeout(OsisSidebar._timerTahan);
    OsisSidebar._timerTahan = null;
    OsisSidebar.drag = null;
  },

  // Drag beneran mulai: bikin hantu + pudarin sumbernya.
  aktifkanDrag() {
    const d = OsisSidebar.drag;
    if (!d || d.aktif) return;
    d.aktif = true;
    document.body.style.userSelect = "none";
    OsisSidebar.blokirGulir(true); // jangan biarin layar ikut scroll
    const nav = document.getElementById("osisSideNav");
    // Yang diangkat: baris (item) atau kepala grup (grup).
    const sumbu =
      d.tipe === "grup"
        ? d.el || null
        : nav
          ? nav.querySelectorAll(".side-edit-row")[d.idx] || null
          : null;
    if (sumbu) {
      // Klon elemen buat hantu (fix di viewport, ikut naik-turun).
      try {
        const r = sumbu.getBoundingClientRect();
        const h = sumbu.cloneNode(true);
        h.classList.add("side-hantu");
        h.style.cssText =
          "position:fixed;z-index:999;pointer-events:none;opacity:.92;margin:0;" +
          "left:" + r.left + "px;width:" + r.width + "px;" +
          "top:" + (d.y - 24) + "px;";
        document.body.appendChild(h);
        d.hantu = h;
      } catch (err) {}
      sumbu.classList.add("side-drag");
      // Grup: baris-baris segrup ikut dipudarin.
      if (d.tipe === "grup") {
        let x = sumbu.nextElementSibling;
        while (x && !x.classList.contains("side-edit-sec")) {
          if (x.classList.contains("side-edit-row")) x.classList.add("side-drag");
          x = x.nextElementSibling;
        }
      }
    }
    OsisSidebar.dragLoop(d.token);
  },

  // Selama drag sentuh jalan, tahan scroll layar (touchmove non-passive).
  blokirGulir(aktif) {
    if (aktif) {
      if (!OsisSidebar._blokGulir) {
        OsisSidebar._blokGulir = (e) => {
          if (OsisSidebar.drag && OsisSidebar.drag.aktif) e.preventDefault();
        };
        document.addEventListener("touchmove", OsisSidebar._blokGulir, {
          passive: false,
        });
      }
    } else if (OsisSidebar._blokGulir) {
      document.removeEventListener("touchmove", OsisSidebar._blokGulir);
      OsisSidebar._blokGulir = null;
    }
  },

  dragLoop(token) {
    const d = OsisSidebar.drag;
    if (!d || !d.aktif || d.token !== token) return;
    const nav = document.getElementById("osisSideNav");
    if (nav) {
      // Auto-scroll saat jari/kursor nyentuh tepi list.
      const r = nav.getBoundingClientRect();
      const zona = 56;
      if (d.y < r.top + zona)
        nav.scrollTop -= Math.max(5, (r.top + zona - d.y) / 3);
      else if (d.y > r.bottom - zona)
        nav.scrollTop += Math.max(5, (d.y - (r.bottom - zona)) / 3);
      OsisSidebar.dragTandai(nav);
    }
    requestAnimationFrame(() => OsisSidebar.dragLoop(token));
  },

  dragTandai(nav) {
    const d = OsisSidebar.drag;
    if (!d) return;
    nav
      .querySelectorAll(".side-edit-sec, .side-edit-row")
      .forEach((el) =>
        el.classList.remove("side-drop-atas", "side-drop-bawah"),
      );
    if (d.tipe === "grup") {
      // Grup: garis di atas kepala grup tujuan (paling bawah = bawah list).
      const headers = [...nav.querySelectorAll(".side-edit-sec")];
      if (!headers.length) return;
      let j = headers.length;
      for (let k = 0; k < headers.length; k++) {
        const r = headers[k].getBoundingClientRect();
        if (d.y < r.top + r.height / 2) {
          j = k;
          break;
        }
      }
      d.drop = j;
      if (j < headers.length) headers[j].classList.add("side-drop-atas");
      else {
        const rows = [...nav.querySelectorAll(".side-edit-row")];
        if (rows.length) rows[rows.length - 1].classList.add("side-drop-bawah");
      }
      return;
    }
    // Item: titik drop = antar elemen visual (kepala grup + baris). Baris yang
    // lagi diangkat di-skip, jadi garisnya persis di posisi akhirnya nanti.
    const rows = [...nav.querySelectorAll(".side-edit-row")];
    const srow = rows[d.idx] || null;
    const els = [
      ...nav.querySelectorAll(".side-edit-sec, .side-edit-row"),
    ].filter((el) => el !== srow);
    if (!els.length) return;
    let k = els.length;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (d.y < r.top + r.height / 2) {
        k = i;
        break;
      }
    }
    d.drop = k;
    if (k < els.length) els[k].classList.add("side-drop-atas");
    else els[els.length - 1].classList.add("side-drop-bawah");
  },

  dragLepas() {
    const d = OsisSidebar.drag;
    OsisSidebar.drag = null;
    clearTimeout(OsisSidebar._timerTahan);
    OsisSidebar._timerTahan = null;
    OsisSidebar.blokirGulir(false);
    document.body.style.userSelect = "";
    if (d && d.hantu && d.hantu.parentNode) d.hantu.parentNode.removeChild(d.hantu);
    const nav = document.getElementById("osisSideNav");
    if (nav)
      nav
        .querySelectorAll(".side-edit-sec, .side-edit-row")
        .forEach((el) =>
          el.classList.remove("side-drag", "side-drop-atas", "side-drop-bawah"),
        );
    if (!d || !d.aktif) return; // cuma nyentuh grip, bukan geser
    OsisSidebar._baruDrag = Date.now(); // klik sisa drag jangan buka popup
    if (d.tipe === "grup") return OsisSidebar.dragLepasGrup(d);
    if (!nav || d.drop == null) return;
    const items = OsisSidebar.getMenu();
    if (!items[d.idx]) return;
    // Titik drop ala visual: d.drop = slot antar elemen (baris sumber di-skip).
    // Posisi + grup item = persis kayak posisi garis penanda di dragTandai.
    const rows = [...nav.querySelectorAll(".side-edit-row")];
    const srow = rows[d.idx] || null;
    const els = [
      ...nav.querySelectorAll(".side-edit-sec, .side-edit-row"),
    ].filter((el) => el !== srow);
    const k = Math.max(0, Math.min(d.drop, els.length));
    const grp = (x) => String((x && x.grup) || "").trim();
    const grupEl = (el) => {
      if (!el) return null;
      if (el.classList.contains("side-edit-sec"))
        return String(el.dataset.grup || "").trim();
      const r = Number(el.dataset.i);
      return Number.isInteger(r) && items[r] ? grp(items[r]) : null;
    };
    const item = items[d.idx];
    // Grup ngikut elemen persis di atas garis (kepala grup / baris); kalau
    // garis di paling atas, ikut elemen bawahnya.
    const gBaru =
      grupEl(k > 0 ? els[k - 1] : null) ??
      grupEl(els[k] || els[0]) ??
      grp(item);
    let p = 0;
    for (let i = 0; i < k; i++)
      if (els[i].classList.contains("side-edit-row")) p++;
    if (p === d.idx) return; // posisi gak berubah
    items.splice(d.idx, 1);
    items.splice(p, 0, item);
    item.grup = gBaru;
    // Status super otomatis dari grup (sumber tunggal = nama grup).
    item.super = gBaru.toLowerCase() === "super admin";
    OsisSidebar.terapkanDraft(items);
  },

  // Lepas drag grup: blok grup dipindah sebelum grup di index drop.
  dragLepasGrup(d) {
    const penuh = OsisSidebar.getMenu();
    // Daftar grup sesuai urutan sekarang.
    const nama = [];
    penuh.forEach((m) => {
      const g = String(m.grup || "").trim();
      if (!nama.includes(g)) nama.push(g);
    });
    const posAsal = nama.indexOf(d.grup);
    if (posAsal < 0) return;
    const j = d.drop == null ? posAsal : d.drop;
    const p = j > posAsal ? j - 1 : j;
    if (p === posAsal) return; // posisi grup gak berubah
    const urutan = nama.slice();
    urutan.splice(posAsal, 1);
    urutan.splice(p, 0, d.grup);
    // Susun ulang item: ikut urutan grup baru, item tiap grup tetap urut.
    const hasil = [];
    urutan.forEach((g) => {
      penuh.forEach((m) => {
        if (String(m.grup || "").trim() === g) hasil.push(m);
      });
    });
    OsisSidebar.terapkanDraft(hasil);
  },

  terapkanMode() {
    const desktop = window.innerWidth >= 900;
    document.body.classList.toggle("osis-side-static", desktop);
    if (desktop) {
      document.getElementById("osisSidebar")?.classList.remove("open");
      document.getElementById("osisSidebarBg")?.classList.remove("open");
      if (
        !document.querySelector(
          ".agenda-form.open, .notulensi-form.open, .proker-form.open, .dokumen-form.open, .task-form.open, .kas-form.open, .evaluasi-form.open, .angg-popup.open",
        )
      ) {
        document.body.style.overflow = "";
      }
    }
  },
};

window.OsisSidebar = OsisSidebar;

document.addEventListener("DOMContentLoaded", () => {
  OsisSidebar.pasang();
  OsisSidebar.sinkronAsync();
});
if (document.readyState !== "loading") {
  OsisSidebar.pasang();
  OsisSidebar.sinkronAsync();
}