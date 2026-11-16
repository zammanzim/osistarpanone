-- =========================================================================
-- MIGRASI-ABSENSI-TAHUN-AKTIF
-- 1) Tabel public.osis_absensi_config (setting tahun aktif & default per angkatan)
-- 2) RPC public.simpan_absensi_config (kelola setting angkatan + sync tabel periode)
-- 3) Seed awal config angkatan & perbaiki backfill osis_absensi (2027 -> ADIABI-5)
--
-- Sifat: IDEMPOTEN.
-- =========================================================================

BEGIN;

-- ================= 1. TABEL CONFIG ABSENSI PER ANGKATAN =================
CREATE TABLE IF NOT EXISTS public.osis_absensi_config (
  angkatan_id   bigint PRIMARY KEY REFERENCES public.angkatan (id) ON DELETE CASCADE,
  tahun_aktif   integer[] NOT NULL DEFAULT '{}'::integer[],
  tahun_default integer NULL REFERENCES public.periode (tahun) ON DELETE SET NULL,
  updated_by    bigint REFERENCES public.osis_users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_absensi_config_updated_by
  ON public.osis_absensi_config (updated_by);
CREATE INDEX IF NOT EXISTS idx_absensi_config_tahun_default
  ON public.osis_absensi_config (tahun_default);

-- ================= 2. RLS & HAK AKSES =================
ALTER TABLE public.osis_absensi_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.osis_absensi_config FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.osis_absensi_config TO authenticated;
GRANT ALL ON TABLE public.osis_absensi_config TO service_role;

DROP POLICY IF EXISTS absensi_config_osis_select ON public.osis_absensi_config;
CREATE POLICY absensi_config_osis_select ON public.osis_absensi_config
  FOR SELECT TO authenticated
  USING (
    (SELECT public.osis_id_dari_auth()) IS NOT NULL
    AND (
      (SELECT public.osis_lintas_angkatan((SELECT public.osis_id_dari_auth())))
      OR angkatan_id = (SELECT public.osis_angkatan_dari_auth())
    )
  );

-- ================= 3. RPC SIMPAN SETTING TAHUN AKTIF =================
CREATE OR REPLACE FUNCTION public.simpan_absensi_config(
  p_user_id       bigint,
  p_tahun_aktif   integer[] DEFAULT '{}'::integer[],
  p_tahun_default integer DEFAULT NULL,
  p_angkatan_id   bigint DEFAULT NULL,
  p_periode_aktif integer[] DEFAULT NULL,
  p_tambah_tahun  integer[] DEFAULT '{}'::integer[]
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang        bigint;
  v_aktif      integer[];
  v_per_aktif  integer[];
  v_semua_baru integer[];
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN RETURN 'ERR_NO_AUTH'; END IF;
  END IF;

  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  IF NOT public.osis_bisa(p_user_id, 'absensi') THEN
    RETURN 'ERR_NO_AUTH';
  END IF;

  v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
  IF v_ang IS NULL THEN
    RETURN 'ERR_NO_AUTH';
  END IF;

  IF p_tahun_default IS NOT NULL AND (p_tahun_default < 2000 OR p_tahun_default > 2100) THEN
    RETURN 'ERR_TAHUN';
  END IF;

  v_aktif := COALESCE((
    SELECT array_agg(DISTINCT t ORDER BY t)
      FROM unnest(COALESCE(p_tahun_aktif, '{}'::integer[])) AS t
     WHERE t BETWEEN 2000 AND 2100
  ), '{}'::integer[]);

  IF p_tahun_default IS NOT NULL
     AND COALESCE(array_length(v_aktif, 1), 0) > 0
     AND NOT (p_tahun_default = ANY(v_aktif)) THEN
    v_aktif := (
      SELECT array_agg(DISTINCT t ORDER BY t)
        FROM unnest(array_append(v_aktif, p_tahun_default)) AS t
    );
  END IF;

  -- Pastikan semua tahun baru / terpilih ada di master periode
  SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), '{}'::integer[])
    INTO v_semua_baru
    FROM unnest(
      COALESCE(p_tambah_tahun, '{}'::integer[])
      || v_aktif
      || CASE WHEN p_tahun_default IS NOT NULL THEN ARRAY[p_tahun_default] ELSE '{}'::integer[] END
      || COALESCE(p_periode_aktif, '{}'::integer[])
    ) AS t
   WHERE t BETWEEN 2000 AND 2100;

  IF COALESCE(array_length(v_semua_baru, 1), 0) > 0 THEN
    INSERT INTO public.periode (tahun, aktif)
    SELECT t, false
      FROM unnest(v_semua_baru) AS t
    ON CONFLICT (tahun) DO NOTHING;
  END IF;

  INSERT INTO public.osis_absensi_config (
    angkatan_id, tahun_aktif, tahun_default, updated_by, updated_at
  )
  VALUES (
    v_ang, v_aktif, p_tahun_default, p_user_id, now()
  )
  ON CONFLICT (angkatan_id) DO UPDATE SET
    tahun_aktif   = EXCLUDED.tahun_aktif,
    tahun_default = EXCLUDED.tahun_default,
    updated_by    = EXCLUDED.updated_by,
    updated_at    = now();

  IF p_periode_aktif IS NOT NULL THEN
    v_per_aktif := COALESCE((
      SELECT array_agg(DISTINCT t ORDER BY t)
        FROM unnest(p_periode_aktif) AS t
       WHERE t BETWEEN 2000 AND 2100
    ), '{}'::integer[]);

    UPDATE public.periode
       SET aktif      = (tahun = ANY(v_per_aktif)),
           updated_at = now()
     WHERE tahun IS NOT NULL;
  END IF;

  RETURN 'OK';
