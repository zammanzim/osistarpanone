-- ============================================================
-- MIGRASI: halaman "Feed" (scrolling foto + video ala IG,
-- like, komen, share). Jalankan SEKALI di Supabase SQL Editor.
-- Idempotent & non-destruktif: CREATE IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
--
-- Konsep:
-- - 1 baris feed_posts = 1 postingan (1 foto ATAU 1 video + caption).
-- - Upload BEBAS untuk semua akun OSIS (tanpa hak khusus);
--   hapus = pemilik postingan / super_admin.
-- - Like: siapa aja (user_key = osis:<id> / biasa:<id> / dev:<device>).
-- - Komen: wajib login (osis / biasa); hapus = pemilik komen / akun OSIS.
-- - Share: tombol share HP + hitung jumlah share.
-- - DB hanya menyimpan metadata/key R2 (folder feed/), bukan binary.
-- - Tulis SELALU lewat RPC SECURITY DEFINER di bawah; baca publik.
-- ============================================================

-- ============ 1. TABEL ============
CREATE TABLE IF NOT EXISTS public.feed_posts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_by bigint,
    pengunggah text NOT NULL DEFAULT '',
    media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
    media_key text NOT NULL DEFAULT '',
    thumb_key text NOT NULL DEFAULT '',
    caption text NOT NULL DEFAULT '',
    share_count integer NOT NULL DEFAULT 0,
    kategori text NOT NULL DEFAULT 'aib' CHECK (kategori IN ('aib', 'serius', 'kocak')),
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Kolom kategori buat DB lama (migrasi idempotent)
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS kategori text NOT NULL DEFAULT 'aib';
UPDATE public.feed_posts SET kategori = 'aib' WHERE kategori IS NULL OR btrim(kategori) = '' OR kategori = 'random' OR kategori NOT IN ('aib', 'serius', 'kocak');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_posts_kategori_check') THEN
    ALTER TABLE public.feed_posts DROP CONSTRAINT feed_posts_kategori_check;
  END IF;
END $$;
ALTER TABLE public.feed_posts ADD CONSTRAINT feed_posts_kategori_check CHECK (kategori IN ('aib', 'serius', 'kocak'));
CREATE INDEX IF NOT EXISTS idx_feed_posts_kategori ON public.feed_posts (kategori);

CREATE TABLE IF NOT EXISTS public.feed_likes (
    post_id bigint NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
    user_key text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_key)
);

