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

        // Animasi masuk + auto focus buat form
        setTimeout(() => {
            overlay.classList.add('active');
            if (type === 'form') {
                const firstInput = overlay.querySelector('input');
                if (firstInput) {
                    firstInput.focus();
                    firstInput.select();
                }
            }
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
//   #visitorOverlay, #prestasiFormOverlay, dan form/detail admin OSIS
//   (#agendaForm, #absensiForm, #absenLangsung, #kasForm, #kasDetail,
//    #tabForm, #tabDetail, #dokumenForm, #dokumenDetail, #evaluasiForm,
//    #evaluasiDetail, #notulensiForm, #notulensiDetail, #prokerForm,
//    #prokerDetail, #taskForm, #taskDetail, #anggotaPopup, #sekbidPopup)
// File ini dimuat di semua halaman (publik + osis + osisbin), jadi satu
// tempat ini cukup untuk meng-cover semuanya tanpa edit tiap modul:
//   - ESC (cadangan untuk popup yang belum punya handler sendiri)
//   - klik area kosong (sudah ada di tiap modul; tidak diubah)
//   - tombol back HP (otomatis via MutationObserver + popstate)
// =========================================================================
window.ModalNav = (function () {
    const IDS = [
        "visitorOverlay", "prestasiFormOverlay",
        "agendaForm", "absensiForm", "absenLangsung",
        "kasForm", "kasDetail", "tabForm", "tabDetail",
        "dokumenForm", "dokumenDetail", "evaluasiForm", "evaluasiDetail",
        "notulensiForm", "notulensiDetail", "prokerForm", "prokerDetail",
        "taskForm", "taskDetail", "anggotaPopup", "sekbidPopup"
    ];

    const ambil = (nama) => (typeof window[nama] !== "undefined" ? window[nama] : null);

    function terbuka() {
        const out = [];
        IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (id === "prestasiFormOverlay") out.push(el); // ada di DOM = terbuka
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
                case "agendaForm": {
                    const A = ambil("AgendaAdmin");
                    if (A && A.tutupForm) { A.tutupForm(); return; }
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
            }
        } catch (err) { /* jatuh ke fallback */ }
        const el = document.getElementById(id);
        if (el) {
            if (el.classList) el.classList.remove("open");
            if (id === "prestasiFormOverlay" && el.parentNode) el.parentNode.removeChild(el);
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
