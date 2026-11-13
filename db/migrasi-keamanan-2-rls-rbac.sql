-- ============================================================================
-- MIGRASI KEAMANAN 2: RLS, TABLE/COLUMN GRANTS, RBAC RPC, & HARDENING AUTH
-- Target: Supabase Postgres (osistarpanone / eefdfaqcccgpfthdidzp)
-- Catatan: Tabel pesenan_orders, pesenan_order_items, wa_archives, wa_messages
--          SENGAJA TIDAK DISENTUH sesuai instruksi owner.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. HAPUS POLICY TULIS BEBAS (*_admin_all & push_*_bebas)
--    Semua operasi tulis sudah lewat RPC SECURITY DEFINER.
-- ============================================================================
DROP POLICY IF EXISTS anggota_admin_all    ON public.anggota;
DROP POLICY IF EXISTS pengaturan_admin_all ON public.pengaturan;
DROP POLICY IF EXISTS pengurus_admin_all   ON public.pengurus;
DROP POLICY IF EXISTS periode_admin_all    ON public.periode;
DROP POLICY IF EXISTS pimpinan_admin_all   ON public.pimpinan;
DROP POLICY IF EXISTS sekbid_admin_all     ON public.sekbid;
DROP POLICY IF EXISTS web_foto_admin_all   ON public.web_foto;

DROP POLICY IF EXISTS push_delete_bebas ON public.push_subscriptions;
DROP POLICY IF EXISTS push_update_bebas ON public.push_subscriptions;
DROP POLICY IF EXISTS push_insert_bebas ON public.push_subscriptions;

-- ============================================================================
-- 2. CABUT GRANT TULIS LANGSUNG (INSERT/UPDATE/DELETE/TRUNCATE) DARI ANON &
--    AUTHENTICATED PADA TABEL APLIKASI OSIS (SEMUA TULIS WAJIB LEWAT RPC)
-- ============================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('pesenan_orders', 'pesenan_order_items', 'wa_archives', 'wa_messages')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM anon, authenticated', r.tablename);
  END LOOP;
END $$;

-- Cabut SELECT langsung pada tabel yang 100% hanya diakses lewat RPC / service_role
REVOKE SELECT ON TABLE
  public.push_subscriptions,
  public.osis_akses,
  public.osis_super_admins,
  public.jabatan_akses,
  public.osis_absensi_qr_kartu,
  public.osis_absensi_qr_rahasia,
  public.osis_absensi_qr_sesi,
  public.osis_visitor,
  public.pelantikan,
  public.pelantikan_minta,
  public.polling_suara
FROM anon, authenticated;

-- ============================================================================
-- 3. KUNCI SELECT TABEL INTERNAL OSIS & ASPIRASI RAHASIA
-- ============================================================================

-- osis_kas: hanya pengurus OSIS yang login
DROP POLICY IF EXISTS kas_public_select ON public.osis_kas;
CREATE POLICY kas_public_select ON public.osis_kas
  FOR SELECT TO authenticated
  USING (public.osis_id_dari_auth() IS NOT NULL);

-- osis_saldo_awal: hanya pengurus OSIS yang login
DROP POLICY IF EXISTS saldo_awal_public_select ON public.osis_saldo_awal;
CREATE POLICY saldo_awal_public_select ON public.osis_saldo_awal
  FOR SELECT TO authenticated
  USING (public.osis_id_dari_auth() IS NOT NULL);

-- osis_tabungan: hanya pengurus OSIS yang login
DROP POLICY IF EXISTS tabungan_public_select ON public.osis_tabungan;
CREATE POLICY tabungan_public_select ON public.osis_tabungan
  FOR SELECT TO authenticated
  USING (public.osis_id_dari_auth() IS NOT NULL);

-- osis_absensi: hanya pengurus OSIS yang login
DROP POLICY IF EXISTS absensi_public_select ON public.osis_absensi;
CREATE POLICY absensi_public_select ON public.osis_absensi
  FOR SELECT TO authenticated
  USING (public.osis_id_dari_auth() IS NOT NULL);

-- osis_dokumen: hanya pengurus OSIS yang login
DROP POLICY IF EXISTS dokumen_public_select ON public.osis_dokumen;
CREATE POLICY dokumen_public_select ON public.osis_dokumen
  FOR SELECT TO authenticated
  USING (public.osis_id_dari_auth() IS NOT NULL);

-- informasi (internal harian OSIS): hanya pengurus OSIS yang login
DROP POLICY IF EXISTS informasi_osis_select ON public.informasi;
CREATE POLICY informasi_osis_select ON public.informasi
  FOR SELECT TO authenticated
  USING (public.osis_id_dari_auth() IS NOT NULL);

-- rapat_notulensi: hanya pengurus OSIS yang login (bukan akun biasa)
DROP POLICY IF EXISTS notulensi_login_select ON public.rapat_notulensi;
CREATE POLICY notulensi_login_select ON public.rapat_notulensi
  FOR SELECT TO authenticated
  USING (public.osis_id_dari_auth() IS NOT NULL);

-- aspirasi: sembunyikan is_private = true dari publik (hanya OSIS yang bisa lihat)
DROP POLICY IF EXISTS aspirasi_public_select ON public.aspirasi;
CREATE POLICY aspirasi_public_select ON public.aspirasi
  FOR SELECT TO public
  USING (NOT COALESCE(is_private, false) OR public.osis_id_dari_auth() IS NOT NULL);

-- ============================================================================
-- 4. PROTEKSI DEVICE_ID PADA ASPIRASI & LAGU_REQUESTS + RPC LIST PUBLIK
-- ============================================================================

-- Sembunyikan kolom device_id dari SELECT tabel langsung (PostgREST)
REVOKE SELECT ON TABLE public.aspirasi FROM anon, authenticated;
GRANT SELECT (id, nama, kelas, isi, dibaca, created_at, is_private, balasan, dibalas_oleh, dibalas_at)
  ON TABLE public.aspirasi TO anon, authenticated;

REVOKE SELECT ON TABLE public.lagu_requests FROM anon, authenticated;
GRANT SELECT (id, judul, penyanyi, nama, created_at, pesan, selesai, balasan, dibalas_oleh, dibalas_at)
  ON TABLE public.lagu_requests TO anon, authenticated;

