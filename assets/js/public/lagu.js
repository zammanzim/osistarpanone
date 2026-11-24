// =========================================================================
// LAGU — request lagu radio jam istirahat (form + playlist)
// =========================================================================

const Lagu = {
    terinisialisasi: false,
    cache: [],
    editingId: null,
    ambil: 30,     // paging: jumlah request yang dimuat (nambah tiap klik)
    langkah: 30,   // nambah berapa per klik "Muat lebih banyak"
    habis: false,  // true kalau server udah ngasih semua (fetch < ambil)
    lagiMuat: false,
    total: 0,      // jumlah asli di server (Postgres ngitung, bukan yang ke-load)
    q: "",
    filter: "semua", // semua | antrean | selesai

    async init() {
        if (Lagu.terinisialisasi) return;
        Lagu.terinisialisasi = true;
        document.getElementById("kataLagu")?.addEventListener("input", () => Lagu.syncChar());
        document.getElementById("laguSearchQ")?.addEventListener("input", (e) => {
            Lagu.q = e.target.value || "";
            Lagu.render();
        });
        document.getElementById("laguClearQ")?.addEventListener("click", () => {
            const inp = document.getElementById("laguSearchQ");
            if (inp) { inp.value = ""; inp.focus(); }
            Lagu.q = "";
            Lagu.render();
        });
        document.getElementById("laguFilterPills")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-lagu-filter]");
            if (!btn) return;
            Lagu.filter = btn.dataset.laguFilter || "semua";
            Lagu.render();
        });
        Lagu.syncChar();

        // Render cache dulu (wajib saat offline), sisanya jalan background.
        try { Lagu.muatDaftar(); } catch {}
        if (typeof OsisAuth.refreshAkses === "function") {
            try { await OsisAuth.refreshAkses(); } catch {}
        }
        try { Lagu.muatDaftar(); } catch {}
        // Autosave balasan inline (blur) + ESC buat batal
        const listBalas = document.getElementById("daftarLagu");
        if (listBalas && !listBalas._balasBound) {
            listBalas._balasBound = true;
            listBalas.addEventListener("focusout", (e) => {
                const el = e.target.closest
                    ? e.target.closest("[data-balas-teks][contenteditable='true']")
                    : null;
                if (!el) return;
                Lagu.simpanBalasan(el);
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

    syncChar() {
        const kata = document.getElementById("kataLagu");
        const cnt = document.getElementById("laguCharCnt");
        if (!cnt) return;
        const n = (kata && kata.value ? kata.value : "").length;
        cnt.textContent = `${n} / 300`;
        cnt.classList.toggle("full", n >= 280);
    },

    syncTools() {
        const clr = document.getElementById("laguClearQ");
        if (clr) clr.style.display = String(Lagu.q || "").trim() ? "" : "none";
        document.querySelectorAll("#laguFilterPills [data-lagu-filter]").forEach(btn => {
            btn.classList.toggle("active", (btn.dataset.laguFilter || "semua") === Lagu.filter);
        });
    },

    resetFilter() {
        const inp = document.getElementById("laguSearchQ");
        if (inp) inp.value = "";
        Lagu.q = "";
        Lagu.filter = "semua";
        Lagu.render();
    },

    // ============ PLAYLIST — SWR ============
    // Badge jumlah: pakai total server, bukan panjang array yang ke-load.
    perbaruiJumlah(filteredCount, totalLoaded, hasFilter) {
        const jum = document.getElementById("jumLagu");
        const heroTot = document.getElementById("laguHeroTotal");
        const heroDone = document.getElementById("laguHeroDone");
        const all = Lagu.cache || [];
        const lokal = all.length;
        const n = Lagu.total > 0 ? Lagu.total : lokal;
        if (heroTot) heroTot.textContent = String(n);
        if (heroDone) heroDone.textContent = String(all.filter(l => !!l.selesai).length);
        if (!jum) return;
        if (hasFilter) {
            jum.textContent = `${filteredCount}/${totalLoaded}`;
            jum.removeAttribute("title");
            return;
        }
        jum.textContent = n;
        if (Lagu.total > lokal) {
            jum.title = `Total di server: ${Lagu.total}. Menampilkan ${lokal} terbaru.`;
        } else {
            jum.removeAttribute("title");
        }
    },

    muatTotal() {
        if (typeof getLaguCount !== "function") return Promise.resolve(Lagu.total);
        return getLaguCount().then(n => {
            Lagu.total = parseInt(n, 10) || 0;
            const hasFilter = !!(String(Lagu.q || "").trim() || Lagu.filter !== "semua");
            if (!hasFilter) Lagu.perbaruiJumlah();
            else {
                const heroTot = document.getElementById("laguHeroTotal");
                if (heroTot) heroTot.textContent = String(Lagu.total > 0 ? Lagu.total : (Lagu.cache || []).length);
            }
            return Lagu.total;
        }).catch(() => Lagu.total);
    },

    render(dataArg) {
        const list = document.getElementById("daftarLagu");
        if (!list) return;
        if (dataArg !== undefined) Lagu.cache = dataArg || [];
        const data = Lagu.cache || [];
        Lagu.syncTools();

        const q = String(Lagu.q || "").trim().toLowerCase();
        const filtered = data.filter(l => {
            if (Lagu.filter === "antrean" && l.selesai) return false;
            if (Lagu.filter === "selesai" && !l.selesai) return false;
            if (q && ![l.judul, l.penyanyi, l.pesan, l.nama, l.balasan].some(v => String(v || "").toLowerCase().includes(q))) {
                return false;
            }
            return true;
        });
        const hasFilter = !!(q || Lagu.filter !== "semua");
        Lagu.perbaruiJumlah(filtered.length, data.length, hasFilter);

        const sisa = Lagu.total > 0 ? Lagu.total - data.length : -1;
        const pagingHtml = (!Lagu.habis && (sisa > 0 || (sisa < 0 && data.length >= Lagu.langkah)))
            ? `<div id="muatLaguWrap" style="text-align:center;padding:12px 0 4px"><button type="button" class="btn btn-white btn-sm" id="btnMuatLagu" onclick="Lagu.muatLagi()"><i class="fa-solid fa-angles-down"></i> Muat lebih banyak${sisa > 0 ? ` (${sisa} lagi)` : ""}</button></div>`
            : "";

        if (!data.length) {
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-headphones"></i> Playlist masih kosong. Jadilah request pertama!</div>`;
            return;
        }
        if (!filtered.length) {
            list.innerHTML = `<div class="pesan-empty" style="text-align:center;padding:20px 12px">
                <i class="fa-solid fa-magnifying-glass"></i> Tidak ada lagu yang cocok dengan pencarian/filter ini.
                <div style="margin-top:10px"><button type="button" class="btn btn-white btn-sm" onclick="Lagu.resetFilter()"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button></div>
            </div>` + pagingHtml;
            return;
        }

        const deviceId = getDeviceId();
        const batasHapus = Date.now() - 3600000;
        const isOsis = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()?.mode === "osis");
        const isSuper = !!(isOsis && typeof OsisAuth.isSuper === "function" && OsisAuth.isSuper());
        const groups = [];
        let curKey = null;
        let curGroup = null;
        filtered.forEach(l => {
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
                const editMode = document.body.classList.contains("edit-mode");
                const canKelola = isOsis
                    ? (editMode && OsisAuth.bisa && OsisAuth.bisa("lagu"))
                    : own;
                const canBalas = isOsis && (isSuper || (OsisAuth.bisa && OsisAuth.bisa("lagu")));
                const selesai = !!l.selesai;
                const balasan = String(l.balasan || "").trim();
                const tombolSelesai = canBalas
                    ? (selesai
                        ? `<button type="button" class="sm-act-btn selesai on" onclick="Lagu.tandaiSelesai(${l.id}, false)" title="Batalkan tanda selesai"><i class="fa-solid fa-rotate-left"></i><span>Batalkan</span></button>`
                        : `<button type="button" class="sm-act-btn selesai" onclick="Lagu.tandaiSelesai(${l.id}, true)" title="Tandai selesai (udah diputar)"><i class="fa-solid fa-check"></i><span>Tandai Selesai</span></button>`)
                    : "";
                const tombolBalas = canBalas
                    ? `<button type="button" class="sm-act-btn balas${balasan ? " edited" : ""}" onclick="Lagu.balas(${l.id})" title="${balasan ? "Edit balasan" : "Balas request"}"><i class="fa-solid ${balasan ? "fa-pen-to-square" : "fa-reply"}"></i><span>${balasan ? "Edit Balasan" : "Balas"}</span></button>`
                    : "";
                const tombolKelola = canKelola
                    ? `<div class="sm-act-manage">
                        <button type="button" class="sm-act-ico edit" onclick="Lagu.edit(${l.id})" title="${isOsis ? "Edit (OSIS)" : "Edit request-ku"}"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="sm-act-ico del" onclick="Lagu.hapus(${l.id})" title="${isOsis ? "Hapus (OSIS)" : "Hapus request-ku"}"><i class="fa-solid fa-trash-can"></i></button>
                    </div>`
                    : "";
                const hasAct = !!(tombolSelesai || tombolBalas || tombolKelola);
                const balasHtml = balasan
                    ? `<div class="pesan-balas">
                        <div class="pesan-balas-head">
                            <span class="pesan-balas-ico"><i class="fa-solid fa-reply"></i></span>
                            <span class="pesan-balas-tag">OSIS</span>
                            <b>${escapeHtml(l.dibalas_oleh || "OSIS")}</b>
                        </div>
                        <p data-balas-teks="${l.id}" contenteditable="false" data-ph="Tulis balasan...">${escapeHtml(balasan)}</p>
                    </div>`
                    : "";
                const statusBadge = selesai
                    ? `<span class="lagu-badge-selesai"><i class="fa-solid fa-circle-check"></i> Selesai</span>`
                    : `<span class="lagu-badge-queue"><i class="fa-solid fa-clock"></i> Antrean</span>`;
                return `
            <div class="lagu-item${selesai ? " selesai" : ""}" data-balas-id="${l.id}">
                <div class="lagu-head">
                    <div class="lagu-cover" aria-hidden="true"><div class="lagu-kaset"><i class="fa-solid ${selesai ? "fa-check" : "fa-music"}"></i></div></div>
                    <div class="lagu-head-info">
                        <div class="lagu-title-row">
                            <div class="lagu-title">${escapeHtml(l.judul)}</div>
                            ${statusBadge}
                        </div>
                        <div class="lagu-artis"><i class="fa-solid fa-microphone-lines"></i> <span>${escapeHtml(l.penyanyi || "-")}</span></div>
                    </div>
                </div>
                ${l.pesan ? `<div class="lagu-pesan"><i class="fa-solid fa-quote-left"></i><span>${escapeHtml(l.pesan)}</span></div>` : ""}
                ${balasHtml}
                <div class="sm-card-foot">
                    <div class="sm-card-meta">
                        <span class="sm-meta-user"><i class="fa-solid fa-user"></i> ${escapeHtml(l.nama || "Anonim")}</span>
                        <span class="sm-meta-dot" aria-hidden="true">&middot;</span>
                        <span class="pesan-waktu"><i class="fa-regular fa-calendar"></i> ${Lagu.formatWaktu(l.created_at)}</span>
                    </div>
                    ${hasAct ? `<div class="sm-act-bar">${tombolSelesai}${tombolBalas}${tombolKelola}</div>` : ""}
                </div>
            </div>`;
            }).join("");
            return sep + items;
        }).join("") + pagingHtml;
    },

    async muatDaftar() {
        const list = document.getElementById("daftarLagu");
        if (!list) return;

        const cached = Cache.get("lagu");
        if (cached) {
            Lagu.render(cached);
            const totalSebelum = Lagu.total;
            Promise.all([getRequestLagu(Lagu.ambil), Lagu.muatTotal()])
                .then(([fresh, totalBaru]) => {
                    Lagu.habis = (fresh || []).length < Lagu.ambil;
                    const bedaBaris = JSON.stringify(fresh) !== JSON.stringify(cached);
                    if (bedaBaris) Cache.set("lagu", fresh);
                    if (bedaBaris || totalBaru !== totalSebelum) Lagu.render(fresh);
                })
                .catch(() => {});
            return;
        }

        try {
            const [data] = await Promise.all([getRequestLagu(Lagu.ambil), Lagu.muatTotal()]);
            Lagu.habis = (data || []).length < Lagu.ambil;
            Cache.set("lagu", data);
            Lagu.render(data);
        } catch (err) {
            console.error(err);
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat playlist. Cek koneksi.</div>`;
        }
    },

    // ============ PAGING — tombol "Muat lebih banyak" (+30 per klik) ============
    async muatLagi() {
        if (Lagu.lagiMuat || Lagu.habis) return;
        const btn = document.getElementById("btnMuatLagu");
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...';
        }
        Lagu.lagiMuat = true;
        Lagu.ambil += Lagu.langkah;
        Cache.del("lagu");
        try {
            await Lagu.muatDaftar();
        } catch (err) {
            console.error(err);
            Lagu.ambil -= Lagu.langkah;
            const b = document.getElementById("btnMuatLagu");
            if (b) {
                b.disabled = false;
                b.innerHTML = '<i class="fa-solid fa-angles-down"></i> Muat lebih banyak';
            }
            showToast("Gagal memuat. Cek koneksi lalu coba lagi.", "error");
        }
        Lagu.lagiMuat = false;
    },

    formatWaktu(t) {
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
        } catch { return ""; }
    },

    async kirim() {
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
            Lagu.syncChar();
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
            catatAksi("kirim_lagu", (judul + " - " + penyanyi).slice(0, 80));
            document.getElementById("judulLagu").value = "";
            document.getElementById("penyanyiLagu").value = "";
            document.getElementById("kataLagu").value = "";
            document.getElementById("namaPengirim").value = "";
            Lagu.syncChar();
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

    // ============ BALAS REQUEST (super_admin + admin hak lagu) ============
    // Bubble balasan langsung muncul & isinya editable inline (autosave pas blur).
    balas(id) {
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        const isSuper = !!(u && u.mode === "osis" && typeof OsisAuth.isSuper === "function" && OsisAuth.isSuper());
        const boleh = !!(u && u.mode === "osis" && (isSuper || (OsisAuth.bisa && OsisAuth.bisa("lagu"))));
        if (!boleh) {
            showToast("Cuma super admin / admin lagu yang bisa bales.", "error");
            return;
        }
        const item = (Lagu.cache || []).find(l => String(l.id) === String(id));
        const wrap = document.querySelector(`.lagu-item[data-balas-id="${id}"]`);
        if (!item || !wrap) {
            showToast("Request tidak ketemu, muat ulang halamannya dulu.", "error");
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
        Lagu.buangAct();
        const bubble = p.closest(".pesan-balas");
        if (bubble) bubble.classList.add("is-editing");
        const act = document.createElement("div");
        act.className = "balas-act";
        act.innerHTML =
            `<span class="balas-hint"><kbd>Esc</kbd> batal</span>` +
            `<div class="balas-act-btns">` +
            (String(item.balasan || "").trim()
                ? `<button type="button" class="sm-act-btn hapus-balas" onmousedown="event.preventDefault()" onclick="Lagu.hapusBalasBtn(${item.id})" title="Hapus balasan"><i class="fa-solid fa-trash-can"></i><span>Hapus</span></button>`
                : "") +
            `<button type="button" class="sm-act-btn batal" onmousedown="event.preventDefault()" onclick="Lagu.batalBalasBtn(${item.id})" title="Batal"><i class="fa-solid fa-xmark"></i><span>Batal</span></button>` +
            `<button type="button" class="sm-act-btn simpan" onmousedown="event.preventDefault()" onclick="Lagu.simpanBalasBtn(${item.id})" title="Simpan balasan"><i class="fa-solid fa-check"></i><span>Simpan</span></button>` +
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
        return document.querySelector(`#daftarLagu [data-balas-teks="${id}"]`);
    },

    buangAct() {
        document.querySelectorAll("#daftarLagu .balas-act").forEach(el => el.remove());
        document.querySelectorAll("#daftarLagu .pesan-balas.is-editing").forEach(el => el.classList.remove("is-editing"));
    },

    simpanBalasBtn(id) {
        const el = Lagu.balasEl(id);
        if (el) Lagu.simpanBalasan(el);
    },

    batalBalasBtn(id) {
        const el = Lagu.balasEl(id);
        if (el) {
            const orig = el.dataset.orig || "";
            el.textContent = orig;
            el.contentEditable = "false";
            el.blur();
            if (!String(orig).trim()) el.closest(".pesan-balas")?.remove();
        }
        Lagu.buangAct();
    },

    hapusBalasBtn(id) {
        const el = Lagu.balasEl(id);
        if (!el) return;
        el.textContent = "";
        Lagu.simpanBalasan(el);
    },

    async simpanBalasan(el) {
        if (!el) return;
        Lagu.buangAct();
        const id = el.dataset.balasTeks;
        const item = (Lagu.cache || []).find(l => String(l.id) === String(id));
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
        const isSuper = !!(u && u.mode === "osis" && typeof OsisAuth.isSuper === "function" && OsisAuth.isSuper());
        const boleh = !!(u && u.mode === "osis" && (isSuper || (OsisAuth.bisa && OsisAuth.bisa("lagu"))));
        if (!boleh) {
            el.textContent = lama;
            if (!lama) el.closest(".pesan-balas")?.remove();
            showToast("Cuma super admin / admin lagu yang bisa bales.", "error");
            return;
        }
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            el.textContent = lama;
            if (!lama) el.closest(".pesan-balas")?.remove();
            showToast("Butuh koneksi buat bales request.", "error");
            return;
        }
        try {
            if (!OsisAuth.butuh("lagu")) {
                el.textContent = lama;
                if (!lama) el.closest(".pesan-balas")?.remove();
                return;
            }
            await balasLaguOsis(u.id, id, val);
            showToast(val ? "Balasan terkirim!" : "Balasan dihapus.", "success");
            Cache.del("lagu");
            Lagu.muatDaftar();
        } catch (err) {
            console.error(err);
            el.textContent = lama;
            if (!lama) el.closest(".pesan-balas")?.remove();
            if (err.message === "ERR_NO_AUTH") {
                showPopup("Cuma super admin / admin lagu yang bisa bales.", "error");
            } else if (err.message === "ERR_NOT_FOUND") {
                showPopup("Request ini sudah tidak ada.", "error");
                Cache.del("lagu");
                Lagu.muatDaftar();
            } else if (String(err.message || "").match(/balas_lagu_osis|schema cache|does not exist|not found/i)) {
                showPopup("Database belum dimigrasi. Jalankan dulu migrasi-balas-pesan.sql di Supabase.", "error");
            } else {
                showPopup("Gagal bales. Cek koneksi lalu coba lagi.", "error");
            }
        }
    },

    // ============ TANDAI SELESAI (super_admin + admin hak lagu, hijau di UI) ============
    async tandaiSelesai(id, nilai = true) {
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        const isSuper = !!(u && u.mode === "osis" && typeof OsisAuth.isSuper === "function" && OsisAuth.isSuper());
        const boleh = !!(u && u.mode === "osis" && (isSuper || (OsisAuth.bisa && OsisAuth.bisa("lagu"))));
        if (!boleh) {
            showToast("Cuma super admin / admin lagu yang bisa nandain selesai.", "error");
            return;
        }
        // Langsung tandai tanpa popup, batalin lewat tombol undo.
        try {
            if (!OsisAuth.butuh("lagu")) return;
            await tandaiLaguSelesai(u.id, id, nilai);
            // Update optimistis biar langsung hijau tanpa nunggu reload
            const item = (Lagu.cache || []).find(l => String(l.id) === String(id));
            if (item) item.selesai = !!nilai;
            showToast(nilai ? "Lagu ditandai selesai" : "Tanda selesai dibatalkan", "success");
            Cache.del("lagu");
            Lagu.muatDaftar();
        } catch (err) {
            console.error(err);
            if (err.message === "ERR_NO_AUTH") {
                showPopup("Cuma super admin / admin lagu yang bisa nandain selesai.", "error");
            } else if (String(err.message || "").match(/schema cache|does not exist|not found|tandai_lagu_selesai/i)) {
                showPopup("Database belum dimigrasi. Jalankan dulu migrasi-lagu-selesai.sql di Supabase.", "error");
            } else {
                showPopup("Gagal menandai. Cek koneksi lalu coba lagi.", "error");
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
        Lagu.syncChar();
        document.getElementById("laguFormCard")?.classList.add("is-editing");
        const btn = document.getElementById("btnKirimLagu");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
        const batal = document.getElementById("btnBatalEditLagu");
        if (batal) batal.style.display = "";
        const head = document.getElementById("headFormLagu");
        if (head) head.textContent = "Edit Request Lagu";
        if (head && head.scrollIntoView) head.scrollIntoView({ behavior: "smooth", block: "center" });
    },

    batalEdit() {
        Lagu.editingId = null;
        const judul = document.getElementById("judulLagu"); if (judul) judul.value = "";
        const penyanyi = document.getElementById("penyanyiLagu"); if (penyanyi) penyanyi.value = "";
        const kata = document.getElementById("kataLagu"); if (kata) kata.value = "";
        const nama = document.getElementById("namaPengirim"); if (nama) nama.value = "";
        Lagu.syncChar();
        document.getElementById("laguFormCard")?.classList.remove("is-editing");
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
    Router.register("musik", () => Lagu.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Lagu.init());
} else {
    Lagu.init();
}
