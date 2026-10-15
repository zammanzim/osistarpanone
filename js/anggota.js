// =========================================================================
// ANGGOTA SIMPLE — halaman khusus OSIS (osis/anggota.html)
// CRUD daftar anggota per tahun: nama, jabatan, kelas, username.
// Roster ini dipakai absensi (js/absensi.js baca via getAnggota).
// Tulis via RPC tambah_anggota/update_anggota/hapus_anggota (p_user_id).
// Tab Pengurus & Sekbid dicabut dari halaman ini (v6.5.0) — data lama di DB
// tidak dihapus, UI kelolanya pindah ke halaman sendiri nanti.
// =========================================================================

const Anggota = {
    cache: [],
    tahunList: [],
    tahun: null,
    q: "",

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
        document.getElementById("btnResetQ")?.addEventListener("click", () => {
            const q = document.getElementById("anggotaQ");
            if (q) q.value = "";
            Anggota.q = "";
            Anggota.render();
        });
        document.getElementById("anggotaQ")?.addEventListener("input", (e) => {
            Anggota.q = e.target.value || "";
            Anggota.render();
        });
        document.getElementById("pilihTahun")?.addEventListener("change", (e) => {
            Anggota.tahun = parseInt(e.target.value, 10);
            Anggota.render();
        });
        document.getElementById("anggotaRows")?.addEventListener("click", (e) => {
            const ed = e.target.closest("[data-edit]");
            if (ed) { Anggota.bukaForm(ed.dataset.edit); return; }
            const del = e.target.closest("[data-del]");
            if (del) Anggota.hapus(del.dataset.del);
        });

        Anggota.muat();
    },

    // Sembunyikan tombol tulis kalau tidak punya kendali atas halaman ini
    terapkanAkses() {
        const boleh = OsisAuth.bisa("anggota");
        ["btnTambahAnggota", "btnTambahTahun"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = boleh ? "" : "none";
        });
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
        if (!Anggota.tahunList.length) Anggota.tahunList = [new Date().getFullYear()];
        if (!Anggota.tahun || !Anggota.tahunList.includes(Anggota.tahun)) {
            Anggota.tahun = Anggota.tahunList[0];
        }
        Anggota.render();
    },

    rowsTampil() {
        const q = String(Anggota.q || "").trim().toLowerCase();
        return Anggota.cache
            .filter(a => parseInt(a.tahun, 10) === Anggota.tahun)
            .filter(a => {
                if (!q) return true;
                return [a.nama, a.jabatan, a.kelas, a.username]
                    .some(v => String(v || "").toLowerCase().includes(q));
            })
            .sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")));
    },

    initial(nama) {
        const c = String(nama || "?").trim().charAt(0).toUpperCase();
        return c || "?";
    },

    // List compact: desktop = kolom rapi, HP = baris ramping
    // (avatar + nama + 1 baris meta). Satu markup, CSS yang melipat.
    render() {
        const sel = document.getElementById("pilihTahun");
        if (sel) {
            sel.innerHTML = Anggota.tahunList
                .map(t => `<option value="${t}" ${t === Anggota.tahun ? "selected" : ""}>Periode ${t}</option>`)
                .join("");
        }
        const boleh = OsisAuth.bisa("anggota");
        const head = document.getElementById("anggotaHead");
        if (head) {
            head.className = "angg-head" + (boleh ? "" : " no-aksi");
            head.innerHTML = `<span>No</span><span></span><span>Nama</span><span>Jabatan</span><span>Kelas</span><span>Username</span>${boleh ? `<span style="text-align:right">Aksi</span>` : ""}`;
        }
        const total = Anggota.cache.filter(a => parseInt(a.tahun, 10) === Anggota.tahun).length;
        const cnt = document.getElementById("anggotaCount");
        if (cnt) cnt.textContent = `${total} anggota · Periode ${Anggota.tahun ?? "-"}`;

        const rows = Anggota.rowsTampil();
        const body = document.getElementById("anggotaRows");
        const empty = document.getElementById("anggotaEmpty");
        if (!body) return;
        if (!total) {
            body.innerHTML = "";
            if (empty) empty.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:22px 12px"><b>Belum ada anggota periode ${Anggota.tahun}.</b>${boleh ? `<div style="margin-top:10px"><button class="btn btn-red btn-sm" onclick="Anggota.bukaForm(null)"><i class="fa-solid fa-plus"></i> Tambah Anggota</button></div>` : ""}</div>`;
            return;
        }
        if (!rows.length) {
            body.innerHTML = "";
            if (empty) empty.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan pencarian.</div>`;
            return;
        }
        if (empty) empty.innerHTML = "";
        body.innerHTML = rows.map((a, i) => {
            const meta = [a.jabatan, a.kelas, a.username ? "@" + a.username : ""]
                .filter(s => String(s || "").trim()).map(s => escapeHtml(s)).join(" · ") || "-";
            return `<div class="angg-row${boleh ? "" : " no-aksi"}">
            <span class="num">${i + 1}</span>
            <span class="ava">${escapeHtml(Anggota.initial(a.nama))}</span>
            <div class="main"><b>${escapeHtml(a.nama || "-")}</b><small class="meta">${meta}</small></div>
            <span class="c-jab">${escapeHtml(a.jabatan || "-")}</span>
            <span class="c-kelas">${escapeHtml(a.kelas || "-")}</span>
            <span class="c-user">${a.username ? `<span class="uname">@${escapeHtml(a.username)}</span>` : "-"}</span>
            ${boleh ? `<span class="aksi"><button class="btn btn-white btn-sm" data-edit="${a.id}" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="btn btn-red btn-sm" data-del="${a.id}" title="Hapus"><i class="fa-solid fa-trash-can"></i></button></span>` : ""}
        </div>`;
        }).join("");
    },

    // ============ PERIODE ============
    // Periode baru disiapkan lokal (tahun muncul di dropdown); baris periode
    // aktif buat roster absen dikelola via tabel periode (hak super admin).
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
        Anggota.render();
        showToast(`Periode ${thn} siap — tambah anggota di bawah`, "info");
    },

    // ============ TAMBAH / EDIT (popup form bawaan, 4 field) ============
    async bukaForm(id) {
        if (!OsisAuth.butuh("anggota")) return;
        const item = id ? Anggota.cache.find(a => String(a.id) === String(id)) : null;
        if (id && !item) return;
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

        const spec = () => ({
            modul: "anggota", op: item ? "update" : "create",
            label: "Anggota: " + nama.slice(0, 42),
            payload: item
                ? { id: item.id, tahun: Anggota.tahun, nama, jabatan, kelas, username }
                : { id: null, tahun: Anggota.tahun, nama, jabatan, kelas, username },
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
                await tambahAnggota({ tahun: Anggota.tahun, nama, jabatan, kelas, username });
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
        const yakin = await showPopup(`Hapus ${item ? escapeHtml(item.nama) : "anggota ini"} dari periode ${Anggota.tahun}?`, "confirm");
        if (!yakin) return;
        try {
            await hapusAnggota(id);
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
