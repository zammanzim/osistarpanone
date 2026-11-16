-- =========================================================================
-- Migrasi: filter "nama" di halaman agenda
-- - sekbid_agenda_ringkas dapat param baru p_nama (DEFAULT NULL): statistik
--   (total/bulan_ini/n_sekbid/n_orang) ikut terfilter pengunggah.
-- - Signature lama (bigint, bigint) di-DROP supaya cuma ada SATU fungsi
--   (hindari ambigu PostgREST); client lama tetap jalan karena p_nama
--   punya DEFAULT.
-- - Catatan: normalisasi pengunggah orphan (Bintang sandi rofiansyah ->
--   Bintang, Deshtania -> Desthania) dijalankan sekali via SQL langsung,
--   tidak diulang di file ini karena data sudah bersih.
-- =========================================================================

DROP FUNCTION IF EXISTS public.sekbid_agenda_ringkas(bigint, bigint);

CREATE FUNCTION public.sekbid_agenda_ringkas(
  p_user_id bigint,
  p_sekbid_id bigint DEFAULT NULL,
  p_nama text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_bln text := to_char(CURRENT_DATE, 'YYYY-MM');
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'total', COUNT(*) FILTER (WHERE p_nama IS NULL OR btrim(pengunggah) = btrim(p_nama)),
      'bulan_ini', COUNT(*) FILTER (WHERE left(tanggal::text, 7) = v_bln AND (p_nama IS NULL OR btrim(pengunggah) = btrim(p_nama))),
      'n_sekbid', COUNT(DISTINCT sekbid_id) FILTER (WHERE p_nama IS NULL OR btrim(pengunggah) = btrim(p_nama)),
      'n_orang', COUNT(DISTINCT NULLIF(btrim(pengunggah), '')) FILTER (WHERE p_nama IS NULL OR btrim(pengunggah) = btrim(p_nama))
    )
    FROM public.sekbid_agenda
    WHERE (p_sekbid_id IS NULL OR sekbid_id = p_sekbid_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.sekbid_agenda_ringkas(bigint, bigint, text) TO anon, authenticated;
