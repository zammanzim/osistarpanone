-- =========================================================================
-- MIGRASI-CRUD-OSIS-USERS — halaman kelola akun OSIS (osis/users.html)
-- Sifat: NON-DESTRUKTIF. Hanya CREATE OR REPLACE FUNCTION. Aman di-run ulang.
-- Cara pakai: Supabase SQL Editor > tempel > Run.
--
-- Tabel osis_users cuma punya policy SELECT (RLS), jadi SEMUA tulis wajib
-- lewat RPC SECURITY DEFINER di sini. Guard seragam: pemanggil harus
-- super_admin (public.osis_is_super) — pola sama dengan set_akses/akses_matriks.
--
-- Soal password: kolom osis_users.password = plaintext LEGACY, cuma dipakai
-- alur klaim login (migrasi_link_auth) untuk baris yang BELUM tertaut Auth
-- (auth_id IS NULL). Begitu user login pertama kali, kolom dikosongkan dan
-- password pindah ke Supabase Auth (bcrypt). Akun yang sudah tertaut TIDAK
-- bisa ganti password dari sini (balas ERR_LINKED) — pakai
-- tools/reset-password.mjs.
-- =========================================================================

-- ---- 1) Daftar akun + status taut Auth (tanpa password) ----
CREATE OR REPLACE FUNCTION public.osis_user_list(p_user_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin text;
BEGIN
    SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
    IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
        RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
    RETURN (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT u.id, u.username, u.nama, u.jabatan, u.angkatan,
            u.created_at,
            (u.auth_id IS NOT NULL) AS tertaut,
            (u.auth_id IS NULL AND COALESCE(u.password, '') <> '') AS siap_klaim,
            public.osis_is_super(u.username) AS is_super,
            public.osis_sekbid_dari_jabatan(u.jabatan) AS sekbid_id,
            (SELECT s.nama FROM public.sekbid s
              WHERE s.id = public.osis_sekbid_dari_jabatan(u.jabatan)) AS sekbid_nama
        FROM public.osis_users u
        ORDER BY u.nama
    ) t);
END $$;

