/**
 * OSIS TARPAN ONE — UNIVERSAL POPUP SYSTEM
 * Pengganti alert()/confirm() dengan tema neo-brutalist.
 *
 * showPopup(msg, type) → Promise
 *   type: 'info' | 'success' | 'error' | 'confirm' | 'form'
 *
 * Contoh:
 *   await showPopup("Yakin hapus?", "confirm")  → true / false
 *   await showPopup("Gagal koneksi", "error")   → true (tombol OK)
 *   const nilai = await showPopup("Isi nama?", "form", { title: "Form", fields: [...] })
 *
 * Semua popup/modal di web ini (uniOverlay, struktur-modal, visitor,
 * form admin OSIS, form prestasi) bisa ditutup dengan:
 *   1. Tombol ESC
 *   2. Klik area kosong (backdrop)
 *   3. Tombol back di HP (history back)
 */

// =========================================================================
// KOORDINASI MODAL GLOBAL
// Tiga sistem modal (uniPopup di file ini, struktur-modal di home.js,
// form/overlay lain via ModalNav di bawah) berbagi satu riwayat browser.
// Aturan: SATU tekan back = tutup SATU modal teratas (LIFO).
// Mekanisme:
//  - Setiap modal yang dibuka push satu history state + simpan nomor urut
//    (window.__seqModal) di dataset.seq.
//  - window.__topModal() menentukan siapa pemilik modal teratas.
//  - Tiap handler popstate hanya menutup kalau dialah pemilik teratas.
//  - Penutupan via tombol/ESC/klik-kosong menyeimbangkan riwayat dengan
//    history.back(); popstate yang timbul darinya dikonsumsi via
//    window.__abaikanBack + flag sekali-pakai di objek event
//    (e.__modalKonsumsi) agar tidak menutup modal lain.
// =========================================================================
window.__seqModal = window.__seqModal || 0;
window.__abaikanBack = window.__abaikanBack || 0;

window.__topModal = function () {
    let top = null;
    const uni = document.getElementById("uniOverlay");
    if (uni) top = { sys: "uni", seq: parseInt(uni.dataset.seq || "0", 10) || 0 };
    document.querySelectorAll(".struktur-modal").forEach((m) => {
        const s = parseInt((m.dataset && m.dataset.seq) || "0", 10) || 0;
        if (!top || s > top.seq) top = { sys: "home", seq: s };
    });
    if (window.ModalNav && typeof ModalNav.terbuka === "function") {
        ModalNav.terbuka().forEach((el) => {
            const s = parseInt((el.dataset && el.dataset.seq) || "0", 10) || 0;
            if (!top || s > top.seq) top = { sys: "nav", seq: s };
        });
    }
    return top;
};

