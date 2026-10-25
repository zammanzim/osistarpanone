// =========================================================================
// SW - OSIS TARPAN ONE (PWA)
// App shell precache + runtime cache. Aman untuk Supabase (API tidak di-cache).
// =========================================================================

const VERSI = "tarpan-v178";
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
  "./css/style.css",
  "./css/feed.css",
  "./css/osis2.css",
  "./css/osis-absensi.css",
  "./css/osis-agenda.css",
  "./css/osis-akses.css",
  "./css/osis-anggota.css",
  "./css/osis-dokumen.css",
  "./css/osis-index.css",
  "./css/osis-informasi.css",
  "./css/osis-keuangan.css",
  "./css/osis-logs.css",
  "./css/osis-notifikasi.css",
  "./css/osis-poster.css",
  "./css/osis-notulensi.css",
  "./css/osis-profil.css",
  "./css/osis-program-bulanan.css",
  "./css/osis-program-tahunan.css",
  "./css/osis-tabungan.css",
  "./css/osis-wawancara.css",
  "./css/hasil-wawancara.css",
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
  "./osis/users.html",
  "./osis/wawancara.html",
  "./osis/hasil-wawancara.html",
  "./js/supabase.min.js",
  "./js/config.js",
  "./js/compress-video.js",
  "./js/db.js",
  "./js/aktivitas.js",
  "./js/app.js",
  "./js/arsip.js",
  "./js/absensi.js",
  "./js/absensi-qr.js",
  "./js/absen-siswa.js",
  "./js/agenda.js",
  "./js/akses.js",
  "./js/anggota.js",
  "./js/aspirasi.js",
  "./js/bottomnav.js",
  "./js/changelog.js",
  "./js/context-menu.js",
  "./js/dashboard.js",
  "./js/dokumen.js",
  "./js/dropdown.js",
  "./js/evaluasi.js",
  "./js/form-persist.js",
  "./js/form-publik.js",
  "./js/formulir.js",
  "./js/feed.js",
  "./js/galeri.js",
  "./js/home.js",
  "./js/informasi.js",
  "./js/informasi-view.js",
  "./js/kegiatan.js",
  "./js/keuangan.js",
  "./js/lagu.js",
  "./js/login.js",
  "./js/logs.js",
  "./js/nav-atur.js",
  "./js/notice.js",
  "./js/notifikasi.js",
  "./js/notulensi.js",
  "./js/osis-auth.js",
  "./js/osis-header.js",
  "./js/osis-visitor.js",
  "./js/osis-menu.js",
  "./js/osis-sidebar.js",
  "./js/osis-users.js",
  "./js/polling.js",
  "./js/poster.js",
  "./js/prestasi.js",
  "./js/profil.js",
  "./js/proker.js",
  "./js/pwa.js",
  "./js/push.js",
  "./js/outbox.js",
  "./js/pengaturan.js",
  "./js/pengurus.js",
  "./js/program.js",
  "./js/sekbid.js",
  "./js/show-popup.js",
  "./js/site-edit.js",
  "./js/tabungan.js",
  "./js/task.js",
  "./js/toast.js",
  "./js/upload.js",
  "./js/visitor.js",
  "./js/wawancara.js",
  "./js/hasil-wawancara.js",
  "./js/vendor/jsQR.min.js",
  "./js/vendor/qrcode.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  // Catatan: JANGAN skipWaiting() di sini. SW baru wajib menunggu sampai
  // halaman memintanya via pesan SKIP_WAITING (js/pwa.js). skipWaiting
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

// Update instan saat ada deploy baru (dipanggil dari js/pwa.js).
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

// Background Sync (Chrome Android): bangunkan halaman biar Outbox kirim antrean.
// Sync utama tetap di foreground (event online + interval di js/outbox.js).
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
      icon: "./icons/icon-192.png",
      badge: "./icons/favicon-32.png",
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
