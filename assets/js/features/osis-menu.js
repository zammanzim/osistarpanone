// =========================================================================
// OSIS MENU — header kanan atas halaman khusus OSIS (/osis/*)
// Desktop: tampil sebagai pill nav (luas), Mobile: masuk ke titik tiga
// Tambah halaman baru: tinggal tambah <a> di #osisNav & #osisMoreMenu
// =========================================================================
const OsisMenu = {
  toggle() {
    const menu = document.getElementById("osisMoreMenu");
    if (!menu) return;
    menu.classList.toggle("open");
  },
  close() {
    const menu = document.getElementById("osisMoreMenu");
    if (menu) menu.classList.remove("open");
  },
  refresh() {
    const nav = document.getElementById("osisNav");
    const wrap = document.getElementById("osisMoreWrap");
    const narrow = window.innerWidth <= 640;
    if (nav) nav.style.display = narrow ? "none" : "flex";
    if (wrap) {
      const show = narrow;
      wrap.classList.toggle("show", show);
      wrap.style.display = show ? "" : "none";
    }
    // active state
    const cur = (location.pathname.split("/").pop() || "index").toLowerCase();
    document.querySelectorAll("#osisNav .osis-nav-link").forEach((a) => {
      const h = (a.getAttribute("href") || "").toLowerCase();
      a.classList.toggle("active", h === cur || (cur === "" && h === "index"));
    });
    document
      .querySelectorAll("#osisMoreMenu .header-more-item")
      .forEach((a) => {
        const h = (a.getAttribute("href") || "").toLowerCase();
        // header-more-item active -> pakai background red biar jelas
        if (h === cur || (cur === "" && h === "index"))
          a.classList.add("active");
        else a.classList.remove("active");
      });
  },
};

document.addEventListener("click", (e) => {
  const wrap = document.getElementById("osisMoreWrap");
  const menu = document.getElementById("osisMoreMenu");
  if (!wrap || !menu || !menu.classList.contains("open")) return;
  if (wrap.contains(e.target)) return;
  OsisMenu.close();
});
window.addEventListener("resize", () => OsisMenu.refresh());
document.addEventListener("DOMContentLoaded", () => OsisMenu.refresh());
if (document.readyState !== "loading") OsisMenu.refresh();
