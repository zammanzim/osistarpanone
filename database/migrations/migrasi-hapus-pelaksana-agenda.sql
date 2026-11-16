-- =========================================================================
-- Migrasi: buang kolom pelaksana di sekbid_agenda — pakai pengunggah saja
-- - pelaksana selalu diisi otomatis dari akun yang input (namaSaya), jadi
--   749/757 baris identik dengan pengunggah; 8 sisanya cuma beda ejaan.
-- - pengunggah terisi 100% (trigger isi_pengunggah) -> satu-satunya sumber
--   "siapa" di agenda.
-- - index idx_agenda_pelaksana ikut kehapus otomatis, TIDAK dibuat ulang
--   (tidak ada query yang filter pakai pelaksana).
-- - RPC buat_agenda/update_agenda signature TIDAK berubah (param p_pelaksana
--   tetap ada tapi diabaikan) supaya client PWA/cache lama tidak pecah.
-- - sekbid_agenda_ringkas: n_orang dihitung dari pengunggah.
-- =========================================================================

ALTER TABLE public.sekbid_agenda DROP COLUMN IF EXISTS pelaksana;

CREATE OR REPLACE FUNCTION public.buat_agenda(
    p_user_id bigint,
    p_sekbid_id bigint,
    p_judul text,
    p_deskripsi text,
    p_tanggal date,
    p_lokasi text,
    p_status text,
    p_fotos jsonb,
    p_display_order integer DEFAULT 99,  -- deprecated: diabaikan
    p_pelaksana text DEFAULT ''          -- deprecated: diabaikan
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    IF p_sekbid_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sekbid WHERE id=p_sekbid_id) THEN RETURN -2; END IF;
    p_judul := left(COALESCE(NULLIF(btrim(p_judul),''),'Tanpa Judul'), 80);
    p_deskripsi := left(COALESCE(p_deskripsi,''), 500);
    p_lokasi := left(COALESCE(p_lokasi,''), 80);
    p_status := COALESCE(NULLIF(btrim(p_status),''), 'selesai');
    IF p_status NOT IN ('rencana','proses','selesai','batal') THEN p_status := 'selesai'; END IF;
    IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' THEN p_fotos := '[]'::jsonb; END IF;
    INSERT INTO public.sekbid_agenda (sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, created_by)
    VALUES (p_sekbid_id, p_judul, p_deskripsi, p_tanggal, p_lokasi, p_status, p_fotos, p_user_id) RETURNING id INTO nid;
    RETURN nid;
END $function$;

CREATE OR REPLACE FUNCTION public.update_agenda(
    p_user_id bigint,
    p_id bigint,
    p_judul text,
    p_deskripsi text,
    p_tanggal date,
    p_lokasi text,
    p_status text,
    p_fotos jsonb,
    p_display_order integer DEFAULT 99,  -- deprecated: diabaikan
    p_pelaksana text DEFAULT ''          -- deprecated: diabaikan
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.sekbid_agenda SET judul=left(COALESCE(NULLIF(btrim(p_judul),judul),judul),80), deskripsi=left(COALESCE(p_deskripsi,deskripsi),500), tanggal=COALESCE(p_tanggal,tanggal), lokasi=left(COALESCE(p_lokasi,lokasi),80), status=COALESCE(NULLIF(btrim(p_status),status),status), fotos=COALESCE(p_fotos,fotos) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $function$;

CREATE OR REPLACE FUNCTION public.sekbid_agenda_ringkas(
  p_user_id bigint,
  p_sekbid_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_bln text := to_char(CURRENT_DATE, 'YYYY-MM');
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'total', COUNT(*),
      'bulan_ini', COUNT(*) FILTER (WHERE left(tanggal::text, 7) = v_bln),
      'n_sekbid', COUNT(DISTINCT sekbid_id),
      'n_orang', COUNT(DISTINCT NULLIF(btrim(COALESCE(pengunggah, '')), ''))
    )
    FROM public.sekbid_agenda
    WHERE (p_sekbid_id IS NULL OR sekbid_id = p_sekbid_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.buat_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sekbid_agenda_ringkas(bigint, bigint) TO anon, authenticated;
