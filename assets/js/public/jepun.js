// =========================================================================
// JEPUN — Tebak Huruf Jepang (halaman standalone jepun.html)
// Mode latihan dipisah: hiragana / katakana, dasar, bercoret, kombinasi.
// Tema + komponen mengikuti design system OSIS Tarpan One.
// =========================================================================

const Jepun = {
  siap: false,
  modeAktif: null,
  soal: null,
  skor: 0,
  streak: 0,
  dijawab: 0,
  benar: 0,
  kunci: false,
  timer: null,

  // ---------- DATA HURUF ----------
  // Hiragana; katakana diturunkan otomatis (selisih kode 0x60).
  hDasar: [
    ["あ", "a"], ["い", "i"], ["う", "u"], ["え", "e"], ["お", "o"],
    ["か", "ka"], ["き", "ki"], ["く", "ku"], ["け", "ke"], ["こ", "ko"],
    ["さ", "sa"], ["し", "shi"], ["す", "su"], ["せ", "se"], ["そ", "so"],
    ["た", "ta"], ["ち", "chi"], ["つ", "tsu"], ["て", "te"], ["と", "to"],
    ["な", "na"], ["に", "ni"], ["ぬ", "nu"], ["ね", "ne"], ["の", "no"],
    ["は", "ha"], ["ひ", "hi"], ["ふ", "fu"], ["へ", "he"], ["ほ", "ho"],
    ["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"],
    ["や", "ya"], ["ゆ", "yu"], ["よ", "yo"],
    ["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"],
    ["わ", "wa"], ["を", "wo"], ["ん", "n"],
  ],
  hCoret: [
    ["が", "ga"], ["ぎ", "gi"], ["ぐ", "gu"], ["げ", "ge"], ["ご", "go"],
    ["ざ", "za"], ["じ", "ji"], ["ず", "zu"], ["ぜ", "ze"], ["ぞ", "zo"],
    ["だ", "da"], ["ぢ", "di"], ["づ", "du"], ["で", "de"], ["ど", "do"],
    ["ば", "ba"], ["び", "bi"], ["ぶ", "bu"], ["べ", "be"], ["ぼ", "bo"],
    ["ぱ", "pa"], ["ぴ", "pi"], ["ぷ", "pu"], ["ぺ", "pe"], ["ぽ", "po"],
  ],
  hKombinasi: [
    ["きゃ", "kya"], ["きゅ", "kyu"], ["きょ", "kyo"],
    ["しゃ", "sha"], ["しゅ", "shu"], ["しょ", "sho"],
    ["ちゃ", "cha"], ["ちゅ", "chu"], ["ちょ", "cho"],
    ["にゃ", "nya"], ["にゅ", "nyu"], ["にょ", "nyo"],
    ["ひゃ", "hya"], ["ひゅ", "hyu"], ["ひょ", "hyo"],
    ["みゃ", "mya"], ["みゅ", "myu"], ["みょ", "myo"],
    ["りゃ", "rya"], ["りゅ", "ryu"], ["りょ", "ryo"],
    ["ぎゃ", "gya"], ["ぎゅ", "gyu"], ["ぎょ", "gyo"],
    ["じゃ", "ja"], ["じゅ", "ju"], ["じょ", "jo"],
    ["びゃ", "bya"], ["びゅ", "byu"], ["びょ", "byo"],
  ],

  // ---------- MODE ----------
  modes: [],

  // Ubah hiragana -> katakana (blok hiragana U+3041-3096 + 0x60).
  keKatakana(s) {
    return String(s).replace(/[\u3041-\u3096]/g, (c) => {
      const k = String.fromCharCode(c.charCodeAt(0) + 0x60);
      return /[\u30a1-\u30f6]/.test(k) ? k : c;
    });
  },

  katakana(list) {
    return list.map((x) => [Jepun.keKatakana(x[0]), x[1]]);
  },

  // ---------- REKOR (localStorage, per mode) ----------
  KUNCI_REKOR: "jepun_rekor_v1",
  rekor(id) {
    try {
      const raw = localStorage.getItem(Jepun.KUNCI_REKOR);
      const data = raw ? JSON.parse(raw) : {};
      return Number(data[id] || 0);
    } catch (e) {
      return 0;
    }
  },
  simpanRekor(id, nilai) {
    try {
      const raw = localStorage.getItem(Jepun.KUNCI_REKOR);
      const data = raw ? JSON.parse(raw) : {};
      if (Number(data[id] || 0) >= nilai) return;
      data[id] = nilai;
      localStorage.setItem(Jepun.KUNCI_REKOR, JSON.stringify(data));
    } catch (e) {}
  },

  // ---------- INIT ----------
  init() {
    if (Jepun.siap) return;
    Jepun.siap = true;

    const hD = Jepun.hDasar, hC = Jepun.hCoret, hK = Jepun.hKombinasi;
    const kD = Jepun.katakana(hD), kC = Jepun.katakana(hC), kK = Jepun.katakana(hK);

    Jepun.modes = [
      {
        id: "hb", nama: "Hiragana dasar", ket: "46 huruf dasar",
        data: hD, label: "Hiragana dasar • 46 huruf",
      },
      {
        id: "hv", nama: "Hiragana bercoret", ket: "Dakuten + handakuten",
        data: hC, label: "Hiragana dakuten / handakuten • 25 huruf",
      },
      {
        id: "hc", nama: "Hiragana kombinasi", ket: "ゃ・ゅ・ょ kecil",
        data: hK, label: "Hiragana kombinasi • 30 huruf",
      },
      {
        id: "ha", nama: "Semua Hiragana", ket: "Dasar + coret + kombinasi",
        data: [...hD, ...hC, ...hK], label: "Semua Hiragana • 101 huruf",
      },
      {
        id: "kb", nama: "Katakana dasar", ket: "46 huruf dasar",
        data: kD, label: "Katakana dasar • 46 huruf",
      },
      {
        id: "kv", nama: "Katakana bercoret", ket: "Dakuten + handakuten",
        data: kC, label: "Katakana dakuten / handakuten • 25 huruf",
      },
      {
        id: "kc", nama: "Katakana kombinasi", ket: "ャ・ュ・ョ kecil",
        data: kK, label: "Katakana kombinasi • 30 huruf",
      },
      {
        id: "ka", nama: "Semua Katakana", ket: "Dasar + coret + kombinasi",
        data: [...kD, ...kC, ...kK], label: "Semua Katakana • 101 huruf",
      },
      {
        id: "all", nama: "Semua huruf", ket: "Hiragana + Katakana",
        data: [...hD, ...hC, ...hK, ...kD, ...kC, ...kK],
        label: "Semua huruf Jepang • 202 huruf",
      },
    ];

    Jepun.modeAktif = Jepun.modes[0];
    Jepun.renderModes();
    Jepun.soalBerikut();
    Jepun.ikat();
  },

  $: (id) => document.getElementById(id),

  // ---------- MODE ----------
  renderModes() {
    const wrap = Jepun.$("jepModes");
    if (!wrap) return;
    wrap.innerHTML = Jepun.modes
      .map(
        (m) =>
          `<button type="button" class="jep-mode${m.id === Jepun.modeAktif.id ? " active" : ""}" data-id="${m.id}">` +
          `<b>${m.nama}</b><small>${m.ket}</small></button>`,
      )
      .join("");
    wrap.querySelectorAll(".jep-mode").forEach((b) => {
      b.onclick = () => {
        const m = Jepun.modes.find((x) => x.id === b.dataset.id);
        if (!m) return;
        Jepun.modeAktif = m;
        Jepun.resetStat();
        Jepun.renderModes();
        Jepun.soalBerikut();
      };
    });
  },

  resetStat() {
    Jepun.skor = 0;
    Jepun.streak = 0;
    Jepun.dijawab = 0;
    Jepun.benar = 0;
    Jepun.updateStat();
  },

  updateStat() {
    const s = Jepun.$("jepSkor"), t = Jepun.$("jepStreak"), a = Jepun.$("jepAkurasi");
    if (s) s.textContent = Jepun.skor;
    if (t) t.textContent = Jepun.streak;
    if (a) a.textContent = (Jepun.dijawab ? Math.round((Jepun.benar / Jepun.dijawab) * 100) : 0) + "%";
    const r = Jepun.$("jepRekor");
    if (r) r.textContent = Jepun.rekor(Jepun.modeAktif ? Jepun.modeAktif.id : "");
  },

  // ---------- SOAL ----------
  acak(a) {
    const arr = [...a];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  soalBerikut() {
    Jepun.kunci = false;
    if (Jepun.timer) { clearTimeout(Jepun.timer); Jepun.timer = null; }

    const m = Jepun.modeAktif;
    if (!m) return;
    const input = Jepun.$("jepInput");
    if (input) input.value = "";
    const fb = Jepun.$("jepFeedback");
    if (fb) {
      fb.className = "jep-feedback";
      fb.textContent = "Pilih salah satu jawaban atau ketik romaji.";
    }
    const lbl = Jepun.$("jepLabel");
    if (lbl) lbl.textContent = m.label;

    const pool = m.data;
    if (!pool.length) return;
    Jepun.soal = pool[Math.floor(Math.random() * pool.length)];

    const kana = Jepun.$("jepKana");
    if (kana) kana.textContent = Jepun.soal[0];

    // Opsi harus romaji unik: di mode "Semua huruf" huruf bacaan sama bisa
    // muncul >1x (mis. "a" buat あ dan ア) — kalau dobel, jawaban jadi ambigu.
    const lihat = new Set([Jepun.soal[1]]);
    const sirip = [];
    for (const x of Jepun.acak(pool.filter((y) => y[1] !== Jepun.soal[1]))) {
      if (lihat.has(x[1])) continue;
      lihat.add(x[1]);
      sirip.push(x);
      if (sirip.length === 3) break;
    }
    const opsi = Jepun.acak([Jepun.soal, ...sirip]);
    const wrap = Jepun.$("jepAnswers");
    if (!wrap) return;
    wrap.innerHTML = opsi
      .map(
        (x, i) =>
          `<button type="button" class="jep-answer" data-romaji="${x[1]}">` +
          `<span class="k">${i + 1}</span>${x[1]}</button>`,
      )
      .join("");
    wrap.querySelectorAll(".jep-answer").forEach((b) => {
      b.onclick = () => Jepun.cek(b.dataset.romaji, b);
    });
  },

  // ---------- CEK JAWABAN ----------
  cek(nilai, tombol) {
    if (Jepun.kunci || !Jepun.soal) return;
    Jepun.kunci = true;
    Jepun.dijawab++;

    const benar = String(nilai || "").trim().toLowerCase() === Jepun.soal[1];
    const fb = Jepun.$("jepFeedback");
    const dapat = 10 + Math.min(Jepun.streak, 5);

    if (benar) {
      Jepun.benar++;
      Jepun.streak++;
      Jepun.skor += dapat;
      if (tombol) tombol.classList.add("correct");
      if (fb) {
        fb.className = "jep-feedback good";
        fb.textContent = `✓ Benar! ${Jepun.soal[0]} = ${Jepun.soal[1]}. +${dapat} poin`;
      }
    } else {
      Jepun.streak = 0;
      if (tombol) tombol.classList.add("wrong");
      if (fb) {
        fb.className = "jep-feedback bad";
        fb.textContent = `✕ Belum tepat. ${Jepun.soal[0]} dibaca “${Jepun.soal[1]}”.`;
      }
      const wrap = Jepun.$("jepAnswers");
      if (wrap) {
        wrap.querySelectorAll(".jep-answer").forEach((b) => {
          if (b.dataset.romaji === Jepun.soal[1]) b.classList.add("correct");
        });
      }
    }

    Jepun.simpanRekor(Jepun.modeAktif.id, Jepun.skor);
    Jepun.updateStat();

    // Auto lanjut, tapi tetap bisa manual pakai tombol "Soal berikutnya".
    Jepun.timer = setTimeout(() => Jepun.soalBerikut(), 1100);
  },

  // ---------- EVENT ----------
  ikat() {
    const submit = Jepun.$("jepSubmit");
    if (submit) submit.onclick = () => Jepun.cek(Jepun.$("jepInput").value);

    const input = Jepun.$("jepInput");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          Jepun.cek(input.value);
        }
      });
    }

    const next = Jepun.$("jepNext");
    if (next) next.onclick = () => Jepun.soalBerikut();

    // Shortcut: 1-4 buat pilih jawaban, "n" buat soal berikutnya.
    document.addEventListener("keydown", (e) => {
      if (!Jepun.siap) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key >= "1" && e.key <= "4") {
        const b = document.querySelectorAll("#jepAnswers .jep-answer")[Number(e.key) - 1];
        if (b) { e.preventDefault(); b.click(); }
        return;
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        Jepun.soalBerikut();
      }
    });
  },
};

// Jalan saat DOM siap (script di-load defer).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Jepun.init());
} else {
  Jepun.init();
}
