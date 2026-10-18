// =========================================================================
// AKUN OSIS (osis_users) — halaman osis/users.html, KHUSUS super_admin.
// CRUD akun pengurus: username login, nama, jabatan, angkatan, password awal.
// Tulis lewat RPC di db/migrasi-crud-osis-users.sql (guard osis_is_super di
// server). RLS osis_users cuma SELECT, jadi JANGAN pernah nulis langsung.
//
// Password = kolom legacy plaintext, cuma buat klaim login pertama
// (migrasi_link_auth). Begitu user login, password pindah ke Supabase Auth
// dan TIDAK bisa diubah dari halaman ini (server balas ERR_LINKED) — pakai
// tools/reset-password.mjs.
// =========================================================================

const OsisUsers = {
    CACHE: "osis_users",
    rows: [],
    sekbidList: [],
    q: "",
    saya: null,

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        OsisUsers.saya = u;
        try { await OsisAuth.refreshAkses(); } catch {}

        if (!OsisAuth.isSuper()) {
            const btn = document.getElementById("btnTambahUser");
            if (btn) btn.style.display = "none";
            const q = document.getElementById("usersQ");
            if (q) q.disabled = true;
            const cnt = document.getElementById("usersCount");
            if (cnt) cnt.textContent = "Khusus super admin";
            const wrap = document.getElementById("usersWrap");
            if (wrap) {
                wrap.innerHTML =
                    `<div class="pesan-empty"><i class="fa-solid fa-lock"></i> Halaman ini khusus super admin.</div>`;
            }
            return;
        }

        document.getElementById("btnTambahUser")?.addEventListener("click", () => OsisUsers.bukaForm(null));
        document.getElementById("btnResetQ")?.addEventListener("click", () => {
            const el = document.getElementById("usersQ");
            if (el) el.value = "";
            OsisUsers.q = "";
            OsisUsers.render();
        });
        document.getElementById("usersQ")?.addEventListener("input", (e) => {
            OsisUsers.q = e.target.value || "";
            OsisUsers.render();
        });
        document.getElementById("usersWrap")?.addEventListener("click", (e) => {
            const ed = e.target.closest("[data-edit]");
            if (ed) { OsisUsers.bukaForm(ed.dataset.edit); return; }
            const del = e.target.closest("[data-del]");
            if (del) OsisUsers.hapus(del.dataset.del);
        });

        await OsisUsers.muat();
    },

    // ============ DATA (cache-first + revalidasi) ============
    async muat() {
        const wrap = document.getElementById("usersWrap");
        const cached = Cache.get(OsisUsers.CACHE);
        if (Array.isArray(cached) && cached.length) {
            OsisUsers.pakai(cached);
            OsisUsers.segarkan(false);
            return;
        }
        if (wrap && !OsisUsers.rows.length) {
            wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat akun...</div>`;
        }
        await OsisUsers.segarkan(true);
    },

    async segarkan(tampilkanError) {
        const u = OsisUsers.saya || OsisAuth.getUser();
        if (!u) return;
        try {
            const rows = await osisUserList(u.id);
            OsisUsers.pakai(rows || []);
            Cache.set(OsisUsers.CACHE, OsisUsers.rows);
        } catch (err) {
            console.error(err);
            if (tampilkanError) {
                const wrap = document.getElementById("usersWrap");
                if (wrap) {
                    wrap.innerHTML =
                        `<div class="pesan-empty">Gagal memuat akun: ${escapeHtml(err.message)}</div>`;
                }
            }
        }
    },

    pakai(list) {
        OsisUsers.rows = (Array.isArray(list) ? list : [])
            .filter((r) => r && r.id)
            .sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")));
        OsisUsers.render();
    },

    rowsTampil() {
        const q = String(OsisUsers.q || "").trim().toLowerCase();
        if (!q) return OsisUsers.rows;
        return OsisUsers.rows.filter((r) =>
            [r.nama, r.username, r.jabatan, r.angkatan, r.sekbid_nama]
                .some((v) => String(v || "").toLowerCase().includes(q)));
    },

    kunciAngkatan(r) {
        return String((r && r.angkatan) || "").trim();
    },

    labelAngkatan(kunci) {
        return kunci || "Tanpa angkatan";
    },

    initial(nama) {
        return (String(nama || "?").trim().charAt(0) || "?").toUpperCase();
    },

    // Status login akun: sudah tertaut Auth / siap klaim / belum ada password.
    badgeStatus(r) {
        if (r.tertaut) {
            return `<span class="osis-badge" style="background:var(--green-bg);color:var(--green)"><i class="fa-solid fa-circle-check"></i> Aktif</span>`;
        }
        if (r.siap_klaim) {
            return `<span class="osis-badge" style="background:var(--yellow)"><i class="fa-solid fa-key"></i> Siap klaim</span>`;
        }
        return `<span class="osis-badge" style="background:#ffe9e9;color:var(--red-dark)"><i class="fa-solid fa-triangle-exclamation"></i> Belum ada password</span>`;
    },

    render() {
        const wrap = document.getElementById("usersWrap");
        const empty = document.getElementById("usersEmpty");
        const cnt = document.getElementById("usersCount");
        if (!wrap) return;

        const total = OsisUsers.rows.length;
        const aktif = OsisUsers.rows.filter((r) => r.tertaut).length;
        if (cnt) cnt.textContent = total ? `${total} akun · ${aktif} aktif login` : "0 akun";

        if (!total) {
            wrap.innerHTML = "";
            if (empty) {
                empty.innerHTML =
                    `<div class="pesan-empty" style="text-align:center;padding:22px 12px"><b>Belum ada akun OSIS.</b><div style="margin-top:10px"><button class="btn btn-red btn-sm" onclick="OsisUsers.bukaForm(null)"><i class="fa-solid fa-plus"></i> Tambah Akun</button></div></div>`;
            }
            return;
        }
        if (empty) empty.innerHTML = "";

        const rows = OsisUsers.rowsTampil();
        if (!rows.length) {
            wrap.innerHTML =
                `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada akun yang cocok.</div>`;
            return;
        }

        const kartu = (r) => {
            const mahkota = r.is_super
                ? ` <span class="osis-badge" style="background:var(--ink);color:var(--yellow)"><i class="fa-solid fa-crown"></i> Super</span>`
                : "";
            const meta = [
                "@" + String(r.username || "-"),
                r.jabatan || "",
                OsisUsers.kunciAngkatan(r) ? OsisUsers.labelAngkatan(OsisUsers.kunciAngkatan(r)) : "",
                r.sekbid_nama ? "Sekbid " + r.sekbid_nama : "",
            ].filter((s) => String(s || "").trim()).map((s) => escapeHtml(s)).join(" · ");
            return `<div class="aks-row${r.is_super ? " aks-super" : ""}" style="cursor:default">
                <span class="ava">${escapeHtml(OsisUsers.initial(r.nama))}</span>
                <span style="min-width:0;flex:1">
                    <span class="nm">${escapeHtml(r.nama || r.username || "-")}${mahkota}</span>
                    <span class="sub">${meta}</span>
                    <span style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">${OsisUsers.badgeStatus(r)}</span>
                </span>
                <span style="display:flex;gap:6px;flex-shrink:0">
                    <button type="button" class="btn btn-white btn-sm" data-edit="${r.id}" title="Edit akun"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="btn btn-red btn-sm" data-del="${r.id}" title="Hapus akun"><i class="fa-solid fa-trash-can"></i></button>
                </span>
            </div>`;
        };

        // Kelompokkan per angkatan (angka terbesar dulu), "Tanpa angkatan" paling bawah.
        const grup = {};
        rows.forEach((r) => {
            const k = OsisUsers.kunciAngkatan(r);
            (grup[k] = grup[k] || []).push(r);
        });
        const angka = (s) => {
            const m = String(s || "").match(/\d+(\.\d+)?/);
            return m ? parseFloat(m[0]) : null;
        };
        const urut = Object.keys(grup).sort((a, b) => {
            if (!a && b) return 1;
            if (!b && a) return -1;
            const na = angka(a), nb = angka(b);
            if (na !== null && nb !== null && na !== nb) return nb - na;
            return a.localeCompare(b);
        });
        wrap.innerHTML = urut.map((k) =>
            (k ? `<div class="aks-angkatan"><i class="fa-solid fa-users"></i> ${escapeHtml(OsisUsers.labelAngkatan(k))}<span class="cnt">${grup[k].length} akun</span></div>` : "") +
            grup[k].map(kartu).join("")).join("");
    },

    // ============ JABATAN (dropdown dari tabel sekbid) ============
    // Lazy + cache: online ambil getSekbid(), offline pakai Cache.get("sekbid").
    async muatSekbid() {
        if (OsisUsers.sekbidList.length) return;
        try {
            const list = await getSekbid();
            if (Array.isArray(list) && list.length) {
                OsisUsers.sekbidList = list;
                Cache.set("sekbid", list);
            }
        } catch {}
        if (!OsisUsers.sekbidList.length) {
            const cached = Cache.get("sekbid");
            if (Array.isArray(cached)) OsisUsers.sekbidList = cached;
        }
    },

    // Opsi dropdown dari sekbid.nama. Nilai lama yang tidak ada di daftar
    // (mis. "Pembina") tetap dimunculkan biar tidak hilang saat edit.
    opsiJabatan(item) {
        if (!OsisUsers.sekbidList.length) return null;
        const opts = OsisUsers.sekbidList
            .filter((s) => s && String(s.nama || "").trim())
            .map((s) => ({
                value: String(s.nama),
                label: (s.kategori ? s.kategori + " · " : "") + s.nama,
            }));
        opts.unshift({ value: "", label: "— Pilih jabatan —" });
        const cur = item ? String(item.jabatan || "").trim() : "";
        if (cur && !opts.some((o) => o.value === cur)) {
            opts.push({ value: cur, label: cur + " (di luar daftar sekbid)" });
        }
        return opts;
    },

    // ============ TAMBAH / EDIT (popup form bawaan) ============
    async bukaForm(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.isSuper()) {
            showToast("Halaman ini khusus super admin.", "error");
            return;
        }
        const item = id ? OsisUsers.rows.find((r) => String(r.id) === String(id)) : null;
        if (id && !item) return;

        await OsisUsers.muatSekbid();
        const jabatanOpts = OsisUsers.opsiJabatan(item);
        const bisaPassword = !item || !item.tertaut;
        const fields = [
            {
                name: "username", label: "Username login", type: "text",
                placeholder: "3-30 karakter: huruf, angka, titik, _ atau -",
                value: item ? (item.username || "") : "",
            },
            {
                name: "nama", label: "Nama lengkap", type: "text",
                placeholder: "cth: Asep Muhammad",
                value: item ? (item.nama || "") : "",
            },
            jabatanOpts
                ? {
                    name: "jabatan", label: "Jabatan / seksi bidang (sekbid otomatis)", type: "select",
                    options: jabatanOpts,
                    value: item ? String(item.jabatan || "").trim() : "",
                }
                : {
                    name: "jabatan", label: "Jabatan (sekbid otomatis dari jabatan)", type: "text",
                    placeholder: "cth: Ketua Sekbid 1 / Bendahara / Pembina",
                    value: item ? (item.jabatan || "") : "",
                },
            {
                name: "angkatan", label: "Angkatan / periode", type: "text",
                placeholder: "cth: ADIABI JILID 4",
                value: item ? (item.angkatan || "") : "",
            },
        ];
        if (bisaPassword) {
            fields.push({
                name: "password", label: item ? "Password awal baru (kosongkan = tidak diubah)" : "Password awal (min. 6, buat login pertama; boleh kosong)", type: "password",
                placeholder: item ? "Kosongkan kalau tidak diubah" : "Minimal 6 karakter",
                value: "",
            });
        }

        const res = await showPopup(item ? "Edit akun OSIS" : "Tambah akun OSIS", "form", {
            title: item ? "Edit Akun" : "Tambah Akun",
            tall: true,
            icon: item ? '<i class="fa-solid fa-pen"></i>' : '<i class="fa-solid fa-user-plus"></i>',
            fields,
        });
        if (!res) return;

        const username = String(res.username || "").trim();
        const nama = String(res.nama || "").trim().slice(0, 80);
        const jabatan = String(res.jabatan || "").trim().slice(0, 80);
        const angkatan = String(res.angkatan || "").trim().slice(0, 40);
        const pwRaw = res.password == null ? "" : String(res.password);
        if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
            showToast("Username 3-30 karakter: huruf, angka, titik, _ atau -.", "error");
            return;
        }
        if (!nama) { showToast("Nama wajib diisi.", "error"); return; }
        if (jabatanOpts && !jabatan) { showToast("Pilih jabatan dulu.", "error"); return; }
        if (bisaPassword && pwRaw && pwRaw.length < 6) {
            showToast("Password minimal 6 karakter (atau kosongkan).", "error");
            return;
        }
        if (bisaPassword && pwRaw.length > 100) {
            showToast("Password maksimal 100 karakter.", "error");
            return;
        }
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            showToast("Butuh koneksi buat kelola akun.", "error");
            return;
        }

        const f = { username, nama, jabatan, angkatan };
        try {
            let hasil;
            if (item) {
                // null = jangan ubah password (akun tertaut / kolom dikosongkan).
                const pw = !bisaPassword || !pwRaw ? null : pwRaw;
                hasil = await updateOsisUser(u.id, item.id, f, pw);
            } else {
                hasil = await tambahOsisUser(u.id, { ...f, password: pwRaw });
            }
            if (!(hasil === "OK" || /^\d+$/.test(String(hasil)))) {
                throw new Error(OsisUsers.pesanKode(hasil));
            }
            try { catatAksi(item ? "ubah_akun" : "tambah_akun", username); } catch {}
            showToast(item ? "Akun diperbarui." : "Akun dibuat. Kasih tahu username + password ke ybs.", "success");
            // Edit akun sendiri: segarkan cache profil di header.
            if (item && String(item.id) === String(u.id)) {
                try {
                    const fresh = await getOsisUserById(u.id);
                    if (fresh) OsisAuth.loginOsis(fresh);
                } catch {}
            }
            await OsisUsers.segarkan(false);
            Cache.set(OsisUsers.CACHE, OsisUsers.rows);
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + OsisUsers.pesanKode(err.message || err), "error");
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis" || !OsisAuth.isSuper()) return;
        const item = OsisUsers.rows.find((r) => String(r.id) === String(id));
        if (!item) return;
        if (String(item.id) === String(u.id)) {
            showToast("Tidak bisa menghapus akun sendiri.", "error");
            return;
        }
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            showToast("Butuh koneksi buat hapus akun.", "error");
            return;
        }
        const yakin = await showPopup(
            `Hapus akun <b>@${escapeHtml(item.username || "-")}</b> (${escapeHtml(item.nama || "-")})?<br><br><small>Hak akses halaman + status super ikut terhapus. Akun login (Auth) dibiarkan — orang itu otomatis ke-logout saat buka web.</small>`,
            "confirm",
        );
        if (!yakin) return;
        try {
            const hasil = await hapusOsisUser(u.id, item.id);
            if (hasil !== "OK") throw new Error(OsisUsers.pesanKode(hasil));
            try { catatAksi("hapus_akun", item.username || String(item.id)); } catch {}
            OsisUsers.rows = OsisUsers.rows.filter((r) => String(r.id) !== String(item.id));
            Cache.set(OsisUsers.CACHE, OsisUsers.rows);
            OsisUsers.render();
            showToast("Akun dihapus.", "success");
        } catch (err) {
            console.error(err);
            showToast("Gagal hapus: " + OsisUsers.pesanKode(err.message || err), "error");
        }
    },

    // Kode balasan RPC -> pesan yang enak dibaca.
    pesanKode(kode) {
        const k = String(kode || "");
        const map = {
            ERR_NO_AUTH: "Kamu bukan super admin.",
            ERR_INVALID: "Username 3-30 karakter: huruf, angka, titik, _ atau -.",
            ERR_NO_NAMA: "Nama wajib diisi.",
            ERR_PASSWORD: "Password minimal 6 karakter (atau kosongkan).",
            ERR_TAKEN: "Username sudah dipakai akun lain.",
            ERR_NOT_FOUND: "Akun tidak ditemukan (mungkin sudah dihapus).",
            ERR_LINKED: "Akun ini sudah tertaut login. Password tidak bisa diubah dari sini.",
            ERR_SELF: "Tidak bisa menghapus akun sendiri.",
        };
        return map[k] || k || "Gagal simpan.";
    },
};

document.addEventListener("DOMContentLoaded", () => OsisUsers.init());
