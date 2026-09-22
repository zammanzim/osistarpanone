// =========================================================================
// SW - OSIS TARPAN ONE (PWA)
// App shell precache + runtime cache. Aman untuk Supabase (API tidak di-cache).
// =========================================================================

const VERSI = "tarpan-v11";
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
  "./offline.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./osis/absensi.html",
  "./osis/agenda.html",
  "./osis/akses.html",
  "./osis/dokumen.html",
  "./osis/index.html",
  "./osis/keuangan.html",
  "./osis/poster.html",
  "./osis/tabungan.html",
  "./osisbin/agenda.html",
  "./osisbin/anggota.html",
  "./osisbin/dokumen.html",
  "./osisbin/evaluasi.html",
  "./osisbin/form.html",
  "./osisbin/formulir.html",
  "./osisbin/index.html",
  "./osisbin/keuangan.html",
  "./osisbin/notulensi.html",
  "./osisbin/profil.html",
  "./osisbin/proker.html",
  "./osisbin/task.html",
  "./js/supabase.min.js",
  "./js/config.js",
  "./js/db.js",
  "./js/app.js",
  "./js/absensi.js",
  "./js/agenda.js",
  "./js/akses.js",
  "./js/anggota.js",
  "./js/aspirasi.js",
  "./js/dashboard.js",
  "./js/dokumen.js",
  "./js/evaluasi.js",
  "./js/form-persist.js",
  "./js/form-publik.js",
  "./js/formulir.js",
  "./js/galeri.js",
  "./js/home.js",
  "./js/kegiatan.js",
  "./js/keuangan.js",
  "./js/lagu.js",
  "./js/login.js",
  "./js/notulensi.js",
  "./js/osis-auth.js",
  "./js/osis-menu.js",
  "./js/osis-sidebar.js",
  "./js/polling.js",
  "./js/poster.js",
  "./js/prestasi.js",
  "./js/profil.js",
  "./js/proker.js",
  "./js/pwa.js",
  "./js/outbox.js",
  "./js/sekbid.js",
  "./js/show-popup.js",
  "./js/site-edit.js",
  "./js/tabungan.js",
  "./js/task.js",
  "./js/toast.js",
  "./js/visitor.js",
  "./jsbin/agenda.js",
  "./jsbin/anggota.js",
  "./jsbin/app.js",
  "./jsbin/aspirasi.js",
  "./jsbin/config.js",
  "./jsbin/dashboard.js",
  "./jsbin/db.js",
  "./jsbin/dokumen.js",
  "./jsbin/evaluasi.js",
  "./jsbin/form-publik.js",
  "./jsbin/formulir.js",
  "./jsbin/galeri.js",
  "./jsbin/home.js",
  "./jsbin/kegiatan.js",
  "./jsbin/keuangan.js",
  "./jsbin/lagu.js",
  "./jsbin/login.js",
  "./jsbin/notulensi.js",
  "./jsbin/osis-auth.js",
  "./jsbin/osis-menu.js",
  "./jsbin/osis-sidebar.js",
  "./jsbin/prestasi.js",
  "./jsbin/profil.js",
  "./jsbin/proker.js",
  "./jsbin/pwa.js",
  "./jsbin/sekbid.js",
  "./jsbin/show-popup.js",
  "./jsbin/site-edit.js",
  "./jsbin/task.js",
  "./jsbin/toast.js",
  "./jsbin/visitor.js",
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
  const cache = await caches.open(namaCache);
  const cached = await cache.match(request, { ignoreSearch: false });
  const ambil = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque"))
        cache.put(request, res.clone());
      return res;
    })
    .catch(async () => {
      if (cached) return cached;
      if (new URL(request.url).origin === self.location.origin) {
        const tanpaQuery = await cache.match(request, {
          ignoreSearch: true,
        });
        if (tanpaQuery) return tanpaQuery;
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

  // 4) Lintas origin: CDN (fonts, cdnjs, jsdelivr) + foto Supabase storage - SWR + fallback cache.
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
