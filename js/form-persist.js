// =========================================================================
// FORM PERSIST — draft otomatis semua form OSIS (folder /osis)
// Tiap ngisi form (dimana aja) otomatis kesimpen ke localStorage.
// Kalo user ga sengaja tutup popup / refresh browser, draft balik lagi.
// Draft BARU dihapus setelah sukses simpan (upload) via FormPersist.clear().
// File input (foto/bukti) TIDAK bisa dipersist — browser melarang, di-skip.
// Cara pakai per halaman (2 langkah):
//   1) di init(): FormPersist.watch("kasForm", {
//        fields: ["kasTanggal","kasNominal",...],
//        collect: () => ({ jenis: Keuangan.jenisForm }),
//        restore: (d) => Keuangan.setJenis(d.jenis),
//        isEditing: () => !!Keuangan.editingId });
//   2) di bukaForm() mode tambah: FormPersist.restoreToForm(...) / load manual
//      lalu di simpan() sukses: FormPersist.clear("kasForm");
// =========================================================================

const FormPersist = {
    PREFIX: "osis_draft_v1_",
    _timers: {},

    // Kunci unik per halaman + form, biar draft absensi ga ketuker sama kas.
    // cth: "osis_draft_v1_absensi_absensiForm"
    key(formId) {
        let page = "umum";
        try {
            const seg = (location.pathname.split("/").pop() || "").toLowerCase().replace(/\.html?$/, "");
            if (seg) page = seg;
        } catch {}
        return FormPersist.PREFIX + page + "_" + formId;
    },

    save(formId, data) {
        try {
            localStorage.setItem(FormPersist.key(formId), JSON.stringify({ t: Date.now(), data: data || {} }));
        } catch {}
    },

    load(formId) {
        try {
            const raw = localStorage.getItem(FormPersist.key(formId));
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || !obj.data) return null;
            // buang draft basi > 7 hari biar storage ga penuh sampah
            if (obj.t && Date.now() - obj.t > 7 * 24 * 3600 * 1000) {
                FormPersist.clear(formId);
                return null;
            }
            return obj.data;
        } catch { return null; }
    },

    clear(formId) {
        try { localStorage.removeItem(FormPersist.key(formId)); } catch {}
    },

    has(formId) {
        return !!FormPersist.load(formId);
    },

    // Ambil nilai semua field sederhana by id (input/select/textarea).
    // Checkbox/radio pakai checked, lainnya pakai value. File di-skip.
    collectFields(fieldIds) {
        const out = {};
        (fieldIds || []).forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.type === "file") return;
            if (el.type === "checkbox" || el.type === "radio") out[id] = !!el.checked;
            else out[id] = el.value ?? "";
        });
        return out;
    },

    // Isi kembali field sederhana by id. Return true kalau ada yg keisi.
    fillFields(data) {
        if (!data) return false;
        let n = 0;
        Object.keys(data).forEach(id => {
            // hanya field sederhana (string/number/boolean), sisanya ditangani via restore()
            const v = data[id];
            if (v !== null && typeof v === "object") return;
            const el = document.getElementById(id);
            if (!el || el.type === "file") return;
            try {
                if (el.type === "checkbox" || el.type === "radio") el.checked = !!v;
                else if (typeof v === "string" || typeof v === "number") { el.value = v; n++; }
            } catch {}
        });
        return n > 0;
    },

    // Pantau form: tiap ketik / ganti / tambah-hapus baris dinamis -> save.
    // opts: { fields:[id...], collect:()=>obj, restore:(draft)=>void,
    //         isEditing:()=>bool, observe:"selector anak dinamis", debounce:ms }
    watch(formId, opts) {
        const o = opts || {};
        if (!document.getElementById(formId)) return;
        // cegah double-watch kalau init() kepanggil 2x
        if (document.getElementById(formId).dataset.persistBound === "1") return;
        document.getElementById(formId).dataset.persistBound = "1";

        const simpanSekarang = () => {
            try {
                if (typeof o.isEditing === "function" && o.isEditing()) return;
                const data = FormPersist.collectFields(o.fields);
                if (typeof o.collect === "function") {
                    const extra = o.collect() || {};
                    Object.keys(extra).forEach(k => { data[k] = extra[k]; });
                }
                // jangan simpen draft kosong melompong (semua string kosong + array kosong)
                FormPersist.save(formId, data);
            } catch {}
        };
        const jadwal = () => {
            clearTimeout(FormPersist._timers[formId]);
            FormPersist._timers[formId] = setTimeout(simpanSekarang, o.debounce || 300);
        };

        // 1) tiap input/change di dalam form
        document.getElementById(formId).addEventListener("input", jadwal);
        document.getElementById(formId).addEventListener("change", jadwal);
        // 2) tambah/hapus baris dinamis (cth: #absensiRows) — input event ga kecover
        if (o.observe) {
            const target = document.querySelector(o.observe);
            if (target && typeof MutationObserver !== "undefined") {
                new MutationObserver(() => jadwal()).observe(target, { childList: true, subtree: false });
            }
        }
        // helper biar halaman bisa panggil save manual (cth: habis tambahBaris)
        document.getElementById(formId)._persistSave = simpanSekarang;
    },

    // Panggil manual setelah aksi non-input (tambah/hapus baris dinamis).
    touch(formId) {
        try {
            const el = document.getElementById(formId);
            if (el && typeof el._persistSave === "function") el._persistSave();
        } catch {}
    }
};
