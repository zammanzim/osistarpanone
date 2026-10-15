// =========================================================================
// GALERI — dokumentasi kegiatan: judul + subjudul + grid foto
// (turun ke bawah). Tambah kegiatan = draft block inline di urutan paling
// atas (editable), foto ditambah satu-satu lewat slot "+" di kanan.
// Auto-save: foto pertama bikin baris DB, teks ke-save pas blur.
// =========================================================================

const Galeri = {
    terinisialisasi: false,
    draft: null, // { id: number|null, judul: "", deskripsi: "", fotos: [] }
    cache: [],   // akumulasi halaman infinite-scroll, dipake pas re-render draft
    perPage: 12, // hemat egress: 12 kegiatan per halaman
    offset: 0,
    habis: false,
    loading: false,

    init() {
        if (Galeri.terinisialisasi) return;
        Galeri.terinisialisasi = true;
        // Segarkan hak kendali lalu sesuaikan tombol
        if (typeof OsisAuth.refreshAkses === "function") {
            OsisAuth.refreshAkses().then(() => { Galeri.cekLogin(); Galeri.render(); }).catch(() => {});
        }
        Galeri.cekLogin();
        Galeri.muat(true);

        // Slot + & tombol hapus draft
        const grid = document.getElementById("galGrid");
        if (grid) grid.addEventListener("click", (e) => {
            if (e.target.closest(".up-slot")) {
                document.getElementById("galFileInput").click();
            }
        });
        if (grid) {
            ["dragenter", "dragover"].forEach(ev => {
                grid.addEventListener(ev, (e) => {
                    const slot = e.target.closest(".up-slot");
                    if (!slot) return;
                    e.preventDefault();
                    slot.classList.add("dragover");
                });
            });
            ["dragleave", "drop"].forEach(ev => {
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
                Galeri.tambahFilesDraft(files);
            });
        }
        const fileInput = document.getElementById("galFileInput");
        if (fileInput) fileInput.addEventListener("change", () => Galeri.tambahFotoDraft(fileInput));

        // Autosave judul/deskripsi inline — elemen editable-nya cuma ada pas state edit nyala
        if (grid && !grid._textEditBound) {
            grid._textEditBound = true;
            grid.addEventListener("focusout", (e) => {
                const el = e.target.closest(
                    "[data-galeri-field][contenteditable='true']",
                );
                if (!el) return;
                const targetBlock = el.closest(".bento-block");
                const id = targetBlock ? targetBlock.dataset.galeriId : null;
                const field = el.dataset.galeriField;
                if (!id || !field) return;

                const item = Galeri.cache.find((g) => String(g.id) === String(id));
                if (!item) return;
                const value = el.textContent.trim();
                if (field === "judul" && !value) {
                    el.textContent = item.judul || "Judul Kegiatan";
                    showToast("Judul gak boleh kosong", "error");
                    return;
                }
                if (value !== (item[field] || ""))
                    Galeri.updateText(id, field, value);
            });
        }

    },

    // Tombol tambah & hapus khusus pemegang kendali galeri
    cekLogin() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        const osis = !!(u && u.mode === "osis");
        const boleh = osis && OsisAuth.bisa && OsisAuth.bisa("galeri");
        const btn = document.getElementById("btnBukaUpload");
        if (btn) btn.style.display = boleh ? "" : "none";
        const grid = document.getElementById("galGrid");
        if (grid) grid.classList.toggle("mode-osis", !!boleh);
    },

    // ============ DRAFT BLOCK ============
    buatDraft() {
        if (!OsisAuth.butuh("galeri")) return;
        if (Galeri.draft) {
            const j = document.querySelector(".draft-judul");
            if (j) j.focus();
            return;
        }
        Galeri.draft = { judul: "", deskripsi: "", files: [] };
        Galeri.render();
        const j = document.querySelector(".draft-judul");
        if (j) j.focus();
        const card = document.querySelector(".bento-block.draft");
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    },

    bacaTeksDraft() {
        const j = document.querySelector(".draft-judul");
        const d = document.querySelector(".draft-desk");
        if (j) Galeri.draft.judul = j.textContent.trim();
        if (d) Galeri.draft.deskripsi = d.textContent.trim();
    },

    // Tambah foto ke draft — cuma preview lokal, belum upload.
    // Bisa banyak sekaligus (input multiple / drop banyak file).
    tambahFotoDraft(input) {
        if (!Galeri.draft) return;
        const files = input.files ? [...input.files] : [];
        input.value = "";
        Galeri.tambahFilesDraft(files);
    },

    tambahFileDraft(file) {
        if (file) Galeri.tambahFilesDraft([file]);
    },

    // Intake batch: render sekali di akhir biar preview banyak foto tetap ringan.
    // Terima foto + video (MP4/WEBM/MOV, max 100MB).
    tambahFilesDraft(files) {
        if (!Galeri.draft) return;
        Galeri.bacaTeksDraft();
        const { valid, tolakTipe, tolakBesar } = (typeof pilahMedia === "function" ? pilahMedia(files) : { valid: (files || []).filter((f) => f && f.type && f.type.startsWith("image/")), tolakTipe: 0, tolakBesar: 0 });
        if (tolakTipe > 0) showToast(tolakTipe + " file bukan foto/video, dilewati", "error");
        if (tolakBesar > 0) showToast(tolakBesar + " video >100MB, dilewati", "error");
        if (!valid.length) {
            if (!((files || []).length) || (!tolakTipe && !tolakBesar)) showToast("File harus foto atau video", "error");
            return;
        }
        if (!Galeri.draft.files) Galeri.draft.files = [];
        valid.forEach((f) => Galeri.draft.files.push(f));
        const total = Galeri.draft.files.length;
        const batas = (typeof BATAS_PREVIEW_DRAFT !== "undefined" ? BATAS_PREVIEW_DRAFT : 24);
        if (total > batas) showToast(`Preview dibatasi ${batas} biar ringan, ${total} tetap ke-upload semua`, "info");
        Galeri.render();
        // fokus balik biar gampang tambah lagi
        const draftEl = document.querySelector(".bento-block.draft");
        if (draftEl) draftEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },

    // Simpan draft — upload semua foto baru bikin row DB
    async simpanDraft() {
        const u = OsisAuth.getUser();
        if (!u || u.mode !== "osis" || !Galeri.draft) return;
        if (!OsisAuth.butuh("galeri")) return;
        Galeri.bacaTeksDraft();
        const judul = Galeri.draft.judul || "";
        const files = Galeri.draft.files || [];

        if (!judul) {
            showToast("Judul kegiatan diisi dulu yaa!", "error");
            const el = document.querySelector(".draft-judul");
            if (el) el.focus();
            return;
        }
        if (files.length === 0) {
            showToast("Tambah minimal 1 foto/video dulu!", "error");
            return;
        }

        const __spec = () => ({ modul: "galeri", op: "create",
            label: "Galeri: " + String(judul).slice(0, 42),
            payload: { judul, deskripsi: Galeri.draft.deskripsi || "" },
            files: files.map((fl, i) => ({ slot: "foto" + i, file: fl, name: fl.name, type: fl.type })),
            cacheKeys: ["gallery"] });
        const __sesudahAntre = () => { Galeri.draft = null; Galeri.render(); };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
            return;
        }

        const btn = document.querySelector(".gal-save");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

        try {
            const paths = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const ext = ((file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 8);
                const path = `gallery/galeri-${u.id}-${Date.now()}-${i}.${ext}`;
                await uploadFotoStorage(file, path, { label: "Galeri: " + String(judul).slice(0, 42) });
                paths.push(path);
            }
            const newId = await buatGallery(u.id, judul, Galeri.draft.deskripsi || "", paths);
            if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
            showToast("Kegiatan berhasil dipublish!", "success");
            try { if (typeof lepasPreview === "function") lepasPreview(files); } catch {}
            Galeri.draft = null;
            Cache.del("gallery");
            Galeri.cache = [];
            await Galeri.muat(true);
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
                Outbox.sesudahAntre(__sesudahAntre);
                return;
            }
            if (String(err.message).includes("-1") || err.message === "ERR_NO_AUTH") {
                showPopup("Cuma akun OSIS yang bisa nambah galeri.", "error");
            } else {
                showToast("Gagal upload. Cek koneksi ya!", "error");
            }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i>'; }
        }
    },

    // Buang draft lokal (belum ke-DB jadi langsung hilang)
    buangDraft() {
        try { if (typeof lepasPreview === "function") lepasPreview(Galeri.draft && Galeri.draft.files); } catch {}
        Galeri.draft = null;
        Galeri.render();
    },

    // ============ MUAT & RENDER — paginasi hemat egress (12/halaman + sentinel) ============
    // awal default true biar pemanggil lama tanpa argumen (outbox/site-edit) tetap refresh penuh.
    async muat(awal = true) {
        const grid = document.getElementById("galGrid");
        if (!grid) return;
        if (Galeri.loading) return;
        if (!awal && Galeri.habis) return;
        Galeri.loading = true;
        if (awal) {
            Galeri.offset = 0;
            Galeri.cache = [];
            Galeri.habis = false;
            // render instan dari cache persisten (tanpa fetch)
            let instan = false;
            try {
                const c = Cache.get("gallery");
                if (c && c.length) {
                    Galeri.cache = [...c];
                    Galeri.render();
                    instan = true;
                    Galeri.cache = [];
                    Galeri.offset = 0;
                    Galeri.habis = false;
                }
            } catch {}
            if (!instan) {
                grid.innerHTML = Galeri.draft ? Galeri.kartuDraft()
                    : `<div class="loading-block"><div class="spinner"></div>Memuat galeri...</div>`;
            }
        }

        try {
            const rows = await getGallery(Galeri.perPage, Galeri.offset);
            // item tanpa foto = sisa upload gagal: sembunyikan + auto-hapus (khusus osis)
            let pakai = rows || [];
            const kosong = pakai.filter(g => !Array.isArray(g.fotos) || g.fotos.length === 0);
            if (kosong.length) {
                pakai = pakai.filter(g => Array.isArray(g.fotos) && g.fotos.length > 0);
                try {
                    const u = OsisAuth.getUser && OsisAuth.getUser();
                    if (u && u.mode === "osis") kosong.forEach(it => { hapusGallery(u.id, it.id).catch(() => {}); });
                } catch {}
            }
            const ada = new Set(Galeri.cache.map(g => String(g.id)));
            pakai.forEach(g => { if (!ada.has(String(g.id))) { Galeri.cache.push(g); ada.add(String(g.id)); } });
            Galeri.offset = Galeri.cache.length;
            if (!rows || rows.length < Galeri.perPage) {
                Galeri.habis = true;
                try { Cache.set("gallery", Galeri.cache); } catch {} // full dataset → aman di-cache offline
            }
            Galeri.render();
        } catch (err) {
            console.error(err);
            // offline: pulihkan cache persisten (dataset lengkap) biar tetap bisa dibaca
            let pulih = false;
            try {
                const c = Cache.get("gallery");
                if (c && c.length) {
                    Galeri.cache = [...c];
                    Galeri.offset = Galeri.cache.length;
                    Galeri.habis = true;
                    Galeri.render();
                    pulih = true;
                }
            } catch {}
            if (!pulih) {
                if (awal && !Galeri.cache.length && !Galeri.draft) grid.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat galeri. Cek koneksi.</div>`;
                else if (typeof showToast === "function") showToast("Gagal muat lanjutan galeri.", "error");
            }
        } finally {
            Galeri.loading = false;
        }
    },

    render() {
        const grid = document.getElementById("galGrid");
        if (!grid) return;
        // selamatkan ketikan draft sebelum DOM diganti (scroll-append bisa trigger render)
        if (Galeri.draft) { try { Galeri.bacaTeksDraft(); } catch {} }

        const data = Galeri.cache;
        let html = "";

        // Draft block selalu paling atas
        if (Galeri.draft) html += Galeri.kartuDraft();

        if (data.length === 0 && !Galeri.draft) {
            html += `<div class="pesan-empty"><i class="fa-solid fa-images"></i> Belum ada dokumentasi. Segera hadir!</div>`;
        } else {
            html += data.map(item => Galeri.kartu(item)).join("");
        }

        // sentinel infinite-scroll + tombol manual (fallback tanpa IO), di bawah #galGrid
        if (data.length) {
            html += `<div style="text-align:center; padding:12px 4px">`
                + (Galeri.habis
                    ? `<small style="color:var(--gray); font-weight:700">— Semua dokumentasi sudah dimuat —</small>`
                    : `<button class="btn btn-white btn-sm" onclick="Galeri.muat(false)"><i class="fa-solid fa-angles-down"></i> Muat lagi</button>`)
                + `</div><div id="galSentinel" style="height:8px"></div>`;
        }

        grid.innerHTML = html;
        // tanpa IO → sembunyikan sentinel, tombol manual yang dipakai
        let io = null;
        try { if (typeof pasangSentinel === "function") io = pasangSentinel("galSentinel", () => Galeri.muat(false)); } catch {}
        if (!io) { const s = document.getElementById("galSentinel"); if (s) s.style.display = "none"; }
    },

    // Struktur draft = persis kartu kegiatan: judul -> subjudul -> foto [+]
    kartuDraft() {
        const d = Galeri.draft;
        const semua = d.files || [];
        const batas = (typeof BATAS_PREVIEW_DRAFT !== "undefined" ? BATAS_PREVIEW_DRAFT : 24);
        const tampil = semua.slice(0, batas);
        const sisa = semua.length - tampil.length;
        let fotoHtml = tampil.map(file => {
            const url = (typeof previewURL === "function" ? previewURL(file) : URL.createObjectURL(file));
            const isVid = typeof isVideoFile === "function" && isVideoFile(file);
            return isVid
                ? `<div class="item media-muat sudah-muat is-video"><video src="${url}" alt="" muted playsinline preload="none"></video><span class="vid-play" aria-hidden="true"><i class="fa-solid fa-play"></i></span></div>`
                : `<div class="item"><img src="${url}" alt="" loading="lazy" decoding="async"></div>`;
        }).join("");
        if (sisa > 0) fotoHtml += `<div class="item" style="display:grid;place-items:center;text-align:center;font-weight:800;font-size:.9rem">+${sisa} lainnya<br><small style="font-weight:600">tetap ke-upload</small></div>`;
        fotoHtml += `<div class="up-slot" title="Tambah foto/video (bisa banyak sekaligus)"><i class="fa-solid fa-plus"></i></div>`;

        return `
            <div class="bento-block draft">
                <div class="bento-meta">
                    <h4 class="draft-judul" contenteditable="true" spellcheck="false" data-ph="Judul Kegiatan">${escapeHtml(d.judul || "")}</h4>
                    <p class="draft-desk" contenteditable="true" spellcheck="false" data-ph="Sub judul / deskripsi singkat...">${escapeHtml(d.deskripsi || "")}</p>
                    <div class="gal-actions">
                        <button class="icon-btn gal-save" onclick="Galeri.simpanDraft()" title="Simpan kegiatan">
                            <i class="fa-solid fa-check"></i>
                        </button>
                        <button class="icon-btn gal-del" onclick="Galeri.buangDraft()" title="Buang draft">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
                <div class="bento-grid">${fotoHtml}</div>
            </div>`;
    },

    kartu(item) {
        const judul = escapeHtml(item.judul);
        const deskripsi = escapeHtml(item.deskripsi || "");
        const fotos = Array.isArray(item.fotos) ? item.fotos : [];
        // Editable HANYA pas state edit nyala + punya hak galeri (kayak dok kegiatan).
        // Di luar itu kartu statis.
        const isEdit =
            document.body.classList.contains("edit-mode") &&
            typeof OsisAuth !== "undefined" &&
            OsisAuth.bisa &&
            OsisAuth.bisa("galeri");

        let fotoHtml = "";
        fotos.forEach((path, idx) => {
            const media = (typeof thumbBento === "function")
                ? ((typeof thumbBentoPath === "function") ? thumbBentoPath(path, judul) : thumbBento(getFoto(path), judul))
                : `<img src="${getFoto(path)}" alt="${judul}" loading="lazy" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span>`;
            fotoHtml += `
                <div class="item media-muat" data-foto-idx="${idx}" onclick="Galeri.bukaPopup(${item.id}, ${idx})">
                    ${media}
                    <button class="foto-del-btn" onclick="event.stopPropagation(); Galeri.hapusFoto(${item.id}, ${idx})" title="Hapus foto/video"><i class="fa-solid fa-trash-can"></i></button>
                </div>`;
        });

        return `
            <div class="bento-block" data-galeri-id="${item.id}">
                <div class="bento-meta">
                    <h4 data-galeri-field="judul" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false" data-ph="Judul Kegiatan">${judul}</h4>
                    ${deskripsi || isEdit ? `<p data-galeri-field="deskripsi" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false" data-ph="Sub judul / deskripsi singkat...">${deskripsi}</p>` : ""}
                    ${olehLabel(item) ? `<div>${olehLabel(item)}</div>` : ""}
                    <button class="icon-btn gal-del" onclick="Galeri.hapus(${item.id})" title="Hapus kegiatan">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
                <div class="bento-grid">${fotoHtml}</div>
            </div>`;
    },

    // Popup foto + swipe antar foto dalam kegiatan yang sama
    bukaPopup(id, fotoIdx) {
        const item = Galeri.cache.find(g => String(g.id) === String(id));
        if (!item || !Array.isArray(item.fotos)) return;
        const gallery = item.fotos.map(path => ({
            id: item.id,
            src: getFoto(path),
            judul: item.judul || "Galeri",
            caption: item.deskripsi || "",
            oleh: item.pengunggah || ""
        })).filter(g => g.src);
        if (!gallery.length) return;
        const index = Math.max(0, Math.min(parseInt(fotoIdx, 10) || 0, gallery.length - 1));
        Home.bukaFotoPopup(null, gallery[index].judul, gallery[index].caption, {
            gallery,
            index,
            onChange(idx) {
                const current = gallery[idx];
                if (current) Galeri.bindPopupCaption(current.id);
            }
        });
    },

    // Caption popup = deskripsi kegiatan (sama untuk semua foto di popup).
    // Pola sama kayak Prestasi.bindPopupCaption: hak dicek pas simpan.
    bindPopupCaption(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;

        try {
            const akses = OsisAuth.getAkses && OsisAuth.getAkses();
            if (akses && !(OsisAuth.bisa && OsisAuth.bisa("galeri"))) return;
        } catch {}

        const modal = document.querySelector(".struktur-modal");
        const pill = modal ? modal.querySelector(".foto-caption-pill") : null;
        const captionEl = pill || (modal ? modal.querySelector(".foto-caption") : null);
        if (!captionEl) return;

        captionEl.contentEditable = "true";
        captionEl.spellcheck = false;
        if (pill) pill.dataset.galeriCaptionPopup = String(id);
        else captionEl.dataset.galeriCaptionPopup = String(id);
        captionEl.onclick = (e) => e.stopPropagation();
        // Flush ganda: blur + tutup modal/pindah foto (lihat Prestasi).
        const simpan = async () => {
            const item = Galeri.cache.find(g => String(g.id) === String(id));
            if (!item) return;
            const nextDesk = captionEl.textContent.trim();
            if (nextDesk === (item.deskripsi || "")) return;
            try {
                if (typeof OsisAuth.refreshAkses === "function" && !(OsisAuth.getAkses && OsisAuth.getAkses())) {
                    await OsisAuth.refreshAkses();
                }
            } catch {}
            if (!OsisAuth.bisa || !OsisAuth.bisa("galeri")) {
                captionEl.textContent = item.deskripsi || "";
                showToast("Kamu tidak punya kendali atas halaman ini.", "error");
                return;
            }
            Galeri.updateDeskripsi(id, nextDesk);
        };
        captionEl.onfocusout = simpan;
        modal._flushCaption = simpan;
    },

    async updateText(id, field, value) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("galeri")) return;
        const item = Galeri.cache.find(g => String(g.id) === String(id));
        if (!item || !["judul", "deskripsi"].includes(field)) return;
        const next = { ...item, [field]: value };
        try {
            await galeriUpdateMeta(u.id, id, next.judul, next.deskripsi);
            const idx = Galeri.cache.findIndex(g => String(g.id) === String(id));
            if (idx >= 0) Galeri.cache[idx] = next;
            // cache persisten cuma ditulis pas dataset lengkap (habis), biar offline gak keracunan parsial
            if (Galeri.habis) { try { Cache.set("gallery", Galeri.cache); } catch {} } else { Cache.del("gallery"); }
            showToast("Galeri tersimpan", "success");
        } catch (err) {
            console.error(err);
            showPopup("Gagal simpan galeri: " + err.message, "error");
            Cache.del("gallery");
            await Galeri.muat(true);
        }
    },

    async updateDeskripsi(id, deskripsi) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Galeri.cache.find(g => String(g.id) === String(id));
        if (!item) return;
        try {
            await galeriUpdateMeta(u.id, id, item.judul, deskripsi);
            item.deskripsi = deskripsi;
            if (Galeri.habis) { try { Cache.set("gallery", Galeri.cache); } catch {} } else { Cache.del("gallery"); }
            Galeri.render();
            showToast("Deskripsi galeri tersimpan", "success");
        } catch (err) {
            console.error(err);
            showPopup("Gagal simpan deskripsi: " + err.message, "error");
            Cache.del("gallery");
            await Galeri.muat(true);
        }
    },

    formatTanggal(t) {
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return ""; }
    },

    async hapusFoto(id, idx) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("galeri")) return;
        const item = Galeri.cache.find(g => String(g.id) === String(id));
        if (!item || !Array.isArray(item.fotos) || !item.fotos[idx]) return;
        const path = item.fotos[idx];
        const isLast = item.fotos.length === 1;
        const yakin = await showPopup(isLast ? "Ini foto terakhir. Galeri akan otomatis terhapus. Lanjutkan?" : "Hapus foto ini?", "confirm");
        if (!yakin) return;
        try {
            const newFotos = item.fotos.filter((_, i) => i !== idx);
            if (newFotos.length === 0) {
                const { data } = await supa.from("gallery").select("fotos").eq("id", id).maybeSingle();
                await hapusGallery(u.id, id);
                const toDel = (data && Array.isArray(data.fotos) && data.fotos.length) ? data.fotos : [path];
                for (const p of toDel) try { await hapusFotoStorage(p); } catch {}
                showToast("Galeri terhapus (tidak ada foto)", "success");
            } else {
                await galeriUpdateFotos(u.id, id, newFotos);
                try { await hapusFotoStorage(path); } catch {}
                showToast("Foto dihapus", "success");
            }
            Cache.del("gallery");
            await Galeri.muat(true);
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_NO_AUTH") showPopup("Cuma akun OSIS yang bisa hapus.", "error");
            else showPopup("Gagal hapus foto: " + err.message, "error");
        }
    },

    // ============ HAPUS KEGIATAN ============
    async hapus(id) {
        const u = OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("galeri")) return;

        const yakin = await showPopup("Yakin hapus kegiatan ini? Fotonya ikut terhapus.", "confirm");
        if (!yakin) return;

        try {
            const { data } = await supa.from("gallery").select("fotos").eq("id", id).maybeSingle();

            await hapusGallery(u.id, id);

            if (data && Array.isArray(data.fotos)) {
                for (const path of data.fotos) {
                    try { await hapusFotoStorage(path); } catch (e) { console.warn("Gagal hapus file:", path); }
                }
            }

            showToast("Kegiatan dihapus", "success");
            Cache.del("gallery");
            Galeri.muat(true);
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_NO_AUTH") {
                showPopup("Cuma akun OSIS yang bisa hapus.", "error");
            } else {
                showPopup("Gagal hapus. Cek koneksi lalu coba lagi.", "error");
            }
        }
    },
};

if (typeof Router !== "undefined") {
    Router.register("galeri", () => Galeri.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Galeri.init());
} else {
    Galeri.init();
}
