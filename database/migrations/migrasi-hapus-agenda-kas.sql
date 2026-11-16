-- =========================================================================
-- MIGRASI-HAPUS-AGENDA-KAS
-- Menghapus kolom agenda_id dari public.osis_kas.
-- Signature RPC buat_kas & update_kas tetap mempertahankan parameter
-- p_agenda_id (diabaikan) agar cache PWA / client lama tidak pecah.
-- Cara pakai: Supabase SQL Editor > tempel > Run.
-- =========================================================================

BEGIN;

-- ================= 1. PERBARUI RPC AGAR TIDAK MENULIS agenda_id =================
CREATE OR REPLACE FUNCTION public.buat_kas(
  p_user_id     bigint,
  p_jenis       text,
  p_tanggal     date,
  p_keterangan  text,
  p_kategori    text,
  p_nominal     bigint,
  p_divisi      text,
  p_pic         text,
  p_proker_id   bigint,
  p_agenda_id   bigint, -- deprecated: diabaikan
  p_catatan     text,
  p_bukti_path  text,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  nid   bigint;
  v_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'keuangan') THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  p_keterangan := COALESCE(NULLIF(btrim(p_keterangan), ''), '');
  IF p_keterangan = '' THEN RETURN -2; END IF;
  IF COALESCE(p_nominal, 0) <= 0 THEN RETURN -3; END IF;
  p_jenis := COALESCE(NULLIF(btrim(p_jenis), ''), 'masuk');
  IF p_jenis NOT IN ('masuk', 'keluar') THEN p_jenis := 'masuk'; END IF;

  INSERT INTO public.osis_kas (
    jenis, tanggal, keterangan, kategori, nominal, divisi, pic,
    proker_id, catatan, bukti_path, created_by, angkatan_id
  ) VALUES (
    p_jenis, COALESCE(p_tanggal, CURRENT_DATE), left(p_keterangan, 200),
    left(COALESCE(p_kategori, ''), 60), p_nominal,
    left(COALESCE(p_divisi, ''), 80), left(COALESCE(p_pic, ''), 120),
    p_proker_id, left(COALESCE(p_catatan, ''), 1000),
    left(COALESCE(p_bukti_path, ''), 300), p_user_id, v_ang
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_kas(
  p_user_id    bigint,
  p_id         bigint,
  p_jenis      text,
  p_tanggal    date,
  p_keterangan text,
  p_kategori   text,
  p_nominal    bigint,
  p_divisi     text,
  p_pic        text,
  p_proker_id  bigint,
  p_agenda_id  bigint, -- deprecated: diabaikan
  p_catatan    text,
  p_bukti_path text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang   bigint;
  v_uk_id bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'keuangan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id, uang_kas_setoran_id INTO v_ang, v_uk_id
    FROM public.osis_kas WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF v_uk_id IS NOT NULL THEN RETURN 'ERR_DARI_UANG_KAS'; END IF;
  IF p_nominal IS NOT NULL AND p_nominal <= 0 THEN RETURN 'ERR_NOMINAL'; END IF;

  UPDATE public.osis_kas SET
    jenis       = CASE WHEN p_jenis IN ('masuk', 'keluar') THEN p_jenis ELSE jenis END,
    tanggal     = COALESCE(p_tanggal, tanggal),
    keterangan  = left(COALESCE(NULLIF(btrim(p_keterangan), keterangan), keterangan), 200),
    kategori    = left(COALESCE(p_kategori, kategori), 60),
    nominal     = COALESCE(p_nominal, nominal),
    divisi      = left(COALESCE(p_divisi, divisi), 80),
    pic         = left(COALESCE(p_pic, pic), 120),
    proker_id   = p_proker_id,
    catatan     = left(COALESCE(p_catatan, catatan), 1000),
    bukti_path  = left(COALESCE(p_bukti_path, bukti_path), 300),
    updated_at  = now()
  WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.buat_uang_kas_setoran(
  p_user_id     bigint,
  p_nama        text,
  p_tanggal     date,
  p_nominal     bigint,
  p_catatan     text DEFAULT '',
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  nid          bigint;
  v_ang        bigint;
  v_catatan    text;
  v_pengunggah text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'uang-kas') THEN RETURN -1; END IF;

  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  IF p_tanggal IS NULL THEN RETURN -2; END IF;

  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN -3; END IF;
  IF COALESCE(p_nominal, 0) <= 0 THEN RETURN -4; END IF;
  v_catatan := left(btrim(COALESCE(p_catatan, '')), 300);

  INSERT INTO public.osis_uang_kas_setoran (
    angkatan_id, nama, tanggal, nominal, catatan, created_by
  ) VALUES (
    v_ang, p_nama, p_tanggal, p_nominal, v_catatan, p_user_id
  ) RETURNING id, COALESCE(pengunggah, '') INTO nid, v_pengunggah;

  INSERT INTO public.osis_kas (
    jenis, tanggal, keterangan, kategori, nominal,
    divisi, pic, proker_id, catatan, bukti_path,
    created_by, pengunggah, angkatan_id, uang_kas_setoran_id
  ) VALUES (
    'masuk', p_tanggal, left('Uang Kas: ' || p_nama, 200), 'Uang Kas', p_nominal,
    '', p_nama, NULL, v_catatan, '',
    p_user_id, v_pengunggah, v_ang, nid
  );

  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_uang_kas_setoran(
  p_user_id bigint,
  p_id      bigint,
  p_nama    text,
  p_tanggal date,
  p_nominal bigint,
  p_catatan text DEFAULT ''
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang        bigint;
  v_created_by bigint;
  v_pengunggah text;
  v_catatan    text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'uang-kas') THEN RETURN 'ERR_NO_AUTH'; END IF;

  SELECT angkatan_id INTO v_ang FROM public.osis_uang_kas_setoran WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;

  IF p_tanggal IS NULL THEN RETURN 'ERR_NO_TANGGAL'; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN 'ERR_NO_NAMA'; END IF;
  IF COALESCE(p_nominal, 0) <= 0 THEN RETURN 'ERR_NOMINAL'; END IF;
  v_catatan := left(btrim(COALESCE(p_catatan, '')), 300);

  UPDATE public.osis_uang_kas_setoran
     SET nama       = p_nama,
         tanggal    = p_tanggal,
         nominal    = p_nominal,
         catatan    = v_catatan,
         updated_at = now()
   WHERE id = p_id
   RETURNING created_by, COALESCE(pengunggah, '') INTO v_created_by, v_pengunggah;

  INSERT INTO public.osis_kas (
    jenis, tanggal, keterangan, kategori, nominal,
    divisi, pic, proker_id, catatan, bukti_path,
    created_by, pengunggah, angkatan_id, uang_kas_setoran_id
  ) VALUES (
    'masuk', p_tanggal, left('Uang Kas: ' || p_nama, 200), 'Uang Kas', p_nominal,
    '', p_nama, NULL, v_catatan, '',
    COALESCE(v_created_by, p_user_id), v_pengunggah, v_ang, p_id
  )
  ON CONFLICT (uang_kas_setoran_id) DO UPDATE SET
    tanggal    = EXCLUDED.tanggal,
    keterangan = EXCLUDED.keterangan,
    kategori   = 'Uang Kas',
    nominal    = EXCLUDED.nominal,
    pic        = EXCLUDED.pic,
    catatan    = EXCLUDED.catatan,
    updated_at = now();

  RETURN 'OK';
END;
$function$;

-- ================= 2. HAPUS KOLOM agenda_id DARI osis_kas =================
ALTER TABLE public.osis_kas DROP COLUMN IF EXISTS agenda_id;

COMMIT;
