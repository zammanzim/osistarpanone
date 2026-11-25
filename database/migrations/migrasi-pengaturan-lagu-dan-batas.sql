-- =========================================================================
-- MIGRASI-PENGATURAN-LAGU-DAN-BATAS
-- Menambahkan pengaturan terpusat untuk:
--   1. Sakelar buka/tutup Request Lagu (pengaturan.status_lagu: BUKA / TUTUP)
--   2. Batas kirim harian per perangkat untuk Aspirasi & Request Lagu
--      (pengaturan.batas_harian_aspirasi & batas_harian_lagu: 0 = tanpa batas, 1..50)
--   3. Perbaikan otorisasi simpan_pengaturan per hak modul (aspirasi / lagu / site)
--   4. Penegakan status TUTUP & batas harian dinamis langsung di RPC server
--
-- Cara pakai: Supabase SQL Editor > tempel > Run.
-- =========================================================================

BEGIN;

-- 1) Seed kunci bawaan (idempoten, tidak menimpa nilai yang sudah ada)
INSERT INTO public.pengaturan (kunci, nilai, updated_at)
VALUES
  ('status_aspirasi', 'BUKA', now()),
  ('status_lagu', 'BUKA', now()),
  ('batas_harian_aspirasi', '1', now()),
  ('batas_harian_lagu', '1', now())
ON CONFLICT (kunci) DO NOTHING;

