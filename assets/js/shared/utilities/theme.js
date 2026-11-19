// =========================================================================
// TARPAN THEME — manajemen tema gelap/terang global (default: terang).
// Disimpan di localStorage ("tarpan_theme": "dark" | "light").
// =========================================================================
(function () {
  "use strict";

  var LS_KEY = "tarpan_theme";
  var THEME_COLOR_LIGHT = "#e11d2e";
  var THEME_COLOR_DARK = "#16131b";

  function get() {
    try {
      return localStorage.getItem(LS_KEY) === "dark" ? "dark" : "light";
    } catch (e) {
      return "light";
    }
  }

  function isDark() {
    return get() === "dark";
  }

  function syncControls(dark) {
    var ids = ["headerMoreThemeToggle", "osisMoreThemeToggle", "setTemaGelap"];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.checked = !!dark;
    }
  }

  function apply(mode) {
    var dark = mode === "dark";
    var root = document.documentElement;
    if (root) {
      if (dark) root.setAttribute("data-theme", "dark");
      else root.removeAttribute("data-theme");
    }
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", dark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
    } catch (e) {}
    syncControls(dark);
  }

  function set(mode) {
    var val = mode === "dark" ? "dark" : "light";
    try {
      localStorage.setItem(LS_KEY, val);
    } catch (e) {}
    apply(val);
    try {
      window.dispatchEvent(
        new CustomEvent("tarpan:theme-change", {
          detail: { theme: val, dark: val === "dark" },
        }),
      );
    } catch (e) {}
    return val;
  }

  function toggle() {
    return set(isDark() ? "light" : "dark");
  }

  function sync() {
    apply(get());
  }

  window.TarpanTheme = {
    get: get,
    set: set,
    toggle: toggle,
    isDark: isDark,
    apply: apply,
    sync: sync,
  };

  apply(get());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sync);
  }
  window.addEventListener("storage", function (e) {
    if (e && e.key === LS_KEY) apply(get());
  });
})();
