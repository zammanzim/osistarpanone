  -- =========================================================================
  -- MIGRASI-WAWANCARA — Halaman "Wawancara Calon OSIS" (osis/wawancara.html)
  -- Sifat: NON-DESTRUKTIF. Hanya CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE
  -- FUNCTION baru + policy/grant baru. TIDAK ada DROP/ALTER tabel lama, TIDAK
  -- ada DELETE/UPDATE data existing. Aman di-run di database produksi.
  -- Cara pakai: buka Supabase Dashboard > SQL Editor > tempel seluruh file ini > Run.
  -- Hak halaman yang dipakai: "wawancara" (diatur super_admin di osis/akses.html).
  -- =========================================================================

  -- ================= 1. TABEL =================
  -- Calon yang akan diwawancarai (diisi manual oleh pemegang hak wawancara).
CREATE TABLE IF NOT EXISTS public.wawancara_calon (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nama          text NOT NULL DEFAULT '',
  kelas         text NOT NULL DEFAULT '',
  keterangan    text NOT NULL DEFAULT '',
  tanggal       date,
  display_order integer NOT NULL DEFAULT 99,
    created_by    bigint REFERENCES public.osis_users (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
  );

  -- Daftar pertanyaan utama (sama untuk semua calon). Satu level turunan via
  -- parent_id (parent_id NULL = utama). Spontan TIDAK disimpan di sini, melainkan
  -- di wawancara_jawaban (is_spontan = true) agar terikat sesi + calon.
  CREATE TABLE IF NOT EXISTS public.wawancara_pertanyaan (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teks       text NOT NULL DEFAULT '',
    urutan     integer NOT NULL DEFAULT 99,
    parent_id  bigint REFERENCES public.wawancara_pertanyaan (id) ON DELETE CASCADE,
    aktif      boolean NOT NULL DEFAULT true,
    created_by bigint REFERENCES public.osis_users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wawancara_pertanyaan_satu_level CHECK (parent_id IS NULL OR parent_id <> id)
  );

-- Satu sesi per calon (UNIQUE calon_id). Dikerjakan 1–2 pewawancara dengan HAK
-- SAMA; jawaban dipakai bersama sehingga cukup SATU yang mencatat, tidak perlu
-- keduanya mengisi terpisah.
CREATE TABLE IF NOT EXISTS public.wawancara_sesi (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  calon_id        bigint NOT NULL UNIQUE REFERENCES public.wawancara_calon (id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'belum'
                  CHECK (status IN ('belum', 'berlangsung', 'selesai')),
  pewawancara1_id bigint REFERENCES public.osis_users (id) ON DELETE SET NULL,
  pewawancara2_id bigint REFERENCES public.osis_users (id) ON DELETE SET NULL,
  catatan_akhir   text NOT NULL DEFAULT '',
    mulai_at       timestamptz,
    selesai_at     timestamptz,
    created_by     bigint REFERENCES public.osis_users (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
  );

  -- Jawaban per (sesi, pertanyaan). pertanyaan_id NULL + is_spontan = pertanyaan
  -- dadakan di luar daftar utama. pertanyaan_teks = snapshot teks master saat
  -- disimpan (riwayat tetap utuh walau master diedit) / teks spontan.
  CREATE TABLE IF NOT EXISTS public.wawancara_jawaban (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sesi_id         bigint NOT NULL REFERENCES public.wawancara_sesi (id) ON DELETE CASCADE,
    calon_id        bigint NOT NULL REFERENCES public.wawancara_calon (id) ON DELETE CASCADE,
    pertanyaan_id   bigint REFERENCES public.wawancara_pertanyaan (id) ON DELETE CASCADE,
    pertanyaan_teks text NOT NULL DEFAULT '',
    jawaban_teks    text NOT NULL DEFAULT '',
    is_spontan      boolean NOT NULL DEFAULT false,
    updated_by      bigint REFERENCES public.osis_users (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wawancara_jawaban_master_wajib_id
      CHECK (is_spontan OR pertanyaan_id IS NOT NULL),
    CONSTRAINT wawancara_jawaban_spontan_tanpa_id
      CHECK (NOT is_spontan OR pertanyaan_id IS NULL)
  );
  -- Satu jawaban per pertanyaan master dalam satu sesi (UPSERT). Baris spontan
  -- (pertanyaan_id NULL) tidak terpengaruh karena NULL dianggap berbeda.
  CREATE UNIQUE INDEX IF NOT EXISTS wawancara_jawaban_sesi_pertanyaan_uniq
    ON public.wawancara_jawaban (sesi_id, pertanyaan_id);
  CREATE INDEX IF NOT EXISTS wawancara_jawaban_sesi_idx ON public.wawancara_jawaban (sesi_id);
  CREATE INDEX IF NOT EXISTS wawancara_jawaban_calon_idx ON public.wawancara_jawaban (calon_id);
CREATE INDEX IF NOT EXISTS wawancara_pertanyaan_parent_idx ON public.wawancara_pertanyaan (parent_id);
CREATE INDEX IF NOT EXISTS wawancara_sesi_status_idx ON public.wawancara_sesi (status);

-- ================= 1b. UPGRADE DARI VERSI AWAL (aman di-run ulang) =================
-- Versi awal file ini memakai kolom pewawancara_id/pencatat_id. Bila migrasi
-- lama sudah terlanjur di-run (termasuk sebagian lalu gagal di tengah),
-- blok ini memindahkan data penugasan ke kolom baru TANPA menghapus data:
-- pewawancara -> pewawancara1, pencatat -> pewawancara2 (haknya kini sama).
-- Instalasi baru: ADD COLUMN IF NOT EXISTS langsung no-op, DO block dilewati.
ALTER TABLE public.wawancara_sesi
  ADD COLUMN IF NOT EXISTS pewawancara1_id bigint REFERENCES public.osis_users (id) ON DELETE SET NULL;
ALTER TABLE public.wawancara_sesi
  ADD COLUMN IF NOT EXISTS pewawancara2_id bigint REFERENCES public.osis_users (id) ON DELETE SET NULL;
-- Kolom jadwal (versi lanjutan): tanggal hari wawancara per calon.
-- Daftar di halaman dikelompokkan per tanggal; NULL = belum dijadwalkan.
ALTER TABLE public.wawancara_calon
  ADD COLUMN IF NOT EXISTS tanggal date;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'wawancara_sesi'
               AND column_name = 'pewawancara_id') THEN
    EXECUTE 'UPDATE public.wawancara_sesi SET pewawancara1_id = COALESCE(pewawancara1_id, pewawancara_id)';
    EXECUTE 'ALTER TABLE public.wawancara_sesi DROP COLUMN pewawancara_id';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'wawancara_sesi'
               AND column_name = 'pencatat_id') THEN
    EXECUTE 'UPDATE public.wawancara_sesi SET pewawancara2_id = COALESCE(pewawancara2_id, pencatat_id)';
    EXECUTE 'ALTER TABLE public.wawancara_sesi DROP COLUMN pencatat_id';
  END IF;
END $$;

  -- ================= 2. RLS =================
  -- Pola ikut sistem existing: baca langsung dari client (SELECT), tulis HANYA
  -- lewat RPC SECURITY DEFINER di bawah (tanpa policy INSERT/UPDATE/DELETE =
  -- tulis langsung selalu ditolak = fail closed).
  -- Beda dengan tabel konten publik: hasil wawancara SIFATNYA INTERNAL, jadi
  -- SELECT dibatasi untuk login OSIS (JWT auth.uid() terlink ke osis_users.auth_id),
  -- BUKAN publik. Akun biasa / anonim tidak bisa membaca sama sekali.
  ALTER TABLE public.wawancara_calon ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.wawancara_pertanyaan ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.wawancara_sesi ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.wawancara_jawaban ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_calon;
  CREATE POLICY wawancara_osis_select ON public.wawancara_calon
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.osis_users u WHERE u.auth_id = auth.uid()));

  DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_pertanyaan;
  CREATE POLICY wawancara_osis_select ON public.wawancara_pertanyaan
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.osis_users u WHERE u.auth_id = auth.uid()));

  DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_sesi;
  CREATE POLICY wawancara_osis_select ON public.wawancara_sesi
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.osis_users u WHERE u.auth_id = auth.uid()));

  DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_jawaban;
  CREATE POLICY wawancara_osis_select ON public.wawancara_jawaban
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.osis_users u WHERE u.auth_id = auth.uid()));

  GRANT SELECT ON public.wawancara_calon TO anon, authenticated;
  GRANT SELECT ON public.wawancara_pertanyaan TO anon, authenticated;
  GRANT SELECT ON public.wawancara_sesi TO anon, authenticated;
  GRANT SELECT ON public.wawancara_jawaban TO anon, authenticated;

  -- ================= 3. RPC =================
