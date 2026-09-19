// =========================================================================
// AKSES — kelola kendali per halaman (KHUSUS super_admin).
// Matriks user x halaman + sekbid pemilik (khusus aturan agenda).
// =========================================================================

const Akses = {
    HALAMAN: [
        ["absensi", "Absensi"],
        ["tabungan", "Tabungan"],
        ["keuangan", "Keuangan"],
        ["agenda", "Agenda"],
        ["anggota", "Anggota"],
        ["dokumen", "Dokumen"],
        ["evaluasi", "Evaluasi"],
        ["formulir", "Formulir"],
        ["notulensi", "Notulensi"],
        ["proker", "Proker"],
        ["program", "Program"],
        ["task", "Task"],
        ["galeri", "Galeri"],
        ["prestasi", "Prestasi"],
        ["kegiatan", "Kegiatan"],
        ["aspirasi", "Aspirasi"],
        ["lagu", "Lagu"],
        ["site", "Site/Edit"],
    ],
    rows: [],
    sekbidList: [],

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

    render() {
        const wrap = document.getElementById("aksesWrap");
        if (!wrap) return;
        if (!Akses.rows.length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-users"></i> Belum ada user OSIS.</div>`;
            return;
        }
        const sekbidOpts = (terpilih) =>
            `<option value="">—</option>` + Akses.sekbidList.map((s) =>
                `<option value="${s.id}" ${String(s.id) === String(terpilih) ? "selected" : ""}>${escapeHtml(s.nama)}</option>`
            ).join("");
        wrap.innerHTML = Akses.rows.map((r) => {
            const punya = new Set(r.halaman || []);
            const checks = Akses.HALAMAN.map(([k, lbl]) => `
                <label class="aks-check${punya.has(k) ? " on" : ""}">
                    <input type="checkbox" data-aks-user="${r.id}" data-aks-hal="${k}" ${punya.has(k) ? "checked" : ""}>
                    ${lbl}
                </label>`).join("");
            return `
            <div class="rekap-card aks-card" data-aks-row="${r.id}">
                <h3><i class="fa-solid fa-user"></i> ${escapeHtml(r.nama || r.username || "-")}
                    <span class="jenis total" style="margin-left:auto">${escapeHtml(r.jabatan || "-")}</span></h3>
                <div class="aks-sub">@${escapeHtml(r.username || "-")}${r.sekbid_nama ? ` · Sekbid ${escapeHtml(r.sekbid_nama)}` : ""}</div>
                <div class="field" style="margin-top:8px">
                    <label>Sekbid pemilik (khusus aturan agenda)</label>
                    <select class="admin-input" data-aks-sekbid="${r.id}">${sekbidOpts(r.sekbid_id)}</select>
                </div>
                <div class="aks-grid">${checks}</div>
                <div style="display:flex; justify-content:flex-end; margin-top:10px">
                    <button class="btn btn-red btn-sm" onclick="Akses.simpan(${r.id})"><i class="fa-solid fa-floppy-disk"></i> Simpan</button>
                </div>
            </div>`;
        }).join("");
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
            return;
        }
        const btn = document.querySelector(`[data-aks-row="${targetId}"] .btn-red`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            await setAkses(u.id, targetId, halaman, sekbidVal, true);
            showToast("Akses diperbarui.", "success");
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
