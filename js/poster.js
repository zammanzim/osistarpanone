// =========================================================================
// POSTER — feed foto + caption (arsip peringatan), 1 foto per poster
// Container #posterGrid di view poster, render via SWR.
// Tambah via FAB -> popup form (foto drag&drop, judul, caption)
// =========================================================================

const Poster = {
    cache: [],
    terinisialisasi: false,
    pendingFile: null,

    init() {
        if (Poster.terinisialisasi) return;
        Poster.terinisialisasi = true;
        if (typeof OsisAuth.refreshAkses === "function") {
            OsisAuth.refreshAkses().then(() => { Poster.cekLogin(); Poster.render(); }).catch(() => {});
        }
        Poster.cekLogin();
        Poster.muat();
    },

    cekLogin() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        const osis = !!(u && u.mode === "osis");
        const boleh = osis && OsisAuth.bisa && OsisAuth.bisa("poster");
        const btn = document.getElementById("btnTambahPoster");
        if (btn) btn.style.display = boleh ? "" : "none";
        const grid = document.getElementById("posterGrid");
        if (grid) grid.classList.toggle("mode-osis", !!boleh);
    },

    async muat() {
        const grid = document.getElementById("posterGrid");
        if (!grid) return;
        const cached = Cache.get("poster");
        if (cached) {
            Poster.cache = cached || [];
            try { Poster.render(); } catch {}
            getPoster().then(fresh => {
                Cache.set("poster", fresh);
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Poster.cache = fresh || [];
                    Poster.render();
                }
            }).catch(() => {});
            return;
        }
        grid.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat poster...</div>`;
        try {
            const data = await getPoster();
            Cache.set("poster", data);
            Poster.cache = data || [];
            Poster.render();
        } catch (err) {
            console.error(err);
            grid.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat poster. Cek koneksi.</div>`;
        }
    },

    render() {
        const grid = document.getElementById("posterGrid");
        if (!grid) return;
        const data = Poster.cache || [];
        if (data.length === 0) {
            grid.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-newspaper"></i> Belum ada poster. Segera hadir!</div>`;
            return;
        }
        grid.innerHTML = data.map(item => Poster.kartu(item)).join("");
    },

    fmtTanggal(iso) {
        try {
            return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return ""; }
    },

    kartu(item) {
        const judul = escapeHtml(item.judul || "");
        const caption = escapeHtml(item.caption || "");
        const foto = item.foto || "";
        const tgl = Poster.fmtTanggal(item.created_at);
        const isEdit = (typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("poster"));
        return `
            <article class="poster-card" data-poster-id="${item.id}">
                <div class="poster-head">
                    <span class="poster-ava"><i class="fa-solid fa-newspaper"></i></span>
                    <div class="poster-who">
                        <b>osis_tarpanone</b>
                        ${tgl ? `<small>${tgl}</small>` : ""}
                    </div>
                    ${isEdit ? `<button class="poster-del" onclick="event.stopPropagation(); Poster.hapus(${item.id})" title="Hapus poster"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                </div>
                <img src="${getFoto(foto)}" alt="${judul || "Poster"}" loading="lazy" onerror="this.style.display='none'" onclick="Poster.bukaPopup(${item.id})">
                <div class="poster-body">
                    <p>${judul ? `<b>${judul}</b> ` : ""}${caption}</p>
                </div>
            </article>`;
    },

    bukaPopup(id) {
        const item = (Poster.cache || []).find(p => String(p.id) === String(id));
        if (!item || !item.foto) return;
        if (typeof Home !== "undefined" && Home.bukaFotoPopup) {
            const img = document.querySelector(`.poster-card[data-poster-id="${id}"] img`);
            Home.bukaFotoPopup(img || { src: getFoto(item.foto) }, item.judul || "Poster", item.caption || "");
        } else {
            window.open(getFoto(item.foto), "_blank");
        }
    },

    // ============ FORM POPUP ============
    bukaForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (!OsisAuth.butuh("poster")) return;
        Poster.pendingFile = null;
        const existing = document.getElementById("posterFormOverlay");
        if (existing) existing.remove();
        const overlay = document.createElement("div");
        overlay.id = "posterFormOverlay";
        overlay.className = "prestasi-form-overlay";
        overlay.innerHTML = `
            <div class="prestasi-form-box">
                <div class="form-head" style="display:flex;align-items:center;justify-content:space-between">
                    <span><i class="fa-solid fa-plus"></i> Tambah Poster</span>
                    <button class="icon-btn" onclick="Poster.tutupForm()" title="Tutup"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="prestasi-drop" id="posterDrop">
                    <div class="prestasi-drop-inner" id="posterDropInner">
                        <i class="fa-solid fa-cloud-arrow-up"></i>
                        <span>Klik atau drag foto ke sini</span>
                        <small>JPG/PNG, max 10MB (otomatis compress &lt;1MB)</small>
                    </div>
                    <img id="posterPreview" style="display:none; width:100%; height:100%; object-fit:cover; border-radius:12px;">
                </div>
                <input type="file" id="posterFormFile" accept="image/*" style="display:none">
                <div class="field" style="margin-top:12px">
                    <label>Judul poster</label>
                    <input type="text" id="posterJudul" class="admin-input" placeholder="cth: Maulid Nabi 1447 H" maxlength="80">
                </div>
                <div class="field">
                    <label>Caption</label>
                    <textarea id="posterCaption" class="admin-input admin-textarea" placeholder="Caption poster..." maxlength="500" rows="3"></textarea>
                </div>
                <div class="form-actions-row" style="margin-top:14px">
                    <button class="btn btn-white" onclick="Poster.tutupForm()">Batal</button>
                    <button class="btn btn-red" id="btnSimpanPoster" onclick="Poster.simpanForm()"><i class="fa-solid fa-check"></i> Simpan</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("active")));
        document.body.style.overflow = "hidden";
        overlay.addEventListener("click", (e) => { if (e.target === overlay) Poster.tutupForm(); });

        const drop = overlay.querySelector("#posterDrop");
        const fileInput = overlay.querySelector("#posterFormFile");
        const preview = overlay.querySelector("#posterPreview");
        const inner = overlay.querySelector("#posterDropInner");

        drop.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => {
            const f = fileInput.files && fileInput.files[0];
            if (f) Poster.handlePickedFile(f, preview, inner);
        });
        ["dragenter","dragover"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
        });
        ["dragleave","drop"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
        });
        drop.addEventListener("drop", (e) => {
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) Poster.handlePickedFile(f, preview, inner);
        });
    },

    tutupForm() {
        const el = document.getElementById("posterFormOverlay");
        if (el) {
            el.classList.remove("active");
            setTimeout(() => { if (el.parentNode) el.remove(); }, 220);
        }
        document.body.style.overflow = "";
        Poster.pendingFile = null;
    },

    handlePickedFile(file, previewEl, innerEl) {
        if (!file || !file.type.startsWith("image/")) { showToast("File harus gambar", "error"); return; }
        Poster.pendingFile = file;
        const url = URL.createObjectURL(file);
        const preview = previewEl || document.getElementById("posterPreview");
        const inner = innerEl || document.getElementById("posterDropInner");
        if (preview) { preview.src = url; preview.style.display = "block"; }
        if (inner) inner.style.display = "none";
        const drop = document.getElementById("posterDrop");
        if (drop) drop.classList.add("has-file");
    },

    async simpanForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (!OsisAuth.butuh("poster")) return;
        const judul = document.getElementById("posterJudul")?.value.trim() || "";
        const caption = document.getElementById("posterCaption")?.value.trim() || "";
        const file = Poster.pendingFile;
        if (!file) { showToast("Pilih foto dulu", "error"); return; }
        if (!judul && !caption) { showToast("Judul atau caption diisi dulu", "error"); return; }
        const __spec = () => ({ modul: "poster", op: "create",
            label: "Poster: " + String(judul || caption || "baru").slice(0, 42),
            payload: { judul, caption },
            files: [{ slot: "foto", file, name: file.name, type: file.type }],
            cacheKeys: ["poster"] });
        const __sesudahAntre = () => { Poster.tutupForm(); };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
            return;
        }
        const btn = document.getElementById("btnSimpanPoster");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            const ext = (file.name.split(".").pop()||"jpg").toLowerCase();
            const path = `poster/poster-${u.id}-${Date.now()}.${ext}`;
            await uploadFotoStorage(file, path);
            const newId = await buatPoster(u.id, judul, caption, path);
            if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
            showToast("Poster ditambah!", "success");
            Poster.tutupForm();
            Cache.del("poster");
            await Poster.muat();
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
                Outbox.sesudahAntre(__sesudahAntre);
                return;
            }
            if (String(err.message).includes("-1") || err.message === "ERR_NO_AUTH") {
                showPopup("Cuma akun OSIS yang bisa nambah poster.", "error");
            } else {
                showToast("Gagal simpan: " + err.message, "error");
            }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("poster")) return;
        const yakin = await showPopup("Hapus poster ini? Fotonya ikut terhapus.", "confirm");
        if (!yakin) return;
        try {
            const item = (Poster.cache || []).find(p => String(p.id) === String(id));
            await hapusPoster(u.id, id);
            if (item && item.foto) { try { await hapusFotoStorage(item.foto); } catch {} }
            showToast("Poster dihapus", "success");
            Cache.del("poster");
            await Poster.muat();
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_NO_AUTH") showPopup("Cuma akun OSIS yang bisa hapus.", "error");
            else showPopup("Gagal hapus: " + err.message, "error");
        }
    },
};

document.addEventListener("DOMContentLoaded", () => Poster.init());
