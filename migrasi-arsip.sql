-- MIGRASI: tabel arsip (struktur persis kegiatan) + pindah data kegiatan -> arsip.
-- Cara pakai: jalankan sekali di Supabase SQL Editor.
-- File storage TIDAK dipindah (path foto tetap valid, kebaca dari bucket lama).
-- Tabel kegiatan TIDAK dihapus (kurasi highlight home manual setelah ini).

CREATE TABLE IF NOT EXISTS public.arsip (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    judul text NOT NULL,
    deskripsi text NOT NULL DEFAULT '',
    badge text NOT NULL DEFAULT '',
    fotos jsonb NOT NULL DEFAULT '[]'::jsonb,
    display_order integer NOT NULL DEFAULT 99,
    pengunggah text NOT NULL DEFAULT '',
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_arsip_order ON public.arsip (display_order, created_at);
ALTER TABLE public.arsip ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "arsip_public_select" ON public.arsip;
CREATE POLICY "arsip_public_select" ON public.arsip FOR SELECT USING (true);

-- RPCs SECURITY DEFINER, cek osis_users (hak "kegiatan" dipakai bareng arsip)
CREATE OR REPLACE FUNCTION public.buat_arsip(p_user_id bigint, p_judul text, p_deskripsi text, p_badge text, p_fotos jsonb, p_display_order integer DEFAULT 99)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE nid bigint;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'kegiatan') THEN RETURN -1; END IF;
    p_judul := left(COALESCE(NULLIF(btrim(p_judul),''), 'Tanpa Judul'), 80);
    p_deskripsi := left(COALESCE(p_deskripsi,''), 200);
    p_badge := left(COALESCE(NULLIF(btrim(p_badge),''), ''), 12);
    IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' THEN p_fotos := '[]'::jsonb; END IF;
    INSERT INTO public.arsip (judul, deskripsi, badge, fotos, display_order, created_by)
    VALUES (p_judul, p_deskripsi, p_badge, p_fotos, COALESCE(p_display_order,99), p_user_id) RETURNING id INTO nid;
    RETURN nid;
END $$;
CREATE OR REPLACE FUNCTION public.update_arsip(p_user_id bigint, p_id bigint, p_judul text, p_deskripsi text, p_badge text, p_fotos jsonb, p_display_order integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'kegiatan') THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.arsip SET judul=left(COALESCE(NULLIF(btrim(p_judul),judul),judul),80), deskripsi=left(COALESCE(p_deskripsi,deskripsi),200), badge=left(COALESCE(p_badge,badge),12), fotos=COALESCE(p_fotos,fotos), display_order=COALESCE(p_display_order,display_order) WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;
CREATE OR REPLACE FUNCTION public.hapus_arsip(p_user_id bigint, p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'kegiatan') THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.arsip WHERE id=p_id;
    IF FOUND THEN RETURN 'OK'; END IF; RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_arsip(bigint, text, text, text, jsonb, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_arsip(bigint, bigint, text, text, text, jsonb, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_arsip(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_arsip(bigint, text, text, text, jsonb, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.update_arsip(bigint, bigint, text, text, text, jsonb, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_arsip(bigint, bigint) TO anon;

-- Label "diupload oleh" otomatis
DROP TRIGGER IF EXISTS trg_isi_pengunggah ON public.arsip;
CREATE TRIGGER trg_isi_pengunggah BEFORE INSERT ON public.arsip
FOR EACH ROW EXECUTE FUNCTION public.isi_pengunggah();

-- Storage arsip/ (upload baru arsip masuk folder ini)
DROP POLICY IF EXISTS "osis_foto_arsip_select" ON storage.objects;
CREATE POLICY "osis_foto_arsip_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='arsip');
DROP POLICY IF EXISTS "osis_foto_arsip_insert" ON storage.objects;
CREATE POLICY "osis_foto_arsip_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='arsip');
DROP POLICY IF EXISTS "osis_foto_arsip_delete" ON storage.objects;
CREATE POLICY "osis_foto_arsip_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='arsip');

-- PINDAH DATA: kegiatan -> arsip (id dipertahankan, idempotent, boleh re-run)
INSERT INTO public.arsip (id, judul, deskripsi, badge, fotos, display_order, pengunggah, created_by, created_at)
OVERRIDING SYSTEM VALUE
SELECT k.id, k.judul, k.deskripsi, k.badge, k.fotos, k.display_order, k.pengunggah, k.created_by, k.created_at
FROM public.kegiatan k
WHERE NOT EXISTS (SELECT 1 FROM public.arsip a WHERE a.id = k.id);
SELECT setval(pg_get_serial_sequence('public.arsip','id'), COALESCE((SELECT MAX(id) FROM public.arsip), 1));

-- OPSIONAL: setelah cek arsip tampil lengkap, kurasi home manual (hapus bulk
-- dari halaman Dokumentasi Kegiatan). JANGAN auto-hapus dari sini.
-- Contoh hapus massal kegiatan (jalankan manual bila yakin):
-- DELETE FROM public.kegiatan WHERE id NOT IN (...id highlight...);