-- Boleh MENCATAT di satu sesi? HANYA pewawancara yang ditugaskan di sesi itu
-- (pewawancara 1 / 2, haknya sama) + super_admin. Pemegang hak "wawancara"
-- yang TIDAK ditugaskan hanya boleh membaca + mengelola (calon/pertanyaan/
-- petugas lewat RPC lain). Membuka/melihat boleh semua login OSIS (diatur
-- policy SELECT).
CREATE OR REPLACE FUNCTION public.wawancara_boleh(p_user_id bigint, p_sesi_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_username text;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  SELECT username INTO v_username FROM public.osis_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.osis_is_super(v_username) THEN RETURN true; END IF;
  IF p_sesi_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.wawancara_sesi s
                 WHERE s.id = p_sesi_id
                   AND (s.pewawancara1_id = p_user_id OR s.pewawancara2_id = p_user_id));
END $$;

-- ---- Calon (butuh hak "wawancara") ----
-- DROP dulu sebelum tambah parameter p_tanggal (aturan 42P13 yang sama).
DROP FUNCTION IF EXISTS public.wawancara_calon_tambah(bigint, text, text, text, integer);
DROP FUNCTION IF EXISTS public.wawancara_calon_ubah(bigint, bigint, text, text, text, integer);
CREATE OR REPLACE FUNCTION public.wawancara_calon_tambah(
  p_user_id bigint, p_nama text, p_kelas text DEFAULT '',
  p_keterangan text DEFAULT '', p_order integer DEFAULT 99,
  p_tanggal date DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE nid bigint;
BEGIN
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN -1; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN -2; END IF;
  INSERT INTO public.wawancara_calon (nama, kelas, keterangan, tanggal, display_order, created_by)
  VALUES (p_nama, left(btrim(COALESCE(p_kelas, '')), 40),
          left(COALESCE(p_keterangan, ''), 500),
          p_tanggal, COALESCE(p_order, 99), p_user_id)
  RETURNING id INTO nid;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.wawancara_calon_ubah(
  p_user_id bigint, p_id bigint, p_nama text, p_kelas text DEFAULT NULL,
  p_keterangan text DEFAULT NULL, p_order integer DEFAULT NULL,
  p_tanggal date DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
  p_nama := left(btrim(COALESCE(p_nama, '')), 80);
  IF p_nama = '' THEN RETURN 'ERR_KOSONG'; END IF;
  UPDATE public.wawancara_calon SET
    nama = p_nama,
    kelas = CASE WHEN p_kelas IS NULL THEN kelas ELSE left(btrim(p_kelas), 40) END,
    keterangan = CASE WHEN p_keterangan IS NULL THEN keterangan ELSE left(p_keterangan, 500) END,
    tanggal = p_tanggal,
    display_order = COALESCE(p_order, display_order),
    updated_at = now()
  WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
  RETURN 'OK';
END $$;

  -- Hapus calon = ikut menghapus sesi + jawabannya (CASCADE). Konfirmasi di UI.
  CREATE OR REPLACE FUNCTION public.wawancara_calon_hapus(p_user_id bigint, p_id bigint)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.wawancara_calon WHERE id = p_id;
    IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
    RETURN 'OK';
  END $$;

  -- ---- Pertanyaan master (butuh hak "wawancara"). p_id NULL = tambah. ----
  CREATE OR REPLACE FUNCTION public.wawancara_pertanyaan_simpan(
    p_user_id bigint, p_id bigint, p_teks text, p_parent_id bigint DEFAULT NULL,
    p_urutan integer DEFAULT NULL, p_aktif boolean DEFAULT NULL)
  RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE nid bigint; v_urut integer;
  BEGIN
    IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN -1; END IF;
    p_teks := left(btrim(COALESCE(p_teks, '')), 500);
    IF p_teks = '' THEN RETURN -2; END IF;
    -- Turunan hanya boleh menempel ke pertanyaan UTAMA (satu level saja).
    IF p_parent_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.wawancara_pertanyaan
                    WHERE id = p_parent_id AND parent_id IS NULL) THEN RETURN -3; END IF;
      IF p_id IS NOT NULL AND p_parent_id = p_id THEN RETURN -3; END IF;
    END IF;
    IF p_id IS NULL THEN
      SELECT COALESCE(MAX(urutan), 0) + 10 INTO v_urut FROM public.wawancara_pertanyaan
      WHERE COALESCE(parent_id, -1) = COALESCE(p_parent_id, -1);
      INSERT INTO public.wawancara_pertanyaan (teks, urutan, parent_id, aktif, created_by)
      VALUES (p_teks, COALESCE(p_urutan, v_urut), p_parent_id,
              COALESCE(p_aktif, true), p_user_id)
      RETURNING id INTO nid;
      RETURN nid;
    END IF;
    UPDATE public.wawancara_pertanyaan SET
      teks = p_teks,
      urutan = COALESCE(p_urutan, urutan),
      aktif = COALESCE(p_aktif, aktif),
      updated_at = now()
    WHERE id = p_id;
    IF NOT FOUND THEN RETURN -4; END IF;
    RETURN p_id;
  END $$;

  CREATE OR REPLACE FUNCTION public.wawancara_pertanyaan_hapus(p_user_id bigint, p_id bigint)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    IF NOT public.osis_bisa(p_user_id, 'wawancara') THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.wawancara_pertanyaan WHERE id = p_id;
    IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
    RETURN 'OK';
  END $$;

  -- ---- Sesi: pastikan satu sesi per calon (idempotent, boleh semua OSIS) ----
  CREATE OR REPLACE FUNCTION public.wawancara_sesi_pastikan(p_user_id bigint, p_calon_id bigint)
  RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE nid bigint;
  BEGIN
    IF p_user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN RETURN -1; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wawancara_calon WHERE id = p_calon_id) THEN RETURN -2; END IF;
    SELECT id INTO nid FROM public.wawancara_sesi WHERE calon_id = p_calon_id;
    IF FOUND THEN RETURN nid; END IF;
    INSERT INTO public.wawancara_sesi (calon_id, status, created_by)
    VALUES (p_calon_id, 'belum', p_user_id)
    RETURNING id INTO nid;
    RETURN nid;
  END $$;

