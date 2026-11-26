// =========================================================================
// SW - OSIS TARPAN ONE (PWA)
// App shell precache + runtime cache. Aman untuk Supabase (API tidak di-cache).
// =========================================================================

const VERSI = "tarpan-v235";
const STATIS = VERSI + "-statis";
const RUNTIME = VERSI + "-runtime";
// Cache lintas-origin (Font Awesome, Google Fonts, foto R2) tidak ikut
// dihapus tiap bump VERSI supaya ikon & gambar terakhir tetap tampil offline.
const LINTAS = "tarpan-lintas-v1";

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
  "./pengaturan.html",
  "./hasil-wawancara.html",
  "./jepun.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./assets/css/shared/style.css",
  "./assets/css/shared/dark.css",
  "./assets/css/public/feed.css",
  "./assets/css/public/jepun.css",
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
  "./assets/css/public/pengaturan.css",
  "./assets/css/public/login.css",
  "./assets/css/public/suara-musik.css",
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
  "./assets/js/shared/utilities/theme.js",
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
  "./assets/js/public/jepun.js",
  "./assets/js/vendor/jsQR.min.js",
  "./assets/js/vendor/qrcode.min.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-512-maskable.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon-32.png",
];

// Cloudflare Pages clean-URL me-redirect *.html -> 308 URL bersih (res.redirected = true).
// Navigasi browser punya redirect:"manual" — kalau SW balas cached response dengan
// redirected:true, browser menolak dengan "This page can't be loaded" (ERR_FAILED).
async function bersihRedirect(res) {
  if (!res || !res.redirected || res.type === "opaque") return res;
  const body = await res.blob();
  return new Response(body, {
    status: res.status || 200,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
}

async function isiPrecache() {
  const cache = await caches.open(STATIS);
  const unik = Array.from(new Set(APP_SHELL));
  await Promise.all(
    unik.map(async (item) => {
      const absUrl = new URL(item, self.location.href).href;
      const res = await fetch(new Request(absUrl, { cache: "no-cache", redirect: "follow" }));
      if (!res || !res.ok) throw new Error("Gagal precache: " + item);
      await cache.put(absUrl, await bersihRedirect(res));
    }),
  );
}

self.addEventListener("install", (e) => {
  // Catatan: JANGAN skipWaiting() di sini. SW baru wajib menunggu sampai
  // halaman memintanya via pesan SKIP_WAITING (assets/js/pwa/pwa.js). skipWaiting
  // otomatis = take-over tiba-tiba + controllerchange + reload sendiri.
  e.waitUntil(isiPrecache());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith("tarpan-") &&
                k !== STATIS &&
                k !== RUNTIME &&
                k !== LINTAS,
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
  // Kalau URL pakai ?v=XX tapi RUNTIME belum terisi (baru buka pertama kali / habis update),
  // cocokkan ke STATIS tanpa query biar instan walau sinyal mati/lemot.
  if (!cached && new URL(request.url).origin === self.location.origin) {
    const statis = await caches.open(STATIS);
    const dariStatis = await statis.match(request, { ignoreSearch: true });
    if (dariStatis) cached = dariStatis;
  }
  const ambil = fetch(request)
    .then(async (res) => {
      if (res && (res.ok || res.type === "opaque"))
        cacheUtama.put(request, await bersihRedirect(res.clone()));
      return res;
    })
    .catch(async () => {
      if (cached) return bersihRedirect(cached);
      if (new URL(request.url).origin === self.location.origin) {
        for (const nama of daftarCache) {
          const c = await caches.open(nama);
          const tanpaQuery = await c.match(request, { ignoreSearch: true });
          if (tanpaQuery) return bersihRedirect(tanpaQuery);
        }
      }
      throw new Error("offline");
    });
  return cached ? bersihRedirect(cached) : ambil;
}

// Cari HTML halaman di cache (cocokkan clean URL Cloudflare Pages "/osis/keuangan"
// dengan precache "./osis/keuangan.html", termasuk URL ber-query ?id=... / ?n=...).
async function cariNavigasiCache(req, url) {
  if (url.origin !== self.location.origin) return null;
  const daftarCache = [RUNTIME, STATIS];
  for (const nama of daftarCache) {
    const c = await caches.open(nama);
    const persis = await c.match(req, { ignoreSearch: false });
    if (persis) return bersihRedirect(persis);
  }

  const scopePath = new URL("./", self.location.href).pathname;
  const rawPath = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : url.pathname;
  const rel = rawPath.replace(/^\/+/, "").replace(/\/+$/, "");

  const kandidat = [];
  if (!rel || rel === "index" || rel === "index.html") {
    kandidat.push("./index.html", "./");
  } else if (rel === "osis" || rel === "osis/index" || rel === "osis/index.html") {
    kandidat.push("./osis/index.html", "./osis/", "./osis/index");
  } else if (rel.endsWith(".html")) {
    kandidat.push("./" + rel, "./" + rel.slice(0, -5));
  } else {
    kandidat.push("./" + rel + ".html", "./" + rel, "./" + rel + "/index.html");
  }

  for (const k of kandidat) {
    const targetHref = new URL(k, self.location.href).href;
    for (const nama of daftarCache) {
      const c = await caches.open(nama);
      const hit = await c.match(targetHref, { ignoreSearch: true });
      if (hit) return bersihRedirect(hit);
    }
  }
  return null;
}

// Fetch navigasi dengan batas tunggu supaya sinyal "nyangkut" (Wi-Fi tanpa internet)
// tidak menggantung sampai browser lempar ERR_TIMED_OUT.
function fetchNavigasi(req, ms) {
  if (typeof AbortController === "undefined") return fetch(req);
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch {}
  }, ms);
  return fetch(req, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Video/audio & Range request (206 Partial Content): biarkan browser stream langsung
  // tanpa lewat SW/Cache API (Cache.put menolak 206 & bikin buffering lambat).
  if (req.headers.has("range") || req.destination === "video" || req.destination === "audio") return;
  const url = new URL(req.url);

  // 1) Navigasi halaman (termasuk clean URL Cloudflare Pages & hash-route SPA).
  // Stale-while-revalidate: sajikan HTML precache/runtime INSTAN (0ms) supaya
  // pindah halaman tidak ketahan jaringan, sambil segarkan di background.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        const scopePath = new URL("./", self.location.href).pathname;
        // "/osis" tanpa garis miring di akhir -> arahkan ke "/osis/" biar path
        // relatif "../assets/..." dan link "keuangan" tetap mengarah ke dalam /osis/.
        if (url.origin === self.location.origin && url.pathname === scopePath + "osis") {
          return Response.redirect(new URL("./osis/" + url.search + url.hash, self.location.href).href, 302);
        }
        const hitAwal = await cariNavigasiCache(req, url);
        const sedangOnline = !(self.navigator && self.navigator.onLine === false);
        if (hitAwal) {
          if (sedangOnline) {
            e.waitUntil(
              fetchNavigasi(req, 4500)
                .then(async (res) => {
                  if (res && res.ok) {
                    const cache = await caches.open(RUNTIME);
                    await cache.put(req, await bersihRedirect(res.clone()));
                  }
                })
                .catch(() => {}),
            );
          }
          return hitAwal;
        }
        try {
          if (!sedangOnline) throw new Error("offline");
          const res = await fetchNavigasi(req, 4500);
          if (res && res.ok) {
            const cache = await caches.open(RUNTIME);
            await cache.put(req, await bersihRedirect(res.clone()));
            return bersihRedirect(res);
          }
          return res;
        } catch {
          const off = await caches.match("./offline.html");
          if (off) return bersihRedirect(off);
          return new Response(
            "<!doctype html><html lang='id'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Offline</title><body style='font-family:sans-serif;padding:24px;text-align:center'><h2>Kamu sedang offline</h2><p>Halaman belum tersimpan di perangkat.</p></body></html>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
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
  // lama selama masa transisi - SWR instan + fallback cache lintas versi.
  e.respondWith(
    (async () => {
      const cache = await caches.open(LINTAS);
      const cached = await cache.match(req);
      const sedangOnline = !(self.navigator && self.navigator.onLine === false);
      if (cached && !(req.mode === "cors" && cached.type === "opaque")) {
        if (sedangOnline && req.destination !== "font" && req.destination !== "image") {
          e.waitUntil(
            fetch(req)
              .then((res) => {
                if (res && res.status !== 206 && (res.ok || res.type === "opaque")) {
                  return cache.put(req, res.clone());
                }
              })
              .catch(() => {}),
          );
        }
        return cached;
      }
      try {
        if (!sedangOnline) throw new Error("offline");
        const res = await fetch(req);
        if (res && res.status !== 206 && (res.ok || res.type === "opaque"))
          cache.put(req, res.clone());
        return res;
      } catch {
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
