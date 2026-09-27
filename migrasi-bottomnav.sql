-- ============ BOTTOM NAV + SHEET DINAMIS (diatur super_admin) ============
-- Config tersimpan di tabel site_content kunci 'bottomnav_menu' (baca
-- publik, tulis HANYA via RPC). Yang boleh mengatur: super_admin + siapa
-- pun yang punya hak kelola "Site" (halaman "site" di menu Akses).
-- User biasa hanya melihat.
--
-- CARA PAKAI (sekali saja):
--   1. Buka Supabase Dashboard > SQL Editor > New query
--   2. Paste seluruh isi file ini > Run
--   3. Refresh web, tombol "Atur Navigasi" muncul untuk super_admin
--
-- Client memakai: getBottomnav() / simpanBottomnav() di js/db.js,
-- render oleh js/bottomnav.js, editor oleh js/nav-atur.js.
--
-- Bentuk config (JSON):
--   { "tabs":  [{ "route":"home", "label":"Home", "icon":"fa-solid fa-house" }],
--     "sheet": [{ "route":"musik", "label":"Request Lagu", "sub":"Radio jam istirahat",
--                 "icon":"fa-solid fa-music", "short":"Musik" },
--               { "href":"https://...", "label":"Link Luar", "sub":"...",
--                 "icon":"fa-solid fa-link", "short":"Luar" }] }
-- - tabs: 1..4 item, wajib route internal (tombol tengah statis, tidak
--   dikonfigurasi). Rute harus ada sebagai <section class="view"> di HTML
--   (client skip yang tidak dikenal).
-- - sheet: 0..12 item, route internal ATAU href eksternal (salah satu).
-- - "short" (label mini tombol tengah) opsional, fallback ke label.

CREATE OR REPLACE FUNCTION public.simpan_bottomnav(
    p_user_id bigint,
    p_menu jsonb
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_tabs jsonb;
    v_sheet jsonb;
    v_item jsonb;
    v_route text;
    v_href text;
    v_label text;
    v_sub text;
    v_icon text;
    v_short text;
    v_lihat text[] := '{}';
BEGIN
    -- hanya pengelola Site (termasuk super_admin) yang boleh atur
    IF NOT public.osis_bisa(p_user_id, 'site') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;

    IF p_menu IS NULL OR jsonb_typeof(p_menu) <> 'object' THEN
        RETURN 'ERR_BAD_MENU';
    END IF;

    v_tabs := COALESCE(p_menu->'tabs', '[]'::jsonb);
    v_sheet := COALESCE(p_menu->'sheet', '[]'::jsonb);
    IF jsonb_typeof(v_tabs) <> 'array' OR jsonb_typeof(v_sheet) <> 'array' THEN
        RETURN 'ERR_BAD_MENU';
    END IF;
    IF jsonb_array_length(v_tabs) < 1 OR jsonb_array_length(v_tabs) > 4 THEN
        RETURN 'ERR_BAD_TABS';
    END IF;
    IF jsonb_array_length(v_sheet) > 12 THEN
        RETURN 'ERR_BAD_SHEET';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_tabs || v_sheet) LOOP
        IF jsonb_typeof(v_item) <> 'object' THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        v_route := NULLIF(btrim(COALESCE(v_item->>'route', '')), '');
        v_href := NULLIF(btrim(COALESCE(v_item->>'href', '')), '');
        v_label := NULLIF(btrim(COALESCE(v_item->>'label', '')), '');
        v_sub := left(COALESCE(v_item->>'sub', ''), 40);
        v_icon := NULLIF(btrim(COALESCE(v_item->>'icon', '')), '');
        v_short := left(NULLIF(btrim(COALESCE(v_item->>'short', '')), ''), 12);
        -- route XOR href (salah satu wajib)
        IF (v_route IS NULL) = (v_href IS NULL) THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        IF v_route IS NOT NULL AND v_route !~ '^[a-z0-9-]+$' THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        IF v_href IS NOT NULL AND v_href !~ '^(https?://|mailto:)' THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        IF v_label IS NULL THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        IF char_length(v_label) > 20 OR char_length(COALESCE(v_href, '')) > 200 THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        IF v_icon IS NULL OR v_icon = '' THEN
            v_icon := 'fa-solid fa-link';
        END IF;
        IF char_length(v_icon) > 80 THEN
            v_icon := 'fa-solid fa-link';
        END IF;
        -- rute tidak boleh dobel (tab vs sheet)
        IF v_route IS NOT NULL THEN
            IF v_route = ANY (v_lihat) THEN
                RETURN 'ERR_DUP_ROUTE';
            END IF;
            v_lihat := v_lihat || v_route;
        END IF;
    END LOOP;

    -- tab wajib route internal (link luar cuma boleh di sheet)
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_tabs) LOOP
        IF NULLIF(btrim(COALESCE(v_item->>'route', '')), '') IS NULL THEN
            RETURN 'ERR_TABS_INTERNAL';
        END IF;
    END LOOP;

    INSERT INTO public.site_content (kunci, nilai, updated_at, updated_by)
    VALUES ('bottomnav_menu', p_menu::text, now(), p_user_id)
    ON CONFLICT (kunci) DO UPDATE SET
        nilai = EXCLUDED.nilai,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;
    RETURN 'OK';
END $$;

REVOKE EXECUTE ON FUNCTION public.simpan_bottomnav(bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.simpan_bottomnav(bigint, jsonb) TO anon;
