-- =========================================================================
-- MIGRASI-ANGKATAN-2-RLS-RPC
-- Penegakan isolasi angkatan di Postgres (helper, RLS InitPlan, RPC + auth).
--
-- Jalankan SETELAH db/migrasi-angkatan-1-skema-backfill.sql.
-- =========================================================================

BEGIN;

-- ================= 1. HELPER OTORISASI ANGKATAN =================
CREATE OR REPLACE FUNCTION public.osis_angkatan_dari_auth()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT u.angkatan_id
    FROM public.osis_users u
   WHERE u.auth_id = auth.uid()
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.osis_lintas_angkatan(p_user_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.osis_users u
     WHERE u.id = p_user_id
       AND (
         public.osis_is_super(u.username)
         OR upper(btrim(COALESCE(u.jabatan, ''))) = 'PEMBINA'
         OR upper(btrim(COALESCE(u.angkatan, ''))) = 'PEMBINA'
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.osis_boleh_angkatan(p_user_id bigint, p_angkatan_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_angkatan_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.angkatan a WHERE a.id = p_angkatan_id) THEN
    RETURN false;
  END IF;
  IF public.osis_lintas_angkatan(p_user_id) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM public.osis_users u
     WHERE u.id = p_user_id
       AND u.angkatan_id = p_angkatan_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.osis_target_angkatan(
  p_user_id bigint,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_ang bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT u.angkatan_id INTO v_user_ang
    FROM public.osis_users u
   WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF public.osis_lintas_angkatan(p_user_id) THEN
    IF p_angkatan_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.angkatan a WHERE a.id = p_angkatan_id) THEN
        RETURN p_angkatan_id;
      END IF;
      RETURN NULL;
    END IF;
    IF v_user_ang IS NOT NULL THEN
      RETURN v_user_ang;
    END IF;
    RETURN COALESCE(
      (SELECT a.id FROM public.angkatan a WHERE a.aktif ORDER BY a.urutan DESC, a.id DESC LIMIT 1),
      (SELECT a.id FROM public.angkatan a ORDER BY a.urutan DESC, a.id DESC LIMIT 1)
    );
  END IF;

  IF v_user_ang IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_angkatan_id IS NOT NULL AND p_angkatan_id <> v_user_ang THEN
    RETURN NULL;
  END IF;
  RETURN v_user_ang;
END;
$function$;

-- ================= 2. ROW LEVEL SECURITY (RLS) PER ANGKATAN =================
DROP POLICY IF EXISTS angkatan_osis_select ON public.angkatan;
CREATE POLICY angkatan_osis_select ON public.angkatan
  FOR SELECT TO authenticated
  USING ((SELECT public.osis_id_dari_auth()) IS NOT NULL);

DROP POLICY IF EXISTS osis_users_public_select ON public.osis_users;
CREATE POLICY osis_users_public_select ON public.osis_users
  FOR SELECT TO authenticated
  USING (
    auth_id = (SELECT auth.uid())
    OR (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
    OR (
      (SELECT public.osis_id_dari_auth()) IS NOT NULL
      AND (
        angkatan_id = (SELECT public.osis_angkatan_dari_auth())
        OR angkatan_id IS NULL
      )
    )
  );

-- Cabut SELECT langsung anon pada tabel internal operasional
REVOKE SELECT ON TABLE
  public.osis_kas, public.osis_saldo_awal, public.osis_tabungan,
  public.osis_absensi, public.osis_dokumen, public.rapat_notulensi,
  public.informasi, public.sekbid_agenda, public.program,
  public.poster, public.anggota,
  public.wawancara_calon, public.wawancara_sesi, public.wawancara_pertanyaan,
  public.wawancara_jawaban, public.wawancara_urutan, public.wawancara_turunan,
  public.wawancara_dokumentasi, public.wawancara_sesi_petugas
FROM PUBLIC, anon;

-- osis_kas
DROP POLICY IF EXISTS kas_public_select ON public.osis_kas;
CREATE POLICY kas_public_select ON public.osis_kas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- osis_saldo_awal
DROP POLICY IF EXISTS saldo_awal_public_select ON public.osis_saldo_awal;
CREATE POLICY saldo_awal_public_select ON public.osis_saldo_awal
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- osis_tabungan
DROP POLICY IF EXISTS tabungan_public_select ON public.osis_tabungan;
CREATE POLICY tabungan_public_select ON public.osis_tabungan
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- osis_absensi
DROP POLICY IF EXISTS absensi_public_select ON public.osis_absensi;
CREATE POLICY absensi_public_select ON public.osis_absensi
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- sekbid_agenda
DROP POLICY IF EXISTS agenda_public_select ON public.sekbid_agenda;
CREATE POLICY agenda_public_select ON public.sekbid_agenda
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- program
DROP POLICY IF EXISTS program_public_select ON public.program;
CREATE POLICY program_public_select ON public.program
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- rapat_notulensi
DROP POLICY IF EXISTS notulensi_login_select ON public.rapat_notulensi;
CREATE POLICY notulensi_login_select ON public.rapat_notulensi
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- informasi
DROP POLICY IF EXISTS informasi_osis_select ON public.informasi;
CREATE POLICY informasi_osis_select ON public.informasi
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- osis_dokumen
DROP POLICY IF EXISTS dokumen_public_select ON public.osis_dokumen;
CREATE POLICY dokumen_public_select ON public.osis_dokumen
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- poster
DROP POLICY IF EXISTS poster_public_select ON public.poster;
CREATE POLICY poster_public_select ON public.poster
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- anggota
DROP POLICY IF EXISTS anggota_public_select ON public.anggota;
CREATE POLICY anggota_public_select ON public.anggota
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- wawancara_calon / wawancara_sesi / wawancara_pertanyaan
DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_calon;
CREATE POLICY wawancara_osis_select ON public.wawancara_calon
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_sesi;
CREATE POLICY wawancara_osis_select ON public.wawancara_sesi
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_pertanyaan;
CREATE POLICY wawancara_osis_select ON public.wawancara_pertanyaan
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- Tabel anak wawancara (ikut sesi_id)
DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_sesi_petugas;
CREATE POLICY wawancara_osis_select ON public.wawancara_sesi_petugas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR EXISTS (
        SELECT 1 FROM public.wawancara_sesi s
         WHERE s.id = sesi_id
           AND s.angkatan_id = (SELECT public.osis_angkatan_dari_auth())
      )
    )
  );

DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_jawaban;
CREATE POLICY wawancara_osis_select ON public.wawancara_jawaban
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR EXISTS (
        SELECT 1 FROM public.wawancara_sesi s
         WHERE s.id = sesi_id
           AND s.angkatan_id = (SELECT public.osis_angkatan_dari_auth())
      )
    )
  );

DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_urutan;
CREATE POLICY wawancara_osis_select ON public.wawancara_urutan
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR EXISTS (
        SELECT 1 FROM public.wawancara_sesi s
         WHERE s.id = sesi_id
           AND s.angkatan_id = (SELECT public.osis_angkatan_dari_auth())
      )
    )
  );

DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_turunan;
CREATE POLICY wawancara_osis_select ON public.wawancara_turunan
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR EXISTS (
        SELECT 1 FROM public.wawancara_sesi s
         WHERE s.id = sesi_id
           AND s.angkatan_id = (SELECT public.osis_angkatan_dari_auth())
      )
    )
  );

DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_dokumentasi;
CREATE POLICY wawancara_osis_select ON public.wawancara_dokumentasi
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR EXISTS (
        SELECT 1 FROM public.wawancara_sesi s
         WHERE s.id = sesi_id
           AND s.angkatan_id = (SELECT public.osis_angkatan_dari_auth())
      )
    )
  );

-- aktivitas (log internal OSIS hanya terbaca oleh angkatan bersangkutan / lintas angkatan)
DROP POLICY IF EXISTS aktivitas_public_select ON public.aktivitas;
CREATE POLICY aktivitas_public_select ON public.aktivitas
  FOR SELECT
  USING (
    (angkatan_id IS NULL AND COALESCE(user_key, '') NOT LIKE 'osis:%')
    OR (
      (SELECT public.osis_id_dari_auth()) IS NOT NULL
      AND (
        (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
        OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
      )
    )
  );

-- ================= 3. AUTH & MASTER ANGKATAN RPC =================
CREATE OR REPLACE FUNCTION public.cari_osis_login(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    'angkatan', coalesce(a.nama, u.angkatan, ''),
    'angkatan_id', u.angkatan_id,
    'lintas_angkatan', public.osis_lintas_angkatan(u.id),
    'auth_id', u.auth_id,
    'auth_email', u.auth_email
  )
  INTO v_row
  FROM public.osis_users u
  LEFT JOIN public.angkatan a ON a.id = u.angkatan_id
  WHERE lower(btrim(u.username)) = lower(p_username)
  LIMIT 1;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.akses_saya(p_user_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_username text;
  v_jabatan text;
  v_ang text;
  v_ang_id bigint;
  v_sekbid bigint;
  v_super boolean;
  v_lintas boolean;
  v_hal text[];
  v_jab text[];
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL;
  ELSE
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  SELECT u.username, u.jabatan, COALESCE(a.nama, u.angkatan, ''), u.angkatan_id
    INTO v_username, v_jabatan, v_ang, v_ang_id
    FROM public.osis_users u
    LEFT JOIN public.angkatan a ON a.id = u.angkatan_id
   WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'halaman', '[]'::jsonb, 'sekbid_id', NULL, 'sekbid_nama', NULL,
      'super', false, 'angkatan_id', NULL, 'angkatan', '', 'lintas_angkatan', false
    );
  END IF;

  v_sekbid := public.osis_sekbid_dari_jabatan(v_jabatan);
  v_super := public.osis_is_super(v_username);
  v_lintas := public.osis_lintas_angkatan(p_user_id);

  SELECT COALESCE(array_agg(DISTINCT halaman), '{}') INTO v_hal
    FROM public.osis_akses WHERE user_id = p_user_id;
  SELECT COALESCE(array_agg(DISTINCT h), '{}') INTO v_jab
    FROM public.jabatan_akses j, unnest(j.halaman) AS h
   WHERE j.jabatan = public.osis_norm_jabatan(v_jabatan)
      OR (j.jabatan = 'sekbid' AND public.osis_norm_jabatan(v_jabatan) LIKE '%sekbid%');

  RETURN jsonb_build_object(
    'halaman', (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM unnest(v_hal || v_jab) AS x),
    'sekbid_id', v_sekbid,
    'sekbid_nama', (SELECT nama FROM public.sekbid WHERE id = v_sekbid),
    'super', v_super,
    'angkatan_id', v_ang_id,
    'angkatan', COALESCE(v_ang, ''),
    'lintas_angkatan', v_lintas
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.angkatan_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF public.osis_id_dari_auth() IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id,
      'kode', a.kode,
      'nama', a.nama,
      'urutan', a.urutan,
      'tahun', a.tahun,
      'aktif', a.aktif,
      'created_at', a.created_at
    ) ORDER BY a.aktif DESC, a.urutan DESC, a.id DESC)
    FROM public.angkatan a
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.angkatan_simpan(
  p_user_id bigint,
  p_id bigint DEFAULT NULL,
  p_kode text DEFAULT '',
  p_nama text DEFAULT '',
  p_urutan integer DEFAULT 0,
  p_tahun integer DEFAULT NULL,
  p_aktif boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin text;
  v_kode  text;
  v_nama  text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;

  SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;

  v_kode := upper(btrim(COALESCE(p_kode, '')));
  v_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF v_kode !~ '^[A-Z0-9_-]{2,40}$' THEN RETURN 'ERR_KODE'; END IF;
  IF v_nama = '' THEN RETURN 'ERR_NO_NAMA'; END IF;
  IF p_tahun IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.periode WHERE tahun = p_tahun) THEN
    RETURN 'ERR_TAHUN';
  END IF;

  IF p_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.angkatan WHERE upper(kode) = v_kode) THEN
      RETURN 'ERR_TAKEN';
    END IF;
    INSERT INTO public.angkatan (kode, nama, urutan, tahun, aktif)
    VALUES (v_kode, v_nama, COALESCE(p_urutan, 0), p_tahun, COALESCE(p_aktif, true));
    RETURN 'OK';
  END IF;

  IF EXISTS (SELECT 1 FROM public.angkatan WHERE upper(kode) = v_kode AND id <> p_id) THEN
    RETURN 'ERR_TAKEN';
  END IF;

  UPDATE public.angkatan
     SET kode = v_kode,
         nama = v_nama,
         urutan = COALESCE(p_urutan, urutan),
         tahun = p_tahun,
         aktif = COALESCE(p_aktif, aktif)
   WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;

  UPDATE public.osis_users SET angkatan = v_nama WHERE angkatan_id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.angkatan_hapus(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;

  SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.angkatan WHERE id = p_id) THEN
    RETURN 'ERR_NOT_FOUND';
  END IF;

  IF EXISTS (SELECT 1 FROM public.osis_users WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.anggota WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.osis_kas WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.osis_saldo_awal WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.osis_tabungan WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.osis_absensi WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.osis_absensi_qr_sesi WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.sekbid_agenda WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.program WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.rapat_notulensi WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.informasi WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.osis_dokumen WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.poster WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.wawancara_calon WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.wawancara_sesi WHERE angkatan_id = p_id)
     OR EXISTS (SELECT 1 FROM public.wawancara_pertanyaan WHERE angkatan_id = p_id) THEN
    RETURN 'ERR_DIPAKAI';
  END IF;

  DELETE FROM public.angkatan WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

