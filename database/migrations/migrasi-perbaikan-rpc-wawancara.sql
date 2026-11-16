-- =========================================================================
-- MIGRASI-PERBAIKAN-RPC-WAWANCARA
-- 1. Mengaktifkan tabel & RPC penugasan N pewawancara (wawancara_sesi_petugas)
--    sesuai standar keamanan RLS/RBAC (tanpa akses anon, dengan search_path
--    & osis_id_dari_auth).
-- 2. Membersihkan fungsi kembar (overload integer vs text) untuk buat_dokumen,
--    update_dokumen, dan set_saldo_awal menjadi 1 signature canonical bertipe
--    integer (sesuai kolom tabel osis_dokumen.tahun & osis_saldo_awal.periode)
--    lengkap dengan cek izin osis_bisa().
-- =========================================================================

-- ================= 1. WAWANCARA_SESI_PETUGAS (N pewawancara) =================
CREATE TABLE IF NOT EXISTS public.wawancara_sesi_petugas (
  sesi_id    bigint NOT NULL REFERENCES public.wawancara_sesi (id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES public.osis_users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wawancara_sesi_petugas_pk PRIMARY KEY (sesi_id, user_id)
);
CREATE INDEX IF NOT EXISTS wawancara_sesi_petugas_sesi_idx
  ON public.wawancara_sesi_petugas (sesi_id);
CREATE INDEX IF NOT EXISTS wawancara_sesi_petugas_user_idx
  ON public.wawancara_sesi_petugas (user_id);

-- Backfill penugasan lama (kolom pewawancara1_id/2_id) ke tabel baru
INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
SELECT id, pewawancara1_id FROM public.wawancara_sesi WHERE pewawancara1_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
SELECT id, pewawancara2_id FROM public.wawancara_sesi WHERE pewawancara2_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.wawancara_sesi_petugas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_sesi_petugas;
CREATE POLICY wawancara_osis_select ON public.wawancara_sesi_petugas
  FOR SELECT TO authenticated
  USING ((SELECT public.osis_id_dari_auth()) IS NOT NULL);
REVOKE ALL ON TABLE public.wawancara_sesi_petugas FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.wawancara_sesi_petugas TO authenticated;

CREATE OR REPLACE FUNCTION public.wawancara_boleh(p_user_id bigint, p_sesi_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_username text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN false; END IF;
  END IF;
  IF p_user_id IS NULL THEN RETURN false; END IF;
  SELECT username INTO v_username FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.osis_is_super(v_username) THEN RETURN true; END IF;
  IF p_sesi_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.wawancara_sesi_petugas
    WHERE sesi_id = p_sesi_id AND user_id = p_user_id
  ) THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.wawancara_sesi s
    WHERE s.id = p_sesi_id
      AND (s.pewawancara1_id = p_user_id OR s.pewawancara2_id = p_user_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_sesi_petugas_set(
  p_user_id bigint, p_sesi_id bigint, p_ids bigint[]
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id bigint;
  v_arr bigint[] := '{}';
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wawancara_sesi WHERE id = p_sesi_id) THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF p_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY p_ids LOOP
      IF v_id IS NULL THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = v_id) THEN RETURN 'ERR_PETUGAS'; END IF;
      IF NOT (v_id = ANY (v_arr)) THEN v_arr := v_arr || v_id; END IF;
    END LOOP;
  END IF;
  IF array_length(v_arr, 1) IS NULL THEN RETURN 'ERR_KOSONG'; END IF;
  DELETE FROM public.wawancara_sesi_petugas WHERE sesi_id = p_sesi_id;
  INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
  SELECT p_sesi_id, unnest(v_arr)
  ON CONFLICT DO NOTHING;
  UPDATE public.wawancara_sesi SET
    pewawancara1_id = v_arr[1],
    pewawancara2_id = v_arr[2],
    updated_at = now()
  WHERE id = p_sesi_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_sesi_petugas(
  p_user_id bigint, p_sesi_id bigint,
  p_pewawancara1_id bigint DEFAULT NULL, p_pewawancara2_id bigint DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_pewawancara1_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_pewawancara1_id) THEN RETURN 'ERR_PETUGAS'; END IF;
  IF p_pewawancara2_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_pewawancara2_id) THEN RETURN 'ERR_PETUGAS'; END IF;
  UPDATE public.wawancara_sesi SET
    pewawancara1_id = p_pewawancara1_id,
    pewawancara2_id = p_pewawancara2_id,
    updated_at = now()
  WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  DELETE FROM public.wawancara_sesi_petugas WHERE sesi_id = p_sesi_id;
  INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
  SELECT p_sesi_id, v FROM unnest(ARRAY[p_pewawancara1_id, p_pewawancara2_id]) AS v
  WHERE v IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN 'OK';
