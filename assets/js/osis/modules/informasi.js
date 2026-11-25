// =========================================================================
// INFORMASI HARIAN — pengganti broadcast grup (/osis/informasi)
// Mode Daftar (search/filter + spotlight + kartu broadcast) & Mode Single (?id=).
// Kelola butuh hak "informasi". Wajib login OSIS (internal pengurus).
// =========================================================================

const Informasi = {
    cache: [],
    offset: 0,
    habis: false,
    loading: false,
    perPage: 200,
    terinisialisasi: false,
    editingId: null,
    _lastSingle: null,

    // Filter & sort UI state (untuk mode daftar)
    q: "",
    jenis: "semua", // semua | jadwal | umum
    sort: "baru",   // baru | lama | judul

    init() {
        if (Informasi.terinisialisasi) return;
        Informasi.terinisialisasi = true;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        if (typeof OsisAuth.refreshAkses === "function") {
            OsisAuth.refreshAkses().then(() => { Informasi.cekLogin(); Informasi.muat(); }).catch(() => {});
        }

        document.getElementById("filterQ")?.addEventListener("input", (e) => {
            Informasi.q = e.target.value || "";
            Informasi.tampilDaftar();
        });
        document.getElementById("btnClearQ")?.addEventListener("click", () => {
            const inp = document.getElementById("filterQ");
            if (inp) { inp.value = ""; inp.focus(); }
            Informasi.q = "";
            Informasi.tampilDaftar();
        });
        document.getElementById("infoJenisChips")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-info-jenis]");
            if (!btn) return;
            Informasi.jenis = btn.dataset.infoJenis || "semua";
            Informasi.tampilDaftar();
        });
        document.getElementById("filterSort")?.addEventListener("change", (e) => {
            Informasi.sort = e.target.value || "baru";
            Informasi.tampilDaftar();
        });
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Informasi.resetFilter());
        document.getElementById("filterChips")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-clear-filter]");
            if (!btn) return;
            const k = btn.dataset.clearFilter;
            if (k === "q") {
                const inp = document.getElementById("filterQ");
                if (inp) inp.value = "";
                Informasi.q = "";
            } else if (k === "jenis") {
                Informasi.jenis = "semua";
            } else if (k === "sort") {
                Informasi.sort = "baru";
            }
            Informasi.tampilDaftar();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && document.getElementById("infoFormOverlay")?.classList.contains("open")) {
                Informasi.tutupForm();
            }
        });

        Informasi.cekLogin();
        Informasi.muat();
        window.addEventListener("osis:angkatan-ready", () => {
            try {
                if (Informasi.idDariUrl() && Informasi._lastSingle) Informasi.tampilSatu(Informasi._lastSingle);
                else if (!Informasi.idDariUrl()) Informasi.tampilDaftar();
            } catch {}
        });
    },

    bolehKelola() {
        return !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("informasi"));
    },

    cekLogin() {
        const btn = document.getElementById("btnTambahInfo");
        if (btn) btn.style.display = (!Informasi.idDariUrl() && Informasi.bolehKelola()) ? "" : "none";
    },

    idDariUrl() {
        try {
            const v = new URLSearchParams(location.search).get("id");
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch { return null; }
    },

    linkUntuk(id) {
        return location.origin + location.pathname + "?id=" + id;
    },

    cariItem(id) {
        const found = (Informasi.cache || []).find(x => String(x.id) === String(id));
        if (found) return found;
        if (Informasi._lastSingle && String(Informasi._lastSingle.id) === String(id)) return Informasi._lastSingle;
        return null;
    },

    punyaJadwal(it) {
        return !!(it && (String(it.tanggal || "").trim() || String(it.jam || "").trim() || String(it.tempat || "").trim()));
    },

    fmtTerbit(iso) {
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return "";
            const tgl = d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
            const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(":", ".");
            return `${tgl} pukul ${jam}`;
        } catch { return ""; }
    },

    fmtTerbitPendek(iso) {
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return "";
            return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return ""; }
    },

    resetFilter() {
        const inp = document.getElementById("filterQ");
        if (inp) inp.value = "";
        Informasi.q = "";
        Informasi.jenis = "semua";
        Informasi.sort = "baru";
        Informasi.tampilDaftar();
    },

    // ============ MUAT: single card (?id=) atau daftar ============
    async muat() {
        const id = Informasi.idDariUrl();
        document.getElementById("infoPageWrap")?.classList.toggle("is-single", !!id);
        Informasi.cekLogin();
        if (id) { await Informasi.muatSatu(id); return; }
        await Informasi.muatDaftar();
    },

    async muatSatu(id) {
        const wrap = document.getElementById("infoWrap");
        if (!wrap) return;
        const kunci = "informasi-" + id;
        const cached = Cache.get(kunci);
        if (cached) {
            Informasi.tampilSatu(cached);
            getInformasi(id).then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    if (fresh) Cache.set(kunci, fresh);
                    Informasi.tampilSatu(fresh);
                }
            }).catch(() => {});
            return;
        }
        wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat informasi...</div>`;
        try {
            const item = await getInformasi(id);
            if (item) Cache.set(kunci, item);
            Informasi.tampilSatu(item);
        } catch (err) {
            console.error(err);
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat. Cek koneksi.</div>`;
        }
    },

    // Helper render kartu resmi: dipakai mode Single (?id=) sekaligus Live Preview di form.
    kartuHtml(item, opts) {
        const preview = !!(opts && opts.preview);
        const judul = String(item?.judul || "").trim() || (preview ? "Judul Pengumuman" : "Informasi");
        const sub = String(item?.subjudul || "").trim();
        const kepada = String(item?.kepada || "").trim();
        const pembuka = String(item?.pembuka || "").trim();
        const penutup = String(item?.penutup || "").trim();
        const tgl = String(item?.tanggal || "").trim();
        const jam = String(item?.jam || "").trim();
        const tmp = String(item?.tempat || "").trim();
        const bawa = String(item?.bawaan || "").trim();

        const hasGrid = !!(tgl || jam || tmp || bawa);
        const gridHtml = hasGrid ? `
            <div class="info-grid">
                ${tgl ? `<div class="ig-cell"><span class="ig-ico ig-blue"><i class="fa-solid fa-calendar-days"></i></span><span class="ig-lbl">Tanggal</span><b>${escapeHtml(tgl)}</b></div>` : ""}
                ${jam ? `<div class="ig-cell"><span class="ig-ico ig-pink"><i class="fa-regular fa-clock"></i></span><span class="ig-lbl">Waktu</span><b>${escapeHtml(jam)}</b></div>` : ""}
                ${tmp ? `<div class="ig-cell"><span class="ig-ico ig-green"><i class="fa-solid fa-location-dot"></i></span><span class="ig-lbl">Tempat</span><b>${escapeHtml(tmp)}</b></div>` : ""}
                ${bawa ? `<div class="ig-cell"><span class="ig-ico ig-orange"><i class="fa-solid fa-triangle-exclamation"></i></span><span class="ig-lbl">Persiapan</span><b>${escapeHtml(bawa)}</b></div>` : ""}
            </div>` : "";

        let footHtml = "";
        if (!preview) {
            const kelola = typeof OsisAngkatanUi !== "undefined"
                ? OsisAngkatanUi.bisaKelolaItem("informasi", item)
                : Informasi.bolehKelola();
            const oleh = typeof olehLabel === "function" ? olehLabel(item) : "";
            footHtml = `
                <div class="info-foot">
                    <span class="info-ava"><i class="fa-solid fa-user"></i></span>
                    <span class="info-terbit">Diterbitkan ${escapeHtml(Informasi.fmtTerbit(item.created_at))} ${oleh}<br>OSIS TARPAN ONE</span>
                    <div class="info-actions">
                        <button type="button" class="btn btn-red btn-sm" onclick="Informasi.salinLink(${item.id})"><i class="fa-solid fa-link"></i> Salin Link</button>
                        <button type="button" class="btn btn-white btn-sm" onclick="Informasi.salinTeks(${item.id})"><i class="fa-regular fa-copy"></i> Salin Teks WA</button>
                        <button type="button" class="btn btn-white btn-sm" onclick="Informasi.bagiWA(${item.id})"><i class="fa-brands fa-whatsapp"></i> Bagikan WA</button>
                        ${kelola ? `<button type="button" class="btn btn-white btn-sm" onclick="Informasi.bukaForm(${item.id})"><i class="fa-solid fa-pen"></i> Ubah</button>` : ""}
                        ${kelola ? `<button type="button" class="btn btn-white btn-sm" onclick="Informasi.hapus(${item.id})"><i class="fa-solid fa-trash-can"></i> Hapus</button>` : ""}
                    </div>
                </div>`;
        }

        return `
            <article class="info-card${preview ? " info-preview-card" : ""}">
                <div class="info-top">
                    <span class="info-kicker"><i class="fa-solid fa-thumbtack"></i> PENGUMUMAN KEGIATAN</span>
                    <span class="info-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                </div>
                <h1 class="info-judul">${escapeHtml(judul)}</h1>
                ${sub ? `<div class="info-sub">(${escapeHtml(sub)})</div>` : ""}
                ${kepada ? `<div class="info-kepada"><span class="ik-ico"><i class="fa-solid fa-people-group"></i></span><span>Kepada: <b>${escapeHtml(kepada)}</b></span></div>` : ""}
                ${pembuka ? `<p class="info-text">${escapeHtml(pembuka)}</p>` : ""}
                ${gridHtml}
                ${penutup ? `<p class="info-text">${escapeHtml(penutup)}</p>` : ""}
                ${footHtml}
            </article>`;
    },

    tampilSatu(item) {
        const wrap = document.getElementById("infoWrap");
        if (!wrap) return;
        document.getElementById("infoPageWrap")?.classList.add("is-single");
        document.getElementById("btnTambahInfo")?.style.setProperty("display", "none");
        if (!item) {
            wrap.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:26px 14px"><i class="fa-solid fa-circle-info"></i> Informasi tidak ditemukan (mungkin sudah dihapus).</div>
                <div style="text-align:center;margin-top:12px"><a class="btn btn-white btn-sm" href="informasi"><i class="fa-solid fa-arrow-left"></i> Lihat daftar informasi</a></div>`;
            return;
        }
        Informasi._lastSingle = item;
        try { document.title = item.judul + " — Informasi OSIS TARPAN ONE"; } catch {}
        wrap.innerHTML = `
            <div class="info-single-bar">
                <a class="btn btn-white btn-sm" href="informasi"><i class="fa-solid fa-arrow-left"></i> Semua Informasi</a>
                <span class="osis-badge"><i class="fa-solid fa-share-nodes"></i> Kartu Shareable</span>
            </div>
            ${Informasi.kartuHtml(item, { preview: false })}`;
    },

    // Daftar paginasi hemat egress (200/fetch) + infinite scroll.
    async muatDaftar(awal = true) {
        const wrap = document.getElementById("infoWrap");
        if (!wrap) return;
        if (Informasi.loading) return;
        if (!awal && Informasi.habis) return;
        Informasi.loading = true;
        if (awal) {
            Informasi.offset = 0;
            Informasi.habis = false;
            const cached = Cache.get("informasi");
            if (cached && cached.length) {
                Informasi.cache = cached.slice();
                try { Informasi.tampilDaftar(); } catch {}
            } else {
                Informasi.cache = [];
                wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat informasi...</div>`;
            }
        } else {
            const btn = document.getElementById("infoLagi");
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...'; }
        }
        try {
            if (awal && typeof navigator !== "undefined" && navigator.onLine === false && Informasi.cache.length) {
                Informasi.offset = Informasi.cache.length;
                Informasi.habis = true;
                Informasi.tampilDaftar();
                return;
            }
            const rows = await getInformasiList(Informasi.perPage, Informasi.offset);
            if (awal) Informasi.cache = [];
            const ada = new Set(Informasi.cache.map(x => String(x.id)));
            (rows || []).forEach(x => {
                if (!ada.has(String(x.id))) { ada.add(String(x.id)); Informasi.cache.push(x); }
            });
            Informasi.offset = Informasi.cache.length;
            if (!rows || rows.length < Informasi.perPage) {
                Informasi.habis = true;
                Cache.set("informasi", Informasi.cache);
            } else if (awal) {
                try { simpanListCache("informasi", Informasi.cache, false); } catch {}
            }
            Informasi.tampilDaftar();
        } catch (err) {
            console.error(err);
            const isOff = typeof adalahOfflineErr === "function" && adalahOfflineErr(err);
            if (awal && !Informasi.cache.length) {
                wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat. Cek koneksi.<br><br><button class="btn btn-red btn-sm" onclick="Informasi.muat()"><i class="fa-solid fa-rotate-right"></i> Coba Lagi</button></div>`;
            } else if (!isOff && awal) {
                showToast("Gagal refresh, tampil data lama.", "error");
            } else if (!isOff) {
                showToast("Gagal muat lanjutan informasi.", "error");
                try { Informasi.tampilDaftar(); } catch {}
            }
        } finally {
            Informasi.loading = false;
        }
    },

    jejaki() {
        try { if (Informasi._io) Informasi._io.disconnect(); } catch {}
        Informasi._io = null;
        let io = null;
        try {
            if (!Informasi.habis && typeof pasangSentinel === "function") {
                io = pasangSentinel("infoSentinel", () => Informasi.muatDaftar(false));
            }
        } catch { io = null; }
        Informasi._io = io;
        const btn = document.getElementById("infoLagi");
        if (btn) btn.style.display = (!io && !Informasi.habis && (Informasi.cache || []).length) ? "" : "none";
    },

    // ============ FILTER, RINGKASAN HERO, SPOTLIGHT SIDEBAR ============
    hasActiveFilter() {
        return !!(String(Informasi.q || "").trim() || Informasi.jenis !== "semua" || Informasi.sort !== "baru");
    },

    dataTampil(data) {
        const q = String(Informasi.q || "").trim().toLowerCase();
        const filtered = (data || []).filter(it => {
            if (Informasi.jenis === "jadwal" && !Informasi.punyaJadwal(it)) return false;
            if (Informasi.jenis === "umum" && Informasi.punyaJadwal(it)) return false;
            if (!q) return true;
            return [it.judul, it.subjudul, it.kepada, it.pembuka, it.penutup, it.tanggal, it.tempat, it.bawaan, it.pengunggah]
                .some(v => String(v || "").toLowerCase().includes(q));
        });

        filtered.sort((a, b) => {
            if (Informasi.sort === "judul") {
                return String(a.judul || "").localeCompare(String(b.judul || ""), "id");
            }
            const ta = new Date(a.created_at || 0).getTime() || 0;
            const tb = new Date(b.created_at || 0).getTime() || 0;
            return Informasi.sort === "lama" ? ta - tb : tb - ta;
        });
        return filtered;
    },

    sinkronFilterUi(all, shown) {
        const sortSel = document.getElementById("filterSort");
        if (sortSel) sortSel.value = Informasi.sort || "baru";
        try { window.Dropdown?.segarkanSemua?.(); } catch {}

        const clr = document.getElementById("btnClearQ");
        if (clr) clr.style.display = String(Informasi.q || "").trim() ? "" : "none";

        document.querySelectorAll("#infoJenisChips [data-info-jenis]").forEach(btn => {
            btn.classList.toggle("active", (btn.dataset.infoJenis || "semua") === Informasi.jenis);
        });

        const chipsEl = document.getElementById("filterChips");
        if (chipsEl) {
            const chips = [];
            if (String(Informasi.q || "").trim()) chips.push({ k: "q", l: `Cari: "${String(Informasi.q).trim()}"` });
            if (Informasi.jenis === "jadwal") chips.push({ k: "jenis", l: "Jenis: Ada Jadwal" });
            else if (Informasi.jenis === "umum") chips.push({ k: "jenis", l: "Jenis: Umum" });
            if (Informasi.sort !== "baru") {
                const sMap = { lama: "Terlama", judul: "Judul A–Z" };
                chips.push({ k: "sort", l: `Urut: ${sMap[Informasi.sort] || Informasi.sort}` });
            }
            chipsEl.innerHTML = chips.map(c =>
                `<button type="button" class="filter-chip" data-clear-filter="${c.k}" title="Hapus filter ini">${escapeHtml(c.l)} <i class="fa-solid fa-xmark"></i></button>`
            ).join("");
        }

        if (window.OsisSearch && window.OsisSearch.setCount) {
            const activeDrawer =
                (Informasi.jenis !== "semua" ? 1 : 0) +
                (Informasi.sort !== "baru" ? 1 : 0);
            window.OsisSearch.setCount("#infoTopSearch", activeDrawer);
        }

        const totalAll = all.length;
        const terjadwalAll = all.filter(it => Informasi.punyaJadwal(it)).length;
        const totBadge = document.getElementById("infoTotalBadge");
        if (totBadge) totBadge.innerHTML = `<i class="fa-solid fa-bullhorn"></i> ${totalAll} Broadcast`;
        const jBadge = document.getElementById("infoJadwalBadge");
        if (jBadge) jBadge.innerHTML = `<i class="fa-solid fa-calendar-check"></i> ${terjadwalAll} berjadwal`;

        const listCnt = document.getElementById("infoListCount");
        if (listCnt) {
            listCnt.textContent = (shown.length !== totalAll)
                ? `${shown.length} dari ${totalAll}`
                : `${totalAll} info`;
        }
        const listSub = document.getElementById("infoListSub");
        if (listSub) {
            listSub.textContent = totalAll
                ? "Ketuk kartu untuk baca penuh atau langsung salin ke grup"
                : "Belum ada broadcast tersimpan";
        }
    },

    renderSidebar(all) {
        let sumber = all || [];
        if (typeof OsisAngkatanUi !== "undefined" && OsisAngkatanUi.pisah) {
            const sp = OsisAngkatanUi.pisah(sumber);
            if (sp && sp.ownItems && sp.ownItems.length) sumber = sp.ownItems;
        }
        const sorted = sumber.slice().sort((a, b) => (new Date(b.created_at || 0).getTime() || 0) - (new Date(a.created_at || 0).getTime() || 0));

        const spotBody = document.getElementById("infoSpotlightBody");
        const latestTag = document.getElementById("infoLatestTag");
        if (spotBody) {
            const latest = sorted[0];
            if (!latest) {
                if (latestTag) latestTag.textContent = "-";
                spotBody.innerHTML = `<div class="osis-empty">Belum ada broadcast untuk disorot.</div>`;
            } else {
                if (latestTag) latestTag.textContent = Informasi.fmtTerbitPendek(latest.created_at) || "Baru";
                const metaParts = [
                    latest.tanggal ? `📅 ${latest.tanggal}` : "",
                    latest.jam ? `⏰ ${latest.jam}` : "",
                    latest.tempat ? `📍 ${latest.tempat}` : ""
                ].filter(Boolean);
                const metaText = metaParts.length
                    ? metaParts.join(" · ")
                    : (latest.pembuka ? String(latest.pembuka).slice(0, 90) + (latest.pembuka.length > 90 ? "…" : "") : "Ketuk buka untuk baca isi lengkap.");

                spotBody.innerHTML = `
                    <div class="info-spot-box">
                        ${latest.kepada ? `<span class="info-spot-to"><i class="fa-solid fa-people-group"></i> ${escapeHtml(latest.kepada)}</span>` : ""}
                        <h4 class="info-spot-title">${escapeHtml(latest.judul || "Tanpa judul")}</h4>
                        <div class="info-spot-meta">${escapeHtml(metaText)}</div>
                        <div class="info-spot-acts">
                            <a class="btn btn-white btn-sm full" href="informasi?id=${latest.id}"><i class="fa-solid fa-book-open"></i> Baca Kartu Lengkap</a>
                            <button type="button" class="btn btn-red btn-sm" onclick="Informasi.salinLink(${latest.id})"><i class="fa-solid fa-link"></i> Salin Link</button>
                            <button type="button" class="btn btn-white btn-sm" onclick="Informasi.salinTeks(${latest.id})"><i class="fa-regular fa-copy"></i> Teks WA</button>
                        </div>
                    </div>`;
            }
        }

        const jList = document.getElementById("infoJadwalList");
        const jCnt = document.getElementById("infoJadwalCnt");
        if (jList) {
            const scheduled = sorted.filter(it => String(it.tanggal || "").trim()).slice(0, 5);
            if (jCnt) jCnt.textContent = String(scheduled.length);
            if (!scheduled.length) {
                jList.innerHTML = `<div class="osis-empty">Belum ada pengumuman bertanggal kegiatan.</div>`;
            } else {
                jList.innerHTML = scheduled.map(it => {
                    const sub = [it.tanggal, it.tempat].filter(Boolean).join(" · ");
                    return `<a class="info-jrow" href="informasi?id=${it.id}">
                        <div class="info-jrow-main">
                            <b>${escapeHtml(it.judul || "Tanpa judul")}</b>
                            <small>${escapeHtml(sub)}</small>
                        </div>
                        <i class="fa-solid fa-chevron-right chev" aria-hidden="true"></i>
                    </a>`;
                }).join("");
            }
        }
    },

    renderKartuDaftar(it, kelola) {
        const bisaItem = kelola && (typeof OsisAngkatanUi === "undefined" || OsisAngkatanUi.bisaKelolaItem("informasi", it));
        const hasSchedule = Informasi.punyaJadwal(it);
        const oleh = typeof olehLabel === "function" ? olehLabel(it) : "";

        const chips = [
            it.tanggal ? `<span class="info-meta-chip tgl"><i class="fa-solid fa-calendar-days"></i> ${escapeHtml(it.tanggal)}</span>` : "",
            it.jam ? `<span class="info-meta-chip jam"><i class="fa-regular fa-clock"></i> ${escapeHtml(it.jam)}</span>` : "",
            it.tempat ? `<span class="info-meta-chip tmp"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(it.tempat)}</span>` : "",
            it.bawaan ? `<span class="info-meta-chip bawa"><i class="fa-solid fa-suitcase"></i> ${escapeHtml(it.bawaan)}</span>` : ""
        ].filter(Boolean).join("");

        return `
            <div class="info-row">
                <a class="info-row-main" href="informasi?id=${it.id}">
                    <div class="info-row-top">
                        <div class="info-row-badges">
                            <span class="info-pin-pill${hasSchedule ? " jadwal" : ""}">
                                <i class="fa-solid ${hasSchedule ? "fa-calendar-check" : "fa-thumbtack"}"></i> ${hasSchedule ? "Berjadwal" : "Pengumuman"}
                            </span>
                            ${it.kepada ? `<span class="info-to-pill"><i class="fa-solid fa-people-group"></i> ${escapeHtml(it.kepada)}</span>` : ""}
                        </div>
                        <span class="info-row-time">${escapeHtml(Informasi.fmtTerbitPendek(it.created_at))}</span>
                    </div>
                    <h4 class="info-row-judul">${escapeHtml(it.judul || "Tanpa judul")}</h4>
                    ${it.subjudul ? `<div class="info-row-subjudul">(${escapeHtml(it.subjudul)})</div>` : ""}
                    ${it.pembuka ? `<p class="info-row-snippet">${escapeHtml(it.pembuka)}</p>` : ""}
                    ${chips ? `<div class="info-row-chips">${chips}</div>` : ""}
                </a>
                <div class="info-row-foot">
                    <span class="info-row-author"><i class="fa-solid fa-user-pen"></i> ${escapeHtml(Informasi.fmtTerbit(it.created_at))} ${oleh}</span>
                    <div class="info-row-ops">
                        <button type="button" class="btn btn-white btn-sm" onclick="Informasi.salinLink(${it.id})" title="Salin link"><i class="fa-solid fa-link"></i> Link</button>
                        <button type="button" class="btn btn-white btn-sm" onclick="Informasi.salinTeks(${it.id})" title="Salin teks siap tempel WhatsApp"><i class="fa-regular fa-copy"></i> Teks</button>
                        <button type="button" class="btn btn-white btn-sm" onclick="Informasi.bagiWA(${it.id})" title="Bagikan ke WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>
                        ${bisaItem ? `<button type="button" class="btn btn-white btn-sm" onclick="Informasi.bukaForm(${it.id})" title="Ubah"><i class="fa-solid fa-pen"></i></button>` : ""}
                        ${bisaItem ? `<button type="button" class="btn btn-red btn-sm" onclick="Informasi.hapus(${it.id})" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                    </div>
                </div>
            </div>`;
    },

    tampilDaftar() {
        const wrap = document.getElementById("infoWrap");
        if (!wrap) return;
        document.getElementById("infoPageWrap")?.classList.remove("is-single");
        Informasi.cekLogin();

        const all = Informasi.cache || [];
        const data = Informasi.dataTampil(all);
        const kelola = Informasi.bolehKelola();
        const filtering = Informasi.hasActiveFilter();

        Informasi.sinkronFilterUi(all, data);
        Informasi.renderSidebar(all);

        const ekor = `<div id="infoSentinel" aria-hidden="true" style="height:2px"></div>
            <div style="text-align:center;margin:6px 0 2px"><button id="infoLagi" class="btn btn-white btn-sm" style="display:none" onclick="Informasi.muatDaftar(false)"><i class="fa-solid fa-rotate-right"></i> Muat lagi</button></div>`;

        if (!all.length) {
            wrap.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:24px 14px">
                <i class="fa-solid fa-bullhorn"></i> <b>Belum ada informasi harian.</b>
                ${kelola ? `<div style="margin-top:10px"><button type="button" class="btn btn-red btn-sm" onclick="Informasi.bukaForm()"><i class="fa-solid fa-plus"></i> Buat Informasi Pertama</button></div>` : ""}
            </div>` + ekor;
            Informasi.jejaki();
            return;
        }

        const renderRows = (items, grp) => {
            const inner = items.map(it => Informasi.renderKartuDaftar(it, kelola)).join("");
            return grp ? inner : `<div class="info-list-stack">${inner}</div>`;
        };

        const emptyFilteredHtml = `<div class="pesan-empty" style="text-align:center; padding:22px 12px">
            <i class="fa-solid fa-magnifying-glass"></i> Tidak ada informasi yang cocok dengan pencarian/filter.
            <div style="margin-top:10px"><button type="button" class="btn btn-white btn-sm" onclick="Informasi.resetFilter()"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button></div>
        </div>`;

        if (typeof OsisAngkatanUi !== "undefined" && OsisAngkatanUi.renderSplit) {
            wrap.classList.remove("ang-acc-list");
            OsisAngkatanUi.renderSplit(wrap, data, {
                key: "informasi",
                label: "informasi",
                bodyClass: "ang-acc-stack",
                hasFilter: filtering,
                emptyHtml: emptyFilteredHtml,
                emptyOwnHtml: `<div class="pesan-empty"><i class="fa-solid fa-bullhorn"></i> Belum ada informasi harian di angkatan ini.</div>`,
                afterHtml: ekor,
                renderItems: renderRows,
                onToggleOther: () => Informasi.tampilDaftar()
            });
        } else {
            wrap.innerHTML = (data.length ? renderRows(data, null) : emptyFilteredHtml) + ekor;
        }
        Informasi.jejaki();
    },

    // ============ SALIN LINK / SALIN TEKS WA / BAGI WA ============
    async salinClipboard(text, suksesMsg) {
        try {
            await navigator.clipboard.writeText(text);
            showToast(suksesMsg, "success");
        } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); showToast(suksesMsg, "success"); }
            catch { showPopup(text, "info"); }
            ta.remove();
        }
    },

    salinLink(id) {
        return Informasi.salinClipboard(Informasi.linkUntuk(id), "Link tersalin, tinggal tempel di grup!");
    },

    formatTeksWA(item) {
        if (!item) return "";
        const lines = [`📌 *${String(item.judul || "Informasi OSIS").trim()}*`];
        if (String(item.subjudul || "").trim()) lines.push(`_${String(item.subjudul).trim()}_`);
        if (String(item.kepada || "").trim()) lines.push(`👥 Kepada: ${String(item.kepada).trim()}`);
        if (String(item.pembuka || "").trim()) lines.push("", String(item.pembuka).trim());
        const detail = [];
        if (String(item.tanggal || "").trim()) detail.push(`📅 Tanggal: ${String(item.tanggal).trim()}`);
        if (String(item.jam || "").trim()) detail.push(`⏰ Waktu: ${String(item.jam).trim()}`);
        if (String(item.tempat || "").trim()) detail.push(`📍 Tempat: ${String(item.tempat).trim()}`);
        if (String(item.bawaan || "").trim()) detail.push(`⚠️ Persiapan: ${String(item.bawaan).trim()}`);
        if (detail.length) lines.push("", ...detail);
        if (String(item.penutup || "").trim()) lines.push("", String(item.penutup).trim());
        lines.push("", `🔗 Detail kartu: ${Informasi.linkUntuk(item.id)}`);
        return lines.join("\n");
    },

    salinTeks(id) {
        const item = Informasi.cariItem(id);
        if (!item) { showToast("Data informasi belum termuat.", "error"); return; }
        return Informasi.salinClipboard(Informasi.formatTeksWA(item), "Teks broadcast WA tersalin!");
    },

    bagiWA(id) {
        const item = Informasi.cariItem(id);
        const judul = item && item.judul ? item.judul : "Informasi OSIS";
        const teks = encodeURIComponent(`📌 [ ${judul} ]\n${Informasi.linkUntuk(id)}`);
        window.open("https://wa.me/?text=" + teks, "_blank", "noopener");
    },

    // ============ FORM (buat/ubah + live preview desktop) ============
    syncPreview() {
        const slot = document.getElementById("infoPreviewSlot");
        if (!slot) return;
        slot.innerHTML = Informasi.kartuHtml(Informasi.bacaForm(), { preview: true });
    },

    async bukaForm(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (!OsisAuth.butuh("informasi")) return;
        let item = id ? Informasi.cariItem(id) : null;
        if (id && !item) {
            try { item = await getInformasi(id); } catch {}
        }
        if (item && typeof OsisAngkatanUi !== "undefined" && !OsisAngkatanUi.bisaKelolaItem("informasi", item)) {
            showToast("Informasi ini milik angkatan lain (hanya lihat).", "info");
            return;
        }
        Informasi.editingId = item ? item.id : null;
        const v = (k) => escapeHtml(item ? (item[k] || "") : "");
        document.getElementById("infoFormOverlay")?.remove();
        const overlay = document.createElement("div");
        overlay.id = "infoFormOverlay";
        overlay.className = "info-modal kas-form";
        overlay.innerHTML = `
            <div class="info-form-box">
                <div class="osis-det-mhead">
                    <span class="osis-det-mtitle">
                        <span class="osis-det-mico"><i class="fa-solid fa-bullhorn"></i></span>
                        <span>${item ? "Ubah Informasi" : "Buat Informasi Baru"}</span>
                    </span>
                    <button type="button" class="icon-btn" onclick="Informasi.tutupForm()" title="Tutup" style="width:36px;height:36px;flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="info-form-layout">
                    <div class="info-form-fields">
                        <div class="info-form-grp">
                            <div class="info-form-grp-lbl"><i class="fa-solid fa-heading"></i> Identitas &amp; Sasaran</div>
                            <div class="field"><label>Judul *</label>
                                <input type="text" id="infoJudul" class="admin-input" placeholder="cth: Kumpulan Rutin" maxlength="80" value="${v("judul")}">
                            </div>
                            <div class="field"><label>Subjudul (opsional, kecil di bawah judul)</label>
                                <input type="text" id="infoSubjudul" class="admin-input" placeholder="cth: Di dalam ruangan" maxlength="80" value="${v("subjudul")}">
                            </div>
                            <div class="field"><label>Kepada</label>
                                <input type="text" id="infoKepada" class="admin-input" placeholder="cth: Seluruh pengurus OSIS Jilid 4" maxlength="200" value="${v("kepada")}">
                            </div>
                        </div>

                        <div class="info-form-grp">
                            <div class="info-form-grp-lbl"><i class="fa-solid fa-calendar-days"></i> Detail Acara (opsional)</div>
                            <div class="info-form-grid">
                                <div class="field"><label>Tanggal kegiatan</label>
                                    <input type="text" id="infoTanggal" class="admin-input" placeholder="cth: Rabu, 23 Sept 2026" maxlength="80" value="${v("tanggal")}">
                                </div>
                                <div class="field"><label>Jam</label>
                                    <input type="text" id="infoJam" class="admin-input" placeholder="cth: 15.00 WIB s.d Selesai" maxlength="80" value="${v("jam")}">
                                </div>
                            </div>
                            <div class="field"><label>Tempat</label>
                                <input type="text" id="infoTempat" class="admin-input" placeholder="cth: SMK Taruna Harapan 1 Cipatat" maxlength="200" value="${v("tempat")}">
                            </div>
                            <div class="field"><label>Yang perlu dibawa / persiapan</label>
                                <input type="text" id="infoBawaan" class="admin-input" placeholder="cth: Buku catatan OSIS & pulpen" maxlength="200" value="${v("bawaan")}">
                            </div>
                        </div>

                        <div class="info-form-grp">
                            <div class="info-form-grp-lbl"><i class="fa-solid fa-align-left"></i> Isi Pengumuman</div>
                            <div class="field"><label>Pembuka</label>
                                <textarea id="infoPembuka" class="admin-input admin-textarea" rows="3" maxlength="2000" placeholder="cth: Selamat sore akang/teteh, izin menginformasikan...">${v("pembuka")}</textarea>
                            </div>
                            <div class="field"><label>Penutup</label>
                                <textarea id="infoPenutup" class="admin-input admin-textarea" rows="2" maxlength="2000" placeholder="cth: Dimohon hadir tepat waktu...">${v("penutup")}</textarea>
                            </div>
                        </div>
                    </div>

                    <div class="info-preview-col">
                        <div class="info-preview-lbl"><i class="fa-solid fa-eye"></i> Pratinjau Kartu</div>
                        <div id="infoPreviewSlot"></div>
                    </div>
                </div>

                <div class="osis-det-foot">
                    <div class="osis-det-foot-left"></div>
                    <div class="osis-det-foot-right">
                        <button type="button" class="btn btn-white" onclick="Informasi.tutupForm()">Batal</button>
                        <button type="button" class="btn btn-red" id="btnSimpanInfo" onclick="Informasi.simpanForm()"><i class="fa-solid fa-check"></i> ${item ? "Simpan Perubahan" : "Terbitkan"}</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector(".info-form-fields")?.addEventListener("input", () => Informasi.syncPreview());
        Informasi.syncPreview();
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("open")));
        document.body.style.overflow = "hidden";
        overlay.addEventListener("click", (e) => { if (e.target === overlay) Informasi.tutupForm(); });
    },

    tutupForm() {
        document.getElementById("infoFormOverlay")?.classList.remove("open");
        setTimeout(() => document.getElementById("infoFormOverlay")?.remove(), 220);
        document.body.style.overflow = "";
        Informasi.editingId = null;
    },

    bacaForm() {
        const g = (id) => document.getElementById(id)?.value.trim() || "";
        return {
            judul: g("infoJudul"),
            subjudul: g("infoSubjudul"),
            kepada: g("infoKepada"),
            pembuka: g("infoPembuka"),
            tanggal: g("infoTanggal"),
            jam: g("infoJam"),
            tempat: g("infoTempat"),
            bawaan: g("infoBawaan"),
            penutup: g("infoPenutup"),
        };
    },

    async simpanForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (!OsisAuth.butuh("informasi")) return;
        const f = Informasi.bacaForm();
        if (!f.judul) { showToast("Judul diisi dulu", "error"); return; }
        const eid = Informasi.editingId;
        const angId = typeof DbScope !== "undefined" && DbScope.angkatanId ? DbScope.angkatanId() : null;
        const antreInfo = {
            modul: "informasi",
            op: eid ? "update" : "create",
            label: "Informasi: " + f.judul.slice(0, 44),
            payload: { id: eid || null, f, angkatan_id: angId },
            cacheKeys: eid ? ["informasi", "info_item_" + eid, "informasi-" + eid] : ["informasi"],
        };
        const btn = document.getElementById("btnSimpanInfo");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        const optimis = () => {
            try {
                if (eid) {
                    const hit = (Informasi.items || []).find(x => String(x.id) === String(eid));
                    if (hit) Object.assign(hit, f);
                } else {
                    Informasi.items = [{
                        id: "tmp-" + Date.now(),
                        ...f,
                        pengunggah: u.nama || u.username || "OSIS",
                        created_at: new Date().toISOString(),
                        angkatan_id: angId,
                    }, ...(Informasi.items || [])];
                }
                Informasi.renderList();
            } catch {}
        };
        if (typeof OutboxOffline === "function" && OutboxOffline()) {
            try {
                await Outbox.enqueue(antreInfo);
                optimis();
                Informasi.tutupForm();
            } catch (e) {
                showToast("Gagal antre: " + (e.message || e), "error");
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
            }
            return;
        }
        try {
            if (eid) {
                await updateInformasi(u.id, eid, f);
                showToast("Informasi diperbarui!", "success");
                Informasi.tutupForm();
                Cache.del("informasi");
                Cache.del("informasi-" + eid);
                await Informasi.muat();
                return;
            }
            const newId = await buatInformasi(u.id, f);
            if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
            showToast("Informasi terbit! Link siap dibagikan.", "success");
            Informasi.tutupForm();
            Cache.del("informasi");
            location.replace("informasi?id=" + newId);
            return;
        } catch (err) {
            if (typeof Outbox !== "undefined" && Outbox.enqueueOnNetErr && (await Outbox.enqueueOnNetErr(err, antreInfo))) {
                optimis();
                Informasi.tutupForm();
                return;
            }
            console.error(err);
            if (err.message === "ERR_NO_AUTH" || String(err.message).includes("-1")) {
                showPopup("Kamu tidak punya hak kelola informasi.", "error");
            } else {
                showToast("Gagal simpan: " + err.message, "error");
            }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("informasi")) return;
        const item = Informasi.cariItem(id);
        if (item && typeof OsisAngkatanUi !== "undefined" && !OsisAngkatanUi.bisaKelolaItem("informasi", item)) {
            showToast("Informasi ini milik angkatan lain (hanya lihat).", "info");
            return;
        }
        const yakin = await showPopup("Hapus informasi ini? Link share-nya ikut mati.", "confirm");
        if (!yakin) return;
        try {
            await hapusInformasi(u.id, id);
            showToast("Informasi dihapus", "success");
            Cache.del("informasi");
            Cache.del("informasi-" + id);
            if (Informasi.idDariUrl()) location.replace("informasi");
            else await Informasi.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },
};

document.addEventListener("DOMContentLoaded", () => Informasi.init());
