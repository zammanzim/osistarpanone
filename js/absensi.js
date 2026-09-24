// =========================================================================
// ABSENSI PENGURUS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/absensi.html — catat pengurus yang TIDAK HADIR
// (izin/sakit/alpha) per tanggal. Nama pengurus diketik manual.
// Tulis via RPC buat_absensi/update_absensi/hapus_absensi (cek osis_users,
// UNIQUE tanggal+lower(nama) anti duplikat).
// =========================================================================

const Absensi = {
    cache: [],
    filter: { q: "", status: "", tanggal: "", tab: "tidak" },
    editTanggal: null,
    // State modal Absen Langsung (tandai hadir cepat dari tabel anggota)
    langsung: { anggota: [], tahun: null, q: "", activeIdx: 0, saving: false },

    STATUS: ["izin", "sakit", "alpha"],

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        // Segarkan hak kendali (biar perubahan akses langsung berlaku)
        try { await OsisAuth.refreshAkses(); } catch {}
        Absensi.terapkanAkses();

        document.getElementById("btnTambahAbsensi")?.addEventListener("click", () => Absensi.bukaForm());
        document.getElementById("btnTabTidak")?.addEventListener("click", () => Absensi.setTab("tidak"));
        document.getElementById("btnTabHadir")?.addEventListener("click", () => Absensi.setTab("hadir"));
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Absensi.resetFilter());
        ["filterQ", "filterStatus", "filterTanggal"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Absensi.bacaFilter());
        });
        document.getElementById("btnBatalAbsensi")?.addEventListener("click", () => Absensi.tutupForm());
        document.getElementById("btnSimpanAbsensi")?.addEventListener("click", () => Absensi.simpan());
        document.getElementById("btnTambahBaris")?.addEventListener("click", () => Absensi.tambahBaris());
        document.getElementById("absensiWrap")?.addEventListener("click", (e) => {
            const eb = e.target.closest("[data-abs-edithari]");
            if (eb) { Absensi.editHari(eb.dataset.absEdithari); return; }
            const hb = e.target.closest("[data-abs-delhari]");
            if (hb) Absensi.hapusHari(hb.dataset.absDelhari);
        });
        document.getElementById("absensiRows")?.addEventListener("click", (e) => {
            const rb = e.target.closest("[data-abs-rmrow]");
            if (!rb) return;
            const rows = document.querySelectorAll("#absensiRows .abs-row");
            if (rows.length <= 1) { showToast("Minimal 1 baris pengurus.", "error"); return; }
            rb.closest(".abs-row")?.remove();
            FormPersist.touch("absensiForm");
        });
        document.getElementById("btnAbsenLangsung")?.addEventListener("click", () => Absensi.bukaLangsung());
        document.getElementById("btnBatalLangsung")?.addEventListener("click", () => Absensi.tutupLangsung());
        document.getElementById("btnSelesaiLangsung")?.addEventListener("click", () => Absensi.selesaiLangsung());
        ["langsungTanggal", "langsungKegiatan"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Absensi.bacaLangsung());
        });
        document.getElementById("langsungSearch")?.addEventListener("input", () => {
            Absensi.langsung.q = document.getElementById("langsungSearch").value || "";
            Absensi.langsung.activeIdx = 0;
            Absensi.renderLangsung();
        });
        document.getElementById("langsungSearch")?.addEventListener("keydown", (e) => Absensi.navLangsung(e));
        document.getElementById("langsungBelum")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-hadir]");
            if (b) Absensi.tandaiHadir(decodeURIComponent(b.dataset.hadir || ""));
        });
        document.getElementById("langsungSudah")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-batal-hadir]");
            if (b) Absensi.batalHadir(decodeURIComponent(b.dataset.batalHadir || ""));
        });
        ["absensiForm", "absenLangsung"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "absensiForm") Absensi.tutupForm();
                    else Absensi.tutupLangsung();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("absenLangsung")?.classList.contains("open")) { Absensi.tutupLangsung(); return; }
            if (document.getElementById("absensiForm")?.classList.contains("open")) Absensi.tutupForm();
        });
        // Draft otomatis: ketikan belum disubmit tetap ada walau popup ditutup / refresh
        if (typeof FormPersist !== "undefined") {
            FormPersist.watch("absensiForm", {
                fields: ["absTanggal", "absKegiatan"],
                observe: "#absensiRows",
                isEditing: () => !!Absensi.editTanggal,
                collect: () => ({ rows: Absensi.kumpulkanDraftRows() })
            });
        }
        Absensi.muat();
    },


    fmtTanggalPanjang(t) {
        if (!t) return "-";
        const d = new Date(t + "T00:00:00");
        if (isNaN(d)) return t;
        return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    },

    // "2026-09" -> "September 2026" (pembatas per bulan)
    fmtBulan(ym) {
        if (!ym) return "-";
        const d = new Date(ym + "-01T00:00:00");
        if (isNaN(d)) return ym;
        const s = d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    labelStatus(s) {
        return s === "izin" ? "Izin" : s === "sakit" ? "Sakit" : "Alpha";
    },

    // ============ DATA ============
    async muat() {
        try {
            const cached = Cache.get("absensi");
            if (cached) {
                Absensi.cache = cached;
                Absensi.render();
                getAbsensi().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("absensi", fresh);
                        Absensi.cache = fresh || [];
                        Absensi.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getAbsensi();
            Cache.set("absensi", data);
            Absensi.cache = data || [];
            Absensi.render();
        } catch (err) {
            console.error(err);
            document.getElementById("absensiWrap").innerHTML = `<div class="pesan-empty">Gagal memuat absensi.</div>`;
        }
    },

    async segarkan() {
        // Render cache dulu biar offline langsung tampil.
        const cached = Cache.get("absensi");
        if (cached) {
            Absensi.cache = cached || [];
            try { Absensi.render(); } catch {}
        }
        try {
            const data = await getAbsensi();
            if (JSON.stringify(data) !== JSON.stringify(cached)) {
                Cache.set("absensi", data);
                Absensi.cache = data || [];
                Absensi.render();
            }
        } catch (err) {
            console.error(err);
            if (!cached) showToast("Gagal memuat ulang: " + err.message, "error");
            try { Absensi.render(); } catch {}
        }
    },

    dataTampil() {
        const f = Absensi.filter;
        const q = f.q.trim().toLowerCase();
        const isHadir = f.tab === "hadir";
        return (Absensi.cache || []).filter(r => {
            if (isHadir) {
                // Tab Hadir: kebalikan tab Tidak Hadir — cuma baris 'hadir'
                if (r.status !== "hadir") return false;
            } else {
                // Baris 'hadir' (Absen Langsung) tidak tampil di riwayat ketidakhadiran
                if (r.status === "hadir") return false;
                if (f.status && r.status !== f.status) return false;
            }
            if (f.tanggal && String(r.tanggal) !== String(f.tanggal)) return false;
            if (q && !(String(r.nama || "").toLowerCase().includes(q) || String(r.kegiatan || "").toLowerCase().includes(q))) return false;
            return true;
        });
    },

    // Pindah tab Hadir / Tidak Hadir. Filter status cuma berlaku di tab
    // Tidak Hadir — di-reset tiap pindah biar tidak bingung.
    setTab(t) {
        Absensi.filter.tab = (t === "hadir") ? "hadir" : "tidak";
        const isHadir = Absensi.filter.tab === "hadir";
        Absensi.filter.status = "";
        const st = document.getElementById("filterStatus");
        if (st) {
            st.value = "";
            const f = st.closest(".field");
            if (f) f.style.display = isHadir ? "none" : "";
        }
        const bT = document.getElementById("btnTabTidak");
        const bH = document.getElementById("btnTabHadir");
        if (bT) bT.className = isHadir ? "" : "on-tidak";
        if (bH) bH.className = isHadir ? "on-hadir" : "";
        Absensi.render();
        // Tab Hadir butuh roster anggota buat hitung otomatis — muat duluan
        if (isHadir) Absensi.muatRosterHadir();
    },

    // ============ RENDER ============
    render() {
        if (Absensi.filter.tab === "hadir") { Absensi.renderHadir(); return; }
        // Kembalikan stat tab Tidak Hadir (diubah/disembunyikan tab Hadir)
        ["statIzin", "statSakit", "statAlpha"].forEach(id => {
            const card = document.getElementById(id)?.closest(".stat-card");
            if (card) card.style.display = "";
        });
        const totalLbl0 = document.getElementById("statTotal")?.closest(".stat-card")?.querySelector(".lbl");
        if (totalLbl0) totalLbl0.innerHTML = `<i class="fa-solid fa-users-slash"></i> Total Tidak Hadir`;
        const data = Absensi.dataTampil();
        // Angka + suffix (suffix disembunyikan di mobile via CSS .stat-suffix)
        const setStat = (id, count, suffix) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = String(count) + `<span class="stat-suffix"> ${suffix}</span>`;
        };
        // Stat paling atas = tanggal terakhir (atau tanggal filter), bukan keseluruhan.
        // Baris 'hadir' tidak ikut hitungan statistik ketidakhadiran.
        const all = Absensi.cache || [];
        const allTK = all.filter(r => r.status !== "hadir");
        let tTarget = Absensi.filter.tanggal || "";
        if (!tTarget && allTK.length) {
            tTarget = allTK.map(r => String(r.tanggal || "")).filter(Boolean).sort().reverse()[0] || "";
        }
        const statRows = tTarget ? allTK.filter(r => String(r.tanggal) === String(tTarget)) : [];
        const n = (s) => statRows.filter(r => r.status === s).length;
        setStat("statIzin", n("izin"), "pengurus");
        setStat("statSakit", n("sakit"), "pengurus");
        setStat("statAlpha", n("alpha"), "pengurus");
        setStat("statTotal", statRows.length, "tidak hadir");

        const wrap = document.getElementById("absensiWrap");
        if (!wrap) return;
        const boleh = OsisAuth.bisa("absensi");
        if (!allTK.length) {
            wrap.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-clipboard-user" style="color:var(--red)"></i></div><b>Belum ada data ketidakhadiran</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Catat pengurus yang izin, sakit, atau alpha.</p>${boleh ? `<button class="btn btn-red btn-sm" onclick="Absensi.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Data</button>` : ""}</div>`;
            return;
        }
        if (!data.length) {
            if (Absensi.filter.tanggal) {
                wrap.innerHTML = `<div class="pesan-empty" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-circle-check" style="color:#146314"></i></div><b>Semua pengurus hadir.</b><p style="font-size:0.8rem; color:var(--gray); margin-top:6px">Tidak ada record ketidakhadiran pada tanggal ini.</p></div>`;
            } else {
                wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada yang cocok dengan filter. <a href="#" onclick="event.preventDefault(); Absensi.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            }
            return;
        }
        const grup = {};
        data.forEach(r => { (grup[r.tanggal] = grup[r.tanggal] || []).push(r); });
        const tgls = Object.keys(grup).sort().reverse();
        // Bagi per bulan (terbaru dulu): pembatas bulan + kartu per hari
        const perBulan = {};
        tgls.forEach(t => { const ym = String(t).slice(0, 7); (perBulan[ym] = perBulan[ym] || []).push(t); });
        const kartuHari = (t) => {
            const rows = grup[t].slice().sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")));
            const keg = (rows.map(r => String(r.kegiatan || "").trim()).find(Boolean) || "");
            const pencatat = [...new Set(rows.map(r => String(r.pengunggah || "").trim()).filter(Boolean))].join(", ");
            return `<div class="rekap-card" style="margin-bottom:12px">
                <h3><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(Absensi.fmtTanggalPanjang(t))} <span class="jenis total" style="margin-left:auto">${rows.length} tidak hadir</span></h3>
                ${keg ? `<div style="display:flex; align-items:center; gap:6px; font-size:0.78rem; font-weight:700; color:var(--gray); margin:-4px 0 8px 2px"><i class="fa-solid fa-bullhorn" style="color:var(--red)"></i> ${escapeHtml(keg)}</div>` : ""}
                ${pencatat ? `<div style="font-size:0.72rem; font-weight:700; color:var(--gray); margin:-2px 0 8px 2px">Dicatat oleh ${escapeHtml(pencatat)}</div>` : ""}
                <div class="kas-scroll"><table class="kas-tabel"><thead><tr><th>No</th><th>Nama</th><th>Status</th><th>Alasan</th></tr></thead><tbody>
                ${rows.map((r, i) => `<tr>
                    <td>${i + 1}</td>
                    <td><b>${escapeHtml(r.nama || "-")}</b></td>
                    <td><span class="jenis ${r.status}">${Absensi.labelStatus(r.status)}</span></td>
                    <td>${escapeHtml(r.alasan || "Tidak ada keterangan")}</td>
                </tr>`).join("")}
                </tbody></table></div>
                ${boleh ? `<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px">
                    <button class="btn btn-white btn-sm" data-abs-edithari="${t}"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn btn-red btn-sm" data-abs-delhari="${t}"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                </div>` : ""}
            </div>`;
        };
        wrap.innerHTML = Object.keys(perBulan).sort().reverse().map(ym => {
            const hari = perBulan[ym];
            const total = hari.reduce((a, t) => a + grup[t].length, 0);
            return `<div class="bulan-sep"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.fmtBulan(ym))}<span class="cnt">${total} tidak hadir</span></div>`
                + hari.map(kartuHari).join("");
        }).join("");
    },

    // ============ TAB HADIR (kebalikan otomatis dari tidak hadir) ============
    // Per tanggal: baris 'hadir' tersimpan (Absen Langsung) diutamakan.
    // Kalau tidak ada, hadir = roster anggota − nama yang tercatat.
    hadirTanggal(t) {
        const hari = (Absensi.cache || []).filter(r => String(r.tanggal) === String(t));
        const tersimpan = hari.filter(r => r.status === "hadir")
            .map(r => String(r.nama || "").trim()).filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        if (tersimpan.length) return { daftar: tersimpan, otomatis: false };
        const roster = Absensi.langsung.anggota || [];
        const catat = new Set(hari.map(r => Absensi.norm(r.nama)));
        return { daftar: roster.filter(n => !catat.has(Absensi.norm(n))), otomatis: true };
    },

    // Roster anggota (periode terbaru) buat hitung hadir otomatis.
    // Cache-first; render ulang tab Hadir tiap ada data baru.
    async muatRosterHadir() {
        try {
            const cached = (typeof Cache !== "undefined") ? Cache.get("anggota") : null;
            if (cached && cached.length) {
                const sebelum = JSON.stringify(Absensi.langsung.anggota || []);
                Absensi.pakaiAnggota(cached);
                if (JSON.stringify(Absensi.langsung.anggota || []) !== sebelum && Absensi.filter.tab === "hadir") Absensi.render();
                getAnggota().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("anggota", fresh);
                        Absensi.pakaiAnggota(fresh);
                        if (Absensi.filter.tab === "hadir") Absensi.render();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getAnggota();
            if (typeof Cache !== "undefined") Cache.set("anggota", fresh);
            Absensi.pakaiAnggota(fresh);
            if (Absensi.filter.tab === "hadir") Absensi.render();
        } catch (err) { console.error(err); }
    },

    renderHadir() {
        const setStat = (id, count, suffix) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = String(count) + `<span class="stat-suffix"> ${suffix}</span>`;
        };
        // Stat per-status disembunyikan, tinggal total hadir
        ["statIzin", "statSakit", "statAlpha"].forEach(id => {
            const card = document.getElementById(id)?.closest(".stat-card");
            if (card) card.style.display = "none";
        });
        const totalLbl = document.getElementById("statTotal")?.closest(".stat-card")?.querySelector(".lbl");
        if (totalLbl) totalLbl.innerHTML = `<i class="fa-solid fa-user-check"></i> Total Hadir`;

        const all = Absensi.cache || [];
        const q = Absensi.filter.q.trim().toLowerCase();
        const tglSet = {};
        all.forEach(r => {
            if (!r.tanggal) return;
            if (Absensi.filter.tanggal && String(r.tanggal) !== String(Absensi.filter.tanggal)) return;
            tglSet[String(r.tanggal)] = true;
        });
        const grupHadir = {};
        Object.keys(tglSet).sort().reverse().forEach(t => {
            const h = Absensi.hadirTanggal(t);
            const hariRows = all.filter(r => String(r.tanggal) === String(t));
            const keg = (hariRows.map(r => String(r.kegiatan || "").trim()).find(Boolean) || "");
            if (q && !(h.daftar.some(n => n.toLowerCase().includes(q)) || keg.toLowerCase().includes(q))) return;
            grupHadir[t] = { daftar: h.daftar, otomatis: h.otomatis, keg };
        });
        const tgls = Object.keys(grupHadir).sort().reverse();

        const tTarget = Absensi.filter.tanggal || (tgls[0] || "");
        setStat("statTotal", tTarget && grupHadir[tTarget] ? grupHadir[tTarget].daftar.length : 0, "pengurus");

        const wrap = document.getElementById("absensiWrap");
        if (!wrap) return;
        const boleh = OsisAuth.bisa("absensi");
        if (!tgls.length) {
            if (Absensi.filter.tanggal || q) {
                wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada data hadir yang cocok. <a href="#" onclick="event.preventDefault(); Absensi.resetFilter()" style="color:var(--red); font-weight:800">Reset filter</a></div>`;
            } else {
                wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:26px 12px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-user-check" style="color:#146314"></i></div><b>Belum ada data kehadiran</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Tandai kehadiran pengurus lewat Absen Langsung.</p>${boleh ? `<button class="btn btn-red btn-sm" onclick="Absensi.bukaLangsung()"><i class="fa-solid fa-bolt"></i> Absen Langsung</button>` : ""}</div>`;
            }
            return;
        }
        const perBulan = {};
        tgls.forEach(t => { const ym = String(t).slice(0, 7); (perBulan[ym] = perBulan[ym] || []).push(t); });
        const kartuHari = (t) => {
            const g = grupHadir[t];
            return `<div class="rekap-card" style="margin-bottom:12px">
                <h3><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(Absensi.fmtTanggalPanjang(t))} <span class="jenis total" style="margin-left:auto">${g.daftar.length} hadir</span></h3>
                ${g.keg ? `<div style="display:flex; align-items:center; gap:6px; font-size:0.78rem; font-weight:700; color:var(--gray); margin:-4px 0 8px 2px"><i class="fa-solid fa-bullhorn" style="color:var(--red)"></i> ${escapeHtml(g.keg)}</div>` : ""}
                ${g.otomatis ? `<div style="font-size:0.7rem; font-weight:700; color:var(--gray); margin:-2px 0 8px 2px"><i class="fa-solid fa-wand-magic-sparkles"></i> Otomatis: daftar anggota − tidak hadir</div>` : ""}
                <div class="kas-scroll"><table class="kas-tabel"><thead><tr><th>No</th><th>Nama</th><th>Status</th></tr></thead><tbody>
                ${g.daftar.map((n, i) => `<tr><td>${i + 1}</td><td><b>${escapeHtml(n)}</b></td><td><span class="jenis hadir">Hadir</span></td></tr>`).join("") || `<tr><td colspan="3" style="text-align:center; color:var(--gray)">Tidak ada — daftar anggota belum termuat.</td></tr>`}
                </tbody></table></div>
                ${boleh ? `<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px">
                    <button class="btn btn-red btn-sm" data-abs-delhari="${t}"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                </div>` : ""}
            </div>`;
        };
        wrap.innerHTML = Object.keys(perBulan).sort().reverse().map(ym => {
            const hari = perBulan[ym];
            const total = hari.reduce((a, t) => a + grupHadir[t].daftar.length, 0);
            return `<div class="bulan-sep"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.fmtBulan(ym))}<span class="cnt">${total} hadir</span></div>`
                + hari.map(kartuHari).join("");
        }).join("");
    },

    bacaFilter() {
        Absensi.filter = {
            q: document.getElementById("filterQ").value || "",
            status: document.getElementById("filterStatus").value || "",
            tanggal: document.getElementById("filterTanggal").value || ""
        };
        Absensi.render();
    },

    resetFilter() {
        ["filterQ", "filterStatus", "filterTanggal"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        Absensi.bacaFilter();
    },

    // ============ FORM ============
    barisHtml(prefill) {
        const pr = prefill || {};
        return `<div class="abs-row" ${pr.id ? `data-row-id="${pr.id}"` : ""} style="position:relative; border:2px dashed var(--line); border-radius:12px; padding:10px; margin-bottom:8px">
            <button type="button" class="icon-btn" data-abs-rmrow title="Hapus baris" style="position:absolute; top:8px; right:8px; width:28px; height:28px; font-size:0.75rem; background:var(--red); color:#fff; border-width:2px"><i class="fa-solid fa-trash-can"></i></button>
            <div class="field" style="padding-right:36px"><label>Nama pengurus</label><input type="text" class="admin-input abs-nama" placeholder="cth: Nizam" maxlength="80" value="${escapeHtml(pr.nama || "")}" /></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px">
                <div class="field"><label>Status</label><select class="admin-input abs-status">
                    <option value="izin" ${pr.status === "izin" ? "selected" : ""}>Izin</option>
                    <option value="sakit" ${pr.status === "sakit" ? "selected" : ""}>Sakit</option>
                    <option value="alpha" ${pr.status === "alpha" ? "selected" : ""}>Alpha</option>
                </select></div>
                <div class="field"><label>Alasan</label><input type="text" class="admin-input abs-alasan" placeholder="cth: Ada keperluan keluarga" maxlength="500" value="${escapeHtml(pr.alasan || "")}" /></div>
            </div>
        </div>`;
    },

    tambahBaris(prefill) {
        document.getElementById("absensiRows")?.insertAdjacentHTML("beforeend", Absensi.barisHtml(prefill));
        if (typeof FormPersist !== "undefined") FormPersist.touch("absensiForm");
    },

    // Kumpulin isi form mentah buat draft (tanpa validasi).
    kumpulkanDraftRows() {
        return [...document.querySelectorAll("#absensiRows .abs-row")].map(el => ({
            id: el.dataset.rowId || "",
            nama: el.querySelector(".abs-nama")?.value ?? "",
            status: el.querySelector(".abs-status")?.value ?? "izin",
            alasan: el.querySelector(".abs-alasan")?.value ?? ""
        }));
    },

    // Sembunyikan tombol aksi kalau tidak punya kendali atas halaman ini
    terapkanAkses() {
        const boleh = OsisAuth.bisa("absensi");
        ["btnTambahAbsensi", "btnAbsenLangsung"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = boleh ? "" : "none";
        });
    },

    bukaForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        Absensi.editTanggal = null;
        document.getElementById("absensiFormTitle").textContent = "Tambah Ketidakhadiran";
        document.getElementById("absTanggal").value = Absensi.filter.tanggal || new Date().toISOString().slice(0, 10);
        document.getElementById("absKegiatan").value = "";
        document.getElementById("absensiRows").innerHTML = "";
        Absensi.tambahBaris();
        // Pulihkan draft kalau ada (tutup form / refresh tidak sengaja)
        try {
            const d = (typeof FormPersist !== "undefined") ? FormPersist.load("absensiForm") : null;
            const adaIsi = d && ((d.absTanggal && String(d.absTanggal).trim()) || (d.absKegiatan && String(d.absKegiatan).trim()) || (Array.isArray(d.rows) && d.rows.some(r => String(r.nama || "").trim() || String(r.alasan || "").trim())));
            if (adaIsi) {
                if (d.absTanggal) document.getElementById("absTanggal").value = d.absTanggal;
                if (typeof d.absKegiatan === "string") document.getElementById("absKegiatan").value = d.absKegiatan;
                if (Array.isArray(d.rows) && d.rows.length) {
                    document.getElementById("absensiRows").innerHTML = "";
                    d.rows.forEach(r => Absensi.tambahBaris(r));
                }
            }
        } catch {}
        document.getElementById("absensiForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    editHari(tanggal) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        // Edit sehari hanya untuk izin/sakit/alpha; baris 'hadir' tidak ikut
        const rows = (Absensi.cache || []).filter(r => String(r.tanggal) === String(tanggal) && r.status !== "hadir");
        if (!rows.length) return;
        Absensi.editTanggal = tanggal;
        document.getElementById("absensiFormTitle").textContent = "Edit — " + Absensi.fmtTanggalPanjang(tanggal);
        document.getElementById("absTanggal").value = tanggal;
        document.getElementById("absKegiatan").value = (rows.map(r => String(r.kegiatan || "").trim()).find(Boolean) || "");
        document.getElementById("absensiRows").innerHTML = "";
        rows.slice().sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")))
            .forEach(r => Absensi.tambahBaris({ id: r.id, nama: r.nama, status: r.status, alasan: r.alasan }));
        document.getElementById("absensiForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupForm() {
        document.getElementById("absensiForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Absensi.editTanggal = null;
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const tanggal = document.getElementById("absTanggal").value || "";
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        const kegiatan = (document.getElementById("absKegiatan")?.value || "").trim().slice(0, 120);
        const els = [...document.querySelectorAll("#absensiRows .abs-row")];
        if (!els.length) { showToast("Tambah minimal 1 pengurus.", "error"); return; }
        const originalIds = Absensi.editTanggal
            ? (Absensi.cache || []).filter(r => String(r.tanggal) === String(Absensi.editTanggal)).map(r => String(r.id))
            : [];
        const lainnya = (Absensi.cache || []).filter(r => !originalIds.includes(String(r.id)));
        const rows = [];
        const temu = new Set();
        for (const el of els) {
            const nama = el.querySelector(".abs-nama").value.trim();
            const status = el.querySelector(".abs-status").value || "";
            const alasan = el.querySelector(".abs-alasan").value.trim();
            const rid = el.dataset.rowId || "";
            if (!nama) { showToast("Ada baris yang namanya masih kosong.", "error"); return; }
            if (!Absensi.STATUS.includes(status)) { showToast("Ada baris yang statusnya belum dipilih.", "error"); return; }
            if (!alasan && status !== "alpha") { showToast("Alasan wajib diisi untuk izin/sakit.", "error"); return; }
            const kunci = tanggal + "|" + nama.toLowerCase();
            if (temu.has(kunci)) { showToast("Ada pengurus yang dobel di form ini.", "error"); return; }
            temu.add(kunci);
            const bentrok = lainnya.find(r => String(r.tanggal) === tanggal && String(r.nama || "").toLowerCase() === nama.toLowerCase());
            if (bentrok) { showToast(nama + " sudah tercatat pada tanggal ini.", "error"); return; }
            rows.push({ id: rid, nama, status, alasan });
        }
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            if (Absensi.editTanggal || rows.some(r => r.id)) {
                showToast("Ubah absensi butuh koneksi — data pembanding ada di server.", "error");
                return;
            }
            try {
                await Outbox.enqueue({ modul: "absensi", op: "create",
                    label: "Absensi " + tanggal + " (" + rows.length + " orang)",
                    payload: { rows: rows.map(r => ({ tanggal, nama: r.nama, status: r.status, alasan: r.alasan, kegiatan })) },
                    files: [], cacheKeys: ["absensi"] });
            } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(() => {
                if (typeof FormPersist !== "undefined") FormPersist.clear("absensiForm");
                Absensi.tutupForm();
            });
            return;
        }
        try {
            const hapusIds = originalIds.filter(id => !rows.some(r => String(r.id) === String(id)));
            for (const hid of hapusIds) await hapusAbsensi(u.id, hid);
            for (const r of rows) {
                if (r.id) await updateAbsensi(u.id, r.id, { tanggal, nama: r.nama, status: r.status, alasan: r.alasan, kegiatan });
                else await buatAbsensi(u.id, { tanggal, nama: r.nama, status: r.status, alasan: r.alasan, kegiatan });
            }
            showToast("Absensi tersimpan!", "success");
            if (typeof FormPersist !== "undefined") FormPersist.clear("absensiForm");
            Absensi.tutupForm();
            Absensi.segarkan();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + Absensi.pesanDb(err.message), "error");
            Absensi.segarkan();
        }
    },

    async hapusHari(tanggal) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        // Hapus sehari = semua baris tanggal itu (hadir + izin/sakit/alpha),
        // biar tab Hadir dan Tidak Hadir sama-sama bersih.
        const rows = (Absensi.cache || []).filter(r => String(r.tanggal) === String(tanggal));
        if (!rows.length) return;
        const nHadir = rows.filter(r => r.status === "hadir").length;
        const yakin = await showPopup(`Hapus semua data absensi (${Absensi.fmtTanggalPanjang(tanggal)})? ${rows.length} baris${nHadir ? ` (termasuk ${nHadir} hadir)` : ""} akan dihapus dari kedua tab.`, "confirm");
        if (!yakin) return;
        try {
            for (const r of rows) await hapusAbsensi(u.id, r.id);
            showToast("Data sehari dihapus.", "success");
            Absensi.segarkan();
        } catch (err) {
            console.error(err);
            showToast("Gagal hapus: " + err.message, "error");
            Absensi.segarkan();
        }
    },

    // ============ ABSEN LANGSUNG (tandai hadir cepat) ============
    // Sumber nama WAJIB dari tabel anggota (periode terbaru). Simpan hadir
    // ke tabel osis_absensi yang sama (status 'hadir'), jadi UNIQUE
    // tanggal+lower(nama) mencegah dobel & bentrok izin/sakit/alpha.
    norm(s) {
        return String(s || "").trim().toLowerCase();
    },

    // Cari per token: tiap kata kunci harus terkandung di nama.
    // "ase" -> Asep; "ase muh" -> Asep Muhammad; "riz" -> Rizky.
    cocokQuery(nama, q) {
        const toks = Absensi.norm(q).split(/\s+/).filter(Boolean);
        if (!toks.length) return true;
        const t = Absensi.norm(nama);
        return toks.every(k => t.includes(k));
    },

    sesiLangsung() {
        return {
            tanggal: document.getElementById("langsungTanggal")?.value || "",
            kegiatan: (document.getElementById("langsungKegiatan")?.value || "").trim().slice(0, 120)
        };
    },

    async bukaLangsung() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const hariIni = new Date().toISOString().slice(0, 10);
        const tDef = Absensi.filter.tanggal || hariIni;
        document.getElementById("langsungTanggal").value = tDef;
        // Pakai kegiatan yang sudah ada pada tanggal itu (struktur data sama)
        const ada = (Absensi.cache || []).filter(r => String(r.tanggal) === String(tDef) && String(r.kegiatan || "").trim());
        document.getElementById("langsungKegiatan").value = ada.length ? ada[0].kegiatan : "";
        Absensi.langsung.q = "";
        Absensi.langsung.activeIdx = 0;
        document.getElementById("langsungSearch").value = "";
        document.getElementById("absenLangsung").classList.add("open");
        document.body.style.overflow = "hidden";
        Absensi.renderLangsung();
        await Absensi.muatAnggotaLangsung();
        Absensi.renderLangsung();
        setTimeout(() => document.getElementById("langsungSearch")?.focus(), 80);
    },

    tutupLangsung() {
        document.getElementById("absenLangsung")?.classList.remove("open");
        if (!document.getElementById("absensiForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Absensi.langsung.saving = false;
    },

    bacaLangsung() {
        Absensi.langsung.activeIdx = 0;
        Absensi.renderLangsung();
    },

    async muatAnggotaLangsung() {
        try {
            const cached = (typeof Cache !== "undefined") ? Cache.get("anggota") : null;
            if (cached && cached.length) {
                Absensi.pakaiAnggota(cached);
                // Revalidasi di background
                getAnggota().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("anggota", fresh);
                        Absensi.pakaiAnggota(fresh);
                        if (document.getElementById("absenLangsung")?.classList.contains("open")) Absensi.renderLangsung();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getAnggota();
            if (typeof Cache !== "undefined") Cache.set("anggota", fresh);
            Absensi.pakaiAnggota(fresh);
        } catch (err) {
            console.error(err);
            showToast("Gagal memuat anggota: " + err.message, "error");
        }
    },

    // Ambil periode terbaru, nama unik urut A-Z
    pakaiAnggota(list) {
        const bersih = (list || []).filter(a => a && String(a.nama || "").trim());
        const thns = [...new Set(bersih.map(a => parseInt(a.tahun, 10)).filter(Number.isFinite))].sort((a, b) => b - a);
        const th = thns.length ? thns[0] : null;
        const pakai = th !== null ? bersih.filter(a => parseInt(a.tahun, 10) === th) : bersih;
        Absensi.langsung.tahun = th;
        Absensi.langsung.anggota = [...new Set(pakai.map(a => String(a.nama).trim()))]
            .filter(Boolean).sort((a, b) => a.localeCompare(b));
    },

    // Kelompokkan anggota -> belum / sudah / izin-sakit-alpha utk sesi ini.
    // Blokir (izin/sakit/alpha) dihitung per tanggal saja biar tidak bentrok;
    // hadir dihitung per tanggal + kegiatan (kalau kegiatan diisi).
    daftarLangsung() {
        const L = Absensi.langsung;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        const kNorm = Absensi.norm(kegiatan);
        const hariRows = (Absensi.cache || []).filter(r => String(r.tanggal) === String(tanggal));
        const cocokKeg = (r) => !kNorm || !String(r.kegiatan || "").trim() || Absensi.norm(r.kegiatan) === kNorm;
        const hadirSet = new Set(hariRows.filter(r => r.status === "hadir" && cocokKeg(r)).map(r => Absensi.norm(r.nama)));
        const blokirMap = {};
        hariRows.filter(r => r.status !== "hadir").forEach(r => { blokirMap[Absensi.norm(r.nama)] = r.status; });
        const q = L.q || "";
        const saring = q.trim() !== "";
        const belum = [], sudah = [], blokir = [];
        L.anggota.forEach(nama => {
            const k = Absensi.norm(nama);
            if (hadirSet.has(k)) {
                if (!saring || Absensi.cocokQuery(nama, q)) sudah.push(nama);
                return;
            }
            if (blokirMap[k]) {
                if (!saring || Absensi.cocokQuery(nama, q)) blokir.push({ nama, status: blokirMap[k] });
                return;
            }
            if (Absensi.cocokQuery(nama, q)) belum.push(nama);
        });
        return { belum, sudah, blokir, total: L.anggota.length, hadirCount: sudah.length };
    },

    renderLangsung() {
        const L = Absensi.langsung;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        const d = Absensi.daftarLangsung();
        if (L.activeIdx >= d.belum.length) L.activeIdx = 0;
        if (L.activeIdx < 0) L.activeIdx = d.belum.length - 1;
        const kegEl = document.getElementById("langsungKegLbl");
        if (kegEl) kegEl.textContent = kegiatan || "(tanpa kegiatan)";
        const tglEl = document.getElementById("langsungTglLbl");
        if (tglEl) tglEl.textContent = tanggal ? Absensi.fmtTanggalPanjang(tanggal) : "-";
        const pEl = document.getElementById("langsungProgress");
        if (pEl) pEl.textContent = `${d.hadirCount} / ${d.total} HADIR`;
        const bar = document.getElementById("langsungBar");
        if (bar) bar.style.width = (d.total ? Math.round(d.hadirCount / d.total * 100) : 0) + "%";
        const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
        setCount("langsungBelumCount", d.belum.length);
        setCount("langsungSudahCount", d.sudah.length);
        setCount("langsungIzinCount", d.blokir.length);
        const bEl = document.getElementById("langsungBelum");
        if (bEl) {
            bEl.innerHTML = d.belum.length
                ? d.belum.map((n, i) => `<button type="button" class="absen-item${i === L.activeIdx ? " active" : ""}" data-hadir="${encodeURIComponent(n)}"><span class="dot">○</span> ${escapeHtml(n)}</button>`).join("")
                : `<div class="pesan-empty">${L.anggota.length ? "Semua anggota tersaring / sudah tercatat." : "Memuat anggota..."}</div>`;
            const akt = bEl.querySelector(".absen-item.active");
            if (akt) akt.scrollIntoView({ block: "nearest" });
        }
        const sEl = document.getElementById("langsungSudah");
        if (sEl) {
            sEl.innerHTML = d.sudah.length
                ? d.sudah.map(n => `<div class="absen-item done"><span class="dot"><i class="fa-solid fa-check"></i></span> ${escapeHtml(n)}<small>hadir</small><button type="button" class="batal" data-batal-hadir="${encodeURIComponent(n)}" title="Batalkan (salah pencet)"><i class="fa-solid fa-xmark"></i></button></div>`).join("")
                : `<div class="pesan-empty">Belum ada yang hadir.</div>`;
        }
        const iEl = document.getElementById("langsungIzin");
        if (iEl) {
            iEl.innerHTML = d.blokir.length
                ? d.blokir.map(o => `<div class="absen-item blocked"><span class="dot">−</span> ${escapeHtml(o.nama)}<small>${Absensi.labelStatus(o.status)}</small></div>`).join("")
                : `<div class="pesan-empty">Tidak ada.</div>`;
        }
    },

    navLangsung(e) {
        const L = Absensi.langsung;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            L.activeIdx++;
            Absensi.renderLangsung();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            L.activeIdx--;
            Absensi.renderLangsung();
        } else if (e.key === "Enter") {
            e.preventDefault();
            const d = Absensi.daftarLangsung();
            if (!d.belum.length) return;
            // Enter = hasil pertama kalau cuma satu, kalau tidak yang sedang disorot
            const pick = d.belum.length === 1 ? d.belum[0] : (d.belum[L.activeIdx] ?? d.belum[0]);
            Absensi.tandaiHadir(pick);
        }
    },

    // Satu klik/Enter langsung simpan ke DB (tanpa tombol simpan per anggota)
    async tandaiHadir(nama) {
        const L = Absensi.langsung;
        if (L.saving) return;
        nama = String(nama || "").trim();
        if (!nama) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        // Cegah dobel & bentrok di client (DB juga dilindungi UNIQUE)
        const k = Absensi.norm(nama);
        const bentrok = (Absensi.cache || []).find(r => String(r.tanggal) === String(tanggal) && Absensi.norm(r.nama) === k);
        if (bentrok) {
            if (bentrok.status === "hadir") showToast(nama + " sudah hadir.", "info");
            else showToast(nama + " sudah tercatat " + Absensi.labelStatus(bentrok.status) + ".", "error");
            return;
        }
        L.saving = true;
        try {
            const nid = await buatAbsensi(u.id, { tanggal, nama, status: "hadir", alasan: "", kegiatan });
            (Absensi.cache = Absensi.cache || []).push({ id: nid, tanggal, nama, status: "hadir", alasan: "", kegiatan });
        } catch (err) {
            console.error(err);
            const kode = String(err.message || "");
            if (kode === "-2" || kode === "ERR_STATUS") {
                showToast("DB belum mendukung 'hadir' — jalankan ulang SQL section 14.", "error");
            } else {
                showToast("Gagal absen: " + Absensi.pesanDb(kode), "error");
            }
            await Absensi.segarkan();
        } finally {
            L.saving = false;
            // Siap untuk nama berikutnya: kosongkan search TANPA focus ulang
            // (focus otomatis bikin keyboard njedul di Android).
            L.q = "";
            L.activeIdx = 0;
            const s = document.getElementById("langsungSearch");
            if (s) s.value = "";
            Absensi.render();
            Absensi.renderLangsung();
        }
    },

    // Batalkan satu hadir (salah pencet) — hapus baris 'hadir' sesi ini.
    // Tanpa konfirmasi biar cepat; tandai ulang tinggal ketuk lagi.
    async batalHadir(nama) {
        const L = Absensi.langsung;
        if (L.saving) return;
        nama = String(nama || "").trim();
        if (!nama) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        if (!tanggal) return;
        const k = Absensi.norm(nama);
        const kNorm = Absensi.norm(kegiatan);
        const row = (Absensi.cache || []).find(r =>
            String(r.tanggal) === String(tanggal) && r.status === "hadir" && Absensi.norm(r.nama) === k &&
            (!kNorm || !String(r.kegiatan || "").trim() || Absensi.norm(r.kegiatan) === kNorm));
        if (!row) { showToast(nama + " tidak tercatat hadir di sesi ini.", "info"); return; }
        L.saving = true;
        try {
            await hapusAbsensi(u.id, row.id);
            Absensi.cache = (Absensi.cache || []).filter(r => String(r.id) !== String(row.id));
            showToast(nama + " dibatalkan hadirnya.", "success");
        } catch (err) {
            console.error(err);
            showToast("Gagal batalkan: " + Absensi.pesanDb(err.message), "error");
            await Absensi.segarkan();
        } finally {
            L.saving = false;
            Absensi.render();
            Absensi.renderLangsung();
        }
    },
    // Selesai = sisa yang belum hadir langsung jadi data Alpha tanpa
    // keterangan, tampil di riwayat ketidakhadiran halaman utama.
    async selesaiLangsung() {
        const L = Absensi.langsung;
        if (L.saving) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        const d = Absensi.daftarLangsung();
        if (!d.belum.length) {
            showToast("Semua pengurus sudah tercatat.", "success");
            Absensi.tutupLangsung();
            return;
        }
        const yakin = await showPopup(
            `Selesaikan absensi <b>${escapeHtml(kegiatan || "(tanpa kegiatan)")}</b> (${escapeHtml(Absensi.fmtTanggalPanjang(tanggal))})?<br><b>${d.belum.length} pengurus</b> yang belum hadir akan dicatat <b>Alpha</b> tanpa keterangan.`,
            "confirm"
        );
        if (!yakin) return;
        L.saving = true;
        const btn = document.getElementById("btnSelesaiLangsung");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        let ok = 0, gagal = 0;
        try {
            for (const nama of d.belum) {
                const k = Absensi.norm(nama);
                const ada = (Absensi.cache || []).find(r => String(r.tanggal) === String(tanggal) && Absensi.norm(r.nama) === k);
                if (ada) continue;
                try {
                    const nid = await buatAbsensi(u.id, { tanggal, nama, status: "alpha", alasan: "", kegiatan });
                    (Absensi.cache = Absensi.cache || []).push({ id: nid, tanggal, nama, status: "alpha", alasan: "", kegiatan });
                    ok++;
                } catch (e) { console.error(e); gagal++; }
            }
            await Absensi.segarkan();
            Absensi.tutupLangsung();
            showToast(`Selesai! ${d.hadirCount} hadir, ${ok} alpha tanpa keterangan.${gagal ? ` ${gagal} gagal.` : ""}`, "success");
        } finally {
            L.saving = false;
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Selesai'; }
        }
    },

    pesanDb(kode) {
        const m = {
            "-1": "tidak ada akses", "-2": "status tidak valid", "-3": "tanggal wajib diisi",
            "-4": "nama wajib diisi", "-5": "sudah tercatat pada tanggal ini",
            ERR_DUPLIKAT: "sudah tercatat pada tanggal ini", ERR_NO_AUTH: "tidak ada akses",
            ERR_NO_TANGGAL: "tanggal wajib diisi", ERR_NO_NAMA: "nama wajib diisi",
            ERR_STATUS: "status tidak valid", ERR_NOT_FOUND: "data tidak ditemukan"
        };
        return m[String(kode)] || String(kode);
    }
};

document.addEventListener("DOMContentLoaded", () => Absensi.init());