-- Tugaskan pewawancara 1 (+ 2 opsional, haknya sama) — butuh hak "wawancara".
-- DROP dulu: Postgres error 42P13 bila nama parameter diganti via OR REPLACE
-- (versi awal memakai p_pewawancara_id/p_pencatat_id). GRANT di bawah
-- memasang ulang izinnya, jadi aman di-run ulang.
DROP FUNCTION IF EXISTS public.wawancara_sesi_petugas(bigint, bigint, bigint, bigint);
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
  RETURN 'OK';
END $$;

  -- Pindah status: belum -> berlangsung -> selesai, plus selesai -> berlangsung
  -- (buka kembali untuk koreksi). Stempel waktu otomatis.
  CREATE OR REPLACE FUNCTION public.wawancara_sesi_status(
    p_user_id bigint, p_sesi_id bigint, p_status text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE v_lama text;
  BEGIN
    IF NOT public.wawancara_boleh(p_user_id, p_sesi_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    p_status := btrim(COALESCE(p_status, ''));
    IF p_status NOT IN ('belum', 'berlangsung', 'selesai') THEN RETURN 'ERR_STATUS'; END IF;
    SELECT status INTO v_lama FROM public.wawancara_sesi WHERE id = p_sesi_id;
    IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
    IF p_status = v_lama THEN RETURN 'OK'; END IF;
    IF NOT ((v_lama = 'belum' AND p_status = 'berlangsung')
        OR (v_lama = 'berlangsung' AND p_status = 'selesai')
        OR (v_lama = 'selesai' AND p_status = 'berlangsung')) THEN RETURN 'ERR_ALUR'; END IF;
    UPDATE public.wawancara_sesi SET
      status = p_status,
      mulai_at = CASE WHEN mulai_at IS NULL AND p_status = 'berlangsung' THEN now() ELSE mulai_at END,
      selesai_at = CASE WHEN p_status = 'selesai' THEN now()
                        WHEN p_status = 'berlangsung' AND v_lama = 'selesai' THEN NULL
                        ELSE selesai_at END,
      updated_at = now()
    WHERE id = p_sesi_id;
    RETURN 'OK';
  END $$;

  -- Catatan akhir sesi (kesimpulan pewawancara — autosave dari client).
  CREATE OR REPLACE FUNCTION public.wawancara_sesi_catatan(
    p_user_id bigint, p_sesi_id bigint, p_catatan text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    IF NOT public.wawancara_boleh(p_user_id, p_sesi_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.wawancara_sesi SET
      catatan_akhir = left(COALESCE(p_catatan, ''), 2000), updated_at = now()
    WHERE id = p_sesi_id;
    IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
    RETURN 'OK';
  END $$;

  -- Simpan jawaban (AUTOSAVE — dipanggil tiap berhenti mengetik):
  -- - Master: p_pertanyaan_id terisi, p_is_spontan false -> UPSERT per sesi.
  -- - Spontan: p_is_spontan true -> p_jawaban_id NULL = baris baru, terisi = edit.
  -- Semua jawaban satu sesi dipakai bersama, jadi cukup satu pewawancara yang mencatat.
  CREATE OR REPLACE FUNCTION public.wawancara_jawaban_simpan(
    p_user_id bigint, p_sesi_id bigint, p_pertanyaan_id bigint DEFAULT NULL,
    p_pertanyaan_teks text DEFAULT '', p_jawaban_teks text DEFAULT '',
    p_is_spontan boolean DEFAULT false, p_jawaban_id bigint DEFAULT NULL)
  RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE v_calon bigint; nid bigint; v_snap text;
  BEGIN
    IF NOT public.wawancara_boleh(p_user_id, p_sesi_id) THEN RETURN -1; END IF;
    SELECT calon_id INTO v_calon FROM public.wawancara_sesi WHERE id = p_sesi_id;
    IF NOT FOUND THEN RETURN -2; END IF;
    p_jawaban_teks := left(COALESCE(p_jawaban_teks, ''), 5000);
    -- Edit baris yang sudah ada (dipakai autosave spontan + koreksi).
    IF p_jawaban_id IS NOT NULL THEN
      IF COALESCE(p_is_spontan, false) THEN
        p_pertanyaan_teks := left(btrim(COALESCE(p_pertanyaan_teks, '')), 500);
        IF p_pertanyaan_teks = '' THEN RETURN -3; END IF;
        UPDATE public.wawancara_jawaban SET
          pertanyaan_teks = p_pertanyaan_teks, jawaban_teks = p_jawaban_teks,
          updated_by = p_user_id, updated_at = now()
        WHERE id = p_jawaban_id AND sesi_id = p_sesi_id AND is_spontan;
      ELSE
        UPDATE public.wawancara_jawaban SET
          jawaban_teks = p_jawaban_teks, updated_by = p_user_id, updated_at = now()
        WHERE id = p_jawaban_id AND sesi_id = p_sesi_id AND NOT is_spontan;
      END IF;
      IF NOT FOUND THEN RETURN -2; END IF;
      RETURN p_jawaban_id;
    END IF;
    -- Baris baru.
    IF COALESCE(p_is_spontan, false) THEN
      p_pertanyaan_teks := left(btrim(COALESCE(p_pertanyaan_teks, '')), 500);
      IF p_pertanyaan_teks = '' THEN RETURN -3; END IF;
      INSERT INTO public.wawancara_jawaban
        (sesi_id, calon_id, pertanyaan_id, pertanyaan_teks, jawaban_teks, is_spontan, updated_by)
      VALUES (p_sesi_id, v_calon, NULL, p_pertanyaan_teks, p_jawaban_teks, true, p_user_id)
      RETURNING id INTO nid;
      RETURN nid;
    END IF;
    IF p_pertanyaan_id IS NULL THEN RETURN -3; END IF;
    SELECT left(teks, 500) INTO v_snap FROM public.wawancara_pertanyaan WHERE id = p_pertanyaan_id;
    IF NOT FOUND THEN RETURN -4; END IF;
    INSERT INTO public.wawancara_jawaban
      (sesi_id, calon_id, pertanyaan_id, pertanyaan_teks, jawaban_teks, is_spontan, updated_by)
    VALUES (p_sesi_id, v_calon, p_pertanyaan_id, v_snap, p_jawaban_teks, false, p_user_id)
    ON CONFLICT (sesi_id, pertanyaan_id) DO UPDATE SET
      jawaban_teks = EXCLUDED.jawaban_teks, pertanyaan_teks = EXCLUDED.pertanyaan_teks,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING id INTO nid;
    RETURN nid;
  END $$;

  -- Hapus pertanyaan spontan (master tidak bisa dihapus dari sini).
  CREATE OR REPLACE FUNCTION public.wawancara_spontan_hapus(p_user_id bigint, p_jawaban_id bigint)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE v_sesi bigint;
  BEGIN
    SELECT sesi_id INTO v_sesi FROM public.wawancara_jawaban
    WHERE id = p_jawaban_id AND is_spontan;
    IF NOT FOUND THEN RETURN 'ERR_NOT_FOUND'; END IF;
    IF NOT public.wawancara_boleh(p_user_id, v_sesi) THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.wawancara_jawaban WHERE id = p_jawaban_id AND is_spontan;
    RETURN 'OK';
  END $$;

  GRANT EXECUTE ON FUNCTION public.wawancara_boleh(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wawancara_calon_tambah(bigint, text, text, text, integer, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wawancara_calon_ubah(bigint, bigint, text, text, text, integer, date) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_calon_hapus(bigint, bigint) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_pertanyaan_simpan(bigint, bigint, text, bigint, integer, boolean) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_pertanyaan_hapus(bigint, bigint) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_sesi_pastikan(bigint, bigint) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_sesi_petugas(bigint, bigint, bigint, bigint) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_sesi_status(bigint, bigint, text) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_sesi_catatan(bigint, bigint, text) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_jawaban_simpan(bigint, bigint, bigint, text, text, boolean, bigint) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.wawancara_spontan_hapus(bigint, bigint) TO anon, authenticated;

-- ================= 4. SEED PERTANYAAN UTAMA (master, BUKAN dummy) =================
-- Sumber: dokumen "ISI WAWANCARA BAKAL CALON OSIS". Hanya diisi bila tabel
-- masih kosong (aman di-run ulang). TANPA turunan: pertanyaan lanjutan dibuat
-- sendiri oleh pewawancara saat sesi (atau spontan). Bisa diubah/hapus dari
-- halaman Wawancara oleh pemegang hak "wawancara".
DO $$
DECLARE
  daftar text[] := ARRAY[
    'Nama dan kelas',
    'Alamat kamu di mana? Jauh tidak? Berapa lama perjalanan? Naik kendaraan apa?',
    'Latar belakang: punya kakak/adik berapa; tinggal dengan siapa saja di rumah; kegiatan di rumah ngapain aja; deskripsikan diri kamu sendiri, kamu itu seperti apa?',
    'Apa alasan masuk OSIS? Apa tujuan masuk OSIS?',
    'Jika disuruh milih hak/kewajiban, mana yang harus didahulukan?',
    'Jika teman kamu mempunyai masalah, sikap kita harus seperti apa dan harus kaya gimana?',
    'Jika OSIS tidak sesuai dengan keinginan kamu/harapan kamu, kamu mau kaya gimana?',
    'Apa faktor utama masuk OSIS? Pilihan sendiri, diajak teman, atau ada orang yang kamu suka di OSIS?',
    'Apa kamu sudah mendapatkan izin dari orang tua kamu, apa tanpa sepengetahuan orang tua kamu?',
    'Selama menjadi bakal calon OSIS, apakah ada unek-unek yang akan disampaikan ke senior atau teman seperjuangan kamu?',
    'Menurut pandangan kamu senior itu seperti apa?',
    'Kalau misalnya kamu gugur di OSIS, kamu mau kaya gimana?',
    'Jika kamu mengundurkan diri dari organisasi OSIS, apa konsekuensinya?',
    'Kalau kamu sudah resmi menjadi OSIS, kamu mau buat gebrakan apa?',
    'Kalau tahapannya masih panjang untuk menjadi OSIS yang resmi, apa kamu masih sanggup?',
    'Kenapa kita harus nerima kamu sebagai OSIS? Apa jaminannya?',
    'Menurut kamu, faktor susahnya dan tidak enaknya jadi OSIS itu apa? Coba jelaskan?',
    'Hal apa menurut kamu yang paling sulit, selama kamu menjadi bakal calon?',
    'Selama kamu jadi siswa di sini dan melihat OSIS di sekolah ini, posisi apa yang kamu mau duduki?',
    '(Kalau sudah dijelaskan, tanya lagi) Apa yakin masih mau jadi OSIS?',
    'Di sesama bakal calon, ada tidak menurut kamu teman yang baik dan pengertian? Siapa?',
    'Ada tidak balon/senior yang menurut kamu toxic? Yang tidak enak?',
    'Kamu ikut ekskul lain? Jika bentrok, bagaimana sikap kamu?',
    'Andaikata OSIS dan ekskul kamu sekarang terdapat masalah, apa sikap kamu?',
    'Punya penyakit yang sering kambuh/sakit?',
    'Apa kekurangan dan kelebihan pada diri kamu?',
    'Bagaimana cara kamu mengelola masalah?',
    'Pernah tidak kamu bikin marah orang tua kamu?',
    'Pernah tidak bikin orang tua kamu menangis?',
    'Andaikan ada orang tua kamu di sini, apa yang mau kamu sampaikan?',
    'Perjuangan apa yang orang tua kamu lakukan untuk kamu? Dan perjuangan apa yang kamu lakukan untuk orang tua kamu?'
  ];
  t text; v_urut integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wawancara_pertanyaan) THEN RETURN; END IF;
  FOREACH t IN ARRAY daftar LOOP
    v_urut := v_urut + 10;
    INSERT INTO public.wawancara_pertanyaan (teks, urutan, parent_id)
    VALUES (left(t, 500), v_urut, NULL);
  END LOOP;
END $$;

-- ================= 4b. GANTI MASTER LAMA -> DAFTAR BARU =================
-- Untuk DB yang sudah terlanjur terisi seed awal (8 utama + turunan):
-- 1) Masukkan 31 pertanyaan baru (lewati bila teksnya sudah ada persis).
-- 2) Singkirkan master lama: HAPUS bila belum ada jawaban tercatat,
--    NONAKTIFKAN (aktif=false) bila sudah ada jawabannya — riwayat jawaban
--    tetap utuh dan tersembunyi dari UI (UI hanya tampilkan yang aktif).
-- Aman di-run ulang.
DO $$
DECLARE
  baru text[] := ARRAY[
    'Nama dan kelas',
    'Alamat kamu di mana? Jauh tidak? Berapa lama perjalanan? Naik kendaraan apa?',
    'Latar belakang: punya kakak/adik berapa; tinggal dengan siapa saja di rumah; kegiatan di rumah ngapain aja; deskripsikan diri kamu sendiri, kamu itu seperti apa?',
    'Apa alasan masuk OSIS? Apa tujuan masuk OSIS?',
    'Jika disuruh milih hak/kewajiban, mana yang harus didahulukan?',
    'Jika teman kamu mempunyai masalah, sikap kita harus seperti apa dan harus kaya gimana?',
    'Jika OSIS tidak sesuai dengan keinginan kamu/harapan kamu, kamu mau kaya gimana?',
    'Apa faktor utama masuk OSIS? Pilihan sendiri, diajak teman, atau ada orang yang kamu suka di OSIS?',
    'Apa kamu sudah mendapatkan izin dari orang tua kamu, apa tanpa sepengetahuan orang tua kamu?',
    'Selama menjadi bakal calon OSIS, apakah ada unek-unek yang akan disampaikan ke senior atau teman seperjuangan kamu?',
    'Menurut pandangan kamu senior itu seperti apa?',
    'Kalau misalnya kamu gugur di OSIS, kamu mau kaya gimana?',
    'Jika kamu mengundurkan diri dari organisasi OSIS, apa konsekuensinya?',
    'Kalau kamu sudah resmi menjadi OSIS, kamu mau buat gebrakan apa?',
    'Kalau tahapannya masih panjang untuk menjadi OSIS yang resmi, apa kamu masih sanggup?',
    'Kenapa kita harus nerima kamu sebagai OSIS? Apa jaminannya?',
    'Menurut kamu, faktor susahnya dan tidak enaknya jadi OSIS itu apa? Coba jelaskan?',
    'Hal apa menurut kamu yang paling sulit, selama kamu menjadi bakal calon?',
    'Selama kamu jadi siswa di sini dan melihat OSIS di sekolah ini, posisi apa yang kamu mau duduki?',
    '(Kalau sudah dijelaskan, tanya lagi) Apa yakin masih mau jadi OSIS?',
    'Di sesama bakal calon, ada tidak menurut kamu teman yang baik dan pengertian? Siapa?',
    'Ada tidak balon/senior yang menurut kamu toxic? Yang tidak enak?',
    'Kamu ikut ekskul lain? Jika bentrok, bagaimana sikap kamu?',
    'Andaikata OSIS dan ekskul kamu sekarang terdapat masalah, apa sikap kamu?',
    'Punya penyakit yang sering kambuh/sakit?',
    'Apa kekurangan dan kelebihan pada diri kamu?',
    'Bagaimana cara kamu mengelola masalah?',
    'Pernah tidak kamu bikin marah orang tua kamu?',
    'Pernah tidak bikin orang tua kamu menangis?',
    'Andaikan ada orang tua kamu di sini, apa yang mau kamu sampaikan?',
    'Perjuangan apa yang orang tua kamu lakukan untuk kamu? Dan perjuangan apa yang kamu lakukan untuk orang tua kamu?'
  ];
  lama text[] := ARRAY[
    'Kenapa kamu ingin masuk OSIS?',
    'Ceritakan kelebihan dan kekurangan dirimu.',
    'Apakah kamu punya pengalaman organisasi atau kepanitiaan?',
    'Bagaimana caramu mengatur waktu antara sekolah dan OSIS?',
    'Apakah kamu siap berkomitmen dan disiplin selama menjadi pengurus?',
    'Bagaimana caramu bekerja sama dalam tim?',
    'Apa visi atau program yang ingin kamu wujudkan di OSIS?',
    'Penutup — adakah yang ingin kamu tanyakan atau sampaikan kepada kami?',
    'Apa yang kamu ketahui tentang OSIS di sekolah ini?',
    'Kenapa kami harus memilih kamu dibanding calon lain?',
    'Berikan contoh situasi di mana kelebihanmu itu berguna.',
    'Bagaimana caramu mengatasi kekurangan tersebut?',
    'Peran apa yang pernah kamu pegang?',
    'Pernah ada konflik? Bagaimana kamu menyelesaikannya?',
    'Jika jadwal OSIS bentrok dengan tugas sekolah, apa prioritasmu?',
    'Apakah ada kesibukan lain di luar sekolah?',
    'Siapkah kamu hadir di rapat dan kegiatan rutin?',
    'Bagaimana jika kamu melanggar aturan yang disepakati?',
    'Jika berbeda pendapat dengan teman satu tim, apa yang kamu lakukan?',
    'Jika ditunjuk menjadi ketua atau penanggung jawab, apakah kamu siap?',
    'Program konkret apa yang ingin kamu usulkan?'
  ];
  t text; qid bigint; qanak bigint; v_urut integer; punya boolean;
BEGIN
  SELECT COALESCE(MAX(urutan), 0) INTO v_urut
  FROM public.wawancara_pertanyaan WHERE parent_id IS NULL;
  FOREACH t IN ARRAY baru LOOP
    IF NOT EXISTS (SELECT 1 FROM public.wawancara_pertanyaan WHERE teks = t) THEN
      v_urut := v_urut + 10;
      INSERT INTO public.wawancara_pertanyaan (teks, urutan, parent_id)
      VALUES (left(t, 500), v_urut, NULL);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY lama LOOP
    SELECT id INTO qid FROM public.wawancara_pertanyaan WHERE teks = t;
    IF NOT FOUND THEN CONTINUE; END IF;
    FOR qanak IN SELECT id FROM public.wawancara_pertanyaan WHERE parent_id = qid LOOP
      SELECT EXISTS (SELECT 1 FROM public.wawancara_jawaban WHERE pertanyaan_id = qanak) INTO punya;
      IF punya THEN
        UPDATE public.wawancara_pertanyaan SET aktif = false, updated_at = now() WHERE id = qanak;
      ELSE
        DELETE FROM public.wawancara_pertanyaan WHERE id = qanak;
      END IF;
    END LOOP;
    SELECT EXISTS (SELECT 1 FROM public.wawancara_jawaban WHERE pertanyaan_id = qid) INTO punya;
    IF punya THEN
      UPDATE public.wawancara_pertanyaan SET aktif = false, updated_at = now() WHERE id = qid;
    ELSE
      DELETE FROM public.wawancara_pertanyaan WHERE id = qid;
    END IF;
  END LOOP;
  -- Rapikan nomor urut master (10, 20, ...) mengikuti id.
  WITH x AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
    FROM public.wawancara_pertanyaan WHERE parent_id IS NULL
  )
  UPDATE public.wawancara_pertanyaan p SET urutan = x.rn * 10, updated_at = now()
  FROM x WHERE x.id = p.id;
END $$;

-- ================= 6. URUTAN PER SESI (tiap calon bisa beda susunan) =================
-- Kolom master wawancara_pertanyaan.urutan tetap sebagai bawaan awal; susunan
-- per sesi disimpan di sini (diisi otomatis dari master saat sesi dibuka).
-- Tulis HANYA lewat RPC (tanpa policy INSERT/UPDATE/DELETE = fail closed),
-- baca khusus login OSIS, sama seperti tabel wawancara lain.
CREATE TABLE IF NOT EXISTS public.wawancara_urutan (
  sesi_id       bigint NOT NULL REFERENCES public.wawancara_sesi (id) ON DELETE CASCADE,
  pertanyaan_id bigint NOT NULL REFERENCES public.wawancara_pertanyaan (id) ON DELETE CASCADE,
  urutan        integer NOT NULL DEFAULT 99,
  PRIMARY KEY (sesi_id, pertanyaan_id)
);
CREATE INDEX IF NOT EXISTS wawancara_urutan_sesi_idx ON public.wawancara_urutan (sesi_id);
ALTER TABLE public.wawancara_urutan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wawancara_osis_select ON public.wawancara_urutan;
CREATE POLICY wawancara_osis_select ON public.wawancara_urutan
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.osis_users u WHERE u.auth_id = auth.uid()));
GRANT SELECT ON public.wawancara_urutan TO anon, authenticated;

