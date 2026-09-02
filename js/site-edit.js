// =========================================================================
// SITE EDIT — toggle di header, cuma OSIS. Bikin semua teks & foto
// jadi editable inline. Teks ke-save ke tabel site_content, foto ke
// bucket osis-foto via web_foto / pimpinan.
// =========================================================================

const SiteEdit = {
    active: false,
    fileTarget: null, // { type: 'web_foto', key } | { type: 'pimpinan', tahun } | { type: 'pimpinan_modal', tahun, field }
    pendingModalFotos: {}, // tahun -> { ketua_foto, wakil_foto, foto_angkatan }

    init() {
        const wrap = document.getElementById("editToggleWrap");
        const toggle = document.getElementById("editToggle");
        if (!wrap || !toggle) return;

        const u = OsisAuth.getUser && OsisAuth.getUser();
        const isOsis = !!(u && u.mode === "osis");
        wrap.style.display = isOsis ? "" : "none";
        // paksa edit mode mati pas refresh — jangan kebawa restore browser
        SiteEdit.active = false;
        document.body.classList.remove("edit-mode");
        toggle.checked = false;
        const moreEdit = document.getElementById("headerMoreEditToggle");
        if (moreEdit) moreEdit.checked = false;
        document.querySelectorAll("[data-edit-key]").forEach(el => el.contentEditable = "false");
        SiteEdit.removePhotoButtons();
        if (!isOsis) return;

        // load teks yang udah di-save
        SiteEdit.loadTexts();
        HeaderMore.refresh();

        // siapkan file input hidden sekali
        if (!document.getElementById("siteEditFileInput")) {
            const fi = document.createElement("input");
            fi.type = "file";
            fi.id = "siteEditFileInput";
            fi.accept = "image/*";
            fi.style.display = "none";
            fi.addEventListener("change", () => SiteEdit.onFilePicked(fi));
            document.body.appendChild(fi);
        }

        // observer buat year-grid yang di-render belakangan (async)
        const yg = document.getElementById("yearGrid");
        if (yg && !yg._editObs) {
            yg._editObs = new MutationObserver(() => {
                if (SiteEdit.active) SiteEdit.injectPhotoButtons();
            });
            yg._editObs.observe(yg, { childList: true });
        }
    },

    async loadTexts() {
        const apply = (rows) => {
            rows.forEach(r => {
                const el = document.querySelector(`[data-edit-key="${r.kunci}"]`);
                if (el) {
                    if (el.dataset.editHtml === "true") {
                        el.innerHTML = r.nilai.replace(/\n/g, "<br>");
                    } else {
                        el.textContent = r.nilai;
                    }
                }
                const a = document.querySelector(`[data-edit-href="${r.kunci}"]`);
                if (a) a.setAttribute("href", r.nilai);
            });
        };
        const cached = Cache.get("site_content");
        if (cached) {
            apply(cached);
            getSiteContent().then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Cache.set("site_content", fresh);
                    apply(fresh);
                }
            }).catch(() => {});
            return;
        }
        try {
            const rows = await getSiteContent();
            Cache.set("site_content", rows);
            apply(rows);
        } catch (err) {
            console.warn("Gagal load site_content:", err.message);
        }
    },

    toggle(on) {
        SiteEdit.active = !!on;
        document.body.classList.toggle("edit-mode", SiteEdit.active);

        const els = document.querySelectorAll("[data-edit-key]");
        els.forEach(el => {
            el.contentEditable = SiteEdit.active ? "true" : "false";
            el.spellcheck = false;
        });

        // sync checkbox titik tiga
        const moreEdit = document.getElementById("headerMoreEditToggle");
        const main = document.getElementById("editToggle");
        if (moreEdit && main) moreEdit.checked = SiteEdit.active;
        if (main) main.checked = SiteEdit.active;

        if (SiteEdit.active) {
            SiteEdit.injectPhotoButtons();
            showToast("Edit mode aktif — klik teks/foto buat ubah", "info");
        } else {
            SiteEdit.removePhotoButtons();
        }
        HeaderMore.refresh();
        if (typeof Prestasi !== "undefined" && Prestasi.render) Prestasi.render();
        if (typeof Kegiatan !== "undefined" && Kegiatan.render) Kegiatan.render();
        if (typeof Prestasi !== "undefined" && Prestasi.cekLogin) Prestasi.cekLogin();
        if (typeof Kegiatan !== "undefined" && Kegiatan.cekLogin) Kegiatan.cekLogin();
    },

    // Save pas selesai ngetik (blur)
    async handleBlur(e) {
        const el = e.target.closest("[data-edit-key]");
        if (!el || !SiteEdit.active) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const key = el.dataset.editKey;
        const isHtml = el.dataset.editHtml === "true";
        const val = isHtml ? el.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim() : el.textContent.trim();
        // untuk html, simpen innerText aja biar simpel — nanti dirender \n->br
        const simpanVal = isHtml ? el.innerText.trim() : el.textContent.trim();
        if (!key) return;
        try {
            await saveSiteText(u.id, key, simpanVal);
            // update cache biar instant next load
            const cached = Cache.get("site_content") || [];
            const idx = cached.findIndex(r => r.kunci === key);
            if (idx >= 0) cached[idx].nilai = simpanVal;
            else cached.push({ kunci: key, nilai: simpanVal });
            Cache.set("site_content", cached);
            showToast("Tersimpan: " + key, "success");
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan " + key, "error");
        }
    },

    // ============ FOTO ============
    injectPhotoButtons() {
        // static foto: [data-foto] — skip logo header (ngikut hero)
        document.querySelectorAll("[data-foto]").forEach(el => {
            if (el.closest(".top-nav")) return;
            const parent = el.closest(".hero-logo, .logo-box, .pembina-photo, .prestasi-card, .bento-grid .item") || el.parentElement;
            if (!parent) return;
            if (parent.querySelector(".photo-edit-btn")) return;
            if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
            const btn = document.createElement("button");
            btn.className = "photo-edit-btn";
            btn.type = "button";
            btn.title = "Ganti foto";
            btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                SiteEdit.fileTarget = { type: "web_foto", key: el.dataset.foto };
                document.getElementById("siteEditFileInput").click();
            });
            parent.appendChild(btn);
        });

        // year-grid (dinamis): tiap .year-card
        document.querySelectorAll(".year-card").forEach(card => {
            if (card.querySelector(".photo-edit-btn")) return;
            const tahun = card.getAttribute("onclick")?.match(/\d{4}/)?.[0];
            if (!tahun) return;
            card.style.position = "relative";
            const btn = document.createElement("button");
            btn.className = "photo-edit-btn";
            btn.type = "button";
            btn.title = "Ganti foto angkatan " + tahun;
            btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                SiteEdit.fileTarget = { type: "pimpinan", tahun: tahun };
                document.getElementById("siteEditFileInput").click();
            });
            card.appendChild(btn);
        });

        // prestasi & kegiatan sekarang DB-driven (prestasi.js/kegiatan.js handle sendiri)

        // kontak social: edit href + handle
        document.querySelectorAll(".social-card").forEach(card => {
            if (card.querySelector(".social-edit-btn")) return;
            card.style.position = "relative";
            // cegah navigasi pas edit mode
            card.addEventListener("click", (e) => {
                if (SiteEdit.active) { e.preventDefault(); e.stopPropagation(); }
            });
            const btn = document.createElement("button");
            btn.className = "photo-edit-btn social-edit-btn";
            btn.type = "button";
            btn.title = "Edit kontak";
            btn.innerHTML = '<i class="fa-solid fa-pen"></i>';
            btn.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const handleEl = card.querySelector("[data-edit-key]");
                const urlKey = card.dataset.editHref;
                const handleKey = handleEl ? handleEl.dataset.editKey : null;
                const curUrl = card.getAttribute("href") || "";
                const curHandle = handleEl ? handleEl.textContent.trim() : "";
                const result = await showPopup("Edit kontak", "form", {
                    title: "Edit Social Media",
                    fields: [
                        { name: "url", label: "URL", type: "text", placeholder: "https://...", value: curUrl },
                        { name: "handle", label: "Teks handle", type: "text", placeholder: "@...", value: curHandle }
                    ]
                });
                if (!result) return;
                const newUrl = (result.url || "").trim();
                const newHandle = (result.handle || "").trim();
                if (!newUrl || !newHandle) { showToast("URL & handle wajib diisi", "error"); return; }
                card.setAttribute("href", newUrl);
                if (handleEl) handleEl.textContent = newHandle;
                const u = OsisAuth.getUser && OsisAuth.getUser();
                if (!u || u.mode !== "osis") { showToast("Preview diupdate (login OSIS buat simpan permanen)", "info"); return; }
                try {
                    if (urlKey) await saveSiteText(u.id, urlKey, newUrl);
                    if (handleKey) await saveSiteText(u.id, handleKey, newHandle);
                    const cached2 = Cache.get("site_content") || [];
                    if (urlKey) {
                        const i = cached2.findIndex(r => r.kunci === urlKey);
                        if (i >= 0) cached2[i].nilai = newUrl; else cached2.push({ kunci: urlKey, nilai: newUrl });
                    }
                    if (handleKey) {
                        const j = cached2.findIndex(r => r.kunci === handleKey);
                        if (j >= 0) cached2[j].nilai = newHandle; else cached2.push({ kunci: handleKey, nilai: newHandle });
                    }
                    Cache.set("site_content", cached2);
                    showToast("Kontak diperbarui!", "success");
                } catch (err) {
                    console.error(err);
                    showToast("Gagal simpan kontak", "error");
                }
            });
            card.appendChild(btn);
        });
    },


    injectModalFotoButtons(modal, tahun) {
        // foto pimpinan & angkatan di dalam popup — overlay kamera kecil
        modal.querySelectorAll(".pimp-photo, .struktur-foto").forEach(wrap => {
            if (wrap.querySelector(".photo-edit-btn")) return;
            if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
            const btn = document.createElement("button");
            btn.className = "photo-edit-btn";
            btn.type = "button";
            btn.title = "Ganti foto";
            btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
            let field = "foto_angkatan";
            if (wrap.classList.contains("pimp-photo")) {
                const all = modal.querySelectorAll(".pimp-photo");
                if (wrap === all[0]) field = "ketua_foto";
                else if (wrap === all[1]) field = "wakil_foto";
            }
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                SiteEdit.fileTarget = { type: "pimpinan_modal", tahun: String(tahun), field };
                document.getElementById("siteEditFileInput").click();
            });
            wrap.appendChild(btn);
        });
    },

    async savePopup(tahun, modal) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const key = String(tahun);
        const lama = (typeof Home !== "undefined" && Home.cachePimpinan) ? Home.cachePimpinan[key] || {} : {};
        const ketuaEl = modal.querySelector('[data-pimp-field="ketua_nama"]');
        const wakilEl = modal.querySelector('[data-pimp-field="wakil_nama"]');
        const ketuaNama = ketuaEl ? ketuaEl.textContent.trim() : (lama.ketua_nama || "");
        const wakilNama = wakilEl ? wakilEl.textContent.trim() : (lama.wakil_nama || "");
        const pending = SiteEdit.pendingModalFotos[key] || {};
        const ketuaFoto = pending.ketua_foto || lama.ketua_foto || "";
        const wakilFoto = pending.wakil_foto || lama.wakil_foto || "";
        const fotoAngkatan = pending.foto_angkatan || lama.foto_angkatan || "";

        const pimpChanged = ketuaNama !== (lama.ketua_nama || "") || wakilNama !== (lama.wakil_nama || "") || pending.ketua_foto || pending.wakil_foto || pending.foto_angkatan;

        const anggotaEls = modal.querySelectorAll(".anggota-chip[data-anggota-id]");
        const saves = [];
        anggotaEls.forEach(chip => {
            const id = chip.dataset.anggotaId;
            const orig = ((typeof Home !== "undefined" && Home.cacheAnggota && Home.cacheAnggota[key]) || []).find(a => String(a.id) === String(id));
            if (!orig) return;
            const namaEl = chip.querySelector('[data-field="nama"]');
            const jabEl = chip.querySelector('[data-field="jabatan"]');
            const nama = namaEl ? namaEl.textContent.trim() : orig.nama;
            const jabatan = jabEl ? jabEl.textContent.trim() : orig.jabatan;
            if (nama !== orig.nama || jabatan !== orig.jabatan) {
                saves.push(updateAnggota(parseInt(id, 10), { nama, jabatan, urutan: orig.urutan }));
            }
        });

        // anggota baru (temp) — yang ditambah via + Tambah anggota
        const tempChips = modal.querySelectorAll('.anggota-chip[data-temp="true"]');
        tempChips.forEach(chip => {
            const nama = chip.querySelector('[data-field="nama"]')?.textContent.trim() || "";
            const jabatan = chip.querySelector('[data-field="jabatan"]')?.textContent.trim() || "";
            if (!nama || !jabatan) return;
            saves.push(tambahAnggota({ tahun: parseInt(tahun, 10), nama, jabatan, urutan: 99 }));
        });

        const promises = [];
        if (pimpChanged) {
            promises.push(
                simpanPimpinan({ tahun: parseInt(tahun, 10), ketua_nama: ketuaNama, wakil_nama: wakilNama, ketua_foto: ketuaFoto, wakil_foto: wakilFoto, foto_angkatan: fotoAngkatan }).then(() => {
                    if (typeof Home !== "undefined") {
                        Home.cachePimpinan[key] = { ...(lama || {}), tahun: parseInt(tahun, 10), ketua_nama: ketuaNama, wakil_nama: wakilNama, ketua_foto: ketuaFoto, wakil_foto: wakilFoto, foto_angkatan: fotoAngkatan };
                        Cache.set("pimpinan", Object.values(Home.cachePimpinan));
                        const cardImg = document.querySelector(`.year-card[onclick*="${tahun}"] img`);
                        if (cardImg && fotoAngkatan) cardImg.src = getFoto(fotoAngkatan);
                    }
                    // hapus file lama yang keganti
                    if (pending.ketua_foto && lama.ketua_foto && pending.ketua_foto !== lama.ketua_foto) { hapusFotoStorage(lama.ketua_foto).catch(()=>{}); }
                    if (pending.wakil_foto && lama.wakil_foto && pending.wakil_foto !== lama.wakil_foto) { hapusFotoStorage(lama.wakil_foto).catch(()=>{}); }
                    if (pending.foto_angkatan && lama.foto_angkatan && pending.foto_angkatan !== lama.foto_angkatan) { hapusFotoStorage(lama.foto_angkatan).catch(()=>{}); }
                })
            );
        }
        // anggota saves will update cache via .then? updateAnggota already did, but cache not refreshed — we push and also update cache after
        saves.forEach(p => promises.push(p.then(() => {
            // refresh cache entry for that anggota is already handled by saves mapping? update cache manually
        })));

        if (promises.length === 0) {
            delete SiteEdit.pendingModalFotos[key];
            return;
        }
        try {
            await Promise.all(promises);
            // refresh anggota cache from DB biar urutan konsisten
            if (saves.length > 0 && typeof supa !== "undefined") {
                try {
                    const { data } = await supa.from("anggota").select("*").eq("tahun", parseInt(tahun, 10)).order("urutan");
                    if (typeof Home !== "undefined") Home.cacheAnggota[key] = data || [];
                } catch (e) {}
            }
            delete SiteEdit.pendingModalFotos[key];
            showToast("Perubahan tersimpan", "success");
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        }
    },

    removePhotoButtons() {
        document.querySelectorAll(".photo-edit-btn, .edit-del-btn, .edit-add-btn, .up-slot-kegiatan").forEach(b => b.remove());
    },


    async savePimpinan(tahun) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const lama = (typeof Home !== "undefined" && Home.cachePimpinan) ? Home.cachePimpinan[String(tahun)] || {} : {};
        let ketuaFoto = lama.ketua_foto || "";
        let wakilFoto = lama.wakil_foto || "";
        let fotoAngkatan = lama.foto_angkatan || "";
        try {
            const ketuaFile = document.getElementById(`pimpKetuaFile-${tahun}`)?.files[0];
            if (ketuaFile) {
                const ext = (ketuaFile.name.split(".").pop() || "jpg").toLowerCase();
                const p = `pimpinan/ketos${tahun}-${Date.now()}.${ext}`;
                await uploadFotoStorage(ketuaFile, p);
                ketuaFoto = p;
            }
            const wakilFile = document.getElementById(`pimpWakilFile-${tahun}`)?.files[0];
            if (wakilFile) {
                const ext = (wakilFile.name.split(".").pop() || "jpg").toLowerCase();
                const p = `pimpinan/waketos${tahun}-${Date.now()}.${ext}`;
                await uploadFotoStorage(wakilFile, p);
                wakilFoto = p;
            }
            const angFile = document.getElementById(`pimpAngkatanFile-${tahun}`)?.files[0];
            if (angFile) {
                const ext = (angFile.name.split(".").pop() || "jpg").toLowerCase();
                const p = `angkatan/foto-${tahun}-${Date.now()}.${ext}`;
                await uploadFotoStorage(angFile, p);
                fotoAngkatan = p;
            }
            const ketuaNama = document.getElementById(`pimpKetuaNama-${tahun}`)?.value.trim() || "";
            const wakilNama = document.getElementById(`pimpWakilNama-${tahun}`)?.value.trim() || "";
            await simpanPimpinan({ tahun: parseInt(tahun,10), ketua_nama: ketuaNama, wakil_nama: wakilNama, ketua_foto: ketuaFoto, wakil_foto: wakilFoto, foto_angkatan: fotoAngkatan });
            if (typeof Home !== "undefined") {
                Home.cachePimpinan[String(tahun)] = { tahun: parseInt(tahun,10), ketua_nama: ketuaNama, wakil_nama: wakilNama, ketua_foto: ketuaFoto, wakil_foto: wakilFoto, foto_angkatan: fotoAngkatan };
                // update year card preview
                const card = document.querySelector(`.year-card[onclick*="${tahun}"] img`);
                if (card && fotoAngkatan) card.src = getFoto(fotoAngkatan);
            }
            showToast("Pimpinan tersimpan!", "success");
            Home.tutupModal(true);
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        }
    },

    async saveAnggota(id, tahun) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const row = document.querySelector(`.anggota-chip[data-anggota-id="${id}"]`);
        if (!row) return;
        const nama = row.querySelector('[data-field="nama"]')?.value.trim() || "";
        const jabatan = row.querySelector('[data-field="jabatan"]')?.value.trim() || "";
        const urutan = parseInt(row.querySelector('[data-field="urutan"]')?.value, 10) || 99;
        if (!nama || !jabatan) { showToast("Nama & jabatan wajib diisi", "error"); return; }
        try {
            await updateAnggota(id, { nama, jabatan, urutan });
            // update cache
            if (typeof Home !== "undefined" && Home.cacheAnggota[String(tahun)]) {
                const list = Home.cacheAnggota[String(tahun)];
                const idx = list.findIndex(a => String(a.id) === String(id));
                if (idx >= 0) list[idx] = { ...list[idx], nama, jabatan, urutan };
                list.sort((a,b) => (a.urutan||99)-(b.urutan||99));
            }
            showToast("Anggota diperbarui", "success");
            Home.tutupModal(true);
            Home.tahunAktif = null;
            Home.bukaModal(tahun);
        } catch (err) {
            console.error(err);
            showToast("Gagal update: " + err.message, "error");
        }
    },

    async deleteAnggota(id, tahun) {
        const yakin = await showPopup("Hapus anggota ini?", "confirm");
        if (!yakin) return;
        try {
            await hapusAnggota(id);
            if (typeof Home !== "undefined" && Home.cacheAnggota[String(tahun)]) {
                Home.cacheAnggota[String(tahun)] = Home.cacheAnggota[String(tahun)].filter(a => String(a.id) !== String(id));
            }
            showToast("Anggota dihapus", "success");
            Home.tutupModal(true);
            Home.tahunAktif = null;
            Home.bukaModal(tahun);
        } catch (err) {
            console.error(err);
            showToast("Gagal hapus: " + err.message, "error");
        }
    },

    async addAnggota(tahun) {
        const nama = document.getElementById(`newAnggotaNama-${tahun}`)?.value.trim() || "";
        const jabatan = document.getElementById(`newAnggotaJabatan-${tahun}`)?.value.trim() || "";
        const urutan = parseInt(document.getElementById(`newAnggotaUrutan-${tahun}`)?.value, 10) || 99;
        if (!nama || !jabatan) { showToast("Nama & jabatan wajib diisi", "error"); return; }
        try {
            await tambahAnggota({ tahun: parseInt(tahun,10), nama, jabatan, urutan });
            // update cache: fetch ulang atau push
            if (typeof Home !== "undefined") {
                if (!Home.cacheAnggota[String(tahun)]) Home.cacheAnggota[String(tahun)] = [];
                // id belum tau, reload dari DB biar akurat
                const { data } = await supa.from("anggota").select("*").eq("tahun", parseInt(tahun,10)).order("urutan");
                Home.cacheAnggota[String(tahun)] = data || [];
            }
            showToast("Anggota ditambah!", "success");
            Home.tutupModal(true);
            Home.tahunAktif = null;
            Home.bukaModal(tahun);
        } catch (err) {
            console.error(err);
            showToast("Gagal tambah: " + err.message, "error");
        }
    },

    tambahAnggotaInline(tahun) {
        const modal = document.querySelector(`.struktur-modal[data-tahun="${tahun}"]`);
        const grid = modal ? modal.querySelector(".anggota-grid") : document.querySelector(".anggota-grid");
        if (!grid) return;
        const chip = document.createElement("div");
        chip.className = "anggota-chip";
        chip.dataset.temp = "true";
        chip.innerHTML = `
            <b contenteditable="true" spellcheck="false" data-field="nama" data-ph="Nama"></b>
            <span contenteditable="true" spellcheck="false" data-field="jabatan" data-ph="Jabatan"></span>
        `;
        const tambahBtn = grid.querySelector(".anggota-chip.tambah");
        if (tambahBtn) grid.insertBefore(chip, tambahBtn);
        else grid.appendChild(chip);
        const first = chip.querySelector('[data-field="nama"]');
        if (first) first.focus();
    },

    async onFilePicked(input) {
        const file = input.files && input.files[0];
        input.value = "";
        const target = SiteEdit.fileTarget;
        SiteEdit.fileTarget = null;
        if (!file || !target) return;
        if (!file.type.startsWith("image/")) {
            showToast("File harus gambar!", "error");
            return;
        }
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            showToast("Cuma OSIS yang bisa ganti foto", "error");
            return;
        }

        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        try {
            if (target.type === "web_foto") {
                const oldPath = FotoWeb.map[target.key];
                const path = `web/${target.key}-${Date.now()}.${ext}`;
                await uploadFotoStorage(file, path);
                await simpanWebFoto(target.key, path);
                // update cache web_foto
                const wfCache = Cache.get("web_foto") || [];
                const wi = wfCache.findIndex(r => r.kunci === target.key);
                if (wi >= 0) wfCache[wi].path = path; else wfCache.push({ kunci: target.key, path });
                Cache.set("web_foto", wfCache);
                // update UI langsung
                document.querySelectorAll(`[data-foto="${target.key}"]`).forEach(el => {
                    el.src = getFoto(path);
                });
                FotoWeb.map[target.key] = path;
                if (oldPath && oldPath !== path) { try { await hapusFotoStorage(oldPath); } catch {} }
                showToast("Foto diganti!", "success");
            } else if (target.type === "pimpinan") {
                const oldPath = (typeof Home !== "undefined" && Home.cachePimpinan && Home.cachePimpinan[String(target.tahun)]) ? Home.cachePimpinan[String(target.tahun)].foto_angkatan : null;
                const path = `angkatan/foto-${target.tahun}-${Date.now()}.${ext}`;
                await uploadFotoStorage(file, path);
                // simpan ke pimpinan (upsert)
                await simpanPimpinan({ tahun: parseInt(target.tahun, 10), foto_angkatan: path });
                if (typeof Home !== "undefined") {
                    if (!Home.cachePimpinan[String(target.tahun)]) Home.cachePimpinan[String(target.tahun)] = { tahun: parseInt(target.tahun, 10) };
                    Home.cachePimpinan[String(target.tahun)].foto_angkatan = path;
                    Cache.set("pimpinan", Object.values(Home.cachePimpinan));
                }
                // update card preview
                const card = document.querySelector(`.year-card[onclick*="${target.tahun}"]`);
                const img = card && card.querySelector("img");
                if (img) img.src = getFoto(path);
                if (oldPath && oldPath !== path) { try { await hapusFotoStorage(oldPath); } catch {} }
                showToast("Foto angkatan diganti!", "success");
            } else if (target.type === "pimpinan_modal") {
                const tahun = target.tahun;
                const field = target.field;
                let folder, prefix;
                if (field === "ketua_foto") { folder = "pimpinan"; prefix = `ketos${tahun}`; }
                else if (field === "wakil_foto") { folder = "pimpinan"; prefix = `waketos${tahun}`; }
                else { folder = "angkatan"; prefix = `foto-${tahun}`; }
                const path = `${folder}/${prefix}-${Date.now()}.${ext}`;
                await uploadFotoStorage(file, path);
                if (!SiteEdit.pendingModalFotos[tahun]) SiteEdit.pendingModalFotos[tahun] = {};
                SiteEdit.pendingModalFotos[tahun][field] = path;
                const modal = document.querySelector(".struktur-modal");
                if (modal) {
                    let img;
                    if (field === "ketua_foto") img = modal.querySelectorAll(".pimp-photo img")[0];
                    else if (field === "wakil_foto") img = modal.querySelectorAll(".pimp-photo img")[1];
                    else img = modal.querySelector(".struktur-foto img");
                    if (img) img.src = getFoto(path);
                }
                if (field === "foto_angkatan") {
                    const card = document.querySelector(`.year-card[onclick*="${tahun}"] img`);
                    if (card) card.src = getFoto(path);
                }
                showToast("Foto diganti (tersimpan pas tutup popup)", "success");
            }
        } catch (err) {
            console.error(err);
            showToast("Gagal upload: " + err.message, "error");
        }
    }
};

