// =========================================================================
// HOME — jejak organisasi, bento slider, ticker
// =========================================================================

const Home = {
    cachePimpinan: {},
    cacheAnggota: {},
    tahunAktif: null,
    fotoPopup: null,
    terinisialisasi: false,

    async init() {
        if (Home.terinisialisasi) return;
        Home.terinisialisasi = true;
        Home.renderTicker();
        document.addEventListener("keydown", (e) => {
            const active = document.activeElement;
            if (active && (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))) return;
            if (e.key === "Escape") Home.tutupModal();
            if (e.key === "ArrowLeft") Home.geserModalAktif(-1);
            if (e.key === "ArrowRight") Home.geserModalAktif(1);
        });
        window.addEventListener("popstate", () => {
            if (Home.selfBack) {
                Home.selfBack = false;
                return;
            }
            if (document.querySelector(".struktur-modal")) Home.tutupModal(true);
        });
        // Prestasi & kegiatan sekarang DB-driven (prestasi.js/kegiatan.js handle popup sendiri)
        // Tidak perlu listener hardcode di sini.
        await Home.muatArsip();
    },

    // ============ POPUP FOTO ============
    bukaFotoPopup(img, judul, caption, opsi = {}) {
        Home.tutupModal();
        Home.statePushed = false;
        try {
            history.pushState({ foto: true }, "");
            Home.statePushed = true;
        } catch (e) {}

        const gallery = Array.isArray(opsi.gallery) ? opsi.gallery : null;
        const startIndex = gallery ? Math.max(0, Math.min(opsi.index || 0, gallery.length - 1)) : 0;
        const current = gallery ? gallery[startIndex] : null;
        Home.fotoPopup = gallery ? { gallery, index: startIndex, onChange: opsi.onChange || null } : null;

        const src = current ? current.src : ((img && img.src) ? img.src : getFoto(FOTO_DEFAULT[(img && img.dataset.foto) || ""] || ""));
        const finalJudul = current ? (current.judul || judul || "") : (judul || "");
        const finalCaption = current ? (current.caption || "") : (caption || "");
        const canEditCaption = document.body.classList.contains("edit-mode") && (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        const captionPill = `<span class="foto-caption-pill" ${canEditCaption ? 'contenteditable="true" spellcheck="false"' : ''}>${escapeHtml(finalCaption || "")}</span>`;
        const captionHtml = finalCaption || canEditCaption ? `<div class="foto-caption">${captionPill}</div>` : "";
        const navHtml = gallery && gallery.length > 1 ? `
                    <button class="foto-nav foto-nav-prev" type="button" onclick="Home.geserFotoPopup(-1)" title="Foto sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>
                    <button class="foto-nav foto-nav-next" type="button" onclick="Home.geserFotoPopup(1)" title="Foto berikutnya"><i class="fa-solid fa-chevron-right"></i></button>` : "";
        const modal = document.createElement("div");
        modal.className = "struktur-modal";
        modal.innerHTML = `
            <div class="struktur-modal-bg"></div>
            <div class="struktur-modal-box foto-only">
                <div class="struktur-head">
                    <h4>${escapeHtml(finalJudul)}</h4>
                    <button class="struktur-close" type="button">&times;</button>
                </div>
                <div class="foto-pop">
                    ${navHtml}
                    <img src="${src}" alt="${escapeHtml(finalJudul)}">
                </div>
                ${captionHtml}
            </div>`;
        modal.querySelector(".struktur-modal-bg").addEventListener("click", () => Home.tutupModal());
        modal.querySelector(".struktur-close").addEventListener("click", () => Home.tutupModal());
        document.body.appendChild(modal);
        document.body.style.overflow = "hidden";
        if (Home.fotoPopup && typeof Home.fotoPopup.onChange === "function") {
            Home.fotoPopup.onChange(Home.fotoPopup.index, modal);
        }
    },

    geserFotoPopup(arah) {
        if (!Home.fotoPopup || !Array.isArray(Home.fotoPopup.gallery) || Home.fotoPopup.gallery.length < 2) return;
        if (!window.matchMedia("(min-width: 1024px)").matches) return;
        const modal = document.querySelector(".struktur-modal");
        if (!modal || !modal.querySelector(".foto-pop")) return;
        const total = Home.fotoPopup.gallery.length;
        Home.fotoPopup.index = (Home.fotoPopup.index + arah + total) % total;
        const item = Home.fotoPopup.gallery[Home.fotoPopup.index];
        const title = modal.querySelector(".struktur-head h4");
        const img = modal.querySelector(".foto-pop img");
        let captionEl = modal.querySelector(".foto-caption");
        const canEditCaption = document.body.classList.contains("edit-mode") && (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");

        if (title) title.textContent = item.judul || "";
        if (img) {
            img.src = item.src || "";
            img.alt = item.judul || "";
        }
        if ((item.caption || canEditCaption) && !captionEl) {
            captionEl = document.createElement("div");
            captionEl.className = "foto-caption";
            captionEl.innerHTML = `<span class="foto-caption-pill" ${canEditCaption ? 'contenteditable="true" spellcheck="false"' : ''}></span>`;
            const pop = modal.querySelector(".foto-pop");
            if (pop && pop.parentNode) pop.parentNode.appendChild(captionEl);
        }
        const pill = captionEl ? captionEl.querySelector(".foto-caption-pill") : null;
        if (pill) {
            pill.contentEditable = canEditCaption ? "true" : "false";
            pill.spellcheck = false;
            pill.textContent = item.caption || "";
            if (!item.caption && !canEditCaption && captionEl) captionEl.remove();
        } else if (captionEl) {
            captionEl.textContent = item.caption || "";
            if (!item.caption && !canEditCaption) captionEl.remove();
        }
        if (typeof Home.fotoPopup.onChange === "function") {
            Home.fotoPopup.onChange(Home.fotoPopup.index, modal);
        }
    },

    // ============ TICKER ============
    renderTicker() {
        const track = document.getElementById("tickerTrack");
        if (!track) return;
        // Duplikasi isi biar loop mulus
        track.innerHTML += track.innerHTML;
    },

    // ============ ARSIP ANGKATAN — SWR (cache dulu biar instant) ============
    async muatArsip() {
        const grid = document.getElementById("yearGrid");
        if (!grid) return;

        const render = (listPimpinan, listAnggota) => {
            Home.cachePimpinan = {};
            Home.cacheAnggota = {};
            listPimpinan.forEach(p => { Home.cachePimpinan[String(p.tahun)] = p; });
            listAnggota.forEach(a => {
                const k = String(a.tahun);
                if (!Home.cacheAnggota[k]) Home.cacheAnggota[k] = [];
                Home.cacheAnggota[k].push(a);
            });
            const totalTahun = Object.keys(Home.cachePimpinan).length;
            const chipTahun = document.getElementById("chipTahun");
            if (chipTahun && totalTahun) chipTahun.textContent = `${Math.min(...Object.keys(Home.cachePimpinan))}–${Math.max(...Object.keys(Home.cachePimpinan))}`;
            let html = "";
            for (let thn = 2010; thn <= 2027; thn++) {
                const p = Home.cachePimpinan[String(thn)];
                const foto = (p && p.foto_angkatan) ? p.foto_angkatan : `angkatan/foto-${thn}.jpg`;
                html += `
                    <div class="year-card" onclick="Home.toggleStruktur(${thn})" role="button">
                        <img src="${getFoto(foto)}" alt="Angkatan ${thn}" loading="lazy"
                             onerror="this.remove();">
                        <div class="year-overlay">
                            <span class="year-num">${thn}</span>
                            <span class="year-label">${labelTahun(thn)}</span>
                        </div>
                    </div>`;
            }
            grid.innerHTML = html;
            if (document.body.classList.contains("edit-mode") && typeof SiteEdit !== "undefined" && SiteEdit.injectPhotoButtons) {
                SiteEdit.injectPhotoButtons();
            }
        };

        const cachedP = Cache.get("pimpinan");
        const cachedA = Cache.get("anggota");
        if (cachedP && cachedA) {
            render(cachedP, cachedA);
            Promise.all([getPimpinan(), getAnggota()]).then(([freshP, freshA]) => {
                if (JSON.stringify(freshP) !== JSON.stringify(cachedP) || JSON.stringify(freshA) !== JSON.stringify(cachedA)) {
                    Cache.set("pimpinan", freshP);
                    Cache.set("anggota", freshA);
                    render(freshP, freshA);
                }
            }).catch(() => {});
            return;
        }

        grid.innerHTML = `<div class="year-card" style="grid-column: 1 / -1; aspect-ratio: auto; cursor: default;">
            <div class="year-loading"><div class="spinner"></div>Memuat jejak organisasi...</div>
        </div>`;

        try {
            const [freshP, freshA] = await Promise.all([getPimpinan(), getAnggota()]);
            Cache.set("pimpinan", freshP);
            Cache.set("anggota", freshA);
            render(freshP, freshA);
        } catch (err) {
            console.error("Gagal muat arsip:", err);
            grid.innerHTML = `<div class="year-card" style="grid-column: 1 / -1; aspect-ratio: auto; cursor: default;">
                <div class="year-loading">Gagal memuat data. Cek koneksi & konfigurasi.</div>
            </div>`;
        }
    },

    // ============ STRUKTUR DETAIL (POPUP) ============
    toggleStruktur(tahun) {
        if (Home.tahunAktif === tahun && document.querySelector(".struktur-modal")) {
            Home.tutupModal();
            return;
        }
        Home.tahunAktif = tahun;
        Home.bukaModal(tahun);
    },

    tutupModal(dariBack = false) {
        const modal = document.querySelector(".struktur-modal");
        // auto-save kalau lagi edit mode (tanpa ubah layout, tanpa tombol)
        if (modal && document.body.classList.contains("edit-mode") && typeof SiteEdit !== "undefined" && SiteEdit.savePopup) {
            const t = parseInt(modal.dataset.tahun, 10);
            if (t && !isNaN(t)) SiteEdit.savePopup(t, modal);
        }
        if (modal) {
            modal.classList.add("tutup");
            setTimeout(() => {
                if (modal.parentNode) modal.remove();
            }, 200);
        }
        Home.tahunAktif = null;
        Home.fotoPopup = null;
        document.body.style.overflow = "";
        const perluBack = !dariBack && Home.statePushed;
        Home.statePushed = false;
        if (perluBack) {
            Home.selfBack = true;
            setTimeout(() => { Home.selfBack = false; }, 300);
            history.back();
        }
    },

    bukaModal(tahun, tanpaHistory = false, tanpaAnimasi = false) {
        if (!tanpaHistory) {
            Home.statePushed = false;
            try {
                history.pushState({ struktur: tahun }, "");
                Home.statePushed = true;
            } catch (e) {}
        }
        const pimpinan = Home.cachePimpinan[String(tahun)] || null;
        const anggota = Home.cacheAnggota[String(tahun)] || [];
        const foto = (pimpinan && pimpinan.foto_angkatan) ? pimpinan.foto_angkatan : `angkatan/foto-${tahun}.jpg`;
        const isEdit = document.body.classList.contains("edit-mode") && (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");

        let chips = "";
        if (!isEdit) {
            if (anggota.length > 0) {
                chips = anggota.map(a => `
                    <div class="anggota-chip">
                        <b>${escapeHtml(a.nama)}</b>
                        <span>${escapeHtml(a.jabatan)}</span>
                    </div>`).join("");
            } else {
                chips = `<div style="grid-column: 1 / -1; font-size: 0.75rem; color: var(--gray); font-weight: 700;">Belum ada data anggota tahun ini.</div>`;
            }
        } else {
            if (anggota.length > 0) {
                chips = anggota.map(a => `
                    <div class="anggota-chip" data-anggota-id="${a.id}">
                        <b contenteditable="true" spellcheck="false" data-field="nama" data-anggota-id="${a.id}">${escapeHtml(a.nama)}</b>
                        <span contenteditable="true" spellcheck="false" data-field="jabatan" data-anggota-id="${a.id}">${escapeHtml(a.jabatan)}</span>
                    </div>`).join("");
            } else {
                chips = "";
            }
            chips += `<div class="anggota-chip tambah" onclick="SiteEdit.tambahAnggotaInline(${tahun})" style="border-style:dashed; cursor:pointer; align-items:center; justify-content:center; color:var(--gray); min-height:56px;"><span><i class="fa-solid fa-plus"></i> Tambah anggota</span></div>`;
            if (anggota.length === 0) {
                chips = `<div style="grid-column: 1 / -1; font-size: 0.75rem; color: var(--gray); font-weight: 700; margin-bottom:6px;">Belum ada data anggota tahun ini.</div>` + chips;
            }
        }

        const modal = document.createElement("div");
        modal.className = tanpaAnimasi ? "struktur-modal no-anim" : "struktur-modal";
        // simpan tahun di dataset modal biar auto-save tau konteksnya
        modal.dataset.tahun = String(tahun);
        modal.innerHTML = `
            <div class="struktur-modal-bg"></div>
            <div class="struktur-modal-box">
                <div class="struktur-head">
                    <h4>${labelTahun(tahun)} (${tahun})</h4>
                    <button class="struktur-close" type="button">&times;</button>
                </div>
                <div class="struktur-modal-body">
                    <button class="foto-nav foto-nav-prev struktur-nav" type="button" onclick="Home.geserStruktur(-1)" title="Angkatan sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>
                    <button class="foto-nav foto-nav-next struktur-nav" type="button" onclick="Home.geserStruktur(1)" title="Angkatan berikutnya"><i class="fa-solid fa-chevron-right"></i></button>
                    <div class="struktur-foto">
                        <img src="${getFoto(foto)}" alt="Angkatan ${tahun}" loading="lazy"
                             onclick="Home.bukaFotoAngkatan(${tahun}, 'angkatan')"
                             onerror="this.remove();">
                    </div>

                    <div class="struktur-pimpinan">
                        <div class="pimp-card">
                            <div class="pimp-photo">
                                <img src="${getFoto(pimpinan ? pimpinan.ketua_foto : "")}" alt="Ketua OSIS"
                                     onclick="Home.bukaFotoAngkatan(${tahun}, 'ketua')"
                                     onerror="this.remove();">
                            </div>
                            <div class="pimp-info">
                                ${isEdit ? `<b contenteditable="true" spellcheck="false" data-pimp-field="ketua_nama" data-tahun="${tahun}">${pimpinan && pimpinan.ketua_nama ? escapeHtml(pimpinan.ketua_nama) : ""}</b>` : `<b>${pimpinan && pimpinan.ketua_nama ? escapeHtml(pimpinan.ketua_nama) : "Belum Ada"}</b>`}
                                <span>Ketua OSIS</span>
                            </div>
                        </div>
                        <div class="pimp-card">
                            <div class="pimp-photo">
                                <img src="${getFoto(pimpinan ? pimpinan.wakil_foto : "")}" alt="Wakil Ketua"
                                     onclick="Home.bukaFotoAngkatan(${tahun}, 'wakil')"
                                     onerror="this.remove();">
                            </div>
                            <div class="pimp-info">
                                ${isEdit ? `<b contenteditable="true" spellcheck="false" data-pimp-field="wakil_nama" data-tahun="${tahun}">${pimpinan && pimpinan.wakil_nama ? escapeHtml(pimpinan.wakil_nama) : ""}</b>` : `<b>${pimpinan && pimpinan.wakil_nama ? escapeHtml(pimpinan.wakil_nama) : "Belum Ada"}</b>`}
                                <span>Wakil Ketua</span>
                            </div>
                        </div>
                    </div>

                    <div class="struktur-anggota">
                        <div class="pembatas">Anggota</div>
                        <div class="anggota-grid">${chips}</div>
                    </div>

                </div>
            </div>
        `;

        modal.querySelector(".struktur-modal-bg").addEventListener("click", () => Home.tutupModal());
        modal.querySelector(".struktur-close").addEventListener("click", () => Home.tutupModal());
        document.body.appendChild(modal);
        if (typeof isEdit !== "undefined" && isEdit && typeof SiteEdit !== "undefined" && SiteEdit.injectModalFotoButtons) {
            SiteEdit.injectModalFotoButtons(modal, tahun);
        }
        document.body.style.overflow = "hidden";
    },

    getGaleriAngkatan(tahun) {
        const pimpinan = Home.cachePimpinan[String(tahun)] || null;
        const fotoAngkatan = (pimpinan && pimpinan.foto_angkatan) ? pimpinan.foto_angkatan : `angkatan/foto-${tahun}.jpg`;
        return [
            { key: "angkatan", src: getFoto(fotoAngkatan), judul: `Angkatan ${tahun}`, caption: labelTahun(tahun) },
            { key: "ketua", src: getFoto(pimpinan ? pimpinan.ketua_foto : ""), judul: "Ketua OSIS", caption: pimpinan && pimpinan.ketua_nama ? pimpinan.ketua_nama : "" },
            { key: "wakil", src: getFoto(pimpinan ? pimpinan.wakil_foto : ""), judul: "Wakil Ketua", caption: pimpinan && pimpinan.wakil_nama ? pimpinan.wakil_nama : "" }
        ].filter(item => item.src);
    },

    bukaFotoAngkatan(tahun, key) {
        const gallery = Home.getGaleriAngkatan(tahun);
        if (gallery.length === 0) return;
        const index = Math.max(0, gallery.findIndex(item => item.key === key));
        Home.bukaFotoPopup(null, gallery[index].judul, gallery[index].caption, { gallery, index });
    },

    geserModalAktif(arah) {
        const modal = document.querySelector(".struktur-modal");
        if (!modal) return;
        if (Home.fotoPopup) {
            Home.geserFotoPopup(arah);
            return;
        }
        if (modal.dataset.tahun) Home.geserStruktur(arah);
    },

    geserStruktur(arah) {
        if (!window.matchMedia("(min-width: 1024px)").matches) return;
        const modal = document.querySelector(".struktur-modal[data-tahun]");
        if (!modal) return;
        const tahun = parseInt(modal.dataset.tahun, 10);
        if (!tahun || isNaN(tahun)) return;
        const tahunList = [];
        for (let thn = 2010; thn <= 2027; thn++) tahunList.push(thn);
        const idx = tahunList.indexOf(tahun);
        if (idx < 0) return;
        const next = tahunList[(idx + arah + tahunList.length) % tahunList.length];
        if (document.body.classList.contains("edit-mode") && typeof SiteEdit !== "undefined" && SiteEdit.savePopup) {
            SiteEdit.savePopup(tahun, modal);
        }
        modal.remove();
        Home.tahunAktif = next;
        Home.bukaModal(next, true, true);
    }
};

if (typeof Router !== "undefined") {
    Router.register("home", () => Home.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Home.init());
} else {
    Home.init();
}
