-- =========================================================================
-- MIGRASI-OSIS-VISITOR — tabel khusus kunjungan dashboard (PISAH TOTAL
-- dari tabel visitor publik). Buat halaman-halaman di /osis saja.
-- Sifat: NON-DESTRUKTIF (IF NOT EXISTS + CREATE OR REPLACE). Bisa di-run
-- ulang kapan saja. Cara pakai: SQL Editor > tempel > Run.
-- - osis_visitor: 1 baris per device (kunjungan pengurus, 1x/hari WIB).
-- - tambah_osis_visitor_unik: upsert + gabung device ganda per user_key
--   (mirror tambah_visitor_unik), khusus login OSIS (cek osis_users).
-- - osis_visitor_list: baca semua baris, khusus login OSIS.
-- RLS NYALA tanpa policy: baca/tulis HANYA lewat 2 RPC di bawah
-- (SECURITY DEFINER). Tanpa SELECT policy = realtime tabel ini mati
-- sengaja; frontend polling tiap buka popup (cukup buat dashboard).
-- Dipakai: js/osis-visitor.js (p_user_id dari OsisAuth, mode osis).
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.osis_visitor (
  device_id   text PRIMARY KEY,
  osis_user_id bigint,
  jumlah      integer NOT NULL DEFAULT 1,
  masuk       timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  label       text NOT NULL DEFAULT 'Unknown',
  tipe        text NOT NULL DEFAULT '',
  user_agent  text NOT NULL DEFAULT '',
  resolusi    text NOT NULL DEFAULT '',
  name        text NOT NULL DEFAULT '',
  user_key    text NOT NULL DEFAULT '',
  halaman     text NOT NULL DEFAULT '',
  mode        text NOT NULL DEFAULT 'browser'
);

ALTER TABLE public.osis_visitor ENABLE ROW LEVEL SECURITY;

-- ---- Catat kunjungan unik per device (1x per hari WIB), return total ----
CREATE OR REPLACE FUNCTION public.tambah_osis_visitor_unik(
  p_user_id  bigint,
  p_key      text,
  p_label    text DEFAULT '',
  p_tipe     text DEFAULT '',
  p_ua       text DEFAULT '',
  p_resolusi text DEFAULT '',
  p_name     text DEFAULT '',
  p_user_key text DEFAULT '',
  p_halaman  text DEFAULT '',
  p_mode     text DEFAULT 'browser')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  total        bigint;
  hari_wib     date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_uid        bigint := NULLIF(p_user_id, NULL);
  v_ukey       text := lower(btrim(COALESCE(p_user_key, '')));
  v_nama       text := btrim(COALESCE(p_name, ''));
  v_hal        text := btrim(COALESCE(p_halaman, ''));
  v_old_jumlah bigint := 0;
  v_mode       text := CASE WHEN lower(btrim(COALESCE(p_mode, ''))) = 'app' THEN 'app' ELSE 'browser' END;
BEGIN
  -- Khusus pengurus: tolak anonim / non-osis
  IF v_uid IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = v_uid) THEN
    RETURN -1;
  END IF;
  IF p_key IS NULL OR p_key = '' THEN
    RETURN 0;
  END IF;
  -- 1 user = 1 baris walau pindah device (jumlah digabung ke device terbaru)
  IF v_ukey <> '' THEN
    SELECT COALESCE(SUM(jumlah), 0) INTO v_old_jumlah
    FROM public.osis_visitor
    WHERE device_id <> p_key
      AND (
        lower(btrim(user_key)) = v_ukey
        OR (
          COALESCE(btrim(user_key), '') = ''
          AND v_nama <> ''
          AND lower(btrim(name)) = lower(v_nama)
        )
      );
    DELETE FROM public.osis_visitor
    WHERE device_id <> p_key
      AND (
        lower(btrim(user_key)) = v_ukey
        OR (
          COALESCE(btrim(user_key), '') = ''
          AND v_nama <> ''
          AND lower(btrim(name)) = lower(v_nama)
        )
      );
  END IF;
  INSERT INTO public.osis_visitor
    (device_id, osis_user_id, jumlah, name, user_key, label, tipe, user_agent, resolusi, halaman, mode, masuk, last_seen)
  VALUES (
    p_key, v_uid, 1 + v_old_jumlah, v_nama, v_ukey,
    COALESCE(NULLIF(btrim(p_label), ''), 'Unknown'),
    COALESCE(NULLIF(btrim(p_tipe), ''), ''),
    COALESCE(NULLIF(btrim(p_ua), ''), ''),
    COALESCE(NULLIF(btrim(p_resolusi), ''), ''),
    v_hal,
    v_mode,
    now(), now()
  )
  ON CONFLICT (device_id) DO UPDATE SET
    osis_user_id = v_uid,
    jumlah = CASE
      WHEN (osis_visitor.last_seen AT TIME ZONE 'Asia/Jakarta')::date = hari_wib
        THEN osis_visitor.jumlah + v_old_jumlah
      ELSE osis_visitor.jumlah + 1 + v_old_jumlah
    END,
    name = CASE WHEN v_nama <> '' THEN v_nama ELSE osis_visitor.name END,
    user_key = CASE WHEN v_ukey <> '' THEN v_ukey ELSE osis_visitor.user_key END,
    label = CASE WHEN COALESCE(NULLIF(btrim(p_label), ''), '') <> '' THEN btrim(p_label) ELSE osis_visitor.label END,
    tipe = CASE WHEN COALESCE(NULLIF(btrim(p_tipe), ''), '') <> '' THEN btrim(p_tipe) ELSE osis_visitor.tipe END,
    user_agent = CASE WHEN COALESCE(NULLIF(btrim(p_ua), ''), '') <> '' THEN btrim(p_ua) ELSE osis_visitor.user_agent END,
    resolusi = CASE WHEN COALESCE(NULLIF(btrim(p_resolusi), ''), '') <> '' THEN btrim(p_resolusi) ELSE osis_visitor.resolusi END,
    halaman = CASE WHEN v_hal <> '' THEN v_hal ELSE osis_visitor.halaman END,
    mode = v_mode,
    masuk = CASE
      WHEN v_old_jumlah > 0 THEN now()
      WHEN (osis_visitor.last_seen AT TIME ZONE 'Asia/Jakarta')::date = hari_wib THEN osis_visitor.masuk
      ELSE now()
    END,
    last_seen = now();
  SELECT COALESCE(SUM(jumlah), 0) INTO total FROM public.osis_visitor;
  RETURN total;
END $$;

-- ---- Baca semua baris (khusus login OSIS) ----
CREATE OR REPLACE FUNCTION public.osis_visitor_list(p_user_id bigint)
RETURNS TABLE (
  device_id  text,
  jumlah     integer,
  name       text,
  user_key   text,
  label      text,
  tipe       text,
  user_agent text,
  resolusi   text,
  masuk      timestamptz,
  last_seen  timestamptz,
  halaman    text,
  mode       text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v.device_id, v.jumlah, v.name, v.user_key, v.label, v.tipe,
         v.user_agent, v.resolusi, v.masuk, v.last_seen, v.halaman, v.mode
  FROM public.osis_visitor v
  ORDER BY v.last_seen DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.tambah_osis_visitor_unik(bigint, text, text, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.osis_visitor_list(bigint) TO anon, authenticated;
