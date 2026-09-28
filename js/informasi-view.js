// =========================================================================
// INFORMASI VIEW (#/informasi di index) — OSIS TARPAN ONE
// Publik bisa baca tanpa login. Kelola (tulis/ubah/hapus) khusus OSIS
// dengan hak "informasi" / super admin. Data: tabel `informasi_publik`.
// Kartu gaya ip3, alur logic dari PapanInfo (informasi2).
// =========================================================================

const InfoView = (function () {
  "use strict";

  const CACHE_KUNCI = "cache_papan_info";

  let semua = [];
  let kategori = "semua";
  let cari = "";
  let urut = "baru"; // baru | lama
  let bisaKelola = false;
  let editingId = null; // number id kartu | "baru" | null
  let sudahInit = false;
  // Staging lampiran PDF selama mode ubah (belum tersimpan sampai Simpan)
  let pendingLampiran = null; // File baru
  let lampiranHapus = false;
  let lampiranAwal = { link: "", label: "" };

  // Contoh kalau DB belum ada / offline.
  const CONTOH = [
    {
      id: 9001,
      judul: "Libur Bersama — KBM Ditiadakan Sementara",
      kategori: "libur",
      ringkasan: "KBM libur beberapa hari sesuai kalender pendidikan, masuk kembali sesuai jadwal yang diumumkan wali kelas.",
      isi: "Diberitahukan kepada seluruh siswa SMK Taruna Harapan 1 Cipatat bahwa KBM diliburkan sementara.\n\nSelama libur, siswa diminta tetap belajar mandiri di rumah, menjaga sikap di lingkungan masing-masing, dan memantau info masuk kembali lewat wali kelas / grup angkatan.",
      tanggal_mulai: "Tunggu pengumuman wali kelas",
      tanggal_selesai: "",
      waktu: "Sepanjang hari",
      lokasi: "Rumah masing-masing",
      sasaran: "Seluruh siswa",
      link_lampiran: "",
      label_lampiran: "",
      is_pinned: true,
      pengunggah: "OSIS TARPAN ONE",
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 9002,
      judul: "Lomba Antar Kelas — Segera Dibuka Pendaftaran",
      kategori: "acara",
      ringkasan: "Siapkan tim kelasmu! Pendaftaran dibuka lewat pengurus OSIS tiap angkatan.",
      isi: "Halo semuanya! Akan ada rangkaian lomba antar kelas (olahraga & seni).\n\n1. Futsal\n2. Voli\n3. E-sport\n4. Vokal grup / akustik\n\nKuota tiap cabang terbatas. Daftar lebih awal ke panitia OSIS biar kebagian slot.",
      tanggal_mulai: "Akan diumumkan",
      tanggal_selesai: "",
      waktu: "Jam sekolah",
      lokasi: "Lapangan & aula sekolah",
      sasaran: "Kelas X, XI, XII",
      link_lampiran: "",
      label_lampiran: "",
      is_pinned: false,
      pengunggah: "OSIS TARPAN ONE",
      created_at: new Date(Date.now() - 86400000 * 6).toISOString(),
    },
    {
      id: 9003,
      judul: "Tata Tertib Seragam — Cek Lagi Sebelum Berangkat",
      kategori: "penting",
      ringkasan: "Pastikan atribut seragam lengkap dan datang sebelum gerbang ditutup.",
      isi: "Pengingat buat semua siswa:\n\n- Datang sebelum pukul 07.00 WIB\n- Atribut seragam lengkap (dasi, sabuk, kaos kaki & sepatu sesuai ketentuan)\n- Rambut rapi sesuai aturan sekolah\n\nPetugas ketertiban akan razia berkala. Yuk tertib bareng-bareng.",
      tanggal_mulai: "Berlaku setiap hari sekolah",
      tanggal_selesai: "",
      waktu: "06.30 – 07.00 WIB",
      lokasi: "Gerbang & area sekolah",
      sasaran: "Seluruh siswa",
      link_lampiran: "",
      label_lampiran: "",
      is_pinned: false,
      pengunggah: "OSIS TARPAN ONE",
      created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    },
  ];

  function esc(s) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(s);
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function info(msg, tipe) {
    if (typeof window.showToast === "function") window.showToast(msg, tipe || "success");
    else if (typeof window.showPopup === "function") window.showPopup(msg, tipe === "error" ? "error" : "success");
    else alert(msg);
  }

  function fmtTgl(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    } catch {
      return "";
    }
  }

  // Kunci deep-link dari hash (#/informasi?id=12 atau ?id=acara_rapat_sekolah).
  // Terima slug maupun id angka lama (biar link lama tetap jalan).
  function kunciDariHash() {
    try {
      const h = String(location.hash || "");
      const q = h.indexOf("?") >= 0 ? h.slice(h.indexOf("?") + 1) : "";
      const v = new URLSearchParams(q).get("id");
      const s = String(v == null ? "" : v).trim();
      return s ? s : null;
    } catch {
      return null;
    }
  }

  function cariByKunci(kunci) {
    if (kunci == null || kunci === "") return null;
    const k = String(kunci).trim();
    if (/^\d+$/.test(k)) {
      const byId = semua.find(function (x) { return String(x.id) === k; });
      if (byId) return byId;
    }
    return semua.find(function (x) { return String(x.slug || "").toLowerCase() === k.toLowerCase(); }) || null;
  }

  // Kunci buat link share: slug kalau ada, kalau kosong pakai id angka.
  function kunciShare(x) {
    const s = String((x && x.slug) || "").trim();
    return s ? s : String(x.id);
  }

  function urlShare(kunci) {
    return location.origin + location.pathname + "#/informasi?id=" + encodeURIComponent(kunci);
  }

  function slugify(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
  }

  // Isi otomatis slug dari judul selagi user belum ngetik slug manual.
  function autoSlug() {
    const card = document.getElementById("infvCard_edit");
    const s = document.getElementById("eSlug");
    if (!card || !s) return;
    if (s.dataset.auto === "0") return;
    const j = card.querySelector('[data-field="judul"]');
    s.value = slugify(j ? j.innerText : "");
  }

  function slugManual() {
    const s = document.getElementById("eSlug");
    if (s) s.dataset.auto = s.value ? "0" : "1";
  }

  // URL lampiran buat view: dukung key storage R2 (getFoto) & link luar (https).
  function urlLampiran(x) {
    const l = String((x && x.link_lampiran) || "").trim();
    if (!l) return "";
    if (/^https?:\/\//i.test(l)) return l;
    try {
      if (typeof getFoto === "function") return getFoto(l);
    } catch {}
    return l;
  }

  function namaFileLampiran(link, label) {
    if (label && String(label).trim()) return String(label).trim();
    const l = String(link || "");
    const pot = l.split("?")[0].split("#")[0].split("/").pop() || "lampiran.pdf";
    try { return decodeURIComponent(pot); } catch { return pot; }
  }

  function cekKelola() {
    bisaKelola = false;
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.getUser) {
        const u = OsisAuth.getUser();
        if (u && u.mode === "osis") {
          bisaKelola = OsisAuth.isSuper() || (OsisAuth.bisa && OsisAuth.bisa("informasi"));
        }
      }
    } catch {
      bisaKelola = false;
    }
    const btn = document.getElementById("btnInfvTambah");
    if (btn) btn.style.display = bisaKelola ? "inline-flex" : "none";
  }

  const NAMA_KAT = {
    pengumuman: ["k-pengumuman", "fa-bullhorn", "Pengumuman"],
    libur: ["k-libur", "fa-umbrella-beach", "Libur"],
    acara: ["k-acara", "fa-calendar-day", "Acara"],
    penting: ["k-penting", "fa-triangle-exclamation", "Penting"],
  };

  function badgeKat(kat) {
    const k = String(kat || "pengumuman").toLowerCase();
    const m = NAMA_KAT[k] || NAMA_KAT.pengumuman;
    return '<span class="infv-badge ' + m[0] + '"><i class="fa-solid ' + m[1] + '"></i> ' + m[2] + "</span>";
  }

  function kartuHtml(x, fokus) {
    const isi = String(x.isi || "");
    const isiEsc = esc(isi);
    const panjang = isiEsc.length > 260;
    const lipat = panjang && !fokus;
    const tgl = fmtTgl(x.created_at);
    const kunci = kunciShare(x);
    const kelola = bisaKelola
      ? '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.bukaForm(' + Number(x.id) + ')"><i class="fa-solid fa-pen"></i> Ubah</button>' +
        '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.hapus(' + Number(x.id) + ')"><i class="fa-solid fa-trash"></i> Hapus</button>'
      : "";
    const per = String(x.tanggal_mulai || "").trim() +
      (String(x.tanggal_selesai || "").trim() ? " – " + esc(String(x.tanggal_selesai).trim()) : "");
    return (
      '<article class="infv-card' + (x.is_pinned ? " pin" : "") + (fokus ? " fokus" : "") + '" id="infvCard_' + x.id + '">' +
      '<div class="infv-head"><div class="infv-badges">' + badgeKat(x.kategori) +
      (x.is_pinned ? '<span class="infv-pin"><i class="fa-solid fa-thumbtack"></i> Disematkan</span>' : "") +
      "</div>" +
      (tgl ? '<span class="infv-tgl"><i class="fa-regular fa-calendar"></i> ' + esc(tgl) + "</span>" : "") +
      "</div>" +
      '<h3 class="infv-judul">' + esc(x.judul || "Tanpa judul") + "</h3>" +
      (x.ringkasan ? '<p class="infv-ringkas">' + esc(x.ringkasan) + "</p>" : "") +
      ((per || x.waktu || x.lokasi || x.sasaran)
        ? '<div class="infv-meta">' +
          (String(x.tanggal_mulai || "").trim() ? '<div class="infv-meta-item"><span class="infv-meta-ico"><i class="fa-regular fa-calendar-check"></i></span><div><small>Jadwal</small><b>' + esc(String(x.tanggal_mulai).trim()) + (String(x.tanggal_selesai || "").trim() ? " – " + esc(String(x.tanggal_selesai).trim()) : "") + "</b></div></div>" : "") +
          (x.waktu ? '<div class="infv-meta-item"><span class="infv-meta-ico"><i class="fa-regular fa-clock"></i></span><div><small>Waktu</small><b>' + esc(x.waktu) + "</b></div></div>" : "") +
          (x.lokasi ? '<div class="infv-meta-item"><span class="infv-meta-ico"><i class="fa-solid fa-location-dot"></i></span><div><small>Tempat</small><b>' + esc(x.lokasi) + "</b></div></div>" : "") +
          (x.sasaran ? '<div class="infv-meta-item"><span class="infv-meta-ico"><i class="fa-solid fa-users"></i></span><div><small>Untuk</small><b>' + esc(x.sasaran) + "</b></div></div>" : "") +
          "</div>"
        : "") +
      (isiEsc
        ? '<div class="infv-isi' + (lipat ? " lipat" : "") + '" id="infvIsi_' + x.id + '"><p>' +
          isiEsc.replace(/\n/g, "<br>") + "</p></div>" +
          (lipat ? '<button type="button" class="infv-baca" id="infvBaca_' + x.id + '" onclick="InfoView.toggleIsi(' + x.id + ')"><i class="fa-solid fa-angle-down"></i> Baca selengkapnya</button>' : "")
        : "") +
      (x.link_lampiran
        ? '<div><a class="btn btn-white btn-sm" href="' + esc(urlLampiran(x)) + '" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-file-pdf"></i> ' + esc(namaFileLampiran(x.link_lampiran, x.label_lampiran)) + "</a></div>"
        : "") +
      '<div class="infv-foot">' +
      '<span class="infv-oleh"><i class="fa-solid fa-user-shield"></i><span><small>Diterbitkan oleh</small><b>' + esc(x.pengunggah || "OSIS TARPAN ONE") + "</b></span></span>" +
      '<div class="infv-aksi">' +
      '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.salinLink(\'' + kunci + '\')" title="Salin link"><i class="fa-solid fa-link"></i> Salin</button>' +
      '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.bagiWA(\'' + kunci + '\')" title="Bagikan WA"><i class="fa-brands fa-whatsapp"></i> WA</button>' +
      kelola +
      "</div></div></article>"
    );
  }

  function cocok(x) {
    if (kategori !== "semua" && String(x.kategori) !== kategori) return false;
    if (!cari) return true;
    const gab = [x.judul, x.ringkasan, x.isi, x.lokasi, x.sasaran].map(function (v) {
      return String(v || "");
    }).join(" ").toLowerCase();
    return gab.includes(cari);
  }

  function urutkan(arr) {
    const cp = arr.slice();
    cp.sort(function (a, b) {
      const ta = new Date(a.created_at || 0).getTime() || 0;
      const tb = new Date(b.created_at || 0).getTime() || 0;
      return urut === "lama" ? ta - tb : tb - ta;
    });
    if (urut === "baru") {
      cp.sort(function (a, b) {
        return Number(!!b.is_pinned) - Number(!!a.is_pinned);
      });
    }
    return cp;
  }

  function render() {
    const box = document.getElementById("infvList");
    if (!box) return;
    const hitung = document.getElementById("infvHitung");
    const sub = document.getElementById("infvSubHitung");
    const sw = document.getElementById("infvSorotanWrap");
    const ss = document.getElementById("infvSorotan");

    const fokusKunci = kunciDariHash();
    const toolbar = document.getElementById("infvToolbar");
    if (fokusKunci) {
        // Mode fokus 1 info (?id=): filter + pencarian disembunyikan.
        if (toolbar) toolbar.style.display = "none";
        const satu = cariByKunci(fokusKunci);
      if (satu) {
        box.innerHTML =
          '<div class="infv-fokusbar"><a class="btn btn-white btn-sm" href="#/informasi"><i class="fa-solid fa-arrow-left"></i> Semua info</a><span><i class="fa-solid fa-eye"></i> Fokus 1 info</span></div>' +
          (editingId === Number(satu.id) ? kartuEditHtml(satu, false) : kartuHtml(satu, true));
        if (hitung) hitung.textContent = "1";
        if (sub) sub.textContent = "info terpilih";
            if (sw) sw.style.display = "none";
            return;
        }
    }
    // Mode daftar biasa: pastikan toolbar filter + pencarian tampil lagi.
    if (toolbar) toolbar.style.display = "";

    const daftar = urutkan(semua.filter(cocok));
    if (hitung) hitung.textContent = String(daftar.length);
    if (sub) {
      sub.textContent =
        semua.length + " info • " +
        semua.filter(function (x) { return x.kategori === "libur"; }).length + " libur • " +
        semua.filter(function (x) { return x.kategori === "acara"; }).length + " acara";
    }

    const pin = semua.filter(function (x) { return !!x.is_pinned; }).slice(0, 8);
    if (sw && ss) {
      if (pin.length && !fokusKunci) {
        sw.style.display = "";
        ss.innerHTML = pin.map(function (x) {
          return (
            '<button type="button" class="infv-spot" onclick="InfoView.lihat(\'' + kunciShare(x) + '\')">' +
            badgeKat(x.kategori) + "<b>" + esc(x.judul) + "</b>" +
            "<small>" + esc(String(x.ringkasan || x.isi || "").slice(0, 90)) + "…</small>" +
            "</button>"
          );
        }).join("");
      } else {
        sw.style.display = "none";
      }
    }

    if (!daftar.length && editingId !== "baru") {
      box.innerHTML =
        '<div class="infv-card"><div class="pesan-empty" style="text-align:center;padding:28px 14px">' +
        '<i class="fa-solid fa-magnifying-glass" style="font-size:1.8rem;color:var(--gray);display:block;margin-bottom:8px"></i>' +
        "<b>Belum ada info yang cocok.</b>" +
        '<p style="font-size:.82rem;color:var(--gray);margin:4px 0 0">Ganti kata kunci atau kategori di atas.</p>' +
        "</div></div>";
      return;
    }
    let htmlBaru = "";
    if (editingId === "baru") htmlBaru = kartuEditHtml(blankoBaru(), true);
    // Kelompokkan per hari terbit (created_at WIB) + sisip pemisah hari
    // biar jarak antar hari keisi elemen.
    const kunciHari = function (x) {
      try {
        const d = new Date(x.created_at);
        if (isNaN(d)) return "lain";
        return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
      } catch { return "lain"; }
    };
    const labelHari = function (kunci) {
      if (kunci === "lain") return "Tanggal tidak diketahui";
      try {
        return new Date(kunci + "T12:00:00+07:00").toLocaleDateString("id-ID", {
          weekday: "long", day: "numeric", month: "long", year: "numeric",
          timeZone: "Asia/Jakarta",
        });
      } catch { return kunci; }
    };
    let htmlHari = "";
    let hariTerakhir = null;
    daftar.forEach(function (x) {
      const k = kunciHari(x);
      if (k !== hariTerakhir) {
        hariTerakhir = k;
        htmlHari += '<div class="infv-daysep"><span><i class="fa-solid fa-calendar-day"></i> ' + esc(labelHari(k)) + "</span></div>";
      }
      htmlHari += editingId === Number(x.id) ? kartuEditHtml(x, false) : kartuHtml(x, false);
    });
    box.innerHTML = htmlBaru + htmlHari;
  }

  async function muat(paksa) {
    const box = document.getElementById("infvList");
    cekKelola();

    if (!semua.length && !paksa) {
      try {
        let cached = null;
        if (typeof Cache !== "undefined" && Cache.get) cached = Cache.get(CACHE_KUNCI);
        if (!cached) {
          const raw = localStorage.getItem(CACHE_KUNCI);
          if (raw) cached = JSON.parse(raw);
        }
        if (Array.isArray(cached) && cached.length) {
          semua = cached;
          render();
        }
      } catch {}
    }

    try {
      if (typeof getInformasiPublikList === "function") {
        const fresh = await getInformasiPublikList();
        // Array kosong = data valid (mis. semua info dihapus), JANGAN ditolak
        // cuma karena length-nya 0 — kalau tidak, `semua` basi tetap dipakai
        // dan card yang udah dihapus server bakal gentayangan (hapus ulang
        // malah ERR_NOT_FOUND).
        if (Array.isArray(fresh)) {
          semua = fresh;
          try {
            if (typeof Cache !== "undefined" && Cache.set) Cache.set(CACHE_KUNCI, fresh);
            localStorage.setItem(CACHE_KUNCI, JSON.stringify(fresh));
          } catch {}
          render();
          return;
        }
      }
      if (!semua.length) {
        semua = CONTOH.slice();
        render();
      } else {
        render();
      }
    } catch (e) {
      console.warn("InfoView: pakai cache/contoh:", e);
      if (!semua.length) semua = CONTOH.slice();
      render();
    }
  }

  function setKategori(k) {
    kategori = k;
    document.querySelectorAll("#infvChips button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.kat === k);
    });
    render();
  }

  function setUrut(v) {
    urut = v === "lama" ? "lama" : "baru";
    render();
  }

  function toggleIsi(id) {
    const el = document.getElementById("infvIsi_" + id);
    const btn = document.getElementById("infvBaca_" + id);
    if (!el) return;
    const lipat = el.classList.toggle("lipat");
    if (btn) {
      btn.innerHTML = lipat
        ? '<i class="fa-solid fa-angle-down"></i> Baca selengkapnya'
        : '<i class="fa-solid fa-angle-up"></i> Tutup';
    }
  }

  function lihat(kunci) {
    location.hash = "#/informasi?id=" + encodeURIComponent(kunci);
  }

  function salinLink(kunci) {
    const url = urlShare(kunci);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        info("Link info berhasil disalin!");
      }).catch(function () {
        prompt("Salin link ini:", url);
      });
    } else {
      prompt("Salin link ini:", url);
    }
  }

  function bagiWA(kunci) {
    const x = cariByKunci(kunci);
    if (!x) return;
    let teks = "*INFO TARPAN ONE*\n\n*" + String(x.judul || "") + "*\n";
    if (x.ringkasan) teks += "\n" + x.ringkasan + "\n";
    if (x.tanggal_mulai) teks += "\nJadwal: " + x.tanggal_mulai + (x.tanggal_selesai ? " s/d " + x.tanggal_selesai : "");
    if (x.lokasi) teks += "\nTempat: " + x.lokasi;
    teks += "\n\nSelengkapnya: " + urlShare(kunciShare(x));
    window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(teks), "_blank", "noopener,noreferrer");
  }

  // ---------- Edit inline langsung di kartu (tanpa popup, tanpa form) ----------
  // Teks diketik di tempat kayak site-content. Kategori & pin = toggle chip.
  function kartuEditHtml(x, isBaru) {
    const kat = String((x && x.kategori) || "pengumuman");
    const satuBaris = function (v) { return String(v == null ? "" : v).replace(/\s*\n\s*/g, " ").trim(); };
    const chipsKat = ["pengumuman", "libur", "acara", "penting"].map(function (k) {
      return '<button type="button" class="infv-badge ' + NAMA_KAT[k][0] + (kat === k ? "" : " off") + '" data-setkat="' + k + '" onclick="InfoView.setKatChips(this)" title="Jadikan ' + NAMA_KAT[k][2] + '">' + NAMA_KAT[k][2] + "</button>";
    }).join("");
    const metaEdit = function (ikon, label, field, ph, val) {
      return '<div class="infv-meta-item"><span class="infv-meta-ico"><i class="' + ikon + '"></i></span><div style="flex:1;min-width:0"><small>' + label + '</small><b contenteditable="true" data-field="' + field + '" data-ph="' + ph + '">' + esc(satuBaris(val)) + "</b></div></div>";
    };
    return (
      '<article class="infv-card editing" id="infvCard_edit" data-kat="' + esc(kat) + '" data-pin="' + (x.is_pinned ? "1" : "0") + '">' +
      '<div class="infv-head"><div class="infv-badges">' + chipsKat +
      '<button type="button" class="infv-pin' + (x.is_pinned ? "" : " off") + '" onclick="InfoView.togglePinChips(this)" title="Sematkan / lepas pin"><i class="fa-solid fa-thumbtack"></i> ' + (isBaru ? "Sematkan?" : (x.is_pinned ? "Disematkan" : "Sematkan?")) + "</button>" +
      "</div></div>" +
      '<h3 class="infv-judul" contenteditable="true" data-field="judul" data-ph="Tulis judul info…" oninput="InfoView.autoSlug()" onkeydown="InfoView.judulEnter(event)">' + esc(satuBaris(x.judul)) + "</h3>" +
      '<p class="infv-ringkas" contenteditable="true" data-field="ringkasan" data-ph="Tulis ringkasan 1–2 kalimat…">' + esc(satuBaris(x.ringkasan)) + "</p>" +
      '<div class="infv-meta">' +
      metaEdit("fa-regular fa-calendar-check", "Jadwal mulai", "tanggal_mulai", "cth: 18 Feb 2026", x.tanggal_mulai) +
      metaEdit("fa-regular fa-calendar-check", "Jadwal selesai", "tanggal_selesai", "opsional", x.tanggal_selesai) +
      metaEdit("fa-regular fa-clock", "Waktu", "waktu", "cth: 08.00 WIB", x.waktu) +
      metaEdit("fa-solid fa-location-dot", "Tempat", "lokasi", "cth: Lapangan utama", x.lokasi) +
      metaEdit("fa-solid fa-users", "Untuk", "sasaran", "cth: Seluruh siswa", x.sasaran) +
      "</div>" +
      '<div class="infv-isi" contenteditable="true" data-field="isi" data-ph="Tulis isi lengkap…">' + (x.isi ? "<p>" + esc(x.isi).replace(/\n/g, "<br>") + "</p>" : "") + "</div>" +
      '<div><label class="infv-flabel">Lampiran PDF</label><div id="infvLampBox">' + chipLampiranHtml() + "</div></div>" +
      '<div class="infv-slugrow"><span>?id=</span><input id="eSlug" maxlength="80" placeholder="acara_rapat_sekolah — kosong = otomatis" value="' + esc(x.slug || "") + '" data-auto="1" oninput="InfoView.slugManual()"></div>' +
      '<div class="infv-foot">' +
      '<span class="infv-oleh"><i class="fa-solid fa-pen"></i><span><small>Mode ubah</small><b>Langsung ketik di kartu</b></span></span>' +
      '<div class="infv-aksi">' +
      '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.batalEdit()"><i class="fa-solid fa-xmark"></i> Batal</button>' +
      '<button type="button" class="btn btn-red btn-sm" id="btnInfvSimpan" onclick="InfoView.simpanEdit()"><i class="fa-solid fa-check"></i> ' + (isBaru ? "Terbitkan" : "Simpan") + "</button>" +
      "</div></div></article>"
    );
  }

  // Toggle chip kategori & pin di kartu yang lagi diedit
  function setKatChips(btn) {
    const card = btn.closest ? btn.closest("#infvCard_edit") : document.getElementById("infvCard_edit");
    if (!card) return;
    card.dataset.kat = btn.dataset.setkat;
    card.querySelectorAll("[data-setkat]").forEach(function (b) {
      b.classList.toggle("off", b.dataset.setkat !== card.dataset.kat);
    });
  }

  function togglePinChips(btn) {
    const card = btn.closest ? btn.closest("#infvCard_edit") : document.getElementById("infvCard_edit");
    if (!card) return;
    const on = card.dataset.pin !== "1";
    card.dataset.pin = on ? "1" : "0";
    btn.classList.toggle("off", !on);
    btn.innerHTML = '<i class="fa-solid fa-thumbtack"></i> ' + (on ? "Disematkan" : "Sematkan?");
  }

  // Judul satu baris: Enter jangan bikin baris baru
  function judulEnter(e) {
    if (e && e.key === "Enter") e.preventDefault();
  }

  // ---------- Lampiran PDF: upload langsung, view dari file ----------
  function chipLampiranHtml() {
    if (pendingLampiran) {
      const kb = Math.max(1, Math.round(pendingLampiran.size / 1024));
      return (
        '<div class="infv-lampchip"><i class="fa-solid fa-file-pdf"></i><b>' + esc(pendingLampiran.name) + '</b><small>baru • ' + kb + ' KB • belum disimpan</small>' +
        '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.pilihPdf()"><i class="fa-solid fa-repeat"></i> Ganti</button>' +
        '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.hapusLampiran()"><i class="fa-solid fa-xmark"></i></button></div>'
      );
    }
    if (!lampiranHapus && lampiranAwal.link) {
      return (
        '<div class="infv-lampchip"><i class="fa-solid fa-file-pdf"></i><b>' + esc(namaFileLampiran(lampiranAwal.link, lampiranAwal.label)) + "</b>" +
        '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.pilihPdf()"><i class="fa-solid fa-repeat"></i> Ganti</button>' +
        '<button type="button" class="btn btn-white btn-sm" onclick="InfoView.hapusLampiran()"><i class="fa-solid fa-trash"></i></button></div>'
      );
    }
    return (
      '<button type="button" class="infv-lampdrop" onclick="InfoView.pilihPdf()"><i class="fa-solid fa-cloud-arrow-up"></i><b>Upload PDF</b><small>maks 10MB</small></button>'
    );
  }

  function gambarChipLampiran() {
    const box = document.getElementById("infvLampBox");
    if (box) box.innerHTML = chipLampiranHtml();
  }

  function pilihPdf() {
    const fi = document.getElementById("infvPdfInput");
    if (fi) fi.click();
    else info("Browser tidak mendukung pilih file", "error");
  }

  function onPdfDipilih(inp) {
    const f = inp && inp.files && inp.files[0];
    if (inp) inp.value = "";
    if (!f) return;
    if (!(f.type === "application/pdf" || /\.pdf$/i.test(f.name))) {
      info("File harus PDF", "error");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      info("PDF maksimal 10MB", "error");
      return;
    }
    pendingLampiran = f;
    lampiranHapus = false;
    gambarChipLampiran();
    info("PDF siap dilampirkan — klik Simpan biar kesimpan.");
  }

  function hapusLampiran() {
    pendingLampiran = null;
    lampiranHapus = true;
    gambarChipLampiran();
  }

  function resetStagingLampiran(x) {
    pendingLampiran = null;
    lampiranHapus = false;
    lampiranAwal = {
      link: String((x && x.link_lampiran) || ""),
      label: String((x && x.label_lampiran) || ""),
    };
  }

  function blankoBaru() {
    return { kategori: "pengumuman", slug: "", judul: "", ringkasan: "", isi: "", tanggal_mulai: "", tanggal_selesai: "", waktu: "", lokasi: "", sasaran: "", link_lampiran: "", label_lampiran: "", is_pinned: false };
  }

  function bukaForm(id) {
    if (!bisaKelola) {
      info("Khusus pengurus OSIS (hak informasi)", "error");
      return;
    }
    // Edit inline di kartu (tanpa popup). "baru" = kartu kosong di atas.
    editingId = id ? Number(id) : "baru";
    const x = editingId === "baru" ? blankoBaru() : semua.find(function (d) { return Number(d.id) === editingId; });
    resetStagingLampiran(x);
    if (editingId === "baru" && kunciDariHash()) {
      location.hash = "#/informasi";
      render();
    } else {
      render();
    }
    gambarChipLampiran();
    setTimeout(function () {
      const el = document.getElementById(editingId === "baru" ? "infvCard_edit" : "infvCard_" + editingId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const f = el.querySelector('[data-field="judul"]');
        if (f) f.focus({ preventScroll: true });
      }
    }, 60);
  }

  function batalEdit() {
    if (!editingId) return;
    editingId = null;
    resetStagingLampiran(null);
    render();
  }

  async function simpanEdit() {
    if (!bisaKelola) {
      info("Akses tidak sah", "error");
      return;
    }
    if (!editingId) return;
    const card = document.getElementById("infvCard_edit");
    if (!card) return;
    // Baca teks yang diketik langsung di kartu
    const tv = function (f) {
      const el = card.querySelector('[data-field="' + f + '"]');
      if (!el) return "";
      const t = String(el.innerText == null ? el.textContent : el.innerText);
      return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    };
    const satuBaris = function (f) { return tv(f).replace(/\s*\n\s*/g, " ").trim(); };
    const val = function (id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : "";
    };
    const judul = satuBaris("judul");
    if (!judul) {
      info("Judul wajib diisi", "error");
      const j = card.querySelector('[data-field="judul"]');
      if (j) j.focus();
      return;
    }
    const payload = {
      judul: judul.slice(0, 150),
      kategori: card.dataset.kat || "pengumuman",
      slug: val("eSlug"),
      ringkasan: satuBaris("ringkasan").slice(0, 300),
      isi: tv("isi"),
      tanggal_mulai: satuBaris("tanggal_mulai"),
      tanggal_selesai: satuBaris("tanggal_selesai"),
      waktu: satuBaris("waktu"),
      lokasi: satuBaris("lokasi"),
      sasaran: satuBaris("sasaran"),
      link_lampiran: lampiranHapus ? "" : lampiranAwal.link,
      label_lampiran: lampiranHapus ? "" : lampiranAwal.label,
      is_pinned: card.dataset.pin === "1",
    };
    const linkLama = lampiranAwal.link;
    const btn = document.getElementById("btnInfvSimpan");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    }
    try {
      const u = OsisAuth.getUser();
      if (!u || !u.id) throw new Error("Silakan login kembali");
      // Upload PDF baru dulu (kalau ada yang dipentaskan)
      if (pendingLampiran) {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Mengupload PDF...';
        const aman = pendingLampiran.name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "") || "lampiran.pdf";
        const key = "informasi/" + Date.now() + "-" + aman;
        await uploadFotoStorage(pendingLampiran, key);
        payload.link_lampiran = key;
        payload.label_lampiran = pendingLampiran.name;
      }
      if (editingId === "baru") {
        await buatInformasiPublik(u.id, payload);
        info("Info baru berhasil diterbitkan!");
      } else {
        await updateInformasiPublik(u.id, editingId, payload);
        info("Info berhasil diperbarui!");
      }
      // File lama yang diganti/dihapus: bersihkan dari storage (best-effort)
      if (linkLama && linkLama !== payload.link_lampiran && !/^https?:\/\//i.test(linkLama)) {
        try { await hapusFotoStorage(linkLama); } catch {}
      }
      editingId = null;
      resetStagingLampiran(null);
      try {
        if (typeof Cache !== "undefined" && Cache.del) Cache.del(CACHE_KUNCI);
        localStorage.removeItem(CACHE_KUNCI);
      } catch {}
      await muat(true);
    } catch (e) {
      console.error(e);
      info((e && e.message) || "Gagal menyimpan", "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan';
      }
    }
  }

  async function hapus(id) {
    if (!bisaKelola) return;
    let yakin = false;
    try {
      yakin = typeof window.showPopup === "function"
        ? await window.showPopup("Hapus info ini?", "confirm")
        : confirm("Hapus info ini?");
    } catch {
      yakin = confirm("Hapus info ini?");
    }
    if (!yakin) return;
    try {
      const u = OsisAuth.getUser();
      await hapusInformasiPublik(u.id, id);
      // Optimistis: buang dari memori + render langsung biar card
      // detik itu juga hilang, baru sinkron ke server di bawah.
      semua = (semua || []).filter(function (x) { return String(x.id) !== String(id); });
      render();
      info("Info berhasil dihapus");
      try {
        if (typeof Cache !== "undefined" && Cache.del) Cache.del(CACHE_KUNCI);
        localStorage.removeItem(CACHE_KUNCI);
      } catch {}
      await muat(true);
    } catch (e) {
      console.error(e);
      info((e && e.message) || "Gagal menghapus", "error");
    }
  }

  function init() {
    // Dipanggil sekali via Router.register; listener dalam dijaga biar
    // tidak dobel kalau user bolak-balik halaman.
    if (!sudahInit) {
      sudahInit = true;
      const c = document.getElementById("infvCari");
      if (c) {
        c.addEventListener("input", function (e) {
          cari = String(e.target.value || "").trim().toLowerCase();
          render();
        });
      }
      window.addEventListener("hashchange", function () {
        try {
          if (typeof Router !== "undefined" && Router.current === "informasi") render();
        } catch {}
      });
      // ESC batalin mode ubah (gantian dari tutup popup kemarin)
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && editingId) InfoView.batalEdit();
      });
      // Input file tersembunyi buat upload PDF lampiran (dibuat sekali)
      if (!document.getElementById("infvPdfInput")) {
        const fi = document.createElement("input");
        fi.type = "file";
        fi.id = "infvPdfInput";
        fi.accept = "application/pdf,.pdf";
        fi.style.display = "none";
        fi.addEventListener("change", function () { InfoView.onPdfDipilih(fi); });
        document.body.appendChild(fi);
      }
      try {
        if (typeof OsisAuth !== "undefined" && OsisAuth.refreshAkses) {
          OsisAuth.refreshAkses().then(function () {
            cekKelola();
            render();
          }).catch(function () {});
        }
      } catch {}
    }
    muat();
  }

  return {
    init: init,
    muat: muat,
    setKategori: setKategori,
    setUrut: setUrut,
    toggleIsi: toggleIsi,
    lihat: lihat,
    salinLink: salinLink,
    bagiWA: bagiWA,
    bukaForm: bukaForm,
    batalEdit: batalEdit,
    simpanEdit: simpanEdit,
    setKatChips: setKatChips,
    togglePinChips: togglePinChips,
    judulEnter: judulEnter,
    autoSlug: autoSlug,
    slugManual: slugManual,
    pilihPdf: pilihPdf,
    onPdfDipilih: onPdfDipilih,
    hapusLampiran: hapusLampiran,
    hapus: hapus,
  };
})();

if (typeof Router !== "undefined") {
  Router.register("informasi", function () { InfoView.init(); });
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { InfoView.init(); });
} else {
  InfoView.init();
}
