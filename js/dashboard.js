// =========================================================================
// DASHBOARD OSIS — Bento Grid Command Center (osis/index.html)
// Semua fetch fail-silent + empty state per section. Sidebar tidak disentuh.
// =========================================================================

const Dashboard = {
    sekbidMap: {},
    namaSaya: [],

    // Peta pintasan cepat sesuai hak akses
    QUICK_LINKS: [
        { key: "informasi", href: "informasi", label: "Broadcast Info", icon: "fa-solid fa-bullhorn" },
        { key: "absensi", href: "absensi", label: "Kelola Absensi", icon: "fa-solid fa-clipboard-user" },
        { key: "notulensi", href: "notulensi", label: "Notulensi Rapat", icon: "fa-solid fa-clipboard-list" },
        { key: "keuangan", href: "keuangan", label: "Kas & Keuangan", icon: "fa-solid fa-wallet" },
        { key: "tabungan", href: "tabungan", label: "Tabungan", icon: "fa-solid fa-piggy-bank" },
        { key: "agenda", href: "agenda", label: "Agenda Sekbid", icon: "fa-solid fa-calendar-days" },
        { key: "program", href: "program-bulanan", label: "Program Kerja", icon: "fa-solid fa-list-check" },
        { key: "dokumen", href: "dokumen", label: "Arsip Dokumen", icon: "fa-solid fa-folder-open" },
        { key: "poster", href: "poster", label: "Galeri Poster", icon: "fa-solid fa-newspaper" },
        { key: "anggota", href: "anggota", label: "Data Pengurus", icon: "fa-solid fa-users" },
        { key: "wawancara", href: "wawancara", label: "Wawancara", icon: "fa-solid fa-comments" },
        { key: "aspirasi", href: "../index#/aspirasi", label: "Balas Aspirasi", icon: "fa-solid fa-comment-dots" },
        { key: "lagu", href: "../index#/musik", label: "Request Lagu", icon: "fa-solid fa-music" },
        { key: "polling", href: "../polling", label: "Polling", icon: "fa-solid fa-check-to-slot" },
        { key: "super", href: "akses", label: "Atur Akses", icon: "fa-solid fa-key" },
        { key: "super", href: "users", label: "Akun OSIS", icon: "fa-solid fa-user-gear" },
        { key: "super", href: "notifikasi", label: "Push Notif", icon: "fa-solid fa-paper-plane" },
        { key: "super", href: "logs", label: "Logs Aktivitas", icon: "fa-solid fa-clock-rotate-left" }
    ],

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        Dashboard.pasangTabs();
        Dashboard.tickJam();
        setInterval(() => Dashboard.tickJam(), 1000);

        // Segarkan hak kendali biar chip + pintasan cepat selalu akurat
        try {
            if (typeof OsisAuth.refreshAkses === "function") await OsisAuth.refreshAkses();
        } catch {}

        const sapaan = (u.nama || u.username || "OSIS").split(" ")[0];
        const helloEl = document.getElementById("osisHello");
        if (helloEl) helloEl.textContent = `Halo, ${sapaan}! 👋`;
        const subEl = document.getElementById("osisSub");
        if (subEl) subEl.textContent = u.bio ? u.bio : "Berikut ringkasan aktivitas & performa OSIS saat ini.";

        Dashboard.renderMeta(u);
        Dashboard.renderAvatar(u);
        Dashboard.renderHak();

        // Refresh foto PP & profil terbaru (fail silent)
        if (typeof getOsisUserById === "function" && u.id) {
            getOsisUserById(u.id).then(fresh => {
                if (!fresh) return;
                if (fresh.foto) Dashboard.renderAvatar({ ...u, foto: fresh.foto });
                if (fresh.bio && subEl) subEl.textContent = fresh.bio;
                try {
                    const cur = OsisAuth.getUser() || {};
                    localStorage.setItem(OsisAuth.KEY, JSON.stringify({ ...cur, foto: fresh.foto || cur.foto, bio: fresh.bio || cur.bio }));
                } catch {}
            }).catch(() => {});
        }

        // Kumpulkan nama milik user login (buat pencocokan Tabungan & Absensi Pribadi)
        const namaSet = new Set();
        const addNama = (n) => { n = String(n || "").trim().toLowerCase(); if (n) namaSet.add(n); };
        addNama(u.nama);

        const [
            agenda,
            agendaRingkas,
            anggota,
            periodeList,
            kas,
            kasRingkas,
            tabungan,
            absensi,
            dokumen,
            sekbid,
            infoList,
            programList,
            notulensiList,
            aspirasiList,
            laguList,
            angSaya,
            pengSaya
        ] = await Promise.all([
            (typeof getAllAgenda === "function" ? getAllAgenda(30, 0) : Promise.resolve([])).catch(() => []),
            (typeof sekbidAgendaRingkas === "function" && u.id ? sekbidAgendaRingkas(u.id, null, null) : Promise.resolve(null)).catch(() => null),
            (typeof getAnggota === "function" ? getAnggota() : Promise.resolve([])).catch(() => []),
            (typeof getPeriode === "function" ? getPeriode() : Promise.resolve([])).catch(() => []),
            (typeof getKas === "function" ? getKas(20, 0, {}) : Promise.resolve([])).catch(() => []),
            (typeof osisKasRingkas === "function" && u.id ? osisKasRingkas(u.id, {}) : Promise.resolve(null)).catch(() => null),
            (typeof getTabungan === "function" ? getTabungan() : Promise.resolve([])).catch(() => []),
            (typeof getAbsensi === "function" ? getAbsensi() : Promise.resolve([])).catch(() => []),
            (typeof getDokumen === "function" ? getDokumen(8, 0) : Promise.resolve([])).catch(() => []),
            (typeof getSekbid === "function" ? getSekbid() : Promise.resolve([])).catch(() => []),
            (typeof getInformasiList === "function" ? getInformasiList(4, 0) : Promise.resolve([])).catch(() => []),
            (typeof getProgram === "function" ? getProgram() : Promise.resolve([])).catch(() => []),
            (typeof getNotulensi === "function" ? getNotulensi(4, 0) : Promise.resolve([])).catch(() => []),
            (typeof getAspirasi === "function" ? getAspirasi(20, 0) : Promise.resolve([])).catch(() => []),
            (typeof getRequestLagu === "function" ? getRequestLagu(20) : Promise.resolve([])).catch(() => []),
            (typeof getAnggotaSaya === "function" ? getAnggotaSaya() : Promise.resolve(null)).catch(() => null),
            (typeof getPengurusSaya === "function" ? getPengurusSaya() : Promise.resolve(null)).catch(() => null)
        ]);

        if (angSaya && angSaya.nama) addNama(angSaya.nama);
        if (pengSaya && pengSaya.nama) addNama(pengSaya.nama);
        Dashboard.namaSaya = [...namaSet];

        (sekbid || []).forEach(s => { Dashboard.sekbidMap[String(s.id)] = s.nama || ""; });

        Dashboard.renderPersonal(u, tabungan, absensi);
        Dashboard.renderStats(agenda, agendaRingkas, anggota, periodeList, kas, kasRingkas, tabungan);
        Dashboard.renderAgenda(agenda);
        Dashboard.renderNotulensi(notulensiList);
        Dashboard.renderKas(kas, kasRingkas);
        Dashboard.renderAbsensi(absensi);
        Dashboard.renderProgram(programList);
        Dashboard.renderInformasi(infoList);
        Dashboard.renderInbox(aspirasiList, laguList);
        Dashboard.renderDokumen(dokumen);
        Dashboard.renderAktivitas(agenda, kas, tabungan, absensi, dokumen, infoList, notulensiList, programList);
    },

    // ============ TABS INTERAKTIF DI KARTU BENTO ============
    pasangTabs() {
        document.getElementById("inboxTabs")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-inbox-tab]");
            if (!btn) return;
            const tab = btn.dataset.inboxTab;
            document.querySelectorAll("#inboxTabs .btab").forEach(b => b.classList.toggle("active", b === btn));
            const pAsp = document.getElementById("inboxAspirasiPane");
            const pLagu = document.getElementById("inboxLaguPane");
            if (pAsp) pAsp.style.display = tab === "aspirasi" ? "" : "none";
            if (pLagu) pLagu.style.display = tab === "lagu" ? "" : "none";
        });

        document.getElementById("rapatTabs")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-rapat-tab]");
            if (!btn) return;
            const tab = btn.dataset.rapatTab;
            document.querySelectorAll("#rapatTabs .btab").forEach(b => b.classList.toggle("active", b === btn));
            const pAg = document.getElementById("agendaPane");
            const pNot = document.getElementById("notulensiPane");
            if (pAg) pAg.style.display = tab === "agenda" ? "" : "none";
            if (pNot) pNot.style.display = tab === "notulensi" ? "" : "none";
        });

        document.getElementById("logTabs")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-log-tab]");
            if (!btn) return;
            const tab = btn.dataset.logTab;
            document.querySelectorAll("#logTabs .btab").forEach(b => b.classList.toggle("active", b === btn));
            const pAkt = document.getElementById("aktivitasPane");
            const pDok = document.getElementById("dokumenPane");
            if (pAkt) pAkt.style.display = tab === "aktivitas" ? "" : "none";
            if (pDok) pDok.style.display = tab === "dokumen" ? "" : "none";
        });
    },

    renderMeta(u) {
        const meta = document.getElementById("osisMeta");
        if (!meta) return;
        meta.innerHTML = `
            <span class="osis-badge"><i class="fa-solid fa-id-card"></i> ${escapeHtml(u.jabatan || "OSIS")}</span>
            <span class="osis-handle">@${escapeHtml(u.username || "-")}</span>`;
    },

    // ============ HAK KENDALI + PINTASAN CEPAT SESUAI AKSES ============
    renderHak() {
        const chips = document.getElementById("hakChips");
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        const superUser = (typeof OsisAuth !== "undefined" && OsisAuth.isSuper) ? OsisAuth.isSuper() : false;
        const list = a && Array.isArray(a.halaman) ? a.halaman : [];

        if (chips) {
            if (superUser) {
                chips.innerHTML = `<span class="hak-chip super"><i class="fa-solid fa-crown"></i> Super Admin · Semua Kendali</span>`;
            } else if (!list.length) {
                chips.innerHTML = `<span class="hak-note">Mode baca (pengurus)</span>`;
            } else {
                chips.innerHTML = list.map(h => `<span class="hak-chip">${escapeHtml(h)}</span>`).join("");
            }
        }
        const sekEl = document.getElementById("hakSekbid");
        if (sekEl) {
            sekEl.textContent = (!superUser && a && a.sekbid_nama)
                ? `· Kendali agenda/program ${a.sekbid_nama}`
                : "";
        }

        // Render Pintasan Cepat sesuai hak akses user
        const quickEl = document.getElementById("quickActions");
        if (!quickEl) return;
        const boleh = (key) => {
            if (superUser) return true;
            if (key === "super") return false;
            if ((key === "agenda" || key === "program") && a && a.sekbid_id) return true;
            return list.includes(key) || list.includes("*");
        };
        const dipilih = [];
        const seenHref = new Set();
        const pushLink = (it) => {
            if (seenHref.has(it.href)) return;
            seenHref.add(it.href);
            dipilih.push(it);
        };
        Dashboard.QUICK_LINKS.forEach(it => {
            if (boleh(it.key)) pushLink(it);
        });
        if (dipilih.length < 5) {
            ["informasi", "agenda", "program", "notulensi", "dokumen", "keuangan"].forEach(k => {
                const found = Dashboard.QUICK_LINKS.find(x => x.key === k);
                if (found) pushLink(found);
            });
        }
        quickEl.innerHTML = dipilih.slice(0, 8).map(it => `
            <a class="q-chip" href="${it.href}">
                <i class="${it.icon}"></i>
                <span>${escapeHtml(it.label)}</span>
            </a>`).join("");
    },

    // ============ RINGKASAN PRIBADI SAYA ============
    renderPersonal(u, tabungan, absensi) {
        const nameTag = document.getElementById("personalNameTag");
        if (nameTag) nameTag.textContent = u.nama || "@" + (u.username || "osis");

        const milikSaya = (namaRow) => {
            const k = String(namaRow || "").trim().toLowerCase();
            return !!k && Dashboard.namaSaya.includes(k);
        };

        // 1. Tabungan Pribadi
        const tabSaya = (tabungan || []).filter(r => milikSaya(r.nama));
        const nilaiTab = (r) => {
            const n = parseInt(r.nominal, 10) || 0;
            return r.jenis === "keluar" ? -n : n;
        };
        const saldoTabSaya = tabSaya.reduce((acc, r) => acc + nilaiTab(r), 0);
        const nSetor = tabSaya.filter(r => r.jenis !== "keluar").length;
        const elTabVal = document.getElementById("myTabunganVal");
        const elTabSub = document.getElementById("myTabunganSub");
        if (elTabVal) elTabVal.textContent = Dashboard.rp(saldoTabSaya);
        if (elTabSub) {
            elTabSub.textContent = tabSaya.length
                ? `${nSetor}x setoran tercatat`
                : "Belum ada setoran atas namamu";
        }

        // 2. Kehadiran Pribadi
        const semuaAbsen = absensi || [];
        const tanggalUnik = [...new Set(semuaAbsen.map(r => String(r.tanggal || "")).filter(Boolean))];
        const totalHari = tanggalUnik.length;
        const barisSaya = semuaAbsen.filter(r =>
            (r.akun_mode === "osis" && String(r.akun_id) === String(u.id)) || milikSaya(r.nama)
        );
        const tidakHadirMap = new Map();
        barisSaya.forEach(r => {
            if (r.tanggal && r.status && r.status !== "hadir") {
                tidakHadirMap.set(String(r.tanggal), r.status);
            }
        });
        const tidakHadirStatus = [...tidakHadirMap.values()];
        const nIzin = tidakHadirStatus.filter(s => s === "izin").length;
        const nSakit = tidakHadirStatus.filter(s => s === "sakit").length;
        const nAlpha = tidakHadirStatus.filter(s => s === "alpha").length;
        const nAbsen = tidakHadirStatus.length;
        const nHadir = Math.max(0, totalHari - nAbsen);
        const pct = totalHari > 0 ? Math.round((nHadir / totalHari) * 100) : 100;

        const elAbsPct = document.getElementById("myAbsenPct");
        const elAbsVal = document.getElementById("myAbsenVal");
        const elAbsBar = document.getElementById("myAbsenBar");
        const elAbsSub = document.getElementById("myAbsenSub");
        if (elAbsPct) elAbsPct.textContent = totalHari ? `${pct}%` : "100%";
        if (elAbsVal) elAbsVal.textContent = totalHari ? `${nHadir}/${totalHari} Hari` : "100% Aman";
        if (elAbsBar) {
            elAbsBar.style.width = `${pct}%`;
            elAbsBar.parentElement?.classList.toggle("green", pct >= 80);
        }
        if (elAbsSub) {
            if (!totalHari) {
                elAbsSub.textContent = "Belum ada sesi absensi";
            } else if (!nAbsen) {
                elAbsSub.textContent = "Nihil izin/sakit/alpha · Pertahankan!";
            } else {
                const parts = [];
                if (nIzin) parts.push(`${nIzin} izin`);
                if (nSakit) parts.push(`${nSakit} sakit`);
                if (nAlpha) parts.push(`${nAlpha} alpha`);
                elAbsSub.textContent = parts.join(" · ");
            }
        }
    },

    inisial(nama) {
        const parts = String(nama || "").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "O";
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    },

    renderAvatar(u) {
        const box = document.getElementById("osisAvatar");
        if (!box) return;
        const inisial = Dashboard.inisial(u && (u.nama || u.username));
        if (u && u.foto) {
            box.classList.add("media-muat", "mini");
            box.innerHTML = `<img src="${getFoto(u.foto)}" alt="" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat');this.remove()"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span>`;
            if (!box.querySelector("img")) box.textContent = inisial;
        } else {
            box.textContent = inisial;
        }
    },

    tickJam() {
        try {
            const now = new Date();
            const tgl = document.getElementById("dashTanggal");
            const jam = document.getElementById("dashJam");
            if (tgl) {
                tgl.textContent = now.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" });
            }
            if (jam) {
                jam.textContent = now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\./g, ":");
            }
        } catch {}
    },

    hariIni() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },

    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return t; }
    },

    relatif(t) {
        if (!t) return "";
        const ms = Date.now() - new Date(t).getTime();
        if (isNaN(ms) || ms < 0) return "baru saja";
        const mnt = Math.floor(ms / 60000);
        if (mnt < 1) return "baru saja";
        if (mnt < 60) return mnt + " mnt lalu";
        const jam = Math.floor(mnt / 60);
        if (jam < 24) return jam + " jam lalu";
        const hari = Math.floor(jam / 24);
        if (hari === 1) return "kemarin";
        if (hari < 7) return hari + " hari lalu";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
        } catch { return ""; }
    },

    rp(n) {
        const val = parseInt(n, 10) || 0;
        return (val < 0 ? "-Rp" : "Rp") + Math.abs(val).toLocaleString("id-ID");
    },

    // ============ 4 STATS UTAMA ============
    renderStats(agenda, agendaRingkas, anggota, periodeList, kas, kasRingkas, tabungan) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        agenda = agenda || [];
        anggota = anggota || [];
        periodeList = periodeList || [];
        kas = kas || [];
        tabungan = tabungan || [];

        // 1. Total Agenda: samakan dengan halaman Agenda via RPC server-side sekbid_agenda_ringkas
        const totalAgenda = agendaRingkas && agendaRingkas.total != null
            ? (parseInt(agendaRingkas.total, 10) || 0)
            : agenda.length;
        const blnIni = Dashboard.hariIni().slice(0, 7);
        const agBulan = agendaRingkas && agendaRingkas.bulan_ini != null
            ? (parseInt(agendaRingkas.bulan_ini, 10) || 0)
            : agenda.filter(a => String(a.tanggal || "").slice(0, 7) === blnIni).length;
        set("statAgenda", totalAgenda.toLocaleString("id-ID"));
        set("statAgendaSub", agBulan ? `${agBulan.toLocaleString("id-ID")} bulan ini` : "belum ada bulan ini");

        // 2. Saldo Kas OSIS: samakan dengan halaman Keuangan via osis_kas_ringkas (masuk - keluar)
        const masuk = kasRingkas && kasRingkas.masuk != null
            ? (parseInt(kasRingkas.masuk, 10) || 0)
            : kas.filter(t => t.jenis === "masuk").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
        const keluar = kasRingkas && kasRingkas.keluar != null
            ? (parseInt(kasRingkas.keluar, 10) || 0)
            : kas.filter(t => t.jenis === "keluar").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
        const nTrans = kasRingkas && kasRingkas.n != null ? kasRingkas.n : kas.length;
        set("statKas", Dashboard.rp(masuk - keluar));
        set("statKasSub", nTrans ? `${nTrans} transaksi tercatat` : "belum ada transaksi");

        // 3. Total Tabungan
        const nilaiTab = (r) => {
            const n = parseInt(r.nominal, 10) || 0;
            return r.jenis === "keluar" ? -n : n;
        };
        const totalTab = tabungan.reduce((a, r) => a + nilaiTab(r), 0);
        const penabung = new Set(tabungan.map(r => String(r.nama || "").trim().toLowerCase()).filter(Boolean)).size;
        set("statTabungan", Dashboard.rp(totalTab));
        set("statTabunganSub", penabung ? `${penabung} pengurus menabung` : "belum ada data");

        // 4. Pengurus Aktif (ambil dari periode aktif di tabel periode; fallback tahun terbaru)
        const thAktif = periodeList
            .filter(p => p && p.aktif)
            .map(p => parseInt(p.tahun, 10))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        let angAktif;
        let subAnggota;
        if (thAktif.length) {
            angAktif = anggota.filter(a => thAktif.includes(parseInt(a.tahun, 10)));
            subAnggota = `periode ${thAktif.join(" & ")}`;
        } else {
            const thns = [...new Set(anggota.map(a => parseInt(a.tahun, 10)).filter(Number.isFinite))].sort((a, b) => b - a);
            angAktif = thns.length ? anggota.filter(a => parseInt(a.tahun, 10) === thns[0]) : anggota;
            subAnggota = thns.length ? `periode ${thns[0]}` : "semua periode";
        }
        set("statAnggota", String(angAktif.length));
        set("statAnggotaSub", subAnggota);
    },

    // ============ A1. AGENDA SEKBID (TERDEKAT ATAU TERBARU) ============
    renderAgenda(agenda) {
        const wrap = document.getElementById("agendaDekat");
        if (!wrap) return;
        const semua = agenda || [];
        if (!semua.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada agenda tercatat.</div>`;
            return;
        }
        const today = Dashboard.hariIni();
        const mendatang = semua
            .filter(a => (a.tanggal || "") >= today)
            .sort((a, b) => String(a.tanggal || "") < String(b.tanggal || "") ? -1 : 1);
        const rows = (mendatang.length ? mendatang : [...semua].sort((a, b) => String(b.tanggal || "").localeCompare(String(a.tanggal || "")))).slice(0, 4);

        wrap.innerHTML = rows.map(a => {
            const sekbid = Dashboard.sekbidMap[String(a.sekbid_id)] || "";
            const st = String(a.status || "").toLowerCase();
            const isDone = st === "selesai" || st === "terlaksana";
            const isPlan = st === "rencana" || st === "mendatang";
            return `<a class="dash-item" href="agenda">
                <div class="di"><i class="fa-solid fa-calendar-days"></i></div>
                <div class="db"><b>${escapeHtml(a.judul || "Tanpa judul")}</b>
                    <small>${Dashboard.fmtTanggal(a.tanggal)}${a.lokasi ? " · " + escapeHtml(a.lokasi) : ""}${sekbid ? " · " + escapeHtml(sekbid) : ""}</small></div>
                <span class="tag ${isDone ? "green" : isPlan ? "yellow" : "gray"}">${escapeHtml(a.status || "-")}</span>
            </a>`;
        }).join("");
    },

    // ============ A2. NOTULENSI RAPAT TERBARU ============
    renderNotulensi(notulensiList) {
        const wrap = document.getElementById("notulensiBaru");
        const badge = document.getElementById("badgeNotulensi");
        const rows = (notulensiList || []).slice(0, 4);
        if (badge) badge.textContent = String((notulensiList || []).length);
        if (!wrap) return;
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada notulensi rapat.</div>`;
            return;
        }
        const stLbl = { rencana: "Rencana", selesai: "Selesai", belum_tindaklanjut: "Belum TL", batal: "Batal" };
        wrap.innerHTML = rows.map(n => {
            const nTl = Array.isArray(n.tindak_lanjut) ? n.tindak_lanjut.length : 0;
            const cls = n.status === "selesai" ? "green" : n.status === "belum_tindaklanjut" ? "red" : "yellow";
            return `
                <a class="dash-item" href="notulensi?id=${n.id}">
                    <div class="di"><i class="fa-solid fa-clipboard-list"></i></div>
                    <div class="db">
                        <b>${escapeHtml(n.judul || "Rapat OSIS")}</b>
                        <small>${Dashboard.fmtTanggal(n.tanggal)}${n.divisi ? " · " + escapeHtml(n.divisi) : ""}${nTl ? ` · ${nTl} tindak lanjut` : ""}</small>
                    </div>
                    <span class="tag ${cls}">${escapeHtml(stLbl[n.status] || n.status || "-")}</span>
                </a>`;
        }).join("");
    },

    // ============ B. KEUANGAN TERAKHIR ============
    renderKas(kas, kasRingkas) {
        const mini = document.getElementById("kasMiniRekap");
        const wrap = document.getElementById("kasTerakhir");
        if (!wrap) return;
        const semua = kas || [];
        const masuk = kasRingkas && kasRingkas.masuk != null
            ? (parseInt(kasRingkas.masuk, 10) || 0)
            : semua.filter(t => t.jenis === "masuk").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);
        const keluar = kasRingkas && kasRingkas.keluar != null
            ? (parseInt(kasRingkas.keluar, 10) || 0)
            : semua.filter(t => t.jenis === "keluar").reduce((a, t) => a + (parseInt(t.nominal, 10) || 0), 0);

        if (mini) {
            mini.innerHTML = `
                <div class="kas-mini-bar">
                    <div class="kmb-cell in"><span>Total Masuk</span><b>+${Dashboard.rp(masuk)}</b></div>
                    <div class="kmb-cell out"><span>Total Keluar</span><b>−${Dashboard.rp(keluar)}</b></div>
                </div>`;
        }

        const rows = [...semua]
            .sort((a, b) => String(b.tanggal || "") < String(a.tanggal || "") ? -1 : 1)
            .slice(0, 4);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada transaksi kas.</div>`;
            return;
        }
        wrap.innerHTML = rows.map(t => {
            const isOut = t.jenis === "keluar";
            return `<a class="dash-item" href="keuangan">
                <div class="di"><i class="fa-solid ${isOut ? "fa-arrow-trend-down" : "fa-arrow-trend-up"}"></i></div>
                <div class="db"><b>${escapeHtml(t.keterangan || "Tanpa keterangan")}</b>
                    <small>${Dashboard.fmtTanggal(t.tanggal)}${t.kategori ? " · " + escapeHtml(t.kategori) : ""}</small></div>
                <span class="tag ${isOut ? "red" : "green"}">${isOut ? "−" : "+"}${Dashboard.rp(t.nominal)}</span>
            </a>`;
        }).join("");
    },

    // ============ C. ABSENSI TERAKHIR ============
    labelAbsen(s) {
        return s === "izin" ? "Izin" : s === "sakit" ? "Sakit" : s === "hadir" ? "Hadir" : "Alpha";
    },

    renderAbsensi(absensi) {
        const wrap = document.getElementById("absensiTerakhir");
        if (!wrap) return;
        const semua = absensi || [];
        if (!semua.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada data absensi.</div>`;
            return;
        }
        const tTerakhir = semua.map(r => String(r.tanggal || "")).filter(Boolean).sort().reverse()[0];
        const hari = semua.filter(r => String(r.tanggal) === String(tTerakhir));
        const takHadir = hari.filter(r => r.status !== "hadir")
            .sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")));
        const nHadir = hari.length - takHadir.length;
        const sub = `${Dashboard.fmtTanggal(tTerakhir)} · ${nHadir} hadir · ${takHadir.length} tidak hadir`;
        if (!takHadir.length) {
            wrap.innerHTML = `<div class="dash-empty">✅ ${escapeHtml(sub)} — lengkap hadir!</div>`;
            return;
        }
        wrap.innerHTML = `<div class="dash-empty" style="padding:2px 0 6px">${escapeHtml(sub)}</div>` + takHadir.slice(0, 4).map(r => `
            <div class="dash-item">
                <div class="di"><i class="fa-solid fa-user-xmark"></i></div>
                <div class="db"><b>${escapeHtml(r.nama || "-")}</b>
                    <small>${escapeHtml(r.kegiatan || r.alasan || "-")}</small></div>
                <span class="tag ${r.status === "alpha" ? "red" : r.status === "sakit" ? "green" : "yellow"}">${Dashboard.labelAbsen(r.status)}</span>
            </div>`).join("")
            + (takHadir.length > 4 ? `<div class="dash-empty">+${takHadir.length - 4} pengurus lainnya…</div>` : "");
    },

    // ============ D. PROGRES PROGRAM KERJA ============
    renderProgram(programList) {
        const sumEl = document.getElementById("progSummary");
        const wrap = document.getElementById("progresProgram");
        if (!wrap) return;
        const semua = programList || [];
        const berjalan = semua.filter(p => p.status === "berjalan").length;
        const selesai = semua.filter(p => p.status === "selesai").length;
        const avg = semua.length
            ? Math.round(semua.reduce((a, p) => a + (parseInt(p.progress, 10) || 0), 0) / semua.length)
            : 0;

        if (sumEl) {
            sumEl.innerHTML = `
                <div class="ps-box"><b>${semua.length}</b><span>Total</span></div>
                <div class="ps-box"><b>${berjalan}</b><span>Berjalan</span></div>
                <div class="ps-box"><b>${selesai}</b><span>Selesai</span></div>
                <div class="ps-box"><b>${avg}%</b><span>Rata-rata</span></div>`;
        }

        if (!semua.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada program kerja tercatat.</div>`;
            return;
        }

        const urut = [...semua].sort((a, b) => {
            const pA = a.status === "berjalan" ? 0 : a.status === "rencana" ? 1 : 2;
            const pB = b.status === "berjalan" ? 0 : b.status === "rencana" ? 1 : 2;
            if (pA !== pB) return pA - pB;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        }).slice(0, 4);

        const stLbl = { rencana: "Rencana", berjalan: "Berjalan", selesai: "Selesai", batal: "Batal" };
        wrap.innerHTML = urut.map(p => {
            const prog = Math.max(0, Math.min(100, parseInt(p.progress, 10) || 0));
            const sekbid = Dashboard.sekbidMap[String(p.sekbid_id)] || "Umum";
            const tipe = (p.tipe || "tahunan") === "bulanan" ? "Bulanan" : "Tahunan";
            const cls = p.status === "selesai" ? "green" : p.status === "berjalan" ? "yellow" : "gray";
            return `
                <div class="prog-item">
                    <div class="prog-item-top">
                        <b>${escapeHtml(p.nama || "Tanpa nama")}</b>
                        <span class="tag ${cls}">${escapeHtml(stLbl[p.status] || p.status || "-")} · ${prog}%</span>
                    </div>
                    <div class="dash-bar ${prog >= 100 ? "green" : ""}"><span style="width:${prog}%"></span></div>
                    <div class="prog-item-sub">
                        <span>${escapeHtml(tipe)} · ${escapeHtml(sekbid)}</span>
                        <span>${p.pj ? "PJ: " + escapeHtml(p.pj) : ""}</span>
                    </div>
                </div>`;
        }).join("");
    },

    // ============ E. PAPAN INFORMASI HARIAN INTERNAL ============
    renderInformasi(infoList) {
        const wrap = document.getElementById("infoInternal");
        if (!wrap) return;
        const rows = (infoList || []).slice(0, 3);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada broadcast informasi internal pengurus.</div>`;
            return;
        }
        wrap.innerHTML = rows.map(it => {
            const chips = [];
            if (it.kepada) chips.push(`<span class="ibi-chip"><i class="fa-solid fa-people-group"></i> ${escapeHtml(it.kepada)}</span>`);
            if (it.tanggal) chips.push(`<span class="ibi-chip"><i class="fa-solid fa-calendar-days"></i> ${escapeHtml(it.tanggal)}</span>`);
            if (it.jam) chips.push(`<span class="ibi-chip"><i class="fa-regular fa-clock"></i> ${escapeHtml(it.jam)}</span>`);
            if (it.tempat) chips.push(`<span class="ibi-chip"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(it.tempat)}</span>`);
            return `
                <a class="info-bento-item" href="informasi?id=${it.id}">
                    <div class="ibi-top">
                        <span class="ibi-pin"><i class="fa-solid fa-thumbtack"></i> Pengumuman Pengurus</span>
                        <span class="ibi-time">${escapeHtml(Dashboard.relatif(it.created_at))}</span>
                    </div>
                    <div class="ibi-title">${escapeHtml(it.judul || "Informasi")}</div>
                    ${chips.length ? `<div class="ibi-meta">${chips.join("")}</div>` : ""}
                </a>`;
        }).join("");
    },

    // ============ F. INBOX SISWA (ASPIRASI & LAGU) ============
    renderInbox(aspirasiList, laguList) {
        const asp = aspirasiList || [];
        const lagu = laguList || [];

        const aspPending = asp.filter(a => !String(a.balasan || "").trim());
        const laguPending = lagu.filter(l => !l.selesai);

        const bAsp = document.getElementById("badgeAspirasi");
        const bLagu = document.getElementById("badgeLagu");
        if (bAsp) bAsp.textContent = String(aspPending.length);
        if (bLagu) bLagu.textContent = String(laguPending.length);

        const aspPane = document.getElementById("inboxAspirasiPane");
        if (aspPane) {
            const tampilAsp = (aspPending.length ? aspPending : asp).slice(0, 3);
            if (!tampilAsp.length) {
                aspPane.innerHTML = `<div class="dash-empty">Belum ada aspirasi siswa masuk.</div>`;
            } else {
                aspPane.innerHTML = tampilAsp.map(a => {
                    const sudahBalas = !!String(a.balasan || "").trim();
                    const rahasia = !!a.is_private;
                    const cuplikan = String(a.isi || "").trim().slice(0, 75) + (String(a.isi || "").length > 75 ? "…" : "");
                    return `
                        <a class="dash-item" href="../index#/aspirasi">
                            <div class="di"><i class="fa-solid ${rahasia ? "fa-user-secret" : "fa-comment-dots"}"></i></div>
                            <div class="db">
                                <b>${escapeHtml(a.nama || "Anonim")}${a.kelas ? ` (${escapeHtml(a.kelas)})` : ""}</b>
                                <small>${escapeHtml(cuplikan)} · ${Dashboard.relatif(a.created_at)}</small>
                            </div>
                            <span class="tag ${rahasia ? "red" : sudahBalas ? "green" : "yellow"}">${rahasia ? "Rahasia" : sudahBalas ? "Dibalas" : "Belum Balas"}</span>
                        </a>`;
                }).join("") + `<div class="pane-foot"><a class="go" href="../index#/aspirasi">Buka halaman aspirasi →</a></div>`;
            }
        }

        const laguPane = document.getElementById("inboxLaguPane");
        if (laguPane) {
            const tampilLagu = (laguPending.length ? laguPending : lagu).slice(0, 3);
            if (!tampilLagu.length) {
                laguPane.innerHTML = `<div class="dash-empty">Belum ada request lagu masuk.</div>`;
            } else {
                laguPane.innerHTML = tampilLagu.map(l => `
                    <a class="dash-item" href="../index#/musik">
                        <div class="di"><i class="fa-solid fa-music"></i></div>
                        <div class="db">
                            <b>${escapeHtml(l.judul || "-")} — ${escapeHtml(l.penyanyi || "-")}</b>
                            <small>Dari: ${escapeHtml(l.nama || "Anonim")} · ${Dashboard.relatif(l.created_at)}</small>
                        </div>
                        <span class="tag ${l.selesai ? "green" : "yellow"}">${l.selesai ? "Diputar" : "Pending"}</span>
                    </a>`).join("") + `<div class="pane-foot"><a class="go" href="../index#/musik">Buka request lagu →</a></div>`;
            }
        }
    },

    // ============ G1. DOKUMEN TERBARU ============
    renderDokumen(dokumen) {
        const wrap = document.getElementById("dokBaru");
        if (!wrap) return;
        const rows = [...(dokumen || [])]
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
            .slice(0, 4);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada dokumen.</div>`;
            return;
        }
        const ikon = { pdf: "fa-solid fa-file-pdf", doc: "fa-solid fa-file-word", docx: "fa-solid fa-file-word", xls: "fa-solid fa-file-excel", xlsx: "fa-solid fa-file-excel", ppt: "fa-solid fa-file-powerpoint", pptx: "fa-solid fa-file-powerpoint", zip: "fa-solid fa-file-zipper" };
        wrap.innerHTML = rows.map(d => {
            const ext = String(d.file_type || "").toLowerCase();
            return `<a class="dash-item" href="dokumen">
                <div class="di"><i class="${ikon[ext] || "fa-solid fa-file"}"></i></div>
                <div class="db"><b>${escapeHtml(d.nama || "Tanpa nama")}</b>
                    <small>${ext.toUpperCase() || "FILE"} · ${Dashboard.fmtTanggal((d.created_at || "").slice(0, 10))} · ${escapeHtml(d.pengunggah || "-")}</small></div>
            </a>`;
        }).join("");
    },

    // ============ G2. AKTIVITAS TERBARU ============
    renderAktivitas(agenda, kas, tabungan, absensi, dokumen, infoList, notulensiList, programList) {
        const wrap = document.getElementById("aktivitasList");
        if (!wrap) return;
        const ev = [];
        const kapan = (r) => r.created_at || r.updated_at || r.tanggal || null;
        (infoList || []).forEach(i => {
            if (i.created_at) ev.push({ t: i.created_at, html: `<b>Info internal:</b> ${escapeHtml(i.judul || "Pengumuman")}` });
        });
        (notulensiList || []).forEach(n => {
            const k = kapan(n);
            if (k) ev.push({ t: k, html: `<b>Notulensi:</b> ${escapeHtml(n.judul || "Rapat")}` });
        });
        (programList || []).forEach(p => {
            if (p.created_at) ev.push({ t: p.created_at, html: `<b>Program:</b> ${escapeHtml(p.nama || "-")} (${parseInt(p.progress, 10) || 0}%)` });
        });
        (agenda || []).forEach(a => {
            if (a.created_at) ev.push({ t: a.created_at, html: `<b>Agenda:</b> ${escapeHtml(a.judul || "Tanpa judul")}` });
        });
        (dokumen || []).forEach(d => {
            if (d.created_at) ev.push({ t: d.created_at, html: `<b>Dokumen:</b> ${escapeHtml(d.nama || "Tanpa nama")}` });
        });
        (kas || []).forEach(t => {
            const k = kapan(t);
            if (k) ev.push({ t: k, html: `<b>Kas ${t.jenis === "keluar" ? "keluar" : "masuk"}:</b> ${escapeHtml(t.keterangan || "-")} (${(t.jenis === "keluar" ? "−" : "+")}${Dashboard.rp(t.nominal)})` });
        });
        (tabungan || []).forEach(r => {
            const k = kapan(r);
            if (k) ev.push({ t: k, html: `<b>Tabungan ${r.jenis === "keluar" ? "diambil" : ""}:</b> ${escapeHtml(r.nama || "-")} (${r.jenis === "keluar" ? "−" : "+"}${Dashboard.rp(r.nominal)})` });
        });
        (absensi || []).forEach(r => {
            if (r.tanggal && r.status !== "hadir") ev.push({ t: r.created_at || r.tanggal, html: `<b>Absensi:</b> ${escapeHtml(r.nama || "-")} (${Dashboard.labelAbsen(r.status)})` });
        });
        ev.sort((a, b) => new Date(b.t) - new Date(a.t));
        const rows = ev.slice(0, 6);
        if (!rows.length) {
            wrap.innerHTML = `<div class="dash-empty">Belum ada aktivitas tercatat.</div>`;
            return;
        }
        wrap.innerHTML = rows.map(e => `
            <div class="tl-item"><span class="tl-dot"></span><div class="tb">${e.html}</div><time>${Dashboard.relatif(e.t)}</time></div>`).join("");
    }
};

document.addEventListener("DOMContentLoaded", () => Dashboard.init());
