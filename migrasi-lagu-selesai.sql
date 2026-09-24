-- ============================================================
-- MIGRASI: tandai selesai request lagu (super_admin, hijau di UI)
-- Jalankan SEKALI di Supabase SQL Editor.
--
-- 1. Tambah kolom lagu_requests.selesai (boolean, default false)
-- 2. RPC tandai_lagu_selesai: KHUSUS super_admin (cek osis_is_super),
--    buat nandain lagu udah diputar / batalin tandanya.
-- ============================================================

ALTER TABLE public.lagu_requests
ADD COLUMN IF NOT EXISTS selesai boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lagu_requests_selesai
ON public.lagu_requests (selesai);

-- Tandai selesai / batalkan (KHUSUS super_admin).
-- p_selesai=true  -> tandai selesai (hijau di playlist)
-- p_selesai=false -> batalkan tanda (balik normal)
CREATE OR REPLACE FUNCTION public.tandai_lagu_selesai(
    p_user_id bigint,
    p_id bigint,
    p_selesai boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_username text;
BEGIN
    SELECT username INTO v_username
    FROM public.osis_users WHERE id = p_user_id;
    IF NOT FOUND OR NOT public.osis_is_super(v_username) THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    UPDATE public.lagu_requests
    SET selesai = COALESCE(p_selesai, true)
    WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.tandai_lagu_selesai(bigint, bigint, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.tandai_lagu_selesai(bigint, bigint, boolean) TO anon;
