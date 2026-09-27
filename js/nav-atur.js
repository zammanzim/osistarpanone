// =========================================================================
// NAV-ATUR — editor "Atur Navigasi" (super_admin / hak "Site").
// Atur tab bawah (maks 4) + Menu Lainnya: tambah, hapus, geser urutan,
// pindah tab↔sheet, ikon, label. Tersimpan ke server (site_content.
// bottomnav_menu) dan berlaku untuk SEMUA user. Ikut pola OsisSidebar.
// Tombol muncul di dalam sheet "Menu Lainnya" (index saja).
// =========================================================================

const NavAtur = {
  draft: null, // { tabs: [], sheet: [] } — salinan kerja selama editor dibuka
  editKey: null, // "tabs:0" / "sheet:2" yang lagi diedit, atau null

  ICONS: [
    "fa-solid fa-house", "fa-solid fa-folder-open", "fa-solid fa-images",
    "fa-solid fa-phone", "fa-solid fa-users", "fa-solid fa-inbox",
    "fa-solid fa-music", "fa-solid fa-box-archive", "fa-solid fa-link",
    "fa-solid fa-star", "fa-solid fa-heart", "fa-solid fa-calendar",
    "fa-solid fa-calendar-days", "fa-solid fa-bullhorn", "fa-solid fa-newspaper",
    "fa-solid fa-circle-info", "fa-solid fa-gear", "fa-solid fa-key",
    "fa-solid fa-wallet", "fa-solid fa-clipboard-list",
  ],

  bisa() {
    try {
      return typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("site");
    } catch (e) {
      return false;
    }
  },

  uid() {
    try {
      const u = typeof OsisAuth !== "undefined" && OsisAuth.getUser ? OsisAuth.getUser() : null;
      if (u && u.mode === "osis" && u.id) return u.id;
    } catch (e) {}
    return null;
  },

  esc(s) {
    if (typeof escapeHtml === "function") return escapeHtml(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  },

  klon(o) {
    return JSON.parse(JSON.stringify(o || { tabs: [], sheet: [] }));
  },

  // ---- tombol di sheet ----
  pasangTombol() {
    const sheet = document.getElementById("navSheet");
    if (!sheet || document.getElementById("navAturBtn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "navAturBtn";
    btn.className = "nav-atur-btn";
    btn.innerHTML = '<i class="fa-solid fa-gear"></i><span>Atur Navigasi</span>';
    btn.addEventListener("click", () => NavAtur.buka());
    sheet.appendChild(btn);
    NavAtur.refresh();
  },

  refresh() {
    const btn = document.getElementById("navAturBtn");
    if (btn) btn.style.display = NavAtur.bisa() ? "" : "none";
  },

  // ---- buka / tutup editor ----
  buka() {
    if (!NavAtur.bisa()) {
      if (typeof showToast === "function") showToast("Hanya super_admin yang bisa mengatur navigasi.", "error");
      return;
    }
    if (typeof NavMore !== "undefined") NavMore.tutup();
    const m = (typeof Bottomnav !== "undefined" && Bottomnav.efektif()) || { tabs: [], sheet: [] };
    NavAtur.draft = NavAtur.klon(m);
    NavAtur.editKey = null;
    let ov = document.getElementById("navAturOverlay");
    if (ov) ov.remove();
    ov = document.createElement("div");
    ov.id = "navAturOverlay";
    ov.className = "navatur-overlay";
    ov.innerHTML =
      '<div class="navatur-box" role="dialog" aria-label="Atur Navigasi">' +
      '<div class="navatur-head"><b><i class="fa-solid fa-gear"></i> Atur Navigasi</b>' +
      '<button class="icon-btn" id="navAturX" title="Tutup"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="navatur-hint">Berlaku untuk SEMUA user. Tab bawah maks 4, tombol tengah tidak bisa diubah.</div>' +
      '<div id="navAturBody"></div>' +
      '<div class="navatur-foot">' +
      '<button class="side-reset" id="navAturReset">Kembalikan ke bawaan</button>' +
      '<div class="navatur-foot-act">' +
      '<button class="side-cancel" id="navAturBatal">Batal</button>' +
      '<button class="side-add" id="navAturSimpan">Simpan</button>' +
      "</div></div></div>";
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
    ov.addEventListener("click", (e) => {
      if (e.target === ov) NavAtur.tutup();
    });
    ov.querySelector("#navAturX").addEventListener("click", () => NavAtur.tutup());
    ov.querySelector("#navAturBatal").addEventListener("click", () => NavAtur.tutup());
    ov.querySelector("#navAturReset").addEventListener("click", () => NavAtur.reset());
    ov.querySelector("#navAturSimpan").addEventListener("click", () => NavAtur.simpan());
    NavAtur.render();
  },

  tutup() {
    const ov = document.getElementById("navAturOverlay");
    if (ov) ov.remove();
    NavAtur.draft = null;
    NavAtur.editKey = null;
    if (!document.querySelector(".struktur-modal") && !document.getElementById("uniOverlay")) {
      document.body.style.overflow = "";
    }
  },

  ruteDipakai() {
    const out = [];
    const d = NavAtur.draft || { tabs: [], sheet: [] };
    (d.tabs || []).concat(d.sheet || []).forEach((it) => {
      if (it && it.route) out.push(String(it.route));
    });
    return out;
  },

  // ---- render daftar ----
  barisHtml(it, sek, i) {
    const key = sek + ":" + i;
    const ikon = NavAtur.esc(it.icon || "fa-solid fa-link");
    const label = NavAtur.esc(it.label || "(tanpa nama)");
    const sub = it.route
      ? "#" + NavAtur.esc(it.route)
      : NavAtur.esc(String(it.href || "").slice(0, 32));
    const atasDis = i === 0 ? "disabled" : "";
    const list = sek === "tabs" ? NavAtur.draft.tabs : NavAtur.draft.sheet;
    const bawahDis = i === list.length - 1 ? "disabled" : "";
    let html =
      '<div class="navatur-row">' +
      '<span class="sic"><i class="' + ikon + '"></i></span>' +
      "<b>" + label + "<small>" + sub + "</small></b>" +
      '<div class="side-edit-ctrl">' +
      '<button class="side-btn" ' + atasDis + ' title="Naik" onclick="NavAtur.geser(\'' + sek + "'," + i + ",-1)\">" +
      '<i class="fa-solid fa-arrow-up"></i></button>' +
      '<button class="side-btn" ' + bawahDis + ' title="Turun" onclick="NavAtur.geser(\'' + sek + "'," + i + ",1)\">" +
      '<i class="fa-solid fa-arrow-down"></i></button>' +
      '<button class="side-btn" title="Pindah ' + (sek === "tabs" ? "ke Menu Lainnya" : "ke Tab Bawah") + '" onclick="NavAtur.pindah(\'' + sek + "'," + i + ')">' +
      '<i class="fa-solid fa-right-left"></i></button>' +
      '<button class="side-btn edt" title="Edit" onclick="NavAtur.mulaiEdit(\'' + sek + "'," + i + ')">' +
      '<i class="fa-solid fa-pen"></i></button>' +
      '<button class="side-btn del" title="Hapus" onclick="NavAtur.hapus(\'' + sek + "'," + i + ')">' +
      '<i class="fa-solid fa-trash"></i></button>' +
      "</div></div>";
    if (NavAtur.editKey === key) html += NavAtur.formHtml(it, sek);
    return html;
  },

  formHtml(it, sek) {
    const isTab = sek === "tabs";
    const dipakai = NavAtur.ruteDipakai().filter((r) => r !== it.route);
    const opsiRute = (typeof Bottomnav !== "undefined" ? Bottomnav.ruteTersedia() : [])
      .filter((r) => dipakai.indexOf(r) < 0 || r === it.route)
      .map((r) => '<option value="' + NavAtur.esc(r) + '"' + (r === it.route ? " selected" : "") + ">" + NavAtur.esc(r) + "</option>")
      .join("");
    const ikonBtns = NavAtur.ICONS.map(
      (c) =>
        '<button type="button" data-ikon="' + c + '" class="' + (c === it.icon ? "on" : "") + '" title="' + c +
        '" onclick="NavAtur.pilihIkon(\'' + c + '\',event)"><i class="' + c + '"></i></button>',
    ).join("");
    return (
      '<div class="side-form">' +
      (it.href
        ? '<label>Link luar<input type="text" id="navF_href" maxlength="200" value="' + NavAtur.esc(it.href) + '"></label>'
        : '<label>Halaman<select id="navF_route">' + opsiRute + "</select></label>") +
      '<label>Label<input type="text" id="navF_label" maxlength="20" value="' + NavAtur.esc(it.label || "") + '"></label>' +
      (isTab
        ? ""
        : '<label>Sub-judul<input type="text" id="navF_sub" maxlength="40" value="' + NavAtur.esc(it.sub || "") + '"></label>' +
          '<label>Nama pendek (tombol tengah)<input type="text" id="navF_short" maxlength="12" value="' + NavAtur.esc(it.short || "") + '"></label>') +
      '<label>Ikon (klik pilih / tulis manual)<input type="text" id="navF_icon" maxlength="80" value="' + NavAtur.esc(it.icon || "fa-solid fa-link") + '"></label>' +
      '<div class="side-icons">' + ikonBtns + "</div>" +
      '<div class="side-form-act">' +
      '<button type="button" class="side-add" onclick="NavAtur.simpanForm(\'' + sek + "')\">Terapkan</button>" +
      '<button type="button" class="side-cancel" onclick="NavAtur.batalEdit()">Batal</button>' +
      "</div></div>"
    );
  },

  render() {
    const body = document.getElementById("navAturBody");
    if (!body || !NavAtur.draft) return;
    const d = NavAtur.draft;
    body.innerHTML =
      '<h4 class="navatur-sec">Tab Bawah (' + d.tabs.length + "/4)</h4>" +
      ((d.tabs || []).map((it, i) => NavAtur.barisHtml(it, "tabs", i)).join("") ||
        '<div class="side-hint">Kosong.</div>') +
      '<button type="button" class="navatur-tambah" onclick="NavAtur.tambahTab()">' +
      '<i class="fa-solid fa-plus"></i> Tambah tab</button>' +
      '<h4 class="navatur-sec">Menu Lainnya (' + d.sheet.length + ")</h4>" +
      ((d.sheet || []).map((it, i) => NavAtur.barisHtml(it, "sheet", i)).join("") ||
        '<div class="side-hint">Kosong.</div>') +
      '<div class="navatur-tambah-row">' +
      '<button type="button" class="navatur-tambah" onclick="NavAtur.tambahSheetHalaman()">' +
      '<i class="fa-solid fa-plus"></i> Tambah halaman</button>' +
      '<button type="button" class="navatur-tambah" onclick="NavAtur.tambahSheetLink()">' +
      '<i class="fa-solid fa-link"></i> Tambah link luar</button>' +
      "</div>";
  },

  // ---- aksi daftar ----
  geser(sek, i, dir) {
    const list = sek === "tabs" ? NavAtur.draft.tabs : NavAtur.draft.sheet;
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    NavAtur.editKey = null;
    NavAtur.render();
  },

  hapus(sek, i) {
    const list = sek === "tabs" ? NavAtur.draft.tabs : NavAtur.draft.sheet;
    if (!list[i]) return;
    if (sek === "tabs" && list.length <= 1) {
      if (typeof showToast === "function") showToast("Tab bawah minimal 1.", "error");
      return;
    }
    if (!confirm('Hapus "' + (list[i].label || list[i].route || "?") + '" dari navigasi?')) return;
    list.splice(i, 1);
    NavAtur.editKey = null;
    NavAtur.render();
  },

  pindah(sek, i) {
    const dari = sek === "tabs" ? NavAtur.draft.tabs : NavAtur.draft.sheet;
    const ke = sek === "tabs" ? NavAtur.draft.sheet : NavAtur.draft.tabs;
    const it = dari[i];
    if (!it) return;
    if (sek === "sheet") {
      if (!it.route) {
        if (typeof showToast === "function") showToast("Link luar cuma bisa di Menu Lainnya.", "error");
        return;
      }
      if (NavAtur.draft.tabs.length >= 4) {
        if (typeof showToast === "function") showToast("Tab bawah sudah penuh (maks 4).", "error");
        return;
      }
      ke.push({ route: it.route, label: it.label, icon: it.icon });
    } else {
      if (dari.length <= 1) {
        if (typeof showToast === "function") showToast("Tab bawah minimal 1.", "error");
        return;
      }
      ke.push({
        route: it.route,
        label: it.label,
        sub: "",
        icon: it.icon,
        short: String(it.label || "").slice(0, 12),
      });
    }
    dari.splice(i, 1);
    NavAtur.editKey = null;
    NavAtur.render();
  },

  tambahTab() {
    if (NavAtur.draft.tabs.length >= 4) {
      if (typeof showToast === "function") showToast("Tab bawah sudah penuh (maks 4).", "error");
      return;
    }
    const dipakai = NavAtur.ruteDipakai();
    const sisa = (typeof Bottomnav !== "undefined" ? Bottomnav.ruteTersedia() : []).filter(
      (r) => dipakai.indexOf(r) < 0,
    );
    if (!sisa.length) {
      if (typeof showToast === "function") showToast("Semua halaman sudah terpasang.", "error");
      return;
    }
    const route = sisa[0];
    NavAtur.draft.tabs.push({
      route,
      label: (typeof Bottomnav !== "undefined" ? Bottomnav.labelBawaan(route) : route).slice(0, 20),
      icon: "fa-solid fa-link",
    });
    NavAtur.editKey = "tabs:" + (NavAtur.draft.tabs.length - 1);
    NavAtur.render();
    setTimeout(() => document.getElementById("navF_label")?.focus(), 60);
  },

  tambahSheetHalaman() {
    if (NavAtur.draft.sheet.length >= 12) {
      if (typeof showToast === "function") showToast("Menu lainnya sudah penuh (maks 12).", "error");
      return;
    }
    const dipakai = NavAtur.ruteDipakai();
    const sisa = (typeof Bottomnav !== "undefined" ? Bottomnav.ruteTersedia() : []).filter(
      (r) => dipakai.indexOf(r) < 0,
    );
    if (!sisa.length) {
      if (typeof showToast === "function") showToast("Semua halaman sudah terpasang.", "error");
      return;
    }
    const route = sisa[0];
    const label = (typeof Bottomnav !== "undefined" ? Bottomnav.labelBawaan(route) : route).slice(0, 20);
    NavAtur.draft.sheet.push({ route, label, sub: "", icon: "fa-solid fa-link", short: label.slice(0, 12) });
    NavAtur.editKey = "sheet:" + (NavAtur.draft.sheet.length - 1);
    NavAtur.render();
    setTimeout(() => document.getElementById("navF_label")?.focus(), 60);
  },

  tambahSheetLink() {
    if (NavAtur.draft.sheet.length >= 12) {
      if (typeof showToast === "function") showToast("Menu lainnya sudah penuh (maks 12).", "error");
      return;
    }
    NavAtur.draft.sheet.push({ href: "https://", label: "Link Baru", sub: "", icon: "fa-solid fa-link", short: "Link" });
    NavAtur.editKey = "sheet:" + (NavAtur.draft.sheet.length - 1);
    NavAtur.render();
    setTimeout(() => {
      const el = document.getElementById("navF_href");
      if (el) {
        el.focus();
        el.select();
      }
    }, 60);
  },

  // ---- form baris ----
  mulaiEdit(sek, i) {
    NavAtur.editKey = sek + ":" + i;
    NavAtur.render();
    setTimeout(() => document.getElementById("navF_label")?.focus(), 60);
  },

  batalEdit() {
    NavAtur.editKey = null;
    NavAtur.render();
  },

  pilihIkon(cls, ev) {
    if (ev) ev.preventDefault();
    const inp = document.getElementById("navF_icon");
    if (inp) inp.value = cls;
    document.querySelectorAll("#navAturOverlay .side-icons button").forEach((b) => {
      b.classList.toggle("on", b.dataset.ikon === cls);
    });
  },

  simpanForm(sek) {
    const idx = parseInt(String(NavAtur.editKey || "").split(":")[1], 10);
    const list = sek === "tabs" ? NavAtur.draft.tabs : NavAtur.draft.sheet;
    const it = list[idx];
    if (!it) return;
    const label = document.getElementById("navF_label")?.value.trim() || "";
    if (!label) {
      if (typeof showToast === "function") showToast("Isi label dulu.", "error");
      return;
    }
    if (label.length > 20) {
      if (typeof showToast === "function") showToast("Label maksimal 20 huruf.", "error");
      return;
    }
    it.label = label;
    it.icon = document.getElementById("navF_icon")?.value.trim() || "fa-solid fa-link";
    if (it.href) {
      const href = document.getElementById("navF_href")?.value.trim() || "";
      if (!/^(https?:\/\/|mailto:)/i.test(href)) {
        if (typeof showToast === "function") showToast("Link harus http(s):// atau mailto:.", "error");
        return;
      }
      it.href = href;
    } else {
      const route = document.getElementById("navF_route")?.value || it.route;
      const dipakai = NavAtur.ruteDipakai().filter((r) => r !== it.route);
      if (dipakai.indexOf(route) >= 0) {
        if (typeof showToast === "function") showToast("Halaman itu sudah terpasang.", "error");
        return;
      }
      it.route = route;
    }
    if (sek === "sheet") {
      it.sub = document.getElementById("navF_sub")?.value.trim().slice(0, 40) || "";
      it.short = document.getElementById("navF_short")?.value.trim().slice(0, 12) || "";
    } else {
      delete it.sub;
      delete it.short;
    }
    NavAtur.editKey = null;
    NavAtur.render();
  },

  // ---- simpan / reset server ----
  async simpan() {
    const uid = NavAtur.uid();
    if (!uid) {
      if (typeof showToast === "function") showToast("Login dulu sebagai OSIS.", "error");
      return;
    }
    const err =
      (typeof Bottomnav !== "undefined" && Bottomnav.validasi && Bottomnav.validasi(NavAtur.draft)) || null;
    if (err) {
      if (typeof showToast === "function") showToast(err, "error");
      else alert(err);
      return;
    }
    try {
      if (typeof simpanBottomnav !== "function") throw new Error("db.js belum dimuat.");
      await simpanBottomnav(uid, NavAtur.draft);
      if (typeof Bottomnav !== "undefined") {
        const bersih = Bottomnav.bersihMenu(NavAtur.draft) || NavAtur.draft;
        Bottomnav.menu = bersih;
        try {
          if (typeof Cache !== "undefined" && Cache.set) Cache.set(Bottomnav.CACHE, bersih);
        } catch (e) {}
        Bottomnav.render();
      }
      if (typeof showToast === "function") showToast("Navigasi diperbarui untuk semua user.", "success");
      NavAtur.tutup();
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (msg === "ERR_NO_AUTH" || String(msg).includes("kendali")) {
        if (typeof showToast === "function") showToast("Kamu tidak punya kendali atas halaman ini.", "error");
      } else if (typeof showToast === "function") {
        showToast("Gagal simpan: " + msg, "error");
      } else {
        alert("Gagal simpan: " + msg);
      }
    }
  },

  async reset() {
    if (!confirm("Kembalikan navigasi ke bawaan untuk SEMUA user?")) return;
    const uid = NavAtur.uid();
    if (!uid) {
      if (typeof showToast === "function") showToast("Login dulu sebagai OSIS.", "error");
      return;
    }
    try {
      if (typeof simpanBottomnav !== "function") throw new Error("db.js belum dimuat.");
      const bawaan = NavAtur.klon(
        (typeof Bottomnav !== "undefined" && Bottomnav.DEFAULT) || { tabs: [], sheet: [] },
      );
      await simpanBottomnav(uid, bawaan);
      if (typeof Bottomnav !== "undefined") {
        Bottomnav.menu = bawaan;
        try {
          if (typeof Cache !== "undefined" && Cache.set) Cache.set(Bottomnav.CACHE, bawaan);
        } catch (e) {}
        Bottomnav.render();
      }
      if (typeof showToast === "function") showToast("Navigasi dikembalikan ke bawaan.", "success");
      NavAtur.tutup();
    } catch (e) {
      if (typeof showToast === "function") showToast("Gagal reset: " + ((e && e.message) || e), "error");
      else alert("Gagal reset: " + ((e && e.message) || e));
    }
  },

  init() {
    NavAtur.pasangTombol();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.getElementById("navAturOverlay")) NavAtur.tutup();
    });
    window.addEventListener("hashchange", () => NavAtur.refresh());
  },
};

// Tombol ikut login/logout (renderHeader dipanggil tiap auth berubah).
try {
  if (typeof OsisAuth !== "undefined" && OsisAuth.renderHeader) {
    const _navRenderHeader = OsisAuth.renderHeader.bind(OsisAuth);
    OsisAuth.renderHeader = function () {
      _navRenderHeader();
      try {
        NavAtur.refresh();
      } catch (e) {}
    };
  }
} catch (e) {}

if (typeof onReady === "function") {
  onReady(() => NavAtur.init());
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => NavAtur.init());
} else {
  NavAtur.init();
}
