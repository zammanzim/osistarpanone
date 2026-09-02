// =========================================================================
// GALERI — dokumentasi kegiatan: judul + subjudul + deretan foto
// horizontal. Tambah kegiatan = draft block inline di urutan paling
// atas (editable), foto ditambah satu-satu lewat slot "+" di kanan.
// Auto-save: foto pertama bikin baris DB, teks ke-save pas blur.
// =========================================================================

const Galeri = {
    terinisialisasi: false,
    draft: null, // { id: number|null, judul: "", deskripsi: "", fotos: [] }
    cache: [],   // hasil fetch terakhir, dipake pas re-render draft

    init() {
        if (Galeri.terinisialisasi) return;
        Galeri.terinisialisasi = true;
        Galeri.cekLogin();
        Galeri.muat();

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
                const file = e.dataTransfer.files && e.dataTransfer.files[0];
                Galeri.tambahFileDraft(file);
            });
        }
        const fileInput = document.getElementById("galFileInput");
        if (fileInput) fileInput.addEventListener("change", () => Galeri.tambahFotoDraft(fileInput));


    },

    // Tombol + & elemen edit cuma aktif kalo login sbg OSIS
    cekLogin() {
        const u = OsisAuth.getUser();
        const osis = !!(u && u.mode === "osis");
        const btn = document.getElementById("btnBukaUpload");
        if (btn) btn.style.display = osis ? "" : "none";
        const grid = document.getElementById("galGrid");
        if (grid) grid.classList.toggle("mode-osis", osis);
    },

    // ============ DRAFT BLOCK ============
    buatDraft() {
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

    // Tambah foto ke draft — cuma preview lokal, belum upload
    tambahFotoDraft(input) {
        if (!Galeri.draft) return;
        const file = input.files && input.files[0];
        input.value = "";
        Galeri.tambahFileDraft(file);
    },

    tambahFileDraft(file) {
        if (!Galeri.draft) return;
        Galeri.bacaTeksDraft();
        if (!file || !file.type.startsWith("image/")) {
            if (file) showToast("File harus gambar", "error");
            return;
        }
        if (!Galeri.draft.files) Galeri.draft.files = [];
        Galeri.draft.files.push(file);
        Galeri.render();
        // fokus balik biar gampang tambah lagi
        const draftEl = document.querySelector(".bento-block.draft");
        if (draftEl) draftEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },

    // Simpan draft — upload semua foto baru bikin row DB
    async simpanDraft() {
        const u = OsisAuth.getUser();
        if (!u || u.mode !== "osis" || !Galeri.draft) return;
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
            showToast("Tambah minimal 1 foto dulu!", "error");
            return;
        }

        const btn = document.querySelector(".gal-save");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

        try {
            const paths = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
                const path = `gallery/galeri-${u.id}-${Date.now()}-${i}.${ext}`;
                await uploadFotoStorage(file, path);
                paths.push(path);
            }
            const newId = await buatGallery(u.id, judul, Galeri.draft.deskripsi || "", paths);
            if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
            showToast("Kegiatan berhasil dipublish!", "success");
            Galeri.draft = null;
            Cache.del("gallery");
            Galeri.cache = [];
            await Galeri.muat();
        } catch (err) {
            console.error(err);
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
        Galeri.draft = null;
        Galeri.render();
    },

    // ============ MUAT & RENDER — SWR ============
    async muat() {
        const grid = document.getElementById("galGrid");
        if (!grid) return;

        const cached = Cache.get("gallery");
        if (cached) {
            Galeri.cache = cached;
            Galeri.render();
            getGallery().then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Cache.set("gallery", fresh);
                    Galeri.cache = fresh;
                    Galeri.render();
                }
            }).catch(() => {});
            return;
        }

        try {
            const data = await getGallery();
            Cache.set("gallery", data);
            Galeri.cache = data || [];
            Galeri.render();
        } catch (err) {
            console.error(err);
            grid.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat galeri. Cek koneksi.</div>`;
        }
    },

    render() {
        const grid = document.getElementById("galGrid");
        if (!grid) return;

        const data = Galeri.cache;
        let html = "";

        // Draft block selalu paling atas
        if (Galeri.draft) html += Galeri.kartuDraft();

        if (data.length === 0 && !Galeri.draft) {
            html += `<div class="pesan-empty"><i class="fa-solid fa-images"></i> Belum ada dokumentasi. Segera hadir!</div>`;
        } else {
            html += data.map(item => Galeri.kartu(item)).join("");
        }

        grid.innerHTML = html;
    },

    // Struktur draft = persis kartu kegiatan: judul -> subjudul -> foto [+]
    kartuDraft() {
        const d = Galeri.draft;
        let fotoHtml = (d.files || []).map(file => {
            const url = URL.createObjectURL(file);
            return `<div class="item"><img src="${url}" alt=""></div>`;
        }).join("");
        fotoHtml += `<div class="up-slot" title="Tambah foto"><i class="fa-solid fa-plus"></i></div>`;

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
                <div class="gal-row">${fotoHtml}</div>
            </div>`;
    },

    kartu(item) {
        const judul = escapeHtml(item.judul);
        const deskripsi = escapeHtml(item.deskripsi || "");
        const fotos = Array.isArray(item.fotos) ? item.fotos : [];

        let fotoHtml = "";
        fotos.forEach(path => {
            fotoHtml += `
                <div class="item" onclick="Home.bukaFotoPopup(this.querySelector('img'), ${JSON.stringify(item.judul).replace(/"/g, "&quot;")}, ${JSON.stringify(item.deskripsi || "").replace(/"/g, "&quot;")})">
                    <img src="${getFoto(path)}" alt="${judul}" loading="lazy">
                </div>`;
        });

        return `
            <div class="bento-block">
                <div class="bento-meta">
                    <h4>${judul}</h4>
                    ${deskripsi ? `<p>${deskripsi}</p>` : ""}
                    <button class="icon-btn gal-del" onclick="Galeri.hapus(${item.id})" title="Hapus kegiatan">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
                <div class="gal-row">${fotoHtml}</div>
            </div>`;
    },

    formatTanggal(t) {
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return ""; }
    },

    // ============ HAPUS KEGIATAN ============
    async hapus(id) {
        const u = OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;

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
            Galeri.muat();
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
