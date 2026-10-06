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
    document.getElementById("btnNotifStatus")?.addEventListener("click", () => Notifikasi.cekStatus());
  },

  // Diagnostik: tanya Worker apakah secret VAPID kepasang + cocok dengan frontend.
  async cekStatus() {
    Notifikasi.hasil("Mengecek status server...", true);
    try {
      const s = await supa.auth.getSession();
      const token = (s && s.data && s.data.session && s.data.session.access_token) || "";
      if (!token) throw new Error("Sesi habis — login ulang dulu.");
      const base = String(typeof PUSH_KIRIM_URL === "string" ? PUSH_KIRIM_URL : "").replace(/\/push-kirim\/?$/, "");
      const kunci = typeof VAPID_PUBLIC_KEY === "string" ? VAPID_PUBLIC_KEY : "";
      const res = await fetch(base + "/push-status?k=" + encodeURIComponent(kunci), {
        headers: { Authorization: "Bearer " + token },
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error((b && b.error) || ("Server balas " + res.status));
      const sub = b.subscriber || {};
      const baris = [
        `VAPID public di server: ${b.vapid_public_ok ? "OK" : "RUSAK/HILANG"}`,
        `VAPID private di server: ${b.vapid_private_ok ? "OK" : "RUSAK/HILANG"}`,
        `Kunci frontend cocok dengan server: ${b.kunci_cocok_frontend === null ? "?" : b.kunci_cocok_frontend ? "YA" : "TIDAK — set ulang secret VAPID_PUBLIC + deploy"}`,
        `Subscriber: total ${sub.total || 0} (publik ${sub.publik || 0}, osis ${sub.osis || 0}, semua ${sub.semua || 0})`,
      ];
      Notifikasi.hasil(baris.join(" · "), b.vapid_public_ok && b.vapid_private_ok);
    } catch (e) {
      Notifikasi.hasil("Gagal cek status: " + (e && e.message ? e.message : e), false);
    }
  },

  hasil(msg, ok) {
    const el = document.getElementById("notifHasil");
    if (!el) return;
    el.className = ok ? "ok" : "err";
    el.textContent = msg;
  },

  // Terjemahkan rincian gagal dari Worker jadi petunjuk yang bisa ditindak.
  teksRincian(rincian) {
    if (!rincian || typeof rincian !== "object") return "";
    const keys = Object.keys(rincian);
    if (!keys.length) return "";
    const ART = {
      400: "payload ditolak push service (cek enkripsi Worker)",
      401: "VAPID tidak cocok — PUBLIC di secret Worker beda dengan di js/config.js, set ulang + deploy",
      403: "VAPID ditolak push service — cek secret + subject",
      404: "subscription basi (dibersihkan otomatis)",
      410: "subscription kadaluarsa (dibersihkan otomatis)",
      429: "rate limit push service — coba lagi nanti",
    };
    const bagian = keys.map((k) => {
      const n = rincian[k];
      if (String(k).startsWith("ERR:")) return `${k} ×${n} (error internal Worker)`;
      const art = ART[String(k)] || "push service menolak";
      return `${k} ×${n} (${art})`;
    });
    return " Rincian: " + bagian.join("; ") + ".";
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
          ? `Terkirim ke ${r.terkirim || 0} dari ${total} HP${r.gagal ? ` (${r.gagal} gagal)` : ""}${r.dibersihkan ? `, ${r.dibersihkan} basi dibersihkan.` : "."}${Notifikasi.teksRincian(r.rincian)}`
          : "Belum ada HP yang aktifkan notif di target ini. Minta buka web → Aktifkan Notif dulu.",
        (r.gagal || 0) === 0,
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