window.showPopup = function (msg, type = 'info', options = {}) {
    return new Promise((resolve) => {
        // 1. Bersihkan popup lama jika ada (warisi state history-nya biar
        //    riwayat tidak dobel: 1 popup = 1 state)
        const existing = document.getElementById('uniOverlay');
        let warisiPush = false;
        if (existing) {
            warisiPush = !!existing._uniPush;
            if (window.__uniPop) {
                window.removeEventListener('popstate', window.__uniPop);
                window.__uniPop = null;
            }
            existing.remove();
        }

        // 2. Buat elemen baru
        const overlay = document.createElement('div');
        overlay.id = 'uniOverlay';
        overlay.className = 'uni-overlay';
        try { overlay.dataset.seq = String(++window.__seqModal); } catch (e) {}

        // 3. Tentukan Icon & Tombol berdasarkan Tipe
        let iconHtml = '';
        let btnsHtml = '';
        let iconClass = 'uni-icon';
        let contentHtml = `<p class="uni-msg">${msg}</p>`;

        if (type === 'success') {
            iconClass += ' success';
            iconHtml = '<i class="fa-solid fa-check"></i>';
            btnsHtml = `<button class="uni-btn" id="uniBtnOk">OK</button>`;
        } else if (type === 'error') {
            iconClass += ' error';
            iconHtml = '<i class="fa-solid fa-xmark"></i>';
            btnsHtml = `<button class="uni-btn" id="uniBtnOk">OK</button>`;
        } else if (type === 'confirm') {
            iconClass += ' warning';
            iconHtml = '<i class="fa-solid fa-exclamation"></i>';
            btnsHtml = `
                <div class="uni-actions">
                    <button class="uni-btn-cancel" id="uniBtnNo">Tidak</button>
                    <button class="uni-btn-confirm" id="uniBtnYes">Iya</button>
                </div>
            `;
        } else if (type === 'form') {
            iconClass += ' info';
            iconHtml = options.icon || '<i class="fa-solid fa-pen-to-square"></i>';

            // Format fields: [{ name, label, type, placeholder, value, options }]
            const fields = options.fields || [{
                name: 'value',
                label: msg,
                type: 'text',
                placeholder: options.placeholder || '',
                value: options.value || ''
            }];

            const fieldsHtml = fields.map(f => {
                if (f.type === 'select') {
                    const optionsHtml = (f.options || []).map(opt => `
                        <option value="${opt.value}" ${opt.value === f.value ? 'selected' : ''}>${opt.label}</option>
                    `).join('');
                    return `
                        <div class="uni-form-group">
                            ${f.label ? `<label>${f.label}</label>` : ''}
                            <select id="uniInput_${f.name}" class="uni-input">
                                ${optionsHtml}
                            </select>
                        </div>
                    `;
                }
                return `
                    <div class="uni-form-group">
                        ${f.label ? `<label>${f.label}</label>` : ''}
                        <input type="${f.type || 'text'}"
                               id="uniInput_${f.name}"
                               placeholder="${f.placeholder || ''}"
                               value="${f.value || ''}"
                               class="uni-input"
                               autocomplete="off">
                    </div>
                `;
            }).join('');

            contentHtml = `
                <div class="uni-form-container">
                    ${options.title ? `<h3 class="uni-title">${options.title}</h3>` : ''}
                    ${!options.title ? `<p class="uni-msg">${msg}</p>` : ''}
                    ${fieldsHtml}
                </div>
            `;

            btnsHtml = `
                <div class="uni-actions">
                    <button class="uni-btn-cancel" id="uniBtnNo">Batal</button>
                    <button class="uni-btn-confirm" id="uniBtnYes">Simpan</button>
                </div>
            `;
        } else {
            iconClass += ' info';
            iconHtml = '<i class="fa-solid fa-info"></i>';
            btnsHtml = `<button class="uni-btn" id="uniBtnOk">OK</button>`;
        }

        // 4. Masukkan HTML
        overlay.innerHTML = `
            <div class="uni-box">
                <div class="${iconClass}">${iconHtml}</div>
                ${contentHtml}
                ${btnsHtml}
            </div>`;

        // varian tinggi: header + footer tetap, konten scroll di dalam
        if (options.tall) {
            const box = overlay.querySelector('.uni-box');
            if (box) box.classList.add('uni-tall');
        }

        document.body.appendChild(overlay);

        // Daftarkan state history biar tombol back HP menutup popup ini.
        // (Diwarisi tanpa push baru kalau menggantikan popup sebelumnya.)
        let didPush = false;
        if (warisiPush) {
            didPush = true;
        } else {
            try { history.pushState({ uniPopup: true }, ""); didPush = true; } catch (e) {}
        }
        overlay._uniPush = didPush;

        // Animasi masuk (tanpa auto focus — HP jangan langsung buka keyboard)
        setTimeout(() => {
            overlay.classList.add('active');
        }, 10);

        // Nilai "batal" untuk tiap tipe (dipakai ESC / klik-kosong / back / closePopup)
        const nilaiBatal = (type === 'confirm' || type === 'form') ? false : true;

        // --- LOGIC PENUTUPAN ---
        const close = (result, dariBack = false) => {
            overlay.classList.remove('active');
            document.removeEventListener('keydown', handleKey, true);
            if (window.__uniPop) {
                window.removeEventListener('popstate', window.__uniPop);
                window.__uniPop = null;
            }

            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 250);

            // Seimbangkan riwayat kalau tutupnya bukan dari tombol back
            if (!dariBack && overlay._uniPush) {
                overlay._uniPush = false;
                window.__abaikanBack = (window.__abaikanBack | 0) + 1;
                try { history.back(); } catch (e) { window.__abaikanBack--; }
            }

            if (type === 'form' && result === true) {
                const fields = options.fields || [{ name: 'value' }];
                const data = {};
                fields.forEach(f => {
                    const el = document.getElementById(`uniInput_${f.name}`);
                    if (el) data[f.name] = el.value;
                });
                resolve(fields.length === 1 ? Object.values(data)[0] : data);
            } else if (type === 'form' && result === false) {
                resolve(null);
            } else {
                resolve(result);
            }
        };
        // Dipakai window.closePopup() — berperilaku seperti tekan ESC
        overlay._tutupBatal = () => close(nilaiBatal);

        // --- EVENT HANDLERS ---
        const handleKey = (e) => {
            if (e.key === 'Enter') {
                // Telan Enter biar form admin di belakang tidak ikut ke-submit
                e.preventDefault();
                try { e.stopPropagation(); } catch (err) {}
                close(true);
            } else if (e.key === 'Escape') {
                // Telan ESC biar hanya popup teratas ini yang tutup
                e.preventDefault();
                try { e.stopPropagation(); } catch (err) {}
                close(nilaiBatal);
            }
        };
        // capture:true → jalan duluan sebelum handler ESC lain di document,
        // jadi modal di belakang tidak ikut ketutup.
        document.addEventListener('keydown', handleKey, true);

        // Tombol back HP: tutup popup ini hanya kalau dialah yang teratas
        const onPop = (e) => {
            if (e.__modalKonsumsi) return;
            if ((window.__abaikanBack | 0) > 0) {
                window.__abaikanBack--;
                e.__modalKonsumsi = true;
                return;
            }
            if (!document.getElementById('uniOverlay')) return;
            if (window.__topModal) {
                const t = window.__topModal();
                if (t && t.sys !== 'uni') return;
            }
            e.__modalKonsumsi = true;
            close(nilaiBatal, true);
        };
        if (window.__uniPop) window.removeEventListener('popstate', window.__uniPop);
        window.__uniPop = onPop;
        window.addEventListener('popstate', onPop);

        if (type === 'confirm' || type === 'form') {
            document.getElementById('uniBtnYes').onclick = () => close(true);
            document.getElementById('uniBtnNo').onclick = () => close(false);
            overlay.onclick = (e) => { if (e.target === overlay) close(false); };
        } else {
            document.getElementById('uniBtnOk').onclick = () => close(true);
            overlay.onclick = (e) => { if (e.target === overlay) close(true); };
        }
    });
};

