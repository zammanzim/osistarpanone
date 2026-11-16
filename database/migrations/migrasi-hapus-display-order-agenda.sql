-- =========================================================================
-- Migrasi: buang kolom mati sekbid_agenda.display_order
-- - Kolom ini tidak dipakai UI: sortir pakai tanggal desc + created_at desc
--   (js/agenda.js "urutkan"). Isi data cuma default (756x 99, 1x 1).
-- - Index idx_agenda_sekbid ikut kehapus otomatis karena mengandung kolom
--   display_order -> dibuat ulang tanpa kolom itu.
-- - RPC buat_agenda/update_agenda signature TIDAK berubah (param
--   p_display_order tetap ada tapi diabaikan) supaya client PWA/cache lama
--   yang masih kirim p_display_order tidak pecah.
-- - update_agenda: p_display_order dikasih DEFAULT 99 biar client baru
--   (db.js) boleh tidak mengirim param tsb.
-- =========================================================================

ALTER TABLE public.sekbid_agenda DROP COLUMN IF EXISTS display_order;

CREATE INDEX IF NOT EXISTS idx_agenda_sekbid
  ON public.sekbid_agenda USING btree (sekbid_id, tanggal);

CREATE OR REPLACE FUNCTION public.buat_agenda(
    p_user_id bigint,
    p_sekbid_id bigint,
    p_judul text,
    p_deskripsi text,
    p_tanggal date,
    p_lokasi text,
    p_status text,
    p_fotos jsonb,
    p_display_order integer DEFAULT 99,  -- deprecated: diabaikan, pertahankan signature
    p_pelaksana text DEFAULT ''
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
    p_pelaksana := left(COALESCE(btrim(p_pelaksana),''), 60);
    INSERT INTO public.sekbid_agenda (sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, created_by, pelaksana)
    VALUES (p_sekbid_id, p_judul, p_deskripsi, p_tanggal, p_lokasi, p_status, p_fotos, p_user_id, p_pelaksana) RETURNING id INTO nid;
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
    p_display_order integer DEFAULT 99,  -- deprecated: diabaikan, pertahankan signature
    p_pelaksana text DEFAULT ''
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.sekbid_agenda SET judul=left(COALESCE(NULLIF(btrim(p_judul),judul),judul),80), deskripsi=left(COALESCE(p_deskripsi,deskripsi),500), tanggal=COALESCE(p_tanggal,tanggal), lokasi=left(COALESCE(p_lokasi,lokasi),80), status=COALESCE(NULLIF(btrim(p_status),status),status), fotos=COALESCE(p_fotos,fotos), pelaksana=left(COALESCE(p_pelaksana,pelaksana),60) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $function$;

GRANT EXECUTE ON FUNCTION public.buat_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text) TO anon, authenticated;
