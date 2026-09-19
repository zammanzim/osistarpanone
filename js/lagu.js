// =========================================================================
// LAGU — request lagu radio jam istirahat (form + playlist)
// =========================================================================

const Lagu = {
    terinisialisasi: false,
    cache: [],
    editingId: null,

    async init() {
        if (Lagu.terinisialisasi) return;
        Lagu.terinisialisasi = true;
        if (typeof OsisAuth.refreshAkses === "function") {
            try { await OsisAuth.refreshAkses(); } catch {}
        }
        Lagu.muatDaftar();
    },

    // ============ PLAYLIST — SWR ============
    async muatDaftar() {
        const list = document.getElementById("daftarLagu");
        if (!list) return;

        const render = (data) => {
            Lagu.cache = data || [];
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
                    // Admin (OSIS): tombol edit/hapus cuma muncul pas edit mode aktif
                    // DAN punya kendali halaman lagu.
                    // Pengunjung biasa: tetap seperti dulu (request sendiri <1 jam).
                    const editMode = document.body.classList.contains("edit-mode");
                    const canKelola = isOsis
                        ? (editMode && OsisAuth.bisa && OsisAuth.bisa("lagu"))
                        : own;
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
                            ${canKelola ? `<button class="hapus-btn" onclick="Lagu.edit(${l.id})" title="${isOsis ? "Edit (OSIS)" : "Edit request-ku"}"><i class="fa-solid fa-pen"></i></button>` : ""}
                            ${canKelola ? `<button class="hapus-btn" onclick="Lagu.hapus(${l.id})" title="${isOsis ? "Hapus (OSIS)" : "Hapus request-ku"}"><i class="fa-solid fa-trash-can"></i></button>` : ""}
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
        // Mode edit: tombol kirim berubah jadi simpan perubahan
        if (Lagu.editingId) {
            await Lagu.simpanEdit();
            return;
        }

        const judul = document.getElementById("judulLagu").value.trim();
        const penyanyi = document.getElementById("penyanyiLagu").value.trim();
        const kata = document.getElementById("kataLagu").value.trim();
        const nama = document.getElementById("namaPengirim").value.trim();
        const btn = document.getElementById("btnKirimLagu");

        if (!judul || !penyanyi) {
            showToast("Judul lagu dan penyanyinya diisi dulu yaa!", "error");
            return;
        }

        const __spec = () => ({ modul: "lagu", op: "create",
            label: "Lagu: " + judul.slice(0, 42),
            payload: { judul, penyanyi, pesan: kata, nama: nama || "Anonim" },
            files: [], cacheKeys: ["lagu"] });
        const __sesudahAntre = () => {
            document.getElementById("judulLagu").value = "";
            document.getElementById("penyanyiLagu").value = "";
            document.getElementById("kataLagu").value = "";
            document.getElementById("namaPengirim").value = "";
        };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
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
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
                Outbox.sesudahAntre(__sesudahAntre);
                return;
            }
            if (err.message === "ERR_LIMIT") {
                showPopup("Hanya bisa masukin 1x/hari, dateng besok lagi yaa. Kalo mau ganti tinggal hapus aja musikmu.", "error");
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
                if (!OsisAuth.butuh("lagu")) return;
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

    // ============ EDIT REQUEST (pakai form utama di atas, bukan popup) ============
    // Tombol edit tampil & hilang mengikuti tombol hapus (milik sendiri <1 jam / OSIS).
    edit(id) {
        const item = (Lagu.cache || []).find(l => String(l.id) === String(id));
        if (!item) {
            showToast("Request tidak ketemu, muat ulang halamannya dulu.", "error");
            return;
        }
        Lagu.editingId = id;
        document.getElementById("judulLagu").value = item.judul || "";
        document.getElementById("penyanyiLagu").value = item.penyanyi || "";
        document.getElementById("kataLagu").value = item.pesan || "";
        document.getElementById("namaPengirim").value = item.nama || "";
        const btn = document.getElementById("btnKirimLagu");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
        const batal = document.getElementById("btnBatalEditLagu");
        if (batal) batal.style.display = "";
        const head = document.getElementById("headFormLagu");
        if (head) head.textContent = "Edit Request Lagu";
        if (head && head.scrollIntoView) head.scrollIntoView({ behavior: "smooth", block: "center" });
        const judul = document.getElementById("judulLagu");
        if (judul) judul.focus();
    },

    batalEdit() {
        Lagu.editingId = null;
        const judul = document.getElementById("judulLagu"); if (judul) judul.value = "";
        const penyanyi = document.getElementById("penyanyiLagu"); if (penyanyi) penyanyi.value = "";
        const kata = document.getElementById("kataLagu"); if (kata) kata.value = "";
        const nama = document.getElementById("namaPengirim"); if (nama) nama.value = "";
        const btn = document.getElementById("btnKirimLagu");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-music"></i> Kirim Request Lagu';
        const batal = document.getElementById("btnBatalEditLagu");
        if (batal) batal.style.display = "none";
        const head = document.getElementById("headFormLagu");
        if (head) head.textContent = "Form Request Lagu";
    },

    async simpanEdit() {
        const id = Lagu.editingId;
        if (!id) return;
        const judul = document.getElementById("judulLagu").value.trim();
        const penyanyi = document.getElementById("penyanyiLagu").value.trim();
        const pesan = document.getElementById("kataLagu").value.trim();
        const nama = document.getElementById("namaPengirim").value.trim() || "Anonim";
        const btn = document.getElementById("btnKirimLagu");
        if (!judul || !penyanyi) {
            showToast("Judul lagu dan penyanyinya diisi dulu yaa!", "error");
            return;
        }
        const isOsis = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
        const __specEdit = () => ({ modul: "lagu", op: "update",
            label: "Ubah lagu: " + judul.slice(0, 42),
            payload: { id, judul, penyanyi, pesan, nama }, files: [], cacheKeys: ["lagu"] });
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__specEdit()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(() => Lagu.batalEdit());
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-music"></i> Kirim Request Lagu';
            return;
        }
        try {
            if (isOsis) {
                if (!OsisAuth.butuh("lagu")) return;
                const u = OsisAuth.getUser();
                await editLaguOsis(u.id, id, judul, penyanyi, pesan, nama);
            } else {
                await editLaguSendiri(id, judul, penyanyi, pesan, nama);
            }
            showToast("Request lagu berhasil diubah", "success");
            Lagu.batalEdit();
            Cache.del("lagu");
            Lagu.muatDaftar();
            const list = document.getElementById("daftarLagu");
            if (list && list.scrollIntoView) list.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __specEdit())) {
                Outbox.sesudahAntre(() => Lagu.batalEdit());
                return;
            }
            if (err.message === "ERR_EXPIRED") {
                showPopup("Request udah lebih dari 1 jam, udah ga bisa diubah.", "error");
                Lagu.batalEdit();
                Cache.del("lagu");
                Lagu.muatDaftar();
            } else if (err.message === "ERR_FORBIDDEN") {
                showPopup("Ini bukan request kamu!", "error");
                Lagu.batalEdit();
                Cache.del("lagu");
                Lagu.muatDaftar();
            } else if (err.message === "ERR_NOT_FOUND") {
                showPopup("Request ini sudah tidak ada.", "error");
                Lagu.batalEdit();
                Cache.del("lagu");
                Lagu.muatDaftar();
            } else if (err.message === "ERR_NO_AUTH") {
                showPopup("Cuma OSIS yang bisa ubah ini.", "error");
            } else if (err.message === "ERR_EMPTY") {
                showToast("Judul lagu dan penyanyinya diisi dulu yaa!", "error");
            } else if (String(err.message || "").match(/schema cache|does not exist|not found/i)) {
                showPopup("Fungsi edit belum dipasang di database. Jalankan dulu SQL terbaru (code.sql) di Supabase.", "error");
            } else {
                showPopup("Gagal menyimpan. Cek koneksi lalu coba lagi.", "error");
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = Lagu.editingId
                ? '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan'
                : '<i class="fa-solid fa-music"></i> Kirim Request Lagu';
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
