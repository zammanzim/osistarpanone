-- ============================================================
-- WEB OSIS TARPAN ONE — SCHEMA LENGKAP (RUN SEMUA SEKALI)
-- Jalankan SEMUA di Supabase SQL Editor (project OSIS).
-- Project pake localStorage custom auth (BUKAN Supabase Auth),
-- jadi RLS cuma anon key, bukan auth.role() = 'authenticated'.
--
-- Aman dijalanin ulang (idempotent): CREATE IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
--
-- Isi:
-- 1. Tabel lagu_requests  (request lagu radio)
-- 2. Tabel aspirasi       (kotak suara siswa)
-- 3. Tabel visitor        (kunjungan unik per perangkat + info device)
-- 4. Function limit + insert (SECURITY DEFINER, anti-bypass)
-- 5. Grant function ke anon
-- 6. Tabel gallery        (dokumentasi kegiatan: judul + deskripsi + foto)
-- 7. Storage policy       (folder gallery/ di bucket osis-foto)
-- 8. Site content         (teks editable hero/visi/misi/pembina/dll)
-- 9. Web foto + storage   (web/ & angkatan/ buat foto editable)
-- 10. Prestasi & Kegiatan home (DB-driven, fotos jsonb, display_order)
-- 11. Agenda per Sekbid (rencana, folder osis/agenda)
--
-- NOTE VISITOR:
-- - device_id = id perangkat MURNI (ga pernah berubah jadi key akun).
-- - name = nama pemilik kunjungan: kosong kalo anonim, nickname kalo
--   login guest, nama anggota kalo login OSIS. Sekali terisi, kunjungan
--   anonim berikutnya ga bakal ngehapus nama itu.
-- - Batas "hari" pake Asia/Jakarta (WIB), BUKAN UTC. Kalo pake UTC,
--   hari ganti jam 07:00 WIB -> kunjungan pagi kehitung dobel walau
--   perangkatnya sama.
-- ============================================================

-- ============ 1. TABEL REQUEST LAGU ============
CREATE TABLE IF NOT EXISTS public.lagu_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id text NOT NULL DEFAULT '',
    judul text NOT NULL,
    penyanyi text NOT NULL,
    pesan text NOT NULL DEFAULT '',
    nama text NOT NULL DEFAULT 'Anonim',
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lagu_requests ADD COLUMN IF NOT EXISTS pesan text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_lagu_requests_created ON public.lagu_requests (created_at DESC);

ALTER TABLE public.lagu_requests ENABLE ROW LEVEL SECURITY;

-- Anon boleh lihat playlist
DROP POLICY IF EXISTS "lagu_public_select" ON public.lagu_requests;
CREATE POLICY "lagu_public_select" ON public.lagu_requests
    FOR SELECT USING (true);

-- Insert langsung di-revoke: cuma lewat function kirim_lagu_terbatas
DROP POLICY IF EXISTS "lagu_public_insert" ON public.lagu_requests;

