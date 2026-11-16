-- =========================================================================
-- MIGRASI-ANGKATAN-3-LINTAS-MODUL
-- Penyesuaian akses lintas angkatan per modul:
-- 1. anggota, osis_absensi, osis_dokumen, rapat_notulensi, informasi, poster:
--    SELECT dibuka untuk semua akun OSIS yang login (filter & pengelompokan
--    ditangani rapi di aplikasi; modul lain seperti keuangan, tabungan,
--    agenda, program, wawancara tetap terkunci per angkatan).
-- 2. Tulis (INSERT/UPDATE/DELETE) untuk anggota, dokumen, notulensi,
--    informasi, poster tetap terkunci di angkatan sendiri (atau lintas/super).
-- 3. Absensi + QR: ikuti osis_absensi_config.tahun_aktif milik angkatan
--    (misal ADIABI Jilid 4 aktif 2026 & 2027 -> boleh catat/edit/hapus/QR
--    untuk baris angkatan yg tahunnya termasuk di tahun_aktif).
--
-- Jalankan SEKALI di Supabase SQL Editor setelah migrasi-angkatan-2
-- dan migrasi-absensi-tahun-aktif. Idempoten (aman dijalankan ulang).
-- =========================================================================

BEGIN;

-- ================= 1. RLS SELECT LINTAS ANGKATAN (KHUSUS OSIS LOGIN) =================
DROP POLICY IF EXISTS anggota_public_select ON public.anggota;
CREATE POLICY anggota_public_select ON public.anggota
  FOR SELECT TO authenticated
  USING ((SELECT public.osis_id_dari_auth()) IS NOT NULL);

DROP POLICY IF EXISTS absensi_public_select ON public.osis_absensi;
CREATE POLICY absensi_public_select ON public.osis_absensi
  FOR SELECT TO authenticated
  USING ((SELECT public.osis_id_dari_auth()) IS NOT NULL);

DROP POLICY IF EXISTS dokumen_public_select ON public.osis_dokumen;
CREATE POLICY dokumen_public_select ON public.osis_dokumen
  FOR SELECT TO authenticated
  USING ((SELECT public.osis_id_dari_auth()) IS NOT NULL);

DROP POLICY IF EXISTS notulensi_login_select ON public.rapat_notulensi;
CREATE POLICY notulensi_login_select ON public.rapat_notulensi
  FOR SELECT TO authenticated
  USING ((SELECT public.osis_id_dari_auth()) IS NOT NULL);

DROP POLICY IF EXISTS informasi_osis_select ON public.informasi;
CREATE POLICY informasi_osis_select ON public.informasi
  FOR SELECT TO authenticated
  USING ((SELECT public.osis_id_dari_auth()) IS NOT NULL);

DROP POLICY IF EXISTS poster_public_select ON public.poster;
CREATE POLICY poster_public_select ON public.poster
  FOR SELECT TO authenticated
  USING ((SELECT public.osis_id_dari_auth()) IS NOT NULL);