END;
$function$;

REVOKE ALL ON FUNCTION public.wawancara_boleh(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_sesi_petugas_set(bigint, bigint, bigint[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_sesi_petugas(bigint, bigint, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wawancara_boleh(bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wawancara_sesi_petugas_set(bigint, bigint, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wawancara_sesi_petugas(bigint, bigint, bigint, bigint) TO authenticated;

-- ================= 2. HAPUS OVERLOAD KEMBAR (DOKUMEN & SALDO AWAL) =================
DROP FUNCTION IF EXISTS public.buat_dokumen(bigint, text, text, text, text, text, text, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.buat_dokumen(bigint, text, text, integer, text, text, text, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.update_dokumen(bigint, bigint, text, text, text, text, text, text, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.update_dokumen(bigint, bigint, text, text, integer, text, text, text, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.set_saldo_awal(bigint, text, bigint);
DROP FUNCTION IF EXISTS public.set_saldo_awal(bigint, integer, bigint);

CREATE FUNCTION public.buat_dokumen(
  p_user_id bigint, p_nama text, p_kategori text, p_tahun integer, p_divisi text,
  p_deskripsi text, p_file_path text, p_file_type text, p_mime text,
  p_ukuran_bytes bigint, p_pengunggah text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE nid bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'dokumen') THEN RETURN -1; END IF;
  p_nama := COALESCE(NULLIF(btrim(p_nama), ''), '');
  p_file_path := COALESCE(NULLIF(btrim(p_file_path), ''), '');
  IF p_nama = '' OR p_file_path = '' THEN RETURN -2; END IF;
  INSERT INTO public.osis_dokumen (
    nama, kategori, tahun, divisi, deskripsi,
    file_path, file_type, mime, ukuran_bytes, pengunggah, created_by
  ) VALUES (
    left(p_nama, 160),
    left(COALESCE(NULLIF(btrim(p_kategori), ''), 'Lainnya'), 40),
    COALESCE(p_tahun, EXTRACT(YEAR FROM CURRENT_DATE)::integer),
    left(COALESCE(p_divisi, ''), 80),
    left(COALESCE(p_deskripsi, ''), 1000),
    left(p_file_path, 300),
    left(COALESCE(p_file_type, 'lainnya'), 20),
    left(COALESCE(p_mime, ''), 100),
    GREATEST(COALESCE(p_ukuran_bytes, 0), 0),
    left(COALESCE(p_pengunggah, ''), 120),
    p_user_id
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE FUNCTION public.update_dokumen(
  p_user_id bigint, p_id bigint, p_nama text, p_kategori text, p_tahun integer,
  p_divisi text, p_deskripsi text, p_file_path text, p_file_type text,
  p_mime text, p_ukuran_bytes bigint, p_pengunggah text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'dokumen') THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.osis_dokumen SET
    nama = left(COALESCE(NULLIF(btrim(p_nama), ''), nama), 160),
    kategori = left(COALESCE(NULLIF(btrim(p_kategori), ''), kategori), 40),
    tahun = COALESCE(p_tahun, tahun),
    divisi = left(COALESCE(p_divisi, divisi), 80),
    deskripsi = left(COALESCE(p_deskripsi, deskripsi), 1000),
    file_path = left(COALESCE(NULLIF(btrim(p_file_path), ''), file_path), 300),
    file_type = left(COALESCE(NULLIF(btrim(p_file_type), ''), file_type), 20),
    mime = left(COALESCE(p_mime, mime), 100),
    ukuran_bytes = GREATEST(0, COALESCE(p_ukuran_bytes, ukuran_bytes)),
    pengunggah = left(COALESCE(p_pengunggah, pengunggah), 120)
  WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE FUNCTION public.set_saldo_awal(p_user_id bigint, p_periode integer, p_nominal bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'keuangan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  p_periode := COALESCE(p_periode, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  INSERT INTO public.osis_saldo_awal (periode, nominal, updated_by, updated_at)
  VALUES (p_periode, GREATEST(0, COALESCE(p_nominal, 0)), p_user_id, now())
  ON CONFLICT (periode) DO UPDATE SET
    nominal = EXCLUDED.nominal,
    updated_by = p_user_id,
    updated_at = now();
  RETURN 'OK';
END;
$function$;

REVOKE ALL ON FUNCTION public.buat_dokumen(bigint, text, text, integer, text, text, text, text, text, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_dokumen(bigint, bigint, text, text, integer, text, text, text, text, text, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_saldo_awal(bigint, integer, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buat_dokumen(bigint, text, text, integer, text, text, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_dokumen(bigint, bigint, text, text, integer, text, text, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_saldo_awal(bigint, integer, bigint) TO authenticated;
