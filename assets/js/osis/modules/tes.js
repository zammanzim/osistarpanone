// =========================================================================
// TES & KUIS INTERNAL OSIS — halaman osis/tes.html
// 4 view: daftar, kerjakan (1 soal/layar + Next/Prev + grid nomor),
//         builder (custom soal & pilihan: PG, Multi, Benar/Salah, Isian,
//         Essay, Skala), hasil & koreksi manual essay.
// =========================================================================

const Tes = {
  TIPE: [
    { id: "pg", label: "Pilihan Ganda", icon: "fa-regular fa-circle-dot", hint: "Pilih 1 jawaban yang paling tepat." },
    { id: "bobot", label: "Pilihan Berpoin", icon: "fa-solid fa-list-ol", hint: "Pilih jawaban yang paling sesuai (setiap pilihan bernilai poin)." },
    { id: "multi", label: "Pilih > 1", icon: "fa-regular fa-square-check", hint: "Boleh pilih lebih dari satu jawaban." },
    { id: "bs", label: "Benar / Salah", icon: "fa-solid fa-scale-balanced", hint: "Tentukan pernyataan ini Benar atau Salah." },
    { id: "isian", label: "Isian Singkat", icon: "fa-solid fa-keyboard", hint: "Ketik jawaban singkat dengan tepat." },
    { id: "essay", label: "Essay / Uraian", icon: "fa-solid fa-align-left", hint: "Tulis penjelasan lengkap. Dinilai manual oleh pembuat tes." },
    { id: "skala", label: "Skala / Rating", icon: "fa-solid fa-sliders", hint: "Pilih angka pada rentang skala berikut." },
  ],
  LIKERT_DEFAULT: [
    "Tidak pernah",
    "Jarang",
    "Kadang-kadang",
    "Sering",
    "Konsisten",
  ],
  STATUS_LABEL: { draft: "Draft", aktif: "Aktif", ditutup: "Ditutup" },

  view: "daftar",
  cache: [],
  filter: { q: "", status: "", saya: "" },
  quiz: null,     // { tes, soal, answers, ragu, idx, startedAt, timerId, dirty }
  builder: null,  // { tes, soal, dirty, saving }
  hasil: null,    // { mode: 'saya'|'rekap'|'koreksi', tes, list, detail, q, status }
  _terinisialisasi: false,

  // ================= AUTH & HELPERS =================
  uid() {
    try {
      const u = OsisAuth.getUser && OsisAuth.getUser();
      if (u && u.mode === "osis" && u.id) return u.id;
    } catch {}
    return null;
  },

  bolehKelola() {
    try {
      return !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("tes"));
    } catch { return false; }
  },

  bolehKelolaItem(item) {
    if (!Tes.bolehKelola()) return false;
    if (typeof OsisAngkatanUi !== "undefined" && OsisAngkatanUi.bisaKelolaItem) {
      return OsisAngkatanUi.bisaKelolaItem("tes", item);
    }
    return true;
  },

  tipeInfo(id) {
    return Tes.TIPE.find((t) => t.id === id) || Tes.TIPE[0];
  },

  fmtAngka(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "0";
    return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, "");
  },

  fmtWaktu(iso) {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString("id-ID", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }).replace(/\./g, ":");
    } catch { return String(iso); }
  },

  fmtDurasi(detik) {
    const s = Math.max(0, Math.floor(detik || 0));
    const j = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const d = s % 60;
    const pad = (x) => String(x).padStart(2, "0");
    return j > 0 ? `${j}:${pad(m)}:${pad(d)}` : `${pad(m)}:${pad(d)}`;
  },

  fmtCountdown(detik) {
    const s = Math.max(0, Math.floor(detik || 0));
    if (s >= 86400) {
      const hari = Math.floor(s / 86400);
      return `${hari}h ${Tes.fmtDurasi(s % 86400)}`;
    }
    return Tes.fmtDurasi(s);
  },

  hitungDurasiDetik(mulaiAt, selesaiAt) {
    if (!mulaiAt || !selesaiAt) return null;
    const m = new Date(mulaiAt).getTime();
    const s = new Date(selesaiAt).getTime();
    if (!Number.isFinite(m) || !Number.isFinite(s) || s < m) return null;
    return Math.round((s - m) / 1000);
  },

  fmtDurasiPanjang(detik) {
    if (detik === null || detik === undefined || !Number.isFinite(Number(detik))) return "-";
    const s = Math.max(0, Math.floor(Number(detik)));
    if (s === 0) return "0 detik";
    const j = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const d = s % 60;
    const parts = [];
    if (j > 0) parts.push(`${j} jam`);
    if (m > 0) parts.push(`${m} menit`);
    if (d > 0) parts.push(`${d} detik`);
    return parts.join(" ");
  },

  parseTutupAtMs(cfg) {
    const raw = cfg && cfg.tutup_at ? String(cfg.tutup_at).trim() : "";
    if (!raw) return null;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  },

  isBatasWaktuLewat(tes) {
    const ms = Tes.parseTutupAtMs(tes && tes.pengaturan);
    return ms !== null && Date.now() >= ms;
  },

  toDatetimeLocalVal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  fromDatetimeLocalVal(val) {
    const s = String(val || "").trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  },

  getDeadlineMs(tes, startedAt) {
    const cfg = (tes && tes.pengaturan) || {};
    const durasi = Number(cfg.durasi_menit || 0);
    const tutupMs = Tes.parseTutupAtMs(cfg);
    const startMs = new Date(startedAt || Date.now()).getTime() || Date.now();
    const dDurasi = durasi > 0 ? startMs + durasi * 60000 : Infinity;
    const dTutup = tutupMs !== null ? tutupMs : Infinity;
    const min = Math.min(dDurasi, dTutup);
    return Number.isFinite(min) ? min : null;
  },

  huruf(i) {
    const abjad = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return i < abjad.length ? abjad[i] : String(i + 1);
  },

  acakArray(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  },

  // ================= INIT & VIEW ROUTING =================
  async init() {
    if (Tes._terinisialisasi) return;
    Tes._terinisialisasi = true;

    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") {
      location.replace("../login");
      return;
    }

    Tes.bindDaftar();
    Tes.pasangKeyboard();
    Tes.pasangBack();

    if (typeof OsisAuth.refreshAkses === "function") {
      OsisAuth.refreshAkses().then(() => {
        Tes.cekTombolBuat();
        if (Tes.view === "daftar") Tes.renderDaftar();
      }).catch(() => {});
    }
    Tes.cekTombolBuat();

    window.addEventListener("osis:angkatan-ready", () => {
      try {
        if (Tes.view === "daftar") Tes.renderDaftar();
      } catch {}
    });

    await Tes.muatDaftar();

    try {
      const p = new URLSearchParams(location.search);
      const id = parseInt(p.get("id") || "", 10);
      const mode = p.get("mode") || "";
      if (Number.isFinite(id) && id > 0) {
        if (mode === "edit" && Tes.bolehKelola()) await Tes.bukaBuilder(id);
        else if (mode === "rekap" && Tes.bolehKelola()) await Tes.bukaRekap(id);
        else await Tes.mulaiAtauHasil(id);
      }
    } catch {}
  },

  cekTombolBuat() {
    const btn = document.getElementById("btnBuatTes");
    if (btn) btn.style.display = Tes.bolehKelola() ? "" : "none";
  },

  setView(view) {
    if (Tes.view === "quiz" && view !== "quiz") Tes.hentiTimer();
    Tes.view = view;
    const map = {
      daftar: "tesViewDaftar",
      quiz: "tesViewQuiz",
      builder: "tesViewBuilder",
      hasil: "tesViewHasil",
    };
    Object.keys(map).forEach((k) => {
      const el = document.getElementById(map[k]);
      if (el) el.style.display = k === view ? "" : "none";
    });
    const sb = document.getElementById("tesTopSearch");
    if (sb) sb.style.display = view === "daftar" ? "" : "none";
    window.scrollTo(0, 0);
  },

  pasangBack() {
    if (Tes._backBound) return;
    Tes._backBound = true;
    window.addEventListener("popstate", (e) => {
      if (e.__modalKonsumsi) return;
      if (document.getElementById("uniOverlay")) return;
      if (Tes.view === "daftar") return;
      e.__modalKonsumsi = true;
      Tes.kembaliKeDaftar(true);
    });
  },

  pasangKeyboard() {
    if (Tes._kbdBound) return;
    Tes._kbdBound = true;
    document.addEventListener("keydown", (e) => {
      if (document.getElementById("uniOverlay")) return;
      if (Tes.view !== "quiz" || !Tes.quiz) return;
      const tag = (e.target && e.target.tagName) || "";
      const sedangKetik = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);

      if (e.key === "Escape") {
        if (!sedangKetik) Tes.kembaliKeDaftar();
        return;
      }
      if (sedangKetik) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        Tes.geserSoal(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        Tes.geserSoal(1);
      } else if (/^[1-9]$/.test(e.key)) {
        const s = Tes.quiz.soal[Tes.quiz.idx];
        if (!s) return;
        const num = parseInt(e.key, 10);
        if (s.tipe === "pg" || s.tipe === "multi" || s.tipe === "bobot") {
          const ops = Array.isArray(s.opsi) ? s.opsi : [];
          if (ops[num - 1]) {
            e.preventDefault();
            if (s.tipe === "multi") Tes.toggleMulti(s.id, ops[num - 1].id);
            else Tes.pilihPg(s.id, ops[num - 1].id);
          }
        } else if (s.tipe === "bs" && (num === 1 || num === 2)) {
          e.preventDefault();
          Tes.pilihBs(s.id, num === 1 ? "benar" : "salah");
        } else if (s.tipe === "skala") {
          const cfg = s.opsi || {};
          const min = Number(cfg.min ?? 1);
          const max = Number(cfg.max ?? 5);
          if (num >= min && num <= max) {
            e.preventDefault();
            Tes.pilihSkala(s.id, num);
          }
        }
      }
    });
  },

  async kembaliKeDaftar(dariPop = false) {
    if (Tes.view === "builder" && Tes.builder && Tes.builder.dirty) {
      const yakin = await showPopup("Ada perubahan di builder yang belum disimpan. Yakin kembali?", "confirm");
      if (!yakin) {
        if (dariPop) try { history.pushState({ tesView: Tes.view }, ""); } catch {}
        return;
      }
    }
    if (Tes.view === "hasil" && Tes.hasil && Tes.hasil.mode === "koreksi") {
      await Tes.bukaRekap(Tes.hasil.tes.id);
      return;
    }
    Tes.quiz = null;
    Tes.builder = null;
    Tes.hasil = null;
    Tes.setView("daftar");
    await Tes.muatDaftar(true);
  },

  // ================= VIEW 1: DAFTAR TES =================
  bindDaftar() {
    document.getElementById("tesFilterQ")?.addEventListener("input", (e) => {
      Tes.filter.q = e.target.value || "";
      Tes.renderDaftar();
    });
    document.getElementById("tesFilterStatus")?.addEventListener("change", (e) => {
      Tes.filter.status = e.target.value || "";
      Tes.renderDaftar();
    });
    document.getElementById("tesFilterSaya")?.addEventListener("change", (e) => {
      Tes.filter.saya = e.target.value || "";
      Tes.renderDaftar();
    });
    document.getElementById("btnResetFilter")?.addEventListener("click", () => Tes.resetFilter());
  },

  resetFilter() {
    Tes.filter = { q: "", status: "", saya: "" };
    const q = document.getElementById("tesFilterQ");
    const st = document.getElementById("tesFilterStatus");
    const sy = document.getElementById("tesFilterSaya");
    if (q) q.value = "";
    if (st) st.value = "";
    if (sy) sy.value = "";
    try { window.Dropdown?.segarkanSemua?.(); } catch {}
    try { window.OsisSearch?.sync?.("#tesTopSearch"); } catch {}
    Tes.renderDaftar();
  },

  async muatDaftar(diam = false) {
    const wrap = document.getElementById("tesDaftarWrap");
    const ban = document.getElementById("tesMigrasiBanner");
    if (ban) ban.style.display = "none";

    const cached = (function () { try { return Cache.get("tes_daftar"); } catch { return null; } })();
    if (cached && cached.length && !diam) {
      Tes.cache = cached;
      Tes.renderDaftar();
    } else if (wrap && !diam && !Tes.cache.length) {
      wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat daftar tes...</div>`;
    }

    try {
      const rows = await getTesDaftar();
      Tes.cache = rows || [];
      try { Cache.set("tes_daftar", Tes.cache); } catch {}
      Tes.renderDaftar();
    } catch (err) {
      if (err && err.message === "BUTUH_MIGRASI") {
        if (ban) ban.style.display = "";
        if (wrap) wrap.innerHTML = `<div class="osis-empty">Menunggu tabel tes dipasang di database.</div>`;
        return;
      }
      console.error(err);
      if (!Tes.cache.length && wrap) {
        wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat daftar tes.<br><br><button class="btn btn-red btn-sm" onclick="Tes.muatDaftar()"><i class="fa-solid fa-rotate-right"></i> Coba Lagi</button></div>`;
      } else if (!diam) {
        showToast("Gagal menyegarkan data, tampil cache terakhir.", "error");
      }
    }
  },

  renderMeta(rows) {
    const meta = document.getElementById("tesMeta");
    if (!meta) return;
    const total = rows.length;
    const aktif = rows.filter((x) => x.status === "aktif").length;
    const selesai = rows.filter((x) => x.saya_hasil).length;
    meta.innerHTML = `
      <span class="osis-badge">${total} Tes</span>
      <span class="osis-badge red">${aktif} Aktif</span>
      <span class="osis-badge">${selesai} Sudah Dikerjakan</span>`;
  },

  renderDaftar() {
    const wrap = document.getElementById("tesDaftarWrap");
    if (!wrap) return;
    const kelola = Tes.bolehKelola();
    const allRows = Tes.cache || [];
    const globalAll = allRows.filter((t) => !!t.global);
    const scopedAll = allRows.filter((t) => !t.global);
    const ownScoped = (typeof OsisAngkatanUi !== "undefined" && OsisAngkatanUi.milikAktif)
      ? OsisAngkatanUi.milikAktif(scopedAll)
      : scopedAll;
    const ownAll = [...globalAll, ...ownScoped];
    Tes.renderMeta(ownAll);

    const q = (Tes.filter.q || "").trim().toLowerCase();
    const st = Tes.filter.status || "";
    const sy = Tes.filter.saya || "";

    const data = (Tes.cache || []).filter((t) => {
      if (q && !(`${t.judul || ""} ${t.deskripsi || ""} ${t.kategori || ""} ${t.pengunggah || ""}`.toLowerCase().includes(q))) {
        return false;
      }
      if (st && t.status !== st) return false;
      if (sy === "belum" && t.saya_hasil) return false;
      if (sy === "sudah" && (!t.saya_hasil || t.saya_hasil.status !== "selesai")) return false;
      if (sy === "koreksi" && (!t.saya_hasil || t.saya_hasil.status !== "menunggu_koreksi")) return false;
      return true;
    });

    if (!(Tes.cache || []).length) {
      wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-clipboard-question"></i> Belum ada tes / kuis.${kelola ? " Klik <b>Buat Tes</b> untuk bikin kuis pertama." : ""}</div>`;
      return;
    }

    if (!data.length) {
      wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada tes yang cocok dengan filter. <a href="#" onclick="event.preventDefault();Tes.resetFilter()" style="color:var(--red);font-weight:800">Reset filter</a></div>`;
      return;
    }

    const renderCards = (items) => items.map((t) => Tes.kartuTesHtml(t)).join("");
    const hasF = !!(q || st || sy);
    const globalData = data.filter((t) => !!t.global);
    const scopedData = data.filter((t) => !t.global);
    const emptyOwnHtml = globalData.length
      ? ""
      : (!ownScoped.length
          ? `<div class="pesan-empty"><i class="fa-solid fa-clipboard-question"></i> Belum ada tes di angkatan ini.${kelola ? " Klik <b>Buat Tes</b> untuk memulai." : ""}</div>`
          : `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok di angkatan ini. <a href="#" onclick="event.preventDefault();Tes.resetFilter()" style="color:var(--red);font-weight:800">Reset filter</a></div>`);

    if (typeof OsisAngkatanUi !== "undefined" && OsisAngkatanUi.renderSplit) {
      if (globalData.length && !scopedData.length) {
        wrap.innerHTML = `<div class="ang-acc-stack">${renderCards(globalData)}</div>`;
      } else if (globalData.length) {
        wrap.innerHTML = `<div class="ang-acc-stack">${renderCards(globalData)}</div><div id="tesScopedSplit"></div>`;
        const splitEl = document.getElementById("tesScopedSplit");
        OsisAngkatanUi.renderSplit(splitEl, scopedData, {
          key: "tes",
          label: "tes",
          bodyClass: "ang-acc-stack",
          hasFilter: hasF,
          emptyOwnHtml,
          renderItems: renderCards,
          onToggleOther: () => Tes.renderDaftar(),
        });
      } else {
        OsisAngkatanUi.renderSplit(wrap, scopedData, {
          key: "tes",
          label: "tes",
          bodyClass: "ang-acc-stack",
          hasFilter: hasF,
          emptyOwnHtml,
          renderItems: renderCards,
          onToggleOther: () => Tes.renderDaftar(),
        });
      }
    } else {
      wrap.innerHTML = renderCards(data);
    }
  },

  kartuTesHtml(t) {
    const cfg = t.pengaturan || {};
    const bisaItem = Tes.bolehKelolaItem(t);
    const h = t.saya_hasil;
    const draft = Tes.bacaDraftQuiz(t.id);
    const adaDraft = !!(draft && draft.startedAt);
    const durasi = Number(cfg.durasi_menit || 0);
    const tutupMs = Tes.parseTutupAtMs(cfg);
    const lewat = tutupMs !== null && Date.now() >= tutupMs;
    const bolehUlang = cfg.boleh_ulang !== false;

    let badgeSaya = "";
    if (adaDraft && t.status === "aktif" && !lewat) {
      badgeSaya = `<span class="tes-pill koreksi"><i class="fa-solid fa-pause"></i> Sedang Dikerjakan</span>`;
    } else if (h) {
      if (h.status === "menunggu_koreksi") {
        badgeSaya = `<span class="tes-pill koreksi"><i class="fa-solid fa-hourglass-half"></i> Menunggu Koreksi</span>`;
      } else if (h.skor_total !== null && h.skor_total !== undefined) {
        const maks = Number(h.skor_maks || 0);
        const teksSkor = maks > 0
          ? `${Tes.fmtAngka(h.skor_total)} / ${Tes.fmtAngka(maks)}`
          : "Selesai";
        badgeSaya = `<span class="tes-pill skor"><i class="fa-solid fa-star"></i> Nilai: ${escapeHtml(teksSkor)}</span>`;
      } else {
        badgeSaya = `<span class="tes-pill aktif"><i class="fa-solid fa-check"></i> Sudah Dikumpulkan</span>`;
      }
    }

    let tombolUtama = "";
    if (t.status === "aktif" && !lewat) {
      if (adaDraft) {
        tombolUtama = `
          ${h ? `<button type="button" class="btn btn-white btn-sm" onclick="Tes.bukaHasilSaya(${t.id}, ${h.id})"><i class="fa-solid fa-square-poll-vertical"></i> Hasil Saya</button>` : ""}
          <button type="button" class="btn btn-red btn-sm" onclick="Tes.mulaiKerjakan(${t.id})"><i class="fa-solid fa-play"></i> Lanjutkan Tes</button>`;
      } else if (!h) {
        tombolUtama = `<button type="button" class="btn btn-red btn-sm" onclick="Tes.mulaiKerjakan(${t.id})"><i class="fa-solid fa-play"></i> Mulai Tes</button>`;
      } else if (bolehUlang) {
        tombolUtama = `
          <button type="button" class="btn btn-white btn-sm" onclick="Tes.bukaHasilSaya(${t.id}, ${h.id})"><i class="fa-solid fa-square-poll-vertical"></i> Hasil Saya</button>
          <button type="button" class="btn btn-red btn-sm" onclick="Tes.mulaiKerjakan(${t.id})"><i class="fa-solid fa-rotate-right"></i> Kerjakan Ulang</button>`;
      } else {
        tombolUtama = `<button type="button" class="btn btn-red btn-sm" onclick="Tes.bukaHasilSaya(${t.id}, ${h.id})"><i class="fa-solid fa-square-poll-vertical"></i> Lihat Hasil</button>`;
      }
    } else if (h) {
      tombolUtama = `<button type="button" class="btn btn-white btn-sm" onclick="Tes.bukaHasilSaya(${t.id}, ${h.id})"><i class="fa-solid fa-square-poll-vertical"></i> Lihat Hasil</button>`;
    } else if (t.status === "draft") {
      tombolUtama = `<span style="font-size:0.74rem;font-weight:700;color:var(--gray)">Masih draft (belum dibuka)</span>`;
    } else if (t.status === "aktif" && lewat) {
      tombolUtama = `<span style="font-size:0.74rem;font-weight:700;color:var(--gray)">Batas waktu tes sudah berakhir</span>`;
    } else {
      tombolUtama = `<span style="font-size:0.74rem;font-weight:700;color:var(--gray)">Tes ditutup</span>`;
    }

    const koreksiWarn = (bisaItem && Number(t.menunggu_koreksi_count || 0) > 0)
      ? `<span class="tes-pill koreksi"><i class="fa-solid fa-pen-to-square"></i> ${t.menunggu_koreksi_count} Perlu Koreksi</span>`
      : "";

    const durSaya = h ? Tes.hitungDurasiDetik(h.mulai_at, h.selesai_at) : null;
    const statusCls = (t.status === "aktif" && lewat) ? "ditutup" : t.status;
    const statusTxt = (t.status === "aktif" && lewat) ? "Waktu Habis" : (Tes.STATUS_LABEL[t.status] || t.status);
    const metaWaktuParts = [];
    if (durasi > 0) metaWaktuParts.push(`${durasi} menit`);
    if (tutupMs !== null) metaWaktuParts.push(`Batas: ${Tes.fmtWaktu(cfg.tutup_at)}`);
    const metaWaktuTxt = metaWaktuParts.length ? metaWaktuParts.join(" · ") : "Tanpa batas waktu";

    return `
      <div class="tes-card">
        <div class="tes-card-top">
          <h3 class="tes-card-title">${escapeHtml(t.judul || "Tanpa judul")}</h3>
          <div class="tes-badges">
            ${t.global ? `<span class="tes-pill global"><i class="fa-solid fa-globe"></i> Global</span>` : `<span class="tes-pill"><i class="fa-solid fa-users-rectangle"></i> Angkatan</span>`}
            ${t.kategori ? `<span class="tes-pill kat">${escapeHtml(t.kategori)}</span>` : ""}
            <span class="tes-pill ${escapeHtml(statusCls)}">${escapeHtml(statusTxt)}</span>
          </div>
        </div>
        ${t.deskripsi ? `<div class="tes-card-desc">${escapeHtml(t.deskripsi)}</div>` : ""}
        <div class="tes-badges">${badgeSaya}${koreksiWarn}</div>
        <div class="tes-card-meta">
          <span><i class="fa-solid fa-list-ol"></i> ${Number(t.soal_count || 0)} soal</span>
          <span><i class="fa-solid fa-award"></i> ${Tes.fmtAngka(t.poin_maks || 0)} poin maks</span>
          <span><i class="fa-regular fa-clock"></i> ${escapeHtml(metaWaktuTxt)}</span>
          ${durSaya !== null ? `<span><i class="fa-solid fa-stopwatch"></i> Durasi saya: ${escapeHtml(Tes.fmtDurasiPanjang(durSaya))}</span>` : ""}
          ${bisaItem ? `<span><i class="fa-solid fa-users"></i> ${Number(t.peserta_count || 0)} peserta</span>` : ""}
          ${t.pengunggah ? `<span><i class="fa-solid fa-user-pen"></i> ${escapeHtml(t.pengunggah)}</span>` : ""}
        </div>
        <div class="tes-card-ops">
          ${tombolUtama}
          ${bisaItem ? `<div class="tes-ops-right">
            <button type="button" class="btn btn-white btn-sm" onclick="Tes.bukaRekap(${t.id})" title="Rekap & koreksi peserta"><i class="fa-solid fa-chart-column"></i> Rekap</button>
            <button type="button" class="btn btn-white btn-sm" onclick="Tes.bukaBuilder(${t.id})" title="Edit soal & pengaturan"><i class="fa-solid fa-pen"></i> Edit</button>
            <button type="button" class="btn btn-white btn-sm" onclick="Tes.konfirmHapusTes(${t.id})" title="Hapus tes"><i class="fa-solid fa-trash-can"></i></button>
          </div>` : ""}
        </div>
      </div>`;
  },

  async mulaiAtauHasil(tesId) {
    try {
      const res = await bukaTes(tesId, false);
      if (!res || !res.tes) return;
      const cfg = res.tes.pengaturan || {};
      if (res.tes.status === "aktif" && !Tes.isBatasWaktuLewat(res.tes) && (!res.saya_hasil || cfg.boleh_ulang !== false)) {
        await Tes.mulaiKerjakan(tesId, res);
      } else if (res.saya_hasil) {
        await Tes.bukaHasilSaya(tesId, res.saya_hasil.id);
      } else {
        showToast("Tes sedang tidak aktif atau batas waktunya sudah berakhir.", "info");
      }
    } catch (err) {
      showToast(err.message || "Gagal membuka tes.", "error");
    }
  },

  async konfirmHapusTes(id) {
    const t = (Tes.cache || []).find((x) => String(x.id) === String(id));
    if (!Tes.bolehKelolaItem(t)) {
      showToast("Kamu tidak punya kendali atas tes ini.", "error");
      return;
    }
    const yakin = await showPopup(`Hapus tes "${t ? t.judul : ""}" beserta seluruh soal dan hasil pesertanya?`, "confirm");
    if (!yakin) return;
    try {
      await hapusTes(id);
      showToast("Tes berhasil dihapus.", "success");
      await Tes.muatDaftar(true);
    } catch (err) {
      showPopup("Gagal hapus: " + (err.message || err), "error");
    }
  },

  // ================= VIEW 2: MODE QUIZ (1 PERTANYAAN PER LAYAR) =================
  draftKey(tesId) {
    return `osis_tes_draft_v1_${Tes.uid() || 0}_${tesId}`;
  },

  bacaDraftQuiz(tesId) {
    try {
      const raw = localStorage.getItem(Tes.draftKey(tesId));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  simpanDraftQuiz() {
    if (!Tes.quiz) return;
    try {
      localStorage.setItem(Tes.draftKey(Tes.quiz.tes.id), JSON.stringify({
        answers: Tes.quiz.answers,
        ragu: Tes.quiz.ragu,
        idx: Tes.quiz.idx,
        orderIds: Tes.quiz.soal.map((s) => s.id),
        startedAt: Tes.quiz.startedAt,
        updatedAt: Date.now(),
      }));
    } catch {}
  },

  hapusDraftQuiz(tesId) {
    try { localStorage.removeItem(Tes.draftKey(tesId)); } catch {}
  },

  hentiTimer() {
    if (Tes.quiz && Tes.quiz.timerId) {
      clearInterval(Tes.quiz.timerId);
      Tes.quiz.timerId = null;
    }
  },

  async mulaiKerjakan(tesId, preloaded = null) {
    try {
      const data = preloaded || await bukaTes(tesId, false);
      if (!data || !data.tes) throw new Error("Tes tidak ditemukan.");
      const t = data.tes;
      const cfg = t.pengaturan || {};
      if (t.status !== "aktif") {
        showToast("Tes ini belum dibuka atau sudah ditutup.", "error");
        return;
      }
      const tutupMs = Tes.parseTutupAtMs(cfg);
      const draft = Tes.bacaDraftQuiz(t.id);
      if (tutupMs !== null && Date.now() >= tutupMs) {
        if (!draft || Date.now() - tutupMs > 120000) {
          showToast("Batas waktu tes ini sudah berakhir.", "error");
          return;
        }
      }
      if (data.saya_hasil && cfg.boleh_ulang === false) {
        await Tes.bukaHasilSaya(tesId, data.saya_hasil.id);
        return;
      }
      const rawSoal = Array.isArray(data.soal) ? data.soal : [];
      if (!rawSoal.length) {
        showToast("Tes ini belum punya pertanyaan.", "info");
        return;
      }

      if (!draft || !draft.startedAt) {
        const durasi = Number(cfg.durasi_menit || 0);
        const infoParts = [`${rawSoal.length} soal`];
        if (durasi > 0) infoParts.push(`durasi ${durasi} menit`);
        if (tutupMs !== null) infoParts.push(`batas ${Tes.fmtWaktu(cfg.tutup_at)}`);
        const yakin = await showPopup(
          `Mulai tes "${t.judul}" sekarang? (${infoParts.join(", ")}. Waktu mulai dihitung setelah konfirmasi.)`,
          "confirm"
        );
        if (!yakin) return;
      }

      let soal = rawSoal.map((s) => {
        const copy = { ...s };
        if (cfg.acak_opsi && (copy.tipe === "pg" || copy.tipe === "multi") && Array.isArray(copy.opsi)) {
          copy.opsi = Tes.acakArray(copy.opsi);
        }
        return copy;
      });

      if (draft && Array.isArray(draft.orderIds) && draft.orderIds.length) {
        const byId = new Map(soal.map((s) => [String(s.id), s]));
        const restored = [];
        draft.orderIds.forEach((oid) => {
          const hit = byId.get(String(oid));
          if (hit) { restored.push(hit); byId.delete(String(oid)); }
        });
        byId.forEach((rest) => restored.push(rest));
        soal = restored;
      } else if (cfg.acak_soal) {
        soal = Tes.acakArray(soal);
      }

      Tes.quiz = {
        tes: t,
        soal,
        answers: (draft && draft.answers && typeof draft.answers === "object") ? { ...draft.answers } : {},
        ragu: (draft && draft.ragu && typeof draft.ragu === "object") ? { ...draft.ragu } : {},
        idx: (draft && Number.isInteger(draft.idx) && draft.idx >= 0 && draft.idx < soal.length) ? draft.idx : 0,
        startedAt: (draft && draft.startedAt) ? draft.startedAt : new Date().toISOString(),
        timerId: null,
        submitting: false,
      };
      Tes.simpanDraftQuiz();

      try { history.pushState({ tesView: "quiz" }, ""); } catch {}
      Tes.setView("quiz");
      Tes.renderQuiz();
      Tes.mulaiTimer();
    } catch (err) {
      showPopup(err.message || "Gagal memulai tes.", "error");
    }
  },

  mulaiTimer() {
    Tes.hentiTimer();
    if (!Tes.quiz) return;

    const cek = () => {
      if (!Tes.quiz || Tes.view !== "quiz") { Tes.hentiTimer(); return; }
      const startMs = new Date(Tes.quiz.startedAt).getTime() || Date.now();
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const elPill = document.getElementById("tesElapsedPill");
      if (elPill) {
        elPill.innerHTML = `<i class="fa-solid fa-stopwatch"></i> ${Tes.fmtCountdown(elapsedSec)}`;
      }

      const dMs = Tes.getDeadlineMs(Tes.quiz.tes, Tes.quiz.startedAt);
      if (dMs === null) return;
      const sisa = Math.ceil((dMs - Date.now()) / 1000);
      const pill = document.getElementById("tesTimerPill");
      if (pill) {
        pill.innerHTML = `<i class="fa-regular fa-clock"></i> Sisa ${Tes.fmtCountdown(sisa)}`;
        pill.classList.toggle("danger", sisa <= 60);
      }
      if (sisa <= 0) {
        Tes.hentiTimer();
        if (!Tes.quiz.submitting) {
          showToast("Waktu habis! Jawaban otomatis dikumpulkan.", "info");
          Tes.kirimJawaban(true);
        }
      }
    };
    cek();
    Tes.quiz.timerId = setInterval(cek, 1000);
  },

  soalTerjawab(s) {
    if (!Tes.quiz || !s) return false;
    const val = Tes.quiz.answers[String(s.id)];
    if (s.tipe === "multi") return Array.isArray(val) && val.length > 0;
    if (s.tipe === "skala") return val !== undefined && val !== null && String(val).trim() !== "";
    return typeof val === "string" ? val.trim() !== "" : (val != null && String(val).trim() !== "");
  },

  renderQuiz() {
    const wrap = document.getElementById("tesViewQuiz");
    if (!wrap || !Tes.quiz) return;
    const { tes, soal, idx } = Tes.quiz;
    const s = soal[idx];
    if (!s) return;
    const deadlineMs = Tes.getDeadlineMs(tes, Tes.quiz.startedAt);
    const startMs = new Date(Tes.quiz.startedAt).getTime() || Date.now();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const info = Tes.tipeInfo(s.tipe);
    const isRagu = !!Tes.quiz.ragu[String(s.id)];
    const dijawabCount = soal.filter((q) => Tes.soalTerjawab(q)).length;
    const pct = Math.round((dijawabCount / soal.length) * 100);

    let inputHtml = "";
    const curVal = Tes.quiz.answers[String(s.id)];

    if (s.tipe === "pg" || s.tipe === "bobot") {
      const ops = Array.isArray(s.opsi) ? s.opsi : [];
      inputHtml = `<div class="tes-opsi-list">${ops.map((o, i) => {
        const oid = String(o.id ?? i);
        const sel = String(curVal || "") === oid;
        const kode = s.tipe === "bobot" ? String(i + 1) : Tes.huruf(i);
        return `<button type="button" class="tes-opsi-btn${sel ? " selected" : ""}" onclick="Tes.pilihPg(${s.id}, '${escapeHtml(oid)}')">
          <span class="tes-opsi-kode">${kode}</span>
          <span class="tes-opsi-teks">${escapeHtml(o.teks || "")}</span>
        </button>`;
      }).join("") || `<div class="osis-empty">Belum ada pilihan pada soal ini.</div>`}</div>`;
    } else if (s.tipe === "multi") {
      const ops = Array.isArray(s.opsi) ? s.opsi : [];
      const dipilih = new Set(Array.isArray(curVal) ? curVal.map(String) : []);
      inputHtml = `<div class="tes-opsi-list">${ops.map((o, i) => {
        const oid = String(o.id ?? i);
        const sel = dipilih.has(oid);
        return `<button type="button" class="tes-opsi-btn${sel ? " selected" : ""}" onclick="Tes.toggleMulti(${s.id}, '${escapeHtml(oid)}')">
          <span class="tes-opsi-kode box">${sel ? '<i class="fa-solid fa-check"></i>' : Tes.huruf(i)}</span>
          <span class="tes-opsi-teks">${escapeHtml(o.teks || "")}</span>
        </button>`;
      }).join("") || `<div class="osis-empty">Belum ada pilihan pada soal ini.</div>`}</div>`;
    } else if (s.tipe === "bs") {
      const ops = Array.isArray(s.opsi) && s.opsi.length >= 2 ? s.opsi : [
        { id: "benar", teks: "Benar" },
        { id: "salah", teks: "Salah" },
      ];
      const lblBenar = (ops.find((x) => x.id === "benar") || ops[0]).teks || "Benar";
      const lblSalah = (ops.find((x) => x.id === "salah") || ops[1]).teks || "Salah";
      const v = String(curVal || "").toLowerCase();
      inputHtml = `
        <div class="tes-bs-grid">
          <button type="button" class="tes-bs-btn benar${v === "benar" ? " selected" : ""}" onclick="Tes.pilihBs(${s.id}, 'benar')">
            <i class="fa-solid fa-circle-check"></i>
            <span>${escapeHtml(lblBenar)}</span>
          </button>
          <button type="button" class="tes-bs-btn salah${v === "salah" ? " selected" : ""}" onclick="Tes.pilihBs(${s.id}, 'salah')">
            <i class="fa-solid fa-circle-xmark"></i>
            <span>${escapeHtml(lblSalah)}</span>
          </button>
        </div>`;
    } else if (s.tipe === "isian") {
      const ph = (s.opsi && s.opsi.placeholder) || "Ketik jawaban singkat...";
      inputHtml = `
        <input type="text" id="tesInputIsian" class="admin-input" maxlength="500"
          value="${escapeHtml(typeof curVal === "string" ? curVal : "")}"
          placeholder="${escapeHtml(ph)}"
          oninput="Tes.isiTeks(${s.id}, this.value)">`;
    } else if (s.tipe === "essay") {
      const ph = (s.opsi && s.opsi.placeholder) || "Tulis jawaban uraian di sini...";
      const valStr = typeof curVal === "string" ? curVal : "";
      inputHtml = `
        <textarea id="tesInputEssay" class="admin-input admin-textarea tes-essay-area" maxlength="8000"
          placeholder="${escapeHtml(ph)}"
          oninput="Tes.isiTeks(${s.id}, this.value, 'tesEssayCount')">${escapeHtml(valStr)}</textarea>
        <div class="tes-char-info">
          <span><i class="fa-solid fa-pen-nib"></i> Dikoreksi manual oleh pembuat tes</span>
          <span id="tesEssayCount">${valStr.length} / 8000</span>
        </div>`;
    } else if (s.tipe === "skala") {
      const o = s.opsi && !Array.isArray(s.opsi) ? s.opsi : {};
      const min = Math.max(0, parseInt(o.min ?? 1, 10) || 1);
      const max = Math.min(10, Math.max(min + 1, parseInt(o.max ?? 5, 10) || 5));
      const btns = [];
      for (let n = min; n <= max; n++) {
        const sel = String(curVal ?? "") === String(n);
        btns.push(`<button type="button" class="tes-skala-btn${sel ? " selected" : ""}" onclick="Tes.pilihSkala(${s.id}, ${n})">${n}</button>`);
      }
      inputHtml = `
        <div class="tes-skala-wrap">
          <div class="tes-skala-row">${btns.join("")}</div>
          ${(o.min_label || o.max_label) ? `<div class="tes-skala-labels">
            <span>${escapeHtml(o.min_label || "")}</span>
            <span>${escapeHtml(o.max_label || "")}</span>
          </div>` : ""}
        </div>`;
    }

    const isLast = idx >= soal.length - 1;
    wrap.innerHTML = `
      <div class="tes-topbar">
        <button type="button" class="btn btn-white btn-sm" onclick="Tes.kembaliKeDaftar()">
          <i class="fa-solid fa-arrow-left"></i> Daftar
        </button>
        <div class="tes-topbar-title">
          <h2>${escapeHtml(tes.judul || "Tanpa judul")}</h2>
          <small>Pertanyaan ${idx + 1} dari ${soal.length} · ${dijawabCount} terjawab</small>
        </div>
        <div class="tes-topbar-acts">
          <span class="tes-timer elapsed" id="tesElapsedPill" title="Durasi sejak mulai tes"><i class="fa-solid fa-stopwatch"></i> ${Tes.fmtCountdown(elapsedSec)}</span>
          ${deadlineMs !== null ? `<span class="tes-timer" id="tesTimerPill" title="Sisa batas waktu"><i class="fa-regular fa-clock"></i> Sisa ${Tes.fmtCountdown(Math.ceil((deadlineMs - Date.now()) / 1000))}</span>` : ""}
        </div>
      </div>

      <div class="tes-quiz-layout">
        <div class="tes-quiz-main">
          <div class="osis-panel tes-qcard${isRagu ? " ragu" : ""}">
            <div class="tes-qhead">
              <span class="tes-qnum"><i class="${info.icon}"></i> Soal ${idx + 1} / ${soal.length}</span>
              <span class="tes-pill kat">${escapeHtml(info.label)}</span>
              ${Number(s.poin || 0) > 0 ? `<span class="tes-pill">${Tes.fmtAngka(s.poin)} poin</span>` : ""}
              ${s.wajib ? `<span class="tes-pill draft">Wajib</span>` : ""}
              <button type="button" class="tes-ragu-btn${isRagu ? " on" : ""}" onclick="Tes.toggleRagu(${s.id})">
                <i class="fa-solid fa-flag"></i> ${isRagu ? "Ragu-ragu" : "Tandai Ragu"}
              </button>
            </div>
            <div class="tes-qteks">${escapeHtml(s.pertanyaan || "(Pertanyaan kosong)")}</div>
            <div class="tes-qhint">${escapeHtml(info.hint)}</div>
            ${inputHtml}
            <div class="tes-nav-foot">
              <button type="button" class="btn btn-white" onclick="Tes.geserSoal(-1)" ${idx <= 0 ? "disabled" : ""}>
                <i class="fa-solid fa-arrow-left"></i> Sebelumnya
              </button>
              ${isLast
                ? `<button type="button" class="btn btn-red" onclick="Tes.kirimJawaban(false)">
                     <i class="fa-solid fa-paper-plane"></i> Kumpulkan
                   </button>`
                : `<button type="button" class="btn btn-red" onclick="Tes.geserSoal(1)">
                     Berikutnya <i class="fa-solid fa-arrow-right"></i>
                   </button>`}
            </div>
            <div class="tes-kbd-hint">Shortcut: <b>← / →</b> pindah soal · <b>1-9</b> pilih opsi · <b>Esc</b> keluar</div>
          </div>
        </div>

        <div class="tes-quiz-side">
          <div class="osis-panel" style="display:flex;flex-direction:column;gap:12px">
            <div class="osis-det-prog" style="margin-top:0">
              <div class="osis-det-prog-top">
                <span>Progres Pengerjaan</span>
                <b id="tesQuizProgTxt">${dijawabCount}/${soal.length} (${pct}%)</b>
              </div>
              <div class="osis-det-prog-bar${dijawabCount === soal.length ? " done" : ""}" id="tesQuizProgBar">
                <span style="width:${pct}%"></span>
              </div>
            </div>
            <div class="tes-nav-grid" id="tesNavGrid">${Tes.renderNavGridHtml()}</div>
            <div class="tes-nav-legend">
              <span><i class="tes-sw kosong"></i>Kosong</span>
              <span><i class="tes-sw isi"></i>Terjawab</span>
              <span><i class="tes-sw ragu"></i>Ragu</span>
              <span><i class="tes-sw aktif"></i>Dibuka</span>
            </div>
            <button type="button" class="btn btn-red" onclick="Tes.kirimJawaban(false)" style="width:100%">
              <i class="fa-solid fa-paper-plane"></i> Kumpulkan Jawaban
            </button>
          </div>
        </div>
      </div>`;
  },

  renderNavGridHtml() {
    if (!Tes.quiz) return "";
    return Tes.quiz.soal.map((s, i) => {
      const cls = ["tes-navbtn"];
      if (i === Tes.quiz.idx) cls.push("aktif");
      if (Tes.quiz.ragu[String(s.id)]) cls.push("ragu");
      if (Tes.soalTerjawab(s)) cls.push("isi");
      return `<button type="button" class="${cls.join(" ")}" onclick="Tes.lompatSoal(${i})" title="Soal ${i + 1}">${i + 1}<span class="tes-nv-cek">✓</span></button>`;
    }).join("");
  },

  perbaruiNavDanProgres() {
    if (!Tes.quiz) return;
    const grid = document.getElementById("tesNavGrid");
    if (grid) grid.innerHTML = Tes.renderNavGridHtml();
    const total = Tes.quiz.soal.length;
    const dijawab = Tes.quiz.soal.filter((q) => Tes.soalTerjawab(q)).length;
    const pct = total ? Math.round((dijawab / total) * 100) : 0;
    const txt = document.getElementById("tesQuizProgTxt");
    if (txt) txt.textContent = `${dijawab}/${total} (${pct}%)`;
    const bar = document.getElementById("tesQuizProgBar");
    if (bar) {
      bar.classList.toggle("done", dijawab === total);
      const span = bar.querySelector("span");
      if (span) span.style.width = pct + "%";
    }
  },

  geserSoal(arah) {
    if (!Tes.quiz) return;
    const next = Tes.quiz.idx + arah;
    if (next < 0 || next >= Tes.quiz.soal.length) return;
    Tes.quiz.idx = next;
    Tes.simpanDraftQuiz();
    Tes.renderQuiz();
  },

  lompatSoal(i) {
    if (!Tes.quiz || i < 0 || i >= Tes.quiz.soal.length) return;
    Tes.quiz.idx = i;
    Tes.simpanDraftQuiz();
    Tes.renderQuiz();
  },

  pilihPg(soalId, opsiId) {
    if (!Tes.quiz) return;
    Tes.quiz.answers[String(soalId)] = String(opsiId);
    Tes.simpanDraftQuiz();
    Tes.renderQuiz();
  },

  toggleMulti(soalId, opsiId) {
    if (!Tes.quiz) return;
    const k = String(soalId);
    const arr = Array.isArray(Tes.quiz.answers[k]) ? Tes.quiz.answers[k].map(String) : [];
    const pos = arr.indexOf(String(opsiId));
    if (pos >= 0) arr.splice(pos, 1);
    else arr.push(String(opsiId));
    Tes.quiz.answers[k] = arr;
    Tes.simpanDraftQuiz();
    Tes.renderQuiz();
  },

  pilihBs(soalId, nilai) {
    if (!Tes.quiz) return;
    Tes.quiz.answers[String(soalId)] = nilai;
    Tes.simpanDraftQuiz();
    Tes.renderQuiz();
  },

  pilihSkala(soalId, angka) {
    if (!Tes.quiz) return;
    Tes.quiz.answers[String(soalId)] = String(angka);
    Tes.simpanDraftQuiz();
    Tes.renderQuiz();
  },

  isiTeks(soalId, nilai, counterId = null) {
    if (!Tes.quiz) return;
    Tes.quiz.answers[String(soalId)] = String(nilai || "");
    if (counterId) {
      const c = document.getElementById(counterId);
      if (c) c.textContent = `${String(nilai || "").length} / 8000`;
    }
    Tes.simpanDraftQuiz();
    Tes.perbaruiNavDanProgres();
  },

  toggleRagu(soalId) {
    if (!Tes.quiz) return;
    const k = String(soalId);
    if (Tes.quiz.ragu[k]) delete Tes.quiz.ragu[k];
    else Tes.quiz.ragu[k] = true;
    Tes.simpanDraftQuiz();
    Tes.renderQuiz();
  },

  async kirimJawaban(otomatis = false) {
    if (!Tes.quiz || Tes.quiz.submitting) return;
    const { tes, soal, answers, ragu, startedAt } = Tes.quiz;

    if (!otomatis) {
      const wajibKosong = soal
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => s.wajib && !Tes.soalTerjawab(s));
      if (wajibKosong.length) {
        const noStr = wajibKosong.slice(0, 5).map((x) => "#" + (x.idx + 1)).join(", ")
          + (wajibKosong.length > 5 ? ` (+${wajibKosong.length - 5} lagi)` : "");
        showToast(`Ada ${wajibKosong.length} soal wajib yang belum diisi (${noStr}).`, "error");
        Tes.lompatSoal(wajibKosong[0].idx);
        return;
      }
      const totalJawab = soal.filter((s) => Tes.soalTerjawab(s)).length;
      const totalRagu = Object.keys(ragu || {}).length;
      const infoExtra = [];
      if (totalJawab < soal.length) infoExtra.push(`${soal.length - totalJawab} soal masih kosong`);
      if (totalRagu > 0) infoExtra.push(`${totalRagu} soal ditandai ragu-ragu`);
      const msg = `Kumpulkan jawaban "${tes.judul}"?`
        + (infoExtra.length ? ` (${infoExtra.join(", ")}.)` : " Semua soal sudah terjawab.");
      const yakin = await showPopup(msg, "confirm");
      if (!yakin) return;
    }

    Tes.quiz.submitting = true;
    Tes.hentiTimer();
    try {
      const res = await submitTes(tes.id, answers, startedAt);
      Tes.hapusDraftQuiz(tes.id);
      try { catatAksi("submit_tes", tes.judul || String(tes.id)); } catch {}
      showToast("Jawaban berhasil dikumpulkan!", "success");
      const tesId = tes.id;
      const hasilId = res && res.hasil_id;
      Tes.quiz = null;
      await Tes.bukaHasilSaya(tesId, hasilId);
    } catch (err) {
      if (Tes.quiz) Tes.quiz.submitting = false;
      showPopup("Gagal mengumpulkan: " + (err.message || err), "error");
    }
  },

  // ================= VIEW 3: BUILDER SOAL CUSTOM =================
  opsiDefaultUntuk(tipe) {
    if (tipe === "bobot") {
      return Tes.LIKERT_DEFAULT.map((teks, i) => ({
        id: String(i + 1),
        teks,
        poin: i + 1,
      }));
    }
    if (tipe === "pg" || tipe === "multi") {
      return [
        { id: "o1", teks: "" },
        { id: "o2", teks: "" },
        { id: "o3", teks: "" },
        { id: "o4", teks: "" },
      ];
    }
    if (tipe === "bs") {
      return [
        { id: "benar", teks: "Benar" },
        { id: "salah", teks: "Salah" },
      ];
    }
    if (tipe === "skala") {
      return { min: 1, max: 5, min_label: "Kurang", max_label: "Sangat Baik" };
    }
    return { placeholder: "" };
  },

  kunciDefaultUntuk(tipe, opsi) {
    if (tipe === "pg") {
      const first = Array.isArray(opsi) && opsi[0] ? opsi[0].id : "o1";
      return { id: first };
    }
    if (tipe === "bobot") return { terbalik: false };
    if (tipe === "multi") return { ids: [], parsial: true };
    if (tipe === "bs") return { nilai: "benar" };
    if (tipe === "isian") return { terima: [""] };
    if (tipe === "skala") return { nilai: "" };
    return {};
  },

  buatSoalKosong(tipe = "pg") {
    const opsi = Tes.opsiDefaultUntuk(tipe);
    return {
      key: "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      id: null,
      tipe,
      pertanyaan: "",
      opsi,
      kunci: Tes.kunciDefaultUntuk(tipe, opsi),
      poin: tipe === "skala" ? 0 : (tipe === "bobot" ? 5 : 10),
      wajib: true,
      pembahasan: "",
    };
  },

  normalisasiSoalBuilder(s) {
    const tipe = Tes.TIPE.some((x) => x.id === s.tipe) ? s.tipe : "pg";
    let opsi = s.opsi;
    if (tipe === "bobot") {
      opsi = Array.isArray(opsi) && opsi.length
        ? opsi.map((o, i) => ({
            id: String(o.id || String(i + 1)),
            teks: String(o.teks || ""),
            poin: Number.isFinite(Number(o.poin)) ? Math.max(0, Number(o.poin)) : (i + 1),
          }))
        : Tes.opsiDefaultUntuk("bobot");
    } else if (tipe === "pg" || tipe === "multi") {
      opsi = Array.isArray(opsi) && opsi.length
        ? opsi.map((o, i) => ({ id: String(o.id || ("o" + (i + 1))), teks: String(o.teks || "") }))
        : Tes.opsiDefaultUntuk(tipe);
    } else if (tipe === "bs") {
      const arr = Array.isArray(opsi) ? opsi : [];
      const b = arr.find((x) => x.id === "benar") || arr[0] || {};
      const sl = arr.find((x) => x.id === "salah") || arr[1] || {};
      opsi = [
        { id: "benar", teks: String(b.teks || "Benar") },
        { id: "salah", teks: String(sl.teks || "Salah") },
      ];
    } else if (tipe === "skala") {
      const o = opsi && !Array.isArray(opsi) ? opsi : {};
      opsi = {
        min: parseInt(o.min ?? 1, 10) || 1,
        max: parseInt(o.max ?? 5, 10) || 5,
        min_label: String(o.min_label ?? ""),
        max_label: String(o.max_label ?? ""),
      };
    } else {
      const o = opsi && !Array.isArray(opsi) ? opsi : {};
      opsi = { placeholder: String(o.placeholder || "") };
    }

    let kunci = s.kunci && typeof s.kunci === "object" ? { ...s.kunci } : {};
    if (tipe === "pg") {
      kunci = { id: String(kunci.id || "") };
    } else if (tipe === "bobot") {
      kunci = { terbalik: !!kunci.terbalik };
    } else if (tipe === "multi") {
      kunci = {
        ids: Array.isArray(kunci.ids) ? kunci.ids.map(String) : [],
        parsial: kunci.parsial !== false,
      };
    } else if (tipe === "bs") {
      kunci = { nilai: kunci.nilai === "salah" ? "salah" : (kunci.nilai === "benar" ? "benar" : "") };
    } else if (tipe === "isian") {
      const arr = Array.isArray(kunci.terima) && kunci.terima.length ? kunci.terima.map(String) : [""];
      kunci = { terima: arr };
    } else if (tipe === "skala") {
      kunci = { nilai: String(kunci.nilai ?? "") };
    } else {
      kunci = {};
    }

    const poinAuto = tipe === "bobot"
      ? Math.max(0, ...(opsi || []).map((o) => Number(o.poin) || 0))
      : (Number.isFinite(Number(s.poin)) ? Number(s.poin) : 10);

    return {
      key: "s_" + (s.id || Math.random().toString(36).slice(2, 8)),
      id: s.id || null,
      tipe,
      pertanyaan: String(s.pertanyaan || ""),
      opsi,
      kunci,
      poin: poinAuto,
      wajib: s.wajib !== false,
      pembahasan: String(s.pembahasan || ""),
    };
  },

  async bukaBuilder(tesId = null) {
    if (!Tes.bolehKelola()) {
      showToast("Kamu tidak punya hak mengelola tes.", "error");
      return;
    }

    if (tesId) {
      try {
        const data = await bukaTes(tesId, true);
        if (!data || !data.tes) throw new Error("Tes tidak ditemukan.");
        if (!Tes.bolehKelolaItem(data.tes)) {
          showToast("Kamu tidak bisa mengubah tes angkatan lain.", "error");
          return;
        }
        const cfg = data.tes.pengaturan || {};
        Tes.builder = {
          tes: {
            id: data.tes.id,
            angkatan_id: data.tes.angkatan_id,
            global: !!data.tes.global,
            judul: data.tes.judul || "",
            deskripsi: data.tes.deskripsi || "",
            kategori: data.tes.kategori || "",
            status: data.tes.status || "draft",
            pengaturan: {
              durasi_menit: Number(cfg.durasi_menit || 0),
              tutup_at: cfg.tutup_at || null,
              acak_soal: !!cfg.acak_soal,
              acak_opsi: !!cfg.acak_opsi,
              boleh_ulang: cfg.boleh_ulang !== false,
              tampil_nilai: cfg.tampil_nilai !== false,
              tampil_kunci: !!cfg.tampil_kunci,
            },
          },
          soal: (data.soal || []).map((s) => Tes.normalisasiSoalBuilder(s)),
          dirty: false,
          saving: false,
        };
      } catch (err) {
        showPopup("Gagal membuka editor tes: " + (err.message || err), "error");
        return;
      }
    } else {
      Tes.builder = {
        tes: {
          id: null,
          angkatan_id: typeof DbScope !== "undefined" ? DbScope.angkatanId() : null,
          global: false,
          judul: "",
          deskripsi: "",
          kategori: "",
          status: "draft",
          pengaturan: {
            durasi_menit: 0,
            tutup_at: null,
            acak_soal: false,
            acak_opsi: false,
            boleh_ulang: true,
            tampil_nilai: true,
            tampil_kunci: false,
          },
        },
        soal: [Tes.buatSoalKosong("pg")],
        dirty: false,
        saving: false,
      };
    }

    try { history.pushState({ tesView: "builder" }, ""); } catch {}
    Tes.setView("builder");
    Tes.renderBuilder();
  },

  renderBuilder() {
    const wrap = document.getElementById("tesViewBuilder");
    if (!wrap || !Tes.builder) return;
    const { tes, soal } = Tes.builder;
    const cfg = tes.pengaturan;
    const totalPoin = soal.reduce((acc, s) => acc + (Number(s.poin) || 0), 0);

    const soalCards = soal.length
      ? soal.map((s, idx) => Tes.builderSoalHtml(s, idx)).join("")
      : `<div class="osis-panel"><div class="osis-empty">Belum ada pertanyaan. Klik salah satu tipe soal di panel kiri atau di bawah untuk menambah soal.</div></div>`;

    wrap.innerHTML = `
      <div class="tes-topbar">
        <button type="button" class="btn btn-white btn-sm" onclick="Tes.kembaliKeDaftar()">
          <i class="fa-solid fa-arrow-left"></i> Daftar
        </button>
        <div class="tes-topbar-title">
          <h2>${tes.id ? "Edit Tes" : "Buat Tes Baru"}</h2>
          <small id="tesBuilderMeta">${soal.length} soal · ${Tes.fmtAngka(totalPoin)} poin total${Tes.builder.dirty ? " · belum disimpan" : ""}</small>
        </div>
        <div class="tes-topbar-acts">
          ${tes.id && tes.status === "aktif" ? `<button type="button" class="btn btn-white btn-sm" onclick="Tes.bukaKerjakanDariBuilder()"><i class="fa-solid fa-play"></i> Kerjakan</button>` : ""}
          <button type="button" class="btn btn-red" id="btnSimpanTes" onclick="Tes.simpanBuilder()">
            <i class="fa-solid fa-floppy-disk"></i> Simpan Tes
          </button>
        </div>
      </div>

      <div class="tes-builder-grid">
        <div class="tes-builder-side">
          <div class="osis-panel" style="display:flex;flex-direction:column;gap:10px">
            <h3 class="ww-judul" style="font-size:0.96rem;font-weight:900"><i class="fa-solid fa-sliders" style="color:var(--red)"></i> Informasi &amp; Pengaturan</h3>
            <div class="field">
              <label>Judul Tes</label>
              <input type="text" class="admin-input" maxlength="180" value="${escapeHtml(tes.judul)}"
                placeholder="cth: Kuis Evaluasi Proker & AD/ART"
                oninput="Tes.setMetaTes('judul', this.value)">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="field">
                <label>Kategori (opsional)</label>
                <input type="text" class="admin-input" maxlength="60" list="tesKategoriList"
                  value="${escapeHtml(tes.kategori)}" placeholder="Evaluasi / LDKS"
                  oninput="Tes.setMetaTes('kategori', this.value)">
                <datalist id="tesKategoriList">
                  <option value="Evaluasi"></option>
                  <option value="Materi"></option>
                  <option value="LDKS"></option>
                  <option value="Umum"></option>
                </datalist>
              </div>
              <div class="field">
                <label>Status</label>
                <select class="admin-input" onchange="Tes.setMetaTes('status', this.value)">
                  <option value="draft" ${tes.status === "draft" ? "selected" : ""}>Draft (Tersembunyi)</option>
                  <option value="aktif" ${tes.status === "aktif" ? "selected" : ""}>Aktif (Bisa Dikerjakan)</option>
                  <option value="ditutup" ${tes.status === "ditutup" ? "selected" : ""}>Ditutup</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Sasaran Peserta</label>
              <select class="admin-input" onchange="Tes.setMetaTes('global', this.value === '1')">
                <option value="0" ${!tes.global ? "selected" : ""}>Angkatan Ini Saja</option>
                <option value="1" ${tes.global ? "selected" : ""}>Global (Semua Angkatan)</option>
              </select>
            </div>
            <div class="field">
              <label>Deskripsi / Petunjuk</label>
              <textarea class="admin-input admin-textarea" rows="3" maxlength="2000"
                placeholder="Petunjuk pengerjaan untuk peserta..."
                oninput="Tes.setMetaTes('deskripsi', this.value)">${escapeHtml(tes.deskripsi)}</textarea>
            </div>
            <div class="field">
              <label>Durasi Pengerjaan (menit, 0 = bebas)</label>
              <input type="number" min="0" max="1440" class="admin-input"
                value="${Number(cfg.durasi_menit || 0)}"
                oninput="Tes.setCfgTes('durasi_menit', Math.max(0, Math.min(1440, parseInt(this.value || 0, 10) || 0)))">
            </div>
            <div class="field">
              <label>Batas Akhir (Tanggal &amp; Jam, opsional)</label>
              <div class="tes-dt-row">
                <input type="datetime-local" id="tesCfgTutupAt" class="admin-input"
                  value="${escapeHtml(Tes.toDatetimeLocalVal(cfg.tutup_at))}"
                  oninput="Tes.setCfgTutupAt(this.value)">
                <button type="button" class="btn btn-white btn-sm" onclick="Tes.setCfgTutupAt('', true)" title="Kosongkan batas tanggal &amp; jam">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
              <small style="font-size:0.71rem;font-weight:600;color:var(--gray);line-height:1.4">
                Bisa isi salah satu atau keduanya. Kalau dua-duanya diisi, waktu yang lebih dulu habis yang dipakai.
              </small>
            </div>
            <div class="tes-switch-list">
              <label class="tes-switch">
                <input type="checkbox" ${cfg.acak_soal ? "checked" : ""} onchange="Tes.setCfgTes('acak_soal', this.checked)">
                <span>Acak urutan soal</span>
              </label>
              <label class="tes-switch">
                <input type="checkbox" ${cfg.acak_opsi ? "checked" : ""} onchange="Tes.setCfgTes('acak_opsi', this.checked)">
                <span>Acak urutan pilihan (PG &amp; Pilih &gt;1)</span>
              </label>
              <label class="tes-switch">
                <input type="checkbox" ${cfg.boleh_ulang ? "checked" : ""} onchange="Tes.setCfgTes('boleh_ulang', this.checked)">
                <span>Peserta boleh mengerjakan ulang</span>
              </label>
              <label class="tes-switch">
                <input type="checkbox" ${cfg.tampil_nilai ? "checked" : ""} onchange="Tes.setCfgTes('tampil_nilai', this.checked)">
                <span>Langsung tampilkan skor setelah selesai</span>
              </label>
              <label class="tes-switch">
                <input type="checkbox" ${cfg.tampil_kunci ? "checked" : ""} onchange="Tes.setCfgTes('tampil_kunci', this.checked)">
                <span>Tampilkan kunci &amp; pembahasan setelah selesai</span>
              </label>
            </div>
          </div>

          <div class="osis-panel" style="display:flex;flex-direction:column;gap:8px">
            <h3 class="ww-judul" style="font-size:0.9rem;font-weight:900"><i class="fa-solid fa-plus-circle" style="color:var(--red)"></i> Tambah Pertanyaan</h3>
            <div class="tes-add-grid">
              ${Tes.TIPE.map((t) => `<button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahSoal('${t.id}')">
                <i class="${t.icon}"></i> ${escapeHtml(t.label)}
              </button>`).join("")}
            </div>
          </div>
        </div>

        <div class="tes-builder-main">
          ${soalCards}
          <div class="osis-panel" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahSoal('pg')"><i class="fa-solid fa-plus"></i> PG</button>
              <button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahSoal('multi')"><i class="fa-solid fa-plus"></i> Pilih &gt;1</button>
              <button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahSoal('bs')"><i class="fa-solid fa-plus"></i> Benar/Salah</button>
              <button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahSoal('isian')"><i class="fa-solid fa-plus"></i> Isian</button>
              <button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahSoal('essay')"><i class="fa-solid fa-plus"></i> Essay</button>
            </div>
            <button type="button" class="btn btn-red" onclick="Tes.simpanBuilder()">
              <i class="fa-solid fa-floppy-disk"></i> Simpan Tes
            </button>
          </div>
        </div>
      </div>`;
  },

  builderSoalHtml(s, idx) {
    const info = Tes.tipeInfo(s.tipe);
    const total = Tes.builder.soal.length;
    let bodyEditor = "";

    if (s.tipe === "bobot") {
      const ops = Array.isArray(s.opsi) ? s.opsi : [];
      const isRev = ops.length >= 2 && Number(ops[0].poin || 0) > Number(ops[ops.length - 1].poin || 0);
      bodyEditor = `
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
            <label style="font-size:0.74rem;font-weight:800">Pilihan &amp; Poin Masing-masing</label>
            ${isRev ? `<span class="tes-pill draft">Terbalik (R)</span>` : ""}
          </div>
          ${ops.map((o, oi) => `<div class="tes-opsi-edit-row">
            <span class="tes-opsi-kode" style="width:28px;height:28px;font-size:0.74rem">${oi + 1}</span>
            <input type="text" class="admin-input" maxlength="500" value="${escapeHtml(o.teks || "")}"
              placeholder="Teks pilihan ${oi + 1}..."
              oninput="Tes.setOpsiTeks(${idx}, ${oi}, this.value)">
            <input type="number" min="0" max="1000" step="0.5" class="admin-input tes-poin-inp"
              value="${Number(o.poin ?? 0)}" title="Poin pilihan ini"
              oninput="Tes.setOpsiPoin(${idx}, ${oi}, this.value)">
            ${ops.length > 2 ? `<button type="button" class="icon-btn icon-btn-sm" title="Hapus pilihan" onclick="Tes.hapusOpsi(${idx}, ${oi})"><i class="fa-solid fa-xmark"></i></button>` : ""}
          </div>`).join("")}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px">
            <button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahOpsi(${idx})">
              <i class="fa-solid fa-plus"></i> Tambah Pilihan
            </button>
            <button type="button" class="btn btn-white btn-sm" onclick="Tes.presetLikertBobot(${idx})">
              <i class="fa-solid fa-wand-magic-sparkles"></i> Preset 1–5
            </button>
            <button type="button" class="btn btn-white btn-sm" onclick="Tes.balikPoinBobot(${idx})">
              <i class="fa-solid fa-right-left"></i> Balik Poin (R)
            </button>
          </div>
        </div>`;
    } else if (s.tipe === "pg" || s.tipe === "multi") {
      const ops = Array.isArray(s.opsi) ? s.opsi : [];
      const keyIds = new Set(s.tipe === "pg" ? [String((s.kunci && s.kunci.id) || "")] : (Array.isArray(s.kunci && s.kunci.ids) ? s.kunci.ids.map(String) : []));
      bodyEditor = `
        <div>
          <label style="font-size:0.74rem;font-weight:800;display:block;margin-bottom:6px">
            Pilihan Jawaban (${s.tipe === "pg" ? "centang 1 kunci benar" : "centang 1 atau lebih kunci benar"})
          </label>
          ${ops.map((o, oi) => {
            const on = keyIds.has(String(o.id));
            return `<div class="tes-opsi-edit-row">
              <label class="tes-key-pick${on ? " on" : ""}" title="Jadikan kunci jawaban">
                <input type="${s.tipe === "pg" ? "radio" : "checkbox"}" name="kunci_${s.key}" ${on ? "checked" : ""}
                  onchange="Tes.setKunciOpsi(${idx}, '${escapeHtml(o.id)}', this.checked)">
                <span>${Tes.huruf(oi)}</span>
              </label>
              <input type="text" class="admin-input" maxlength="500" value="${escapeHtml(o.teks || "")}"
                placeholder="Teks pilihan ${Tes.huruf(oi)}..."
                oninput="Tes.setOpsiTeks(${idx}, ${oi}, this.value)">
              ${ops.length > 2 ? `<button type="button" class="icon-btn icon-btn-sm" title="Hapus pilihan" onclick="Tes.hapusOpsi(${idx}, ${oi})"><i class="fa-solid fa-xmark"></i></button>` : ""}
            </div>`;
          }).join("")}
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px">
            <button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahOpsi(${idx})">
              <i class="fa-solid fa-plus"></i> Tambah Pilihan
            </button>
            ${s.tipe === "multi" ? `<label style="display:inline-flex;align-items:center;gap:6px;font-size:0.76rem;font-weight:700;cursor:pointer">
              <input type="checkbox" ${s.kunci && s.kunci.parsial !== false ? "checked" : ""} onchange="Tes.setParsial(${idx}, this.checked)">
              Nilai parsial (proporsional jika sebagian benar)
            </label>` : ""}
          </div>
        </div>`;
    } else if (s.tipe === "bs") {
      const ops = Array.isArray(s.opsi) && s.opsi.length >= 2 ? s.opsi : Tes.opsiDefaultUntuk("bs");
      const kVal = (s.kunci && s.kunci.nilai) || "";
      bodyEditor = `
        <div>
          <label style="font-size:0.74rem;font-weight:800;display:block;margin-bottom:6px">Label &amp; Kunci Benar/Salah</label>
          ${ops.map((o, oi) => {
            const on = kVal === o.id;
            return `<div class="tes-opsi-edit-row">
              <label class="tes-key-pick${on ? " on" : ""}">
                <input type="radio" name="kunci_bs_${s.key}" ${on ? "checked" : ""}
                  onchange="Tes.setKunciBs(${idx}, '${escapeHtml(o.id)}')">
                <span>Kunci</span>
              </label>
              <input type="text" class="admin-input" maxlength="80" value="${escapeHtml(o.teks || "")}"
                oninput="Tes.setOpsiTeks(${idx}, ${oi}, this.value)">
            </div>`;
          }).join("")}
        </div>`;
    } else if (s.tipe === "isian") {
      const terima = (s.kunci && Array.isArray(s.kunci.terima) && s.kunci.terima.length) ? s.kunci.terima : [""];
      bodyEditor = `
        <div>
          <label style="font-size:0.74rem;font-weight:800;display:block;margin-bottom:6px">
            Kunci Jawaban yang Diterima (tidak peka huruf besar/kecil)
          </label>
          ${terima.map((v, vi) => `<div class="tes-opsi-edit-row">
            <input type="text" class="admin-input" maxlength="300" value="${escapeHtml(v)}"
              placeholder="Variasi jawaban benar ke-${vi + 1}..."
              oninput="Tes.setIsianKunci(${idx}, ${vi}, this.value)">
            ${terima.length > 1 ? `<button type="button" class="icon-btn icon-btn-sm" title="Hapus variasi" onclick="Tes.hapusIsianKunci(${idx}, ${vi})"><i class="fa-solid fa-xmark"></i></button>` : ""}
          </div>`).join("")}
          <button type="button" class="btn btn-white btn-sm" onclick="Tes.tambahIsianKunci(${idx})">
            <i class="fa-solid fa-plus"></i> Tambah Variasi Kunci
          </button>
        </div>`;
    } else if (s.tipe === "essay") {
      bodyEditor = `
        <div class="osis-det-alert warn" style="margin-top:0">
          <i class="fa-solid fa-pen-nib"></i>
          <span>Soal essay dinilai manual di menu <b>Rekap</b> setelah peserta mengumpulkan. Jika poin &gt; 0, status peserta otomatis <b>Menunggu Koreksi</b> dulu.</span>
        </div>`;
    } else if (s.tipe === "skala") {
      const o = s.opsi && !Array.isArray(s.opsi) ? s.opsi : { min: 1, max: 5, min_label: "", max_label: "" };
      bodyEditor = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
          <div class="field">
            <label>Nilai Min</label>
            <input type="number" min="0" max="5" class="admin-input" value="${Number(o.min ?? 1)}"
              oninput="Tes.setSkalaCfg(${idx}, 'min', parseInt(this.value || 1, 10))">
          </div>
          <div class="field">
            <label>Nilai Max</label>
            <input type="number" min="2" max="10" class="admin-input" value="${Number(o.max ?? 5)}"
              oninput="Tes.setSkalaCfg(${idx}, 'max', parseInt(this.value || 5, 10))">
          </div>
          <div class="field">
            <label>Label Min</label>
            <input type="text" class="admin-input" maxlength="60" value="${escapeHtml(o.min_label || "")}" placeholder="cth: Kurang"
              oninput="Tes.setSkalaCfg(${idx}, 'min_label', this.value)">
          </div>
          <div class="field">
            <label>Label Max</label>
            <input type="text" class="admin-input" maxlength="60" value="${escapeHtml(o.max_label || "")}" placeholder="cth: Sangat Baik"
              oninput="Tes.setSkalaCfg(${idx}, 'max_label', this.value)">
          </div>
        </div>
        <div class="field" style="margin-top:6px">
          <label>Kunci Angka (kosongkan jika hanya survei / tanpa kunci)</label>
          <input type="text" class="admin-input" maxlength="4" value="${escapeHtml((s.kunci && s.kunci.nilai) || "")}" placeholder="Kosong = tanpa kunci"
            oninput="Tes.setSkalaKunci(${idx}, this.value)">
        </div>`;
    }

    return `
      <div class="tes-qedit" data-qidx="${idx}">
        <div class="tes-qedit-head">
          <span class="tes-qedit-num">${idx + 1}</span>
          <span class="tes-pill kat"><i class="${info.icon}"></i> ${escapeHtml(info.label)}</span>
          <div class="tes-qedit-ops">
            <button type="button" class="icon-btn icon-btn-sm" title="Naik" onclick="Tes.geserUrutanBuilder(${idx}, -1)" ${idx <= 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" class="icon-btn icon-btn-sm" title="Turun" onclick="Tes.geserUrutanBuilder(${idx}, 1)" ${idx >= total - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" class="icon-btn icon-btn-sm" title="Duplikat soal" onclick="Tes.duplikatSoal(${idx})"><i class="fa-regular fa-copy"></i></button>
            <button type="button" class="icon-btn icon-btn-sm" title="Hapus soal" onclick="Tes.hapusSoalBuilder(${idx})"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </div>

        <div class="tes-qedit-row2">
          <div class="field">
            <label>Tipe Soal</label>
            <select class="admin-input" data-dd="off" onchange="Tes.ubahTipeSoal(${idx}, this.value)">
              ${Tes.TIPE.map((t) => `<option value="${t.id}" ${s.tipe === t.id ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Bobot Poin${s.tipe === "bobot" ? " (Maks Opsi)" : ""}</label>
            <input type="number" min="0" max="10000" step="1" class="admin-input" id="tesBobotMaks_${idx}"
              value="${Number(s.poin ?? 10)}" ${s.tipe === "bobot" ? "disabled" : ""}
              oninput="Tes.setSoalField(${idx}, 'poin', Math.max(0, Number(this.value) || 0))">
          </div>
          <label class="tes-switch" style="padding:9px 11px">
            <input type="checkbox" ${s.wajib ? "checked" : ""} onchange="Tes.setSoalField(${idx}, 'wajib', this.checked)">
            <span>Wajib</span>
          </label>
        </div>

        <div class="field">
          <label>Pertanyaan</label>
          <textarea class="admin-input admin-textarea" rows="2" maxlength="4000" placeholder="Tulis pertanyaan di sini..."
            oninput="Tes.setSoalField(${idx}, 'pertanyaan', this.value)">${escapeHtml(s.pertanyaan)}</textarea>
        </div>

        ${bodyEditor}

        <div class="field">
          <label>Pembahasan (opsional — tampil jika kunci diaktifkan)</label>
          <input type="text" class="admin-input" maxlength="4000" value="${escapeHtml(s.pembahasan)}"
            placeholder="Penjelasan kenapa jawaban tersebut benar..."
            oninput="Tes.setSoalField(${idx}, 'pembahasan', this.value)">
        </div>
      </div>`;
  },

  tandaiBuilderKotor() {
    if (!Tes.builder) return;
    Tes.builder.dirty = true;
    const m = document.getElementById("tesBuilderMeta");
    if (m) {
      const totalPoin = Tes.builder.soal.reduce((acc, s) => acc + (Number(s.poin) || 0), 0);
      m.textContent = `${Tes.builder.soal.length} soal · ${Tes.fmtAngka(totalPoin)} poin total · belum disimpan`;
    }
  },

  setMetaTes(k, v) {
    if (!Tes.builder) return;
    Tes.builder.tes[k] = v;
    Tes.tandaiBuilderKotor();
  },

  setCfgTes(k, v) {
    if (!Tes.builder) return;
    Tes.builder.tes.pengaturan[k] = v;
    Tes.tandaiBuilderKotor();
  },

  setCfgTutupAt(localVal, clearEl = false) {
    if (!Tes.builder) return;
    const iso = Tes.fromDatetimeLocalVal(localVal);
    Tes.builder.tes.pengaturan.tutup_at = iso;
    if (clearEl) {
      const el = document.getElementById("tesCfgTutupAt");
      if (el) el.value = "";
    }
    Tes.tandaiBuilderKotor();
  },

  setSoalField(idx, k, v) {
    if (!Tes.builder || !Tes.builder.soal[idx]) return;
    Tes.builder.soal[idx][k] = v;
    Tes.tandaiBuilderKotor();
  },

  tambahSoal(tipe = "pg") {
    if (!Tes.builder) return;
    Tes.builder.soal.push(Tes.buatSoalKosong(tipe));
    Tes.builder.dirty = true;
    Tes.renderBuilder();
    setTimeout(() => {
      const last = document.querySelector(`.tes-qedit[data-qidx="${Tes.builder.soal.length - 1}"]`);
      if (last) last.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  },

  duplikatSoal(idx) {
    if (!Tes.builder || !Tes.builder.soal[idx]) return;
    const src = JSON.parse(JSON.stringify(Tes.builder.soal[idx]));
    src.id = null;
    src.key = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    Tes.builder.soal.splice(idx + 1, 0, src);
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  hapusSoalBuilder(idx) {
    if (!Tes.builder || !Tes.builder.soal[idx]) return;
    Tes.builder.soal.splice(idx, 1);
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  geserUrutanBuilder(idx, arah) {
    if (!Tes.builder) return;
    const next = idx + arah;
    if (next < 0 || next >= Tes.builder.soal.length) return;
    const arr = Tes.builder.soal;
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  ubahTipeSoal(idx, tipeBaru) {
    if (!Tes.builder || !Tes.builder.soal[idx]) return;
    const s = Tes.builder.soal[idx];
    const lama = s.tipe;
    if (lama === tipeBaru) return;
    s.tipe = tipeBaru;
    if ((lama === "pg" && tipeBaru === "multi") || (lama === "multi" && tipeBaru === "pg")) {
      if (tipeBaru === "multi") {
        const k = s.kunci && s.kunci.id ? [String(s.kunci.id)] : [];
        s.kunci = { ids: k, parsial: true };
      } else {
        const k = s.kunci && Array.isArray(s.kunci.ids) && s.kunci.ids[0] ? String(s.kunci.ids[0]) : "";
        s.kunci = { id: k };
      }
    } else {
      s.opsi = Tes.opsiDefaultUntuk(tipeBaru);
      s.kunci = Tes.kunciDefaultUntuk(tipeBaru, s.opsi);
      if (tipeBaru === "skala") s.poin = 0;
      else if (tipeBaru === "bobot") s.poin = 5;
      else if (s.poin === 0 || lama === "bobot") s.poin = 10;
    }
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  setOpsiTeks(idx, oi, teks) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s || !Array.isArray(s.opsi) || !s.opsi[oi]) return;
    s.opsi[oi].teks = teks;
    Tes.tandaiBuilderKotor();
  },

  setOpsiPoin(idx, oi, val) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s || !Array.isArray(s.opsi) || !s.opsi[oi]) return;
    s.opsi[oi].poin = Math.max(0, parseFloat(val) || 0);
    s.poin = Math.max(0, ...s.opsi.map((o) => Number(o.poin) || 0));
    const inp = document.getElementById("tesBobotMaks_" + idx);
    if (inp) inp.value = s.poin;
    Tes.tandaiBuilderKotor();
  },

  presetLikertBobot(idx) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s || s.tipe !== "bobot") return;
    s.opsi = Tes.opsiDefaultUntuk("bobot");
    s.poin = 5;
    s.kunci = { terbalik: false };
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  balikPoinBobot(idx) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s || s.tipe !== "bobot" || !Array.isArray(s.opsi) || !s.opsi.length) return;
    const pts = s.opsi.map((o) => Number(o.poin) || 0).reverse();
    s.opsi.forEach((o, i) => { o.poin = pts[i]; });
    s.poin = Math.max(0, ...s.opsi.map((o) => Number(o.poin) || 0));
    s.kunci = { terbalik: s.opsi.length >= 2 && Number(s.opsi[0].poin) > Number(s.opsi[s.opsi.length - 1].poin) };
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  tambahOpsi(idx) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s || !Array.isArray(s.opsi)) return;
    const oid = s.tipe === "bobot"
      ? String(s.opsi.length + 1) + "_" + Date.now().toString(36).slice(-3)
      : "o" + Date.now().toString(36).slice(-4) + (s.opsi.length + 1);
    const baru = { id: oid, teks: "" };
    if (s.tipe === "bobot") {
      baru.poin = s.opsi.length + 1;
      s.poin = Math.max(Number(s.poin) || 0, baru.poin);
    }
    s.opsi.push(baru);
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  hapusOpsi(idx, oi) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s || !Array.isArray(s.opsi) || s.opsi.length <= 2) return;
    const [removed] = s.opsi.splice(oi, 1);
    if (s.tipe === "bobot") {
      s.poin = Math.max(0, ...s.opsi.map((o) => Number(o.poin) || 0));
    }
    if (removed) {
      if (s.tipe === "pg" && s.kunci && s.kunci.id === removed.id) s.kunci.id = "";
      if (s.tipe === "multi" && s.kunci && Array.isArray(s.kunci.ids)) {
        s.kunci.ids = s.kunci.ids.filter((x) => x !== removed.id);
      }
    }
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  setKunciOpsi(idx, oid, checked) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s) return;
    if (s.tipe === "pg") {
      s.kunci = { id: String(oid) };
    } else if (s.tipe === "multi") {
      const set = new Set(Array.isArray(s.kunci && s.kunci.ids) ? s.kunci.ids.map(String) : []);
      if (checked) set.add(String(oid));
      else set.delete(String(oid));
      s.kunci = { ids: Array.from(set), parsial: s.kunci ? s.kunci.parsial !== false : true };
    }
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  setParsial(idx, checked) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s) return;
    s.kunci = s.kunci || {};
    s.kunci.parsial = !!checked;
    Tes.tandaiBuilderKotor();
  },

  setKunciBs(idx, val) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s) return;
    s.kunci = { nilai: val };
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  setIsianKunci(idx, vi, val) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s) return;
    s.kunci = s.kunci || { terima: [""] };
    if (!Array.isArray(s.kunci.terima)) s.kunci.terima = [""];
    s.kunci.terima[vi] = val;
    Tes.tandaiBuilderKotor();
  },

  tambahIsianKunci(idx) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s) return;
    s.kunci = s.kunci || { terima: [] };
    if (!Array.isArray(s.kunci.terima)) s.kunci.terima = [];
    s.kunci.terima.push("");
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  hapusIsianKunci(idx, vi) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s || !s.kunci || !Array.isArray(s.kunci.terima) || s.kunci.terima.length <= 1) return;
    s.kunci.terima.splice(vi, 1);
    Tes.builder.dirty = true;
    Tes.renderBuilder();
  },

  setSkalaCfg(idx, k, val) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s) return;
    if (!s.opsi || Array.isArray(s.opsi)) s.opsi = Tes.opsiDefaultUntuk("skala");
    s.opsi[k] = val;
    Tes.tandaiBuilderKotor();
  },

  setSkalaKunci(idx, val) {
    const s = Tes.builder && Tes.builder.soal[idx];
    if (!s) return;
    s.kunci = { nilai: String(val || "").replace(/[^\d-]/g, "") };
    Tes.tandaiBuilderKotor();
  },

  async bukaKerjakanDariBuilder() {
    if (!Tes.builder || !Tes.builder.tes.id) return;
    if (Tes.builder.dirty) {
      const simpanDulu = await showPopup("Simpan perubahan sebelum mengerjakan tes?", "confirm");
      if (simpanDulu) {
        const ok = await Tes.simpanBuilder();
        if (!ok) return;
      }
    }
    await Tes.mulaiKerjakan(Tes.builder.tes.id);
  },

  async simpanBuilder() {
    if (!Tes.builder || Tes.builder.saving) return false;
    const { tes, soal } = Tes.builder;
    if (!String(tes.judul || "").trim()) {
      showToast("Judul tes wajib diisi.", "error");
      return false;
    }
    for (let i = 0; i < soal.length; i++) {
      const s = soal[i];
      if (!String(s.pertanyaan || "").trim()) {
        showToast(`Pertanyaan #${i + 1} masih kosong.`, "error");
        return false;
      }
      if (s.tipe === "pg" || s.tipe === "multi" || s.tipe === "bobot") {
        const validOps = (s.opsi || []).filter((o) => String(o.teks || "").trim() !== "");
        if (validOps.length < 2) {
          showToast(`Soal #${i + 1} minimal butuh 2 pilihan yang terisi.`, "error");
          return false;
        }
      }
    }

    const btn = document.getElementById("btnSimpanTes");
    Tes.builder.saving = true;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }

    try {
      const res = await simpanTes({
        id: tes.id,
        angkatan_id: tes.angkatan_id,
        global: !!tes.global,
        judul: tes.judul.trim(),
        deskripsi: tes.deskripsi || "",
        kategori: tes.kategori || "",
        status: tes.status,
        pengaturan: tes.pengaturan,
        soal: soal.map((s) => ({
          id: s.id || null,
          tipe: s.tipe,
          pertanyaan: s.pertanyaan,
          opsi: s.opsi,
          kunci: s.kunci,
          poin: Number(s.poin) || 0,
          wajib: !!s.wajib,
          pembahasan: s.pembahasan || "",
        })),
      });
      const newId = res && res.id;
      try { catatAksi(tes.id ? "edit_tes" : "buat_tes", tes.judul); } catch {}
      showToast("Tes berhasil disimpan!", "success");

      // Muat ulang agar soal.id sinkron dengan server
      const fresh = await bukaTes(newId, true);
      if (fresh && fresh.tes) {
        Tes.builder.tes.id = fresh.tes.id;
        Tes.builder.tes.angkatan_id = fresh.tes.angkatan_id;
        Tes.builder.soal = (fresh.soal || []).map((x) => Tes.normalisasiSoalBuilder(x));
      }
      Tes.builder.dirty = false;
      Tes.builder.saving = false;
      Tes.renderBuilder();
      return true;
    } catch (err) {
      Tes.builder.saving = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Tes'; }
      showPopup("Gagal menyimpan tes: " + (err.message || err), "error");
      return false;
    }
  },

  // ================= VIEW 4: HASIL & KOREKSI =================
  async bukaHasilSaya(tesId, hasilIdOpt = null) {
    try {
      let detail = null;
      if (hasilIdOpt) {
        detail = await getTesHasilDetail(hasilIdOpt);
      } else {
        const d = await bukaTes(tesId, false);
        if (!d || !d.saya_hasil) {
          showToast("Kamu belum punya hasil untuk tes ini.", "info");
          return;
        }
        detail = await getTesHasilDetail(d.saya_hasil.id);
      }
      if (!detail || !detail.tes || !detail.hasil) throw new Error("Hasil tidak ditemukan.");
      Tes.hasil = { mode: "saya", detail };
      try { history.pushState({ tesView: "hasil" }, ""); } catch {}
      Tes.setView("hasil");
      Tes.renderHasil();
    } catch (err) {
      showPopup("Gagal memuat hasil: " + (err.message || err), "error");
    }
  },

  async bukaRekap(tesId) {
    if (!Tes.bolehKelola()) {
      showToast("Kamu tidak punya hak melihat rekap peserta.", "error");
      return;
    }
    try {
      const [info, list] = await Promise.all([
        bukaTes(tesId, true),
        getTesHasilList(tesId),
      ]);
      if (!info || !info.tes) throw new Error("Tes tidak ditemukan.");
      Tes.hasil = {
        mode: "rekap",
        tes: info.tes,
        soal: info.soal || [],
        list: list || [],
        q: "",
        status: "",
      };
      try { history.pushState({ tesView: "rekap" }, ""); } catch {}
      Tes.setView("hasil");
      Tes.renderHasil();
    } catch (err) {
      showPopup("Gagal memuat rekap: " + (err.message || err), "error");
    }
  },

  async bukaKoreksi(hasilId) {
    try {
      const detail = await getTesHasilDetail(hasilId);
      if (!detail || !detail.tes || !detail.hasil) throw new Error("Detail hasil tidak ditemukan.");
      Tes.hasil = {
        mode: "koreksi",
        tes: detail.tes,
        detail,
        koreksiMap: {},
      };
      // Pre-fill manual score map untuk essay / manual item
      const pen = detail.hasil.penilaian || {};
      (detail.soal || []).forEach((s) => {
        const p = pen[String(s.id)] || {};
        if (s.tipe === "essay" || p.manual) {
          Tes.hasil.koreksiMap[String(s.id)] = {
            poin: p.poin ?? 0,
            catatan: p.catatan || "",
          };
        }
      });
      Tes.setView("hasil");
      Tes.renderHasil();
    } catch (err) {
      showPopup("Gagal memuat detail peserta: " + (err.message || err), "error");
    }
  },

  formatJawabanTeks(s, rawVal) {
    if (s.tipe === "pg" || s.tipe === "bobot") {
      const ops = Array.isArray(s.opsi) ? s.opsi : [];
      const hit = ops.find((o) => String(o.id) === String(rawVal));
      return hit ? hit.teks : (rawVal ? String(rawVal) : "");
    }
    if (s.tipe === "multi") {
      const arr = Array.isArray(rawVal) ? rawVal : [];
      const ops = Array.isArray(s.opsi) ? s.opsi : [];
      return arr.map((id) => {
        const hit = ops.find((o) => String(o.id) === String(id));
        return hit ? hit.teks : id;
      }).filter(Boolean).join(", ");
    }
    if (s.tipe === "bs") {
      if (!rawVal) return "";
      const ops = Array.isArray(s.opsi) ? s.opsi : [];
      const hit = ops.find((o) => String(o.id) === String(rawVal));
      return hit ? hit.teks : (rawVal === "benar" ? "Benar" : "Salah");
    }
    return rawVal != null ? String(rawVal) : "";
  },

  formatKunciTeks(s) {
    if (!s.kunci) return "";
    if (s.tipe === "pg") {
      const hit = (s.opsi || []).find((o) => String(o.id) === String(s.kunci.id || ""));
      return hit ? hit.teks : "";
    }
    if (s.tipe === "multi") {
      const ids = Array.isArray(s.kunci.ids) ? s.kunci.ids.map(String) : [];
      return ids.map((id) => {
        const hit = (s.opsi || []).find((o) => String(o.id) === id);
        return hit ? hit.teks : id;
      }).filter(Boolean).join(", ");
    }
    if (s.tipe === "bs") {
      const v = s.kunci.nilai;
      if (!v) return "";
      const hit = (s.opsi || []).find((o) => String(o.id) === v);
      return hit ? hit.teks : (v === "benar" ? "Benar" : "Salah");
    }
    if (s.tipe === "isian") {
      const arr = Array.isArray(s.kunci.terima) ? s.kunci.terima.filter((x) => String(x || "").trim() !== "") : [];
      return arr.join(" / ");
    }
    if (s.tipe === "skala") {
      return s.kunci.nilai ? String(s.kunci.nilai) : "";
    }
    return "";
  },

  renderHasil() {
    const wrap = document.getElementById("tesViewHasil");
    if (!wrap || !Tes.hasil) return;

    if (Tes.hasil.mode === "saya") {
      Tes.renderHasilDetailView(wrap, Tes.hasil.detail, false);
    } else if (Tes.hasil.mode === "koreksi") {
      Tes.renderHasilDetailView(wrap, Tes.hasil.detail, true);
    } else {
      Tes.renderRekapView(wrap);
    }
  },

  ekstrakAspek(pertanyaan) {
    const m = String(pertanyaan || "").match(/^\[([^\]]{1,40})\]/);
    return m ? m[1].trim() : "";
  },

  hitungAspek(soal, pen) {
    const map = new Map();
    (soal || []).forEach((s) => {
      const asp = Tes.ekstrakAspek(s.pertanyaan);
      if (!asp) return;
      const p = (pen && pen[String(s.id)]) || {};
      const maks = Number(p.maks != null ? p.maks : (s.poin || 0));
      const dapat = Number(p.poin || 0);
      if (!map.has(asp)) map.set(asp, { nama: asp, skor: 0, maks: 0, jml: 0 });
      const row = map.get(asp);
      row.skor += dapat;
      row.maks += maks;
      row.jml += 1;
    });
    return Array.from(map.values());
  },

  ringkasanAspekHtml(soal, pen) {
    const aspek = Tes.hitungAspek(soal, pen);
    if (aspek.length < 2) return "";
    const cards = aspek.map((a) => {
      const pct = a.maks > 0 ? Math.round((a.skor / a.maks) * 100) : 0;
      return `<div class="tes-stat-card">
        <small>${escapeHtml(a.nama)} (${a.jml} soal)</small>
        <b>${Tes.fmtAngka(a.skor)} / ${Tes.fmtAngka(a.maks)} <span style="font-size:0.78rem;color:var(--gray)">(${pct}%)</span></b>
      </div>`;
    }).join("");
    return `<div class="osis-panel" style="display:flex;flex-direction:column;gap:10px">
      <h3 class="ww-judul" style="font-size:0.92rem;font-weight:900"><i class="fa-solid fa-layer-group" style="color:var(--red)"></i> Ringkasan Skor per Aspek</h3>
      <div class="tes-stats-grid">${cards}</div>
    </div>`;
  },

  renderHasilDetailView(wrap, detail, modeKoreksi) {
    const { tes, soal, hasil, peserta } = detail;
    const cfg = tes.pengaturan || {};
    const jwb = hasil.jawaban || {};
    const pen = hasil.penilaian || {};
    const tampilNilai = modeKoreksi || cfg.tampil_nilai !== false || Tes.bolehKelola();
    const tampilKunci = modeKoreksi || !!cfg.tampil_kunci || Tes.bolehKelola();
    const maks = Number(hasil.skor_maks || 0);
    const total = hasil.skor_total !== null && hasil.skor_total !== undefined ? Number(hasil.skor_total) : null;
    const persen = (maks > 0 && total !== null) ? Math.round((total / maks) * 100) : null;
    const durDetik = Tes.hitungDurasiDetik(hasil.mulai_at, hasil.selesai_at);
    const durTeks = Tes.fmtDurasiPanjang(durDetik);

    let skorCardHtml = "";
    if (!tampilNilai) {
      skorCardHtml = `<div class="tes-skor-box"><b>Terkumpul</b><small>Nilai disembunyikan</small></div>`;
    } else if (maks === 0) {
      skorCardHtml = `<div class="tes-skor-box"><b>Selesai</b><small>Tanpa Skor</small></div>`;
    } else {
      skorCardHtml = `<div class="tes-skor-box">
        <b>${Tes.fmtAngka(total)} / ${Tes.fmtAngka(maks)}</b>
        <small>${persen}% · ${hasil.status === "menunggu_koreksi" ? "Sementara" : "Skor Akhir"}</small>
      </div>`;
    }

    const reviewList = (soal || []).map((s, idx) => {
      const info = Tes.tipeInfo(s.tipe);
      const val = jwb[String(s.id)];
      const ansText = Tes.formatJawabanTeks(s, val);
      const p = pen[String(s.id)] || {};
      const statusCls = p.benar === true ? "benar" : (p.benar === false ? "salah" : (s.tipe === "essay" || p.manual ? "manual" : ""));
      const kunciText = tampilKunci ? Tes.formatKunciTeks(s) : "";

      let badgePoin = "";
      if (tampilNilai && Number(s.poin || 0) > 0 && (tampilKunci || s.tipe === "essay")) {
        const dapat = p.poin != null ? Number(p.poin) : 0;
        const badgeCls = p.benar === true
          ? "aktif"
          : (p.benar === false ? "ditutup" : (s.tipe === "bobot" ? "skor" : "koreksi"));
        badgePoin = `<span class="tes-pill ${badgeCls}">
          ${Tes.fmtAngka(dapat)} / ${Tes.fmtAngka(s.poin)} poin
        </span>`;
      }

      let koreksiInputHtml = "";
      if (modeKoreksi && (s.tipe === "essay" || Number(s.poin || 0) > 0)) {
        const curK = (Tes.hasil.koreksiMap && Tes.hasil.koreksiMap[String(s.id)]) || null;
        const valPoin = curK ? curK.poin : (p.poin ?? 0);
        const valCat = curK ? curK.catatan : (p.catatan || "");
        if (s.tipe === "essay" || curK) {
          koreksiInputHtml = `
            <div class="tes-koreksi-box">
              <div class="field">
                <label>Nilai (0–${Tes.fmtAngka(s.poin)})</label>
                <input type="number" min="0" max="${Number(s.poin || 0)}" step="0.5" class="admin-input"
                  value="${Number(valPoin)}"
                  oninput="Tes.setNilaiKoreksi(${s.id}, ${Number(s.poin || 0)}, 'poin', this.value)">
              </div>
              <div class="field">
                <label>Catatan soal (opsional)</label>
                <input type="text" class="admin-input" maxlength="500" value="${escapeHtml(valCat)}"
                  placeholder="Komentar untuk jawaban ini..."
                  oninput="Tes.setNilaiKoreksi(${s.id}, ${Number(s.poin || 0)}, 'catatan', this.value)">
              </div>
            </div>`;
        } else {
          koreksiInputHtml = `
            <div>
              <button type="button" class="btn btn-white btn-sm" onclick="Tes.aktifkanKoreksiManual(${s.id})">
                <i class="fa-solid fa-pen"></i> Koreksi / Ubah Nilai Manual
              </button>
            </div>`;
        }
      }

      return `
        <div class="tes-rev-item ${statusCls}">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="tes-qnum">#${idx + 1}</span>
            <span class="tes-pill kat">${escapeHtml(info.label)}</span>
            <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${badgePoin}</div>
          </div>
          <div style="font-weight:800;font-size:0.95rem;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(s.pertanyaan || "")}</div>
          <div class="tes-rev-ans">${ansText ? escapeHtml(ansText) : '<span style="color:var(--gray);font-style:italic">Tidak dijawab</span>'}</div>
          ${tampilKunci && kunciText ? `<div class="tes-rev-kunci"><i class="fa-solid fa-key"></i> Kunci: ${escapeHtml(kunciText)}</div>` : ""}
          ${tampilKunci && s.pembahasan ? `<div class="tes-rev-bahas"><i class="fa-solid fa-lightbulb"></i> Pembahasan: ${escapeHtml(s.pembahasan)}</div>` : ""}
          ${p.catatan && !modeKoreksi ? `<div class="tes-rev-bahas" style="background:#fffbeb;color:#92400e"><i class="fa-solid fa-comment-dots"></i> Catatan korektor: ${escapeHtml(p.catatan)}</div>` : ""}
          ${koreksiInputHtml}
        </div>`;
    }).join("");

    wrap.innerHTML = `
      <div class="tes-topbar">
        <button type="button" class="btn btn-white btn-sm" onclick="Tes.kembaliKeDaftar()">
          <i class="fa-solid fa-arrow-left"></i> ${modeKoreksi ? "Kembali ke Rekap" : "Daftar Tes"}
        </button>
        <div class="tes-topbar-title">
          <h2>${modeKoreksi ? `Koreksi: ${escapeHtml((peserta && peserta.nama) || "Peserta")}` : `Hasil: ${escapeHtml(tes.judul)}`}</h2>
          <small>Dikumpulkan ${Tes.fmtWaktu(hasil.selesai_at)} · Durasi: ${escapeHtml(durTeks)} · Percobaan ke-${Number(hasil.percobaan_ke || 1)}</small>
        </div>
        <div class="tes-topbar-acts">
          ${(modeKoreksi || Tes.bolehKelola() || (tampilNilai && tampilKunci))
            ? `<button type="button" class="btn btn-white btn-sm" id="btnExportCsvOrang" onclick="Tes.exportCsvOrang()"><i class="fa-solid fa-file-csv"></i> Export CSV</button>` : ""}
          ${!modeKoreksi && tes.status === "aktif" && cfg.boleh_ulang !== false
            ? `<button type="button" class="btn btn-red btn-sm" onclick="Tes.mulaiKerjakan(${tes.id})"><i class="fa-solid fa-rotate-right"></i> Kerjakan Ulang</button>` : ""}
          ${modeKoreksi
            ? `<button type="button" class="btn btn-white btn-sm" onclick="Tes.konfirmResetHasil(${hasil.id}, ${tes.id})"><i class="fa-solid fa-trash-can"></i> Hapus Hasil</button>` : ""}
        </div>
      </div>

      <div class="tes-hasil-hero">
        <div style="flex:1;min-width:200px">
          <div class="tes-badges" style="margin-bottom:6px">
            <span class="tes-pill ${hasil.status === "menunggu_koreksi" ? "koreksi" : "aktif"}">
              ${hasil.status === "menunggu_koreksi" ? "Menunggu Koreksi Essay" : "Selesai"}
            </span>
            ${peserta ? `<span class="tes-pill">${escapeHtml(peserta.nama || "-")}${peserta.jabatan ? " · " + escapeHtml(peserta.jabatan) : ""}</span>` : ""}
          </div>
          <h2 style="font-size:1.15rem;font-weight:900">${escapeHtml(tes.judul)}</h2>
          <div class="tes-card-meta" style="margin-top:8px">
            <span><i class="fa-solid fa-play"></i> Mulai: ${hasil.mulai_at ? Tes.fmtWaktu(hasil.mulai_at) : "-"}</span>
            <span><i class="fa-solid fa-flag-checkered"></i> Selesai: ${Tes.fmtWaktu(hasil.selesai_at)}</span>
            <span><i class="fa-solid fa-stopwatch"></i> Durasi: ${escapeHtml(durTeks)}</span>
          </div>
          ${hasil.catatan_koreksi ? `<p style="font-size:0.84rem;font-weight:600;margin-top:6px"><i class="fa-solid fa-comment-dots" style="color:var(--red)"></i> Catatan: ${escapeHtml(hasil.catatan_koreksi)}</p>` : ""}
        </div>
        ${skorCardHtml}
      </div>

      ${modeKoreksi ? `
        <div class="osis-panel" style="display:flex;flex-direction:column;gap:10px">
          <div class="field">
            <label>Catatan Keseluruhan Korektor (opsional)</label>
            <textarea id="tesCatatanKoreksi" class="admin-input admin-textarea" rows="2" maxlength="1000"
              placeholder="Feedback untuk peserta...">${escapeHtml(hasil.catatan_koreksi || "")}</textarea>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-white btn-sm" onclick="Tes.simpanKoreksi(false)">Simpan sebagai Draft Koreksi</button>
            <button type="button" class="btn btn-red" id="btnSimpanKoreksi" onclick="Tes.simpanKoreksi(true)">
              <i class="fa-solid fa-check-double"></i> Simpan &amp; Selesaikan Koreksi
            </button>
          </div>
        </div>
      ` : ""}

      ${(tampilNilai && (tampilKunci || modeKoreksi)) ? Tes.ringkasanAspekHtml(soal, pen) : ""}

      ${tampilKunci || modeKoreksi
        ? `<div style="display:flex;flex-direction:column;gap:10px">${reviewList}</div>`
        : `<div class="osis-panel"><div class="osis-empty">Kunci jawaban dan rincian pembahasan tidak ditampilkan untuk tes ini.</div></div>`}`;
  },

  aktifkanKoreksiManual(soalId) {
    if (!Tes.hasil || !Tes.hasil.detail) return;
    const pen = (Tes.hasil.detail.hasil && Tes.hasil.detail.hasil.penilaian) || {};
    const p = pen[String(soalId)] || {};
    Tes.hasil.koreksiMap[String(soalId)] = {
      poin: Number(p.poin ?? 0) || 0,
      catatan: String(p.catatan || ""),
    };
    Tes.renderHasil();
  },

  setNilaiKoreksi(soalId, maks, field, val) {
    if (!Tes.hasil) return;
    const k = String(soalId);
    const cur = Tes.hasil.koreksiMap[k] || { poin: 0, catatan: "" };
    if (field === "poin") {
      const n = Math.max(0, Math.min(Number(maks) || 0, parseFloat(val) || 0));
      cur.poin = n;
    } else {
      cur.catatan = String(val || "");
    }
    Tes.hasil.koreksiMap[k] = cur;
  },

  async simpanKoreksi(selesai = true) {
    if (!Tes.hasil || !Tes.hasil.detail) return;
    const btn = document.getElementById("btnSimpanKoreksi");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
    const catatan = (document.getElementById("tesCatatanKoreksi") && document.getElementById("tesCatatanKoreksi").value) || "";
    try {
      await koreksiTes(Tes.hasil.detail.hasil.id, Tes.hasil.koreksiMap || {}, catatan, selesai);
      showToast("Koreksi berhasil disimpan!", "success");
      await Tes.bukaRekap(Tes.hasil.detail.tes.id);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check-double"></i> Simpan &amp; Selesaikan Koreksi'; }
      showPopup("Gagal simpan koreksi: " + (err.message || err), "error");
    }
  },

  async konfirmResetHasil(hasilId, tesId) {
    let nama = "";
    try {
      const hit = Tes.hasil && Array.isArray(Tes.hasil.list)
        ? Tes.hasil.list.find((x) => String(x.id) === String(hasilId))
        : null;
      if (hit && hit.nama) nama = hit.nama;
      else if (Tes.hasil && Tes.hasil.detail && Tes.hasil.detail.peserta) {
        nama = Tes.hasil.detail.peserta.nama || "";
      }
    } catch {}
    const label = nama ? ` "${nama}"` : " peserta ini";
    const yakin = await showPopup(`Hapus hasil tes${label}? Seluruh jawabannya akan dihapus dan yang bersangkutan bisa mengulang dari awal.`, "confirm");
    if (!yakin) return;
    try {
      await hapusTesHasil(hasilId);
      try { catatAksi("hapus_tes_hasil", `${tesId}:${nama || hasilId}`); } catch {}
      showToast("Hasil tes berhasil dihapus.", "success");
      await Tes.bukaRekap(tesId);
    } catch (err) {
      showPopup("Gagal hapus hasil: " + (err.message || err), "error");
    }
  },

  rekapRowsHtml(filtered) {
    if (!filtered.length) {
      return `<div class="osis-panel"><div class="osis-empty">Belum ada peserta yang cocok.</div></div>`;
    }
    return filtered.map((r) => {
      const dur = Tes.hitungDurasiDetik(r.mulai_at, r.selesai_at);
      return `
      <div class="tes-peserta-row">
        <div class="tes-peserta-info">
          <b>${escapeHtml(r.nama || "-")}</b>
          <small>@${escapeHtml(r.username || "-")}${r.jabatan ? " · " + escapeHtml(r.jabatan) : ""} · ${Tes.fmtWaktu(r.selesai_at)} · Durasi: ${escapeHtml(Tes.fmtDurasiPanjang(dur))} · Percobaan ${Number(r.percobaan_ke || 1)}x</small>
        </div>
        <span class="tes-pill ${r.status === "menunggu_koreksi" ? "koreksi" : "aktif"}">
          ${r.status === "menunggu_koreksi" ? "Perlu Koreksi" : "Selesai"}
        </span>
        <span class="tes-pill skor">${Tes.fmtAngka(r.skor_total)} / ${Tes.fmtAngka(r.skor_maks)}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-white btn-sm" onclick="Tes.exportCsvOrang(${r.id}, this)" title="Export CSV peserta ini">
            <i class="fa-solid fa-file-csv"></i> CSV
          </button>
          <button type="button" class="btn btn-red btn-sm" onclick="Tes.bukaKoreksi(${r.id})">
            <i class="fa-solid fa-eye"></i> Detail / Koreksi
          </button>
          <button type="button" class="btn btn-white btn-sm" onclick="Tes.konfirmResetHasil(${r.id}, ${r.tes_id})" title="Hapus hasil tes peserta ini">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>`;
    }).join("");
  },

  renderRekapView(wrap) {
    const { tes, list, q, status } = Tes.hasil;
    const total = list.length;
    const perluKoreksi = list.filter((x) => x.status === "menunggu_koreksi").length;
    const rata = total
      ? (list.reduce((a, b) => a + Number(b.skor_total || 0), 0) / total)
      : 0;
    const maksSkor = total ? Math.max(...list.map((x) => Number(x.skor_total || 0))) : 0;
    const durList = list.map((x) => Tes.hitungDurasiDetik(x.mulai_at, x.selesai_at)).filter((d) => d !== null);
    const rataDurasi = durList.length
      ? Tes.fmtDurasiPanjang(Math.round(durList.reduce((a, b) => a + b, 0) / durList.length))
      : "-";

    const qLow = (q || "").trim().toLowerCase();
    const filtered = list.filter((r) => {
      if (qLow && !(`${r.nama || ""} ${r.username || ""} ${r.jabatan || ""}`.toLowerCase().includes(qLow))) return false;
      if (status && r.status !== status) return false;
      return true;
    });

    wrap.innerHTML = `
      <div class="tes-topbar">
        <button type="button" class="btn btn-white btn-sm" onclick="Tes.kembaliKeDaftar()">
          <i class="fa-solid fa-arrow-left"></i> Daftar Tes
        </button>
        <div class="tes-topbar-title">
          <h2>Rekap: ${escapeHtml(tes.judul)}</h2>
          <small>${total} peserta mengumpulkan · Status: ${escapeHtml(Tes.STATUS_LABEL[tes.status] || tes.status)}</small>
        </div>
        <div class="tes-topbar-acts">
          <button type="button" class="btn btn-white btn-sm" onclick="Tes.bukaBuilder(${tes.id})"><i class="fa-solid fa-pen"></i> Edit Soal</button>
          ${total ? `<button type="button" class="btn btn-red btn-sm" id="btnExportCsv" onclick="Tes.exportCsv()"><i class="fa-solid fa-file-csv"></i> Export CSV</button>` : ""}
        </div>
      </div>

      <div class="tes-stats-grid">
        <div class="tes-stat-card"><small>Total Peserta</small><b>${total}</b></div>
        <div class="tes-stat-card"><small>Rata-rata Skor</small><b>${Tes.fmtAngka(rata)}</b></div>
        <div class="tes-stat-card"><small>Skor Tertinggi</small><b>${Tes.fmtAngka(maksSkor)}</b></div>
        <div class="tes-stat-card"><small>Rata-rata Durasi</small><b style="font-size:1.05rem">${escapeHtml(rataDurasi)}</b></div>
        <div class="tes-stat-card"><small>Perlu Koreksi</small><b style="color:${perluKoreksi ? "var(--red)" : "inherit"}">${perluKoreksi}</b></div>
      </div>

      <div class="osis-panel" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" class="admin-input" style="flex:1;min-width:180px" placeholder="Cari nama atau jabatan peserta..."
          value="${escapeHtml(q || "")}" oninput="Tes.filterRekap('q', this.value)">
        <select class="admin-input" style="min-width:170px" data-dd="off" onchange="Tes.filterRekap('status', this.value)">
          <option value="" ${!status ? "selected" : ""}>Semua status</option>
          <option value="menunggu_koreksi" ${status === "menunggu_koreksi" ? "selected" : ""}>Menunggu koreksi</option>
          <option value="selesai" ${status === "selesai" ? "selected" : ""}>Selesai</option>
        </select>
      </div>

      <div id="tesRekapList" style="display:flex;flex-direction:column;gap:10px">
        ${Tes.rekapRowsHtml(filtered)}
      </div>`;
  },

  filterRekap(k, val) {
    if (!Tes.hasil || Tes.hasil.mode !== "rekap") return;
    Tes.hasil[k] = val || "";
    const listWrap = document.getElementById("tesRekapList");
    if (!listWrap) return;
    const qLow = (Tes.hasil.q || "").trim().toLowerCase();
    const st = Tes.hasil.status || "";
    const filtered = (Tes.hasil.list || []).filter((r) => {
      if (qLow && !(`${r.nama || ""} ${r.username || ""} ${r.jabatan || ""}`.toLowerCase().includes(qLow))) return false;
      if (st && r.status !== st) return false;
      return true;
    });
    listWrap.innerHTML = Tes.rekapRowsHtml(filtered);
  },

  slugFile(teks, fallback = "export") {
    return String(teks || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback;
  },

  unduhCsv(filename, rows) {
    const escCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "\uFEFF" + rows.map((row) => row.map(escCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async exportCsvOrang(hasilId = null, btnEl = null) {
    const btn = btnEl || document.getElementById("btnExportCsvOrang");
    const oldHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';
    }
    try {
      let detail = null;
      if (!hasilId && Tes.hasil && Tes.hasil.detail) {
        detail = Tes.hasil.detail;
      } else if (hasilId) {
        const hit = Tes.hasil && Array.isArray(Tes.hasil.list)
          ? Tes.hasil.list.find((x) => String(x.id) === String(hasilId))
          : null;
        if (hit && hit.jawaban && typeof hit.jawaban === "object" && Array.isArray(Tes.hasil.soal) && Tes.hasil.soal.length) {
          detail = {
            tes: Tes.hasil.tes,
            peserta: { id: hit.user_id, nama: hit.nama, username: hit.username, jabatan: hit.jabatan },
            soal: Tes.hasil.soal,
            hasil: hit,
          };
        } else {
          detail = await getTesHasilDetail(hasilId);
          if (hit && detail && detail.hasil) {
            hit.jawaban = detail.hasil.jawaban || {};
            hit.penilaian = detail.hasil.penilaian || {};
          }
        }
      }
      if (!detail || !detail.tes || !detail.hasil) {
        throw new Error("Detail hasil tidak ditemukan.");
      }

      const { tes, peserta, soal, hasil } = detail;
      const cfg = tes.pengaturan || {};
      const tampilNilai = Tes.bolehKelola() || cfg.tampil_nilai !== false;
      const tampilKunci = Tes.bolehKelola() || !!cfg.tampil_kunci;
      const jwb = hasil.jawaban || {};
      const pen = hasil.penilaian || {};
      const maks = Number(hasil.skor_maks || 0);
      const tot = hasil.skor_total != null ? Number(hasil.skor_total) : null;
      const pct = (maks > 0 && tot !== null) ? `${Math.round((tot / maks) * 100)}%` : "-";
      const namaP = (peserta && peserta.nama) || hasil.nama || "Peserta";
      const userP = (peserta && peserta.username) || hasil.username || "-";
      const jabP = (peserta && peserta.jabatan) || hasil.jabatan || "-";

      const durDetik = Tes.hitungDurasiDetik(hasil.mulai_at, hasil.selesai_at);
      const rows = [
        ["Tes", tes.judul || "-"],
        ["Nama", namaP],
        ["Username", userP],
        ["Jabatan", jabP],
        ["Status", hasil.status === "menunggu_koreksi" ? "Menunggu Koreksi" : "Selesai"],
        ["Skor Total", tampilNilai && tot !== null ? `${Tes.fmtAngka(tot)} / ${Tes.fmtAngka(maks)} (${pct})` : "-"],
        ["Percobaan Ke", Number(hasil.percobaan_ke || 1)],
        ["Waktu Mulai", hasil.mulai_at ? Tes.fmtWaktu(hasil.mulai_at) : "-"],
        ["Waktu Selesai", Tes.fmtWaktu(hasil.selesai_at)],
        ["Durasi Pengerjaan", Tes.fmtDurasiPanjang(durDetik)],
        ["Durasi (Detik)", durDetik !== null ? durDetik : ""],
      ];
      if (hasil.catatan_koreksi) {
        rows.push(["Catatan Korektor", hasil.catatan_koreksi]);
      }

      const aspekRows = tampilNilai ? Tes.hitungAspek(soal, pen) : [];
      if (aspekRows.length >= 2) {
        rows.push([]);
        rows.push(["Ringkasan Aspek", "Skor", "Maks", "Persentase"]);
        aspekRows.forEach((a) => {
          const apct = a.maks > 0 ? `${Math.round((a.skor / a.maks) * 100)}%` : "-";
          rows.push([a.nama, Tes.fmtAngka(a.skor), Tes.fmtAngka(a.maks), apct]);
        });
      }

      rows.push([]);
      const qHead = ["No", "Aspek", "Tipe", "Pertanyaan", "Jawaban"];
      if (tampilNilai) qHead.push("Poin", "Poin Maks");
      if (tampilKunci) qHead.push("Kunci");
      qHead.push("Catatan Soal");
      rows.push(qHead);

      (soal || []).forEach((s, idx) => {
        const info = Tes.tipeInfo(s.tipe);
        const asp = Tes.ekstrakAspek(s.pertanyaan) || "-";
        const ans = Tes.formatJawabanTeks(s, jwb[String(s.id)]);
        const p = pen[String(s.id)] || {};
        const qRow = [idx + 1, asp, info.label, s.pertanyaan || "", ans];
        if (tampilNilai) {
          qRow.push(p.poin != null ? Tes.fmtAngka(p.poin) : "", Tes.fmtAngka(p.maks != null ? p.maks : (s.poin || 0)));
        }
        if (tampilKunci) {
          qRow.push(Tes.formatKunciTeks(s));
        }
        qRow.push(p.catatan || "");
        rows.push(qRow);
      });

      const fname = `jawaban-${Tes.slugFile(namaP, "peserta")}-${Tes.slugFile(tes.judul, "tes")}.csv`;
      Tes.unduhCsv(fname, rows);
      showToast(`Export CSV ${namaP} berhasil.`, "success");
    } catch (err) {
      showPopup("Gagal export CSV: " + (err.message || err), "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    }
  },

  async exportCsv() {
    if (!Tes.hasil || !Tes.hasil.list || !Tes.hasil.list.length) return;
    const btn = document.getElementById("btnExportCsv");
    const list = Tes.hasil.list;
    const tes = Tes.hasil.tes || {};
    let soal = Array.isArray(Tes.hasil.soal) ? Tes.hasil.soal : [];

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyiapkan...';
    }

    try {
      if (!soal.length && tes.id) {
        const info = await bukaTes(tes.id, true);
        if (info && Array.isArray(info.soal)) {
          soal = info.soal;
          Tes.hasil.soal = soal;
        }
      }

      // Bila tes_hasil_list belum memuat jawaban/penilaian, ambil detail per peserta (batch 5)
      const kurang = list.filter((r) => !r.jawaban || typeof r.jawaban !== "object");
      for (let i = 0; i < kurang.length; i += 5) {
        const batch = kurang.slice(i, i + 5);
        await Promise.all(batch.map(async (r) => {
          const d = await getTesHasilDetail(r.id);
          if (d && d.hasil) {
            r.jawaban = d.hasil.jawaban || {};
            r.penilaian = d.hasil.penilaian || {};
          }
        }));
      }

      const aspekList = Tes.hitungAspek(soal, {}).map((a) => a.nama);
      const pakaiAspek = aspekList.length >= 2;

      const header = [
        "No", "Nama", "Username", "Jabatan", "Status",
        "Skor Otomatis", "Skor Manual", "Skor Total", "Skor Maks", "Persentase (%)",
        "Percobaan", "Waktu Mulai", "Waktu Selesai", "Durasi Pengerjaan", "Durasi (Detik)", "Catatan Korektor",
      ];
      if (pakaiAspek) {
        aspekList.forEach((asp) => header.push(`Skor ${asp}`));
      }
      soal.forEach((s, idx) => {
        const teks = String(s.pertanyaan || ("Soal " + (idx + 1))).replace(/[\r\n]+/g, " ").trim();
        header.push(`${idx + 1}. ${teks}`);
        header.push(`${idx + 1}. Poin`);
      });

      const dataRows = list.map((r, rIdx) => {
        const jwb = r.jawaban || {};
        const pen = r.penilaian || {};
        const maks = Number(r.skor_maks || 0);
        const tot = Number(r.skor_total || 0);
        const pct = maks > 0 ? Math.round((tot / maks) * 100) : "";

        const durDetik = Tes.hitungDurasiDetik(r.mulai_at, r.selesai_at);
        const row = [
          rIdx + 1,
          r.nama, r.username, r.jabatan, r.status,
          r.skor_otomatis, r.skor_manual, r.skor_total, r.skor_maks, pct,
          r.percobaan_ke,
          r.mulai_at ? Tes.fmtWaktu(r.mulai_at) : "-",
          Tes.fmtWaktu(r.selesai_at),
          Tes.fmtDurasiPanjang(durDetik),
          durDetik !== null ? durDetik : "",
          r.catatan_koreksi,
        ];

        if (pakaiAspek) {
          const sumByName = new Map(Tes.hitungAspek(soal, pen).map((a) => [a.nama, a.skor]));
          aspekList.forEach((a) => row.push(Tes.fmtAngka(sumByName.get(a) || 0)));
        }

        soal.forEach((s) => {
          const val = jwb[String(s.id)];
          const teksJawab = Tes.formatJawabanTeks(s, val);
          const p = pen[String(s.id)] || {};
          const poinJawab = p.poin != null ? Tes.fmtAngka(p.poin) : "";
          row.push(teksJawab, poinJawab);
        });

        return row;
      });

      const slug = Tes.slugFile(tes.judul || ("tes-" + (tes.id || "export")), "export");
      Tes.unduhCsv(`jawaban-${slug}.csv`, [header, ...dataRows]);
      showToast(`Export CSV berhasil (${list.length} peserta, ${soal.length} soal).`, "success");
    } catch (err) {
      showPopup("Gagal export CSV: " + (err.message || err), "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-file-csv"></i> Export CSV';
      }
    }
  },
};

document.addEventListener("DOMContentLoaded", () => Tes.init());
