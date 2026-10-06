// =========================================================================
// NOTIFIKASI — halaman khusus super_admin: bebas kirim notif apapun ke HP.
// Guard: wajib login OSIS + isSuper (pola sama kayak logs.js).
// Kirim: lewat PushNotif.kirimManual (Worker /push-kirim, flag only_super).
// =========================================================================

const Notifikasi = {
  terinisialisasi: false,

  init() {
    if (Notifikasi.terinisialisasi) return;
    Notifikasi.terinisialisasi = true;
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") {
      location.replace("../login");
      return;
    }
    if (typeof OsisAuth.refreshAkses === "function") {
      OsisAuth.refreshAkses()
        .then(() => Notifikasi.cekSuper())
        .catch(() => Notifikasi.cekSuper());
    } else {
      Notifikasi.cekSuper();
    }
  },

  cekSuper() {
    let superUser = false;
    try {
      superUser = typeof OsisAuth.isSuper === "function" && OsisAuth.isSuper();
    } catch {
      superUser = false;
    }
    if (!superUser) {
      document.getElementById("notifWrap").innerHTML =
        '<div class="notif-card" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-lock" style="color:var(--red)"></i></div><b>Halaman ini khusus super admin.</b></div>';
      return;
    }
    Notifikasi.pasang();
  },

  bacaForm() {
    const g = (id) => document.getElementById(id)?.value.trim() || "";
    let aud = "publik";
    try {
      aud = document.querySelector('input[name="notifAud"]:checked')?.value || "publik";
    } catch {}
    if (!["publik", "osis", "semua"].includes(aud)) aud = "publik";
    return { judul: g("notifJudul"), isi: g("notifIsi"), url: g("notifUrl") || "#/informasi", audience: aud };
  },

  pasang() {
    const judul = document.getElementById("notifJudul");
    const isi = document.getElementById("notifIsi");
    const url = document.getElementById("notifUrl");

    const renderPrev = () => {
      document.getElementById("prevJudul").textContent = judul.value.trim() || "Judul notif…";
      document.getElementById("prevIsi").textContent = isi.value.trim() || "Isi notif…";
      document.getElementById("hitungJudul").textContent = String(judul.value.length);
      document.getElementById("hitungIsi").textContent = String(isi.value.length);
    };
    judul.addEventListener("input", renderPrev);
    isi.addEventListener("input", renderPrev);
    renderPrev();

    document.querySelectorAll("#notifChips button").forEach((b) => {
      b.addEventListener("click", () => {
        url.value = b.dataset.url || "#/informasi";
        url.focus();
      });
    });

    document.querySelectorAll('#notifAud label').forEach((lab) => {
      lab.addEventListener("click", () => {
        document.querySelectorAll('#notifAud label').forEach((l) => l.classList.remove("pilih"));
        lab.classList.add("pilih");
      });
    });

    document.getElementById("btnNotifUji")?.addEventListener("click", () => Notifikasi.ujiLokal());
    document.getElementById("btnNotifKirim")?.addEventListener("click", () => Notifikasi.kirim());
  },

  hasil(msg, ok) {
    const el = document.getElementById("notifHasil");
    if (!el) return;
    el.className = ok ? "ok" : "err";
    el.textContent = msg;
  },

  // Tes lokal: notif hanya muncul di HP ini, tidak terkirim ke siapa-siapa.
  async ujiLokal() {
    const f = Notifikasi.bacaForm();
    if (!f.judul || !f.isi) {
      Notifikasi.hasil("Isi judul + isi dulu buat tes.", false);
      return;
    }
    try {
      if (!("Notification" in window)) throw new Error("Perangkat ini tidak dukung notifikasi.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Izin notif ditolak browser.");
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(f.judul.slice(0, 80), {
        body: f.isi.slice(0, 180),
        icon: "../icons/icon-192.png",
        badge: "../icons/favicon-32.png",
        tag: "tarpan-uji-" + Date.now(),
        data: { url: f.url },
      });
      Notifikasi.hasil("Tes terkirim ke HP ini. Cek shade notifikasi HP.", true);
    } catch (e) {
      Notifikasi.hasil("Gagal tes: " + (e && e.message ? e.message : e), false);
    }
  },

  tungguPush() {
    // push.js dimuat dinamis via pwa.js — tunggu sampai siap (maks ~8 detik).
    return new Promise((resolve, reject) => {
      if (window.PushNotif && window.PushNotif.kirimManual) return resolve(window.PushNotif);
      let n = 0;
      const t = setInterval(() => {
        n++;
        if (window.PushNotif && window.PushNotif.kirimManual) {
          clearInterval(t);
          resolve(window.PushNotif);
        } else if (n > 40) {
          clearInterval(t);
          reject(new Error("Modul push belum termuat, refresh halaman."));
        }
      }, 200);
    });
  },

  async kirim() {
    const f = Notifikasi.bacaForm();
    if (!f.judul || !f.isi) {
      Notifikasi.hasil("Judul + isi wajib diisi.", false);
      return;
    }
    let ok = true;
    try {
      ok = await showPopup(
        `Kirim "${f.judul.slice(0, 40)}" ke target ${f.audience.toUpperCase()}?`,
        "confirm",
      );
    } catch {
      ok = confirm("Kirim notifikasi?");
    }
    if (!ok) return;
    const btn = document.getElementById("btnNotifKirim");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';
    }
    Notifikasi.hasil("Mengirim ke HP subscriber...", true);
    try {
      const push = await Notifikasi.tungguPush();
      const r = await push.kirimManual({ ...f, only_super: true });
      const total = Number(r.total || 0);
      Notifikasi.hasil(
        total
          ? `Terkirim ke ${r.terkirim || 0} dari ${total} HP${r.gagal ? ` (${r.gagal} gagal)` : ""}${r.dibersihkan ? `, ${r.dibersihkan} basi dibersihkan.` : "."}`
          : "Belum ada HP yang aktifkan notif di target ini. Minta buka web → Aktifkan Notif dulu.",
        true,
      );
      try {
        if (typeof catatAksi === "function") catatAksi("push_broadcast", f.judul.slice(0, 60) + " [" + f.audience + "]");
      } catch {}
    } catch (e) {
      console.error(e);
      Notifikasi.hasil("Gagal kirim: " + (e && e.message ? e.message : e), false);
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim ke Semua Target';
    }
  },
};

document.addEventListener("DOMContentLoaded", () => Notifikasi.init());
