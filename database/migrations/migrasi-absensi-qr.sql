-- =========================================================================
-- MIGRASI-ABSENSI-QR — absensi pakai QR (2 mode) untuk anggota OSIS
--
-- MODE A (QR di HP absensi, siswa scan):
--   Wrapper bikin SESI QR -> QR berisi URL /absen?s=<token>.
--   Siswa scan -> login akun OSIS -> RPC qr_absen_daftar -> baris 'hadir'.
-- MODE B (QR di HP siswa, wrapper scan):
--   Siswa buka /absen -> "Tampilkan Kartu" -> QR personal (60 dtk, 1x pakai).
--   Wrapper scan -> RPC qr_absen_catat -> baris 'hadir'.
--
-- KEAMANAN:
-- - Token ditandatangani HMAC-SHA256 (pgcrypto) DI SERVER. Rahasia disimpan
--   di tabel TERPISAH tanpa policy RLS => anon/authenticated gabisa baca.
-- - Identitas siswa dibaca dari auth.uid() (JWT), BUKAN dari kiriman client.
-- - Sesi QR maks 12 jam (default 2 jam), kartu QR maks 5 mnt (default 90 dtk).
-- - Kartu QR sekali pakai (dipakai_at) => screenshot/foto gak bisa dibuang2.
-- - RLS NYALA tanpa policy di 3 tabel baru: akses CUMA lewat RPC SECURITY
--   DEFINER (pola sama seperti tabel osis_visitor).
--
-- NON-DESTRUKTIF (IF NOT EXISTS + CREATE OR REPLACE). Bisa di-run ulang.
-- Cara pakai: SQL Editor > tempel > Run (atau lewat tools admin).
-- Dipakai: js/absensi-qr.js (wrapper) + js/absen-siswa.js (siswa).
--
-- STATUS: sudah DITERAPKAN ke DB produksi 2026-10-21 (lewat MCP Supabase,
-- execute_sql per fungsi - tool apply_migration ng-split statement di
-- dalam $$ jadi error). Isi file ini sama persis sama yg jalan di DB.
-- Catatan Supabase: pgcrypto (hmac/gen_random_bytes) ada di schema
-- `extensions`, makanya dipanggil qualify (extensions.hmac(...)).
-- Blok BEGIN...EXCEPTION harus ditutup `END;` (bukan END IF;).
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------------------
-- 1) Tabel rahasia tanda tangan token (1 baris, RLS tanpa policy)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.osis_absensi_qr_rahasia (
  id        integer PRIMARY KEY DEFAULT 1,
  rahasia   text NOT NULL,
  dibuat_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT osis_absensi_qr_rahasia_satu CHECK (id = 1)
);

ALTER TABLE public.osis_absensi_qr_rahasia ENABLE ROW LEVEL SECURITY;
-- SENGAJA TANPA policy: tabel ini cuma dibaca dari dalam RPC SECURITY DEFINER.

INSERT INTO public.osis_absensi_qr_rahasia (id, rahasia)
VALUES (1, encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------------
-- 2) Sesi QR (1 baris = 1 kegiatan di 1 tanggal, dibuka operator)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.osis_absensi_qr_sesi (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tanggal     date NOT NULL,
  kegiatan    text NOT NULL DEFAULT '',
  dibuat_oleh bigint NOT NULL REFERENCES public.osis_users(id) ON DELETE CASCADE,
  dibuat_at   timestamptz NOT NULL DEFAULT now(),
  berakhir_at timestamptz NOT NULL,
  aktif       boolean NOT NULL DEFAULT true,
  kode        text NOT NULL,
  catatan     text NOT NULL DEFAULT ''
);

ALTER TABLE public.osis_absensi_qr_sesi ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_sesi_kode
  ON public.osis_absensi_qr_sesi (kode);
CREATE INDEX IF NOT EXISTS idx_qr_sesi_owner
  ON public.osis_absensi_qr_sesi (dibuat_oleh, dibuat_at DESC);

-- -------------------------------------------------------------------------
-- 3) Kartu QR personal (sekali pakai, dibuat	on-demand oleh siswa)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.osis_absensi_qr_kartu (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES public.osis_users(id) ON DELETE CASCADE,
  dibuat_at   timestamptz NOT NULL DEFAULT now(),
  berakhir_at timestamptz NOT NULL,
  dipakai_at  timestamptz,
  dipakai_oleh bigint REFERENCES public.osis_users(id) ON DELETE SET NULL
);