// blur handler untuk semua data-edit-key
document.addEventListener("focusout", (e) => {
    if (e.target && e.target.matches && e.target.matches("[data-edit-key]")) {
        SiteEdit.handleBlur(e);
    }
});

// ============ HEADER MORE (titik tiga mobile) ============
const HeaderMore = {
    toggle() {
        const menu = document.getElementById("headerMoreMenu");
        if (!menu) return;
        menu.classList.toggle("open");
    },
    close() {
        const menu = document.getElementById("headerMoreMenu");
        if (menu) menu.classList.remove("open");
    },
    onEditToggle(checked) {
        const main = document.getElementById("editToggle");
        if (main) main.checked = checked;
        SiteEdit.toggle(checked);
        HeaderMore.close();
    },
    async logout() {
        HeaderMore.close();
        const yakin = await showPopup("Yakin mau logout?", "confirm");
        if (!yakin) return;
        OsisAuth.logout();
        OsisAuth.renderHeader();
    },
    refresh() {
        const wrap = document.getElementById("headerMoreWrap");
        const editRow = document.getElementById("headerMoreEditRow");
        const logoutBtn = document.getElementById("headerMoreLogout");
        const moreEdit = document.getElementById("headerMoreEditToggle");
        const u = OsisAuth.getUser && OsisAuth.getUser();
        const isOsis = !!(u && u.mode === "osis");
        const isLogged = !!(u && (u.mode === "osis" || u.mode === "guest" || u.mode === "tamu"));
        const narrow = window.innerWidth <= 500;
        if (wrap) {
            const showWrap = narrow && isLogged;
            wrap.classList.toggle("show", showWrap);
            wrap.style.display = showWrap ? "" : "none";
        }
        if (editRow) editRow.style.display = isOsis ? "" : "none";
        if (logoutBtn) logoutBtn.style.display = isLogged ? "" : "none";
        if (moreEdit) {
            const main = document.getElementById("editToggle");
            moreEdit.checked = !!(main && main.checked);
        }
    }
};

