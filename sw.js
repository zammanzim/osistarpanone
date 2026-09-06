// =========================================================================
// SW — OSIS TARPAN ONE (PWA)
// App shell precache + runtime cache. Aman untuk Supabase (API tidak di-cache).
// =========================================================================

const VERSI = "tarpan-v1";
const STATIS = VERSI + "-statis";
const RUNTIME = VERSI + "-runtime";

// App shell — file inti biar halaman publik + login langsung offline-ready.
// (Halaman osis/*, foto sekbid, dan CDN di-cache saat runtime.)
const APP_SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/config.js",
  "./js/db.js",
  "./js/app.js",
  "./js/toast.js",
  "./js/show-popup.js",
  "./js/visitor.js",
  "./js/home.js",
  "./js/prestasi.js",
  "./js/kegiatan.js",
  "./js/sekbid.js",
  "./js/aspirasi.js",
  "./js/lagu.js",
  "./js/galeri.js",
  "./js/osis-auth.js",
  "./js/site-edit.js",
  "./js/login.js",
  "./js/pwa.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(STATIS)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("tarpan-") && k !== STATIS && k !== RUNTIME)
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

// Jangan cache API/auth Supabase — selalu network (data live + milik localStorage SWR).
function apiJanganCache(url) {
  return (
    url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/auth/v1/") ||
    url.pathname.includes("/realtime/v1/")
  );
}

// Stale-while-revalidate: sajikan cache dulu, update di background.
async function basiDulu(request, namaCache) {
  const cache = await caches.open(namaCache);
  const cached = await cache.match(request, { ignoreSearch: false });
  const ambil = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || ambil;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 1) Navigasi halaman (termasuk hash-route SPA) — network dulu, fallback cache/offline.
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
              (await caches.match("./index.html")) || (await caches.match("./"));
            if (shell) return shell;
          }
          return caches.match("./offline.html");
        }
      })(),
    );
    return;
  }

  // 2) API Supabase — network only (fallback: error, jangan sajikan basi).
  if (url.hostname.endsWith("supabase.co") && apiJanganCache(url)) return;

  // 3) Aset lokal (css/js/gambar/manifest/icons) — stale-while-revalidate.
  if (url.origin === self.location.origin) {
    e.respondWith(basiDulu(req, RUNTIME));
    return;
  }

  // 4) Lintas origin: CDN (fonts, cdnjs, jsdelivr) + foto Supabase storage — SWR + fallback cache.
  e.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      } catch {
        if (cached) return cached;
        // Gambar gagal total saat offline — kembalikan placeholder SVG ringan.
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
