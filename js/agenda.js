// =========================================================================
// AGENDA — admin per sekbid (folder /osis)
// Dipakai di osis/agenda — kelola agenda per sekbid
// Public view di #sekbid juga render agenda via getAgendaBySekbid
// Foto: drag & drop kayak prestasi/galeri/kegiatan (klik atau drop banyak file)
// =========================================================================

const AgendaAdmin = {
    filterSekbid: null, // sekbid yang sedang ditampilkan (satu aja, bisa diganti)
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
        // Segarkan hak kendali (biar perubahan akses langsung berlaku)
        try { await OsisAuth.refreshAkses(); } catch {}
        // Muat daftar sekbid + pasang filter (satu sekbid aja, bisa diganti).
        // Default: sekbid sendiri; yang belum diset fallback ke ketua/BPH.
        // Offline: pakai cache sekbid biar filter tetap jalan.
        let list = null;
        try {
            list = await getSekbid();
            if (list) Cache.set("sekbid", list);
        } catch (err) {
            console.error(err);
            list = Cache.get("sekbid");
            if (!list) showToast("Offline dan daftar sekbid belum tersimpan.", "error");
        }
        if (list) {
            AgendaAdmin.sekbidList = list || [];
            const sel = document.getElementById("pilihSekbid");
            if (sel) {
                sel.innerHTML = AgendaAdmin.sekbidList.map(s => `<option value="${s.id}">${escapeHtml(s.nama)} (${s.kategori})</option>`).join("");
                sel.value = String(AgendaAdmin.defaultFilter() || "");
                AgendaAdmin.filterSekbid = sel.value ? parseInt(sel.value, 10) : null;
                sel.addEventListener("change", () => {
                    const v = sel.value;
                    AgendaAdmin.filterSekbid = v ? parseInt(v, 10) : null;
                    AgendaAdmin.render();
                });
            }
            AgendaAdmin.isiOpsiSekbidForm(null);
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
        AgendaAdmin.terapkanAkses();
    },

    // Pengendali agenda global (super / mapping eksplisit 'agenda').
    bisaGlobal() {
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        if (!u || u.mode !== "osis" || !a) return false;
        if (a.super) return true;
        const list = Array.isArray(a.halaman) ? a.halaman : [];
        return list.includes("agenda") || list.includes("*");
    },

    // Boleh kendali agenda sekbid ini? (cermin aturan server osis_bisa_agenda)
    bisaKendali(sekbidId) {
        if (AgendaAdmin.bisaGlobal()) return true;
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        if (!a || !a.sekbid_id || !sekbidId) return false;
        return String(a.sekbid_id) === String(sekbidId);
    },

    // Sekbid milik user yang login (null = belum diset / global).
    sekbidSaya() {
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        if (!a || !a.sekbid_id) return null;
        return parseInt(a.sekbid_id, 10) || null;
    },

    // Default filter: sekbid sendiri; yang belum diset fallback ke ketua/BPH.
    defaultFilter() {
        const saya = AgendaAdmin.sekbidSaya();
        if (saya) return saya;
        const list = AgendaAdmin.sekbidList || [];
        const ketua = list.find(s => /ketua/i.test(s.nama || "") || /bph/i.test(s.kategori || ""));
        if (ketua) return ketua.id;
        return list[0] ? list[0].id : null;
    },

    // Tombol tambah tampil kalau bisa isi: global ATAU punya sekbid sendiri.
    // Filter boleh diganti siapa aja (cuma tampilan); isi tetap ikut sekbid masing-masing.
    terapkanAkses() {
        const bolehIsi = AgendaAdmin.bisaGlobal() || !!AgendaAdmin.sekbidSaya();
        const btn = document.getElementById("btnTambahAgenda");
        if (btn) btn.style.display = bolehIsi ? "" : "none";
        const sel = document.getElementById("pilihSekbid");
        if (sel && AgendaAdmin.filterSekbid) sel.value = String(AgendaAdmin.filterSekbid);
        AgendaAdmin.render();
    },

    async muat() {
        const listEl = document.getElementById("agendaList");
        // Render cache DULU biar offline langsung tampil.
        const cached = Cache.get("agenda_all");
        if (cached) {
            AgendaAdmin.cache = cached || [];
            try { AgendaAdmin.render(); } catch {}
        } else if (listEl) {
            listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat agenda...</div>`;
        }
        try {
            const data = await getAllAgenda();
            if (JSON.stringify(data) !== JSON.stringify(cached)) {
                Cache.set("agenda_all", data);
                AgendaAdmin.cache = data || [];
                AgendaAdmin.render();
            }
        } catch (err) {
            console.error(err);
            if (!cached && listEl) listEl.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-cloud"></i> Offline dan belum ada data tersimpan. Buka halaman ini sekali saat online.</div>`;
        }
    },

    gantiTab(tab) {
        AgendaAdmin.tab = tab === "orang" ? "orang" : "sekbid";
        document.querySelectorAll("#agendaTabs .atab").forEach(b =>
            b.classList.toggle("active", b.dataset.atab === AgendaAdmin.tab));
        AgendaAdmin.render();
    },

    // Dropdown sekbid di form CUMA untuk pengendali global (super/mapping).
    // User biasa tidak memilih: otomatis sekbid miliknya (field disembunyikan).
    isiOpsiSekbidForm(terpilih) {
        const sel = document.getElementById("agendaSekbid");
        if (!sel) return;
        const global = AgendaAdmin.bisaGlobal();
        const saya = AgendaAdmin.sekbidSaya();
        const field = sel.closest ? sel.closest(".field") : null;
        if (field) field.style.display = global ? "" : "none";
        sel.disabled = !global;
        if (!global && saya) {
            sel.innerHTML = `<option value="${saya}">${escapeHtml(AgendaAdmin.namaSekbid(saya))}</option>`;
            sel.value = String(saya);
            return;
        }
        const list = AgendaAdmin.sekbidList || [];
        sel.innerHTML = list.map(s => `<option value="${s.id}">${escapeHtml(s.nama)} (${s.kategori})</option>`).join("");
        if (terpilih) sel.value = String(terpilih);
        else if (AgendaAdmin.filterSekbid) sel.value = String(AgendaAdmin.filterSekbid);
        else if (list[0]) sel.value = String(list[0].id);
    },

    // Opsi pelaksana: "Saya sendiri" (nama user login) atau
    // "Seluruh anggota sekbid" (kerja bareng satu sekbid).
    // Bukan teks bebas biar tidak typo / nama ganda.
    isiOpsiPelaksana(terpilih) {
        const sel = document.getElementById("agendaPelaksana");
        if (!sel) return null;
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        const saya = (((typeof OsisAuth !== "undefined" && typeof OsisAuth.displayName === "function") ? OsisAuth.displayName(u) : "") || (u && (u.nama || u.username)) || "").trim() || "Saya";
        // Sekbid acuan label: global = pilihan form, sisanya milik sendiri
        let sidTarget = null;
        if (AgendaAdmin.bisaGlobal()) {
            const v = document.getElementById("agendaSekbid")?.value;
            sidTarget = v ? parseInt(v, 10) : null;
        } else {
            sidTarget = AgendaAdmin.sekbidSaya();
        }
        const namaSek = sidTarget ? AgendaAdmin.namaSekbid(sidTarget) : "";
        const semua = namaSek ? `Sekbid ${namaSek}` : "Seluruh anggota sekbid";
        sel.innerHTML =
            `<option value="${escapeHtml(saya)}">Saya sendiri — ${escapeHtml(saya)}</option>` +
            `<option value="${escapeHtml(semua)}">Seluruh anggota${namaSek ? " — " + escapeHtml(namaSek) : ""}</option>`;
        if (terpilih && terpilih !== saya && terpilih !== semua) {
            // Data lama (teks bebas): tampilkan apa adanya biar tidak hilang
            const op = document.createElement("option");
            op.value = terpilih;
            op.textContent = terpilih;
            sel.appendChild(op);
            sel.value = terpilih;
        } else {
            // Default: seluruh anggota sekbid
            sel.value = terpilih || semua;
        }
        return { saya, semua };
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
                ${AgendaAdmin.bisaKendali(a.sekbid_id) ? `<div class="agenda-actions">
                    <button class="btn btn-white btn-sm" onclick="AgendaAdmin.edit(${a.id})"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn btn-red btn-sm" onclick="AgendaAdmin.hapus(${a.id})"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                </div>` : ""}
            </div>`;
    },

    render() {
        const listEl = document.getElementById("agendaList");
        if (!listEl) return;
        const semua = AgendaAdmin.cache || [];
        // Tampil satu sekbid aja sesuai filter (bisa diganti siapa aja).
        const basis = AgendaAdmin.filterSekbid
            ? semua.filter(a => String(a.sekbid_id) === String(AgendaAdmin.filterSekbid))
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
        if (AgendaAdmin.filterSekbid) {
            grupSekbid = grupSekbid.filter(s => String(s.id) === String(AgendaAdmin.filterSekbid));
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
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        AgendaAdmin.editingId = null;
        AgendaAdmin.pendingFiles = [];
        AgendaAdmin.existingFotos = [];
        AgendaAdmin._revokePreviewUrls();
        document.getElementById("agendaId").value = "";
        AgendaAdmin.isiOpsiSekbidForm(null);
        // Sekbid tujuan: global = pilihan form, sisanya otomatis sekbid sendiri.
        // TIDAK ada dropdown pilih sekbid buat user biasa (field disembunyikan).
        const sidAwal = AgendaAdmin.bisaGlobal()
            ? (document.getElementById("agendaSekbid")?.value || null)
            : AgendaAdmin.sekbidSaya();
        if (!AgendaAdmin.bisaKendali(sidAwal)) {
            if (typeof showToast === "function") showToast("Akunmu belum diset sekbid — hubungi admin.", "error");
            return;
        }
        document.getElementById("agendaJudul").value = "";
        document.getElementById("agendaDeskripsi").value = "";
        // Tanggal otomatis hari ini (lokal, bukan UTC biar tidak mundur sehari)
        const _t = new Date();
        document.getElementById("agendaTanggal").value =
            `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, "0")}-${String(_t.getDate()).padStart(2, "0")}`;
        document.getElementById("agendaLokasi").value = "";
        AgendaAdmin.isiOpsiPelaksana(null);
        // otomatis ngambil urutan paling latest (latest di atas) — min display_order - 1 kayak prestasi
        // (dihitung dalam sekbid tujuan)
        const sidForm = AgendaAdmin.bisaGlobal()
            ? (document.getElementById("agendaSekbid")?.value || null)
            : AgendaAdmin.sekbidSaya();
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
        if (!AgendaAdmin.bisaKendali(item.sekbid_id)) {
            if (typeof showToast === "function") showToast("Kamu tidak punya kendali atas sekbid ini.", "error");
            return;
        }
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
        AgendaAdmin.isiOpsiPelaksana(item.pelaksana || "");
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
        // Sekbid tujuan: global = pilihan form (boleh pindah saat edit),
        // sisanya OTOMATIS sekbid sendiri. User biasa tidak memilih apa-apa.
        const id = document.getElementById("agendaId").value ? parseInt(document.getElementById("agendaId").value, 10) : null;
        let sekbidId = null;
        const itemEdit = id ? AgendaAdmin.cache.find(a => String(a.id) === String(id)) : null;
        if (AgendaAdmin.bisaGlobal()) {
            const v = document.getElementById("agendaSekbid")?.value;
            sekbidId = v ? parseInt(v, 10) : (itemEdit ? parseInt(itemEdit.sekbid_id, 10) : null);
        } else if (id) {
            sekbidId = itemEdit ? parseInt(itemEdit.sekbid_id, 10) : null;
        } else {
            sekbidId = AgendaAdmin.sekbidSaya();
        }
        const judul = document.getElementById("agendaJudul").value.trim();
        const deskripsi = document.getElementById("agendaDeskripsi").value.trim();
        const tanggal = document.getElementById("agendaTanggal").value || null;
        const lokasi = document.getElementById("agendaLokasi").value.trim();
        // Agenda di sini = kegiatan yang sudah dilaksanakan, status selalu selesai
        const status = "selesai";
        const pelaksana = document.getElementById("agendaPelaksana")?.value.trim() || "";
        let order = parseInt(document.getElementById("agendaOrder").value, 10);
        if (!Number.isFinite(order)) {
            if (!id) {
                const list = (AgendaAdmin.cache || []).filter(a => !sekbidId || String(a.sekbid_id) === String(sekbidId));
                order = list.length ? Math.min(...list.map(a => parseInt(a.display_order, 10) || 99)) - 1 : 1;
            } else order = 99;
        }

        if (!judul) { showToast("Judul wajib diisi", "error"); return; }
        if (!pelaksana) { showToast("Pilih pelaksana dulu", "error"); return; }
        if (!sekbidId) { showToast("Akunmu belum diset sekbid — hubungi admin.", "error"); return; }
        if (!AgendaAdmin.bisaKendali(sekbidId)) {
            showToast("Kamu tidak punya kendali atas sekbid ini.", "error");
            return;
        }

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
        const item0 = AgendaAdmin.cache.find(a => String(a.id) === String(id));
        if (item0 && !AgendaAdmin.bisaKendali(item0.sekbid_id)) {
            showPopup("Kamu tidak punya kendali atas sekbid ini.", "error");
            return;
        }
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