END;
$function$;

REVOKE ALL ON FUNCTION public.simpan_absensi_config(bigint, integer[], integer, bigint, integer[], integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simpan_absensi_config(bigint, integer[], integer, bigint, integer[], integer[]) TO authenticated, service_role;

-- ================= 4. SEED CONFIG AWAL & PERBAIKI BACKFILL ABSENSI =================
INSERT INTO public.osis_absensi_config (angkatan_id, tahun_aktif, tahun_default)
SELECT a.id, ARRAY[a.tahun]::integer[], a.tahun
  FROM public.angkatan a
 WHERE a.tahun IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.periode p WHERE p.tahun = a.tahun)
ON CONFLICT (angkatan_id) DO NOTHING;

DO $$
DECLARE
  v_j4_id bigint;
  v_j5_id bigint;
BEGIN
  SELECT id INTO v_j4_id FROM public.angkatan WHERE kode = 'ADIABI-4' LIMIT 1;
  SELECT id INTO v_j5_id FROM public.angkatan WHERE kode = 'ADIABI-5' LIMIT 1;

  IF v_j4_id IS NOT NULL AND v_j5_id IS NOT NULL THEN
    UPDATE public.osis_absensi tgt
       SET angkatan_id = v_j5_id,
           updated_at  = now()
     WHERE tgt.angkatan_id = v_j4_id
       AND (
         (
           EXISTS (
             SELECT 1 FROM public.anggota ag5
              WHERE ag5.angkatan_id = v_j5_id
                AND lower(btrim(ag5.nama)) = lower(btrim(tgt.nama))
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.anggota ag4
              WHERE ag4.angkatan_id = v_j4_id
                AND lower(btrim(ag4.nama)) = lower(btrim(tgt.nama))
           )
         )
         OR (
           tgt.tanggal = DATE '2026-10-15'
           AND lower(btrim(COALESCE(tgt.kegiatan, ''))) = 'rapat among'
           AND NOT EXISTS (
             SELECT 1 FROM public.anggota ag4
              WHERE ag4.angkatan_id = v_j4_id
                AND lower(btrim(ag4.nama)) = lower(btrim(tgt.nama))
           )
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.osis_absensi dup
          WHERE dup.angkatan_id = v_j5_id
            AND dup.tanggal = tgt.tanggal
            AND lower(dup.nama) = lower(tgt.nama)
       );
  END IF;
END $$;

COMMIT;
