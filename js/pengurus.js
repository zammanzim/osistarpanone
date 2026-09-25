// =========================================================================
// PENGURUS — daftar biodata pengurus, satu list card full-width
// Sumber data: tabel pimpinan (ketua/wakil) + anggota
// =========================================================================

const Pengurus = {
  siap: false,
  escTerpasang: false,
  popBound: false,
  statePushed: false,
  pimpinan: [],
  anggota: [],
  daftarTahun: [],
  tahunAktif: null,
  tampil: [],
  milikId: null,
  superKuasa: false,
  editFile: null,
  editUrl: null,

  async init() {
    if (Pengurus.siap) {
      Pengurus.render();
      return;
    }
    Pengurus.siap = true;

    const sel = document.getElementById("pengurusPeriode");
    if (sel) {
      sel.addEventListener("change", (e) => {
        Pengurus.tahunAktif = parseInt(e.target.value, 10);
        Pengurus.render();
      });
    }

    await Pengurus.muat();
  },

  async muat() {
    const cp = Cache.get("pimpinan");
    const ca = Cache.get("anggota");
    if (cp && ca) Pengurus.pakai(cp, ca);

    try {
      const [pimp, agg] = await Promise.all([getPimpinan(), getAnggota()]);
      Cache.set("pimpinan", pimp || []);
      Cache.set("anggota", agg || []);
      Pengurus.pakai(pimp || [], agg || []);
    } catch (err) {
      console.error("Gagal muat pengurus:", err);
      if (!cp && !ca) {
        const list = document.getElementById("pengurusList");
        if (list) {
          list.innerHTML = `<div class="loading-block">Gagal memuat data. Cek koneksi internet.</div>`;
        }
      }
    }
    Pengurus.muatMilik();
  },

  // Cari baris anggota milik user yang login (buat tombol edit di card sendiri)
  async muatMilik() {
    let uid = null;
    try {
      const u =
        typeof OsisAuth !== "undefined" && OsisAuth.getUser
          ? OsisAuth.getUser()
          : null;
      uid = u && u.mode === "osis" && u.id ? u.id : null;
    } catch {}
    if (!uid) {
      if (Pengurus.milikId !== null || Pengurus.superKuasa) {
        Pengurus.milikId = null;
        Pengurus.superKuasa = false;
        Pengurus.render();
      }
      return;
    }
    try {
      try {
        if (typeof OsisAuth !== "undefined" && OsisAuth.refreshAkses)
          await OsisAuth.refreshAkses();
      } catch {}
      const kuasa =
        typeof OsisAuth !== "undefined" &&
        (OsisAuth.isSuper() || OsisAuth.bisa("anggota"));
      const saya = await getAnggotaSaya();
      const idBaru = (saya && saya.id) || null;
      if (idBaru !== Pengurus.milikId || kuasa !== Pengurus.superKuasa) {
        Pengurus.milikId = idBaru;
        Pengurus.superKuasa = !!kuasa;
        Pengurus.render();
      }
    } catch (err) {
      console.error("Gagal muat data milikku:", err);
    }
  },

  // Boleh edit inline: card sendiri, atau super/admin berhak
  bolehEdit(k) {
    if (!k || !k.data || !k.data.id) return false;
    return k.data.id === Pengurus.milikId || Pengurus.superKuasa;
  },

  // "Belum Ada" / "Coming Soon" = placeholder, anggap kosong
  namaAsli(n) {
    const s = String(n ?? "").trim();
    const l = s.toLowerCase();
    if (!s || l === "belum ada" || l === "coming soon" || l === "-" || l === "--") return "";
    return s;
  },

  pakai(pimp, agg) {
    Pengurus.pimpinan = pimp;
    Pengurus.anggota = agg;

    const semuaThn = new Set();
    const thnNyata = new Set();
    // Periode masa depan (mis. 2027/2028 saat datanya belum fix) disembunyikan
    // dari dropdown sampai tahunnya tiba.
    const maksThn = new Date().getFullYear();
    pimp.forEach((p) => {
      const t = parseInt(p.tahun, 10);
      if (!Number.isFinite(t) || t > maksThn) return;
      semuaThn.add(t);
      if (Pengurus.namaAsli(p.ketua_nama) || Pengurus.namaAsli(p.wakil_nama)) {
        thnNyata.add(t);
      }
    });
    agg.forEach((a) => {
      const t = parseInt(a.tahun, 10);
      if (!Number.isFinite(t) || t > maksThn) return;
      semuaThn.add(t);
      if (String(a.nama || "").trim()) thnNyata.add(t);
    });

    Pengurus.daftarTahun = [...semuaThn].sort((a, b) => b - a);
    if (!Pengurus.daftarTahun.length) {
      Pengurus.daftarTahun = [new Date().getFullYear()];
    }
    // Default = tahun terbaru yang isinya nama beneran (bukan placeholder)
    const nyataUrut = [...thnNyata].sort((a, b) => b - a);
    if (
      !Pengurus.tahunAktif ||
      !Pengurus.daftarTahun.includes(Pengurus.tahunAktif)
    ) {
      Pengurus.tahunAktif = nyataUrut.length
        ? nyataUrut[0]
        : Pengurus.daftarTahun[0];
    }

    const sel = document.getElementById("pengurusPeriode");
    if (sel) {
      sel.innerHTML = Pengurus.daftarTahun
        .map(
          (t) =>
            `<option value="${t}"${
              t === Pengurus.tahunAktif ? " selected" : ""
            }>Periode ${t}/${t + 1}</option>`
        )
        .join("");
    }

    Pengurus.render();
  },

  render() {
    const list = document.getElementById("pengurusList");
    if (!list) return;
    const thn = Pengurus.tahunAktif;

    // Ketua & wakil = anggota dengan jabatan Ketua / Wakil Ketua OSIS.
    // Kalau belum ada, fallback ke tabel pimpinan lama (abaikan placeholder).
    const rows = Pengurus.anggota
      .filter(
        (a) =>
          parseInt(a.tahun, 10) === thn && String(a.nama || "").trim()
      )
      .sort((a, b) => (a.urutan || 99) - (b.urutan || 99));
    const jab = (a) => String((a && a.jabatan) || "");
    const isWakil = (a) => /wakil/i.test(jab(a)) && /osis/i.test(jab(a));
    const isKetua = (a) =>
      /ketua/i.test(jab(a)) && /osis/i.test(jab(a)) && !/wakil/i.test(jab(a));

    const kartu = [];
    const terpakai = new Set();
    const rowKetua = rows.find(isKetua);
    const rowWakil = rows.find(isWakil);
    if (rowKetua || rowWakil) {
      [rowKetua, rowWakil].forEach((a) => {
        if (!a) return;
        terpakai.add(a);
        kartu.push({
          nama: a.nama,
          jabatan: a.jabatan || "Anggota OSIS",
          foto: a.foto,
          pimpinan: true,
          data: a,
        });
      });
    } else {
      const pimp = Pengurus.pimpinan.find(
        (p) => parseInt(p.tahun, 10) === thn
      );
      if (pimp) {
        const ketua = Pengurus.namaAsli(pimp.ketua_nama);
        const wakil = Pengurus.namaAsli(pimp.wakil_nama);
        if (ketua) {
          kartu.push({
            nama: ketua,
            jabatan: "Ketua OSIS",
            foto: pimp.ketua_foto,
            pimpinan: true,
            data: null,
          });
        }
        if (wakil) {
          kartu.push({
            nama: wakil,
            jabatan: "Wakil Ketua OSIS",
            foto: pimp.wakil_foto,
            pimpinan: true,
            data: null,
          });
        }
      }
    }
    rows.forEach((a) => {
      if (terpakai.has(a)) return;
      kartu.push({
        nama: a.nama,
        jabatan: a.jabatan || "Anggota OSIS",
        foto: a.foto,
        pimpinan: false,
        data: a,
      });
    });

    Pengurus.tampil = kartu;

    const jum = document.getElementById("pengurusCount");
    if (jum) jum.textContent = kartu.length;

    if (!kartu.length) {
      list.innerHTML = `<div class="loading-block">Belum ada data pengurus periode ${thn}/${
        thn + 1
      }.</div>`;
      return;
    }

    list.innerHTML = kartu
      .map((k, i) => {
        const inisial = escapeHtml(
          String(k.nama || "?").trim().charAt(0).toUpperCase() || "?"
        );
        const no = String(i + 1).padStart(2, "0");
        const foto = k.foto
          ? `<img src="${getFoto(k.foto)}" alt="${escapeHtml(
              k.nama
            )}" loading="lazy">`
          : `<span class="pg-initial">${inisial}</span>`;
        const d = k.data || {};
        const bioVal = (v) => String(v ?? "").trim();
        const bioTiles = [
          ["Panggilan", bioVal(d.panggilan || d.nama_panggilan), "fa-solid fa-user"],
          ["TTL", bioVal(d.ttl || d.tempat_tanggal_lahir || d.tempat_lahir), "fa-solid fa-calendar-days"],
          ["Visi", bioVal(d.visi), "fa-solid fa-bullseye"],
          ["Misi", bioVal(d.misi), "fa-solid fa-flag"],
        ].filter((t) => t[1]);
        const bioHtml = bioTiles.length
          ? `<div class="pg-bio">${bioTiles
              .map(
                (t) =>
                  `<div class="pg-bio-item"><i class="${t[2]}"></i><div><span>${t[0]}</span><p>${escapeHtml(
                    t[1]
                  )}</p></div></div>`
              )
              .join("")}</div>`
          : "";
        return `<article class="pg-card${
          k.pimpinan ? " pg-pimpinan" : ""
        }" onclick="Pengurus.buka(${i})">
          <span class="pg-num">${no}</span>
          <span class="pg-periode"><i class="fa-solid fa-star"></i> PENGURUS ${thn}/${
            thn + 1
          }</span>
          <div class="pg-foto">${foto}</div>
          <div class="pg-info">
            <h3>${escapeHtml(k.nama)}</h3>
            <p>${escapeHtml(k.jabatan)}</p>
          </div>
          ${bioHtml}
          <button class="pg-more" onclick="event.stopPropagation(); Pengurus.buka(${i})">LIHAT PROFIL LENGKAP <i class="fa-solid fa-arrow-right"></i></button>
        </article>`;
      })
      .join("");
  },

  // ============ POPUP BIODATA ============
  buka(i) {
    const k = Pengurus.tampil[i];
    if (!k) return;
    // 1 popup = 1 history state (ganti popup warisi state lama)
    const warisi =
      !!document.getElementById("pengurusModal") && Pengurus.statePushed;
    Pengurus.statePushed = false;
    Pengurus.tutup(true);
    Pengurus.viewIndex = i;
    if (!Pengurus.escTerpasang) {
      Pengurus.escTerpasang = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") Pengurus.tutupManual();
      });
      // Placeholder "Belum diatur" langsung hilang saat mulai diketik
      document.addEventListener("focusin", (e) => {
        const t =
          e.target && e.target.closest
            ? e.target.closest("#pengurusModal.pg-editing [data-f].pg-belum")
            : null;
        if (t && t.textContent.trim() === "Belum diatur") {
          t.textContent = "";
          t.classList.remove("pg-belum");
        }
      });
    }

    const modal = document.createElement("div");
    modal.className = "struktur-modal";
    modal.id = "pengurusModal";
    modal.innerHTML = `
      <div class="struktur-modal-bg"></div>
      <div class="struktur-modal-box pg-pop-box">
        <div class="struktur-head">
          <h4>Biodata Pengurus</h4>
          <div class="pg-head-btns">
            ${
              Pengurus.bolehEdit(k)
                ? `<button class="struktur-edit" id="pgHeadEdit" type="button" aria-label="Edit biodata" title="Edit biodata"><i class="fa-solid fa-pen"></i></button>`
                : ""
            }
            <button class="struktur-close" type="button" aria-label="Tutup">&times;</button>
          </div>
        </div>
        <div class="struktur-modal-body" id="pgBody"></div>
      </div>`;
    modal
      .querySelector(".struktur-modal-bg")
      .addEventListener("click", () => Pengurus.tutupManual());
    modal
      .querySelector(".struktur-close")
      .addEventListener("click", () => Pengurus.tutupManual());
    document.body.appendChild(modal);
    document.body.style.overflow = "hidden";
    try {
      modal.dataset.seq = String(
        (window.__seqModal = (window.__seqModal || 0) + 1)
      );
    } catch (e) {}
    if (!warisi) {
      try {
        history.pushState({ pengurus: true }, "");
      } catch (e) {}
    }
    Pengurus.statePushed = true;
    const btnEdit = modal.querySelector("#pgHeadEdit");
    if (btnEdit)
      btnEdit.addEventListener("click", () => Pengurus.bukaEditInline());
    Pengurus.isiBodyView();
  },

  isiBodyView() {
    const modal = document.getElementById("pengurusModal");
    if (modal) modal.classList.remove("pg-editing");
    const body = document.getElementById("pgBody");
    const k = Pengurus.tampil[Pengurus.viewIndex];
    if (!body || !k) return;
    const i = Pengurus.viewIndex;
    const thn = Pengurus.tahunAktif;
    const d = k.data || {};
    const val = (v) => String(v ?? "").trim();
    const panggilan = val(d.panggilan || d.nama_panggilan);
    const ttl = val(d.ttl || d.tempat_tanggal_lahir || d.tempat_lahir);
    const visi = val(d.visi);
    const misi = val(d.misi);
    const motto = val(d.motto);
    const ig = val(d.ig || d.instagram);
    const wa = val(d.wa || d.whatsapp || d.no_wa);
    const tiktok = val(d.tiktok);

    const linkIg = Pengurus.linkIg(ig);
    const linkWa = Pengurus.linkWa(wa);
    const linkTt = Pengurus.linkTiktok(tiktok);
    const medsos =
      linkIg || linkWa || linkTt
        ? `<div class="pg-pop-medsos">
          ${
            linkWa
              ? `<a href="${linkWa}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(
                  wa
                )}</a>`
              : ""
          }
          ${
            linkTt
              ? `<a href="${linkTt}" target="_blank" rel="noopener"><i class="fa-brands fa-tiktok"></i> ${escapeHtml(
                  Pengurus.userTiktok(tiktok)
                )}</a>`
              : ""
          }
          ${
            linkIg
              ? `<a href="${linkIg}" target="_blank" rel="noopener"><i class="fa-brands fa-instagram"></i> ${escapeHtml(
                  Pengurus.userIg(ig)
                )}</a>`
              : ""
          }
        </div>`
        : `<div class="pg-pop-medsos">
          <span class="pg-pop-off"><i class="fa-brands fa-whatsapp"></i> Belum diatur</span>
          <span class="pg-pop-off"><i class="fa-brands fa-tiktok"></i> Belum diatur</span>
          <span class="pg-pop-off"><i class="fa-brands fa-instagram"></i> Belum diatur</span>
        </div>`;

    const tile = (icon, label, isi, field) =>
      `<div class="pg-pop-tile"><i class="${icon}"></i><div><span>${label}</span>${
        isi
          ? `<p${field ? ` data-f="${field}"` : ""}>${escapeHtml(isi)}</p>`
          : `<p class="pg-belum"${field ? ` data-f="${field}"` : ""}>Belum diatur</p>`
      }</div></div>`;
    const tiles = [
      tile("fa-solid fa-user", "Nama Panggilan", panggilan, "panggilan"),
      tile("fa-solid fa-calendar-days", "Tempat, Tanggal Lahir", ttl, "ttl"),
      tile("fa-solid fa-graduation-cap", "Periode", `${thn}/${thn + 1}`),
      tile("fa-solid fa-users", "Jabatan", k.jabatan),
      tile("fa-solid fa-school", "Kelas", val(d.kelas), "kelas"),
    ].join("");

    const misiList = misi
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const vmHtml = `<div class="pg-pop-vm">
          <div class="pg-pop-vm-card"><h5><i class="fa-solid fa-bullseye"></i> VISI</h5><div class="pg-pop-visi">${
            visi
              ? `<p data-f="visi">${escapeHtml(visi)}</p>`
              : `<p class="pg-belum" data-f="visi">Belum diatur</p>`
          }</div></div>
          <div class="pg-pop-vm-card"><h5><i class="fa-solid fa-flag"></i> MISI</h5><div class="pg-pop-misi">${
            misiList.length
              ? `<ul data-f="misi">${misiList
                  .map((m) => `<li>${escapeHtml(m)}</li>`)
                  .join("")}</ul>`
              : `<p class="pg-belum" data-f="misi">Belum diatur</p>`
          }</div></div>
        </div>`;

    const inisial = escapeHtml(
      String(k.nama || "?").trim().charAt(0).toUpperCase() || "?"
    );
    const foto = k.foto
      ? `<img src="${getFoto(k.foto)}" alt="${escapeHtml(k.nama)}">`
      : `<span class="pg-initial">${inisial}</span>`;
    const no = String(i + 1).padStart(2, "0");

    body.innerHTML = `
          <div class="pg-pop-top">
            <div class="pg-pop-foto-wrap">
              <span class="pg-pop-no">${no}</span>
              <div class="pg-pop-foto">${foto}</div>
            </div>
            <div class="pg-pop-main">
              <p class="pg-pop-jab">${escapeHtml(k.jabatan)}</p>
              <h3 class="pg-pop-nama">${escapeHtml(k.nama)}</h3>
              <p class="pg-pop-sub">Pengurus OSIS Tarpan One</p>
              <div class="pg-pop-rule"></div>
              ${medsos}
              <div class="pg-pop-tiles pg-pop-tiles-desktop">${tiles}</div>
            </div>
          </div>
          <div class="pg-pop-tiles pg-pop-tiles-mobile">${tiles}</div>
          ${vmHtml}
          <div class="pg-pop-motto"><i class="fa-solid fa-quote-left"></i>${
            motto
              ? `<p data-f="motto">"${escapeHtml(motto)}"</p>`
              : `<p class="pg-belum" data-f="motto">Belum diatur</p>`
          }</div>`;
    const btnEdit = document.getElementById("pgHeadEdit");
    if (btnEdit) btnEdit.style.display = Pengurus.bolehEdit(k) ? "" : "none";
  },

  tutupManual() {
    const modal = document.getElementById("pengurusModal");
    if (!modal || modal.classList.contains("tutup")) return;
    const pushed = Pengurus.statePushed;
    Pengurus.tutup();
    if (pushed) {
      if (typeof Home !== "undefined") {
        Home.selfBack = true;
        setTimeout(() => {
          Home.selfBack = false;
        }, 300);
      }
      try {
        history.back();
      } catch (e) {}
    }
  },

  tutup(instan) {
    const modal = document.getElementById("pengurusModal");
    Pengurus.statePushed = false;
    if (!modal) return;
    document.body.style.overflow = "";
    if (instan) {
      modal.remove();
      return;
    }
    modal.classList.add("tutup");
    setTimeout(() => modal.remove(), 180);
  },

  // ============ EDIT BIODATA SENDIRI (inline di popup) ============
  bukaEditInline() {
    const k = Pengurus.tampil[Pengurus.viewIndex];
    if (!Pengurus.bolehEdit(k)) {
      if (typeof showToast === "function")
        showToast("Kamu tidak boleh mengedit ini.", "error");
      return;
    }
    const modal = document.getElementById("pengurusModal");
    const body = document.getElementById("pgBody");
    if (!modal || !body) return;
    const d = k.data;
    Pengurus.editFile = null;
    if (Pengurus.editUrl) {
      try {
        URL.revokeObjectURL(Pengurus.editUrl);
      } catch {}
      Pengurus.editUrl = null;
    }
    modal.classList.add("pg-editing");
    body.querySelectorAll("[data-f]").forEach((el) => {
      el.setAttribute("contenteditable", "true");
      el.setAttribute("spellcheck", "false");
    });
    // Medsos jadi input langsung di pilnya
    const val = (x) => String(x ?? "");
    body.querySelectorAll(".pg-pop-medsos").forEach((box) => {
      box.innerHTML = `
        <span class="pg-pop-sos-in"><i class="fa-brands fa-whatsapp"></i><input data-sos="wa" maxlength="40" placeholder="Nomor WA" value="${escapeHtml(val(d.wa))}"></span>
        <span class="pg-pop-sos-in"><i class="fa-brands fa-tiktok"></i><input data-sos="tiktok" maxlength="120" placeholder="Username" value="${escapeHtml(val(d.tiktok))}"></span>
        <span class="pg-pop-sos-in"><i class="fa-brands fa-instagram"></i><input data-sos="ig" maxlength="120" placeholder="Username" value="${escapeHtml(val(d.ig))}"></span>`;
    });
    // Tombol kamera di foto (input transparan di atas tombol biar aman di HP)
    const fotoWrap = body.querySelector(".pg-pop-foto-wrap");
    if (fotoWrap && !fotoWrap.querySelector("#pgEditCam")) {
      const cam = document.createElement("label");
      cam.id = "pgEditCam";
      cam.className = "pg-edit-cam";
      cam.title = "Ganti foto";
      cam.innerHTML = '<i class="fa-solid fa-camera"></i>';
      const inp = document.createElement("input");
      inp.type = "file";
      inp.id = "pgEditFile";
      inp.accept = "image/*";
      inp.addEventListener("change", (e) => Pengurus.pilihFotoEdit(e.target));
      cam.appendChild(inp);
      fotoWrap.appendChild(cam);
    }
    // Bar simpan
    if (!body.querySelector("#pgEditBar")) {
      const bar = document.createElement("div");
      bar.className = "pg-edit-actions";
      bar.id = "pgEditBar";
      bar.innerHTML = `
        <button class="btn btn-white" id="pgEditBatal">Batal</button>
        <button class="btn btn-red" id="pgEditSimpan"><i class="fa-solid fa-floppy-disk"></i> Simpan</button>`;
      body.appendChild(bar);
      bar.querySelector("#pgEditBatal").addEventListener("click", () => Pengurus.batalEditInline());
      bar.querySelector("#pgEditSimpan").addEventListener("click", () => Pengurus.simpanEditInline());
    }
    const headEdit = document.getElementById("pgHeadEdit");
    if (headEdit) headEdit.style.display = "none";
    const scroller = document.querySelector("#pengurusModal .struktur-modal-body");
    if (scroller) scroller.scrollTop = 0;
  },

  batalEditInline() {
    Pengurus.editFile = null;
    Pengurus.isiBodyView();
  },

  // Baca teks dari salinan yang terlihat (tile desktop/mobile ganda)
  bacaField(name) {
    const els = [
      ...document.querySelectorAll(
        '#pengurusModal [data-f="' + name + '"]'
      ),
    ];
    const el =
      els.find((e) => e.offsetParent !== null) || els[0];
    if (!el) return "";
    return (el.innerText || "").trim();
  },

  bacaMisi() {
    const els = [
      ...document.querySelectorAll('#pengurusModal [data-f="misi"]'),
    ];
    const el =
      els.find((e) => e.offsetParent !== null) || els[0];
    if (!el) return "";
    if (el.tagName === "UL")
      return [...el.querySelectorAll("li")]
        .map((li) => (li.innerText || "").trim())
        .filter(Boolean)
        .join("\n");
    return (el.innerText || "").trim();
  },

  bacaSosmed(key) {
    const boxes = [
      ...document.querySelectorAll("#pengurusModal .pg-pop-medsos"),
    ];
    const box =
      boxes.find((b) => b.offsetParent !== null) || boxes[0];
    const inp =
      box && box.querySelector('[data-sos="' + key + '"]');
    return inp ? (inp.value || "").trim() : "";
  },

  pilihFotoEdit(input) {
    const f = input.files && input.files[0];
    input.value = "";
    if (!f) return;
    if (!f.type || !f.type.startsWith("image/")) {
      if (typeof showToast === "function") showToast("File harus gambar.", "error");
      return;
    }
    Pengurus.editFile = f;
    if (Pengurus.editUrl && Pengurus.editUrl.indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(Pengurus.editUrl);
      } catch {}
    }
    const tampil = (url) => {
      Pengurus.editUrl = url;
      const wrap = document.querySelector("#pengurusModal .pg-pop-foto");
      if (!wrap) return;
      let img = wrap.querySelector("img");
      if (!img) {
        wrap.innerHTML = "";
        img = document.createElement("img");
        img.alt = "";
        wrap.appendChild(img);
      }
      img.src = url;
    };
    try {
      tampil(URL.createObjectURL(f));
    } catch (e) {
      // Fallback HP lama: baca sebagai data URL
      try {
        const r = new FileReader();
        r.onload = () => {
          if (r.result) tampil(String(r.result));
          else if (typeof showToast === "function") showToast("Foto tidak terbaca.", "error");
        };
        r.onerror = () => {
          if (typeof showToast === "function") showToast("Foto tidak terbaca.", "error");
        };
        r.readAsDataURL(f);
      } catch (err) {
        if (typeof showToast === "function") showToast("Foto tidak terbaca.", "error");
      }
    }
  },

  async simpanEditInline() {
    const k = Pengurus.tampil[Pengurus.viewIndex];
    if (!Pengurus.bolehEdit(k)) {
      if (typeof showToast === "function")
        showToast("Kamu tidak boleh mengedit ini.", "error");
      return;
    }
    const bersihMotto = (t) => t.replace(/^"\s*|\s*"$/g, "");
    const bio = {
      panggilan: Pengurus.bacaField("panggilan"),
      ttl: Pengurus.bacaField("ttl"),
      kelas: Pengurus.bacaField("kelas"),
      visi: Pengurus.bacaField("visi"),
      misi: Pengurus.bacaMisi(),
      motto: bersihMotto(Pengurus.bacaField("motto")),
      ig: Pengurus.bacaSosmed("ig"),
      wa: Pengurus.bacaSosmed("wa"),
      tiktok: Pengurus.bacaSosmed("tiktok"),
    };
    const btn = document.getElementById("pgEditSimpan");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    }
    try {
      let foto = k.data.foto || "";
      if (Pengurus.editFile) {
        const f = Pengurus.editFile;
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `anggota/anggota-${k.data.tahun || Pengurus.tahunAktif}-${Date.now()}.${ext}`;
        await uploadFotoStorage(f, path);
        if (foto && foto !== path) {
          try {
            await hapusFotoStorage(foto);
          } catch {}
        }
        foto = path;
      }
      const milikSendiri = k.data.id === Pengurus.milikId;
      if (milikSendiri) {
        await updateAnggotaSendiri(k.data.id, Object.assign({}, bio, { foto }));
      } else {
        // Super/admin: pakai jalur admin biasa (nama & jabatan ikut terkunci via "")
        await updateAnggota(
          k.data.id,
          Object.assign(
            { nama: "", jabatan: "", urutan: k.data.urutan ?? 99, foto },
            bio
          )
        );
      }
      if (typeof showToast === "function")
        showToast("Biodatamu diperbarui!", "success");
      Pengurus.editFile = null;
      Object.assign(k.data, bio, { foto });
      k.foto = foto;
      try {
        Cache.set("anggota", Pengurus.anggota);
      } catch {}
      Pengurus.isiBodyView();
      Pengurus.render();
    } catch (err) {
      console.error(err);
      const msg = String((err && err.message) || err || "");
      if (typeof showToast === "function") {
        if (/anggota_sendiri|function/i.test(msg))
          showToast("Migrasi edit-sendiri belum dijalankan admin.", "error");
        else if (/BUKAN_MILIK|NO_AUTH/i.test(msg))
          showToast("Kamu tidak boleh mengedit ini.", "error");
        else showToast("Gagal simpan: " + msg, "error");
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
      }
    }
  },

  linkIg(v) {
    v = String(v || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    return "https://instagram.com/" + v.replace(/^@/, "");
  },

  linkTiktok(v) {
    v = String(v || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    return "https://tiktok.com/@" + v.replace(/^@/, "");
  },

  linkWa(v) {
    const digit = String(v || "").replace(/\D/g, "");
    if (!digit) return "";
    const no = digit.startsWith("0") ? "62" + digit.slice(1) : digit;
    return "https://wa.me/" + no;
  },

  userIg(v) {
    v = String(v || "").trim();
    const m = v.match(/instagram\.com\/(@?[^/?#]+)/i);
    const u = m ? m[1] : v;
    return "@" + String(u).replace(/^@/, "");
  },

  userTiktok(v) {
    v = String(v || "").trim();
    const m = v.match(/tiktok\.com\/(@?[^/?#]+)/i);
    const u = m ? m[1] : v;
    return "@" + String(u).replace(/^@/, "");
  },
};

if (typeof Router !== "undefined") {
  Router.register("pengurus", () => Pengurus.init());
}

// Back HP = tutup popup (jalan walau user mendarat langsung di #/pengurus)
if (!Pengurus.popBound) {
  Pengurus.popBound = true;
  window.addEventListener("popstate", () => {
    const m = document.getElementById("pengurusModal");
    if (m && !m.classList.contains("tutup")) Pengurus.tutup(true);
  });
}
