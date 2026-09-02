// =========================================================================
// SEKBID — BPH & seksi bidang dari database (kartu orang, gaya pembina)
// =========================================================================

const Sekbid = {
    terinisialisasi: false,

    async init() {
        if (Sekbid.terinisialisasi) return;
        Sekbid.terinisialisasi = true;
        const container = document.getElementById("sekbidList");
        if (!container) return;

        const render = async (data) => {
            const jum = document.getElementById("jumSekbid");
            if (jum && data) jum.textContent = data.length;
            const listBPH = (data || []).filter(s => s.kategori === "BPH");
            const listSekbid = (data || []).filter(s => s.kategori !== "BPH");
            let html = "";
            html += Sekbid.renderGrup("Badan Pengurus Harian", listBPH, "BPH");
            html += Sekbid.renderGrup("Seksi Bidang", listSekbid, "SEKBID");
            // tombol kelola agenda buat OSIS
            const u = OsisAuth.getUser && OsisAuth.getUser();
            if (u && u.mode === "osis") {
                html += `<div style="margin:12px 0 8px; text-align:center"><a href="osis/agenda.html" class="btn btn-red btn-sm"><i class="fa-solid fa-calendar-check"></i> Kelola Agenda Sekbid</a></div>`;
            }
            container.innerHTML = html;
            // render agenda per sekbid di bawahnya
            Sekbid.renderAgendaForList(data);
        };

        const cached = Cache.get("sekbid");
        if (cached) {
            render(cached);
            getSekbid().then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Cache.set("sekbid", fresh);
                    render(fresh);
                }
            }).catch(() => {});
            return;
        }

        try {
            const data = await getSekbid();
            Cache.set("sekbid", data);
            await render(data);
        } catch (err) {
            console.error(err);
            container.innerHTML = `<div class="loading-block">Gagal memuat data. Cek koneksi.</div>`;
        }
    },

    async renderAgendaForList(sekbidList) {
        try {
            const all = await getAllAgenda();
            if (!all || all.length === 0) return;
            // group by sekbid_id
            const bySekbid = {};
            all.forEach(a => {
                const k = String(a.sekbid_id);
                if (!bySekbid[k]) bySekbid[k] = [];
                bySekbid[k].push(a);
            });
            const container = document.getElementById("sekbidList");
            if (!container) return;
            let html = `<div class="agenda-public-wrap" style="margin-top:18px"><div class="grup-label">Agenda Terbaru <span class="chip-num">${all.length}</span></div>`;
            for (const sid of Object.keys(bySekbid)) {
                const sek = (sekbidList || []).find(s => String(s.id) === sid);
                const nama = sek ? sek.nama : `Sekbid #${sid}`;
                const list = bySekbid[sid].slice(0, 3);
                html += `
                    <div class="agenda-sekbid">
                        <div class="agenda-sekbid-head"><i class="fa-solid fa-calendar"></i> ${escapeHtml(nama)} <span class="chip-num">${bySekbid[sid].length}</span></div>
                        <div class="agenda-mini-list">
                            ${list.map(a => `
                                <div class="agenda-mini-item">
                                    <span class="agenda-mini-date">${a.tanggal ? new Date(a.tanggal).toLocaleDateString("id-ID", {day:"numeric", month:"short"}) : ""}</span>
                                    <span class="agenda-mini-judul">${escapeHtml(a.judul)}</span>
                                    <span class="agenda-status ${a.status}">${a.status}</span>
                                </div>
                            `).join("")}
                            ${bySekbid[sid].length > 3 ? `<div style="font-size:0.7rem; color:var(--gray); text-align:center; margin-top:6px"><a href="osis/agenda.html">Lihat semua (${bySekbid[sid].length}) →</a></div>` : ""}
                        </div>
                    </div>`;
            }
            html += `</div>`;
            container.insertAdjacentHTML("beforeend", html);
        } catch (e) { console.warn("agenda public fail", e.message); }
    },

    renderGrup(judul, list, peran) {
        if (!list || list.length === 0) return "";
        let html = `
            <div class="grup-label">
                ${judul} <span class="chip-num">${list.length}</span>
            </div>`;
        list.forEach(item => {
            html += Sekbid.seksi(item, peran);
        });
        return html;
    },

    seksi(item, peran) {
        const nama = escapeHtml(item.nama);
        const icon = item.icon || "fa-solid fa-users";
        const ikon = icon.trim().startsWith("fa")
            ? `<i class="${escapeHtml(icon)}"></i>`
            : escapeHtml(icon);
        const foto = item.foto
            ? `<img src="${getFoto(item.foto)}" alt="${nama}" loading="lazy"
                   onerror="this.parentNode.classList.add('tanpa-foto'); this.remove();">`
            : "";
        return `
            <div class="orang-block">
                <div class="orang-photo${item.foto ? "" : " tanpa-foto"}">
                    ${foto}
                    <span class="orang-fallback">${ikon}</span>
                </div>
                <div class="orang-info">
                    <span class="orang-role">${peran}</span>
                    <h4>${nama}</h4>
                    <p>${escapeHtml(item.deskripsi)}</p>
                </div>
            </div>`;
    }
};

if (typeof Router !== "undefined") {
    Router.register("sekbid", () => Sekbid.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Sekbid.init());
} else {
    Sekbid.init();
}