// tutup menu kalo klik di luar
document.addEventListener("click", (e) => {
    const wrap = document.getElementById("headerMoreWrap");
    const menu = document.getElementById("headerMoreMenu");
    if (!wrap || !menu || !menu.classList.contains("open")) return;
    if (wrap.contains(e.target)) return;
    HeaderMore.close();
});
window.addEventListener("resize", () => HeaderMore.refresh());

// refresh toggle visibility tiap login/logout
const _origRenderHeader = OsisAuth.renderHeader.bind(OsisAuth);
OsisAuth.renderHeader = function() {
    _origRenderHeader();
    const wrap = document.getElementById("editToggleWrap");
    const u = OsisAuth.getUser && OsisAuth.getUser();
    if (wrap) wrap.style.display = (u && u.mode === "osis") ? "" : "none";
    // sync checkbox titik tiga
    const moreEdit = document.getElementById("headerMoreEditToggle");
    const main = document.getElementById("editToggle");
    if (moreEdit && main) moreEdit.checked = main.checked;
    HeaderMore.refresh();
    if (!u || u.mode !== "osis") {
        document.body.classList.remove("edit-mode");
        const t = document.getElementById("editToggle");
        if (t) t.checked = false;
        if (moreEdit) moreEdit.checked = false;
        SiteEdit.removePhotoButtons();
        document.querySelectorAll("[data-edit-key]").forEach(el => el.contentEditable = "false");
    }
};

if (typeof onReady === "function") {
    onReady(() => SiteEdit.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => SiteEdit.init());
} else {
    SiteEdit.init();
}
