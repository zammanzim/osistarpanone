-- ============================================================
-- MIGRASI: label "diupload oleh" di semua konten (snapshot nama)
-- Jalankan SEKALI di Supabase SQL Editor.
--
-- Cara kerja: tiap tabel konten dapat kolom `pengunggah` (teks) yang
-- OTOMATIS diisi dari osis_users.nama via trigger BEFORE INSERT
-- (berdasarkan created_by). Tanpa ubah tanda tangan RPC mana pun.
-- Update tidak menyentuh pengunggah (tetap pengupload pertama).
-- Baris lama di-backfill dari nama pemilik created_by saat ini.
--
-- Tabel: gallery, prestasi, kegiatan, sekbid_agenda, rapat_notulensi,
-- proker, program, osis_dokumen, osis_task, osis_kas, osis_evaluasi,
-- osis_formulir, osis_absensi, osis_tabungan, polling_kandidat,
-- poster, informasi.
-- Dikecualikan: lagu/aspirasi (publik anonim), polling_suara (privasi),
-- site_content/web_foto/pimpinan (setting super), anggota/sekbid (direktori orang).
-- ============================================================

-- ============ 1. KOLOM ============
ALTER TABLE public.gallery ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.prestasi ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.kegiatan ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.sekbid_agenda ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.rapat_notulensi ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.proker ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.program ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.osis_dokumen ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.osis_task ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.osis_kas ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.osis_evaluasi ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.osis_formulir ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.osis_absensi ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.osis_tabungan ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.poster ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';
ALTER TABLE public.informasi ADD COLUMN IF NOT EXISTS pengunggah text NOT NULL DEFAULT '';

-- ============ 2. TRIGGER: isi otomatis dari nama pembuat ============
CREATE OR REPLACE FUNCTION public.isi_pengunggah()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NEW.pengunggah IS NULL OR btrim(NEW.pengunggah) = '' THEN
        SELECT COALESCE(NULLIF(btrim(nama), ''), username, '') INTO NEW.pengunggah
        FROM public.osis_users WHERE id = NEW.created_by;
        IF NEW.pengunggah IS NULL THEN NEW.pengunggah := ''; END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.gallery;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.gallery
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.prestasi;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.prestasi
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.kegiatan;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.kegiatan
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.sekbid_agenda;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.sekbid_agenda
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.rapat_notulensi;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.rapat_notulensi
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.proker;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.proker
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.program;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.program
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.osis_dokumen;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.osis_dokumen
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.osis_task;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.osis_task
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.osis_kas;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.osis_kas
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.osis_evaluasi;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.osis_evaluasi
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.osis_formulir;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.osis_formulir
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.osis_absensi;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.osis_absensi
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.osis_tabungan;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.osis_tabungan
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.polling_kandidat;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.polling_kandidat
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.poster;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.poster
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.informasi;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.informasi
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();

-- ============ 3. BACKFILL: isi yang kosong dari nama pemilik ============
UPDATE public.gallery g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.prestasi g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.kegiatan g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.sekbid_agenda g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.rapat_notulensi g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.proker g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.program g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.osis_dokumen g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.osis_task g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.osis_kas g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.osis_evaluasi g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.osis_formulir g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.osis_absensi g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.osis_tabungan g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.polling_kandidat g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.poster g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
UPDATE public.informasi g SET pengunggah = COALESCE((SELECT NULLIF(btrim(u.nama), '') FROM public.osis_users u WHERE u.id = g.created_by), '') WHERE COALESCE(btrim(g.pengunggah), '') = '';
