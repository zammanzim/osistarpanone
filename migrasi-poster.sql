-- ============================================================
-- MIGRASI: halaman POSTER (feed foto + caption, arsip peringatan)
-- Jalankan SEKALI di Supabase SQL Editor. Aman di-run ulang.
-- ============================================================

-- ============ TABEL POSTER ============
CREATE TABLE IF NOT EXISTS public.poster (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL DEFAULT '',
    caption text NOT NULL DEFAULT '',
    foto text NOT NULL DEFAULT '',
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poster_created ON public.poster (created_at DESC);

ALTER TABLE public.poster ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "poster_public_select" ON public.poster;
CREATE POLICY "poster_public_select" ON public.poster
    FOR SELECT USING (true);

-- Insert/delete langsung di-revoke: cuma lewat function
DROP POLICY IF EXISTS "poster_public_insert" ON public.poster;

-- ============ RPCs (SECURITY DEFINER) ============
-- Buat poster baru, balikin id (>0). Error: -1 no auth, -2 caption kosong, -3 foto kosong.
CREATE OR REPLACE FUNCTION public.buat_poster(
    p_user_id bigint,
    p_judul text,
    p_caption text,
    p_foto text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'poster') THEN
        RETURN -1;
    END IF;
    p_caption := COALESCE(p_caption, '');
    IF btrim(p_caption) = '' AND btrim(COALESCE(p_judul, '')) = '' THEN
        RETURN -2;
    END IF;
    IF p_foto IS NULL OR btrim(p_foto) = '' THEN
        RETURN -3;
    END IF;

    INSERT INTO public.poster (judul, caption, foto, created_by)
    VALUES (
        left(COALESCE(NULLIF(btrim(p_judul), ''), ''), 80),
        left(p_caption, 500),
        left(btrim(p_foto), 300),
        p_user_id
    )
    RETURNING id INTO new_id;
    RETURN new_id;
END $$;

DROP FUNCTION IF EXISTS public.buat_poster(bigint, text, text);

CREATE OR REPLACE FUNCTION public.update_poster(
    p_user_id bigint,
    p_id bigint,
    p_judul text,
    p_caption text,
    p_foto text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'poster') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    UPDATE public.poster SET
        judul = left(COALESCE(NULLIF(btrim(p_judul), judul), judul), 80),
        caption = left(COALESCE(p_caption, caption), 500),
        foto = left(COALESCE(NULLIF(btrim(p_foto), ''), foto), 300)
    WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.hapus_poster(
    p_user_id bigint,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'poster') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.poster WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- ============ GRANT ============
REVOKE EXECUTE ON FUNCTION public.buat_poster(bigint, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_poster(bigint, bigint, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_poster(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_poster(bigint, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_poster(bigint, bigint, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_poster(bigint, bigint) TO anon;

-- ============ STORAGE: folder poster/ di bucket osis-foto ============
DROP POLICY IF EXISTS "osis_foto_poster_select" ON storage.objects;
CREATE POLICY "osis_foto_poster_select" ON storage.objects
    FOR SELECT TO anon
    USING (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'poster');
DROP POLICY IF EXISTS "osis_foto_poster_insert" ON storage.objects;
CREATE POLICY "osis_foto_poster_insert" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'poster');
DROP POLICY IF EXISTS "osis_foto_poster_delete" ON storage.objects;
CREATE POLICY "osis_foto_poster_delete" ON storage.objects
    FOR DELETE TO anon
    USING (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'poster');

-- ============ AKSES: sekbid juga boleh kelola poster ============
UPDATE public.jabatan_akses
SET halaman = (
    SELECT array_agg(DISTINCT h)
    FROM unnest(halaman || ARRAY['poster']) AS h
)
WHERE jabatan = 'sekbid'
  AND NOT ('poster' = ANY(halaman));