-- ================= 4. AKUN OSIS & MATRIKS AKSES =================
DROP FUNCTION IF EXISTS public.osis_user_list(bigint);
CREATE FUNCTION public.osis_user_list(p_user_id bigint, p_angkatan_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL;
  ELSE
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;

  RETURN (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
    SELECT u.id, u.username, u.nama, u.jabatan,
           COALESCE(a.nama, u.angkatan, '') AS angkatan,
           u.angkatan_id,
           u.created_at,
           (u.auth_id IS NOT NULL) AS tertaut,
           (u.auth_id IS NULL AND COALESCE(u.password, '') <> '') AS siap_klaim,
           public.osis_is_super(u.username) AS is_super,
           public.osis_lintas_angkatan(u.id) AS lintas_angkatan,
           public.osis_sekbid_dari_jabatan(u.jabatan) AS sekbid_id,
           (SELECT s.nama FROM public.sekbid s
             WHERE s.id = public.osis_sekbid_dari_jabatan(u.jabatan)) AS sekbid_nama
      FROM public.osis_users u
      LEFT JOIN public.angkatan a ON a.id = u.angkatan_id
     WHERE (p_angkatan_id IS NULL)
        OR (p_angkatan_id = -1 AND u.angkatan_id IS NULL)
        OR (p_angkatan_id > 0 AND u.angkatan_id = p_angkatan_id)
     ORDER BY u.nama
  ) t);
END;
$function$;

DROP FUNCTION IF EXISTS public.akses_matriks(bigint);
CREATE FUNCTION public.akses_matriks(p_admin bigint, p_angkatan_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL;
  ELSE
    p_admin := public.osis_id_dari_auth();
    IF p_admin IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  SELECT username INTO v_admin FROM public.osis_users WHERE id = p_admin;
  IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;

  RETURN (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
    SELECT u.id, u.username, u.nama, u.jabatan,
           COALESCE(ang.nama, u.angkatan, '') AS angkatan,
           u.angkatan_id,
           public.osis_sekbid_dari_jabatan(u.jabatan) AS sekbid_id,
           (SELECT s.nama FROM public.sekbid s WHERE s.id = public.osis_sekbid_dari_jabatan(u.jabatan)) AS sekbid_nama,
           public.osis_is_super(u.username) AS is_super,
           COALESCE((SELECT jsonb_agg(a.halaman ORDER BY a.halaman)
                     FROM public.osis_akses a WHERE a.user_id = u.id), '[]'::jsonb) AS halaman
      FROM public.osis_users u
      LEFT JOIN public.angkatan ang ON ang.id = u.angkatan_id
     WHERE (p_angkatan_id IS NULL)
        OR (p_angkatan_id = -1 AND u.angkatan_id IS NULL)
        OR (p_angkatan_id > 0 AND u.angkatan_id = p_angkatan_id)
     ORDER BY u.nama
  ) t);
END;
$function$;

