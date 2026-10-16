-- =========================================================================
-- MIGRASI-NOTULENSI — halaman rangkuman rapat (osis/notulensi.html)
-- Sifat: NON-DESTRUKTIF. CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE
-- FUNCTION + INSERT ... WHERE NOT EXISTS. Aman di-run ulang kapan saja.
-- Cara pakai: Supabase SQL Editor > tempel > Run.
-- - tabel rapat_notulensi (kolom persis dipakai js/db.js + js/notulensi.js)
-- - RLS: baca = wajib login (authenticated), tulis = hanya via RPC
--   SECURITY DEFINER (pola osis_dokumen / sekbid_agenda)
-- - RPC: buat_notulensi / update_notulensi / hapus_notulensi
-- - akses: seluruh pengurus (osis_users) diberi halaman "notulensi"
-- - seed: 1 baris contoh = Notulen Rapat Among, 15 Okt 2026
-- =========================================================================

-- ---- 1) Tabel ----
CREATE TABLE IF NOT EXISTS public.rapat_notulensi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  judul text NOT NULL DEFAULT 'Tanpa judul',
  tanggal date,
  waktu_mulai text NOT NULL DEFAULT '',
  waktu_selesai text NOT NULL DEFAULT '',
  lokasi text NOT NULL DEFAULT '',
  divisi text NOT NULL DEFAULT '',
  pimpinan text NOT NULL DEFAULT '',
  notulis text NOT NULL DEFAULT '',
  peserta text NOT NULL DEFAULT '',
  agenda_topik text NOT NULL DEFAULT '',
  isi_pembahasan text NOT NULL DEFAULT '',
  keputusan text NOT NULL DEFAULT '',
  tindak_lanjut jsonb NOT NULL DEFAULT '[]'::jsonb,
  lampiran jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'selesai'
    CHECK (status IN ('rencana', 'selesai', 'belum_tindaklanjut', 'batal')),
  pengunggah text NOT NULL DEFAULT '',
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rapat_notulensi_tanggal_idx
  ON public.rapat_notulensi (tanggal DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS rapat_notulensi_divisi_idx
  ON public.rapat_notulensi (divisi);

-- ---- 2) RLS: baca wajib login, tulis hanya lewat RPC ----
ALTER TABLE public.rapat_notulensi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notulensi_login_select ON public.rapat_notulensi;
CREATE POLICY notulensi_login_select ON public.rapat_notulensi
  FOR SELECT TO authenticated USING (true);

