// =========================================================================
// AGENDA — admin per sekbid (folder /osis)
// Dipakai di osis/agenda — kelola agenda per sekbid
// Public view di #sekbid juga render agenda via getAgendaBySekbid
// Foto: drag & drop kayak prestasi/galeri/kegiatan (klik atau drop banyak file)
// =========================================================================

const AgendaAdmin = {
    filterSekbid: null, // sekbid yang sedang ditampilkan (null = semua)
    filterNama: null,   // filter pengunggah (nama dari osis_users), null = semua
    filterQ: "",        // pencarian lokal pada data yang sudah termuat
    filterFoto: false,  // true = hanya agenda yang punya foto
    viewMode: "grid",   // "grid" (bento multi-kolom) | "list" (padat)
    editingId: null,
    detailId: null,
    detailIdx: 0,
    cache: [],
    // Paging hemat egress: 18/halaman (kelipatan 2 & 3 untuk grid) + sentinel.
    // Cache persisten "agenda_all" HANYA ditulis pas habis (lengkap) — dipakai
    // juga keuangan.js buat lookup, jangan keracunan data parsial.
    offset: 0,
    habis: false,
    loading: false,
    ulang: false, // ada muat() yang ketahan pas loading -> ulang sekali lagi
    perPage: 18,
    ringkas: null, // angka statistik dari server (benar walau belum scroll habis)
    sekbidList: [],
    namaList: [],       // daftar pengurus [{nama, sekbid_id}] buat filter nama
    pendingFiles: [],   // File[] baru yang belum di-upload (buat preview lokal)
    existingFotos: [],  // {path,caption}[] foto yang udah kesimpen (pas edit)
    _previewUrls: [],   // buat revoke objectURL biar ga leak

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        try {
            const savedView = localStorage.getItem("agenda_view_mode");
            if (savedView === "list" || savedView === "grid") AgendaAdmin.viewMode = savedView;
        } catch {}
        AgendaAdmin.syncViewButtons();

        const sel = document.getElementById("pilihSekbid");
        if (sel) {
            sel.addEventListener("change", () => AgendaAdmin.pilihSekbid(sel.value));
        }
        const selNama = document.getElementById("pilihNama");
        if (selNama) {
            selNama.addEventListener("change", () => {
                const v = selNama.value || null;
                AgendaAdmin.filterNama = v;
                // Aturan: "Semua nama" → semua sekbid; pilih orang → sekbid orang itu.
                const selSb = document.getElementById("pilihSekbid");
                if (!v) {
                    AgendaAdmin.filterSekbid = null;
                    if (selSb) selSb.value = "";
                } else {
                    const row = (AgendaAdmin.namaList || []).find(x => x.nama === v);
                    const sb = row && row.sekbid_id ? parseInt(row.sekbid_id, 10) : null;
                    if (sb) {
                        AgendaAdmin.filterSekbid = sb;
                        if (selSb) selSb.value = String(sb);
                    }
                }
                AgendaAdmin.renderSekbidRail();
                AgendaAdmin.segarkanDropdown();
                AgendaAdmin.muat(true);
            });
        }

        const isiSekbidUi = (list, setDefault) => {
            if (!Array.isArray(list) || !list.length) return;
            AgendaAdmin.sekbidList = list;
            if (sel) {
                sel.innerHTML = `<option value="">Semua sekbid</option>` + AgendaAdmin.sekbidList.map(s => `<option value="${s.id}">${escapeHtml(s.nama)} (${s.kategori})</option>`).join("");
                if (setDefault) {
                    sel.value = AgendaAdmin.superSaya() ? "" : String(AgendaAdmin.defaultFilter() || "");
                    AgendaAdmin.filterSekbid = sel.value ? parseInt(sel.value, 10) : null;
                } else {
                    sel.value = AgendaAdmin.filterSekbid ? String(AgendaAdmin.filterSekbid) : "";
                }
            }
            AgendaAdmin.renderSekbidRail();
            AgendaAdmin.isiOpsiSekbidForm(null);
            AgendaAdmin.segarkanDropdown();
        };

        const isiNamaUi = (list, setDefault) => {
            if (!Array.isArray(list)) return;
            AgendaAdmin.namaList = list;
            if (!selNama) return;
            const grup = {};
            (AgendaAdmin.namaList || []).forEach(x => {
                const g = String(x.angkatan || "").trim() || "Lainnya";
                (grup[g] = grup[g] || []).push(x.nama);
            });
            const grupUrut = Object.keys(grup).sort((a, b) => {
                const na = /(\d+)\s*$/.exec(a), nb = /(\d+)\s*$/.exec(b);
                if (na && nb) return parseInt(nb[1], 10) - parseInt(na[1], 10);
                if (na) return -1;
                if (nb) return 1;
                return a.localeCompare(b);
            });
            selNama.innerHTML = `<option value="">Semua nama</option>` + grupUrut.map(g =>
                `<optgroup label="${escapeHtml(g)}">` + grup[g].map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("") + `</optgroup>`
            ).join("");
            if (setDefault) {
                const saya = (!AgendaAdmin.superSaya() && u.nama) ? String(u.nama).trim() : "";
                if (saya && AgendaAdmin.namaList.some(x => x.nama === saya)) {
                    AgendaAdmin.filterNama = saya;
                    selNama.value = saya;
                }
            } else if (AgendaAdmin.filterNama) {
                selNama.value = AgendaAdmin.filterNama;
            }
            AgendaAdmin.segarkanDropdown();
        };

        // 1) Isi filter sekbid + nama INSTAN dari cache biar muat() langsung jalan tanpa nunggu DB
        const cachedSb = Cache.get("sekbid");
        const cachedNm = Cache.get("nama_pengurus");
        const adaSbAwal = Array.isArray(cachedSb) && cachedSb.length > 0;
        const adaNmAwal = Array.isArray(cachedNm) && cachedNm.length > 0;
        if (adaSbAwal) isiSekbidUi(cachedSb, true);
        if (adaNmAwal) isiNamaUi(cachedNm, true);

        // 2) Segarkan akses, sekbid, dan daftar nama paralel di background
        Promise.all([
            (typeof OsisAuth.refreshAkses === "function" ? OsisAuth.refreshAkses() : Promise.resolve(null)).catch(() => null),
            getSekbid().catch(() => null),
            getNamaPengurus().catch(() => null),
        ]).then(([_, freshSb, freshNm]) => {
            const filterLamaSb = AgendaAdmin.filterSekbid;
            const filterLamaNm = AgendaAdmin.filterNama;
            if (freshSb && freshSb.length) {
                Cache.set("sekbid", freshSb);
                isiSekbidUi(freshSb, !adaSbAwal);
            } else if (!adaSbAwal && typeof navigator !== "undefined" && navigator.onLine === false) {
                showToast("Offline dan daftar sekbid belum tersimpan.", "error");
            }
            if (freshNm) isiNamaUi(freshNm, !adaNmAwal);
            AgendaAdmin.terapkanAkses();
            if ((!adaSbAwal || !adaNmAwal) && (AgendaAdmin.filterSekbid !== filterLamaSb || AgendaAdmin.filterNama !== filterLamaNm)) {
                AgendaAdmin.muat(true);
            }
        });

        // Pencarian lokal, filter berfoto, toggle view, dan reset filter
        const qInput = document.getElementById("filterAgendaQ");
        const qClear = document.getElementById("btnClearAgendaQ");
        if (qInput) {
            qInput.addEventListener("input", () => {
                AgendaAdmin.filterQ = qInput.value.trim();
                if (qClear) qClear.style.display = qInput.value ? "" : "none";
                AgendaAdmin.render();
            });
        }
        if (qClear) {
            qClear.addEventListener("click", () => {
                if (qInput) { qInput.value = ""; qInput.focus(); }
                qClear.style.display = "none";
                AgendaAdmin.filterQ = "";
                AgendaAdmin.render();
            });
        }
        document.getElementById("btnFilterFoto")?.addEventListener("click", () => {
            AgendaAdmin.filterFoto = !AgendaAdmin.filterFoto;
            const b = document.getElementById("btnFilterFoto");
            if (b) b.setAttribute("aria-pressed", AgendaAdmin.filterFoto ? "true" : "false");
            AgendaAdmin.render();
        });
        document.getElementById("btnAgendaGrid")?.addEventListener("click", () => AgendaAdmin.setViewMode("grid"));
        document.getElementById("btnAgendaList")?.addEventListener("click", () => AgendaAdmin.setViewMode("list"));
        document.getElementById("btnResetAgendaFilter")?.addEventListener("click", () => AgendaAdmin.resetFilter());

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
        const agendaDetailEl = document.getElementById("agendaDetail");
        if (agendaDetailEl) {
            agendaDetailEl.addEventListener("click", (e) => {
                if (e.target === agendaDetailEl) AgendaAdmin.tutupDetail();
            });
        }
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") AgendaAdmin.tutupMenu();
            if (e.key === "Escape" && document.getElementById("agendaForm")?.classList.contains("open")) {
                AgendaAdmin.tutupForm();
            }
            if (document.getElementById("agendaDetail")?.classList.contains("open")) {
                if (e.key === "Escape") AgendaAdmin.tutupDetail();
                else if (e.key === "ArrowRight") AgendaAdmin.fotoGeser(1);
                else if (e.key === "ArrowLeft") AgendaAdmin.fotoGeser(-1);
            }
        });
        // Klik di luar menu titik-tiga → tutup.
        document.addEventListener("click", () => AgendaAdmin.tutupMenu());

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
        // Hangatkan 15 agenda global di background supaya kalau nanti ganti filter
        // ke "Semua sekbid" saat offline, tetap ada data cadangan.
        if ((AgendaAdmin.filterSekbid || AgendaAdmin.filterNama) &&
            (typeof navigator === "undefined" || navigator.onLine !== false) &&
            typeof getAllAgenda === "function") {
            getAllAgenda(15, 0).catch(() => {});
        }
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

    // Super admin? Buat default filter: super mulai dari semua sekbid & semua nama.
    superSaya() {
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        return !!(a && a.super);
    },

    // Segarkan label dropdown custom (dropdown.js) setelah value diubah dari kode.
    segarkanDropdown() {
        try { if (window.Dropdown && Dropdown.segarkanSemua) Dropdown.segarkanSemua(); } catch {}
    },

    // Boleh kendali agenda sekbid ini? (cermin aturan server osis_bisa_agenda)
    bisaKendali(sekbidId) {
        if (AgendaAdmin.bisaGlobal()) return true;
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        if (!a || !a.sekbid_id || !sekbidId) return false;
        return String(a.sekbid_id) === String(sekbidId);
    },

    // Sekbid milik user yang login (null = jabatan tak cocok sekbid / global).
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
        if (sel) sel.value = AgendaAdmin.filterSekbid ? String(AgendaAdmin.filterSekbid) : "";
        const selNama = document.getElementById("pilihNama");
        if (selNama && AgendaAdmin.filterNama) selNama.value = AgendaAdmin.filterNama;
        AgendaAdmin.renderSekbidRail();
        AgendaAdmin.segarkanDropdown();
        AgendaAdmin.render();
    },

    pilihSekbid(val) {
        const sid = val ? parseInt(val, 10) : null;
        AgendaAdmin.filterSekbid = sid;
        const sel = document.getElementById("pilihSekbid");
        if (sel) sel.value = sid ? String(sid) : "";
        // Aturan: ganti sekbid (termasuk "Semua sekbid") → nama jadi "Semua nama".
        AgendaAdmin.filterNama = null;
        const selNamaEl = document.getElementById("pilihNama");
        if (selNamaEl) selNamaEl.value = "";
        AgendaAdmin.renderSekbidRail();
        AgendaAdmin.segarkanDropdown();
        AgendaAdmin.muat(true);
    },

    setViewMode(mode) {
        AgendaAdmin.viewMode = mode === "list" ? "list" : "grid";
        try { localStorage.setItem("agenda_view_mode", AgendaAdmin.viewMode); } catch {}
        AgendaAdmin.syncViewButtons();
        AgendaAdmin.render();
    },

    syncViewButtons() {
        const isGrid = AgendaAdmin.viewMode !== "list";
        document.getElementById("btnAgendaGrid")?.classList.toggle("active", isGrid);
        document.getElementById("btnAgendaList")?.classList.toggle("active", !isGrid);
    },

    resetLokal() {
        AgendaAdmin.filterQ = "";
        AgendaAdmin.filterFoto = false;
        const qInput = document.getElementById("filterAgendaQ");
        if (qInput) qInput.value = "";
        const qClear = document.getElementById("btnClearAgendaQ");
        if (qClear) qClear.style.display = "none";
        const bFoto = document.getElementById("btnFilterFoto");
        if (bFoto) bFoto.setAttribute("aria-pressed", "false");
        AgendaAdmin.render();
    },

    resetFilter() {
        const perluRefetch = !!(AgendaAdmin.filterSekbid || AgendaAdmin.filterNama);
        AgendaAdmin.filterSekbid = null;
        AgendaAdmin.filterNama = null;
        AgendaAdmin.filterQ = "";
        AgendaAdmin.filterFoto = false;
        const sel = document.getElementById("pilihSekbid");
        if (sel) sel.value = "";
        const selNama = document.getElementById("pilihNama");
        if (selNama) selNama.value = "";
        const qInput = document.getElementById("filterAgendaQ");
        if (qInput) qInput.value = "";
        const qClear = document.getElementById("btnClearAgendaQ");
        if (qClear) qClear.style.display = "none";
        const bFoto = document.getElementById("btnFilterFoto");
        if (bFoto) bFoto.setAttribute("aria-pressed", "false");
        AgendaAdmin.renderSekbidRail();
        AgendaAdmin.segarkanDropdown();
        if (perluRefetch) AgendaAdmin.muat(true);
        else AgendaAdmin.render();
    },

    hapusChip(jenis) {
        if (jenis === "sekbid") {
            AgendaAdmin.pilihSekbid("");
        } else if (jenis === "nama") {
            AgendaAdmin.filterNama = null;
            const selNama = document.getElementById("pilihNama");
            if (selNama) selNama.value = "";
            AgendaAdmin.segarkanDropdown();
            AgendaAdmin.muat(true);
        } else if (jenis === "foto") {
            AgendaAdmin.filterFoto = false;
            document.getElementById("btnFilterFoto")?.setAttribute("aria-pressed", "false");
            AgendaAdmin.render();
        } else if (jenis === "q") {
            AgendaAdmin.filterQ = "";
            const qInput = document.getElementById("filterAgendaQ");
            if (qInput) qInput.value = "";
            const qClear = document.getElementById("btnClearAgendaQ");
            if (qClear) qClear.style.display = "none";
            AgendaAdmin.render();
        }
    },

    sekbidIcon(nama) {
        const n = String(nama || "").toLowerCase();
        if (/wakil/.test(n)) return "fa-user-tie";
        if (/ketua/.test(n)) return "fa-crown";
        if (/sekretaris/.test(n)) return "fa-file-signature";
        if (/bendahara/.test(n)) return "fa-wallet";
        if (/humas/.test(n)) return "fa-bullhorn";
        if (/rohani/.test(n)) return "fa-mosque";
        if (/budi|pekerti/.test(n)) return "fa-heart";
        if (/politik/.test(n)) return "fa-landmark";
        if (/olahraga/.test(n)) return "fa-futbol";
        if (/berbangsa|bernegara/.test(n)) return "fa-flag";
        if (/bela/.test(n)) return "fa-shield-halved";
        if (/seni/.test(n)) return "fa-palette";
        if (/bahasa/.test(n)) return "fa-language";
        if (/wirausaha/.test(n)) return "fa-store";
        if (/\bit\b|teknologi|media/.test(n)) return "fa-laptop-code";
        return "fa-folder-open";
    },

    sekbidTone(sid) {
        const n = parseInt(sid, 10);
        return "sb-t" + (Number.isFinite(n) ? Math.abs(n) % 6 : 0);
    },

    renderSekbidRail() {
        const railEl = document.getElementById("sekbidRail");
        if (!railEl) return;
        const list = AgendaAdmin.sekbidList || [];
        const badge = document.getElementById("sekbidTotalBadge");
        if (badge) badge.textContent = String(list.length || 0);
        const aktif = AgendaAdmin.filterSekbid != null ? String(AgendaAdmin.filterSekbid) : "";
        const btnAll = `
            <button type="button" class="sekbid-rail-btn${aktif === "" ? " active" : ""}" data-sid="">
                <span class="sekbid-rail-ico"><i class="fa-solid fa-layer-group"></i></span>
                <span class="sekbid-rail-txt"><b>Semua Sekbid</b><small>Gabungan semua divisi</small></span>
                <span class="sekbid-rail-dot" aria-hidden="true"></span>
            </button>`;
        const itemsHtml = list.map(s => {
            const sid = String(s.id);
            const isAktif = aktif === sid;
            return `
            <button type="button" class="sekbid-rail-btn${isAktif ? " active" : ""}" data-sid="${escapeHtml(sid)}" title="${escapeHtml(s.nama)}">
                <span class="sekbid-rail-ico"><i class="fa-solid ${AgendaAdmin.sekbidIcon(s.nama)}"></i></span>
                <span class="sekbid-rail-txt"><b>${escapeHtml(s.nama)}</b><small>${escapeHtml(s.kategori || "Sekbid")}</small></span>
                <span class="sekbid-rail-dot" aria-hidden="true"></span>
            </button>`;
        }).join("");
        railEl.innerHTML = btnAll + itemsHtml;
        railEl.querySelectorAll(".sekbid-rail-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                AgendaAdmin.pilihSekbid(btn.dataset.sid || "");
            });
        });
    },

    kunciCacheAktif(sid, nmr) {
        if (typeof agendaKunciView === "function") return agendaKunciView(sid, nmr);
        const sb = sid ? String(sid) : "all";
        const nm = nmr ? String(nmr).trim().toLowerCase() : "all";
        return "agenda_view_" + sb + "_" + nm;
    },

    ambilCacheOffline(sid, nmr) {
        const kv = AgendaAdmin.kunciCacheAktif(sid, nmr);
        const dariView = Cache.get(kv);
        if (Array.isArray(dariView) && dariView.length) return dariView;
        if (sid && !nmr) {
            const dariSb = Cache.get("agenda_sb_" + sid);
            if (Array.isArray(dariSb) && dariSb.length) return dariSb;
        }
        const semua = Cache.get("agenda_all");
        if (Array.isArray(semua) && semua.length) {
            const saring = semua.filter(a =>
                (!sid || String(a.sekbid_id) === String(sid)) &&
                (!nmr || String(a.pengunggah || "").trim().toLowerCase() === nmr.toLowerCase()));
            if (saring.length || (!sid && !nmr)) return saring;
        }
        return null;
    },

    // muat() tanpa argumen = refresh penuh (dipakai outbox + pasca simpan/hapus)
    async muat(awal = true) {
        const listEl = document.getElementById("agendaList");
        if (AgendaAdmin.loading) { AgendaAdmin.ulang = true; return; }
        if (!awal && AgendaAdmin.habis) return;
        AgendaAdmin.loading = true;
        try {
            const sid = AgendaAdmin.filterSekbid || null;
            const nmr = AgendaAdmin.filterNama || null;
            if (awal) {
                AgendaAdmin.offset = 0;
                AgendaAdmin.cache = [];
                AgendaAdmin.habis = false;
                AgendaAdmin.ringkas = Cache.get("agenda_ringkas_" + (sid || "all") + "_" + (nmr || "")) || null;
                // Render cache 15 item terakhir DULU biar offline langsung tampil.
                const cached = AgendaAdmin.ambilCacheOffline(sid, nmr);
                if (cached) {
                    AgendaAdmin.cache = cached.slice();
                    if (typeof navigator !== "undefined" && navigator.onLine === false) {
                        AgendaAdmin.offset = AgendaAdmin.cache.length;
                        AgendaAdmin.habis = true;
                        try { AgendaAdmin.render(); } catch {}
                        return;
                    }
                    try { AgendaAdmin.render(); } catch {}
                } else if (listEl) {
                    listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat agenda...</div>`;
                }
            }
            const uidS = (() => { try { const u = OsisAuth.getUser && OsisAuth.getUser(); if (u && u.mode === "osis" && u.id) return u.id; } catch {} return null; })();
            // Filter sekbid/nama aktif = fetch di-scope itu (biar halaman 1
            // langsung isinya, bukan 15 global yang kesaring jadi 0).
            const [ringkas, rows] = await Promise.all([
                (awal && typeof sekbidAgendaRingkas === "function" ? sekbidAgendaRingkas(uidS, sid, nmr) : Promise.resolve(null)).catch(() => null),
                sid
                    ? getAgendaBySekbid(sid, AgendaAdmin.perPage, AgendaAdmin.offset, nmr)
                    : getAllAgenda(AgendaAdmin.perPage, AgendaAdmin.offset, nmr),
            ]);
            if (ringkas) AgendaAdmin.ringkas = ringkas;
            if (awal) {
                AgendaAdmin.cache = rows || [];
            } else {
                const ada = new Set((AgendaAdmin.cache || []).map(a => String(a.id)));
                (rows || []).forEach(a => { if (!ada.has(String(a.id))) { ada.add(String(a.id)); AgendaAdmin.cache.push(a); } });
            }
            AgendaAdmin.offset = (AgendaAdmin.cache || []).length;
            AgendaAdmin.habis = (rows || []).length < AgendaAdmin.perPage || (typeof navigator !== "undefined" && navigator.onLine === false);
            // Simpan 15 item terakhir sesuai view aktif + stok agenda_all.
            if (awal) {
                try { Cache.set(AgendaAdmin.kunciCacheAktif(sid, nmr), AgendaAdmin.cache.slice(0, 15)); } catch {}
                if (!sid && !nmr) {
                    try { Cache.set("agenda_all", AgendaAdmin.cache.slice(0, 15)); } catch {}
                } else {
                    try { simpanListCache("agenda_all", AgendaAdmin.cache.slice(0, 15), false); } catch {}
                }
            }
            AgendaAdmin.render();
        } catch (err) {
            console.error(err);
            const isOff = typeof adalahOfflineErr === "function" && adalahOfflineErr(err);
            if ((AgendaAdmin.cache || []).length) {
                if (isOff) AgendaAdmin.habis = true;
                try { AgendaAdmin.render(); } catch {}
                if (!isOff && typeof showToast === "function") showToast("Gagal muat lanjutan agenda.", "error");
            } else if (awal && listEl) {
                listEl.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-cloud"></i> Offline dan belum ada data tersimpan. Buka halaman ini sekali saat online.</div>`;
            } else if (!isOff && typeof showToast === "function") {
                showToast("Gagal muat lanjutan agenda.", "error");
            }
        } finally {
            AgendaAdmin.loading = false;
            // Aksi user (ganti filter) yang ketahan pas loading -> ulangi sekali.
            if (AgendaAdmin.ulang) {
                AgendaAdmin.ulang = false;
                AgendaAdmin.muat(true);
            }
        }
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

    namaSekbid(id) {
        const s = (AgendaAdmin.sekbidList || []).find(x => String(x.id) === String(id));
        return s ? s.nama : "Sekbid";
    },

    // Urutan kartu: tanggal terbaru dulu (newest -> oldest),
    // tie-break created_at terbaru. Tanpa display_order.
    urutkan(list) {
        return [...(list || [])].sort((a, b) => {
            const ta = a.tanggal ? new Date(a.tanggal).getTime() : 0;
            const tb = b.tanggal ? new Date(b.tanggal).getTime() : 0;
            if (tb !== ta) return tb - ta;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
    },

    // Kunci grup per hari: "YYYY-MM-DD" atau "" kalau tanpa tanggal
    kunciTanggal(a) {
        const t = String(a.tanggal || "").slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
    },

    labelTanggal(key) {
        if (!key) return "Tanpa tanggal";
        const d = new Date(key + "T00:00:00");
        if (isNaN(d.getTime())) return key;
        return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    },

    kartu(a, tampilSekbid) {
        const aid = parseInt(a.id, 10) || 0;
        const fotos = Array.isArray(a.fotos) ? a.fotos : [];
        const maksThumb = 3;
        const thumbs = fotos.slice(0, maksThumb);
        const sisaFoto = fotos.length - maksThumb;
        const stripCls = thumbs.length === 1 ? "n1" : (thumbs.length === 2 ? "n2" : "n3");
        const fotosHtml = thumbs.length ? `<div class="agenda-media-strip ${stripCls}">${thumbs.map((f, fi) => {
            const p = typeof f === "string" ? f : f.path;
            const more = (fi === maksThumb - 1 && sisaFoto > 0) ? `<span class="agenda-media-more">+${sisaFoto}</span>` : "";
            return `<span class="agenda-media-thumb media-muat" onclick="event.stopPropagation(); AgendaAdmin.detail(${aid}, ${fi})" title="Klik untuk lihat foto"><img src="${getFoto(p)}" alt="${escapeHtml(a.judul || "Foto agenda")}" loading="lazy" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span>${more}</span>`;
        }).join("")}</div>` : "";
        const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
        const pel = String(a.pengunggah || "").trim();
        const kendali = AgendaAdmin.bisaKendali(a.sekbid_id);
        const sekbidNama = AgendaAdmin.namaSekbid(a.sekbid_id);
        const tone = AgendaAdmin.sekbidTone(a.sekbid_id);
        const lok = String(a.lokasi || "").trim();
        return `
            <div class="agenda-card${fotos.length ? " punya-foto" : ""}${kendali ? " punya-kendali" : ""}" onclick="AgendaAdmin.detail(${aid}, 0)" title="Klik untuk lihat detail">
                <div class="agenda-card-top">
                    ${tampilSekbid !== false ? `<span class="agenda-sekbid-tag ${tone}"><i class="fa-solid ${AgendaAdmin.sekbidIcon(sekbidNama)}"></i> ${escapeHtml(sekbidNama)}</span>` : "<span></span>"}
                </div>
                <h4>${escapeHtml(a.judul)}</h4>
                ${a.deskripsi ? `<p class="agenda-desk">${escapeHtml(a.deskripsi)}</p>` : ""}
                ${fotosHtml}
                <div class="agenda-card-foot">
                    <div class="agenda-oleh" title="Diunggah oleh ${escapeHtml(pel || "Tanpa pengunggah")}">
                        <i class="fa-solid fa-user"></i>
                        <span>${escapeHtml(pel || "Tanpa pengunggah")}</span>
                    </div>
                    <div class="agenda-meta">
                        ${lok ? `<span class="a-chip lok" title="${escapeHtml(lok)}"><i class="fa-solid fa-location-dot"></i> <span>${escapeHtml(lok)}</span></span>` : `<span class="a-chip"><i class="fa-solid fa-calendar"></i> <span>${escapeHtml(tgl)}</span></span>`}
                        ${fotos.length ? `<span class="a-chip foto-badge"><i class="fa-solid fa-images"></i> <span>${fotos.length}</span></span>` : ""}
                    </div>
                </div>
                ${kendali ? `<div class="agenda-kebab" onclick="event.stopPropagation()">
                    <button class="kb-btn" onclick="AgendaAdmin.toggleMenu(this)" title="Aksi" aria-label="Aksi"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    <div class="kb-menu">
                        <button class="kb-item" onclick="AgendaAdmin.edit(${aid})"><i class="fa-solid fa-pen"></i> Edit</button>
                        <button class="kb-item hapus" onclick="AgendaAdmin.hapus(${aid})"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                    </div>
                </div>` : ""}
            </div>`;
    },

    render() {
        const listEl = document.getElementById("agendaList");
        if (!listEl) return;
        listEl.classList.toggle("agenda-list-compact", AgendaAdmin.viewMode === "list");
        listEl.classList.toggle("agenda-list-grid", AgendaAdmin.viewMode !== "list");
        AgendaAdmin.syncViewButtons();

        const semua = AgendaAdmin.cache || [];
        // Tampil sesuai filter sekbid aktif.
        const basis = AgendaAdmin.filterSekbid
            ? semua.filter(a => String(a.sekbid_id) === String(AgendaAdmin.filterSekbid))
            : semua;

        // Filter lokal (tanpa bolak-balik server): Hanya Berfoto & Pencarian teks
        const q = String(AgendaAdmin.filterQ || "").trim().toLowerCase();
        const lokal = basis.filter(a => {
            if (AgendaAdmin.filterFoto) {
                const f = Array.isArray(a.fotos) ? a.fotos : [];
                if (!f.length) return false;
            }
            if (q) {
                const hay = [
                    a.judul || "",
                    a.deskripsi || "",
                    a.lokasi || "",
                    a.pengunggah || "",
                    AgendaAdmin.namaSekbid(a.sekbid_id),
                ].join(" ").toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        // Statistik: HANYA dari RPC ringkas. Belum ada (loading / offline)
        // -> tampil "…", jangan hitung dari cache parsial biar angkanya nggak ngaco/kedip.
        const R = AgendaAdmin.ringkas;
        const ang = (v) => (R ? (parseInt(v, 10) || 0).toLocaleString("id-ID") : "…");
        const nTotal = ang(R && R.total);
        const nBulan = ang(R && R.bulan_ini);
        const nSekbid = ang(R && R.n_sekbid);
        const nOrang = ang(R && R.n_orang);
        const blnLbl = new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
        const statsEl = document.getElementById("agendaStats");
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="stat-card">
                    <div class="stat-head">
                        <span class="stat-ico blue"><i class="fa-solid fa-calendar-check"></i></span>
                        <span class="lbl">Total Agenda</span>
                    </div>
                    <b>${nTotal}</b>
                    <small>${AgendaAdmin.filterSekbid || AgendaAdmin.filterNama ? "sesuai filter aktif" : "semua catatan agenda"}</small>
                </div>
                <div class="stat-card">
                    <div class="stat-head">
                        <span class="stat-ico yellow"><i class="fa-solid fa-clock"></i></span>
                        <span class="lbl">Bulan Ini</span>
                    </div>
                    <b>${nBulan}</b>
                    <small>${escapeHtml(blnLbl)}</small>
                </div>
                <div class="stat-card">
                    <div class="stat-head">
                        <span class="stat-ico red"><i class="fa-solid fa-layer-group"></i></span>
                        <span class="lbl">Sekbid Terlibat</span>
                    </div>
                    <b>${nSekbid}</b>
                    <small>divisi aktif</small>
                </div>
                <div class="stat-card">
                    <div class="stat-head">
                        <span class="stat-ico green"><i class="fa-solid fa-users"></i></span>
                        <span class="lbl">Pengunggah</span>
                    </div>
                    <b>${nOrang}</b>
                    <small>pengurus tercatat</small>
                </div>`;
        }

        // Bar info hasil + chip filter aktif
        const adaFilterAktif = !!(AgendaAdmin.filterSekbid || AgendaAdmin.filterNama || AgendaAdmin.filterFoto || q);
        const btnReset = document.getElementById("btnResetAgendaFilter");
        if (btnReset) btnReset.style.display = adaFilterAktif ? "" : "none";
        try { window.OsisSearch?.sync?.("agendaTopSearch"); } catch {}

        // Kalau lagi edit, sembunyikan card yang sedang diedit biar ga keliatan duplikat
        const isEditing = !!(AgendaAdmin.editingId && document.getElementById("agendaForm")?.classList.contains("open"));
        const tampil = isEditing ? lokal.filter(a => String(a.id) !== String(AgendaAdmin.editingId)) : lokal;

        const barEl = document.getElementById("agendaBar");
        const barCount = document.getElementById("agendaBarCount");
        const chipsEl = document.getElementById("agendaChips");
        if (barEl && barCount && chipsEl) {
            if (adaFilterAktif || basis.length > 0) {
                barEl.style.display = "";
                const infoTotal = R && !q && !AgendaAdmin.filterFoto && !AgendaAdmin.habis
                    ? ` dari <b>${(parseInt(R.total, 10) || 0).toLocaleString("id-ID")}</b> total`
                    : ((q || AgendaAdmin.filterFoto) && basis.length !== tampil.length ? ` (disaring dari ${basis.length} dimuat)` : "");
                barCount.innerHTML = `Menampilkan <b>${tampil.length}</b> agenda${infoTotal}`;
                const chips = [];
                if (AgendaAdmin.filterSekbid) {
                    chips.push(`<button type="button" class="agenda-chip" onclick="AgendaAdmin.hapusChip('sekbid')">Sekbid: ${escapeHtml(AgendaAdmin.namaSekbid(AgendaAdmin.filterSekbid))} <i class="fa-solid fa-xmark"></i></button>`);
                }
                if (AgendaAdmin.filterNama) {
                    chips.push(`<button type="button" class="agenda-chip" onclick="AgendaAdmin.hapusChip('nama')">Oleh: ${escapeHtml(AgendaAdmin.filterNama)} <i class="fa-solid fa-xmark"></i></button>`);
                }
                if (AgendaAdmin.filterFoto) {
                    chips.push(`<button type="button" class="agenda-chip" onclick="AgendaAdmin.hapusChip('foto')">Ada Foto <i class="fa-solid fa-xmark"></i></button>`);
                }
                if (q) {
                    chips.push(`<button type="button" class="agenda-chip" onclick="AgendaAdmin.hapusChip('q')">Cari: "${escapeHtml(AgendaAdmin.filterQ)}" <i class="fa-solid fa-xmark"></i></button>`);
                }
                chipsEl.innerHTML = chips.join("");
            } else {
                barEl.style.display = "none";
            }
        }

        if (AgendaAdmin.loading && !semua.length) {
            listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat agenda...</div>`;
            return;
        }

        const footerPaging = (tampil.length || ((q || AgendaAdmin.filterFoto) && !AgendaAdmin.habis && basis.length > 0))
            ? `<div class="agenda-loadmore">`
                + (AgendaAdmin.habis
                    ? `<small style="color:var(--gray); font-weight:700">— Semua agenda sudah dimuat —</small>`
                    : `<button class="btn btn-white btn-sm" onclick="AgendaAdmin.muat(false)"><i class="fa-solid fa-angles-down"></i> Muat lagi</button>`)
                + `</div><div id="agendaSentinel" style="height:8px"></div>`
            : "";

        listEl.innerHTML = AgendaAdmin.renderSekbid(tampil, isEditing, basis.length, q) + footerPaging;
        // Tanpa IO → sembunyikan sentinel, tombol manual yang dipakai
        let io = null;
        try { if (typeof pasangSentinel === "function") io = pasangSentinel("agendaSentinel", () => AgendaAdmin.muat(false)); } catch {}
        if (!io) { const s = document.getElementById("agendaSentinel"); if (s) s.style.display = "none"; }
    },

    // ===== TAMPILAN: per hari (newest -> oldest), kartu ngalir dalam grid multi-kolom =====
    renderSekbid(tampil, isEditing, totalBasis, q) {
        const urut = AgendaAdmin.urutkan(tampil);
        if (!urut.length) {
            if (isEditing) return `<div class="pesan-empty" style="font-size:0.82rem;color:var(--gray)"><i class="fa-solid fa-pen"></i> Sedang mengedit — lihat form di atas.</div>`;
            if ((q || AgendaAdmin.filterFoto) && totalBasis > 0) {
                return `<div class="agenda-empty-card">
                    <i class="fa-solid fa-filter-circle-xmark"></i>
                    <b>Belum ada yang cocok di ${totalBasis} agenda termuat</b>
                    <p>Pencarian & filter foto menyaring data yang sudah dimuat. Coba muat batch berikutnya atau bersihkan filter.</p>
                    <div class="agenda-empty-actions">
                        <button type="button" class="btn btn-white btn-sm" onclick="AgendaAdmin.resetLokal()"><i class="fa-solid fa-eraser"></i> Bersihkan Filter Lokal</button>
                    </div>
                </div>`;
            }
            if (AgendaAdmin.filterSekbid || AgendaAdmin.filterNama) {
                return `<div class="agenda-empty-card">
                    <i class="fa-solid fa-calendar-xmark"></i>
                    <b>Belum ada agenda untuk filter ini</b>
                    <p>Coba tampilkan semua sekbid atau semua pengunggah untuk melihat agenda lainnya.</p>
                    <div class="agenda-empty-actions">
                        <button type="button" class="btn btn-yellow btn-sm" onclick="AgendaAdmin.resetFilter()"><i class="fa-solid fa-layer-group"></i> Lihat Semua Agenda</button>
                    </div>
                </div>`;
            }
            return `<div class="agenda-empty-card"><i class="fa-solid fa-calendar"></i><b>Belum ada agenda.</b></div>`;
        }
        // Urutan sekbid ikut master list biar sekbid sejenis rapih berdampingan dalam hari yang sama
        const orderSekbid = {};
        (AgendaAdmin.sekbidList || []).forEach((s, i) => { orderSekbid[String(s.id)] = i; });
        // Kelompokkan per tanggal
        const grupHari = {};
        urut.forEach(a => {
            const k = AgendaAdmin.kunciTanggal(a);
            (grupHari[k] = grupHari[k] || []).push(a);
        });
        const kunciUrut = Object.keys(grupHari).sort((x, y) => {
            if (x === "" && y !== "") return 1;
            if (y === "" && x !== "") return -1;
            return y.localeCompare(x); // YYYY-MM-DD: string desc = newest dulu
        });
        return kunciUrut.map(k => {
            const isiHari = [...grupHari[k]].sort((a, b) => {
                const ox = orderSekbid[String(a.sekbid_id ?? "")];
                const oy = orderSekbid[String(b.sekbid_id ?? "")];
                if (ox != null && oy != null && ox !== oy) return ox - oy;
                if (ox == null && oy != null) return 1;
                if (oy == null && ox != null) return -1;
                return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            });
            const nSekbidHari = new Set(isiHari.map(a => String(a.sekbid_id ?? ""))).size;
            const gridMod = isiHari.length === 1 ? " satu-item" : (isiHari.length === 2 ? " dua-item" : "");
            const kartuHtml = `<div class="agenda-grid${gridMod}">${isiHari.map(a => AgendaAdmin.kartu(a, true)).join("")}</div>`;
            return `
                <div class="agenda-hari">
                    <div class="agenda-hari-head">
                        <span class="agenda-hari-date"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(AgendaAdmin.labelTanggal(k))}</span>
                        <div class="agenda-hari-badges">
                            ${nSekbidHari > 1 ? `<span class="agenda-grup-subpill">${nSekbidHari} sekbid</span>` : ""}
                            <span class="agenda-grup-count">${isiHari.length} agenda</span>
                        </div>
                    </div>
                    ${kartuHtml}
                </div>`;
        }).join("");
    },

    // ============ DETAIL (klik foto — tampilkan agenda lebih jelas) ============
    detail(id, idx) {
        const a = (AgendaAdmin.cache || []).find(x => String(x.id) === String(id));
        if (!a) return;
        AgendaAdmin.detailId = id;
        const fotos = Array.isArray(a.fotos) ? a.fotos : [];
        AgendaAdmin.detailIdx = Math.max(0, Math.min(parseInt(idx, 10) || 0, fotos.length - 1));
        const tgl = a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "-";
        const oleh = String(a.pengunggah || "").trim() || "Tidak diketahui";
        const kv = (k, v, ico, tone, wide) => `
            <div class="osis-det-kv${wide ? " wide" : ""}">
                <div class="osis-det-kv-top">
                    <span class="osis-det-kv-ico ${tone || ""}"><i class="fa-solid ${ico}"></i></span>
                    <span class="k">${k}</span>
                </div>
                <div class="v">${v || "-"}</div>
            </div>`;
        document.getElementById("agendaDetailBody").innerHTML = `
            <div class="osis-det-hero">
                <div class="osis-det-chips">
                    <span class="agenda-sekbid-tag ${AgendaAdmin.sekbidTone(a.sekbid_id)}"><i class="fa-solid ${AgendaAdmin.sekbidIcon(AgendaAdmin.namaSekbid(a.sekbid_id))}"></i> ${escapeHtml(AgendaAdmin.namaSekbid(a.sekbid_id))}</span>
                    ${fotos.length ? `<span class="osis-det-chip blue"><i class="fa-solid fa-images"></i> ${fotos.length} foto</span>` : `<span class="osis-det-chip"><i class="fa-regular fa-image"></i> Tanpa foto</span>`}
                </div>
                <h3 class="osis-det-title">${escapeHtml(a.judul || "Tanpa judul")}</h3>
            </div>
            <div class="osis-det-grid">
                ${kv("Tanggal", escapeHtml(tgl), "fa-calendar-days", "t-blue", true)}
                ${kv("Tempat", escapeHtml(a.lokasi || "-"), "fa-location-dot", "t-green")}
                ${kv("Diunggah oleh", escapeHtml(oleh), "fa-cloud-arrow-up", "t-amber")}
            </div>
            ${a.deskripsi ? `<div class="osis-det-sec"><div class="osis-det-sec-head"><span><i class="fa-solid fa-align-left"></i> Deskripsi Agenda</span></div><div class="osis-det-box">${escapeHtml(a.deskripsi)}</div></div>` : ""}
            ${fotos.length ? `<div class="osis-det-sec"><div class="osis-det-sec-head"><span><i class="fa-solid fa-images"></i> Dokumentasi Foto</span><span>${fotos.length} foto</span></div><div class="agenda-detail-stage media-muat media-muat-tinggi">
                <img id="agendaDetailFoto" src="" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')" alt="${escapeHtml(a.judul || "Foto agenda")}">
                <span class="media-muat-loading" aria-hidden="true" style="z-index:auto"><span class="spinner"></span></span>${fotos.length > 1 ? `<button type="button" class="agenda-detail-nav prev" onclick="AgendaAdmin.fotoGeser(-1)" title="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>
                <button type="button" class="agenda-detail-nav next" onclick="AgendaAdmin.fotoGeser(1)" title="Berikutnya"><i class="fa-solid fa-chevron-right"></i></button>` : ""}
                ${fotos.length > 1 ? `<span class="agenda-detail-count" id="agendaDetailCount"></span>` : ""}
            </div>
            ${fotos.length > 1 ? `<div class="agenda-detail-thumbs" id="agendaDetailThumbs">${fotos.map((f, fi) => {
                const p = typeof f === "string" ? f : f.path;
                return `<span class="media-muat mini" style="width:64px;height:64px;flex-shrink:0"><img src="${getFoto(p)}" alt="" loading="lazy" data-thumb="${fi}" style="width:64px;height:64px" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')" onclick="AgendaAdmin.fotoPilih(${fi})"><span class="media-muat-loading" aria-hidden="true" style="border-radius:10px"><span class="spinner"></span></span></span>`;
            }).join("")}</div>` : ""}</div>` : ""}`;
        AgendaAdmin.renderDetailFoto();
        document.getElementById("agendaDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    renderDetailFoto() {
        const a = (AgendaAdmin.cache || []).find(x => String(x.id) === String(AgendaAdmin.detailId));
        if (!a) return;
        const fotos = Array.isArray(a.fotos) ? a.fotos : [];
        if (!fotos.length) return;
        AgendaAdmin.detailIdx = (AgendaAdmin.detailIdx + fotos.length) % fotos.length;
        const f = fotos[AgendaAdmin.detailIdx];
        const img = document.getElementById("agendaDetailFoto");
        if (img) {
            img.closest(".media-muat")?.classList.remove("sudah-muat");
            img.src = getFoto(typeof f === "string" ? f : f.path);
        }
        const count = document.getElementById("agendaDetailCount");
        if (count) count.textContent = (AgendaAdmin.detailIdx + 1) + " / " + fotos.length;
        document.querySelectorAll("#agendaDetailThumbs img").forEach(el => {
            el.classList.toggle("aktif", parseInt(el.dataset.thumb, 10) === AgendaAdmin.detailIdx);
        });
    },

    fotoPilih(i) {
        AgendaAdmin.detailIdx = parseInt(i, 10) || 0;
        AgendaAdmin.renderDetailFoto();
    },

    fotoGeser(arah) {
        AgendaAdmin.detailIdx += (parseInt(arah, 10) || 0);
        AgendaAdmin.renderDetailFoto();
    },

    tutupDetail() {
        document.getElementById("agendaDetail")?.classList.remove("open");
        if (!document.getElementById("agendaForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        AgendaAdmin.detailId = null;
        AgendaAdmin.detailIdx = 0;
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
            if (typeof showToast === "function") showToast("Jabatanmu tidak cocok sekbid manapun — hubungi admin.", "error");
            return;
        }
        document.getElementById("agendaJudul").value = "";
        document.getElementById("agendaDeskripsi").value = "";
        // Tanggal otomatis hari ini (lokal, bukan UTC biar tidak mundur sehari)
        const _t = new Date();
        document.getElementById("agendaTanggal").value =
            `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, "0")}-${String(_t.getDate()).padStart(2, "0")}`;
        document.getElementById("agendaLokasi").value = "";
        const ft = document.getElementById("agendaFormTitle");
        if (ft) ft.textContent = "Tambah Agenda";
        const fi = document.getElementById("agendaFotos");
        if (fi) fi.value = "";
        AgendaAdmin.renderPreview();
        document.getElementById("agendaForm").classList.add("open");
        document.body.style.overflow = "hidden";
        AgendaAdmin.render();
    },

    edit(id) {
        AgendaAdmin.tutupMenu();
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
        const ft = document.getElementById("agendaFormTitle");
        if (ft) ft.textContent = "Edit Agenda";
        const fi = document.getElementById("agendaFotos");
        if (fi) fi.value = "";
        // buka form dulu baru render supaya filter editingId kepake
        document.getElementById("agendaForm").classList.add("open");
        document.body.style.overflow = "hidden";
        AgendaAdmin.renderPreview();
        AgendaAdmin.render();
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

    // Menu titik-tiga di kartu (Edit / Hapus).
    toggleMenu(btn) {
        const wrap = btn && btn.closest ? btn.closest(".agenda-kebab") : null;
        if (!wrap) return;
        const lagiBuka = wrap.classList.contains("buka");
        AgendaAdmin.tutupMenu();
        if (!lagiBuka) wrap.classList.add("buka");
    },
    tutupMenu() {
        document.querySelectorAll(".agenda-kebab.buka").forEach(w => w.classList.remove("buka"));
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
        // Tanpa urutan manual: tampilan selalu tanggal terbaru -> terlama.

        if (!judul) { showToast("Judul wajib diisi", "error"); return; }
        if (!sekbidId) { showToast("Jabatanmu tidak cocok sekbid manapun — hubungi admin.", "error"); return; }
        if (!AgendaAdmin.bisaKendali(sekbidId)) {
            showToast("Kamu tidak punya kendali atas sekbid ini.", "error");
            return;
        }

        const __spec = () => ({ modul: "agenda", op: id ? "update" : "create",
            label: "Agenda: " + String(judul).slice(0, 42),
            payload: { id: id || null, sekbid_id: sekbidId, judul, deskripsi, tanggal, lokasi,
                status, fotosExisting: [...(AgendaAdmin.existingFotos || [])] },
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
                await updateAgenda(u.id, id, judul, deskripsi, tanggal, lokasi, status, fotos);
                showToast("Agenda diperbarui!", "success");
            } else {
                const newId = await buatAgenda(u.id, sekbidId, judul, deskripsi, tanggal, lokasi, status, fotos);
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
        AgendaAdmin.tutupMenu();
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
