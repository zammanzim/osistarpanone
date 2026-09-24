-- Migrasi super admin dinamis: tambah/hapus tinggal INSERT/DELETE, tanpa edit fungsi.
-- Cara pakai: run SEKALI di Supabase SQL Editor. Aman di-run ulang (idempotent).
-- Setelah ini, nambah super admin:
--   INSERT INTO public.osis_super_admins (username) VALUES ('username_baru');
-- Cabut:
--   DELETE FROM public.osis_super_admins WHERE lower(username) = lower('username_baru');
-- Atau via RPC (dari client, harus login sebagai super):
--   SELECT public.set_super(admin_id, target_id, true);   -- jadikan super
--   SELECT public.set_super(admin_id, target_id, false);  -- cabut super

-- 1. Tabel penampung username super admin
CREATE TABLE IF NOT EXISTS public.osis_super_admins (
    username text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.osis_super_admins ENABLE ROW LEVEL SECURITY;
INSERT INTO public.osis_super_admins (username) VALUES
    ('mizammm'), ('bintangsandirofiansyah')
ON CONFLICT (username) DO NOTHING;

-- 2. Helper cek super (case-insensitive)
CREATE OR REPLACE FUNCTION public.osis_is_super(p_username text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.osis_super_admins s
        WHERE lower(s.username) = lower(btrim(COALESCE(p_username, '')))
    );
$$;
REVOKE EXECUTE ON FUNCTION public.osis_is_super(text) FROM public;
GRANT EXECUTE ON FUNCTION public.osis_is_super(text) TO anon;

-- 3. osis_bisa: ganti hardcode IN (...) -> helper
CREATE OR REPLACE FUNCTION public.osis_bisa(p_user_id bigint, p_halaman text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_username text; v_jabatan text;
BEGIN
    IF p_user_id IS NULL OR p_halaman IS NULL OR btrim(p_halaman) = '' THEN
        RETURN false;
    END IF;
    SELECT username, jabatan INTO v_username, v_jabatan
    FROM public.osis_users WHERE id = p_user_id;
    IF NOT FOUND THEN RETURN false; END IF;
    IF public.osis_is_super(v_username) THEN RETURN true; END IF;
    IF EXISTS (SELECT 1 FROM public.osis_akses
            WHERE user_id = p_user_id AND halaman IN (p_halaman, '*')) THEN
        RETURN true;
    END IF;
    IF p_halaman <> 'agenda'
    AND public.osis_hak_jabatan(v_jabatan, p_halaman) THEN
        RETURN true;
    END IF;
    RETURN false;
END $$;

-- 4. akses_saya: flag super dari tabel
CREATE OR REPLACE FUNCTION public.akses_saya(p_user_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_username text; v_jabatan text; v_sekbid bigint; v_super boolean;
    v_hal text[]; v_jab text[];
BEGIN
    SELECT username, jabatan INTO v_username, v_jabatan
    FROM public.osis_users WHERE id = p_user_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('halaman', '[]'::jsonb, 'sekbid_id', NULL, 'sekbid_nama', NULL, 'super', false);
    END IF;
    v_sekbid := public.osis_sekbid_dari_jabatan(v_jabatan);
    v_super := public.osis_is_super(v_username);
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
        'super', v_super
    );
END $$;

-- 5. set_akses: yang boleh bagi akses = super dari tabel
CREATE OR REPLACE FUNCTION public.set_akses(
    p_admin bigint, p_target bigint, p_halaman text[],
    p_sekbid_id bigint DEFAULT NULL, p_ubah_sekbid boolean DEFAULT false
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin text;
BEGIN
    SELECT username INTO v_admin FROM public.osis_users WHERE id = p_admin;
    IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_target) THEN
        RETURN 'ERR_NOT_FOUND';
    END IF;
    DELETE FROM public.osis_akses WHERE user_id = p_target;
    IF p_halaman IS NOT NULL THEN
        INSERT INTO public.osis_akses (user_id, halaman)
        SELECT DISTINCT p_target, btrim(h) FROM unnest(p_halaman) AS h
        WHERE btrim(h) <> ''
        ON CONFLICT DO NOTHING;
    END IF;
    IF p_ubah_sekbid THEN
        UPDATE public.osis_users SET sekbid_id = p_sekbid_id WHERE id = p_target;
    END IF;
    RETURN 'OK';
END $$;

-- 6. RPC tambah/cabut super (dipanggil super yang masih aktif)
CREATE OR REPLACE FUNCTION public.set_super(
    p_admin bigint, p_target bigint, p_jadikan_super boolean DEFAULT true
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin text; v_target text;
BEGIN
    SELECT username INTO v_admin FROM public.osis_users WHERE id = p_admin;
    IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    SELECT username INTO v_target FROM public.osis_users WHERE id = p_target;
    IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
    IF p_jadikan_super IS NOT FALSE THEN
        INSERT INTO public.osis_super_admins (username) VALUES (v_target)
        ON CONFLICT (username) DO NOTHING;
    ELSE
        IF lower(v_target) = lower(btrim(v_admin)) THEN RETURN 'ERR_SELF'; END IF;
        DELETE FROM public.osis_super_admins WHERE lower(username) = lower(v_target);
    END IF;
    RETURN 'OK';
END $$;
REVOKE EXECUTE ON FUNCTION public.set_super(bigint, bigint, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_super(bigint, bigint, boolean) TO anon;

-- 7. akses_matriks: auth dari tabel + kolom is_super per user
CREATE OR REPLACE FUNCTION public.akses_matriks(p_admin bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_admin text;
BEGIN
    SELECT username INTO v_admin FROM public.osis_users WHERE id = p_admin;
    IF NOT FOUND OR NOT public.osis_is_super(v_admin) THEN
        RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
    RETURN (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT u.id, u.username, u.nama, u.jabatan, u.angkatan,
            public.osis_sekbid_dari_jabatan(u.jabatan) AS sekbid_id,
            (SELECT s.nama FROM public.sekbid s WHERE s.id = public.osis_sekbid_dari_jabatan(u.jabatan)) AS sekbid_nama,
            public.osis_is_super(u.username) AS is_super,
            COALESCE((SELECT jsonb_agg(a.halaman ORDER BY a.halaman)
                    FROM public.osis_akses a WHERE a.user_id = u.id), '[]'::jsonb) AS halaman
        FROM public.osis_users u ORDER BY u.nama
    ) t);
END $$;
