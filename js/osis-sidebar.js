// =========================================================================
// OSIS SIDEBAR — drawer kiri pengganti pil nav di header (folder /osis/*)
// Disuntik otomatis: tombol hamburger + backdrop + drawer. Satu file untuk
// semua halaman OSIS, jadi nambah halaman baru tidak perlu utak-atik header.
// Tambah menu baru: tinggal tambah 1 entri di OsisSidebar.MENU.
// =========================================================================

const OsisSidebar = {
    MENU: [
        ["index", "Dashboard", "fa-solid fa-grip"],
        ["agenda", "Agenda", "fa-solid fa-calendar-days"],
        ["profil", "Profil", "fa-solid fa-user"],
        ["anggota", "Anggota", "fa-solid fa-users"],
        ["notulensi", "Notulensi", "fa-solid fa-clipboard-list"],
        ["proker", "Proker", "fa-solid fa-list-check"],
        ["dokumen", "Dokumen", "fa-solid fa-folder-open"],
        ["task", "Task", "fa-solid fa-clipboard-check"],
        ["keuangan", "Keuangan", "fa-solid fa-wallet"],
        ["evaluasi", "Evaluasi", "fa-solid fa-star-half-stroke"],
        ["formulir", "Formulir", "fa-solid fa-clipboard-question"]
    ],

    toggle() {
        const sb = document.getElementById("osisSidebar");
        if (!sb) return;
        sb.classList.contains("open") ? OsisSidebar.close() : OsisSidebar.open();
    },

    open() {
        document.getElementById("osisSidebar")?.classList.add("open");
        document.getElementById("osisSidebarBg")?.classList.add("open");
        document.body.style.overflow = "hidden";
    },

    close() {
        document.getElementById("osisSidebar")?.classList.remove("open");
        document.getElementById("osisSidebarBg")?.classList.remove("open");
        // balikin scroll kecuali ada popup form yang masih kebuka
        if (!document.querySelector(".agenda-form.open, .notulensi-form.open, .proker-form.open, .dokumen-form.open, .task-form.open, .kas-form.open, .evaluasi-form.open, .angg-popup.open")) {
            document.body.style.overflow = "";
        }
    },

    halamanAktif() {
        const seg = (location.pathname.split("/").pop() || "index").toLowerCase().replace(/\.html?$/, "");
        return seg || "index";
    },

    pasang() {
        if (document.getElementById("osisSidebar")) return;

        // buang sisa pil nav / titik-tiga lama kalau masih ada di markup
        document.getElementById("osisNav")?.remove();
        document.getElementById("osisMoreWrap")?.remove();

        // CSS drawer (sekali, ikut design system)
        if (!document.getElementById("osisSidebarStyle")) {
            const st = document.createElement("style");
            st.id = "osisSidebarStyle";
            st.textContent = `
                #osisSideBtn { flex-shrink: 0; }
                .osis-sidebar-bg { position: fixed; inset: 0; background: rgba(15,10,11,.55); z-index: 290; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .2s ease, visibility .2s ease; }
                .osis-sidebar-bg.open { opacity: 1; visibility: visible; pointer-events: auto; }
                .osis-sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: min(280px, 84vw); background: var(--white); border-right: 3px solid var(--ink); z-index: 295; transform: translateX(-105%); transition: transform .25s cubic-bezier(.34,1.2,.64,1); display: flex; flex-direction: column; }
                .osis-sidebar.open { transform: none; }
                .osis-sidebar-head { display: flex; align-items: center; gap: 10px; padding: 16px; border-bottom: 3px solid var(--ink); background: var(--yellow); }
                .osis-sidebar-head .t { flex: 1; min-width: 0; }
                .osis-sidebar-head h2 { font-size: 1rem; font-weight: 900; line-height: 1.1; }
                .osis-sidebar-head p { font-size: .62rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--red-dark); }
                .osis-sidebar nav { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 7px; }
                .osis-sidebar-link { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 2.5px solid var(--ink); border-radius: 12px; background: var(--white); font-size: .82rem; font-weight: 800; text-decoration: none; color: var(--ink); box-shadow: 2px 2px 0 var(--ink); }
                .osis-sidebar-link:active { transform: translate(1px,1px); box-shadow: none; }
                .osis-sidebar-link.active { background: var(--red); color: #fff; }
                .osis-sidebar-link .sic { width: 28px; text-align: center; flex-shrink: 0; }
                .osis-sidebar-link.active .sic { color: #fff; }
                .osis-sidebar-link .sic { color: var(--red); }
                .osis-sidebar-foot { padding: 12px; border-top: 3px solid var(--ink); }
                @media (min-width: 900px) {
                    body.osis-side-static { padding-left: 283px; }
                    body.osis-side-static .osis-sidebar { transform: none; }
                    body.osis-side-static #osisSideBtn { display: none; }
                    body.osis-side-static .osis-sidebar-bg { display: none !important; }
                    body.osis-side-static #osisSideClose { display: none; }
                }
            `;
            document.head.appendChild(st);
        }

        // tombol hamburger di kiri header
        const header = document.querySelector("header.top-nav");
        if (header && !document.getElementById("osisSideBtn")) {
            const btn = document.createElement("button");
            btn.className = "icon-btn";
            btn.id = "osisSideBtn";
            btn.title = "Menu OSIS";
            btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
            btn.addEventListener("click", () => OsisSidebar.toggle());
            header.prepend(btn);
        }

        // backdrop + drawer
        const cur = OsisSidebar.halamanAktif();
        const bg = document.createElement("div");
        bg.className = "osis-sidebar-bg";
        bg.id = "osisSidebarBg";
        bg.addEventListener("click", () => OsisSidebar.close());
        const sb = document.createElement("aside");
        sb.className = "osis-sidebar";
        sb.id = "osisSidebar";
        sb.setAttribute("aria-label", "Menu OSIS");
        sb.innerHTML = `
            <div class="osis-sidebar-head">
                <div class="t"><h2>MENU OSIS</h2><p>Halaman Khusus</p></div>
                <button class="icon-btn" id="osisSideClose" title="Tutup" style="width:34px; height:34px; flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <nav>${OsisSidebar.MENU.map(m => `
                <a href="${m[0]}" class="osis-sidebar-link ${cur === m[0] ? "active" : ""}"><span class="sic"><i class="${m[2]}"></i></span>${m[1]}</a>`).join("")}
            </nav>
            <div class="osis-sidebar-foot">
                <a href="../index#/" class="osis-sidebar-link"><span class="sic"><i class="fa-solid fa-house"></i></span>Beranda Website</a>
            </div>`;
        document.body.appendChild(bg);
        document.body.appendChild(sb);
        sb.querySelector("#osisSideClose").addEventListener("click", () => OsisSidebar.close());
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") OsisSidebar.close();
        });
        // desktop: sidebar selalu nempel, mobile: drawer
        OsisSidebar.terapkanMode();
        window.addEventListener("resize", () => OsisSidebar.terapkanMode());
    },

    terapkanMode() {
        const desktop = window.innerWidth >= 900;
        document.body.classList.toggle("osis-side-static", desktop);
        if (desktop) {
            // matikan state drawer (tanpa utak-atik scroll popup)
            document.getElementById("osisSidebar")?.classList.remove("open");
            document.getElementById("osisSidebarBg")?.classList.remove("open");
            if (!document.querySelector(".agenda-form.open, .notulensi-form.open, .proker-form.open, .dokumen-form.open, .task-form.open, .kas-form.open, .evaluasi-form.open, .angg-popup.open")) {
                document.body.style.overflow = "";
            }
        }
    }
};

document.addEventListener("DOMContentLoaded", () => OsisSidebar.pasang());
if (document.readyState !== "loading") OsisSidebar.pasang();
