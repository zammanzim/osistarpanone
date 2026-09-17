// =========================================================================
// FORM PUBLIK — halaman root /form (tanpa login)
// Isi formulir audience=publik via ?id=slug atau ?isi=id. Kirim sebagai
// anonim (userId null). Gagal dibaca → pesan ramah, bukan redirect.
// =========================================================================

const FormPublik = {
    form: null,
    questions: [],
    answers: {},
    files: {},
    fileUrls: {},
    fileTarget: null,

    async init() {
        const params = new URLSearchParams(location.search);
        const ref = (params.get("id") || params.get("isi") || "").trim();
        if (!ref) {
            FormPublik.gagal("Link formulir tidak valid.");
            return;
        }
        FormPublik.bind();
        try {
            const forms = await getFormulir();
            const key = ref.toLowerCase();
            const f = forms.find(x => String(x.id) === String(ref) || String(x.settings?.audience || "osis") && String(x.slug || "").toLowerCase() === key);
            if (!f) {
                FormPublik.gagal("Formulir tidak ditemukan. Cek lagi link-nya ya.");
                return;
            }
            const aud = (f.settings && f.settings.audience) || "osis";
            if (f.status !== "aktif") {
                FormPublik.gagal("Formulir sudah ditutup.", "Responden tidak dapat mengisi lagi. Hubungi pengurus OSIS untuk info lebih lanjut.");
                return;
            }
            if (aud !== "publik") {
                FormPublik.gagal("Formulir khusus OSIS.", "Form ini hanya bisa diisi anggota OSIS yang sudah login.", true);
                return;
            }
            let qs = await getPertanyaan(f.id);
            qs = qs.map((q, i) => ({ ...q, key: "q" + q.id + "_" + i }));
            if (f.settings && f.settings.acak) qs = [...qs].sort(() => Math.random() - 0.5);
            FormPublik.form = f;
            FormPublik.questions = qs;
            document.title = (f.judul || "Formulir") + " — OSIS TARPAN ONE";
            document.getElementById("pubJudul").textContent = f.judul || "Tanpa judul";
            document.getElementById("pubDeskripsi").textContent = f.deskripsi || "";
            FormPublik.render();
        } catch (err) {
            console.error(err);
            FormPublik.gagal("Gagal memuat formulir. Cek koneksi lalu refresh.");
        }
    },

    gagal(judul, sub, loginLink) {
        document.getElementById("pubJudul").textContent = judul;
        document.getElementById("pubDeskripsi").textContent = sub || "";
        document.getElementById("pubBody").innerHTML = loginLink
            ? `<div class="fcard" style="text-align:center"><a class="btn btn-red" href="../login"><i class="fa-solid fa-right-to-bracket"></i> Login OSIS</a></div>`
            : "";
        const btn = document.getElementById("btnPubKirim");
        if (btn) btn.style.display = "none";
    },

    bind() {
        document.getElementById("btnPubKirim")?.addEventListener("click", () => FormPublik.kirim());
        document.getElementById("pubBody")?.addEventListener("click", (e) => {
            const star = e.target.closest("[data-star]");
            if (star) {
                Object.assign(FormPublik.answers, FormPublik.bacaDOM());
                FormPublik.answers[star.dataset.qkey] = parseInt(star.dataset.star, 10);
                FormPublik.render();
                return;
            }
            const fbtn = e.target.closest("[data-filebtn]");
            if (fbtn) {
                FormPublik.fileTarget = fbtn.dataset.filebtn;
                document.getElementById("pubFileInput").click();
            }
        });
        document.getElementById("pubFileInput")?.addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = "";
            if (f && FormPublik.fileTarget) {
                const key = FormPublik.fileTarget;
                const old = FormPublik.fileUrls[key];
                if (old) { try { URL.revokeObjectURL(old); } catch {} }
                FormPublik.files[key] = f;
                if ((f.type || "").startsWith("image/")) FormPublik.fileUrls[key] = URL.createObjectURL(f);
                else delete FormPublik.fileUrls[key];
                FormPublik.fileTarget = null;
                FormPublik.render();
            }
        });
    },

    esc(s) {
        return escapeHtml(s ?? "");
    },

    fmtBytes(b) {
        b = parseInt(b, 10) || 0;
        if (!b) return "—";
        if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
        return (b / 1048576).toFixed(1) + " MB";
    },

    render() {
        const body = document.getElementById("pubBody");
        body.innerHTML = FormPublik.questions.map((q, i) => `
            <div class="fcard"><div class="isi-q">
                <label>${i + 1}. ${FormPublik.esc(q.teks || "Tanpa pertanyaan")} ${q.wajib ? '<span class="wajib-star" style="color:var(--red)">*</span>' : ""}</label>
                ${FormPublik.input(q)}
            </div></div>`).join("");
    },

    input(q) {
        const key = q.key;
        const ans = FormPublik.answers[key];
        const esc = (s) => escapeHtml(s ?? "");
        if (q.tipe === "short") return `<input type="text" data-jawab="${key}" value="${esc(ans)}" placeholder="Jawaban singkat">`;
        if (q.tipe === "paragraf") return `<textarea data-jawab="${key}" placeholder="Tulis jawaban...">${esc(ans)}</textarea>`;
        if (q.tipe === "radio") {
            const opsi = Array.isArray(q.opsi) ? q.opsi : [];
            return opsi.map(op => `<label class="isi-opt"><input type="radio" name="jw_${key}" data-jawab-radio="${key}" value="${esc(op)}" ${ans === op ? "checked" : ""}> ${esc(op)}</label>`).join("");
        }
        if (q.tipe === "checkbox") {
            const opsi = Array.isArray(q.opsi) ? q.opsi : [];
            const cur = Array.isArray(ans) ? ans : [];
            return opsi.map(op => `<label class="isi-opt"><input type="checkbox" data-jawab-check="${key}" value="${esc(op)}" ${cur.includes(op) ? "checked" : ""}> ${esc(op)}</label>`).join("");
        }
        if (q.tipe === "dropdown") {
            const opsi = Array.isArray(q.opsi) ? q.opsi : [];
            return `<select data-jawab="${key}"><option value="">— Pilih —</option>${opsi.map(op => `<option value="${esc(op)}" ${ans === op ? "selected" : ""}>${esc(op)}</option>`).join("")}</select>`;
        }
        if (q.tipe === "skala") {
            const c = q.config || {};
            const min = [0, 1].includes(parseInt(c.min, 10)) ? parseInt(c.min, 10) : 1;
            const max = Math.max(min + 1, Math.min(10, parseInt(c.max, 10) || 5));
            let h = `<div class="skala-row">`;
            for (let v = min; v <= max; v++) {
                h += `<label class="skala-opt"><span>${v}</span><input type="radio" name="jw_${key}" data-jawab-radio="${key}" value="${v}" ${String(ans) === String(v) ? "checked" : ""}></label>`;
            }
            return h + `</div><div class="skala-labels"><span>${esc(c.label_min || "")}</span><span>${esc(c.label_max || "")}</span></div>`;
        }
        if (q.tipe === "rating") {
            const max = Math.max(3, Math.min(10, parseInt((q.config || {}).max, 10) || 5));
            const cur = parseInt(ans, 10) || 0;
            let h = `<div class="rate-pick">`;
            for (let v = 1; v <= max; v++) h += `<button type="button" data-star="${v}" data-qkey="${key}" class="${v <= cur ? "on" : ""}">☆</button>`;
            return h + `</div>`;
        }
        if (q.tipe === "tanggal") return `<input type="date" data-jawab="${key}" value="${esc(ans)}">`;
        if (q.tipe === "file") {
            const c = q.config || {};
            const f = FormPublik.files[key];
            let info = "";
            if (f) {
                const url = FormPublik.fileUrls[key];
                const prev = url ? `<img src="${url}" alt="" style="width:72px; height:72px; object-fit:cover; border:2px solid var(--ink); border-radius:10px; flex-shrink:0">` : `<i class="fa-solid fa-file" style="font-size:1.4rem; color:var(--red)"></i>`;
                info = `<div class="detail-text" style="margin-top:6px; display:flex; gap:10px; align-items:center">${prev}<div style="min-width:0"><div style="overflow-wrap:anywhere">${esc(f.name)}</div><small style="color:var(--gray)">${FormPublik.fmtBytes(f.size)}</small></div></div>`;
            }
            return `<button type="button" class="btn btn-white btn-sm" data-filebtn="${key}"><i class="fa-solid fa-upload"></i> ${f ? "Ganti file" : "Pilih file"}</button>
                <div style="font-size:.7rem; color:var(--gray); font-weight:600; margin-top:4px">${esc(c.types || "Semua tipe")} · Maks ${esc(c.max_mb || 10)} MB</div>${info}`;
        }
        return `<input type="text" data-jawab="${key}" value="${esc(ans)}">`;
    },

    bacaDOM() {
        const out = {};
        document.querySelectorAll("[data-jawab]").forEach(el => {
            out[el.dataset.jawab] = el.value;
        });
        document.querySelectorAll("[data-jawab-radio]:checked").forEach(el => {
            out[el.dataset.jawabRadio] = el.value;
        });
        document.querySelectorAll("[data-jawab-check]").forEach(el => {
            const k = el.dataset.jawabCheck;
            if (!out[k]) out[k] = [];
            if (el.checked) out[k].push(el.value);
        });
        FormPublik.questions.forEach(q => {
            if (q.tipe === "rating" && FormPublik.answers[q.key]) out[q.key] = FormPublik.answers[q.key];
        });
        return out;
    },

    async kirim() {
        const f = FormPublik.form;
        if (!f) return;
        const jawaban = FormPublik.bacaDOM();

        for (const q of FormPublik.questions) {
            if (!q.wajib) continue;
            const v = jawaban[q.key];
            const kosong = v === undefined || v === "" || (Array.isArray(v) && !v.length) || (q.tipe === "file" && !FormPublik.files[q.key]);
            if (kosong) {
                showToast(`"${(q.teks || "").slice(0, 40)}" wajib diisi`, "error");
                return;
            }
        }
        for (const q of FormPublik.questions) {
            if (q.tipe !== "file" || !FormPublik.files[q.key]) continue;
            const fl = FormPublik.files[q.key];
            const maxMb = parseInt((q.config || {}).max_mb, 10) || 10;
            if (fl.size > maxMb * 1024 * 1024) {
                showToast(`"${fl.name}" melebihi ${maxMb}MB`, "error");
                return;
            }
            const allow = String((q.config || {}).types || "").toUpperCase().replace(/\s+/g, "").split(",").filter(Boolean);
            if (allow.length) {
                const ext = (fl.name.split(".").pop() || "").toUpperCase();
                const mimeOk = allow.some(a => (fl.type || "").toUpperCase().includes(a));
                if (!allow.includes(ext) && !mimeOk) {
                    showToast(`"${fl.name}" harus: ${(q.config || {}).types}`, "error");
                    return;
                }
            }
        }

        const btn = document.getElementById("btnPubKirim");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...'; }
        try {
            for (const q of FormPublik.questions) {
                if (q.tipe !== "file" || !FormPublik.files[q.key]) continue;
                const fl = FormPublik.files[q.key];
                const ext = (fl.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
                const path = `formulir/f-${f.id}-${Date.now()}.${ext}`;
                await uploadFotoStorage(fl, path);
                jawaban[q.key] = { nama: fl.name, path, ukuran: fl.size };
            }
            const bersih = {};
            FormPublik.questions.forEach(q => {
                const qid = q.id || q.key;
                if (jawaban[q.key] !== undefined) bersih[String(qid)] = jawaban[q.key];
            });
            const multi = f.settings ? f.settings.multi_isi !== false : true;
            const flagKey = "form_isi_" + f.id;
            if (!multi) {
                try {
                    if (localStorage.getItem(flagKey)) {
                        showToast("Kamu sudah mengisi form ini (1x saja).", "error");
                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim'; }
                        return;
                    }
                } catch {}
            }
            await kirimRespons(f.id, bersih, null);
            try { localStorage.setItem(flagKey, "1"); } catch {}
            const pesan = (f.settings && f.settings.pesan_sukses) || "Terima kasih, respons kamu telah berhasil dikirim.";
            document.getElementById("pubBody").innerHTML = `<div class="fcard" style="text-align:center; padding:30px 18px"><div style="font-size:2.4rem; color:#146314"><i class="fa-solid fa-circle-check"></i></div><h3 style="font-size:1rem; font-weight:900; margin-top:8px">Terkirim!</h3><p style="font-size:.84rem; color:var(--gray); font-weight:600">${escapeHtml(pesan)}</p></div>`;
            if (btn) btn.style.display = "none";
        } catch (err) {
            console.error(err);
            const code = String(err.message || "");
            if (code.includes("-2")) FormPublik.gagal("Formulir sudah ditutup.");
            else if (code.includes("-3")) FormPublik.gagal("Kuota respons sudah penuh.");
            else showToast("Gagal kirim: " + err.message, "error");
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim'; }
        }
    }
};

document.addEventListener("DOMContentLoaded", () => FormPublik.init());
