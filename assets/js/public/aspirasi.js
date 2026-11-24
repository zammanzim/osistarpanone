// =========================================================================
// ASPIRASI — form kirim aspirasi + sakelar buka/tutup
// =========================================================================

const Aspirasi = {
    status: "BUKA",
    terinisialisasi: false,
    cache: [], // akumulasi halaman infinite-scroll
    perPage: 15, // hemat egress: 15 pesan per halaman
    offset: 0,
    habis: false,
    loading: false,
    editingId: null,
    q: "",
    filter: "semua", // semua | dibalas | private

    async init() {
        if (Aspirasi.terinisialisasi) return;
        Aspirasi.terinisialisasi = true;
        document.getElementById("isiAspirasi")?.addEventListener("input", () => Aspirasi.syncChar());
        document.getElementById("aspSearchQ")?.addEventListener("input", (e) => {
            Aspirasi.q = e.target.value || "";
            Aspirasi.render();
        });
        document.getElementById("aspClearQ")?.addEventListener("click", () => {
            const inp = document.getElementById("aspSearchQ");
            if (inp) { inp.value = ""; inp.focus(); }
            Aspirasi.q = "";
            Aspirasi.render();
        });
        document.getElementById("aspFilterPills")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-asp-filter]");
            if (!btn) return;
            Aspirasi.filter = btn.dataset.aspFilter || "semua";
            Aspirasi.render();
        });
        Aspirasi.syncChar();
        Aspirasi.syncStatusBadge();

        // Render cache dulu (wajib saat offline), sisanya jalan background.
        try { Aspirasi.muatPesan(true); } catch {}
        if (typeof OsisAuth.refreshAkses === "function") {
            try { await OsisAuth.refreshAkses(); } catch {}
        }
        try {
            Aspirasi.status = await cekStatusAspirasi();
        } catch { Aspirasi.status = "BUKA"; }
        Aspirasi.syncStatusBadge();
        if (Aspirasi.status === "TUTUP") Aspirasi.kunciFormulir();
        try { Aspirasi.muatPesan(true); } catch {}
        // Autosave balasan inline (blur) + ESC buat batal
        const listBalas = document.getElementById("daftarPesan");
        if (listBalas && !listBalas._balasBound) {
            listBalas._balasBound = true;
            listBalas.addEventListener("focusout", (e) => {
                const el = e.target.closest
                    ? e.target.closest("[data-balas-teks][contenteditable='true']")
                    : null;
                if (!el) return;
                Aspirasi.simpanBalasan(el);
            });
            listBalas.addEventListener("keydown", (e) => {
                if (e.key !== "Escape") return;
                const el = e.target.closest
                    ? e.target.closest("[data-balas-teks][contenteditable='true']")
                    : null;
                if (!el) return;
                el.textContent = el.dataset.orig || "";
                el.blur();
            });
        }
    },

    // ============ DAFTAR PESAN — paginasi hemat egress (15/halaman + sentinel) ============
    // awal default true biar pemanggil lama tanpa argumen (outbox/site-edit) tetap refresh penuh.
    // Filter private tetap di atas cache terakumulasi (makin lengkap seiring scroll).
    async muatPesan(awal = true) {
        const list = document.getElementById("daftarPesan");
        if (!list) return;
        if (Aspirasi.loading) return;
        if (!awal && Aspirasi.habis) return;
        Aspirasi.loading = true;
        if (awal) {
            Aspirasi.offset = 0;
            Aspirasi.cache = [];
            Aspirasi.habis = false;
            // render instan dari cache persisten (tanpa fetch)
            let instan = false;
            try {
                const c = Cache.get("aspirasi");
                if (c && c.length) {
                    Aspirasi.cache = [...c];
                    Aspirasi.render();
                    instan = true;
                    Aspirasi.cache = [];
                    Aspirasi.offset = 0;
                    Aspirasi.habis = false;
                }
            } catch {}
            if (!instan) list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-spinner fa-spin"></i> Memuat suara...</div>`;
        }
        try {
            const rows = await getAspirasi(Aspirasi.perPage, Aspirasi.offset);
            const ada = new Set(Aspirasi.cache.map(p => String(p.id)));
            (rows || []).forEach(p => { if (!ada.has(String(p.id))) { Aspirasi.cache.push(p); ada.add(String(p.id)); } });
            Aspirasi.offset = Aspirasi.cache.length;
            if (!rows || rows.length < Aspirasi.perPage) {
                Aspirasi.habis = true;
                try { Cache.set("aspirasi", Aspirasi.cache); } catch {} // full dataset → aman di-cache offline
            }
            Aspirasi.render();
        } catch (err) {
            console.error(err);
            // offline: pulihkan cache persisten (dataset lengkap) biar tetap bisa dibaca
            let pulih = false;
            try {
                const c = Cache.get("aspirasi");
                if (c && c.length) {
                    Aspirasi.cache = [...c];
                    Aspirasi.offset = Aspirasi.cache.length;
                    Aspirasi.habis = true;
                    Aspirasi.render();
                    pulih = true;
                }
            } catch {}
            if (!pulih) {
                if (awal && !Aspirasi.cache.length) list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat suara. Cek koneksi.</div>`;
                else if (typeof showToast === "function") showToast("Gagal muat lanjutan suara.", "error");
            }
        } finally {
            Aspirasi.loading = false;
        }
    },

    syncChar() {
        const isi = document.getElementById("isiAspirasi");
        const cnt = document.getElementById("aspCharCnt");
        if (!cnt) return;
        const n = (isi && isi.value ? isi.value : "").length;
        cnt.textContent = `${n} karakter`;
    },

    syncStatusBadge() {
        const el = document.getElementById("aspStatusBadge");
        if (!el) return;
        const tutup = Aspirasi.status === "TUTUP";
        el.className = "sm-stat-pill " + (tutup ? "red" : "mint");
        el.innerHTML = tutup
            ? `<i class="fa-solid fa-lock"></i> Sedang Ditutup`
            : `<i class="fa-solid fa-unlock"></i> Kotak Dibuka`;
    },

    syncTools(isOsis) {
        const privPill = document.getElementById("aspFilterPrivate");
        if (privPill) privPill.style.display = isOsis ? "" : "none";
        if (!isOsis && Aspirasi.filter === "private") Aspirasi.filter = "semua";
        const clr = document.getElementById("aspClearQ");
        if (clr) clr.style.display = String(Aspirasi.q || "").trim() ? "" : "none";
        document.querySelectorAll("#aspFilterPills [data-asp-filter]").forEach(btn => {
            btn.classList.toggle("active", (btn.dataset.aspFilter || "semua") === Aspirasi.filter);
        });
    },

    resetFilter() {
        const inp = document.getElementById("aspSearchQ");
        if (inp) inp.value = "";
        Aspirasi.q = "";
        Aspirasi.filter = "semua";
        Aspirasi.render();
    },

    render() {
        const list = document.getElementById("daftarPesan");
        if (!list) return;
        const data = Aspirasi.cache || [];
        const isOsis = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        Aspirasi.syncTools(isOsis);

        const visible = isOsis ? data : (data || []).filter(p => !p.is_private);
        const q = String(Aspirasi.q || "").trim().toLowerCase();
        const filtered = visible.filter(p => {
            if (Aspirasi.filter === "dibalas" && !String(p.balasan || "").trim()) return false;
            if (Aspirasi.filter === "private" && !p.is_private) return false;
            if (q && ![p.isi, p.nama, p.kelas, p.balasan].some(v => String(v || "").toLowerCase().includes(q))) {
                return false;
            }
            return true;
        });

        const hasFilter = !!(q || Aspirasi.filter !== "semua");
        const heroCnt = document.getElementById("aspHeroCount");
        if (heroCnt) heroCnt.textContent = String(visible.length);
        const jum = document.getElementById("jumPesan");
        if (jum) jum.textContent = hasFilter ? `${filtered.length}/${visible.length}` : String(visible.length);

        const kaki = data.length
            ? `<div style="text-align:center; padding:12px 4px">`
                + (Aspirasi.habis
                    ? `<small style="color:var(--gray); font-weight:700">— Semua suara sudah dimuat —</small>`
                    : `<button type="button" class="btn btn-white btn-sm" onclick="Aspirasi.muatPesan(false)"><i class="fa-solid fa-angles-down"></i> Muat lagi</button>`)
                + `</div><div id="aspSentinel" style="height:8px"></div>`
            : "";
        const arm = () => {
            let io = null;
            try { if (typeof pasangSentinel === "function") io = pasangSentinel("aspSentinel", () => Aspirasi.muatPesan(false)); } catch {}
            if (!io) { const s = document.getElementById("aspSentinel"); if (s) s.style.display = "none"; }
        };
        if (!visible || visible.length === 0) {
            list.innerHTML = (isOsis
                ? `<div class="pesan-empty"><i class="fa-solid fa-comments"></i> Belum ada suara masuk.</div>`
                : `<div class="pesan-empty"><i class="fa-solid fa-comments"></i> Belum ada suara public. Private hanya OSIS yang bisa lihat.</div>`) + kaki;
            arm();
            return;
        }
        if (!filtered.length) {
            list.innerHTML = `<div class="pesan-empty" style="text-align:center;padding:20px 12px">
                <i class="fa-solid fa-magnifying-glass"></i> Tidak ada suara yang cocok dengan filter ini.
                <div style="margin-top:10px"><button type="button" class="btn btn-white btn-sm" onclick="Aspirasi.resetFilter()"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button></div>
            </div>` + kaki;
            arm();
            return;
        }
        {
            const deviceId = getDeviceId();
            const batasHapus = Date.now() - 3600000;
            const groups = [];
            let curKey = null;
            let curGroup = null;
            filtered.forEach(p => {
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
                    const editMode = document.body.classList.contains("edit-mode");
                    const canKelola = isOsis
                        ? (editMode && OsisAuth.bisa && OsisAuth.bisa("aspirasi"))
                        : own;
                    const canBalas = isOsis && (OsisAuth.isSuper() || (OsisAuth.bisa && OsisAuth.bisa("aspirasi")));
                    const namaTxt = String(p.nama || "Anonim").trim() || "Anonim";
                    const initChar = namaTxt.charAt(0).toUpperCase() || "A";
                    const lock = p.is_private ? `<span class="sm-priv-pill" title="Private — hanya OSIS"><i class="fa-solid fa-lock"></i> Private</span>` : "";
                    const balasan = String(p.balasan || "").trim();
                    const repliedPill = balasan ? `<span class="sm-replied-pill"><i class="fa-solid fa-circle-check"></i> Dibalas</span>` : "";
                    const tombolBalas = canBalas
                        ? `<button type="button" class="sm-act-btn balas${balasan ? " edited" : ""}" onclick="Aspirasi.balas(${p.id})" title="${balasan ? "Edit balasan" : "Balas pesan"}"><i class="fa-solid ${balasan ? "fa-pen-to-square" : "fa-reply"}"></i><span>${balasan ? "Edit Balasan" : "Balas"}</span></button>`
                        : "";
                    const tombolKelola = canKelola
                        ? `<div class="sm-act-manage">
                            <button type="button" class="sm-act-ico edit" onclick="Aspirasi.edit(${p.id})" title="${isOsis ? "Edit (OSIS)" : "Edit pesanku"}"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="sm-act-ico del" onclick="Aspirasi.hapus(${p.id})" title="${isOsis ? "Hapus (OSIS)" : "Hapus pesanku"}"><i class="fa-solid fa-trash-can"></i></button>
                        </div>`
                        : "";
                    const hasAct = !!(tombolBalas || tombolKelola);
                    const balasHtml = balasan
                        ? `<div class="pesan-balas">
                            <div class="pesan-balas-head">
                                <span class="pesan-balas-ico"><i class="fa-solid fa-reply"></i></span>
                                <span class="pesan-balas-tag">OSIS</span>
                                <b>${escapeHtml(p.dibalas_oleh || "OSIS")}</b>
                            </div>
                            <p data-balas-teks="${p.id}" contenteditable="false" data-ph="Tulis balasan...">${escapeHtml(balasan)}</p>
                        </div>`
                        : "";
                    return `
                <div class="pesan-item${p.is_private ? " is-private" : ""}${balasan ? " is-replied" : ""}" data-balas-id="${p.id}">
                    <div class="pesan-meta">
                        <span class="sm-ava">${escapeHtml(initChar)}</span>
                        <div class="pesan-author">
                            <span class="pesan-nama">${escapeHtml(namaTxt)}</span>
                            <span class="pesan-kelas">${escapeHtml(p.kelas || "-")}</span>
                        </div>
                        ${lock || repliedPill ? `<div class="pesan-badges">${lock}${repliedPill}</div>` : ""}
                    </div>
                    <p class="pesan-isi">${escapeHtml(p.isi)}</p>
                    ${balasHtml}
                    <div class="sm-card-foot">
                        <div class="sm-card-meta">
                            <span class="pesan-waktu"><i class="fa-regular fa-calendar"></i> ${Aspirasi.formatWaktu(p.created_at)}</span>
                        </div>
                        ${hasAct ? `<div class="sm-act-bar">${tombolBalas}${tombolKelola}</div>` : ""}
                    </div>
                </div>`;
                }).join("");
                return sep + items;
            }).join("") + kaki;
            arm();
        }
    },

    formatWaktu(t) {
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return ""; }
    },

    kunciFormulir() {
        Aspirasi.syncStatusBadge();
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

        // Mode edit: tombol kirim berubah jadi simpan perubahan
        if (Aspirasi.editingId) {
            await Aspirasi.simpanEdit();
            return;
        }

        const nama = document.getElementById("namaSiswa").value.trim();
        const kelas = document.getElementById("kelasSiswa").value.trim();
        const isi = document.getElementById("isiAspirasi").value.trim();
        const isPrivate = !!document.getElementById("isPrivateAspirasi")?.checked;
        const btn = document.getElementById("btnKirimAspirasi");

        if (!isi) {
            showToast("Unek-uneknya diisi dulu yaa, jangan dikosongkan!", "error");
            return;
        }

        // Offline -> masuk antrean, terkirim otomatis saat online.
        const __spec = () => ({ modul: "aspirasi", op: "create",
            label: "Aspirasi: " + isi.slice(0, 42),
            payload: { nama: nama || "Anonim", kelas: kelas || "-", isi, is_private: isPrivate },
            files: [], cacheKeys: ["aspirasi"] });
        const __sesudahAntre = () => {
            document.getElementById("namaSiswa").value = "";
            document.getElementById("kelasSiswa").value = "";
            document.getElementById("isiAspirasi").value = "";
            const cb = document.getElementById("isPrivateAspirasi"); if (cb) cb.checked = false;
            Aspirasi.syncChar();
        };
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__spec()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(__sesudahAntre);
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';

        try {
            await kirimAspirasi(nama || "Anonim", kelas || "-", isi, isPrivate);
            showToast(isPrivate ? "Terkirim sebagai private (hanya OSIS bisa lihat)." : "Terima kasih! Aspirasimu sudah terkirim.", "success");
            catatAksi("kirim_aspirasi", isi.slice(0, 80));
            document.getElementById("namaSiswa").value = "";
            document.getElementById("kelasSiswa").value = "";
            document.getElementById("isiAspirasi").value = "";
            const cb = document.getElementById("isPrivateAspirasi"); if (cb) cb.checked = false;
            Aspirasi.syncChar();
            Cache.del("aspirasi");
            Aspirasi.muatPesan(true);
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __spec())) {
                Outbox.sesudahAntre(__sesudahAntre);
                return;
            }
            if (err.message === "ERR_LIMIT") {
                showPopup("Hanya bisa masukin 1x/hari, dateng besok lagi yaa. Kalo mau ganti tinggal hapus aja pesanmu.", "error");
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
                if (!OsisAuth.butuh("aspirasi")) return;
                const u = OsisAuth.getUser();
                await hapusAspirasiOsis(u.id, id);
            } else {
                await hapusAspirasiSendiri(id);
            }
            showToast("Pesan berhasil dihapus", "success");
            Cache.del("aspirasi");
            Aspirasi.muatPesan(true);
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

    // ============ BALAS PESAN (super_admin + admin hak aspirasi) ============
    // Bubble balasan langsung muncul & isinya editable inline (autosave pas blur).
    balas(id) {
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        const boleh = !!(u && u.mode === "osis" && (OsisAuth.isSuper() || (OsisAuth.bisa && OsisAuth.bisa("aspirasi"))));
        if (!boleh) {
            showToast("Cuma super admin / admin aspirasi yang bisa bales.", "error");
            return;
        }
        const item = (Aspirasi.cache || []).find(p => String(p.id) === String(id));
        const wrap = document.querySelector(`.pesan-item[data-balas-id="${id}"]`);
        if (!item || !wrap) {
            showToast("Pesan tidak ketemu, muat ulang halamannya dulu.", "error");
            return;
        }
        let p = wrap.querySelector(`[data-balas-teks="${id}"]`);
        if (!p) {
            const nama = ((typeof OsisAuth.displayName === "function" ? OsisAuth.displayName(u) : "") || (u && (u.nama || u.username)) || "OSIS").trim() || "OSIS";
            const div = document.createElement("div");
            div.className = "pesan-balas";
            div.innerHTML = `<div class="pesan-balas-head"><span class="pesan-balas-ico"><i class="fa-solid fa-reply"></i></span><span class="pesan-balas-tag">OSIS</span><b>${escapeHtml(nama)}</b></div><p data-balas-teks="${id}" data-ph="Tulis balasan..."></p>`;
            const foot = wrap.querySelector(".sm-card-foot");
            if (foot) foot.before(div);
            else wrap.appendChild(div);
            p = div.querySelector("p");
        }
        p.dataset.orig = String(item.balasan || "");
        p.contentEditable = "true";
        p.spellcheck = false;
        // Tombol aksi di dalam bubble editor: simpan, batal, hapus
        Aspirasi.buangAct();
        const bubble = p.closest(".pesan-balas");
        if (bubble) bubble.classList.add("is-editing");
        const act = document.createElement("div");
        act.className = "balas-act";
        act.innerHTML =
            `<span class="balas-hint"><kbd>Esc</kbd> batal</span>` +
            `<div class="balas-act-btns">` +
            (String(item.balasan || "").trim()
                ? `<button type="button" class="sm-act-btn hapus-balas" onmousedown="event.preventDefault()" onclick="Aspirasi.hapusBalasBtn(${item.id})" title="Hapus balasan"><i class="fa-solid fa-trash-can"></i><span>Hapus</span></button>`
                : "") +
            `<button type="button" class="sm-act-btn batal" onmousedown="event.preventDefault()" onclick="Aspirasi.batalBalasBtn(${item.id})" title="Batal"><i class="fa-solid fa-xmark"></i><span>Batal</span></button>` +
            `<button type="button" class="sm-act-btn simpan" onmousedown="event.preventDefault()" onclick="Aspirasi.simpanBalasBtn(${item.id})" title="Simpan balasan"><i class="fa-solid fa-check"></i><span>Simpan</span></button>` +
            `</div>`;
        if (bubble) bubble.appendChild(act);
        else p.after(act);
        p.focus();
        try {
            const r = document.createRange();
            r.selectNodeContents(p);
            r.collapse(false);
            const s = getSelection();
            s.removeAllRanges();
            s.addRange(r);
        } catch {}
    },

    balasEl(id) {
        return document.querySelector(`#daftarPesan [data-balas-teks="${id}"]`);
    },

    buangAct() {
        document.querySelectorAll("#daftarPesan .balas-act").forEach(el => el.remove());
        document.querySelectorAll("#daftarPesan .pesan-balas.is-editing").forEach(el => el.classList.remove("is-editing"));
    },

    simpanBalasBtn(id) {
        const el = Aspirasi.balasEl(id);
        if (el) Aspirasi.simpanBalasan(el);
    },

    batalBalasBtn(id) {
        const el = Aspirasi.balasEl(id);
        if (el) {
            const orig = el.dataset.orig || "";
            el.textContent = orig;
            el.contentEditable = "false";
            el.blur();
            if (!String(orig).trim()) el.closest(".pesan-balas")?.remove();
        }
        Aspirasi.buangAct();
    },

    hapusBalasBtn(id) {
        const el = Aspirasi.balasEl(id);
        if (!el) return;
        el.textContent = "";
        Aspirasi.simpanBalasan(el);
    },

    async simpanBalasan(el) {
        if (!el) return;
        Aspirasi.buangAct();
        const id = el.dataset.balasTeks;
        const item = (Aspirasi.cache || []).find(p => String(p.id) === String(id));
        const val = String(el.textContent || "").trim().slice(0, 500);
        const lama = String((item && item.balasan) || "").trim();
        el.contentEditable = "false";
        if (val === lama) {
            el.textContent = lama;
            if (!lama) el.closest(".pesan-balas")?.remove();
            return;
        }
        if (!val && lama) {
            const yakin = await showPopup("Hapus balasan ini?", "confirm");
            if (!yakin) {
                el.textContent = lama;
                return;
            }
        }
        if (!val && !lama) {
            el.closest(".pesan-balas")?.remove();
            return;
        }
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        const boleh = !!(u && u.mode === "osis" && (OsisAuth.isSuper() || (OsisAuth.bisa && OsisAuth.bisa("aspirasi"))));
        if (!boleh) {
            el.textContent = lama;
            if (!lama) el.closest(".pesan-balas")?.remove();
            showToast("Cuma super admin / admin aspirasi yang bisa bales.", "error");
            return;
        }
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            el.textContent = lama;
            if (!lama) el.closest(".pesan-balas")?.remove();
            showToast("Butuh koneksi buat bales pesan.", "error");
            return;
        }
        try {
            if (!OsisAuth.butuh("aspirasi")) {
                el.textContent = lama;
                if (!lama) el.closest(".pesan-balas")?.remove();
                return;
            }
            await balasAspirasiOsis(u.id, id, val);
            showToast(val ? "Balasan terkirim!" : "Balasan dihapus.", "success");
            Cache.del("aspirasi");
            Aspirasi.muatPesan(true);
        } catch (err) {
            console.error(err);
            el.textContent = lama;
            if (!lama) el.closest(".pesan-balas")?.remove();
            if (err.message === "ERR_NO_AUTH") {
                showPopup("Cuma super admin / admin aspirasi yang bisa bales.", "error");
            } else if (err.message === "ERR_NOT_FOUND") {
                showPopup("Pesan ini sudah tidak ada.", "error");
                Cache.del("aspirasi");
                Aspirasi.muatPesan(true);
            } else if (String(err.message || "").match(/balas_aspirasi_osis|schema cache|does not exist|not found/i)) {
                showPopup("Database belum dimigrasi. Jalankan dulu migrasi-balas-pesan.sql di Supabase.", "error");
            } else {
                showPopup("Gagal bales. Cek koneksi lalu coba lagi.", "error");
            }
        }
    },

    // ============ EDIT PESAN (pakai form utama di atas, bukan popup) ============
    // Tombol edit tampil & hilang mengikuti tombol hapus (milik sendiri <1 jam / OSIS).
    edit(id) {
        if (Aspirasi.status === "TUTUP") {
            showToast("Maaf, kotak aspirasi sedang ditutup sementara.", "error");
            return;
        }
        const item = (Aspirasi.cache || []).find(p => String(p.id) === String(id));
        if (!item) {
            showToast("Pesan tidak ketemu, muat ulang halamannya dulu.", "error");
            return;
        }
        Aspirasi.editingId = id;
        document.getElementById("namaSiswa").value = item.nama || "";
        document.getElementById("kelasSiswa").value = item.kelas || "";
        document.getElementById("isiAspirasi").value = item.isi || "";
        Aspirasi.syncChar();
        document.getElementById("aspFormCard")?.classList.add("is-editing");
        // Status private tidak ikut diubah, jadi kunci biar jelas
        const cb = document.getElementById("isPrivateAspirasi");
        if (cb) { cb.checked = !!item.is_private; cb.disabled = true; }
        const btn = document.getElementById("btnKirimAspirasi");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
        const batal = document.getElementById("btnBatalEditAspirasi");
        if (batal) batal.style.display = "";
        const head = document.getElementById("headFormAspirasi");
        if (head) head.textContent = "Edit Aspirasi";
        if (head && head.scrollIntoView) head.scrollIntoView({ behavior: "smooth", block: "center" });
    },

    batalEdit() {
        Aspirasi.editingId = null;
        const nama = document.getElementById("namaSiswa"); if (nama) nama.value = "";
        const kelas = document.getElementById("kelasSiswa"); if (kelas) kelas.value = "";
        const isi = document.getElementById("isiAspirasi"); if (isi) isi.value = "";
        Aspirasi.syncChar();
        document.getElementById("aspFormCard")?.classList.remove("is-editing");
        const cb = document.getElementById("isPrivateAspirasi"); if (cb) { cb.checked = false; cb.disabled = false; }
        const btn = document.getElementById("btnKirimAspirasi");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Suara Tarpan';
        const batal = document.getElementById("btnBatalEditAspirasi");
        if (batal) batal.style.display = "none";
        const head = document.getElementById("headFormAspirasi");
        if (head) head.textContent = "Formulir Suara Tarpan";
    },

    async simpanEdit() {
        const id = Aspirasi.editingId;
        if (!id) return;
        const nama = document.getElementById("namaSiswa").value.trim() || "Anonim";
        const kelas = document.getElementById("kelasSiswa").value.trim() || "-";
        const isi = document.getElementById("isiAspirasi").value.trim();
        const btn = document.getElementById("btnKirimAspirasi");
        if (!isi) {
            showToast("Isi aspirasi jangan dikosongkan!", "error");
            return;
        }
        const isOsis = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
        const __specEdit = () => ({ modul: "aspirasi", op: "update",
            label: "Ubah aspirasi: " + isi.slice(0, 42),
            payload: { id, nama, kelas, isi }, files: [], cacheKeys: ["aspirasi"] });
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            try { await Outbox.enqueue(__specEdit()); } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(() => Aspirasi.batalEdit());
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Suara Tarpan';
            return;
        }
        try {
            if (isOsis) {
                if (!OsisAuth.butuh("aspirasi")) return;
                const u = OsisAuth.getUser();
                await editAspirasiOsis(u.id, id, nama, kelas, isi);
            } else {
                await editAspirasiSendiri(id, nama, kelas, isi);
            }
            showToast("Aspirasi berhasil diubah", "success");
            Aspirasi.batalEdit();
            Cache.del("aspirasi");
            Aspirasi.muatPesan(true);
            const list = document.getElementById("daftarPesan");
            if (list && list.scrollIntoView) list.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
            console.error(err);
            if (typeof Outbox !== "undefined" && await Outbox.enqueueOnNetErr(err, __specEdit())) {
                Outbox.sesudahAntre(() => Aspirasi.batalEdit());
                return;
            }
            if (err.message === "ERR_EXPIRED") {
                showPopup("Pesan udah lebih dari 1 jam, udah ga bisa diubah.", "error");
                Aspirasi.batalEdit();
                Cache.del("aspirasi");
                Aspirasi.muatPesan(true);
            } else if (err.message === "ERR_FORBIDDEN") {
                showPopup("Ini bukan pesan kamu!", "error");
                Aspirasi.batalEdit();
                Cache.del("aspirasi");
                Aspirasi.muatPesan(true);
            } else if (err.message === "ERR_NOT_FOUND") {
                showPopup("Pesan ini sudah tidak ada.", "error");
                Aspirasi.batalEdit();
                Cache.del("aspirasi");
                Aspirasi.muatPesan(true);
            } else if (err.message === "ERR_NO_AUTH") {
                showPopup("Cuma OSIS yang bisa ubah pesan ini.", "error");
            } else if (err.message === "ERR_EMPTY") {
                showToast("Isi aspirasi jangan dikosongkan!", "error");
            } else if (String(err.message || "").match(/schema cache|does not exist|not found/i)) {
                showPopup("Fungsi edit belum dipasang di database. Jalankan dulu SQL terbaru (code.sql) di Supabase.", "error");
            } else {
                showPopup("Gagal menyimpan. Cek koneksi lalu coba lagi.", "error");
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = Aspirasi.editingId
                ? '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan'
                : '<i class="fa-solid fa-paper-plane"></i> Kirim Suara Tarpan';
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
