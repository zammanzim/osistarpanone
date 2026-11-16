-- =========================================================================
-- MIGRASI-SIDEBAR-GRUP — sidebar OSIS dikasih "grup" (judul pemisah teks,
-- mis. Umum / Sekretaris / Bendahara / Super Admin). NON-DESTRUKTIF.
-- 1) simpan_sidebar: ikut menyimpan field "grup" (versi lama membuangnya).
--    Validasi & batas lama tidak berubah (30 item, href<=120, label<=40).
-- 2) Sekali jalan: menu tersimpan di site_content ditambah grup + diurutkan
--    ulang biar item segrup berurutan. Label/ikon custom TIDAK diubah.
--    GUARD: hanya jalan kalau nilai lama belum punya "grup" -> aman diulang,
--    tidak menimpa kalau owner sudah mengatur ulang lewat editor.
-- Frontend: js/osis-sidebar.js (editor punya input Grup).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.simpan_sidebar(p_user_id bigint, p_key text, p_menu jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_item jsonb;
    v_href text;
    v_label text;
    v_icon text;
    v_super boolean;
    v_grup text;
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
        v_grup := btrim(COALESCE(v_item->>'grup', ''));
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
            'href', v_href, 'label', v_label, 'icon', v_icon, 'super', v_super, 'grup', v_grup
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

-- ---- Sekali: tambah grup ke menu yang sudah tersimpan (urutan baru) ----
-- Super Admin paling atas; Umum; Sekretaris; Bendahara.
UPDATE public.site_content
SET nilai = '[{"href":"akses","icon":"fa-solid fa-key","label":"Akses","super":true,"grup":"Super Admin"},{"href":"logs","icon":"fa-solid fa-clock-rotate-left","label":"Logs","super":true,"grup":"Super Admin"},{"href":"notifikasi","icon":"fa-solid fa-info","label":"Kirim Notifikasi","super":true,"grup":"Super Admin"},{"href":"index","icon":"fa-solid fa-grip","label":"Dashboard","super":false,"grup":"Umum"},{"href":"agenda","icon":"fa-solid fa-calendar-days","label":"Agenda","super":false,"grup":"Umum"},{"href":"anggota","icon":"fa-solid fa-users","label":"Anggota","super":false,"grup":"Umum"},{"href":"informasi","icon":"fa-solid fa-info","label":"informasi","super":false,"grup":"Umum"},{"href":"poster","icon":"fa-solid fa-image","label":"Arsip Poster","super":false,"grup":"Umum"},{"href":"wawancara","icon":"fa-solid fa-microphone","label":"Wawancara","super":false,"grup":"Umum"},{"href":"program-bulanan","icon":"fa-solid fa-calendar-days","label":"Program Bulanan","super":false,"grup":"Umum"},{"href":"program-tahunan","icon":"fa-solid fa-calendar","label":"Program Tahunan","super":false,"grup":"Umum"},{"href":"absensi","icon":"fa-solid fa-clipboard-user","label":"Absensi","super":false,"grup":"Sekretaris"},{"href":"notulensi","icon":"fa-solid fa-clipboard-list","label":"Notulensi","super":false,"grup":"Sekretaris"},{"href":"dokumen","icon":"fa-solid fa-folder-open","label":"Dokumen","super":false,"grup":"Sekretaris"},{"href":"keuangan","icon":"fa-solid fa-wallet","label":"Keuangan","super":false,"grup":"Bendahara"},{"href":"tabungan","icon":"fa-solid fa-piggy-bank","label":"Tabungan","super":false,"grup":"Bendahara"}]',
    updated_at = now()
WHERE kunci = 'sidebar_menu'
  AND nilai NOT LIKE '%"grup"%';
