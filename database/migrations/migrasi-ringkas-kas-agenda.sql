-- =========================================================================
-- MIGRASI-RINGKAS-KAS-AGENDA — total server-side tanpa narik baris (hemat egress)
-- Sifat: NON-DESTRUKTIF. Hanya CREATE OR REPLACE FUNCTION + GRANT baru.
-- Bisa di-run ulang kapan saja. Cara pakai: SQL Editor > tempel > Run.
-- - osis_kas_ringkas: total masuk/keluar/n + rekap 6 bulan + rekap proker +
--   daftar tahun & kategori (buat opsi filter), semua dalam 1 panggilan.
-- - sekbid_agenda_ringkas: total, bulan ini, jml sekbid, jml orang.
-- Visibilitas = barisnya (semua login OSIS boleh baca angka).
-- =========================================================================

-- ---- Kas: satu panggilan untuk seluruh angka halaman keuangan ----
CREATE OR REPLACE FUNCTION public.osis_kas_ringkas(
  p_user_id bigint,
  p_tahun text DEFAULT NULL,    -- "2026", NULL/kosong = semua
  p_jenis text DEFAULT NULL,    -- "masuk"/"keluar", NULL/kosong = semua
  p_kategori text DEFAULT NULL,
  p_divisi text DEFAULT NULL,
  p_q text DEFAULT NULL)        -- cari di keterangan/catatan/pic
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tahun text := NULLIF(btrim(COALESCE(p_tahun, '')), '');
  v_jenis text := NULLIF(btrim(COALESCE(p_jenis, '')), '');
  v_kat text := NULLIF(btrim(COALESCE(p_kategori, '')), '');
  v_div text := NULLIF(btrim(COALESCE(p_divisi, '')), '');
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_hasil jsonb;
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;
  -- Samakan dengan includes() di frontend: % _ \ dianggap literal.
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  WITH basis AS (
    SELECT k.jenis, COALESCE(k.nominal, 0) AS nominal, k.proker_id,
           left(k.tanggal::text, 7) AS ym
    FROM public.osis_kas k
    WHERE (v_tahun IS NULL OR left(k.tanggal::text, 4) = v_tahun)
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
           COUNT(*) AS n
    FROM basis
  ),
  bln AS (
    SELECT ym,
           COALESCE(SUM(CASE WHEN jenis = 'masuk' THEN nominal ELSE 0 END), 0) AS masuk,
           COALESCE(SUM(CASE WHEN jenis = 'keluar' THEN nominal ELSE 0 END), 0) AS keluar,
           COUNT(*) AS n
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
    SELECT DISTINCT left(tanggal::text, 4) AS th FROM public.osis_kas
    WHERE tanggal IS NOT NULL AND left(tanggal::text, 4) ~ '^[0-9]{4}$'
    ORDER BY 1 DESC
  ),
  kat AS (
    SELECT DISTINCT kategori AS k FROM public.osis_kas
    WHERE kategori IS NOT NULL AND btrim(kategori) <> ''
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
END $$;

-- ---- Agenda: angka statistik tanpa narik baris ----
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
      'n_orang', COUNT(DISTINCT NULLIF(btrim(COALESCE(pelaksana, '')), ''))
    )
    FROM public.sekbid_agenda
    WHERE (p_sekbid_id IS NULL OR sekbid_id = p_sekbid_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.osis_kas_ringkas(bigint, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sekbid_agenda_ringkas(bigint, bigint) TO anon, authenticated;
