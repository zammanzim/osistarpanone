-- =========================================================================
-- MIGRASI-FITUR-UANG-KAS-SKIP-DAN-BLOK
-- 1. Tambah kolom skip_anggota (jsonb) di public.osis_uang_kas_config.
-- 2. Buat RPC public.atur_uang_kas_skip_anggota untuk atur skip per anggota
--    (mulai wajib kas dari minggu tertentu &/atau daftar minggu di-skip).
-- 3. Perbarui RPC public.osis_kas_ringkas agar jumlah transaksi (n) menghitung
--    setoran Uang Kas sebagai 1 blok per minggu (konsisten dengan UI Keuangan).
-- 4. Pecah data setoran Uang Kas Apr-Nov (angkatan_id = 3) menjadi per-minggu
--    (@Rp2.000, 575 baris = 20 blok mingguan = Rp1.150.000) + set skip minggu
--    lama untuk Nizam & Muhammad Rizki Aditia Samsudin (mulai 2026-11-23).
-- Cara pakai: Supabase SQL Editor > tempel > Run.
-- =========================================================================

BEGIN;

-- ================= 1. KOLOM skip_anggota DI CONFIG =================
ALTER TABLE public.osis_uang_kas_config
  ADD COLUMN IF NOT EXISTS skip_anggota jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_uang_kas_skip_obj'
  ) THEN
    ALTER TABLE public.osis_uang_kas_config
      ADD CONSTRAINT chk_uang_kas_skip_obj CHECK (jsonb_typeof(skip_anggota) = 'object');
  END IF;
END $$;