-- ================= 2. HELPER OTORISASI ABSENSI TAHUN AKTIF =================
CREATE OR REPLACE FUNCTION public.osis_absensi_boleh_angkatan(
  p_user_id bigint,
  p_row_angkatan_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    public.osis_boleh_angkatan(p_user_id, p_row_angkatan_id)
    OR EXISTS (
      SELECT 1
        FROM public.osis_users u
        JOIN public.osis_absensi_config c ON c.angkatan_id = u.angkatan_id
        JOIN public.angkatan a ON a.id = p_row_angkatan_id
       WHERE u.id = p_user_id
         AND a.tahun IS NOT NULL
         AND a.tahun = ANY(c.tahun_aktif)
    );
$function$;

CREATE OR REPLACE FUNCTION public.osis_qr_sesi_boleh_user(
  p_sesi_angkatan_id bigint,
  p_user_id bigint,
  p_user_ang_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    p_user_ang_id IS NULL
    OR p_user_ang_id = p_sesi_angkatan_id
    OR public.osis_lintas_angkatan(p_user_id)
    OR EXISTS (
      SELECT 1
        FROM public.osis_absensi_config c
        JOIN public.angkatan au ON au.id = p_user_ang_id
       WHERE c.angkatan_id = p_sesi_angkatan_id
         AND au.tahun IS NOT NULL
         AND au.tahun = ANY(c.tahun_aktif)
    );
$function$;

-- ================= 3. RPC ABSENSI + QR (IKUT TAHUN AKTIF) =================
CREATE OR REPLACE FUNCTION public.buat_absensi(
  p_user_id bigint,
  p_tanggal date,
  p_nama text,
  p_status text,
  p_alasan text,
  p_kegiatan text DEFAULT ''::text,
  p_angkatan_id bigint DEFAULT NULL::bigint
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
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN RETURN -1; END IF;

  IF p_angkatan_id IS NOT NULL AND public.osis_absensi_boleh_angkatan(p_user_id, p_angkatan_id) THEN
    v_ang := p_angkatan_id;
  ELSE
    v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  END IF;
  IF v_ang IS NULL THEN RETURN -1; END IF;

  IF p_tanggal IS NULL THEN RETURN -2; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN -3; END IF;
  p_status := COALESCE(NULLIF(btrim(p_status), ''), '');
  IF p_status NOT IN ('izin', 'sakit', 'alpha', 'hadir') THEN RETURN -4; END IF;
  p_kegiatan := left(btrim(COALESCE(p_kegiatan, '')), 120);

  BEGIN
    INSERT INTO public.osis_absensi (tanggal, nama, status, alasan, kegiatan, created_by, angkatan_id)
    VALUES (p_tanggal, p_nama, p_status, left(COALESCE(p_alasan, ''), 500), p_kegiatan, p_user_id, v_ang)
    RETURNING id INTO nid;
  EXCEPTION WHEN unique_violation THEN
    RETURN -5;
  END;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_absensi(
  p_user_id bigint,
  p_id bigint,
  p_tanggal date,
  p_nama text,
  p_status text,
  p_alasan text,
  p_kegiatan text DEFAULT ''::text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.osis_absensi WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_absensi_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_tanggal IS NULL THEN RETURN 'ERR_NO_TANGGAL'; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN 'ERR_NO_NAMA'; END IF;
  IF COALESCE(btrim(p_status), '') NOT IN ('izin', 'sakit', 'alpha', 'hadir') THEN
    RETURN 'ERR_STATUS';
  END IF;

  BEGIN
    UPDATE public.osis_absensi
       SET tanggal = p_tanggal,
           nama = p_nama,
           status = btrim(p_status),
           alasan = left(COALESCE(p_alasan, alasan), 500),
           kegiatan = left(btrim(COALESCE(p_kegiatan, kegiatan, '')), 120),
           updated_at = now()
     WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN 'ERR_DUPLIKAT';
  END;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_absensi(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.osis_absensi WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_absensi_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.osis_absensi WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.qr_absen_catat(p_user_id bigint, p_sesi_id bigint, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sesi     public.osis_absensi_qr_sesi%ROWTYPE;
  v_kartu    public.osis_absensi_qr_kartu%ROWTYPE;
  v_user     public.osis_users%ROWTYPE;
  v_anggota  jsonb;
  v_secret   text;
  v_pay      text;
  v_sig      text;
  v_expect   text;
  v_kartu_id bigint;
  v_siswa_id bigint;
  v_nama     text;
  v_kelas    text;
  v_tahun    integer;
  v_roster   boolean := true;
  v_id       bigint;
  v_status   text;
  v_row_ang  bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AUTH');
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AKSES');
  END IF;

  SELECT * INTO v_sesi
    FROM public.osis_absensi_qr_sesi
   WHERE id = p_sesi_id AND dibuat_oleh = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ERR_SESI');
  END IF;
  IF NOT public.osis_absensi_boleh_angkatan(p_user_id, v_sesi.angkatan_id) THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AKSES');
  END IF;
  IF NOT v_sesi.aktif THEN
    RETURN jsonb_build_object('status', 'ERR_SESI_TUTUP');
  END IF;
  IF v_sesi.berakhir_at < now() THEN
    RETURN jsonb_build_object('status', 'ERR_KEDALUWARSA');
  END IF;

  v_secret := (SELECT rahasia FROM public.osis_absensi_qr_rahasia WHERE id = 1);
  v_pay := split_part(btrim(COALESCE(p_token, '')), '.', 1);
  v_sig := split_part(btrim(COALESCE(p_token, '')), '.', 2);
  v_expect := rtrim(translate(encode(extensions.hmac(v_pay, v_secret, 'sha256'), 'base64'), '+/', '-_'), '=');
  IF v_sig = '' OR v_sig IS DISTINCT FROM v_expect THEN
    RETURN jsonb_build_object('status', 'ERR_TOKEN');
  END IF;
  BEGIN
    v_kartu_id := (split_part(v_pay, '|', 2))::bigint;
    v_siswa_id := (split_part(v_pay, '|', 3))::bigint;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'ERR_TOKEN');
  END;

  SELECT * INTO v_kartu FROM public.osis_absensi_qr_kartu WHERE id = v_kartu_id;
  IF NOT FOUND OR v_kartu.user_id <> v_siswa_id THEN
    RETURN jsonb_build_object('status', 'ERR_TOKEN');
  END IF;
  IF v_kartu.dipakai_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ERR_PAKAI');
  END IF;
  IF v_kartu.berakhir_at < now() THEN
    RETURN jsonb_build_object('status', 'ERR_KEDALUWARSA');
  END IF;

  SELECT * INTO v_user FROM public.osis_users WHERE id = v_kartu.user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ERR_TOKEN');
  END IF;
  IF NOT public.osis_qr_sesi_boleh_user(v_sesi.angkatan_id, v_user.id, v_user.angkatan_id) THEN
    RETURN jsonb_build_object('status', 'ERR_BEDA_ANGKATAN');
  END IF;

  v_row_ang := COALESCE(v_user.angkatan_id, v_sesi.angkatan_id);

  SELECT to_jsonb(a) INTO v_anggota
    FROM public.anggota a
   WHERE btrim(lower(a.username)) = btrim(lower(COALESCE(v_user.username, '')))
     AND btrim(COALESCE(a.username, '')) <> ''
   ORDER BY (a.angkatan_id = v_row_ang) DESC, a.tahun DESC, a.id DESC
   LIMIT 1;

  IF v_anggota IS NULL THEN
    v_nama := left(btrim(COALESCE(v_user.nama, '')), 80);
    v_roster := false;
  ELSE
    v_nama := left(btrim(COALESCE(v_anggota ->> 'nama', v_user.nama, '')), 80);
    v_tahun := NULLIF(v_anggota ->> 'tahun', '')::integer;
    v_kelas := btrim(COALESCE(v_anggota ->> 'kelas', ''));
  END IF;
  IF v_nama = '' THEN
    RETURN jsonb_build_object('status', 'ERR_NO_NAMA');
  END IF;

  SELECT id, status INTO v_id, v_status
    FROM public.osis_absensi
   WHERE angkatan_id IN (v_row_ang, v_sesi.angkatan_id)
     AND tanggal = v_sesi.tanggal
     AND lower(btrim(nama)) = lower(v_nama)
   LIMIT 1;
  IF FOUND THEN
    IF v_status = 'hadir' THEN
      UPDATE public.osis_absensi_qr_kartu
         SET dipakai_at = now(), dipakai_oleh = p_user_id
       WHERE id = v_kartu.id;
      RETURN jsonb_build_object('status', 'OK_SAMA', 'nama', v_nama, 'kelas', v_kelas);
    END IF;
    RETURN jsonb_build_object('status', 'ERR_BENTROK', 'nama', v_nama, 'absen', v_status);
  END IF;

  UPDATE public.osis_absensi_qr_kartu
     SET dipakai_at = now(), dipakai_oleh = p_user_id
   WHERE id = v_kartu.id;

  INSERT INTO public.osis_absensi
    (tanggal, nama, status, alasan, kegiatan, created_by, sumber, akun_id, akun_mode, sesi_qr_id, angkatan_id)
  VALUES
    (v_sesi.tanggal, v_nama, 'hadir', '', v_sesi.kegiatan, v_user.id,
     'qr', v_user.id, 'osis', v_sesi.id, v_row_ang);

  RETURN jsonb_build_object(
    'status', 'OK',
    'nama', v_nama,
    'kelas', v_kelas,
    'tahun', v_tahun,
    'roster', v_roster,
    'tanggal', v_sesi.tanggal,
    'kegiatan', v_sesi.kegiatan,
    'jam', now()
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'OK_SAMA');
END;
$function$;

CREATE OR REPLACE FUNCTION public.qr_absen_daftar(p_token text, p_kode text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_user    public.osis_users%ROWTYPE;
  v_anggota jsonb;
  v_sesi    public.osis_absensi_qr_sesi%ROWTYPE;
  v_secret  text;
  v_pay     text;
  v_sig     text;
  v_expect  text;
  v_nama    text;
  v_kelas   text;
  v_tahun   integer;
  v_roster  boolean := true;
  v_kode2   text := upper(btrim(COALESCE(p_kode, '')));
  v_id      bigint;
  v_status  text;
  v_row_ang bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'ERR_NO_LOGIN');
  END IF;
  SELECT * INTO v_user FROM public.osis_users WHERE auth_id = v_uid;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.biasa_users WHERE auth_id = v_uid) THEN
      RETURN jsonb_build_object('status', 'ERR_BUKAN_OSIS');
    END IF;
    RETURN jsonb_build_object('status', 'ERR_NO_LOGIN');
  END IF;

  v_secret := (SELECT rahasia FROM public.osis_absensi_qr_rahasia WHERE id = 1);

  IF btrim(COALESCE(p_token, '')) <> '' THEN
    v_pay := split_part(btrim(p_token), '.', 1);
    v_sig := split_part(btrim(p_token), '.', 2);
    v_expect := rtrim(translate(encode(extensions.hmac(v_pay, v_secret, 'sha256'), 'base64'), '+/', '-_'), '=');
    IF v_sig = '' OR v_sig IS DISTINCT FROM v_expect THEN
      RETURN jsonb_build_object('status', 'ERR_TOKEN');
    END IF;
    BEGIN
      v_id := (split_part(v_pay, '|', 2))::bigint;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'ERR_TOKEN');
    END;
    SELECT * INTO v_sesi FROM public.osis_absensi_qr_sesi WHERE id = v_id;
    IF NOT FOUND OR split_part(v_pay, '|', 4) <> v_sesi.kode THEN
      RETURN jsonb_build_object('status', 'ERR_TOKEN');
    END IF;
  ELSIF v_kode2 <> '' THEN
    SELECT * INTO v_sesi
      FROM public.osis_absensi_qr_sesi
     WHERE kode = v_kode2 AND aktif
     ORDER BY dibuat_at DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'ERR_KODE');
    END IF;
  ELSE
    RETURN jsonb_build_object('status', 'ERR_TOKEN');
  END IF;

  IF NOT v_sesi.aktif THEN
    RETURN jsonb_build_object('status', 'ERR_SESI_TUTUP');
  END IF;
  IF v_sesi.berakhir_at < now() THEN
    RETURN jsonb_build_object('status', 'ERR_KEDALUWARSA');
  END IF;
  IF NOT public.osis_qr_sesi_boleh_user(v_sesi.angkatan_id, v_user.id, v_user.angkatan_id) THEN
    RETURN jsonb_build_object('status', 'ERR_BEDA_ANGKATAN');
  END IF;

  v_row_ang := COALESCE(v_user.angkatan_id, v_sesi.angkatan_id);

  SELECT to_jsonb(a) INTO v_anggota
    FROM public.anggota a
   WHERE btrim(lower(a.username)) = btrim(lower(COALESCE(v_user.username, '')))
     AND btrim(COALESCE(a.username, '')) <> ''
   ORDER BY (a.angkatan_id = v_row_ang) DESC, a.tahun DESC, a.id DESC
   LIMIT 1;

  IF v_anggota IS NULL THEN
    v_nama := left(btrim(COALESCE(v_user.nama, '')), 80);
    v_roster := false;
  ELSE
    v_nama := left(btrim(COALESCE(v_anggota ->> 'nama', v_user.nama, '')), 80);
    v_tahun := NULLIF(v_anggota ->> 'tahun', '')::integer;
    v_kelas := btrim(COALESCE(v_anggota ->> 'kelas', ''));
  END IF;
  IF v_nama = '' THEN
    RETURN jsonb_build_object('status', 'ERR_NO_NAMA');
  END IF;

  SELECT id, status INTO v_id, v_status
    FROM public.osis_absensi
   WHERE angkatan_id IN (v_row_ang, v_sesi.angkatan_id)
     AND tanggal = v_sesi.tanggal
     AND lower(btrim(nama)) = lower(v_nama)
   LIMIT 1;
  IF FOUND THEN
    IF v_status = 'hadir' THEN
      RETURN jsonb_build_object(
        'status', 'OK_SAMA', 'nama', v_nama,
        'tanggal', v_sesi.tanggal, 'jam', now()
      );
    END IF;
    RETURN jsonb_build_object('status', 'ERR_BENTROK', 'nama', v_nama, 'absen', v_status);
  END IF;

  INSERT INTO public.osis_absensi
    (tanggal, nama, status, alasan, kegiatan, created_by, sumber, akun_id, akun_mode, sesi_qr_id, angkatan_id)
  VALUES
    (v_sesi.tanggal, v_nama, 'hadir', '', v_sesi.kegiatan, v_user.id,
     'qr', v_user.id, 'osis', v_sesi.id, v_row_ang);

  RETURN jsonb_build_object(
    'status', 'OK',
    'nama', v_nama,
    'kelas', v_kelas,
    'tahun', v_tahun,
    'roster', v_roster,
    'tanggal', v_sesi.tanggal,
    'kegiatan', v_sesi.kegiatan,
    'jam', now()
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'OK_SAMA');
END;
$function$;

COMMIT;
