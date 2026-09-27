-- ============================================================
-- MIGRASI: Informasi & Pengumuman Publik
-- OSIS TARPAN ONE — SMK Taruna Harapan 1 Cipatat
--
-- Halaman: view #/informasi di index.html (bisa diakses publik tanpa login).
-- Kelola: Hak "informasi" (atau role super admin).
-- Berbeda dengan /osis/informasi.html yang khusus internal OSIS.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.informasi_publik (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL DEFAULT '',
    kategori text NOT NULL DEFAULT 'pengumuman' CHECK (kategori IN ('pengumuman', 'libur', 'acara', 'penting')),
    ringkasan text NOT NULL DEFAULT '',
    isi text NOT NULL DEFAULT '',
    tanggal_mulai text NOT NULL DEFAULT '',
    tanggal_selesai text NOT NULL DEFAULT '',
    waktu text NOT NULL DEFAULT '',
    lokasi text NOT NULL DEFAULT '',
    sasaran text NOT NULL DEFAULT '',
    link_lampiran text NOT NULL DEFAULT '',
    label_lampiran text NOT NULL DEFAULT '',
    is_pinned boolean NOT NULL DEFAULT false,
    pengunggah text NOT NULL DEFAULT 'OSIS TARPAN ONE',
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_info_publik_pinned ON public.informasi_publik (is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_info_publik_kategori ON public.informasi_publik (kategori);

-- Kolom slug: link cantik ?id=acara_rapat_sekolah (unik, bisa dikustom).
-- Kosong ('') = tanpa slug (tetap bisa dibuka via id angka).
ALTER TABLE public.informasi_publik ADD COLUMN IF NOT EXISTS slug text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_info_publik_slug ON public.informasi_publik (slug) WHERE (slug <> '');

ALTER TABLE public.informasi_publik ENABLE ROW LEVEL SECURITY;

-- Baca: Terbuka untuk umum (publik)
DROP POLICY IF EXISTS "info_publik_select" ON public.informasi_publik;
CREATE POLICY "info_publik_select" ON public.informasi_publik
    FOR SELECT USING (true);

-- Buat Informasi Publik (cek hak 'informasi' atau super_admin)
-- Hapus overload lama (tanpa slug) biar tidak ganda.
DROP FUNCTION IF EXISTS public.buat_informasi_publik(bigint, text, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.buat_informasi_publik(
    p_user_id bigint,
    p_judul text,
    p_kategori text DEFAULT 'pengumuman',
    p_ringkasan text DEFAULT '',
    p_isi text DEFAULT '',
    p_tanggal_mulai text DEFAULT '',
    p_tanggal_selesai text DEFAULT '',
    p_waktu text DEFAULT '',
    p_lokasi text DEFAULT '',
    p_sasaran text DEFAULT '',
    p_link_lampiran text DEFAULT '',
    p_label_lampiran text DEFAULT '',
    p_is_pinned boolean DEFAULT false,
    p_slug text DEFAULT ''
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
    v_pengunggah text;
    v_kat text;
    v_slug text;
    n integer;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'informasi') THEN
        RETURN -1;
    END IF;
    IF p_judul IS NULL OR btrim(p_judul) = '' THEN
        RETURN -2;
    END IF;

    v_kat := lower(COALESCE(p_kategori, 'pengumuman'));
    IF v_kat NOT IN ('pengumuman', 'libur', 'acara', 'penting') THEN
        v_kat := 'pengumuman';
    END IF;

    SELECT COALESCE(NULLIF(btrim(nama), ''), username) INTO v_pengunggah
    FROM public.osis_users WHERE id = p_user_id;

    -- Slug: pakai kustom user, kosong = otomatis dari judul, jamin unik.
    v_slug := public.slugify_teks(p_slug);
    IF v_slug IS NULL OR v_slug = '' THEN
        v_slug := public.slugify_teks(p_judul);
    END IF;
    IF v_slug IS NULL OR v_slug = '' THEN
        v_slug := 'info';
    END IF;
    n := 0;
    WHILE EXISTS (SELECT 1 FROM public.informasi_publik WHERE slug = v_slug || CASE WHEN n = 0 THEN '' ELSE '-' || n END) LOOP
        n := n + 1;
    END LOOP;
    IF n > 0 THEN
        v_slug := v_slug || '-' || n;
    END IF;

    INSERT INTO public.informasi_publik (
        judul, kategori, ringkasan, isi,
        tanggal_mulai, tanggal_selesai, waktu, lokasi, sasaran,
        link_lampiran, label_lampiran, is_pinned, slug,
        pengunggah, created_by, created_at, updated_at
    )
    VALUES (
        left(btrim(p_judul), 150),
        v_kat,
        left(COALESCE(p_ringkasan, ''), 300),
        COALESCE(p_isi, ''),
        left(COALESCE(p_tanggal_mulai, ''), 60),
        left(COALESCE(p_tanggal_selesai, ''), 60),
        left(COALESCE(p_waktu, ''), 60),
        left(COALESCE(p_lokasi, ''), 120),
        left(COALESCE(p_sasaran, ''), 120),
        left(COALESCE(p_link_lampiran, ''), 500),
        left(COALESCE(p_label_lampiran, ''), 80),
        COALESCE(p_is_pinned, false),
        v_slug,
        COALESCE(v_pengunggah, 'OSIS TARPAN ONE'),
        p_user_id,
        now(),
        now()
    )
    RETURNING id INTO new_id;

    RETURN new_id;
END $$;

-- Update Informasi Publik
-- Hapus overload lama (tanpa slug) biar tidak ganda.
DROP FUNCTION IF EXISTS public.update_informasi_publik(bigint, bigint, text, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.update_informasi_publik(
    p_user_id bigint,
    p_id bigint,
    p_judul text,
    p_kategori text DEFAULT NULL,
    p_ringkasan text DEFAULT NULL,
    p_isi text DEFAULT NULL,
    p_tanggal_mulai text DEFAULT NULL,
    p_tanggal_selesai text DEFAULT NULL,
    p_waktu text DEFAULT NULL,
    p_lokasi text DEFAULT NULL,
    p_sasaran text DEFAULT NULL,
    p_link_lampiran text DEFAULT NULL,
    p_label_lampiran text DEFAULT NULL,
    p_is_pinned boolean DEFAULT NULL,
    p_slug text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_kat text;
    v_slug text;
    n integer;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'informasi') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;

    IF p_kategori IS NOT NULL THEN
        v_kat := lower(btrim(p_kategori));
        IF v_kat NOT IN ('pengumuman', 'libur', 'acara', 'penting') THEN
            v_kat := 'pengumuman';
        END IF;
    END IF;

    -- Slug: NULL = biarkan lama, '' = biarkan lama, isi = normalkan + jamin unik.
    IF p_slug IS NOT NULL THEN
        v_slug := public.slugify_teks(p_slug);
        IF v_slug IS NULL OR v_slug = '' THEN
            v_slug := NULL;
        ELSE
            n := 0;
            WHILE EXISTS (SELECT 1 FROM public.informasi_publik WHERE slug = v_slug || CASE WHEN n = 0 THEN '' ELSE '-' || n END AND id <> p_id) LOOP
                n := n + 1;
            END LOOP;
            IF n > 0 THEN
                v_slug := v_slug || '-' || n;
            END IF;
        END IF;
    END IF;

    UPDATE public.informasi_publik SET
        judul = left(COALESCE(NULLIF(btrim(p_judul), ''), judul), 150),
        kategori = COALESCE(v_kat, kategori),
        ringkasan = CASE WHEN p_ringkasan IS NULL THEN ringkasan ELSE left(p_ringkasan, 300) END,
        isi = CASE WHEN p_isi IS NULL THEN isi ELSE p_isi END,
        tanggal_mulai = CASE WHEN p_tanggal_mulai IS NULL THEN tanggal_mulai ELSE left(p_tanggal_mulai, 60) END,
        tanggal_selesai = CASE WHEN p_tanggal_selesai IS NULL THEN tanggal_selesai ELSE left(p_tanggal_selesai, 60) END,
        waktu = CASE WHEN p_waktu IS NULL THEN waktu ELSE left(p_waktu, 60) END,
        lokasi = CASE WHEN p_lokasi IS NULL THEN lokasi ELSE left(p_lokasi, 120) END,
        sasaran = CASE WHEN p_sasaran IS NULL THEN sasaran ELSE left(p_sasaran, 120) END,
        link_lampiran = CASE WHEN p_link_lampiran IS NULL THEN link_lampiran ELSE left(p_link_lampiran, 500) END,
        label_lampiran = CASE WHEN p_label_lampiran IS NULL THEN label_lampiran ELSE left(p_label_lampiran, 80) END,
        is_pinned = CASE WHEN p_is_pinned IS NULL THEN is_pinned ELSE p_is_pinned END,
        slug = COALESCE(v_slug, slug),
        updated_at = now()
    WHERE id = p_id;

    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Hapus Informasi Publik
CREATE OR REPLACE FUNCTION public.hapus_informasi_publik(
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

    DELETE FROM public.informasi_publik WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE ALL ON FUNCTION public.buat_informasi_publik FROM public;
REVOKE ALL ON FUNCTION public.update_informasi_publik FROM public;
REVOKE ALL ON FUNCTION public.hapus_informasi_publik FROM public;
GRANT EXECUTE ON FUNCTION public.buat_informasi_publik TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_informasi_publik TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_informasi_publik TO anon, authenticated;

-- Seed contoh data jika tabel masih kosong
INSERT INTO public.informasi_publik (judul, kategori, ringkasan, isi, tanggal_mulai, tanggal_selesai, waktu, lokasi, sasaran, is_pinned, pengunggah)
SELECT
    'Pemberitahuan Jadwal Libur Awal Ramadhan 1448 H',
    'libur',
    'Sehubungan dengan awal bulan suci Ramadhan, kegiatan belajar mengajar ditiadakan sesuai kalender pendidikan.',
    'Diberitahukan kepada seluruh siswa-siswi SMK Taruna Harapan 1 Cipatat bahwa kegiatan belajar mengajar (KBM) diliburkan pada tanggal yang telah ditentukan. Siswa diharapkan tetap menjaga ibadah dan memanfaatkan waktu libur untuk kegiatan positif di rumah.',
    '18 Februari 2026',
    '21 Februari 2026',
    'Sepanjang Hari',
    'Rumah Masing-masing',
    'Seluruh Siswa & Guru',
    true,
    'OSIS TARPAN ONE'
WHERE NOT EXISTS (SELECT 1 FROM public.informasi_publik WHERE judul LIKE '%Libur Awal Ramadhan%');

INSERT INTO public.informasi_publik (judul, kategori, ringkasan, isi, tanggal_mulai, tanggal_selesai, waktu, lokasi, sasaran, is_pinned, pengunggah)
SELECT
    'Pekan Olahraga & Seni (PORSENI) Antar Kelas',
    'acara',
    'Ajang perlombaan olahraga, e-sports, dan kesenian antar kelas SMK Taruna Harapan 1 Cipatat.',
    'OSIS TARPAN ONE mengadakan kegiatan Porseni dengan berbagai cabang lomba: Futsal, Voli, Mobile Legends, Akustik, dan Tari Tradisional. Setiap perwakilan kelas wajib mendaftarkan timnya ke panitia OSIS seksi bidang terkait.',
    '15 Oktober 2026',
    '18 Oktober 2026',
    '08.00 - 15.00 WIB',
    'Lapangan Utama & Aula SMK Taruna Harapan 1',
    'Seluruh Siswa Kelas X, XI, XII',
    false,
    'OSIS TARPAN ONE'
WHERE NOT EXISTS (SELECT 1 FROM public.informasi_publik WHERE judul LIKE '%PORSENI%');

-- ============================================================
-- SLUG LINK CANTIK (?id=acara_rapat_sekolah)
-- Normalkan teks jadi slug: kecil, spasi/simbol jadi garis bawah.
-- ============================================================
CREATE OR REPLACE FUNCTION public.slugify_teks(t text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT regexp_replace(
        regexp_replace(
            translate(
                lower(trim(COALESCE(t, ''))),
                'àáâãäåèéêëìíîïòóôõöùúûüýÿñç',
                'aaaaaaeeeeiiiiooooouuuuyync'
            ),
            '[^a-z0-9]+', '_', 'g'
        ),
        '^_+|_+$', '', 'g'
    );
$$;

-- Isi slug yang masih kosong dari judul + jamin unik.
DO $$
DECLARE
    r record;
    base text;
    cand text;
    n integer;
BEGIN
    FOR r IN SELECT id, judul FROM public.informasi_publik WHERE slug IS NULL OR slug = '' ORDER BY id LOOP
        base := public.slugify_teks(r.judul);
        IF base IS NULL OR base = '' THEN
            base := 'info-' || r.id;
        END IF;
        cand := base;
        n := 0;
        WHILE EXISTS (SELECT 1 FROM public.informasi_publik WHERE slug = cand AND id <> r.id) LOOP
            n := n + 1;
            cand := base || '-' || n;
        END LOOP;
        UPDATE public.informasi_publik SET slug = cand, updated_at = now() WHERE id = r.id;
    END LOOP;
END $$;
