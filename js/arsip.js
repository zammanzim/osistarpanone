// =========================================================================
// ARSIP GALERI — arsip semua dokumentasi kegiatan, pagination server-side.
// EXACT kayak Dokumentasi Kegiatan (home): draft inline, edit teks langsung,
// badge, hapus foto, hapus kegiatan, caption popup. Bedanya: paginasi +
// read di halaman sendiri biar home tetap ringan (highlight doang).
// Sumber: tabel arsip. Hak akses: "kegiatan" (dipakai bareng home).
// =========================================================================

const Arsip = {
  rows: [], // baris halaman aktif (page-scoped, urutan dari server)
  draft: null, // { judul, deskripsi, badge, fotos:[], files:[File] }
  page: 1,
  perPage: 6,
  total: 0,
  terinisialisasi: false,
  token: 0,
  memuat: false, // lagi fetch — render jangan vonis "belum ada"
  gagalMuat: false, // fetch terakhir error (offline) — render jangan vonis kosong
  pernahMuat: false, // minimal 1x sukses — sebelum itu kosong = "belum tahu", bukan "belum ada"

  // 0 itu order valid, jangan || 99
  ord(k) {
    const o = parseInt(k && k.display_order, 10);
    return Number.isFinite(o) ? o : 99;
  },

  // order global terkecil - 1 biar insert baru selalu paling atas (hal 1)
  async nextOrderGlobal() {
    try {
      const m = await getArsipMinOrder();
      return m - 1;
    } catch {
      const rows = Arsip.rows || [];
      if (!rows.length) return 99;
      try {
        return Math.min(...rows.map(Arsip.ord)) - 1;
      } catch {
        return 99;
      }
    }
  },

  totalHal() {
    return Math.max(1, Math.ceil((Arsip.total || 0) / Arsip.perPage));
  },

  init() {
    if (Arsip.terinisialisasi) return;
    Arsip.terinisialisasi = true;
    // Segarkan hak kendali lalu sesuaikan tombol
    if (typeof OsisAuth.refreshAkses === "function") {
      OsisAuth.refreshAkses()
        .then(() => {
          Arsip.cekLogin();
          Arsip.render();
        })
        .catch(() => {});
    }
    Arsip.cekLogin();
    Arsip.muat(1);
    const grid = document.getElementById("arsipGrid");
    if (grid)
      grid.addEventListener("click", (e) => {
        if (e.target.closest(".up-slot")) {
          document.getElementById("arsipFileInput")?.click();
        }
      });
    if (grid) {
      ["dragenter", "dragover"].forEach((ev) => {
        grid.addEventListener(ev, (e) => {
          const slot = e.target.closest(".up-slot");
          if (!slot) return;
          e.preventDefault();
          slot.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach((ev) => {
        grid.addEventListener(ev, (e) => {
          const slot = e.target.closest(".up-slot");
          if (!slot) return;
          e.preventDefault();
          slot.classList.remove("dragover");
        });
      });
      grid.addEventListener("drop", (e) => {
        const slot = e.target.closest(".up-slot");
        if (!slot) return;
        const files = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
        Arsip.tambahFilesDraft(files);
      });
    }
    if (!document.getElementById("arsipFileInput")) {
      const fi2 = document.createElement("input");
      fi2.type = "file";
      fi2.id = "arsipFileInput";
      fi2.accept = "image/*,video/mp4,video/webm,video/quicktime";
      fi2.multiple = true;
      fi2.style.display = "none";
      fi2.addEventListener("change", () => Arsip.tambahFotoDraft(fi2));
      document.body.appendChild(fi2);
    }
    // Klik foto = buka popup (draft, tombol hapus & teks editable dikecualikan)
    if (grid)
      grid.addEventListener("click", (e) => {
        if (e.target.closest(".up-slot, .foto-del-btn")) return;
        if (
          e.target.closest(
            "[data-arsip-field][contenteditable='true'], .bento-badge[contenteditable='true']",
          )
        )
          return;
        const item = e.target.closest(".item");
        if (!item) return;
        const block = item.closest(".bento-block");
        const id = block ? block.dataset.arsipId : null;
        const fotoIdx = Number(item.dataset.fotoIdx || 0);
        if (id) Arsip.bukaPopup(id, fotoIdx);
      });
    // Autosave teks inline — cuma ada elemen editable-nya pas state edit nyala
    if (grid && !grid._textEditBound) {
      grid._textEditBound = true;
      grid.addEventListener("focusout", (e) => {
        const el = e.target.closest(
          "[data-arsip-field][contenteditable='true']",
        );
        const badgeEl = e.target.closest(
          ".bento-badge[contenteditable='true']",
        );
        if (!el && !badgeEl) return;
        const targetEl = badgeEl || el;
        const targetBlock = targetEl.closest(".bento-block");
        const id = targetBlock ? targetBlock.dataset.arsipId : null;
        const field = badgeEl ? "badge" : el.dataset.arsipField;
        if (!id || !field) return;

        const item = Arsip.rows.find((k) => String(k.id) === String(id));
        if (!item) return;
        const value = targetEl.textContent.trim();
        if (field === "badge" && value.length > 12) {
          targetEl.textContent = value.slice(0, 12);
          Arsip.updateText(id, field, value.slice(0, 12));
          return;
        }
        if (field === "judul" && !value) {
          el.textContent = item.judul || "Judul Kegiatan";
          showToast("Judul gak boleh kosong", "error");
          return;
        }
        if (value !== (item[field] || ""))
          Arsip.updateText(id, field, value);
      });
    }
  },

  cekLogin() {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    const osis = !!(u && u.mode === "osis");
    const boleh = osis && OsisAuth.bisa && OsisAuth.bisa("kegiatan");
    const grid = document.getElementById("arsipGrid");
    if (grid) grid.classList.toggle("mode-osis", !!boleh);
    const btn = document.getElementById("btnTambahArsip");
    if (btn)
      btn.style.display =
        osis && OsisAuth.bisa && OsisAuth.bisa("kegiatan") ? "" : "none";
    // Kartu ruang pelantikan di #/arsip: ikut segar tiap cek login
    try {
      if (typeof ArsipPelantikan !== "undefined" && ArsipPelantikan.refreshTombol) {
        ArsipPelantikan.refreshTombol();
      }
    } catch {}
  },

  async muat(page) {
    const grid = document.getElementById("arsipGrid");
    if (!grid) return;
    Arsip.page = Math.max(1, parseInt(page, 10) || 1);
    const token = ++Arsip.token;
    Arsip.memuat = true;
    Arsip.gagalMuat = false;
    grid.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat arsip...</div>`;
    Arsip.renderBar();
    try {
      const [total, rows] = await Promise.all([
        getArsipCount(),
        getArsipPage(Arsip.page, Arsip.perPage),
      ]);
      if (token !== Arsip.token) return;
      const maxHal = Math.max(1, Math.ceil((total || 0) / Arsip.perPage));
      if (Arsip.page > maxHal) {
        Arsip.muat(maxHal);
        return;
      }
      Arsip.total = total || 0;
      Arsip.rows = rows || [];
      Arsip.memuat = false;
      Arsip.pernahMuat = true;
      Arsip.render();
    } catch (err) {
      console.error(err);
      if (token !== Arsip.token) return;
      Arsip.memuat = false;
      Arsip.gagalMuat = true;
      grid.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat arsip. Cek koneksi.<br><br><button class="btn btn-red btn-sm" onclick="Arsip.muat(Arsip.page)"><i class="fa-solid fa-rotate-right"></i> Coba Lagi</button></div>`;
    }
    Arsip.renderBar();
  },

  go(p) {
    const maxHal = Arsip.totalHal();
    const next = Math.min(maxHal, Math.max(1, parseInt(p, 10) || 1));
    const view = document.querySelector('.view[data-view="arsip"]');
    if (view) view.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo(0, 0);
    Arsip.muat(next);
  },

  render() {
    const grid = document.getElementById("arsipGrid");
    if (!grid) return;
    let html = "";
    if (Arsip.draft) html += Arsip.kartuDraft();
    const rows = Arsip.rows || [];
    if (rows.length === 0 && !Arsip.draft) {
      // Jangan vonis "belum ada" pas internet mati/lemot:
      // - lagi loading / belum pernah sukses = tampil loading
      // - fetch terakhir gagal = tampil error + tombol coba lagi
      // "Belum ada arsip" cuma kalau sudah pernah sukses dan hasilnya kosong.
      if (Arsip.memuat || !Arsip.pernahMuat) {
        html += `<div class="loading-block"><div class="spinner"></div>Memuat arsip...</div>`;
      } else if (Arsip.gagalMuat) {
        html += `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat arsip. Cek koneksi.<br><br><button class="btn btn-red btn-sm" onclick="Arsip.muat(Arsip.page)"><i class="fa-solid fa-rotate-right"></i> Coba Lagi</button></div>`;
      } else {
        html += `<div class="pesan-empty"><i class="fa-solid fa-images"></i> Belum ada arsip.</div>`;
      }
    } else {
      html += rows.map((item) => Arsip.kartu(item)).join("");
    }
    grid.innerHTML = html;
    Arsip.renderBar();
  },

  kartu(item) {
    const judul = escapeHtml(item.judul || "");
    const deskripsi = escapeHtml(item.deskripsi || "");
    const badge = escapeHtml(item.badge || "");
    const fotos = Array.isArray(item.fotos) ? item.fotos : [];
    // Editable HANYA pas state edit nyala + punya hak kegiatan.
    // Di luar itu kartu statis (tidak bisa diketik).
    const isEdit =
      document.body.classList.contains("edit-mode") &&
      typeof OsisAuth !== "undefined" &&
      OsisAuth.bisa &&
      OsisAuth.bisa("kegiatan");
    const fotosHtml = fotos
      .map((f, idx) => {
        const path = typeof f === "string" ? f : f.path;
        if (!path) return "";
        const badgeHtml =
          idx === 0 && (badge || isEdit)
            ? `<span class="bento-badge" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false" data-ph="BADGE">${badge}</span>`
            : "";
        const media = (typeof thumbBento === "function")
          ? thumbBento(getFoto(path), judul)
          : `<img src="${getFoto(path)}" alt="${judul}" loading="lazy" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat');this.style.display='none'"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span>`;
        return `<div class="item media-muat" data-foto-idx="${idx}">${media}${badgeHtml}<button class="foto-del-btn" onclick="event.stopPropagation(); Arsip.hapusFoto(${item.id}, ${idx})" title="Hapus foto/video"><i class="fa-solid fa-trash-can"></i></button></div>`;
      })
      .join("");
    return `
            <div class="bento-block" data-arsip-id="${item.id}">
                <div class="bento-meta">
                    <h4 data-arsip-field="judul" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false" data-ph="Judul Kegiatan">${judul}</h4>
                    ${deskripsi || isEdit ? `<p data-arsip-field="deskripsi" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false" data-ph="Sub judul / deskripsi singkat...">${deskripsi}</p>` : ""}
                    ${olehLabel(item) ? `<div>${olehLabel(item)}</div>` : ""}
                    <button class="icon-btn gal-del" onclick="event.stopPropagation(); Arsip.hapus(${item.id})" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
                </div>
                <div class="bento-grid">${fotosHtml}</div>
            </div>`;
  },

  getFotoCaption(item, fotoIdx) {
    if (!item || !Array.isArray(item.fotos)) return "";
    const foto = item.fotos[fotoIdx];
    return foto && typeof foto !== "string" ? foto.caption || "" : "";
  },

  bukaPopup(id, fotoIdx) {
    const item = Arsip.rows.find((k) => String(k.id) === String(id));
    if (!item || !Array.isArray(item.fotos) || !item.fotos[fotoIdx]) return;
    const gallery = [];
    Arsip.rows.forEach((k) => {
      const fotos = Array.isArray(k.fotos) ? k.fotos : [];
      fotos.forEach((foto, idx) => {
        const path = typeof foto === "string" ? foto : foto.path;
        if (!path) return;
        gallery.push({
          kegiatanId: k.id,
          fotoIdx: idx,
          src: getFoto(path),
          judul: k.judul || "Arsip",
          caption: Arsip.getFotoCaption(k, idx),
          oleh: k.pengunggah || "",
        });
      });
    });
    const index = Math.max(
      0,
      gallery.findIndex(
        (f) => String(f.kegiatanId) === String(id) && f.fotoIdx === fotoIdx,
      ),
    );
    Home.bukaFotoPopup(
      null,
      item.judul || "Arsip",
      Arsip.getFotoCaption(item, fotoIdx),
      {
        gallery,
        index,
        oleh: item.pengunggah || "",
        onChange(idx) {
          const current = gallery[idx];
          if (current)
            Arsip.bindPopupCaption(current.kegiatanId, current.fotoIdx);
        },
      },
    );
  },

  bindPopupCaption(id, fotoIdx) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;

    // Lihat Prestasi.bindPopupCaption: hak dicek pas simpan, bukan pas
    // bind — cache akses async bisa belum ada saat popup dibuka.
    try {
      const akses = OsisAuth.getAkses && OsisAuth.getAkses();
      if (akses && !(OsisAuth.bisa && OsisAuth.bisa("kegiatan"))) return;
    } catch {}

    const modal = document.querySelector(".struktur-modal");
    const pill = modal ? modal.querySelector(".foto-caption-pill") : null;
    const captionEl =
      pill || (modal ? modal.querySelector(".foto-caption") : null);
    if (!captionEl) return;

    captionEl.contentEditable = "true";
    captionEl.spellcheck = false;
    if (pill) pill.dataset.kegiatanCaptionPopup = String(id);
    else captionEl.dataset.kegiatanCaptionPopup = String(id);
    captionEl.onclick = (e) => e.stopPropagation();
    // Flush ganda: blur + tutup modal/pindah foto (lihat Prestasi).
    const simpan = async () => {
      const item = Arsip.rows.find((k) => String(k.id) === String(id));
      if (!item) return;
      const nextCaption = captionEl.textContent.trim();
      if (nextCaption === Arsip.getFotoCaption(item, fotoIdx)) return;
      try {
        if (typeof OsisAuth.refreshAkses === "function" && !(OsisAuth.getAkses && OsisAuth.getAkses())) {
          await OsisAuth.refreshAkses();
        }
      } catch {}
      if (!OsisAuth.bisa || !OsisAuth.bisa("kegiatan")) {
        captionEl.textContent = Arsip.getFotoCaption(item, fotoIdx);
        showToast("Kamu tidak punya kendali atas halaman ini.", "error");
        return;
      }
      Arsip.updateFotoCaption(id, fotoIdx, nextCaption);
    };
    captionEl.onfocusout = simpan;
    modal._flushCaption = simpan;
  },

  kartuDraft() {
    const d = Arsip.draft || {
      judul: "",
      deskripsi: "",
      badge: "",
      fotos: [],
      files: [],
    };
    let fotosHtml = "";
    if (d.fotos && d.fotos.length) {
      fotosHtml += d.fotos
        .map((f) => {
          const p = typeof f === "string" ? f : f.path;
          const media = (typeof thumbBento === "function")
            ? thumbBento(getFoto(p), "")
            : `<img src="${getFoto(p)}" alt="">`;
          return `<div class="item media-muat">${media}</div>`;
        })
        .join("");
    }
    (d.files || []).forEach((f) => {
      const url = URL.createObjectURL(f);
      const isVid = typeof isVideoFile === "function" && isVideoFile(f);
      fotosHtml += isVid
        ? `<div class="item media-muat sudah-muat is-video"><video src="${url}" alt="" muted playsinline preload="metadata"></video><span class="vid-play" aria-hidden="true"><i class="fa-solid fa-play"></i></span></div>`
        : `<div class="item"><img src="${url}" alt=""></div>`;
    });
    fotosHtml += `<div class="up-slot" title="Tambah foto/video (bisa banyak sekaligus)"><i class="fa-solid fa-plus"></i></div>`;
    return `
            <div class="bento-block draft">
                <div class="bento-meta">
                    <h4 class="draft-judul" contenteditable="true" spellcheck="false" data-ph="Judul Kegiatan">${escapeHtml(d.judul || "")}</h4>
                    <p class="draft-desk" contenteditable="true" spellcheck="false" data-ph="Sub judul / deskripsi singkat...">${escapeHtml(d.deskripsi || "")}</p>
                    <input type="text" class="admin-input draft-badge" placeholder="Badge (cth: MAKRAB)" value="${escapeHtml(d.badge || "")}" maxlength="12">
                    <div class="gal-actions">
                        <button class="icon-btn gal-save" onclick="Arsip.simpanDraft()" title="Simpan kegiatan">
                            <i class="fa-solid fa-check"></i>
                        </button>
                        <button class="icon-btn gal-del" onclick="Arsip.buangDraft()" title="Buang draft">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
                <div class="bento-grid">${fotosHtml}</div>
            </div>`;
  },

  buatDraft() {
    if (!OsisAuth.butuh("kegiatan")) return;
    if (Arsip.draft) {
      const j = document.querySelector("#arsipGrid .draft-judul");
      if (j) j.focus();
      return;
    }
    Arsip.draft = {
      judul: "",
      deskripsi: "",
      badge: "",
      fotos: [],
      files: [],
    };
    Arsip.render();
    const j = document.querySelector("#arsipGrid .draft-judul");
    if (j) j.focus();
    const card = document.querySelector("#arsipGrid .bento-block.draft");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  },

  bacaTeksDraft() {
    if (!Arsip.draft) return;
    const jEl = document.querySelector("#arsipGrid .draft-judul");
    const dEl = document.querySelector("#arsipGrid .draft-desk");
    const bEl = document.querySelector("#arsipGrid .draft-badge");
    if (jEl) Arsip.draft.judul = jEl.textContent.trim();
    if (dEl) Arsip.draft.deskripsi = dEl.textContent.trim();
    if (bEl) Arsip.draft.badge = bEl.value.trim();
  },

  tambahFotoDraft(input) {
    if (!Arsip.draft) return;
    const files = input.files ? [...input.files] : [];
    input.value = "";
    Arsip.tambahFilesDraft(files);
  },

  tambahFileDraft(file) {
    if (file) Arsip.tambahFilesDraft([file]);
  },

  // Intake batch: dipakai input file (multiple), drop banyak file, maupun 1 file.
  // Render sekali di akhir biar preview banyak foto tetap ringan.
  // Terima foto + video (MP4/WEBM/MOV, max 100MB).
  tambahFilesDraft(files) {
    if (!Arsip.draft) return;
    Arsip.bacaTeksDraft();
    const { valid, tolakTipe, tolakBesar } = (typeof pilahMedia === "function" ? pilahMedia(files) : { valid: (files || []).filter((f) => f && f.type && f.type.startsWith("image/")), tolakTipe: 0, tolakBesar: 0 });
    if (tolakTipe > 0) showToast(tolakTipe + " file bukan foto/video, dilewati", "error");
    if (tolakBesar > 0) showToast(tolakBesar + " video >100MB, dilewati", "error");
    if (!valid.length) {
      if (!((files || []).length) || (!tolakTipe && !tolakBesar)) showToast("File harus foto atau video", "error");
      return;
    }
    if (!Arsip.draft.files) Arsip.draft.files = [];
    valid.forEach((f) => Arsip.draft.files.push(f));
    Arsip.render();
    const draftEl = document.querySelector("#arsipGrid .bento-block.draft");
    if (draftEl)
      draftEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  buangDraft() {
    Arsip.draft = null;
    Arsip.render();
  },

  async simpanDraft() {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") {
      showPopup("Cuma OSIS", "error");
      return;
    }
    if (!OsisAuth.butuh("kegiatan")) return;
    Arsip.bacaTeksDraft();
    const d = Arsip.draft;
    if (!d || !d.judul || !d.judul.trim()) {
      showToast("Judul wajib diisi", "error");
      return;
    }
    if (
      (!d.files || d.files.length === 0) &&
      (!d.fotos || d.fotos.length === 0)
    ) {
      showToast("Tambah minimal 1 foto/video", "error");
      return;
    }
    // order dari MIN GLOBAL (bukan halaman aktif) biar selalu paling atas
    const __order = await Arsip.nextOrderGlobal();
    const __spec = () => ({ modul: "arsip", op: "create",
      label: "Arsip: " + String(d.judul || "").trim().slice(0, 42),
      payload: { judul: d.judul.trim(), deskripsi: d.deskripsi || "", badge: d.badge || "",
        order: __order,
        fotosExisting: (d.fotos || []).map((fl) => ({
          path: typeof fl === "string" ? fl : fl.path,
          caption: typeof fl === "string" ? "" : fl.caption || "",
        })) },
      files: (d.files || []).map((fl, i) => ({ slot: "foto" + i, file: fl, name: fl.name, type: fl.type })),
      cacheKeys: ["arsip"] });
    const __sesudahAntre = () => { Arsip.draft = null; Arsip.render(); };
    if (typeof Outbox !== "undefined" && Outbox.offline()) {
      try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
      Outbox.sesudahAntre(__sesudahAntre);
      return;
    }
    const btn = document.querySelector("#arsipGrid .gal-save");
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const paths = [];
      if (d.fotos) {
        for (const f of d.fotos) {
          const p = typeof f === "string" ? f : f.path;
          const c = typeof f === "string" ? "" : f.caption || "";
          paths.push({ path: p, caption: c });
        }
      }
      for (let i = 0; i < (d.files || []).length; i++) {
        const f = d.files[i];
        const ext = ((f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 8);
        const path = `arsip/arsip-${u.id}-${Date.now()}-${i}.${ext}`;
        await uploadFotoStorage(f, path, { label: "Arsip: " + String(d.judul || "").trim().slice(0, 42) });
        paths.push({ path, caption: "" });
      }
      const newId = await buatArsip(
        u.id,
        d.judul.trim(),
        d.deskripsi || "",
        d.badge || "",
        paths,
        __order,
      );
      if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
      showToast("Arsip ditambah!", "success");
      Arsip.draft = null;
      Arsip.go(1);
    } catch (err) {
      console.error(err);
      if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
        Outbox.sesudahAntre(__sesudahAntre);
        return;
      }
      showToast("Gagal simpan: " + err.message, "error");
      if (btn) btn.innerHTML = '<i class="fa-solid fa-check"></i>';
    }
  },

  async updateFotoCaption(kegiatanId, fotoIdx, caption) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    const item = Arsip.rows.find(
      (k) => String(k.id) === String(kegiatanId),
    );
    if (!item || !Array.isArray(item.fotos) || !item.fotos[fotoIdx]) return;

    const newFotos = item.fotos.slice();
    const foto = newFotos[fotoIdx];
    newFotos[fotoIdx] =
      typeof foto === "string" ? { path: foto, caption } : { ...foto, caption };

    try {
      await updateArsip(
        u.id,
        kegiatanId,
        item.judul,
        item.deskripsi,
        item.badge,
        newFotos,
        item.display_order,
      );
      const idx = Arsip.rows.findIndex(
        (k) => String(k.id) === String(kegiatanId),
      );
      if (idx >= 0) Arsip.rows[idx] = { ...Arsip.rows[idx], fotos: newFotos };
      showToast("Caption arsip tersimpan", "success");
    } catch (err) {
      console.error(err);
      showPopup("Gagal simpan caption: " + err.message, "error");
      await Arsip.muat(Arsip.page);
    }
  },

  async updateText(kegiatanId, field, value) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    if (!OsisAuth.butuh("kegiatan")) return;
    const item = Arsip.rows.find(
      (k) => String(k.id) === String(kegiatanId),
    );
    if (!item || !["judul", "deskripsi", "badge"].includes(field)) return;

    const next = { ...item, [field]: value };
    try {
      await updateArsip(
        u.id,
        kegiatanId,
        next.judul,
        next.deskripsi,
        next.badge,
        next.fotos,
        next.display_order,
      );
      const idx = Arsip.rows.findIndex(
        (k) => String(k.id) === String(kegiatanId),
      );
      if (idx >= 0) Arsip.rows[idx] = next;
      showToast("Arsip tersimpan", "success");
    } catch (err) {
      console.error(err);
      showPopup("Gagal simpan kegiatan: " + err.message, "error");
      await Arsip.muat(Arsip.page);
    }
  },

  async hapus(id) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    if (!OsisAuth.butuh("kegiatan")) return;
    const yakin = await showPopup(
      "Hapus kegiatan ini? Fotonya ikut terhapus.",
      "confirm",
    );
    if (!yakin) return;
    try {
      const item = Arsip.rows.find((k) => String(k.id) === String(id));
      await hapusArsip(u.id, id);
      if (item && Array.isArray(item.fotos)) {
        for (const f of item.fotos) {
          const p = typeof f === "string" ? f : f.path;
          if (p)
            try {
              await hapusFotoStorage(p);
            } catch {}
        }
      }
      showToast("Arsip dihapus", "success");
      await Arsip.muat(Arsip.page);
    } catch (err) {
      console.error(err);
      showPopup("Gagal hapus: " + err.message, "error");
    }
  },

  async hapusFoto(kegiatanId, fotoIdx) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    if (!OsisAuth.butuh("kegiatan")) return;
    const item = Arsip.rows.find(
      (k) => String(k.id) === String(kegiatanId),
    );
    if (!item || !Array.isArray(item.fotos) || !item.fotos[fotoIdx]) return;
    const foto = item.fotos[fotoIdx];
    const path = typeof foto === "string" ? foto : foto.path;
    const isLast = Array.isArray(item.fotos) && item.fotos.length === 1;
    const yakin = await showPopup(
      isLast
        ? "Ini foto terakhir. Kegiatan akan otomatis terhapus. Lanjutkan?"
        : "Hapus foto ini?",
      "confirm",
    );
    if (!yakin) return;
    try {
      const newFotos = item.fotos.filter((_, i) => i !== fotoIdx);
      if (newFotos.length === 0) {
        await hapusArsip(u.id, kegiatanId);
        if (path)
          try {
            await hapusFotoStorage(path);
          } catch {}
        showToast("Arsip terhapus (tidak ada foto)", "success");
      } else {
        await updateArsip(
          u.id,
          kegiatanId,
          item.judul,
          item.deskripsi,
          item.badge,
          newFotos,
          item.display_order,
        );
        if (path)
          try {
            await hapusFotoStorage(path);
          } catch {}
        showToast("Foto dihapus", "success");
      }
      await Arsip.muat(Arsip.page);
    } catch (err) {
      console.error(err);
      showPopup("Gagal hapus foto: " + err.message, "error");
    }
  },

  renderBar() {
    const bar = document.getElementById("arsipBar");
    if (!bar) return;
    const hal = Arsip.page;
    const maxHal = Arsip.totalHal();
    bar.innerHTML = `
      <button class="btn btn-white btn-sm" onclick="Arsip.go(${hal - 1})" ${hal <= 1 ? "disabled" : ""}>
        <i class="fa-solid fa-chevron-left"></i> Prev
      </button>
      <span class="arsip-pageinfo">Hal <b>${hal}</b> dari <b>${maxHal}</b> &bull; ${Arsip.total} kegiatan</span>
      <button class="btn btn-white btn-sm" onclick="Arsip.go(${hal + 1})" ${hal >= maxHal ? "disabled" : ""}>
        Next <i class="fa-solid fa-chevron-right"></i>
      </button>`;
  },
};

// =========================================================================
// RUANG KHUSUS PELANTIKAN — satu tombol gembok di halaman arsip.
// - Publik/biasa WAJIB login lalu "Minta Akses" (nama+alasan tercatat).
// - Pemilik = OSIS yang bisa('kegiatan') incl super admin: auto-masuk +
//   bisa Setujui/Tolak + cabut + kunci/buka gembok per kegiatan.
// - Isi private TIDAK ikut grid publik (RLS) — hanya via RPC bertanda.
// =========================================================================
const ArsipPelantikan = {
  status: null, // owner|setuju|pending|tolak|belum|butuh_login
  page: 1,
  perPage: 6,
  total: 0,
  rows: [],
  draft: null, // { judul, deskripsi, badge, files:[File] }
  _minta: [],

  isOwner() {
    try {
      const u = OsisAuth.getUser && OsisAuth.getUser();
      return !!(u && u.mode === "osis" && OsisAuth.bisa && OsisAuth.bisa("kegiatan"));
    } catch { return false; }
  },

  async statusSaya() {
    try {
      if (ArsipPelantikan.isOwner()) return "owner";
      if (typeof statusAksesPelantikan !== "function") return "belum";
      return await statusAksesPelantikan();
    } catch { return "belum"; }
  },

  // Kartu di #/arsip: update tulisan + tombol sesuai status akses saya.
  // pending -> tombol berubah jadi "Menunggu Persetujuan".
  async refreshTombol() {
    try {
      const st = await ArsipPelantikan.statusSaya();
      ArsipPelantikan.status = st;
      ArsipPelantikan.tulisStatus(st);
      ArsipPelantikan.tulisTombol(st);
      ArsipPelantikan.refreshOwner();
    } catch {}
  },

  // Init halaman khusus #/pelantikan (dipanggil tiap rute dibuka).
  async init() {
    const gate = document.getElementById("pelantikanGate");
    if (gate) gate.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memeriksa akses...</div>`;
    const grid = document.getElementById("pelantikanGrid");
    const bar = document.getElementById("pelantikanBar");
    if (grid) grid.style.display = "none";
    if (bar) bar.style.display = "none";
    // Input file draft + klik up-slot (sekali saja)
    if (!document.getElementById("pelantikanFileInput")) {
      const fi = document.createElement("input");
      fi.type = "file";
      fi.id = "pelantikanFileInput";
      fi.accept = "image/*,video/mp4,video/webm,video/quicktime";
      fi.multiple = true;
      fi.style.display = "none";
      fi.addEventListener("change", () => ArsipPelantikan.tambahFotoDraft(fi));
      document.body.appendChild(fi);
    }
    if (grid && !grid._pelBound) {
      grid._pelBound = true;
      grid.addEventListener("click", (e) => {
        if (e.target.closest(".up-slot")) {
          document.getElementById("pelantikanFileInput")?.click();
        }
      });
    }
    try {
      ArsipPelantikan.status = await ArsipPelantikan.statusSaya();
    } catch { ArsipPelantikan.status = "belum"; }
    ArsipPelantikan.tulisTombol(ArsipPelantikan.status);
    ArsipPelantikan.renderHalaman();
    ArsipPelantikan.refreshOwner();
  },

  async refresh() {
    try { ArsipPelantikan.status = await ArsipPelantikan.statusSaya(); }
    catch { ArsipPelantikan.status = "belum"; }
    ArsipPelantikan.tulisTombol(ArsipPelantikan.status);
    ArsipPelantikan.renderHalaman();
    ArsipPelantikan.refreshOwner();
  },

  tulisStatus(st) {
    const el = document.getElementById("vaultStatus");
    if (!el) return;
    const peta = {
      owner: "Kamu pemilik arsip — langsung bisa buka + ACC permintaan masuk di bawah.",
      setuju: "Aksesmu sudah disetujui. Klik tombol buat lihat isinya.",
      pending: "Permintaanmu lagi nunggu disetujui pemilik arsip. Cek lagi nanti ya.",
      tolak: "Maaf, permintaanmu ditolak. Kamu boleh ajukan ulang dengan alasan yang jelas.",
      belum: "Dokumentasi pelantikan & penyematan bersifat sensitif. Minta izin dulu buat lihat.",
      butuh_login: "Login dulu sebagai akun biasa, baru bisa minta akses.",
    };
    el.textContent = peta[st] || peta.belum;
  },

  tulisTombol(st) {
    const label = document.getElementById("btnVaultLabel");
    const btn = document.getElementById("btnVaultBuka");
    if (!label || !btn) return;
    const ikon = btn.querySelector("i.fa-solid");
    if (st === "pending") {
      label.textContent = "Menunggu persetujuan";
      if (ikon) ikon.className = "fa-solid fa-hourglass-half";
    } else {
      label.textContent = "Lihat arsip pelantikan";
      if (ikon) ikon.className = st === "owner" || st === "setuju" ? "fa-solid fa-lock-open" : "fa-solid fa-lock";
    }
  },

  keLogin() {
    try { OsisAuth.simpanBack && OsisAuth.simpanBack(); } catch {}
    location.href = "login";
  },

  // Penjelasan pembuka: kenapa halaman ini dikunci (tampil sebelum form /
  // tombol aksi buat yang belum punya akses).
  penjelasanHtml() {
    return `
      <div class="vault-card vault-info">
        <div class="vault-ico"><i class="fa-solid fa-circle-info"></i></div>
        <div class="vault-txt">
          <b>Arsip foto &amp; video pelantikan — akses terbatas</b>
          <ul>
            <li>Halaman ini berisi dokumentasi <b>pelantikan &amp; penyematan pengurus OSIS</b>.</li>
            <li>Hanya <b>orang tertentu yang punya akses</b> yang bisa buka, agar tidak disalahgunakan (disebar tanpa izin, diedit, dsb).</li>
            <li>Butuh melihat? Minta akses ke <b>pemilik arsip</b> dengan alasan yang jelas.</li>
          </ul>
        </div>
      </div>`;
  },

  // Isi #pelantikanGate sesuai status: login / form minta / menunggu / info.
  renderHalaman() {
    const gate = document.getElementById("pelantikanGate");
    const grid = document.getElementById("pelantikanGrid");
    const bar = document.getElementById("pelantikanBar");
    if (!gate) return;
    const st = ArsipPelantikan.status || "belum";
    const sembunyiIsi = () => {
      if (grid) { grid.style.display = "none"; grid.innerHTML = ""; }
      if (bar) { bar.style.display = "none"; bar.innerHTML = ""; }
    };
    if (st === "butuh_login") {
      sembunyiIsi();
      gate.innerHTML = ArsipPelantikan.penjelasanHtml() + `
        <div class="vault-card">
          <div class="vault-ico"><i class="fa-solid fa-right-to-bracket"></i></div>
          <div class="vault-txt">
            <b>Ruang ini khusus — login dulu</b>
            <p>Daftar / masuk sebagai akun biasa, baru bisa minta akses ke pemilik arsip.</p>
          </div>
          <button class="btn btn-red btn-sm" onclick="ArsipPelantikan.keLogin()"><i class="fa-solid fa-right-to-bracket"></i> Login / Daftar</button>
        </div>`;
      return;
    }
    if (st === "pending") {
      sembunyiIsi();
      gate.innerHTML = ArsipPelantikan.penjelasanHtml() + `
        <div class="vault-card">
          <div class="vault-ico"><i class="fa-solid fa-hourglass-half"></i></div>
          <div class="vault-txt">
            <b>Menunggu persetujuan</b>
            <p>Permintaanmu sudah masuk. Pemilik arsip lagi ngecek — cek lagi nanti ya.</p>
          </div>
          <button class="btn btn-white btn-sm" onclick="ArsipPelantikan.refresh()"><i class="fa-solid fa-rotate-right"></i> Cek Lagi</button>
        </div>`;
      return;
    }
    if (st === "belum" || st === "tolak") {
      sembunyiIsi();
      const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()) || null;
      const nama = u ? (OsisAuth.displayName ? OsisAuth.displayName(u) : (u.nama || u.username || "")) : "";
      gate.innerHTML = ArsipPelantikan.penjelasanHtml() + `
        <div class="vault-card" style="align-items:flex-start">
          <div class="vault-ico"><i class="fa-solid fa-key"></i></div>
          <div class="vault-txt">
            <b>Minta akses ke pemilik arsip</b>
            <p>Halo <b>${escapeHtml(nama || "kamu")}</b> — tulis alasan singkat (mis. “alumni 2019, mau nostalgia” / “butuh buat LPJ”).</p>
            ${st === "tolak" ? `<p><b style="color:var(--red)">Pengajuan terakhirmu ditolak — coba tulis alasan yang lebih jelas.</b></p>` : ""}
            <div class="field" style="margin-top:8px"><label>Alasan minta akses</label>
              <textarea id="pelantikanAlasan" class="admin-input" rows="3" maxlength="200" placeholder="Tulis alasanmu..."></textarea>
            </div>
            <div style="margin-top:8px"><button class="btn btn-red btn-sm" id="btnPelantikanKirim" onclick="ArsipPelantikan.kirim()"><i class="fa-solid fa-paper-plane"></i> Kirim Permintaan</button></div>
          </div>
        </div>`;
      return;
    }
    // owner / setuju: info + grid di bawah
    gate.innerHTML = st === "owner"
      ? `<div class="vault-card"><div class="vault-ico"><i class="fa-solid fa-crown"></i></div><div class="vault-txt"><b>Kamu pemilik arsip</b><p>Langsung bisa lihat + ACC permintaan masuk di bawah.</p></div></div>`
      : `<div class="vault-card"><div class="vault-ico"><i class="fa-solid fa-lock-open"></i></div><div class="vault-txt"><b>Akses disetujui</b><p>Selamat melihat ya!</p></div></div>`;
    if (grid) { grid.style.display = ""; grid.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat foto pelantikan...</div>`; }
    ArsipPelantikan.muatIsi(1);
  },

  async kirim() {
    const alasan = (document.getElementById("pelantikanAlasan")?.value || "").trim();
    if (!alasan) { showToast("Tulis alasan singkat dulu", "error"); return; }
    const btn = document.getElementById("btnPelantikanKirim");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...'; }
    try {
      const hasil = await mintaAksesPelantikan(alasan);
      if (hasil === "OWNER" || hasil === "OK_SUDAH") {
        ArsipPelantikan.status = "owner" === hasil ? "owner" : "setuju";
        if (hasil === "OK_SUDAH") showToast("Kamu sudah diizinkan — selamat melihat!", "success");
        ArsipPelantikan.tulisTombol(ArsipPelantikan.status);
        ArsipPelantikan.renderHalaman();
        ArsipPelantikan.refreshOwner();
        return;
      }
      ArsipPelantikan.status = "pending";
      ArsipPelantikan.tulisTombol("pending");
      ArsipPelantikan.renderHalaman();
      showToast("Permintaan terkirim. Tombol arsip ikut berubah jadi Menunggu.", "success");
    } catch (err) {
      console.error(err);
      showToast("Gagal kirim: " + (err.message || err), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Permintaan'; }
    }
  },

  async muatIsi(page) {
    ArsipPelantikan.page = Math.max(1, parseInt(page, 10) || 1);
    const grid = document.getElementById("pelantikanGrid");
    const bar = document.getElementById("pelantikanBar");
    if (grid) { grid.style.display = ""; grid.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat foto pelantikan...</div>`; }
    if (bar) { bar.style.display = "none"; bar.innerHTML = ""; }
    try {
      const r = await getPelantikan(ArsipPelantikan.page, ArsipPelantikan.perPage);
      ArsipPelantikan.total = r.total || 0;
      ArsipPelantikan.rows = r.rows || [];
      ArsipPelantikan.renderIsi();
    } catch (err) {
      console.error(err);
      // Izin dicabut di tengah jalan / sesi habis -> cek ulang status
      ArsipPelantikan.refresh();
    }
  },

  go(p) {
    ArsipPelantikan.muatIsi(p);
    const view = document.querySelector('.view[data-view="pelantikan"]');
    if (view) view.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo(0, 0);
  },

  renderIsi() {
    const box = document.getElementById("pelantikanGrid");
    const bar = document.getElementById("pelantikanBar");
    if (!box) return;
    box.style.display = "";
    const owner = ArsipPelantikan.isOwner();
    box.classList.toggle("mode-osis", !!owner);
    let html = "";
    if (owner && ArsipPelantikan.draft) html += ArsipPelantikan.kartuDraft();
    const rows = ArsipPelantikan.rows || [];
    if (!rows.length && !ArsipPelantikan.draft) {
      box.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-images"></i> Belum ada foto pelantikan di ruang ini.</div>`;
      if (bar) { bar.style.display = "none"; bar.innerHTML = ""; }
      return;
    }
    const maxHal = Math.max(1, Math.ceil((ArsipPelantikan.total || 0) / ArsipPelantikan.perPage));
    html += rows.map((item) => {
      const judul = escapeHtml(item.judul || "");
      const fotos = Array.isArray(item.fotos) ? item.fotos : [];
      const fotosHtml = fotos.map((f, idx) => {
        const path = typeof f === "string" ? f : f.path;
        if (!path) return "";
        const media = (typeof thumbBento === "function")
          ? thumbBento(getFoto(path), judul)
          : `<img src="${getFoto(path)}" alt="${judul}" loading="lazy">`;
        return `<div class="item media-muat" data-vault-id="${item.id}" data-foto-idx="${idx}">${media}<button class="foto-del-btn" onclick="event.stopPropagation(); ArsipPelantikan.hapusFoto(${item.id}, ${idx})" title="Hapus foto"><i class="fa-solid fa-trash-can"></i></button></div>`;
      }).join("");
      return `<div class="bento-block" data-vault-id="${item.id}">
        <div class="bento-meta">
          <h4>${judul}</h4>
          ${item.deskripsi ? `<p>${escapeHtml(item.deskripsi)}</p>` : ""}
          <button class="icon-btn gal-del" onclick="event.stopPropagation(); ArsipPelantikan.hapus(${item.id})" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
        </div>
        <div class="bento-grid">${fotosHtml}</div>
      </div>`;
    }).join("");
    box.innerHTML = html;
    if (bar && rows.length) {
      bar.style.display = "";
      bar.innerHTML = `
        <button class="btn btn-white btn-sm" onclick="ArsipPelantikan.go(${ArsipPelantikan.page - 1})" ${ArsipPelantikan.page <= 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i> Prev</button>
        <span class="arsip-pageinfo">Hal <b>${ArsipPelantikan.page}</b> dari <b>${maxHal}</b> &bull; ${ArsipPelantikan.total} kegiatan</span>
        <button class="btn btn-white btn-sm" onclick="ArsipPelantikan.go(${ArsipPelantikan.page + 1})" ${ArsipPelantikan.page >= maxHal ? "disabled" : ""}>Next <i class="fa-solid fa-chevron-right"></i></button>`;
    } else if (bar) {
      bar.style.display = "none";
      bar.innerHTML = "";
    }
    box.querySelectorAll(".item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.vaultId;
        const idx = Number(el.dataset.fotoIdx || 0);
        ArsipPelantikan.bukaPopup(id, idx);
      });
    });
  },

  bukaPopup(id, fotoIdx) {
    const item = (ArsipPelantikan.rows || []).find((k) => String(k.id) === String(id));
    if (!item || !Array.isArray(item.fotos) || !item.fotos[fotoIdx]) return;
    const gallery = [];
    ArsipPelantikan.rows.forEach((k) => {
      (Array.isArray(k.fotos) ? k.fotos : []).forEach((foto, idx) => {
        const path = typeof foto === "string" ? foto : foto.path;
        if (!path) return;
        gallery.push({
          kegiatanId: k.id, fotoIdx: idx, src: getFoto(path),
          judul: k.judul || "Pelantikan",
          caption: (foto && typeof foto !== "string" && foto.caption) || "",
          oleh: k.pengunggah || "",
        });
      });
    });
    const index = Math.max(0, gallery.findIndex((f) => String(f.kegiatanId) === String(id) && f.fotoIdx === fotoIdx));
    if (typeof Home !== "undefined" && Home.bukaFotoPopup) {
      Home.bukaFotoPopup(null, item.judul || "Pelantikan", "", { gallery, index, oleh: item.pengunggah || "" });
    } else {
      window.open(gallery[index] && gallery[index].src, "_blank");
    }
  },

  // ---- Kelola isi (khusus pemilik): draft + upload + hapus ----
  ord(k) {
    const o = parseInt(k && k.display_order, 10);
    return Number.isFinite(o) ? o : 99;
  },

  buatDraft() {
    if (!OsisAuth.butuh("kegiatan")) return;
    if (ArsipPelantikan.draft) {
      const j = document.querySelector("#pelantikanGrid .draft-judul");
      if (j) j.focus();
      return;
    }
    ArsipPelantikan.draft = { judul: "", deskripsi: "", badge: "", files: [] };
    ArsipPelantikan.renderIsi();
    const j = document.querySelector("#pelantikanGrid .draft-judul");
    if (j) j.focus();
    const card = document.querySelector("#pelantikanGrid .bento-block.draft");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  },

  kartuDraft() {
    const d = ArsipPelantikan.draft || { judul: "", deskripsi: "", badge: "", files: [] };
    let fotosHtml = "";
    (d.files || []).forEach((f) => {
      const url = URL.createObjectURL(f);
      const isVid = typeof isVideoFile === "function" && isVideoFile(f);
      fotosHtml += isVid
        ? `<div class="item media-muat sudah-muat is-video"><video src="${url}" alt="" muted playsinline preload="metadata"></video><span class="vid-play" aria-hidden="true"><i class="fa-solid fa-play"></i></span></div>`
        : `<div class="item"><img src="${url}" alt=""></div>`;
    });
    fotosHtml += `<div class="up-slot" title="Tambah foto/video (bisa banyak sekaligus)"><i class="fa-solid fa-plus"></i></div>`;
    return `
      <div class="bento-block draft">
        <div class="bento-meta">
          <h4 class="draft-judul" contenteditable="true" spellcheck="false" data-ph="Judul (cth: Pelantikan 2025)">${escapeHtml(d.judul || "")}</h4>
          <p class="draft-desk" contenteditable="true" spellcheck="false" data-ph="Keterangan singkat...">${escapeHtml(d.deskripsi || "")}</p>
          <input type="text" class="admin-input draft-badge" placeholder="Badge (cth: 2025)" value="${escapeHtml(d.badge || "")}" maxlength="12">
          <div class="gal-actions">
            <button class="icon-btn gal-save" onclick="ArsipPelantikan.simpanDraft()" title="Simpan"><i class="fa-solid fa-check"></i></button>
            <button class="icon-btn gal-del" onclick="ArsipPelantikan.buangDraft()" title="Buang draft"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
        <div class="bento-grid">${fotosHtml}</div>
      </div>`;
  },

  bacaTeksDraft() {
    if (!ArsipPelantikan.draft) return;
    const jEl = document.querySelector("#pelantikanGrid .draft-judul");
    const dEl = document.querySelector("#pelantikanGrid .draft-desk");
    const bEl = document.querySelector("#pelantikanGrid .draft-badge");
    if (jEl) ArsipPelantikan.draft.judul = jEl.textContent.trim();
    if (dEl) ArsipPelantikan.draft.deskripsi = dEl.textContent.trim();
    if (bEl) ArsipPelantikan.draft.badge = bEl.value.trim();
  },

  tambahFotoDraft(input) {
    if (!ArsipPelantikan.draft) return;
    const files = input.files ? [...input.files] : [];
    input.value = "";
    ArsipPelantikan.bacaTeksDraft();
    const pilah = (typeof pilahMedia === "function" ? pilahMedia(files) : { valid: (files || []).filter((f) => f && f.type && f.type.startsWith("image/")), tolakTipe: 0, tolakBesar: 0 });
    if (pilah.tolakTipe > 0) showToast(pilah.tolakTipe + " file bukan foto/video, dilewati", "error");
    if (pilah.tolakBesar > 0) showToast(pilah.tolakBesar + " video >100MB, dilewati", "error");
    if (!pilah.valid.length) return;
    if (!ArsipPelantikan.draft.files) ArsipPelantikan.draft.files = [];
    pilah.valid.forEach((f) => ArsipPelantikan.draft.files.push(f));
    ArsipPelantikan.renderIsi();
  },

  buangDraft() {
    ArsipPelantikan.draft = null;
    ArsipPelantikan.renderIsi();
  },

  async simpanDraft() {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
    if (!OsisAuth.butuh("kegiatan")) return;
    if (typeof Outbox !== "undefined" && Outbox.offline()) {
      showToast("Lagi offline — pelantikan cuma bisa diupload pas online.", "error");
      return;
    }
    ArsipPelantikan.bacaTeksDraft();
    const d = ArsipPelantikan.draft;
    if (!d || !d.judul || !d.judul.trim()) { showToast("Judul wajib diisi", "error"); return; }
    if (!d.files || !d.files.length) { showToast("Tambah minimal 1 foto/video", "error"); return; }
    const rows = ArsipPelantikan.rows || [];
    const order = rows.length ? Math.min(...rows.map(ArsipPelantikan.ord)) - 1 : 99;
    const btn = document.querySelector("#pelantikanGrid .gal-save");
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const paths = [];
      for (let i = 0; i < d.files.length; i++) {
        const f = d.files[i];
        const ext = ((f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 8);
        const path = `pelantikan/pel-${u.id}-${Date.now()}-${i}.${ext}`;
        await uploadFotoStorage(f, path, { label: "Pelantikan: " + String(d.judul || "").trim().slice(0, 42) });
        paths.push({ path, caption: "" });
      }
      const newId = await buatPelantikan(u.id, d.judul.trim(), d.deskripsi || "", d.badge || "", paths, order);
      if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
      showToast("Foto pelantikan ditambah!", "success");
      ArsipPelantikan.draft = null;
      ArsipPelantikan.muatIsi(1);
    } catch (err) {
      console.error(err);
      showToast("Gagal simpan: " + err.message, "error");
      if (btn) btn.innerHTML = '<i class="fa-solid fa-check"></i>';
    }
  },

  async hapus(id) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    if (!OsisAuth.butuh("kegiatan")) return;
    const yakin = await showPopup("Hapus kegiatan ini? Fotonya ikut terhapus.", "confirm");
    if (!yakin) return;
    try {
      const item = ArsipPelantikan.rows.find((k) => String(k.id) === String(id));
      await hapusPelantikan(u.id, id);
      if (item && Array.isArray(item.fotos)) {
        for (const f of item.fotos) {
          const p = typeof f === "string" ? f : f.path;
          if (p) try { await hapusFotoStorage(p); } catch {}
        }
      }
      showToast("Dihapus", "success");
      ArsipPelantikan.muatIsi(ArsipPelantikan.page);
    } catch (err) {
      console.error(err);
      showPopup("Gagal hapus: " + err.message, "error");
    }
  },

  async hapusFoto(kegiatanId, fotoIdx) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    if (!OsisAuth.butuh("kegiatan")) return;
    const item = ArsipPelantikan.rows.find((k) => String(k.id) === String(kegiatanId));
    if (!item || !Array.isArray(item.fotos) || !item.fotos[fotoIdx]) return;
    const foto = item.fotos[fotoIdx];
    const path = typeof foto === "string" ? foto : foto.path;
    const isLast = item.fotos.length === 1;
    const yakin = await showPopup(isLast ? "Ini foto terakhir. Kegiatan akan otomatis terhapus. Lanjutkan?" : "Hapus foto ini?", "confirm");
    if (!yakin) return;
    try {
      const newFotos = item.fotos.filter((_, i) => i !== fotoIdx);
      if (newFotos.length === 0) {
        await hapusPelantikan(u.id, kegiatanId);
        if (path) try { await hapusFotoStorage(path); } catch {}
        showToast("Kegiatan terhapus (tidak ada foto)", "success");
      } else {
        await updatePelantikan(u.id, kegiatanId, item.judul, item.deskripsi, item.badge, newFotos, item.display_order);
        if (path) try { await hapusFotoStorage(path); } catch {}
        showToast("Foto dihapus", "success");
      }
      ArsipPelantikan.muatIsi(ArsipPelantikan.page);
    } catch (err) {
      console.error(err);
      showPopup("Gagal hapus foto: " + err.message, "error");
    }
  },

  // ---- Pemilik: bar compact + daftar permintaan via popup ----
  async refreshOwner() {
    const bar = document.getElementById("pelantikanOwnerBar");
    if (!bar) return;
    if (!ArsipPelantikan.isOwner()) { bar.style.display = "none"; return; }
    bar.style.display = "";
    ArsipPelantikan.muatPermintaan(false);
  },

  kartuMinta(r) {
    return `
        <div class="vault-req">
          <div style="flex:1;min-width:160px">
            <span class="nm">${escapeHtml(r.nama || "-")}</span>
            <span class="sub">@${escapeHtml(r.username || "-")} &bull; ${r.tipe === "osis" ? "OSIS" : "akun biasa"} &bull; ${escapeHtml(String(r.alasan || "").slice(0, 80))}</span>
          </div>
          <span class="st ${r.status}">${r.status === "pending" ? "nunggu" : r.status === "setuju" ? "diizinkan" : "ditolak"}</span>
          ${r.status === "pending" ? `
            <button class="btn btn-red btn-sm" onclick="ArsipPelantikan.putus(${r.id}, true)"><i class="fa-solid fa-check"></i> Izinkan</button>
            <button class="btn btn-white btn-sm" onclick="ArsipPelantikan.putus(${r.id}, false)">Tolak</button>` : `
            <button class="btn btn-white btn-sm" onclick="ArsipPelantikan.putus(${r.id}, ${r.status !== "setuju"})">${r.status === "setuju" ? "Cabut" : "Izinkan"}</button>`}
        </div>`;
  },

  async muatPermintaan(manual) {
    const count = document.getElementById("pelantikanOwnerCount");
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    if (!ArsipPelantikan.isOwner()) return;
    const list = document.getElementById("pelantikanReqList");
    if (manual && list) list.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat...</div>`;
    try {
      const rows = await daftarMintaPelantikan(u.id);
      ArsipPelantikan._minta = rows || [];
      const pending = ArsipPelantikan._minta.filter((r) => r.status === "pending").length;
      if (count) count.textContent = pending ? `(${pending})` : "";
      if (list) {
        if (!ArsipPelantikan._minta.length) {
          list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-inbox"></i> Belum ada yang minta akses.</div>`;
        } else {
          list.innerHTML = ArsipPelantikan._minta.map((r) => ArsipPelantikan.kartuMinta(r)).join("");
        }
      }
    } catch (err) {
      console.error(err);
      if (manual && list) list.innerHTML = `<div class="pesan-empty">Gagal memuat: ${escapeHtml(err.message)}</div>`;
    }
  },

  // Popup daftar permintaan (hemat ruang, dibuka dari bar pemilik)
  bukaPermintaan() {
    if (!ArsipPelantikan.isOwner()) return;
    let m = document.getElementById("pelantikanReqModal");
    if (!m) {
      m = document.createElement("div");
      m.className = "vault-modal";
      m.id = "pelantikanReqModal";
      m.innerHTML = `<div class="vault-modal-inner">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <b style="font-size:1rem"><i class="fa-solid fa-inbox" style="color:var(--red)"></i> Permintaan akses</b>
          <button class="icon-btn" onclick="ArsipPelantikan.tutupPermintaan()" title="Tutup"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div id="pelantikanReqList"><div class="loading-block"><div class="spinner"></div>Memuat...</div></div>
      </div>`;
      m.addEventListener("click", (e) => { if (e.target === m) ArsipPelantikan.tutupPermintaan(); });
      document.body.appendChild(m);
    }
    m.classList.add("open");
    document.body.style.overflow = "hidden";
    ArsipPelantikan.muatPermintaan(true);
  },

  tutupPermintaan() {
    document.getElementById("pelantikanReqModal")?.classList.remove("open");
    document.body.style.overflow = "";
  },

  async putus(id, setuju) {
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (!u || u.mode !== "osis") return;
    try {
      await putusMintaPelantikan(u.id, id, setuju);
      showToast(setuju ? "Akses diizinkan" : "Akses ditolak/dicabut", "success");
      ArsipPelantikan.muatPermintaan(false);
    } catch (err) { showToast("Gagal: " + err.message, "error"); }
  },
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("pelantikanReqModal")?.classList.contains("open")) {
    ArsipPelantikan.tutupPermintaan();
  }
});

if (typeof Router !== "undefined") {
  Router.register("arsip", () => {
    Arsip.init();
    try { ArsipPelantikan.refreshTombol(); } catch {}
  });
  Router.register("pelantikan", () => ArsipPelantikan.init());
  // Router hanya init sekali per view — segarkan manual tiap pindah hash
  // biar status akses (pending -> disetujui) tidak basi.
  window.addEventListener("hashchange", () => {
    try {
      if (typeof Router === "undefined" || !Router.parse) return;
      const r = Router.parse();
      if (r === "pelantikan") ArsipPelantikan.init();
      else if (r === "arsip") ArsipPelantikan.refreshTombol();
    } catch {}
  });
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Arsip.init());
} else {
  Arsip.init();
}
