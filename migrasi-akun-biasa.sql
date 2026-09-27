-- ============ MIGRASI AKUN BIASA (publik bisa daftar, tanpa hak OSIS) ============
-- Jalankan di Supabase Dashboard > SQL Editor. Idempotent (boleh di-run ulang).
--
-- ISI: tabel biasa_users + 2 RPC (daftar_biasa, link_auth_biasa).
-- Email Auth sintetis: biasa-<id>@<domain> (paralel osis-<id>@<domain>).
-- Username UNIK GLOBAL lawan osis_users (case-insensitive) — cegah penyamaran
-- jadi anggota OSIS. Password dipegang Supabase Auth (bcrypt), TIDAK ada kolom
-- password di tabel ini.
--
-- Alur client (js/login.js):
--   daftar: daftar_biasa(username, nama) -> id -> signUp(biasa-<id>@domain)
--           -> link_auth_biasa(id, email) -> login
--   masuk:  cari username di osis_users dulu (tetap prioritas), kalau tidak ada
--           cari di biasa_users -> signIn -> self-heal link kalau perlu
--   keluar: logout normal (akun tetap ada, bisa masuk lagi kapan saja).
-- =============================================================================

-- 1. Tabel akun biasa: username + nama + link Auth.
CREATE TABLE IF NOT EXISTS public.biasa_users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL UNIQUE,
    nama text NOT NULL DEFAULT '',
    auth_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    auth_email text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_biasa_users_auth_id ON public.biasa_users(auth_id);

-- Baca publik (id/username/nama/auth_*) biar client bisa login by username.
-- RLS tetap MATI seperti osis_users — keamanan kolom dipegang GRANT di bawah.
-- JANGAN enable RLS tanpa policy (deny-all = semua query pecah).
REVOKE ALL ON public.biasa_users FROM anon, authenticated;
GRANT SELECT (id, username, nama, auth_id, auth_email)
    ON public.biasa_users TO anon, authenticated;

-- 2. Daftar akun biasa. Cek format + unik global (kedua tabel, case-insensitive).
-- Kalau username sudah dipesan TAPI belum terlink Auth (daftar kepotong di
-- tengah: insert sukses, signUp/link gagal) -> kembalikan id lama biar user
-- bisa mengulang daftar tanpa mentok. Selain itu yang kembar = ERR_TAKEN.
-- Return: id baru/lama (teks angka) / ERR_INVALID / ERR_NO_NAMA / ERR_TAKEN.
CREATE OR REPLACE FUNCTION public.daftar_biasa(p_username text, p_nama text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_u text;
    v_n text;
    v_id bigint;
BEGIN
    v_u := btrim(COALESCE(p_username, ''));
    v_n := left(btrim(COALESCE(p_nama, '')), 80);
    IF v_u !~ '^[A-Za-z0-9._-]{3,30}$' THEN
        RETURN 'ERR_INVALID';
    END IF;
    IF v_n = '' THEN
        RETURN 'ERR_NO_NAMA';
    END IF;
    -- Username OSIS tidak boleh dipakai (cegah penyamaran).
    IF EXISTS (SELECT 1 FROM public.osis_users WHERE lower(username) = lower(v_u)) THEN
        RETURN 'ERR_TAKEN';
    END IF;
    SELECT id INTO v_id FROM public.biasa_users
    WHERE lower(username) = lower(v_u);
    IF FOUND THEN
        -- Baris ada: lanjutkan kalau belum terlink, tolak kalau sudah aktif.
        IF EXISTS (SELECT 1 FROM public.biasa_users
                   WHERE id = v_id AND auth_id IS NULL) THEN
            UPDATE public.biasa_users SET nama = v_n WHERE id = v_id;
            RETURN v_id::text;
        END IF;
        RETURN 'ERR_TAKEN';
    END IF;
    INSERT INTO public.biasa_users (username, nama)
    VALUES (v_u, v_n)
    RETURNING id INTO v_id;
    RETURN v_id::text;
END $$;

REVOKE ALL ON FUNCTION public.daftar_biasa(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.daftar_biasa(text, text) TO anon, authenticated;

-- 3. Link Auth: dipanggil setelah signUp (session = akun Auth baru) dengan
-- email yang dipakai signUp. Server pastikan email berpola biasa-<id>@...
-- milik baris ini, lalu set auth_id + auth_email. Idempotent (boleh diulang
-- buat self-heal kalau link pertama gagal di tengah jalan).
-- Return 'OK' / kode ERR_*.
CREATE OR REPLACE FUNCTION public.link_auth_biasa(p_user_id bigint, p_email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_uid uuid;
    v_kiri text;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF p_user_id IS NULL THEN
        RETURN 'ERR_NO_USER';
    END IF;
    IF p_email IS NULL OR position('@' IN p_email) = 0 THEN
        RETURN 'ERR_EMAIL';
    END IF;

    -- Idempotent: baris ini memang milik pemanggil.
    IF EXISTS (SELECT 1 FROM public.biasa_users
               WHERE id = p_user_id AND auth_id = v_uid) THEN
        RETURN 'OK';
    END IF;
    -- Auth ini sudah terlink ke baris lain? Tolak (1 Auth = 1 akun).
    IF EXISTS (SELECT 1 FROM public.biasa_users
               WHERE auth_id = v_uid AND id <> p_user_id) THEN
        RETURN 'ERR_SUDAH';
    END IF;

    -- Email harus fallback deterministik milik baris ini (anti-bentrok).
    v_kiri := split_part(p_email, '@', 1);
    IF v_kiri <> ('biasa-' || p_user_id::text) THEN
        RETURN 'ERR_EMAIL';
    END IF;

    UPDATE public.biasa_users
    SET auth_id = v_uid, auth_email = p_email
    WHERE id = p_user_id AND auth_id IS NULL;
    IF NOT FOUND THEN
        -- Baris milik akun Auth lain (berebut username) — suruh login.
        RETURN 'ERR_SUDAH';
    END IF;
    RETURN 'OK';
END $$;

REVOKE ALL ON FUNCTION public.link_auth_biasa(bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.link_auth_biasa(bigint, text) TO anon, authenticated;

-- 4. BATAL: rencana hapus-akun-pas-keluar tidak jadi dipakai.
-- Baris di bawah cuma bersih-bersih kalau file versi lama sempat di-run
-- (RPC hapus_akun_biasa jadi tidak ada di DB). Aman di-run ulang.
DROP FUNCTION IF EXISTS public.hapus_akun_biasa();
