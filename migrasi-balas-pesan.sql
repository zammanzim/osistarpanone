-- ============================================================
-- MIGRASI: balas pesan aspirasi & request lagu
-- Jalankan SEKALI di Supabase SQL Editor.
--
-- 1. Tambah kolom balasan / dibalas_oleh / dibalas_at di
--    public.aspirasi & public.lagu_requests
-- 2. RPC balas_aspirasi_osis & balas_lagu_osis: boleh dipakai
--    super_admin + admin yang dikasih hak halaman terkait
--    (cek public.osis_bisa). Balasan tampil untuk semua user.
--    p_balasan kosong = hapus balasan.
-- ============================================================

ALTER TABLE public.aspirasi
ADD COLUMN IF NOT EXISTS balasan text NOT NULL DEFAULT '';
ALTER TABLE public.aspirasi
ADD COLUMN IF NOT EXISTS dibalas_oleh text NOT NULL DEFAULT '';
ALTER TABLE public.aspirasi
ADD COLUMN IF NOT EXISTS dibalas_at timestamptz NULL;

ALTER TABLE public.lagu_requests
ADD COLUMN IF NOT EXISTS balasan text NOT NULL DEFAULT '';
ALTER TABLE public.lagu_requests
ADD COLUMN IF NOT EXISTS dibalas_oleh text NOT NULL DEFAULT '';
ALTER TABLE public.lagu_requests
ADD COLUMN IF NOT EXISTS dibalas_at timestamptz NULL;

-- Balas aspirasi oleh OSIS (super_admin / hak "aspirasi").
-- p_balasan kosong -> hapus balasan yang ada.
CREATE OR REPLACE FUNCTION public.balas_aspirasi_osis(
    p_user_id bigint,
    p_id bigint,
    p_balasan text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_nama text;
    v_balas text := left(COALESCE(btrim(p_balasan), ''), 500);
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'aspirasi') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF v_balas = '' THEN
        UPDATE public.aspirasi
        SET balasan = '', dibalas_oleh = '', dibalas_at = NULL
        WHERE id = p_id;
    ELSE
        SELECT COALESCE(NULLIF(btrim(nama), ''), username, '') INTO v_nama
        FROM public.osis_users WHERE id = p_user_id;
        IF NOT FOUND THEN RETURN 'ERR_NO_AUTH'; END IF;
        UPDATE public.aspirasi
        SET balasan = v_balas, dibalas_oleh = v_nama, dibalas_at = now()
        WHERE id = p_id;
    END IF;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Balas request lagu oleh OSIS (super_admin / hak "lagu").
-- p_balasan kosong -> hapus balasan yang ada.
CREATE OR REPLACE FUNCTION public.balas_lagu_osis(
    p_user_id bigint,
    p_id bigint,
    p_balasan text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_nama text;
    v_balas text := left(COALESCE(btrim(p_balasan), ''), 500);
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'lagu') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF v_balas = '' THEN
        UPDATE public.lagu_requests
        SET balasan = '', dibalas_oleh = '', dibalas_at = NULL
        WHERE id = p_id;
    ELSE
        SELECT COALESCE(NULLIF(btrim(nama), ''), username, '') INTO v_nama
        FROM public.osis_users WHERE id = p_user_id;
        IF NOT FOUND THEN RETURN 'ERR_NO_AUTH'; END IF;
        UPDATE public.lagu_requests
        SET balasan = v_balas, dibalas_oleh = v_nama, dibalas_at = now()
        WHERE id = p_id;
    END IF;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.balas_aspirasi_osis(bigint, bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.balas_lagu_osis(bigint, bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.balas_aspirasi_osis(bigint, bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.balas_lagu_osis(bigint, bigint, text) TO anon;
