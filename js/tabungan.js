// =========================================================================
// TABUNGAN PENGURUS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/tabungan.html — catat setoran per orang, tampil satu
// tabel per orang: No | Tanggal | Nominal | Total Semua (running total
// per orang, dihitung di client) | Ceklis (toggle verifikasi per baris).
// Tulis via RPC buat_tabungan/update_tabungan/toggle_tabungan_cek/
// hapus_tabungan (cek osis_users).
// =========================================================================

const Tabungan = {
    cache: [],
    filter: { q: "" },
    editingId: null,
    detailId: null,
    jenisForm: "masuk",
    // Roster nama dari data anggota (periode aktif), buat pilih penabung.
    anggota: [],
    periodeTahun: [],
    namaQ: "",
    // Nama-nama milik user login (akun + anggota + pengurus) — boleh ceklis sendiri.
    namaSaya: [],

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        // Segarkan hak kendali (biar perubahan akses langsung berlaku)
        try { await OsisAuth.refreshAkses(); } catch {}
        Tabungan.terapkanAkses();

        document.getElementById("btnTambahTabungan")?.addEventListener("click", () => Tabungan.bukaForm());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Tabungan.resetFilter());
        document.getElementById("filterQ")?.addEventListener("input", () => Tabungan.bacaFilter());
        document.getElementById("btnBatalTabungan")?.addEventListener("click", () => Tabungan.tutupForm());
        document.getElementById("btnSimpanTabungan")?.addEventListener("click", () => Tabungan.simpan());
        // Pilih nama dari data anggota (ketuk, bukan ketik bebas)
        document.getElementById("tabNamaSearch")?.addEventListener("input", () => {
            Tabungan.namaQ = document.getElementById("tabNamaSearch").value || "";
            Tabungan.renderNamaList();
        });
        document.getElementById("tabNamaListBox")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-pilih-nama]");
            if (b) Tabungan.pilihNama(decodeURIComponent(b.dataset.pilihNama || ""));
        });
        // Nominal: ketik angka -> tampil titik ribuan otomatis
        if (typeof ikatRupiah === "function") ikatRupiah("tabNominal");
        document.getElementById("btnEditDariDetail")?.addEventListener("click", () => {
            const id = Tabungan.detailId;
            Tabungan.tutupDetail();
            if (id) Tabungan.editRow(id);
        });
        document.getElementById("btnHapusDariDetail")?.addEventListener("click", () => {
            const id = Tabungan.detailId;
            if (id) Tabungan.hapusRow(id, true);
        });
        document.getElementById("tabunganWrap")?.addEventListener("click", (e) => {
            const tg = e.target.closest("[data-tab-toggle]");
            if (tg) { Tabungan.toggleCek(tg.dataset.tabToggle); return; }
            const ed = e.target.closest("[data-tab-edit]");
            if (ed) { Tabungan.editRow(ed.dataset.tabEdit); return; }
            const hb = e.target.closest("[data-tab-del]");
            if (hb) { Tabungan.hapusRow(hb.dataset.tabDel); return; }
            const mr = e.target.closest("[data-tab-more]");
            if (mr) { e.stopPropagation(); Tabungan.toggleMenu(mr); return; }
            const tb = e.target.closest("[data-tab-tambah]");
            if (tb) { Tabungan.bukaForm(decodeURIComponent(tb.dataset.tabTambah || "")); return; }
            const pf = e.target.closest("[data-tab-pdf]");
            if (pf) { e.stopPropagation(); Tabungan.tutupSemuaMenu(); Tabungan.exportSatu(decodeURIComponent(pf.dataset.tabPdf || "")); return; }
            // Klik di dalam menu tapi bukan tombol: jangan tembus ke detail baris
            if (e.target.closest(".tb-menu")) { e.stopPropagation(); return; }
            const row = e.target.closest("[data-tab-row]");
            if (row) { Tabungan.detail(row.dataset.tabRow); return; }
        });
        // Klik di luar menu: tutup semua menu titik-tiga yang terbuka
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".tb-menu-wrap")) Tabungan.tutupSemuaMenu();
        });
        ["tabForm", "tabDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "tabForm") Tabungan.tutupForm();
                    else Tabungan.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            Tabungan.tutupSemuaMenu();
            if (document.getElementById("tabForm")?.classList.contains("open")) Tabungan.tutupForm();
            if (document.getElementById("tabDetail")?.classList.contains("open")) Tabungan.tutupDetail();
        });
        // Draft otomatis: ketikan belum disubmit tetap ada walau popup ditutup / refresh
        if (typeof FormPersist !== "undefined") {
            FormPersist.watch("tabForm", {
                fields: ["tabNama", "tabTanggal", "tabNominal"],
                isEditing: () => !!Tabungan.editingId,
                collect: () => ({ jenis: Tabungan.jenisForm })
            });
        }
        // Nama milik sendiri (buat ceklis tanpa akses kelola) — fail silent
        Tabungan.muatNamaSaya();
        Tabungan.muat();
    },

    // Nama-nama milik user login: nama akun + nama anggota/pengurus yang
    // tertaut username-nya. Cocok salah satu = baris milik sendiri.
    async muatNamaSaya() {
        const set = new Set();
        const tambah = (n) => { n = String(n || "").trim().toLowerCase(); if (n) set.add(n); };
        try {
            const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
            if (u) tambah(u.nama);
        } catch {}
        try {
            const [a, p] = await Promise.all([
                (typeof getAnggotaSaya === "function" ? getAnggotaSaya() : Promise.resolve(null)).catch(() => null),
                (typeof getPengurusSaya === "function" ? getPengurusSaya() : Promise.resolve(null)).catch(() => null)
            ]);
            if (a) tambah(a.nama);
            if (p) tambah(p.nama);
        } catch {}
        Tabungan.namaSaya = [...set];
        try { Tabungan.render(); } catch {}
    },

    // Baris ini milik user login?
    milikSaya(r) {
        if (!r) return false;
        const k = String(r.nama || "").trim().toLowerCase();
        return !!k && (Tabungan.namaSaya || []).includes(k);
    },

    setJenis(j) {
        Tabungan.jenisForm = (j === "keluar") ? "keluar" : "masuk";
        const m = document.getElementById("jenisMasuk");
        const k = document.getElementById("jenisKeluar");
        if (m) m.className = Tabungan.jenisForm === "masuk" ? "on-masuk" : "";
        if (k) k.className = Tabungan.jenisForm === "keluar" ? "on-keluar" : "";
        if (typeof FormPersist !== "undefined") FormPersist.touch("tabForm");
    },

    // Nilai bertanda: setoran +, penarikan -.
    nilai(r) {
        const n = parseInt(r.nominal, 10) || 0;
        return (r.jenis === "keluar") ? -n : n;
    },

    isKeluar(r) {
        return r.jenis === "keluar";
    },

    rp(n) {
        return "Rp" + (parseInt(n, 10) || 0).toLocaleString("id-ID");
    },

    fmtTanggalPendek(t) {
        if (!t) return "-";
        const d = new Date(t + "T00:00:00");
        if (isNaN(d)) return t;
        const p = (x) => String(x).padStart(2, "0");
        return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
    },

    fmtTanggalWaktu(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch { return "-"; }
    },

    hariIni() {
        return new Date().toISOString().slice(0, 10);
    },

    // ============ DATA ============
    async muat() {
        try {
            const cached = Cache.get("tabungan");
            if (cached) {
                Tabungan.cache = cached;
                Tabungan.render();
                getTabungan().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("tabungan", fresh);
                        Tabungan.cache = fresh || [];
                        Tabungan.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getTabungan();
            Cache.set("tabungan", data);
            Tabungan.cache = data || [];
            Tabungan.render();
        } catch (err) {
            console.error(err);
            document.getElementById("tabunganWrap").innerHTML = `<div class="pesan-empty">Gagal memuat tabungan.</div>`;
        }
    },

    async segarkan() {
        // Render cache dulu biar offline langsung tampil.
        const cached = Cache.get("tabungan");
        if (cached) {
            Tabungan.cache = cached || [];
            try { Tabungan.render(); } catch {}
        }
        try {
            const data = await getTabungan();
            if (JSON.stringify(data) !== JSON.stringify(cached)) {
                Cache.set("tabungan", data);
                Tabungan.cache = data || [];
                Tabungan.render();
            }
        } catch (err) {
            console.error(err);
            if (!cached) showToast("Gagal memuat ulang: " + err.message, "error");
            try { Tabungan.render(); } catch {}
        }
    },

    dataTampil() {
        const q = Tabungan.filter.q.trim().toLowerCase();
        return (Tabungan.cache || []).filter(r => {
            if (q && !String(r.nama || "").toLowerCase().includes(q)) return false;
            return true;
        });
    },

    // Kelompokkan per orang (key = lower(nama)), urut nama A-Z.
    // Baris per orang urut tanggal naik lalu id naik (buat running total).
    grupPerOrang(data) {
        const grup = {};
        (data || []).forEach(r => {
            const kunci = String(r.nama || "").trim().toLowerCase();
            if (!kunci) return;
            if (!grup[kunci]) grup[kunci] = { nama: String(r.nama).trim(), rows: [] };
            grup[kunci].rows.push(r);
        });
        return Object.values(grup)
            .map(g => {
                g.rows.sort((a, b) =>
                    String(a.tanggal || "").localeCompare(String(b.tanggal || "")) ||
                    (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
                let jalan = 0;
                g.rows = g.rows.map(r => {
                    jalan += Tabungan.nilai(r);
                    return { ...r, _total: jalan };
                });
                g.total = jalan;
                return g;
            })
            .sort((a, b) => a.nama.localeCompare(b.nama));
    },

    // ============ RENDER ============
    render() {
        const data = Tabungan.dataTampil();
        const setStat = (id, count, suffix) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = String(count) + `<span class="stat-suffix"> ${suffix}</span>`;
        };
        const orang = new Set((Tabungan.cache || []).map(r => String(r.nama || "").trim().toLowerCase()).filter(Boolean)).size;
        const totalSemua = (Tabungan.cache || []).reduce((a, r) => a + Tabungan.nilai(r), 0);
        const sudah = (Tabungan.cache || []).filter(r => !!r.cek).length;
        const belum = (Tabungan.cache || []).length - sudah;
        // Total minggu berjalan (Senin-Minggu) + bulan berjalan dari tanggal setoran.
        const now = new Date();
        const mundur = (now.getDay() + 6) % 7; // Senin=0 ... Minggu=6
        const senin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mundur);
        const minggu = new Date(senin.getFullYear(), senin.getMonth(), senin.getDate() + 6);
        const p2 = (x) => String(x).padStart(2, "0");
        const keStr = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
        const strSenin = keStr(senin);
        const strMinggu = keStr(minggu);
        const blnIni = keStr(now).slice(0, 7);
        const rows = Tabungan.cache || [];
        const strHariIni = keStr(now);
        const totalHarian = rows.reduce((a, r) => {
            return a + (String(r.tanggal || "") === strHariIni ? Tabungan.nilai(r) : 0);
        }, 0);
        const totalMinggu = rows.reduce((a, r) => {
            const t = String(r.tanggal || "");
            return a + ((t >= strSenin && t <= strMinggu) ? Tabungan.nilai(r) : 0);
        }, 0);
        const totalBulan = rows.reduce((a, r) => {
            return a + (String(r.tanggal || "").slice(0, 7) === blnIni ? Tabungan.nilai(r) : 0);
        }, 0);
        setStat("statOrang", orang, "orang");
        const elTotal = document.getElementById("statTotal");
        if (elTotal) elTotal.textContent = Tabungan.rp(totalSemua);
        const elHarian = document.getElementById("statHarian");
        if (elHarian) elHarian.textContent = Tabungan.rp(totalHarian);
        const elMinggu = document.getElementById("statMinggu");
        if (elMinggu) elMinggu.textContent = Tabungan.rp(totalMinggu);
        const elBulan = document.getElementById("statBulan");
        if (elBulan) elBulan.textContent = Tabungan.rp(totalBulan);
        setStat("statSudah", sudah, "setoran");
        setStat("statBelum", belum, "setoran");

        const wrap = document.getElementById("tabunganWrap");
        if (!wrap) return;
        const boleh = OsisAuth.bisa("tabungan");
        if (!(Tabungan.cache || []).length) {
            wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-piggy-bank" style="color:var(--red)"></i></div><b>Belum ada data tabungan</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Catat setoran tabungan per pengurus.</p>${boleh ? `<button class="btn btn-red btn-sm" onclick="Tabungan.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Data</button>` : ""}</div>`;
            return;
        }
        const grups = Tabungan.grupPerOrang(data);
        // Milik sendiri selalu paling atas, sisanya tetap A-Z
        grups.sort((a, b) => (Tabungan.milikSaya({ nama: b.nama }) ? 1 : 0) - (Tabungan.milikSaya({ nama: a.nama }) ? 1 : 0));
        if (!grups.length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Tabungan.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            return;
        }
        wrap.innerHTML = grups.map(g => {
            const sudahSemua = g.rows.length > 0 && g.rows.every(r => !!r.cek);
            // Label hijau "Milik sendiri" tampil di kanan bawah (footer card)
            const milik = Tabungan.milikSaya({ nama: g.nama });
            const namaEnc = encodeURIComponent(g.nama);
            return `<div class="rekap-card" style="margin-bottom:12px">
                <div class="tb-head">
                    <h3><i class="fa-solid fa-piggy-bank"></i> <span class="tb-title">Tabungan — ${escapeHtml(g.nama)}</span> <span class="jenis total">${Tabungan.rp(g.total)}${sudahSemua ? " ✓" : ""}</span></h3>
                    <div class="tb-menu-wrap">
                        <button type="button" class="tb-more-btn" data-tab-more="${namaEnc}" title="Menu lainnya"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                        <div class="tb-menu" hidden>
                            <button type="button" data-tab-pdf="${namaEnc}"><i class="fa-solid fa-file-pdf"></i> Export PDF</button>
                        </div>
                    </div>
                </div>
                <div class="kas-scroll"><table class="kas-tabel"><thead><tr><th>No</th><th>Ceklis</th><th>Tanggal</th><th>Nominal</th><th>Total Semua</th>${boleh ? `<th style="text-align:right">Aksi</th>` : ""}</tr></thead><tbody>
                ${g.rows.map((r, i) => {
                    // Kelola (akses tabungan) boleh ceklis siapa saja; lainnya cuma milik sendiri
                    const bisaCek = boleh || Tabungan.milikSaya(r);
                    return `<tr data-tab-row="${r.id}">
                    <td>${i + 1}</td>
                    <td>${bisaCek
                        ? `<button type="button" class="cek-btn ${r.cek ? "on" : ""}" data-tab-toggle="${r.id}" title="${r.cek ? "Sudah diceklis — klik untuk batalkan" : "Belum diceklis — klik untuk tandai"}"><i class="fa-solid ${r.cek ? "fa-check" : "fa-minus"}"></i></button>`
                        : `<span class="cek-btn ${r.cek ? "on" : ""}" style="cursor:default"><i class="fa-solid ${r.cek ? "fa-check" : "fa-minus"}"></i></span>`}</td>
                    <td>${escapeHtml(Tabungan.fmtTanggalPendek(r.tanggal))}${olehLabel(r) ? `<br>${olehLabel(r)}` : ""}</td>
                    <td><span class="jenis ${Tabungan.isKeluar(r) ? "keluar" : "masuk"}">${Tabungan.isKeluar(r) ? "−" : "+"} ${Tabungan.rp(r.nominal)}</span></td>
                    <td class="num">${Tabungan.rp(r._total)}</td>
                    ${boleh ? `<td><div class="row-act">
                        <button type="button" class="icon-btn" data-tab-edit="${r.id}" title="Edit" style="width:30px; height:30px; font-size:0.75rem; border-width:2px"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="icon-btn" data-tab-del="${r.id}" title="Hapus" style="width:30px; height:30px; font-size:0.75rem; background:var(--red); color:#fff; border-width:2px"><i class="fa-solid fa-trash-can"></i></button>
                    </div></td>` : ""}
                </tr>`;}).join("")}
                </tbody></table></div>
                ${(boleh || milik) ? `<div class="tb-foot">
                    ${boleh ? `<button class="btn btn-white btn-sm" data-tab-tambah="${namaEnc}"><i class="fa-solid fa-plus"></i> Tambah Setoran</button>` : `<span></span>`}
                    ${milik ? `<span class="jenis milik"><i class="fa-solid fa-user-check"></i> Milik sendiri</span>` : ""}
                </div>` : ""}
            </div>`;
        }).join("");
    },

    toggleMenu(btn) {
        try {
            const wrap = btn.closest(".tb-menu-wrap");
            const menu = wrap?.querySelector(".tb-menu");
            if (!menu) return;
            const sedangBuka = !menu.hidden;
            Tabungan.tutupSemuaMenu();
            if (!sedangBuka) menu.hidden = false;
        } catch {}
    },

    tutupSemuaMenu() {
        try {
            document.querySelectorAll("#tabunganWrap .tb-menu").forEach(m => { m.hidden = true; });
        } catch {}
    },

    bacaFilter() {
        Tabungan.filter = { q: document.getElementById("filterQ").value || "" };
        Tabungan.render();
    },

    resetFilter() {
        const el = document.getElementById("filterQ");
        if (el) el.value = "";
        Tabungan.bacaFilter();
    },

    // ============ NAMA DARI DATA ANGGOTA (ketuk, bukan ketik bebas) ============
    // Roster = anggota periode AKTIF (tabel periode), fallback periode terbaru.
    norm(s) {
        return String(s || "").trim().toLowerCase();
    },

    // Cari per token: tiap kata kunci harus terkandung di nama.
    cocokQuery(nama, q) {
        const toks = Tabungan.norm(q).split(/\s+/).filter(Boolean);
        if (!toks.length) return true;
        const t = Tabungan.norm(nama);
        return toks.every(k => t.includes(k));
    },

    async muatPeriode() {
        try {
            if (typeof getPeriode !== "function") return;
            const cached = (typeof Cache !== "undefined") ? Cache.get("periode") : null;
            if (cached && cached.length) {
                Tabungan.pakaiPeriode(cached);
                getPeriode().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("periode", fresh);
                        Tabungan.pakaiPeriode(fresh);
                        if (Tabungan.anggota._cacheList) Tabungan.pakaiAnggota(Tabungan.anggota._cacheList);
                        Tabungan.renderNamaList();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getPeriode();
            if (typeof Cache !== "undefined") Cache.set("periode", fresh);
            Tabungan.pakaiPeriode(fresh);
        } catch (err) { console.error(err); }
    },

    pakaiPeriode(list) {
        Tabungan.periodeTahun = (list || [])
            .filter(p => p && p.aktif)
            .map(p => parseInt(p.tahun, 10))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
    },

    async muatAnggota() {
        try {
            await Tabungan.muatPeriode();
            const cached = (typeof Cache !== "undefined") ? Cache.get("anggota") : null;
            if (cached && cached.length) {
                Tabungan.pakaiAnggota(cached);
                getAnggota().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("anggota", fresh);
                        Tabungan.pakaiAnggota(fresh);
                        Tabungan.renderNamaList();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getAnggota();
            if (typeof Cache !== "undefined") Cache.set("anggota", fresh);
            Tabungan.pakaiAnggota(fresh);
        } catch (err) {
            console.error(err);
            showToast("Gagal memuat anggota: " + err.message, "error");
        }
    },

    // Nama unik per tahun, urut tahun lalu A-Z
    pakaiAnggota(list) {
        const bersih = (list || []).filter(a => a && String(a.nama || "").trim());
        const aktif = (Tabungan.periodeTahun || []).filter(Number.isFinite);
        let pakai;
        if (aktif.length) {
            pakai = bersih.filter(a => aktif.includes(parseInt(a.tahun, 10)));
        } else {
            const thns = [...new Set(bersih.map(a => parseInt(a.tahun, 10)).filter(Number.isFinite))].sort((a, b) => b - a);
            const th = thns.length ? thns[0] : null;
            pakai = th !== null ? bersih.filter(a => parseInt(a.tahun, 10) === th) : bersih;
        }
        const temu = new Set();
        const jadi = [];
        pakai.forEach(a => {
            const nama = String(a.nama).trim();
            const t = parseInt(a.tahun, 10);
            const kunci = (Number.isFinite(t) ? t : "?") + "|" + nama.toLowerCase();
            if (!nama || temu.has(kunci)) return;
            temu.add(kunci);
            jadi.push({ nama, tahun: Number.isFinite(t) ? t : null });
        });
        jadi.sort((x, y) => (x.tahun ?? 9999) - (y.tahun ?? 9999) || x.nama.localeCompare(y.nama));
        Tabungan.anggota = jadi;
        Tabungan.anggota._cacheList = list;
    },

    pilihNama(nama) {
        nama = String(nama || "").trim();
        if (!nama) return;
        document.getElementById("tabNama").value = nama;
        Tabungan.renderNamaList();
        if (typeof FormPersist !== "undefined") FormPersist.touch("tabForm");
    },

    renderNamaList() {
        const box = document.getElementById("tabNamaListBox");
        if (!box) return;
        if (!document.getElementById("tabForm")?.classList.contains("open")) return;
        const dipilih = (document.getElementById("tabNama")?.value || "").trim();
        const q = Tabungan.namaQ || "";
        const saring = Tabungan.anggota.filter(o => Tabungan.cocokQuery(o.nama, q));
        // Banner pilihan
        const dp = document.getElementById("tabNamaDipilih");
        if (dp) {
            if (dipilih) {
                const ketemu = Tabungan.anggota.find(o => Tabungan.norm(o.nama) === Tabungan.norm(dipilih));
                dp.className = "tb-dipilih";
                dp.innerHTML = `<span class="dot"><i class="fa-solid fa-check"></i></span> ${escapeHtml(dipilih)}<small>${ketemu && ketemu.tahun != null ? ketemu.tahun : "riwayat"}</small>`;
            } else {
                dp.className = "tb-dipilih kosong";
                dp.innerHTML = `<span class="dot">○</span> Belum dipilih — ketuk nama di bawah`;
            }
        }
        if (!saring.length) {
            box.innerHTML = `<div class="pesan-empty">${Tabungan.anggota.length ? "Tidak ada nama yang cocok." : "Memuat anggota..."}</div>`;
            return;
        }
        // Kelompok per tahun
        const m = new Map();
        saring.forEach(o => {
            const t = o.tahun != null ? o.tahun : "?";
            if (!m.has(t)) m.set(t, []);
            m.get(t).push(o.nama);
        });
        box.innerHTML = [...m.entries()]
            .sort((a, b) => (a[0] === "?" ? 9999 : a[0]) - (b[0] === "?" ? 9999 : b[0]))
            .map(([t, names]) =>
                `<div class="tb-tahun"><i class="fa-solid fa-calendar"></i> ${t === "?" ? "Tanpa tahun" : t}<span class="cnt">${names.length}</span></div>` +
                names.map(n => `<button type="button" class="tb-item${Tabungan.norm(n) === Tabungan.norm(dipilih) ? " pilih" : ""}" data-pilih-nama="${encodeURIComponent(n)}"><span class="dot">${Tabungan.norm(n) === Tabungan.norm(dipilih) ? '<i class="fa-solid fa-check"></i>' : "○"}</span> ${escapeHtml(n)}</button>`).join("")
            ).join("");
    },

    // Sembunyikan tombol aksi kalau tidak punya kendali atas halaman ini
    terapkanAkses() {
        const boleh = OsisAuth.bisa("tabungan");
        ["btnTambahTabungan", "btnEditDariDetail", "btnHapusDariDetail"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = boleh ? "" : "none";
        });
    },

    // ============ FORM ============
    bukaForm(prefillNama) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        Tabungan.editingId = null;
        document.getElementById("tabId").value = "";
        document.getElementById("tabFormTitle").textContent = "Tambah Setoran";
        Tabungan.setJenis("masuk");
        document.getElementById("tabNama").value = prefillNama || "";
        // Via "Tambah Setoran" per orang: nama sudah pasti — kunci, langsung
        // tampil tanpa picker. Dibuka manual: picker seperti biasa.
        const terkunci = !!prefillNama;
        document.getElementById("tabNamaSearchWrap").style.display = terkunci ? "none" : "";
        document.getElementById("tabNamaListBox").style.display = terkunci ? "none" : "";
        Tabungan.namaQ = "";
        document.getElementById("tabNamaSearch").value = "";
        document.getElementById("tabTanggal").value = Tabungan.hariIni();
        document.getElementById("tabNominal").value = "";
        Tabungan.renderNamaList();
        // Pulihkan draft kalau ada (tutup form / refresh tidak sengaja).
        // Di-skip kalau dibuka via "Tambah Setoran" per orang (nama eksplisit).
        if (!prefillNama) {
            try {
                const d = (typeof FormPersist !== "undefined") ? FormPersist.load("tabForm") : null;
                const adaIsi = d && (String(d.tabNama || "").trim() || String(d.tabNominal || "").trim());
                if (adaIsi) {
                    if (d.jenis) Tabungan.setJenis(d.jenis);
                    if (typeof d.tabNama === "string") document.getElementById("tabNama").value = d.tabNama;
                    if (typeof d.tabTanggal === "string" && d.tabTanggal) document.getElementById("tabTanggal").value = d.tabTanggal;
                    if (d.tabNominal !== undefined && d.tabNominal !== null) {
                        document.getElementById("tabNominal").value = d.tabNominal;
                        if (typeof formatRupiah === "function") formatRupiah(document.getElementById("tabNominal"));
                    }
                    showToast("Draft dipulihkan.", "info");
                }
            } catch {}
        }
        document.getElementById("tabForm").classList.add("open");
        document.body.style.overflow = "hidden";
        Tabungan.renderNamaList();
        // Roster anggota buat daftar ketuk (cache dulu, segarkan background)
        Tabungan.muatAnggota().then(() => Tabungan.renderNamaList()).catch(() => {});
        setTimeout(() => document.getElementById(prefillNama ? "tabNominal" : "tabNamaSearch")?.focus(), 80);
    },

    editRow(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        const item = (Tabungan.cache || []).find(r => String(r.id) === String(id));
        if (!item) return;
        Tabungan.editingId = id;
        document.getElementById("tabId").value = id;
        document.getElementById("tabFormTitle").textContent = "Edit Setoran";
        Tabungan.setJenis(item.jenis);
        document.getElementById("tabNama").value = item.nama || "";
        // Mode edit: picker tetap tampil (boleh ganti nama)
        document.getElementById("tabNamaSearchWrap").style.display = "";
        document.getElementById("tabNamaListBox").style.display = "";
        Tabungan.namaQ = "";
        document.getElementById("tabNamaSearch").value = "";
        document.getElementById("tabTanggal").value = item.tanggal || "";
        document.getElementById("tabNominal").value = item.nominal ?? "";
        if (typeof formatRupiah === "function") formatRupiah(document.getElementById("tabNominal"));
        document.getElementById("tabForm").classList.add("open");
        document.body.style.overflow = "hidden";
        Tabungan.renderNamaList();
        Tabungan.muatAnggota().then(() => Tabungan.renderNamaList()).catch(() => {});
    },

    tutupForm() {
        document.getElementById("tabForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Tabungan.editingId = null;
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        const nama = (document.getElementById("tabNama").value || "").trim();
        const tanggal = document.getElementById("tabTanggal").value || "";
        // Angka murni tanpa titik (tampilan "10.000" -> 10000 ke DB)
        const nominal = (typeof parseRupiah === "function")
            ? parseRupiah(document.getElementById("tabNominal").value)
            : (parseInt(document.getElementById("tabNominal").value, 10) || 0);
        const jenis = Tabungan.jenisForm;
        if (!nama) { showToast("Pilih nama penabung dari daftar.", "error"); return; }
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        if (!nominal || nominal <= 0) { showToast("Nominal harus lebih dari 0.", "error"); return; }
        const id = Tabungan.editingId || (document.getElementById("tabId").value ? parseInt(document.getElementById("tabId").value, 10) : null);
        const __spec = () => ({ modul: "tabungan", op: id ? "update" : "create",
            label: (jenis === "keluar" ? "Penarikan " : "Setoran ") + nama,
            payload: { id: id || null, nama, tanggal, nominal, jenis },
            files: [], cacheKeys: ["tabungan"] });
        const __sesudahAntre = () => {
            if (typeof FormPersist !== "undefined") FormPersist.clear("tabForm");
            Tabungan.tutupForm();
        };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
            return;
        }
        const btn = document.getElementById("btnSimpanTabungan");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            if (id) {
                await updateTabungan(u.id, id, { nama, tanggal, nominal, jenis });
                showToast("Setoran diperbarui!", "success");
                catatAksi("simpan_tabungan", "edit " + nama + " " + Tabungan.rp(nominal));
            } else {
                await buatTabungan(u.id, { nama, tanggal, nominal, jenis });
                showToast(jenis === "keluar" ? "Penarikan tersimpan!" : "Setoran tersimpan!", "success");
                catatAksi("simpan_tabungan", nama + " " + Tabungan.rp(nominal));
            }
            if (typeof FormPersist !== "undefined") FormPersist.clear("tabForm");
            Tabungan.tutupForm();
            Tabungan.segarkan();
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
                Outbox.sesudahAntre(__sesudahAntre);
                return;
            }
            showToast("Gagal simpan: " + Tabungan.pesanDb(err.message), "error");
            Tabungan.segarkan();
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async toggleCek(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const key = String(id);
        const item = (Tabungan.cache || []).find(r => String(r.id) === key);
        if (!item) return;
        // Kelola (akses tabungan) boleh ceklis siapa saja; lainnya cuma milik sendiri
        if (!(OsisAuth.bisa("tabungan") || Tabungan.milikSaya(item))) {
            showToast("Kamu cuma bisa ceklis tabungan sendiri.", "error");
            return;
        }
        // Cegah double-tap saat request sebelumnya belum selesai
        if (!Tabungan._pendingCek) Tabungan._pendingCek = new Set();
        if (Tabungan._pendingCek.has(key)) return;
        const nilaiAwal = !!item.cek;
        const nilaiBaru = !nilaiAwal;
        // 1) Optimis: ubah UI seketika, urusan kirim belakangan
        item.cek = nilaiBaru;
        try { if (typeof Cache !== "undefined") Cache.set("tabungan", Tabungan.cache); } catch {}
        try { Tabungan.render(); } catch {}
        Tabungan._pendingCek.add(key);
        try {
            await toggleTabunganCek(u.id, id, nilaiBaru);
            showToast(nilaiBaru ? "Ditandai sudah diceklis." : "Ceklis dibatalkan.", "success");
            catatAksi("cek_tabungan", (nilaiBaru ? "✓ " : "batal ") + (item.nama || ""));
            Tabungan.segarkan();
        } catch (err) {
            console.error(err);
            // 2) Gagal: kembalikan UI ke nilai awal
            try {
                const cur = (Tabungan.cache || []).find(r => String(r.id) === key);
                if (cur) cur.cek = nilaiAwal;
                if (typeof Cache !== "undefined") Cache.set("tabungan", Tabungan.cache);
                Tabungan.render();
            } catch {}
            const msg = String((err && err.message) || err || "");
            showToast("Gagal update ceklis: " + (/ERR_NO_AUTH/i.test(msg) ? "kamu cuma bisa ceklis tabungan sendiri" : msg), "error");
            Tabungan.segarkan();
        } finally {
            Tabungan._pendingCek.delete(key);
        }
    },

    async hapusRow(id, dariDetail) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("tabungan")) return;
        const item = (Tabungan.cache || []).find(r => String(r.id) === String(id));
        if (!item) return;
        const yakin = await showPopup(`Hapus ${Tabungan.isKeluar(item) ? "penarikan" : "setoran"} ${item.nama} (${Tabungan.fmtTanggalPendek(item.tanggal)}, ${Tabungan.rp(item.nominal)})?`, "confirm");
        if (!yakin) return;
        try {
            await hapusTabungan(u.id, id);
            if (dariDetail) Tabungan.tutupDetail();
            showToast("Setoran dihapus.", "success");
            catatAksi("hapus_tabungan", (item.nama || "") + " " + Tabungan.rp(item.nominal));
            Tabungan.segarkan();
        } catch (err) {
            console.error(err);
            showToast("Gagal hapus: " + err.message, "error");
            Tabungan.segarkan();
        }
    },

    // ============ DETAIL (klik baris) ============
    detail(id) {
        const r = (Tabungan.cache || []).find(x => String(x.id) === String(id));
        if (!r) return;
        Tabungan.detailId = id;
        const keluar = Tabungan.isKeluar(r);
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        document.getElementById("tabDetailBody").innerHTML = `
            <h4 style="font-size:1rem; font-weight:900; overflow-wrap:anywhere">${escapeHtml(r.nama || "Tanpa nama")}</h4>
            <div style="margin:6px 0 2px; display:flex; gap:6px; align-items:center; flex-wrap:wrap">
                <span class="jenis ${keluar ? "keluar" : "masuk"}">${keluar ? "Penarikan" : "Setoran"}</span>
                <span class="num" style="font-size:1.1rem; font-weight:900; color:${keluar ? "var(--red-dark)" : "#146314"}">${keluar ? "−" : "+"} ${Tabungan.rp(r.nominal)}</span>
            </div>
            <div class="detail-info">
                ${info("Tanggal", Tabungan.fmtTanggalPendek(r.tanggal))}
                ${info("Status", r.cek ? "Sudah diceklis ✓" : "Belum diceklis")}
                ${info("Dibuat", Tabungan.fmtTanggalWaktu(r.created_at))}
                ${info("Diupload oleh", escapeHtml(r.pengunggah || "-"))}
                ${info("Diubah", Tabungan.fmtTanggalWaktu(r.updated_at))}
            </div>`;
        document.getElementById("tabDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("tabDetail")?.classList.remove("open");
        if (!document.getElementById("tabForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Tabungan.detailId = null;
    },

    // ============ EXPORT PDF (via dialog print → Save as PDF) ============
    cariGrup(nama) {
        const kunci = String(nama || "").trim().toLowerCase();
        return Tabungan.grupPerOrang(Tabungan.dataTampil()).find(g => String(g.nama || "").trim().toLowerCase() === kunci) || null;
    },

    isiLaporanSatu(g) {
        const esc = (s) => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s ?? "-"));
        const masuk = g.rows.filter(r => !Tabungan.isKeluar(r)).reduce((a, r) => a + (parseInt(r.nominal, 10) || 0), 0);
        const keluar = g.rows.filter(r => Tabungan.isKeluar(r)).reduce((a, r) => a + (parseInt(r.nominal, 10) || 0), 0);
        const sudah = g.rows.filter(r => !!r.cek).length;
        return `
            <div style="font-family:Arial,Helvetica,sans-serif; color:#111; max-width:700px; margin:0 auto">
                <div style="text-align:center; border-bottom:3px solid #111; padding-bottom:10px; margin-bottom:14px">
                    <div style="font-size:18px; font-weight:900">TABUNGAN PENGURUS OSIS</div>
                    <div style="font-size:12px">SMK Taruna Harapan 1 Cipatat — ${esc(g.nama)}</div>
                </div>
                <table style="font-size:13px; margin-bottom:12px">
                    <tr><td>Total Setoran (${g.rows.filter(r => !Tabungan.isKeluar(r)).length})</td><td style="text-align:right"><b>${Tabungan.rp(masuk)}</b></td></tr>
                    <tr><td>Total Penarikan (${g.rows.filter(r => Tabungan.isKeluar(r)).length})</td><td style="text-align:right"><b>${Tabungan.rp(keluar)}</b></td></tr>
                    <tr><td><b>Saldo Akhir</b></td><td style="text-align:right"><b>${Tabungan.rp(g.total)}</b></td></tr>
                    <tr><td>Ceklis</td><td style="text-align:right">${sudah}/${g.rows.length} sudah diceklis</td></tr>
                </table>
                <table border="1" cellspacing="0" cellpadding="6" style="width:100%; font-size:12px; border-collapse:collapse">
                    <thead><tr><th>No</th><th>Ceklis</th><th>Tanggal</th><th>Setoran</th><th>Penarikan</th><th>Saldo Jalan</th></tr></thead>
                    <tbody>${g.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.cek ? "Sudah" : "Belum"}</td><td>${esc(Tabungan.fmtTanggalPendek(r.tanggal))}</td><td style="text-align:right">${Tabungan.isKeluar(r) ? "-" : Tabungan.rp(r.nominal)}</td><td style="text-align:right">${Tabungan.isKeluar(r) ? Tabungan.rp(r.nominal) : "-"}</td><td style="text-align:right">${Tabungan.rp(r._total)}</td></tr>`).join("") || `<tr><td colspan="6">Tidak ada data.</td></tr>`}</tbody>
                </table>
                <p style="font-size:11px; color:#666; margin-top:12px">Dicetak ${new Date().toLocaleString("id-ID")} dari website OSIS Tarpan One.</p>
            </div>`;
    },

    cetakHtml(html, judulFile) {
        const pa = document.getElementById("printArea");
        if (!pa) { showToast("Area cetak tidak ditemukan.", "error"); return; }
        pa.innerHTML = html;
        const oldTitle = document.title;
        document.title = judulFile;
        showToast("Pilih 'Save as PDF' di dialog print", "info");
        window.print();
        setTimeout(() => { document.title = oldTitle; }, 500);
    },

    exportSatu(nama) {
        const g = Tabungan.cariGrup(nama);
        if (!g) { showToast("Data penabung tidak ditemukan.", "error"); return; }
        const aman = String(g.nama || "tabungan").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "tabungan";
        Tabungan.cetakHtml(Tabungan.isiLaporanSatu(g), `Tabungan-${aman}`);
    },

    pesanDb(kode) {
        const m = {
            "-1": "tidak ada akses", "-3": "tanggal wajib diisi",
            "-4": "nama wajib diisi", "-6": "nominal harus lebih dari 0",
            ERR_DUPLIKAT: "data duplikat", ERR_NO_AUTH: "tidak ada akses",
            ERR_NO_TANGGAL: "tanggal wajib diisi", ERR_NO_NAMA: "nama wajib diisi",
            ERR_NOMINAL: "nominal harus lebih dari 0", ERR_NOT_FOUND: "data tidak ditemukan"
        };
        return m[String(kode)] || String(kode);
    }
};

document.addEventListener("DOMContentLoaded", () => Tabungan.init());