ALTER TABLE public.osis_absensi_qr_kartu ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_qr_kartu_user
  ON public.osis_absensi_qr_kartu (user_id, dibuat_at DESC);

-- -------------------------------------------------------------------------
-- 4) Kolom baru di osis_absensi (baris 'hadir' dari QR)
--    sumber   : manual | qr
--    akun_id  : id akun yang absen (osis_users.id)
--    akun_mode: osis | biasa
--    sesi_qr_id: sesi QR terkait
-- -------------------------------------------------------------------------
ALTER TABLE public.osis_absensi
  ADD COLUMN IF NOT EXISTS sumber text NOT NULL DEFAULT 'manual';
ALTER TABLE public.osis_absensi
  ADD COLUMN IF NOT EXISTS akun_id bigint;
ALTER TABLE public.osis_absensi
  ADD COLUMN IF NOT EXISTS akun_mode text NOT NULL DEFAULT '';
ALTER TABLE public.osis_absensi
  ADD COLUMN IF NOT EXISTS sesi_qr_id bigint
  REFERENCES public.osis_absensi_qr_sesi(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_absensi_sesi_qr
  ON public.osis_absensi (sesi_qr_id);

-- -------------------------------------------------------------------------
-- 5) RPC — sisi operator (p_user_id = osis_users.id, cek osis_bisa 'absensi')
-- -------------------------------------------------------------------------

-- Bikin sesi QR baru -> return token (QR) + kode manual (fallback ketik).
CREATE OR REPLACE FUNCTION public.qr_absen_sesi_buat(
  p_user_id  bigint,
  p_tanggal  date,
  p_kegiatan text DEFAULT '',
  p_menit    integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sesi   public.osis_absensi_qr_sesi%ROWTYPE;
  v_secret text;
  v_pay    text;
  v_sig    text;
  v_menit  integer;
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AUTH');
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AKSES');
  END IF;
  IF p_tanggal IS NULL THEN
    RETURN jsonb_build_object('status', 'ERR_NO_TANGGAL');
  END IF;

  v_menit := LEAST(GREATEST(COALESCE(p_menit, 120), 5), 720);

  INSERT INTO public.osis_absensi_qr_sesi
    (tanggal, kegiatan, dibuat_oleh, berakhir_at, kode)
  VALUES
    (p_tanggal,
     left(btrim(COALESCE(p_kegiatan, '')), 120),
     p_user_id,
     now() + make_interval(mins => v_menit),
     upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10)))
  RETURNING * INTO v_sesi;

  v_secret := (SELECT rahasia FROM public.osis_absensi_qr_rahasia WHERE id = 1);
  v_pay := 'S|' || v_sesi.id::text || '|'
        || (extract(epoch FROM v_sesi.berakhir_at))::bigint::text || '|'
        || v_sesi.kode;
  v_sig := rtrim(translate(encode(extensions.hmac(v_pay, v_secret, 'sha256'), 'base64'), '+/', '-_'), '=');

  RETURN jsonb_build_object(
    'status', 'OK',
    'sesi_id', v_sesi.id,
    'token', v_pay || '.' || v_sig,
    'kode', v_sesi.kode,
    'tanggal', v_sesi.tanggal,
    'kegiatan', v_sesi.kegiatan,
    'berakhir_at', v_sesi.berakhir_at,
    'menit', v_menit
  );
END $$;

