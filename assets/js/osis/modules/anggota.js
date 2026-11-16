// =========================================================================
// ANGGOTA — halaman roster OSIS (osis/anggota.html)
// CRUD daftar anggota per periode: nama, jabatan, kelas, username.
// Roster ini dipakai absensi (absensi.js baca via getAnggota).
// Tulis via RPC tambah_anggota / update_anggota / hapus_anggota (p_user_id).
// =========================================================================

const Anggota = {
    cache: [],
    tahunList: [],
    tahun: null,
    q: "",
    status: "semua",
    kelas: "",
    jabatan: "",
    sort: "nama",
    viewMode: "card",
    tampilSemua: false,
    DEFAULT_LIMIT: 15,
    detailId: null,

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        try { await OsisAuth.refreshAkses(); } catch {}
        Anggota.terapkanAkses();

        document.getElementById("btnTambahAnggota")?.addEventListener("click", () => Anggota.bukaForm(null));
        document.getElementById("btnTambahTahun")?.addEventListener("click", () => Anggota.tambahPeriode());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Anggota.resetFilter());

        document.getElementById("anggotaQ")?.addEventListener("input", (e) => {
            Anggota.q = e.target.value || "";
            Anggota.render();
        });
        document.getElementById("btnClearQ")?.addEventListener("click", () => {
            const inp = document.getElementById("anggotaQ");
            if (inp) { inp.value = ""; inp.focus(); }
            Anggota.q = "";
            Anggota.render();
        });

        document.getElementById("anggStatusChips")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-angg-status]");
            if (!btn) return;
            Anggota.status = btn.dataset.anggStatus || "semua";
            Anggota.render();
        });
        document.getElementById("statCardTertaut")?.addEventListener("click", () => Anggota.toggleStatus("tertaut"));
        document.getElementById("statCardBelum")?.addEventListener("click", () => Anggota.toggleStatus("belum"));

        document.getElementById("pilihTahun")?.addEventListener("change", (e) => {
            const thn = parseInt(e.target.value, 10);
            if (!Number.isFinite(thn)) return;
            Anggota.tahun = thn;
            Anggota.tampilSemua = false;
            Anggota.render();
        });
        document.getElementById("filterKelas")?.addEventListener("change", (e) => {
            Anggota.kelas = e.target.value || "";
            Anggota.render();
        });
        document.getElementById("filterSort")?.addEventListener("change", (e) => {
            Anggota.sort = e.target.value || "nama";
            Anggota.render();
        });

        document.getElementById("filterChips")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-clear-filter]");
            if (!btn) return;
            const k = btn.dataset.clearFilter;
            if (k === "q") {
                const inp = document.getElementById("anggotaQ");
                if (inp) inp.value = "";
                Anggota.q = "";
            } else if (k === "status") {
                Anggota.status = "semua";
            } else if (k === "kelas") {
                Anggota.kelas = "";
            } else if (k === "jabatan") {
                Anggota.jabatan = "";
            } else if (k === "sort") {
                Anggota.sort = "nama";
            }
            Anggota.render();
        });

        document.getElementById("anggTingkatChips")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-tingkat]");
            if (!btn) return;
            const t = btn.dataset.tingkat || "";
            const key = t ? `tingkat:${t}` : "";
            Anggota.kelas = (Anggota.kelas === key) ? "" : key;
            Anggota.render();
        });
        document.getElementById("anggKelasBars")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-filter-kelas]");
            if (!btn) return;
            const kls = btn.dataset.filterKelas || "";
            Anggota.kelas = (Anggota.kelas === kls) ? "" : kls;
            Anggota.render();
        });
        document.getElementById("anggJabatanBars")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-filter-jabatan]");
            if (!btn) return;
            const jab = btn.dataset.filterJabatan || "";
            Anggota.jabatan = (Anggota.jabatan === jab) ? "" : jab;
            Anggota.render();
        });
        document.getElementById("anggPeriodePills")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-pilih-tahun]");
            if (!btn) return;
            const thn = parseInt(btn.dataset.pilihTahun, 10);
            if (!Number.isFinite(thn)) return;
            Anggota.tahun = thn;
            Anggota.tampilSemua = false;
            Anggota.render();
        });

        document.getElementById("btnViewCard")?.addEventListener("click", () => {
            if (Anggota.viewMode === "card") return;
            Anggota.viewMode = "card";
            Anggota.render();
        });
        document.getElementById("btnViewTable")?.addEventListener("click", () => {
            if (Anggota.viewMode === "table") return;
            Anggota.viewMode = "table";
            Anggota.render();
        });
        document.getElementById("anggotaMoreBar")?.addEventListener("click", (e) => {
            if (!e.target.closest("#btnToggleMore")) return;
            Anggota.tampilSemua = !Anggota.tampilSemua;
            Anggota.render();
        });

        document.getElementById("anggotaRows")?.addEventListener("click", (e) => {
            const ed = e.target.closest("[data-edit]");
            if (ed) { e.stopPropagation(); Anggota.bukaForm(ed.dataset.edit); return; }
            const del = e.target.closest("[data-del]");
            if (del) { e.stopPropagation(); Anggota.hapus(del.dataset.del); return; }
            const det = e.target.closest("[data-detail]");
            if (det) Anggota.bukaDetail(det.dataset.detail);
        });

        const detModal = document.getElementById("anggotaDetail");
        if (detModal) {
            detModal.addEventListener("click", (e) => {
                if (e.target === detModal) Anggota.tutupDetail();
            });
        }
        document.getElementById("btnDetEdit")?.addEventListener("click", () => {
            const id = Anggota.detailId;
            if (!id) return;
            Anggota.tutupDetail();
            Anggota.bukaForm(id);
        });
        document.getElementById("btnDetHapus")?.addEventListener("click", () => {
            const id = Anggota.detailId;
            if (id) Anggota.hapus(id);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && document.getElementById("anggotaDetail")?.classList.contains("open")) {
                Anggota.tutupDetail();
            }
        });

        Anggota.muat();
        window.addEventListener("osis:angkatan-ready", () => { try { Anggota.render(); } catch {} });
    },

    terapkanAkses() {
        const boleh = OsisAuth.bisa("anggota");
        ["btnTambahAnggota", "btnTambahTahun"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = boleh ? "" : "none";
        });
        const linkUsers = document.getElementById("linkAkunOsis");
        if (linkUsers) linkUsers.style.display = OsisAuth.bisa("users") ? "" : "none";
        try { Anggota.render(); } catch {}
    },

    // ============ DATA (cache-first + revalidasi, pola absensi.js) ============
    async muat() {
        try {
            const cached = Cache.get("anggota");
            if (cached) {
                Anggota.pakai(cached);
                getAnggota().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("anggota", fresh);
                        Anggota.pakai(fresh || []);
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getAnggota();
            Cache.set("anggota", fresh);
            Anggota.pakai(fresh || []);
        } catch (err) {
            console.error(err);
            document.getElementById("anggotaRows").innerHTML =
                `<div class="pesan-empty">Gagal memuat anggota.</div>`;
        }
    },

    pakai(list) {
        Anggota.cache = (list || []).filter(a => a && String(a.nama || "").trim());
        const setTahun = new Set();
        Anggota.cache.forEach(a => {
            const t = parseInt(a.tahun, 10);
            if (Number.isFinite(t)) setTahun.add(t);
        });
        Anggota.tahunList = [...setTahun].sort((a, b) => b - a);
        const angObj = (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanAktifObj) ? OsisAuth.getAngkatanAktifObj() : null;
        const angTahun = angObj && angObj.tahun ? parseInt(angObj.tahun, 10) : null;
        if (!Anggota.tahunList.length) Anggota.tahunList = [angTahun || new Date().getFullYear()];
        if (!Anggota.tahun || !Anggota.tahunList.includes(Anggota.tahun)) {
            Anggota.tahun = (angTahun && Anggota.tahunList.includes(angTahun)) ? angTahun : Anggota.tahunList[0];
        }
        Anggota.render();
    },

    // ============ FILTER & HELPERS ============
    toggleStatus(val) {
        Anggota.status = (Anggota.status === val) ? "semua" : val;
        Anggota.render();
    },

    resetFilter() {
        const inp = document.getElementById("anggotaQ");
        if (inp) inp.value = "";
        Anggota.q = "";
        Anggota.status = "semua";
        Anggota.kelas = "";
        Anggota.jabatan = "";
        Anggota.sort = "nama";
        Anggota.render();
    },

    tingkatDariKelas(kelas) {
        const s = String(kelas || "").trim();
        if (!s) return "";
        if (/^(XII|12)(?=$|[\s\-_/.])/i.test(s)) return "XII";
        if (/^(XI|11)(?=$|[\s\-_/.])/i.test(s)) return "XI";
        if (/^(X|10)(?=$|[\s\-_/.])/i.test(s)) return "X";
        return "";
    },

    tertaut(a) {
        return !!String(a?.username || "").trim();
    },

    isSaya(a) {
        const me = String(OsisAuth.getUser?.()?.username || "").trim().toLowerCase();
        const uname = String(a?.username || "").trim().toLowerCase();
        return !!(me && uname && me === uname);
    },

    bisaBaris(a) {
        return OsisAuth.bisa("anggota") && (typeof OsisAngkatanUi === "undefined" || OsisAngkatanUi.bisaKelolaItem("anggota", a));
    },

    hasActiveFilter() {
        return !!(
            String(Anggota.q || "").trim() ||
            Anggota.status !== "semua" ||
            Anggota.kelas ||
            Anggota.jabatan ||
            Anggota.sort !== "nama"
        );
    },

    rowsPeriode() {
        return Anggota.cache.filter(a => parseInt(a.tahun, 10) === Anggota.tahun);
    },

    rowsTampil(allInPeriode) {
        const q = String(Anggota.q || "").trim().toLowerCase();
        const isTingkat = Anggota.kelas.startsWith("tingkat:");
        const targetTingkat = isTingkat ? Anggota.kelas.slice(8) : "";

        const filtered = (allInPeriode || Anggota.rowsPeriode()).filter(a => {
            if (q && ![a.nama, a.jabatan, a.kelas, a.username].some(v => String(v || "").toLowerCase().includes(q))) {
                return false;
            }
            if (Anggota.status === "tertaut" && !Anggota.tertaut(a)) return false;
            if (Anggota.status === "belum" && Anggota.tertaut(a)) return false;
            if (Anggota.kelas) {
                const k = String(a.kelas || "").trim();
                if (isTingkat) {
                    if (Anggota.tingkatDariKelas(k) !== targetTingkat) return false;
                } else if (k !== Anggota.kelas) {
                    return false;
                }
            }
            if (Anggota.jabatan && String(a.jabatan || "").trim() !== Anggota.jabatan) {
                return false;
            }
            return true;
        });

        const byNama = (x, y) => String(x.nama || "").localeCompare(String(y.nama || ""), "id");
        filtered.sort((a, b) => {
            if (Anggota.sort === "nama-desc") return byNama(b, a);
            if (Anggota.sort === "kelas") {
                const ka = String(a.kelas || "zzz").localeCompare(String(b.kelas || "zzz"), "id");
                return ka !== 0 ? ka : byNama(a, b);
            }
            if (Anggota.sort === "jabatan") {
                const ja = String(a.jabatan || "zzz").localeCompare(String(b.jabatan || "zzz"), "id");
                return ja !== 0 ? ja : byNama(a, b);
            }
            return byNama(a, b);
        });
        return filtered;
    },

    initial(nama) {
        const parts = String(nama || "?").trim().split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return (parts[0]?.[0] || "?").toUpperCase();
    },

    // Hitung frekuensi nilai tertentu dan kembalikan array [{name, count}] terurut.
    hitungGrup(items, fn) {
        const map = new Map();
        items.forEach(a => {
            const key = String(fn(a) || "").trim();
            if (!key) return;
            map.set(key, (map.get(key) || 0) + 1);
        });
        return [...map.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort((x, y) => (y.count - x.count) || x.name.localeCompare(y.name, "id"));
    },

    // ============ SYNC FILTER DRAWER & CHIPS ============
    sinkronFilterUi(kelasList) {
        const setTersedia = new Set(kelasList.map(k => k.name));
        if (Anggota.kelas && !Anggota.kelas.startsWith("tingkat:") && !setTersedia.has(Anggota.kelas)) {
            Anggota.kelas = "";
        }

        const selTahun = document.getElementById("pilihTahun");
        if (selTahun) {
            selTahun.innerHTML = Anggota.tahunList
                .map(t => `<option value="${t}" ${t === Anggota.tahun ? "selected" : ""}>Periode ${t}</option>`)
                .join("");
        }

        const selKelas = document.getElementById("filterKelas");
        if (selKelas) {
            const tingkatAda = ["XII", "XI", "X"].filter(t => kelasList.some(k => Anggota.tingkatDariKelas(k.name) === t));
            let html = `<option value="">Semua kelas</option>`;
            if (tingkatAda.length) {
                html += `<optgroup label="Berdasarkan Tingkat">` +
                    tingkatAda.map(t => `<option value="tingkat:${t}">Semua Kelas ${t}</option>`).join("") +
                    `</optgroup>`;
            }
            if (kelasList.length) {
                html += `<optgroup label="Per Kelas">` +
                    kelasList.map(k => `<option value="${escapeHtml(k.name)}">${escapeHtml(k.name)} (${k.count})</option>`).join("") +
                    `</optgroup>`;
            }
            selKelas.innerHTML = html;
            selKelas.value = Anggota.kelas || "";
        }

        const selSort = document.getElementById("filterSort");
        if (selSort) selSort.value = Anggota.sort || "nama";
        try { window.Dropdown?.segarkanSemua?.(); } catch {}

        const clearBtn = document.getElementById("btnClearQ");
        if (clearBtn) clearBtn.style.display = String(Anggota.q || "").trim() ? "" : "none";

        document.querySelectorAll("#anggStatusChips [data-angg-status]").forEach(btn => {
            btn.classList.toggle("active", (btn.dataset.anggStatus || "semua") === Anggota.status);
        });

        const chipsEl = document.getElementById("filterChips");
        if (chipsEl) {
            const chips = [];
            if (String(Anggota.q || "").trim()) chips.push({ k: "q", l: `Cari: "${String(Anggota.q).trim()}"` });
            if (Anggota.status === "tertaut") chips.push({ k: "status", l: "Akun: Tertaut ✓" });
            else if (Anggota.status === "belum") chips.push({ k: "status", l: "Akun: Belum Tertaut" });
            if (Anggota.kelas) {
                const lblK = Anggota.kelas.startsWith("tingkat:") ? `Tingkat ${Anggota.kelas.slice(8)}` : Anggota.kelas;
                chips.push({ k: "kelas", l: `Kelas: ${lblK}` });
            }
            if (Anggota.jabatan) chips.push({ k: "jabatan", l: `Jabatan: ${Anggota.jabatan}` });
            if (Anggota.sort !== "nama") {
                const sMap = { "nama-desc": "Nama Z–A", kelas: "Kelas A–Z", jabatan: "Jabatan A–Z" };
                chips.push({ k: "sort", l: `Urut: ${sMap[Anggota.sort] || Anggota.sort}` });
            }
            chipsEl.innerHTML = chips.map(c =>
                `<button type="button" class="filter-chip" data-clear-filter="${c.k}" title="Hapus filter ini">${escapeHtml(c.l)} <i class="fa-solid fa-xmark"></i></button>`
            ).join("");
        }

        if (window.OsisSearch && window.OsisSearch.setCount) {
            const activeDrawer =
                (Anggota.status !== "semua" ? 1 : 0) +
                (Anggota.kelas ? 1 : 0) +
                (Anggota.jabatan ? 1 : 0) +
                (Anggota.sort !== "nama" ? 1 : 0);
            window.OsisSearch.setCount("#anggotaTopSearch", activeDrawer);
        }
    },

    // ============ RENDER SUMMARY + SIDEBAR ============
    renderRingkasan(all, kelasList, jabList) {
        const total = all.length;
        const tertaut = all.filter(Anggota.tertaut).length;
        const belum = total - tertaut;
        const pct = total ? Math.round((tertaut / total) * 100) : 0;

        const cntBadge = document.getElementById("anggotaCount");
        if (cntBadge) cntBadge.innerHTML = `<i class="fa-solid fa-users"></i> ${total} Anggota`;
        const perBadge = document.getElementById("anggotaPeriodeBadge");
        if (perBadge) perBadge.innerHTML = `<i class="fa-solid fa-calendar-days"></i> Periode ${Anggota.tahun ?? "-"}`;

        const pill = document.getElementById("statPeriodePill");
        if (pill) pill.textContent = `Periode ${Anggota.tahun ?? "-"}`;
        const heroTotal = document.getElementById("statTotalHero");
        if (heroTotal) heroTotal.textContent = `${total} Anggota`;
        const linkBar = document.getElementById("statLinkBar");
        if (linkBar) linkBar.style.width = `${pct}%`;
        const linkLbl = document.getElementById("statLinkLbl");
        if (linkLbl) linkLbl.textContent = `${tertaut} / ${total} tertaut akun`;
        const linkPct = document.getElementById("statLinkPct");
        if (linkPct) linkPct.textContent = `${pct}%`;
        const heroOk = document.getElementById("statHeroTertaut");
        if (heroOk) heroOk.textContent = `Tertaut: ${tertaut}`;
        const heroNo = document.getElementById("statHeroBelum");
        if (heroNo) heroNo.textContent = `Belum tertaut: ${belum}`;

        const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setEl("statJabatan", String(jabList.length));
        setEl("statJabatanSub", jabList[0] ? `terbanyak: ${jabList[0].name}` : "belum terdata");
        setEl("statTertaut", String(tertaut));
        setEl("statTertautSub", total ? `${pct}% terhubung` : "belum ada data");
        setEl("statBelum", String(belum));
        setEl("statBelumSub", belum ? "ketuk untuk saring" : "semua sudah tertaut");
        setEl("statKelas", String(kelasList.length));
        setEl("statKelasSub", kelasList[0] ? `terbanyak: ${kelasList[0].name}` : "belum terdata");

        document.getElementById("statCardTertaut")?.classList.toggle("active", Anggota.status === "tertaut");
        document.getElementById("statCardBelum")?.classList.toggle("active", Anggota.status === "belum");
    },

    renderBarList(el, items, total, opts) {
        if (!el) return;
        if (!items.length) {
            el.innerHTML = `<div class="osis-empty">${escapeHtml(opts.emptyText || "Belum ada data.")}</div>`;
            return;
        }
        const max = Math.max(...items.map(x => x.count), 1);
        el.innerHTML = items.map(item => {
            const pct = Math.round((item.count / max) * 100);
            const share = total ? Math.round((item.count / total) * 100) : 0;
            const active = opts.activeValue === item.name;
            return `<button type="button" class="angg-bar-btn${active ? " active" : ""}" ${opts.attr}="${escapeHtml(item.name)}" title="Klik untuk filter ${escapeHtml(item.name)}">
                <div class="angg-bar-top">
                    <span class="angg-bar-lbl">${escapeHtml(item.name)}</span>
                    <span class="angg-bar-val">${item.count} (${share}%)</span>
                </div>
                <div class="angg-bar-track"><span style="width:${pct}%"></span></div>
            </button>`;
        }).join("");
    },

    renderSidebar(all, kelasList, jabList) {
        const total = all.length;

        const kelasCnt = document.getElementById("anggKelasCnt");
        if (kelasCnt) kelasCnt.textContent = `${kelasList.length} kelas`;

        const tingkatEl = document.getElementById("anggTingkatChips");
        if (tingkatEl) {
            const tCounts = ["XII", "XI", "X"].map(t => ({
                t,
                n: all.filter(a => Anggota.tingkatDariKelas(a.kelas) === t).length
            })).filter(x => x.n > 0);
            tingkatEl.innerHTML = tCounts.length > 1
                ? `<button type="button" class="angg-tchip${!Anggota.kelas ? " active" : ""}" data-tingkat="">Semua</button>` +
                  tCounts.map(x => `<button type="button" class="angg-tchip${Anggota.kelas === `tingkat:${x.t}` ? " active" : ""}" data-tingkat="${x.t}">Kelas ${x.t} (${x.n})</button>`).join("")
                : "";
        }

        const isTingkat = Anggota.kelas.startsWith("tingkat:");
        const tSel = isTingkat ? Anggota.kelas.slice(8) : "";
        const kelasTampil = tSel ? kelasList.filter(k => Anggota.tingkatDariKelas(k.name) === tSel) : kelasList;
        Anggota.renderBarList(document.getElementById("anggKelasBars"), kelasTampil, total, {
            attr: "data-filter-kelas",
            activeValue: Anggota.kelas,
            emptyText: "Belum ada data kelas."
        });

        const jabCnt = document.getElementById("anggJabatanCnt");
        if (jabCnt) jabCnt.textContent = `${jabList.length} posisi`;
        Anggota.renderBarList(document.getElementById("anggJabatanBars"), jabList.slice(0, 10), total, {
            attr: "data-filter-jabatan",
            activeValue: Anggota.jabatan,
            emptyText: "Belum ada data jabatan."
        });

        const perPanel = document.getElementById("anggPeriodePanel");
        const perPills = document.getElementById("anggPeriodePills");
        const perCnt = document.getElementById("anggPeriodeCnt");
        if (perPanel && perPills) {
            if (Anggota.tahunList.length > 1) {
                perPanel.style.display = "";
                if (perCnt) perCnt.textContent = `${Anggota.tahunList.length} tahun`;
                const countPerTahun = new Map();
                Anggota.cache.forEach(a => {
                    const t = parseInt(a.tahun, 10);
                    countPerTahun.set(t, (countPerTahun.get(t) || 0) + 1);
                });
                perPills.innerHTML = Anggota.tahunList.map(t =>
                    `<button type="button" class="angg-per-pill${t === Anggota.tahun ? " active" : ""}" data-pilih-tahun="${t}">${t} <small>(${countPerTahun.get(t) || 0})</small></button>`
                ).join("");
            } else {
                perPanel.style.display = "none";
            }
        }
    },

    // ============ RENDER MAIN ROSTER ============
    render() {
        const all = Anggota.rowsPeriode();
        const kelasList = Anggota.hitungGrup(all, a => a.kelas);
        const jabList = Anggota.hitungGrup(all, a => a.jabatan);

        if (Anggota.jabatan && !jabList.some(j => j.name === Anggota.jabatan)) {
            Anggota.jabatan = "";
        }

        Anggota.sinkronFilterUi(kelasList);
        Anggota.renderRingkasan(all, kelasList, jabList);
        Anggota.renderSidebar(all, kelasList, jabList);

        const boleh = OsisAuth.bisa("anggota");
        const rows = Anggota.rowsTampil(all);
        const filtering = Anggota.hasActiveFilter();
        const needLimit = !filtering && !Anggota.tampilSemua && rows.length > Anggota.DEFAULT_LIMIT;
        const shown = needLimit ? rows.slice(0, Anggota.DEFAULT_LIMIT) : rows;
        const adaAksi = shown.length ? shown.some(a => Anggota.bisaBaris(a)) : boleh;

        document.getElementById("btnViewCard")?.classList.toggle("active", Anggota.viewMode === "card");
        document.getElementById("btnViewTable")?.classList.toggle("active", Anggota.viewMode === "table");

        const listCount = document.getElementById("anggListCount");
        if (listCount) {
            if (rows.length > shown.length) listCount.textContent = `${shown.length}/${rows.length} (${all.length} total)`;
            else if (rows.length !== all.length) listCount.textContent = `${rows.length} dari ${all.length}`;
            else listCount.textContent = `${all.length} anggota`;
        }
        const listSub = document.getElementById("anggListSub");
        if (listSub) {
            listSub.textContent = all.length
                ? `Periode ${Anggota.tahun ?? "-"} · Ketuk baris untuk lihat detail`
                : `Belum ada roster pada periode ${Anggota.tahun ?? "-"}`;
        }

        const head = document.getElementById("anggotaHead");
        const body = document.getElementById("anggotaRows");
        const moreBar = document.getElementById("anggotaMoreBar");
        const empty = document.getElementById("anggotaEmpty");
        if (!body) return;

        if (!all.length) {
            if (head) head.style.display = "none";
            body.innerHTML = "";
            if (moreBar) moreBar.innerHTML = "";
            if (empty) {
                empty.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:24px 14px">
                    <b>Belum ada anggota di periode ${Anggota.tahun}.</b>
                    ${boleh ? `<div style="margin-top:10px"><button type="button" class="btn btn-red btn-sm" onclick="Anggota.bukaForm(null)"><i class="fa-solid fa-plus"></i> Tambah Anggota Pertama</button></div>` : ""}
                </div>`;
            }
            return;
        }

        if (!rows.length) {
            if (head) head.style.display = "none";
            body.innerHTML = "";
            if (moreBar) moreBar.innerHTML = "";
            if (empty) {
                empty.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:22px 12px">
                    <i class="fa-solid fa-magnifying-glass"></i> Tidak ada anggota yang cocok dengan filter aktif.
                    <div style="margin-top:10px"><button type="button" class="btn btn-white btn-sm" onclick="Anggota.resetFilter()"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button></div>
                </div>`;
            }
            return;
        }

        if (empty) empty.innerHTML = "";

        if (Anggota.viewMode === "table") {
            if (head) {
                head.style.display = "";
                head.className = "angg-head" + (adaAksi ? "" : " no-aksi");
                head.innerHTML = `<span>No</span><span></span><span>Nama</span><span>Jabatan</span><span>Kelas</span><span>Username</span>${adaAksi ? `<span style="text-align:right">Aksi</span>` : ""}`;
            }
            body.className = "";
            body.innerHTML = shown.map((a, i) => {
                const kelola = Anggota.bisaBaris(a);
                const linked = Anggota.tertaut(a);
                const saya = Anggota.isSaya(a);
                const meta = [a.jabatan, a.kelas, linked ? "@" + a.username : "Belum tertaut"]
                    .filter(s => String(s || "").trim()).map(s => escapeHtml(s)).join(" · ") || "-";
                return `<div class="angg-row${adaAksi ? "" : " no-aksi"}${linked ? " linked" : ""}${saya ? " saya" : ""}" data-detail="${a.id}">
                    <span class="num">${i + 1}</span>
                    <span class="ava">${escapeHtml(Anggota.initial(a.nama))}</span>
                    <div class="main"><b>${escapeHtml(a.nama || "-")}${saya ? ` <span class="angg-tag-saya">Saya</span>` : ""}</b><small class="meta">${meta}</small></div>
                    <span class="c-jab">${escapeHtml(a.jabatan || "-")}</span>
                    <span class="c-kelas">${escapeHtml(a.kelas || "-")}</span>
                    <span class="c-user">${linked ? `<span class="uname">@${escapeHtml(a.username)}</span>` : `<span class="uname kosong">Belum tertaut</span>`}</span>
                    ${adaAksi ? (kelola
                        ? `<span class="aksi"><button type="button" class="btn btn-white btn-sm" data-edit="${a.id}" title="Edit"><i class="fa-solid fa-pen"></i></button><button type="button" class="btn btn-red btn-sm" data-del="${a.id}" title="Hapus"><i class="fa-solid fa-trash-can"></i></button></span>`
                        : `<span class="aksi"><span title="Angkatan lain — hanya lihat" style="color:var(--gray);font-size:.78rem;padding:0 6px"><i class="fa-solid fa-lock"></i></span></span>`) : ""}
                </div>`;
            }).join("");
        } else {
            if (head) head.style.display = "none";
            body.className = "angg-cards";
            body.innerHTML = shown.map(a => {
                const kelola = Anggota.bisaBaris(a);
                const linked = Anggota.tertaut(a);
                const saya = Anggota.isSaya(a);
                const lockBadge = (OsisAuth.bisa("anggota") && !kelola)
                    ? `<span title="Angkatan lain — hanya lihat" style="color:var(--gray);font-size:.76rem"><i class="fa-solid fa-lock"></i></span>`
                    : "";
                return `<div class="angg-item${linked ? " linked" : " unlinked"}${saya ? " saya" : ""}" data-detail="${a.id}">
                    <span class="angg-ava">${escapeHtml(Anggota.initial(a.nama))}</span>
                    <div class="angg-item-body">
                        <div class="angg-name-row">
                            <b>${escapeHtml(a.nama || "-")}</b>
                            ${saya ? `<span class="angg-tag-saya">Saya</span>` : ""}
                            ${lockBadge}
                        </div>
                        <div class="angg-pills">
                            <span class="angg-pill jab"><i class="fa-solid fa-id-badge"></i> ${escapeHtml(a.jabatan || "Tanpa jabatan")}</span>
                            <span class="angg-pill kelas"><i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(a.kelas || "-")}</span>
                            ${linked
                                ? `<span class="angg-pill user-ok"><i class="fa-solid fa-at"></i> ${escapeHtml(a.username)}</span>`
                                : `<span class="angg-pill user-no"><i class="fa-solid fa-link-slash"></i> Belum tertaut</span>`}
                        </div>
                    </div>
                    <div class="angg-item-right">
                        ${kelola ? `
                            <button type="button" class="btn btn-white btn-sm" data-edit="${a.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="btn btn-red btn-sm" data-del="${a.id}" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
                        ` : ""}
                        <i class="fa-solid fa-chevron-right angg-chev" aria-hidden="true"></i>
                    </div>
                </div>`;
            }).join("");
        }

        if (moreBar) {
            if (!filtering && rows.length > Anggota.DEFAULT_LIMIT) {
                const sisa = rows.length - Anggota.DEFAULT_LIMIT;
                moreBar.innerHTML = `<div class="angg-expand-bar">
                    <button type="button" class="btn btn-white btn-sm" id="btnToggleMore">
                        ${Anggota.tampilSemua
                            ? `<i class="fa-solid fa-chevron-up"></i> Ringkas (${Anggota.DEFAULT_LIMIT} teratas)`
                            : `<i class="fa-solid fa-chevron-down"></i> Tampilkan semua (+${sisa} anggota)`}
                    </button>
                </div>`;
            } else {
                moreBar.innerHTML = "";
            }
        }
    },

    // ============ POPUP DETAIL ANGGOTA (.osis-det-*) ============
    bukaDetail(id) {
        const a = Anggota.cache.find(x => String(x.id) === String(id));
        if (!a) return;
        Anggota.detailId = a.id;

        const linked = Anggota.tertaut(a);
        const saya = Anggota.isSaya(a);
        const kelola = Anggota.bisaBaris(a);
        const lvl = Anggota.tingkatDariKelas(a.kelas);

        const titleEl = document.getElementById("anggotaDetailTitle");
        if (titleEl) titleEl.textContent = "Detail Anggota";

        const body = document.getElementById("anggotaDetailBody");
        if (body) {
            const chips = [
                `<span class="osis-det-chip yellow"><i class="fa-solid fa-calendar-days"></i> Periode ${escapeHtml(String(a.tahun ?? Anggota.tahun ?? "-"))}</span>`,
                linked
                    ? `<span class="osis-det-chip green"><i class="fa-solid fa-link"></i> Akun Tertaut</span>`
                    : `<span class="osis-det-chip red"><i class="fa-solid fa-link-slash"></i> Belum Tertaut</span>`,
                saya ? `<span class="osis-det-chip ink"><i class="fa-solid fa-user-check"></i> Akun Saya</span>` : ""
            ].filter(Boolean).join("");

            const alertHtml = linked
                ? `<div class="osis-det-alert ok"><i class="fa-solid fa-circle-check"></i><span>Username <b>@${escapeHtml(a.username)}</b> sudah tertaut untuk pengenalan profil, absensi, &amp; modul terkait.</span></div>`
                : `<div class="osis-det-alert warn"><i class="fa-solid fa-triangle-exclamation"></i><span>Belum ada username penaut akun. Isi kolom username pada form Edit (samakan dengan username login) agar anggota terhubung ke profil OSIS.</span></div>`;

            body.innerHTML = `
                <div class="osis-det-hero">
                    <div class="osis-det-hero-row">
                        <span class="angg-det-ava ${linked ? "linked" : "unlinked"}">${escapeHtml(Anggota.initial(a.nama))}</span>
                        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px">
                            <div class="osis-det-chips">${chips}</div>
                            <h4 class="osis-det-title">${escapeHtml(a.nama || "-")}</h4>
                            <p class="osis-det-sub">${escapeHtml(a.jabatan || "Tanpa jabatan")}${a.kelas ? " · " + escapeHtml(a.kelas) : ""}</p>
                        </div>
                    </div>
                </div>
                <div class="osis-det-grid">
                    <div class="osis-det-kv">
                        <div class="osis-det-kv-top"><span class="osis-det-kv-ico t-blue"><i class="fa-solid fa-id-badge"></i></span><span class="k">Jabatan</span></div>
                        <span class="v">${escapeHtml(a.jabatan || "-")}</span>
                    </div>
                    <div class="osis-det-kv">
                        <div class="osis-det-kv-top"><span class="osis-det-kv-ico t-amber"><i class="fa-solid fa-graduation-cap"></i></span><span class="k">Kelas${lvl ? ` (${lvl})` : ""}</span></div>
                        <span class="v">${escapeHtml(a.kelas || "-")}</span>
                    </div>
                    <div class="osis-det-kv">
                        <div class="osis-det-kv-top"><span class="osis-det-kv-ico ${linked ? "t-green" : "t-red"}"><i class="fa-solid fa-at"></i></span><span class="k">Username Akun</span></div>
                        <span class="v">${linked ? "@" + escapeHtml(a.username) : "Belum ditautkan"}</span>
                    </div>
                    <div class="osis-det-kv">
                        <div class="osis-det-kv-top"><span class="osis-det-kv-ico t-ink"><i class="fa-solid fa-calendar"></i></span><span class="k">Periode Roster</span></div>
                        <span class="v">Periode ${escapeHtml(String(a.tahun ?? "-"))}</span>
                    </div>
                </div>
                ${alertHtml}
            `;
        }

        const btnEdit = document.getElementById("btnDetEdit");
        const btnHapus = document.getElementById("btnDetHapus");
        if (btnEdit) btnEdit.style.display = kelola ? "" : "none";
        if (btnHapus) btnHapus.style.display = kelola ? "" : "none";

        const modal = document.getElementById("anggotaDetail");
        if (modal) {
            modal.classList.add("open");
            modal.setAttribute("aria-hidden", "false");
            document.body.style.overflow = "hidden";
        }
    },

    tutupDetail() {
        const modal = document.getElementById("anggotaDetail");
        if (modal) {
            modal.classList.remove("open");
            modal.setAttribute("aria-hidden", "true");
        }
        Anggota.detailId = null;
        document.body.style.overflow = "";
    },

    angkatanIdUntukTahun(tahun) {
        const list = (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanList) ? (OsisAuth.getAngkatanList() || []) : [];
        const t = parseInt(tahun, 10);
        if (typeof OsisAuth !== "undefined" && OsisAuth.isLintasAngkatan && OsisAuth.isLintasAngkatan()) {
            const match = Number.isFinite(t)
                ? (list.find(a => Number(a.tahun) === t) || (t <= 2024 ? list.find(a => String(a.kode || "").toUpperCase().includes("ARSIP")) : null))
                : null;
            if (match && match.id) return match.id;
        }
        return (typeof DbScope !== "undefined" && DbScope.angkatanId) ? DbScope.angkatanId() : null;
    },

    // ============ PERIODE ============
    async tambahPeriode() {
        if (!OsisAuth.butuh("anggota")) return;
        const res = await showPopup("Tambah periode", "form", {
            title: "Periode Baru",
            fields: [{ name: "tahun", label: "Tahun (cth: 2026)", type: "text", placeholder: "2026", value: "" }]
        });
        if (!res) return;
        const thn = parseInt(String(res.tahun || "").trim(), 10);
        if (!Number.isFinite(thn) || thn < 2000 || thn > 2100) {
            showToast("Tahun 2000-2100", "error");
            return;
        }
        if (!Anggota.tahunList.includes(thn)) {
            Anggota.tahunList.push(thn);
            Anggota.tahunList.sort((a, b) => b - a);
        }
        Anggota.tahun = thn;
        Anggota.tampilSemua = false;
        Anggota.render();
        showToast(`Periode ${thn} siap — tambah anggota sekarang`, "info");
    },

    // ============ TAMBAH / EDIT (popup form bawaan, 4 field) ============
    async bukaForm(id) {
        if (!OsisAuth.butuh("anggota")) return;
        const item = id ? Anggota.cache.find(a => String(a.id) === String(id)) : null;
        if (id && !item) return;
        if (item && typeof OsisAngkatanUi !== "undefined" && !OsisAngkatanUi.bisaKelolaItem("anggota", item)) {
            showToast("Data anggota ini milik angkatan lain (hanya lihat).", "info");
            return;
        }
        if (!item && typeof OsisAuth !== "undefined" && !(OsisAuth.isLintasAngkatan && OsisAuth.isLintasAngkatan())) {
            const list = OsisAuth.getAngkatanList ? (OsisAuth.getAngkatanList() || []) : [];
            const myAngId = OsisAuth.getAngkatanAktif ? OsisAuth.getAngkatanAktif() : null;
            const t = parseInt(Anggota.tahun, 10);
            const targetAng = Number.isFinite(t)
                ? (list.find(a => Number(a.tahun) === t) || (t <= 2024 ? list.find(a => String(a.kode || "").toUpperCase().includes("ARSIP")) : null))
                : null;
            if (myAngId && targetAng && String(targetAng.id) !== String(myAngId)) {
                showToast(`Periode ${Anggota.tahun} milik ${targetAng.nama || "angkatan lain"} (hanya lihat).`, "info");
                return;
            }
        }
        const res = await showPopup(item ? "Edit anggota" : "Tambah anggota", "form", {
            title: item ? "Edit Anggota" : "Tambah Anggota",
            fields: [
                { name: "nama", label: "Nama lengkap", type: "text", placeholder: "cth: Asep Muhammad", value: item ? (item.nama || "") : "" },
                { name: "jabatan", label: "Jabatan", type: "text", placeholder: "cth: Ketua Sekbid 1", value: item ? (item.jabatan || "") : "" },
                { name: "kelas", label: "Kelas", type: "text", placeholder: "cth: XII RPL 1", value: item ? (item.kelas || "") : "" },
                { name: "username", label: "Username akun (penaut card)", type: "text", placeholder: "samakan dengan username login ybs", value: item ? (item.username || "") : "" }
            ]
        });
        if (!res) return;
        const nama = String(res.nama || "").trim().slice(0, 80);
        const jabatan = String(res.jabatan || "").trim().slice(0, 80);
        const kelas = String(res.kelas || "").trim().slice(0, 40);
        const username = String(res.username || "").trim().slice(0, 60);
        if (!nama) { showToast("Nama wajib diisi", "error"); return; }

        const angIdTarget = item ? (item.angkatan_id || null) : Anggota.angkatanIdUntukTahun(Anggota.tahun);
        const spec = () => ({
            modul: "anggota", op: item ? "update" : "create",
            label: "Anggota: " + nama.slice(0, 42),
            payload: item
                ? { id: item.id, tahun: Anggota.tahun, nama, jabatan, kelas, username }
                : { id: null, tahun: Anggota.tahun, nama, jabatan, kelas, username, angkatan_id: angIdTarget },
            files: [], cacheKeys: ["anggota"]
        });
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(spec()); }
            catch (e) { showToast(e.message, "error"); return; }
            return;
        }
        try {
            if (item) {
                await updateAnggota(item.id, { nama, jabatan, kelas, username });
                showToast("Anggota diperbarui!", "success");
            } else {
                await tambahAnggota({ tahun: Anggota.tahun, nama, jabatan, kelas, username, angkatan_id: angIdTarget });
                showToast("Anggota ditambah!", "success");
            }
            try { catatAksi("simpan_anggota", nama); } catch {}
            const fresh = await getAnggota();
            Cache.set("anggota", fresh);
            Anggota.pakai(fresh || []);
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, spec())) return;
            showToast("Gagal simpan: " + err.message, "error");
        }
    },

    async hapus(id) {
        if (!OsisAuth.butuh("anggota")) return;
        const item = Anggota.cache.find(a => String(a.id) === String(id));
        if (item && typeof OsisAngkatanUi !== "undefined" && !OsisAngkatanUi.bisaKelolaItem("anggota", item)) {
            showToast("Data anggota ini milik angkatan lain (hanya lihat).", "info");
            return;
        }
        const yakin = await showPopup(`Hapus ${item ? escapeHtml(item.nama) : "anggota ini"} dari periode ${Anggota.tahun}?`, "confirm");
        if (!yakin) return;
        try {
            await hapusAnggota(id);
            if (String(Anggota.detailId) === String(id)) Anggota.tutupDetail();
            Anggota.cache = Anggota.cache.filter(a => String(a.id) !== String(id));
            try { Cache.set("anggota", Anggota.cache); } catch {}
            try { catatAksi("hapus_anggota", item ? item.nama : String(id)); } catch {}
            showToast("Anggota dihapus", "success");
            Anggota.pakai(Anggota.cache);
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    }
};

document.addEventListener("DOMContentLoaded", () => Anggota.init());
