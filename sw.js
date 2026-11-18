// =========================================================================
// SW - OSIS TARPAN ONE (PWA)
// App shell precache + runtime cache. Aman untuk Supabase (API tidak di-cache).
// =========================================================================

const VERSI = "tarpan-v218";
const STATIS = VERSI + "-statis";
const RUNTIME = VERSI + "-runtime";

// App shell - SEMUA halaman + script lokal di-precache biar offline-ready
// sejak kunjungan pertama (tidak tergantung runtime cache yang bisa kehapus
// saat update versi). API Supabase tetap network-only (lihat fetch handler).
const APP_SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./polling.html",
  "./absen.html",
  "./changelog.html",
  "./hasil-wawancara.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./assets/css/shared/style.css",
  "./assets/css/public/feed.css",
  "./assets/css/shared/osis2.css",
  "./assets/css/osis/absensi.css",
  "./assets/css/osis/agenda.css",
  "./assets/css/osis/akses.css",
  "./assets/css/osis/anggota.css",
  "./assets/css/osis/dokumen.css",
  "./assets/css/osis/index.css",
  "./assets/css/osis/informasi.css",
  "./assets/css/osis/keuangan.css",
  "./assets/css/osis/logs.css",
  "./assets/css/osis/notifikasi.css",
  "./assets/css/osis/poster.css",
  "./assets/css/osis/notulensi.css",
  "./assets/css/osis/profil.css",
  "./assets/css/osis/program-bulanan.css",
  "./assets/css/osis/program-tahunan.css",
  "./assets/css/osis/tabungan.css",
  "./assets/css/osis/tes.css",
  "./assets/css/osis/uang-kas.css",
  "./assets/css/osis/wawancara.css",
  "./assets/css/public/hasil-wawancara.css",
  "./assets/css/public/login.css",
  "./osis/absensi.html",
  "./osis/agenda.html",
  "./osis/akses.html",
  "./osis/anggota.html",
  "./osis/dokumen.html",
  "./osis/program-bulanan.html",
  "./osis/program-tahunan.html",
  "./osis/index.html",
  "./osis/informasi.html",
  "./osis/keuangan.html",
  "./osis/logs.html",
  "./osis/notifikasi.html",
  "./osis/notulensi.html",
  "./osis/poster.html",
  "./osis/profil.html",
  "./osis/tabungan.html",
  "./osis/tes.html",
  "./osis/uang-kas.html",
  "./osis/users.html",
  "./osis/wawancara.html",
  "./osis/hasil-wawancara.html",
  "./assets/js/vendor/supabase.min.js",
  "./assets/js/core/config.js",
  "./assets/js/services/compress-video.js",
  "./assets/js/core/db.js",
  "./assets/js/services/aktivitas.js",
  "./assets/js/core/app.js",
  "./assets/js/public/arsip.js",
  "./assets/js/osis/modules/absensi.js",
  "./assets/js/osis/modules/absensi-qr.js",
  "./assets/js/public/absen-siswa.js",
  "./assets/js/osis/modules/agenda.js",
  "./assets/js/osis/modules/akses.js",
  "./assets/js/osis/modules/anggota.js",
  "./assets/js/public/aspirasi.js",
  "./assets/js/shared/ui/bottomnav.js",
  "./assets/js/public/changelog.js",
  "./assets/js/shared/ui/context-menu.js",
  "./assets/js/osis/shell/dashboard.js",
  "./assets/js/osis/modules/dokumen.js",
  "./assets/js/shared/ui/dropdown.js",
  "./assets/js/features/evaluasi.js",
  "./assets/js/shared/utilities/form-persist.js",
  "./assets/js/features/form-publik.js",
  "./assets/js/features/formulir.js",
  "./assets/js/public/feed.js",
  "./assets/js/public/galeri.js",
  "./assets/js/public/home.js",
  "./assets/js/osis/modules/informasi.js",
  "./assets/js/public/informasi-view.js",
  "./assets/js/public/kegiatan.js",
  "./assets/js/osis/modules/keuangan.js",
  "./assets/js/public/lagu.js",
  "./assets/js/core/login.js",
  "./assets/js/osis/modules/logs.js",
  "./assets/js/shared/ui/nav-atur.js",
  "./assets/js/shared/ui/notice.js",
  "./assets/js/osis/modules/notifikasi.js",
  "./assets/js/osis/modules/notulensi.js",
  "./assets/js/core/osis-auth.js",
  "./assets/js/osis/shell/osis-header.js",
  "./assets/js/osis/shell/osis-visitor.js",
  "./assets/js/features/osis-menu.js",
  "./assets/js/osis/shell/osis-sidebar.js",
  "./assets/js/osis/modules/osis-users.js",
  "./assets/js/public/polling.js",
  "./assets/js/osis/modules/poster.js",
  "./assets/js/public/prestasi.js",
  "./assets/js/osis/modules/profil.js",
  "./assets/js/features/proker.js",
  "./assets/js/pwa/pwa.js",
  "./assets/js/pwa/push.js",
  "./assets/js/pwa/outbox.js",
  "./assets/js/shared/utilities/pengaturan.js",
  "./assets/js/public/pengurus.js",
  "./assets/js/osis/modules/program.js",
  "./assets/js/public/sekbid.js",
  "./assets/js/shared/ui/show-popup.js",
  "./assets/js/shared/utilities/site-edit.js",
  "./assets/js/osis/modules/tabungan.js",
  "./assets/js/features/task.js",
  "./assets/js/osis/modules/tes.js",
  "./assets/js/shared/ui/toast.js",
  "./assets/js/osis/modules/uang-kas.js",
  "./assets/js/services/upload.js",
  "./assets/js/services/visitor.js",
  "./assets/js/osis/modules/wawancara.js",
  "./assets/js/public/hasil-wawancara.js",
  "./assets/js/vendor/jsQR.min.js",
  "./assets/js/vendor/qrcode.min.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-512-maskable.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  // Catatan: JANGAN skipWaiting() di sini. SW baru wajib menunggu sampai
  // halaman memintanya via pesan SKIP_WAITING (assets/js/pwa/pwa.js). skipWaiting
  // otomatis = take-over tiba-tiba + controllerchange + reload sendiri.
  e.waitUntil(caches.open(STATIS).then((c) => c.addAll(APP_SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) => k.startsWith("tarpan-") && k !== STATIS && k !== RUNTIME,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Update instan saat ada deploy baru (dipanggil dari assets/js/pwa/pwa.js).
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

// Background Sync (Chrome Android): bangunkan halaman biar Outbox kirim antrean.
// Sync utama tetap di foreground (event online + interval di assets/js/pwa/outbox.js).
self.addEventListener("sync", (e) => {
  if (e.tag === "osis-outbox") {
    e.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((daftar) => {
        daftar.forEach((c) => {
          try {
            c.postMessage("OUTBOX_SYNC");
          } catch {}
        });
      }),
    );
  }
});

// Web Push: tampilkan notif dari server (Worker /push-kirim) walau web tertutup.
// Payload: { judul, isi, url, tag }. Klik = buka URL target di tab/app.
self.addEventListener("push", (e) => {
  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    try {
      data = { isi: e.data ? e.data.text() : "" };
    } catch {
      data = {};
    }
  }
  var judul = String(data.judul || "OSIS TARPAN ONE").slice(0, 80);
  var isi = String(data.isi || data.body || "Ada info baru.").slice(0, 180);
  var url = String(data.url || "./#/informasi").slice(0, 300);
  var tag = String(data.tag || "tarpan-" + Date.now()).slice(0, 80);
  e.waitUntil(
    self.registration.showNotification(judul, {
      body: isi,
      icon: "./assets/icons/icon-192.png",
      badge: "./assets/icons/favicon-32.png",
      tag: tag,
      renotify: false,
      requireInteraction: false,
      data: { url: url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "./#/informasi";
  // Samakan dengan scope SW (subpath /osis/ vs root).
  var jadi = target;
  try {
    jadi = new URL(target, self.location.href).href;
  } catch {
    jadi = self.location.origin + "/";
  }
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((daftar) => {
      for (var i = 0; i < daftar.length; i++) {
        try {
          // Fokuskan tab yang sudah buka app, lalu arahkan ke target.
          daftar[i].navigate(jadi);
          return daftar[i].focus();
        } catch {}
      }
      return self.clients.openWindow(jadi);
    }),
  );
});

// Jangan cache API/auth Supabase - selalu network (data live + milik localStorage SWR).
function apiJanganCache(url) {
  return (
    url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/auth/v1/") ||
    url.pathname.includes("/realtime/v1/")
  );
}

// Stale-while-revalidate: sajikan cache dulu, update di background.
// Saat fetch gagal (offline): fallback cache persis, lalu cache tanpa
// query (?v=7) biar URL berversion tetap ketemu precache.
async function basiDulu(request, namaCache) {
  // Precache (STATIS) juga ikut dicek, supaya aset yang sudah di-precache
  // tetap ke-serve saat RUNTIME kosong (mis. setelah update SW).
  const daftarCache = namaCache === STATIS ? [STATIS] : [namaCache, STATIS];
  const cacheUtama = await caches.open(namaCache);
  let cached = null;
  for (const nama of daftarCache) {
    const c = await caches.open(nama);
    const m = await c.match(request, { ignoreSearch: false });
    if (m) { cached = m; break; }
  }
  const ambil = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque"))
        cacheUtama.put(request, res.clone());
      return res;
    })
    .catch(async () => {
      if (cached) return cached;
      if (new URL(request.url).origin === self.location.origin) {
        for (const nama of daftarCache) {
          const c = await caches.open(nama);
          const tanpaQuery = await c.match(request, { ignoreSearch: true });
          if (tanpaQuery) return tanpaQuery;
        }
      }
      throw new Error("offline");
    });
  return cached || ambil;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 1) Navigasi halaman (termasuk hash-route SPA) - network dulu, fallback cache/offline.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(RUNTIME);
          cache.put(req, res.clone());
          return res;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          // SPA: rute hash (#/sekbid dsb) tetap dilayani index.html dari cache.
          if (url.origin === self.location.origin) {
            const shell =
              (await caches.match("./index.html")) ||
              (await caches.match("./"));
            if (shell) return shell;
          }
          return caches.match("./offline.html");
        }
      })(),
    );
    return;
  }

  // 2) API Supabase - network only (fallback: error, jangan sajikan basi).
  if (url.hostname.endsWith("supabase.co") && apiJanganCache(url)) return;

  // 3) Aset lokal (css/js/gambar/manifest/icons) - stale-while-revalidate.
  if (url.origin === self.location.origin) {
    e.respondWith(basiDulu(req, RUNTIME));
    return;
  }

  // 4) Lintas origin: CDN (fonts, cdnjs, jsdelivr) + media R2
  // (custom domain, mis. media.osistarpanone.my.id) + sisa foto Supabase
  // lama selama masa transisi - SWR + fallback cache.
  e.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque"))
          cache.put(req, res.clone());
        return res;
      } catch {
        if (cached) return cached;
        // Gambar gagal total saat offline - kembalikan placeholder SVG ringan.
        if (req.destination === "image") {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#f5efea"/><text x="50%" y="50%" font-family="sans-serif" font-size="28" fill="#6f6668" text-anchor="middle">Offline</text></svg>',
            { headers: { "Content-Type": "image/svg+xml" } },
          );
        }
        throw new Error("offline");
      }
    })(),
  );
});
