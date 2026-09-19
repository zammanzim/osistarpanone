// =========================================================================
// AGENDA — admin per sekbid (folder /osis)
// Dipakai di osis/agenda — kelola agenda per sekbid
// Public view di #sekbid juga render agenda via getAgendaBySekbid
// Foto: drag & drop kayak prestasi/galeri/kegiatan (klik atau drop banyak file)
// =========================================================================

const AgendaAdmin = {
    sekbidId: null, // null = semua sekbid (filter)
    tab: "sekbid", // "sekbid" | "orang"
    editingId: null,
    cache: [],
    sekbidList: [],
    pendingFiles: [],   // File[] baru yang belum di-upload (buat preview lokal)
    existingFotos: [],  // {path,caption}[] foto yang udah kesimpen (pas edit)
    _previewUrls: [],   // buat revoke objectURL biar ga leak

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        // isi dropdown sekbid (filter) + dropdown sekbid di form
        try {
            const list = await getSekbid();
            AgendaAdmin.sekbidList = list || [];
            const sel = document.getElementById("pilihSekbid");
            if (sel) {
                sel.innerHTML = `<option value="">Semua Sekbid</option>` + AgendaAdmin.sekbidList.map(s => `<option value="${s.id}">${escapeHtml(s.nama)} (${s.kategori})</option>`).join("");
                sel.value = "";
                sel.addEventListener("change", () => {
                    const v = sel.value;
                    AgendaAdmin.sekbidId = v ? parseInt(v, 10) : null;
                    AgendaAdmin.render();
                });
            }
            AgendaAdmin.isiOpsiSekbidForm(null);
        } catch (err) {
            console.error(err);
            showToast("Gagal load sekbid", "error");
        }

        // tab tipe: per sekbid / per orang
        document.querySelectorAll("#agendaTabs .atab").forEach(b => {
            b.addEventListener("click", () => AgendaAdmin.gantiTab(b.dataset.atab));
        });

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
        if (listEl) listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat agenda...</div>`;
        try {
            const data = await getAllAgenda();
            AgendaAdmin.cache = data || [];
            AgendaAdmin.refreshDatalist();
            AgendaAdmin.render();
        } catch (err) {
            console.error(err);
            if (listEl) listEl.innerHTML = `<div class="pesan-empty">Gagal memuat agenda.</div>`;
        }
    },

    gantiTab(tab) {
        AgendaAdmin.tab = tab === "orang" ? "orang" : "sekbid";
        document.querySelectorAll("#agendaTabs .atab").forEach(b =>
            b.classList.toggle("active", b.dataset.atab === AgendaAdmin.tab));
        AgendaAdmin.render();
    },

    // Opsi sekbid di dalam form (terpisah dari filter toolbar)
    isiOpsiSekbidForm(terpilih) {
        const sel = document.getElementById("agendaSekbid");
        if (!sel) return;
        const list = AgendaAdmin.sekbidList || [];
        sel.innerHTML = list.map(s => `<option value="${s.id}">${escapeHtml(s.nama)} (${s.kategori})</option>`).join("");
        if (terpilih) sel.value = String(terpilih);
        else if (AgendaAdmin.sekbidId) sel.value = String(AgendaAdmin.sekbidId);
        else if (list[0]) sel.value = String(list[0].id);
    },

    // Saran nama pelaksana: dari anggota + nama yang pernah dipakai
    async refreshDatalist() {
        try {
            const agg = await getAnggota().catch(() => []);
            const setNama = new Set();
            (agg || []).forEach(a => { if (a.nama) setNama.add(String(a.nama).trim()); });
            (AgendaAdmin.cache || []).forEach(a => {
                const p = String(a.pelaksana || "").trim();
                if (p) setNama.add(p);
            });
            const dl = document.getElementById("pelaksanaList");
            if (dl) dl.innerHTML = [...setNama].sort().map(n => `<option value="${escapeHtml(n)}">`).join("");
        } catch {}
    },

    namaSekbid(id) {
        const s = (AgendaAdmin.sekbidList || []).find(x => String(x.id) === String(id));
        return s ? s.nama : "Sekbid";
    },

    // Kunci grup per orang (case-insensitive biar "Nizam" & "nizam" nyatu)
    kunciOrang(a) {
        const p = String(a.pelaksana || "").trim();
        return p ? p.toLowerCase() : "";
    },

    labelOrang(key) {
        if (!key) return "Tanpa pelaksana";
        const item = (AgendaAdmin.cache || []).find(a => AgendaAdmin.kunciOrang(a) === key);
        return item ? String(item.pelaksana).trim() : key;
    },

    // Urutan kartu: display_order terkecil dulu, tie-break tanggal & created_at terbaru
    urutkan(list) {
        return [...(list || [])].sort((a, b) => {
            const oa = parseInt(a.display_order, 10); const ob = parseInt(b.display_order, 10);
            const va = Number.isFinite(oa) ? oa : 99; const vb = Number.isFinite(ob) ? ob : 99;
            if (va !== vb) return va - vb;
            const ta = a.tanggal ? new Date(a.tanggal).getTime() : 0;
            const tb = b.tanggal ? new Date(b.tanggal).getTime() : 0;
            if (tb !== ta) return tb - ta;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
    },

    kartu(a, tampilSekbid) {
        const fotos = Array.isArray(a.fotos) ? a.fotos : [];
        const fotosHtml = fotos.length ? `<div class="agenda-fotos">${fotos.map(f => {
            const p = typeof f === "string" ? f : f.path;
            return `<img src="${getFoto(p)}" alt="" loading="lazy" onclick="Home && Home.bukaFotoPopup && Home.bukaFotoPopup(this, '${escapeHtml(a.judul).replace(/'/g, "\\'")}', '')">`;
        }).join("")}</div>` : "";
        const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "-";
        const pel = String(a.pelaksana || "").trim();
        return `
            <div class="agenda-card">
                ${tampilSekbid ? `<span class="agenda-sekbid-tag"><i class="fa-solid fa-folder-open"></i> ${escapeHtml(AgendaAdmin.namaSekbid(a.sekbid_id))}</span>` : ""}
                <h4>${escapeHtml(a.judul)}</h4>
                <div class="agenda-pelaksana"><i class="fa-solid fa-user"></i> ${escapeHtml(pel || "Tanpa pelaksana")}</div>
                ${a.deskripsi ? `<p style="font-size:0.85rem; color:var(--gray); margin:4px 0 8px">${escapeHtml(a.deskripsi)}</p>` : ""}
                <div class="agenda-meta">
                    <span><i class="fa-solid fa-calendar"></i> ${tgl}</span>
                    <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(a.lokasi || "-")}</span>
                </div>
                ${fotosHtml}
                <div class="agenda-actions">
                    <button class="btn btn-white btn-sm" onclick="AgendaAdmin.edit(${a.id})"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn btn-red btn-sm" onclick="AgendaAdmin.hapus(${a.id})"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                </div>
            </div>`;
    },

    render() {
        const listEl = document.getElementById("agendaList");
        if (!listEl) return;
        const semua = AgendaAdmin.cache || [];
        // Filter sekbid (toolbar)
        const basis = AgendaAdmin.sekbidId
            ? semua.filter(a => String(a.sekbid_id) === String(AgendaAdmin.sekbidId))
            : semua;
        // Statistik: total, bulan ini, sekbid aktif, orang terlibat
        const now = new Date();
        const blnIni = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
        const nBulan = basis.filter(a => (a.tanggal || "").slice(0, 7) === blnIni).length;
        const nSekbid = new Set(basis.map(a => String(a.sekbid_id))).size;
        const nOrang = new Set(basis.map(a => AgendaAdmin.kunciOrang(a)).filter(k => k !== "")).size;
        const statsEl = document.getElementById("agendaStats");
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="astat total"><b>${basis.length}</b><span>Total</span></div>
                <div class="astat bulan"><b>${nBulan}</b><span>Bulan ini</span></div>
                <div class="astat sekbid"><b>${nSekbid}</b><span>Sekbid</span></div>
                <div class="astat orang"><b>${nOrang}</b><span>Orang</span></div>`;
        }
        // Kalau lagi edit, sembunyikan card yang sedang diedit biar ga keliatan duplikat
        const isEditing = !!(AgendaAdmin.editingId && document.getElementById("agendaForm")?.classList.contains("open"));
        const tampil = isEditing ? basis.filter(a => String(a.id) !== String(AgendaAdmin.editingId)) : basis;

        if (AgendaAdmin.tab === "orang") {
            listEl.innerHTML = AgendaAdmin.renderOrang(tampil, isEditing);
        } else {
            listEl.innerHTML = AgendaAdmin.renderSekbid(tampil, isEditing);
        }
    },

    // ===== TIPE 1: PER SEKBID (per orang otomatis masuk ke sekbidnya) =====
    renderSekbid(tampil, isEditing) {
        const urut = AgendaAdmin.urutkan(tampil);
        let grupSekbid = AgendaAdmin.sekbidList || [];
        if (AgendaAdmin.sekbidId) {
            grupSekbid = grupSekbid.filter(s => String(s.id) === String(AgendaAdmin.sekbidId));
        }
        // Sekbid yang punya agenda tapi tidak ada di list (misal sudah dihapus) tetap tampil
        const idDikenal = new Set(grupSekbid.map(s => String(s.id)));
        const yatim = urut.filter(a => !idDikenal.has(String(a.sekbid_id)));
        if (!grupSekbid.length && !yatim.length) {
            if (isEditing) return `<div class="pesan-empty" style="font-size:0.82rem;color:var(--gray)"><i class="fa-solid fa-pen"></i> Sedang mengedit — lihat form di atas.</div>`;
            return `<div class="pesan-empty"><i class="fa-solid fa-calendar"></i> Belum ada agenda.</div>`;
        }
        let html = "";
        grupSekbid.forEach(s => {
            const isi = urut.filter(a => String(a.sekbid_id) === String(s.id));
            if (!isi.length) return;
            // Ringkasan per orang di sekbid ini (biar adil kelihatan siapa ngerjain apa)
            const perOrang = {};
            isi.forEach(a => {
                const k = AgendaAdmin.kunciOrang(a);
                perOrang[k] = perOrang[k] || { nama: AgendaAdmin.labelOrang(k), jum: 0 };
                perOrang[k].jum++;
            });
            const chips = Object.values(perOrang)
                .sort((x, y) => y.jum - x.jum)
                .map(o => `<span class="pchip">${escapeHtml(o.nama)} <b>×${o.jum}</b></span>`).join("");
            html += `
                <div class="agenda-grup">
                    <div class="agenda-grup-head">
                        <h3>${escapeHtml(s.nama)}</h3>
                        <span class="agenda-grup-count">${isi.length} agenda</span>
                    </div>
                    <div class="pelaksana-chips">${chips}</div>
                    <div class="agenda-grid">${isi.map(a => AgendaAdmin.kartu(a, false)).join("")}</div>
                </div>`;
        });
        if (yatim.length) {
            html += `
                <div class="agenda-grup">
                    <div class="agenda-grup-head">
                        <h3>Sekbid lain</h3>
                        <span class="agenda-grup-count">${yatim.length} agenda</span>
                    </div>
                    <div class="agenda-grid">${yatim.map(a => AgendaAdmin.kartu(a, false)).join("")}</div>
                </div>`;
        }
        if (!html && isEditing) {
            return `<div class="pesan-empty" style="font-size:0.82rem;color:var(--gray)"><i class="fa-solid fa-pen"></i> Sedang mengedit — lihat form di atas.</div>`;
        }
        return html;
    },

    // ===== TIPE 2: PER ORANG + podium =====
    renderOrang(tampil, isEditing) {
        const urut = AgendaAdmin.urutkan(tampil);
        if (!urut.length) {
            if (isEditing) return `<div class="pesan-empty" style="font-size:0.82rem;color:var(--gray)"><i class="fa-solid fa-pen"></i> Sedang mengedit — lihat form di atas.</div>`;
            return `<div class="pesan-empty"><i class="fa-solid fa-user"></i> Belum ada agenda per orang.</div>`;
        }
        const grup = {};
        urut.forEach(a => {
            const k = AgendaAdmin.kunciOrang(a);
            grup[k] = grup[k] || { nama: AgendaAdmin.labelOrang(k), items: [], sekbid: new Set() };
            grup[k].items.push(a);
            grup[k].sekbid.add(String(a.sekbid_id));
        });
        const ranking = Object.entries(grup).map(([key, g]) => ({ key, nama: g.nama, items: g.items, nSekbid: g.sekbid.size }))
            .sort((x, y) => (y.items.length - x.items.length) || x.nama.localeCompare(y.nama));
        // Podium: 3 teratas yang ada namanya (tanpa pelaksana tidak ikut podium)
        const podium = ranking.filter(r => r.key !== "").slice(0, 3);
        const medal = [
            '<span class="podium-medal">🥇</span>',
            '<span class="podium-medal">🥈</span>',
            '<span class="podium-medal">🥉</span>'
        ];
        let html = "";
        if (podium.length) {
            html += `<div class="podium">` + podium.map((r, i) => `
                <div class="podium-card${i === 0 ? " juara1" : ""}">
                    ${medal[i]}
                    <b>${escapeHtml(r.nama)}</b>
                    <span>${r.nSekbid} sekbid</span><br>
                    <span class="podium-total">${r.items.length} agenda</span>
                </div>`).join("") + `</div>`;
        }
        // Grup tanpa pelaksana selalu paling bawah
        ranking.sort((x, y) => {
            if (x.key === "" && y.key !== "") return 1;
            if (y.key === "" && x.key !== "") return -1;
            return (y.items.length - x.items.length) || x.nama.localeCompare(y.nama);
        });
        html += ranking.map(r => `
            <div class="agenda-grup">
                <div class="agenda-grup-head">
                    <h3><i class="fa-solid fa-user" style="color:var(--red)"></i> ${escapeHtml(r.nama)}</h3>
                    <span class="agenda-grup-count">${r.items.length} agenda</span>
                </div>
                <div class="agenda-grid">${r.items.map(a => AgendaAdmin.kartu(a, true)).join("")}</div>
            </div>`).join("");
        return html;
    },

    bukaForm() {
        AgendaAdmin.editingId = null;
        AgendaAdmin.pendingFiles = [];
        AgendaAdmin.existingFotos = [];
        AgendaAdmin._revokePreviewUrls();
        document.getElementById("agendaId").value = "";
        AgendaAdmin.isiOpsiSekbidForm(null);
        document.getElementById("agendaJudul").value = "";
        document.getElementById("agendaDeskripsi").value = "";
        document.getElementById("agendaTanggal").value = "";
        document.getElementById("agendaLokasi").value = "";
        document.getElementById("agendaPelaksana").value = "";
        // otomatis ngambil urutan paling latest (latest di atas) — min display_order - 1 kayak prestasi
        // (dihitung dalam sekbid yang dipilih di form)
        const sidForm = document.getElementById("agendaSekbid")?.value;
        let nextOrder = 1;
        const list = (AgendaAdmin.cache || []).filter(a => !sidForm || String(a.sekbid_id) === String(sidForm));
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
        AgendaAdmin.isiOpsiSekbidForm(item.sekbid_id);
        document.getElementById("agendaJudul").value = item.judul || "";
        document.getElementById("agendaDeskripsi").value = item.deskripsi || "";
        document.getElementById("agendaTanggal").value = item.tanggal || "";
        document.getElementById("agendaLokasi").value = item.lokasi || "";
        document.getElementById("agendaPelaksana").value = item.pelaksana || "";
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
        const sekbidForm = document.getElementById("agendaSekbid")?.value;
        const sekbidId = sekbidForm ? parseInt(sekbidForm, 10) : null;
        const judul = document.getElementById("agendaJudul").value.trim();
        const deskripsi = document.getElementById("agendaDeskripsi").value.trim();
        const tanggal = document.getElementById("agendaTanggal").value || null;
        const lokasi = document.getElementById("agendaLokasi").value.trim();
        // Agenda di sini = kegiatan yang sudah dilaksanakan, status selalu selesai
        const status = "selesai";
        const pelaksana = document.getElementById("agendaPelaksana")?.value.trim() || "";
        let order = parseInt(document.getElementById("agendaOrder").value, 10);
        const id = document.getElementById("agendaId").value ? parseInt(document.getElementById("agendaId").value, 10) : null;
        if (!Number.isFinite(order)) {
            if (!id) {
                const list = (AgendaAdmin.cache || []).filter(a => !sekbidId || String(a.sekbid_id) === String(sekbidId));
                order = list.length ? Math.min(...list.map(a => parseInt(a.display_order, 10) || 99)) - 1 : 1;
            } else order = 99;
        }

        if (!judul) { showToast("Judul wajib diisi", "error"); return; }
        if (!sekbidId) { showToast("Pilih sekbid dulu", "error"); return; }
        const __spec = () => ({ modul: "agenda", op: id ? "update" : "create",
            label: "Agenda: " + String(judul).slice(0, 42),
            payload: { id: id || null, sekbid_id: sekbidId, judul, deskripsi, tanggal, lokasi,
                status, pelaksana, order, fotosExisting: [...(AgendaAdmin.existingFotos || [])] },
            files: (AgendaAdmin.pendingFiles || []).filter(fl => fl.type && fl.type.startsWith("image/"))
                .map((fl, i) => ({ slot: "foto" + i, file: fl, name: fl.name, type: fl.type })),
            cacheKeys: ["agenda_all", "agenda_*"] });
        const __sesudahAntre = () => {
            AgendaAdmin.tutupForm();
            AgendaAdmin.pendingFiles = [];
            AgendaAdmin.existingFotos = [];
            AgendaAdmin._revokePreviewUrls();
            const fi = document.getElementById("agendaFotos");
            if (fi) fi.value = "";
            const pv = document.getElementById("agendaPreview");
            if (pv) { pv.innerHTML = ""; pv.style.display = "none"; }
        };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
            return;
        }

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
                await updateAgenda(u.id, id, judul, deskripsi, tanggal, lokasi, status, fotos, order, pelaksana);
                showToast("Agenda diperbarui!", "success");
            } else {
                const newId = await buatAgenda(u.id, sekbidId, judul, deskripsi, tanggal, lokasi, status, fotos, order, pelaksana);
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
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
                Outbox.sesudahAntre(__sesudahAntre);
                return;
            }
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