-- Lengkapi baris urutan sesi dari master (idempotent, boleh semua OSIS).
CREATE OR REPLACE FUNCTION public.wawancara_urutan_pastikan(p_user_id bigint, p_sesi_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.osis_users WHERE id = p_user_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wawancara_sesi WHERE id = p_sesi_id) THEN RETURN 'ERR_NOT_FOUND'; END IF;
  INSERT INTO public.wawancara_urutan (sesi_id, pertanyaan_id, urutan)
  SELECT p_sesi_id, p.id, p.urutan FROM public.wawancara_pertanyaan p
  WHERE p.aktif
    AND NOT EXISTS (SELECT 1 FROM public.wawancara_urutan u
                    WHERE u.sesi_id = p_sesi_id AND u.pertanyaan_id = p.id);
  RETURN 'OK';
END $$;

-- Simpan susunan sesi sekaligus (urutan array = atas ke bawah).
-- Boleh: pemegang hak "wawancara" ATAU petugas sesi (ditugaskan/super).
CREATE OR REPLACE FUNCTION public.wawancara_urutan_atur(
  p_user_id bigint, p_sesi_id bigint, p_ids bigint[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE i integer := 0; qid bigint;
BEGIN
  IF NOT public.osis_bisa(p_user_id, 'wawancara')
     AND NOT public.wawancara_boleh(p_user_id, p_sesi_id) THEN RETURN 'ERR_NO_AUTH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wawancara_sesi WHERE id = p_sesi_id) THEN RETURN 'ERR_NOT_FOUND'; END IF;
  PERFORM public.wawancara_urutan_pastikan(p_user_id, p_sesi_id);
  FOREACH qid IN ARRAY COALESCE(p_ids, '{}') LOOP
    i := i + 1;
    UPDATE public.wawancara_urutan SET urutan = i * 10
    WHERE sesi_id = p_sesi_id AND pertanyaan_id = qid;
  END LOOP;
  RETURN 'OK';
END $$;

GRANT EXECUTE ON FUNCTION public.wawancara_urutan_pastikan(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wawancara_urutan_atur(bigint, bigint, bigint[]) TO anon, authenticated;

  -- ================= 5. OPSIONAL: daftarkan ke sidebar + halaman akses =================
  -- Sidebar /osis diambil dari site_content.kunci='sidebar_menu' (diatur lewat tombol
  -- "Atur Menu" oleh pemegang hak "site"). Cukup tambah via UI Atur Menu setelah
  -- deploy: href "wawancara", label "Wawancara", ikon "fa-solid fa-comments".
  -- Hak halaman "wawancara" otomatis terbaca di osis/akses.html setelah
  -- js/akses.js yang baru di-deploy.
