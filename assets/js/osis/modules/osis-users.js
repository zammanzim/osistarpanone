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
    angkatanList: [],
    periodeList: [],
    q: "",
    filterAng: "",
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
            const sb = document.getElementById("usersTopSearch");
            if (sb) sb.style.display = "none";
            const panelAng = document.getElementById("angkatanPanel");
            if (panelAng) panelAng.style.display = "none";
            const btn = document.getElementById("btnTambahUser");
            if (btn) btn.style.display = "none";
            const q = document.getElementById("usersQ");
            if (q) q.disabled = true;
            const fa = document.getElementById("usersFilterAng");
            if (fa) fa.disabled = true;
            const cnt = document.getElementById("usersCount");
            if (cnt) cnt.textContent = "Khusus super admin";
            const wrap = document.getElementById("usersWrap");
            if (wrap) {
                wrap.innerHTML =
                    `<div class="pesan-empty"><i class="fa-solid fa-lock"></i> Halaman ini khusus super admin.</div>`;
            }
            return;
        }

        document.getElementById("btnTambahAngkatan")?.addEventListener("click", () => OsisUsers.bukaFormAngkatan(null));
        document.getElementById("angkatanWrap")?.addEventListener("click", (e) => {
            const ed = e.target.closest("[data-ang-edit]");
            if (ed) { OsisUsers.bukaFormAngkatan(ed.dataset.angEdit); return; }
            const del = e.target.closest("[data-ang-del]");
            if (del) OsisUsers.hapusAngkatan(del.dataset.angDel);
        });
        document.getElementById("btnTambahUser")?.addEventListener("click", () => OsisUsers.bukaForm(null));
        document.getElementById("btnResetQ")?.addEventListener("click", () => {
            const el = document.getElementById("usersQ");
            if (el) el.value = "";
            const fa = document.getElementById("usersFilterAng");
            if (fa) fa.value = "";
            OsisUsers.q = "";
            OsisUsers.filterAng = "";
            try { window.Dropdown?.segarkanSemua?.(); } catch {}
            OsisUsers.render();
            try { window.OsisSearch?.sync?.("usersTopSearch"); } catch {}
        });
        document.getElementById("usersQ")?.addEventListener("input", (e) => {
            OsisUsers.q = e.target.value || "";
            OsisUsers.render();
        });
        document.getElementById("usersFilterAng")?.addEventListener("change", (e) => {
            OsisUsers.filterAng = e.target.value || "";
            OsisUsers.render();
        });
        document.getElementById("usersWrap")?.addEventListener("click", (e) => {
            const ed = e.target.closest("[data-edit]");
            if (ed) { OsisUsers.bukaForm(ed.dataset.edit); return; }
            const del = e.target.closest("[data-del]");
            if (del) OsisUsers.hapus(del.dataset.del);
        });

        await Promise.all([OsisUsers.muatAngkatan(), OsisUsers.muat()]);
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
        const fa = String(OsisUsers.filterAng || "");
        const q = String(OsisUsers.q || "").trim().toLowerCase();
        return OsisUsers.rows.filter((r) => {
            if (fa === "-1" && r.angkatan_id) return false;
            if (Number(fa) > 0 && Number(r.angkatan_id) !== Number(fa)) return false;
            if (!q) return true;
            return [r.nama, r.username, r.jabatan, r.angkatan, r.sekbid_nama]
                .some((v) => String(v || "").toLowerCase().includes(q));
        });
    },

    async muatAngkatan(force = false) {
        try {
            const [list, per] = await Promise.all([
                typeof getAngkatanList === "function" ? getAngkatanList(force) : Promise.resolve([]),
                typeof getPeriode === "function" ? getPeriode().catch(() => []) : Promise.resolve([]),
            ]);
            if (Array.isArray(list)) OsisUsers.angkatanList = list;
            if (Array.isArray(per) && per.length) OsisUsers.periodeList = per;
        } catch {}
        OsisUsers.renderAngkatan();
        OsisUsers.renderFilterAngkatan();
        try { OsisMore?.renderAngkatan?.(); } catch {}
    },

    renderFilterAngkatan() {
        const sel = document.getElementById("usersFilterAng");
        if (!sel) return;
        const cur = String(OsisUsers.filterAng || "");
        const list = OsisUsers.angkatanList || [];
        let html = `<option value="">Semua Angkatan</option><option value="-1">Pembina / Lintas Angkatan</option>`;
        list.forEach((a) => {
            html += `<option value="${escapeHtml(a.id)}">${escapeHtml(a.nama)}${a.aktif === false ? " (Arsip)" : ""}</option>`;
        });
        sel.innerHTML = html;
        sel.value = cur;
        try { window.Dropdown?.segarkanSemua?.(); window.OsisSearch?.sync?.("usersTopSearch"); } catch {}
    },

    renderAngkatan() {
        const wrap = document.getElementById("angkatanWrap");
        const cnt = document.getElementById("angCount");
        if (!wrap) return;
        const list = OsisUsers.angkatanList || [];
        if (cnt) cnt.textContent = `${list.length} angkatan`;
        if (!list.length) {
            wrap.innerHTML = `<div class="osis-empty">Belum ada master angkatan.</div>`;
            return;
        }
        wrap.innerHTML = list.map((a) => {
            const badgeAktif = a.aktif !== false
                ? `<span class="osis-badge" style="background:var(--green-bg);color:var(--green)">Aktif</span>`
                : `<span class="osis-badge">Arsip</span>`;
            const tahunLbl = a.tahun ? ` · Periode ${escapeHtml(a.tahun)}` : "";
            return `<div class="aks-row" style="cursor:default">
                <span class="ava" style="background:var(--yellow);color:var(--ink)">${escapeHtml(a.urutan ?? "#")}</span>
                <span style="min-width:0;flex:1">
                    <span class="nm">${escapeHtml(a.nama)} ${badgeAktif}</span>
                    <span class="sub">Kode: ${escapeHtml(a.kode)} · Urutan #${escapeHtml(a.urutan ?? 0)}${tahunLbl}</span>
                </span>
                <span style="display:flex;gap:6px;flex-shrink:0">
                    <button type="button" class="btn btn-white btn-sm" data-ang-edit="${escapeHtml(a.id)}" title="Edit angkatan"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="btn btn-red btn-sm" data-ang-del="${escapeHtml(a.id)}" title="Hapus angkatan"><i class="fa-solid fa-trash-can"></i></button>
                </span>
            </div>`;
        }).join("");
    },

    async bukaFormAngkatan(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis" || !OsisAuth.isSuper()) return;
        const item = id ? (OsisUsers.angkatanList || []).find((a) => String(a.id) === String(id)) : null;
        if (id && !item) return;
        if (!OsisUsers.periodeList.length && typeof getPeriode === "function") {
            try { OsisUsers.periodeList = (await getPeriode()) || []; } catch {}
        }
        const perOpts = [{ value: "", label: "— Tanpa tautan tahun —" }].concat(
            [...(OsisUsers.periodeList || [])]
                .sort((a, b) => Number(b.tahun) - Number(a.tahun))
                .map((p) => ({ value: String(p.tahun), label: `${p.tahun}${p.aktif ? " (Aktif)" : ""}` })),
        );
        const fields = [
            { name: "kode", label: "Kode unik (kapital, angka, _ / -)", type: "text", placeholder: "cth: ADIABI-5", value: item ? (item.kode || "") : "" },
            { name: "nama", label: "Nama angkatan", type: "text", placeholder: "cth: ADIABI JILID 5", value: item ? (item.nama || "") : "" },
            { name: "urutan", label: "Urutan jilid / periode", type: "number", placeholder: "cth: 5", value: item ? String(item.urutan ?? 0) : String((OsisUsers.angkatanList.length || 0) + 1) },
            { name: "tahun", label: "Tautkan tahun periode (opsional)", type: "select", options: perOpts, value: item && item.tahun ? String(item.tahun) : "" },
            {
                name: "aktif", label: "Status", type: "select",
                options: [{ value: "1", label: "Aktif" }, { value: "0", label: "Arsip (Nonaktif)" }],
                value: item && item.aktif === false ? "0" : "1",
            },
        ];
        const res = await showPopup(item ? "Edit master angkatan" : "Tambah master angkatan", "form", {
            title: item ? "Edit Angkatan" : "Tambah Angkatan",
            icon: '<i class="fa-solid fa-layer-group"></i>',
            fields,
        });
        if (!res) return;
        const kode = String(res.kode || "").trim().toUpperCase();
        const nama = String(res.nama || "").trim().slice(0, 80);
        const urutan = parseInt(res.urutan, 10) || 0;
        const tahun = res.tahun ? parseInt(res.tahun, 10) : null;
        const aktif = res.aktif !== "0";
        if (!/^[A-Z0-9_-]{2,40}$/.test(kode)) {
            showToast("Kode 2-40 karakter huruf kapital, angka, _ atau -.", "error");
            return;
        }
        if (!nama) { showToast("Nama angkatan wajib diisi.", "error"); return; }
        try {
            const hasil = await angkatanSimpan(u.id, { id: item ? item.id : null, kode, nama, urutan, tahun, aktif });
            if (hasil !== "OK") throw new Error(OsisUsers.pesanKode(hasil));
            showToast(item ? "Angkatan diperbarui." : "Angkatan ditambahkan.", "success");
            await OsisUsers.muatAngkatan(true);
            await OsisUsers.segarkan(false);
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan angkatan: " + OsisUsers.pesanKode(err.message || err), "error");
        }
    },

    async hapusAngkatan(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis" || !OsisAuth.isSuper()) return;
        const item = (OsisUsers.angkatanList || []).find((a) => String(a.id) === String(id));
        if (!item) return;
        const yakin = await showPopup(`Hapus master angkatan <b>${escapeHtml(item.nama)}</b>?<br><br><small>Hanya bisa dihapus kalau belum ada akun atau data di dalamnya.</small>`, "confirm");
        if (!yakin) return;
        try {
            const hasil = await angkatanHapus(u.id, item.id);
            if (hasil !== "OK") throw new Error(OsisUsers.pesanKode(hasil));
            showToast("Angkatan dihapus.", "success");
            if (Number(OsisUsers.filterAng) === Number(item.id)) OsisUsers.filterAng = "";
            await OsisUsers.muatAngkatan(true);
        } catch (err) {
            console.error(err);
            showToast("Gagal hapus angkatan: " + OsisUsers.pesanKode(err.message || err), "error");
        }
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

        await Promise.all([OsisUsers.muatSekbid(), OsisUsers.muatAngkatan()]);
        const jabatanOpts = OsisUsers.opsiJabatan(item);
        const angOpts = [{ value: "-1", label: "PEMBINA (Lintas Angkatan)" }].concat(
            (OsisUsers.angkatanList || []).map((a) => ({
                value: String(a.id),
                label: escapeHtml(a.nama + (a.aktif === false ? " (Arsip)" : "")),
            })),
        );
        let defAng = "-1";
        if (item) {
            if (item.angkatan_id) defAng = String(item.angkatan_id);
            else if (String(item.angkatan || "").trim().toUpperCase() !== "PEMBINA") {
                const hit = (OsisUsers.angkatanList || []).find((a) =>
                    String(a.nama || "").trim().toUpperCase() === String(item.angkatan || "").trim().toUpperCase());
                if (hit) defAng = String(hit.id);
            }
        } else if (Number(OsisUsers.filterAng) > 0) {
            defAng = String(OsisUsers.filterAng);
        } else {
            const akt = typeof OsisAuth.getAngkatanAktif === "function" ? OsisAuth.getAngkatanAktif() : null;
            if (akt) defAng = String(akt);
        }
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
            angOpts.length > 1
                ? {
                    name: "angkatan_id", label: "Angkatan / periode", type: "select",
                    options: angOpts,
                    value: defAng,
                }
                : {
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
        let angkatan = String(res.angkatan || "").trim().slice(0, 40);
        let angkatan_id = null;
        if ("angkatan_id" in res) {
            const valAng = String(res.angkatan_id || "");
            if (valAng === "-1" || !valAng) {
                angkatan_id = null;
                angkatan = "PEMBINA";
            } else {
                angkatan_id = Number(valAng);
                const hit = (OsisUsers.angkatanList || []).find((a) => Number(a.id) === angkatan_id);
                angkatan = hit ? String(hit.nama || "").slice(0, 40) : angkatan;
            }
        }
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

        const f = { username, nama, jabatan, angkatan, angkatan_id };
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
                    await OsisAuth.refreshAkses();
                    OsisMore?.renderAngkatan?.();
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
            ERR_TAKEN: "Username atau kode sudah dipakai.",
            ERR_NOT_FOUND: "Data tidak ditemukan (mungkin sudah dihapus).",
            ERR_LINKED: "Akun ini sudah tertaut login. Password tidak bisa diubah dari sini.",
            ERR_SELF: "Tidak bisa menghapus akun sendiri.",
            ERR_ANGKATAN: "Angkatan tidak ditemukan.",
            ERR_KODE: "Kode angkatan 2-40 karakter kapital, angka, _ atau -.",
            ERR_TAHUN: "Tahun tidak ditemukan di master periode.",
            ERR_DIPAKAI: "Angkatan masih punya akun atau data sehingga tidak bisa dihapus.",
        };
        return map[k] || k || "Gagal simpan.";
    },
};

document.addEventListener("DOMContentLoaded", () => OsisUsers.init());