-- RPC baca aspirasi: hanya kembalikan device_id bila cocok dengan p_device_id pemanggil
CREATE OR REPLACE FUNCTION public.aspirasi_list_publik(
  p_device_id text DEFAULT ''::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_osis boolean;
  v_dev text;
  v_res jsonb;
BEGIN
  v_is_osis := (public.osis_id_dari_auth() IS NOT NULL);
  v_dev := btrim(coalesce(p_device_id, ''));
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_res
  FROM (
    SELECT
      a.id,
      CASE WHEN v_dev <> '' AND a.device_id = v_dev THEN a.device_id ELSE '' END AS device_id,
      a.nama,
      a.kelas,
      a.isi,
      COALESCE(a.is_private, false) AS is_private,
      COALESCE(a.balasan, '') AS balasan,
      COALESCE(a.dibalas_oleh, '') AS dibalas_oleh,
      a.dibalas_at,
      a.created_at
    FROM public.aspirasi a
    WHERE (NOT COALESCE(a.is_private, false) OR v_is_osis)
    ORDER BY a.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;
  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.aspirasi_list_publik(text, integer, integer) TO anon, authenticated, service_role;

-- RPC baca request lagu: hanya kembalikan device_id bila cocok dengan p_device_id pemanggil
CREATE OR REPLACE FUNCTION public.lagu_list_publik(
  p_device_id text DEFAULT ''::text,
  p_batas integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dev text;
  v_res jsonb;
BEGIN
  v_dev := btrim(coalesce(p_device_id, ''));
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_res
  FROM (
    SELECT
      l.id,
      CASE WHEN v_dev <> '' AND l.device_id = v_dev THEN l.device_id ELSE '' END AS device_id,
      l.judul,
      l.penyanyi,
      l.pesan,
      l.nama,
      COALESCE(l.selesai, false) AS selesai,
      COALESCE(l.balasan, '') AS balasan,
      COALESCE(l.dibalas_oleh, '') AS dibalas_oleh,
      l.dibalas_at,
      l.created_at
    FROM public.lagu_requests l
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_batas, 30), 200))
  ) t;
  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.lagu_list_publik(text, integer) TO anon, authenticated, service_role;

-- ============================================================================
-- 5. PROTEKSI TABEL OSIS_USERS & BIASA_USERS + RPC LOOKUP LOGIN SATU AKUN
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cari_osis_login(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb;
BEGIN
  p_username := btrim(coalesce(p_username, ''));
  IF p_username = '' OR char_length(p_username) > 60 THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'nama', u.nama,
    'jabatan', coalesce(u.jabatan, ''),
    'foto', coalesce(u.foto, ''),
    'bio', coalesce(u.bio, ''),
    'angkatan', coalesce(u.angkatan, ''),
    'auth_id', u.auth_id,
    'auth_email', u.auth_email
  )
  INTO v_row
  FROM public.osis_users u
  WHERE lower(btrim(u.username)) = lower(p_username)
  LIMIT 1;
  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cari_osis_login(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cari_biasa_login(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb;
BEGIN
  p_username := btrim(coalesce(p_username, ''));
  IF p_username = '' OR char_length(p_username) > 60 THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'nama', u.nama,
    'auth_id', u.auth_id,
    'auth_email', u.auth_email
  )
  INTO v_row
  FROM public.biasa_users u
  WHERE lower(btrim(u.username)) = lower(p_username)
  LIMIT 1;
  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cari_biasa_login(text) TO anon, authenticated, service_role;

-- Aktifkan RLS biasa_users & batasi SELECT osis_users/biasa_users hanya milik sendiri atau pengurus OSIS
ALTER TABLE public.biasa_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS biasa_users_select ON public.biasa_users;
CREATE POLICY biasa_users_select ON public.biasa_users
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.osis_id_dari_auth() IS NOT NULL);

DROP POLICY IF EXISTS osis_users_public_select ON public.osis_users;
CREATE POLICY osis_users_public_select ON public.osis_users
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.osis_id_dari_auth() IS NOT NULL);

-- ============================================================================
-- 6. PERBAIKAN IDOR PELANTIKAN (PAKSA p_auth_id := auth.uid())
-- ============================================================================

