-- ============ SIDEBAR DINAMIS (diatur pusat, berlaku untuk semua user) ============
-- Config tersimpan di tabel site_content (baca publik, tulis HANYA via RPC).
-- Yang boleh mengatur: super_admin + siapa pun yang punya hak kelola "Site"
-- (halaman "site" di menu Akses). User biasa hanya melihat.
--
-- CARA PAKAI (sekali saja):
--   1. Buka Supabase Dashboard > SQL Editor > New query
--   2. Paste seluruh isi file ini > Run
--   3. Refresh halaman OSIS, tombol "Atur Menu" muncul untuk super_admin
--
-- Client memakai: getSidebarMenu() / simpanSidebarMenu() di js/db.js
-- Kunci yang dipakai: sidebar_menu (folder /osis) dan sidebar_menu_bin (folder /osisbin)

CREATE OR REPLACE FUNCTION public.simpan_sidebar(
    p_user_id bigint,
    p_key text,
    p_menu jsonb
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_item jsonb;
    v_href text;
    v_label text;
    v_icon text;
    v_super boolean;
    v_bersih jsonb := '[]'::jsonb;
BEGIN
    -- hanya pengelola Site (termasuk super_admin) yang boleh atur sidebar
    IF NOT public.osis_bisa(p_user_id, 'site') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;

    IF p_key IS NULL OR p_key NOT IN ('sidebar_menu', 'sidebar_menu_bin') THEN
        RETURN 'ERR_BAD_KEY';
    END IF;

    IF p_menu IS NULL OR jsonb_typeof(p_menu) <> 'array' THEN
        RETURN 'ERR_BAD_MENU';
    END IF;

    IF jsonb_array_length(p_menu) < 1 OR jsonb_array_length(p_menu) > 30 THEN
        RETURN 'ERR_BAD_MENU';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_menu) LOOP
        IF jsonb_typeof(v_item) <> 'object' THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        v_href := NULLIF(btrim(COALESCE(v_item->>'href', '')), '');
        v_label := NULLIF(btrim(COALESCE(v_item->>'label', '')), '');
        v_icon := NULLIF(btrim(COALESCE(v_item->>'icon', '')), '');
        v_super := (v_item->>'super') IN ('true', '1', 't');
        IF v_href IS NULL OR v_label IS NULL THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        IF char_length(v_href) > 120 OR char_length(v_label) > 40 THEN
            RETURN 'ERR_BAD_MENU';
        END IF;
        IF v_icon IS NULL OR v_icon = '' THEN
            v_icon := 'fa-solid fa-link';
        END IF;
        IF char_length(v_icon) > 80 THEN
            v_icon := 'fa-solid fa-link';
        END IF;
        v_bersih := v_bersih || jsonb_build_object(
            'href', v_href, 'label', v_label, 'icon', v_icon, 'super', v_super
        );
    END LOOP;

    INSERT INTO public.site_content (kunci, nilai, updated_at, updated_by)
    VALUES (p_key, v_bersih::text, now(), p_user_id)
    ON CONFLICT (kunci) DO UPDATE SET
        nilai = EXCLUDED.nilai,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;
    RETURN 'OK';
END $$;

REVOKE EXECUTE ON FUNCTION public.simpan_sidebar(bigint, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.simpan_sidebar(bigint, text, jsonb) TO anon;