-- ---- 2) Tambah akun ----
-- Balasan: id baru (text) atau ERR_NO_AUTH / ERR_INVALID / ERR_NO_NAMA /
--          ERR_PASSWORD / ERR_TAKEN.
-- Password boleh kosong = akun dibuat tapi belum bisa login sampai admin
-- mengisi password awal (user klaim sendiri lewat form login).
CREATE OR REPLACE FUNCTION public.tambah_osis_user(
    p_user_id bigint,
    p_username text,
    p_nama text,
    p_jabatan text,
    p_angkatan text,
    p_password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin text;
    v_u text;
    v_n text;
    v_pw text;
    v_id bigint;
BEGIN
    SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
    IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;

    v_u := btrim(COALESCE(p_username, ''));
    v_n := left(btrim(COALESCE(p_nama, '')), 80);
    v_pw := COALESCE(p_password, '');
    IF v_u !~ '^[A-Za-z0-9._-]{3,30}$' THEN
        RETURN 'ERR_INVALID';
    END IF;
    IF v_n = '' THEN
        RETURN 'ERR_NO_NAMA';
    END IF;
    IF length(v_pw) > 100 OR (length(v_pw) > 0 AND length(v_pw) < 6) THEN
        RETURN 'ERR_PASSWORD';
    END IF;
    -- Username unik global lawan akun OSIS + akun biasa (anti-penyamaran).
    IF EXISTS (SELECT 1 FROM public.osis_users WHERE lower(username) = lower(v_u))
       OR EXISTS (SELECT 1 FROM public.biasa_users WHERE lower(username) = lower(v_u)) THEN
        RETURN 'ERR_TAKEN';
    END IF;

    -- osis_users.id tidak punya sequence default (data lama diisi manual).
    -- Kunci advisory biar 2 admin yang tambah bareng tidak dapat id sama.
    PERFORM pg_advisory_xact_lock(720015);
    SELECT COALESCE(max(id), 0) + 1 INTO v_id FROM public.osis_users;

    INSERT INTO public.osis_users
        (id, username, password, nama, jabatan, angkatan, sekbid_id)
    VALUES
        (v_id, v_u, v_pw, v_n,
         left(btrim(COALESCE(p_jabatan, '')), 80),
         left(btrim(COALESCE(p_angkatan, '')), 40),
         public.osis_sekbid_dari_jabatan(p_jabatan));
    RETURN v_id::text;
END $$;

-- ---- 3) Ubah akun (username/nama/jabatan/angkatan + password awal) ----
-- p_password NULL = tidak diubah. Non-NULL hanya boleh untuk baris yang
-- belum tertaut Auth (ERR_LINKED kalau sudah tertaut).
CREATE OR REPLACE FUNCTION public.update_osis_user(
    p_user_id bigint,
    p_id bigint,
    p_username text,
    p_nama text,
    p_jabatan text,
    p_angkatan text,
    p_password text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin text;
    v_u text;
    v_n text;
    v_lama text;
    v_tertaut boolean;
BEGIN
    SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
    IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;

    SELECT username, (auth_id IS NOT NULL) INTO v_lama, v_tertaut
    FROM public.osis_users WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN 'ERR_NOT_FOUND';
    END IF;

    v_u := btrim(COALESCE(p_username, ''));
    v_n := left(btrim(COALESCE(p_nama, '')), 80);
    IF v_u !~ '^[A-Za-z0-9._-]{3,30}$' THEN
        RETURN 'ERR_INVALID';
    END IF;
    IF v_n = '' THEN
        RETURN 'ERR_NO_NAMA';
    END IF;
    IF p_password IS NOT NULL THEN
        IF v_tertaut THEN
            RETURN 'ERR_LINKED';
        END IF;
        IF length(p_password) > 100
           OR (length(p_password) > 0 AND length(p_password) < 6) THEN
            RETURN 'ERR_PASSWORD';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.osis_users
               WHERE lower(username) = lower(v_u) AND id <> p_id)
       OR EXISTS (SELECT 1 FROM public.biasa_users WHERE lower(username) = lower(v_u)) THEN
        RETURN 'ERR_TAKEN';
    END IF;

    UPDATE public.osis_users SET
        username = v_u,
        nama = v_n,
        jabatan = left(btrim(COALESCE(p_jabatan, '')), 80),
        angkatan = left(btrim(COALESCE(p_angkatan, '')), 40),
        sekbid_id = public.osis_sekbid_dari_jabatan(p_jabatan),
        password = CASE WHEN p_password IS NULL THEN password ELSE p_password END
    WHERE id = p_id;

    -- Super admin disimpan by username: ikut pindahkan biar status tidak hilang.
    -- Hati-hati rename beda kapital saja (lower sama): jangan sampai barisnya
    -- dihapus dulu oleh pembersih bentrok, cek baris lama dulu.
    IF v_lama IS DISTINCT FROM v_u
       AND EXISTS (SELECT 1 FROM public.osis_super_admins WHERE username = v_lama) THEN
        DELETE FROM public.osis_super_admins
        WHERE lower(username) = lower(v_u) AND lower(username) <> lower(v_lama);
        UPDATE public.osis_super_admins SET username = v_u WHERE username = v_lama;
    END IF;
    RETURN 'OK';
END $$;

-- ---- 4) Hapus akun ----
-- Baris osis_users dihapus; osis_akses ikut CASCADE, relasi lain SET NULL.
-- Akun Supabase Auth-nya DIBIARKAN (tidak bisa dihapus dari SQL client);
-- user itu otomatis ke-logout saat halaman dimuat (syncAuth buang cache).
-- Tidak boleh hapus diri sendiri (ERR_SELF).
CREATE OR REPLACE FUNCTION public.hapus_osis_user(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin text;
    v_target text;
BEGIN
    SELECT username INTO v_admin FROM public.osis_users WHERE id = p_user_id;
    IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF p_id = p_user_id THEN
        RETURN 'ERR_SELF';
    END IF;

    SELECT username INTO v_target FROM public.osis_users WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN 'ERR_NOT_FOUND';
    END IF;

    DELETE FROM public.osis_users WHERE id = p_id;
    DELETE FROM public.osis_super_admins WHERE lower(username) = lower(v_target);
    RETURN 'OK';
END $$;