-- ============ 2. TABEL ASPIRASI ============
CREATE TABLE IF NOT EXISTS public.aspirasi (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id text NOT NULL DEFAULT '',
    nama text NOT NULL DEFAULT 'Anonim',
    kelas text NOT NULL DEFAULT '-',
    isi text NOT NULL,
    is_private boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aspirasi_created ON public.aspirasi (created_at DESC);

ALTER TABLE public.aspirasi ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT '';
ALTER TABLE public.aspirasi ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

ALTER TABLE public.aspirasi ENABLE ROW LEVEL SECURITY;

-- Anon boleh lihat suara yang masuk (list di web)
DROP POLICY IF EXISTS "aspirasi_public_select" ON public.aspirasi;
CREATE POLICY "aspirasi_public_select" ON public.aspirasi
    FOR SELECT USING (true);

-- Insert/update/delete langsung di-revoke: cuma lewat function
-- kirim_aspirasi_terbatas & hapus_aspirasi_own (SECURITY DEFINER)
DROP POLICY IF EXISTS "aspirasi_public_insert" ON public.aspirasi;

-- ============ 3. TABEL VISITOR (kunjungan unik per perangkat) ============
CREATE TABLE IF NOT EXISTS public.visitor (
    device_id text PRIMARY KEY,
    jumlah integer NOT NULL DEFAULT 1,
    name text NOT NULL DEFAULT '',
    label text NOT NULL DEFAULT '',
    masuk timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now()
);

-- Nama pemilik kunjungan (anonim = kosong, guest = nickname, OSIS = nama anggota)
ALTER TABLE public.visitor ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
-- Kolom nama perangkat (dari user-agent) buat list di popup
ALTER TABLE public.visitor ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '';
-- Info perangkat lengkap: tipe, user-agent mentah, resolusi layar
ALTER TABLE public.visitor ADD COLUMN IF NOT EXISTS tipe text NOT NULL DEFAULT '';
ALTER TABLE public.visitor ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT '';
ALTER TABLE public.visitor ADD COLUMN IF NOT EXISTS resolusi text NOT NULL DEFAULT '';

ALTER TABLE public.visitor ENABLE ROW LEVEL SECURITY;

-- Anon boleh lihat data (buat counter + list di popup)
DROP POLICY IF EXISTS "visitor_public_select" ON public.visitor;
CREATE POLICY "visitor_public_select" ON public.visitor
    FOR SELECT USING (true);

-- ============ 4. FUNCTION LIMIT + INSERT (SECURITY DEFINER) ============
-- SECURITY DEFINER: jalan sebagai pemilik tabel, bypass RLS, jadi
-- limit HARUS lewat function ini — ga bisa bypass dari client.

-- Kirim aspirasi: maks 3 per device per hari, support private
CREATE OR REPLACE FUNCTION public.kirim_aspirasi_terbatas(
    p_device_id text,
    p_nama text,
    p_kelas text,
    p_isi text,
    p_is_private boolean DEFAULT false,
    p_batas_harian integer DEFAULT 3
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    n integer;
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN 'ERR_NO_DEVICE';
    END IF;
    SELECT count(*) INTO n FROM public.aspirasi
    WHERE device_id = p_device_id AND created_at::date = CURRENT_DATE;
    IF n >= p_batas_harian THEN
        RETURN 'ERR_LIMIT';
    END IF;
    INSERT INTO public.aspirasi (device_id, nama, kelas, isi, is_private)
    VALUES (p_device_id, p_nama, p_kelas, p_isi, COALESCE(p_is_private, false));
    RETURN 'OK';
END $$;

DROP FUNCTION IF EXISTS public.kirim_aspirasi_terbatas(text, text, text, text, integer);

-- Kirim request lagu: maks 5 per device per hari
CREATE OR REPLACE FUNCTION public.kirim_lagu_terbatas(
    p_device_id text,
    p_judul text,
    p_penyanyi text,
    p_pesan text,
    p_nama text,
    p_batas_harian integer DEFAULT 5
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    n integer;
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN 'ERR_NO_DEVICE';
    END IF;
    SELECT count(*) INTO n FROM public.lagu_requests
    WHERE device_id = p_device_id AND created_at::date = CURRENT_DATE;
    IF n >= p_batas_harian THEN
        RETURN 'ERR_LIMIT';
    END IF;
    INSERT INTO public.lagu_requests (device_id, judul, penyanyi, pesan, nama)
    VALUES (p_device_id, p_judul, p_penyanyi, COALESCE(NULLIF(btrim(p_pesan), ''), ''), p_nama);
    RETURN 'OK';
END $$;

DROP FUNCTION IF EXISTS public.kirim_lagu_terbatas(text, text, text, text, integer);

-- Hapus function visitor signature lama biar ga nyangkut overload
DROP FUNCTION IF EXISTS public.tambah_visitor_unik(text);
DROP FUNCTION IF EXISTS public.tambah_visitor_unik(text, text);
DROP FUNCTION IF EXISTS public.tambah_visitor_unik(text, text, text, text, text);

-- Catat kunjungan unik per perangkat: jumlah nambah 1x per hari WIB.
-- `masuk` = jam pertama online hari ini (reset tiap ganti hari WIB),
-- `last_seen` = terakhir aktif (di-update tiap load halaman).
-- p_key      : device id perangkat (selalu device id, bukan key akun)
-- p_label    : nama perangkat dari user-agent (iPhone, model Android, dll)
-- p_tipe     : Mobile / Tablet / Desktop
-- p_ua       : user-agent mentah
-- p_resolusi : resolusi layar (cth: 360x800)
-- p_name     : nama pemilik (nickname guest / nama anggota OSIS, kosong = anonim)
CREATE OR REPLACE FUNCTION public.tambah_visitor_unik(
    p_key text,
    p_label text DEFAULT '',
    p_tipe text DEFAULT '',
    p_ua text DEFAULT '',
    p_resolusi text DEFAULT '',
    p_name text DEFAULT ''
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    total bigint;
    hari_wib date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
    IF p_key IS NULL OR p_key = '' THEN
        RETURN 0;
    END IF;

    INSERT INTO public.visitor (device_id, jumlah, name, label, tipe, user_agent, resolusi, masuk, last_seen)
    VALUES (
        p_key, 1,
        COALESCE(NULLIF(p_name, ''), ''),
        COALESCE(NULLIF(p_label, ''), 'Unknown'),
        COALESCE(NULLIF(p_tipe, ''), ''),
        COALESCE(NULLIF(p_ua, ''), ''),
        COALESCE(NULLIF(p_resolusi, ''), ''),
        now(), now()
    )
    ON CONFLICT (device_id) DO UPDATE SET
        jumlah = CASE
            WHEN (visitor.last_seen AT TIME ZONE 'Asia/Jakarta')::date = hari_wib
                THEN visitor.jumlah
            ELSE visitor.jumlah + 1
        END,
        -- Name sekali terisi ga bakal ketimpa kunjungan anonim
        name = CASE
            WHEN COALESCE(NULLIF(p_name, ''), '') <> '' THEN p_name
            ELSE visitor.name
        END,
        label = CASE
            WHEN COALESCE(NULLIF(p_label, ''), '') <> '' THEN p_label
            ELSE visitor.label
        END,
        tipe = CASE
            WHEN COALESCE(NULLIF(p_tipe, ''), '') <> '' THEN p_tipe
            ELSE visitor.tipe
        END,
        user_agent = CASE
            WHEN COALESCE(NULLIF(p_ua, ''), '') <> '' THEN p_ua
            ELSE visitor.user_agent
        END,
        resolusi = CASE
            WHEN COALESCE(NULLIF(p_resolusi, ''), '') <> '' THEN p_resolusi
            ELSE visitor.resolusi
        END,
        masuk = CASE
            WHEN (visitor.last_seen AT TIME ZONE 'Asia/Jakarta')::date = hari_wib
                THEN visitor.masuk
            ELSE now()
        END,
        last_seen = now();

    SELECT COALESCE(SUM(jumlah), 0) INTO total FROM public.visitor;
    RETURN total;
END $$;

-- Hapus aspirasi milik sendiri, cuma bisa dalam 1 jam pertama
CREATE OR REPLACE FUNCTION public.hapus_aspirasi_own(
    p_device_id text,
    p_id bigint
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN 'ERR_NO_DEVICE';
    END IF;
    DELETE FROM public.aspirasi
    WHERE id = p_id
      AND device_id = p_device_id
      AND created_at > now() - interval '1 hour';
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    PERFORM 1 FROM public.aspirasi WHERE id = p_id;
    IF FOUND THEN
        RETURN 'ERR_EXPIRED';
    END IF;
    RETURN 'ERR_FORBIDDEN';
END $$;

-- Hapus request lagu milik sendiri, cuma bisa dalam 1 jam pertama
CREATE OR REPLACE FUNCTION public.hapus_lagu_own(
    p_device_id text,
    p_id bigint
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN 'ERR_NO_DEVICE';
    END IF;
    DELETE FROM public.lagu_requests
    WHERE id = p_id
      AND device_id = p_device_id
      AND created_at > now() - interval '1 hour';
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    PERFORM 1 FROM public.lagu_requests WHERE id = p_id;
    IF FOUND THEN
        RETURN 'ERR_EXPIRED';
    END IF;
    RETURN 'ERR_FORBIDDEN';
END $$;

-- Hapus aspirasi oleh OSIS (boleh hapus punya siapa aja, validasi id OSIS)
CREATE OR REPLACE FUNCTION public.hapus_aspirasi_osis(
    p_user_id bigint,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.aspirasi WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Hapus request lagu oleh OSIS (boleh hapus punya siapa aja)
CREATE OR REPLACE FUNCTION public.hapus_lagu_osis(
    p_user_id bigint,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.lagu_requests WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- ============ 5. GRANT FUNCTION (anon) ============
REVOKE EXECUTE ON FUNCTION public.kirim_aspirasi_terbatas(text, text, text, text, boolean, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.kirim_lagu_terbatas(text, text, text, text, text, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.tambah_visitor_unik(text, text, text, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_aspirasi_own(text, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_lagu_own(text, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_aspirasi_osis(bigint, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_lagu_osis(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.kirim_aspirasi_terbatas(text, text, text, text, boolean, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.kirim_lagu_terbatas(text, text, text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.tambah_visitor_unik(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_aspirasi_own(text, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_lagu_own(text, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_aspirasi_osis(bigint, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_lagu_osis(bigint, bigint) TO anon;

-- ============ 6. TABEL GALLERY (dokumentasi kegiatan) ============
-- Satu baris = satu kegiatan. `fotos` = jsonb array path foto di bucket.
-- Cuma akun OSIS (id ada di osis_users) boleh nambah/hapus �
-- divalidasi di function, bukan di client.
CREATE TABLE IF NOT EXISTS public.gallery (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL,
    fotos jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Subjudul / deskripsi singkat kegiatan
ALTER TABLE public.gallery ADD COLUMN IF NOT EXISTS deskripsi text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_gallery_created ON public.gallery (created_at DESC);

ALTER TABLE public.gallery ENABLE ROW LEVEL SECURITY;

-- Publik boleh lihat galeri
DROP POLICY IF EXISTS "gallery_public_select" ON public.gallery;
CREATE POLICY "gallery_public_select" ON public.gallery
    FOR SELECT USING (true);

-- Insert/delete langsung di-revoke: cuma lewat function (validasi akun)
DROP POLICY IF EXISTS "gallery_public_insert" ON public.gallery;

-- Buat kegiatan baru, BALIKIN ID barunya (>0). Kode error negatif:
-- -1 bukan akun OSIS, -2 judul kosong, -3 foto kosong.
CREATE OR REPLACE FUNCTION public.buat_gallery(
    p_user_id bigint,
    p_judul text,
    p_deskripsi text,
    p_fotos jsonb
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN -1;
    END IF;
    p_judul := COALESCE(NULLIF(btrim(p_judul), ''), '');
    IF p_judul = '' THEN
        RETURN -2;
    END IF;
    IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array'
       OR jsonb_array_length(p_fotos) = 0 THEN
        RETURN -3;
    END IF;

    INSERT INTO public.gallery (judul, deskripsi, fotos, created_by)
    VALUES (left(p_judul, 80), left(COALESCE(NULLIF(btrim(p_deskripsi), ''), ''), 140), p_fotos, p_user_id)
    RETURNING id INTO new_id;
    RETURN new_id;
END $$;

-- Hapus signature lama biar ga nyangkut overload
DROP FUNCTION IF EXISTS public.buat_gallery(bigint, text, text, jsonb);
DROP FUNCTION IF EXISTS public.buat_gallery(bigint, text, jsonb);
DROP FUNCTION IF EXISTS public.buat_gallery(bigint, text);

-- Tambah 1 foto ke kegiatan yang udah ada (append ke array fotos)
CREATE OR REPLACE FUNCTION public.galeri_add_foto(
    p_user_id bigint,
    p_id bigint,
    p_path text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF p_path IS NULL OR btrim(p_path) = '' THEN
        RETURN 'ERR_NO_FOTO';
    END IF;

    UPDATE public.gallery
    SET fotos = COALESCE(fotos, '[]'::jsonb) || to_jsonb(left(p_path, 300))
    WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Update judul & subjudul kegiatan (dipanggil pas selesai ngetik)
CREATE OR REPLACE FUNCTION public.galeri_update_meta(
    p_user_id bigint,
    p_id bigint,
    p_judul text,
    p_deskripsi text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    judul_akhir text;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    judul_akhir := COALESCE(NULLIF(btrim(p_judul), ''), 'Tanpa Judul');

    UPDATE public.gallery
    SET judul = left(judul_akhir, 80),
        deskripsi = left(COALESCE(NULLIF(btrim(p_deskripsi), ''), ''), 140)
    WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Update fotos galeri (hapus 1 foto ? auto hapus kalau kosong di client, tapi RPC ini untuk update array)
CREATE OR REPLACE FUNCTION public.galeri_update_fotos(
    p_user_id bigint,
    p_id bigint,
    p_fotos jsonb
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' THEN
        RETURN 'ERR_NO_FOTO';
    END IF;
    UPDATE public.gallery SET fotos = p_fotos WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Hapus kegiatan galeri (khusus akun OSIS)
CREATE OR REPLACE FUNCTION public.hapus_gallery(
    p_user_id bigint,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.gallery WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_gallery(bigint, text, text, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.galeri_add_foto(bigint, bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.galeri_update_meta(bigint, bigint, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.galeri_update_fotos(bigint, bigint, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_gallery(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_gallery(bigint, text, text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.galeri_add_foto(bigint, bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.galeri_update_meta(bigint, bigint, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.galeri_update_fotos(bigint, bigint, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_gallery(bigint, bigint) TO anon;

-- ============ 7. STORAGE � FOLDER GALLERY DI BUCKET osis-foto ============
-- Bucket osis-foto pake policy per folder. Folder gallery/ harus
-- diizinin khusus biar upload & hapus foto galeri bisa dari client.
DROP POLICY IF EXISTS "osis_foto_gallery_select" ON storage.objects;
CREATE POLICY "osis_foto_gallery_select" ON storage.objects
    FOR SELECT TO anon
    USING (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'gallery');

DROP POLICY IF EXISTS "osis_foto_gallery_insert" ON storage.objects;
CREATE POLICY "osis_foto_gallery_insert" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'gallery');

DROP POLICY IF EXISTS "osis_foto_gallery_delete" ON storage.objects;
CREATE POLICY "osis_foto_gallery_delete" ON storage.objects
    FOR DELETE TO anon
    USING (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'gallery');

-- ============ 8. SITE CONTENT � TEKS EDITABLE (HERO/VISI/MISI/PEMBINA/DLL) ============
-- Satu baris per kunci (cth: hero_badge, visi_text, misi_1_title ...).
-- Cuma akun OSIS boleh nulis, baca bebas.
CREATE TABLE IF NOT EXISTS public.site_content (
    kunci text PRIMARY KEY,
    nilai text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by bigint
);

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_content_public_select" ON public.site_content;
CREATE POLICY "site_content_public_select" ON public.site_content
    FOR SELECT USING (true);

-- Insert/update langsung di-revoke: cuma lewat function save_site_text
DROP POLICY IF EXISTS "site_content_public_insert" ON public.site_content;

CREATE OR REPLACE FUNCTION public.save_site_text(
    p_user_id bigint,
    p_key text,
    p_value text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    p_key := COALESCE(NULLIF(btrim(p_key), ''), '');
    IF p_key = '' THEN
        RETURN 'ERR_NO_KEY';
    END IF;
    -- batasi panjang biar ga di-abuse, tapi longgar (up to 800 char)
    p_value := COALESCE(p_value, '');
    IF char_length(p_value) > 2000 THEN
        p_value := left(p_value, 2000);
    END IF;

    INSERT INTO public.site_content (kunci, nilai, updated_at, updated_by)
    VALUES (p_key, p_value, now(), p_user_id)
    ON CONFLICT (kunci) DO UPDATE SET
        nilai = EXCLUDED.nilai,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;
    RETURN 'OK';
END $$;

REVOKE EXECUTE ON FUNCTION public.save_site_text(bigint, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.save_site_text(bigint, text, text) TO anon;

-- ============ 9. WEB_FOTO + STORAGE WEB/ANGKATAN (buat foto editable) ============
-- Foto prestasi/kegiatan/hero/pembina pake tabel web_foto + bucket osis-foto/web/
-- dan foto angkatan pake bucket angkatan/. Kasih policy biar anon (OSIS
-- client) bisa upsert � validasi OSIS Tetep di client (SiteEdit cek mode).
CREATE TABLE IF NOT EXISTS public.web_foto (
    kunci text PRIMARY KEY,
    path text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.web_foto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "web_foto_public_select" ON public.web_foto;
CREATE POLICY "web_foto_public_select" ON public.web_foto
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "web_foto_public_insert" ON public.web_foto;
CREATE POLICY "web_foto_public_insert" ON public.web_foto
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "web_foto_public_update" ON public.web_foto;
CREATE POLICY "web_foto_public_update" ON public.web_foto
    FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "web_foto_public_delete" ON public.web_foto;
CREATE POLICY "web_foto_public_delete" ON public.web_foto
    FOR DELETE USING (true);

-- Storage: folder web/
DROP POLICY IF EXISTS "osis_foto_web_select" ON storage.objects;
CREATE POLICY "osis_foto_web_select" ON storage.objects
    FOR SELECT TO anon USING (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'web');
DROP POLICY IF EXISTS "osis_foto_web_insert" ON storage.objects;
CREATE POLICY "osis_foto_web_insert" ON storage.objects
    FOR INSERT TO anon WITH CHECK (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'web');
DROP POLICY IF EXISTS "osis_foto_web_delete" ON storage.objects;
CREATE POLICY "osis_foto_web_delete" ON storage.objects
    FOR DELETE TO anon USING (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'web');

-- Storage: folder angkatan/ (foto jejak organisasi)
DROP POLICY IF EXISTS "osis_foto_angkatan_select" ON storage.objects;
CREATE POLICY "osis_foto_angkatan_select" ON storage.objects
    FOR SELECT TO anon USING (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'angkatan');
DROP POLICY IF EXISTS "osis_foto_angkatan_insert" ON storage.objects;
CREATE POLICY "osis_foto_angkatan_insert" ON storage.objects
    FOR INSERT TO anon WITH CHECK (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'angkatan');
DROP POLICY IF EXISTS "osis_foto_angkatan_delete" ON storage.objects;
CREATE POLICY "osis_foto_angkatan_delete" ON storage.objects
    FOR DELETE TO anon USING (bucket_id = 'osis-foto' AND (storage.foldername(name))[1] = 'angkatan');

-- ============ 10. PRESTASI & KEGIATAN HOME (DB-driven) ============
-- HTML cuma container kosong, data dari DB. Fotos = jsonb array [{path,caption}] biar n foto fleksibel.
CREATE TABLE IF NOT EXISTS public.prestasi (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tag text NOT NULL,
    caption text NOT NULL DEFAULT '',
    fotos jsonb NOT NULL DEFAULT '[]'::jsonb,
    display_order integer NOT NULL DEFAULT 99,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prestasi_order ON public.prestasi (display_order, created_at);
ALTER TABLE public.prestasi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prestasi_public_select" ON public.prestasi;
CREATE POLICY "prestasi_public_select" ON public.prestasi FOR SELECT USING (true);
DROP POLICY IF EXISTS "prestasi_public_insert" ON public.prestasi;

CREATE TABLE IF NOT EXISTS public.kegiatan (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL,
    deskripsi text NOT NULL DEFAULT '',
    badge text NOT NULL DEFAULT '',
    fotos jsonb NOT NULL DEFAULT '[]'::jsonb,
    display_order integer NOT NULL DEFAULT 99,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kegiatan_order ON public.kegiatan (display_order, created_at);
ALTER TABLE public.kegiatan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kegiatan_public_select" ON public.kegiatan;
CREATE POLICY "kegiatan_public_select" ON public.kegiatan FOR SELECT USING (true);
DROP POLICY IF EXISTS "kegiatan_public_insert" ON public.kegiatan;

-- RPCs � SECURITY DEFINER, cek osis_users
CREATE OR REPLACE FUNCTION public.buat_prestasi(p_user_id bigint, p_tag text, p_caption text, p_fotos jsonb, p_display_order integer DEFAULT 99)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    p_tag := left(COALESCE(NULLIF(btrim(p_tag),''), 'Tanpa Tag'), 40);
    p_caption := left(COALESCE(p_caption,''), 200);
    IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' THEN p_fotos := '[]'::jsonb; END IF;
    INSERT INTO public.prestasi (tag, caption, fotos, display_order, created_by)
    VALUES (p_tag, p_caption, p_fotos, COALESCE(p_display_order,99), p_user_id) RETURNING id INTO nid;
    RETURN nid;
END $$;
CREATE OR REPLACE FUNCTION public.update_prestasi(p_user_id bigint, p_id bigint, p_tag text, p_caption text, p_fotos jsonb, p_display_order integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.prestasi SET tag=left(COALESCE(NULLIF(btrim(p_tag),tag),tag),40), caption=left(COALESCE(p_caption,caption),200), fotos=COALESCE(p_fotos,fotos), display_order=COALESCE(p_display_order,display_order) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;
CREATE OR REPLACE FUNCTION public.hapus_prestasi(p_user_id bigint, p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.prestasi WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.buat_kegiatan(p_user_id bigint, p_judul text, p_deskripsi text, p_badge text, p_fotos jsonb, p_display_order integer DEFAULT 99)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    p_judul := left(COALESCE(NULLIF(btrim(p_judul),''), 'Tanpa Judul'), 80);
    p_deskripsi := left(COALESCE(p_deskripsi,''), 200);
    p_badge := left(COALESCE(NULLIF(btrim(p_badge),''), ''), 12);
    IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' THEN p_fotos := '[]'::jsonb; END IF;
    INSERT INTO public.kegiatan (judul, deskripsi, badge, fotos, display_order, created_by)
    VALUES (p_judul, p_deskripsi, p_badge, p_fotos, COALESCE(p_display_order,99), p_user_id) RETURNING id INTO nid;
    RETURN nid;
END $$;
CREATE OR REPLACE FUNCTION public.update_kegiatan(p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text, p_badge text, p_fotos jsonb, p_display_order integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.kegiatan SET judul=left(COALESCE(NULLIF(btrim(p_judul),judul),judul),80), deskripsi=left(COALESCE(p_deskripsi,deskripsi),200), badge=left(COALESCE(p_badge,badge),12), fotos=COALESCE(p_fotos,fotos), display_order=COALESCE(p_display_order,display_order) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;
CREATE OR REPLACE FUNCTION public.hapus_kegiatan(p_user_id bigint, p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.kegiatan WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_prestasi(bigint, text, text, jsonb, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_prestasi(bigint, bigint, text, text, jsonb, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_prestasi(bigint, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.buat_kegiatan(bigint, text, text, text, jsonb, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_kegiatan(bigint, bigint, text, text, text, jsonb, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_kegiatan(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_prestasi(bigint, text, text, jsonb, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.update_prestasi(bigint, bigint, text, text, jsonb, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_prestasi(bigint, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.buat_kegiatan(bigint, text, text, text, jsonb, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.update_kegiatan(bigint, bigint, text, text, text, jsonb, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_kegiatan(bigint, bigint) TO anon;

-- Storage prestasi/ & kegiatan/
DROP POLICY IF EXISTS "osis_foto_prestasi_select" ON storage.objects;
CREATE POLICY "osis_foto_prestasi_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='prestasi');
DROP POLICY IF EXISTS "osis_foto_prestasi_insert" ON storage.objects;
CREATE POLICY "osis_foto_prestasi_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='prestasi');
DROP POLICY IF EXISTS "osis_foto_prestasi_delete" ON storage.objects;
CREATE POLICY "osis_foto_prestasi_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='prestasi');
DROP POLICY IF EXISTS "osis_foto_kegiatan_select" ON storage.objects;
CREATE POLICY "osis_foto_kegiatan_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='kegiatan');
DROP POLICY IF EXISTS "osis_foto_kegiatan_insert" ON storage.objects;
CREATE POLICY "osis_foto_kegiatan_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='kegiatan');
DROP POLICY IF EXISTS "osis_foto_kegiatan_delete" ON storage.objects;
CREATE POLICY "osis_foto_kegiatan_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='kegiatan');

-- Seed dari data hardcode lama (hanya jika kosong)
INSERT INTO public.prestasi (tag, caption, fotos, display_order)
SELECT * FROM (VALUES
    ('Kemah Tangkas 1.0','Momen Kemah Tangkas 1.0','[{"path":"web/prestasi3.jpg","caption":"Momen Kemah Tangkas 1.0"}]'::jsonb,1),
    ('Jambore OSIS','Jambore OSIS tahun ini','[{"path":"web/prestasi2.jpg","caption":"Jambore OSIS tahun ini"}]'::jsonb,2),
    ('Paskibra','Tim Paskibra kebanggaan','[{"path":"web/prestasi1.jpg","caption":"Tim Paskibra kebanggaan"}]'::jsonb,3),
    ('Teater','Pentas Teater OSIS','[{"path":"web/prestasi4.jpg","caption":"Pentas Teater OSIS"}]'::jsonb,4)
) AS v(tag,caption,fotos,display_order)
WHERE NOT EXISTS (SELECT 1 FROM public.prestasi);

INSERT INTO public.kegiatan (judul, deskripsi, badge, fotos, display_order)
SELECT * FROM (VALUES
    ('Makrab OSIS 2026','Meningkatkan rasa kekeluargaan antar pengurus','MAKRAB','[{"path":"web/makrab1.jpg","caption":"Makrab - kebersamaan pengurus"},{"path":"web/makrab2.jpg","caption":"Makrab - sesi keakraban"},{"path":"web/makrab3.jpg","caption":"Makrab - api unggun"},{"path":"web/makrab4.jpg","caption":"Makrab - foto bersama"}]'::jsonb,1),
    ('Takjilin OSIS 2026','Membangun jiwa kewirausahaan & berbagi','TAKJILIN','[{"path":"web/takjilin1.jpg","caption":"Takjilin - persiapan takjil"},{"path":"web/takjilin2.jpg","caption":"Takjilin - berbagi takjil"},{"path":"web/takjilin3.jpg","caption":"Takjilin - stand bazar"},{"path":"web/takjilin4.jpg","caption":"Takjilin - kebersamaan"}]'::jsonb,2),
    ('Pentas Seni Antar Kelas','Ajang ekspresi bakat dan kreativitas siswa','PESAK','[{"path":"web/pesak1.jpg","caption":"PESAK - penampilan tari"},{"path":"web/pesak2.jpg","caption":"PESAK - band sekolah"},{"path":"web/pesak3.jpg","caption":"PESAK - drama kelas"},{"path":"web/pesak4.jpg","caption":"PESAK - foto bersama"}]'::jsonb,3)
) AS v(judul,deskripsi,badge,fotos,display_order)
WHERE NOT EXISTS (SELECT 1 FROM public.kegiatan);

-- ============ 11. AGENDA PER SEKBID (rencana, folder /osis) ============
CREATE TABLE IF NOT EXISTS public.sekbid_agenda (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sekbid_id bigint NOT NULL REFERENCES public.sekbid(id) ON DELETE CASCADE,
    judul text NOT NULL,
    deskripsi text NOT NULL DEFAULT '',
    tanggal date,
    lokasi text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'selesai' CHECK (status IN ('rencana','proses','selesai','batal')),
    fotos jsonb NOT NULL DEFAULT '[]'::jsonb,
    display_order integer NOT NULL DEFAULT 99,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_sekbid ON public.sekbid_agenda (sekbid_id, display_order, tanggal);
CREATE INDEX IF NOT EXISTS idx_agenda_tanggal ON public.sekbid_agenda (tanggal DESC);
ALTER TABLE public.sekbid_agenda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agenda_public_select" ON public.sekbid_agenda;
CREATE POLICY "agenda_public_select" ON public.sekbid_agenda FOR SELECT USING (true);
DROP POLICY IF EXISTS "agenda_public_insert" ON public.sekbid_agenda;

CREATE OR REPLACE FUNCTION public.buat_agenda(p_user_id bigint, p_sekbid_id bigint, p_judul text, p_deskripsi text, p_tanggal date, p_lokasi text, p_status text, p_fotos jsonb, p_display_order integer DEFAULT 99)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    IF p_sekbid_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sekbid WHERE id=p_sekbid_id) THEN RETURN -2; END IF;
    p_judul := left(COALESCE(NULLIF(btrim(p_judul),''),'Tanpa Judul'), 80);
    p_deskripsi := left(COALESCE(p_deskripsi,''), 500);
    p_lokasi := left(COALESCE(p_lokasi,''), 80);
    p_status := COALESCE(NULLIF(btrim(p_status),''), 'selesai');
    IF p_status NOT IN ('rencana','proses','selesai','batal') THEN p_status := 'selesai'; END IF;
    IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' THEN p_fotos := '[]'::jsonb; END IF;
    INSERT INTO public.sekbid_agenda (sekbid_id, judul, deskripsi, tanggal, lokasi, status, fotos, display_order, created_by)
    VALUES (p_sekbid_id, p_judul, p_deskripsi, p_tanggal, p_lokasi, p_status, p_fotos, COALESCE(p_display_order,99), p_user_id) RETURNING id INTO nid;
    RETURN nid;
END $$;
CREATE OR REPLACE FUNCTION public.update_agenda(p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text, p_tanggal date, p_lokasi text, p_status text, p_fotos jsonb, p_display_order integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.sekbid_agenda SET judul=left(COALESCE(NULLIF(btrim(p_judul),judul),judul),80), deskripsi=left(COALESCE(p_deskripsi,deskripsi),500), tanggal=COALESCE(p_tanggal,tanggal), lokasi=left(COALESCE(p_lokasi,lokasi),80), status=COALESCE(NULLIF(btrim(p_status),status),status), fotos=COALESCE(p_fotos,fotos), display_order=COALESCE(p_display_order,display_order) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;
CREATE OR REPLACE FUNCTION public.hapus_agenda(p_user_id bigint, p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.sekbid_agenda WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;
REVOKE EXECUTE ON FUNCTION public.buat_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_agenda(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.update_agenda(bigint, bigint, text, text, date, text, text, jsonb, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_agenda(bigint, bigint) TO anon;

-- Storage agenda/
DROP POLICY IF EXISTS "osis_foto_agenda_select" ON storage.objects;
CREATE POLICY "osis_foto_agenda_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='agenda');
DROP POLICY IF EXISTS "osis_foto_agenda_insert" ON storage.objects;
CREATE POLICY "osis_foto_agenda_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='agenda');
DROP POLICY IF EXISTS "osis_foto_agenda_delete" ON storage.objects;
CREATE POLICY "osis_foto_agenda_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='agenda');

-- Cleanup keys lama yang sekarang pindah ke tabel prestasi/kegiatan (jalanin setelah seed & verifikasi)
DELETE FROM public.site_content WHERE kunci LIKE 'prestasi\_%' ESCAPE '\' OR kunci LIKE 'kegiatan\_%' ESCAPE '\' OR kunci IN ('makrab1_caption','makrab2_caption','makrab3_caption','makrab4_caption','takjilin1_caption','takjilin2_caption','takjilin3_caption','takjilin4_caption','pesak1_caption','pesak2_caption','pesak3_caption','pesak4_caption','prestasi_1_tag','prestasi_2_tag','prestasi_3_tag','prestasi_4_tag','prestasi_1_caption','prestasi_2_caption','prestasi_3_caption','prestasi_4_caption','kegiatan_1_title','kegiatan_2_title','kegiatan_3_title','kegiatan_1_desc','kegiatan_2_desc','kegiatan_3_desc');
DELETE FROM public.web_foto WHERE kunci IN ('prestasi1','prestasi2','prestasi3','prestasi4','makrab1','makrab2','makrab3','makrab4','takjilin1','takjilin2','takjilin3','takjilin4','pesak1','pesak2','pesak3','pesak4');

-- Bersihin sisa objek eksperimen sebelumnya (ganti desain)
DROP TABLE IF EXISTS public.guests CASCADE;
DROP FUNCTION IF EXISTS public.register_guest(text, text);
DROP TABLE IF EXISTS public.tamu CASCADE;
DROP FUNCTION IF EXISTS public.daftar_tamu(text, text);

-- ============ 12. PROFIL OSIS (halaman osis/profil) ============
-- Tabel osis_users dibuat di luar file ini (id, username, password, nama,
-- jabatan). Tambahan kolom buat profil: foto PP (path storage) + bio.
-- Pastikan tabel ada (idempotent, tidak merusak data lama), lalu tambah kolom.
CREATE TABLE IF NOT EXISTS public.osis_users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL UNIQUE,
    password text NOT NULL DEFAULT '',
    nama text NOT NULL DEFAULT '',
    jabatan text NOT NULL DEFAULT ''
);
ALTER TABLE public.osis_users ADD COLUMN IF NOT EXISTS foto text NOT NULL DEFAULT '';
ALTER TABLE public.osis_users ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';

-- Update nama + bio + foto PP (khusus pemilik akun, p_user_id = id sendiri)
CREATE OR REPLACE FUNCTION public.update_osis_profil(
    p_user_id bigint,
    p_nama text,
    p_bio text,
    p_foto text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    p_nama := COALESCE(NULLIF(btrim(p_nama), ''), '');
    IF p_nama = '' THEN
        RETURN 'ERR_NO_NAMA';
    END IF;
    UPDATE public.osis_users
    SET nama = left(p_nama, 80),
        bio = left(COALESCE(p_bio, ''), 200),
        foto = left(COALESCE(p_foto, ''), 300)
    WHERE id = p_user_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Ganti username (harus unik, min 3 karakter)
CREATE OR REPLACE FUNCTION public.ganti_osis_username(
    p_user_id bigint,
    p_username text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    p_username := COALESCE(NULLIF(btrim(p_username), ''), '');
    IF char_length(p_username) < 3 OR char_length(p_username) > 30 THEN
        RETURN 'ERR_INVALID';
    END IF;
    IF EXISTS (SELECT 1 FROM public.osis_users WHERE username = p_username AND id <> p_user_id) THEN
        RETURN 'ERR_TAKEN';
    END IF;
    UPDATE public.osis_users SET username = p_username WHERE id = p_user_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Ganti password (verifikasi password lama, baru min 4 karakter)
CREATE OR REPLACE FUNCTION public.ganti_osis_password(
    p_user_id bigint,
    p_old text,
    p_new text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    cur_pw text;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS
        (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    SELECT password INTO cur_pw FROM public.osis_users WHERE id = p_user_id;
    IF cur_pw IS DISTINCT FROM COALESCE(p_old, '') THEN
        RETURN 'ERR_WRONG';
    END IF;
    IF char_length(COALESCE(p_new, '')) < 4 OR char_length(COALESCE(p_new, '')) > 100 THEN
        RETURN 'ERR_INVALID';
    END IF;
    UPDATE public.osis_users SET password = p_new WHERE id = p_user_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.update_osis_profil(bigint, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.ganti_osis_username(bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.ganti_osis_password(bigint, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_osis_profil(bigint, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.ganti_osis_username(bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.ganti_osis_password(bigint, text, text) TO anon;

-- Storage profil/ (PP) di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_profil_select" ON storage.objects;
CREATE POLICY "osis_foto_profil_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='profil');
DROP POLICY IF EXISTS "osis_foto_profil_insert" ON storage.objects;
CREATE POLICY "osis_foto_profil_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='profil');
DROP POLICY IF EXISTS "osis_foto_profil_delete" ON storage.objects;
CREATE POLICY "osis_foto_profil_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='profil');

-- ============ 13. DATA ANGGOTA & KEPENGURUSAN (halaman osis/anggota) ============
-- Tabel pimpinan/anggota/sekbid dibuat di luar file ini (project lama).
-- Tambahan: foto per anggota. Tulis langsung via anon (ikut pola lama di
-- js/db.js: simpanPimpinan/tambahAnggota/updateSekbid � bukan RPC).
ALTER TABLE public.anggota ADD COLUMN IF NOT EXISTS foto text NOT NULL DEFAULT '';

-- Storage anggota/ (foto per anggota) di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_anggota_select" ON storage.objects;
CREATE POLICY "osis_foto_anggota_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='anggota');
DROP POLICY IF EXISTS "osis_foto_anggota_insert" ON storage.objects;
CREATE POLICY "osis_foto_anggota_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='anggota');
DROP POLICY IF EXISTS "osis_foto_anggota_delete" ON storage.objects;
CREATE POLICY "osis_foto_anggota_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='anggota');

-- Storage sekbid/ (foto sekbid/BPH) di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_sekbid_select" ON storage.objects;
CREATE POLICY "osis_foto_sekbid_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='sekbid');
DROP POLICY IF EXISTS "osis_foto_sekbid_insert" ON storage.objects;
CREATE POLICY "osis_foto_sekbid_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='sekbid');
DROP POLICY IF EXISTS "osis_foto_sekbid_delete" ON storage.objects;
CREATE POLICY "osis_foto_sekbid_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='sekbid');

-- Storage pimpinan/ (ketua/wakil � selama ini upload tanpa policy khusus)
DROP POLICY IF EXISTS "osis_foto_pimpinan_select" ON storage.objects;
CREATE POLICY "osis_foto_pimpinan_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='pimpinan');
DROP POLICY IF EXISTS "osis_foto_pimpinan_insert" ON storage.objects;
CREATE POLICY "osis_foto_pimpinan_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='pimpinan');
DROP POLICY IF EXISTS "osis_foto_pimpinan_delete" ON storage.objects;
CREATE POLICY "osis_foto_pimpinan_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='pimpinan');

-- ============ 14. NOTULENSI RAPAT (halaman osis/notulensi) ============
-- Satu baris = satu notulensi. `tindak_lanjut` = jsonb array
-- {tugas, pic, deadline, status}. `lampiran` = jsonb array {path, caption}
-- kayak fotos agenda. Status: rencana/selesai/belum_tindaklanjut/batal.
CREATE TABLE IF NOT EXISTS public.rapat_notulensi (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL DEFAULT '',
    tanggal date,
    waktu_mulai text NOT NULL DEFAULT '',
    waktu_selesai text NOT NULL DEFAULT '',
    lokasi text NOT NULL DEFAULT '',
    divisi text NOT NULL DEFAULT '',
    pimpinan text NOT NULL DEFAULT '',
    notulis text NOT NULL DEFAULT '',
    peserta text NOT NULL DEFAULT '',
    agenda_topik text NOT NULL DEFAULT '',
    isi_pembahasan text NOT NULL DEFAULT '',
    keputusan text NOT NULL DEFAULT '',
    tindak_lanjut jsonb NOT NULL DEFAULT '[]'::jsonb,
    lampiran jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'selesai',
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notulensi_tanggal ON public.rapat_notulensi (tanggal DESC);
ALTER TABLE public.rapat_notulensi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notulensi_public_select" ON public.rapat_notulensi;
CREATE POLICY "notulensi_public_select" ON public.rapat_notulensi FOR SELECT USING (true);
DROP POLICY IF EXISTS "notulensi_public_insert" ON public.rapat_notulensi;

CREATE OR REPLACE FUNCTION public.buat_notulensi(
    p_user_id bigint, p_judul text, p_tanggal date, p_waktu_mulai text, p_waktu_selesai text,
    p_lokasi text, p_divisi text, p_pimpinan text, p_notulis text, p_peserta text,
    p_agenda_topik text, p_isi_pembahasan text, p_keputusan text, p_tindak_lanjut jsonb,
    p_lampiran jsonb, p_status text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    p_judul := left(COALESCE(NULLIF(btrim(p_judul),''),'Tanpa Judul'), 120);
    IF p_tindak_lanjut IS NULL OR jsonb_typeof(p_tindak_lanjut) <> 'array' THEN p_tindak_lanjut := '[]'::jsonb; END IF;
    IF p_lampiran IS NULL OR jsonb_typeof(p_lampiran) <> 'array' THEN p_lampiran := '[]'::jsonb; END IF;
    INSERT INTO public.rapat_notulensi (judul, tanggal, waktu_mulai, waktu_selesai, lokasi, divisi, pimpinan, notulis, peserta, agenda_topik, isi_pembahasan, keputusan, tindak_lanjut, lampiran, status, created_by)
    VALUES (p_judul, p_tanggal, left(COALESCE(p_waktu_mulai,''),5), left(COALESCE(p_waktu_selesai,''),5), left(COALESCE(p_lokasi,''),80), left(COALESCE(p_divisi,''),80), left(COALESCE(p_pimpinan,''),80), left(COALESCE(p_notulis,''),80), left(COALESCE(p_peserta,''),1000), left(COALESCE(p_agenda_topik,''),1000), left(COALESCE(p_isi_pembahasan,''),5000), left(COALESCE(p_keputusan,''),5000), p_tindak_lanjut, p_lampiran, COALESCE(NULLIF(btrim(p_status),''),'selesai'), p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.update_notulensi(
    p_user_id bigint, p_id bigint, p_judul text, p_tanggal date, p_waktu_mulai text, p_waktu_selesai text,
    p_lokasi text, p_divisi text, p_pimpinan text, p_notulis text, p_peserta text,
    p_agenda_topik text, p_isi_pembahasan text, p_keputusan text, p_tindak_lanjut jsonb,
    p_lampiran jsonb, p_status text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.rapat_notulensi SET judul=left(COALESCE(NULLIF(btrim(p_judul),judul),judul),120),
        tanggal=COALESCE(p_tanggal,tanggal), waktu_mulai=left(COALESCE(p_waktu_mulai,waktu_mulai),5), waktu_selesai=left(COALESCE(p_waktu_selesai,waktu_selesai),5),
        lokasi=left(COALESCE(p_lokasi,lokasi),80), divisi=left(COALESCE(p_divisi,divisi),80), pimpinan=left(COALESCE(p_pimpinan,pimpinan),80),
        notulis=left(COALESCE(p_notulis,notulis),80), peserta=left(COALESCE(p_peserta,peserta),1000), agenda_topik=left(COALESCE(p_agenda_topik,agenda_topik),1000),
        isi_pembahasan=left(COALESCE(p_isi_pembahasan,isi_pembahasan),5000), keputusan=left(COALESCE(p_keputusan,keputusan),5000),
        tindak_lanjut=COALESCE(p_tindak_lanjut,tindak_lanjut), lampiran=COALESCE(p_lampiran,lampiran),
        status=COALESCE(NULLIF(btrim(p_status),status),status) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.hapus_notulensi(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.rapat_notulensi WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

-- Grants dibungkus guard biar aman di-run terpisah/ulang: kalau function-nya
-- belum ada (CREATE di atas belum ke-run), tidak error 42883 � tapi itu tanda
-- kamu harus run CREATE FUNCTION-nya dulu, kalau tidak RPC dari web gagal.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'buat_notulensi') THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.buat_notulensi(bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.buat_notulensi(bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) TO anon';
    ELSE
        RAISE NOTICE 'SKIP grant: public.buat_notulensi belum ada � run CREATE FUNCTION-nya dulu';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'update_notulensi') THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.update_notulensi(bigint, bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_notulensi(bigint, bigint, text, date, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) TO anon';
    ELSE
        RAISE NOTICE 'SKIP grant: public.update_notulensi belum ada � run CREATE FUNCTION-nya dulu';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hapus_notulensi') THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.hapus_notulensi(bigint, bigint) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.hapus_notulensi(bigint, bigint) TO anon';
    ELSE
        RAISE NOTICE 'SKIP grant: public.hapus_notulensi belum ada � run CREATE FUNCTION-nya dulu';
    END IF;
END $$;

-- Storage notulensi/ (lampiran dokumentasi) di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_notulensi_select" ON storage.objects;
CREATE POLICY "osis_foto_notulensi_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='notulensi');
DROP POLICY IF EXISTS "osis_foto_notulensi_insert" ON storage.objects;
CREATE POLICY "osis_foto_notulensi_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='notulensi');
DROP POLICY IF EXISTS "osis_foto_notulensi_delete" ON storage.objects;
CREATE POLICY "osis_foto_notulensi_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='notulensi');

-- ============ 15. PROGRAM KERJA (halaman osis/proker) ============
-- Satu baris = satu proker. Relasi ke agenda disimpan di sisi proker
-- (`agenda_ids` jsonb array of id) supaya tabel/halaman agenda tidak berubah.
-- `tugas` = jsonb [{tugas,pic,deadline,status}]. `dokumentasi` = jsonb
-- [{path,caption}] kayak fotos agenda. Status: rencana/belum_dimulai/
-- berjalan/selesai/ditunda/batal. Progress 0-100.
CREATE TABLE IF NOT EXISTS public.proker (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nama text NOT NULL DEFAULT '',
    deskripsi text NOT NULL DEFAULT '',
    divisi text NOT NULL DEFAULT '',
    pj text NOT NULL DEFAULT '',
    periode integer NOT NULL DEFAULT 2026,
    tgl_mulai date,
    tgl_selesai date,
    lokasi text NOT NULL DEFAULT '',
    target_peserta text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'rencana',
    progress integer NOT NULL DEFAULT 0,
    catatan text NOT NULL DEFAULT '',
    agenda_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    tugas jsonb NOT NULL DEFAULT '[]'::jsonb,
    evaluasi_hasil text NOT NULL DEFAULT '',
    evaluasi_kendala text NOT NULL DEFAULT '',
    evaluasi_solusi text NOT NULL DEFAULT '',
    evaluasi_lanjut text NOT NULL DEFAULT '',
    dokumentasi jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proker_periode ON public.proker (periode DESC);
ALTER TABLE public.proker ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "proker_public_select" ON public.proker;
CREATE POLICY "proker_public_select" ON public.proker FOR SELECT USING (true);
DROP POLICY IF EXISTS "proker_public_insert" ON public.proker;

CREATE OR REPLACE FUNCTION public.buat_proker(
    p_user_id bigint, p_nama text, p_deskripsi text, p_divisi text, p_pj text, p_periode integer,
    p_tgl_mulai date, p_tgl_selesai date, p_lokasi text, p_target_peserta text, p_status text,
    p_progress integer, p_catatan text, p_agenda_ids jsonb, p_tugas jsonb,
    p_evaluasi_hasil text, p_evaluasi_kendala text, p_evaluasi_solusi text, p_evaluasi_lanjut text,
    p_dokumentasi jsonb
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    p_nama := left(COALESCE(NULLIF(btrim(p_nama),''),'Tanpa Nama'), 120);
    IF p_agenda_ids IS NULL OR jsonb_typeof(p_agenda_ids) <> 'array' THEN p_agenda_ids := '[]'::jsonb; END IF;
    IF p_tugas IS NULL OR jsonb_typeof(p_tugas) <> 'array' THEN p_tugas := '[]'::jsonb; END IF;
    IF p_dokumentasi IS NULL OR jsonb_typeof(p_dokumentasi) <> 'array' THEN p_dokumentasi := '[]'::jsonb; END IF;
    INSERT INTO public.proker (nama, deskripsi, divisi, pj, periode, tgl_mulai, tgl_selesai, lokasi, target_peserta, status, progress, catatan, agenda_ids, tugas, evaluasi_hasil, evaluasi_kendala, evaluasi_solusi, evaluasi_lanjut, dokumentasi, created_by)
    VALUES (p_nama, left(COALESCE(p_deskripsi,''),1000), left(COALESCE(p_divisi,''),80), left(COALESCE(p_pj,''),80), COALESCE(p_periode,2026), p_tgl_mulai, p_tgl_selesai, left(COALESCE(p_lokasi,''),80), left(COALESCE(p_target_peserta,''),80), COALESCE(NULLIF(btrim(p_status),''),'rencana'), GREATEST(0,LEAST(100,COALESCE(p_progress,0))), left(COALESCE(p_catatan,''),2000), p_agenda_ids, p_tugas, left(COALESCE(p_evaluasi_hasil,''),2000), left(COALESCE(p_evaluasi_kendala,''),2000), left(COALESCE(p_evaluasi_solusi,''),2000), left(COALESCE(p_evaluasi_lanjut,''),2000), p_dokumentasi, p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.update_proker(
    p_user_id bigint, p_id bigint, p_nama text, p_deskripsi text, p_divisi text, p_pj text, p_periode integer,
    p_tgl_mulai date, p_tgl_selesai date, p_lokasi text, p_target_peserta text, p_status text,
    p_progress integer, p_catatan text, p_agenda_ids jsonb, p_tugas jsonb,
    p_evaluasi_hasil text, p_evaluasi_kendala text, p_evaluasi_solusi text, p_evaluasi_lanjut text,
    p_dokumentasi jsonb
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.proker SET nama=left(COALESCE(NULLIF(btrim(p_nama),nama),nama),120), deskripsi=left(COALESCE(p_deskripsi,deskripsi),1000),
        divisi=left(COALESCE(p_divisi,divisi),80), pj=left(COALESCE(p_pj,pj),80), periode=COALESCE(p_periode,periode),
        tgl_mulai=COALESCE(p_tgl_mulai,tgl_mulai), tgl_selesai=COALESCE(p_tgl_selesai,tgl_selesai),
        lokasi=left(COALESCE(p_lokasi,lokasi),80), target_peserta=left(COALESCE(p_target_peserta,target_peserta),80),
        status=COALESCE(NULLIF(btrim(p_status),status),status), progress=GREATEST(0,LEAST(100,COALESCE(p_progress,progress))),
        catatan=left(COALESCE(p_catatan,catatan),2000), agenda_ids=COALESCE(p_agenda_ids,agenda_ids), tugas=COALESCE(p_tugas,tugas),
        evaluasi_hasil=left(COALESCE(p_evaluasi_hasil,evaluasi_hasil),2000), evaluasi_kendala=left(COALESCE(p_evaluasi_kendala,evaluasi_kendala),2000),
        evaluasi_solusi=left(COALESCE(p_evaluasi_solusi,evaluasi_solusi),2000), evaluasi_lanjut=left(COALESCE(p_evaluasi_lanjut,evaluasi_lanjut),2000),
        dokumentasi=COALESCE(p_dokumentasi,dokumentasi) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.hapus_proker(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.proker WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'buat_proker') THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.buat_proker(bigint, text, text, text, text, integer, date, date, text, text, text, integer, text, jsonb, jsonb, text, text, text, text, jsonb) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.buat_proker(bigint, text, text, text, text, integer, date, date, text, text, text, integer, text, jsonb, jsonb, text, text, text, text, jsonb) TO anon';
    ELSE
        RAISE NOTICE 'SKIP grant: public.buat_proker belum ada � run CREATE FUNCTION-nya dulu';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'update_proker') THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.update_proker(bigint, bigint, text, text, text, text, integer, date, date, text, text, text, integer, text, jsonb, jsonb, text, text, text, text, jsonb) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_proker(bigint, bigint, text, text, text, text, integer, date, date, text, text, text, integer, text, jsonb, jsonb, text, text, text, text, jsonb) TO anon';
    ELSE
        RAISE NOTICE 'SKIP grant: public.update_proker belum ada � run CREATE FUNCTION-nya dulu';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hapus_proker') THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.hapus_proker(bigint, bigint) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.hapus_proker(bigint, bigint) TO anon';
    ELSE
        RAISE NOTICE 'SKIP grant: public.hapus_proker belum ada � run CREATE FUNCTION-nya dulu';
    END IF;
END $$;

-- Storage proker/ (dokumentasi) di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_proker_select" ON storage.objects;
CREATE POLICY "osis_foto_proker_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='proker');
DROP POLICY IF EXISTS "osis_foto_proker_insert" ON storage.objects;
CREATE POLICY "osis_foto_proker_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='proker');
DROP POLICY IF EXISTS "osis_foto_proker_delete" ON storage.objects;
CREATE POLICY "osis_foto_proker_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='proker');

-- Seed dummy (cuma kalau tabel masih kosong � buat uji tampilan)
INSERT INTO public.proker (nama, deskripsi, divisi, pj, periode, tgl_mulai, tgl_selesai, lokasi, target_peserta, status, progress, catatan, agenda_ids, tugas, evaluasi_hasil, evaluasi_kendala, evaluasi_solusi, evaluasi_lanjut, dokumentasi)
SELECT * FROM (VALUES
    ('Class Meeting', 'Ajang kompetisi antar kelas: futsal, voli, e-sport, dan pentas seni penutup.', 'Olahraga', 'Rizky Pratama', 2026, '2026-09-01'::date, '2026-09-12'::date, 'Lapangan & Aula', 'Seluruh siswa', 'berjalan', 70, 'Koordinasi dengan kesiswaan untuk izin lapangan.',
     '[]'::jsonb,
     '[{"tugas":"Booking lapangan","pic":"Rizky","deadline":"2026-08-28","status":"selesai"},{"tugas":"Technical meeting perwakilan kelas","pic":"Sinta","deadline":"2026-09-02","status":"selesai"},{"tugas":"Siapkan hadiah & sertifikat","pic":"Dewi","deadline":"2026-09-10","status":"belum"}]'::jsonb,
     '', '', '', '', '[]'::jsonb),
    ('PESAK � Pentas Seni Antar Kelas', 'Pentas seni tahunan tiap kelas menampilkan kabaret, band, dan tari.', 'Seni', 'Sinta Maharani', 2026, '2026-10-20'::date, '2026-10-22'::date, 'Aula Sekolah', '500 penonton', 'belum_dimulai', 25, 'Audisi tiap kelas dulu sebelum gladi.',
     '[]'::jsonb,
     '[{"tugas":"Edarkan juknis ke tiap kelas","pic":"Sinta","deadline":"2026-09-15","status":"belum"}]'::jsonb,
     '', '', '', '', '[]'::jsonb),
    ('Kemah Tangkas 1.0', 'Kemah pelantikan anggota baru dengan materi kepemimpinan dan outbond.', 'BPH', 'Andi Wijaya', 2026, '2026-07-11'::date, '2026-07-13'::date, 'Bumi Perkemahan', '120 peserta', 'selesai', 100, 'Dokumentasi lengkap, tinggal evaluasi akhir.',
     '[]'::jsonb, '[]'::jsonb,
     'Peserta antusias, acara tepat waktu.', 'Hujan di hari kedua, tenda bocor 2 unit.', 'Sewa tenda cadangan tahun depan.', 'Tambah pos P3K di tiap kelompok.',
     '[]'::jsonb),
    ('Takjilin Berkah', 'Bagi-bagi takjil gratis di depan sekolah selama Ramadan.', 'Sosial', 'Dewi Lestari', 2026, '2026-03-05'::date, '2026-03-25'::date, 'Depan Gerbang', '200 paket/hari', 'rencana', 0, 'Menunggu biaya dari kas OSIS.',
     '[]'::jsonb, '[]'::jsonb, '', '', '', '', '[]'::jsonb)
) AS v(nama, deskripsi, divisi, pj, periode, tgl_mulai, tgl_selesai, lokasi, target_peserta, status, progress, catatan, agenda_ids, tugas, evaluasi_hasil, evaluasi_kendala, evaluasi_solusi, evaluasi_lanjut, dokumentasi)
  WHERE NOT EXISTS (SELECT 1 FROM public.proker);

-- ============ 16. DOKUMEN OSIS (halaman osis/dokumen) ============
-- Satu baris = satu file arsip. File fisik di bucket osis-foto folder
-- dokumen/ (PDF/DOCX/XLSX/PPTX/ZIP/gambar/dll — upload apa adanya, cuma
-- gambar yang dikompres). Kategori: proposal/lpj/surat/sk/notulensi/
-- administrasi/laporan/lainnya.
CREATE TABLE IF NOT EXISTS public.osis_dokumen (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nama text NOT NULL DEFAULT '',
    kategori text NOT NULL DEFAULT 'lainnya',
    tahun integer NOT NULL DEFAULT 2026,
    divisi text NOT NULL DEFAULT '',
    deskripsi text NOT NULL DEFAULT '',
    file_path text NOT NULL DEFAULT '',
    file_type text NOT NULL DEFAULT '',
    mime text NOT NULL DEFAULT '',
    ukuran_bytes bigint NOT NULL DEFAULT 0,
    pengunggah text NOT NULL DEFAULT '',
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dokumen_created ON public.osis_dokumen (created_at DESC);
ALTER TABLE public.osis_dokumen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dokumen_public_select" ON public.osis_dokumen;
CREATE POLICY "dokumen_public_select" ON public.osis_dokumen FOR SELECT USING (true);
DROP POLICY IF EXISTS "dokumen_public_insert" ON public.osis_dokumen;

CREATE OR REPLACE FUNCTION public.buat_dokumen(
    p_user_id bigint, p_nama text, p_kategori text, p_tahun integer, p_divisi text,
    p_deskripsi text, p_file_path text, p_file_type text, p_mime text,
    p_ukuran_bytes bigint, p_pengunggah text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    p_nama := left(COALESCE(NULLIF(btrim(p_nama),''),'Tanpa Nama'), 160);
    INSERT INTO public.osis_dokumen (nama, kategori, tahun, divisi, deskripsi, file_path, file_type, mime, ukuran_bytes, pengunggah, created_by)
    VALUES (p_nama, COALESCE(NULLIF(btrim(p_kategori),''),'lainnya'), COALESCE(p_tahun,2026), left(COALESCE(p_divisi,''),80), left(COALESCE(p_deskripsi,''),1000), left(COALESCE(p_file_path,''),300), left(COALESCE(p_file_type,''),10), left(COALESCE(p_mime,''),100), GREATEST(0,COALESCE(p_ukuran_bytes,0)), left(COALESCE(p_pengunggah,''),80), p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.update_dokumen(
    p_user_id bigint, p_id bigint, p_nama text, p_kategori text, p_tahun integer, p_divisi text,
    p_deskripsi text, p_file_path text, p_file_type text, p_mime text,
    p_ukuran_bytes bigint, p_pengunggah text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.osis_dokumen SET nama=left(COALESCE(NULLIF(btrim(p_nama),nama),nama),160), kategori=COALESCE(NULLIF(btrim(p_kategori),kategori),kategori),
        tahun=COALESCE(p_tahun,tahun), divisi=left(COALESCE(p_divisi,divisi),80), deskripsi=left(COALESCE(p_deskripsi,deskripsi),1000),
        file_path=left(COALESCE(p_file_path,file_path),300), file_type=left(COALESCE(p_file_type,file_type),10), mime=left(COALESCE(p_mime,mime),100),
        ukuran_bytes=GREATEST(0,COALESCE(p_ukuran_bytes,ukuran_bytes)), pengunggah=left(COALESCE(p_pengunggah,pengunggah),80) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.hapus_dokumen(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.osis_dokumen WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_dokumen(bigint, text, text, integer, text, text, text, text, text, bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_dokumen(bigint, bigint, text, text, integer, text, text, text, text, text, bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_dokumen(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_dokumen(bigint, text, text, integer, text, text, text, text, text, bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_dokumen(bigint, bigint, text, text, integer, text, text, text, text, text, bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_dokumen(bigint, bigint) TO anon;

-- Storage dokumen/ di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_dokumen_select" ON storage.objects;
CREATE POLICY "osis_foto_dokumen_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='dokumen');
DROP POLICY IF EXISTS "osis_foto_dokumen_insert" ON storage.objects;
CREATE POLICY "osis_foto_dokumen_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='dokumen');
DROP POLICY IF EXISTS "osis_foto_dokumen_delete" ON storage.objects;
CREATE POLICY "osis_foto_dokumen_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='dokumen');

-- Seed contoh (metadata saja, file_path kosong = badge "Contoh" di web;
-- Buka/Download dinonaktifkan sampai file asli dilampirkan via Edit).
-- Cuma jalan kalau tabel masih kosong.
INSERT INTO public.osis_dokumen (nama, kategori, tahun, divisi, deskripsi, file_path, file_type, mime, ukuran_bytes, pengunggah)
SELECT * FROM (VALUES
    ('Proposal Class Meeting 2026', 'proposal', 2026, 'Olahraga', 'Proposal kegiatan class meeting antar kelas.', '', 'pdf', 'application/pdf', 2516582, 'Sistem'),
    ('LPJ HUT RI ke-81', 'lpj', 2026, 'BPH', 'Laporan pertanggungjawaban lomba HUT RI.', '', 'pdf', 'application/pdf', 1835008, 'Sistem'),
    ('Surat Peminjaman Aula', 'surat', 2026, 'Umum', 'Surat izin peminjaman aula untuk PESAK.', '', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 245760, 'Sistem'),
    ('SK Kepengurusan 2026/2027', 'sk', 2026, 'BPH', 'SK pengurus OSIS periode 2026/2027.', '', 'pdf', 'application/pdf', 1048576, 'Sistem'),
    ('Notulensi Rapat Evaluasi Makrab', 'notulensi', 2026, 'BPH', 'Hasil rapat evaluasi MAKRAB.', '', 'pdf', 'application/pdf', 524288, 'Sistem'),
    ('Daftar Hadir Anggota', 'administrasi', 2026, 'Umum', 'Rekap kehadiran rapat rutin.', '', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 131072, 'Sistem'),
    ('Laporan Kas Semester 1', 'laporan', 2026, 'BPH', 'Arus kas semester 1.', '', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 98304, 'Sistem'),
    ('Logo OSIS PNG', 'lainnya', 2026, 'Umum', 'Logo resmi resolusi tinggi.', '', 'png', 'image/png', 786432, 'Sistem')
) AS v(nama, kategori, tahun, divisi, deskripsi, file_path, file_type, mime, ukuran_bytes, pengunggah)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_dokumen);

-- ============ 17. TASK (halaman osis/task) ============
-- Satu baris = satu tugas. Status kanban: todo/in_progress/review/done.
-- Priority: urgent/high/medium/low. Relasi opsional ke proker & agenda
-- (disimpan di sisi task supaya tabel proker/agenda tidak berubah).
CREATE TABLE IF NOT EXISTS public.osis_task (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL DEFAULT '',
    deskripsi text NOT NULL DEFAULT '',
    pic text NOT NULL DEFAULT '',
    divisi text NOT NULL DEFAULT '',
    priority text NOT NULL DEFAULT 'medium',
    deadline date,
    status text NOT NULL DEFAULT 'todo',
    proker_id bigint,
    agenda_id bigint,
    catatan text NOT NULL DEFAULT '',
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_status ON public.osis_task (status);
CREATE INDEX IF NOT EXISTS idx_task_deadline ON public.osis_task (deadline);
ALTER TABLE public.osis_task ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_public_select" ON public.osis_task;
CREATE POLICY "task_public_select" ON public.osis_task FOR SELECT USING (true);
DROP POLICY IF EXISTS "task_public_insert" ON public.osis_task;

CREATE OR REPLACE FUNCTION public.buat_task(
    p_user_id bigint, p_judul text, p_deskripsi text, p_pic text, p_divisi text,
    p_priority text, p_deadline date, p_status text, p_proker_id bigint,
    p_agenda_id bigint, p_catatan text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    p_judul := left(COALESCE(NULLIF(btrim(p_judul),''),'Tanpa Judul'), 160);
    INSERT INTO public.osis_task (judul, deskripsi, pic, divisi, priority, deadline, status, proker_id, agenda_id, catatan, created_by)
    VALUES (p_judul, left(COALESCE(p_deskripsi,''),2000), left(COALESCE(p_pic,''),80), left(COALESCE(p_divisi,''),80), COALESCE(NULLIF(btrim(p_priority),''),'medium'), p_deadline, COALESCE(NULLIF(btrim(p_status),''),'todo'), p_proker_id, p_agenda_id, left(COALESCE(p_catatan,''),2000), p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.update_task(
    p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text, p_pic text, p_divisi text,
    p_priority text, p_deadline date, p_status text, p_proker_id bigint,
    p_agenda_id bigint, p_catatan text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.osis_task SET judul=left(COALESCE(NULLIF(btrim(p_judul),judul),judul),160), deskripsi=left(COALESCE(p_deskripsi,deskripsi),2000),
        pic=left(COALESCE(p_pic,pic),80), divisi=left(COALESCE(p_divisi,divisi),80), priority=COALESCE(NULLIF(btrim(p_priority),priority),priority),
        deadline=COALESCE(p_deadline,deadline), status=COALESCE(NULLIF(btrim(p_status),status),status),
        proker_id=COALESCE(p_proker_id,proker_id), agenda_id=COALESCE(p_agenda_id,agenda_id),
        catatan=left(COALESCE(p_catatan,catatan),2000), updated_at=now() WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

-- Pindah status cepat (panah kanban / tandai selesai) + buka lagi
CREATE OR REPLACE FUNCTION public.pindah_task(p_user_id bigint, p_id bigint, p_status text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    IF COALESCE(btrim(p_status),'') NOT IN ('todo','in_progress','review','done') THEN RETURN 'ERR_INVALID'; END IF;
    UPDATE public.osis_task SET status=p_status, updated_at=now() WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

-- Lepas relasi (set NULL) — dipakai saat proker/agenda sumber dihapus
CREATE OR REPLACE FUNCTION public.lepas_task(p_user_id bigint, p_id bigint, p_field text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    IF p_field = 'proker' THEN
        UPDATE public.osis_task SET proker_id=NULL, updated_at=now() WHERE id=p_id;
    ELSIF p_field = 'agenda' THEN
        UPDATE public.osis_task SET agenda_id=NULL, updated_at=now() WHERE id=p_id;
    ELSE
        RETURN 'ERR_INVALID';
    END IF;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.hapus_task(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.osis_task WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_task(bigint, text, text, text, text, text, date, text, bigint, bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_task(bigint, bigint, text, text, text, text, text, date, text, bigint, bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.pindah_task(bigint, bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.lepas_task(bigint, bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_task(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_task(bigint, text, text, text, text, text, date, text, bigint, bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_task(bigint, bigint, text, text, text, text, text, date, text, bigint, bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.pindah_task(bigint, bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.lepas_task(bigint, bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_task(bigint, bigint) TO anon;

-- Seed dummy (cuma kalau tabel masih kosong — kanban langsung hidup).
-- Relasi proker/agenda dikosongkan (hubungkan manual via Edit).
INSERT INTO public.osis_task (judul, deskripsi, pic, divisi, priority, deadline, status, proker_id, agenda_id, catatan)
SELECT * FROM (VALUES
    ('Buat proposal Class Meeting', 'Draft proposal + RAB, minta tanda tangan pembina.', 'Rizky', 'Olahraga', 'urgent', '2026-09-02'::date, 'todo', NULL::bigint, NULL::bigint, ''),
    ('Hubungi panitia kelas', 'Minta tiap kelas kirim 2 perwakilan panitia.', 'Sinta', 'Olahraga', 'high', '2026-09-04'::date, 'todo', NULL::bigint, NULL::bigint, ''),
    ('Cetak poster PESAK', 'Desain sudah ada, cetak 20 lembar A3.', 'Dewi', 'Seni', 'medium', '2026-09-10'::date, 'todo', NULL::bigint, NULL::bigint, ''),
    ('Siapkan materi rapat', 'Slide evaluasi MAKRAB untuk rapat pengurus.', 'Andi', 'BPH', 'high', '2026-09-05'::date, 'in_progress', NULL::bigint, NULL::bigint, ''),
    ('Kumpulkan LPJ lomba 17-an', 'Minta LPJ tiap seksi, deadline minggu ini.', 'Bima', 'BPH', 'medium', '2026-09-07'::date, 'in_progress', NULL::bigint, NULL::bigint, ''),
    ('Verifikasi kas sekretaris', 'Cek ulang kas masuk vs nota belanja.', 'Dewi', 'BPH', 'low', '2026-09-12'::date, 'review', NULL::bigint, NULL::bigint, 'Menunggu nota terakhir.'),
    ('Booking aula PESAK', 'Sudah DP, tinggal ambil kuitansi.', 'Sinta', 'Seni', 'urgent', '2026-08-28'::date, 'in_progress', NULL::bigint, NULL::bigint, ''),
    ('Buat daftar peserta rapat', 'Absensi + konsumsi 30 orang.', 'Citra', 'Umum', 'low', '2026-09-03'::date, 'done', NULL::bigint, NULL::bigint, ''),
    ('Cetak dokumen rapat', 'Notulensi + lampiran, 5 rangkap.', 'Citra', 'Umum', 'medium', '2026-08-30'::date, 'done', NULL::bigint, NULL::bigint, ''),
    ('Siapkan perlengkapan kemah', 'Tenda, P3K, HT — cek gudang.', 'Andi', 'BPH', 'high', '2026-07-09'::date, 'done', NULL::bigint, NULL::bigint, '')
) AS v(judul, deskripsi, pic, divisi, priority, deadline, status, proker_id, agenda_id, catatan)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_task);

-- ============ 18. KEUANGAN (halaman osis/keuangan) ============
-- Satu baris = satu transaksi kas. Jenis: masuk/keluar. Saldo = saldo awal
-- periode + total masuk - total keluar (dihitung di client dari transaksi).
-- Saldo awal disimpan per periode di tabel osis_saldo_awal.
CREATE TABLE IF NOT EXISTS public.osis_kas (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    jenis text NOT NULL DEFAULT 'keluar',
    tanggal date,
    keterangan text NOT NULL DEFAULT '',
    kategori text NOT NULL DEFAULT 'Lainnya',
    nominal bigint NOT NULL DEFAULT 0,
    divisi text NOT NULL DEFAULT '',
    pic text NOT NULL DEFAULT '',
    proker_id bigint,
    agenda_id bigint,
    catatan text NOT NULL DEFAULT '',
    bukti_path text NOT NULL DEFAULT '',
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kas_tanggal ON public.osis_kas (tanggal DESC);
ALTER TABLE public.osis_kas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kas_public_select" ON public.osis_kas;
CREATE POLICY "kas_public_select" ON public.osis_kas FOR SELECT USING (true);
DROP POLICY IF EXISTS "kas_public_insert" ON public.osis_kas;

CREATE TABLE IF NOT EXISTS public.osis_saldo_awal (
    periode integer PRIMARY KEY,
    nominal bigint NOT NULL DEFAULT 0,
    updated_by bigint,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.osis_saldo_awal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saldo_awal_public_select" ON public.osis_saldo_awal;
CREATE POLICY "saldo_awal_public_select" ON public.osis_saldo_awal FOR SELECT USING (true);
DROP POLICY IF EXISTS "saldo_awal_public_insert" ON public.osis_saldo_awal;

CREATE OR REPLACE FUNCTION public.buat_kas(
    p_user_id bigint, p_jenis text, p_tanggal date, p_keterangan text, p_kategori text,
    p_nominal bigint, p_divisi text, p_pic text, p_proker_id bigint, p_agenda_id bigint,
    p_catatan text, p_bukti_path text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    IF COALESCE(btrim(p_jenis),'') NOT IN ('masuk','keluar') THEN RETURN -2; END IF;
    IF COALESCE(p_nominal,0) <= 0 THEN RETURN -3; END IF;
    p_keterangan := left(COALESCE(NULLIF(btrim(p_keterangan),''),'Tanpa Keterangan'), 160);
    INSERT INTO public.osis_kas (jenis, tanggal, keterangan, kategori, nominal, divisi, pic, proker_id, agenda_id, catatan, bukti_path, created_by)
    VALUES (p_jenis, p_tanggal, p_keterangan, left(COALESCE(NULLIF(btrim(p_kategori),''),'Lainnya'),40), p_nominal, left(COALESCE(p_divisi,''),80), left(COALESCE(p_pic,''),80), p_proker_id, p_agenda_id, left(COALESCE(p_catatan,''),2000), left(COALESCE(p_bukti_path,''),300), p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.update_kas(
    p_user_id bigint, p_id bigint, p_jenis text, p_tanggal date, p_keterangan text, p_kategori text,
    p_nominal bigint, p_divisi text, p_pic text, p_proker_id bigint, p_agenda_id bigint,
    p_catatan text, p_bukti_path text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.osis_kas SET jenis=COALESCE(NULLIF(btrim(p_jenis),jenis),jenis), tanggal=COALESCE(p_tanggal,tanggal),
        keterangan=left(COALESCE(NULLIF(btrim(p_keterangan),keterangan),keterangan),160), kategori=left(COALESCE(NULLIF(btrim(p_kategori),kategori),kategori),40),
        nominal=COALESCE(p_nominal,nominal), divisi=left(COALESCE(p_divisi,divisi),80), pic=left(COALESCE(p_pic,pic),80),
        proker_id=COALESCE(p_proker_id,proker_id), agenda_id=COALESCE(p_agenda_id,agenda_id),
        catatan=left(COALESCE(p_catatan,catatan),2000), bukti_path=left(COALESCE(p_bukti_path,bukti_path),300), updated_at=now() WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.hapus_kas(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.osis_kas WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

-- Set saldo awal periode (upsert)
CREATE OR REPLACE FUNCTION public.set_saldo_awal(p_user_id bigint, p_periode integer, p_nominal bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    INSERT INTO public.osis_saldo_awal (periode, nominal, updated_by, updated_at)
    VALUES (COALESCE(p_periode,2026), GREATEST(0,COALESCE(p_nominal,0)), p_user_id, now())
    ON CONFLICT (periode) DO UPDATE SET nominal=EXCLUDED.nominal, updated_by=EXCLUDED.updated_by, updated_at=now();
    RETURN 'OK';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_kas(bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_kas(bigint, bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_kas(bigint, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.set_saldo_awal(bigint, integer, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_kas(bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_kas(bigint, bigint, text, date, text, text, bigint, text, text, bigint, bigint, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_kas(bigint, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.set_saldo_awal(bigint, integer, bigint) TO anon;

-- Storage kas/ (bukti nota/kwitansi) di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_kas_select" ON storage.objects;
CREATE POLICY "osis_foto_kas_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='kas');
DROP POLICY IF EXISTS "osis_foto_kas_insert" ON storage.objects;
CREATE POLICY "osis_foto_kas_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='kas');
DROP POLICY IF EXISTS "osis_foto_kas_delete" ON storage.objects;
CREATE POLICY "osis_foto_kas_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='kas');

-- Seed: saldo awal 2026 + belasan transaksi contoh (cuma kalau kosong)
INSERT INTO public.osis_saldo_awal (periode, nominal) VALUES (2026, 1000000)
ON CONFLICT (periode) DO NOTHING;
INSERT INTO public.osis_kas (jenis, tanggal, keterangan, kategori, nominal, divisi, pic, proker_id, agenda_id, catatan, bukti_path)
SELECT * FROM (VALUES
    ('masuk', '2026-09-01'::date, 'Dana kas OSIS September', 'Kas', 500000, 'BPH', 'Andi', NULL::bigint, NULL::bigint, '', ''),
    ('masuk', '2026-09-02'::date, 'Sponsor Class Meeting — Toko Berkah', 'Sponsorship', 1000000, 'Olahraga', 'Rizky', NULL::bigint, NULL::bigint, '', ''),
    ('keluar', '2026-09-03'::date, 'Cetak proposal & RAB', 'Administrasi', 75000, 'Olahraga', 'Rizky', NULL::bigint, NULL::bigint, '', ''),
    ('keluar', '2026-09-04'::date, 'Konsumsi rapat pengurus', 'Konsumsi', 120000, 'BPH', 'Sinta', NULL::bigint, NULL::bigint, '30 orang', ''),
    ('masuk', '2026-09-05'::date, 'Donasi alumni', 'Donasi', 750000, 'BPH', 'Andi', NULL::bigint, NULL::bigint, '', ''),
    ('keluar', '2026-09-06'::date, 'Beli perlengkapan lomba', 'Perlengkapan', 350000, 'Olahraga', 'Bima', NULL::bigint, NULL::bigint, '', ''),
    ('keluar', '2026-09-07'::date, 'Transport survei lokasi kemah', 'Transportasi', 200000, 'BPH', 'Andi', NULL::bigint, NULL::bigint, '', ''),
    ('masuk', '2026-08-28'::date, 'Dana sekolah kegiatan 17-an', 'Dana Sekolah', 1500000, 'BPH', 'Andi', NULL::bigint, NULL::bigint, '', ''),
    ('keluar', '2026-08-29'::date, 'Hadiah lomba 17-an', 'Acara', 900000, 'BPH', 'Sinta', NULL::bigint, NULL::bigint, '', ''),
    ('keluar', '2026-08-30'::date, 'Cetak foto dokumentasi', 'Dokumentasi', 150000, 'Seni', 'Dewi', NULL::bigint, NULL::bigint, '', ''),
    ('masuk', '2026-08-15'::date, 'Penjualan stiker OSIS', 'Penjualan', 300000, 'Umum', 'Citra', NULL::bigint, NULL::bigint, '', ''),
    ('keluar', '2026-09-08'::date, 'Sewa sound mini rapat', 'Acara', 250000, 'Umum', 'Citra', NULL::bigint, NULL::bigint, '', '')
) AS v(jenis, tanggal, keterangan, kategori, nominal, divisi, pic, proker_id, agenda_id, catatan, bukti_path)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_kas);

-- ============ 19. EVALUASI (halaman osis/evaluasi) ============
-- Satu baris = satu evaluasi kegiatan. Relasi opsional ke agenda & proker
-- (disimpan di sisi evaluasi supaya tabel agenda/proker tidak berubah).
-- Rating 1-5: total + 5 aspek. Status: belum/draft/selesai.
CREATE TABLE IF NOT EXISTS public.osis_evaluasi (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nama_kegiatan text NOT NULL DEFAULT '',
    agenda_id bigint,
    proker_id bigint,
    tgl_kegiatan date,
    divisi text NOT NULL DEFAULT '',
    pj text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft',
    rating_total integer NOT NULL DEFAULT 5,
    r_persiapan integer NOT NULL DEFAULT 5,
    r_pelaksanaan integer NOT NULL DEFAULT 5,
    r_koordinasi integer NOT NULL DEFAULT 5,
    r_waktu integer NOT NULL DEFAULT 5,
    r_anggaran integer NOT NULL DEFAULT 5,
    baik text NOT NULL DEFAULT '',
    kendala text NOT NULL DEFAULT '',
    penyebab text NOT NULL DEFAULT '',
    solusi text NOT NULL DEFAULT '',
    perbaiki text NOT NULL DEFAULT '',
    rekomendasi text NOT NULL DEFAULT '',
    dokumentasi jsonb NOT NULL DEFAULT '[]'::jsonb,
    tugas jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evaluasi_tgl ON public.osis_evaluasi (tgl_kegiatan DESC);
ALTER TABLE public.osis_evaluasi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evaluasi_public_select" ON public.osis_evaluasi;
CREATE POLICY "evaluasi_public_select" ON public.osis_evaluasi FOR SELECT USING (true);
DROP POLICY IF EXISTS "evaluasi_public_insert" ON public.osis_evaluasi;

CREATE OR REPLACE FUNCTION public.buat_evaluasi(
    p_user_id bigint, p_nama_kegiatan text, p_agenda_id bigint, p_proker_id bigint, p_tgl_kegiatan date,
    p_divisi text, p_pj text, p_status text, p_rating_total integer, p_r_persiapan integer,
    p_r_pelaksanaan integer, p_r_koordinasi integer, p_r_waktu integer, p_r_anggaran integer,
    p_baik text, p_kendala text, p_penyebab text, p_solusi text, p_perbaiki text, p_rekomendasi text,
    p_dokumentasi jsonb, p_tugas jsonb
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE nid bigint;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    p_nama_kegiatan := left(COALESCE(NULLIF(btrim(p_nama_kegiatan),''),'Tanpa Nama'), 160);
    IF p_dokumentasi IS NULL OR jsonb_typeof(p_dokumentasi) <> 'array' THEN p_dokumentasi := '[]'::jsonb; END IF;
    IF p_tugas IS NULL OR jsonb_typeof(p_tugas) <> 'array' THEN p_tugas := '[]'::jsonb; END IF;
    INSERT INTO public.osis_evaluasi (nama_kegiatan, agenda_id, proker_id, tgl_kegiatan, divisi, pj, status, rating_total, r_persiapan, r_pelaksanaan, r_koordinasi, r_waktu, r_anggaran, baik, kendala, penyebab, solusi, perbaiki, rekomendasi, dokumentasi, tugas, created_by)
    VALUES (p_nama_kegiatan, p_agenda_id, p_proker_id, p_tgl_kegiatan, left(COALESCE(p_divisi,''),80), left(COALESCE(p_pj,''),80), COALESCE(NULLIF(btrim(p_status),''),'draft'), GREATEST(1,LEAST(5,COALESCE(p_rating_total,5))), GREATEST(1,LEAST(5,COALESCE(p_r_persiapan,5))), GREATEST(1,LEAST(5,COALESCE(p_r_pelaksanaan,5))), GREATEST(1,LEAST(5,COALESCE(p_r_koordinasi,5))), GREATEST(1,LEAST(5,COALESCE(p_r_waktu,5))), GREATEST(1,LEAST(5,COALESCE(p_r_anggaran,5))), left(COALESCE(p_baik,''),3000), left(COALESCE(p_kendala,''),3000), left(COALESCE(p_penyebab,''),3000), left(COALESCE(p_solusi,''),3000), left(COALESCE(p_perbaiki,''),3000), left(COALESCE(p_rekomendasi,''),3000), p_dokumentasi, p_tugas, p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.update_evaluasi(
    p_user_id bigint, p_id bigint, p_nama_kegiatan text, p_agenda_id bigint, p_proker_id bigint, p_tgl_kegiatan date,
    p_divisi text, p_pj text, p_status text, p_rating_total integer, p_r_persiapan integer,
    p_r_pelaksanaan integer, p_r_koordinasi integer, p_r_waktu integer, p_r_anggaran integer,
    p_baik text, p_kendala text, p_penyebab text, p_solusi text, p_perbaiki text, p_rekomendasi text,
    p_dokumentasi jsonb, p_tugas jsonb
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.osis_evaluasi SET nama_kegiatan=left(COALESCE(NULLIF(btrim(p_nama_kegiatan),nama_kegiatan),nama_kegiatan),160),
        agenda_id=COALESCE(p_agenda_id,agenda_id), proker_id=COALESCE(p_proker_id,proker_id), tgl_kegiatan=COALESCE(p_tgl_kegiatan,tgl_kegiatan),
        divisi=left(COALESCE(p_divisi,divisi),80), pj=left(COALESCE(p_pj,pj),80), status=COALESCE(NULLIF(btrim(p_status),status),status),
        rating_total=GREATEST(1,LEAST(5,COALESCE(p_rating_total,rating_total))), r_persiapan=GREATEST(1,LEAST(5,COALESCE(p_r_persiapan,r_persiapan))),
        r_pelaksanaan=GREATEST(1,LEAST(5,COALESCE(p_r_pelaksanaan,r_pelaksanaan))), r_koordinasi=GREATEST(1,LEAST(5,COALESCE(p_r_koordinasi,r_koordinasi))),
        r_waktu=GREATEST(1,LEAST(5,COALESCE(p_r_waktu,r_waktu))), r_anggaran=GREATEST(1,LEAST(5,COALESCE(p_r_anggaran,r_anggaran))),
        baik=left(COALESCE(p_baik,baik),3000), kendala=left(COALESCE(p_kendala,kendala),3000), penyebab=left(COALESCE(p_penyebab,penyebab),3000),
        solusi=left(COALESCE(p_solusi,solusi),3000), perbaiki=left(COALESCE(p_perbaiki,perbaiki),3000), rekomendasi=left(COALESCE(p_rekomendasi,rekomendasi),3000),
        dokumentasi=COALESCE(p_dokumentasi,dokumentasi), tugas=COALESCE(p_tugas,tugas), updated_at=now() WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.hapus_evaluasi(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.osis_evaluasi WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_evaluasi(bigint, text, bigint, bigint, date, text, text, text, integer, integer, integer, integer, integer, integer, text, text, text, text, text, text, jsonb, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_evaluasi(bigint, bigint, text, bigint, bigint, date, text, text, text, integer, integer, integer, integer, integer, integer, text, text, text, text, text, text, jsonb, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_evaluasi(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_evaluasi(bigint, text, bigint, bigint, date, text, text, text, integer, integer, integer, integer, integer, integer, text, text, text, text, text, text, jsonb, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.update_evaluasi(bigint, bigint, text, bigint, bigint, date, text, text, text, integer, integer, integer, integer, integer, integer, text, text, text, text, text, text, jsonb, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_evaluasi(bigint, bigint) TO anon;

-- Storage evaluasi/ (dokumentasi) di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_evaluasi_select" ON storage.objects;
CREATE POLICY "osis_foto_evaluasi_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='evaluasi');
DROP POLICY IF EXISTS "osis_foto_evaluasi_insert" ON storage.objects;
CREATE POLICY "osis_foto_evaluasi_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='evaluasi');
DROP POLICY IF EXISTS "osis_foto_evaluasi_delete" ON storage.objects;
CREATE POLICY "osis_foto_evaluasi_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='evaluasi');

-- ============ 20. FORMULIR (halaman osis/formulir, form builder) ============
-- General purpose: evaluasi, survei, pendaftaran, pendataan, polling.
-- osis_formulir = bungkus + settings jsonb. osis_pertanyaan = fleksibel:
-- tipe short/paragraf/radio/checkbox/dropdown/skala/rating/tanggal/file,
-- opsi jsonb (pilihan), config jsonb (skala/rating/file). osis_respons =
-- jawaban jsonb keyed by id pertanyaan. Tulis via RPC SECURITY DEFINER.
CREATE TABLE IF NOT EXISTS public.osis_formulir (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL DEFAULT '',
    deskripsi text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft',
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.osis_pertanyaan (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES public.osis_formulir(id) ON DELETE CASCADE,
    tipe text NOT NULL DEFAULT 'short',
    teks text NOT NULL DEFAULT '',
    opsi jsonb NOT NULL DEFAULT '[]'::jsonb,
    wajib boolean NOT NULL DEFAULT false,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    urutan integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pertanyaan_form ON public.osis_pertanyaan (form_id, urutan);
CREATE TABLE IF NOT EXISTS public.osis_respons (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES public.osis_formulir(id) ON DELETE CASCADE,
    jawaban jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_respons_form ON public.osis_respons (form_id, created_at DESC);
ALTER TABLE public.osis_formulir ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.osis_pertanyaan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.osis_respons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "formulir_public_select" ON public.osis_formulir;
CREATE POLICY "formulir_public_select" ON public.osis_formulir FOR SELECT USING (true);
DROP POLICY IF EXISTS "formulir_public_insert" ON public.osis_formulir;
DROP POLICY IF EXISTS "pertanyaan_public_select" ON public.osis_pertanyaan;
CREATE POLICY "pertanyaan_public_select" ON public.osis_pertanyaan FOR SELECT USING (true);
DROP POLICY IF EXISTS "pertanyaan_public_insert" ON public.osis_pertanyaan;
DROP POLICY IF EXISTS "respons_public_select" ON public.osis_respons;
CREATE POLICY "respons_public_select" ON public.osis_respons FOR SELECT USING (true);
DROP POLICY IF EXISTS "respons_public_insert" ON public.osis_respons;

-- Simpan form + seluruh pertanyaan sekaligus (buat baru kalau p_id null,
-- kalau tidak: update form, hapus pertanyaan lama, insert ulang urut).
-- Dipakai buat simpan, publish, tutup, duplicate (client kirim array).
CREATE OR REPLACE FUNCTION public.simpan_formulir(
    p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text, p_status text,
    p_settings jsonb, p_pertanyaan jsonb
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE fid bigint; q jsonb;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN -1; END IF;
    IF COALESCE(btrim(p_status),'') NOT IN ('draft','aktif','ditutup') THEN p_status := 'draft'; END IF;
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN p_settings := '{}'::jsonb; END IF;
    IF p_pertanyaan IS NULL OR jsonb_typeof(p_pertanyaan) <> 'array' THEN p_pertanyaan := '[]'::jsonb; END IF;
    IF p_id IS NULL THEN
        INSERT INTO public.osis_formulir (judul, deskripsi, status, settings, created_by)
        VALUES (left(COALESCE(NULLIF(btrim(p_judul),''),'Tanpa Judul'),160), left(COALESCE(p_deskripsi,''),1000), p_status, p_settings, p_user_id)
        RETURNING id INTO fid;
    ELSE
        UPDATE public.osis_formulir SET judul=left(COALESCE(NULLIF(btrim(p_judul),judul),judul),160), deskripsi=left(COALESCE(p_deskripsi,deskripsi),1000),
            status=p_status, settings=p_settings, updated_at=now() WHERE id=p_id;
        IF NOT FOUND THEN RETURN -2; END IF;
        fid := p_id;
        DELETE FROM public.osis_pertanyaan WHERE form_id=fid;
    END IF;
    FOR q IN SELECT * FROM jsonb_array_elements(p_pertanyaan) LOOP
        INSERT INTO public.osis_pertanyaan (form_id, tipe, teks, opsi, wajib, config, urutan)
        VALUES (fid,
            COALESCE(NULLIF(btrim(q->>'tipe'),''),'short'),
            left(COALESCE(q->>'teks','Tanpa pertanyaan'),300),
            CASE WHEN jsonb_typeof(COALESCE(q->'opsi','[]'::jsonb))='array' THEN q->'opsi' ELSE '[]'::jsonb END,
            COALESCE((q->>'wajib')::boolean, false),
            CASE WHEN jsonb_typeof(COALESCE(q->'config','{}'::jsonb))='object' THEN q->'config' ELSE '{}'::jsonb END,
            COALESCE((q->>'urutan')::integer, 0));
    END LOOP;
    RETURN fid;
END $$;

CREATE OR REPLACE FUNCTION public.hapus_formulir(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id=p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.osis_respons WHERE form_id=p_id;
    DELETE FROM public.osis_pertanyaan WHERE form_id=p_id;
    DELETE FROM public.osis_formulir WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

-- Kirim respons (boleh anonim/responden umum). Kode: -1 form tidak ada,
-- -2 form tidak aktif, -3 kuota respons penuh.
CREATE OR REPLACE FUNCTION public.kirim_respons(p_form_id bigint, p_jawaban jsonb, p_user_id bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE nid bigint; st text; cfg jsonb; batas integer; terisi integer;
BEGIN
    SELECT status, settings INTO st, cfg FROM public.osis_formulir WHERE id=p_form_id;
    IF NOT FOUND THEN RETURN -1; END IF;
    IF st <> 'aktif' THEN RETURN -2; END IF;
    IF p_jawaban IS NULL OR jsonb_typeof(p_jawaban) <> 'object' THEN p_jawaban := '{}'::jsonb; END IF;
    batas := COALESCE((cfg->>'batas_respons')::integer, 0);
    IF batas > 0 THEN
        SELECT COUNT(*) INTO terisi FROM public.osis_respons WHERE form_id=p_form_id;
        IF terisi >= batas THEN RETURN -3; END IF;
    END IF;
    INSERT INTO public.osis_respons (form_id, jawaban, created_by) VALUES (p_form_id, p_jawaban, p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
END $$;

REVOKE EXECUTE ON FUNCTION public.simpan_formulir(bigint, bigint, text, text, text, jsonb, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_formulir(bigint, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.kirim_respons(bigint, jsonb, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.simpan_formulir(bigint, bigint, text, text, text, jsonb, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_formulir(bigint, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.kirim_respons(bigint, jsonb, bigint) TO anon;

-- Storage formulir/ (file jawaban responden) di bucket osis-foto
DROP POLICY IF EXISTS "osis_foto_formulir_select" ON storage.objects;
CREATE POLICY "osis_foto_formulir_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='formulir');
DROP POLICY IF EXISTS "osis_foto_formulir_insert" ON storage.objects;
CREATE POLICY "osis_foto_formulir_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='formulir');
DROP POLICY IF EXISTS "osis_foto_formulir_delete" ON storage.objects;
CREATE POLICY "osis_foto_formulir_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='formulir');

-- Seed dummy formulir (cuma kalau tabel masih kosong)
INSERT INTO public.osis_formulir (judul, deskripsi, status, settings)
SELECT * FROM (VALUES
    ('Evaluasi Kegiatan Class Meeting', 'Ceritakan pengalamanmu ikut Class Meeting kemarin.', 'aktif', '{"pesan_sukses":"Terima kasih, respons kamu telah berhasil dikirim.","simpan_waktu":true}'::jsonb),
    ('Pendataan Peserta LDKS', 'Isi data diri untuk Latihan Dasar Kepemimpinan Siswa.', 'aktif', '{"pesan_sukses":"Data tersimpan, sampai jumpa di LDKS!","simpan_waktu":true}'::jsonb),
    ('Pendaftaran Panitia HUT Sekolah', 'Ayo gabung panitia HUT sekolah tahun ini.', 'draft', '{}'::jsonb),
    ('Survei Kepuasan Siswa', 'Survei layanan OSIS semester ini (sudah ditutup).', 'ditutup', '{}'::jsonb)
) AS v(judul, deskripsi, status, settings)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_formulir);

-- Seed pertanyaan per form (cuma kalau form itu belum punya pertanyaan)
INSERT INTO public.osis_pertanyaan (form_id, tipe, teks, opsi, wajib, config, urutan)
SELECT (SELECT id FROM public.osis_formulir WHERE judul='Evaluasi Kegiatan Class Meeting'), tipe, teks, opsi, wajib, config, urutan FROM (VALUES
    ('short','Nama lengkap','[]'::jsonb,true,'{}'::jsonb,0),
    ('short','Kelas','[]'::jsonb,true,'{}'::jsonb,1),
    ('rating','Penilaian keseluruhan acara','[]'::jsonb,true,'{"max":5}'::jsonb,2),
    ('radio','Bagian paling berkesan','["Pertandingan","Pentas seni","Konsumsi","Kekompakan panitia"]'::jsonb,false,'{}'::jsonb,3),
    ('paragraf','Saran untuk tahun depan','[]'::jsonb,false,'{}'::jsonb,4),
    ('file','Upload foto momen favoritmu','[]'::jsonb,false,'{"types":"JPG, PNG","max_mb":10}'::jsonb,5)
) AS q(tipe, teks, opsi, wajib, config, urutan)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_pertanyaan WHERE form_id=(SELECT id FROM public.osis_formulir WHERE judul='Evaluasi Kegiatan Class Meeting'));

INSERT INTO public.osis_pertanyaan (form_id, tipe, teks, opsi, wajib, config, urutan)
SELECT (SELECT id FROM public.osis_formulir WHERE judul='Pendataan Peserta LDKS'), tipe, teks, opsi, wajib, config, urutan FROM (VALUES
    ('short','Nama lengkap','[]'::jsonb,true,'{}'::jsonb,0),
    ('short','Kelas','[]'::jsonb,true,'{}'::jsonb,1),
    ('short','No HP aktif','[]'::jsonb,true,'{}'::jsonb,2),
    ('dropdown','Ukuran kaos','["S","M","L","XL","XXL"]'::jsonb,true,'{}'::jsonb,3),
    ('paragraf','Alergi / kebutuhan khusus','[]'::jsonb,false,'{}'::jsonb,4),
    ('file','Upload surat izin orang tua (PDF/JPG)','[]'::jsonb,true,'{"types":"PDF, JPG, PNG","max_mb":10}'::jsonb,5)
) AS q(tipe, teks, opsi, wajib, config, urutan)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_pertanyaan WHERE form_id=(SELECT id FROM public.osis_formulir WHERE judul='Pendataan Peserta LDKS'));

INSERT INTO public.osis_pertanyaan (form_id, tipe, teks, opsi, wajib, config, urutan)
SELECT (SELECT id FROM public.osis_formulir WHERE judul='Pendaftaran Panitia HUT Sekolah'), tipe, teks, opsi, wajib, config, urutan FROM (VALUES
    ('short','Nama lengkap','[]'::jsonb,true,'{}'::jsonb,0),
    ('radio','Divisi pilihan','["Acara","Humas","Konsumsi","Dokumentasi","Keamanan"]'::jsonb,true,'{}'::jsonb,1),
    ('paragraf','Alasan gabung panitia','[]'::jsonb,false,'{}'::jsonb,2)
) AS q(tipe, teks, opsi, wajib, config, urutan)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_pertanyaan WHERE form_id=(SELECT id FROM public.osis_formulir WHERE judul='Pendaftaran Panitia HUT Sekolah'));

INSERT INTO public.osis_pertanyaan (form_id, tipe, teks, opsi, wajib, config, urutan)
SELECT (SELECT id FROM public.osis_formulir WHERE judul='Survei Kepuasan Siswa'), tipe, teks, opsi, wajib, config, urutan FROM (VALUES
    ('skala','Seberapa puas dengan layanan OSIS semester ini','[]'::jsonb,true,'{"min":1,"max":5,"label_min":"Sangat Tidak Puas","label_max":"Sangat Puas"}'::jsonb,0),
    ('checkbox','Layanan yang pernah dipakai','["Aspirasi","Request lagu","Peminjaman alat","Info lomba"]'::jsonb,false,'{}'::jsonb,1),
    ('tanggal','Terakhir berinteraksi dengan OSIS','[]'::jsonb,false,'{}'::jsonb,2),
    ('paragraf','Kritik dan saran','[]'::jsonb,false,'{}'::jsonb,3)
) AS q(tipe, teks, opsi, wajib, config, urutan)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_pertanyaan WHERE form_id=(SELECT id FROM public.osis_formulir WHERE judul='Survei Kepuasan Siswa'));

-- Seed respons contoh buat form evaluasi (cuma kalau belum ada respons)
DO $$
DECLARE fid bigint; q bigint[];
BEGIN
    SELECT id INTO fid FROM public.osis_formulir WHERE judul='Evaluasi Kegiatan Class Meeting';
    IF fid IS NULL THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.osis_respons WHERE form_id=fid) THEN RETURN; END IF;
    SELECT array_agg(id ORDER BY urutan) INTO q FROM public.osis_pertanyaan WHERE form_id=fid;
    IF array_length(q,1) < 5 THEN RETURN; END IF;
    INSERT INTO public.osis_respons (form_id, jawaban, created_at) VALUES
    (fid, jsonb_build_object(q[1]::text,'Andini Pratiwi', q[2]::text,'XII RPL 1', q[3]::text,'5', q[4]::text,'Pentas seni', q[5]::text,'Tahun depan tambah stand bazar.'), now() - interval '2 days'),
    (fid, jsonb_build_object(q[1]::text,'Bagas Ramadhan', q[2]::text,'XI TKJ 2', q[3]::text,'5', q[4]::text,'Pertandingan', q[5]::text,'Suaranya kurang kencang pas final.'), now() - interval '2 days'),
    (fid, jsonb_build_object(q[1]::text,'Citra Ayu', q[2]::text,'X AKL 1', q[3]::text,'4', q[4]::text,'Kekompakan panitia', q[5]::text,'Konsumsi antre terlalu lama.'), now() - interval '1 day'),
    (fid, jsonb_build_object(q[1]::text,'Dimas Saputra', q[2]::text,'XII RPL 2', q[3]::text,'5', q[4]::text,'Pertandingan', q[5]::text,''), now() - interval '1 day'),
    (fid, jsonb_build_object(q[1]::text,'Eka Putri', q[2]::text,'XI AKL 3', q[3]::text,'4', q[4]::text,'Pentas seni', q[5]::text,'Parkir perlu diatur lagi.'), now() - interval '5 hours'),
    (fid, jsonb_build_object(q[1]::text,'Fajar Nugroho', q[2]::text,'X TKJ 1', q[3]::text,'3', q[4]::text,'Konsumsi', q[5]::text,'Jadwal molor satu jam.'), now() - interval '1 hour');
END $$;

-- Seed dummy (cuma kalau tabel masih kosong)
INSERT INTO public.osis_evaluasi (nama_kegiatan, agenda_id, proker_id, tgl_kegiatan, divisi, pj, status, rating_total, r_persiapan, r_pelaksanaan, r_koordinasi, r_waktu, r_anggaran, baik, kendala, penyebab, solusi, perbaiki, rekomendasi, dokumentasi, tugas)
SELECT * FROM (VALUES
    ('Pelaksanaan Class Meeting', NULL::bigint, NULL::bigint, '2026-09-05'::date, 'Olahraga', 'Rizky Pratama', 'selesai', 5, 4, 5, 4, 5, 4,
     'Antusiasme kelas tinggi, jadwal tepat waktu.', 'Sound sempat mati 10 menit.', 'Kabel kendor + tidak ada sound cadangan.', 'Pinjam sound aula, jeda diisi games.', 'Cek semua kabel H-1.',
     'Tambah tim dokumentasi khusus tahun depan.', '[]'::jsonb,
     '[{"tugas":"Kembalikan alat sewaan","pic":"Bima","deadline":"2026-09-07","status":"selesai"}]'::jsonb),
    ('Lomba 17-an Tingkat Sekolah', NULL::bigint, NULL::bigint, '2026-08-17'::date, 'BPH', 'Andi Wijaya', 'selesai', 4, 4, 4, 3, 4, 4,
     'Peserta membludak, semua lomba jalan.', 'Koordinasi juri telat 30 menit.', 'Briefing juri dadakan di hari H.', 'Buat grup juri H-3 berikutnya.', 'Jadwal briefing resmi.',
     'Pisahkan lomba putra/putri lebih awal.', '[]'::jsonb, '[]'::jsonb),
    ('Rapat Evaluasi MAKRAB', NULL::bigint, NULL::bigint, '2026-08-25'::date, 'BPH', 'Sinta Maharani', 'selesai', 4, 5, 3, 4, 4, 3,
     'Semua divisi hadir dan terbuka.', 'LPJ konsumsi belum lengkap.', 'Nota tercecer di beberapa seksi.', 'Batas pengumpulan nota H+3.', 'Amplop nota per seksi sejak awal.',
     'Evaluasi maksimal H+7 setelah kegiatan.', '[]'::jsonb, '[]'::jsonb),
    ('Gladi Bersih PESAK', NULL::bigint, NULL::bigint, '2026-09-12'::date, 'Seni', 'Sinta Maharani', 'draft', 3, 3, 3, 3, 2, 3,
     'Penampil utama sudah siap.', 'Lighting belum datang, molor 1 jam.', 'Vendor kirim jadwal mendadak.', 'Hubungi H-1 dan siapkan plan B.', 'Kontrak tertulis dengan vendor.',
     '', '[]'::jsonb,
     '[{"tugas":"Konfirmasi ulang vendor lighting","pic":"Sinta","deadline":"2026-09-18","status":"belum"}]'::jsonb),
    ('Bagi Takjil Hari ke-10', NULL::bigint, NULL::bigint, '2026-03-15'::date, 'Sosial', 'Dewi Lestari', 'selesai', 5, 5, 5, 5, 5, 5,
     '200 paket habis dalam 20 menit, tertib.', '-', '-', '-', '-', 'Tambah titik distribusi tahun depan.', '[]'::jsonb, '[]'::jsonb),
    ('Persiapan Technical Meeting', NULL::bigint, NULL::bigint, '2026-09-02'::date, 'Olahraga', 'Bima Sakti', 'belum', 2, 2, 2, 2, 2, 2,
     '', 'Jadwal bentrok dengan ujian.', '', '', '', '', '[]'::jsonb, '[]'::jsonb)
) AS v(nama_kegiatan, agenda_id, proker_id, tgl_kegiatan, divisi, pj, status, rating_total, r_persiapan, r_pelaksanaan, r_koordinasi, r_waktu, r_anggaran, baik, kendala, penyebab, solusi, perbaiki, rekomendasi, dokumentasi, tugas)
WHERE NOT EXISTS (SELECT 1 FROM public.osis_evaluasi);