-- ================= 2. RPC ATUR SKIP PER ANGGOTA =================
CREATE OR REPLACE FUNCTION public.atur_uang_kas_skip_anggota(
  p_user_id     bigint,
  p_nama        text,
  p_mulai       date DEFAULT NULL,
  p_minggu      jsonb DEFAULT '[]'::jsonb,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang    bigint;
  v_key    text;
  v_mulai  text := NULL;
  v_minggu jsonb := '[]'::jsonb;
  v_cur    jsonb;
  v_next   jsonb;
  v_entry  jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'uang-kas') THEN RETURN 'ERR_NO_AUTH'; END IF;

  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;

  v_key := lower(btrim(COALESCE(p_nama, '')));
  IF v_key = '' THEN RETURN 'ERR_NO_NAMA'; END IF;

  IF p_mulai IS NOT NULL THEN
    v_mulai := to_char(date_trunc('week', p_mulai)::date, 'YYYY-MM-DD');
  END IF;

  IF p_minggu IS NOT NULL AND jsonb_typeof(p_minggu) = 'array' THEN
    SELECT COALESCE(jsonb_agg(to_char(s_tgl, 'YYYY-MM-DD') ORDER BY s_tgl), '[]'::jsonb)
      INTO v_minggu
      FROM (
        SELECT DISTINCT date_trunc('week', (el #>> '{}')::date)::date AS s_tgl
          FROM jsonb_array_elements(p_minggu) AS el
         WHERE (el #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      ) sub;
  END IF;

  INSERT INTO public.osis_uang_kas_config (angkatan_id, updated_by)
  VALUES (v_ang, p_user_id)
  ON CONFLICT (angkatan_id) DO NOTHING;

  SELECT COALESCE(skip_anggota, '{}'::jsonb)
    INTO v_cur
    FROM public.osis_uang_kas_config
   WHERE angkatan_id = v_ang
   FOR UPDATE;

  IF v_mulai IS NULL AND jsonb_array_length(v_minggu) = 0 THEN
    v_next := v_cur - v_key;
  ELSE
    v_entry := jsonb_strip_nulls(
      jsonb_build_object(
        'mulai', v_mulai,
        'minggu', CASE WHEN jsonb_array_length(v_minggu) > 0 THEN v_minggu ELSE NULL END
      )
    );
    v_next := jsonb_set(v_cur, ARRAY[v_key], v_entry, true);
  END IF;

  UPDATE public.osis_uang_kas_config
     SET skip_anggota = v_next,
         updated_by   = p_user_id,
         updated_at   = now()
   WHERE angkatan_id = v_ang;

  RETURN 'OK';
END;
$function$;

REVOKE ALL ON FUNCTION public.atur_uang_kas_skip_anggota(bigint, text, date, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atur_uang_kas_skip_anggota(bigint, text, date, jsonb, bigint) TO authenticated, service_role;

-- ================= 3. RPC RINGKAS KEUANGAN (HITUNG BLOK MINGGUAN) =================
CREATE OR REPLACE FUNCTION public.osis_kas_ringkas(
  p_user_id     bigint,
  p_tahun       text DEFAULT NULL,
  p_jenis       text DEFAULT NULL,
  p_kategori    text DEFAULT NULL,
  p_divisi      text DEFAULT NULL,
  p_q           text DEFAULT NULL,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tahun text := NULLIF(btrim(COALESCE(p_tahun, '')), '');
  v_jenis text := NULLIF(btrim(COALESCE(p_jenis, '')), '');
  v_kat   text := NULLIF(btrim(COALESCE(p_kategori, '')), '');
  v_div   text := NULLIF(btrim(COALESCE(p_divisi, '')), '');
  v_q     text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_ang   bigint;
  v_hasil jsonb;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL;
  ELSE
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;

  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  WITH basis AS (
    SELECT k.jenis,
           COALESCE(k.nominal, 0) AS nominal,
           k.proker_id,
           k.uang_kas_setoran_id,
           CASE
             WHEN k.uang_kas_setoran_id IS NOT NULL AND k.tanggal IS NOT NULL
               THEN date_trunc('week', k.tanggal)::date
             ELSE NULL
           END AS uk_week,
           left(k.tanggal::text, 7) AS ym
      FROM public.osis_kas k
     WHERE k.angkatan_id = v_ang
       AND (v_tahun IS NULL OR left(k.tanggal::text, 4) = v_tahun)
       AND (v_jenis IS NULL OR k.jenis = v_jenis)
       AND (v_kat IS NULL OR k.kategori = v_kat)
       AND (v_div IS NULL OR k.divisi = v_div)
       AND (v_q IS NULL
            OR lower(COALESCE(k.keterangan, '')) LIKE '%' || lower(v_q) || '%' ESCAPE '\'
            OR lower(COALESCE(k.catatan, '')) LIKE '%' || lower(v_q) || '%' ESCAPE '\'
            OR lower(COALESCE(k.pic, '')) LIKE '%' || lower(v_q) || '%' ESCAPE '\')
  ),
  tot AS (
    SELECT COALESCE(SUM(CASE WHEN jenis = 'masuk' THEN nominal ELSE 0 END), 0) AS masuk,
           COALESCE(SUM(CASE WHEN jenis = 'keluar' THEN nominal ELSE 0 END), 0) AS keluar,
           (COUNT(*) FILTER (WHERE uk_week IS NULL)
            + COUNT(DISTINCT uk_week) FILTER (WHERE uk_week IS NOT NULL)) AS n
      FROM basis
  ),
  bln AS (
    SELECT ym,
           COALESCE(SUM(CASE WHEN jenis = 'masuk' THEN nominal ELSE 0 END), 0) AS masuk,
           COALESCE(SUM(CASE WHEN jenis = 'keluar' THEN nominal ELSE 0 END), 0) AS keluar,
           (COUNT(*) FILTER (WHERE uk_week IS NULL)
            + COUNT(DISTINCT uk_week) FILTER (WHERE uk_week IS NOT NULL)) AS n
      FROM basis
     WHERE ym ~ '^[0-9]{4}-[0-9]{2}$'
     GROUP BY ym ORDER BY ym DESC LIMIT 6
  ),
  prk AS (
    SELECT proker_id,
           COALESCE(SUM(CASE WHEN jenis = 'masuk' THEN nominal ELSE 0 END), 0) AS masuk,
           COALESCE(SUM(CASE WHEN jenis = 'keluar' THEN nominal ELSE 0 END), 0) AS keluar,
           COUNT(*) AS n
      FROM basis
     WHERE proker_id IS NOT NULL
     GROUP BY proker_id
  ),
  thn AS (
    SELECT DISTINCT left(tanggal::text, 4) AS th
      FROM public.osis_kas
     WHERE angkatan_id = v_ang
       AND tanggal IS NOT NULL AND left(tanggal::text, 4) ~ '^[0-9]{4}$'
     ORDER BY 1 DESC
  ),
  kat AS (
    SELECT DISTINCT kategori AS k
      FROM public.osis_kas
     WHERE angkatan_id = v_ang
       AND kategori IS NOT NULL AND btrim(kategori) <> ''
     ORDER BY 1
  )
  SELECT jsonb_build_object(
    'masuk', (SELECT masuk FROM tot),
    'keluar', (SELECT keluar FROM tot),
    'n', (SELECT n FROM tot),
    'per_bulan', COALESCE((SELECT jsonb_agg(
        jsonb_build_object('ym', ym, 'masuk', masuk, 'keluar', keluar, 'n', n)
        ORDER BY ym DESC) FROM bln), '[]'::jsonb),
    'per_proker', COALESCE((SELECT jsonb_agg(
        jsonb_build_object('proker_id', proker_id, 'masuk', masuk, 'keluar', keluar, 'n', n))
        FROM prk), '[]'::jsonb),
    'tahuns', COALESCE((SELECT jsonb_agg(th) FROM thn), '[]'::jsonb),
    'kategoris', COALESCE((SELECT jsonb_agg(k) FROM kat), '[]'::jsonb)
  ) INTO v_hasil;
  RETURN v_hasil;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.osis_kas_ringkas(bigint, text, text, text, text, text, bigint) TO authenticated, service_role;

-- ================= 4. DATA PER-MINGGU (@Rp2.000) + SKIP ANAK BARU =================
DELETE FROM public.osis_kas
 WHERE angkatan_id = 3 AND uang_kas_setoran_id IS NOT NULL;

DELETE FROM public.osis_uang_kas_setoran
 WHERE angkatan_id = 3;

INSERT INTO public.osis_uang_kas_config (
  angkatan_id, nominal_mingguan, tanggal_mulai, minggu_libur, tarif_riwayat, skip_anggota, catatan, updated_by, updated_at
) VALUES (
  3,
  2000,
  '2026-04-27',
  '["2026-06-22","2026-06-29","2026-07-06","2026-07-13","2026-07-20","2026-07-27","2026-08-10","2026-08-17","2026-08-24","2026-08-31"]'::jsonb,
  '[{"mulai":"2026-04-27","nominal":2000}]'::jsonb,
  '{"nizam fhamer arafli":{"mulai":"2026-11-23"},"muhammad rizki aditia samsudin":{"mulai":"2026-11-23"}}'::jsonb,
  'Sesuai buku kas tulis tangan bendahara (mulai 27 Apr 2026)',
  1,
  now()
)
ON CONFLICT (angkatan_id) DO UPDATE SET
  nominal_mingguan = EXCLUDED.nominal_mingguan,
  tanggal_mulai    = EXCLUDED.tanggal_mulai,
  minggu_libur     = EXCLUDED.minggu_libur,
  tarif_riwayat    = EXCLUDED.tarif_riwayat,
  skip_anggota     = EXCLUDED.skip_anggota,
  catatan          = EXCLUDED.catatan,
  updated_by       = EXCLUDED.updated_by,
  updated_at       = now();

WITH data_import (tanggal, nama, nominal, catatan) AS (
  VALUES
    ('2026-04-27'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-04-27'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-04-27'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-04-27'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-04-27'::date, 'Ayusta Bagas Abdillah', 2000::bigint, ''),
    ('2026-04-27'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-04-27'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-04-27'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-04-27'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-04-27'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-04-27'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-04-27'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-04-27'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-04-27'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-04-27'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-04-27'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-04-27'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-04-27'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-04-27'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-04-27'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-04-27'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-04-27'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-04-27'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-04-27'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-04-27'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-04-27'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-04-27'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-04-27'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-04-27'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-04-27'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-04-27'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-04-27'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-04-27'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-05-04'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-05-04'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-05-04'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-05-04'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-05-04'::date, 'Ayusta Bagas Abdillah', 2000::bigint, ''),
    ('2026-05-04'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-05-04'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-05-04'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-05-04'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-05-04'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-05-04'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-05-04'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-05-04'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-05-04'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-05-04'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-05-04'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-05-04'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-05-04'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-05-04'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-05-04'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-05-04'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-05-04'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-05-04'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-05-04'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-05-04'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-05-04'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-05-04'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-05-04'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-05-04'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-05-04'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-05-04'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-05-04'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-05-04'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-05-11'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-05-11'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-05-11'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-05-11'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-05-11'::date, 'Ayusta Bagas Abdillah', 2000::bigint, ''),
    ('2026-05-11'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-05-11'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-05-11'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-05-11'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-05-11'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-05-11'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-05-11'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-05-11'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-05-11'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-05-11'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-05-11'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-05-11'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-05-11'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-05-11'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-05-11'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-05-11'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-05-11'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-05-11'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-05-11'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-05-11'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-05-11'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-05-11'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-05-11'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-05-11'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-05-11'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-05-11'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-05-11'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-05-11'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-05-18'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-05-18'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-05-18'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-05-18'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-05-18'::date, 'Ayusta Bagas Abdillah', 2000::bigint, ''),
    ('2026-05-18'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-05-18'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-05-18'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-05-18'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-05-18'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-05-18'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-05-18'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-05-18'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-05-18'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-05-18'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-05-18'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-05-18'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-05-18'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-05-18'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-05-18'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-05-18'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-05-18'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-05-18'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-05-18'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-05-18'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-05-18'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-05-18'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-05-18'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-05-18'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-05-18'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-05-18'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-05-18'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-05-18'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-05-25'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-05-25'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-05-25'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-05-25'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-05-25'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-05-25'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-05-25'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-05-25'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-05-25'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-05-25'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-05-25'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-05-25'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-05-25'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-05-25'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-05-25'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-05-25'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-05-25'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-05-25'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-05-25'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-05-25'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-05-25'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-05-25'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-05-25'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-05-25'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-05-25'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-05-25'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-05-25'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-05-25'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-05-25'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-05-25'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-05-25'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-05-25'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-06-03'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-06-03'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-06-03'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-06-03'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-06-03'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-06-03'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-06-03'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-06-03'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-06-03'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-06-03'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-06-03'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-06-03'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-06-03'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-06-03'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-06-03'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-06-03'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-06-03'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-06-03'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-06-03'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-06-03'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-06-03'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-06-03'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-06-03'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-06-03'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-06-03'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-06-03'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-06-03'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-06-03'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-06-03'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-06-03'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-06-03'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-06-03'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-06-08'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-06-08'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-06-08'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-06-08'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-06-08'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-06-08'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-06-08'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-06-08'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-06-08'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-06-08'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-06-08'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-06-08'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-06-08'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-06-08'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-06-08'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-06-08'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-06-08'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-06-08'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-06-08'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-06-08'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-06-08'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-06-08'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-06-08'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-06-08'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-06-08'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-06-08'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-06-08'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-06-08'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-06-08'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-06-08'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-06-08'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-06-15'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-06-15'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-06-15'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-06-15'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-06-15'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-06-15'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-06-15'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-06-15'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-06-15'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-06-15'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-06-15'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-06-15'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-06-15'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-06-15'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-06-15'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-06-15'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-06-15'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-06-15'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-06-15'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-06-15'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-06-15'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-06-15'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-06-15'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-06-15'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-06-15'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-06-15'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-06-15'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-06-15'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-06-15'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-06-15'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-06-15'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-08-03'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-08-03'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-08-03'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-08-03'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-08-03'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-08-03'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-08-03'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-08-03'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-08-03'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-08-03'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-08-03'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-08-03'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-08-03'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-08-03'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-08-03'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-08-03'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-08-03'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-08-03'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-08-03'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-08-03'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-08-03'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-08-03'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-08-03'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-08-03'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-08-03'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-08-03'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-08-03'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-08-03'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-08-03'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-08-03'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-08-03'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-09-07'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-09-07'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-09-07'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-09-07'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-09-07'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-09-07'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-09-07'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-09-07'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-09-07'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-09-07'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-09-07'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-09-07'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-09-07'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-09-07'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-09-07'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-09-07'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-09-07'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-09-07'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-09-07'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-09-07'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-09-07'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-09-07'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-09-07'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-09-07'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-09-07'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-09-07'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-09-07'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-09-07'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-09-07'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-09-07'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-09-14'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-09-14'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-09-14'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-09-14'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-09-14'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-09-14'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-09-14'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-09-14'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-09-14'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-09-14'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-09-14'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-09-14'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-09-14'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-09-14'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-09-14'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-09-14'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-09-14'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-09-14'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-09-14'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-09-14'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-09-14'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-09-14'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-09-14'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-09-14'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-09-14'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-09-14'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-09-14'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-09-14'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-09-14'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-09-14'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-09-14'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-09-14'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-09-21'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-09-21'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-09-21'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-09-21'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-09-21'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-09-21'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-09-21'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-09-21'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-09-21'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-09-21'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-09-21'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-09-21'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-09-21'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-09-21'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-09-21'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-09-21'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-09-21'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-09-21'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-09-21'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-09-21'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-09-21'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-09-21'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-09-21'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-09-21'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-09-21'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-09-21'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-09-21'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-09-21'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-09-21'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-09-21'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-09-21'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-09-28'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-09-28'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-09-28'::date, 'Ayusta Bagas Abdillah', 2000::bigint, ''),
    ('2026-09-28'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-09-28'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-09-28'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-09-28'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-09-28'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-09-28'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-09-28'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-09-28'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-09-28'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-09-28'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-09-28'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-09-28'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-09-28'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-09-28'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-09-28'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-09-28'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-09-28'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-09-28'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-09-28'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-09-28'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-09-28'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-09-28'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-09-28'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-09-28'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-09-28'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-09-28'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-09-28'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-09-28'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-10-05'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-10-05'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-10-05'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-10-05'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-10-05'::date, 'Ayusta Bagas Abdillah', 2000::bigint, ''),
    ('2026-10-05'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-10-05'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-10-05'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-10-05'::date, 'Desthania Aneukeu Felicia', 2000::bigint, ''),
    ('2026-10-05'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-10-05'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-10-05'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-10-05'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-10-05'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-10-05'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-10-05'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-10-05'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-10-05'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-10-05'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-10-05'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-10-05'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-10-05'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-10-05'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-10-05'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-10-05'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-10-05'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-10-05'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-10-05'::date, 'Sulthaan Maulana Malik', 2000::bigint, ''),
    ('2026-10-05'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-10-05'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-10-05'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-10-12'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-10-12'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-10-12'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-10-12'::date, 'Aura Salsya', 2000::bigint, ''),
    ('2026-10-12'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-10-12'::date, 'Desta Fabiano', 2000::bigint, ''),
    ('2026-10-12'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-10-12'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-10-12'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-10-12'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-10-12'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-10-12'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-10-12'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-10-12'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-10-12'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-10-12'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-10-12'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-10-12'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-10-12'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-10-12'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-10-12'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-10-12'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-10-12'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-10-12'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-10-12'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-10-12'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-10-12'::date, 'Zaenal Darmawan', 2000::bigint, ''),
    ('2026-10-12'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-10-12'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-10-19'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-10-19'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-10-19'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-10-19'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-10-19'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-10-19'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-10-19'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-10-19'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-10-19'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-10-19'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-10-19'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-10-19'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-10-19'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-10-19'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-10-19'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-10-19'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-10-19'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-10-19'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-10-19'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-10-19'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-10-26'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-10-26'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-10-26'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-10-26'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-10-26'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-10-26'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-10-26'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-10-26'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-10-26'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-10-26'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-10-26'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-10-26'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-10-26'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-10-26'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-10-26'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-10-26'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-10-26'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-10-26'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-10-26'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-10-26'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-10-26'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-10-26'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-10-26'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-10-26'::date, 'Zafira Pebiyanti', 2000::bigint, ''),
    ('2026-10-26'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-11-02'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-11-02'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-11-02'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-11-02'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-11-02'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-11-02'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-11-02'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-11-02'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-11-02'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-11-02'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-11-02'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-11-02'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-11-02'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-11-02'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-11-02'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-11-02'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-11-02'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-11-02'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-11-02'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-11-02'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-11-02'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-11-02'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-11-02'::date, 'Siti Amira Febriyani', 2000::bigint, ''),
    ('2026-11-02'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-11-09'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-11-09'::date, 'Anissa Agustin', 2000::bigint, ''),
    ('2026-11-09'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-11-09'::date, 'Bintang Sandi Rofiansyah', 2000::bigint, ''),
    ('2026-11-09'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-11-09'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-11-09'::date, 'Kaila Rabbani', 2000::bigint, ''),
    ('2026-11-09'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-11-09'::date, 'Krisna Aditya', 2000::bigint, ''),
    ('2026-11-09'::date, 'Lia Nur Fitriyani', 2000::bigint, ''),
    ('2026-11-09'::date, 'M. Akbar Maulana', 2000::bigint, ''),
    ('2026-11-09'::date, 'M. Rizki Nurfadilah', 2000::bigint, ''),
    ('2026-11-09'::date, 'Nashwa Dwi Davinia', 2000::bigint, ''),
    ('2026-11-09'::date, 'Nazma Setia Wardani', 2000::bigint, ''),
    ('2026-11-09'::date, 'Qeyla Putri Azahra', 2000::bigint, ''),
    ('2026-11-09'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-11-09'::date, 'Rafha Maulana Warandy', 2000::bigint, ''),
    ('2026-11-09'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-11-09'::date, 'Rostriana Vatmala', 2000::bigint, ''),
    ('2026-11-09'::date, 'Salma Nurfadilah', 2000::bigint, ''),
    ('2026-11-09'::date, 'Sartika Sari Dewi', 2000::bigint, ''),
    ('2026-11-09'::date, 'Sella Erika', 2000::bigint, ''),
    ('2026-11-09'::date, 'Sinta Febriansyah', 2000::bigint, ''),
    ('2026-11-09'::date, 'Zaskia Aulianti', 2000::bigint, ''),
    ('2026-11-16'::date, 'Anisa Raudatun Zanah', 2000::bigint, ''),
    ('2026-11-16'::date, 'Aprilia Dwi Maharani', 2000::bigint, ''),
    ('2026-11-16'::date, 'Deca Sri Anjani', 2000::bigint, ''),
    ('2026-11-16'::date, 'Ira Lisna Novianti', 2000::bigint, ''),
    ('2026-11-16'::date, 'Kisty Azkhra Ramadani', 2000::bigint, ''),
    ('2026-11-16'::date, 'Nabila Fikri', 2000::bigint, ''),
    ('2026-11-16'::date, 'Queensha Zalfaa Salsabila', 2000::bigint, ''),
    ('2026-11-16'::date, 'Rohmah Hermawati', 2000::bigint, ''),
    ('2026-11-16'::date, 'Sella Erika', 2000::bigint, '')
),
inserted_setoran AS (
  INSERT INTO public.osis_uang_kas_setoran (
    angkatan_id, nama, tanggal, nominal, catatan, created_by, pengunggah
  )
  SELECT 3, d.nama, d.tanggal, d.nominal, d.catatan, 1, 'Nizam'
    FROM data_import d
   ORDER BY d.tanggal, d.nama
  RETURNING id, angkatan_id, nama, tanggal, nominal, catatan, created_by, pengunggah
)
INSERT INTO public.osis_kas (
  jenis, tanggal, keterangan, kategori, nominal,
  divisi, pic, proker_id, catatan, bukti_path,
  created_by, pengunggah, angkatan_id, uang_kas_setoran_id
)
SELECT
  'masuk', s.tanggal, left('Uang Kas: ' || s.nama, 200), 'Uang Kas', s.nominal,
  '', s.nama, NULL, s.catatan, '',
  s.created_by, s.pengunggah, s.angkatan_id, s.id
FROM inserted_setoran s
ORDER BY s.id;

COMMIT;
