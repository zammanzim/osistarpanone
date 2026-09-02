// =========================================================================
// AGENDA — admin per sekbid (folder /osis)
// Dipakai di osis/agenda.html — kelola agenda per sekbid
// Public view di #sekbid juga render agenda via getAgendaBySekbid
// =========================================================================

const AgendaAdmin = {
    sekbidId: null,
    editingId: null,
    cache: [],

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login.html");
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
        document.getElementById("agendaFotos")?.addEventListener("change", (e) => AgendaAdmin.preview(e.target));

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
        const data = AgendaAdmin.cache || [];
        if (data.length === 0) {
            listEl.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-calendar"></i> Belum ada agenda untuk sekbid ini.</div>`;
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
        document.getElementById("agendaId").value = "";
        document.getElementById("agendaJudul").value = "";
        document.getElementById("agendaDeskripsi").value = "";
        document.getElementById("agendaTanggal").value = "";
        document.getElementById("agendaLokasi").value = "";
        document.getElementById("agendaStatus").value = "selesai";
        document.getElementById("agendaOrder").value = "99";
        document.getElementById("agendaFotos").value = "";
        document.getElementById("agendaPreview").innerHTML = "";
        document.getElementById("agendaPreview").style.display = "none";
        document.getElementById("agendaForm").classList.add("open");
        document.getElementById("agendaJudul").focus();
    },

    edit(id) {
        const item = AgendaAdmin.cache.find(a => String(a.id) === String(id));
        if (!item) return;
        AgendaAdmin.editingId = id;
        document.getElementById("agendaId").value = id;
        document.getElementById("agendaJudul").value = item.judul || "";
        document.getElementById("agendaDeskripsi").value = item.deskripsi || "";
        document.getElementById("agendaTanggal").value = item.tanggal || "";
        document.getElementById("agendaLokasi").value = item.lokasi || "";
        document.getElementById("agendaStatus").value = item.status || "selesai";
        document.getElementById("agendaOrder").value = item.display_order || 99;
        // preview existing fotos
        const preview = document.getElementById("agendaPreview");
        const fotos = Array.isArray(item.fotos) ? item.fotos : [];
        if (fotos.length) {
            preview.innerHTML = fotos.map(f => {
                const p = typeof f === "string" ? f : f.path;
                return `<img src="${getFoto(p)}" alt="">`;
            }).join("");
            preview.style.display = "flex";
        } else {
            preview.innerHTML = "";
            preview.style.display = "none";
        }
        document.getElementById("agendaForm").classList.add("open");
        document.getElementById("agendaJudul").focus();
        window.scrollTo({ top: 0, behavior: "smooth" });
    },

    tutupForm() {
        document.getElementById("agendaForm").classList.remove("open");
        AgendaAdmin.editingId = null;
    },

    preview(input) {
        const preview = document.getElementById("agendaPreview");
        if (!preview) return;
        preview.innerHTML = "";
        const files = input.files || [];
        if (files.length === 0) { preview.style.display = "none"; return; }
        preview.style.display = "flex";
        [...files].forEach(f => {
            if (!f.type.startsWith("image/")) return;
            const url = URL.createObjectURL(f);
            const img = document.createElement("img");
            img.src = url;
            preview.appendChild(img);
        });
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        const judul = document.getElementById("agendaJudul").value.trim();
        const deskripsi = document.getElementById("agendaDeskripsi").value.trim();
        const tanggal = document.getElementById("agendaTanggal").value || null;
        const lokasi = document.getElementById("agendaLokasi").value.trim();
        const status = document.getElementById("agendaStatus").value;
        const order = parseInt(document.getElementById("agendaOrder").value, 10) || 99;
        const id = document.getElementById("agendaId").value ? parseInt(document.getElementById("agendaId").value, 10) : null;

        if (!judul) { showToast("Judul wajib diisi", "error"); return; }
        if (!AgendaAdmin.sekbidId) { showToast("Pilih sekbid dulu", "error"); return; }

        const btn = document.getElementById("btnSimpanAgenda");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }

        try {
            // kumpulkan foto baru
            const fileInput = document.getElementById("agendaFotos");
            const files = fileInput ? [...(fileInput.files || [])] : [];
            let fotos = [];
            // kalau edit, ambil fotos lama dulu
            if (id) {
                const existing = AgendaAdmin.cache.find(a => String(a.id) === String(id));
                if (existing && Array.isArray(existing.fotos)) fotos = [...existing.fotos];
            }
            // upload file baru
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