DROP FUNCTION IF EXISTS public.tambah_osis_user(bigint, text, text, text, text, text);
CREATE FUNCTION public.tambah_osis_user(
  p_user_id bigint,
  p_username text,
  p_nama text,
  p_jabatan text,
  p_angkatan text DEFAULT '',
  p_password text DEFAULT '',
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin    text;
  v_u        text;
  v_n        text;
  v_pw       text;
  v_id       bigint;
  v_ang_id   bigint;
  v_ang_text text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL;
  ELSE
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;

  SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;

  v_u := btrim(COALESCE(p_username, ''));
  v_n := left(btrim(COALESCE(p_nama, '')), 80);
  v_pw := COALESCE(p_password, '');
  IF v_u !~ '^[A-Za-z0-9._-]{3,30}$' THEN RETURN 'ERR_INVALID'; END IF;
  IF v_n = '' THEN RETURN 'ERR_NO_NAMA'; END IF;
  IF length(v_pw) > 100 OR (length(v_pw) > 0 AND length(v_pw) < 6) THEN
    RETURN 'ERR_PASSWORD';
  END IF;
  IF EXISTS (SELECT 1 FROM public.osis_users WHERE lower(username) = lower(v_u))
     OR EXISTS (SELECT 1 FROM public.biasa_users WHERE lower(username) = lower(v_u)) THEN
    RETURN 'ERR_TAKEN';
  END IF;

  IF p_angkatan_id IS NOT NULL THEN
    SELECT nama INTO v_ang_text FROM public.angkatan WHERE id = p_angkatan_id;
    IF NOT FOUND THEN RETURN 'ERR_ANGKATAN'; END IF;
    v_ang_id := p_angkatan_id;
  ELSE
    v_ang_text := left(btrim(COALESCE(p_angkatan, '')), 40);
    IF v_ang_text <> '' AND upper(v_ang_text) <> 'PEMBINA' THEN
      SELECT id, nama INTO v_ang_id, v_ang_text
        FROM public.angkatan
       WHERE upper(btrim(nama)) = upper(v_ang_text)
          OR upper(btrim(kode)) = upper(v_ang_text)
       LIMIT 1;
      IF NOT FOUND THEN
        v_ang_id := NULL;
        v_ang_text := left(btrim(COALESCE(p_angkatan, '')), 40);
      END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(720015);
  SELECT COALESCE(max(id), 0) + 1 INTO v_id FROM public.osis_users;
  INSERT INTO public.osis_users
    (id, username, password, nama, jabatan, angkatan, angkatan_id, sekbid_id)
  VALUES (
    v_id, v_u, v_pw, v_n,
    left(btrim(COALESCE(p_jabatan, '')), 80),
    left(COALESCE(v_ang_text, ''), 40),
    v_ang_id,
    public.osis_sekbid_dari_jabatan(p_jabatan)
  );
  RETURN v_id::text;
END;
$function$;

DROP FUNCTION IF EXISTS public.update_osis_user(bigint, bigint, text, text, text, text, text);
CREATE FUNCTION public.update_osis_user(
  p_user_id bigint,
  p_id bigint,
  p_username text,
  p_nama text,
  p_jabatan text,
  p_angkatan text DEFAULT '',
  p_password text DEFAULT NULL,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin    text;
  v_u        text;
  v_n        text;
  v_lama     text;
  v_tertaut  boolean;
  v_ang_id   bigint;
  v_ang_text text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL;
  ELSE
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;

  SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;

  SELECT username, (auth_id IS NOT NULL) INTO v_lama, v_tertaut
    FROM public.osis_users WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;

  v_u := btrim(COALESCE(p_username, ''));
  v_n := left(btrim(COALESCE(p_nama, '')), 80);
  IF v_u !~ '^[A-Za-z0-9._-]{3,30}$' THEN RETURN 'ERR_INVALID'; END IF;
  IF v_n = '' THEN RETURN 'ERR_NO_NAMA'; END IF;
  IF p_password IS NOT NULL THEN
    IF v_tertaut THEN RETURN 'ERR_LINKED'; END IF;
    IF length(p_password) > 100
       OR (length(p_password) > 0 AND length(p_password) < 6) THEN
      RETURN 'ERR_PASSWORD';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.osis_users WHERE lower(username) = lower(v_u) AND id <> p_id)
     OR EXISTS (SELECT 1 FROM public.biasa_users WHERE lower(username) = lower(v_u)) THEN
    RETURN 'ERR_TAKEN';
  END IF;

  IF p_angkatan_id IS NOT NULL THEN
    SELECT nama INTO v_ang_text FROM public.angkatan WHERE id = p_angkatan_id;
    IF NOT FOUND THEN RETURN 'ERR_ANGKATAN'; END IF;
    v_ang_id := p_angkatan_id;
  ELSE
    v_ang_text := left(btrim(COALESCE(p_angkatan, '')), 40);
    IF v_ang_text <> '' AND upper(v_ang_text) <> 'PEMBINA' THEN
      SELECT id, nama INTO v_ang_id, v_ang_text
        FROM public.angkatan
       WHERE upper(btrim(nama)) = upper(v_ang_text)
          OR upper(btrim(kode)) = upper(v_ang_text)
       LIMIT 1;
      IF NOT FOUND THEN
        v_ang_id := NULL;
        v_ang_text := left(btrim(COALESCE(p_angkatan, '')), 40);
      END IF;
    ELSE
      v_ang_id := NULL;
    END IF;
  END IF;

  UPDATE public.osis_users
     SET username = v_u,
         nama = v_n,
         jabatan = left(btrim(COALESCE(p_jabatan, '')), 80),
         angkatan = left(COALESCE(v_ang_text, ''), 40),
         angkatan_id = v_ang_id,
         sekbid_id = public.osis_sekbid_dari_jabatan(p_jabatan),
         password = CASE WHEN p_password IS NULL THEN password ELSE p_password END
   WHERE id = p_id;

  IF v_lama IS DISTINCT FROM v_u
     AND EXISTS (SELECT 1 FROM public.osis_super_admins WHERE username = v_lama) THEN
    DELETE FROM public.osis_super_admins
     WHERE lower(username) = lower(v_u) AND lower(username) <> lower(v_lama);
    UPDATE public.osis_super_admins SET username = v_u WHERE username = v_lama;
  END IF;
  RETURN 'OK';
END;
$function$;

-- ================= 5. KEUANGAN & SALDO AWAL =================
DROP FUNCTION IF EXISTS public.buat_kas(bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text);
CREATE FUNCTION public.buat_kas(
  p_user_id bigint, p_jenis text, p_tanggal date, p_keterangan text, p_kategori text,
  p_nominal bigint, p_divisi text, p_pic text, p_proker_id bigint, p_agenda_id bigint,
  p_catatan text, p_bukti_path text, p_angkatan_id bigint DEFAULT NULL
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
    proker_id, agenda_id, catatan, bukti_path, created_by, angkatan_id
  ) VALUES (
    p_jenis, COALESCE(p_tanggal, CURRENT_DATE), left(p_keterangan, 200),
    left(COALESCE(p_kategori, ''), 60), p_nominal,
    left(COALESCE(p_divisi, ''), 80), left(COALESCE(p_pic, ''), 120),
    p_proker_id, p_agenda_id, left(COALESCE(p_catatan, ''), 1000),
    left(COALESCE(p_bukti_path, ''), 300), p_user_id, v_ang
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
DECLARE
  v_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'keuangan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.osis_kas WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_nominal IS NOT NULL AND p_nominal <= 0 THEN RETURN 'ERR_NOMINAL'; END IF;
  UPDATE public.osis_kas SET
    jenis = CASE WHEN p_jenis IN ('masuk', 'keluar') THEN p_jenis ELSE jenis END,
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
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_kas(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'keuangan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.osis_kas WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.osis_kas WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.osis_kas_ringkas(bigint, text, text, text, text, text);
CREATE FUNCTION public.osis_kas_ringkas(
  p_user_id bigint,
  p_tahun text DEFAULT NULL,
  p_jenis text DEFAULT NULL,
  p_kategori text DEFAULT NULL,
  p_divisi text DEFAULT NULL,
  p_q text DEFAULT NULL,
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
    SELECT k.jenis, COALESCE(k.nominal, 0) AS nominal, k.proker_id,
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

DROP FUNCTION IF EXISTS public.set_saldo_awal(bigint, text, bigint);
DROP FUNCTION IF EXISTS public.set_saldo_awal(bigint, integer, bigint);
CREATE FUNCTION public.set_saldo_awal(
  p_user_id bigint, p_periode integer, p_nominal bigint, p_angkatan_id bigint DEFAULT NULL
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
  IF NOT public.osis_bisa(p_user_id, 'keuangan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  p_periode := COALESCE(p_periode, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  INSERT INTO public.osis_saldo_awal (angkatan_id, periode, nominal, updated_by, updated_at)
  VALUES (v_ang, p_periode, GREATEST(0, COALESCE(p_nominal, 0)), p_user_id, now())
  ON CONFLICT (angkatan_id, periode) DO UPDATE SET
    nominal = EXCLUDED.nominal,
    updated_by = p_user_id,
    updated_at = now();
  RETURN 'OK';
END;
$function$;

-- ================= 6. TABUNGAN =================
DROP FUNCTION IF EXISTS public.buat_tabungan(bigint, text, date, bigint, text);
CREATE FUNCTION public.buat_tabungan(
  p_user_id bigint, p_nama text, p_tanggal date, p_nominal bigint,
  p_jenis text DEFAULT 'masuk', p_angkatan_id bigint DEFAULT NULL
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
  IF NOT public.osis_bisa(p_user_id, 'tabungan') THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  IF p_tanggal IS NULL THEN RETURN -2; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN -3; END IF;
  IF COALESCE(p_nominal, 0) <= 0 THEN RETURN -4; END IF;
  p_jenis := COALESCE(NULLIF(btrim(p_jenis), ''), 'masuk');
  IF p_jenis NOT IN ('masuk', 'keluar') THEN p_jenis := 'masuk'; END IF;
  INSERT INTO public.osis_tabungan (nama, tanggal, nominal, jenis, created_by, angkatan_id)
  VALUES (p_nama, p_tanggal, p_nominal, p_jenis, p_user_id, v_ang)
  RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_tabungan(
  p_user_id bigint, p_id bigint, p_nama text, p_tanggal date, p_nominal bigint, p_jenis text DEFAULT 'masuk'
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
  IF NOT public.osis_bisa(p_user_id, 'tabungan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.osis_tabungan WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_tanggal IS NULL THEN RETURN 'ERR_NO_TANGGAL'; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN 'ERR_NO_NAMA'; END IF;
  IF COALESCE(p_nominal, 0) <= 0 THEN RETURN 'ERR_NOMINAL'; END IF;
  p_jenis := COALESCE(NULLIF(btrim(p_jenis), ''), 'masuk');
  IF p_jenis NOT IN ('masuk', 'keluar') THEN p_jenis := 'masuk'; END IF;
  UPDATE public.osis_tabungan
     SET nama = p_nama, tanggal = p_tanggal, nominal = p_nominal, jenis = p_jenis, updated_at = now()
   WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_tabungan(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'tabungan') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.osis_tabungan WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.osis_tabungan WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_tabungan_cek(p_user_id bigint, p_id bigint, p_cek boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row_nama text;
  v_row_ang  bigint;
  v_uname    text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL;
  ELSE
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;

  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;

  SELECT nama, angkatan_id INTO v_row_nama, v_row_ang
    FROM public.osis_tabungan WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_row_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;

  IF public.osis_bisa(p_user_id, 'tabungan') THEN
    UPDATE public.osis_tabungan SET cek = COALESCE(p_cek, NOT cek), updated_at = now() WHERE id = p_id;
    RETURN 'OK';
  END IF;

  SELECT btrim(lower(username)) INTO v_uname FROM public.osis_users WHERE id = p_user_id;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT COALESCE(NULLIF(btrim(nama), ''), username, '') AS nm
        FROM public.osis_users WHERE id = p_user_id
      UNION
      SELECT a.nama FROM public.anggota a
       WHERE btrim(lower(a.username)) = v_uname
         AND btrim(COALESCE(a.username, '')) <> ''
         AND a.angkatan_id = v_row_ang
      UNION
      SELECT p.nama FROM public.pengurus p
       WHERE btrim(lower(p.username)) = v_uname
         AND btrim(COALESCE(p.username, '')) <> ''
    ) s
    WHERE btrim(lower(s.nm)) = btrim(lower(COALESCE(v_row_nama, '')))
      AND btrim(COALESCE(s.nm, '')) <> ''
  ) THEN
    UPDATE public.osis_tabungan SET cek = COALESCE(p_cek, NOT cek), updated_at = now() WHERE id = p_id;
    RETURN 'OK';
  END IF;
  RETURN 'ERR_NO_AUTH';
END;
$function$;

-- ================= 7. ABSENSI & QR ABSEN =================
DROP FUNCTION IF EXISTS public.buat_absensi(bigint, date, text, text, text, text);
CREATE FUNCTION public.buat_absensi(
  p_user_id bigint, p_tanggal date, p_nama text, p_status text, p_alasan text,
  p_kegiatan text DEFAULT '', p_angkatan_id bigint DEFAULT NULL
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
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
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
  p_user_id bigint, p_id bigint, p_tanggal date, p_nama text, p_status text, p_alasan text, p_kegiatan text DEFAULT ''
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
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
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
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.osis_absensi WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.anggota_saya(bigint);
CREATE FUNCTION public.anggota_saya(p_user_id bigint, p_angkatan_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r      jsonb;
  v_ang  bigint;
  v_user text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    NULL;
  ELSE
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT btrim(lower(username)) INTO v_user FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND OR COALESCE(v_user, '') = '' THEN RETURN NULL; END IF;

  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  SELECT to_jsonb(a) INTO r
    FROM public.anggota a
   WHERE btrim(lower(a.username)) = v_user
     AND (v_ang IS NULL OR a.angkatan_id = v_ang)
   ORDER BY a.tahun DESC, a.id DESC
   LIMIT 1;
  RETURN r;
END;
$function$;

DROP FUNCTION IF EXISTS public.qr_absen_sesi_buat(bigint, date, text, integer);
CREATE FUNCTION public.qr_absen_sesi_buat(
  p_user_id bigint, p_tanggal date, p_kegiatan text DEFAULT '',
  p_menit integer DEFAULT 120, p_angkatan_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sesi   public.osis_absensi_qr_sesi%ROWTYPE;
  v_secret text;
  v_pay    text;
  v_sig    text;
  v_menit  integer;
  v_ang    bigint;
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
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AUTH');
  END IF;
  IF p_tanggal IS NULL THEN
    RETURN jsonb_build_object('status', 'ERR_NO_TANGGAL');
  END IF;

  v_menit := LEAST(GREATEST(COALESCE(p_menit, 120), 5), 720);

  INSERT INTO public.osis_absensi_qr_sesi
    (tanggal, kegiatan, dibuat_oleh, berakhir_at, kode, angkatan_id)
  VALUES (
    p_tanggal,
    left(btrim(COALESCE(p_kegiatan, '')), 120),
    p_user_id,
    now() + make_interval(mins => v_menit),
    upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10)),
    v_ang
  )
  RETURNING * INTO v_sesi;

  v_secret := (SELECT rahasia FROM public.osis_absensi_qr_rahasia WHERE id = 1);
  v_pay := 'S|' || v_sesi.id::text || '|'
        || (extract(epoch FROM v_sesi.berakhir_at))::bigint::text || '|'
        || v_sesi.kode;
  v_sig := rtrim(translate(encode(extensions.hmac(v_pay, v_secret, 'sha256'), 'base64'), '+/', '-_'), '=');

  RETURN jsonb_build_object(
    'status', 'OK',
    'sesi_id', v_sesi.id,
    'angkatan_id', v_sesi.angkatan_id,
    'token', v_pay || '.' || v_sig,
    'kode', v_sesi.kode,
    'tanggal', v_sesi.tanggal,
    'kegiatan', v_sesi.kegiatan,
    'berakhir_at', v_sesi.berakhir_at,
    'menit', v_menit
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.qr_absen_sesi_ambil(bigint);
CREATE FUNCTION public.qr_absen_sesi_ambil(p_user_id bigint, p_angkatan_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
  v_rows   jsonb := '[]'::jsonb;
  v_pay    text;
  v_sig    text;
  v_ang    bigint;
  r        record;
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
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN
    RETURN jsonb_build_object('status', 'OK', 'sesi', '[]'::jsonb);
  END IF;

  v_secret := (SELECT rahasia FROM public.osis_absensi_qr_rahasia WHERE id = 1);

  FOR r IN
    SELECT s.*,
           (SELECT count(*) FROM public.osis_absensi a
             WHERE a.sesi_qr_id = s.id AND a.status = 'hadir') AS jumlah,
           (SELECT jsonb_agg(jsonb_build_object('nama', a.nama, 'jam', a.created_at)
                             ORDER BY a.created_at)
              FROM public.osis_absensi a
             WHERE a.sesi_qr_id = s.id AND a.status = 'hadir') AS hadir
      FROM public.osis_absensi_qr_sesi s
     WHERE s.dibuat_oleh = p_user_id
       AND s.angkatan_id = v_ang
     ORDER BY s.dibuat_at DESC
     LIMIT 10
  LOOP
    v_pay := 'S|' || r.id::text || '|'
          || (extract(epoch FROM r.berakhir_at))::bigint::text || '|'
          || r.kode;
    v_sig := rtrim(translate(encode(extensions.hmac(v_pay, v_secret, 'sha256'), 'base64'), '+/', '-_'), '=');
    v_rows := v_rows || jsonb_build_object(
      'sesi_id', r.id,
      'angkatan_id', r.angkatan_id,
      'token', v_pay || '.' || v_sig,
      'kode', r.kode,
      'tanggal', r.tanggal,
      'kegiatan', r.kegiatan,
      'berakhir_at', r.berakhir_at,
      'dibuat_at', r.dibuat_at,
      'aktif', r.aktif,
      'jumlah', r.jumlah,
      'hadir', COALESCE(r.hadir, '[]'::jsonb)
    );
  END LOOP;

  RETURN jsonb_build_object('status', 'OK', 'sesi', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.qr_absen_sesi_tutup(p_user_id bigint, p_sesi_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ang bigint;
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

  SELECT angkatan_id INTO v_ang
    FROM public.osis_absensi_qr_sesi
   WHERE id = p_sesi_id AND dibuat_oleh = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ERR_NOT_FOUND');
  END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AKSES');
  END IF;

  UPDATE public.osis_absensi_qr_sesi SET aktif = false WHERE id = p_sesi_id;
  RETURN jsonb_build_object('status', 'OK');
END;
$function$;

CREATE OR REPLACE FUNCTION public.qr_absen_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
  v_pay    text;
  v_sig    text;
  v_expect text;
  v_sesi   public.osis_absensi_qr_sesi%ROWTYPE;
  v_id     bigint;
BEGIN
  IF btrim(COALESCE(p_token, '')) = '' THEN
    RETURN jsonb_build_object('status', 'ERR_TOKEN');
  END IF;

  v_secret := (SELECT rahasia FROM public.osis_absensi_qr_rahasia WHERE id = 1);
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
  IF NOT v_sesi.aktif THEN
    RETURN jsonb_build_object('status', 'ERR_SESI_TUTUP');
  END IF;
  IF v_sesi.berakhir_at < now() THEN
    RETURN jsonb_build_object('status', 'ERR_KEDALUWARSA');
  END IF;

  RETURN jsonb_build_object(
    'status', 'OK',
    'tanggal', v_sesi.tanggal,
    'kegiatan', v_sesi.kegiatan,
    'berakhir_at', v_sesi.berakhir_at,
    'angkatan', COALESCE((SELECT nama FROM public.angkatan WHERE id = v_sesi.angkatan_id), '')
  );
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
  IF NOT public.osis_boleh_angkatan(p_user_id, v_sesi.angkatan_id) THEN
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
  IF v_user.angkatan_id IS NOT NULL AND v_user.angkatan_id IS DISTINCT FROM v_sesi.angkatan_id THEN
    RETURN jsonb_build_object('status', 'ERR_BEDA_ANGKATAN');
  END IF;

  SELECT to_jsonb(a) INTO v_anggota
    FROM public.anggota a
   WHERE btrim(lower(a.username)) = btrim(lower(COALESCE(v_user.username, '')))
     AND btrim(COALESCE(a.username, '')) <> ''
   ORDER BY (a.angkatan_id = v_sesi.angkatan_id) DESC, a.tahun DESC, a.id DESC
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
   WHERE angkatan_id = v_sesi.angkatan_id
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
     'qr', v_user.id, 'osis', v_sesi.id, v_sesi.angkatan_id);

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

CREATE OR REPLACE FUNCTION public.qr_absen_daftar(p_token text, p_kode text DEFAULT '')
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
  IF v_user.angkatan_id IS NOT NULL AND v_user.angkatan_id IS DISTINCT FROM v_sesi.angkatan_id THEN
    RETURN jsonb_build_object('status', 'ERR_BEDA_ANGKATAN');
  END IF;

  SELECT to_jsonb(a) INTO v_anggota
    FROM public.anggota a
   WHERE btrim(lower(a.username)) = btrim(lower(COALESCE(v_user.username, '')))
     AND btrim(COALESCE(a.username, '')) <> ''
   ORDER BY (a.angkatan_id = v_sesi.angkatan_id) DESC, a.tahun DESC, a.id DESC
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
   WHERE angkatan_id = v_sesi.angkatan_id
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
     'qr', v_user.id, 'osis', v_sesi.id, v_sesi.angkatan_id);

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

-- ================= 8. AGENDA, PROGRAM, NOTULENSI, INFORMASI =================
DROP FUNCTION IF EXISTS public.buat_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text);
CREATE FUNCTION public.buat_agenda(
  p_user_id bigint, p_sekbid_id bigint, p_judul text, p_deskripsi text, p_tanggal date,
  p_lokasi text, p_status text, p_fotos jsonb,
  p_display_order integer DEFAULT 99, p_pelaksana text DEFAULT '',
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
  IF NOT public.osis_bisa_agenda(p_user_id, p_sekbid_id) THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  p_judul := COALESCE(NULLIF(btrim(p_judul), ''), '');
  IF p_judul = '' THEN RETURN -2; END IF;
  IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' THEN p_fotos := '[]'::jsonb; END IF;
  p_status := COALESCE(NULLIF(btrim(p_status), ''), 'Terlaksana');
  INSERT INTO public.sekbid_agenda
    (sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, created_by, angkatan_id)
  VALUES (
    p_sekbid_id, left(p_judul, 80), left(COALESCE(p_deskripsi, ''), 500),
    COALESCE(p_tanggal, CURRENT_DATE), left(COALESCE(p_lokasi, ''), 80),
    p_status, p_fotos, p_user_id, v_ang
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_agenda(
  p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text, p_tanggal date,
  p_lokasi text, p_status text, p_fotos jsonb,
  p_display_order integer DEFAULT 99, p_pelaksana text DEFAULT ''
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sekbid bigint;
  v_ang    bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT sekbid_id, angkatan_id INTO v_sekbid, v_ang FROM public.sekbid_agenda WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_bisa_agenda(p_user_id, v_sekbid)
     OR NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  UPDATE public.sekbid_agenda
     SET judul = left(COALESCE(NULLIF(btrim(p_judul), judul), judul), 80),
         deskripsi = left(COALESCE(p_deskripsi, deskripsi), 500),
         tanggal = COALESCE(p_tanggal, tanggal),
         lokasi = left(COALESCE(p_lokasi, lokasi), 80),
         status = COALESCE(NULLIF(btrim(p_status), status), status),
         fotos = COALESCE(p_fotos, fotos)
   WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_agenda(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sekbid bigint;
  v_ang    bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT sekbid_id, angkatan_id INTO v_sekbid, v_ang FROM public.sekbid_agenda WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_bisa_agenda(p_user_id, v_sekbid)
     OR NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  DELETE FROM public.sekbid_agenda WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.sekbid_agenda_ringkas(bigint, bigint, text);
CREATE FUNCTION public.sekbid_agenda_ringkas(
  p_user_id bigint,
  p_sekbid_id bigint DEFAULT NULL,
  p_nama text DEFAULT NULL,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bln text := to_char(CURRENT_DATE, 'YYYY-MM');
  v_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'total', COUNT(*) FILTER (WHERE p_nama IS NULL OR btrim(pengunggah) = btrim(p_nama)),
      'bulan_ini', COUNT(*) FILTER (WHERE left(tanggal::text, 7) = v_bln AND (p_nama IS NULL OR btrim(pengunggah) = btrim(p_nama))),
      'n_sekbid', COUNT(DISTINCT sekbid_id) FILTER (WHERE p_nama IS NULL OR btrim(pengunggah) = btrim(p_nama)),
      'n_orang', COUNT(DISTINCT NULLIF(btrim(pengunggah), '')) FILTER (WHERE p_nama IS NULL OR btrim(pengunggah) = btrim(p_nama))
    )
    FROM public.sekbid_agenda
    WHERE angkatan_id = v_ang
      AND (p_sekbid_id IS NULL OR sekbid_id = p_sekbid_id)
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.buat_program(bigint, bigint, text, text, text, text, date, date, text, text, text, integer, text);
CREATE FUNCTION public.buat_program(
  p_user_id bigint, p_sekbid_id bigint, p_tipe text, p_nama text, p_deskripsi text,
  p_pj text, p_tgl_mulai date, p_tgl_selesai date, p_lokasi text, p_target_peserta text,
  p_status text, p_progress integer, p_catatan text, p_angkatan_id bigint DEFAULT NULL
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
  IF NOT public.osis_bisa_program(p_user_id, p_sekbid_id) THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  IF p_sekbid_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sekbid WHERE id = p_sekbid_id) THEN RETURN -2; END IF;
  IF p_tipe NOT IN ('tahunan', 'bulanan') THEN RETURN -1; END IF;
  p_nama := left(COALESCE(NULLIF(btrim(p_nama), ''), 'Tanpa Nama'), 120);
  p_deskripsi := left(COALESCE(p_deskripsi, ''), 1000);
  p_pj := left(COALESCE(p_pj, ''), 80);
  p_lokasi := left(COALESCE(p_lokasi, ''), 80);
  p_target_peserta := left(COALESCE(p_target_peserta, ''), 80);
  p_status := COALESCE(NULLIF(btrim(p_status), ''), 'rencana');
  IF p_status NOT IN ('rencana', 'berjalan', 'selesai', 'batal') THEN p_status := 'rencana'; END IF;
  p_progress := GREATEST(0, LEAST(100, COALESCE(p_progress, 0)));
  p_catatan := left(COALESCE(p_catatan, ''), 2000);
  INSERT INTO public.program (
    sekbid_id, tipe, nama, deskripsi, pj, tgl_mulai, tgl_selesai,
    lokasi, target_peserta, status, progress, catatan, created_by, angkatan_id
  ) VALUES (
    p_sekbid_id, p_tipe, p_nama, p_deskripsi, p_pj, p_tgl_mulai, p_tgl_selesai,
    p_lokasi, p_target_peserta, p_status, p_progress, p_catatan, p_user_id, v_ang
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_program(
  p_user_id bigint, p_id bigint, p_sekbid_id bigint, p_tipe text, p_nama text,
  p_deskripsi text, p_pj text, p_tgl_mulai date, p_tgl_selesai date, p_lokasi text,
  p_target_peserta text, p_status text, p_progress integer, p_catatan text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sekbid bigint;
  v_ang    bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT sekbid_id, angkatan_id INTO v_sekbid, v_ang FROM public.program WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_bisa_program(p_user_id, v_sekbid)
     OR NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  IF p_sekbid_id IS NOT NULL AND NOT public.osis_bisa_program(p_user_id, p_sekbid_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  UPDATE public.program SET
    sekbid_id = COALESCE(p_sekbid_id, sekbid_id),
    tipe = COALESCE(p_tipe, tipe),
    nama = left(COALESCE(NULLIF(btrim(p_nama), nama), nama), 120),
    deskripsi = left(COALESCE(p_deskripsi, deskripsi), 1000),
    pj = left(COALESCE(p_pj, pj), 80),
    tgl_mulai = COALESCE(p_tgl_mulai, tgl_mulai),
    tgl_selesai = COALESCE(p_tgl_selesai, tgl_selesai),
    lokasi = left(COALESCE(p_lokasi, lokasi), 80),
    target_peserta = left(COALESCE(p_target_peserta, target_peserta), 80),
    status = COALESCE(NULLIF(btrim(p_status), status), status),
    progress = GREATEST(0, LEAST(100, COALESCE(p_progress, progress))),
    catatan = left(COALESCE(p_catatan, catatan), 2000)
  WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_program(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sekbid bigint;
  v_ang    bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT sekbid_id, angkatan_id INTO v_sekbid, v_ang FROM public.program WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_bisa_program(p_user_id, v_sekbid)
     OR NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  DELETE FROM public.program WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.buat_notulensi(bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text);
CREATE FUNCTION public.buat_notulensi(
  p_user_id bigint, p_judul text, p_tanggal date, p_waktu_mulai text, p_waktu_selesai text,
  p_lokasi text, p_divisi text, p_pimpinan text, p_notulis text, p_peserta text,
  p_agenda_topik text, p_isi_pembahasan text, p_keputusan text,
  p_tindak_lanjut jsonb, p_lampiran jsonb, p_status text,
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
  IF NOT public.osis_bisa(p_user_id, 'notulensi') THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  p_judul := COALESCE(NULLIF(btrim(p_judul), ''), '');
  IF p_judul = '' THEN RETURN -2; END IF;
  IF p_tindak_lanjut IS NULL OR jsonb_typeof(p_tindak_lanjut) <> 'array' THEN p_tindak_lanjut := '[]'::jsonb; END IF;
  IF p_lampiran IS NULL OR jsonb_typeof(p_lampiran) <> 'array' THEN p_lampiran := '[]'::jsonb; END IF;
  p_status := COALESCE(NULLIF(btrim(p_status), ''), 'Draft');
  INSERT INTO public.rapat_notulensi (
    judul, tanggal, waktu_mulai, waktu_selesai, lokasi, divisi,
    pimpinan, notulis, peserta, agenda_topik, isi_pembahasan,
    keputusan, tindak_lanjut, lampiran, status, created_by, angkatan_id
  ) VALUES (
    left(p_judul, 160), COALESCE(p_tanggal, CURRENT_DATE),
    left(COALESCE(p_waktu_mulai, ''), 20), left(COALESCE(p_waktu_selesai, ''), 20),
    left(COALESCE(p_lokasi, ''), 120), left(COALESCE(p_divisi, ''), 80),
    left(COALESCE(p_pimpinan, ''), 120), left(COALESCE(p_notulis, ''), 120),
    left(COALESCE(p_peserta, ''), 4000), left(COALESCE(p_agenda_topik, ''), 4000),
    left(COALESCE(p_isi_pembahasan, ''), 8000), left(COALESCE(p_keputusan, ''), 8000),
    p_tindak_lanjut, p_lampiran, p_status, p_user_id, v_ang
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
DECLARE
  v_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'notulensi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.rapat_notulensi WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_tindak_lanjut IS NOT NULL AND jsonb_typeof(p_tindak_lanjut) <> 'array' THEN p_tindak_lanjut := '[]'::jsonb; END IF;
  IF p_lampiran IS NOT NULL AND jsonb_typeof(p_lampiran) <> 'array' THEN p_lampiran := '[]'::jsonb; END IF;
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
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_notulensi(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'notulensi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.rapat_notulensi WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.rapat_notulensi WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.buat_informasi(bigint, text, text, text, text, text, text, text, text, text);
CREATE FUNCTION public.buat_informasi(
  p_user_id bigint, p_judul text, p_subjudul text DEFAULT '', p_kepada text DEFAULT '',
  p_pembuka text DEFAULT '', p_tanggal text DEFAULT '', p_jam text DEFAULT '',
  p_tempat text DEFAULT '', p_bawaan text DEFAULT '', p_penutup text DEFAULT '',
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  new_id bigint;
  v_ang  bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'informasi') THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  IF p_judul IS NULL OR btrim(p_judul) = '' THEN RETURN -2; END IF;
  INSERT INTO public.informasi
    (judul, subjudul, kepada, pembuka, tanggal, jam, tempat, bawaan, penutup, created_by, angkatan_id)
  VALUES (
    left(btrim(p_judul), 80), left(COALESCE(p_subjudul, ''), 80),
    left(COALESCE(p_kepada, ''), 200), left(COALESCE(p_pembuka, ''), 2000),
    left(COALESCE(p_tanggal, ''), 80), left(COALESCE(p_jam, ''), 80),
    left(COALESCE(p_tempat, ''), 200), left(COALESCE(p_bawaan, ''), 200),
    left(COALESCE(p_penutup, ''), 2000), p_user_id, v_ang
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_informasi(
  p_user_id bigint, p_id bigint, p_judul text, p_subjudul text DEFAULT NULL,
  p_kepada text DEFAULT NULL, p_pembuka text DEFAULT NULL, p_tanggal text DEFAULT NULL,
  p_jam text DEFAULT NULL, p_tempat text DEFAULT NULL, p_bawaan text DEFAULT NULL,
  p_penutup text DEFAULT NULL
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
  IF NOT public.osis_bisa(p_user_id, 'informasi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.informasi WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.informasi SET
    judul = left(COALESCE(NULLIF(btrim(p_judul), ''), judul), 80),
    subjudul = CASE WHEN p_subjudul IS NULL THEN subjudul ELSE left(p_subjudul, 80) END,
    kepada = CASE WHEN p_kepada IS NULL THEN kepada ELSE left(p_kepada, 200) END,
    pembuka = CASE WHEN p_pembuka IS NULL THEN pembuka ELSE left(p_pembuka, 2000) END,
    tanggal = CASE WHEN p_tanggal IS NULL THEN tanggal ELSE left(p_tanggal, 80) END,
    jam = CASE WHEN p_jam IS NULL THEN jam ELSE left(p_jam, 80) END,
    tempat = CASE WHEN p_tempat IS NULL THEN tempat ELSE left(p_tempat, 200) END,
    bawaan = CASE WHEN p_bawaan IS NULL THEN bawaan ELSE left(p_bawaan, 200) END,
    penutup = CASE WHEN p_penutup IS NULL THEN penutup ELSE left(p_penutup, 2000) END
  WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_informasi(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'informasi') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.informasi WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.informasi WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

-- ================= 9. DOKUMEN, POSTER, ANGGOTA =================
DROP FUNCTION IF EXISTS public.buat_dokumen(bigint, text, text, text, text, text, text, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.buat_dokumen(bigint, text, text, integer, text, text, text, text, text, bigint, text);
CREATE FUNCTION public.buat_dokumen(
  p_user_id bigint, p_nama text, p_kategori text, p_tahun integer, p_divisi text,
  p_deskripsi text, p_file_path text, p_file_type text, p_mime text,
  p_ukuran_bytes bigint, p_pengunggah text, p_angkatan_id bigint DEFAULT NULL
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
  IF NOT public.osis_bisa(p_user_id, 'dokumen') THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  p_nama := COALESCE(NULLIF(btrim(p_nama), ''), '');
  p_file_path := COALESCE(NULLIF(btrim(p_file_path), ''), '');
  IF p_nama = '' OR p_file_path = '' THEN RETURN -2; END IF;
  INSERT INTO public.osis_dokumen (
    nama, kategori, tahun, divisi, deskripsi,
    file_path, file_type, mime, ukuran_bytes, pengunggah, created_by, angkatan_id
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
    p_user_id, v_ang
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

DROP FUNCTION IF EXISTS public.update_dokumen(bigint, bigint, text, text, text, text, text, text, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.update_dokumen(bigint, bigint, text, text, integer, text, text, text, text, text, bigint, text);
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
DECLARE
  v_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'dokumen') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.osis_dokumen WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
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
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_dokumen(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'dokumen') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.osis_dokumen WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.osis_dokumen WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.buat_poster(bigint, text, text, text);
CREATE FUNCTION public.buat_poster(
  p_user_id bigint, p_judul text, p_caption text, p_foto text, p_angkatan_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  new_id bigint;
  v_ang  bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'poster') THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  p_caption := COALESCE(p_caption, '');
  IF btrim(p_caption) = '' AND btrim(COALESCE(p_judul, '')) = '' THEN RETURN -2; END IF;
  IF p_foto IS NULL OR btrim(p_foto) = '' THEN RETURN -3; END IF;
  INSERT INTO public.poster (judul, caption, foto, created_by, angkatan_id)
  VALUES (
    left(COALESCE(NULLIF(btrim(p_judul), ''), ''), 80),
    left(p_caption, 500),
    left(btrim(p_foto), 300),
    p_user_id,
    v_ang
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_poster(
  p_user_id bigint, p_id bigint, p_judul text, p_caption text, p_foto text
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
  IF NOT public.osis_bisa(p_user_id, 'poster') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.poster WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.poster SET
    judul = left(COALESCE(NULLIF(btrim(p_judul), judul), judul), 80),
    caption = left(COALESCE(p_caption, caption), 500),
    foto = left(COALESCE(NULLIF(btrim(p_foto), ''), foto), 300)
  WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_poster(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'poster') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.poster WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.poster WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.tambah_anggota(bigint, integer, text, text, text, text);
CREATE FUNCTION public.tambah_anggota(
  p_user_id bigint, p_tahun integer, p_nama text, p_jabatan text DEFAULT '',
  p_kelas text DEFAULT '', p_username text DEFAULT '', p_angkatan_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  nid      bigint;
  v_ang    bigint;
  v_tahun  integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'anggota') THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  IF COALESCE(NULLIF(btrim(p_nama), ''), '') = '' THEN RETURN -2; END IF;
  SELECT COALESCE(p_tahun, a.tahun, EXTRACT(YEAR FROM CURRENT_DATE)::integer)
    INTO v_tahun
    FROM public.angkatan a
   WHERE a.id = v_ang;
  INSERT INTO public.anggota (tahun, nama, jabatan, kelas, username, angkatan_id)
  VALUES (
    v_tahun,
    left(btrim(p_nama), 80),
    left(COALESCE(btrim(p_jabatan), ''), 80),
    left(COALESCE(btrim(p_kelas), ''), 40),
    left(COALESCE(btrim(p_username), ''), 60),
    v_ang
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_anggota(
  p_user_id bigint, p_id bigint, p_nama text, p_jabatan text,
  p_kelas text DEFAULT NULL, p_username text DEFAULT NULL
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
  IF NOT public.osis_bisa(p_user_id, 'anggota') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.anggota WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.anggota SET
    nama = left(COALESCE(NULLIF(btrim(p_nama), ''), nama), 80),
    jabatan = left(COALESCE(p_jabatan, jabatan), 80),
    kelas = left(COALESCE(p_kelas, kelas), 40),
    username = left(COALESCE(p_username, username), 60)
  WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_anggota(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'anggota') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.anggota WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.anggota WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

-- ================= 10. WAWANCARA (SESI, PERTANYAAN, JAWABAN, HASIL) =================
CREATE OR REPLACE FUNCTION public.wawancara_boleh(p_user_id bigint, p_sesi_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_username text;
  v_sesi_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN false; END IF;
  END IF;
  IF p_user_id IS NULL OR p_sesi_id IS NULL THEN RETURN false; END IF;
  SELECT username INTO v_username FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT angkatan_id INTO v_sesi_ang FROM public.wawancara_sesi WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_sesi_ang) THEN RETURN false; END IF;
  IF public.osis_is_super(v_username) THEN RETURN true; END IF;
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

CREATE OR REPLACE FUNCTION public.wawancara_turunan_boleh(p_user_id bigint, p_sesi_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sesi_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN false; END IF;
  END IF;
  IF p_user_id IS NULL OR p_sesi_id IS NULL THEN RETURN false; END IF;
  SELECT angkatan_id INTO v_sesi_ang FROM public.wawancara_sesi WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_sesi_ang) THEN RETURN false; END IF;
  IF public.osis_bisa(p_user_id, 'wawancara') THEN RETURN true; END IF;
  RETURN public.wawancara_boleh(p_user_id, p_sesi_id);
END;
$function$;

DROP FUNCTION IF EXISTS public.wawancara_calon_tambah(bigint, text, text, text, integer, date);
CREATE FUNCTION public.wawancara_calon_tambah(
  p_user_id bigint, p_nama text, p_kelas text DEFAULT '', p_keterangan text DEFAULT '',
  p_order integer DEFAULT 99, p_tanggal date DEFAULT NULL, p_angkatan_id bigint DEFAULT NULL
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
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN -1; END IF;
  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN RETURN -1; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN -2; END IF;
  INSERT INTO public.wawancara_calon
    (nama, kelas, keterangan, tanggal, display_order, created_by, angkatan_id)
  VALUES (
    p_nama, left(btrim(COALESCE(p_kelas, '')), 40),
    left(COALESCE(p_keterangan, ''), 500), p_tanggal, COALESCE(p_order, 99),
    p_user_id, v_ang
  ) RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_calon_ubah(
  p_user_id bigint, p_id bigint, p_nama text, p_kelas text DEFAULT NULL,
  p_keterangan text DEFAULT NULL, p_order integer DEFAULT NULL, p_tanggal date DEFAULT NULL
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
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.wawancara_calon WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN 'ERR_KOSONG'; END IF;
  UPDATE public.wawancara_calon SET
    nama = p_nama,
    kelas = CASE WHEN p_kelas IS NULL THEN kelas ELSE left(btrim(p_kelas), 40) END,
    keterangan = CASE WHEN p_keterangan IS NULL THEN keterangan ELSE left(p_keterangan, 500) END,
    tanggal = p_tanggal,
    display_order = COALESCE(p_order, display_order),
    updated_at = now()
  WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_calon_hapus(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.wawancara_calon WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.wawancara_calon WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_sesi_pastikan(p_user_id bigint, p_calon_id bigint)
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
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN -1;
  END IF;
  SELECT angkatan_id INTO v_ang FROM public.wawancara_calon WHERE id = p_calon_id;
  IF NOT FOUND THEN RETURN -2; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN -1; END IF;
  SELECT id INTO nid FROM public.wawancara_sesi WHERE calon_id = p_calon_id;
  IF FOUND THEN RETURN nid; END IF;
  INSERT INTO public.wawancara_sesi (calon_id, status, created_by, angkatan_id)
  VALUES (p_calon_id, 'belum', p_user_id, v_ang)
  RETURNING id INTO nid;
  RETURN nid;
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
  v_id       bigint;
  v_arr      bigint[] := '{}';
  v_sesi_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_sesi_ang FROM public.wawancara_sesi WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_sesi_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;

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
DECLARE
  v_sesi_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_sesi_ang FROM public.wawancara_sesi WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_sesi_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_pewawancara1_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_pewawancara1_id) THEN RETURN 'ERR_PETUGAS'; END IF;
  IF p_pewawancara2_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_pewawancara2_id) THEN RETURN 'ERR_PETUGAS'; END IF;
  UPDATE public.wawancara_sesi SET
    pewawancara1_id = p_pewawancara1_id,
    pewawancara2_id = p_pewawancara2_id,
    updated_at = now()
  WHERE id = p_sesi_id;
  DELETE FROM public.wawancara_sesi_petugas WHERE sesi_id = p_sesi_id;
  INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
  SELECT p_sesi_id, v FROM unnest(ARRAY[p_pewawancara1_id, p_pewawancara2_id]) AS v
  WHERE v IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_urutan_pastikan(p_user_id bigint, p_sesi_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sesi_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  SELECT angkatan_id INTO v_sesi_ang FROM public.wawancara_sesi WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_sesi_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;

  INSERT INTO public.wawancara_urutan (sesi_id, pertanyaan_id, urutan)
  SELECT p_sesi_id, p.id, p.urutan
    FROM public.wawancara_pertanyaan p
   WHERE p.aktif
     AND p.angkatan_id = v_sesi_ang
     AND NOT EXISTS (
       SELECT 1 FROM public.wawancara_urutan u
        WHERE u.sesi_id = p_sesi_id AND u.pertanyaan_id = p.id
     );
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_urutan_atur(p_user_id bigint, p_sesi_id bigint, p_ids bigint[])
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i          integer := 0;
  qid        bigint;
  v_sesi_ang bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  SELECT angkatan_id INTO v_sesi_ang FROM public.wawancara_sesi WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_sesi_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF NOT public.osis_bisa(p_user_id, 'wawancara')
     AND NOT public.wawancara_boleh(p_user_id, p_sesi_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  PERFORM public.wawancara_urutan_pastikan(p_user_id, p_sesi_id);
  FOREACH qid IN ARRAY COALESCE(p_ids, '{}') LOOP
    i := i + 1;
    UPDATE public.wawancara_urutan SET urutan = i * 10
     WHERE sesi_id = p_sesi_id AND pertanyaan_id = qid;
  END LOOP;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.wawancara_pertanyaan_simpan(bigint, bigint, text, bigint, integer, boolean);
CREATE FUNCTION public.wawancara_pertanyaan_simpan(
  p_user_id bigint, p_id bigint, p_teks text,
  p_parent_id bigint DEFAULT NULL, p_urutan integer DEFAULT NULL,
  p_aktif boolean DEFAULT NULL, p_angkatan_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  nid        bigint;
  v_urut     integer;
  v_ang      bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN -1; END IF;
  p_teks := left(btrim(COALESCE(p_teks, '')), 500);
  IF p_teks = '' THEN RETURN -2; END IF;

  IF p_id IS NULL THEN
    v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
    IF v_ang IS NULL THEN RETURN -1; END IF;
    IF p_parent_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.wawancara_pertanyaan
         WHERE id = p_parent_id AND parent_id IS NULL AND angkatan_id = v_ang
      ) THEN RETURN -3; END IF;
    END IF;
    SELECT COALESCE(MAX(urutan), 0) + 10 INTO v_urut
      FROM public.wawancara_pertanyaan
     WHERE angkatan_id = v_ang
       AND COALESCE(parent_id, -1) = COALESCE(p_parent_id, -1);
    INSERT INTO public.wawancara_pertanyaan (teks, urutan, parent_id, aktif, created_by, angkatan_id)
    VALUES (p_teks, COALESCE(p_urutan, v_urut), p_parent_id, COALESCE(p_aktif, true), p_user_id, v_ang)
    RETURNING id INTO nid;
    RETURN nid;
  END IF;

  SELECT angkatan_id INTO v_ang FROM public.wawancara_pertanyaan WHERE id = p_id;
  IF NOT FOUND THEN RETURN -4; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN -1; END IF;
  IF p_parent_id IS NOT NULL THEN
    IF p_parent_id = p_id THEN RETURN -3; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.wawancara_pertanyaan
       WHERE id = p_parent_id AND parent_id IS NULL AND angkatan_id = v_ang
    ) THEN RETURN -3; END IF;
  END IF;

  UPDATE public.wawancara_pertanyaan SET
    teks = p_teks,
    urutan = COALESCE(p_urutan, urutan),
    aktif = COALESCE(p_aktif, aktif),
    updated_at = now()
  WHERE id = p_id;
  RETURN p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_pertanyaan_hapus(p_user_id bigint, p_id bigint)
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
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.wawancara_pertanyaan WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  DELETE FROM public.wawancara_pertanyaan WHERE id = p_id;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_pertanyaan_penting(p_user_id bigint, p_id bigint, p_penting boolean)
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
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.wawancara_pertanyaan WHERE id = p_id AND parent_id IS NULL;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;
  UPDATE public.wawancara_pertanyaan SET penting = COALESCE(p_penting, false), updated_at = now()
   WHERE id = p_id AND parent_id IS NULL;
  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_pertanyaan_salin(
  p_user_id bigint,
  p_dari_angkatan_id bigint,
  p_ke_angkatan_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target   bigint;
  v_disalin  integer := 0;
  v_dilewati integer := 0;
  v_max_urut integer;
  v_dest_pid bigint;
  v_dest_cid bigint;
  v_sub_urut integer;
  r          record;
  c          record;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN jsonb_build_object('error', 'ERR_NO_AUTH'); END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;

  v_target := public.osis_target_angkatan(p_user_id, p_ke_angkatan_id);
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;
  IF p_dari_angkatan_id IS NULL OR p_dari_angkatan_id = v_target
     OR NOT EXISTS (SELECT 1 FROM public.angkatan WHERE id = p_dari_angkatan_id) THEN
    RETURN jsonb_build_object('error', 'ERR_ANGKATAN');
  END IF;

  SELECT COALESCE(MAX(urutan), 0) INTO v_max_urut
    FROM public.wawancara_pertanyaan
   WHERE angkatan_id = v_target AND parent_id IS NULL;

  FOR r IN
    SELECT * FROM public.wawancara_pertanyaan
     WHERE angkatan_id = p_dari_angkatan_id AND parent_id IS NULL AND aktif
     ORDER BY urutan ASC, id ASC
  LOOP
    SELECT id INTO v_dest_pid
      FROM public.wawancara_pertanyaan
     WHERE angkatan_id = v_target
       AND parent_id IS NULL
       AND lower(btrim(teks)) = lower(btrim(r.teks))
     LIMIT 1;

    IF v_dest_pid IS NULL THEN
      v_max_urut := v_max_urut + 10;
      INSERT INTO public.wawancara_pertanyaan
        (teks, urutan, parent_id, aktif, penting, created_by, angkatan_id)
      VALUES (r.teks, v_max_urut, NULL, true, COALESCE(r.penting, false), p_user_id, v_target)
      RETURNING id INTO v_dest_pid;
      v_disalin := v_disalin + 1;
    ELSE
      v_dilewati := v_dilewati + 1;
    END IF;

    SELECT COALESCE(MAX(urutan), 0) INTO v_sub_urut
      FROM public.wawancara_pertanyaan
     WHERE angkatan_id = v_target AND parent_id = v_dest_pid;

    FOR c IN
      SELECT * FROM public.wawancara_pertanyaan
       WHERE angkatan_id = p_dari_angkatan_id AND parent_id = r.id AND aktif
       ORDER BY urutan ASC, id ASC
    LOOP
      SELECT id INTO v_dest_cid
        FROM public.wawancara_pertanyaan
       WHERE angkatan_id = v_target
         AND parent_id = v_dest_pid
         AND lower(btrim(teks)) = lower(btrim(c.teks))
       LIMIT 1;

      IF v_dest_cid IS NULL THEN
        v_sub_urut := v_sub_urut + 10;
        INSERT INTO public.wawancara_pertanyaan
          (teks, urutan, parent_id, aktif, created_by, angkatan_id)
        VALUES (c.teks, v_sub_urut, v_dest_pid, true, p_user_id, v_target);
        v_disalin := v_disalin + 1;
      ELSE
        v_dilewati := v_dilewati + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'disalin', v_disalin, 'dilewati', v_dilewati);
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_jawaban_simpan(
  p_user_id bigint, p_sesi_id bigint, p_pertanyaan_id bigint DEFAULT NULL,
  p_pertanyaan_teks text DEFAULT '', p_jawaban_teks text DEFAULT '',
  p_is_spontan boolean DEFAULT false, p_jawaban_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_calon    bigint;
  v_sesi_ang bigint;
  nid        bigint;
  v_snap     text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;

  IF NOT public.wawancara_boleh(p_user_id, p_sesi_id) THEN RETURN -1; END IF;
  SELECT calon_id, angkatan_id INTO v_calon, v_sesi_ang FROM public.wawancara_sesi WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN -2; END IF;
  p_jawaban_teks := left(COALESCE(p_jawaban_teks, ''), 5000);

  IF p_jawaban_id IS NOT NULL THEN
    IF COALESCE(p_is_spontan, false) THEN
      p_pertanyaan_teks := left(btrim(COALESCE(p_pertanyaan_teks, '')), 500);
      IF p_pertanyaan_teks = '' THEN RETURN -3; END IF;
      UPDATE public.wawancara_jawaban SET
        pertanyaan_teks = p_pertanyaan_teks, jawaban_teks = p_jawaban_teks,
        updated_by = p_user_id, updated_at = now()
      WHERE id = p_jawaban_id AND sesi_id = p_sesi_id AND is_spontan;
    ELSE
      UPDATE public.wawancara_jawaban SET
        jawaban_teks = p_jawaban_teks, updated_by = p_user_id, updated_at = now()
      WHERE id = p_jawaban_id AND sesi_id = p_sesi_id AND NOT is_spontan;
    END IF;
    IF NOT FOUND THEN RETURN -2; END IF;
    RETURN p_jawaban_id;
  END IF;

  IF COALESCE(p_is_spontan, false) THEN
    p_pertanyaan_teks := left(btrim(COALESCE(p_pertanyaan_teks, '')), 500);
    IF p_pertanyaan_teks = '' THEN RETURN -3; END IF;
    INSERT INTO public.wawancara_jawaban
      (sesi_id, calon_id, pertanyaan_id, pertanyaan_teks, jawaban_teks, is_spontan, updated_by)
    VALUES (p_sesi_id, v_calon, NULL, p_pertanyaan_teks, p_jawaban_teks, true, p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
  END IF;

  IF p_pertanyaan_id IS NULL THEN RETURN -3; END IF;
  SELECT left(teks, 500) INTO v_snap
    FROM public.wawancara_pertanyaan
   WHERE id = p_pertanyaan_id AND angkatan_id = v_sesi_ang;
  IF NOT FOUND THEN RETURN -4; END IF;
  INSERT INTO public.wawancara_jawaban
    (sesi_id, calon_id, pertanyaan_id, pertanyaan_teks, jawaban_teks, is_spontan, updated_by)
  VALUES (p_sesi_id, v_calon, p_pertanyaan_id, v_snap, p_jawaban_teks, false, p_user_id)
  ON CONFLICT (sesi_id, pertanyaan_id) DO UPDATE SET
    jawaban_teks = EXCLUDED.jawaban_teks,
    pertanyaan_teks = EXCLUDED.pertanyaan_teks,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_turunan_tambah(
  p_user_id bigint, p_sesi_id bigint, p_parent_id bigint, p_teks text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  nid        bigint;
  v_calon    bigint;
  v_sesi_ang bigint;
  v_urut     integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;

  IF NOT public.wawancara_turunan_boleh(p_user_id, p_sesi_id) THEN RETURN -1; END IF;
  SELECT calon_id, angkatan_id INTO v_calon, v_sesi_ang FROM public.wawancara_sesi WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN -2; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wawancara_pertanyaan
     WHERE id = p_parent_id AND parent_id IS NULL AND angkatan_id = v_sesi_ang
  ) THEN RETURN -3; END IF;
  p_teks := left(btrim(COALESCE(p_teks, '')), 500);
  IF p_teks = '' THEN RETURN -4; END IF;
  SELECT COALESCE(MAX(urutan), 0) + 10 INTO v_urut
    FROM public.wawancara_turunan
   WHERE sesi_id = p_sesi_id AND parent_id = p_parent_id;
  INSERT INTO public.wawancara_turunan (sesi_id, calon_id, parent_id, teks, urutan, updated_by)
  VALUES (p_sesi_id, v_calon, p_parent_id, p_teks, v_urut, p_user_id)
  RETURNING id INTO nid;
  RETURN nid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wawancara_hasil_simpan(
  p_user_id bigint, p_calon_id bigint, p_hasil text,
  p_catatan text DEFAULT '', p_diumumkan boolean DEFAULT false, p_kakasuh text DEFAULT ''
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hasil   text;
  v_kakasuh text;
  v_ang     bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  SELECT angkatan_id INTO v_ang FROM public.wawancara_calon WHERE id = p_calon_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN RETURN 'ERR_NO_AUTH'; END IF;

  v_hasil := btrim(coalesce(p_hasil, ''));
  IF v_hasil NOT IN ('', 'lolos', 'tidak_lolos') THEN RETURN 'ERR_HASIL'; END IF;
  v_kakasuh := left(btrim(coalesce(p_kakasuh, '')), 100);
  IF v_hasil = '' THEN v_kakasuh := ''; END IF;

  UPDATE public.wawancara_calon SET
    hasil = v_hasil,
    hasil_catatan = left(btrim(coalesce(p_catatan, '')), 1000),
    hasil_diumumkan = CASE WHEN v_hasil = '' THEN false ELSE coalesce(p_diumumkan, false) END,
    hasil_kakasuh = v_kakasuh,
    hasil_updated_at = now(),
    hasil_updated_by = p_user_id,
    updated_at = now()
  WHERE id = p_calon_id;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.wawancara_hasil_publik();
CREATE FUNCTION public.wawancara_hasil_publik(p_angkatan_id bigint DEFAULT NULL)
RETURNS TABLE(nama text, kelas text, tanggal date, hasil text, hasil_kakasuh text, hasil_updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang bigint := p_angkatan_id;
BEGIN
  IF v_ang IS NULL THEN
    SELECT c.angkatan_id INTO v_ang
      FROM public.wawancara_calon c
      JOIN public.angkatan a ON a.id = c.angkatan_id
     WHERE c.hasil_diumumkan = true
       AND c.hasil IN ('lolos', 'tidak_lolos')
     ORDER BY a.aktif DESC, a.urutan DESC, a.id DESC
     LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT c.nama, c.kelas, c.tanggal, c.hasil, c.hasil_kakasuh, c.hasil_updated_at
    FROM public.wawancara_calon c
   WHERE c.angkatan_id = v_ang
     AND c.hasil_diumumkan = true
     AND c.hasil IN ('lolos', 'tidak_lolos')
   ORDER BY c.display_order ASC, c.nama ASC;
END;
$function$;

-- ================= 11. MONITORING: AKTIVITAS & OSIS_VISITOR =================
DROP FUNCTION IF EXISTS public.aktivitas_heartbeat(text, text, text, text);
DROP FUNCTION IF EXISTS public.aktivitas_heartbeat(text, text, text, text, text);
CREATE FUNCTION public.aktivitas_heartbeat(
  p_device_id text, p_user_key text DEFAULT '', p_nama text DEFAULT '',
  p_halaman text DEFAULT '', p_mode text DEFAULT 'browser'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ukey text := lower(btrim(COALESCE(p_user_key, '')));
  v_nama text := left(btrim(COALESCE(p_nama, '')), 80);
  v_hal  text := left(btrim(COALESCE(p_halaman, '')), 120);
  v_mode text := CASE WHEN lower(btrim(COALESCE(p_mode, ''))) = 'app' THEN 'app' ELSE 'browser' END;
BEGIN
  IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RETURN 'ERR_NO_DEVICE';
  END IF;
  UPDATE public.visitor SET
    last_seen = now(),
    halaman = CASE WHEN v_hal <> '' THEN v_hal ELSE halaman END,
    name = CASE WHEN v_nama <> '' THEN v_nama ELSE name END,
    user_key = CASE WHEN v_ukey <> '' THEN v_ukey ELSE user_key END,
    mode = v_mode
  WHERE device_id = btrim(p_device_id);
  IF NOT FOUND THEN
    INSERT INTO public.visitor (device_id, jumlah, name, user_key, halaman, mode, masuk, last_seen)
    VALUES (btrim(p_device_id), 0, v_nama, v_ukey, v_hal, v_mode, now(), now());
  END IF;
  RETURN 'OK';
END;
$function$;

DROP FUNCTION IF EXISTS public.aktivitas_catat(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.aktivitas_catat(text, text, text, text, text, text, text);
CREATE FUNCTION public.aktivitas_catat(
  p_device_id text, p_user_key text DEFAULT '', p_nama text DEFAULT '',
  p_aksi text DEFAULT '', p_halaman text DEFAULT '', p_detail text DEFAULT '',
  p_mode text DEFAULT 'browser'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dev     text := left(btrim(COALESCE(p_device_id, '')), 120);
  v_ukey    text := lower(btrim(COALESCE(p_user_key, '')));
  v_nama    text := left(btrim(COALESCE(p_nama, '')), 80);
  v_aksi    text := lower(btrim(COALESCE(p_aksi, '')));
  v_hal     text := left(btrim(COALESCE(p_halaman, '')), 120);
  v_det     text := left(btrim(COALESCE(p_detail, '')), 300);
  v_osis_id bigint;
  v_ang     bigint := NULL;
  new_id    bigint := 0;
  v_max     bigint;
BEGIN
  IF v_dev = '' OR v_aksi = '' THEN RETURN 0; END IF;
  v_osis_id := public.osis_id_dari_auth();
  IF v_osis_id IS NOT NULL THEN
    SELECT angkatan_id INTO v_ang FROM public.osis_users WHERE id = v_osis_id;
  END IF;

  IF v_aksi = 'buka_halaman' AND EXISTS (
    SELECT 1 FROM public.aktivitas
     WHERE device_id = v_dev
       AND aksi = 'buka_halaman'
       AND halaman = v_hal
       AND angkatan_id IS NOT DISTINCT FROM v_ang
       AND created_at > now() - interval '60 seconds'
  ) THEN
    PERFORM public.aktivitas_heartbeat(v_dev, v_ukey, v_nama, v_hal, p_mode);
    RETURN 0;
  END IF;

  INSERT INTO public.aktivitas (device_id, user_key, nama, aksi, halaman, detail, angkatan_id)
  VALUES (v_dev, v_ukey, v_nama, v_aksi, v_hal, v_det, v_ang)
  RETURNING id INTO new_id;
  PERFORM public.aktivitas_heartbeat(v_dev, v_ukey, v_nama, v_hal, p_mode);
  SELECT MAX(id) INTO v_max FROM public.aktivitas;
  IF v_max IS NOT NULL AND v_max > 50000 THEN
    DELETE FROM public.aktivitas WHERE id < v_max - 50000;
  END IF;
  RETURN new_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.aktivitas_list(integer, integer);
CREATE FUNCTION public.aktivitas_list(
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_osis_id bigint;
  v_ang     bigint;
  v_lintas  boolean := false;
  hasil     jsonb;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    v_lintas := true;
  ELSE
    v_osis_id := public.osis_id_dari_auth();
    IF v_osis_id IS NOT NULL THEN
      v_lintas := public.osis_lintas_angkatan(v_osis_id);
      IF NOT v_lintas THEN
        SELECT angkatan_id INTO v_ang FROM public.osis_users WHERE id = v_osis_id;
        IF v_ang IS NULL OR (p_angkatan_id IS NOT NULL AND p_angkatan_id <> v_ang) THEN
          RETURN '[]'::jsonb;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_osis_id IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    -- Pemanggil publik (beranda): hanya aktivitas publik non-OSIS
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO hasil FROM (
      SELECT id, created_at, user_key, nama, aksi, halaman, detail
        FROM public.aktivitas
       WHERE angkatan_id IS NULL
         AND COALESCE(user_key, '') NOT LIKE 'osis:%'
       ORDER BY id DESC
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100))
      OFFSET GREATEST(0, COALESCE(p_offset, 0))
    ) t;
    RETURN hasil;
  END IF;

  IF v_lintas THEN
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO hasil FROM (
      SELECT id, created_at, user_key, nama, aksi, halaman, detail
        FROM public.aktivitas
       WHERE (p_angkatan_id IS NULL)
          OR (p_angkatan_id = -1 AND angkatan_id IS NULL)
          OR (p_angkatan_id > 0 AND angkatan_id = p_angkatan_id)
       ORDER BY id DESC
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100))
      OFFSET GREATEST(0, COALESCE(p_offset, 0))
    ) t;
    RETURN hasil;
  END IF;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO hasil FROM (
    SELECT id, created_at, user_key, nama, aksi, halaman, detail
      FROM public.aktivitas
     WHERE angkatan_id = v_ang
     ORDER BY id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;
  RETURN hasil;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tambah_osis_visitor_unik(
  p_user_id bigint, p_key text, p_label text DEFAULT '', p_tipe text DEFAULT '',
  p_ua text DEFAULT '', p_resolusi text DEFAULT '', p_name text DEFAULT '',
  p_user_key text DEFAULT '', p_halaman text DEFAULT '', p_mode text DEFAULT 'browser'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  total        bigint;
  hari_wib     date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_uid        bigint;
  v_ang        bigint;
  v_ukey       text := lower(btrim(COALESCE(p_user_key, '')));
  v_nama       text := btrim(COALESCE(p_name, ''));
  v_hal        text := btrim(COALESCE(p_halaman, ''));
  v_old_jumlah bigint := 0;
  v_mode       text := CASE WHEN lower(btrim(COALESCE(p_mode, ''))) = 'app' THEN 'app' ELSE 'browser' END;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN -1; END IF;
  END IF;
  v_uid := p_user_id;

  SELECT angkatan_id INTO v_ang FROM public.osis_users WHERE id = v_uid;
  IF NOT FOUND THEN RETURN -1; END IF;
  IF p_key IS NULL OR p_key = '' THEN RETURN 0; END IF;

  IF v_ukey <> '' THEN
    SELECT COALESCE(SUM(jumlah), 0) INTO v_old_jumlah
      FROM public.osis_visitor
     WHERE device_id <> p_key
       AND (
         lower(btrim(user_key)) = v_ukey
         OR (COALESCE(btrim(user_key), '') = '' AND v_nama <> '' AND lower(btrim(name)) = lower(v_nama))
       );
    DELETE FROM public.osis_visitor
     WHERE device_id <> p_key
       AND (
         lower(btrim(user_key)) = v_ukey
         OR (COALESCE(btrim(user_key), '') = '' AND v_nama <> '' AND lower(btrim(name)) = lower(v_nama))
       );
  END IF;

  INSERT INTO public.osis_visitor
    (device_id, osis_user_id, angkatan_id, jumlah, name, user_key, label, tipe, user_agent, resolusi, halaman, mode, masuk, last_seen)
  VALUES (
    p_key, v_uid, v_ang, 1 + v_old_jumlah, v_nama, v_ukey,
    COALESCE(NULLIF(btrim(p_label), ''), 'Unknown'),
    COALESCE(NULLIF(btrim(p_tipe), ''), ''),
    COALESCE(NULLIF(btrim(p_ua), ''), ''),
    COALESCE(NULLIF(btrim(p_resolusi), ''), ''),
    v_hal, v_mode, now(), now()
  )
  ON CONFLICT (device_id) DO UPDATE SET
    osis_user_id = v_uid,
    angkatan_id = v_ang,
    jumlah = CASE
      WHEN (osis_visitor.last_seen AT TIME ZONE 'Asia/Jakarta')::date = hari_wib
        THEN osis_visitor.jumlah + v_old_jumlah
      ELSE osis_visitor.jumlah + 1 + v_old_jumlah
    END,
    name = CASE WHEN v_nama <> '' THEN v_nama ELSE osis_visitor.name END,
    user_key = CASE WHEN v_ukey <> '' THEN v_ukey ELSE osis_visitor.user_key END,
    label = CASE WHEN COALESCE(NULLIF(btrim(p_label), ''), '') <> '' THEN btrim(p_label) ELSE osis_visitor.label END,
    tipe = CASE WHEN COALESCE(NULLIF(btrim(p_tipe), ''), '') <> '' THEN btrim(p_tipe) ELSE osis_visitor.tipe END,
    user_agent = CASE WHEN COALESCE(NULLIF(btrim(p_ua), ''), '') <> '' THEN btrim(p_ua) ELSE osis_visitor.user_agent END,
    resolusi = CASE WHEN COALESCE(NULLIF(btrim(p_resolusi), ''), '') <> '' THEN btrim(p_resolusi) ELSE osis_visitor.resolusi END,
    halaman = CASE WHEN v_hal <> '' THEN v_hal ELSE osis_visitor.halaman END,
    mode = v_mode,
    masuk = CASE
      WHEN v_old_jumlah > 0 THEN now()
      WHEN (osis_visitor.last_seen AT TIME ZONE 'Asia/Jakarta')::date = hari_wib THEN osis_visitor.masuk
      ELSE now()
    END,
    last_seen = now();

  SELECT COALESCE(SUM(jumlah), 0) INTO total
    FROM public.osis_visitor
   WHERE (v_ang IS NULL OR angkatan_id = v_ang);
  RETURN total;
END;
$function$;

DROP FUNCTION IF EXISTS public.osis_visitor_list(bigint);
CREATE FUNCTION public.osis_visitor_list(p_user_id bigint, p_angkatan_id bigint DEFAULT NULL)
RETURNS TABLE(
  device_id text, jumlah integer, name text, user_key text, label text, tipe text,
  user_agent text, resolusi text, masuk timestamptz, last_seen timestamptz, halaman text, mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang    bigint;
  v_lintas boolean;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN; END IF;
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN;
  END IF;

  v_lintas := public.osis_lintas_angkatan(p_user_id);
  IF v_lintas THEN
    RETURN QUERY
    SELECT v.device_id, v.jumlah, v.name, v.user_key, v.label, v.tipe,
           v.user_agent, v.resolusi, v.masuk, v.last_seen, v.halaman, v.mode
      FROM public.osis_visitor v
     WHERE (p_angkatan_id IS NULL)
        OR (p_angkatan_id > 0 AND v.angkatan_id = p_angkatan_id)
     ORDER BY v.last_seen DESC;
    RETURN;
  END IF;

  SELECT angkatan_id INTO v_ang FROM public.osis_users WHERE id = p_user_id;
  IF v_ang IS NULL OR (p_angkatan_id IS NOT NULL AND p_angkatan_id <> v_ang) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v.device_id, v.jumlah, v.name, v.user_key, v.label, v.tipe,
         v.user_agent, v.resolusi, v.masuk, v.last_seen, v.halaman, v.mode
    FROM public.osis_visitor v
   WHERE v.angkatan_id = v_ang
   ORDER BY v.last_seen DESC;
END;
$function$;

-- ================= 12. REVOKE & GRANT EXECUTE =================
REVOKE ALL ON FUNCTION public.osis_angkatan_dari_auth() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.osis_lintas_angkatan(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.osis_boleh_angkatan(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.osis_target_angkatan(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.osis_angkatan_dari_auth() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.osis_lintas_angkatan(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.osis_boleh_angkatan(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.osis_target_angkatan(bigint, bigint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cari_osis_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cari_osis_login(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.akses_saya(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.angkatan_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.angkatan_simpan(bigint, bigint, text, text, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.angkatan_hapus(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.osis_user_list(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.akses_matriks(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tambah_osis_user(bigint, text, text, text, text, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_osis_user(bigint, bigint, text, text, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akses_saya(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.angkatan_list() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.angkatan_simpan(bigint, bigint, text, text, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.angkatan_hapus(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.osis_user_list(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.akses_matriks(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tambah_osis_user(bigint, text, text, text, text, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_osis_user(bigint, bigint, text, text, text, text, text, bigint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.buat_kas(bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_kas(bigint, bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_kas(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.osis_kas_ringkas(bigint, text, text, text, text, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_saldo_awal(bigint, integer, bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buat_tabungan(bigint, text, date, bigint, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_tabungan(bigint, bigint, text, date, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_tabungan(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_tabungan_cek(bigint, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buat_kas(bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_kas(bigint, bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_kas(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.osis_kas_ringkas(bigint, text, text, text, text, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_saldo_awal(bigint, integer, bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buat_tabungan(bigint, text, date, bigint, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_tabungan(bigint, bigint, text, date, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_tabungan(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_tabungan_cek(bigint, bigint, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.buat_absensi(bigint, date, text, text, text, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_absensi(bigint, bigint, date, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_absensi(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anggota_saya(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qr_absen_sesi_buat(bigint, date, text, integer, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qr_absen_sesi_ambil(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qr_absen_sesi_tutup(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qr_absen_catat(bigint, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qr_absen_daftar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buat_absensi(bigint, date, text, text, text, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_absensi(bigint, bigint, date, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_absensi(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anggota_saya(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qr_absen_sesi_buat(bigint, date, text, integer, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qr_absen_sesi_ambil(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qr_absen_sesi_tutup(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qr_absen_catat(bigint, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qr_absen_daftar(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.qr_absen_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_absen_info(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.buat_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_agenda(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sekbid_agenda_ringkas(bigint, bigint, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buat_program(bigint, bigint, text, text, text, text, date, date, text, text, text, integer, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_program(bigint, bigint, bigint, text, text, text, text, date, date, text, text, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_program(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buat_notulensi(bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_notulensi(bigint, bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_notulensi(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buat_informasi(bigint, text, text, text, text, text, text, text, text, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_informasi(bigint, bigint, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_informasi(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buat_dokumen(bigint, text, text, integer, text, text, text, text, text, bigint, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_dokumen(bigint, bigint, text, text, integer, text, text, text, text, text, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_dokumen(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buat_poster(bigint, text, text, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_poster(bigint, bigint, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_poster(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tambah_anggota(bigint, integer, text, text, text, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_anggota(bigint, bigint, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hapus_anggota(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buat_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_agenda(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sekbid_agenda_ringkas(bigint, bigint, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buat_program(bigint, bigint, text, text, text, text, date, date, text, text, text, integer, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_program(bigint, bigint, bigint, text, text, text, text, date, date, text, text, text, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_program(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buat_notulensi(bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_notulensi(bigint, bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_notulensi(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buat_informasi(bigint, text, text, text, text, text, text, text, text, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_informasi(bigint, bigint, text, text, text, text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_informasi(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buat_dokumen(bigint, text, text, integer, text, text, text, text, text, bigint, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_dokumen(bigint, bigint, text, text, integer, text, text, text, text, text, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_dokumen(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buat_poster(bigint, text, text, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_poster(bigint, bigint, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_poster(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tambah_anggota(bigint, integer, text, text, text, text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_anggota(bigint, bigint, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hapus_anggota(bigint, bigint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wawancara_boleh(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_turunan_boleh(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_calon_tambah(bigint, text, text, text, integer, date, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_calon_ubah(bigint, bigint, text, text, text, integer, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_calon_hapus(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_sesi_pastikan(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_sesi_petugas_set(bigint, bigint, bigint[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_sesi_petugas(bigint, bigint, bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_urutan_pastikan(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_urutan_atur(bigint, bigint, bigint[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_pertanyaan_simpan(bigint, bigint, text, bigint, integer, boolean, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_pertanyaan_hapus(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_pertanyaan_penting(bigint, bigint, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_pertanyaan_salin(bigint, bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_jawaban_simpan(bigint, bigint, bigint, text, text, boolean, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_turunan_tambah(bigint, bigint, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wawancara_boleh(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_turunan_boleh(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_calon_tambah(bigint, text, text, text, integer, date, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_calon_ubah(bigint, bigint, text, text, text, integer, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_calon_hapus(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_sesi_pastikan(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_sesi_petugas_set(bigint, bigint, bigint[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_sesi_petugas(bigint, bigint, bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_urutan_pastikan(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_urutan_atur(bigint, bigint, bigint[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_pertanyaan_simpan(bigint, bigint, text, bigint, integer, boolean, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_pertanyaan_hapus(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_pertanyaan_penting(bigint, bigint, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_pertanyaan_salin(bigint, bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_jawaban_simpan(bigint, bigint, bigint, text, text, boolean, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_turunan_tambah(bigint, bigint, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wawancara_hasil_publik(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wawancara_hasil_publik(bigint) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aktivitas_heartbeat(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aktivitas_catat(text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aktivitas_list(integer, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aktivitas_heartbeat(text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aktivitas_catat(text, text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aktivitas_list(integer, integer, bigint) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.tambah_osis_visitor_unik(bigint, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.osis_visitor_list(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tambah_osis_visitor_unik(bigint, text, text, text, text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.osis_visitor_list(bigint, bigint) TO authenticated, service_role;

COMMIT;
