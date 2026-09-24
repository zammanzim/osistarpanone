-- ============================================================
-- MIGRASI: informasi harian (pengganti broadcast grup)
-- Jalankan SEKALI di Supabase SQL Editor.
--
-- Halaman: /osis/informasi (login OSIS wajib).
-- Card shareable: /osis/informasi?id=<id> -> tombol "Salin Link".
-- Kelola (buat/ubah/hapus): hak "informasi" (diatur super_admin di Akses).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.informasi (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL DEFAULT '',
    kepada text NOT NULL DEFAULT '',
    pembuka text NOT NULL DEFAULT '',
    tanggal text NOT NULL DEFAULT '',
    jam text NOT NULL DEFAULT '',
    tempat text NOT NULL DEFAULT '',
    bawaan text NOT NULL DEFAULT '',
    penutup text NOT NULL DEFAULT '',
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_informasi_created ON public.informasi (created_at DESC);

-- Kolom subjudul (teks kecil di bawah judul, cth: "Di dalam ruangan").
ALTER TABLE public.informasi ADD COLUMN IF NOT EXISTS subjudul text NOT NULL DEFAULT '';

ALTER TABLE public.informasi ENABLE ROW LEVEL SECURITY;

-- Baca: pengurus login (anon key dipakai bareng browser login) boleh lihat.
-- Tulis: cuma lewat function (cek hak "informasi").
DROP POLICY IF EXISTS "informasi_osis_select" ON public.informasi;
CREATE POLICY "informasi_osis_select" ON public.informasi
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "informasi_public_insert" ON public.informasi;

-- Buat informasi baru, balikin id (>0). Error: -1 no auth, -2 judul kosong.
-- Hapus overload lama (tanpa subjudul) biar tidak ganda.
DROP FUNCTION IF EXISTS public.buat_informasi(bigint, text, text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.buat_informasi(
    p_user_id bigint,
    p_judul text,
    p_subjudul text DEFAULT '',
    p_kepada text DEFAULT '',
    p_pembuka text DEFAULT '',
    p_tanggal text DEFAULT '',
    p_jam text DEFAULT '',
    p_tempat text DEFAULT '',
    p_bawaan text DEFAULT '',
    p_penutup text DEFAULT ''
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'informasi') THEN
        RETURN -1;
    END IF;
    IF p_judul IS NULL OR btrim(p_judul) = '' THEN
        RETURN -2;
    END IF;
    INSERT INTO public.informasi (judul, subjudul, kepada, pembuka, tanggal, jam, tempat, bawaan, penutup, created_by)
    VALUES (
        left(btrim(p_judul), 80),
        left(COALESCE(p_subjudul, ''), 80),
        left(COALESCE(p_kepada, ''), 200),
        left(COALESCE(p_pembuka, ''), 2000),
        left(COALESCE(p_tanggal, ''), 80),
        left(COALESCE(p_jam, ''), 80),
        left(COALESCE(p_tempat, ''), 200),
        left(COALESCE(p_bawaan, ''), 200),
        left(COALESCE(p_penutup, ''), 2000),
        p_user_id
    )
    RETURNING id INTO new_id;
    RETURN new_id;
END $$;

-- Ubah informasi. Error: ERR_NO_AUTH / ERR_NOT_FOUND.
DROP FUNCTION IF EXISTS public.update_informasi(bigint, bigint, text, text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.update_informasi(
    p_user_id bigint,
    p_id bigint,
    p_judul text,
    p_subjudul text DEFAULT NULL,
    p_kepada text DEFAULT NULL,
    p_pembuka text DEFAULT NULL,
    p_tanggal text DEFAULT NULL,
    p_jam text DEFAULT NULL,
    p_tempat text DEFAULT NULL,
    p_bawaan text DEFAULT NULL,
    p_penutup text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'informasi') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
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
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Hapus informasi. Error: ERR_NO_AUTH / ERR_NOT_FOUND.
CREATE OR REPLACE FUNCTION public.hapus_informasi(
    p_user_id bigint,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'informasi') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.informasi WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_informasi(bigint, text, text, text, text, text, text, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_informasi(bigint, bigint, text, text, text, text, text, text, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_informasi(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_informasi(bigint, text, text, text, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_informasi(bigint, bigint, text, text, text, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_informasi(bigint, bigint) TO anon;