-- 2) Perbarui RPC simpan_pengaturan agar mendukung hak per modul + validasi nilai
CREATE OR REPLACE FUNCTION public.simpan_pengaturan(
  p_user_id bigint,
  p_kunci text,
  p_nilai text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_kunci text;
  v_nilai text;
  v_angka integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN 'ERR_NO_AUTH';
    END IF;
  END IF;

  v_kunci := btrim(coalesce(p_kunci, ''));
  IF v_kunci = '' OR char_length(v_kunci) > 80 THEN
    RETURN 'ERR_KEY';
  END IF;

  -- Cek hak sesuai domain kunci
  IF v_kunci IN ('status_aspirasi', 'batas_harian_aspirasi') THEN
    IF NOT (public.osis_bisa(p_user_id, 'aspirasi') OR public.osis_bisa(p_user_id, 'site')) THEN
      RETURN 'ERR_NO_AUTH';
    END IF;
  ELSIF v_kunci IN ('status_lagu', 'batas_harian_lagu') THEN
    IF NOT (public.osis_bisa(p_user_id, 'lagu') OR public.osis_bisa(p_user_id, 'site')) THEN
      RETURN 'ERR_NO_AUTH';
    END IF;
  ELSE
    IF NOT public.osis_bisa(p_user_id, 'site') THEN
      RETURN 'ERR_NO_AUTH';
    END IF;
  END IF;

  v_nilai := left(btrim(coalesce(p_nilai, '')), 2000);

  -- Validasi nilai spesifik
  IF v_kunci IN ('status_aspirasi', 'status_lagu') THEN
    v_nilai := upper(v_nilai);
    IF v_nilai NOT IN ('BUKA', 'TUTUP') THEN
      RETURN 'ERR_BAD_STATUS';
    END IF;
  ELSIF v_kunci IN ('batas_harian_aspirasi', 'batas_harian_lagu') THEN
    IF v_nilai !~ '^\d+$' THEN
      RETURN 'ERR_BAD_LIMIT';
    END IF;
    v_angka := v_nilai::integer;
    IF v_angka < 0 OR v_angka > 50 THEN
      RETURN 'ERR_BAD_LIMIT';
    END IF;
    v_nilai := v_angka::text;
  END IF;

  INSERT INTO public.pengaturan (kunci, nilai, updated_at)
  VALUES (v_kunci, v_nilai, now())
  ON CONFLICT (kunci) DO UPDATE
    SET nilai = EXCLUDED.nilai,
        updated_at = now();

  RETURN 'OK';
END;
$function$;

-- 3) Perbarui kirim_aspirasi_terbatas: patuhi status_aspirasi + batas_harian_aspirasi
CREATE OR REPLACE FUNCTION public.kirim_aspirasi_terbatas(
  p_device_id text,
  p_nama text,
  p_kelas text,
  p_isi text,
  p_is_private boolean DEFAULT false,
  p_batas_harian integer DEFAULT 1
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n integer;
  v_status text;
  v_batas_txt text;
  v_batas integer := 1;
  v_hari_wib constant date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RETURN 'ERR_NO_DEVICE';
  END IF;
  IF p_isi IS NULL OR btrim(p_isi) = '' THEN
    RETURN 'ERR_EMPTY';
  END IF;

  SELECT upper(btrim(nilai)) INTO v_status
  FROM public.pengaturan
  WHERE kunci = 'status_aspirasi';

  IF coalesce(v_status, 'BUKA') <> 'BUKA' THEN
    RETURN 'ERR_TUTUP';
  END IF;

  SELECT btrim(nilai) INTO v_batas_txt
  FROM public.pengaturan
  WHERE kunci = 'batas_harian_aspirasi';

  IF v_batas_txt ~ '^\d+$' THEN
    v_batas := LEAST(50, GREATEST(0, v_batas_txt::integer));
  END IF;

  IF v_batas > 0 THEN
    SELECT count(*) INTO n
    FROM public.aspirasi
    WHERE device_id = p_device_id
      AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_hari_wib;
    IF n >= v_batas THEN
      RETURN 'ERR_LIMIT';
    END IF;
  END IF;

  INSERT INTO public.aspirasi (device_id, nama, kelas, isi, is_private)
  VALUES (
    p_device_id,
    left(coalesce(nullif(btrim(p_nama), ''), 'Anonim'), 60),
    left(coalesce(nullif(btrim(p_kelas), ''), '-'), 30),
    left(btrim(p_isi), 500),
    coalesce(p_is_private, false)
  );
  RETURN 'OK';
END;
$function$;

-- 4) Perbarui kirim_lagu_terbatas: patuhi status_lagu + batas_harian_lagu
CREATE OR REPLACE FUNCTION public.kirim_lagu_terbatas(
  p_device_id text,
  p_judul text,
  p_penyanyi text,
  p_pesan text,
  p_nama text,
  p_batas_harian integer DEFAULT 1
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n integer;
  v_status text;
  v_batas_txt text;
  v_batas integer := 1;
  v_hari_wib constant date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RETURN 'ERR_NO_DEVICE';
  END IF;
  IF p_judul IS NULL OR btrim(p_judul) = '' OR p_penyanyi IS NULL OR btrim(p_penyanyi) = '' THEN
    RETURN 'ERR_EMPTY';
  END IF;

  SELECT upper(btrim(nilai)) INTO v_status
  FROM public.pengaturan
  WHERE kunci = 'status_lagu';

  IF coalesce(v_status, 'BUKA') <> 'BUKA' THEN
    RETURN 'ERR_TUTUP';
  END IF;

  SELECT btrim(nilai) INTO v_batas_txt
  FROM public.pengaturan
  WHERE kunci = 'batas_harian_lagu';

  IF v_batas_txt ~ '^\d+$' THEN
    v_batas := LEAST(50, GREATEST(0, v_batas_txt::integer));
  END IF;

  IF v_batas > 0 THEN
    SELECT count(*) INTO n
    FROM public.lagu_requests
    WHERE device_id = p_device_id
      AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_hari_wib;
    IF n >= v_batas THEN
      RETURN 'ERR_LIMIT';
    END IF;
  END IF;

  INSERT INTO public.lagu_requests (device_id, judul, penyanyi, pesan, nama)
  VALUES (
    p_device_id,
    left(btrim(p_judul), 80),
    left(btrim(p_penyanyi), 60),
    left(coalesce(nullif(btrim(p_pesan), ''), ''), 300),
    left(coalesce(nullif(btrim(p_nama), ''), 'Anonim'), 50)
  );
  RETURN 'OK';
END;
$function$;

COMMIT;
