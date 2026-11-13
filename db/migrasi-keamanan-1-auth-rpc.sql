-- =========================================================================
-- MIGRASI-KEAMANAN-1-AUTH-RPC — RPC gak boleh percaya p_user_id dari client
--
-- MASALAH:
--   133 fungsi SECURITY DEFINER di schema public nerima p_user_id/p_admin
--   dari client TANPA ngecek JWT. Karena EXECUTE di-grant ke anon, siapa pun
--   (tanpa login) bisa panggil:
--     akses_saya(1)       -> dapet id + hak super admin
--     osis_user_list(1)   -> dapet 58 akun osis_users
--     osis_bisa(1, ...)   -> true
--   ...lalu tambah_osis_user / set_super / set_akses = takeover penuh.
--
-- SOLUSI:
--   1) Helper public.osis_id_dari_auth() -> id osis_users milik auth.uid().
--   2) Semua RPC target dipatch: setelah token BEGIN pertama disisipkan guard
--        - service_role (script/admin/Worker)  -> p_user_id dipakai apa adanya
--        - selain itu (anon/authenticated)     -> p_user_id DIPAKSA dari JWT
--        - gak ada JWT / akun belum ke-link    -> balikin ERR_NO_AUTH
--   3) link_auth_biasa DIKECUALIKAN: p_user_id di situ = biasa_users.id
--      (bukan osis_users.id), dan fungsinya udah pakai auth.uid() sendiri.
--   4) feed_komen_hapus dapet guard LONGGAR: p_user_id di-override dari JWT
--      kalau ada, tapi TIDAK wajib login (fitur feed publik: anon hapus komen
--      sendiri lewat user_key). Tanpa override, anon bisa ngaku-ngaku id osis.
--
-- SIFAT: non-destruktif, idempoten (fungsi yang udah ada guard dilewati).
--        Backup definisi lama disimpan di _backup_fungsi_auth_rpc_20261112.
--
-- CATATAN PENTING:
--   - Client WAJIB punya sesi Supabase Auth (JWT) saat manggil RPC. Login
--     osis/biasa di js/login.js udah signInWithPassword, jadi aman.
--   - Panggilan manual dari SQL Editor (role postgres, tanpa JWT) sekarang
--     kena ERR_NO_AUTH. Buat admin, panggil via API pakai service key.
--   - Kalau sesi JWT kedaluwarsa, RPC balikin ERR_NO_AUTH sampai refresh.
--
-- STATUS: sudah DITERAPKAN ke DB produksi 2026-11-13 (via MCP Supabase
-- execute_sql, satu blok). Verifikasi: anon -> ERR_NO_AUTH, JWT pengurus ->
-- p_user_id dipaksa ke id sendiri, feed_komen_hapus tetap jalan buat anon.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Helper: id osis_users yang nempel ke JWT aktif
--    SECURITY DEFINER biar tetap jalan walau SELECT osis_users ditutup (fix #2)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.osis_id_dari_auth()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT u.id
    FROM public.osis_users u
   WHERE u.auth_id = auth.uid()
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION public.osis_id_dari_auth() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.osis_id_dari_auth() TO service_role;

COMMENT ON FUNCTION public.osis_id_dari_auth() IS
  'id osis_users milik auth.uid() (null kalau belum login / bukan pengurus).';

-- -------------------------------------------------------------------------
-- 2) Backup definisi fungsi SEBELUM dipatch (rollback ada di bagian 5)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._backup_fungsi_auth_rpc_20261112 (
  proname       text NOT NULL,
  identity_args text NOT NULL,
  def           text NOT NULL,
  dibuat_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proname, identity_args)
);

