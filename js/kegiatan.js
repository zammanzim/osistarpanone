// =========================================================================
// KEGIATAN — DB-driven home bento (judul, deskripsi, badge, fotos jsonb)
// Container kosong #kegiatanGrid di index.html, render via SWR.
// Edit via toggle header (SiteEdit) — draft inline kayak Galeri.
// =========================================================================

const Kegiatan = {
    cache: [],
    draft: null, // { judul, deskripsi, badge, fotos:[{path,caption}], files:[File] }
    terinisialisasi: false,

    init() {
        if (Kegiatan.terinisialisasi) return;
        Kegiatan.terinisialisasi = true;
        Kegiatan.cekLogin();
        Kegiatan.muat();
        const grid = document.getElementById("kegiatanGrid");
        if (grid) grid.addEventListener("click", (e) => {
            if (e.target.closest(".up-slot")) {
                document.getElementById("kegiatanFileInput")?.click();
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
                const file = e.dataTransfer.files && e.dataTransfer.files[0];
                Kegiatan.tambahFileDraft(file);
            });
        }
        if (!document.getElementById("kegiatanFileInput")) {
            const fi2 = document.createElement("input");
            fi2.type = "file";
            fi2.id = "kegiatanFileInput";
            fi2.accept = "image/*";
            fi2.style.display = "none";
            fi2.addEventListener("change", () => Kegiatan.tambahFotoDraft(fi2));
            document.body.appendChild(fi2);
        }
        if (grid) grid.addEventListener("click", (e) => {
            if (e.target.closest(".up-slot, .foto-del-btn")) return;
            if (e.target.closest("[data-kegiatan-field][contenteditable='true'], .bento-badge[contenteditable='true']")) return;
            const item = e.target.closest(".item");
            if (!item) return;
            const block = item.closest(".bento-block");
            const id = block ? block.dataset.kegiatanId : null;
            const fotoIdx = Number(item.dataset.fotoIdx || 0);
            if (id) Kegiatan.bukaPopup(id, fotoIdx);
        });
        if (grid && !grid._textEditBound) {
            grid._textEditBound = true;
            grid.addEventListener("focusout", (e) => {
                const el = e.target.closest("[data-kegiatan-field][contenteditable='true']");
                const badgeEl = e.target.closest(".bento-badge[contenteditable='true']");
                if (!el && !badgeEl) return;
                const targetEl = badgeEl || el;
                const targetBlock = targetEl.closest(".bento-block");
                const id = targetBlock ? targetBlock.dataset.kegiatanId : null;
                const field = badgeEl ? "badge" : el.dataset.kegiatanField;
                if (!id || !field) return;

                const item = Kegiatan.cache.find(k => String(k.id) === String(id));
                if (!item) return;
                const value = targetEl.textContent.trim();
                if (field === "badge" && value.length > 12) {
                    targetEl.textContent = value.slice(0, 12);
                    Kegiatan.updateText(id, field, value.slice(0, 12));
                    return;
                }
                if (field === "judul" && !value) {
                    el.textContent = item.judul || "Judul Kegiatan";
                    showToast("Judul gak boleh kosong", "error");
                    return;
                }
                if (value !== (item[field] || "")) Kegiatan.updateText(id, field, value);
            });
        }
    },

    cekLogin() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        const osis = !!(u && u.mode === "osis");
        const edit = document.body.classList.contains("edit-mode");
        const grid = document.getElementById("kegiatanGrid");
        if (grid) grid.classList.toggle("mode-osis", osis && edit);
        const btn = document.getElementById("btnTambahKegiatan");
        if (btn) btn.style.display = osis ? "" : "none";
    },

    async muat() {
        const grid = document.getElementById("kegiatanGrid");
        if (!grid) return;
        const cached = Cache.get("kegiatan");
        if (cached) {
            Kegiatan.cache = cached;
            Kegiatan.render();
            getKegiatan().then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Cache.set("kegiatan", fresh);
                    Kegiatan.cache = fresh;
                    Kegiatan.render();
                }
            }).catch(()=>{});
            return;
        }
        grid.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat kegiatan...</div>`;
        try {
            const data = await getKegiatan();
            Cache.set("kegiatan", data);
            Kegiatan.cache = data;
            Kegiatan.render();
        } catch (err) {
            console.error(err);
            grid.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat kegiatan.</div>`;
        }
    },

    render() {
        const grid = document.getElementById("kegiatanGrid");
        if (!grid) return;
        let html = "";
        if (Kegiatan.draft) html += Kegiatan.kartuDraft();
        const data = Kegiatan.cache || [];
        if (data.length === 0 && !Kegiatan.draft) {
            html += `<div class="pesan-empty"><i class="fa-solid fa-images"></i> Belum ada kegiatan.</div>`;
        } else {
            html += data.map(item => Kegiatan.kartu(item)).join("");
        }
        grid.innerHTML = html;
    },

    kartu(item) {
        const judul = escapeHtml(item.judul || "");
        const deskripsi = escapeHtml(item.deskripsi || "");
        const badge = escapeHtml(item.badge || "");
        const fotos = Array.isArray(item.fotos) ? item.fotos : [];
        const isEdit = document.body.classList.contains("edit-mode") && (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        let fotosHtml = fotos.map((f, idx) => {
            const path = typeof f === "string" ? f : f.path;
            const badgeHtml = idx === 0 && (badge || isEdit) ? `<span class="bento-badge" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false" data-ph="BADGE">${badge}</span>` : "";
            return `<div class="item" data-foto-idx="${idx}"><img src="${getFoto(path)}" alt="${judul}" loading="lazy" onerror="this.style.display='none'">${badgeHtml}<button class="foto-del-btn" onclick="event.stopPropagation(); Kegiatan.hapusFoto(${item.id}, ${idx})" title="Hapus foto"><i class="fa-solid fa-trash-can"></i></button></div>`;
        }).join("");
        return `
            <div class="bento-block" data-kegiatan-id="${item.id}">
                <div class="bento-meta">
                    <h4 data-kegiatan-field="judul" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false" data-ph="Judul Kegiatan">${judul}</h4>
                    ${deskripsi || isEdit ? `<p data-kegiatan-field="deskripsi" contenteditable="${isEdit ? "true" : "false"}" spellcheck="false" data-ph="Sub judul / deskripsi singkat...">${deskripsi}</p>` : ""}
                    <button class="icon-btn gal-del" onclick="event.stopPropagation(); Kegiatan.hapus(${item.id})" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
                </div>
                <div class="bento-grid">${fotosHtml}</div>
            </div>`;
    },

    getFotoCaption(item, fotoIdx) {
        if (!item || !Array.isArray(item.fotos)) return "";
        const foto = item.fotos[fotoIdx];
        return foto && typeof foto !== "string" ? (foto.caption || "") : "";
    },

    bukaPopup(id, fotoIdx) {
        const item = Kegiatan.cache.find(k => String(k.id) === String(id));
        if (!item || !Array.isArray(item.fotos) || !item.fotos[fotoIdx]) return;
        const gallery = [];
        Kegiatan.cache.forEach(k => {
            const fotos = Array.isArray(k.fotos) ? k.fotos : [];
            fotos.forEach((foto, idx) => {
                const path = typeof foto === "string" ? foto : foto.path;
                if (!path) return;
                gallery.push({
                    kegiatanId: k.id,
                    fotoIdx: idx,
                    src: getFoto(path),
                    judul: k.judul || "Kegiatan",
                    caption: Kegiatan.getFotoCaption(k, idx)
                });
            });
        });
        const index = Math.max(0, gallery.findIndex(f => String(f.kegiatanId) === String(id) && f.fotoIdx === fotoIdx));
        Home.bukaFotoPopup(null, item.judul || "Kegiatan", Kegiatan.getFotoCaption(item, fotoIdx), {
            gallery,
            index,
            onChange(idx) {
                const current = gallery[idx];
                if (current) Kegiatan.bindPopupCaption(current.kegiatanId, current.fotoIdx);
            }
        });
    },

    bindPopupCaption(id, fotoIdx) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        const isEdit = document.body.classList.contains("edit-mode") && u && u.mode === "osis";
        if (!isEdit) return;

        const modal = document.querySelector(".struktur-modal");
        const pill = modal ? modal.querySelector(".foto-caption-pill") : null;
        const captionEl = pill || (modal ? modal.querySelector(".foto-caption") : null);
        if (!captionEl) return;

        captionEl.contentEditable = "true";
        captionEl.spellcheck = false;
        if (pill) pill.dataset.kegiatanCaptionPopup = String(id);
        else captionEl.dataset.kegiatanCaptionPopup = String(id);
        captionEl.onclick = (e) => e.stopPropagation();
        captionEl.onfocusout = () => {
            const item = Kegiatan.cache.find(k => String(k.id) === String(id));
            if (!item) return;
            const nextCaption = captionEl.textContent.trim();
            if (nextCaption !== Kegiatan.getFotoCaption(item, fotoIdx)) Kegiatan.updateFotoCaption(id, fotoIdx, nextCaption);
        };
    },

    kartuDraft() {
        const d = Kegiatan.draft || { judul:"", deskripsi:"", badge:"", fotos:[], files:[] };
        let fotosHtml = "";
        // existing fotos (if editing, not needed for new)
        if (d.fotos && d.fotos.length) {
            fotosHtml += d.fotos.map(f => {
                const p = typeof f === "string" ? f : f.path;
                return `<div class="item"><img src="${getFoto(p)}" alt=""></div>`;
            }).join("");
        }
        // files preview
        (d.files || []).forEach(f => {
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
                        <button class="icon-btn gal-save" onclick="Kegiatan.simpanDraft()" title="Simpan kegiatan">
                            <i class="fa-solid fa-check"></i>
                        </button>
                        <button class="icon-btn gal-del" onclick="Kegiatan.buangDraft()" title="Buang draft">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
                <div class="bento-grid">${fotosHtml}</div>
            </div>`;
    },

    buatDraft() {
        if (Kegiatan.draft) {
            const j = document.querySelector("#kegiatanGrid .draft-judul");
            if (j) j.focus();
            return;
        }
        Kegiatan.draft = { judul:"", deskripsi:"", badge:"", fotos:[], files:[] };
        Kegiatan.render();
        const j = document.querySelector("#kegiatanGrid .draft-judul");
        if (j) j.focus();
        const card = document.querySelector("#kegiatanGrid .bento-block.draft");
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    },

    bacaTeksDraft() {
        if (!Kegiatan.draft) return;
        const jEl = document.querySelector("#kegiatanGrid .draft-judul");
        const dEl = document.querySelector("#kegiatanGrid .draft-desk");
        const bEl = document.querySelector("#kegiatanGrid .draft-badge");
        if (jEl) Kegiatan.draft.judul = jEl.textContent.trim();
        if (dEl) Kegiatan.draft.deskripsi = dEl.textContent.trim();
        if (bEl) Kegiatan.draft.badge = bEl.value.trim();
    },

    tambahFotoDraft(input) {
        if (!Kegiatan.draft) return;
        const file = input.files && input.files[0];
        input.value = "";
        Kegiatan.tambahFileDraft(file);
    },

    tambahFileDraft(file) {
        if (!Kegiatan.draft) return;
        Kegiatan.bacaTeksDraft();
        if (!file || !file.type.startsWith("image/")) {
            if (file) showToast("File harus gambar", "error");
            return;
        }
        if (!Kegiatan.draft.files) Kegiatan.draft.files = [];
        Kegiatan.draft.files.push(file);
        Kegiatan.render();
        const draftEl = document.querySelector("#kegiatanGrid .bento-block.draft");
        if (draftEl) draftEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    buangDraft() { Kegiatan.draft = null; Kegiatan.render(); },

    async simpanDraft() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        Kegiatan.bacaTeksDraft();
        const d = Kegiatan.draft;
        if (!d || !d.judul || !d.judul.trim()) { showToast("Judul wajib diisi", "error"); return; }
        if ((!d.files || d.files.length===0) && (!d.fotos || d.fotos.length===0)) { showToast("Tambah minimal 1 foto", "error"); return; }
        const btn = document.querySelector("#kegiatanGrid .gal-save");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            const paths = [];
            // keep existing fotos (if any)
            if (d.fotos) {
                for (const f of d.fotos) {
                    const p = typeof f === "string" ? f : f.path;
                    const c = typeof f === "string" ? "" : (f.caption||"");
                    paths.push({ path: p, caption: c });
                }
            }
            for (let i=0;i<(d.files||[]).length;i++) {
                const f = d.files[i];
                const ext = (f.name.split(".").pop()||"jpg").toLowerCase();
                const path = `kegiatan/kegiatan-${u.id}-${Date.now()}-${i}.${ext}`;
                await uploadFotoStorage(f, path);
                paths.push({ path, caption: "" });
            }
            const newId = await buatKegiatan(u.id, d.judul.trim(), d.deskripsi||"", d.badge||"", paths, 99);
            if (!newId || newId<=0) throw new Error("Gagal simpan ("+newId+")");
            showToast("Kegiatan ditambah!", "success");
            Kegiatan.draft = null;
            Cache.del("kegiatan");
            await Kegiatan.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: "+err.message, "error");
            if (btn) btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        }
    },

    async updateFotoCaption(kegiatanId, fotoIdx, caption) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Kegiatan.cache.find(k => String(k.id) === String(kegiatanId));
        if (!item || !Array.isArray(item.fotos) || !item.fotos[fotoIdx]) return;

        const newFotos = item.fotos.slice();
        const foto = newFotos[fotoIdx];
        newFotos[fotoIdx] = typeof foto === "string" ? { path: foto, caption } : { ...foto, caption };

        try {
            await updateKegiatan(u.id, kegiatanId, item.judul, item.deskripsi, item.badge, newFotos, item.display_order);
            const idx = Kegiatan.cache.findIndex(k => String(k.id) === String(kegiatanId));
            if (idx >= 0) {
                Kegiatan.cache[idx] = { ...Kegiatan.cache[idx], fotos: newFotos };
                Cache.set("kegiatan", Kegiatan.cache);
            }
            showToast("Caption kegiatan tersimpan", "success");
        } catch (err) {
            console.error(err);
            showPopup("Gagal simpan caption: " + err.message, "error");
            Cache.del("kegiatan");
            await Kegiatan.muat();
        }
    },

    async updateText(kegiatanId, field, value) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Kegiatan.cache.find(k => String(k.id) === String(kegiatanId));
        if (!item || !["judul", "deskripsi", "badge"].includes(field)) return;

        const next = { ...item, [field]: value };
        try {
            await updateKegiatan(u.id, kegiatanId, next.judul, next.deskripsi, next.badge, next.fotos, next.display_order);
            const idx = Kegiatan.cache.findIndex(k => String(k.id) === String(kegiatanId));
            if (idx >= 0) {
                Kegiatan.cache[idx] = next;
                Cache.set("kegiatan", Kegiatan.cache);
            }
            showToast("Kegiatan tersimpan", "success");
        } catch (err) {
            console.error(err);
            showPopup("Gagal simpan kegiatan: " + err.message, "error");
            Cache.del("kegiatan");
            await Kegiatan.muat();
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode!=="osis") return;
        const yakin = await showPopup("Hapus kegiatan ini? Fotonya ikut terhapus.", "confirm");
        if (!yakin) return;
        try {
            const item = Kegiatan.cache.find(k=>String(k.id)===String(id));
            await hapusKegiatan(u.id, id);
            if (item && Array.isArray(item.fotos)) {
                for (const f of item.fotos) {
                    const p = typeof f === "string" ? f : f.path;
                    if (p) try { await hapusFotoStorage(p); } catch {}
                }
            }
            showToast("Kegiatan dihapus", "success");
            Cache.del("kegiatan");
            await Kegiatan.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: "+err.message, "error");
        }
    },

    async hapusFoto(kegiatanId, fotoIdx) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode!=="osis") return;
        const item = Kegiatan.cache.find(k=>String(k.id)===String(kegiatanId));
        if (!item || !Array.isArray(item.fotos) || !item.fotos[fotoIdx]) return;
        const foto = item.fotos[fotoIdx];
        const path = typeof foto === "string" ? foto : foto.path;
        const yakin = await showPopup("Hapus foto ini?", "confirm");
        if (!yakin) return;
        try {
            const newFotos = item.fotos.filter((_, i) => i !== fotoIdx);
            await updateKegiatan(u.id, kegiatanId, item.judul, item.deskripsi, item.badge, newFotos, item.display_order);
            if (path) try { await hapusFotoStorage(path); } catch {}
            showToast("Foto dihapus", "success");
            Cache.del("kegiatan");
            await Kegiatan.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus foto: "+err.message, "error");
        }
    }
};

// hook ke Home init
if (typeof Home !== "undefined") {
    const _origHomeInit = Home.init.bind(Home);
    Home.init = async function() {
        await _origHomeInit();
        Kegiatan.init();
    };
    if (Home.terinisialisasi) Kegiatan.init();
}
