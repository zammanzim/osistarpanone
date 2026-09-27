// =========================================================================
// BOTTOMNAV — tab bawah + sheet "Menu Lainnya" digambar dari config server
// (site_content.bottomnav_menu). Super_admin mengatur lewat editor
// "Atur Navigasi" (js/nav-atur.js). User biasa hanya melihat.
// Tombol tengah (bulat) STATIS — tidak dikonfigurasi, selalu buka sheet.
// Offline: tampil cache terakhir / susunan bawaan.
// =========================================================================

const Bottomnav = {
  CACHE: "bottomnav",

  // Susunan bawaan = yang tertulis di index.html (dipakai sebelum config
  // server datang / offline / config rusak).
  DEFAULT: {
    tabs: [
      { route: "home", label: "Home", icon: "fa-solid fa-house" },
      { route: "sekbid", label: "Sekbid", icon: "fa-solid fa-folder-open" },
      { route: "galeri", label: "Galeri", icon: "fa-solid fa-images" },
      { route: "kontak", label: "Kontak", icon: "fa-solid fa-phone" },
    ],
    sheet: [
      { route: "pengurus", label: "Pengurus", sub: "Struktur OSIS", icon: "fa-solid fa-users", short: "Pengurus" },
      { route: "aspirasi", label: "Aspirasi", sub: "Suara siswa", icon: "fa-solid fa-inbox", short: "Aspirasi" },
      { route: "musik", label: "Request Lagu", sub: "Radio jam istirahat", icon: "fa-solid fa-music", short: "Musik" },
      { route: "arsip", label: "Arsip Galeri", sub: "Semua dokumentasi", icon: "fa-solid fa-box-archive", short: "Arsip" },
    ],
  },

  menu: null, // config efektif (server) — null = pakai DEFAULT

  esc(s) {
    if (typeof escapeHtml === "function") return escapeHtml(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  },

  // Rute internal yang punya <section class="view"> di halaman ini.
  ruteAda(route) {
    if (!route) return false;
    try {
      return !!document.querySelector('.view[data-view="' + route + '"]');
    } catch (e) {
      return false;
    }
  },

  // Config efektif saat ini (server kalau ada, kalau tidak = bawaan).
  efektif() {
    const m = Bottomnav.menu;
    if (m && Array.isArray(m.tabs) && Array.isArray(m.sheet)) return m;
    return Bottomnav.DEFAULT;
  },

  // Daftar rute internal yang dikenal nav (untuk Router.parse).
  ruteDikenal() {
    const m = Bottomnav.efektif();
    const out = [];
    (m.tabs || []).concat(m.sheet || []).forEach((it) => {
      if (it && it.route && out.indexOf(it.route) < 0) out.push(it.route);
    });
    return out;
  },

  punyaRoute(r) {
    return Bottomnav.ruteDikenal().indexOf(String(r || "")) >= 0;
  },

  // Normalisasi 1 item dari server (buang yang rusak, jangan mati total).
  bersihItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    const route = String(raw.route || "").trim().toLowerCase();
    const href = String(raw.href || "").trim();
    const label = String(raw.label || "").trim();
    const icon = String(raw.icon || "").trim() || "fa-solid fa-link";
    if (!label) return null;
    if (route && href) return null; // XOR
    if (route) {
      if (!/^[a-z0-9-]+$/.test(route)) return null;
      if (!Bottomnav.ruteAda(route)) return null; // view tidak ada = skip
      return {
        route,
        label: label.slice(0, 20),
        sub: String(raw.sub || "").slice(0, 40),
        icon: icon.slice(0, 80),
        short: String(raw.short || "").slice(0, 12),
      };
    }
    if (href) {
      if (!/^(https?:\/\/|mailto:)/i.test(href)) return null;
      return {
        href: href.slice(0, 200),
        label: label.slice(0, 20),
        sub: String(raw.sub || "").slice(0, 40),
        icon: icon.slice(0, 80),
        short: String(raw.short || "").slice(0, 12),
      };
    }
    return null;
  },

  // Normalisasi seluruh config (dipakai render + editor).
  bersihMenu(menu) {
    if (!menu || typeof menu !== "object") return null;
    const tabs = (Array.isArray(menu.tabs) ? menu.tabs : [])
      .map((x) => Bottomnav.bersihItem(x))
      .filter((x) => x && x.route); // tab wajib internal
    const sheet = (Array.isArray(menu.sheet) ? menu.sheet : [])
      .map((x) => Bottomnav.bersihItem(x))
      .filter(Boolean);
    if (!tabs.length) return null;
    return { tabs: tabs.slice(0, 4), sheet: sheet.slice(0, 12) };
  },

  // Validasi untuk editor (mirror aturan server). Return string error / null.
  validasi(menu) {
    if (!menu || typeof menu !== "object") return "Config rusak.";
    const tabs = Array.isArray(menu.tabs) ? menu.tabs : [];
    const sheet = Array.isArray(menu.sheet) ? menu.sheet : [];
    if (tabs.length < 1) return "Tab bawah minimal 1.";
    if (tabs.length > 4) return "Tab bawah maksimal 4 (tombol tengah tetap).";
    if (sheet.length > 12) return "Menu lainnya maksimal 12.";
    const lihat = [];
    const cek = (it, diTab) => {
      if (!it || typeof it !== "object") return "Item rusak.";
      const route = String(it.route || "").trim().toLowerCase();
      const href = String(it.href || "").trim();
      const label = String(it.label || "").trim();
      if ((route && href) || (!route && !href)) return "Tiap item wajib route ATAU link luar.";
      if (route && !/^[a-z0-9-]+$/.test(route)) return "Route tidak valid: " + route;
      if (route && !Bottomnav.ruteAda(route)) return "Halaman belum ada: " + route;
      if (href && !/^(https?:\/\/|mailto:)/i.test(href)) return "Link harus http(s):// atau mailto:.";
      if (!label) return "Label wajib diisi.";
      if (label.length > 20) return "Label maksimal 20 huruf.";
      if (diTab && !route) return "Tab bawah wajib halaman internal (link luar cuma di Menu Lainnya).";
      if (route) {
        if (lihat.indexOf(route) >= 0) return "Rute dobel: " + route;
        lihat.push(route);
      }
      return null;
    };
    for (const t of tabs) {
      const err = cek(t, true);
      if (err) return err;
    }
    for (const s of sheet) {
      const err = cek(s, false);
      if (err) return err;
    }
    return null;
  },

  // Rute internal yang tersedia di halaman ini (untuk dropdown editor).
  ruteTersedia() {
    const out = [];
    try {
      document.querySelectorAll(".view[data-view]").forEach((el) => {
        const r = String((el.dataset && el.dataset.view) || "").trim().toLowerCase();
        if (r && out.indexOf(r) < 0) out.push(r);
      });
    } catch (e) {}
    return out;
  },

  labelBawaan(route) {
    const semua = Bottomnav.DEFAULT.tabs.concat(Bottomnav.DEFAULT.sheet);
    const ketemu = semua.find((x) => x.route === route);
    if (ketemu) return ketemu.label;
    return route.charAt(0).toUpperCase() + route.slice(1);
  },

  tabHtml(it) {
    return (
      '<a href="#/' + Bottomnav.esc(it.route) + '" class="tab-item" data-route="' + Bottomnav.esc(it.route) + '">' +
      '<span class="ico"><i class="' + Bottomnav.esc(it.icon) + '"></i></span>' +
      Bottomnav.esc(it.label) +
      "</a>"
    );
  },

  sheetHtml(it) {
    const short = it.short ? ' data-short="' + Bottomnav.esc(it.short) + '"' : "";
    const dalam = '<span class="nsi-ico"><i class="' + Bottomnav.esc(it.icon) + '"></i></span>' +
      '<span class="nsi-text"><b>' + Bottomnav.esc(it.label) + "</b><small>" +
      Bottomnav.esc(it.sub || "") + "</small></span>";
    if (it.href) {
      return '<a href="' + Bottomnav.esc(it.href) + '" target="_blank" rel="noopener" class="nav-sheet-item"' + short + ">" + dalam + "</a>";
    }
    return '<a href="#/' + Bottomnav.esc(it.route) + '" class="nav-sheet-item" data-route="' + Bottomnav.esc(it.route) + '"' + short + ">" + dalam + "</a>";
  },

  render() {
    const nav = document.getElementById("bottomNav");
    const grid = document.querySelector(".nav-sheet-grid");
    if (!nav && !grid) return;
    const m = Bottomnav.bersihMenu(Bottomnav.efektif()) || Bottomnav.bersihMenu(Bottomnav.DEFAULT);

    // --- tab bawah: pill + tombol tengah dipertahankan, sisanya digambar ulang.
    // Tombol tengah selalu di tengah (kiri = ceil(n/2)).
    if (nav) {
      const pill = document.getElementById("navPill");
      const moreBtn = document.getElementById("navMoreBtn");
      nav.querySelectorAll(".tab-item").forEach((el) => el.remove());
      const batas = Math.ceil(m.tabs.length / 2);
      const kiri = m.tabs.slice(0, batas).map((t) => Bottomnav.tabHtml(t)).join("");
      const kanan = m.tabs.slice(batas).map((t) => Bottomnav.tabHtml(t)).join("");
      const tmp = document.createElement("div");
      tmp.innerHTML = kiri;
      const fragKiri = document.createDocumentFragment();
      while (tmp.firstChild) fragKiri.appendChild(tmp.firstChild);
      tmp.innerHTML = kanan;
      const fragKanan = document.createDocumentFragment();
      while (tmp.firstChild) fragKanan.appendChild(tmp.firstChild);
      if (moreBtn) {
        nav.insertBefore(fragKiri, moreBtn);
        nav.appendChild(fragKanan);
      } else {
        if (pill && pill.nextSibling) {
          nav.insertBefore(fragKiri, pill.nextSibling);
          nav.appendChild(fragKanan);
        } else {
          nav.appendChild(fragKiri);
          nav.appendChild(fragKanan);
        }
      }
    }

    // --- sheet: digambar ulang penuh (kecuali komentar dev, tidak penting).
    if (grid) {
      grid.innerHTML = m.sheet.map((s) => Bottomnav.sheetHtml(s)).join("");
    }

    Bottomnav.terapkanState();
  },

  // Terapkan active-state + pill + ikon tengah tanpa navigasi ulang.
  terapkanState() {
    const cur = (typeof Router !== "undefined" && Router.current) || "";
    try {
      document.querySelectorAll(".tab-item").forEach((t) =>
        t.classList.toggle("active", t.dataset.route === cur),
      );
      document.querySelectorAll(".nav-sheet-item").forEach((t) =>
        t.classList.toggle("active", t.dataset.route === cur),
      );
      const moreBtn = document.getElementById("navMoreBtn");
      if (moreBtn)
        moreBtn.classList.toggle(
          "is-in-sheet",
          !!document.querySelector('.nav-sheet-item[data-route="' + cur + '"]'),
        );
    } catch (e) {}
    try {
      if (typeof Router !== "undefined" && Router.geserPill) Router.geserPill(false);
    } catch (e) {}
    try {
      if (typeof NavMore !== "undefined" && NavMore.refreshIcon) NavMore.refreshIcon();
    } catch (e) {}
  },

  async muat(ulang) {
    if (!ulang) {
      const cached = (typeof Cache !== "undefined" && Cache.get && Cache.get(Bottomnav.CACHE)) || null;
      if (cached) {
        const bersih = Bottomnav.bersihMenu(cached);
        if (bersih) {
          Bottomnav.menu = bersih;
          try {
            Bottomnav.render();
          } catch (e) {}
        }
      }
    }
    if (typeof getBottomnav !== "function") return;
    try {
      const fresh = await getBottomnav();
      if (fresh) {
        const bersih = Bottomnav.bersihMenu(fresh);
        if (bersih && JSON.stringify(bersih) !== JSON.stringify(Bottomnav.menu)) {
          Bottomnav.menu = bersih;
          if (typeof Cache !== "undefined" && Cache.set) Cache.set(Bottomnav.CACHE, bersih);
          Bottomnav.render();
        }
      }
    } catch (e) {
      // offline / gagal: tetap pakai cache atau bawaan
    }
  },

  init() {
    if (!document.getElementById("bottomNav") && !document.querySelector(".nav-sheet-grid")) return;
    try {
      Bottomnav.render();
    } catch (e) {}
    Bottomnav.muat();
  },
};

if (typeof onReady === "function") {
  onReady(() => Bottomnav.init());
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Bottomnav.init());
} else {
  Bottomnav.init();
}
