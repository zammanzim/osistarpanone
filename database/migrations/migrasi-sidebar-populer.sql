-- =========================================================================
-- MIGRASI-SIDEBAR-POPULER — dukung pin "Menu Populer" (grid 2 kolom atas)
-- di sidebar OSIS tanpa menghapus item dari grup aslinya. NON-DESTRUKTIF.
--
-- 1) simpan_sidebar: ikut menyimpan field boolean "populer", tetap menjaga
--    otentikasi osis_id_dari_auth() + osis_bisa('site') & search_path aman.
-- 2) Sekali jalan (idempoten, guard NOT LIKE '%"populer"%'):
--    - Tambah field "populer" (true untuk agenda, tabungan, program-bulanan, uang-kas)
--    - Pindah Dashboard (index) ke paling atas (grup = '')
--    - Kapitalkan label 'informasi' -> 'Informasi'
--    - Geser grup Super Admin ke paling bawah
--
-- Cara pakai: Supabase SQL Editor > tempel > Run.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.simpan_sidebar(p_user_id bigint, p_key text, p_menu jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_item jsonb;
    v_href text;
    v_label text;
    v_icon text;
    v_super boolean;
    v_grup text;
    v_populer boolean;
    v_bersih jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL; -- service key/script boleh kirim identitas sendiri
  ELSE
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN 'ERR_NO_AUTH';
    END IF;
  END IF;

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
        v_grup := btrim(COALESCE(v_item->>'grup', ''));
        v_populer := COALESCE((v_item->>'populer') IN ('true', '1', 't'), false);
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
        IF char_length(v_grup) > 40 THEN
            v_grup := left(v_grup, 40);
        END IF;
        v_bersih := v_bersih || jsonb_build_object(
            'href', v_href,
            'label', v_label,
            'icon', v_icon,
            'super', v_super,
            'grup', v_grup,
            'populer', v_populer
        );
    END LOOP;

    INSERT INTO public.site_content (kunci, nilai, updated_at, updated_by)
    VALUES (p_key, v_bersih::text, now(), p_user_id)
    ON CONFLICT (kunci) DO UPDATE SET
        nilai = EXCLUDED.nilai,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;
    RETURN 'OK';
END $function$;

UPDATE public.site_content AS sc
SET nilai = (
    SELECT jsonb_agg(
        jsonb_build_object(
            'href', elem.val->>'href',
            'label', CASE
                WHEN elem.val->>'label' = 'informasi' THEN 'Informasi'
                ELSE elem.val->>'label'
            END,
            'icon', COALESCE(NULLIF(btrim(COALESCE(elem.val->>'icon', '')), ''), 'fa-solid fa-link'),
            'super', COALESCE((elem.val->>'super') IN ('true', '1', 't'), false),
            'grup', CASE
                WHEN regexp_replace(lower(btrim(COALESCE(elem.val->>'href', ''))), '\.html?$', '') = 'index' THEN ''
                ELSE btrim(COALESCE(elem.val->>'grup', ''))
            END,
            'populer', (
                regexp_replace(lower(btrim(COALESCE(elem.val->>'href', ''))), '\.html?$', '')
                IN ('agenda', 'tabungan', 'program-bulanan', 'uang-kas')
            )
        )
        ORDER BY
            CASE
                WHEN regexp_replace(lower(btrim(COALESCE(elem.val->>'href', ''))), '\.html?$', '') = 'index' THEN 0
                WHEN lower(btrim(COALESCE(elem.val->>'grup', ''))) = 'super admin'
                  OR COALESCE((elem.val->>'super') IN ('true', '1', 't'), false) THEN 2
                ELSE 1
            END,
            elem.ord
    )::text
    FROM jsonb_array_elements(sc.nilai::jsonb) WITH ORDINALITY AS elem(val, ord)
),
updated_at = now()
WHERE sc.kunci = 'sidebar_menu'
  AND jsonb_typeof(sc.nilai::jsonb) = 'array'
  AND jsonb_array_length(sc.nilai::jsonb) > 0
  AND sc.nilai NOT LIKE '%"populer"%';

COMMIT;