CREATE OR REPLACE FUNCTION public.status_akses_pelantikan(p_auth_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_osis_id bigint;
  v_status text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_auth_id := auth.uid();
  END IF;
  IF p_auth_id IS NULL THEN RETURN 'butuh_login'; END IF;
  SELECT id INTO v_osis_id FROM public.osis_users WHERE auth_id = p_auth_id LIMIT 1;
  IF v_osis_id IS NOT NULL AND public.osis_bisa(v_osis_id, 'kegiatan') THEN
    RETURN 'disetujui';
  END IF;
  SELECT status INTO v_status FROM public.pelantikan_minta WHERE auth_id = p_auth_id;
  RETURN COALESCE(v_status, 'belum');
END;
$function$;

CREATE OR REPLACE FUNCTION public.minta_akses_pelantikan(p_auth_id uuid, p_alasan text DEFAULT ''::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nama text;
  v_username text;
  v_mode text;
  v_status text;
  v_osis_id bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_auth_id := auth.uid();
  END IF;
  IF p_auth_id IS NULL THEN RETURN 'ERR_LOGIN'; END IF;

  SELECT id, nama, username INTO v_osis_id, v_nama, v_username
    FROM public.osis_users WHERE auth_id = p_auth_id LIMIT 1;
  IF v_osis_id IS NOT NULL THEN
    v_mode := 'osis';
    IF public.osis_bisa(v_osis_id, 'kegiatan') THEN RETURN 'SUDAH_BOLEH'; END IF;
  ELSE
    SELECT nama, username INTO v_nama, v_username
      FROM public.biasa_users WHERE auth_id = p_auth_id LIMIT 1;
    IF v_username IS NULL THEN RETURN 'ERR_LOGIN'; END IF;
    v_mode := 'biasa';
  END IF;

  SELECT status INTO v_status FROM public.pelantikan_minta WHERE auth_id = p_auth_id;
  IF v_status = 'disetujui' THEN RETURN 'SUDAH_BOLEH'; END IF;

  INSERT INTO public.pelantikan_minta (auth_id, mode, username, nama, alasan, status, created_at, decided_at)
  VALUES (p_auth_id, v_mode, COALESCE(v_username, ''), COALESCE(v_nama, ''), left(btrim(COALESCE(p_alasan, '')), 200), 'menunggu', now(), NULL)
  ON CONFLICT (auth_id) DO UPDATE
    SET alasan = EXCLUDED.alasan,
        nama = EXCLUDED.nama,
        username = EXCLUDED.username,
        mode = EXCLUDED.mode,
        status = 'menunggu',
        created_at = now(),
        decided_at = NULL;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pelantikan(p_auth_id uuid, p_page integer DEFAULT 1, p_per integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_from int;
  v_total int;
  v_rows jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_auth_id := auth.uid();
  END IF;
  v_status := public.status_akses_pelantikan(p_auth_id);
  IF v_status <> 'disetujui' THEN
    RAISE EXCEPTION 'ERR_AKSES_%', upper(v_status);
  END IF;
  p_page := GREATEST(1, COALESCE(p_page, 1));
  p_per := LEAST(24, GREATEST(1, COALESCE(p_per, 6)));
  v_from := (p_page - 1) * p_per;
  SELECT count(*) INTO v_total FROM public.pelantikan;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows FROM (
    SELECT id, judul, deskripsi, badge, fotos, display_order, pengunggah, created_at
    FROM public.pelantikan
    ORDER BY display_order ASC, created_at DESC
    OFFSET v_from LIMIT p_per
  ) t;
  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$function$;

-- ============================================================================
-- 7. RPC SIMPAN_PENGATURAN & TAMBAH RBAC PADA SEMUA RPC TULIS OSIS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.simpan_pengaturan(p_user_id bigint, p_kunci text, p_nilai text)
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
  IF NOT (public.osis_bisa(p_user_id, 'aspirasi') OR public.osis_bisa(p_user_id, 'site')) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  p_kunci := btrim(coalesce(p_kunci, ''));
  IF p_kunci = '' OR char_length(p_kunci) > 80 THEN
    RETURN 'ERR_KEY';
  END IF;
  INSERT INTO public.pengaturan (kunci, nilai, updated_at)
  VALUES (p_kunci, left(coalesce(p_nilai, ''), 2000), now())
  ON CONFLICT (kunci) DO UPDATE
    SET nilai = EXCLUDED.nilai,
        updated_at = now();
  RETURN 'OK';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.simpan_pengaturan(bigint, text, text) TO authenticated, service_role;

-- KEUANGAN: buat_kas, update_kas, hapus_kas, set_saldo_awal (wajib hak 'keuangan')
CREATE OR REPLACE FUNCTION public.buat_kas(
  p_user_id bigint, p_jenis text, p_tanggal date, p_keterangan text, p_kategori text,
  p_nominal bigint, p_divisi text, p_pic text, p_proker_id bigint, p_agenda_id bigint,
  p_catatan text, p_bukti_path text
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
  IF NOT public.osis_bisa(p_user_id, 'keuangan') THEN RETURN -1; END IF;
  p_keterangan := COALESCE(NULLIF(btrim(p_keterangan),''), '');
  IF p_keterangan = '' THEN RETURN -2; END IF;
  IF COALESCE(p_nominal, 0) <= 0 THEN RETURN -3; END IF;
  p_jenis := COALESCE(NULLIF(btrim(p_jenis),''), 'masuk');
  IF p_jenis NOT IN ('masuk','keluar') THEN p_jenis := 'masuk'; END IF;
  INSERT INTO public.osis_kas (
    jenis, tanggal, keterangan, kategori, nominal, divisi, pic,
    proker_id, agenda_id, catatan, bukti_path, created_by
  ) VALUES (
    p_jenis, COALESCE(p_tanggal, CURRENT_DATE), left(p_keterangan, 200),
    left(COALESCE(p_kategori,''), 60), p_nominal,
    left(COALESCE(p_divisi,''), 80), left(COALESCE(p_pic,''), 120),
    p_proker_id, p_agenda_id, left(COALESCE(p_catatan,''), 1000),
    left(COALESCE(p_bukti_path,''), 300), p_user_id
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_kas(
  p_user_id bigint, p_id bigint, p_jenis text, p_tanggal date, p_keterangan text,
  p_kategori text, p_nominal bigint, p_divisi text, p_pic text, p_proker_id bigint,
  p_agenda_id bigint, p_catatan text, p_bukti_path text
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
  IF NOT public.osis_bisa(p_user_id, 'keuangan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_nominal IS NOT NULL AND p_nominal <= 0 THEN RETURN 'ERR_NOMINAL'; END IF;
  UPDATE public.osis_kas SET
    jenis = CASE WHEN p_jenis IN ('masuk','keluar') THEN p_jenis ELSE jenis END,
    tanggal = COALESCE(p_tanggal, tanggal),
    keterangan = left(COALESCE(NULLIF(btrim(p_keterangan), keterangan), keterangan), 200),
    kategori = left(COALESCE(p_kategori, kategori), 60),
    nominal = COALESCE(p_nominal, nominal),
    divisi = left(COALESCE(p_divisi, divisi), 80),
    pic = left(COALESCE(p_pic, pic), 120),
    proker_id = p_proker_id,
    agenda_id = p_agenda_id,
    catatan = left(COALESCE(p_catatan, catatan), 1000),
    bukti_path = left(COALESCE(p_bukti_path, bukti_path), 300),
    updated_at = now()
  WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_kas(p_user_id bigint, p_id bigint)
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
  DELETE FROM public.osis_kas WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_saldo_awal(p_user_id bigint, p_periode text, p_nominal bigint)
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
  p_periode := left(COALESCE(NULLIF(btrim(p_periode),''), 'default'), 40);
  INSERT INTO public.osis_saldo_awal (periode, nominal, updated_by, updated_at)
  VALUES (p_periode, COALESCE(p_nominal, 0), p_user_id, now())
  ON CONFLICT (periode) DO UPDATE SET
    nominal = EXCLUDED.nominal, updated_by = p_user_id, updated_at = now();
  RETURN 'OK';
END;
$function$;

-- TABUNGAN: buat_tabungan, update_tabungan, hapus_tabungan (wajib hak 'tabungan')
CREATE OR REPLACE FUNCTION public.buat_tabungan(
  p_user_id bigint, p_nama text, p_tanggal date, p_nominal bigint, p_jenis text DEFAULT 'masuk'::text
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
  IF NOT public.osis_bisa(p_user_id, 'tabungan') THEN RETURN -1; END IF;
  IF p_tanggal IS NULL THEN RETURN -2; END IF;
  p_nama := left(btrim(COALESCE(p_nama,'')), 80);
  IF p_nama = '' THEN RETURN -3; END IF;
  IF COALESCE(p_nominal, 0) <= 0 THEN RETURN -4; END IF;
  p_jenis := COALESCE(NULLIF(btrim(p_jenis),''), 'masuk');
  IF p_jenis NOT IN ('masuk','keluar') THEN p_jenis := 'masuk'; END IF;
  INSERT INTO public.osis_tabungan (nama, tanggal, nominal, jenis, created_by)
  VALUES (p_nama, p_tanggal, p_nominal, p_jenis, p_user_id)
  RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_tabungan(
  p_user_id bigint, p_id bigint, p_nama text, p_tanggal date, p_nominal bigint, p_jenis text DEFAULT 'masuk'::text
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
  IF NOT public.osis_bisa(p_user_id, 'tabungan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_tanggal IS NULL THEN RETURN 'ERR_NO_TANGGAL'; END IF;
  p_nama := left(btrim(COALESCE(p_nama,'')), 80);
  IF p_nama = '' THEN RETURN 'ERR_NO_NAMA'; END IF;
  IF COALESCE(p_nominal, 0) <= 0 THEN RETURN 'ERR_NOMINAL'; END IF;
  p_jenis := COALESCE(NULLIF(btrim(p_jenis),''), 'masuk');
  IF p_jenis NOT IN ('masuk','keluar') THEN p_jenis := 'masuk'; END IF;
  UPDATE public.osis_tabungan SET nama=p_nama, tanggal=p_tanggal,
      nominal=p_nominal, jenis=p_jenis, updated_at=now() WHERE id=p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_tabungan(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'tabungan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.osis_tabungan WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

-- ABSENSI: buat_absensi (wajib hak 'absensi')
CREATE OR REPLACE FUNCTION public.buat_absensi(
  p_user_id bigint, p_tanggal date, p_nama text, p_status text, p_alasan text, p_kegiatan text DEFAULT ''::text
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
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN RETURN -1; END IF;
  IF p_tanggal IS NULL THEN RETURN -2; END IF;
  p_nama := left(btrim(COALESCE(p_nama,'')), 80);
  IF p_nama = '' THEN RETURN -3; END IF;
  p_status := COALESCE(NULLIF(btrim(p_status),''), '');
  IF p_status NOT IN ('izin','sakit','alpha','hadir') THEN RETURN -4; END IF;
  p_kegiatan := left(btrim(COALESCE(p_kegiatan,'')), 120);
  BEGIN
    INSERT INTO public.osis_absensi (tanggal, nama, status, alasan, kegiatan, created_by)
    VALUES (p_tanggal, p_nama, p_status, left(COALESCE(p_alasan,''), 500), p_kegiatan, p_user_id)
    RETURNING id INTO nid;
  EXCEPTION WHEN unique_violation THEN
    RETURN -5;
  END;
  RETURN nid;
END;
$function$;

-- DOKUMEN: buat_dokumen, update_dokumen, hapus_dokumen (wajib hak 'dokumen')
CREATE OR REPLACE FUNCTION public.buat_dokumen(
  p_user_id bigint, p_nama text, p_kategori text, p_tahun text, p_divisi text,
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
    left(COALESCE(p_tahun, ''), 20),
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

CREATE OR REPLACE FUNCTION public.update_dokumen(
  p_user_id bigint, p_id bigint, p_nama text, p_kategori text, p_tahun text,
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
    nama = left(COALESCE(NULLIF(btrim(p_nama), nama), nama), 160),
    kategori = left(COALESCE(NULLIF(btrim(p_kategori), ''), kategori), 40),
    tahun = left(COALESCE(p_tahun, tahun), 20),
    divisi = left(COALESCE(p_divisi, divisi), 80),
    deskripsi = left(COALESCE(p_deskripsi, deskripsi), 1000),
    file_path = left(COALESCE(NULLIF(btrim(p_file_path), ''), file_path), 300),
    file_type = left(COALESCE(NULLIF(btrim(p_file_type), ''), file_type), 20),
    mime = left(COALESCE(p_mime, mime), 100),
    ukuran_bytes = COALESCE(p_ukuran_bytes, ukuran_bytes),
    pengunggah = left(COALESCE(p_pengunggah, pengunggah), 120)
  WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_dokumen(p_user_id bigint, p_id bigint)
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
  DELETE FROM public.osis_dokumen WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

-- NOTULENSI: buat_notulensi, update_notulensi, hapus_notulensi (wajib hak 'notulensi')
CREATE OR REPLACE FUNCTION public.buat_notulensi(
  p_user_id bigint, p_judul text, p_tanggal date, p_waktu_mulai text, p_waktu_selesai text,
  p_lokasi text, p_divisi text, p_pimpinan text, p_notulis text, p_peserta text,
  p_agenda_topik text, p_isi_pembahasan text, p_keputusan text,
  p_tindak_lanjut jsonb, p_lampiran jsonb, p_status text
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
  IF NOT public.osis_bisa(p_user_id, 'notulensi') THEN RETURN -1; END IF;
  p_judul := COALESCE(NULLIF(btrim(p_judul), ''), '');
  IF p_judul = '' THEN RETURN -2; END IF;
  IF p_tindak_lanjut IS NULL OR jsonb_typeof(p_tindak_lanjut) <> 'array' THEN
    p_tindak_lanjut := '[]'::jsonb;
  END IF;
  IF p_lampiran IS NULL OR jsonb_typeof(p_lampiran) <> 'array' THEN
    p_lampiran := '[]'::jsonb;
  END IF;
  p_status := COALESCE(NULLIF(btrim(p_status), ''), 'Draft');
  INSERT INTO public.rapat_notulensi (
    judul, tanggal, waktu_mulai, waktu_selesai, lokasi, divisi,
    pimpinan, notulis, peserta, agenda_topik, isi_pembahasan,
    keputusan, tindak_lanjut, lampiran, status, created_by
  ) VALUES (
    left(p_judul, 160),
    COALESCE(p_tanggal, CURRENT_DATE),
    left(COALESCE(p_waktu_mulai, ''), 20),
    left(COALESCE(p_waktu_selesai, ''), 20),
    left(COALESCE(p_lokasi, ''), 120),
    left(COALESCE(p_divisi, ''), 80),
    left(COALESCE(p_pimpinan, ''), 120),
    left(COALESCE(p_notulis, ''), 120),
    left(COALESCE(p_peserta, ''), 4000),
    left(COALESCE(p_agenda_topik, ''), 4000),
    left(COALESCE(p_isi_pembahasan, ''), 8000),
    left(COALESCE(p_keputusan, ''), 8000),
    p_tindak_lanjut,
    p_lampiran,
    p_status,
    p_user_id
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_notulensi(
  p_user_id bigint, p_id bigint, p_judul text, p_tanggal date, p_waktu_mulai text,
  p_waktu_selesai text, p_lokasi text, p_divisi text, p_pimpinan text, p_notulis text,
  p_peserta text, p_agenda_topik text, p_isi_pembahasan text, p_keputusan text,
  p_tindak_lanjut jsonb, p_lampiran jsonb, p_status text
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
  IF NOT public.osis_bisa(p_user_id, 'notulensi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_tindak_lanjut IS NOT NULL AND jsonb_typeof(p_tindak_lanjut) <> 'array' THEN
    p_tindak_lanjut := '[]'::jsonb;
  END IF;
  IF p_lampiran IS NOT NULL AND jsonb_typeof(p_lampiran) <> 'array' THEN
    p_lampiran := '[]'::jsonb;
  END IF;
  UPDATE public.rapat_notulensi SET
    judul = left(COALESCE(NULLIF(btrim(p_judul), judul), judul), 160),
    tanggal = COALESCE(p_tanggal, tanggal),
    waktu_mulai = left(COALESCE(p_waktu_mulai, waktu_mulai), 20),
    waktu_selesai = left(COALESCE(p_waktu_selesai, waktu_selesai), 20),
    lokasi = left(COALESCE(p_lokasi, lokasi), 120),
    divisi = left(COALESCE(p_divisi, divisi), 80),
    pimpinan = left(COALESCE(p_pimpinan, pimpinan), 120),
    notulis = left(COALESCE(p_notulis, notulis), 120),
    peserta = left(COALESCE(p_peserta, peserta), 4000),
    agenda_topik = left(COALESCE(p_agenda_topik, agenda_topik), 4000),
    isi_pembahasan = left(COALESCE(p_isi_pembahasan, isi_pembahasan), 8000),
    keputusan = left(COALESCE(p_keputusan, keputusan), 8000),
    tindak_lanjut = COALESCE(p_tindak_lanjut, tindak_lanjut),
    lampiran = COALESCE(p_lampiran, lampiran),
    status = COALESCE(NULLIF(btrim(p_status), ''), status)
  WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_notulensi(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'notulensi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.rapat_notulensi WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

-- AGENDA: buat_agenda, update_agenda, hapus_agenda (wajib osis_bisa_agenda)
CREATE OR REPLACE FUNCTION public.buat_agenda(
  p_user_id bigint, p_sekbid_id bigint, p_judul text, p_deskripsi text,
  p_tanggal date, p_lokasi text, p_status text, p_fotos jsonb,
  p_display_order integer DEFAULT 99, p_pelaksana text DEFAULT ''::text
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
  IF NOT public.osis_bisa_agenda(p_user_id, p_sekbid_id) THEN RETURN -1; END IF;
  p_judul := COALESCE(NULLIF(btrim(p_judul),''), '');
  IF p_judul = '' THEN RETURN -2; END IF;
  IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' THEN p_fotos := '[]'::jsonb; END IF;
  p_status := COALESCE(NULLIF(btrim(p_status),''), 'Terlaksana');
  INSERT INTO public.sekbid_agenda (sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, created_by)
  VALUES (p_sekbid_id, left(p_judul,80), left(COALESCE(p_deskripsi,''),500), COALESCE(p_tanggal,CURRENT_DATE), left(COALESCE(p_lokasi,''),80), p_status, p_fotos, p_user_id)
  RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_agenda(
  p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text,
  p_tanggal date, p_lokasi text, p_status text, p_fotos jsonb,
  p_display_order integer DEFAULT 99, p_pelaksana text DEFAULT ''::text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sekbid bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT sekbid_id INTO v_sekbid FROM public.sekbid_agenda WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_bisa_agenda(p_user_id, v_sekbid) THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.sekbid_agenda
     SET judul = left(COALESCE(NULLIF(btrim(p_judul), judul), judul), 80),
         deskripsi = left(COALESCE(p_deskripsi, deskripsi), 500),
         tanggal = COALESCE(p_tanggal, tanggal),
         lokasi = left(COALESCE(p_lokasi, lokasi), 80),
         status = COALESCE(NULLIF(btrim(p_status), status), status),
         fotos = COALESCE(p_fotos, fotos)
   WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_agenda(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sekbid bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT sekbid_id INTO v_sekbid FROM public.sekbid_agenda WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_bisa_agenda(p_user_id, v_sekbid) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.sekbid_agenda WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

-- KEGIATAN: buat_kegiatan, update_kegiatan, hapus_kegiatan (wajib hak 'kegiatan')
CREATE OR REPLACE FUNCTION public.buat_kegiatan(
  p_user_id bigint, p_judul text, p_deskripsi text, p_badge text, p_fotos jsonb, p_display_order integer DEFAULT 99
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
  IF NOT public.osis_bisa(p_user_id, 'kegiatan') THEN RETURN -1; END IF;
  p_judul := COALESCE(NULLIF(btrim(p_judul),''), '');
  IF p_judul = '' THEN RETURN -2; END IF;
  IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' OR jsonb_array_length(p_fotos) = 0 THEN RETURN -3; END IF;
  INSERT INTO public.kegiatan (judul, deskripsi, badge, fotos, display_order, created_by)
  VALUES (left(p_judul,80), left(COALESCE(p_deskripsi,''),200), left(COALESCE(p_badge,''),12), p_fotos, COALESCE(p_display_order,99), p_user_id)
  RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_kegiatan(
  p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text, p_badge text, p_fotos jsonb, p_display_order integer
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
  IF NOT public.osis_bisa(p_user_id, 'kegiatan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.kegiatan
     SET judul = left(COALESCE(NULLIF(btrim(p_judul), judul), judul), 80),
         deskripsi = left(COALESCE(p_deskripsi, deskripsi), 200),
         badge = left(COALESCE(p_badge, badge), 12),
         fotos = COALESCE(p_fotos, fotos),
         display_order = COALESCE(p_display_order, display_order)
   WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_kegiatan(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'kegiatan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.kegiatan WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

-- PRESTASI: buat_prestasi, update_prestasi, hapus_prestasi (wajib hak 'prestasi')
CREATE OR REPLACE FUNCTION public.buat_prestasi(
  p_user_id bigint, p_tag text, p_caption text, p_fotos jsonb, p_display_order integer DEFAULT 99
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
  IF NOT public.osis_bisa(p_user_id, 'prestasi') THEN RETURN -1; END IF;
  p_tag := COALESCE(NULLIF(btrim(p_tag),''), '');
  IF p_tag = '' THEN RETURN -2; END IF;
  IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' OR jsonb_array_length(p_fotos) = 0 THEN RETURN -3; END IF;
  INSERT INTO public.prestasi (tag, caption, fotos, display_order, created_by)
  VALUES (left(p_tag,40), left(COALESCE(p_caption,''),200), p_fotos, COALESCE(p_display_order,99), p_user_id)
  RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_prestasi(
  p_user_id bigint, p_id bigint, p_tag text, p_caption text, p_fotos jsonb, p_display_order integer
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
  IF NOT public.osis_bisa(p_user_id, 'prestasi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.prestasi
     SET tag = left(COALESCE(NULLIF(btrim(p_tag), tag), tag), 40),
         caption = left(COALESCE(p_caption, caption), 200),
         fotos = COALESCE(p_fotos, fotos),
         display_order = COALESCE(p_display_order, display_order)
   WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_prestasi(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'prestasi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.prestasi WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

-- GALERI: buat_gallery, hapus_gallery, galeri_add_foto, galeri_update_meta, galeri_update_fotos (wajib hak 'galeri')
CREATE OR REPLACE FUNCTION public.buat_gallery(
  p_user_id bigint, p_judul text, p_deskripsi text, p_fotos jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE nid bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN '-1'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'galeri') THEN RETURN '-1'; END IF;
  p_judul := COALESCE(NULLIF(btrim(p_judul), ''), '');
  IF p_judul = '' THEN RETURN 'ERR_NO_TITLE'; END IF;
  IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' OR jsonb_array_length(p_fotos) = 0 THEN
    RETURN 'ERR_NO_FOTO';
  END IF;
  INSERT INTO public.gallery (judul, deskripsi, fotos, created_by)
  VALUES (left(p_judul, 80), left(COALESCE(NULLIF(btrim(p_deskripsi), ''), ''), 140), p_fotos, p_user_id)
  RETURNING id INTO nid;
  RETURN nid::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_gallery(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'galeri') THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.gallery WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.galeri_add_foto(p_user_id bigint, p_id bigint, p_path text)
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
  IF NOT public.osis_bisa(p_user_id, 'galeri') THEN RETURN 'ERR_NO_AUTH'; END IF;
  p_path := btrim(coalesce(p_path, ''));
  IF p_path = '' THEN RETURN 'ERR_NO_FOTO'; END IF;
  UPDATE public.gallery
     SET fotos = COALESCE(fotos, '[]'::jsonb) || to_jsonb(p_path)
   WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.galeri_update_meta(p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text)
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
  IF NOT public.osis_bisa(p_user_id, 'galeri') THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.gallery
     SET judul = left(COALESCE(NULLIF(btrim(p_judul), ''), judul), 80),
         deskripsi = left(COALESCE(p_deskripsi, deskripsi), 140)
   WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.galeri_update_fotos(p_user_id bigint, p_id bigint, p_fotos jsonb)
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
  IF NOT public.osis_bisa(p_user_id, 'galeri') THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' OR jsonb_array_length(p_fotos) = 0 THEN
    RETURN 'ERR_NO_FOTO';
  END IF;
  UPDATE public.gallery SET fotos = p_fotos WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.galeri_add_foto(bigint, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.galeri_update_meta(bigint, bigint, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.galeri_update_fotos(bigint, bigint, jsonb) TO authenticated, service_role;

-- ASPIRASI & LAGU: edit/hapus oleh OSIS wajib punya hak modul ('aspirasi' / 'lagu')
CREATE OR REPLACE FUNCTION public.edit_aspirasi_osis(
  p_user_id bigint, p_id bigint, p_nama text, p_kelas text, p_isi text
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
  IF NOT public.osis_bisa(p_user_id, 'aspirasi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  p_isi := COALESCE(NULLIF(btrim(p_isi), ''), '');
  IF p_isi = '' THEN RETURN 'ERR_EMPTY'; END IF;
  p_nama := COALESCE(NULLIF(btrim(p_nama), ''), 'Anonim');
  p_kelas := COALESCE(NULLIF(btrim(p_kelas), ''), '-');
  UPDATE public.aspirasi
     SET nama = left(p_nama, 60),
         kelas = left(p_kelas, 30),
         isi = left(p_isi, 500)
   WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_aspirasi_osis(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'aspirasi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.aspirasi WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.edit_lagu_osis(
  p_user_id bigint, p_id bigint, p_judul text, p_penyanyi text, p_pesan text, p_nama text
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
  IF NOT public.osis_bisa(p_user_id, 'lagu') THEN RETURN 'ERR_NO_AUTH'; END IF;
  p_judul := COALESCE(NULLIF(btrim(p_judul), ''), '');
  p_penyanyi := COALESCE(NULLIF(btrim(p_penyanyi), ''), '');
  IF p_judul = '' OR p_penyanyi = '' THEN RETURN 'ERR_EMPTY'; END IF;
  p_nama := COALESCE(NULLIF(btrim(p_nama), ''), 'Anonim');
  UPDATE public.lagu_requests
     SET judul = left(p_judul, 80),
         penyanyi = left(p_penyanyi, 60),
         pesan = left(COALESCE(NULLIF(btrim(p_pesan), ''), ''), 200),
         nama = left(p_nama, 50)
   WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_lagu_osis(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'lagu') THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.lagu_requests WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

CREATE OR REPLACE FUNCTION public.tandai_lagu_selesai(p_user_id bigint, p_id bigint, p_selesai boolean DEFAULT true)
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
  IF NOT public.osis_bisa(p_user_id, 'lagu') THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.lagu_requests
     SET selesai = COALESCE(p_selesai, true)
   WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END;
$function$;

-- SITE CONTENT: save_site_text wajib hak 'site' (atau 'polling' khusus kunci polling_*)
CREATE OR REPLACE FUNCTION public.save_site_text(p_user_id bigint, p_key text, p_value text)
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
  p_key := COALESCE(NULLIF(btrim(p_key), ''), '');
  IF p_key = '' OR char_length(p_key) > 64 THEN
    RETURN 'ERR_INVALID_KEY';
  END IF;
  IF p_key IN ('polling_status', 'polling_judul') THEN
    IF NOT (public.osis_bisa(p_user_id, 'polling') OR public.osis_bisa(p_user_id, 'site')) THEN
      RETURN 'ERR_NO_AUTH';
    END IF;
  ELSE
    IF NOT public.osis_bisa(p_user_id, 'site') THEN
      RETURN 'ERR_NO_AUTH';
    END IF;
  END IF;
  INSERT INTO public.site_content (kunci, nilai, updated_at)
  VALUES (p_key, left(COALESCE(p_value, ''), 2000), now())
  ON CONFLICT (kunci) DO UPDATE
    SET nilai = EXCLUDED.nilai,
        updated_at = now();
  RETURN 'OK';
END;
$function$;

-- ============================================================================
-- 8. HARDENING LINK_AUTH_BIASA, VOTE_POLLING, FEED_KOMEN, PUSH, & AKUN OSIS
-- ============================================================================

-- link_auth_biasa: pastikan email cocok dengan email JWT & domain resmi
CREATE OR REPLACE FUNCTION public.link_auth_biasa(p_user_id bigint, p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_existing uuid;
  v_jwt_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN 'ERR_NO_SESSION'; END IF;

  p_email := lower(btrim(coalesce(p_email, '')));
  v_jwt_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  IF p_email = '' OR split_part(p_email, '@', 2) <> 'osistarpanone.my.id' THEN
    RETURN 'ERR_EMAIL_MISMATCH';
  END IF;
  IF v_jwt_email <> '' AND v_jwt_email <> p_email THEN
    RETURN 'ERR_EMAIL_MISMATCH';
  END IF;

  SELECT auth_id INTO v_existing FROM public.biasa_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;

  IF v_existing IS NOT NULL AND v_existing <> v_uid THEN
    RETURN 'ERR_ALREADY_LINKED';
  END IF;

  IF EXISTS (SELECT 1 FROM public.biasa_users WHERE auth_id = v_uid AND id <> p_user_id)
     OR EXISTS (SELECT 1 FROM public.osis_users WHERE auth_id = v_uid) THEN
    RETURN 'ERR_UID_USED';
  END IF;

  UPDATE public.biasa_users
     SET auth_id = v_uid,
         auth_email = p_email
   WHERE id = p_user_id;
  RETURN 'OK';
END;
$function$;

-- vote_polling: wajib sesi JWT aktif; identitas p_user_key & p_nama diturunkan dari auth.uid()
CREATE OR REPLACE FUNCTION public.vote_polling(
  p_device_id text, p_user_key text, p_nama text, p_kandidat_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_osis_id bigint;
  v_biasa_id bigint;
  v_nama_db text;
  v_status text;
  v_lama bigint;
BEGIN
  v_uid := auth.uid();
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF v_uid IS NULL THEN RETURN 'ERR_NO_LOGIN'; END IF;
    SELECT id, COALESCE(NULLIF(btrim(nama), ''), username)
      INTO v_osis_id, v_nama_db
      FROM public.osis_users WHERE auth_id = v_uid LIMIT 1;
    IF v_osis_id IS NOT NULL THEN
      p_user_key := 'osis:' || v_osis_id::text;
      p_nama := v_nama_db;
    ELSE
      SELECT id, COALESCE(NULLIF(btrim(nama), ''), username)
        INTO v_biasa_id, v_nama_db
        FROM public.biasa_users WHERE auth_id = v_uid LIMIT 1;
      IF v_biasa_id IS NULL THEN RETURN 'ERR_NO_LOGIN'; END IF;
      p_user_key := 'biasa:' || v_biasa_id::text;
      p_nama := v_nama_db;
    END IF;
  END IF;

  SELECT upper(btrim(nilai)) INTO v_status
    FROM public.site_content WHERE kunci = 'polling_status';
  IF COALESCE(v_status, 'BUKA') <> 'BUKA' THEN
    RETURN 'ERR_TUTUP';
  END IF;

  p_device_id := btrim(COALESCE(p_device_id, ''));
  p_user_key := lower(btrim(COALESCE(p_user_key, '')));
  p_nama := left(btrim(COALESCE(p_nama, '')), 60);
  IF p_device_id = '' OR length(p_device_id) < 4 THEN RETURN 'ERR_NO_DEVICE'; END IF;
  IF p_user_key = '' OR p_nama = '' THEN RETURN 'ERR_NO_LOGIN'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.polling_kandidat WHERE id = p_kandidat_id) THEN
    RETURN 'ERR_NO_KANDIDAT';
  END IF;

  SELECT kandidat_id INTO v_lama FROM public.polling_suara WHERE user_key = p_user_key;
  IF v_lama IS NULL THEN
    SELECT kandidat_id INTO v_lama FROM public.polling_suara WHERE device_id = p_device_id;
  END IF;

  IF v_lama IS NOT NULL THEN
    IF v_lama = p_kandidat_id THEN
      RETURN 'OK_SAMA';
    END IF;
    UPDATE public.polling_suara
       SET kandidat_id = p_kandidat_id,
           user_key = p_user_key,
           device_id = p_device_id,
           nama = p_nama,
           created_at = now()
     WHERE user_key = p_user_key OR device_id = p_device_id;
    RETURN 'OK_GANTI';
  END IF;

  INSERT INTO public.polling_suara (kandidat_id, device_id, user_key, nama)
  VALUES (p_kandidat_id, p_device_id, p_user_key, p_nama);
  RETURN 'OK';
END;
$function$;

-- feed_komen_tambah: wajib login; turunkan p_user_key & p_nama dari auth.uid()
CREATE OR REPLACE FUNCTION public.feed_komen_tambah(
  p_post_id bigint, p_user_key text, p_nama text, p_teks text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_osis_id bigint;
  v_biasa_id bigint;
  v_nama_db text;
  nid bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN RETURN -1; END IF;
    SELECT id, COALESCE(NULLIF(btrim(nama), ''), username)
      INTO v_osis_id, v_nama_db
      FROM public.osis_users WHERE auth_id = v_uid LIMIT 1;
    IF v_osis_id IS NOT NULL THEN
      p_user_key := 'osis:' || v_osis_id::text;
      p_nama := v_nama_db;
    ELSE
      SELECT id, COALESCE(NULLIF(btrim(nama), ''), username)
        INTO v_biasa_id, v_nama_db
        FROM public.biasa_users WHERE auth_id = v_uid LIMIT 1;
      IF v_biasa_id IS NULL THEN RETURN -1; END IF;
      p_user_key := 'biasa:' || v_biasa_id::text;
      p_nama := v_nama_db;
    END IF;
  END IF;

  IF p_post_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.feed_posts WHERE id = p_post_id) THEN
    RETURN -2;
  END IF;
  p_teks := btrim(COALESCE(p_teks, ''));
  IF p_teks = '' THEN RETURN -3; END IF;
  p_user_key := left(btrim(COALESCE(p_user_key, '')), 120);
  IF p_user_key = '' THEN RETURN -4; END IF;
  p_nama := left(COALESCE(NULLIF(btrim(p_nama), ''), 'Anonim'), 60);

  INSERT INTO public.feed_comments (post_id, user_key, nama, teks)
  VALUES (p_post_id, p_user_key, p_nama, left(p_teks, 300))
  RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

-- feed_komen_hapus: cegah spoofing p_user_key (verifikasi pemilik via auth.uid())
CREATE OR REPLACE FUNCTION public.feed_komen_hapus(
  p_user_id bigint, p_user_key text, p_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_biasa_id bigint;
  pemilik_key text;
  boleh boolean := false;
BEGIN
  IF p_id IS NULL THEN RETURN 'ERR_ID'; END IF;
  SELECT user_key INTO pemilik_key FROM public.feed_comments WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;

  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NOT NULL THEN
      boleh := true;
    ELSE
      v_uid := auth.uid();
      IF v_uid IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
      SELECT id INTO v_biasa_id FROM public.biasa_users WHERE auth_id = v_uid LIMIT 1;
      IF v_biasa_id IS NOT NULL AND pemilik_key = ('biasa:' || v_biasa_id::text) THEN
        boleh := true;
      END IF;
    END IF;
  ELSE
    boleh := true;
  END IF;

  IF NOT boleh THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.feed_comments WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

-- simpan_push_sub: validasi HTTPS endpoint & batasi audience 'osis' hanya untuk pengurus OSIS
CREATE OR REPLACE FUNCTION public.simpan_push_sub(
  p_endpoint text, p_p256dh text, p_auth text,
  p_audience text DEFAULT 'publik'::text, p_user_key text DEFAULT ''::text, p_device_id text DEFAULT ''::text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_aud text;
BEGIN
  p_endpoint := btrim(coalesce(p_endpoint, ''));
  IF p_endpoint = '' OR char_length(p_endpoint) < 12 OR char_length(p_endpoint) > 2000 THEN
    RETURN 'ERR_ENDPOINT';
  END IF;
  IF p_endpoint !~* '^https://[a-z0-9.-]+/' THEN
    RETURN 'ERR_ENDPOINT';
  END IF;
  IF p_p256dh IS NULL OR char_length(p_p256dh) < 10 OR char_length(p_p256dh) > 500 THEN
    RETURN 'ERR_KEY';
  END IF;
  IF p_auth IS NULL OR char_length(p_auth) < 5 OR char_length(p_auth) > 500 THEN
    RETURN 'ERR_AUTH';
  END IF;
  v_aud := lower(coalesce(nullif(trim(p_audience), ''), 'publik'));
  IF v_aud NOT IN ('publik', 'osis', 'semua') THEN v_aud := 'publik'; END IF;
  IF v_aud IN ('osis', 'semua') AND public.osis_id_dari_auth() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    v_aud := 'publik';
  END IF;
  INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, audience, user_key, device_id, updated_at)
  VALUES (p_endpoint, p_p256dh, p_auth, v_aud, left(coalesce(p_user_key, ''), 120), left(coalesce(p_device_id, ''), 120), now())
  ON CONFLICT (endpoint) DO UPDATE SET
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    audience = EXCLUDED.audience,
    user_key = EXCLUDED.user_key,
    device_id = EXCLUDED.device_id,
    updated_at = now();
  RETURN 'OK';
END;
$function$;

-- ganti_osis_username: cek keunikan case-insensitive di osis_users & biasa_users + sinkron super_admin
CREATE OR REPLACE FUNCTION public.ganti_osis_username(p_user_id bigint, p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT username INTO v_old FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN 'ERR_NO_AUTH'; END IF;

  p_username := COALESCE(NULLIF(btrim(p_username), ''), '');
  IF p_username = '' OR p_username !~ '^[A-Za-z0-9._-]{3,30}$' THEN
    RETURN 'ERR_INVALID';
  END IF;

  IF EXISTS (SELECT 1 FROM public.osis_users WHERE lower(btrim(username)) = lower(p_username) AND id <> p_user_id)
     OR EXISTS (SELECT 1 FROM public.biasa_users WHERE lower(btrim(username)) = lower(p_username)) THEN
    RETURN 'ERR_TAKEN';
  END IF;

  UPDATE public.osis_users SET username = p_username WHERE id = p_user_id;
  IF v_old IS NOT NULL AND lower(btrim(v_old)) <> lower(p_username) THEN
    UPDATE public.osis_super_admins
       SET username = lower(p_username)
     WHERE lower(btrim(username)) = lower(btrim(v_old));
  END IF;
  RETURN 'OK';
END;
$function$;

-- ganti_osis_password: tolak bila akun sudah terlink ke Supabase Auth
CREATE OR REPLACE FUNCTION public.ganti_osis_password(p_user_id bigint, p_old text, p_new text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth_id uuid;
  v_pw text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT auth_id, password INTO v_auth_id, v_pw FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF v_auth_id IS NOT NULL OR coalesce(v_pw, '') = '' THEN
    RETURN 'ERR_LINKED';
  END IF;
  IF v_pw <> COALESCE(p_old, '') THEN
    RETURN 'ERR_WRONG_PASS';
  END IF;
  p_new := COALESCE(p_new, '');
  IF char_length(p_new) < 4 OR char_length(p_new) > 64 THEN
    RETURN 'ERR_INVALID';
  END IF;
  UPDATE public.osis_users SET password = p_new WHERE id = p_user_id;
  RETURN 'OK';
END;
$function$;

-- ============================================================================
-- 9. SET SEARCH_PATH = 'public', 'pg_temp' & KUNCI EXECUTE FUNCTION DARI ANON
--    (Kecuali wa_device_id yang tidak disentuh sesuai instruksi owner)
-- ============================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'wa_device_id'
      AND p.proconfig IS NULL
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO public, pg_temp', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.prorettype = 'trigger'::regtype AS is_trig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'wa_device_id'
      AND p.proname NOT IN (
        'cari_osis_login',
        'cari_biasa_login',
        'daftar_biasa',
        'aspirasi_list_publik',
        'kirim_aspirasi_terbatas',
        'edit_aspirasi_own',
        'hapus_aspirasi_own',
        'lagu_list_publik',
        'kirim_lagu_terbatas',
        'edit_lagu_own',
        'hapus_lagu_own',
        'tambah_visitor_unik',
        'aktivitas_catat',
        'aktivitas_heartbeat',
        'aktivitas_list',
        'feed_posts_list',
        'feed_post_satu',
        'feed_like_toggle',
        'feed_komen_list',
        'feed_share_cat',
        'polling_hasil',
        'polling_total',
        'polling_hasil_total',
        'polling_suara_saya',
        'simpan_push_sub',
        'hapus_push_sub',
        'wawancara_hasil_publik',
        'qr_absen_info',
        'status_akses_pelantikan'
      )
  LOOP
    IF r.is_trig THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    END IF;
  END LOOP;
END $$;

COMMIT;
