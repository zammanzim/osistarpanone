// =========================================================================
// HASIL WAWANCARA — halaman internal (osis/hasil-wawancara.html) + publik
// (hasil-wawancara.html).
// - ?n=<slug-nama>  -> langsung buka hasil calon (contoh: ?n=almira).
// - tanpa ?n        -> tampil semua calon sebagai pilihan.
// - Internal: semua calon OSIS bisa lihat; hanya hak "wawancara" yang bisa
//   mengisi hasil + toggle umumkan.
// - Publik: tanpa login, cuma baca hasil yang sudah diumumkan lewat RPC aman.
// =========================================================================

const HasilWawancara = {
    mode: "osis",
    calon: [],
    calonAktif: null,
    sesiMap: {},
    q: "",
    filter: "",
    nParam: "",
    opened: false,
    bolehEdit: false,
    _memuat: false,

    // Dari roster pengurus (tahun aktif): nama -> wa.
    pengurusList: [],
    // Semua roster (semua tahun) — cadangan kalau kakak asuh bukan pengurus
    // tahun aktif (mis. roster 2025), biar jabatan + WA tetap kebaca.
    pengurusSemua: [],

    // Template pesan hasil (site_content, bisa diedit dari halaman ini).
    // Placeholder: {tanggal}, {kakasuh}. Baris pertama tanpa indent.
    TPL_LANJUT: "Terimakasih atas partisipasi yang anda yang telah melaksanakan tes wawancara kesiapan yang dilaksanakan pada {tanggal}.\nDan hasil anda di nyatakan\nLANJUT\n\nSemoga hasil yang di dapat hari ini, bisa memicu motivasi kedepannya, dan tetap konsisten pada pendirian. Setelah ini silahkan hubungi kakak asuh terbaru kamu yaitu {kakasuh}.",
    TPL_GAGAL: "Terimakasih atas partisipasi yang anda yang telah melaksanakan tes wawancara kesiapan yang dilaksanakan pada {tanggal}.\nDan hasil anda di nyatakan\nGAGAL\n\nmohon maaf, anda tidak bisa melanjutkan di keorganisasian ini\n\nSemoga anda bisa lebih maju, dan termotivasi lagi di cabang extrakurikuler yang lain.",
    tpl: null,

    STATUS_LABEL: { belum: "Belum dimulai", berlangsung: "Sedang berlangsung", selesai: "Selesai" },

    init() {
        this.mode = document.body && document.body.dataset && document.body.dataset.mode === "publik"
            ? "publik" : "osis";
        this.bacaParams();
        if (this.mode === "osis") this.initOsis();
        else this.initPublik();
        // Klik di luar / ESC → tutup menu titik-tiga kartu.
        document.addEventListener("click", () => HasilWawancara.tutupMenu());
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") HasilWawancara.tutupMenu();
        });
        // Tombol back/forward → ikut pindah step (publik).
        window.addEventListener("popstate", () => {
            HasilWawancara.bacaParams();
            HasilWawancara.render();
        });
    },

    // Baca ?n=<slug> + &opened=true dari URL.
    bacaParams() {
        try {
            const p = new URLSearchParams(location.search);
            this.nParam = String(p.get("n") || "").trim();
            this.opened = p.get("opened") === "true";
        } catch {
            this.nParam = "";
            this.opened = false;
        }
    },

    async initOsis() {
        try {
            if (typeof OsisAuth !== "undefined" && OsisAuth.syncAuth) await OsisAuth.syncAuth();
        } catch {}
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        try {
            if (typeof OsisAuth.refreshAkses === "function") await OsisAuth.refreshAkses();
        } catch {}
        this.bolehEdit = !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("wawancara"));
        await this.muatData();
    },

    async initPublik() {
        this.bolehEdit = false;
        await this.muatData();
    },

    async muatData() {
        if (this._memuat) return;
        this._memuat = true;
        this.setLoading();
        try {
            if (this.mode === "publik") {
                this.calon = await getWawancaraHasilPublik();
                this.sesiMap = {};
            } else {
                const [calon, sesi] = await Promise.all([getWawancaraCalon(), getWawancaraSesi()]);
                this.calon = calon || [];
                this.sesiMap = {};
                (sesi || []).forEach(s => { this.sesiMap[String(s.calon_id)] = s; });
            }
            // Kontak kakak asuh dari roster pengurus tahun aktif (nama -> wa).
            try {
                const [periode, pengurus] = await Promise.all([getPeriode(), getPengurus()]);
                const aktif = (periode || []).filter(p => p.aktif).map(p => String(p.tahun));
                this.pengurusSemua = pengurus || [];
                this.pengurusList = (pengurus || []).filter(p => aktif.includes(String(p.tahun)));
            } catch { this.pengurusList = []; this.pengurusSemua = []; }
            // Template pesan hasil (fallback ke teks pembina kalau DB kosong).
            try {
                const sc = await getSiteContent();
                this.tpl = {
                    lanjut: this.ambilTpl(sc, "hasil_wawancara_tpl_lanjut", this.TPL_LANJUT),
                    gagal: this.ambilTpl(sc, "hasil_wawancara_tpl_gagal", this.TPL_GAGAL),
                };
            } catch {
                this.tpl = { lanjut: this.TPL_LANJUT, gagal: this.TPL_GAGAL };
            }
            this.render();
        } catch (err) {
            console.error(err);
            this.renderError(err);
        } finally {
            this._memuat = false;
        }
    },

    ambilTpl(rows, kunci, fallback) {
        const r = (rows || []).find(x => String(x.kunci) === kunci);
        const v = r && r.nilai ? String(r.nilai).trim() : "";
        return v || fallback;
    },

    setLoading() {
        const el = document.getElementById("hwContent");
        if (!el) return;
        el.innerHTML = `<div class="hw-empty"><div class="spinner" style="margin:0 auto 8px"></div>Memuat hasil wawancara...</div>`;
    },

    /* ================= RENDER ================= */
    render() {
        this.renderHero();
        const q = String(this.nParam || "").trim();
        if (!q) {
            this.renderDaftar();
            return;
        }
        const cocok = this.cari(q);
        if (!cocok.length) {
            this.renderTidakKetemu(q);
            return;
        }
        const skorTop = cocok[0].skor;
        const teratas = cocok.filter(x => x.skor === skorTop);
        if (teratas.length > 1) {
            this.renderPilihan(q, teratas.slice(0, 8));
            return;
        }
        const calon = teratas[0].calon;
        this.calonAktif = calon;
        // Halaman publik: 2 langkah. Tanpa &opened=true baru tampil identitas,
        // hasil-nya kebuka setelah tombol "Buka Hasil" diklik.
        if (this.mode === "publik" && !this.opened) {
            this.renderBuka(calon);
            return;
        }
        this.renderDetail(calon);
    },

    renderHero() {
        const hero = document.getElementById("hwHero");
        if (!hero) return;
        // Mode "?n=..&opened=true" → hero disembunyikan, layar fokus ke hasil.
        if (this.opened) {
            hero.style.display = "none";
            hero.innerHTML = "";
            return;
        }
        hero.style.display = "";
        const total = this.calon.length;
        const lolos = this.calon.filter(c => c.hasil === "lolos").length;
        const tidak = this.calon.filter(c => c.hasil === "tidak_lolos").length;
        const belum = Math.max(0, total - lolos - tidak);
        const umum = this.calon.filter(c => !!c.hasil_diumumkan).length;
        const pub = this.mode === "publik";
        const aksi = pub
            ? ""
            : `<a class="btn btn-white btn-sm" href="wawancara"><i class="fa-solid fa-comments"></i> Wawancara</a>`;

        // Internal + publik sama-sama pakai .osis-hero biar konsisten
        // dengan header halaman lain.
        hero.className = "osis-hero";
        hero.innerHTML = `
            <div class="osis-avatar"><i class="fa-solid fa-square-poll-vertical"></i></div>
            <div style="flex: 1; min-width: 180px">
                <h1>HASIL WAWANCARA</h1>
                <p>${pub
                    ? "Pengumuman hasil wawancara calon pengurus OSIS SMK Taruna Harapan 1 Cipatat."
                    : "Keputusan lolos/tidak lolos calon pengurus OSIS. Isi hasil dan atur publikasinya di sini."}</p>
                <div class="osis-meta">
                    <span class="hw-chip kuning"><i class="fa-solid fa-users"></i> <b>${total}</b> ${pub ? "hasil diumumkan" : "calon"}</span>
                    <span class="hw-chip hijau"><i class="fa-solid fa-circle-check"></i> <b>${lolos}</b> lanjut</span>
                    <span class="hw-chip merah"><i class="fa-solid fa-circle-xmark"></i> <b>${tidak}</b> gagal</span>
                    ${pub ? "" : `<span class="hw-chip"><i class="fa-solid fa-hourglass-half"></i> <b>${belum}</b> belum diputuskan</span>
                    <span class="hw-chip"><i class="fa-solid fa-bullhorn"></i> <b>${umum}</b> diumumkan</span>`}
                </div>
            </div>
            ${aksi || (!pub && this.bolehEdit) ? `<div class="hw-hero-act">
                ${aksi}
                ${!pub && this.bolehEdit
                    ? `<button class="icon-btn" title="Edit template pesan hasil" onclick="HasilWawancara.formTemplate()"><i class="fa-solid fa-file-pen"></i></button>`
                    : ""}
            </div>` : ""}`;
    },

    renderDaftar() {
        const el = document.getElementById("hwContent");
        if (!el) return;
        const pub = this.mode === "publik";
        // Publik tanpa filter hasil — biar surprise, hasil cuma kelihatan
        // saat buka detail calon. Filter lengkap cuma di internal.
        const opsi = `<option value="">Semua hasil</option>
           <option value="lolos">Lanjut</option>
           <option value="tidak_lolos">Gagal</option>
           <option value="belum">Belum diputuskan</option>
           <option value="diumumkan">Sudah diumumkan</option>`;
        el.innerHTML = `
            <div class="hw-toolbar">
                <div class="hw-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="hwCari" autocomplete="off" placeholder="Cari nama / kelas calon..."
                        value="${this.esc(this.q)}" oninput="HasilWawancara.setCari(this.value)">
                </div>
                ${pub ? "" : `<select class="admin-input" id="hwFilter" onchange="HasilWawancara.setFilter(this.value)">
                    ${opsi}
                </select>`}
            </div>
            <div id="hwList" class="hw-grid"></div>`;
        const sel = document.getElementById("hwFilter");
        if (sel) sel.value = this.filter;
        this.renderList();
    },

    renderList() {
        const list = document.getElementById("hwList");
        if (!list) return;
        const nq = this.norm(this.q);
        const rows = (this.calon || []).filter(c => {
            if (nq) {
                const teks = this.norm((c.nama || "") + " " + (c.kelas || ""));
                if (!teks.includes(nq)) return false;
            }
            const h = c.hasil || "belum";
            if (this.filter === "diumumkan") return !!c.hasil_diumumkan;
            if (this.filter && h !== this.filter) return false;
            return true;
        });
        // Publik sudah urut dari RPC (display_order, nama); internal urut lokal.
        if (this.mode !== "publik") {
            rows.sort((a, b) => {
                if ((a.display_order || 99) !== (b.display_order || 99)) {
                    return (a.display_order || 99) - (b.display_order || 99);
                }
                return String(a.nama || "").localeCompare(String(b.nama || ""));
            });
        }
        if (!rows.length) {
            list.innerHTML = `<div class="hw-empty"><i class="fa-solid fa-magnifying-glass"></i>${
                this.calon.length ? "Tidak ada calon yang cocok dengan pencarian/filter." :
                this.mode === "publik" ? "Belum ada hasil yang diumumkan." : "Belum ada calon di daftar wawancara."
            }</div>`;
            return;
        }
        list.innerHTML = rows.map(c => this.kartu(c)).join("");
    },

    kartu(c) {
        const h = c.hasil || "";
        const sesi = this.sesiMap[String(c.id)];
        const tgl = this.fmtTanggal(c.tanggal);
        // Kartu sengaja TIDAK menampilkan hasil/catatan — biar surprise,
        // hasil cuma kelihatan saat buka detail.
        return `<article class="hw-card">
            <div class="hw-card-top">
                <div class="hw-ava">${this.esc(this.inisial(c.nama))}</div>
                <div class="hw-card-info">
                    <b>${this.esc(c.nama || "-")}</b>
                    <span>${this.esc(c.kelas || "-")}${tgl ? " · " + this.esc(tgl) : ""}</span>
                </div>
            </div>
            ${this.mode === "osis" && this.bolehEdit ? `
            <div class="hw-kebab" onclick="event.stopPropagation()">
                <button class="kb-btn" onclick="HasilWawancara.toggleMenu(this)" title="Aksi" aria-label="Aksi"
                    ><i class="fa-solid fa-ellipsis-vertical"></i></button>
                <div class="kb-menu">
                    <button class="kb-item" onclick="HasilWawancara.formHasil(${c.id})"
                        ><i class="fa-solid fa-pen"></i> Edit hasil</button>
                </div>
            </div>` : ""}
            ${this.mode === "osis" && h && !c.hasil_diumumkan
                ? `<div class="hw-hint"><i class="fa-solid fa-eye-slash"></i> Sudah ada hasil, belum diumumkan.</div>`
                : ""}
            <div class="hw-card-foot">
                <a class="btn btn-red btn-sm" href="${this.urlCalon(c)}"><i class="fa-solid fa-eye"></i> Liat Hasil</a>
                ${this.mode === "osis" && sesi
                    ? `<a class="btn btn-white btn-sm" href="wawancara?calon=${c.id}"><i class="fa-solid fa-comments"></i> Wawancara</a>`
                    : ""}
            </div>
        </article>`;
    },

    // Step 1 halaman publik: identitas calon + tombol "Buka Hasil".
    // Pita warna tetap netral biar status hasilnya nggak kebocor.
    renderBuka(c) {
        const el = document.getElementById("hwContent");
        if (!el) return;
        const tgl = this.fmtTanggal(c.tanggal);
        el.innerHTML = `
            <div class="hw-detail-nav">
                <a class="btn btn-white btn-sm" href="hasil-wawancara">
                    <i class="fa-solid fa-arrow-left"></i> Semua hasil
                </a>
            </div>
            <section class="hw-detail hw-belum">
                <header class="hw-detail-head">
                    <div class="hw-ava hw-ava-lg">${this.esc(this.inisial(c.nama))}</div>
                    <div class="hw-detail-name">
                        <h1>${this.esc(c.nama || "-")}</h1>
                        <p>
                            <span class="hw-detail-kelas">${this.esc(c.kelas || "-")}</span>
                            ${tgl ? `<span><i class="fa-regular fa-calendar"></i> ${this.esc(tgl)}</span>` : ""}
                        </p>
                    </div>
                </header>
                <div class="hw-buka">
                    <div class="hw-buka-ikon"><i class="fa-solid fa-lock"></i></div>
                    <h2>Buka Hasil Kamu?</h2>
                    <p>Klik tombol di bawah buat lihat hasil wawancara kamu. Good luck yaa!</p>
                    <a class="btn btn-red" href="${this.urlBuka(c)}"
                        onclick="HasilWawancara.bukaHasil(event)">
                        <i class="fa-solid fa-unlock"></i> Buka Hasil
                    </a>
                </div>
            </section>`;
    },

    // Buka hasil: tambah &opened=true (tanpa reload).
    bukaHasil(e) {
        if (e && e.preventDefault) e.preventDefault();
        const a = e && e.currentTarget;
        const href = a ? a.getAttribute("href") : "";
        try { if (href) history.pushState({ hw: 1 }, "", href); } catch {}
        this.opened = true;
        this.render();
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    },

    // Tutup hasil: balik ke step 1 (?n=<slug> tanpa &opened).
    tutupHasil(e) {
        if (e && e.preventDefault) e.preventDefault();
        try { history.pushState({ hw: 1 }, "", this.urlCalon(this.calonAktif || {})); } catch {}
        this.opened = false;
        this.render();
    },

    renderDetail(c) {
        const el = document.getElementById("hwContent");
        if (!el) return;
        const h = c.hasil || "";
        const sesi = this.sesiMap[String(c.id)];
        const edit = this.mode === "osis" && this.bolehEdit;
        const tgl = this.fmtTanggal(c.tanggal);
        const update = this.fmtWaktu(c.hasil_updated_at);
        const cls = this.clsHasil(h);
        el.innerHTML = `
            <div class="hw-detail-nav">
                <a class="btn btn-white btn-sm" href="hasil-wawancara">
                    <i class="fa-solid fa-arrow-left"></i> Semua hasil
                </a>
                ${this.mode === "publik"
                    ? `<a class="btn btn-white btn-sm" href="${this.urlCalon(c)}"
                        onclick="HasilWawancara.tutupHasil(event)">
                        <i class="fa-solid fa-eye-slash"></i> Sembunyikan hasil
                    </a>`
                    : ""}
                ${this.mode === "osis" && sesi
                    ? `<a class="btn btn-white btn-sm" href="wawancara?calon=${c.id}"><i class="fa-solid fa-comments"></i> Buka wawancara</a>`
                    : ""}
            </div>
            <section class="hw-detail hw-${cls}">
                <header class="hw-detail-head">
                    <div class="hw-ava hw-ava-lg">${this.esc(this.inisial(c.nama))}</div>
                    <div class="hw-detail-name">
                        <h1>${this.esc(c.nama || "-")}</h1>
                        <p>
                            <span class="hw-detail-kelas">${this.esc(c.kelas || "-")}</span>
                            ${tgl ? `<span><i class="fa-regular fa-calendar"></i> ${this.esc(tgl)}</span>` : ""}
                        </p>
                    </div>
                </header>
                <div class="hw-surat-kop">
                    <i class="fa-solid fa-envelope-open-text"></i>
                    <span>Surat Keterangan Hasil Wawancara &middot; OSIS SMK Taruna Harapan 1 Cipatat</span>
                </div>
                <div class="hw-surat-body">${this.isiPesan(c, h)}</div>
                ${h === "lolos" ? this.panelKakakAsuh(c) : ""}
                <div class="hw-detail-meta">
                    ${this.mode === "osis"
                        ? `<span><i class="fa-solid ${c.hasil_diumumkan ? "fa-eye" : "fa-eye-slash"}"></i> ${c.hasil_diumumkan ? "Sudah diumumkan ke publik" : "Belum diumumkan ke publik"}</span>`
                        : ""}
                    ${update ? `<span><i class="fa-solid fa-clock-rotate-left"></i> Diperbarui ${this.esc(update)}</span>` : ""}
                    ${this.mode === "osis" && sesi
                        ? `<span><i class="fa-solid fa-clipboard-check"></i> Status wawancara: ${this.esc(this.STATUS_LABEL[sesi.status] || sesi.status || "-")}</span>`
                        : ""}
                </div>
                ${this.mode === "osis" && !edit
                    ? `<p class="hw-detail-note"><i class="fa-solid fa-lock"></i> Hanya pemegang hak <b>wawancara</b> yang bisa mengubah hasil ini.</p>`
                    : ""}
            </section>`;
    },

    // Panel kakak asuh (khusus hasil LANJUT) — kartu + tombol chat WA.
    panelKakakAsuh(c) {
        const daftar = this.kaDaftar(c);
        if (!daftar.length) return "";
        const kartu = daftar.map(nama => {
            const p = this.cariPengurus(nama);
            const jabatan = p && p.jabatan ? p.jabatan : "";
            return `<a class="hw-kakak-card" href="${this.waHref(c, nama)}" target="_blank" rel="noopener">
                <span class="hw-kakak-ava">${this.esc(this.inisial(nama))}</span>
                <span class="hw-kakak-info">
                    <b>${this.esc(nama)}</b>
                    ${jabatan ? `<small>${this.esc(jabatan)}</small>` : ""}
                </span>
                <span class="hw-kakak-cta"><i class="fa-brands fa-whatsapp"></i> Chat</span>
            </a>`;
        }).join("");
        return `<div class="hw-kakak-panel">
            <div class="hw-panel-title"><i class="fa-solid fa-user-group"></i> Kakak Asuh</div>
            <div class="hw-kakak-grid">${kartu}</div>
        </div>`;
    },

    renderPilihan(q, cocok) {
        const el = document.getElementById("hwContent");
        if (!el) return;
        el.innerHTML = `<div class="hw-pick">
            <h2>Pilih calon yang dimaksud</h2>
            <p>Ada beberapa nama yang cocok dengan <b>${this.esc(q)}</b>. Pilih salah satu:</p>
            <div class="hw-pick-list">${cocok.map(x => {
                const c = x.calon;
                return `<a class="hw-pick-item" href="${this.urlCalon(c)}">
                    <span class="hw-ava">${this.esc(this.inisial(c.nama))}</span>
                    <span>${this.esc(c.nama || "-")}<small>${this.esc(c.kelas || "-")}</small></span>
                </a>`;
            }).join("")}</div>
        </div>`;
    },

    renderTidakKetemu(q) {
        const el = document.getElementById("hwContent");
        if (!el) return;
        el.innerHTML = `<div class="hw-empty">
            <i class="fa-solid fa-user-slash"></i>
            ${this.mode === "publik"
                ? `Hasil untuk <b>${this.esc(q)}</b> belum diumumkan atau nama tidak ditemukan.`
                : `Calon dengan nama <b>${this.esc(q)}</b> tidak ditemukan.`}
            <div style="margin-top:12px">
                <a class="btn btn-white btn-sm" href="hasil-wawancara">
                    <i class="fa-solid fa-list"></i> Liat semua hasil
                </a>
            </div>
        </div>`;
    },

    renderError(err) {
        const el = document.getElementById("hwContent");
        if (!el) return;
        const migrasi = String((err && err.message) || "") === "BUTUH_MIGRASI_HASIL";
        el.innerHTML = `<div class="hw-empty">
            <i class="fa-solid fa-triangle-exclamation"></i>
            ${this.mode === "publik"
                ? "Hasil wawancara belum bisa dimuat. Coba refresh halaman ini."
                : (migrasi
                    ? "Fitur hasil wawancara belum aktif di database. Jalankan <b>db/migrasi-hasil-wawancara.sql</b> lewat SQL Editor, lalu refresh."
                    : "Gagal memuat hasil wawancara: " + this.esc((err && err.message) || err))}
            <div style="margin-top:12px">
                <button class="btn btn-white btn-sm" onclick="HasilWawancara.muatData()"><i class="fa-solid fa-rotate"></i> Coba lagi</button>
            </div>
        </div>`;
    },

    /* ================= TITIK TIGA + POPUP HASIL ================= */
    // Menu titik-tiga di kartu (kayak kartu agenda): buka → Edit hasil → popup.
    toggleMenu(btn) {
        const wrap = btn && btn.closest ? btn.closest(".hw-kebab") : null;
        if (!wrap) return;
        const lagiBuka = wrap.classList.contains("buka");
        this.tutupMenu();
        if (!lagiBuka) wrap.classList.add("buka");
    },
    tutupMenu() {
        document.querySelectorAll(".hw-kebab.buka").forEach(w => w.classList.remove("buka"));
    },

    /* ================= DAFTAR KAKAK ASUH ================= */
    // hasil_kakasuh disimpan sebagai JSON array nama.
    kaDaftar(c) {
        const raw = String((c && c.hasil_kakasuh) || "").trim();
        if (!raw) return [];
        try {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) return p.map(x => String(x).trim()).filter(Boolean);
        } catch {}
        return raw.split(",").map(x => x.trim()).filter(Boolean);
    },

    kaListHtml() {
        const list = this._kaList || [];
        if (!list.length) return `<p class="hw-ka-empty">Belum ada kakak asuh dipilih.</p>`;
        return list.map(nama => `<span class="hw-ka-item">${this.esc(nama)}
            <button type="button" class="hw-ka-x" title="Hapus" data-nama="${this.esc(nama)}"
                onclick="HasilWawancara.kaHapus(this)"><i class="fa-solid fa-xmark"></i></button></span>`).join("");
    },

    // Tambah kakak asuh dari dropdown (bisa berulang).
    kaTambah(v) {
        const nama = String(v || "").trim();
        if (!nama) return;
        this._kaList = this._kaList || [];
        if (!this._kaList.some(x => String(x).toLowerCase() === nama.toLowerCase())) {
            this._kaList.push(nama);
        }
        this.kaSync();
    },

    // Hapus lewat tombol X.
    kaHapus(btn) {
        const nama = btn && btn.getAttribute ? (btn.getAttribute("data-nama") || "") : "";
        this._kaList = (this._kaList || []).filter(x => x !== nama);
        this.kaSync();
    },

    // Sinkronkan tampilan + nilai yang dibaca popup saat ditutup.
    kaSync() {
        const list = document.getElementById("hwKaList");
        if (list) list.innerHTML = this.kaListHtml();
        const hid = document.getElementById("uniInput_kakasuh");
        if (hid) hid.value = JSON.stringify(this._kaList || []);
        const sel = document.getElementById("hwKaSelect");
        if (sel) sel.value = "";
    },

    // Edit hasil lewat popup bawaan (show-popup.js).
    async formHasil(calonId) {
        this.tutupMenu();
        if (this.mode !== "osis" || !this.bolehEdit) return;
        if (typeof OsisAuth !== "undefined" && OsisAuth.butuh && !OsisAuth.butuh("wawancara")) return;
        if (typeof showPopup !== "function") return;
        const c = (this.calon || []).find(x => String(x.id) === String(calonId));
        if (!c) return;
        // Kakak asuh bisa lebih dari satu: pilih dari dropdown, langsung muncul
        // dropdown baru di bawahnya, tiap pilihan ada tombol X buat hapus.
        this._kaList = this.kaDaftar(c);
        const htmlKa = `
            <input type="hidden" id="uniInput_kakasuh" value="${this.esc(JSON.stringify(this._kaList))}">
            <div class="hw-ka-list" id="hwKaList">${this.kaListHtml()}</div>
            <select class="uni-input" id="hwKaSelect" onchange="HasilWawancara.kaTambah(this.value)">
                <option value="">+ Tambah kakak asuh...</option>
                ${(this.pengurusList || []).filter(p => p.nama).map(p =>
                    `<option value="${this.esc(p.nama)}">${this.esc((p.nama || "?") + (p.jabatan ? " · " + p.jabatan : ""))}</option>`
                ).join("")}
            </select>`;
        const v = await showPopup(
            "Atur hasil " + (c.nama || "calon ini"),
            "form",
            {
                title: "Hasil wawancara",
                tall: true,
                fields: [{
                    name: "hasil", label: "Status hasil", type: "select", value: c.hasil || "",
                    options: [
                        { value: "", label: "Belum diputuskan" },
                        { value: "lolos", label: "LANJUT" },
                        { value: "tidak_lolos", label: "GAGAL" },
                    ],
                }, {
                    name: "kakasuh", label: "Kakak asuh baru (khusus hasil LANJUT)",
                    type: "custom", html: htmlKa,
                }, {
                    name: "umumkan", label: "Tampilkan di halaman publik?", type: "select",
                    value: c.hasil_diumumkan ? "1" : "0",
                    options: [
                        { value: "0", label: "Belum (private)" },
                        { value: "1", label: "Ya, umumkan" },
                    ],
                }],
            },
        );
        if (v === null || !v) return; // dibatalkan
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        if (!u || !u.id) return;
        const hasil = v.hasil || "";
        let daftarKa = [];
        try {
            const p = JSON.parse(String(v.kakasuh || "[]"));
            daftarKa = Array.isArray(p) ? p.map(x => String(x).trim()).filter(Boolean) : [];
        } catch {
            daftarKa = String(v.kakasuh || "").split(",").map(x => x.trim()).filter(Boolean);
        }
        const kakasuh = v.hasil === "lolos" ? JSON.stringify(daftarKa) : "";
        const diumumkan = v.umumkan === "1" && !!hasil;
        try {
            await wawancaraHasilSimpan(u.id, calonId, hasil, "", diumumkan, kakasuh);
            if (c) {
                c.hasil = hasil;
                c.hasil_kakasuh = kakasuh;
                c.hasil_diumumkan = diumumkan;
                c.hasil_updated_at = new Date().toISOString();
            }
            if (typeof showToast === "function") showToast("Hasil wawancara disimpan.", "success");
            this.render();
        } catch (err) {
            console.error(err);
            if (typeof showToast === "function") {
                showToast(String((err && err.message) || err) === "BUTUH_MIGRASI_HASIL"
                    ? "Migrasi hasil wawancara v2 belum dijalankan."
                    : "Gagal menyimpan: " + ((err && err.message) || err), "error");
            }
        }
    },

    // Edit template pesan hasil (LANJUT/GAGAL), disimpan di site_content.
    async formTemplate() {
        this.tutupMenu();
        if (this.mode !== "osis" || !this.bolehEdit) return;
        if (typeof OsisAuth !== "undefined" && OsisAuth.butuh && !OsisAuth.butuh("wawancara")) return;
        if (typeof showPopup !== "function") return;
        const t = this.tpl || { lanjut: this.TPL_LANJUT, gagal: this.TPL_GAGAL };
        const v = await showPopup("Template pesan hasil", "form", {
            title: "Template pesan hasil",
            tall: true,
            fields: [{
                name: "lanjut", label: "Pesan hasil LANJUT ({tanggal} & {kakasuh} = otomatis)",
                type: "textarea", value: t.lanjut, rows: 6,
            }, {
                name: "gagal", label: "Pesan hasil GAGAL ({tanggal} = otomatis)",
                type: "textarea", value: t.gagal, rows: 6,
            }],
        });
        if (v === null || !v) return;
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        if (!u || !u.id) return;
        try {
            await wawancaraTemplateSimpan(u.id, String(v.lanjut || ""), String(v.gagal || ""));
            this.tpl = {
                lanjut: (String(v.lanjut || "").trim() || this.TPL_LANJUT),
                gagal: (String(v.gagal || "").trim() || this.TPL_GAGAL),
            };
            if (typeof showToast === "function") showToast("Template pesan disimpan.", "success");
            this.render();
        } catch (err) {
            console.error(err);
            if (typeof showToast === "function") {
                showToast(String((err && err.message) || err) === "BUTUH_MIGRASI_HASIL"
                    ? "Migrasi hasil wawancara v2 belum dijalankan."
                    : "Gagal menyimpan template: " + ((err && err.message) || err), "error");
            }
        }
    },

    /* ================= EVENT ================= */
    setCari(v) {
        this.q = String(v || "");
        this.renderList();
    },

    setFilter(v) {
        this.filter = String(v || "");
        this.renderList();
    },

    /* ================= UTIL ================= */
    esc(teks) {
        if (typeof escapeHtml === "function") return escapeHtml(teks);
        return String(teks ?? "").replace(/[&<>"']/g, ch => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[ch]));
    },

    inisial(nama) {
        const t = String(nama || "?").trim();
        return (t.charAt(0) || "?").toUpperCase();
    },

    norm(teks) {
        return String(teks || "")
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    },

    slugNama(teks) {
        return this.norm(teks).replace(/\s+/g, "-");
    },

    jarak(a, b) {
        const s = String(a || ""), t = String(b || "");
        const m = s.length, n = t.length;
        if (!m) return n;
        if (!n) return m;
        let prev = new Array(n + 1);
        let curr = new Array(n + 1);
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            curr[0] = i;
            for (let j = 1; j <= n; j++) {
                const biaya = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
                curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + biaya);
            }
            const tmp = prev; prev = curr; curr = tmp;
        }
        return prev[n];
    },

    mirip(a, b) {
        const s = String(a || ""), t = String(b || "");
        const max = Math.max(s.length, t.length);
        if (!max) return 0;
        return 1 - (this.jarak(s, t) / max);
    },

    // Cari calon dari ?n=...: slug/full name dulu, lalu token, lalu fuzzy
    // (mis. "almira" tetap ketemu "Maulidyna Almahira Renaldi").
    cari(q) {
        const nq = this.norm(q);
        const slugQ = this.slugNama(q);
        if (!nq) return [];
        const out = [];
        (this.calon || []).forEach(c => {
            const nn = this.norm(c.nama);
            const slug = this.slugNama(c.nama);
            const token = nn.split(" ").filter(Boolean);
            let skor = 0;
            if (slug === slugQ || nn === nq) skor = 100;
            else if (token.includes(nq)) skor = 90;
            else if (token.some(t => t.startsWith(nq))) skor = 80;
            else if (nn.includes(nq)) skor = 70;
            else if (nq.length >= 4) {
                token.forEach(t => {
                    if (t.length < 4) return;
                    const m = this.mirip(t, nq);
                    if (m >= 0.72) skor = Math.max(skor, Math.round(m * 60));
                });
            }
            if (skor > 0) out.push({ calon: c, skor });
        });
        return out.sort((a, b) =>
            (b.skor - a.skor) || String(a.calon.nama || "").localeCompare(String(b.calon.nama || "")));
    },

    urlCalon(c) {
        const slug = this.slugNama(c.nama) || ("calon-" + c.id);
        return "?n=" + encodeURIComponent(slug);
    },

    // Link step 2 (hasil kebuka).
    urlBuka(c) {
        return this.urlCalon(c) + "&opened=true";
    },

    labelHasil(h) {
        if (h === "lolos") return "LANJUT";
        if (h === "tidak_lolos") return "GAGAL";
        return "BELUM DIPUTUSKAN";
    },

    clsHasil(h) {
        if (h === "lolos" || h === "tidak_lolos") return h;
        return "belum";
    },

    /* ================= PESAN HASIL (template + WA kakak asuh) ================= */
    // Cari baris pengurus by nama: tahun aktif dulu, lalu semua tahun
    // (kakak asuh bisa dari roster lama). Baris terbaru yang punya WA menang.
    cariPengurus(nama) {
        const target = String(nama || "").trim().toLowerCase();
        if (!target) return null;
        const cocok = x => String(x.nama || "").trim().toLowerCase() === target;
        const aktif = (this.pengurusList || []).find(cocok);
        if (aktif) return aktif;
        const semua = (this.pengurusSemua || []).filter(cocok);
        return semua.slice().reverse().find(x => String(x.wa || "").trim())
            || semua[semua.length - 1]
            || null;
    },

    // Nama kakak asuh -> nomor WA.
    waNoKakasuh(c, nama) {
        const p = this.cariPengurus(nama);
        return String((p && p.wa) || "").replace(/\D/g, "");
    },

    // Link WA + pesan default untuk calon yang LANJUT.
    waHref(c, nama) {
        const target = String(nama || "").trim();
        const digit = this.waNoKakasuh(c, target);
        const no = digit.startsWith("0") ? "62" + digit.slice(1) : digit;
        const pesan = "Assalamualaikum Kak " + target + ", saya " + (c.nama || "") +
            ", hasil wawancara OSIS saya dinyatakan LANJUT. Saya adik asuh kakak yang baru, mohon bimbingannya yaa kak.";
        const t = encodeURIComponent(pesan);
        return no ? "https://wa.me/" + no + "?text=" + t : "https://wa.me/?text=" + t;
    },

    // Baris {kakasuh} di template: nama kakak asuh polos (tanpa link WA).
    // Link chat-nya ada di panel "Kakak Asuh" di bawah surat.
    teksKakasuh(c) {
        const daftar = this.kaDaftar(c);
        if (!daftar.length) {
            return `<span class="hw-kaka-teks kosong">belum ditentukan</span>`;
        }
        return daftar.map(nama => this.esc(nama)).join(", ");
    },

    // Bangun isi surat dari template: placeholder {tanggal} + {kakasuh}.
    // Satu baris template = satu paragraf; baris LANJUT/GAGAL jadi stempel.
    isiPesan(c, h) {
        const tpl = h === "lolos"
            ? ((this.tpl && this.tpl.lanjut) || this.TPL_LANJUT)
            : h === "tidak_lolos"
                ? ((this.tpl && this.tpl.gagal) || this.TPL_GAGAL)
                : "";
        if (!tpl) {
            return `<div class="hw-kosong">
                <i class="fa-solid fa-hourglass-half"></i>
                <span>Hasil belum diputuskan. Pesan otomatis akan muncul begitu statusnya diisi.</span>
            </div>`;
        }
        const tanggal = this.fmtTanggal(c.tanggal) || "-";
        const cls = this.clsHasil(h);
        return String(tpl).split("\n").map(baris => {
            let t = String(baris)
                .replace(/\{tanggal\}/gi, tanggal)
                .replace(/\{kakasuh\}/gi, "\u0000");
            t = this.esc(t).split("\u0000").join(this.teksKakasuh(c));
            if (!t.trim()) return "";
            const polos = t.replace(/<[^>]*>/g, "").trim();
            if (polos === "LANJUT" || polos === "GAGAL") {
                return `<p class="hw-status-inline hw-${cls}">${polos}</p>`;
            }
            return `<p class="hw-tpl">${t}</p>`;
        }).filter(Boolean).join("");
    },

    fmtTanggal(t) {
        if (!t) return "";
        try {
            const d = new Date(String(t).slice(0, 10) + "T12:00:00+07:00");
            return d.toLocaleDateString("id-ID", {
                timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric",
            });
        } catch { return String(t).slice(0, 10); }
    },

    fmtWaktu(ts) {
        if (!ts) return "";
        try {
            return new Date(ts).toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit",
            }).replace(/\./g, ":");
        } catch { return ""; }
    },
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => HasilWawancara.init());
} else {
    HasilWawancara.init();
}