CREATE TABLE IF NOT EXISTS public.feed_comments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id bigint NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
    user_key text NOT NULL DEFAULT '',
    nama text NOT NULL DEFAULT 'Anonim',
    teks text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_posts_created ON public.feed_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_likes_post ON public.feed_likes (post_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON public.feed_comments (post_id, created_at ASC);

ALTER TABLE public.feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_comments ENABLE ROW LEVEL SECURITY;

-- Publik boleh lihat (halaman Feed bisa dibuka tanpa login)
DROP POLICY IF EXISTS "feed_posts_public_select" ON public.feed_posts;
CREATE POLICY "feed_posts_public_select" ON public.feed_posts
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "feed_likes_public_select" ON public.feed_likes;
CREATE POLICY "feed_likes_public_select" ON public.feed_likes
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "feed_comments_public_select" ON public.feed_comments;
CREATE POLICY "feed_comments_public_select" ON public.feed_comments
    FOR SELECT USING (true);

-- Insert/update/delete langsung di-revoke: cuma lewat RPC di bawah.
DROP POLICY IF EXISTS "feed_posts_public_insert" ON public.feed_posts;
DROP POLICY IF EXISTS "feed_likes_public_insert" ON public.feed_likes;
DROP POLICY IF EXISTS "feed_comments_public_insert" ON public.feed_comments;

-- Snapshot "diupload oleh" otomatis dari osis_users.nama
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.feed_posts;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.feed_posts
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();

-- ============ 2. RPC TULIS (SECURITY DEFINER) ============
-- Buat postingan baru. BEBAS untuk semua akun OSIS (tanpa hak khusus).
-- BALIKIN ID (>0). Kode error negatif:
-- -1 bukan akun OSIS, -2 media_key kosong, -3 tipe media tidak dikenal.
CREATE OR REPLACE FUNCTION public.feed_post_buat(
    p_user_id bigint,
    p_media_type text,
    p_media_key text,
    p_thumb_key text,
    p_caption text,
    p_kategori text DEFAULT 'aib'
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
    v_kat text := lower(COALESCE(NULLIF(btrim(p_kategori), ''), 'aib'));
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
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
    IF v_kat NOT IN ('aib', 'serius', 'kocak') THEN
        v_kat := 'aib';
    END IF;
    INSERT INTO public.feed_posts
        (created_by, media_type, media_key, thumb_key, caption, kategori)
    VALUES
        (p_user_id,
         p_media_type,
         left(p_media_key, 512),
         left(COALESCE(p_thumb_key, ''), 512),
         left(COALESCE(p_caption, ''), 500),
         v_kat)
    RETURNING id INTO new_id;
    RETURN new_id;
END $$;

-- Hapus postingan (media R2 dihapus client setelah RPC OK).
-- Boleh: pemilik postingan / super_admin.
CREATE OR REPLACE FUNCTION public.feed_post_hapus(
    p_user_id bigint,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_username text;
    v_owner bigint;
BEGIN
    SELECT username INTO v_username
    FROM public.osis_users WHERE id = p_user_id;
    IF NOT FOUND THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    SELECT created_by INTO v_owner
    FROM public.feed_posts WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN 'ERR_NOT_FOUND';
    END IF;
    IF v_owner IS DISTINCT FROM p_user_id
        AND NOT public.osis_is_super(v_username) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.feed_posts WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Daftar postingan + hitungan + status like user (1 panggilan buat scroll).
-- p_user_key kosong = tanpa status like. BALIKIN jsonb array.
CREATE OR REPLACE FUNCTION public.feed_posts_list(
    p_limit integer DEFAULT 8,
    p_offset integer DEFAULT 0,
    p_user_key text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
DECLARE
    hasil jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO hasil
    FROM (
        SELECT
            p.id,
            p.created_by,
            p.media_type,
            p.media_key,
            p.caption,
            p.pengunggah,
            p.share_count,
            p.created_at,
            COALESCE(NULLIF(p.kategori, 'random'), 'aib') AS kategori,
            (SELECT count(*) FROM public.feed_likes l WHERE l.post_id = p.id) AS like_count,
            (SELECT count(*) FROM public.feed_comments c WHERE c.post_id = p.id) AS comment_count,
            CASE
                WHEN COALESCE(btrim(p_user_key), '') = '' THEN false
                ELSE EXISTS (
                    SELECT 1 FROM public.feed_likes l
                    WHERE l.post_id = p.id AND l.user_key = p_user_key
                )
            END AS liked
        FROM public.feed_posts p
        ORDER BY p.created_at DESC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 20))
        OFFSET GREATEST(0, COALESCE(p_offset, 0))
    ) t;
    RETURN hasil;
END $$;

-- Toggle like. BALIKIN jumlah like terbaru (>=0), atau teks ERR_*.
CREATE OR REPLACE FUNCTION public.feed_like_toggle(
    p_post_id bigint,
    p_user_key text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_key text := left(COALESCE(btrim(p_user_key), ''), 120);
    v_count integer;
BEGIN
    IF v_key = '' THEN
        RETURN 'ERR_NO_KEY';
    END IF;
    PERFORM 1 FROM public.feed_posts WHERE id = p_post_id;
    IF NOT FOUND THEN
        RETURN 'ERR_NOT_FOUND';
    END IF;
    IF EXISTS (SELECT 1 FROM public.feed_likes WHERE post_id = p_post_id AND user_key = v_key) THEN
        DELETE FROM public.feed_likes WHERE post_id = p_post_id AND user_key = v_key;
    ELSE
        INSERT INTO public.feed_likes (post_id, user_key) VALUES (p_post_id, v_key);
    END IF;
    SELECT count(*)::integer INTO v_count FROM public.feed_likes WHERE post_id = p_post_id;
    RETURN v_count::text;
END $$;

-- Tambah komen (wajib login di client; nama snapshot max 80, teks max 300).
-- BALIKIN ID (>0). Kode error negatif: -1 data kurang, -2 postingan hilang.
CREATE OR REPLACE FUNCTION public.feed_komen_tambah(
    p_post_id bigint,
    p_user_key text,
    p_nama text,
    p_teks text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
BEGIN
    p_user_key := left(COALESCE(btrim(p_user_key), ''), 120);
    p_nama := left(COALESCE(NULLIF(btrim(p_nama), ''), 'Anonim'), 80);
    p_teks := left(COALESCE(btrim(p_teks), ''), 300);
    IF p_user_key = '' OR p_teks = '' THEN
        RETURN -1;
    END IF;
    PERFORM 1 FROM public.feed_posts WHERE id = p_post_id;
    IF NOT FOUND THEN
        RETURN -2;
    END IF;
    INSERT INTO public.feed_comments (post_id, user_key, nama, teks)
    VALUES (p_post_id, p_user_key, p_nama, p_teks)
    RETURNING id INTO new_id;
    RETURN new_id;
END $$;

-- Daftar komen 1 postingan (tertua di atas). BALIKIN jsonb array.
CREATE OR REPLACE FUNCTION public.feed_komen_list(
    p_post_id bigint,
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
DECLARE
    hasil jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO hasil
    FROM (
        SELECT id, user_key, nama, teks, created_at
        FROM public.feed_comments
        WHERE post_id = p_post_id
        ORDER BY created_at ASC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
        OFFSET GREATEST(0, COALESCE(p_offset, 0))
    ) t;
    RETURN hasil;
END $$;

-- Hapus komen. Boleh: pemilik komen (user_key cocok) / akun OSIS mana pun.
CREATE OR REPLACE FUNCTION public.feed_komen_hapus(
    p_user_id bigint,
    p_user_key text,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_pemilik text;
    v_osis boolean;
BEGIN
    SELECT user_key INTO v_pemilik
    FROM public.feed_comments WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN 'ERR_NOT_FOUND';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) INTO v_osis;
    IF v_pemilik IS DISTINCT FROM COALESCE(NULLIF(btrim(p_user_key), ''), '###') AND NOT v_osis THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.feed_comments WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Catat 1x share (tanpa auth, dipanggil pas user pencet share).
CREATE OR REPLACE FUNCTION public.feed_share_cat(
    p_post_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.feed_posts
    SET share_count = COALESCE(share_count, 0) + 1
    WHERE id = p_post_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- 1 postingan buat deep-link (#/feed?id=...). BALIKIN objek / null.
CREATE OR REPLACE FUNCTION public.feed_post_satu(
    p_id bigint,
    p_user_key text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
DECLARE
    hasil jsonb;
BEGIN
    SELECT to_jsonb(t) INTO hasil
    FROM (
        SELECT
            p.id,
            p.created_by,
            p.media_type,
            p.media_key,
            p.caption,
            p.pengunggah,
            p.share_count,
            p.created_at,
            COALESCE(NULLIF(p.kategori, 'random'), 'aib') AS kategori,
            (SELECT count(*) FROM public.feed_likes l WHERE l.post_id = p.id) AS like_count,
            (SELECT count(*) FROM public.feed_comments c WHERE c.post_id = p.id) AS comment_count,
            CASE
                WHEN COALESCE(btrim(p_user_key), '') = '' THEN false
                ELSE EXISTS (
                    SELECT 1 FROM public.feed_likes l
                    WHERE l.post_id = p.id AND l.user_key = p_user_key
                )
            END AS liked
        FROM public.feed_posts p
        WHERE p.id = p_id
    ) t;
    RETURN hasil;
END $$;

REVOKE EXECUTE ON FUNCTION public.feed_post_buat(bigint, text, text, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.feed_post_hapus(bigint, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.feed_posts_list(integer, integer, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.feed_like_toggle(bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.feed_komen_tambah(bigint, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.feed_komen_list(bigint, integer, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.feed_komen_hapus(bigint, text, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.feed_share_cat(bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.feed_post_satu(bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.feed_post_buat(bigint, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.feed_post_hapus(bigint, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.feed_posts_list(integer, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION public.feed_like_toggle(bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.feed_komen_tambah(bigint, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.feed_komen_list(bigint, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.feed_komen_hapus(bigint, text, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.feed_share_cat(bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.feed_post_satu(bigint, text) TO anon;