window.closePopup = function () {
    const overlay = document.getElementById('uniOverlay');
    if (overlay && typeof overlay._tutupBatal === 'function') overlay._tutupBatal();
    else if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
};

// =========================================================================
// ModalNav — penutup universal untuk SEMUA popup non-uni & non-struktur:
//   #visitorOverlay, #prestasiFormOverlay, #posterFormOverlay,
//   dan form/detail admin OSIS
//   (#agendaForm, #absensiForm, #absenLangsung, #kasForm, #kasDetail,
//    #tabForm, #tabDetail, #dokumenForm, #dokumenDetail, #evaluasiForm,
//    #evaluasiDetail, #notulensiForm, #notulensiDetail, #prokerForm,
//    #prokerDetail, #taskForm, #taskDetail, #anggotaPopup, #sekbidPopup,
//    #wwCalonForm, #wwTanyaForm, #wwTanyaEdit)
// File ini dimuat di semua halaman (publik + osis), jadi satu
// tempat ini cukup untuk meng-cover semuanya tanpa edit tiap modul:
//   - ESC (cadangan untuk popup yang belum punya handler sendiri)
//   - klik area kosong (sudah ada di tiap modul; tidak diubah)
//   - tombol back HP (otomatis via MutationObserver + popstate)
// =========================================================================
window.ModalNav = (function () {
    const IDS = [
        "visitorOverlay", "prestasiFormOverlay", "posterFormOverlay",
        "navAturOverlay",
        "agendaForm", "agendaDetail", "absensiForm", "absenLangsung",
        "kasForm", "kasDetail", "tabForm", "tabDetail", "aksDetail",
        "dokumenForm", "dokumenDetail", "evaluasiForm", "evaluasiDetail",
        "notulensiForm", "notulensiDetail", "prokerForm", "prokerDetail",
        "taskForm", "taskDetail", "anggotaPopup", "sekbidPopup",
        "wwCalonForm", "wwTanyaForm", "wwTanyaEdit"
    ];

    const ambil = (nama) => (typeof window[nama] !== "undefined" ? window[nama] : null);

    function terbuka() {
        const out = [];
        IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (id === "prestasiFormOverlay" || id === "posterFormOverlay") out.push(el); // ada di DOM = terbuka
            else if (el.classList && el.classList.contains("open")) out.push(el);
        });
        return out;
    }

    function pulihkanScroll() {
        if (document.getElementById("uniOverlay")) return;
        if (document.querySelector(".struktur-modal")) return;
        if (terbuka().length) return;
        document.body.style.overflow = "";
    }

    // Tutup satu popup generik via fungsi modulnya; fallback: lepas .open
    function tutupEl(id) {
        try {
            switch (id) {
                case "visitorOverlay": {
                    const V = ambil("Visitor");
                    if (V && V.tutupPopup) { V.tutupPopup(); return; }
                    break;
                }
                case "prestasiFormOverlay": {
                    const P = ambil("Prestasi");
                    if (P && P.tutupForm) { P.tutupForm(); return; }
                    const el = document.getElementById(id);
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                    pulihkanScroll();
                    return;
                }
                case "posterFormOverlay": {
                    const P = ambil("Poster");
                    if (P && P.tutupForm) { P.tutupForm(); return; }
                    const el = document.getElementById(id);
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                    pulihkanScroll();
                    return;
                }
                case "navAturOverlay": {
                    const N = ambil("NavAtur");
                    if (N && N.tutup) { N.tutup(); return; }
                    break;
                }
                case "agendaForm": {
                    const A = ambil("AgendaAdmin");
                    if (A && A.tutupForm) { A.tutupForm(); return; }
                    break;
                }
                case "agendaDetail": {
                    const A = ambil("AgendaAdmin");
                    if (A && A.tutupDetail) { A.tutupDetail(); return; }
                    break;
                }
                case "absensiForm": {
                    const A = ambil("Absensi");
                    if (A && A.tutupForm) { A.tutupForm(); return; }
                    break;
                }
                case "absenLangsung": {
                    const A = ambil("Absensi");
                    if (A && A.tutupLangsung) { A.tutupLangsung(); return; }
                    break;
                }
                case "kasForm": {
                    const K = ambil("Keuangan");
                    if (K && K.tutupForm) { K.tutupForm(); return; }
                    break;
                }
                case "kasDetail": {
                    const K = ambil("Keuangan");
                    if (K && K.tutupDetail) { K.tutupDetail(); return; }
                    break;
                }
                case "tabForm": {
                    const T = ambil("Tabungan");
                    if (T && T.tutupForm) { T.tutupForm(); return; }
                    break;
                }
                case "tabDetail": {
                    const T = ambil("Tabungan");
                    if (T && T.tutupDetail) { T.tutupDetail(); return; }
                    break;
                }
                case "aksDetail": {
                    const A = ambil("Akses");
                    if (A && A.tutupDetail) { A.tutupDetail(); return; }
                    break;
                }
                case "dokumenForm": {
                    const D = ambil("Dokumen");
                    if (D && D.tutupForm) { D.tutupForm(); return; }
                    break;
                }
                case "dokumenDetail": {
                    const D = ambil("Dokumen");
                    if (D && D.tutupDetail) { D.tutupDetail(); return; }
                    break;
                }
                case "evaluasiForm": {
                    const E = ambil("Evaluasi");
                    if (E && E.tutupForm) { E.tutupForm(); return; }
                    break;
                }
                case "evaluasiDetail": {
                    const E = ambil("Evaluasi");
                    if (E && E.tutupDetail) { E.tutupDetail(); return; }
                    break;
                }
                case "notulensiForm": {
                    const N = ambil("Notulensi");
                    if (N && N.tutupForm) { N.tutupForm(); return; }
                    break;
                }
                case "notulensiDetail": {
                    const N = ambil("Notulensi");
                    if (N && N.tutupDetail) { N.tutupDetail(); return; }
                    break;
                }
                case "prokerForm": {
                    const P = ambil("Proker");
                    if (P && P.tutupForm) { P.tutupForm(); return; }
                    break;
                }
                case "prokerDetail": {
                    const P = ambil("Proker");
                    if (P && P.tutupDetail) { P.tutupDetail(); return; }
                    break;
                }
                case "taskForm": {
                    const T = ambil("Task");
                    if (T && T.tutupForm) { T.tutupForm(); return; }
                    break;
                }
                case "taskDetail": {
                    const T = ambil("Task");
                    if (T && T.tutupDetail) { T.tutupDetail(); return; }
                    break;
                }
                case "anggotaPopup": {
                    const A = ambil("Anggota");
                    if (A && A.tutupPopupAnggota) { A.tutupPopupAnggota(); return; }
                    break;
                }
                case "sekbidPopup": {
                    const A = ambil("Anggota");
                    if (A && A.tutupPopupSekbid) { A.tutupPopupSekbid(); return; }
                    break;
                }
                case "wwCalonForm": {
                    const W = ambil("Wawancara");
                    if (W && W.tutupFormCalon) { W.tutupFormCalon(); return; }
                    break;
                }
                case "wwTanyaForm": {
                    const W = ambil("Wawancara");
                    if (W && W.tutupKelolaTanya) { W.tutupKelolaTanya(); return; }
                    break;
                }
                case "wwTanyaEdit": {
                    const W = ambil("Wawancara");
                    if (W && W.tutupFormTanya) { W.tutupFormTanya(); return; }
                    break;
                }
            }
        } catch (err) { /* jatuh ke fallback */ }
        const el = document.getElementById(id);
        if (el) {
            if (el.classList) el.classList.remove("open");
            if ((id === "prestasiFormOverlay" || id === "posterFormOverlay") && el.parentNode) el.parentNode.removeChild(el);
        }
        pulihkanScroll();
    }

    // ---- Pelacakan buka/tutup + penyeimbang history ----
    let prev = -1;   // jumlah popup terbuka saat sinkron terakhir
    let did = 0;     // state history yang kita push & belum di-balance
    const urutan = []; // id popup sesuai urutan dibuka

    function sinkron() {
        const skrg = terbuka();
        const ids = skrg.map((el) => el.id);
        for (let i = urutan.length - 1; i >= 0; i--) {
            if (ids.indexOf(urutan[i]) < 0) urutan.splice(i, 1);
        }
        skrg.forEach((el) => {
            if (urutan.indexOf(el.id) < 0) {
                urutan.push(el.id);
                try { el.dataset.seq = String(++window.__seqModal); } catch (e) {}
            }
        });
        if (prev === -1) { prev = skrg.length; return; }
        if (skrg.length > prev) {
            // Ada popup dibuka (tutup via tombol/ESC/klik-kosong di modul
            // masing-masing tidak menyentuh history) → push biar back = tutup
            const n = skrg.length - prev;
            prev = skrg.length;
            for (let i = 0; i < n; i++) {
                try { history.pushState({ modalNav: true }, ""); did++; } catch (e) {}
            }
        } else if (skrg.length < prev) {
            // Ada popup ditutup manual → mundurkan history biar sejajar
            const n = prev - skrg.length;
            prev = skrg.length;
            const b = Math.min(n, did);
            did -= b;
            for (let i = 0; i < b; i++) {
                window.__abaikanBack = (window.__abaikanBack | 0) + 1;
                try { history.back(); } catch (e) { window.__abaikanBack--; }
            }
        }
    }

    let terjadwal = false;
    function jadwal() {
        if (terjadwal) return;
        terjadwal = true;
        setTimeout(() => {
            terjadwal = false;
            try { sinkron(); } catch (e) {}
        }, 0);
    }

    function tutupTeratas(dariBack) {
        const buka = terbuka();
        if (!buka.length) return false;
        const id = urutan.length ? urutan[urutan.length - 1] : buka[buka.length - 1].id;
        const ix = urutan.indexOf(id);
        if (ix >= 0) urutan.splice(ix, 1);
        if (dariBack) {
            // Dipanggil dari handler back: selaraskan penghitung manual
            // karena observer nanti melihat jumlah yang sudah pas.
            prev = buka.length - 1;
            did = Math.max(0, did - 1);
        }
        tutupEl(id);
        return true;
    }

    // Tombol back HP: tutup popup teratas hanya kalau milik sistem ini
    window.addEventListener("popstate", (e) => {
        if (e.__modalKonsumsi) return;
        if ((window.__abaikanBack | 0) > 0) {
            window.__abaikanBack--;
            e.__modalKonsumsi = true;
            return;
        }
        if (document.getElementById("uniOverlay")) return; // uniPopup yang urus
        if (window.__topModal) {
            const t = window.__topModal();
            if (t && t.sys !== "nav") return; // struktur-modal (home.js) yang urus
        }
        const buka = terbuka();
        if (!buka.length) return;
        e.__modalKonsumsi = true;
        tutupTeratas(true);
    });

    // ESC cadangan: hanya untuk popup yang belum punya handler ESC sendiri
    // (visitor & form prestasi). Form admin lain sudah handle di modulnya.
    // Di-skip kalau uniPopup terbuka (uni yang urus, capture-nya menelan key).
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (document.getElementById("uniOverlay")) return;
        const v = document.getElementById("visitorOverlay");
        if (v && v.classList.contains("open")) {
            const V = ambil("Visitor");
            if (V && V.tutupPopup) V.tutupPopup();
            else { v.classList.remove("open"); pulihkanScroll(); }
            return;
        }
        if (document.getElementById("prestasiFormOverlay")) {
            const P = ambil("Prestasi");
            if (P && P.tutupForm) P.tutupForm();
            else {
                const p = document.getElementById("prestasiFormOverlay");
                if (p && p.parentNode) p.parentNode.removeChild(p);
                pulihkanScroll();
            }
            return;
        }
        if (document.getElementById("posterFormOverlay")) {
            const P = ambil("Poster");
            if (P && P.tutupForm) P.tutupForm();
            else {
                const p = document.getElementById("posterFormOverlay");
                if (p && p.parentNode) p.parentNode.removeChild(p);
                pulihkanScroll();
            }
        }
    });

    if (typeof MutationObserver !== "undefined") {
        const obs = new MutationObserver(jadwal);
        const mulai = () => {
            try {
                obs.observe(document.documentElement, {
                    childList: true, subtree: true,
                    attributes: true, attributeFilter: ["class"]
                });
            } catch (e) {}
            jadwal();
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulai);
        else mulai();
    }

    return {
        terbuka: terbuka,
        adaYangTerbuka: function () { return terbuka().length > 0; },
        tutupTeratas: tutupTeratas
    };
})();

