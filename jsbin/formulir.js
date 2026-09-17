// =========================================================================
// FORMULIR — form builder general-purpose (folder /osis)
// Dipakai di osis/formulir.html — 4 view: daftar, builder, isi (?isi=ID
// buat responden, boleh guest), respons. Tulis via RPC simpan_formulir
// (form + pertanyaan sekaligus), hapus_formulir, kirim_respons.
// =========================================================================

const Formulir = {
    view: "daftar",
    cache: [],        // [{...form, jml_pertanyaan, jml_respons}]
    builder: null,    // { id, judul, deskripsi, status, settings, questions: [{key,id,tipe,teks,opsi,wajib,config}] }
    isi: null,        // { form, questions, answers, files, preview, fromBuilder }
    responsCache: [],
    keySeq: 0,

    TIPE: [
        ["short", "Jawaban singkat", "fa-solid fa-minus"],
        ["paragraf", "Paragraf", "fa-solid fa-align-left"],
        ["radio", "Pilihan ganda", "fa-regular fa-circle-dot"],
        ["checkbox", "Checkbox", "fa-regular fa-square-check"],
        ["dropdown", "Dropdown", "fa-solid fa-caret-down"],
        ["skala", "Skala linear", "fa-solid fa-sliders"],
        ["rating", "Rating", "fa-solid fa-star"],
        ["tanggal", "Tanggal", "fa-solid fa-calendar"],
        ["file", "Upload file", "fa-solid fa-file-arrow-up"]
    ],

    tipeLabel(t) {
        const f = Formulir.TIPE.find(x => x[0] === t);
        return f ? f[1] : t;
    },

    async init() {
        const params = new URLSearchParams(location.search);
        const isiSlug = params.get("id");
        const isiId = params.get("isi");
        const u = OsisAuth.getUser && OsisAuth.getUser();

        // mode isi (responden): ?id=slug custom atau ?isi=id angka.
        // boleh guest maupun osis, tapi harus login dulu
        if (isiSlug || isiId) {
            if (!u) { location.replace("../login"); return; }
            Formulir.bindIsi();
            await Formulir.bukaIsi(isiSlug || isiId, false);
            return;
        }

        // mode kelola: khusus OSIS
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        Formulir.bindDaftar();
        Formulir.bindBuilder();
        Formulir.bindIsi();
        await Formulir.muatDaftar();
    },

    show(view) {
        Formulir.view = view;
        ["viewDaftar", "viewBuilder", "viewIsi", "viewRespons"].forEach(id => {
            document.getElementById(id).style.display = "none";
        });
        const map = { daftar: "viewDaftar", builder: "viewBuilder", isi: "viewIsi", respons: "viewRespons" };
        document.getElementById(map[view]).style.display = "flex";
        window.scrollTo({ top: 0 });
    },

    // ============ DAFTAR ============
    bindDaftar() {
        document.getElementById("btnBuatForm")?.addEventListener("click", () => Formulir.baru());
        document.getElementById("formList")?.addEventListener("click", async (e) => {
            const btn = e.target.closest("[data-aksi]");
            if (!btn) return;
            const id = btn.dataset.id;
            const aksi = btn.dataset.aksi;
            if (aksi === "edit") Formulir.bukaBuilder(id);
            else if (aksi === "lihat") Formulir.lihatForm(id);
            else if (aksi === "respons") Formulir.bukaRespons(id);
            else if (aksi === "hapus") Formulir.hapus(id);
            else if (aksi === "salin") Formulir.salinLink(id);
        });
    },

    async muatDaftar() {
        const wrap = document.getElementById("formList");
        if (wrap) wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat formulir...</div>`;
        try {
            const cached = Cache.get("formulir");
            const render = async (forms) => {
                // hitung pertanyaan + respons per form (background, fail silent)
                const rows = await Promise.all((forms || []).map(async (f) => {
                    let jp = 0, jr = 0;
                    try {
                        const qs = await getPertanyaan(f.id);
                        jp = qs.length;
                    } catch {}
                    try {
                        const rs = await getRespons(f.id);
                        jr = rs.length;
                    } catch {}
                    return { ...f, jml_pertanyaan: jp, jml_respons: jr };
                }));
                Formulir.cache = rows;
                Formulir.renderDaftar();
            };
            if (cached) {
                render(cached);
                getFormulir().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("formulir", fresh);
                        render(fresh);
                    }
                }).catch(() => {});
                return;
            }
            const data = await getFormulir();
            Cache.set("formulir", data);
            await render(data);
        } catch (err) {
            console.error(err);
            if (wrap) wrap.innerHTML = `<div class="pesan-empty">Gagal memuat formulir.</div>`;
        }
    },

    renderDaftar() {
        const wrap = document.getElementById("formList");
        if (!wrap) return;
        const data = Formulir.cache || [];
        if (!data.length) {
            wrap.innerHTML = `<div class="pesan-empty" style="grid-column:1/-1; background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:28px 16px; text-align:center"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-clipboard-question" style="color:var(--red)"></i></div><b>Belum ada formulir</b><p style="font-size:0.8rem; color:var(--gray); margin:6px 0 12px">Mulai buat formulir pertama untuk mengumpulkan data dari siswa atau pengurus.</p><button class="btn btn-red btn-sm" onclick="document.getElementById('btnBuatForm').click()"><i class="fa-solid fa-plus"></i> Buat Formulir</button></div>`;
            return;
        }
        const stLbl = { draft: "Draft", aktif: "Aktif", ditutup: "Ditutup" };
        wrap.innerHTML = data.map(f => `
            <div class="form-card">
                <div style="display:flex; align-items:center; gap:8px">
                    <h4 style="flex:1">${escapeHtml(f.judul || "Tanpa judul")}</h4>
                    <span class="status-badge ${f.status}"><span class="status-dot"></span>${stLbl[f.status] || f.status}</span>
                </div>
                ${f.deskripsi ? `<div class="desc">${escapeHtml(f.deskripsi.length > 120 ? f.deskripsi.slice(0, 120) + "…" : f.deskripsi)}</div>` : ""}
                <div class="meta">
                    <span><i class="fa-solid fa-list"></i> ${f.jml_pertanyaan || 0} pertanyaan</span>
                    <span><i class="fa-solid fa-inbox"></i> ${f.jml_respons || 0} respons</span>
                    <span><i class="fa-solid fa-${(f.settings && f.settings.audience) === "publik" ? "globe" : "lock"}"></i> ${((f.settings && f.settings.audience) === "publik" ? "Publik" : "OSIS")}</span>
                </div>
                <div class="meta"><span><i class="fa-solid fa-clock"></i> ${Formulir.fmtWaktu(f.updated_at)}</span></div>
                <div class="actions">
                    <button class="btn btn-white btn-sm" data-aksi="edit" data-id="${f.id}"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn btn-white btn-sm" data-aksi="lihat" data-id="${f.id}"><i class="fa-solid fa-eye"></i> Lihat Form</button>
                    <button class="btn btn-white btn-sm" data-aksi="respons" data-id="${f.id}"><i class="fa-solid fa-inbox"></i> Respons</button>
                    <button class="btn btn-red btn-sm" data-aksi="hapus" data-id="${f.id}"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>`).join("");
    },

    fmtWaktu(t) {
        if (!t) return "-";
        try {
            return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch { return "-"; }
    },

    audienceOf(id) {
        if (Formulir.builder && String(Formulir.builder.id) === String(id)) {
            return (Formulir.builder.settings && Formulir.builder.settings.audience) || "osis";
        }
        const f = (Formulir.cache || []).find(x => String(x.id) === String(id));
        return (f && f.settings && f.settings.audience) || "osis";
    },

    shareUrl(id) {
        const slug = Formulir.slugOf(id);
        const q = slug ? "?id=" + encodeURIComponent(slug) : "?isi=" + id;
        // form publik → halaman osis/form (tanpa login), selain itu link halaman OSIS ini
        if (Formulir.audienceOf(id) === "publik") {
            return location.href.split("?")[0].replace(/formulir$/, "form") + q;
        }
        return location.href.split("?")[0] + q;
    },

    slugOf(id) {
        if (Formulir.builder && String(Formulir.builder.id) === String(id)) {
            return (Formulir.builder.slug || "").trim();
        }
        const f = (Formulir.cache || []).find(x => String(x.id) === String(id));
        return f ? ((f.slug || "").trim()) : "";
    },

    salinLink(id) {
        const url = Formulir.shareUrl(id);
        const done = () => showToast("Link disalin!", "success");
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done).catch(() => showToast(url, "info"));
        } else {
            showPopup(url, "info");
        }
    },

    async hapus(id) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        const item = Formulir.cache.find(f => String(f.id) === String(id));
        const yakin = await showPopup(`Hapus formulir "${item ? item.judul : ""}"? Pertanyaan & respons ikut terhapus.`, "confirm");
        if (!yakin) return;
        try {
            await hapusFormulir(u.id, id);
            showToast("Formulir dihapus", "success");
            await Formulir.muatDaftar();
        } catch (err) {
            console.error(err);
            showPopup("Gagal hapus: " + err.message, "error");
        }
    },

    async lihatForm(id) {
        const item = Formulir.cache.find(f => String(f.id) === String(id));
        if (!item) return;
        if (item.status === "aktif") {
            const url = Formulir.shareUrl(id);
            if (Formulir.audienceOf(id) === "publik") window.open(url, "_blank");
            else location.href = url;
            return;
        }
        // belum aktif → preview dari data tersimpan
        await Formulir.bukaBuilder(id, true);
    },

    // ============ BUILDER ============
    bindBuilder() {
        document.getElementById("btnKembaliDaftar")?.addEventListener("click", () => {
            Formulir.show("daftar");
            Formulir.muatDaftar();
        });
        document.getElementById("btnSimpanBuilder")?.addEventListener("click", () => Formulir.simpanBuilder(false));
        document.getElementById("btnPublish")?.addEventListener("click", () => Formulir.publish());
        document.getElementById("btnPreview")?.addEventListener("click", () => Formulir.previewDariBuilder());
        document.getElementById("btnStatusAktif")?.addEventListener("click", () => Formulir.setStatusBuilder("aktif"));
        document.getElementById("btnStatusTutup")?.addEventListener("click", () => Formulir.setStatusBuilder("ditutup"));
        document.getElementById("btnSalinLink")?.addEventListener("click", () => {
            if (Formulir.builder && Formulir.builder.id) Formulir.salinLink(Formulir.builder.id);
        });
        document.getElementById("setAudience")?.addEventListener("change", () => {
            if (!Formulir.builder) return;
            Formulir.builder.settings.audience = document.getElementById("setAudience").value;
            Formulir.renderBuilderMeta();
        });
        document.getElementById("btnSimpanSlug")?.addEventListener("click", () => Formulir.simpanSlug());
        // grid tombol tambah tipe
        const grid = document.getElementById("addqGrid");
        if (grid) {
            grid.innerHTML = Formulir.TIPE.map(t => `<button class="addq-btn" data-tipe="${t[0]}"><i class="${t[2]}"></i>${t[1]}</button>`).join("");
            grid.addEventListener("click", (e) => {
                const b = e.target.closest("[data-tipe]");
                if (b) Formulir.tambahPertanyaan(b.dataset.tipe);
            });
        }
        // delegasi kartu pertanyaan
        const list = document.getElementById("builderList");
        if (list) {
            list.addEventListener("click", (e) => {
                const card = e.target.closest("[data-q]");
                const optDel = e.target.closest("[data-opt-del]");
                if (optDel && card) {
                    Formulir.syncBuilderDOM();
                    const q = Formulir.findQ(card.dataset.q);
                    if (q) {
                        q.opsi.splice(parseInt(optDel.dataset.optDel, 10), 1);
                        Formulir.renderBuilder();
                    }
                    return;
                }
                const addOpt = e.target.closest("[data-add-opt]");
                if (addOpt && card) {
                    Formulir.syncBuilderDOM();
                    const q = Formulir.findQ(card.dataset.q);
                    if (q) {
                        q.opsi.push(`Opsi ${q.opsi.length + 1}`);
                        Formulir.renderBuilder();
                    }
                    return;
                }
                const btn = e.target.closest("[data-qaksi]");
                if (!btn || !card) return;
                const key = card.dataset.q;
                const aksi = btn.dataset.qaksi;
                Formulir.syncBuilderDOM();
                if (aksi === "dup") Formulir.duplikatQ(key);
                else if (aksi === "del") Formulir.hapusQ(key);
                else if (aksi === "up") Formulir.geserQ(key, -1);
                else if (aksi === "down") Formulir.geserQ(key, 1);
            });
            list.addEventListener("change", (e) => {
                if (e.target.matches(".q-tipe") || e.target.matches(".q-wajib")) {
                    Formulir.syncBuilderDOM();
                    Formulir.renderBuilder();
                }
            });
        }
    },

    baru() {
        Formulir.builder = {
            id: null, judul: "", deskripsi: "", status: "draft", slug: "",
            settings: { batas_respons: 0, multi_isi: true, acak: false, pesan_sukses: "Terima kasih, respons kamu telah berhasil dikirim.", simpan_waktu: true, audience: "osis" },
            questions: []
        };
        Formulir.renderBuilderMeta();
        Formulir.renderBuilder();
        Formulir.show("builder");
        setTimeout(() => document.getElementById("bJudul")?.focus(), 60);
    },

    async bukaBuilder(id, langsungPreview) {
        try {
            const forms = await getFormulir();
            const f = forms.find(x => String(x.id) === String(id));
            if (!f) { showToast("Formulir tidak ditemukan", "error"); return; }
            const qs = await getPertanyaan(id);
            Formulir.builder = {
                id: f.id, judul: f.judul || "", deskripsi: f.deskripsi || "", status: f.status || "draft", slug: f.slug || "",
                settings: { batas_respons: 0, multi_isi: true, acak: false, pesan_sukses: "Terima kasih, respons kamu telah berhasil dikirim.", simpan_waktu: true, audience: "osis", ...(f.settings || {}) },
                questions: qs.map(q => ({
                    key: "db" + q.id, id: q.id, tipe: q.tipe, teks: q.teks || "",
                    opsi: Array.isArray(q.opsi) ? [...q.opsi] : [],
                    wajib: !!q.wajib, config: { ...(q.config || {}) }
                }))
            };
            Formulir.renderBuilderMeta();
            Formulir.renderBuilder();
            Formulir.show("builder");
            if (langsungPreview) Formulir.previewDariBuilder();
        } catch (err) {
            console.error(err);
            showToast("Gagal buka builder: " + err.message, "error");
        }
    },

    findQ(key) {
        return (Formulir.builder.questions || []).find(q => q.key === key);
    },

    blankQ(tipe) {
        const cfg = {};
        let opsi = [];
        if (["radio", "checkbox", "dropdown"].includes(tipe)) opsi = ["Opsi 1"];
        if (tipe === "skala") Object.assign(cfg, { min: 1, max: 5, label_min: "Sangat Tidak Puas", label_max: "Sangat Puas" });
        if (tipe === "rating") Object.assign(cfg, { max: 5 });
        if (tipe === "file") Object.assign(cfg, { types: "PDF, JPG, PNG", max_mb: 10 });
        return { key: "n" + (++Formulir.keySeq) + Date.now().toString(36), id: null, tipe, teks: "", opsi, wajib: false, config: cfg };
    },

    tambahPertanyaan(tipe) {
        if (!Formulir.builder) return;
        Formulir.syncBuilderDOM();
        Formulir.builder.questions.push(Formulir.blankQ(tipe));
        Formulir.renderBuilder();
        const cards = document.querySelectorAll("#builderList .q-card");
        const last = cards[cards.length - 1];
        if (last) {
            last.scrollIntoView({ behavior: "smooth", block: "center" });
            last.querySelector(".q-teks")?.focus();
        }
    },

    duplikatQ(key) {
        const qs = Formulir.builder.questions;
        const i = qs.findIndex(q => q.key === key);
        if (i < 0) return;
        const cp = JSON.parse(JSON.stringify(qs[i]));
        cp.key = "n" + (++Formulir.keySeq) + Date.now().toString(36);
        cp.id = null;
        qs.splice(i + 1, 0, cp);
        Formulir.renderBuilder();
    },

    hapusQ(key) {
        Formulir.builder.questions = Formulir.builder.questions.filter(q => q.key !== key);
        Formulir.renderBuilder();
    },

    geserQ(key, arah) {
        const qs = Formulir.builder.questions;
        const i = qs.findIndex(q => q.key === key);
        const j = i + arah;
        if (i < 0 || j < 0 || j >= qs.length) return;
        [qs[i], qs[j]] = [qs[j], qs[i]];
        Formulir.renderBuilder();
    },

    // baca seluruh DOM builder kembali ke state (dipanggil sebelum mutasi/save)
    syncBuilderDOM() {
        const b = Formulir.builder;
        if (!b) return;
        b.judul = document.getElementById("bJudul").value;
        b.deskripsi = document.getElementById("bDeskripsi").value;
        b.settings = {
            batas_respons: parseInt(document.getElementById("setBatas").value, 10) || 0,
            multi_isi: document.getElementById("setMulti").checked,
            acak: document.getElementById("setAcak").checked,
            pesan_sukses: document.getElementById("setPesan").value,
            simpan_waktu: document.getElementById("setWaktu").checked,
            audience: document.getElementById("setAudience").value || "osis"
        };
        document.querySelectorAll("#builderList .q-card").forEach(card => {
            const q = Formulir.findQ(card.dataset.q);
            if (!q) return;
            q.teks = card.querySelector(".q-teks").value;
            q.tipe = card.querySelector(".q-tipe").value;
            q.wajib = card.querySelector(".q-wajib").checked;
            q.opsi = [...card.querySelectorAll(".q-opt input")].map(i => i.value);
            const cfg = {};
            card.querySelectorAll("[data-cfg]").forEach(inp => {
                cfg[inp.dataset.cfg] = inp.value;
            });
            q.config = cfg;
        });
    },

    renderBuilderMeta() {
        const b = Formulir.builder;
        if (!b) return;
        document.getElementById("bJudul").value = b.judul || "";
        document.getElementById("bDeskripsi").value = b.deskripsi || "";
        const s = b.settings || {};
        document.getElementById("setBatas").value = s.batas_respons ?? 0;
        document.getElementById("setMulti").checked = s.multi_isi !== false;
        document.getElementById("setAcak").checked = !!s.acak;
        document.getElementById("setWaktu").checked = s.simpan_waktu !== false;
        document.getElementById("setPesan").value = s.pesan_sukses || "Terima kasih, respons kamu telah berhasil dikirim.";
        document.getElementById("setAudience").value = s.audience === "publik" ? "publik" : "osis";
        const badge = document.getElementById("builderStatus");
        if (badge) {
            const lbl = { draft: "Draft", aktif: "Aktif", ditutup: "Ditutup" };
            badge.className = "status-badge " + (b.status || "draft");
            badge.textContent = lbl[b.status] || b.status;
        }
        const pub = document.getElementById("btnPublish");
        if (pub) pub.innerHTML = b.status === "aktif" ? '<i class="fa-solid fa-lock"></i> Tutup Form' : '<i class="fa-solid fa-paper-plane"></i> Publikasikan';
        const share = document.getElementById("shareBox");
        if (share) {
            if (b.id && b.status === "aktif") {
                share.style.display = "";
                document.getElementById("shareLink").value = Formulir.shareUrl(b.id);
            } else {
                share.style.display = "none";
            }
        }
        const slugRow = document.getElementById("slugRow");
        if (slugRow) {
            if (b.id) {
                slugRow.style.display = "";
                const si = document.getElementById("slugInput");
                if (si && document.activeElement !== si) si.value = b.slug || "";
            } else {
                slugRow.style.display = "none";
            }
        }
    },

    renderBuilder() {
        Formulir.renderBuilderMeta();
        const wrap = document.getElementById("builderList");
        if (!wrap) return;
        const qs = Formulir.builder ? Formulir.builder.questions : [];
        if (!qs.length) {
            wrap.innerHTML = `<div class="pesan-empty" style="background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:22px; text-align:center">Belum ada pertanyaan. Klik tipe di bawah buat nambah.</div>`;
            return;
        }
        wrap.innerHTML = qs.map((q, i) => `
            <div class="q-card" data-q="${q.key}">
                <div class="q-top">
                    <span class="q-num">${i + 1}</span>
                    <textarea class="q-teks" placeholder="Tulis pertanyaan...">${escapeHtml(q.teks || "")}</textarea>
                </div>
                <select class="q-tipe">${Formulir.TIPE.map(t => `<option value="${t[0]}" ${q.tipe === t[0] ? "selected" : ""}>${t[1]}</option>`).join("")}</select>
                ${Formulir.areaOpsi(q)}
                ${Formulir.areaConfig(q)}
                <div class="q-foot">
                    <button class="q-icon-btn" data-qaksi="up" title="Naik"><i class="fa-solid fa-arrow-up"></i></button>
                    <button class="q-icon-btn" data-qaksi="down" title="Turun"><i class="fa-solid fa-arrow-down"></i></button>
                    <button class="q-icon-btn" data-qaksi="dup" title="Duplikat"><i class="fa-solid fa-copy"></i></button>
                    <button class="q-icon-btn del" data-qaksi="del" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
                    <label class="wajib">Wajib diisi <input type="checkbox" class="q-wajib" ${q.wajib ? "checked" : ""}></label>
                </div>
            </div>`).join("");
    },

    areaOpsi(q) {
        if (!["radio", "checkbox", "dropdown"].includes(q.tipe)) return "";
        const ikon = q.tipe === "radio" ? "fa-regular fa-circle" : q.tipe === "checkbox" ? "fa-regular fa-square" : "fa-solid fa-caret-down";
        const rows = (q.opsi.length ? q.opsi : [""]).map((op, i) => `
            <div class="q-opt"><i class="${ikon}" style="color:var(--gray)"></i><input type="text" value="${escapeHtml(op)}" placeholder="Opsi ${i + 1}"><button data-opt-del="${i}" title="Hapus opsi"><i class="fa-solid fa-xmark"></i></button></div>`).join("");
        return rows + `<button class="q-add-opt" data-add-opt><i class="fa-solid fa-plus"></i> Tambah opsi</button>`;
    },

    areaConfig(q) {
        const c = q.config || {};
        const inp = (k, v, ph, type) => `<div class="field"><label>${ph}</label><input data-cfg="${k}" type="${type || "text"}" value="${escapeHtml(v ?? "")}"></div>`;
        if (q.tipe === "skala") {
            return `<div class="q-cfg">
                <div class="field"><label>Min</label><select data-cfg="min" style="width:100%; border:2px solid var(--ink); border-radius:10px; padding:8px; font-family:inherit"><option value="0" ${String(c.min) === "0" ? "selected" : ""}>0</option><option value="1" ${String(c.min ?? 1) !== "0" ? "selected" : ""}>1</option></select></div>
                <div class="field"><label>Maks</label><input data-cfg="max" type="number" min="2" max="10" value="${escapeHtml(c.max ?? 5)}"></div>
                ${inp("label_min", c.label_min ?? "Sangat Tidak Puas", "Label minimum")}
                ${inp("label_max", c.label_max ?? "Sangat Puas", "Label maksimum")}
            </div>`;
        }
        if (q.tipe === "rating") {
            return `<div class="q-cfg"><div class="field"><label>Maksimal (5/10)</label><input data-cfg="max" type="number" min="3" max="10" value="${escapeHtml(c.max ?? 5)}"></div></div>`;
        }
        if (q.tipe === "file") {
            return `<div class="q-cfg">
                ${inp("types", c.types ?? "PDF, JPG, PNG", "Tipe diizinkan")}
                <div class="field"><label>Maks MB</label><input data-cfg="max_mb" type="number" min="1" max="20" value="${escapeHtml(c.max_mb ?? 10)}"></div>
            </div>`;
        }
        return "";
    },

    kumpulkanBuilder() {
        Formulir.syncBuilderDOM();
        const b = Formulir.builder;
        const questions = (b.questions || []).map((q, i) => ({
            tipe: q.tipe, teks: (q.teks || "").trim(),
            opsi: (q.opsi || []).map(o => String(o || "").trim()).filter(Boolean),
            wajib: !!q.wajib, config: q.config || {}, urutan: i
        })).filter(q => q.teks);
        return { ...b, questions };
    },

    async simpanBuilder(silent) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return null;
        const data = Formulir.kumpulkanBuilder();
        if (!data.judul.trim()) { showToast("Judul formulir wajib diisi", "error"); return null; }
        try {
            const id = await simpanFormulir(u.id, data.id, data.judul, data.deskripsi, data.status, data.settings, data.questions);
            Formulir.builder.id = id;
            Formulir.renderBuilderMeta();
            Cache.del("formulir");
            if (!silent) showToast("Formulir tersimpan!", "success");
            return id;
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + err.message, "error");
            return null;
        }
    },

    async publish() {
        if (!Formulir.builder) return;
        Formulir.syncBuilderDOM();
        const b = Formulir.builder;
        const tutup = b.status === "aktif";
        if (!tutup) {
            if (!b.judul.trim()) { showToast("Judul wajib diisi", "error"); return; }
            const qs = Formulir.kumpulkanBuilder().questions;
            if (!qs.length) { showToast("Tambah minimal 1 pertanyaan", "error"); return; }
            // simpan sebagai aktif
            const u = OsisAuth.getUser && OsisAuth.getUser();
            try {
                const id = await simpanFormulir(u.id, b.id, b.judul, b.deskripsi, "aktif", b.settings, qs);
                b.id = id;
                b.status = "aktif";
                Formulir.renderBuilderMeta();
                Cache.del("formulir");
                showToast("Formulir AKTIF! Bagikan link-nya.", "success");
            } catch (err) {
                console.error(err);
                showToast("Gagal publish: " + err.message, "error");
            }
            return;
        }
        const yakin = await showPopup("Tutup formulir? Responden baru akan ditolak.", "confirm");
        if (!yakin) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        try {
            const data = Formulir.kumpulkanBuilder();
            const id = await simpanFormulir(u.id, b.id, data.judul, data.deskripsi, "ditutup", data.settings, data.questions);
            b.id = id;
            b.status = "ditutup";
            Formulir.renderBuilderMeta();
            Cache.del("formulir");
            showToast("Formulir ditutup.", "success");
        } catch (err) {
            console.error(err);
            showToast("Gagal tutup: " + err.message, "error");
        }
    },

    async simpanSlug() {
        const b = Formulir.builder;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!b || !b.id || !u || u.mode !== "osis") return;
        const slug = document.getElementById("slugInput").value.trim().toLowerCase();
        try {
            await setFormulirSlug(u.id, b.id, slug);
            b.slug = slug;
            const item = Formulir.cache.find(f => String(f.id) === String(b.id));
            if (item) item.slug = slug;
            Formulir.renderBuilderMeta();
            showToast(slug ? `Link custom aktif: ?id=${slug}` : "Kembali ke link ID.", "success");
        } catch (err) {
            console.error(err);
            const code = String(err.message || "");
            if (code.includes("ERR_TAKEN")) showToast("Slug sudah dipakai form lain", "error");
            else if (code.includes("ERR_INVALID")) showToast("3-40 karakter: huruf, angka, dash", "error");
            else showToast("Gagal simpan link: " + err.message, "error");
        }
    },

    setStatusBuilder(st) {
        if (!Formulir.builder) return;
        Formulir.builder.status = st;
        Formulir.renderBuilderMeta();
        showToast(st === "aktif" ? "Status: Aktif (klik Publikasikan buat simpan)" : "Status: Ditutup (klik Publikasikan/Tutup buat simpan)", "info");
    },

    async previewDariBuilder() {
        Formulir.syncBuilderDOM();
        const b = Formulir.builder;
        if (!b.judul.trim()) { showToast("Isi judul dulu", "error"); return; }
        const data = Formulir.kumpulkanBuilder();
        if (!data.questions.length) { showToast("Tambah minimal 1 pertanyaan", "error"); return; }
        Formulir.isi = {
            form: { id: b.id, judul: b.judul, deskripsi: b.deskripsi, status: b.status, settings: b.settings },
            questions: data.questions.map((q, i) => ({ ...q, key: "p" + i })),
            answers: {}, files: {}, preview: true
        };
        Formulir.renderIsi();
        Formulir.show("isi");
    },

    // ============ ISI (responden) ============
    bindIsi() {
        document.getElementById("btnIsiKembali")?.addEventListener("click", () => {
            const params = new URLSearchParams(location.search);
            if (params.get("isi") || params.get("id")) location.href = location.pathname.replace(/[^/]*$/, "") + "index";
            else Formulir.show(Formulir.builder ? "builder" : "daftar");
        });
        document.getElementById("btnKirimIsi")?.addEventListener("click", () => Formulir.kirimIsi());
        document.getElementById("isiBody")?.addEventListener("click", (e) => {
            const star = e.target.closest("[data-star]");
            if (star) {
                // simpan dulu semua ketikan ke state, baru render ulang
                Object.assign(Formulir.isi.answers, Formulir.bacaJawabanDOM());
                Formulir.isi.answers[star.dataset.qkey] = parseInt(star.dataset.star, 10);
                Formulir.renderIsiJawaban();
                return;
            }
            const fbtn = e.target.closest("[data-filebtn]");
            if (fbtn) {
                Formulir.fileTarget = fbtn.dataset.filebtn;
                document.getElementById("isiFileInput").click();
            }
        });
        document.getElementById("isiFileInput")?.addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = "";
            if (f && Formulir.fileTarget) {
                const key = Formulir.fileTarget;
                const old = (Formulir.isi.fileUrls || {})[key];
                if (old) { try { URL.revokeObjectURL(old); } catch {} }
                Formulir.isi.files[key] = f;
                if (!Formulir.isi.fileUrls) Formulir.isi.fileUrls = {};
                if ((f.type || "").startsWith("image/")) {
                    Formulir.isi.fileUrls[key] = URL.createObjectURL(f);
                } else {
                    delete Formulir.isi.fileUrls[key];
                }
                Formulir.fileTarget = null;
                Formulir.renderIsiJawaban();
            }
        });
        document.getElementById("btnResponsKembali")?.addEventListener("click", () => Formulir.show("daftar"));
    },

    async bukaIsi(formRef, preview) {
        try {
            const forms = await getFormulir();
            const ref = String(formRef || "").trim().toLowerCase();
            const f = forms.find(x => String(x.id) === String(formRef) || String(x.slug || "").toLowerCase() === ref);
            if (!f) { showToast("Formulir tidak ditemukan", "error"); return; }
            let qs = await getPertanyaan(f.id);
            qs = qs.map((q, i) => ({ ...q, key: "q" + q.id + "_" + i }));
            if (f.settings && f.settings.acak) {
                qs = [...qs].sort(() => Math.random() - 0.5);
            }
            Formulir.isi = { form: f, questions: qs, answers: {}, files: {}, preview: !!preview };
            Formulir.renderIsi();
            Formulir.show("isi");
        } catch (err) {
            console.error(err);
            showToast("Gagal buka form: " + err.message, "error");
        }
    },

    renderIsi() {
        const isi = Formulir.isi;
        if (!isi) return;
        document.getElementById("isiJudul").textContent = isi.form.judul || "Tanpa judul";
        document.getElementById("isiDeskripsi").textContent = isi.form.deskripsi || "";
        const badge = document.getElementById("isiModeBadge");
        if (badge) {
            if (isi.preview) {
                badge.className = "status-badge draft";
                badge.textContent = "Preview";
            } else if (isi.form.status === "aktif") {
                badge.className = "status-badge aktif";
                badge.textContent = "Aktif";
            } else {
                badge.className = "status-badge ditutup";
                badge.textContent = "Ditutup";
            }
        }
        const btn = document.getElementById("btnKirimIsi");
        if (btn) btn.style.display = (!isi.preview && isi.form.status !== "aktif") ? "none" : "";
        Formulir.renderIsiJawaban();
        if (!isi.preview && isi.form.status !== "aktif") {
            document.getElementById("isiBody").innerHTML = `<div class="pesan-empty" style="background:var(--white); border:2.5px dashed var(--ink); border-radius:14px; padding:26px; text-align:center"><b>Formulir sudah ditutup.</b><p style="font-size:.8rem; color:var(--gray)">Responden tidak dapat mengisi lagi.</p></div>`;
        }
    },

    renderIsiJawaban() {
        const isi = Formulir.isi;
        if (!isi || (!isi.preview && isi.form.status !== "aktif")) return;
        const body = document.getElementById("isiBody");
        body.innerHTML = isi.questions.map((q, i) => `
            <div class="fcard"><div class="isi-q">
                <label>${i + 1}. ${escapeHtml(q.teks || "Tanpa pertanyaan")} ${q.wajib ? '<span class="wajib-star">*</span>' : ""}</label>
                ${Formulir.inputJawaban(q)}
            </div></div>`).join("");
    },

    inputJawaban(q) {
        const key = q.key;
        const ans = Formulir.isi.answers[key];
        const req = q.wajib ? "required" : "";
        const esc = (s) => escapeHtml(s ?? "");
        if (q.tipe === "short") return `<input type="text" data-jawab="${key}" value="${esc(ans)}" placeholder="Jawaban singkat" ${req}>`;
        if (q.tipe === "paragraf") return `<textarea data-jawab="${key}" placeholder="Tulis jawaban...">${esc(ans)}</textarea>`;
        if (q.tipe === "radio") {
            const opsi = Array.isArray(q.opsi) ? q.opsi : [];
            if (!opsi.length) return `<div class="pesan-empty">Tidak ada opsi.</div>`;
            return opsi.map((op, i) => `<label class="isi-opt"><input type="radio" name="jw_${key}" data-jawab-radio="${key}" value="${esc(op)}" ${ans === op ? "checked" : ""}> ${esc(op)}</label>`).join("");
        }
        if (q.tipe === "checkbox") {
            const opsi = Array.isArray(q.opsi) ? q.opsi : [];
            const cur = Array.isArray(ans) ? ans : [];
            if (!opsi.length) return `<div class="pesan-empty">Tidak ada opsi.</div>`;
            return opsi.map((op) => `<label class="isi-opt"><input type="checkbox" data-jawab-check="${key}" value="${esc(op)}" ${cur.includes(op) ? "checked" : ""}> ${esc(op)}</label>`).join("");
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
            h += `</div><div class="skala-labels"><span>${esc(c.label_min || "")}</span><span>${esc(c.label_max || "")}</span></div>`;
            return h;
        }
        if (q.tipe === "rating") {
            const max = Math.max(3, Math.min(10, parseInt((q.config || {}).max, 10) || 5));
            const cur = parseInt(ans, 10) || 0;
            let h = `<div class="rate-pick">`;
            for (let v = 1; v <= max; v++) {
                h += `<button type="button" data-star="${v}" data-qkey="${key}" class="${v <= cur ? "on" : ""}">☆</button>`;
            }
            return h + `</div>`;
        }
        if (q.tipe === "tanggal") return `<input type="date" data-jawab="${key}" value="${esc(ans)}">`;
        if (q.tipe === "file") {
            const c = q.config || {};
            const f = Formulir.isi.files[key];
            let info = "";
            if (f) {
                const url = (Formulir.isi.fileUrls || {})[key];
                const isImg = (f.type || "").startsWith("image/") && url;
                info = `<div class="detail-text" style="margin-top:6px; display:flex; gap:10px; align-items:center">`
                    + (isImg ? `<img src="${url}" alt="" style="width:72px; height:72px; object-fit:cover; border:2px solid var(--ink); border-radius:10px; flex-shrink:0">` : `<i class="fa-solid fa-file" style="font-size:1.4rem; color:var(--red)"></i>`)
                    + `<div style="min-width:0"><div style="overflow-wrap:anywhere">${esc(f.name)}</div><small style="color:var(--gray)">${Formulir.fmtBytes(f.size)}</small></div></div>`;
            }
            return `<button type="button" class="btn btn-white btn-sm" data-filebtn="${key}"><i class="fa-solid fa-upload"></i> ${f ? "Ganti file" : "Pilih file"}</button>
                <div style="font-size:.7rem; color:var(--gray); font-weight:600; margin-top:4px">${esc(c.types || "Semua tipe")} · Maks ${esc(c.max_mb || 10)} MB</div>${info}`;
        }
        return `<input type="text" data-jawab="${key}" value="${esc(ans)}">`;
    },

    fmtBytes(b) {
        b = parseInt(b, 10) || 0;
        if (!b) return "—";
        if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
        return (b / 1048576).toFixed(1) + " MB";
    },

    isGambar(nama) {
        return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(String(nama || ""));
    },

    fileJawabanHtml(v) {
        if (!v || typeof v !== "object" || !v.path) return "-";
        const url = getFoto(v.path);
        const label = escapeHtml(v.nama || "file");
        if (Formulir.isGambar(v.nama || v.path)) {
            return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="" loading="lazy" style="max-width:100%; max-height:240px; width:auto; height:auto; display:block; border:2px solid var(--ink); border-radius:10px"></a><a href="${url}" target="_blank" rel="noopener" style="color:var(--red); font-size:.74rem; font-weight:700">${label}</a>`;
        }
        return `<a href="${url}" target="_blank" rel="noopener" style="color:var(--red)">${label}</a>`;
    },

    bacaJawabanDOM() {
        const isi = Formulir.isi;
        const out = {};
        document.querySelectorAll("[data-jawab]").forEach(el => {
            const q = isi.questions.find(x => x.key === el.dataset.jawab);
            if (!q) return;
            out[el.dataset.jawab] = el.value;
        });
        const radioSeen = new Set();
        document.querySelectorAll("[data-jawab-radio]:checked").forEach(el => {
            out[el.dataset.jawabRadio] = el.value;
            radioSeen.add(el.dataset.jawabRadio);
        });
        document.querySelectorAll("[data-jawab-check]").forEach(el => {
            const k = el.dataset.jawabCheck;
            if (!out[k]) out[k] = [];
            if (el.checked) out[k].push(el.value);
        });
        // rating dari state (bintang), file dari state files
        isi.questions.forEach(q => {
            if (q.tipe === "rating" && isi.answers[q.key]) out[q.key] = isi.answers[q.key];
        });
        return out;
    },

    async kirimIsi() {
        const isi = Formulir.isi;
        if (!isi) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        const jawaban = Formulir.bacaJawabanDOM();

        // validasi wajib
        for (const q of isi.questions) {
            if (!q.wajib) continue;
            const v = jawaban[q.key];
            const kosong = v === undefined || v === "" || (Array.isArray(v) && !v.length) || (q.tipe === "file" && !isi.files[q.key]);
            if (kosong) {
                showToast(`"${(q.teks || "").slice(0, 40)}" wajib diisi`, "error");
                return;
            }
        }
        // validasi file (tipe + ukuran)
        for (const q of isi.questions) {
            if (q.tipe !== "file" || !isi.files[q.key]) continue;
            const f = isi.files[q.key];
            const maxMb = parseInt((q.config || {}).max_mb, 10) || 10;
            if (f.size > maxMb * 1024 * 1024) {
                showToast(`"${f.name}" melebihi ${maxMb}MB`, "error");
                return;
            }
            const allow = String((q.config || {}).types || "").toUpperCase().replace(/\s+/g, "").split(",").filter(Boolean);
            if (allow.length) {
                const ext = (f.name.split(".").pop() || "").toUpperCase();
                const mimeOk = allow.some(a => (f.type || "").toUpperCase().includes(a));
                if (!allow.includes(ext) && !mimeOk) {
                    showToast(`"${f.name}" harus: ${(q.config || {}).types}`, "error");
                    return;
                }
            }
        }

        // mode preview → simulasi saja, tidak disimpan
        if (isi.preview) {
            const pesan = (isi.form.settings && isi.form.settings.pesan_sukses) || "Terima kasih, respons kamu telah berhasil dikirim.";
            showPopup(escapeHtml(pesan) + '<br><small style="color:var(--gray)">(Mode preview — respons tidak disimpan.)</small>', "success");
            return;
        }

        const btn = document.getElementById("btnKirimIsi");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...'; }
        try {
            // upload file jawaban dulu
            for (const q of isi.questions) {
                if (q.tipe !== "file" || !isi.files[q.key]) continue;
                const f = isi.files[q.key];
                const ext = (f.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
                const path = `formulir/f-${isi.form.id}-${Date.now()}.${ext}`;
                await uploadFotoStorage(f, path);
                jawaban[q.key] = { nama: f.name, path, ukuran: f.size };
            }
            // jawaban keyed by id pertanyaan asli (bukan key lokal acak)
            const bersih = {};
            isi.questions.forEach(q => {
                const qid = q.id || q.key;
                if (jawaban[q.key] !== undefined) bersih[String(qid)] = jawaban[q.key];
                else if (Array.isArray(jawaban[q.key])) bersih[String(qid)] = jawaban[q.key];
            });
            // multi-isi: cegah dobel via localStorage (server juga cek batas)
            const multi = isi.form.settings ? isi.form.settings.multi_isi !== false : true;
            const flagKey = "form_isi_" + isi.form.id;
            if (!multi) {
                try {
                    if (localStorage.getItem(flagKey)) {
                        showToast("Kamu sudah mengisi form ini (1x saja).", "error");
                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim'; }
                        return;
                    }
                } catch {}
            }
            const uid = (u && u.mode === "osis") ? u.id : null;
            await kirimRespons(isi.form.id, bersih, uid);
            try { localStorage.setItem(flagKey, "1"); } catch {}
            const pesan = (isi.form.settings && isi.form.settings.pesan_sukses) || "Terima kasih, respons kamu telah berhasil dikirim.";
            document.getElementById("isiBody").innerHTML = `<div class="fcard" style="text-align:center; padding:30px 18px"><div style="font-size:2.4rem; color:#146314"><i class="fa-solid fa-circle-check"></i></div><h3 style="justify-content:center; margin-top:8px">Terkirim!</h3><p class="sub">${escapeHtml(pesan)}</p></div>`;
            if (btn) btn.style.display = "none";
        } catch (err) {
            console.error(err);
            const code = String(err.message || "");
            if (code.includes("-2")) showPopup("Formulir sudah ditutup.", "error");
            else if (code.includes("-3")) showPopup("Kuota respons sudah penuh.", "error");
            else showToast("Gagal kirim: " + err.message, "error");
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim'; }
        }
    },

    // ============ RESPONS ============
    async bukaRespons(id) {
        try {
            const forms = Formulir.cache.length ? Formulir.cache : await getFormulir();
            const f = forms.find(x => String(x.id) === String(id));
            if (!f) return;
            const [qs, rs] = await Promise.all([getPertanyaan(id), getRespons(id)]);
            Formulir.responsCache = rs || [];
            Formulir.responsView = { qs, rs: rs || [] };
            document.getElementById("responsJudul").textContent = f.judul || "Tanpa judul";
            const last = rs && rs[0] ? Formulir.fmtWaktu(rs[0].created_at) : "-";
            document.getElementById("responsMeta").textContent = `Total ${rs.length} respons · Terakhir: ${last} · Status: ${f.status}`;
            document.getElementById("responsJudulBadge").textContent = "Respons";
            Formulir.renderResponsRingkasan(qs, rs || []);
            Formulir.renderResponsTabel(qs, rs || []);
            Formulir.show("respons");
        } catch (err) {
            console.error(err);
            showToast("Gagal muat respons: " + err.message, "error");
        }
    },

    renderResponsRingkasan(qs, rs) {
        const wrap = document.getElementById("responsRingkas");
        if (!wrap) return;
        if (!rs.length) {
            wrap.innerHTML = `<div class="pesan-empty">Belum ada respons masuk.</div>`;
            return;
        }
        wrap.innerHTML = qs.map(q => {
            const qid = String(q.id);
            const vals = rs.map(r => (r.jawaban || {})[qid]).filter(v => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length));
            let body = "";
            if (["radio", "dropdown", "checkbox"].includes(q.tipe)) {
                const count = {};
                vals.forEach(v => {
                    (Array.isArray(v) ? v : [v]).forEach(o => {
                        const k = String(o);
                        count[k] = (count[k] || 0) + 1;
                    });
                });
                const total = Math.max(1, vals.length);
                const keys = Object.keys(count).sort((a, b) => count[b] - count[a]);
                body = keys.length ? keys.map(k => {
                    const pct = Math.round(count[k] / total * 100);
                    return `<div class="sum-bar"><div class="top"><span>${escapeHtml(k)}</span><span>${pct}%</span></div><div class="bar"><span style="width:${pct}%"></span></div></div>`;
                }).join("") : `<div class="pesan-empty">Belum ada jawaban.</div>`;
            } else if (["rating", "skala"].includes(q.tipe)) {
                const nums = vals.map(v => parseInt(v, 10)).filter(Number.isFinite);
                if (!nums.length) {
                    body = `<div class="pesan-empty">Belum ada jawaban.</div>`;
                } else {
                    const avg = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);
                    const uniq = [...new Set(nums)].sort((a, b) => b - a);
                    body = `<div class="sum-bar"><div class="top"><span>Rata-rata</span><span>★ ${avg}</span></div></div>` + uniq.map(v => {
                        const c = nums.filter(n => n === v).length;
                        const pct = Math.round(c / nums.length * 100);
                        return `<div class="sum-bar"><div class="top"><span>${"★".repeat(Math.min(5, v))}${v > 5 ? " " + v : ""}</span><span>${pct}% (${c})</span></div><div class="bar"><span style="width:${pct}%"></span></div></div>`;
                    }).join("");
                }
            } else if (q.tipe === "file") {
                const files = vals.filter(v => v && typeof v === "object" && v.path);
                body = files.length ? `<div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px">` + files.slice(0, 9).map(v => `<div style="min-width:0">${Formulir.fileJawabanHtml(v)}</div>`).join("") + `</div>`
                    : `<div class="pesan-empty">Belum ada file.</div>`;
            } else {
                body = vals.slice(0, 20).map(v => `<div class="detail-text" style="margin-bottom:6px">${escapeHtml(String(v))}</div>`).join("") || `<div class="pesan-empty">Belum ada jawaban.</div>`;
                if (vals.length > 20) body += `<div class="pesan-empty">+ ${vals.length - 20} lainnya (lihat tabel).</div>`;
            }
            return `<div><h4 style="font-size:.84rem; font-weight:900; margin-bottom:6px">${escapeHtml(q.teks || "Tanpa pertanyaan")} <small style="color:var(--gray)">(${vals.length})</small></h4>${body}</div>`;
        }).join("");
    },

    renderResponsTabel(qs, rs) {
        const wrap = document.getElementById("responsTabel");
        if (!wrap) return;
        if (!rs.length) {
            wrap.innerHTML = `<div class="pesan-empty">Belum ada responden.</div>`;
            return;
        }
        const short = (v) => {
            if (v === undefined || v === "" || v === null) return "-";
            if (Array.isArray(v)) return escapeHtml(v.join(", ") || "-");
            if (typeof v === "object") return escapeHtml(v.nama || "file");
            const s = String(v);
            return escapeHtml(s.length > 40 ? s.slice(0, 40) + "…" : s);
        };
        wrap.innerHTML = `<table class="resp-tabel"><thead><tr><th>Waktu</th>${qs.map(q => `<th>${escapeHtml((q.teks || "").slice(0, 24))}</th>`).join("")}<th></th></tr></thead><tbody>${rs.map((r, i) => `
            <tr>
                <td style="white-space:nowrap">${Formulir.fmtWaktu(r.created_at)}</td>
                ${qs.map(q => `<td>${short((r.jawaban || {})[String(q.id)])}</td>`).join("")}
                <td><button class="q-icon-btn" onclick="Formulir.detailRespons(${i})" title="Detail"><i class="fa-solid fa-eye"></i></button></td>
            </tr>`).join("")}</tbody></table>`;
    },

    detailRespons(i) {
        const view = Formulir.responsView;
        if (!view || !view.rs[i]) return;
        const r = view.rs[i];
        const isi = view.qs.map(q => {
            const v = (r.jawaban || {})[String(q.id)];
            let val;
            if (v === undefined || v === "" || v === null) val = "-";
            else if (Array.isArray(v)) val = escapeHtml(v.join(", ") || "-");
            else if (typeof v === "object") val = Formulir.fileJawabanHtml(v);
            else val = escapeHtml(String(v));
            return `<div style="margin-bottom:8px; text-align:left"><b>${escapeHtml(q.teks || "Tanpa pertanyaan")}</b><br>${val}</div>`;
        }).join("");
        showPopup(`<div style="overflow-wrap:anywhere; min-width:0; max-height:50vh; overflow-y:auto; text-align:left"><div style="font-size:.72rem; font-weight:800; color:var(--gray); margin-bottom:8px">${Formulir.fmtWaktu(r.created_at)}</div>${isi}</div>`, "info");
    }
};

document.addEventListener("DOMContentLoaded", () => Formulir.init());
