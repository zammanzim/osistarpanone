// =========================================================================
// INFORMASI HARIAN — pengganti broadcast grup (/osis/informasi)
// Card shareable via ?id= (tombol Salin Link). Kelola butuh hak "informasi".
// Wajib login OSIS (internal pengurus).
// =========================================================================

const Informasi = {
    cache: [],
    terinisialisasi: false,
    editingId: null,

    init() {
        if (Informasi.terinisialisasi) return;
        Informasi.terinisialisasi = true;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        if (typeof OsisAuth.refreshAkses === "function") {
            OsisAuth.refreshAkses().then(() => { Informasi.cekLogin(); Informasi.muat(); }).catch(() => {});
        }
        Informasi.cekLogin();
        Informasi.muat();
    },

    bolehKelola() {
        return !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("informasi"));
    },

    cekLogin() {
        const btn = document.getElementById("btnTambahInfo");
        if (btn) btn.style.display = Informasi.bolehKelola() ? "" : "none";
    },

    idDariUrl() {
        try {
            const v = new URLSearchParams(location.search).get("id");
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch { return null; }
    },

    linkUntuk(id) {
        return location.origin + location.pathname + "?id=" + id;
    },

    fmtTerbit(iso) {
        try {
            const d = new Date(iso);
            const tgl = d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
            const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(":", ".");
            return `${tgl} pukul ${jam}`;
        } catch { return ""; }
    },

    // ============ MUAT: single card (?id=) atau daftar ============
    async muat() {
        const id = Informasi.idDariUrl();
        if (id) { await Informasi.muatSatu(id); return; }
        await Informasi.muatDaftar();
    },

    async muatSatu(id) {
        const wrap = document.getElementById("infoWrap");
        if (!wrap) return;
        const kunci = "informasi-" + id;
        const cached = Cache.get(kunci);
        if (cached) {
            Informasi.tampilSatu(cached);
            getInformasi(id).then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    if (fresh) Cache.set(kunci, fresh);
                    Informasi.tampilSatu(fresh);
                }
            }).catch(() => {});
            return;
        }
        wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat informasi...</div>`;
        try {
            const item = await getInformasi(id);
            if (item) Cache.set(kunci, item);
            Informasi.tampilSatu(item);
        } catch (err) {
            console.error(err);
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat. Cek koneksi.</div>`;
        }
    },

    tampilSatu(item) {
        const wrap = document.getElementById("infoWrap");
        if (!wrap) return;
        document.getElementById("btnTambahInfo")?.style.setProperty("display", "none");
        if (!item) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-circle-info"></i> Informasi tidak ditemukan (mungkin sudah dihapus).</div>
                <div style="text-align:center;margin-top:12px"><a class="btn btn-white btn-sm" href="informasi"><i class="fa-solid fa-list"></i> Lihat daftar informasi</a></div>`;
            return;
        }
        try { document.title = item.judul + " — Informasi OSIS TARPAN ONE"; } catch {}
        const kelola = Informasi.bolehKelola();
        wrap.innerHTML = `
            <article class="info-card">
                <div class="info-top">
                    <span class="info-kicker"><i class="fa-solid fa-thumbtack"></i> PENGUMUMAN KEGIATAN</span>
                    <span class="info-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                </div>
                <h1 class="info-judul">${escapeHtml(item.judul || "Informasi")}</h1>
                ${item.subjudul ? `<div class="info-sub">(${escapeHtml(item.subjudul)})</div>` : ""}
                ${item.kepada ? `<div class="info-kepada"><span class="ik-ico"><i class="fa-solid fa-people-group"></i></span><span>Kepada: <b>${escapeHtml(item.kepada)}</b></span></div>` : ""}
                ${item.pembuka ? `<p class="info-text">${escapeHtml(item.pembuka)}</p>` : ""}
                ${(item.tanggal || item.jam || item.tempat || item.bawaan) ? `
                <div class="info-grid">
                    ${item.tanggal ? `<div class="ig-cell"><span class="ig-ico ig-blue"><i class="fa-solid fa-calendar-days"></i></span><span class="ig-lbl">Tanggal</span><b>${escapeHtml(item.tanggal)}</b></div>` : ""}
                    ${item.jam ? `<div class="ig-cell"><span class="ig-ico ig-pink"><i class="fa-regular fa-clock"></i></span><span class="ig-lbl">Waktu</span><b>${escapeHtml(item.jam)}</b></div>` : ""}
                    ${item.tempat ? `<div class="ig-cell"><span class="ig-ico ig-green"><i class="fa-solid fa-location-dot"></i></span><span class="ig-lbl">Tempat</span><b>${escapeHtml(item.tempat)}</b></div>` : ""}
                    ${item.bawaan ? `<div class="ig-cell"><span class="ig-ico ig-orange"><i class="fa-solid fa-triangle-exclamation"></i></span><span class="ig-lbl">Persiapan</span><b>${escapeHtml(item.bawaan)}</b></div>` : ""}
                </div>` : ""}
                ${item.penutup ? `<p class="info-text">${escapeHtml(item.penutup)}</p>` : ""}
                <div class="info-foot">
                    <span class="info-ava"><i class="fa-solid fa-user"></i></span>
                    <span class="info-terbit">Diterbitkan ${escapeHtml(Informasi.fmtTerbit(item.created_at))}${olehLabel(item)}<br>OSIS TARPAN ONE</span>
                    <div class="info-actions">
                        <button class="btn btn-red btn-sm" onclick="Informasi.salinLink(${item.id})"><i class="fa-solid fa-link"></i> Salin Link</button>
                        <button class="btn btn-white btn-sm" onclick="Informasi.bagiWA(${item.id})"><i class="fa-brands fa-whatsapp"></i> Bagikan WA</button>
                        ${kelola ? `<button class="btn btn-white btn-sm" onclick="Informasi.bukaForm(${item.id})"><i class="fa-solid fa-pen"></i> Ubah</button>` : ""}
                        ${kelola ? `<button class="btn btn-white btn-sm" onclick="Informasi.hapus(${item.id})"><i class="fa-solid fa-trash-can"></i> Hapus</button>` : ""}
                    </div>
                </div>
            </article>
            <div style="text-align:center;margin-top:12px"><a class="btn btn-white btn-sm" href="informasi"><i class="fa-solid fa-list"></i> Daftar informasi</a></div>`;
    },

    async muatDaftar() {
        const wrap = document.getElementById("infoWrap");
        if (!wrap) return;
        const cached = Cache.get("informasi");
        if (cached) {
            Informasi.cache = cached || [];
            try { Informasi.tampilDaftar(); } catch {}
            getInformasiList().then(fresh => {
                Cache.set("informasi", fresh);
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Informasi.cache = fresh || [];
                    Informasi.tampilDaftar();
                }
            }).catch(() => {});
            return;
        }
        wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat informasi...</div>`;
        try {
            const data = await getInformasiList();
            Cache.set("informasi", data);
            Informasi.cache = data || [];
            Informasi.tampilDaftar();
        } catch (err) {
            console.error(err);
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat. Cek koneksi.</div>`;
        }
    },

    tampilDaftar() {
        const wrap = document.getElementById("infoWrap");
        if (!wrap) return;
        const data = Informasi.cache || [];
        const kelola = Informasi.bolehKelola();
        if (!data.length) {
            wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-bullhorn"></i> Belum ada informasi harian.</div>`;
            return;
        }
        wrap.innerHTML = data.map(it => `
            <div class="info-row">
                <a class="info-row-main" href="informasi?id=${it.id}">
                    <span class="info-row-pin"><i class="fa-solid fa-thumbtack"></i></span>
                    <span style="min-width:0">
                        <span class="info-row-judul">${escapeHtml(it.judul || "Tanpa judul")}</span>
                        <span class="info-row-sub">${it.tanggal ? escapeHtml(it.tanggal) + " · " : ""}${escapeHtml(Informasi.fmtTerbit(it.created_at))} ${olehLabel(it)}</span>
                    </span>
                    <i class="fa-solid fa-chevron-right chev"></i>
                </a>
                <div class="info-row-ops">
                    <button class="btn btn-white btn-sm" onclick="Informasi.salinLink(${it.id})" title="Salin link share"><i class="fa-solid fa-link"></i></button>
                    ${kelola ? `<button class="btn btn-white btn-sm" onclick="Informasi.bukaForm(${it.id})" title="Ubah"><i class="fa-solid fa-pen"></i></button>` : ""}
                    ${kelola ? `<button class="btn btn-white btn-sm" onclick="Informasi.hapus(${it.id})" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                </div>
            </div>`).join("");
    },

    // ============ SALIN LINK / BAGI WA ============
    async salinLink(id) {
        const link = Informasi.linkUntuk(id);
        try {
            await navigator.clipboard.writeText(link);
            showToast("Link tersalin, tinggal tempel di grup!", "success");
        } catch {
            const ta = document.createElement("textarea");
            ta.value = link;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); showToast("Link tersalin!", "success"); }
            catch { showPopup(link, "info"); }
            ta.remove();
        }
    },

    bagiWA(id) {
        const item = (Informasi.cache || []).find(x => String(x.id) === String(id));
        const judul = item && item.judul ? item.judul : "Informasi OSIS";
        const teks = encodeURIComponent(`📌 [ ${judul} ]\n${Informasi.linkUntuk(id)}`);
        window.open("https://wa.me/?text=" + teks, "_blank", "noopener");
    },

    // ============ FORM (buat/ubah) ============
    bukaForm(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (!OsisAuth.butuh("informasi")) return;
        const item = id ? (Informasi.cache || []).find(x => String(x.id) === String(id)) : null;
        Informasi.editingId = item ? item.id : null;
        const v = (k) => escapeHtml(item ? (item[k] || "") : "");
        document.getElementById("infoFormOverlay")?.remove();
        const overlay = document.createElement("div");
        overlay.id = "infoFormOverlay";
        overlay.className = "prestasi-form-overlay";
        overlay.innerHTML = `
            <div class="prestasi-form-box info-form-box">
                <div class="form-head" style="display:flex;align-items:center;justify-content:space-between">
                    <span><i class="fa-solid fa-bullhorn"></i> ${item ? "Ubah" : "Buat"} Informasi</span>
                    <button class="icon-btn" onclick="Informasi.tutupForm()" title="Tutup"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="field"><label>Judul *</label>
                    <input type="text" id="infoJudul" class="admin-input" placeholder="cth: Kumpulan Rutin" maxlength="80" value="${v("judul")}">
                </div>
                <div class="field"><label>Subjudul (kecil di bawah judul)</label>
                    <input type="text" id="infoSubjudul" class="admin-input" placeholder="cth: Di dalam ruangan" maxlength="80" value="${v("subjudul")}">
                </div>
                <div class="field"><label>Kepada</label>
                    <input type="text" id="infoKepada" class="admin-input" placeholder="cth: seluruh pengurus OSIS Jilid 4" maxlength="200" value="${v("kepada")}">
                </div>
                <div class="field"><label>Isi pembuka</label>
                    <textarea id="infoPembuka" class="admin-input admin-textarea" rows="3" maxlength="2000" placeholder="cth: Selamat sore akang/teteh, izin menginformasikan...">${v("pembuka")}</textarea>
                </div>
                <div class="info-form-grid">
                    <div class="field"><label>📅 Tanggal kegiatan</label>
                        <input type="text" id="infoTanggal" class="admin-input" placeholder="cth: Rabu, 23 September 2026" maxlength="80" value="${v("tanggal")}">
                    </div>
                    <div class="field"><label>⏰ Jam</label>
                        <input type="text" id="infoJam" class="admin-input" placeholder="cth: 15.00 WIB s.d Selesai" maxlength="80" value="${v("jam")}">
                    </div>
                </div>
                <div class="field"><label>📍 Tempat</label>
                    <input type="text" id="infoTempat" class="admin-input" placeholder="cth: SMK Taruna Harapan 1 Cipatat" maxlength="200" value="${v("tempat")}">
                </div>
                <div class="field"><label>⚠️ Yang dibawa</label>
                    <input type="text" id="infoBawaan" class="admin-input" placeholder="cth: Buku catatan OSIS" maxlength="200" value="${v("bawaan")}">
                </div>
                <div class="field"><label>Isi penutup</label>
                    <textarea id="infoPenutup" class="admin-input admin-textarea" rows="3" maxlength="2000" placeholder="cth: Maka dari itu, dimohon untuk meluangkan waktunya...">${v("penutup")}</textarea>
                </div>
                <div class="form-actions-row" style="margin-top:14px">
                    <button class="btn btn-white" onclick="Informasi.tutupForm()">Batal</button>
                    <button class="btn btn-red" id="btnSimpanInfo" onclick="Informasi.simpanForm()"><i class="fa-solid fa-check"></i> Simpan</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("active")));
        document.body.style.overflow = "hidden";
        overlay.addEventListener("click", (e) => { if (e.target === overlay) Informasi.tutupForm(); });
    },

    tutupForm() {
        document.getElementById("infoFormOverlay")?.classList.remove("active");
        setTimeout(() => document.getElementById("infoFormOverlay")?.remove(), 220);
        document.body.style.overflow = "";
        Informasi.editingId = null;
    },

    bacaForm() {
        const g = (id) => document.getElementById(id)?.value.trim() || "";
        return {
            judul: g("infoJudul"),
            subjudul: g("infoSubjudul"),
            kepada: g("infoKepada"),
            pembuka: g("infoPembuka"),
            tanggal: g("infoTanggal"),
            jam: g("infoJam"),
            tempat: g("infoTempat"),
            bawaan: g("infoBawaan"),
            penutup: g("infoPenutup"),
        };
    },

    async simpanForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") { showPopup("Cuma OSIS", "error"); return; }
        if (!OsisAuth.butuh("informasi")) return;
        const f = Informasi.bacaForm();
        if (!f.judul) { showToast("Judul diisi dulu", "error"); return; }
        const btn = document.getElementById("btnSimpanInfo");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            if (Informasi.editingId) {
                const eid = Informasi.editingId;
                await updateInformasi(u.id, eid, f);
                showToast("Informasi diperbarui!", "success");
                Informasi.tutupForm();
                Cache.del("informasi");
                Cache.del("informasi-" + eid);
                await Informasi.muat();
                return;
            }
            const newId = await buatInformasi(u.id, f);
            if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
            showToast("Informasi terbit! Link siap dibagikan.", "success");
            Informasi.tutupForm();
            Cache.del("informasi");
            location.replace("informasi?id=" + newId);
            return;
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_NO_AUTH" || String(err.message).includes("-1")) {
                showPopup("Kamu tidak punya hak kelola informasi.", "error");
            } else {
                showToast("Gagal simpan: " + err.message, "error");
            }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("informasi")) return;
        const yakin = await showPopup("Hapus informasi ini? Link share-nya ikut mati.", "confirm");
        if (!yakin) return;
        try {
            await hapusInformasi(u.id, id);
            showToast("Informasi dihapus", "success");
            Cache.del("informasi");
            Cache.del("informasi-" + id);
            if (Informasi.idDariUrl()) location.replace("informasi");
            else await Informasi.muat();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },
};

document.addEventListener("DOMContentLoaded", () => Informasi.init());
