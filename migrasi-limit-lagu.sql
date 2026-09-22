-- ============================================================
-- MIGRASI: fix limit request lagu & aspirasi
-- Jalankan SEKALI di Supabase SQL Editor.
--
-- Masalah:
-- 1. p_batas_harian bisa dikirim client (GRANT anon) -> bisa tembak 5/hari
-- 2. Hari dihitung UTC (CURRENT_DATE), padahal UI pakai WIB
-- 3. Produksi mungkin masih function lama DEFAULT 5
--
-- Fix: limit dipaksa 1 di dalam function, hari = Asia/Jakarta.
-- Signature tetap sama -> client / GRANT lama tetap cocok.
-- ============================================================

-- ============ ASPIRASI: maks 1/device/hari (WIB) ============
CREATE OR REPLACE FUNCTION public.kirim_aspirasi_terbatas(
    p_device_id text,
    p_nama text,
    p_kelas text,
    p_isi text,
    p_is_private boolean DEFAULT false,
    p_batas_harian integer DEFAULT 1
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    n integer;
    v_batas constant integer := 1;
    v_hari_wib constant date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN 'ERR_NO_DEVICE';
    END IF;
    SELECT count(*) INTO n FROM public.aspirasi
    WHERE device_id = p_device_id
      AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_hari_wib;
    IF n >= v_batas THEN
        RETURN 'ERR_LIMIT';
    END IF;
    INSERT INTO public.aspirasi (device_id, nama, kelas, isi, is_private)
    VALUES (p_device_id, p_nama, p_kelas, p_isi, COALESCE(p_is_private, false));
    RETURN 'OK';
END $$;

DROP FUNCTION IF EXISTS public.kirim_aspirasi_terbatas(text, text, text, text, integer);

-- ============ LAGU: maks 1/device/hari (WIB) ============
CREATE OR REPLACE FUNCTION public.kirim_lagu_terbatas(
    p_device_id text,
    p_judul text,
    p_penyanyi text,
    p_pesan text,
    p_nama text,
    p_batas_harian integer DEFAULT 1
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    n integer;
    v_batas constant integer := 1;
    v_hari_wib constant date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN 'ERR_NO_DEVICE';
    END IF;
    SELECT count(*) INTO n FROM public.lagu_requests
    WHERE device_id = p_device_id
      AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_hari_wib;
    IF n >= v_batas THEN
        RETURN 'ERR_LIMIT';
    END IF;
    INSERT INTO public.lagu_requests (device_id, judul, penyanyi, pesan, nama)
    VALUES (p_device_id, p_judul, p_penyanyi, COALESCE(NULLIF(btrim(p_pesan), ''), ''), p_nama);
    RETURN 'OK';
END $$;

DROP FUNCTION IF EXISTS public.kirim_lagu_terbatas(text, text, text, text, integer);

-- ============ Pastikan grant tetap cuma ke anon (signature lama) ============
REVOKE EXECUTE ON FUNCTION public.kirim_aspirasi_terbatas(text, text, text, text, boolean, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.kirim_lagu_terbatas(text, text, text, text, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.kirim_aspirasi_terbatas(text, text, text, text, boolean, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.kirim_lagu_terbatas(text, text, text, text, text, integer) TO anon;
