// =========================================================================
// PROGRAM OSIS — halaman khusus OSIS (folder /osis)
// Satu modul untuk dua halaman: program-tahunan.html & program-bulanan.html.
// Tipe halaman dibaca dari <body data-tipe="tahunan|bulanan">.
// Tahunan = rencana besar; Bulanan = operasional, dikelompokkan per bulan.
// Hak akses per sekbid: OSIS users bisa menambah/mengedit program sekbid mereka.
// =========================================================================

const Program = {
    tipe: "tahunan",
    cache: [],
    sekbidList: [],
    filter: { q: "", sekbid: "", status: "" },
    editingId: null,
    detailId: null,

    STATUS_LABEL: { rencana: "Rencana", berjalan: "Berjalan", selesai: "Selesai", batal: "Batal" },

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        const t = (document.body && document.body.dataset && document.body.dataset.tipe) || "tahunan";
        Program.tipe = t === "bulanan" ? "bulanan" : "tahunan";
        // Segarkan hak kendali (biar perubahan akses langsung berlaku)
        try { await OsisAuth.refreshAkses(); } catch {}
        Program.terapkanAkses();

        // Muat daftar sekbid
        try {
            Program.sekbidList = (await getSekbid()) || [];
            const fs = document.getElementById("filterSekbid");
            if (fs) {
                fs.innerHTML = `<option value="">Semua sekbid</option>` +
                    Program.sekbidList.map(s => `<option value="${s.id}">${escapeHtml(s.nama)}</option>`).join("");
            }
        } catch {}

        document.getElementById("btnTambahProgram")?.addEventListener("click", () => Program.bukaForm());
        document.getElementById("btnBatalProgram")?.addEventListener("click", () => Program.tutupForm());
        document.getElementById("btnSimpanProgram")?.addEventListener("click", () => Program.simpan());
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Program.resetFilter());
        document.getElementById("btnEditDariDetail")?.addEventListener("click", () => {
            const id = Program.detailId;
            Program.tutupDetail();
            if (id) Program.edit(id);
        });
        document.getElementById("btnHapusDariDetail")?.addEventListener("click", () => {
            const id = Program.detailId;
            if (id) Program.hapus(id, true);
        });

        ["filterQ", "filterSekbid", "filterStatus"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Program.bacaFilter());
        });
        document.getElementById("progProgress")?.addEventListener("input", () => Program.renderProgressEdit());

        ["programForm", "programDetail"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "programForm") Program.tutupForm();
                    else Program.tutupDetail();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("programForm")?.classList.contains("open")) Program.tutupForm();
            if (document.getElementById("programDetail")?.classList.contains("open")) Program.tutupDetail();
        });

        await Program.muat();
    },

    // ============ HAK AKSES ============
    bisaGlobal() {
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        if (!a) return false;
        if (a.super) return true;
        const list = Array.isArray(a.halaman) ? a.halaman : [];
        return list.includes("program") || list.includes("*");
    },

    sekbidSaya() {
        const a = (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) ? OsisAuth.getAkses() : null;
        if (!a || !a.sekbid_id) return null;
        return parseInt(a.sekbid_id, 10) || null;
    },

    bisaKendali(sekbidId) {
        if (Program.bisaGlobal()) return true;
        const saya = Program.sekbidSaya();
        if (!saya || !sekbidId) return false;
        return String(saya) === String(sekbidId);
    },

    bolehTambah() {
        return Program.bisaGlobal() || !!Program.sekbidSaya();
    },

    namaSekbid(id) {
        const s = (Program.sekbidList || []).find(x => String(x.id) === String(id));
        return s ? s.nama : (id ? "Sekbid #" + id : "-");
    },

    isiOpsiSekbid(terpilih) {
        const sel = document.getElementById("progSekbid");
        if (!sel) return;
        const global = Program.bisaGlobal();
        const saya = Program.sekbidSaya();
        const field = sel.closest ? sel.closest(".field") : null;
        if (field) field.style.display = global ? "" : "none";
        sel.disabled = !global;
        if (!global && saya) {
            sel.innerHTML = `<option value="${saya}">${escapeHtml(Program.namaSekbid(saya))}</option>`;
            sel.value = String(saya);
            return;
        }
        const list = Program.sekbidList || [];
        sel.innerHTML = `<option value="">— Pilih Sekbid —</option>` +
            list.map(s => `<option value="${s.id}">${escapeHtml(s.nama)} (${s.kategori})</option>`).join("");
        if (terpilih) sel.value = String(terpilih);
        else if (Program.filter.sekbid) sel.value = String(Program.filter.sekbid);
        else if (list[0]) sel.value = String(list[0].id);
    },

    terapkanAkses() {
        const boleh = Program.bolehTambah();
        const btn = document.getElementById("btnTambahProgram");
        if (btn) btn.style.display = boleh ? "" : "none";
    },

    // ============ DATA ============
    async muat() {
        const listEl = document.getElementById("programList");
        if (listEl) listEl.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat program...</div>`;
        try {
            const cached = Cache.get("program");
            if (cached) {
                Program.cache = cached;
                Program.render();
                getProgram().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("program", fresh);
                        Program.cache = fresh || [];
                        Program.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getProgram();
            Cache.set("program", data);
            Program.cache = data || [];
            Program.render();
        } catch (err) {
            console.error(err);
            if (listEl) listEl.innerHTML = `<div class="pesan-empty">Gagal memuat program.</div>`;
        }
    },

    bacaFilter() {
        Program.filter = {
            q: document.getElementById("filterQ").value || "",
            sekbid: document.getElementById("filterSekbid").value || "",
            status: document.getElementById("filterStatus").value || ""
        };
        Program.render();
    },

    resetFilter() {
        ["filterQ", "filterSekbid", "filterStatus"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        Program.bacaFilter();
    },

    dataTampil() {
        const f = Program.filter;
        const q = f.q.trim().toLowerCase();
        return (Program.cache || []).filter(p => {
            if ((p.tipe || "tahunan") !== Program.tipe) return false;
            if (f.sekbid && String(p.sekbid_id || "") !== String(f.sekbid)) return false;
            if (f.status && (p.status || "") !== f.status) return false;
            if (q) {
                const sekbidNama = Program.namaSekbid(p.sekbid_id);
                if (!(`${p.nama || ""} ${p.deskripsi || ""} ${sekbidNama} ${p.pj || ""}`.toLowerCase().includes(q))) {
                    return false;
                }
            }
            return true;
        });
    },

    // ============ HELPERS ============
    fmtTanggal(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return "-"; }
    },

    rentang(p) {
        if (!p.tgl_mulai && !p.tgl_selesai) return "";
        if (p.tgl_mulai && p.tgl_selesai) return `${Program.fmtTanggal(p.tgl_mulai)} – ${Program.fmtTanggal(p.tgl_selesai)}`;
        return Program.fmtTanggal(p.tgl_mulai || p.tgl_selesai);
    },

    labelBulan(key) {
        if (!key) return "Tanpa tanggal";
        try {
            const [y, m] = key.split("-").map(Number);
            const nama = new Date(y, m - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
            return nama.charAt(0).toUpperCase() + nama.slice(1);
        } catch { return key; }
    },

    bar(prog) {
        const v = Math.max(0, Math.min(100, parseInt(prog, 10) || 0));
        return `<div class="prog-bar"><span style="width:${v}%"></span></div>`;
    },

    // ============ RENDER ============
    render() {
        const listEl = document.getElementById("programList");
        if (!listEl) return;
        const data = Program.dataTampil();
        const semua = (Program.cache || []).filter(p => (p.tipe || "tahunan") === Program.tipe);

        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("statTotal", String(semua.length));
        set("statBerjalan", String(semua.filter(p => p.status === "berjalan").length));
        set("statSelesai", String(semua.filter(p => p.status === "selesai").length));
        set("statRencana", String(semua.filter(p => p.status === "rencana").length));

        if (!data.length) {
            const lagiCari = Program.filter.q || Program.filter.sekbid || Program.filter.status;
            listEl.innerHTML = `<div class="pesan-empty" style="background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:28px 16px; text-align:center">`
                + `<div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-calendar-days" style="color:var(--red)"></i></div>`
                + (lagiCari
                    ? `<b>Tidak ada yang cocok</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Coba ubah kata kunci atau filter.</p>`
                    : `<b>Belum ada program ${Program.tipe}</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Tambahkan ${Program.tipe === "bulanan" ? "kegiatan operasional bulan ini" : "rencana besar tahun ini"}.</p>`
                        + (Program.bolehTambah() ? `<button class="btn btn-red btn-sm" onclick="Program.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Program</button>` : ""))
                + `</div>`;
            return;
        }

        if (Program.tipe === "bulanan") {
            // Kelompokkan per bulan mulai (terbaru dulu)
            const grup = {};
            data.forEach(p => {
                const k = (p.tgl_mulai || "").slice(0, 7);
                (grup[k] = grup[k] || []).push(p);
            });
            const kunci = Object.keys(grup).sort((a, b) => {
                if (!a) return 1;
                if (!b) return -1;
                return b.localeCompare(a);
            });
            listEl.innerHTML = kunci.map(k => `
                <div class="prog-grup">
                    <div class="prog-grup-head">
                        <h3>${escapeHtml(Program.labelBulan(k))}</h3>
                        <span class="prog-grup-count">${grup[k].length} program</span>
                    </div>
                    <div class="prog-grid">${grup[k].map(p => Program.kartu(p)).join("")}</div>
                </div>`).join("");
        } else {
            // Tahunan: urut tanggal mulai terdekat dulu
            const urut = [...data].sort((a, b) => {
                if (!a.tgl_mulai && !b.tgl_mulai) return 0;
                if (!a.tgl_mulai) return 1;
                if (!b.tgl_mulai) return -1;
                return String(a.tgl_mulai).localeCompare(String(b.tgl_mulai));
            });
            listEl.innerHTML = `<div class="prog-grid">${urut.map(p => Program.kartu(p)).join("")}</div>`;
        }
    },

    kartu(p) {
        const prog = Math.max(0, Math.min(100, parseInt(p.progress, 10) || 0));
        const boleh = Program.bisaKendali(p.sekbid_id);
        return `
            <div class="prog-item">
                <div class="prog-ico ${Program.tipe}"><i class="fa-solid fa-${Program.tipe === "bulanan" ? "calendar-days" : "calendar"}"></i></div>
                <div class="prog-body">
                    <h4>${escapeHtml(p.nama || "Tanpa nama")}</h4>
                    <div class="prog-meta"><b>${escapeHtml(Program.namaSekbid(p.sekbid_id))}</b> · ${escapeHtml(p.pj ? "PIC " + p.pj : "-")} ${olehLabel(p)}</div>
                    <div class="prog-meta">${escapeHtml(Program.rentang(p))}</div>
                    ${Program.bar(prog)}
                    <div class="prog-actions">
                        <span class="prog-tag ${p.status}">${Program.STATUS_LABEL[p.status] || p.status || "-"}</span>
                        <button class="btn btn-white btn-sm" onclick="Program.detail(${p.id})"><i class="fa-solid fa-eye"></i> Detail</button>
                        ${boleh ? `<button class="btn btn-white btn-sm" onclick="Program.edit(${p.id})"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-red btn-sm" onclick="Program.hapus(${p.id})"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                    </div>
                </div>
            </div>`;
    },

    // ============ FORM ============
    bukaForm() {
        if (!Program.bolehTambah()) {
            showToast("Anda tidak memiliki akses ke sekbid manapun", "error");
            return;
        }
        Program.editingId = null;
        document.getElementById("progId").value = "";
        document.getElementById("programFormTitle").textContent = "Tambah Program";
        document.getElementById("progNama").value = "";
        document.getElementById("progDeskripsi").value = "";
        Program.isiOpsiSekbid();
        document.getElementById("progPJ").value = "";
        const t = new Date();
        const hariIni = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
        document.getElementById("progMulai").value = hariIni;
        document.getElementById("progSelesai").value = "";
        document.getElementById("progLokasi").value = "";
        document.getElementById("progTarget").value = "";
        document.getElementById("progStatus").value = "rencana";
        document.getElementById("progProgress").value = "0";
        Program.renderProgressEdit();
        document.getElementById("progCatatan").value = "";
        document.getElementById("programForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("progNama")?.focus(), 80);
    },

    edit(id) {
        const item = Program.cache.find(p => String(p.id) === String(id));
        if (!item) return;
        if (!Program.bisaKendali(item.sekbid_id)) {
            showToast("Hanya bisa mengedit program dari sekbid Anda", "error");
            return;
        }
        Program.editingId = id;
        document.getElementById("progId").value = id;
        document.getElementById("programFormTitle").textContent = "Edit Program";
        document.getElementById("progNama").value = item.nama || "";
        document.getElementById("progDeskripsi").value = item.deskripsi || "";
        Program.isiOpsiSekbid(item.sekbid_id);
        document.getElementById("progPJ").value = item.pj || "";
        document.getElementById("progMulai").value = item.tgl_mulai || "";
        document.getElementById("progSelesai").value = item.tgl_selesai || "";
        document.getElementById("progLokasi").value = item.lokasi || "";
        document.getElementById("progTarget").value = item.target_peserta || "";
        document.getElementById("progStatus").value = item.status || "rencana";
        document.getElementById("progProgress").value = item.progress ?? "0";
        Program.renderProgressEdit();
        document.getElementById("progCatatan").value = item.catatan || "";
        document.getElementById("programForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupForm() {
        document.getElementById("programForm")?.classList.remove("open");
        document.body.style.overflow = "";
        Program.editingId = null;
    },

    renderProgressEdit() {
        const inp = document.getElementById("progProgress");
        const lbl = document.getElementById("progProgressLbl");
        if (lbl) lbl.textContent = `${parseInt(inp && inp.value, 10) || 0}%`;
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (!Program.bolehTambah()) { showToast("Tidak ada hak akses", "error"); return; }

        let sekbid_id = null;
        if (Program.bisaGlobal()) {
            const v = document.getElementById("progSekbid")?.value;
            sekbid_id = v ? parseInt(v, 10) : null;
        } else {
            sekbid_id = Program.sekbidSaya();
        }

        const nama = document.getElementById("progNama").value.trim();
        const deskripsi = document.getElementById("progDeskripsi").value.trim();
        const pj = document.getElementById("progPJ").value.trim();
        const tgl_mulai = document.getElementById("progMulai").value || null;
        const tgl_selesai = document.getElementById("progSelesai").value || null;
        const lokasi = document.getElementById("progLokasi").value.trim();
        const target = document.getElementById("progTarget").value.trim();
        const status = document.getElementById("progStatus").value || "rencana";
        let progress = parseInt(document.getElementById("progProgress").value, 10);
        if (!Number.isFinite(progress)) progress = 0;
        const catatan = document.getElementById("progCatatan").value.trim();
        const id = Program.editingId;

        if (!nama) { showToast("Nama program wajib diisi", "error"); return; }
        if (!sekbid_id) { showToast("Sekbid wajib dipilih", "error"); return; }
        if (!pj) { showToast("PIC wajib diisi", "error"); return; }
        if (!tgl_mulai) { showToast("Tanggal mulai wajib diisi", "error"); return; }

        const btn = document.getElementById("btnSimpanProgram");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            const f = {
                sekbid_id, tipe: Program.tipe, nama, deskripsi, pj,
                tgl_mulai, tgl_selesai, lokasi, target_peserta: target,
                status, progress, catatan
            };
            if (id) {
                await updateProgram(u.id, id, f);
                showToast("Program diperbarui!", "success");
            } else {
                const newId = await buatProgram(u.id, f);
                if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
                showToast("Program ditambah!", "success");
            }
            Program.tutupForm();
            await Program.muat();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
        }
    },

    async hapus(id, dariDetail) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Program.cache.find(p => String(p.id) === String(id));
        if (!item) return;
        if (!Program.bisaKendali(item.sekbid_id)) {
            showToast("Hanya bisa menghapus program dari sekbid Anda", "error");
            return;
        }
        const yakin = await showPopup(`Hapus program "${item.nama}"?`, "confirm");
        if (!yakin) return;
        try {
            await hapusProgram(u.id, id);
            if (dariDetail) Program.tutupDetail();
            showToast("Program dihapus", "success");
            await Program.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    // ============ DETAIL ============
    detail(id) {
        const p = Program.cache.find(x => String(x.id) === String(id));
        if (!p) return;
        Program.detailId = id;
        const prog = Math.max(0, Math.min(100, parseInt(p.progress, 10) || 0));
        const boleh = Program.bisaKendali(p.sekbid_id);
        const info = (k, v) => `<div><div class="k">${k}</div><div class="v">${v || "-"}</div></div>`;
        document.getElementById("programDetailBody").innerHTML = `
            <h4 style="font-size:1rem; font-weight:900; overflow-wrap:anywhere"><i class="fa-solid fa-${Program.tipe === "bulanan" ? "calendar-days" : "calendar"}" style="color:var(--red); margin-right:6px"></i>${escapeHtml(p.nama || "Tanpa nama")}</h4>
            <div class="prog-bar big"><span style="width:${prog}%"></span></div>
            <div class="prog-persen">${prog}% selesai · ${Program.STATUS_LABEL[p.status] || p.status || "-"}</div>
            <div class="detail-info">
                ${info("Sekbid", escapeHtml(Program.namaSekbid(p.sekbid_id)))}
                ${info("PIC", escapeHtml(p.pj || "-"))}
                ${info("Tanggal", escapeHtml(Program.rentang(p) || "-"))}
                ${info("Lokasi", escapeHtml(p.lokasi || "-"))}
                ${info("Target", escapeHtml(p.target_peserta || "-"))}
                ${info("Tipe", Program.tipe === "bulanan" ? "Bulanan" : "Tahunan")}
                ${info("Diupload oleh", escapeHtml(p.pengunggah || "-"))}
            </div>
            ${p.deskripsi ? `<div class="detail-text">${escapeHtml(p.deskripsi)}</div>` : ""}
            ${p.catatan ? `<div class="detail-text" style="margin-top:8px"><b>Catatan:</b> ${escapeHtml(p.catatan)}</div>` : ""}`;
        document.getElementById("btnEditDariDetail").style.display = boleh ? "" : "none";
        document.getElementById("btnHapusDariDetail").style.display = boleh ? "" : "none";
        document.getElementById("programDetail").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupDetail() {
        document.getElementById("programDetail")?.classList.remove("open");
        if (!document.getElementById("programForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        Program.detailId = null;
    }
};

document.addEventListener("DOMContentLoaded", () => Program.init());