-- ---- 3) RPC tulis (pola buat/update/hapus_dokumen) ----
CREATE OR REPLACE FUNCTION public.buat_notulensi(
  p_user_id bigint,
  p_judul text,
  p_tanggal date,
  p_waktu_mulai text,
  p_waktu_selesai text,
  p_lokasi text,
  p_divisi text,
  p_pimpinan text,
  p_notulis text,
  p_peserta text,
  p_agenda_topik text,
  p_isi_pembahasan text,
  p_keputusan text,
  p_tindak_lanjut jsonb,
  p_lampiran jsonb,
  p_status text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE nid bigint;
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN -1;
  END IF;
  IF p_tindak_lanjut IS NULL OR jsonb_typeof(p_tindak_lanjut) <> 'array' THEN
    p_tindak_lanjut := '[]'::jsonb;
  END IF;
  IF p_lampiran IS NULL OR jsonb_typeof(p_lampiran) <> 'array' THEN
    p_lampiran := '[]'::jsonb;
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('rencana', 'selesai', 'belum_tindaklanjut', 'batal') THEN
    p_status := 'selesai';
  END IF;
  INSERT INTO public.rapat_notulensi
    (judul, tanggal, waktu_mulai, waktu_selesai, lokasi, divisi, pimpinan,
     notulis, peserta, agenda_topik, isi_pembahasan, keputusan,
     tindak_lanjut, lampiran, status, created_by)
  VALUES
    (left(COALESCE(NULLIF(btrim(p_judul), ''), 'Tanpa judul'), 160),
     p_tanggal,
     left(COALESCE(p_waktu_mulai, ''), 20),
     left(COALESCE(p_waktu_selesai, ''), 20),
     left(COALESCE(p_lokasi, ''), 120),
     left(COALESCE(p_divisi, ''), 80),
     left(COALESCE(p_pimpinan, ''), 120),
     left(COALESCE(p_notulis, ''), 120),
     left(COALESCE(p_peserta, ''), 4000),
     left(COALESCE(p_agenda_topik, ''), 4000),
     left(COALESCE(p_isi_pembahasan, ''), 8000),
     left(COALESCE(p_keputusan, ''), 8000),
     p_tindak_lanjut, p_lampiran, p_status, p_user_id)
  RETURNING id INTO nid;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.update_notulensi(
  p_user_id bigint,
  p_id bigint,
  p_judul text,
  p_tanggal date,
  p_waktu_mulai text,
  p_waktu_selesai text,
  p_lokasi text,
  p_divisi text,
  p_pimpinan text,
  p_notulis text,
  p_peserta text,
  p_agenda_topik text,
  p_isi_pembahasan text,
  p_keputusan text,
  p_tindak_lanjut jsonb,
  p_lampiran jsonb,
  p_status text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  IF p_tindak_lanjut IS NOT NULL AND jsonb_typeof(p_tindak_lanjut) <> 'array' THEN
    p_tindak_lanjut := '[]'::jsonb;
  END IF;
  IF p_lampiran IS NOT NULL AND jsonb_typeof(p_lampiran) <> 'array' THEN
    p_lampiran := '[]'::jsonb;
  END IF;
  UPDATE public.rapat_notulensi SET
    judul = left(COALESCE(NULLIF(btrim(p_judul), judul), judul), 160),
    tanggal = COALESCE(p_tanggal, tanggal),
    waktu_mulai = left(COALESCE(p_waktu_mulai, waktu_mulai), 20),
    waktu_selesai = left(COALESCE(p_waktu_selesai, waktu_selesai), 20),
    lokasi = left(COALESCE(p_lokasi, lokasi), 120),
    divisi = left(COALESCE(p_divisi, divisi), 80),
    pimpinan = left(COALESCE(p_pimpinan, pimpinan), 120),
    notulis = left(COALESCE(p_notulis, notulis), 120),
    peserta = left(COALESCE(p_peserta, peserta), 4000),
    agenda_topik = left(COALESCE(p_agenda_topik, agenda_topik), 4000),
    isi_pembahasan = left(COALESCE(p_isi_pembahasan, isi_pembahasan), 8000),
    keputusan = left(COALESCE(p_keputusan, keputusan), 8000),
    tindak_lanjut = COALESCE(p_tindak_lanjut, tindak_lanjut),
    lampiran = COALESCE(p_lampiran, lampiran),
    status = COALESCE(NULLIF(btrim(p_status), ''), status)
  WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.hapus_notulensi(p_user_id bigint, p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN
    RETURN 'ERR_NO_AUTH';
  END IF;
  DELETE FROM public.rapat_notulensi WHERE id = p_id;
  IF FOUND THEN RETURN 'OK'; END IF;
  RETURN 'ERR_NOT_FOUND';
END $$;

GRANT EXECUTE ON FUNCTION public.buat_notulensi(bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_notulensi(bigint, bigint, text, date, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_notulensi(bigint, bigint) TO anon, authenticated;

-- ---- 4) Akses: seluruh pengurus boleh buka halaman "notulensi" ----
-- (super_admin lolos otomatis; matriks per user bisa dicabut via halaman Akses)
INSERT INTO public.osis_akses (user_id, halaman)
SELECT u.id, 'notulensi'
FROM public.osis_users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.osis_akses a
  WHERE a.user_id = u.id AND a.halaman = 'notulensi'
);

-- ---- 5) Seed contoh: Notulen Rapat Among, 15 Okt 2026 ----
INSERT INTO public.rapat_notulensi
  (judul, tanggal, waktu_mulai, waktu_selesai, lokasi, divisi,
   pimpinan, notulis, peserta, agenda_topik, isi_pembahasan, keputusan, status)
SELECT
  'Pembagian Kepanitiaan Among (Pembagian Rapor)',
  DATE '2026-10-15',
  '19:20', '', 'Google Meet', 'Umum',
  '', '',
  'Sella Erika' || chr(10) || 'Bintang Sandi' || chr(10) || 'Keanu' || chr(10)
    || 'Siti Amira' || chr(10) || 'Lia' || chr(10) || 'M. Rizki N' || chr(10)
    || 'Adelia' || chr(10) || 'Zaenal' || chr(10) || 'M. Haikal' || chr(10)
    || 'Rahmawati' || chr(10) || 'Queensha' || chr(10) || 'Sartika' || chr(10)
    || 'Naura' || chr(10) || 'Nurul Gisela' || chr(10) || 'Maulidyna Almira' || chr(10)
    || 'Nazma' || chr(10) || 'Maulidia Naftalika' || chr(10) || 'Silvana',
  'Susunan acara:' || chr(10)
    || '1. Pembukaan' || chr(10)
    || '2. Sambutan' || chr(10)
    || '3. Pembahasan agenda inti' || chr(10)
    || '4. Tanya jawab' || chr(10)
    || '5. Penutup',
  'Pembagian rapor:' || chr(10)
    || 'Panitia yang bertugas sekitar 16 orang karena pihak sekolah meminta jumlah petugas yang terbatas.' || chr(10) || chr(10)
    || 'Dress code:' || chr(10)
    || '- Kelas XI-XII: PDL, celana hitam, kerudung hitam, pin dan lanyard.' || chr(10)
    || '- Kelas X: batik, celana hitam, kerudung hitam (segi 4).' || chr(10)
    || '- Catatan: sepatu & kaus kaki menyesuaikan.' || chr(10) || chr(10)
    || 'Jam kedatangan:' || chr(10)
    || '- Panitia datang pukul 06.15 WIB, batas maksimal 06.30 WIB.' || chr(10) || chr(10)
    || 'Absensi among:' || chr(10)
    || '- Among yang berjaga diberikan absen kelas tersebut.',
  'Panitia Among ditetapkan 18 orang. Datang 06.15 WIB, batas maksimal 06.30 WIB. Dress code sesuai ketentuan tiap angkatan.',
  'selesai'
WHERE NOT EXISTS (
  SELECT 1 FROM public.rapat_notulensi
  WHERE judul = 'Pembagian Kepanitiaan Among (Pembagian Rapor)'
    AND tanggal = DATE '2026-10-15'
);
