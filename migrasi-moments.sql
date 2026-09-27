-- ============================================================
-- MIGRASI: halaman "Moments" (foto + video momen OSIS)
-- Jalankan SEKALI di Supabase SQL Editor. Idempotent & non-destruktif:
-- CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / OR REPLACE /
-- DROP POLICY IF EXISTS. Tidak menghapus tabel/kolom/data apa pun.
--
-- Konsep (lihat js/moments.js untuk kontrak frontend):
-- - DB hanya menyimpan METADATA (key/path relatif R2), bukan binary.
--   Key dipertahankan identik dengan pola folder R2: moments/xxx.jpg.
-- - 1 baris = 1 momen (1 foto ATAU 1 video + thumbnail opsional).
-- - media_type : 'photo' | 'video'
-- - category   : 'events' | 'random' (filter frontend All/Photos/
--   Videos/Events/Random; kategori baru tinggal tambah nilai +
--   chip di js/moments.js, tanpa ubah tabel lain).
-- - Upload binary via Worker presign (folder "moments" sudah masuk
--   allowlist worker/osis-media-presign.js) — JANGAN upload via kolom DB.
-- - Hak tulis: akun OSIS dengan hak 'moments' (super_admin lolos
--   otomatis via osis_bisa). Baca: publik (anon).
-- - Like/comment/share BELUM ada backend — frontend hanya sediakan
--   UI stub (Moments.aksi). Jangan tambah kolom palsu di sini.
-- ============================================================

-- ============ 1. TABEL ============
CREATE TABLE IF NOT EXISTS public.moments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    caption text NOT NULL DEFAULT '',
    event_name text NOT NULL DEFAULT '',
    media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
    media_key text NOT NULL DEFAULT '',
    thumb_key text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT 'random' CHECK (category IN ('events', 'random')),
    display_order integer NOT NULL DEFAULT 99,
    created_by bigint,
    pengunggah text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Kolom pengunggah untuk tabel lama yang dibuat sebelum migrasi-pengunggah
ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_moments_created ON public.moments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moments_order ON public.moments (display_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moments_type ON public.moments (media_type);
CREATE INDEX IF NOT EXISTS idx_moments_category ON public.moments (category);

ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;

-- Publik boleh lihat (halaman Moments bisa dibuka tanpa login)
DROP POLICY IF EXISTS "moments_public_select" ON public.moments;
CREATE POLICY "moments_public_select" ON public.moments
    FOR SELECT USING (true);

-- Insert/update/delete langsung di-revoke: cuma lewat function di bawah
-- (validasi akun OSIS + hak 'moments' di server, bukan di client).
DROP POLICY IF EXISTS "moments_public_insert" ON public.moments;

-- Snapshot "diupload oleh" otomatis dari osis_users.nama (pola migrasi-pengunggah.sql)
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.moments;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.moments
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();

-- ============ 2. RPC TULIS (SECURITY DEFINER) ============
-- Buat momen baru, BALIKIN ID (>0). Kode error negatif:
-- -1 bukan akun OSIS / tidak punya hak 'moments', -2 media_key kosong,
-- -3 tipe media tidak dikenal.
CREATE OR REPLACE FUNCTION public.buat_moment(
    p_user_id bigint,
    p_caption text,
    p_event_name text,
    p_media_type text,
    p_media_key text,
    p_thumb_key text,
    p_category text,
    p_display_order integer DEFAULT 99
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'moments') THEN
        RETURN -1;
    END IF;
    p_media_key := COALESCE(NULLIF(btrim(p_media_key), ''), '');
    IF p_media_key = '' THEN
        RETURN -2;
    END IF;
    p_media_type := lower(COALESCE(NULLIF(btrim(p_media_type), ''), 'photo'));
    IF p_media_type NOT IN ('photo', 'video') THEN
        RETURN -3;
    END IF;
    p_category := lower(COALESCE(NULLIF(btrim(p_category), ''), 'random'));
    IF p_category NOT IN ('events', 'random') THEN
        p_category := 'random';
    END IF;

    INSERT INTO public.moments
        (caption, event_name, media_type, media_key, thumb_key, category, display_order, created_by)
    VALUES
        (left(COALESCE(p_caption, ''), 500),
         left(COALESCE(p_event_name, ''), 80),
         p_media_type,
         left(p_media_key, 512),
         left(COALESCE(p_thumb_key, ''), 512),
         p_category,
         COALESCE(p_display_order, 99),
         p_user_id)
    RETURNING id INTO new_id;
    RETURN new_id;
END $$;

-- Update caption/event/kategori (media_key tidak bisa diganti: hapus + buat baru)
CREATE OR REPLACE FUNCTION public.update_moment(
    p_user_id bigint,
    p_id bigint,
    p_caption text,
    p_event_name text,
    p_category text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'moments') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    UPDATE public.moments
    SET caption = left(COALESCE(p_caption, caption), 500),
        event_name = left(COALESCE(p_event_name, event_name), 80),
        category = CASE
            WHEN lower(COALESCE(p_category, '')) IN ('events', 'random')
            THEN lower(p_category)
            ELSE category
        END
    WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Hapus momen (file R2 dihapus client via presign DELETE setelah RPC OK)
CREATE OR REPLACE FUNCTION public.hapus_moment(
    p_user_id bigint,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'moments') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.moments WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_moment(bigint, text, text, text, text, text, text, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_moment(bigint, bigint, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_moment(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_moment(bigint, text, text, text, text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.update_moment(bigint, bigint, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_moment(bigint, bigint) TO anon;
