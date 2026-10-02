// =========================================================================
// CHANGELOG — daftar versi DB-driven, bisa diedit langsung di halaman.
// Publik: baca bebas (DB → fallback changelog.json offline).
// Kelola inline (tambah/ubah/hapus): tombol muncul kalau login OSIS
// dengan hak "changelog" (super_admin selalu bisa).
// =========================================================================
(function () {
  "use strict";

  var semua = [];
  var saring = "semua";
  var cari = "";
  var bisaKelola = false;
  var editingId = null;
  var tipeForm = "patch";

  function esc(s) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(s);
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTanggal(iso) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return esc(iso);
    var bulan = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    return p[2].replace(/^0/, "") + " " + (bulan[+p[1]] || p[1]) + " " + p[0];
  }

  function badge(tipe) {
    if (tipe === "major") return '<span class="cl-badge cl-major"><i class="fa-solid fa-bolt"></i> Major</span>';
    if (tipe === "minor") return '<span class="cl-badge cl-minor"><i class="fa-solid fa-star"></i> Minor</span>';
    return '<span class="cl-badge cl-patch"><i class="fa-solid fa-wrench"></i> Patch</span>';
  }

  function cocok(r) {
    if (saring !== "semua" && r.type !== saring) return false;
    if (!cari) return true;
    var hay = (r.version + " " + r.title + " " + r.description + " " + r.message).toLowerCase();
    return hay.includes(cari);
  }

  function kartu(r) {
    var commit = String(r.commit || "").slice(0, 7);
    var stat = r.filesChanged + " file · +" + r.insertions + " / -" + r.deletions;
    var komitHtml = (commit || r.message)
      ? '<span class="cl-commit" title="' + esc(r.commit || "") + '"><i class="fa-solid fa-code-commit"></i> ' + esc(commit) + (r.message ? " · " + esc(r.message) : "") + "</span>"
      : "";
    var metaIsi =
      (r.filesChanged ? '<span><i class="fa-solid fa-file-lines"></i> ' + esc(stat) + "</span>" : "") +
      komitHtml;
    return (
      '<article class="cl-card cl-' + esc(r.type) + '">' +
      '<div class="cl-top"><span class="cl-ver">' + esc(r.version) + '</span>' + badge(r.type) +
      '<span class="cl-date"><i class="fa-regular fa-calendar"></i> ' + fmtTanggal(r.date) + "</span></div>" +
      '<h2 class="cl-title">' + esc(r.title) + "</h2>" +
      '<p class="cl-desc">' + esc(r.description) + "</p>" +
      (metaIsi ? '<div class="cl-meta">' + metaIsi + "</div>" : "") +
      (bisaKelola && r._id ? '<div class="cl-ops"><button class="btn btn-white btn-sm" onclick="Changelog.bukaForm(' + r._id + ')"><i class="fa-solid fa-pen"></i> Ubah</button><button class="btn btn-white btn-sm" onclick="Changelog.hapus(' + r._id + ')"><i class="fa-solid fa-trash-can"></i> Hapus</button></div>' : "") +
      "</article>"
    );
  }

  function render() {
    var daftar = semua.filter(cocok);
    var box = document.getElementById("clList");
    var info = document.getElementById("clInfo");
    if (info) {
      var nM = semua.filter(function (r) { return r.type === "major"; }).length;
      var nm = semua.filter(function (r) { return r.type === "minor"; }).length;
      var nP = semua.filter(function (r) { return r.type === "patch"; }).length;
      info.textContent = semua.length + " versi · " + nM + " major · " + nm + " minor · " + nP + " patch";
    }
    if (!box) return;
    if (!daftar.length) {
      box.innerHTML = '<div class="cl-card"><div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada versi yang cocok.</div></div>';
      return;
    }
    box.innerHTML = daftar.map(kartu).join("");
    var hit = document.getElementById("clHitung");
    if (hit) hit.textContent = daftar.length + " ditampilkan";
  }

  function segarkanSeg() {
    document.querySelectorAll("#clFilterSeg button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.f === saring);
    });
  }

  // ============ KELOLA INLINE (hak "changelog") ============
  function bolehKelola() {
    try { return !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("changelog")); }
    catch (e) { return false; }
  }

  function cekKelola() {
    bisaKelola = bolehKelola();
    var btn = document.getElementById("btnTambahCl");
    if (btn) btn.style.display = bisaKelola ? "" : "none";
    render();
  }

  function naikkan(versi, tipe) {
    var m = String(versi || "v1.0.0").match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return null;
    var x = +m[1], y = +m[2], z = +m[3];
    if (tipe === "major") return "v" + (x + 1) + ".0.0";
    if (tipe === "minor") return "v" + x + "." + (y + 1) + ".0";
    return "v" + x + "." + y + "." + (z + 1);
  }

  function versiBerikut(tipe) {
    if (!semua.length) return tipe === "major" ? "v1.0.0" : tipe === "minor" ? "v1.1.0" : "v1.0.1";
    return naikkan(semua[0].version, tipe);
  }

  function butuhKelola() {
    var u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
    if (!u || u.mode !== "osis") {
      if (typeof showPopup === "function") showPopup("Login sebagai OSIS dulu", "error");
      return null;
    }
    if (!bolehKelola()) {
      if (typeof OsisAuth !== "undefined" && OsisAuth.butuh) OsisAuth.butuh("changelog");
      return null;
    }
    return u;
  }

  function bukaForm(id) {
    if (!butuhKelola()) return;
    var item = id ? semua.find(function (x) { return String(x._id) === String(id); }) : null;
    if (id && !item) return;
    editingId = item ? item._id : null;
    tipeForm = item ? item.type : "patch";
    var hariIni = new Date().toISOString().slice(0, 10);
    document.getElementById("clFormOverlay")?.remove();
    var overlay = document.createElement("div");
    overlay.id = "clFormOverlay";
    overlay.className = "prestasi-form-overlay";
    overlay.innerHTML =
      '<div class="prestasi-form-box" style="max-height:92vh;overflow-y:auto">' +
      '<div class="form-head" style="display:flex;align-items:center;justify-content:space-between">' +
      '<span><i class="fa-solid fa-clock-rotate-left"></i> ' + (item ? "Ubah " + esc(item.version) : "Tambah Versi") + "</span>" +
      '<button class="icon-btn" onclick="Changelog.tutupForm()" title="Tutup"><i class="fa-solid fa-xmark"></i></button></div>' +
      (item ? "" :
      '<div class="field"><label>Jenis perubahan</label>' +
      '<span class="cl-seg" id="clTipeSeg">' +
      '<button type="button" data-t="patch" class="on" onclick="Changelog.pilihTipe(\'patch\')">Patch <small>(fix)</small></button>' +
      '<button type="button" data-t="minor" onclick="Changelog.pilihTipe(\'minor\')">Minor <small>(fitur)</small></button>' +
      '<button type="button" data-t="major" onclick="Changelog.pilihTipe(\'major\')">Major <small>(gede)</small></button>' +
      "</span></div>" +
      '<div class="cl-ver-preview">Versi baru: <b id="clVerPrev">…</b> <span>(otomatis)</span></div>') +
      '<div class="field" style="margin-top:8px"><label>Judul *</label>' +
      '<input type="text" id="clJudul" class="admin-input" placeholder="cth: Fitur Arsip Galeri" maxlength="80" value="' + esc(item ? item.title : "") + '"></div>' +
      '<div class="field"><label>Deskripsi * (1-2 kalimat buat user)</label>' +
      '<textarea id="clDeskripsi" class="admin-input admin-textarea" rows="3" maxlength="500" placeholder="cth: Semua dokumentasi kini terkumpul di satu halaman Arsip.">' + esc(item ? item.description : "") + "</textarea></div>" +
      '<div class="field"><label>Tanggal' + (item ? "" : " (default: hari ini)") + "</label>" +
      '<input type="date" id="clTanggal" class="admin-input" value="' + esc(item ? (item.date || "") : hariIni) + '"></div>' +
      '<div class="form-actions-row" style="margin-top:14px">' +
      '<button class="btn btn-white" onclick="Changelog.tutupForm()">Batal</button>' +
      '<button class="btn btn-red" id="btnSimpanCl" onclick="Changelog.simpanForm()"><i class="fa-solid fa-check"></i> Simpan</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { requestAnimationFrame(function () { overlay.classList.add("active"); }); });
    document.body.style.overflow = "hidden";
    overlay.addEventListener("click", function (e) { if (e.target === overlay) tutupForm(); });
    if (!item) refreshPrev();
  }

  function tutupForm() {
    document.getElementById("clFormOverlay")?.classList.remove("active");
    setTimeout(function () { document.getElementById("clFormOverlay")?.remove(); }, 220);
    document.body.style.overflow = "";
    editingId = null;
  }

  function pilihTipe(t) {
    tipeForm = t;
    document.querySelectorAll("#clTipeSeg button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === t); });
    refreshPrev();
  }

  function refreshPrev() {
    var el = document.getElementById("clVerPrev");
    if (el) el.textContent = versiBerikut(tipeForm) || "?";
  }

  function toast(msg, tipe) {
    if (typeof window.showToast === "function") window.showToast(msg, tipe || "success");
    else if (typeof showPopup === "function") showPopup(msg, tipe === "error" ? "error" : "success");
  }

  async function simpanForm() {
    var u = butuhKelola();
    if (!u) return;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
    var judul = g("clJudul"), deskripsi = g("clDeskripsi"), tanggal = g("clTanggal");
    if (!judul) { toast("Judul diisi dulu", "error"); return; }
    if (!deskripsi) { toast("Deskripsi diisi dulu", "error"); return; }
    var btn = document.getElementById("btnSimpanCl");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
    try {
      if (editingId) {
        await updateChangelog(u.id, editingId, { type: null, title: judul, description: deskripsi, date: tanggal || null });
        toast("Versi diperbarui!");
      } else {
        var versi = versiBerikut(tipeForm);
        if (!versi) { toast("Gagal hitung versi", "error"); return; }
        await buatChangelog(u.id, { versi: versi, tipe: tipeForm, judul: judul, deskripsi: deskripsi, date: tanggal || null });
        toast("Tayang sebagai " + versi + "!");
      }
      tutupForm();
      if (typeof Cache !== "undefined" && Cache.del) Cache.del("changelog");
      try { localStorage.removeItem("changelog_cache"); } catch (e) {}
      await muat(true);
    } catch (err) {
      console.error(err);
      var msg = String((err && err.message) || err);
      toast(msg.indexOf("-3") !== -1 ? "Versi sudah dipakai — refresh dulu" : msg, "error");
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
    }
  }

  async function hapus(id) {
    if (!butuhKelola()) return;
    var yakin = (typeof showPopup === "function") ? await showPopup("Hapus entri ini dari changelog?", "confirm") : true;
    if (!yakin) return;
    try {
      var u = OsisAuth.getUser();
      await hapusChangelog(u.id, id);
      toast("Entri dihapus");
      if (typeof Cache !== "undefined" && Cache.del) Cache.del("changelog");
      try { localStorage.removeItem("changelog_cache"); } catch (e) {}
      await muat(true);
    } catch (err) {
      console.error(err);
      toast(String((err && err.message) || err), "error");
    }
  }

  function terapkan(fresh) {
    semua = fresh;
    try { localStorage.setItem("changelog_cache", JSON.stringify(fresh)); } catch (e) {}
    var hero = document.getElementById("clVersi");
    if (hero && fresh.length) hero.textContent = fresh[0].version;
    render();
  }

  async function dariJson() {
    var res = await fetch("./changelog.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var j = await res.json();
    if (!Array.isArray(j) || !j.length) throw new Error("json kosong");
    return j;
  }

  async function muat(force) {
    var box = document.getElementById("clList");
    try {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem("changelog_cache") || "null"); } catch (e) {}
      if (Array.isArray(cached) && cached.length && !force) {
        semua = cached;
        render();
      } else if (!semua.length && box) {
        box.innerHTML = '<div class="cl-card"><div class="loading-block"><div class="spinner"></div>Memuat changelog...</div></div>';
      }
      // 1) DB dulu (publik, tanpa login). 2) fallback file JSON (precache offline).
      var fresh = null;
      try {
        if (typeof getChangelogList === "function") fresh = await getChangelogList();
      } catch (e1) { fresh = null; }
      if (!fresh || !fresh.length) fresh = await dariJson();
      if (fresh.length) terapkan(fresh);
    } catch (err) {
      if (!semua.length && box) {
        box.innerHTML = '<div class="cl-card"><div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat changelog. Cek koneksi lalu refresh.</div><div style="text-align:center;margin-top:8px"><button class="btn btn-red btn-sm" onclick="Changelog.muat(true)"><i class="fa-solid fa-rotate"></i> Coba lagi</button></div></div>';
      }
    }
  }

  window.Changelog = {
    muat: function (force) { muat(!!force); },
    filter: function (f) { saring = f; segarkanSeg(); render(); },
    bukaForm: bukaForm,
    tutupForm: tutupForm,
    pilihTipe: pilihTipe,
    simpanForm: simpanForm,
    hapus: hapus,
    init: function () {
      segarkanSeg();
      var q = document.getElementById("clCari");
      if (q) q.addEventListener("input", function () { cari = q.value.trim().toLowerCase(); render(); });
      muat(false);
      cekKelola();
      try {
        if (typeof OsisAuth !== "undefined" && OsisAuth.refreshAkses) {
          OsisAuth.refreshAkses().then(cekKelola).catch(function () {});
        }
      } catch (e) {}
    }
  };

  document.addEventListener("DOMContentLoaded", function () { window.Changelog.init(); });
})();