-- Daftar sesi milik operator (10 terbaru) + token + jumlah yang sudah absen.
CREATE OR REPLACE FUNCTION public.qr_absen_sesi_ambil(p_user_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_secret text;
  v_rows   jsonb := '[]'::jsonb;
  v_pay    text;
  v_sig    text;
  r        record;
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AUTH');
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AKSES');
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
     ORDER BY s.dibuat_at DESC
     LIMIT 10
  LOOP
    v_pay := 'S|' || r.id::text || '|'
          || (extract(epoch FROM r.berakhir_at))::bigint::text || '|'
          || r.kode;
    v_sig := rtrim(translate(encode(extensions.hmac(v_pay, v_secret, 'sha256'), 'base64'), '+/', '-_'), '=');
    v_rows := v_rows || jsonb_build_object(
      'sesi_id', r.id,
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
END $$;

-- Tutup sesi (QR jadi tidak berlaku).
CREATE OR REPLACE FUNCTION public.qr_absen_sesi_tutup(
  p_user_id bigint,
  p_sesi_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AUTH');
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN
    RETURN jsonb_build_object('status', 'ERR_NO_AKSES');
  END IF;
  UPDATE public.osis_absensi_qr_sesi
     SET aktif = false
   WHERE id = p_sesi_id AND dibuat_oleh = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ERR_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('status', 'OK');
END $$;

-- -------------------------------------------------------------------------
-- 6) RPC — sisi siswa (identitas dari auth.uid(), bukan dari client)
-- -------------------------------------------------------------------------

-- Intip info sesi dari token (buat layar "kamu mau absen ini?").
CREATE OR REPLACE FUNCTION public.qr_absen_info(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    'berakhir_at', v_sesi.berakhir_at
  );
END $$;

-- MODE A: siswa scan QR sesi -> catat hadir.
CREATE OR REPLACE FUNCTION public.qr_absen_daftar(
  p_token text,
  p_kode  text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  -- 1) Identitas: WAJIB akun OSIS (bawa auth.id). Akun biasa ditolak.
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

  -- 2) Token (atau kode manual) -> sesi
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

  -- 3) Nama: dari roster anggota (biar sama dgn halaman absensi), else nama akun.
  v_anggota := public.anggota_saya(v_user.id);
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

  -- 4) Sudah tercatat? (UNIQUE tanggal+lower(nama) juga jaga di DB)
  SELECT id, status INTO v_id, v_status
    FROM public.osis_absensi
   WHERE tanggal = v_sesi.tanggal
     AND lower(btrim(nama)) = lower(v_nama)
   LIMIT 1;
  IF FOUND THEN
    IF v_status = 'hadir' THEN
      RETURN jsonb_build_object(
        'status', 'OK_SAMA', 'nama', v_nama,
        'tanggal', v_sesi.tanggal, 'jam', now());
    END IF;
    RETURN jsonb_build_object(
      'status', 'ERR_BENTROK', 'nama', v_nama, 'absen', v_status);
  END IF;

  -- 5) Tulis baris hadir
  INSERT INTO public.osis_absensi
    (tanggal, nama, status, alasan, kegiatan, created_by, sumber, akun_id, akun_mode, sesi_qr_id)
  VALUES
    (v_sesi.tanggal, v_nama, 'hadir', '', v_sesi.kegiatan, v_user.id,
     'qr', v_user.id, 'osis', v_sesi.id);

  RETURN jsonb_build_object(
    'status', 'OK',
    'nama', v_nama,
    'kelas', v_kelas,
    'tahun', v_tahun,
    'roster', v_roster,
    'tanggal', v_sesi.tanggal,
    'kegiatan', v_sesi.kegiatan,
    'jam', now());
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'OK_SAMA');
END $$;

