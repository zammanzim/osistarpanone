// =========================================================================
// LAGU — request lagu radio jam istirahat (form + playlist)
// =========================================================================

const Lagu = {
    terinisialisasi: false,

    async init() {
        if (Lagu.terinisialisasi) return;
        Lagu.terinisialisasi = true;
        Lagu.muatDaftar();
    },

    // ============ PLAYLIST — SWR ============
    async muatDaftar() {
        const list = document.getElementById("daftarLagu");
        if (!list) return;

        const render = (data) => {
            const jum = document.getElementById("jumLagu");
            if (jum) jum.textContent = data.length;
            if (!data || data.length === 0) {
                list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-headphones"></i> Playlist masih kosong. Jadilah request pertama!</div>`;
                return;
            }
            const deviceId = getDeviceId();
            const batasHapus = Date.now() - 3600000;
            const isOsis = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
            const groups = [];
            let curKey = null;
            let curGroup = null;
            data.forEach(l => {
                const key = new Date(l.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
                if (key !== curKey) {
                    curKey = key;
                    const display = new Date(l.created_at).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
                    curGroup = { key, display, items: [] };
                    groups.push(curGroup);
                }
                curGroup.items.push(l);
            });
            list.innerHTML = groups.map(g => {
                const sep = `<div class="pesan-date-sep"><span>${g.display}</span><span class="pesan-date-line"></span></div>`;
                const items = g.items.map(l => {
                    const own = l.device_id === deviceId && new Date(l.created_at).getTime() > batasHapus;
                    const canHapus = own || isOsis;
                    return `
                <div class="lagu-item">
                    <div class="lagu-cover"><div class="lagu-kaset"><i class="fa-solid fa-music"></i></div></div>
                    <div class="lagu-body">
                        <div class="lagu-title">${escapeHtml(l.judul)}</div>
                        <div class="lagu-artis">${escapeHtml(l.penyanyi || "-")}</div>
                        ${l.pesan ? `<div class="lagu-pesan">${escapeHtml(l.pesan)}</div>` : ""}
                        <div class="lagu-meta">
                            <span><i class="fa-solid fa-user"></i> ${escapeHtml(l.nama || "Anonim")}</span>
                            <span class="pesan-waktu">${Lagu.formatWaktu(l.created_at)}</span>
                            ${canHapus ? `<button class="hapus-btn" onclick="Lagu.hapus(${l.id})" title="${isOsis ? "Hapus (OSIS)" : "Hapus request-ku"}"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                        </div>
                    </div>
                </div>`;
                }).join("");
                return sep + items;
            }).join("");
        };

        const cached = Cache.get("lagu");
        if (cached) {
            render(cached);
            getRequestLagu().then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Cache.set("lagu", fresh);
                    render(fresh);
                }
            }).catch(() => {});
            return;
        }

        try {
            const data = await getRequestLagu();
            Cache.set("lagu", data);
            render(data);
        } catch (err) {
            console.error(err);
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat playlist. Cek koneksi.</div>`;
        }
    },

    formatWaktu(t) {
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
        } catch { return ""; }
    },

    async kirim() {
        const judul = document.getElementById("judulLagu").value.trim();
        const penyanyi = document.getElementById("penyanyiLagu").value.trim();
        const kata = document.getElementById("kataLagu").value.trim();
        const nama = document.getElementById("namaPengirim").value.trim();
        const btn = document.getElementById("btnKirimLagu");

        if (!judul || !penyanyi) {
            showToast("Judul lagu dan penyanyinya diisi dulu yaa!", "error");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';

        try {
            await kirimRequestLagu(judul, penyanyi, kata, nama || "Anonim");
            showToast("Mantap! Lagu kamu masuk playlist.", "success");
            document.getElementById("judulLagu").value = "";
            document.getElementById("penyanyiLagu").value = "";
            document.getElementById("kataLagu").value = "";
            document.getElementById("namaPengirim").value = "";
            Cache.del("lagu");
            Lagu.muatDaftar();
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_LIMIT") {
                showToast("Request lagu hari ini udah 5. Ditabung dulu, besok request lagi yaa!", "error");
            } else {
                showToast("Waduh, gagal terkirim. Cek koneksi lalu coba lagi ya!", "error");
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-music"></i> Kirim Request Lagu';
        }
    },

    // ============ HAPUS REQUEST ============
    async hapus(id) {
        const yakin = await showPopup("Yakin mau hapus request lagu ini?", "confirm");
        if (!yakin) return;
        const isOsis = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        try {
            if (isOsis) {
                const u = OsisAuth.getUser();
                await hapusLaguOsis(u.id, id);
            } else {
                await hapusLaguSendiri(id);
            }
            showToast("Request lagu dihapus", "success");
            Cache.del("lagu");
            Lagu.muatDaftar();
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_EXPIRED") {
                showPopup("Request udah lebih dari 1 jam, udah ga bisa dihapus.", "error");
            } else if (err.message === "ERR_FORBIDDEN") {
                showPopup("Ini bukan request kamu!", "error");
            } else if (err.message === "ERR_NO_AUTH") {
                showPopup("Cuma OSIS yang bisa hapus ini.", "error");
            } else {
                showPopup("Gagal hapus. Cek koneksi lalu coba lagi.", "error");
            }
        }
    },
};

if (typeof Router !== "undefined") {
    Router.register("kontak", () => Lagu.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Lagu.init());
} else {
    Lagu.init();
}
