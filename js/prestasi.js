// =========================================================================
// PRESTASI — DB-driven, 1 foto per prestasi
// Container #prestasiGrid di home, render via SWR.
// Tambah via header + -> popup form (foto drag&drop, tag, caption)
// =========================================================================

const Prestasi = {
    cache: [],
    terinisialisasi: false,
    pendingFile: null,

    init() {
        if (Prestasi.terinisialisasi) return;
        Prestasi.terinisialisasi = true;
        Prestasi.cekLogin();
        Prestasi.muat();
    },

    cekLogin() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        const osis = !!(u && u.mode === "osis");
        const edit = document.body.classList.contains("edit-mode");
        const grid = document.getElementById("prestasiGrid");
        if (grid) {
            grid.classList.toggle("mode-osis", osis && edit);
            if (!grid._editBound) {
                grid._editBound = true;
                grid.addEventListener("focusout", (e) => {
                    const tagEl = e.target.closest(".prestasi-tag[contenteditable='true']");
                    if (!tagEl) return;
                    const card = e.target.closest(".prestasi-card");
                    const id = card ? card.dataset.prestasiId : null;
                    if (!id) return;
                    const item = Prestasi.cache.find(p => String(p.id) === String(id));
                    if (!item) return;
                    const newTag = tagEl.textContent.trim();
                    if (!newTag) {
                        tagEl.textContent = item.tag || "Tag";
                        showToast("Tag gak boleh kosong", "error");
                        return;
                    }
                    if (newTag !== (item.tag || "")) Prestasi.updateTag(id, newTag);
                });
                grid.addEventListener("click", (e) => {
                    if (e.target.closest(".prestasi-tag[contenteditable='true']")) e.stopPropagation();
                });
            }
        }
        const btn = document.getElementById("btnTambahPrestasi");
        if (btn) btn.style.display = osis ? "" : "none";
    },

    async muat() {
        const grid = document.getElementById("prestasiGrid");
        if (!grid) return;
        const cached = Cache.get("prestasi");
        if (cached) {
            Prestasi.cache = cached;
            Prestasi.render();
            getPrestasi().then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Cache.set("prestasi", fresh);
                    Prestasi.cache = fresh;
                    Prestasi.render();
                }
            }).catch(()=>{});
            return;
        }
        grid.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat prestasi...</div>`;
        try {
            const data = await getPrestasi();
            Cache.set("prestasi", data);
            Prestasi.cache = data;
            Prestasi.render();
        } catch (err) {
            console.error(err);
            grid.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat prestasi.</div>`;
        }
    },

    render() {
        const grid = document.getElementById("prestasiGrid");
        if (!grid) return;
        const data = Prestasi.cache || [];
        if (data.length === 0) {
            grid.innerHTML = `<div class="pesan-empty" style="grid-column:1/-1;color:#fff"><i class="fa-solid fa-trophy"></i> Belum ada prestasi.</div>`;
            return;
        }
        grid.innerHTML = data.map(item => Prestasi.kartu(item)).join("");
    },

    kartu(item) {
        const fotos = Array.isArray(item.fotos) ? item.fotos : [];
        const cover = fotos[0] ? (typeof fotos[0] === "string" ? fotos[0] : fotos[0].path) : "";
        const tag = escapeHtml(item.tag || "");
        const isEdit = document.body.classList.contains("edit-mode") && (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        return `
            <div class="prestasi-card" data-prestasi-id="${item.id}" style="position:relative">
                <img src="${getFoto(cover)}" alt="${tag || "Prestasi"}" loading="lazy" onerror="this.style.display='none'" onclick="Prestasi.bukaPopup(${item.id})">
                ${tag || isEdit ? `<span class="prestasi-tag" data-prestasi-tag="${item.id}" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false">${tag || (isEdit ? "Tag" : "")}</span>` : ""}
                <button class="foto-del-btn" onclick="event.stopPropagation(); Prestasi.hapus(${item.id})" title="Hapus foto"><i class="fa-solid fa-trash-can"></i></button>
            </div>`;
    },

    getCaption(item) {
        if (!item) return "";
        const fotos = Array.isArray(item.fotos) ? item.fotos : [];
        const first = fotos[0];
        if (first && typeof first !== "string" && first.caption) return first.caption;
        return item.caption || "";
    },

    async updateTag(id, tag) {
        const item = Prestasi.cache.find(p => String(p.id) === String(id));
        if (!item) return;
        await Prestasi.updateItem(id, {
            tag,
            caption: Prestasi.getCaption(item),
            fotos: item.fotos,
            display_order: item.display_order
        }, "Tag prestasi tersimpan");
    },

    async updateCaption(id, caption) {
        const item = Prestasi.cache.find(p => String(p.id) === String(id));
        if (!item) return;
        const fotos = Array.isArray(item.fotos) ? item.fotos.slice() : [];
        if (fotos[0]) {
            fotos[0] = typeof fotos[0] === "string" ? { path: fotos[0], caption } : { ...fotos[0], caption };
        }
        await Prestasi.updateItem(id, {
            tag: item.tag,
            caption,
            fotos,
            display_order: item.display_order
        }, "Caption prestasi tersimpan");
    },

    async updateItem(id, next, successMsg) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        try {
            await updatePrestasi(u.id, id, next.tag, next.caption, next.fotos, next.display_order);
            const idx = Prestasi.cache.findIndex(p => String(p.id) === String(id));
            if (idx >= 0) {
                Prestasi.cache[idx] = { ...Prestasi.cache[idx], ...next };
                Cache.set("prestasi", Prestasi.cache);
            }
            showToast(successMsg, "success");
        } catch (err) {
            console.error(err);
            showPopup("Gagal simpan prestasi: " + err.message, "error");
            Cache.del("prestasi");
            await Prestasi.muat();
        }
    },

    bukaPopup(id) {
        const item = Prestasi.cache.find(p => String(p.id) === String(id));
        if (!item) return;
        const gallery = Prestasi.cache.map(p => {
            const fotos = Array.isArray(p.fotos) ? p.fotos : [];
            const cover = fotos[0] ? (typeof fotos[0] === "string" ? fotos[0] : fotos[0].path) : "";
            return {
                id: p.id,
                src: getFoto(cover),
                judul: p.tag || "Prestasi",
                caption: Prestasi.getCaption(p)
            };
        }).filter(p => p.src);
        const index = Math.max(0, gallery.findIndex(p => String(p.id) === String(id)));
        Home.bukaFotoPopup(null, item.tag || "", Prestasi.getCaption(item), {
            gallery,
            index,
            onChange(idx) {
                const current = gallery[idx];
                if (current) Prestasi.bindPopupCaption(current.id);
            }
        });
    },

    bindPopupCaption(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        const isEdit = document.body.classList.contains("edit-mode") && u && u.mode === "osis";
        if (!isEdit) return;

        const modal = document.querySelector(".struktur-modal");
        const pill = modal ? modal.querySelector(".foto-caption-pill") : null;
        const captionEl = pill || (modal ? modal.querySelector(".foto-caption") : null);
        if (!captionEl) return;

        captionEl.contentEditable = "true";
        captionEl.spellcheck = false;
        if (pill) pill.dataset.prestasiCaptionPopup = String(id);
        else captionEl.dataset.prestasiCaptionPopup = String(id);
        captionEl.onclick = (e) => e.stopPropagation();
        captionEl.onfocusout = () => {
            const item = Prestasi.cache.find(p => String(p.id) === String(id));
            if (!item) return;
            const nextCaption = captionEl.textContent.trim();
            if (nextCaption !== Prestasi.getCaption(item)) Prestasi.updateCaption(id, nextCaption);
        };
    },

    // ============ FORM POPUP ============
    bukaForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        Prestasi.pendingFile = null;
        // buat overlay
        const existing = document.getElementById("prestasiFormOverlay");
        if (existing) existing.remove();
        const overlay = document.createElement("div");
        overlay.id = "prestasiFormOverlay";
        overlay.className = "prestasi-form-overlay";
        overlay.innerHTML = `
            <div class="prestasi-form-box">
                <div class="form-head" style="display:flex;align-items:center;justify-content:space-between">
                    <span><i class="fa-solid fa-plus"></i> Tambah Prestasi</span>
                    <button class="icon-btn" onclick="Prestasi.tutupForm()" title="Tutup"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="prestasi-drop" id="prestasiDrop">
                    <div class="prestasi-drop-inner" id="prestasiDropInner">
                        <i class="fa-solid fa-cloud-arrow-up"></i>
                        <span>Klik atau drag foto ke sini</span>
                        <small>JPG/PNG, max 10MB (otomatis compress &lt;1MB)</small>
                    </div>
                    <img id="prestasiPreview" style="display:none; width:100%; height:100%; object-fit:cover; border-radius:12px;">
                </div>
                <input type="file" id="prestasiFormFile" accept="image/*" style="display:none">
                <div class="field" style="margin-top:12px">
                    <label>Tag kecil (judul kecil)</label>
                    <input type="text" id="prestasiTag" class="admin-input" placeholder="cth: Paskibra" maxlength="40">
                </div>
                <div class="field">
                    <label>Deskripsi (muncul di popup caption)</label>
                    <textarea id="prestasiCaption" class="admin-input admin-textarea" placeholder="Deskripsi caption..." maxlength="200" rows="3"></textarea>
                </div>
                <div class="form-actions-row" style="margin-top:14px">
                    <button class="btn btn-white" onclick="Prestasi.tutupForm()">Batal</button>
                    <button class="btn btn-red" id="btnSimpanPrestasi" onclick="Prestasi.simpanForm()"><i class="fa-solid fa-check"></i> Simpan</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("active")));
        document.body.style.overflow = "hidden";
        overlay.addEventListener("click", (e) => { if (e.target === overlay) Prestasi.tutupForm(); });

        const drop = overlay.querySelector("#prestasiDrop");
        const fileInput = overlay.querySelector("#prestasiFormFile");
        const preview = overlay.querySelector("#prestasiPreview");
        const inner = overlay.querySelector("#prestasiDropInner");

        drop.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => {
            const f = fileInput.files && fileInput.files[0];
            if (f) Prestasi.handlePickedFile(f, preview, inner);
        });
        // drag & drop
        ["dragenter","dragover"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
        });
        ["dragleave","drop"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
        });
        drop.addEventListener("drop", (e) => {
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) Prestasi.handlePickedFile(f, preview, inner);
        });
    },

    tutupForm() {
        const el = document.getElementById("prestasiFormOverlay");
        if (el) {
            el.classList.remove("active");
            setTimeout(() => { if (el.parentNode) el.remove(); }, 220);
        }
        document.body.style.overflow = "";
        Prestasi.pendingFile = null;
    },

    handlePickedFile(file, previewEl, innerEl) {
        if (!file || !file.type.startsWith("image/")) { showToast("File harus gambar", "error"); return; }
        Prestasi.pendingFile = file;
        const url = URL.createObjectURL(file);
        const preview = previewEl || document.getElementById("prestasiPreview");
        const inner = innerEl || document.getElementById("prestasiDropInner");
        if (preview) { preview.src = url; preview.style.display = "block"; }
        if (inner) inner.style.display = "none";
        const drop = document.getElementById("prestasiDrop");
        if (drop) drop.classList.add("has-file");
    },

    async simpanForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const tag = document.getElementById("prestasiTag")?.value.trim() || "";
        const caption = document.getElementById("prestasiCaption")?.value.trim() || "";
        const file = Prestasi.pendingFile;
        if (!file) { showToast("Pilih foto dulu", "error"); return; }
        const btn = document.getElementById("btnSimpanPrestasi");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            const ext = (file.name.split(".").pop()||"jpg").toLowerCase();
            const path = `prestasi/prestasi-${u.id}-${Date.now()}.${ext}`;
            await uploadFotoStorage(file, path);
            const maxOrder = Prestasi.cache.length ? Math.min(...Prestasi.cache.map(p => p.display_order ?? 99)) : 99;
            const newId = await buatPrestasi(u.id, tag, caption, [{ path, caption }], maxOrder - 1);
            if (!newId || newId<=0) throw new Error("Gagal simpan ("+newId+")");
            showToast("Prestasi ditambah!", "success");
            Prestasi.tutupForm();
            Cache.del("prestasi");
            await Prestasi.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: "+err.message, "error");
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode!=="osis") return;
        const yakin = await showPopup("Hapus prestasi ini? Fotonya ikut terhapus.", "confirm");
        if (!yakin) return;
        try {
            const item = Prestasi.cache.find(p=>String(p.id)===String(id));
            await hapusPrestasi(u.id, id);
            if (item && Array.isArray(item.fotos)) {
                for (const f of item.fotos) {
                    const p = typeof f === "string" ? f : f.path;
                    if (p) try { await hapusFotoStorage(p); } catch {}
                }
            }
            showToast("Prestasi dihapus", "success");
            Cache.del("prestasi");
            await Prestasi.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: "+err.message, "error");
        }
    }
};

// hook ke Home init biar ke-load pas view home pertama
if (typeof Home !== "undefined") {
    const _origHomeInit = Home.init.bind(Home);
    Home.init = async function() {
        await _origHomeInit();
        Prestasi.init();
    };
    if (Home.terinisialisasi) Prestasi.init();
}