INSERT INTO public._backup_fungsi_auth_rpc_20261112 (proname, identity_args, def)
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid),
       pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prosecdef
   AND (pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_user_id\s'
        OR pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_admin\s')
ON CONFLICT DO NOTHING;

REVOKE ALL ON TABLE public._backup_fungsi_auth_rpc_20261112 FROM PUBLIC, anon, authenticated;
ALTER TABLE public._backup_fungsi_auth_rpc_20261112 ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public._backup_fungsi_auth_rpc_20261112 IS
  'Backup definisi RPC sebelum patch guard auth. Internal, jangan diekspos.';

-- -------------------------------------------------------------------------
-- 3) Patch: sisipkan guard setelah token BEGIN pertama
-- -------------------------------------------------------------------------
DO $patch$
DECLARE
  r        record;
  v_def    text;
  v_body   text;
  v_as     int;
  v_body0  int;
  v_b      int;
  v_param  text;
  v_ret    text;
  v_noauth text;
  v_guard  text;
  v_new    text;
  v_n      int := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           p.proretset,
           format_type(p.prorettype, NULL) AS ret,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND (pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_user_id\s'
            OR pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_admin\s')
     ORDER BY p.proname
  LOOP
    -- p_user_id di link_auth_biasa = biasa_users.id, bukan osis_users.id
    CONTINUE WHEN r.proname = 'link_auth_biasa';

    v_def := r.def;
    v_as  := strpos(v_def, 'AS $function$');
    IF v_as = 0 THEN
      RAISE EXCEPTION 'Format fungsi % gak dikenal (tanpa AS $function$)', r.proname;
    END IF;

    v_body0 := v_as + length('AS $function$');
    v_body  := substr(v_def, v_body0);

    -- idempoten: kalau guard udah ada, lewati
    CONTINUE WHEN position('osis_id_dari_auth()' IN v_body) > 0;

    v_b := regexp_instr(v_body, '\mbegin\M', 1, 1, 0, 'i');
    IF v_b = 0 THEN
      RAISE EXCEPTION 'Fungsi % gak punya token BEGIN', r.proname;
    END IF;

    v_param := CASE WHEN r.args ~ '(^|,)\s*p_admin\s' THEN 'p_admin' ELSE 'p_user_id' END;
    v_ret   := r.ret;

    IF r.proretset OR v_ret IN ('record', 'void') THEN
      v_noauth := 'RETURN;';
    ELSIF v_ret = 'boolean' THEN
      v_noauth := 'RETURN false;';
    ELSIF v_ret IN ('bigint', 'integer', 'smallint') THEN
      v_noauth := 'RETURN -1;';
    ELSIF v_ret = 'jsonb' THEN
      v_noauth := 'RETURN jsonb_build_object(''error'', ''ERR_NO_AUTH'');';
    ELSIF v_ret = 'text' THEN
      v_noauth := 'RETURN ''ERR_NO_AUTH'';';
    ELSE
      v_noauth := 'RETURN NULL;';
    END IF;

    v_guard := chr(10) ||
      '  IF coalesce(auth.role(), '''') = ''service_role'' THEN' || chr(10) ||
      '    NULL; -- service key/script boleh kirim identitas sendiri' || chr(10) ||
      '  ELSE' || chr(10) ||
      '    ' || v_param || ' := public.osis_id_dari_auth();' || chr(10) ||
      '    IF ' || v_param || ' IS NULL THEN' || chr(10) ||
      '      ' || v_noauth || chr(10) ||
      '    END IF;' || chr(10) ||
      '  END IF;' || chr(10);

    -- publik: cukup override identitas kalau ada JWT, gak wajib login
    IF r.proname = 'feed_komen_hapus' THEN
      v_guard := chr(10) ||
        '  IF coalesce(auth.role(), '''') <> ''service_role'' THEN' || chr(10) ||
        '    p_user_id := public.osis_id_dari_auth();' || chr(10) ||
        '  END IF;' || chr(10);
    END IF;

    -- khusus: v_uid diisi dari p_user_id di DECLARE (sebelum guard)
    IF r.proname = 'tambah_osis_visitor_unik' THEN
      v_guard := v_guard || '  v_uid := p_user_id;' || chr(10);
    END IF;

    v_new := left(v_def, v_body0 + v_b + 3) || v_guard || substr(v_body, v_b + 5);
    EXECUTE v_new;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'Patch selesai: % fungsi dipatch.', v_n;
END $patch$;

-- -------------------------------------------------------------------------
-- 4) Verifikasi: semua target (kecuali link_auth_biasa) wajib punya guard
-- -------------------------------------------------------------------------
DO $cek$
DECLARE
  v_total   int;
  v_patched int;
  v_missing text;
BEGIN
  SELECT count(*) INTO v_total
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND (pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_user_id\s'
          OR pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_admin\s')
     AND p.proname <> 'link_auth_biasa';

  SELECT count(*) INTO v_patched
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND position('osis_id_dari_auth()' IN pg_get_functiondef(p.oid)) > 0
     AND p.proname <> 'link_auth_biasa'
     AND (pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_user_id\s'
          OR pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_admin\s');

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_missing
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND position('osis_id_dari_auth()' IN pg_get_functiondef(p.oid)) = 0
     AND p.proname <> 'link_auth_biasa'
     AND (pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_user_id\s'
          OR pg_get_function_identity_arguments(p.oid) ~ '(^|,)\s*p_admin\s');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Masih ada fungsi tanpa guard: %', v_missing;
  END IF;

  RAISE NOTICE 'Verifikasi OK: % / % fungsi target punya guard auth.', v_patched, v_total;
END $cek$;

-- -------------------------------------------------------------------------
-- 5) Rollback (jalankan manual kalau perlu balikin definisi lama)
-- -------------------------------------------------------------------------
-- DO $rollback$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT def FROM public._backup_fungsi_auth_rpc_20261112 LOOP
--     EXECUTE r.def;
--   END LOOP;
-- END $rollback$;
--
-- Setelah stabil, helper + tabel backup boleh dihapus manual:
--   DROP FUNCTION IF EXISTS public.osis_id_dari_auth();
--   DROP TABLE IF EXISTS public._backup_fungsi_auth_rpc_20261112;
