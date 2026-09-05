-- ============================================================
-- WEB OSIS TARPAN ONE â€” SCHEMA LENGKAP (RUN SEMUA SEKALI)
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
-- limit HARUS lewat function ini â€” ga bisa bypass dari client.

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
-- Cuma akun OSIS (id ada di osis_users) boleh nambah/hapus —
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

-- Update fotos galeri (hapus 1 foto → auto hapus kalau kosong di client, tapi RPC ini untuk update array)
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

-- ============ 7. STORAGE — FOLDER GALLERY DI BUCKET osis-foto ============
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

-- ============ 8. SITE CONTENT — TEKS EDITABLE (HERO/VISI/MISI/PEMBINA/DLL) ============
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
-- client) bisa upsert — validasi OSIS Tetep di client (SiteEdit cek mode).
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

-- RPCs — SECURITY DEFINER, cek osis_users
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
