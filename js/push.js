// =========================================================================
// PUSH NOTIF — Web Push murni (VAPID) untuk PWA OSIS TARPAN ONE
// Subscribe 1x per HP/browser -> tersimpan di tabel push_subscriptions.
// Audience OTOMATIS dari login: 'osis' kalau login OSIS, 'publik' kalau
// belum login / akun biasa. Yang pilih target ('publik'/'osis'/'semua')
// hanya PENGIRIM (dashboard OSIS) saat kirim, bukan penerima.
// Kirim: via Worker POST PUSH_KIRIM_URL (JWT OSIS + hak).
// Include: otomatis dimuat dari js/pwa.js (muatPush). Aman tanpa SW.
// =========================================================================
(function () {
  "use strict";

  var LS_AUD = "push_audience";
  var LS_ON = "push_aktif";

  function toast(msg, tipe) {
    try {
      if (typeof window.showToast === "function") window.showToast(msg, tipe || "info");
    } catch {}
  }

  function didukung() {
    return (
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      typeof VAPID_PUBLIC_KEY === "string" &&
      VAPID_PUBLIC_KEY.length > 20
    );
  }

  function izin() {
    try {
      return Notification.permission || "default";
    } catch {
      return "default";
    }
  }

  // base64url -> Uint8Array (applicationServerKey)
  function kunciKeBytes(b64url) {
    var b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function b64DariBuf(buf) {
    var bytes = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function regAktif() {
    var reg = await navigator.serviceWorker.ready;
    return reg;
  }

  // Audience OTOMATIS dari status login — user tidak memilih.
  // Login OSIS (mode "osis") -> 'osis'. Selain itu (belum login / akun biasa) -> 'publik'.
  function audienceOtomatis() {
    try {
      var u = typeof OsisAuth !== "undefined" && OsisAuth.getUser ? OsisAuth.getUser() : null;
      if (u && u.mode === "osis") return "osis";
    } catch {}
    return "publik";
  }

  // Label mode buat ditampilkan di UI (baca simpanan terakhir).
  function audienceTersimpan() {
    try {
      var s = localStorage.getItem(LS_AUD) || "";
      if (s === "osis" || s === "publik") return s;
    } catch {}
    return audienceOtomatis();
  }

  function infoUser() {
    var key = "";
    try {
      if (typeof getVisitorKey === "function") key = getVisitorKey() || "";
      else if (typeof OsisAuth !== "undefined" && OsisAuth.getUser) {
        var u = OsisAuth.getUser();
        if (u && u.mode === "osis") key = "osis:" + (u.id || u.username || "");
        else if (u && u.mode === "biasa") key = "biasa:" + (u.id || u.username || "");
      }
    } catch {}
    var did = "";
    try {
      if (typeof getDeviceId === "function") did = getDeviceId() || "";
    } catch {}
    return { key: String(key || ""), did: String(did || "") };
  }

  async function simpanKeDB(sub) {
    try {
      var aud = audienceOtomatis();
      var info = infoUser();
      // getKey() sync -> ArrayBuffer langsung
      var rawP = sub.getKey("p256dh");
      var rawA = sub.getKey("auth");
      var p256dh = b64DariBuf(rawP);
      var auth = b64DariBuf(rawA);
      var r = await supa.rpc("simpan_push_sub", {
        p_endpoint: sub.endpoint,
        p_p256dh: p256dh,
        p_auth: auth,
        p_audience: aud,
        p_user_key: info.key,
        p_device_id: info.did,
      });
      if (r.error) throw r.error;
      if (r.data && r.data !== "OK") throw new Error(r.data);
      try {
        localStorage.setItem(LS_AUD, aud);
        localStorage.setItem(LS_ON, "1");
      } catch {}
    } catch (e) {
      console.warn("simpan_push_sub gagal", e);
      throw e;
    }
  }

  async function status() {
    if (!didukung()) return "tak-dukung";
    if (izin() === "denied") return "diblokir";
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      return sub ? "aktif" : "mati";
    } catch {
      return "mati";
    }
  }

  // Aktifkan: minta izin -> subscribe -> simpan ke Supabase.
  // Audience otomatis dari login (osis = pengurus, publik = sisanya).
  async function aktifkan() {
    if (!didukung()) {
      // iOS Safari biasa (bukan PWA ter-install) masuk sini.
      toast("Perangkat ini belum dukung push. Di iPhone: Install dulu via Bagikan → Tambah ke Layar Utama.", "error");
      return false;
    }
    var perm = await Notification.requestPermission();
    if (perm !== "granted") {
      toast("Izin notif ditolak. Aktifkan manual di Pengaturan browser/HP.", "error");
      return false;
    }
    try {
      var reg = await regAktif();
      var lama = await reg.pushManager.getSubscription();
      var sub =
        lama ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: kunciKeBytes(VAPID_PUBLIC_KEY),
        }));
      await simpanKeDB(sub);
      toast(
        audienceOtomatis() === "osis"
          ? "Notifikasi HP aktif (mode OSIS — info internal)!"
          : "Notifikasi HP aktif (info umum)!",
      );
      refreshTombol();
      return true;
    } catch (e) {
      console.error(e);
      toast("Gagal aktifkan: " + (e && e.message ? e.message : e), "error");
      return false;
    }
  }

  async function matikan() {
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      var ep = sub ? sub.endpoint : "";
      if (sub) await sub.unsubscribe().catch(function () {});
      if (ep) {
        try {
          await supa.rpc("hapus_push_sub", { p_endpoint: ep });
        } catch {}
      }
      try {
        localStorage.removeItem(LS_ON);
        localStorage.removeItem(LS_AUD);
      } catch {}
      toast("Notifikasi dimatikan.", "info");
      refreshTombol();
      return true;
    } catch (e) {
      toast("Gagal mematikan: " + (e && e.message ? e.message : e), "error");
      return false;
    }
  }

  // Dipanggil dari dashboard OSIS: judul + isi + url + target.
  // url: hash-route publik mis. "#/informasi" atau path "polling" / "osis/informasi?id=3".
  async function kirimManual(o) {
    o = o || {};
    var judul = String(o.judul || "").trim().slice(0, 80);
    var isi = String(o.isi || "").trim().slice(0, 180);
    var url = String(o.url || "#/informasi").trim().slice(0, 300);
    var audience = o.audience === "osis" || o.audience === "semua" ? o.audience : "publik";
    if (!judul || !isi) throw new Error("Judul + isi wajib diisi.");
    var token = "";
    try {
      var s = await supa.auth.getSession();
      token = (s && s.data && s.data.session && s.data.session.access_token) || "";
    } catch {}
    if (!token) throw new Error("Sesi habis — login ulang dulu.");
    var res = await fetch(PUSH_KIRIM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ judul: judul, isi: isi, url: url, audience: audience }),
    });
    var body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) throw new Error((body && body.error) || ("Gagal kirim (" + res.status + ")"));
    return body || { ok: true };
  }

  // ---- Tombol lonceng: desktop pill + item titik-tiga (mobile) ----
  var tombol = null;
  var itemMenu = null;

  function pasangCss() {
    if (document.getElementById("pushBellCss")) return;
    var st = document.createElement("style");
    st.id = "pushBellCss";
    st.textContent =
      "#pushBellBtn{display:none;align-items:center;gap:6px;padding:8px 14px;" +
      "border:2.5px solid var(--ink,#1a1314);border-radius:999px;background:var(--white,#fff);" +
      "font-family:inherit;font-size:.78rem;font-weight:800;color:var(--ink,#1a1314);cursor:pointer;" +
      "box-shadow:2px 2px 0 var(--ink,#1a1314);white-space:nowrap}" +
      "#pushBellBtn i{color:var(--red,#e11d2e)}" +
      "#pushBellBtn.on{background:#def5e3}" +
      "@media (max-width:700px){#pushBellBtn{display:none!important}}" +
      "#headerMorePush i{color:var(--red,#e11d2e)}";
    try {
      document.head.appendChild(st);
    } catch {}
  }

  function labelTombol(st) {
    if (st === "aktif") return '<i class="fa-solid fa-bell"></i><span>Notif Aktif</span>';
    if (st === "diblokir") return '<i class="fa-solid fa-bell-slash"></i><span>Notif Diblokir</span>';
    return '<i class="fa-solid fa-bell"></i><span>Aktifkan Notif</span>';
  }

  // Mode tampil: ikut status login saat ini (osis = pengurus, publik = sisanya).
  function labelMode() {
    return audienceOtomatis() === "osis" ? "OSIS (info internal)" : "Publik (info umum)";
  }

  async function klikToggle() {
    var st = await status();
    if (st === "tak-dukung") {
      toast("Perangkat ini belum dukung push.", "error");
      return;
    }
    if (st === "diblokir") {
      toast("Notifikasi diblokir browser. Buka Pengaturan situs → Izin → Notifikasi → Izinkan.", "error");
      return;
    }
    if (st === "aktif") {
      pilihAksi();
      return;
    }
    // Konfirmasi sekali, tanpa pilihan target (otomatis dari login).
    var tanya = "Aktifkan notif " + labelMode() + " di HP ini?";
    if (typeof window.showPopup === "function") {
      window.showPopup(tanya, "confirm").then(function (ok) {
        if (ok) aktifkan();
      });
    } else if (confirm(tanya)) aktifkan();
  }

  function pilihAksi() {
    var overlay = document.createElement("div");
    overlay.className = "prestasi-form-overlay";
    overlay.innerHTML =
      '<div class="prestasi-form-box" style="max-width:360px">' +
      '<div class="form-head"><span><i class="fa-solid fa-bell"></i> Notif Aktif</span></div>' +
      '<p style="font-size:.82rem;font-weight:600;color:var(--gray)">HP ini terdaftar sebagai: <b>' + labelMode() + "</b> (otomatis dari akun).</p>" +
      '<div class="form-actions-row" style="margin-top:12px;flex-wrap:wrap;gap:8px">' +
      '<button class="btn btn-white" id="pushAksiMati"><i class="fa-solid fa-bell-slash"></i> Matikan</button>' +
      '<button class="btn btn-red" id="pushAksiTutup">Tutup</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add("active");
      });
    });
    function tutup() {
      overlay.classList.remove("active");
      setTimeout(function () {
        overlay.remove();
      }, 200);
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) tutup();
    });
    overlay.querySelector("#pushAksiTutup").addEventListener("click", tutup);
    overlay.querySelector("#pushAksiMati").addEventListener("click", function () {
      tutup();
      matikan();
    });
  }

  function buatTombol() {
    if (tombol || itemMenu || !didukung()) return;
    pasangCss();
    var menu = document.getElementById("headerMoreMenu");
    if (menu && !document.getElementById("headerMorePush")) {
      itemMenu = document.createElement("button");
      itemMenu.type = "button";
      itemMenu.id = "headerMorePush";
      itemMenu.className = "header-more-item";
      itemMenu.innerHTML = '<i class="fa-solid fa-bell"></i> Notifikasi HP';
      itemMenu.addEventListener("click", function () {
        try {
          if (window.HeaderMore && HeaderMore.close) HeaderMore.close();
        } catch {}
        klikToggle();
      });
      menu.appendChild(itemMenu);
    }
    var extra = document.querySelector(".top-nav-extra");
    if (extra && !document.getElementById("pushBellBtn")) {
      tombol = document.createElement("button");
      tombol.id = "pushBellBtn";
      tombol.type = "button";
      tombol.innerHTML = labelTombol("mati");
      tombol.setAttribute("aria-label", "Aktifkan notifikasi HP");
      tombol.addEventListener("click", klikToggle);
      try {
        var wrap = document.getElementById("headerMoreWrap");
        if (wrap && wrap.parentNode === extra) extra.insertBefore(tombol, wrap);
        else extra.appendChild(tombol);
      } catch {
        try {
          extra.appendChild(tombol);
        } catch {}
      }
    }
    refreshTombol();
    try {
      if (window.HeaderMore && HeaderMore.refresh) HeaderMore.refresh();
    } catch {}
  }

  async function refreshTombol() {
    var st = "mati";
    try {
      st = await status();
    } catch {}
    if (tombol) {
      tombol.style.display = "inline-flex";
      tombol.innerHTML = labelTombol(st);
      tombol.classList.toggle("on", st === "aktif");
      tombol.title =
        st === "aktif"
          ? "Notifikasi HP aktif — klik untuk atur"
          : st === "diblokir"
            ? "Notifikasi diblokir browser"
            : "Aktifkan notifikasi ke HP";
    }
    if (itemMenu) {
      itemMenu.style.display = "";
      itemMenu.innerHTML =
        st === "aktif"
          ? '<i class="fa-solid fa-bell"></i> Notif HP: Aktif'
          : '<i class="fa-solid fa-bell"></i> Aktifkan Notif HP';
    }
    try {
      if (window.HeaderMore && HeaderMore.refresh) HeaderMore.refresh();
    } catch {}
  }

  // ---- Form kirim manual (dashboard OSIS) ----
  // prefill: { judul, isi, url, audience }
  function bukaFormKirim(prefill) {
    prefill = prefill || {};
    try {
      var u = typeof OsisAuth !== "undefined" && OsisAuth.getUser ? OsisAuth.getUser() : null;
      if (!u || u.mode !== "osis") {
        toast("Hanya OSIS yang bisa kirim notif.", "error");
        return;
      }
    } catch {
      return;
    }
    document.getElementById("pushKirimOverlay")?.remove();
    var esc = function (s) {
      if (typeof window.escapeHtml === "function") return window.escapeHtml(s);
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    };
    var overlay = document.createElement("div");
    overlay.id = "pushKirimOverlay";
    overlay.className = "prestasi-form-overlay";
    overlay.innerHTML =
      '<div class="prestasi-form-box" style="max-width:420px">' +
      '<div class="form-head" style="display:flex;align-items:center;justify-content:space-between">' +
      "<span><i class=\"fa-solid fa-paper-plane\"></i> Kirim Notif ke HP</span>" +
      '<button class="icon-btn" id="pushKirimTutup" title="Tutup"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="field"><label>Judul * (maks 80)</label>' +
      '<input type="text" id="pushJudul" class="admin-input" maxlength="80" placeholder="cth: Info baru: Makrab OSIS 2026" value="' + esc(prefill.judul || "") + '"></div>' +
      '<div class="field"><label>Isi * (maks 180)</label>' +
      '<textarea id="pushIsi" class="admin-input admin-textarea" rows="3" maxlength="180" placeholder="cth: Jadwal + tempat kumpul sudah terbit. Cek infonya!">' + esc(prefill.isi || "") + "</textarea></div>" +
      '<div class="field"><label>Buka halaman apa saat diklik?</label>' +
      '<input type="text" id="pushUrl" class="admin-input" maxlength="300" placeholder="#/informasi" value="' + esc(prefill.url || "#/informasi") + '">' +
      '<small style="font-size:.7rem;color:var(--gray)">cth: <b>#/informasi</b>, <b>#/galeri</b>, <b>polling</b>, <b>osis/informasi?id=3</b></small></div>' +
      '<div class="field"><label>Target penerima</label>' +
      '<select id="pushAud" class="admin-input">' +
      '<option value="publik"' + ((prefill.audience || "publik") === "publik" ? " selected" : "") + '>Publik — semua pengunjung</option>' +
      '<option value="osis"' + (prefill.audience === "osis" ? " selected" : "") + '>OSIS — internal pengurus saja</option>' +
      '<option value="semua"' + (prefill.audience === "semua" ? " selected" : "") + '>Semua</option>' +
      "</select></div>" +
      '<div id="pushKirimHasil" style="font-size:.76rem;font-weight:700;color:var(--gray)"></div>' +
      '<div class="form-actions-row" style="margin-top:12px">' +
      '<button class="btn btn-white" id="pushKirimBatal">Batal</button>' +
      '<button class="btn btn-red" id="pushKirimOk"><i class="fa-solid fa-paper-plane"></i> Kirim</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add("active");
      });
    });
    try {
      document.body.style.overflow = "hidden";
    } catch {}
    function tutup() {
      overlay.classList.remove("active");
      try {
        document.body.style.overflow = "";
      } catch {}
      setTimeout(function () {
        overlay.remove();
      }, 200);
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) tutup();
    });
    overlay.querySelector("#pushKirimTutup").addEventListener("click", tutup);
    overlay.querySelector("#pushKirimBatal").addEventListener("click", tutup);
    overlay.querySelector("#pushKirimOk").addEventListener("click", async function () {
      var btn = overlay.querySelector("#pushKirimOk");
      var hasil = overlay.querySelector("#pushKirimHasil");
      var judul = overlay.querySelector("#pushJudul").value.trim();
      var isi = overlay.querySelector("#pushIsi").value.trim();
      var urlV = overlay.querySelector("#pushUrl").value.trim() || "#/informasi";
      var aud = overlay.querySelector("#pushAud").value || "publik";
      if (!judul || !isi) {
        toast("Judul + isi wajib diisi.", "error");
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';
      hasil.textContent = "Mengirim ke HP subscriber...";
      try {
        var r = await kirimManual({ judul: judul, isi: isi, url: urlV, audience: aud });
        var total = Number(r.total || 0);
        hasil.textContent = total
          ? ("Terkirim ke " + (r.terkirim || 0) + " dari " + total + " HP" + (r.gagal ? (" (" + r.gagal + " gagal)") : "") + (r.dibersihkan ? ", " + r.dibersihkan + " basi dibersihkan." : "."))
          : "Belum ada HP yang aktifkan notif. Minta buka web → Aktifkan Notif dulu.";
        toast("Selesai mengirim notif!");
        try {
          if (typeof catatAksi === "function") catatAksi("push_kirim", judul.slice(0, 60) + " [" + aud + "]");
        } catch {}
      } catch (e) {
        hasil.textContent = "";
        toast("Gagal kirim: " + (e && e.message ? e.message : e), "error");
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim';
      }
    });
  }

  // Sisipkan tombol "Kirim Notif" di halaman OSIS (kalau ada hak + login).
  // Dipanggil berkala karena tombol tambah (btnTambah) muncul setelah cek hak async.
  function suntikTombolKirim() {
    try {
      var u = typeof OsisAuth !== "undefined" && OsisAuth.getUser ? OsisAuth.getUser() : null;
      if (!u || u.mode !== "osis") return;
      var boleh = false;
      try {
        boleh = typeof OsisAuth.bisa === "function" ? !!OsisAuth.bisa("informasi") : false;
        if (!boleh && typeof OsisAuth.isSuper === "function" && OsisAuth.isSuper()) boleh = true;
      } catch {
        boleh = false;
      }
      if (!boleh) return;
      // 1) Halaman osis/informasi (hero, sebelah btnTambahInfo)
      var ref1 = document.getElementById("btnTambahInfo");
      if (ref1 && !document.getElementById("btnKirimPush")) {
        var b1 = document.createElement("button");
        b1.id = "btnKirimPush";
        b1.className = ref1.className || "btn btn-white";
        b1.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Notif';
        b1.addEventListener("click", function () {
          bukaFormKirim({ url: "osis/informasi" });
        });
        ref1.parentNode.insertBefore(b1, ref1.nextSibling);
      }
      // 2) View publik #/informasi (sebelah btnInfvTambah)
      var ref2 = document.getElementById("btnInfvTambah");
      if (ref2 && !document.getElementById("btnInfvKirimPush")) {
        var b2 = document.createElement("button");
        b2.id = "btnInfvKirimPush";
        b2.type = "button";
        b2.className = "btn btn-white btn-sm";
        b2.style.display = ref2.style.display;
        b2.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Notif';
        b2.title = "Kirim notif ke HP";
        b2.addEventListener("click", function () {
          var kunci = "";
          try {
            kunci = String(location.hash || "");
            var m = kunci.match(/[?&]id=([^&]+)/);
            var id = m ? decodeURIComponent(m[1]) : "";
            bukaFormKirim({ url: id ? "#/informasi?id=" + id : "#/informasi", audience: "publik" });
          } catch {
            bukaFormKirim({ url: "#/informasi", audience: "publik" });
          }
        });
        ref2.parentNode.insertBefore(b2, ref2.nextSibling);
        // Ikuti visibilitas tombol tambah (muncul setelah cek hak).
        new MutationObserver(function () {
          try {
            b2.style.display = ref2.style.display;
          } catch {}
        }).observe(ref2, { attributes: true, attributeFilter: ["style"] });
      }
    } catch {}
  }

  function init() {
    if (!didukung()) return;
    function siap(fn) {
      if (document.readyState === "complete" || document.readyState === "interactive") fn();
      else document.addEventListener("DOMContentLoaded", fn);
    }
    siap(function () {
      buatTombol();
      suntikTombolKirim();
      setTimeout(suntikTombolKirim, 1500);
      setTimeout(suntikTombolKirim, 4000);
      // Sinkron ulang diam-diam: kalau subscription masih ada tapi baris DB
      // kehapus (mis. DB reset) ATAU status login berubah (baru login OSIS /
      // baru logout), upsert lagi biar audience selalu ikut akun saat ini.
      (async function () {
        try {
          var reg = await navigator.serviceWorker.ready;
          var sub = await reg.pushManager.getSubscription();
          if (!sub) return;
          try {
            var perlu = false;
            try {
              perlu =
                !localStorage.getItem(LS_ON) ||
                (localStorage.getItem(LS_AUD) || "") !== audienceOtomatis();
            } catch {
              perlu = true;
            }
            if (perlu) await simpanKeDB(sub);
          } catch {}
        } catch {}
      })();
    });
  }

  window.PushNotif = {
    didukung: didukung,
    status: status,
    aktifkan: aktifkan,
    matikan: matikan,
    kirimManual: kirimManual,
    bukaFormKirim: bukaFormKirim,
    refreshTombol: refreshTombol,
  };

  init();
})();
