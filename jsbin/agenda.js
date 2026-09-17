// =========================================================================
// AGENDA — admin per sekbid (folder /osis)
// Dipakai di osis/agenda — kelola agenda per sekbid
// Public view di #sekbid juga render agenda via getAgendaBySekbid
// Foto: drag & drop kayak prestasi/galeri/kegiatan (klik atau drop banyak file)
// =========================================================================

const AgendaAdmin = {
    sekbidId: null,
    editingId: null,
    cache: [],
    pendingFiles: [],   // File[] baru yang belum di-upload (buat preview lokal)
    existingFotos: [],  // {path,caption}[] foto yang udah kesimpen (pas edit)
    _previewUrls: [],   // buat revoke objectURL biar ga leak

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        // isi dropdown sekbid
        try {
            const list = await getSekbid();
            const sel = document.getElementById("pilihSekbid");
            if (sel) {
                sel.innerHTML = list.map(s => `<option value="${s.id}">${escapeHtml(s.nama)} (${s.kategori})</option>`).join("");
                if (list[0]) {
                    AgendaAdmin.sekbidId = list[0].id;
                    sel.value = list[0].id;
                }
                sel.addEventListener("change", () => {
                    AgendaAdmin.sekbidId = parseInt(sel.value, 10);
                    AgendaAdmin.muat();
                });
            }
        } catch (err) {
            console.error(err);
            showToast("Gagal load sekbid", "error");
        }

        document.getElementById("btnTambahAgenda")?.addEventListener("click", () => AgendaAdmin.bukaForm());
        document.getElementById("btnBatalAgenda")?.addEventListener("click", () => AgendaAdmin.tutupForm());
        document.getElementById("btnSimpanAgenda")?.addEventListener("click", () => AgendaAdmin.simpan());

        // popup: klik backdrop & ESC untuk tutup (kayak prestasi)
        const agendaFormEl = document.getElementById("agendaForm");
        if (agendaFormEl) {
            agendaFormEl.addEventListener("click", (e) => {
                if (e.target === agendaFormEl) AgendaAdmin.tutupForm();
            });
        }
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && document.getElementById("agendaForm")?.classList.contains("open")) {
                AgendaAdmin.tutupForm();
            }
        });

        // ——— drag & drop foto agenda (kayak prestasi/galeri) ———
        const drop = document.getElementById("agendaDrop");
        const fileInput = document.getElementById("agendaFotos");
        if (drop && fileInput) {
            drop.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", (e) => {
                AgendaAdmin.handleFiles(e.target.files);
                e.target.value = "";
            });
            ["dragenter", "dragover"].forEach(ev => {
                drop.addEventListener(ev, (e) => {
                    e.preventDefault();
                    drop.classList.add("dragover");
                });
            });
            ["dragleave", "drop"].forEach(ev => {
                drop.addEventListener(ev, (e) => {
                    e.preventDefault();
                    drop.classList.remove("dragover");
                });
            });
            drop.addEventListener("drop", (e) => {
                const files = e.dataTransfer && e.dataTransfer.files;
                if (files && files.length) AgendaAdmin.handleFiles(files);
            });
        } else {
            // fallback lama — kalo drop ga ada (jaga2)
            document.getElementById("agendaFotos")?.addEventListener("change", (e) => AgendaAdmin.preview(e.target));
        }

        AgendaAdmin.muat();
    },

    async muat() {
        const listEl = document.getElementById("agendaList");
        if (!listEl || !AgendaAdmin.sekbidId) return;
        listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat agenda...</div>`;
        try {
            const data = await getAgendaBySekbid(AgendaAdmin.sekbidId);
            AgendaAdmin.cache = data || [];
            AgendaAdmin.render();
        } catch (err) {
            console.error(err);
            listEl.innerHTML = `<div class="pesan-empty">Gagal memuat agenda.</div>`;
        }
    },

    render() {
        const listEl = document.getElementById("agendaList");
        if (!listEl) return;
        const raw = AgendaAdmin.cache || [];
        // pastikan urutan: terbaru di atas — display_order terkecil dulu (latest = min-1), tie-break tanggal & created_at terbaru dulu
        const allData = [...raw].sort((a, b) => {
            const oa = parseInt(a.display_order, 10); const ob = parseInt(b.display_order, 10);
            const va = Number.isFinite(oa) ? oa : 99; const vb = Number.isFinite(ob) ? ob : 99;
            if (va !== vb) return va - vb;
            const ta = a.tanggal ? new Date(a.tanggal).getTime() : 0;
            const tb = b.tanggal ? new Date(b.tanggal).getTime() : 0;
            if (tb !== ta) return tb - ta;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
        // kalau lagi edit, sembunyikan card yang sedang diedit biar ga keliatan duplikat
        // (popup di atas udah nampilin data yang sama + preview foto)
        const isEditing = !!(AgendaAdmin.editingId && document.getElementById("agendaForm")?.classList.contains("open"));
        const data = isEditing ? allData.filter(a => String(a.id) !== String(AgendaAdmin.editingId)) : allData;
        if (allData.length === 0) {
            listEl.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-calendar"></i> Belum ada agenda untuk sekbid ini.</div>`;
            return;
        }
        if (data.length === 0 && isEditing) {
            listEl.innerHTML = `<div class="pesan-empty" style="font-size:0.82rem;color:var(--gray)"><i class="fa-solid fa-pen"></i> Sedang mengedit — lihat form di atas.</div>`;
            return;
        }
        listEl.innerHTML = data.map(a => {
            const fotos = Array.isArray(a.fotos) ? a.fotos : [];
            const fotosHtml = fotos.length ? `<div class="agenda-fotos">${fotos.map(f => {
                const p = typeof f === "string" ? f : f.path;
                return `<img src="${getFoto(p)}" alt="" loading="lazy" onclick="Home && Home.bukaFotoPopup && Home.bukaFotoPopup(this, '${escapeHtml(a.judul).replace(/'/g, "\\'")}', '')">`;
            }).join("")}</div>` : "";
            const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "-";
            return `
                <div class="agenda-card">
                    <h4>${escapeHtml(a.judul)}</h4>
                    ${a.deskripsi ? `<p style="font-size:0.85rem; color:var(--gray); margin:4px 0 8px">${escapeHtml(a.deskripsi)}</p>` : ""}
                    <div class="agenda-meta">
                        <span><i class="fa-solid fa-calendar"></i> ${tgl}</span>
                        <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(a.lokasi || "-")}</span>
                        <span class="agenda-status ${a.status}">${a.status}</span>
                    </div>
                    ${fotosHtml}
                    <div class="agenda-actions">
                        <button class="btn btn-white btn-sm" onclick="AgendaAdmin.edit(${a.id})"><i class="fa-solid fa-pen"></i> Edit</button>
                        <button class="btn btn-red btn-sm" onclick="AgendaAdmin.hapus(${a.id})"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                    </div>
                </div>`;
        }).join("");
    },

    bukaForm() {
        AgendaAdmin.editingId = null;
        AgendaAdmin.pendingFiles = [];
        AgendaAdmin.existingFotos = [];
        AgendaAdmin._revokePreviewUrls();
        document.getElementById("agendaId").value = "";
        document.getElementById("agendaJudul").value = "";
        document.getElementById("agendaDeskripsi").value = "";
        document.getElementById("agendaTanggal").value = "";
        document.getElementById("agendaLokasi").value = "";
        document.getElementById("agendaStatus").value = "selesai";
        // otomatis ngambil urutan paling latest (latest di atas) — min display_order - 1 kayak prestasi
        let nextOrder = 1;
        const list = AgendaAdmin.cache || [];
        if (list.length > 0) {
            const minOrder = Math.min(...list.map(a => parseInt(a.display_order, 10) || 99));
            nextOrder = minOrder - 1;
            // biar latest tetap di atas walau udah 1, boleh 0 / negatif (DB allow), tapi clamp UI 1..999 kalau mau manual
        }
        document.getElementById("agendaOrder").value = String(nextOrder);
        const ft = document.getElementById("agendaFormTitle");
        if (ft) ft.textContent = "Tambah Agenda";
        const fi = document.getElementById("agendaFotos");
        if (fi) fi.value = "";
        AgendaAdmin.renderPreview();
        document.getElementById("agendaForm").classList.add("open");
        document.body.style.overflow = "hidden";
        AgendaAdmin.render();
        setTimeout(() => document.getElementById("agendaJudul")?.focus(), 80);
    },

    edit(id) {
        const item = AgendaAdmin.cache.find(a => String(a.id) === String(id));
        if (!item) return;
        AgendaAdmin.editingId = id;
        AgendaAdmin.pendingFiles = [];
        AgendaAdmin._revokePreviewUrls();
        // normalize existing fotos ke {path,caption}
        const fotos = Array.isArray(item.fotos) ? item.fotos : [];
        AgendaAdmin.existingFotos = fotos.map(f => typeof f === "string" ? { path: f, caption: "" } : { path: f.path, caption: f.caption || "" }).filter(f => f.path);
        document.getElementById("agendaId").value = id;
        document.getElementById("agendaJudul").value = item.judul || "";
        document.getElementById("agendaDeskripsi").value = item.deskripsi || "";
        document.getElementById("agendaTanggal").value = item.tanggal || "";
        document.getElementById("agendaLokasi").value = item.lokasi || "";
        document.getElementById("agendaStatus").value = item.status || "selesai";
        document.getElementById("agendaOrder").value = item.display_order || 99;
        const ft = document.getElementById("agendaFormTitle");
        if (ft) ft.textContent = "Edit Agenda";
        const fi = document.getElementById("agendaFotos");
        if (fi) fi.value = "";
        // buka form dulu baru render supaya filter editingId kepake
        document.getElementById("agendaForm").classList.add("open");
        document.body.style.overflow = "hidden";
        AgendaAdmin.renderPreview();
        AgendaAdmin.render();
        setTimeout(() => document.getElementById("agendaJudul")?.focus(), 80);
    },

    tutupForm() {
        const form = document.getElementById("agendaForm");
        if (form) form.classList.remove("open");
        document.body.style.overflow = "";
        AgendaAdmin.editingId = null;
        AgendaAdmin.pendingFiles = [];
        AgendaAdmin.existingFotos = [];
        AgendaAdmin._revokePreviewUrls();
        const pv = document.getElementById("agendaPreview");
        if (pv) { pv.innerHTML = ""; pv.style.display = "none"; }
        const fi = document.getElementById("agendaFotos");
        if (fi) fi.value = "";
        const drop = document.getElementById("agendaDrop");
        if (drop) drop.classList.remove("dragover");
        AgendaAdmin.render();
    },

    // handler baru — dipanggil dari drop & file input (support banyak file sekaligus)
    handleFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        let added = 0;
        for (const f of fileList) {
            if (!f.type || !f.type.startsWith("image/")) {
                showToast(`"${f.name}" bukan gambar`, "error");
                continue;
            }
            AgendaAdmin.pendingFiles.push(f);
            added++;
        }
        if (added > 0) AgendaAdmin.renderPreview();
    },

    // legacy: dipanggil via onchange lama (kalo ada) — forward ke handleFiles
    preview(input) {
        if (input && input.files) {
            AgendaAdmin.handleFiles(input.files);
            input.value = "";
        }
    },

    renderPreview() {
        const preview = document.getElementById("agendaPreview");
        if (!preview) return;
        // revoke url lama sebelum bikin baru
        AgendaAdmin._revokePreviewUrls();
        preview.innerHTML = "";

        const existing = AgendaAdmin.existingFotos || [];
        const pending = AgendaAdmin.pendingFiles || [];
        if (existing.length === 0 && pending.length === 0) {
            preview.style.display = "none";
            return;
        }
        preview.style.display = "flex";

        // foto existing (dari DB) — bisa dihapus sebelum simpan
        existing.forEach((f, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "agenda-preview-item";
            wrap.innerHTML = `<img src="${getFoto(f.path)}" alt=""><button type="button" class="agenda-preview-del" title="Hapus foto ini"><i class="fa-solid fa-xmark"></i></button>`;
            wrap.querySelector(".agenda-preview-del").addEventListener("click", () => AgendaAdmin.hapusExistingFoto(idx));
            preview.appendChild(wrap);
        });

        // file pending (lokal) — preview via objectURL
        pending.forEach((file, idx) => {
            if (!file.type.startsWith("image/")) return;
            const url = URL.createObjectURL(file);
            AgendaAdmin._previewUrls.push(url);
            const wrap = document.createElement("div");
            wrap.className = "agenda-preview-item";
            wrap.innerHTML = `<img src="${url}" alt=""><button type="button" class="agenda-preview-del" title="Hapus foto ini"><i class="fa-solid fa-xmark"></i></button>`;
            wrap.querySelector(".agenda-preview-del").addEventListener("click", () => AgendaAdmin.hapusPending(idx));
            preview.appendChild(wrap);
        });
    },

    hapusExistingFoto(idx) {
        AgendaAdmin.existingFotos.splice(idx, 1);
        AgendaAdmin.renderPreview();
    },

    hapusPending(idx) {
        AgendaAdmin.pendingFiles.splice(idx, 1);
        AgendaAdmin.renderPreview();
    },

    _revokePreviewUrls() {
        (AgendaAdmin._previewUrls || []).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        AgendaAdmin._previewUrls = [];
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const judul = document.getElementById("agendaJudul").value.trim();
        const deskripsi = document.getElementById("agendaDeskripsi").value.trim();
        const tanggal = document.getElementById("agendaTanggal").value || null;
        const lokasi = document.getElementById("agendaLokasi").value.trim();
        const status = document.getElementById("agendaStatus").value;
        let order = parseInt(document.getElementById("agendaOrder").value, 10);
        const id = document.getElementById("agendaId").value ? parseInt(document.getElementById("agendaId").value, 10) : null;
        if (!Number.isFinite(order)) {
            if (!id) {
                const list = AgendaAdmin.cache || [];
                order = list.length ? Math.min(...list.map(a => parseInt(a.display_order, 10) || 99)) - 1 : 1;
            } else order = 99;
        }

        if (!judul) { showToast("Judul wajib diisi", "error"); return; }
        if (!AgendaAdmin.sekbidId) { showToast("Pilih sekbid dulu", "error"); return; }

        const btn = document.getElementById("btnSimpanAgenda");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }

        try {
            // fotos akhir = existing yang masih disisain + upload pending baru
            let fotos = [...(AgendaAdmin.existingFotos || [])];
            const files = AgendaAdmin.pendingFiles || [];
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                if (!f.type.startsWith("image/")) continue;
                const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
                const path = `agenda/agenda-${u.id}-${Date.now()}-${i}.${ext}`;
                await uploadFotoStorage(f, path);
                fotos.push({ path, caption: "" });
            }

            if (id) {
                await updateAgenda(u.id, id, judul, deskripsi, tanggal, lokasi, status, fotos, order);
                showToast("Agenda diperbarui!", "success");
            } else {
                const newId = await buatAgenda(u.id, AgendaAdmin.sekbidId, judul, deskripsi, tanggal, lokasi, status, fotos, order);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Agenda ditambah!", "success");
            }
            AgendaAdmin.tutupForm();
            // reset state preview
            AgendaAdmin.pendingFiles = [];
            AgendaAdmin.existingFotos = [];
            AgendaAdmin._revokePreviewUrls();
            const fi = document.getElementById("agendaFotos");
            if (fi) fi.value = "";
            const pv = document.getElementById("agendaPreview");
            if (pv) { pv.innerHTML = ""; pv.style.display = "none"; }
            await AgendaAdmin.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const yakin = await showPopup("Hapus agenda ini? Fotonya ikut terhapus.", "confirm");
        if (!yakin) return;
        try {
            const item = AgendaAdmin.cache.find(a => String(a.id) === String(id));
            await hapusAgenda(u.id, id);
            if (item && Array.isArray(item.fotos)) {
                for (const f of item.fotos) {
                    const p = typeof f === "string" ? f : f.path;
                    if (p) try { await hapusFotoStorage(p); } catch {}
                }
            }
            showToast("Agenda dihapus", "success");
            await AgendaAdmin.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    }
};

document.addEventListener("DOMContentLoaded", () => AgendaAdmin.init());
