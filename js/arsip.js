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
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        Arsip.tambahFileDraft(file);
      });
    }
    if (!document.getElementById("arsipFileInput")) {
      const fi2 = document.createElement("input");
      fi2.type = "file";
      fi2.id = "arsipFileInput";
      fi2.accept = "image/*";
      fi2.style.display = "none";
      fi2.addEventListener("change", () => Arsip.tambahFotoDraft(fi2));
      document.body.appendChild(fi2);
    }
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
  },

  async muat(page) {
    const grid = document.getElementById("arsipGrid");
    if (!grid) return;
    Arsip.page = Math.max(1, parseInt(page, 10) || 1);
    const token = ++Arsip.token;
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
      Arsip.render();
    } catch (err) {
      console.error(err);
      if (token !== Arsip.token) return;
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
      html += `<div class="pesan-empty"><i class="fa-solid fa-images"></i> Belum ada arsip.</div>`;
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
    const isEdit =
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
        return `<div class="item" data-foto-idx="${idx}"><img src="${getFoto(path)}" alt="${judul}" loading="lazy" onerror="this.style.display='none'">${badgeHtml}<button class="foto-del-btn" onclick="event.stopPropagation(); Arsip.hapusFoto(${item.id}, ${idx})" title="Hapus foto"><i class="fa-solid fa-trash-can"></i></button></div>`;
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
          return `<div class="item"><img src="${getFoto(p)}" alt=""></div>`;
        })
        .join("");
    }
    (d.files || []).forEach((f) => {
      const url = URL.createObjectURL(f);
      fotosHtml += `<div class="item"><img src="${url}" alt=""></div>`;
    });
    fotosHtml += `<div class="up-slot" title="Tambah foto"><i class="fa-solid fa-plus"></i></div>`;
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
    const file = input.files && input.files[0];
    input.value = "";
    Arsip.tambahFileDraft(file);
  },

  tambahFileDraft(file) {
    if (!Arsip.draft) return;
    Arsip.bacaTeksDraft();
    if (!file || !file.type.startsWith("image/")) {
      if (file) showToast("File harus gambar", "error");
      return;
    }
    if (!Arsip.draft.files) Arsip.draft.files = [];
    Arsip.draft.files.push(file);
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
      showToast("Tambah minimal 1 foto", "error");
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
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `arsip/arsip-${u.id}-${Date.now()}-${i}.${ext}`;
        await uploadFotoStorage(f, path);
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

if (typeof Router !== "undefined") {
  Router.register("arsip", () => Arsip.init());
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Arsip.init());
} else {
  Arsip.init();
}