-- MODE B ( sisi siswa): bikin kartu QR personal, berlaku 90 detik, 1x pakai.
CREATE OR REPLACE FUNCTION public.qr_absen_kartu_ambil(p_detik integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_user    public.osis_users%ROWTYPE;
  v_kartu   public.osis_absensi_qr_kartu%ROWTYPE;
  v_anggota jsonb;
  v_secret  text;
  v_pay     text;
  v_sig     text;
  v_detik   integer;
  v_nama    text;
  v_kelas   text;
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

  v_detik := LEAST(GREATEST(COALESCE(p_detik, 90), 30), 300);

  INSERT INTO public.osis_absensi_qr_kartu (user_id, berakhir_at)
  VALUES (v_user.id, now() + make_interval(secs => v_detik))
  RETURNING * INTO v_kartu;

  v_secret := (SELECT rahasia FROM public.osis_absensi_qr_rahasia WHERE id = 1);
  v_pay := 'K|' || v_kartu.id::text || '|' || v_user.id::text || '|'
        || (extract(epoch FROM v_kartu.berakhir_at))::bigint::text;
  v_sig := rtrim(translate(encode(extensions.hmac(v_pay, v_secret, 'sha256'), 'base64'), '+/', '-_'), '=');

  v_anggota := public.anggota_saya(v_user.id);
  IF v_anggota IS NULL THEN
    v_nama := left(btrim(COALESCE(v_user.nama, '')), 80);
  ELSE
    v_nama := left(btrim(COALESCE(v_anggota ->> 'nama', v_user.nama, '')), 80);
    v_kelas := btrim(COALESCE(v_anggota ->> 'kelas', ''));
  END IF;

  RETURN jsonb_build_object(
    'status', 'OK',
    'token', v_pay || '.' || v_sig,
    'nama', v_nama,
    'kelas', v_kelas,
    'berlaku_detik', v_detik,
    'berakhir_at', v_kartu.berakhir_at
  );
END $$;

-- MODE B ( sisi operator): scan kartu QR siswa -> catat hadir.
CREATE OR REPLACE FUNCTION public.qr_absen_catat(
  p_user_id bigint,
  p_sesi_id bigint,
  p_token  text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sesi    public.osis_absensi_qr_sesi%ROWTYPE;
  v_kartu   public.osis_absensi_qr_kartu%ROWTYPE;
  v_user    public.osis_users%ROWTYPE;
  v_anggota jsonb;
  v_secret  text;
  v_pay     text;
  v_sig     text;
  v_expect  text;
  v_kartu_id bigint;
  v_siswa_id bigint;
  v_nama    text;
  v_kelas   text;
  v_tahun   integer;
  v_roster  boolean := true;
  v_id      bigint;
  v_status  text;
BEGIN
  -- 1) Operator harus punya hak 'absensi'
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
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
  IF NOT v_sesi.aktif THEN
    RETURN jsonb_build_object('status', 'ERR_SESI_TUTUP');
  END IF;
  IF v_sesi.berakhir_at < now() THEN
    RETURN jsonb_build_object('status', 'ERR_KEDALUWARSA');
  END IF;

  -- 2) Cek tanda tangan token kartu
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

  -- 3) Identitas siswa (dari server, bukan dari isi QR)
  SELECT * INTO v_user FROM public.osis_users WHERE id = v_kartu.user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ERR_TOKEN');
  END IF;
  v_anggota := public.anggota_saya(v_user.id);
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

  -- 4) Sudah tercatat hari itu?
  SELECT id, status INTO v_id, v_status
    FROM public.osis_absensi
   WHERE tanggal = v_sesi.tanggal
     AND lower(btrim(nama)) = lower(v_nama)
   LIMIT 1;
  IF FOUND THEN
    IF v_status = 'hadir' THEN
      UPDATE public.osis_absensi_qr_kartu
         SET dipakai_at = now(), dipakai_oleh = p_user_id
       WHERE id = v_kartu.id;
      RETURN jsonb_build_object(
        'status', 'OK_SAMA', 'nama', v_nama, 'kelas', v_kelas);
    END IF;
    RETURN jsonb_build_object(
      'status', 'ERR_BENTROK', 'nama', v_nama, 'absen', v_status);
  END IF;

  -- 5) Pakai kartu + tulis baris hadir
  UPDATE public.osis_absensi_qr_kartu
     SET dipakai_at = now(), dipakai_oleh = p_user_id
   WHERE id = v_kartu.id;

  INSERT INTO public.osis_absensi
    (tanggal, nama, status, alasan, kegiatan, created_by, sumber, akun_id, akun_mode, sesi_qr_id)
  VALUES
    (v_sesi.tanggal, v_nama, 'hadir', '', v_sesi.kegiatan, v_user.id,
     'qr', v_user.id, 'osis', v_sesi.id);

  RETURN jsonb_build_object(
    'status', 'OK',
    'nama', v_nama,
    'kelas', v_kelas,
    'tahun', v_tahun,
    'roster', v_roster,
    'tanggal', v_sesi.tanggal,
    'kegiatan', v_sesi.kegiatan,
    'jam', now());
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'OK_SAMA');
END $$;

-- -------------------------------------------------------------------------
-- 7) PERKUATAN — hapus/ubah absensi wajib punya hak 'absensi'
--    Tanpa ini: anggota OSIS (termasuk siswa) bisa hapus/ubah baris absensi
--    MILIKNYA sendiri lewat RPC (pakai p_user_id miliknya). Frontend sudah
--    menyembunyikan tombol, tapi RPC harusnya juga ngecek.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hapus_absensi(p_user_id bigint, p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  DELETE FROM public.osis_absensi WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.update_absensi(
  p_user_id bigint,
  p_id bigint,
  p_tanggal date,
  p_nama text,
  p_status text,
  p_alasan text,
  p_kegiatan text DEFAULT '')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  IF p_tanggal IS NULL THEN RETURN 'ERR_NO_TANGGAL'; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN 'ERR_NO_NAMA'; END IF;
  IF COALESCE(btrim(p_status), '') NOT IN ('izin','sakit','alpha','hadir') THEN
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
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END $$;
