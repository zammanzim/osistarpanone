// =========================================================================
// AKSES — kelola kendali per halaman (KHUSUS super_admin).
// Matriks user x halaman + sekbid pemilik (khusus aturan agenda).
// =========================================================================

const Akses = {
    // Cuma halaman/bagian yang BENAR-BENAR ada:
    // - HALAMAN_OSIS = file di folder /osis (+ kunci yang dicek modulnya)
    // - HALAMAN_WEB = bagian beranda yang bisa diedit (mode edit homepage)
    // Evaluasi/Formulir/Notulensi/Proker/Task DIBUANG: halamannya tidak ada
    // di /osis (cuma sisa di folder *bin*) dan tidak dipakai kode manapun.
    HALAMAN_OSIS: [
        ["anggota", "Anggota"],
        ["absensi", "Absensi"],
        ["tabungan", "Tabungan"],
        ["keuangan", "Keuangan"],
        ["agenda", "Agenda"],
        ["dokumen", "Dokumen"],
        ["poster", "Poster"],
        ["program", "Program (Tahunan+Bulanan)"],
    ],
    HALAMAN_WEB: [
        ["galeri", "Galeri"],
        ["prestasi", "Prestasi"],
        ["kegiatan", "Kegiatan"],
        ["aspirasi", "Aspirasi"],
        ["lagu", "Lagu"],
        ["polling", "Polling Waketos"],
        ["site", "Site/Edit"],
    ],
    rows: [],
    sekbidList: [],
    filterQ: "",
    detailId: null,

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        try { await OsisAuth.refreshAkses(); } catch {}
        if (!OsisAuth.isSuper()) {
            const wrap = document.getElementById("aksesWrap");
            if (wrap) {
                wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-lock"></i> Halaman ini khusus super admin.</div>`;
            }
            return;
        }
        document.getElementById("aksesQ")?.addEventListener("input", (e) => {
            Akses.filterQ = e.target.value || "";
            Akses.render();
        });
        // Hidupkan warna hijau checkbox langsung saat dicentang di popup
        document.getElementById("aksDetailBody")?.addEventListener("change", (e) => {
            const cb = e.target.closest && e.target.closest(".aks-check input");
            if (cb) cb.closest(".aks-check")?.classList.toggle("on", cb.checked);
        });
        const detailEl = document.getElementById("aksDetail");
        if (detailEl) {
            detailEl.addEventListener("click", (e) => {
                if (e.target === detailEl) Akses.tutupDetail();
            });
        }
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("aksDetail")?.classList.contains("open")) Akses.tutupDetail();
        });
        await Akses.muat();
    },

    async muat() {
        const wrap = document.getElementById("aksesWrap");
        if (wrap) wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat data akses...</div>`;
        try {
            const u = OsisAuth.getUser();
            const [rows, sekbid] = await Promise.all([
                aksesMatriks(u.id),
                getSekbid().catch(() => []),
            ]);
            Akses.rows = rows || [];
            Akses.sekbidList = sekbid || [];
            Akses.render();
        } catch (err) {
            console.error(err);
            if (wrap) wrap.innerHTML = `<div class="pesan-empty">Gagal memuat: ${escapeHtml(err.message)}</div>`;
        }
    },

    // Daftar nama ringkas, dikelompokkan per angkatan — ketuk satu nama
    // baru muncul checkbox-nya. Tanpa data angkatan = tampil datar biasa.
    kunciAngkatan(r) {
        return String(r.angkatan || "").trim();
    },

    labelAngkatan(kunci) {
        if (!kunci) return "Tanpa angkatan";
        return /^angkatan\b/i.test(kunci) ? kunci : "Angkatan " + kunci;
    },

    render() {
        const wrap = document.getElementById("aksesWrap");
        if (!wrap) return;
        if (!Akses.rows.length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-users"></i> Belum ada user OSIS.</div>`;
            return;
        }
        const q = (Akses.filterQ || "").trim().toLowerCase();
        const rows = Akses.rows.filter(r => !q ||
            String(r.nama || "").toLowerCase().includes(q) ||
            String(r.username || "").toLowerCase().includes(q) ||
            String(r.jabatan || "").toLowerCase().includes(q));
        if (!rows.length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada nama yang cocok.</div>`;
            return;
        }
        const kartuOrang = (r) => {
            const nHal = new Set(r.halaman || []).size;
            const inisial = (String(r.nama || r.username || "?").trim().charAt(0) || "?").toUpperCase();
            return `
            <button type="button" class="aks-row" onclick="Akses.detail(${r.id})">
                <span class="ava">${escapeHtml(inisial)}</span>
                <span style="min-width:0">
                    <span class="nm">${escapeHtml(r.nama || r.username || "-")}</span>
                    <span class="sub">@${escapeHtml(r.username || "-")} · ${escapeHtml(r.jabatan || "-")}${r.sekbid_nama ? ` · ${escapeHtml(r.sekbid_nama)}` : ""} · ${nHal} halaman</span>
                </span>
                <i class="fa-solid fa-chevron-right chev"></i>
            </button>`;
        };
        // Ada data angkatan? Kalau tidak (RPC lama) tampil datar seperti dulu.
        if (!rows.some(r => Akses.kunciAngkatan(r))) {
            wrap.innerHTML = `<div class="aks-sub" style="margin-bottom:8px">${rows.length} orang · ketuk nama untuk atur akses</div>`
                + rows.map(kartuOrang).join("");
            return;
        }
        const grup = {};
        rows.forEach(r => {
            const k = Akses.kunciAngkatan(r);
            (grup[k] = grup[k] || []).push(r);
        });
        const angka = (s) => {
            const m = String(s || "").match(/\d+(\.\d+)?/);
            return m ? parseFloat(m[0]) : null;
        };
        const kunciUrut = Object.keys(grup).sort((a, b) => {
            if (!a && b) return 1;
            if (!b && a) return -1;
            // Angka terbesar dulu: "ADIABI JILID 4" di atas "ADIABI JILID 3"
            const na = angka(a), nb = angka(b);
            if (na !== null && nb !== null && na !== nb) return nb - na;
            return a.localeCompare(b);
        });
        wrap.innerHTML = `<div class="aks-sub" style="margin-bottom:8px">${rows.length} orang · ketuk nama untuk atur akses</div>` + kunciUrut.map(k => `
            <div class="aks-angkatan"><i class="fa-solid fa-users"></i> ${escapeHtml(Akses.labelAngkatan(k))}<span class="cnt">${grup[k].length} orang</span></div>
            ${grup[k].map(kartuOrang).join("")}`).join("");
    },

    // Popup per orang: sekbid pemilik + checkbox halaman + simpan.
    detail(id) {
        const r = (Akses.rows || []).find(x => String(x.id) === String(id));
        if (!r) return;
        Akses.detailId = id;
        document.getElementById("aksDetailTitle").textContent = "Akses — " + (r.nama || r.username || "-");
        const punya = new Set(r.halaman || []);
        const sekbidOpts = `<option value="">—</option>` + Akses.sekbidList.map((s) =>
            `<option value="${s.id}" ${String(s.id) === String(r.sekbid_id) ? "selected" : ""}>${escapeHtml(s.nama)}</option>`
        ).join("");
        const checks = (daftar) => daftar.map(([k, lbl]) => `
            <label class="aks-check${punya.has(k) ? " on" : ""}">
                <input type="checkbox" data-aks-user="${r.id}" data-aks-hal="${k}" ${punya.has(k) ? "checked" : ""}>
                ${lbl}
            </label>`).join("");
        document.getElementById("aksDetailBody").innerHTML = `
            <div class="aks-sub">@${escapeHtml(r.username || "-")} · ${escapeHtml(r.jabatan || "-")}${Akses.kunciAngkatan(r) ? ` · ${escapeHtml(Akses.labelAngkatan(Akses.kunciAngkatan(r)))}` : ""}${r.sekbid_nama ? ` · Sekbid ${escapeHtml(r.sekbid_nama)}` : ""} · ${punya.size} halaman dicentang</div>
            <div class="field" style="margin-top:8px">
                <label>Sekbid pemilik (khusus aturan agenda)</label>
                <select class="admin-input" data-aks-sekbid="${r.id}">${sekbidOpts}</select>
            </div>
            <div class="aks-sub" style="margin-top:10px">Halaman OSIS (/osis)</div>
            <div class="aks-grid">${checks(Akses.HALAMAN_OSIS)}</div>
            <div class="aks-sub" style="margin-top:10px">Bagian beranda (mode edit)</div>
            <div class="aks-grid">${checks(Akses.HALAMAN_WEB)}</div>
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:12px">
                <button class="btn btn-white btn-sm" onclick="Akses.tutupDetail()">Batal</button>
                <button class="btn btn-red btn-sm" onclick="Akses.simpan(${r.id})"><i class="fa-solid fa-floppy-disk"></i> Simpan</button>
            </div>`;
        document.getElementById("aksDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("aksDetail")?.classList.remove("open");
        document.body.style.overflow = "";
        Akses.detailId = null;
    },

    async simpan(targetId) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const halaman = [...document.querySelectorAll(`input[data-aks-user="${targetId}"]:checked`)]
            .map((el) => el.dataset.aksHal);
        const sekbidEl = document.querySelector(`select[data-aks-sekbid="${targetId}"]`);
        const sekbidVal = sekbidEl && sekbidEl.value ? parseInt(sekbidEl.value, 10) : null;
        const __specAks = () => ({ modul: "akses", op: "update",
            label: "Akses user #" + targetId,
            payload: { targetId, halaman, sekbidId: sekbidVal }, files: [], cacheKeys: [] });
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__specAks()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre();
            Akses.tutupDetail();
            return;
        }
        const btn = document.querySelector(`#aksDetailBody .btn-red`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            await setAkses(u.id, targetId, halaman, sekbidVal, true);
            showToast("Akses diperbarui.", "success");
            Akses.tutupDetail();
            await Akses.muat();
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __specAks())) {
                Outbox.sesudahAntre();
                return;
            }
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },
};

document.addEventListener("DOMContentLoaded", () => Akses.init());
