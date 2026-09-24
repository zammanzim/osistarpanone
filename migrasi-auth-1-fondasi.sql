-- ============ MIGRASI AUTH BAGIAN 1: FONDASI (aman, tidak merusak login lama) ============
-- Jalankan di Supabase Dashboard > SQL Editor. Idempotent (boleh di-run ulang).
--
-- ISI: tambah kolom auth_id (link ke auth.users) + RPC klaim akun mandiri.
-- Login lama (plaintext) TETAP JALAN setelah file ini — jadi urutan deploy:
--   1. Run file ini
--   2. Dashboard Auth: matikan "Confirm email", set password minimum = 4
--      (Authentication > Sign In / Up > Email: OFF "Confirm email";
--       Auth > Password Protection > Minimum password length: 4)
--      Alasan: app login/daftar tanpa verifikasi email; password lama ada yg < 6 char.
--   3. (Opsional, disarankan) run tools/migrasi-auth-bulk.mjs buat pindahkan semua user
--   4. Deploy frontend baru (login.js/osis-auth.js/db.js/profil.js) — user yg belum
--      kebulk otomatis klaim akun saat login pertama via RPC di bawah
--   5. Run migrasi-auth-2-kunci.sql (cabut akses kolom password) — login lama MATI di sini
-- =============================================================================

-- Link akun OSIS <-> Supabase Auth.
-- Email utama: <nama.lengkap>@<domain> (disimpan di auth_email, dibuat saat
-- migrasi bulk). Fallback deterministik: osis-<id>@<domain> (dipakai alur
-- klaim mandiri, anti-bentrok). Keduanya stabil walau username/nama diganti.
ALTER TABLE public.osis_users ADD COLUMN IF NOT EXISTS auth_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_osis_users_auth_id ON public.osis_users(auth_id);
ALTER TABLE public.osis_users ADD COLUMN IF NOT EXISTS auth_email text UNIQUE;
-- BOLEH di-run ulang (idempotent) — mis. setelah update file ini.

-- Klaim akun mandiri: user baru signUp (dapat session) lalu panggil RPC ini
-- dengan username + password LAMA + email yang dipakai signUp. Server verifikasi
-- password, set auth_id ke auth.uid() pemanggil, simpan auth_email, dan kosongkan
-- password plaintext. p_email WAJIB berpola osis-<id>@... (fallback anti-bentrok).
-- Return 'OK' / kode ERR_*.
DROP FUNCTION IF EXISTS public.migrasi_link_auth(text, text);
CREATE OR REPLACE FUNCTION public.migrasi_link_auth(p_username text, p_password text, p_email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_id bigint;
    v_uid uuid;
    v_kiri text;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF p_username IS NULL OR btrim(p_username) = '' THEN
        RETURN 'ERR_NO_USER';
    END IF;
    IF p_password IS NULL OR p_password = '' THEN
        RETURN 'ERR_WRONG';
    END IF;
    IF p_email IS NULL OR position('@' IN p_email) = 0 THEN
        RETURN 'ERR_EMAIL';
    END IF;

    -- Sudah terlink ke akun auth lain? Tolak (anti-bajak).
    IF EXISTS (SELECT 1 FROM public.osis_users
               WHERE username = btrim(p_username) AND auth_id IS NOT NULL AND auth_id <> v_uid) THEN
        RETURN 'ERR_SUDAH';
    END IF;
    -- Idempotent: baris ini memang milik pemanggil.
    IF EXISTS (SELECT 1 FROM public.osis_users
               WHERE username = btrim(p_username) AND auth_id = v_uid) THEN
        RETURN 'OK';
    END IF;

    SELECT id INTO v_id FROM public.osis_users
    WHERE username = btrim(p_username)
      AND auth_id IS NULL
      AND password <> ''
      AND password = p_password;

    IF v_id IS NULL THEN
        RETURN 'ERR_WRONG';
    END IF;

    -- Email klaim harus fallback deterministik milik baris ini (anti-bentrok
    -- dengan email nama yang dikelola skrip bulk).
    v_kiri := split_part(p_email, '@', 1);
    IF v_kiri <> ('osis-' || v_id::text) THEN
        RETURN 'ERR_EMAIL';
    END IF;

    UPDATE public.osis_users SET auth_id = v_uid, auth_email = p_email, password = '' WHERE id = v_id;
    RETURN 'OK';
END $$;

REVOKE ALL ON FUNCTION public.migrasi_link_auth(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.migrasi_link_auth(text, text, text) TO anon, authenticated;
