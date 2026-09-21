// =========================================================================
// OSIS SIDEBAR - drawer kiri (folder /osisbin/*). Disuntik otomatis.
// CONFIG PUSAT: susunan menu disimpan di server (tabel site_content) dan
// berlaku untuk SEMUA user. Yang bisa mengatur (tombol "Atur Menu") hanya
// super_admin + pemegang hak kelola "Site". User biasa hanya melihat.
// Tambah/hapus/edit/geser urutan lewat mode Atur, tersimpan ke server.
// Offline: tampil cache terakhir / menu bawaan.
// Dev: ubah DEFAULT_MENU kalau halaman baru dibikin permanen.
// =========================================================================

const OsisSidebar = {
  // Kunci config di site_content untuk area ini ("sidebar_menu_bin" untuk /osisbin).
  KUNCI: "sidebar_menu_bin",

  DEFAULT_MENU: [
    { href: "index", label: "Dashboard", icon: "fa-solid fa-grip" },
    { href: "agenda", label: "Agenda", icon: "fa-solid fa-calendar-days" },
    { href: "profil", label: "Profil", icon: "fa-solid fa-user" },
    { href: "anggota", label: "Anggota", icon: "fa-solid fa-users" },
    { href: "notulensi", label: "Notulensi", icon: "fa-solid fa-clipboard-list" },
    { href: "proker", label: "Proker", icon: "fa-solid fa-list-check" },
    { href: "dokumen", label: "Dokumen", icon: "fa-solid fa-folder-open" },
    { href: "task", label: "Task", icon: "fa-solid fa-clipboard-check" },
    { href: "keuangan", label: "Keuangan", icon: "fa-solid fa-wallet" },
    { href: "evaluasi", label: "Evaluasi", icon: "fa-solid fa-star-half-stroke" },
    { href: "formulir", label: "Formulir", icon: "fa-solid fa-clipboard-question" },
  ],

  // Kompatibel ke belakang: kode lama baca OsisSidebar.MENU (array).
  MENU: [
    ["index", "Dashboard", "fa-solid fa-grip"],
    ["agenda", "Agenda", "fa-solid fa-calendar-days"],
    ["profil", "Profil", "fa-solid fa-user"],
    ["anggota", "Anggota", "fa-solid fa-users"],
    ["notulensi", "Notulensi", "fa-solid fa-clipboard-list"],
    ["proker", "Proker", "fa-solid fa-list-check"],
    ["dokumen", "Dokumen", "fa-solid fa-folder-open"],
    ["task", "Task", "fa-solid fa-clipboard-check"],
    ["keuangan", "Keuangan", "fa-solid fa-wallet"],
    ["evaluasi", "Evaluasi", "fa-solid fa-star-half-stroke"],
    ["formulir", "Formulir", "fa-solid fa-clipboard-question"]
  ],

  // Pilihan ikon siap pakai di form tambah/edit.
  ICONS: [
    "fa-solid fa-grip",
    "fa-solid fa-house",
    "fa-solid fa-users",
    "fa-solid fa-user",
    "fa-solid fa-clipboard-user",
    "fa-solid fa-clipboard-list",
    "fa-solid fa-clipboard-check",
    "fa-solid fa-piggy-bank",
    "fa-solid fa-wallet",
    "fa-solid fa-calendar-days",
    "fa-solid fa-calendar",
    "fa-solid fa-folder-open",
    "fa-solid fa-file-lines",
    "fa-solid fa-list-check",
    "fa-solid fa-star-half-stroke",
    "fa-solid fa-key",
    "fa-solid fa-gear",
    "fa-solid fa-link",
  ],

  // Config dari server (null = belum dimuat / tidak ada -> pakai bawaan).
  serverMenu: null,
  editMode: false,
  editIndex: -1, // -1 = tambah baru, >=0 = lagi edit item ke-N

  cacheKey() {
    return "sidebar_" + OsisSidebar.KUNCI;
  },

  uid() {
    try {
      const u =
        typeof OsisAuth !== "undefined" && OsisAuth.getUser
          ? OsisAuth.getUser()
          : null;
      if (u && u.mode === "osis" && u.id) return u.id;
    } catch (e) {}
    return null;
  },

  // Boleh mengatur sidebar? super_admin selalu lolos (punya semua hak).
  bisaAtur() {
    try {
      return (
        typeof OsisAuth !== "undefined" &&
        OsisAuth.bisa &&
        OsisAuth.bisa("site")
      );
    } catch (e) {
      return false;
    }
  },

  // Normalisasi 1 entri: dukung format lama [href,label,icon,flag]
  // maupun format baru {href,label,icon,super}.
  normalizeItem(raw) {
    if (Array.isArray(raw)) {
      return {
        href: String(raw[0] || "").trim(),
        label: String(raw[1] || "").trim(),
        icon: String(raw[2] || "fa-solid fa-link").trim() || "fa-solid fa-link",
        super: raw[3] === "super" || raw[3] === true,
      };
    }
    const o = raw && typeof raw === "object" ? raw : {};
    return {
      href: String(o.href || "").trim(),
      label: String(o.label || "").trim(),
      icon: String(o.icon || "fa-solid fa-link").trim() || "fa-solid fa-link",
      super: o.super === true || o.super === "super",
    };
  },

  // Menu efektif: config server kalau ada, kalau tidak = bawaan.
  getMenu() {
    if (Array.isArray(OsisSidebar.serverMenu) && OsisSidebar.serverMenu.length) {
      return OsisSidebar.serverMenu.map((x) => ({ ...x }));
    }
    return OsisSidebar.DEFAULT_MENU.map((x) => ({ ...x }));
  },

  bacaCache() {
    // Cache lokal biar sidebar langsung tampil + tetap ada saat offline.
    try {
      let arr = null;
      if (typeof Cache !== "undefined" && Cache.get) {
        arr = Cache.get(OsisSidebar.cacheKey());
      } else {
        const raw = localStorage.getItem("osis_cache_" + OsisSidebar.cacheKey());
        arr = raw ? JSON.parse(raw) : null;
      }
      if (Array.isArray(arr) && arr.length) {
        const items = arr
          .map((x) => OsisSidebar.normalizeItem(x))
          .filter((x) => x.href && x.label);
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

  // Muat config pusat: cache dulu (instan), lalu server (segarkan).
  async muat() {
    const cache = OsisSidebar.bacaCache();
    if (cache) {
      OsisSidebar.serverMenu = cache;
      OsisSidebar.renderMenu();
    }
    if (typeof getSidebarMenu !== "function") return;
    try {
      const arr = await getSidebarMenu(OsisSidebar.KUNCI);
      if (Array.isArray(arr) && arr.length) {
        const items = arr
          .map((x) => OsisSidebar.normalizeItem(x))
          .filter((x) => x.href && x.label);
        if (items.length) {
          OsisSidebar.serverMenu = items;
          OsisSidebar.tulisCache(items);
        }
      }
    } catch (e) {
      // offline / gagal: tetap pakai cache atau bawaan
    }
    OsisSidebar.renderMenu();
  },

  // Simpan susunan ke server (berlaku untuk semua user).
  async simpanKeServer(items, pesanOk) {
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
      }));
    if (!bersih.length) {
      if (typeof showToast === "function")
        showToast("Menu tidak boleh kosong semua.", "error");
      return false;
    }
    try {
      if (typeof simpanSidebarMenu !== "function")
        throw new Error("db.js belum dimuat.");
      await simpanSidebarMenu(uid, OsisSidebar.KUNCI, bersih);
      OsisSidebar.serverMenu = bersih;
      OsisSidebar.tulisCache(bersih);
      if (typeof showToast === "function")
        showToast(pesanOk || "Sidebar diperbarui untuk semua user.", "success");
      return true;
    } catch (err) {
      if (typeof showToast === "function")
        showToast("Gagal simpan: " + (err && err.message ? err.message : err), "error");
      else alert("Gagal simpan: " + (err && err.message ? err.message : err));
      return false;
    }
  },

  async resetMenu() {
    if (!confirm("Kembalikan sidebar ke bawaan untuk SEMUA user?")) return;
    OsisSidebar.editIndex = -1;
    await OsisSidebar.simpanKeServer(
      OsisSidebar.DEFAULT_MENU.map((x) => ({ ...x })),
      "Sidebar dikembalikan ke bawaan.",
    );
    OsisSidebar.renderMenu();
  },

  // Entri super (mis. Akses) cuma tampil untuk super_admin.
  menuTampil() {
    let superUser = false;
    try {
      superUser =
        typeof OsisAuth !== "undefined" &&
        OsisAuth.isSuper &&
        OsisAuth.isSuper();
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

  pasang() {
    if (document.getElementById("osisSidebar")) return;

    document.getElementById("osisNav")?.remove();
    document.getElementById("osisMoreWrap")?.remove();

    if (!document.getElementById("osisSidebarStyle")) {
      const st = document.createElement("style");
      st.id = "osisSidebarStyle";
      st.textContent = `
                #osisSideBtn { flex-shrink: 0; }
                .osis-sidebar-bg { position: fixed; inset: 0; background: rgba(15,10,11,.55); z-index: 290; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .2s ease, visibility .2s ease; }
                .osis-sidebar-bg.open { opacity: 1; visibility: visible; pointer-events: auto; }
                .osis-sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: min(300px, 86vw); background: var(--white); border-right: 3px solid var(--ink); z-index: 295; transform: translateX(-105%); transition: transform .25s cubic-bezier(.34,1.2,.64,1); display: flex; flex-direction: column; }
                .osis-sidebar.open { transform: none; }
                .osis-sidebar-head { display: flex; align-items: center; gap: 10px; padding: 16px; border-bottom: 3px solid var(--ink); background: var(--yellow); }
                .osis-sidebar-head .t { flex: 1; min-width: 0; }
                .osis-sidebar-head h2 { font-size: 1rem; font-weight: 900; line-height: 1.1; }
                .osis-sidebar-head p { font-size: .62rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--red-dark); }
                .osis-sidebar nav { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 7px; }
                .osis-sidebar-link { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 2.5px solid var(--ink); border-radius: 12px; background: var(--white); font-size: .82rem; font-weight: 800; text-decoration: none; color: var(--ink); box-shadow: 2px 2px 0 var(--ink); }
                .osis-sidebar-link:active { transform: translate(1px,1px); box-shadow: none; }
                .osis-sidebar-link.active { background: var(--red); color: #fff; }
                .osis-sidebar-link .sic { width: 28px; text-align: center; flex-shrink: 0; }
                .osis-sidebar-link.active .sic { color: #fff; }
                .osis-sidebar-link .sic { color: var(--red); }
                .osis-sidebar-foot { padding: 12px; border-top: 3px solid var(--ink); display: flex; flex-direction: column; gap: 8px; }
                .osis-side-atur { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 9px 12px; border: 2.5px solid var(--ink); border-radius: 12px; background: var(--paper-2); font-size: .78rem; font-weight: 900; color: var(--ink); cursor: pointer; box-shadow: 2px 2px 0 var(--ink); font-family: inherit; }
                .osis-side-atur:active { transform: translate(1px,1px); box-shadow: none; }
                .osis-side-atur.done { background: var(--red); color: #fff; }
                .side-edit-row { border: 2.5px solid var(--ink); border-radius: 12px; background: var(--white); box-shadow: 2px 2px 0 var(--ink); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
                .side-edit-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
                .side-edit-top .sic { width: 26px; text-align: center; color: var(--red); flex-shrink: 0; }
                .side-edit-top b { flex: 1; min-width: 0; font-size: .8rem; font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .side-edit-top small { display: block; font-size: .64rem; font-weight: 700; color: var(--gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .side-edit-ctrl { display: flex; gap: 5px; }
                .side-btn { width: 30px; height: 30px; border: 2px solid var(--ink); border-radius: 9px; background: var(--white); cursor: pointer; display: grid; place-items: center; font-size: .72rem; color: var(--ink); flex-shrink: 0; }
                .side-btn:active { transform: translate(1px,1px); }
                .side-btn:disabled { opacity: .35; cursor: default; }
                .side-btn.del { background: #ffe9e9; color: var(--red-dark); }
                .side-btn.edt { background: var(--yellow); }
                .side-form { border: 2.5px dashed var(--ink); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--paper-2); }
                .side-form h4 { font-size: .74rem; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; }
                .side-form label { font-size: .68rem; font-weight: 800; display: flex; flex-direction: column; gap: 4px; }
                .side-form input[type="text"] { border: 2px solid var(--ink); border-radius: 9px; padding: 7px 9px; font-size: .78rem; font-weight: 700; font-family: inherit; width: 100%; box-sizing: border-box; }
                .side-icons { display: flex; gap: 5px; flex-wrap: wrap; }
                .side-icons button { width: 32px; height: 32px; border: 2px solid var(--ink); border-radius: 9px; background: #fff; cursor: pointer; display: grid; place-items: center; font-size: .78rem; color: var(--red); }
                .side-icons button.on { background: var(--ink); color: #fff; }
                .side-check { flex-direction: row !important; align-items: center; gap: 6px !important; }
                .side-check input { width: 16px; height: 16px; accent-color: var(--red); }
                .side-form-act { display: flex; gap: 6px; }
                .side-add { flex: 1; border: 2.5px solid var(--ink); border-radius: 10px; background: var(--red); color: #fff; font-weight: 900; font-size: .76rem; padding: 8px; cursor: pointer; box-shadow: 2px 2px 0 var(--ink); font-family: inherit; }
                .side-add:active { transform: translate(1px,1px); box-shadow: none; }
                .side-cancel { border: 2.5px solid var(--ink); border-radius: 10px; background: #fff; font-weight: 900; font-size: .76rem; padding: 8px 10px; cursor: pointer; font-family: inherit; }
                .side-reset { border: none; background: none; color: var(--gray); font-size: .7rem; font-weight: 800; cursor: pointer; text-decoration: underline; font-family: inherit; }
                .side-hint { font-size: .68rem; font-weight: 600; color: var(--gray); line-height: 1.4; }
                @media (min-width: 900px) {
                    body.osis-side-static { padding-left: 303px; }
                    body.osis-side-static .osis-sidebar { transform: none; }
                    body.osis-side-static #osisSideBtn { display: none; }
                    body.osis-side-static .osis-sidebar-bg { display: none !important; }
                    body.osis-side-static #osisSideClose { display: none; }
                }
            `;
      document.head.appendChild(st);
    }

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
                <div class="t"><h2>MENU OSIS</h2><p>Halaman Khusus</p></div>
                <button class="icon-btn" id="osisSideClose" title="Tutup" style="width:34px; height:34px; flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <nav id="osisSideNav"></nav>
            <div class="osis-sidebar-foot">
                <a href="../index#/" class="osis-sidebar-link"><span class="sic"><i class="fa-solid fa-house"></i></span>Beranda Website</a>
                <button class="osis-side-atur" id="osisSideAtur" type="button" style="display:none"><i class="fa-solid fa-gear"></i><span>Atur Menu</span></button>
            </div>`;
    document.body.appendChild(bg);
    document.body.appendChild(sb);
    OsisSidebar.renderMenu();
    sb.querySelector("#osisSideClose").addEventListener("click", () =>
      OsisSidebar.close(),
    );
    sb.querySelector("#osisSideAtur").addEventListener("click", () =>
      OsisSidebar.toggleAtur(),
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (OsisSidebar.editMode) OsisSidebar.toggleAtur(true);
        else OsisSidebar.close();
      }
    });
    // Config pusat + hak akses dimuat async - gambar ulang kalau sudah datang.
    OsisSidebar.muat();
    if (typeof OsisAuth !== "undefined" && OsisAuth.refreshAkses) {
      OsisAuth.refreshAkses()
        .then(() => OsisSidebar.renderMenu())
        .catch(() => {});
    }
    OsisSidebar.terapkanMode();
    window.addEventListener("resize", () => OsisSidebar.terapkanMode());
  },

  // ---- mode atur (hanya pengelola Site / super_admin) ----
  toggleAtur(forceClose) {
    if (!forceClose && !OsisSidebar.bisaAtur()) {
      if (typeof showToast === "function")
        showToast("Hanya super_admin yang bisa mengatur sidebar.", "error");
      return;
    }
    OsisSidebar.editMode = forceClose ? false : !OsisSidebar.editMode;
    OsisSidebar.editIndex = -1;
    const btn = document.getElementById("osisSideAtur");
    if (btn) {
      btn.classList.toggle("done", OsisSidebar.editMode);
      btn.innerHTML = OsisSidebar.editMode
        ? "<i class=\"fa-solid fa-check\"></i><span>Selesai</span>"
        : "<i class=\"fa-solid fa-gear\"></i><span>Atur Menu</span>";
    }
    OsisSidebar.renderMenu();
  },

  async geser(i, dir) {
    const penuh = OsisSidebar.getMenu();
    const j = i + dir;
    if (i < 0 || j < 0 || j >= penuh.length) return;
    const tmp = penuh[i];
    penuh[i] = penuh[j];
    penuh[j] = tmp;
    if (await OsisSidebar.simpanKeServer(penuh)) OsisSidebar.renderMenu();
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
    if (!confirm("Hapus menu \"" + target.label + "\" untuk SEMUA user?")) return;
    penuh.splice(i, 1);
    if (await OsisSidebar.simpanKeServer(penuh, "Menu dihapus.")) {
      OsisSidebar.editIndex = -1;
      OsisSidebar.renderMenu();
    }
  },

  mulaiEdit(i) {
    OsisSidebar.editIndex = i;
    OsisSidebar.renderMenu();
    setTimeout(() => {
      document.getElementById("sideJudul")?.focus();
    }, 50);
  },

  batalEdit() {
    OsisSidebar.editIndex = -1;
    OsisSidebar.renderMenu();
  },

  pilihIkon(cls, ev) {
    if (ev) ev.preventDefault();
    const inp = document.getElementById("sideIkon");
    if (inp) inp.value = cls;
    document.querySelectorAll(".side-icons button").forEach((b) => {
      b.classList.toggle("on", b.dataset.ikon === cls);
    });
  },

  async simpanDariForm(ev) {
    if (ev) ev.preventDefault();
    const judul = document.getElementById("sideJudul")?.value.trim() || "";
    let href = document.getElementById("sideHref")?.value.trim() || "";
    const ikon =
      document.getElementById("sideIkon")?.value.trim() ||
      "fa-solid fa-link";
    const superOnly = document.getElementById("sideSuper")?.checked || false;
    if (!judul) {
      if (typeof showToast === "function") showToast("Isi nama menu dulu.", "error");
      else alert("Isi nama menu dulu.");
      return;
    }
    if (!href) {
      if (typeof showToast === "function") showToast("Isi tujuan/link menu.", "error");
      else alert("Isi tujuan/link menu.");
      return;
    }
    href = href.replace(/\.html?$/i, "").replace(/^\.\//, "");
    const penuh = OsisSidebar.getMenu();
    if (OsisSidebar.editIndex >= 0 && penuh[OsisSidebar.editIndex]) {
      penuh[OsisSidebar.editIndex] = { href, label: judul, icon: ikon, super: superOnly };
      if (await OsisSidebar.simpanKeServer(penuh, "Menu diperbarui.")) {
        OsisSidebar.editIndex = -1;
        OsisSidebar.renderMenu();
      }
    } else {
      const duplikat = penuh.some(
        (x) => String(x.href).toLowerCase() === href.toLowerCase(),
      );
      if (duplikat) {
        if (typeof showToast === "function")
          showToast("Link itu sudah ada di sidebar.", "error");
        else alert("Link itu sudah ada di sidebar.");
        return;
      }
      penuh.push({ href, label: judul, icon: ikon, super: superOnly });
      if (await OsisSidebar.simpanKeServer(penuh, "Menu ditambah.")) {
        OsisSidebar.editIndex = -1;
        OsisSidebar.renderMenu();
      }
    }
  },

  // Isi ulang daftar menu (tampil biasa / mode atur)
  renderMenu() {
    const nav = document.getElementById("osisSideNav");
    // Tombol Atur hanya untuk pengelola (super_admin selalu lolos).
    const atur = document.getElementById("osisSideAtur");
    if (atur && !OsisSidebar.editMode) {
      atur.style.display = OsisSidebar.bisaAtur() ? "" : "none";
    }
    if (!nav) return;
    if (OsisSidebar.editMode) {
      if (!OsisSidebar.bisaAtur()) {
        OsisSidebar.editMode = false;
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
    nav.innerHTML = items
      .map((m) => {
        const slug = OsisSidebar.slugHref(m.href);
        const aktif = slug && slug === cur ? " active" : "";
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
      })
      .join("");
  },

  renderEditor(nav) {
    // Editor selalu melihat daftar penuh (termasuk item khusus super).
    const items = OsisSidebar.getMenu();
    const sedangEdit =
      OsisSidebar.editIndex >= 0 ? items[OsisSidebar.editIndex] : null;
    const vJudul = sedangEdit ? sedangEdit.label : "";
    const vHref = sedangEdit ? sedangEdit.href : "";
    const vIkon = sedangEdit ? sedangEdit.icon : "fa-solid fa-link";
    const vSuper = sedangEdit && sedangEdit.super ? "checked" : "";

    const rows = items
      .map((m, i) => {
        const upDis = i === 0 ? "disabled" : "";
        const downDis = i === items.length - 1 ? "disabled" : "";
        return (
          "<div class=\"side-edit-row\">" +
          "<div class=\"side-edit-top\"><span class=\"sic\"><i class=\"" +
          OsisSidebar.esc(m.icon) +
          "\"></i></span>" +
          "<b>" +
          OsisSidebar.esc(m.label) +
          "<small>" +
          OsisSidebar.esc(m.href) +
          (m.super ? " &bull; khusus super" : "") +
          "</small></b></div>" +
          "<div class=\"side-edit-ctrl\">" +
          "<button class=\"side-btn\" " +
          upDis +
          " title=\"Naik\" onclick=\"OsisSidebar.geser(" +
          i +
          ",-1)\"><i class=\"fa-solid fa-arrow-up\"></i></button>" +
          "<button class=\"side-btn\" " +
          downDis +
          " title=\"Turun\" onclick=\"OsisSidebar.geser(" +
          i +
          ",1)\"><i class=\"fa-solid fa-arrow-down\"></i></button>" +
          "<button class=\"side-btn edt\" title=\"Edit\" onclick=\"OsisSidebar.mulaiEdit(" +
          i +
          ")\"><i class=\"fa-solid fa-pen\"></i></button>" +
          "<button class=\"side-btn del\" title=\"Hapus\" onclick=\"OsisSidebar.hapus(" +
          i +
          ")\"><i class=\"fa-solid fa-trash\"></i></button>" +
          "</div></div>"
        );
      })
      .join("");

    const ikonBtns = OsisSidebar.ICONS.map(
      (c) =>
        "<button type=\"button\" data-ikon=\"" +
        c +
        "\" class=\"" +
        (c === vIkon ? "on" : "") +
        "\" title=\"" +
        c +
        "\" onclick=\"OsisSidebar.pilihIkon('" +
        c +
        "',event)\"><i class=\"" +
        c +
        "\"></i></button>",
    ).join("");

    nav.innerHTML =
      "<div class=\"side-hint\">Perubahan tersimpan ke server dan berlaku untuk SEMUA user.</div>" +
      (rows || "<div class=\"side-hint\">Belum ada menu.</div>") +
      ("<form class=\"side-form\" onsubmit=\"OsisSidebar.simpanDariForm(event)\">" +
        "<h4>" +
        (sedangEdit ? "Edit menu" : "Tambah menu") +
        "</h4>" +
        "<label>Nama menu<input type=\"text\" id=\"sideJudul\" maxlength=\"40\" placeholder=\"cth: Notulensi\" value=\"" +
        OsisSidebar.esc(vJudul) +
        "\"></label>" +
        "<label>Tujuan (nama file tanpa .html / link)<input type=\"text\" id=\"sideHref\" maxlength=\"120\" placeholder=\"cth: notulensi\" value=\"" +
        OsisSidebar.esc(vHref) +
        "\"></label>" +
        "<label>Ikon (klik pilih / tulis manual)<input type=\"text\" id=\"sideIkon\" maxlength=\"80\" value=\"" +
        OsisSidebar.esc(vIkon) +
        "\"></label>" +
        "<div class=\"side-icons\">" +
        ikonBtns +
        "</div>" +
        "<label class=\"side-check\"><input type=\"checkbox\" id=\"sideSuper\" " +
        vSuper +
        "> Khusus super admin</label>" +
        "<div class=\"side-form-act\">" +
        "<button type=\"submit\" class=\"side-add\">" +
        (sedangEdit ? "Simpan" : "Tambah") +
        "</button>" +
        (sedangEdit
          ? "<button type=\"button\" class=\"side-cancel\" onclick=\"OsisSidebar.batalEdit()\">Batal</button>"
          : "") +
        "</div>" +
        "<button type=\"button\" class=\"side-reset\" onclick=\"OsisSidebar.resetMenu()\">Kembalikan ke bawaan</button>" +
        "</form>");
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

document.addEventListener("DOMContentLoaded", () => OsisSidebar.pasang());
if (document.readyState !== "loading") OsisSidebar.pasang();