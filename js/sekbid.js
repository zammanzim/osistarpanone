// =========================================================================
// SEKBID — BPH & seksi bidang dari database (kartu orang, gaya pembina)
// =========================================================================

const Sekbid = {
  terinisialisasi: false,

  async init() {
    if (Sekbid.terinisialisasi) return;
    Sekbid.terinisialisasi = true;
    const container = document.getElementById("sekbidList");
    if (!container) return;

    const render = async (data) => {
      const jum = document.getElementById("jumSekbid");
      if (jum && data) jum.textContent = data.length;
      const listBPH = (data || []).filter((s) => s.kategori === "BPH");
      const listSekbid = (data || []).filter((s) => s.kategori !== "BPH");
      let html = "";
      html += Sekbid.renderGrup("Badan Pengurus Harian", listBPH, "BPH");
      html += Sekbid.renderGrup("Seksi Bidang", listSekbid, "SEKBID");
      html += Sekbid.renderGrup("Anggota", [{
        nama: "Pengurus OSIS",
        deskripsi: "Keluarga besar Pengurus OSIS Tarpan One — seluruh anggota dari setiap seksi bidang yang bergerak bersama menyukseskan setiap program dan kegiatan sekolah.",
        foto: "",
      }], "ANGGOTA");
      container.innerHTML = html;
    };

    const cached = Cache.get("sekbid");
    if (cached) {
      render(cached);
      getSekbid()
        .then((fresh) => {
          if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
            Cache.set("sekbid", fresh);
            render(fresh);
          }
        })
        .catch(() => {});
      return;
    }

    try {
      const data = await getSekbid();
      Cache.set("sekbid", data);
      await render(data);
    } catch (err) {
      console.error(err);
      container.innerHTML = `<div class="loading-block">Gagal memuat data. Cek koneksi.</div>`;
    }
  },

  // 1 Sekbid = 1 foto background, dari folder "sekbid photos" di project.
  // (File "INFORMASI DAN TEKNOLOGI Copy" isinya foto Kewirausahaan.)
  // Ini murni pemetaan UI — tidak mengubah DB/API/struktur data.
  fotoLatar(item) {
    const n = String(item && item.nama ? item.nama : "").toLowerCase();
    const F = "sekbid photos/";
    if (!n) return "";
    if (n.includes("pengurus") || n.includes("anggota osis") || n === "anggota") return F + "ANGGOTA OSIS [AA19ADE].webp";
    if (n.includes("wakil") || n === "ketua osis") return F + "KETUA&WAKIL [FF2EC1E].webp";
    if (n.includes("sekretaris")) return F + "SEKERTARIS [5EDF175].webp";
    if (n.includes("bendahara")) return F + "BENDAHARA [3FC38E4].webp";
    if (n.includes("humas")) return F + "HUMAS [CD64C22].webp";
    if (n.includes("budi")) return F + "BUDI PEKERTI LUHUR [F9D0487].webp";
    if (n.includes("kerohanian")) return F + "KEROHANIAN [639FCB8].webp";
    if (n.includes("politik")) return F + "POLITIK [087655A].webp";
    if (n.includes("olahraga")) return F + "OLAHRAGA [C83DCB9].webp";
    if (n.includes("kbb") || n.includes("berbangsa")) return F + "KBB [E49EC4E].webp";
    if (n.includes("bela negara")) return F + "BELA NEGARA [3459EA0].webp";
    if (n.includes("kesenian")) return F + "KESENIAN [2100D88].webp";
    if (n.includes("bahasa") && !n.includes("berbangsa")) return F + "BAHASA [ACD8A6F].webp";
    if (n.includes("kewirausahaan")) return F + "INFORMASI DAN TEKNOLOGI Copy [C1CE5CA].webp";
    if (n.includes("teknologi") || n.includes("(it)") || n === "it") return F + "INFORMASI DAN TEKNOLOGI [0E419E1].webp";
    return "";
  },

  renderGrup(judul, list, peran) {
    if (!list || list.length === 0) return "";
    let html = `
            <div class="grup-label">
                ${judul} <span class="chip-num">${list.length}</span>
            </div>
            <div class="sekbid-list">`;
    list.forEach((item, idx) => {
      html += Sekbid.seksi(item, peran, idx + 1);
    });
    html += `</div>`;
    return html;
  },

  seksi(item, peran, nomor) {
    const nama = escapeHtml(item.nama);
    const no = String(nomor || item.urutan || 1).padStart(2, "0");
    // Prioritas: foto editorial lokal; fallback ke foto DB kalau tidak ada padanannya.
    const lokal = Sekbid.fotoLatar(item);
    const bg = lokal || (item.foto ? getFoto(item.foto) : "");
    const bgSrc = bg ? encodeURI(bg) : "";
    const fotoIsi = bgSrc
      ? `<img class="sekbid-img" src="${bgSrc}" alt="Foto ${nama}" loading="lazy"
                   onerror="this.closest('.sekbid-card').classList.add('tanpa-foto'); this.remove();">`
      : `<span class="sekbid-foto-fallback">${no}</span>`;
    return `
            <article class="sekbid-card${bgSrc ? "" : " tanpa-foto"}">
                <div class="sekbid-foto">${fotoIsi}</div>
                <div class="sekbid-body">
                    <span class="sekbid-no">${no}</span>
                    <span class="sekbid-label">${peran}</span>
                    <h4 class="sekbid-nama">${nama}</h4>
                    <p class="sekbid-desc">${escapeHtml(item.deskripsi)}</p>
                </div>
            </article>`;
  },
};

if (typeof Router !== "undefined") {
  Router.register("sekbid", () => Sekbid.init());
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Sekbid.init());
} else {
  Sekbid.init();
}
