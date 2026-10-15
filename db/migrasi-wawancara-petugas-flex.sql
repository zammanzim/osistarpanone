-- =========================================================================
-- MIGRASI-WAWANCARA-PETUGAS-FLEX — pewawancara TAK TERBATAS per sesi
-- Sifat: NON-DESTRUKTIF. Hanya CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE
-- FUNCTION + policy/grant baru. Kolom lama pewawancara1_id/2_id DIPERTAHANKAN
-- (disinkron otomatis = 2 pertama) agar klien lama/cache lama tetap jalan.
-- Cara pakai: Supabase Dashboard > SQL Editor > tempel seluruh file > Run.
-- Bisa di-run ulang kapan saja (idempotent; backfill pakai ON CONFLICT).
-- =========================================================================

-- ================= 1. TABEL PENUGASAN (N pewawancara per sesi) =================
CREATE TABLE IF NOT EXISTS public.wawancara_sesi_petugas (
  sesi_id    bigint NOT NULL REFERENCES public.wawancara_sesi (id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES public.osis_users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wawancara_sesi_petugas_pk PRIMARY KEY (sesi_id, user_id)
);
CREATE INDEX IF NOT EXISTS wawancara_sesi_petugas_sesi_idx
  ON public.wawancara_sesi_petugas (sesi_id);

-- Backfill: pindahkan penugasan lama (kolom 1/2) ke tabel baru.
INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
SELECT id, pewawancara1_id FROM public.wawancara_sesi WHERE pewawancara1_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
SELECT id, pewawancara2_id FROM public.wawancara_sesi WHERE pewawancara2_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ================= 2. RLS (ikut pola existing: baca OSIS, tulis via RPC) =================
ALTER TABLE public.wawancara_sesi_petugas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_sesi_petugas;
CREATE POLICY wawancara_osis_select ON public.wawancara_sesi_petugas
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.osis_users u WHERE u.auth_id = auth.uid()));
GRANT SELECT ON public.wawancara_sesi_petugas TO anon, authenticated;

-- ================= 3. RPC =================
-- Boleh mencatat: cek tabel baru DULU, fallback kolom lama (sesi yang
-- penugasannya belum di-backfill / ditulis klien lama langsung ke kolom).
CREATE OR REPLACE FUNCTION public.wawancara_boleh(p_user_id bigint, p_sesi_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_username text;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  SELECT username INTO v_username FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.osis_is_super(v_username) THEN RETURN true; END IF;
  IF p_sesi_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.wawancara_sesi_petugas
             WHERE sesi_id = p_sesi_id AND user_id = p_user_id) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.wawancara_sesi s
                 WHERE s.id = p_sesi_id
                   AND (s.pewawancara1_id = p_user_id OR s.pewawancara2_id = p_user_id));
END $$;

-- Atur ulang DAFTAR pewawancara sesi (jumlah bebas, minimal 1).
-- Kolom lama disinkron = 2 pertama (urutan sesuai array) agar klien lama tetap baca benar.
CREATE OR REPLACE FUNCTION public.wawancara_sesi_petugas_set(
  p_user_id bigint, p_sesi_id bigint, p_ids bigint[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id bigint; v_arr bigint[] := '{}';
BEGIN
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wawancara_sesi WHERE id = p_sesi_id) THEN RETURN 'ERR_NOT_FOUND'; END IF;
  IF p_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY p_ids LOOP
      IF v_id IS NULL THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = v_id) THEN RETURN 'ERR_PETUGAS'; END IF;
      IF NOT (v_id = ANY (v_arr)) THEN v_arr := v_arr || v_id; END IF;
    END LOOP;
  END IF;
  IF array_length(v_arr, 1) IS NULL THEN RETURN 'ERR_KOSONG'; END IF;
  DELETE FROM public.wawancara_sesi_petugas WHERE sesi_id = p_sesi_id;
  INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
  SELECT p_sesi_id, unnest(v_arr)
  ON CONFLICT DO NOTHING;
  UPDATE public.wawancara_sesi SET
    pewawancara1_id = v_arr[1], pewawancara2_id = v_arr[2], updated_at = now()
  WHERE id = p_sesi_id;
  RETURN 'OK';
END $$;

-- RPC lama (2 slot): dipertahankan untuk klien lama, tapi ikut sinkron ke tabel baru.
CREATE OR REPLACE FUNCTION public.wawancara_sesi_petugas(
  p_user_id bigint, p_sesi_id bigint,
  p_pewawancara1_id bigint DEFAULT NULL, p_pewawancara2_id bigint DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF p_pewawancara1_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_pewawancara1_id) THEN RETURN 'ERR_PETUGAS'; END IF;
  IF p_pewawancara2_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_pewawancara2_id) THEN RETURN 'ERR_PETUGAS'; END IF;
  UPDATE public.wawancara_sesi SET
    pewawancara1_id = p_pewawancara1_id, pewawancara2_id = p_pewawancara2_id, updated_at = now()
  WHERE id = p_sesi_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  DELETE FROM public.wawancara_sesi_petugas WHERE sesi_id = p_sesi_id;
  INSERT INTO public.wawancara_sesi_petugas (sesi_id, user_id)
  SELECT p_sesi_id, v FROM unnest(ARRAY[p_pewawancara1_id, p_pewawancara2_id]) AS v
  WHERE v IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN 'OK';
END $$;

GRANT EXECUTE ON FUNCTION public.wawancara_boleh(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wawancara_sesi_petugas_set(bigint, bigint, bigint[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wawancara_sesi_petugas(bigint, bigint, bigint, bigint) TO anon, authenticated;
