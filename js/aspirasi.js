// =========================================================================
// ASPIRASI — form kirim aspirasi + sakelar buka/tutup
// =========================================================================

const Aspirasi = {
    status: "BUKA",
    terinisialisasi: false,

    async init() {
        if (Aspirasi.terinisialisasi) return;
        Aspirasi.terinisialisasi = true;
        Aspirasi.status = await cekStatusAspirasi();
        if (Aspirasi.status === "TUTUP") Aspirasi.kunciFormulir();
        Aspirasi.muatPesan();
    },

    // ============ DAFTAR PESAN — SWR ============
    async muatPesan() {
        const list = document.getElementById("daftarPesan");
        if (!list) return;

        const render = (data) => {
            const isOsis = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
            const visible = isOsis ? data : (data || []).filter(p => !p.is_private);
            const jum = document.getElementById("jumPesan");
            if (jum) jum.textContent = visible.length;
            if (!visible || visible.length === 0) {
                list.innerHTML = isOsis
                    ? `<div class="pesan-empty"><i class="fa-solid fa-comments"></i> Belum ada suara masuk.</div>`
                    : `<div class="pesan-empty"><i class="fa-solid fa-comments"></i> Belum ada suara public. Private hanya OSIS yang bisa lihat.</div>`;
                return;
            }
            const deviceId = getDeviceId();
            const batasHapus = Date.now() - 3600000;
            const groups = [];
            let curKey = null;
            let curGroup = null;
            visible.forEach(p => {
                const key = new Date(p.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
                if (key !== curKey) {
                    curKey = key;
                    const display = new Date(p.created_at).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
                    curGroup = { key, display, items: [] };
                    groups.push(curGroup);
                }
                curGroup.items.push(p);
            });
            list.innerHTML = groups.map(g => {
                const sep = `<div class="pesan-date-sep"><span>${g.display}</span><span class="pesan-date-line"></span></div>`;
                const items = g.items.map(p => {
                    const own = p.device_id === deviceId && new Date(p.created_at).getTime() > batasHapus;
                    const canHapus = own || isOsis;
                    const lock = p.is_private ? `<span title="Private — hanya OSIS" style="color:var(--red);font-size:0.7rem"><i class="fa-solid fa-lock"></i> Private</span>` : "";
                    return `
                <div class="pesan-item" style="${p.is_private ? "border-style:dashed" : ""}">
                    <div class="pesan-meta">
                        <span class="pesan-nama"><i class="fa-solid fa-user"></i> ${escapeHtml(p.nama || "Anonim")}</span>
                        <span class="pesan-kelas">${escapeHtml(p.kelas || "-")}</span>
                        ${lock}
                        <span class="pesan-waktu">${Aspirasi.formatWaktu(p.created_at)}</span>
                        ${canHapus ? `<button class="hapus-btn" onclick="Aspirasi.hapus(${p.id})" title="${isOsis ? "Hapus (OSIS)" : "Hapus pesanku"}"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                    </div>
                    <p class="pesan-isi">${escapeHtml(p.isi)}</p>
                </div>`;
                }).join("");
                return sep + items;
            }).join("");
        };

        const cached = Cache.get("aspirasi");
        if (cached) {
            render(cached);
            getAspirasi().then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Cache.set("aspirasi", fresh);
                    render(fresh);
                }
            }).catch(() => {});
            return;
        }

        try {
            const data = await getAspirasi();
            Cache.set("aspirasi", data);
            render(data);
        } catch (err) {
            console.error(err);
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat suara. Cek koneksi.</div>`;
        }
    },

    formatWaktu(t) {
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return ""; }
    },

    kunciFormulir() {
        const nama = document.getElementById("namaSiswa");
        const kelas = document.getElementById("kelasSiswa");
        const isi = document.getElementById("isiAspirasi");
        const btn = document.getElementById("btnKirimAspirasi");

        [nama, kelas, isi].forEach(el => {
            if (el) { el.disabled = true; el.placeholder = "Ditutup sementara"; }
        });
        if (isi) isi.placeholder = "Maaf, kotak aspirasi sedang ditutup sementara oleh pengurus OSIS.";
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-lock"></i> Kotak Aspirasi Ditutup';
            btn.style.opacity = "0.6";
            btn.style.cursor = "not-allowed";
            btn.style.pointerEvents = "none";
        }
    },

    async kirim() {
        if (Aspirasi.status === "TUTUP") return;

        const nama = document.getElementById("namaSiswa").value.trim();
        const kelas = document.getElementById("kelasSiswa").value.trim();
        const isi = document.getElementById("isiAspirasi").value.trim();
        const isPrivate = !!document.getElementById("isPrivateAspirasi")?.checked;
        const btn = document.getElementById("btnKirimAspirasi");

        if (!isi) {
            showToast("Unek-uneknya diisi dulu yaa, jangan dikosongkan!", "error");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';

        try {
            await kirimAspirasi(nama || "Anonim", kelas || "-", isi, isPrivate);
            showToast(isPrivate ? "Terkirim sebagai private (hanya OSIS bisa lihat)." : "Terima kasih! Aspirasimu sudah terkirim.", "success");
            document.getElementById("namaSiswa").value = "";
            document.getElementById("kelasSiswa").value = "";
            document.getElementById("isiAspirasi").value = "";
            const cb = document.getElementById("isPrivateAspirasi"); if (cb) cb.checked = false;
            Cache.del("aspirasi");
            Aspirasi.muatPesan();
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_LIMIT") {
                showToast("Kamu udah kirim 3 suara hari ini. Coba lagi besok yaa!", "error");
            } else {
                showToast("Waduh, gagal terkirim. Cek koneksi lalu coba lagi ya!", "error");
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Suara Tarpan';
        }
    },

    // ============ HAPUS PESAN ============
    async hapus(id) {
        const yakin = await showPopup("Yakin mau hapus pesan ini?", "confirm");
        if (!yakin) return;
        const isOsis = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        try {
            if (isOsis) {
                const u = OsisAuth.getUser();
                await hapusAspirasiOsis(u.id, id);
            } else {
                await hapusAspirasiSendiri(id);
            }
            showToast("Pesan berhasil dihapus", "success");
            Cache.del("aspirasi");
            Aspirasi.muatPesan();
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_EXPIRED") {
                showPopup("Pesan udah lebih dari 1 jam, udah ga bisa dihapus.", "error");
            } else if (err.message === "ERR_FORBIDDEN") {
                showPopup("Ini bukan pesan kamu!", "error");
            } else if (err.message === "ERR_NO_AUTH") {
                showPopup("Cuma OSIS yang bisa hapus pesan ini.", "error");
            } else {
                showPopup("Gagal hapus. Cek koneksi lalu coba lagi.", "error");
            }
        }
    },
};

if (typeof Router !== "undefined") {
    Router.register("aspirasi", () => Aspirasi.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Aspirasi.init());
} else {
    Aspirasi.init();
}