// =========================================================================
// Ctrl/Cmd + Enter = simpan.
// Satu handler buat semua popup & form inline yang punya tombol simpan.
// Urutan cari tombol: di dalam popup/panel fokus → popup teratas → kalau
// cuma ada satu tombol simpan yang kelihatan di halaman, pakai itu.
// Popup showPopup() (uniOverlay) sudah ditangani handler Enter di atas.
// =========================================================================
(function () {
    // id popup → selector tombol simpan di dalamnya
    const POPUP = {
        agendaForm: "#btnSimpanAgenda",
        absensiForm: "#btnSimpanAbsensi",
        absenLangsung: "#btnSelesaiLangsung",
        kasForm: "#btnSimpanKas",
        tabForm: "#btnSimpanTabungan",
        dokumenForm: "#btnSimpanDokumen",
        notulensiForm: "#btnSimpanNotulensi",
        programForm: "#btnSimpanProgram",
        aksDetail: "#aksDetailBody .btn-red",
        wwCalonForm: '[onclick*="Wawancara.simpanCalon"]',
        wwTanyaEdit: '[onclick*="Wawancara.simpanTanya"]',
        feedFormOverlay: "#btnSimpanFeed",
        infoFormOverlay: "#btnSimpanInfo",
        clFormOverlay: "#btnSimpanCl",
        prestasiFormOverlay: "#btnSimpanPrestasi",
        posterFormOverlay: "#btnSimpanPoster",
        navAturOverlay: "#navAturSimpan",
        pengurusModal: "#pgEditSimpan",
        // modul lama (halamannya sudah dihapus, aman kalau dipakai lagi)
        evaluasiForm: "#btnSimpanEvaluasi",
        prokerForm: "#btnSimpanProker",
        taskForm: "#btnSimpanTask"
    };

    // Popup yang hilang dari DOM saat ditutup (bukan pakai class .open)
    const APPEND = [
        "feedFormOverlay", "infoFormOverlay", "clFormOverlay",
        "prestasiFormOverlay", "posterFormOverlay", "navAturOverlay", "pengurusModal"
    ];

    // Form inline (bukan popup)
    const INLINE = [
        "#btnInfvSimpan", "#polBtnSimpan",
        "#btnSimpanProfil", "#btnSimpanUsername", "#btnSimpanPassword",
        "button.gal-save",
        '[onclick*="Wawancara.simpanPetugas"]',
        "#wwTurunanSimpan"
    ];

    // Panel form inline yang boleh dicari tombol simpannya
    const SCOPE = ".bento-block.draft, #infvCard_edit, .osis-panel, #wwTurunanBaru, #polAdmin";

    // Tombol beneran kelihatan & bisa diklik
    function tampil(btn) {
        if (!btn || btn.disabled) return false;
        if (btn.getAttribute("aria-disabled") === "true") return false;
        if (!btn.getClientRects().length) return false;
        const cs = window.getComputedStyle(btn);
        return cs.display !== "none" && cs.visibility !== "hidden";
    }

    function cariSimpan(root) {
        if (!root || !root.querySelector) return null;
        // Atur Navigasi: kalau baris lagi diedit, simpan baris itu dulu
        if (root.id === "navAturOverlay") {
            const form = root.querySelector(".side-form");
            const terapkan = form && form.querySelector(".side-add");
            if (tampil(terapkan)) return terapkan;
        }
        const daftar = INLINE.concat(Object.keys(POPUP).map(function (k) { return POPUP[k]; }));
        for (let i = 0; i < daftar.length; i++) {
            const btn = root.querySelector(daftar[i]);
            if (tampil(btn)) return btn;
        }
        const cadangan = root.querySelector('button[id^="btnSimpan"]');
        return tampil(cadangan) ? cadangan : null;
    }

    // Popup paling atas yang lagi terbuka (pakai urutan DOM; popup baru
    // di-append ke body jadi otomatis paling akhir).
    function popupTeratas() {
        let hasil = null;
        Object.keys(POPUP).forEach(function (id) {
            const el = document.getElementById(id);
            if (!el) return;
            if (APPEND.indexOf(id) < 0 && !el.classList.contains("open")) return;
            if (!el.getClientRects().length) return;
            if (!hasil || (hasil.compareDocumentPosition(el) & 4)) hasil = el;
        });
        return hasil;
    }

    // Cari tombol simpan dari elemen yang lagi fokus
    function dariFokus() {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;

        // 1. Di dalam popup?
        let node = el;
        while (node && node !== document.body) {
            if (node.id && POPUP[node.id]) {
                const btn = cariSimpan(node);
                if (btn) return btn;
            }
            node = node.parentElement;
        }

        // 2. Di dalam panel form inline? (berhenti di panel terdekat)
        const scope = el.closest && el.closest(SCOPE);
        if (scope) {
            for (let i = 0; i < INLINE.length; i++) {
                const btn = scope.querySelector(INLINE[i]);
                if (tampil(btn)) return btn;
            }
        }
        return null;
    }

    // Cadangan: cuma ada satu tombol simpan yang kelihatan di halaman
    function satuTombol() {
        const ketemu = [];
        INLINE.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(function (btn) {
                if (tampil(btn) && ketemu.indexOf(btn) < 0) ketemu.push(btn);
            });
        });
        return ketemu.length === 1 ? ketemu[0] : null;
    }

    document.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
        if (e.altKey || e.shiftKey || e.isComposing || e.repeat) return;
        if (document.getElementById("uniOverlay")) return; // diurus showPopup
        const btn = dariFokus() || cariSimpan(popupTeratas()) || satuTombol();
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        btn.click();
    }, true);
})();
