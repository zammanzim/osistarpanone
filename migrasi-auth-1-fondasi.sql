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

-- Link akun OSIS <-> Supabase Auth. Email sintetis stabil: osis-<id>@<domain>
-- (pakai id, BUKAN username, biar ganti username tidak merusak login).
ALTER TABLE public.osis_users ADD COLUMN IF NOT EXISTS auth_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_osis_users_auth_id ON public.osis_users(auth_id);

-- Klaim akun mandiri: user baru signUp (dapat session) lalu panggil RPC ini
-- dengan username + password LAMA. Server verifikasi password, set auth_id ke
-- auth.uid() pemanggil, dan kosongkan password plaintext. Return 'OK' / kode ERR_*.
CREATE OR REPLACE FUNCTION public.migrasi_link_auth(p_username text, p_password text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_id bigint;
    v_uid uuid;
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

    UPDATE public.osis_users SET auth_id = v_uid, password = '' WHERE id = v_id;
    RETURN 'OK';
END $$;

REVOKE ALL ON FUNCTION public.migrasi_link_auth(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.migrasi_link_auth(text, text) TO anon, authenticated;
