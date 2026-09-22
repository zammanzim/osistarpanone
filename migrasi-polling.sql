-- ============================================================
-- POLLING WAKETOS (Wakil Ketua OSIS) - MIGRASI
-- Halaman: polling.html (standalone di root) + js/polling.js
--
-- Aturan main:
--   - Wajib login (guest nickname / anggota OSIS).
--   - 1 perangkat = 1 suara, 1 nickname = 1 suara.
--   - Ganti pilihan diperbolehkan (vote = update, bukan dobel).
--   - Hasil live (jumlah + persentase) untuk semua pengunjung.
--   - Kandidat + buka/tutup + reset suara dikelola pemegang hak
--     "polling" (diatur super_admin di halaman Akses).
--   - Identitas pemilih TIDAK bisa dibaca publik (cuma via RPC
--     agregat polling_hasil + polling_suara_saya per device).
--
-- CARA PAKAI (sekali saja):
--   1. Supabase Dashboard > SQL Editor > New query
--   2. Paste seluruh isi file ini > Run
--   3. Di halaman Akses, beri hak "Polling Waketos" ke pengelola.
--
-- Client memakai (js/db.js):
--   getPollingKandidat / getPollingHasil / getPollingSuaraSaya /
--   votePolling / cekStatusPolling / tambahPollingKandidat /
--   ubahPollingKandidat / hapusPollingKandidat /
--   setPollingStatus / resetPollingSuara
-- ============================================================

-- ============ 1. TABEL KANDIDAT ============
CREATE TABLE IF NOT EXISTS public.polling_kandidat (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nomor integer NOT NULL DEFAULT 1,
    nama text NOT NULL DEFAULT '',
    kelas text NOT NULL DEFAULT '',
    foto text NOT NULL DEFAULT '',
    visi text NOT NULL DEFAULT '',
    misi text NOT NULL DEFAULT '',
    display_order integer NOT NULL DEFAULT 99,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS nomor integer NOT NULL DEFAULT 1;
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS nama text NOT NULL DEFAULT '';
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS kelas text NOT NULL DEFAULT '';
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS foto text NOT NULL DEFAULT '';
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS visi text NOT NULL DEFAULT '';
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS misi text NOT NULL DEFAULT '';
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 99;
ALTER TABLE public.polling_kandidat ADD COLUMN IF NOT EXISTS created_by bigint;
CREATE INDEX IF NOT EXISTS idx_polling_kandidat_order ON public.polling_kandidat (display_order, nomor);
ALTER TABLE public.polling_kandidat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "polling_kandidat_public_select" ON public.polling_kandidat;
CREATE POLICY "polling_kandidat_public_select" ON public.polling_kandidat FOR SELECT USING (true);
DROP POLICY IF EXISTS "polling_kandidat_public_insert" ON public.polling_kandidat;

-- ============ 2. TABEL SUARA (privat, tanpa SELECT publik) ============
CREATE TABLE IF NOT EXISTS public.polling_suara (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kandidat_id bigint NOT NULL,
    device_id text NOT NULL DEFAULT '',
    user_key text NOT NULL DEFAULT '',
    nama text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.polling_suara ADD COLUMN IF NOT EXISTS kandidat_id bigint NOT NULL DEFAULT 0;
ALTER TABLE public.polling_suara ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT '';
ALTER TABLE public.polling_suara ADD COLUMN IF NOT EXISTS user_key text NOT NULL DEFAULT '';
ALTER TABLE public.polling_suara ADD COLUMN IF NOT EXISTS nama text NOT NULL DEFAULT '';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_polling_suara_kandidat') THEN
        ALTER TABLE public.polling_suara
        ADD CONSTRAINT fk_polling_suara_kandidat
        FOREIGN KEY (kandidat_id) REFERENCES public.polling_kandidat (id) ON DELETE CASCADE;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_polling_suara_device ON public.polling_suara (device_id) WHERE device_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_polling_suara_user ON public.polling_suara (lower(user_key)) WHERE user_key <> '';
CREATE INDEX IF NOT EXISTS idx_polling_suara_kandidat ON public.polling_suara (kandidat_id);
ALTER TABLE public.polling_suara ENABLE ROW LEVEL SECURITY;

-- ============ 3. RPC VOTE ============
-- Return: OK (baru) / OK_GANTI (pindah pilihan) / OK_SAMA (sudah pilih ini)
--         ERR_NO_DEVICE / ERR_NO_LOGIN / ERR_CLOSED / ERR_VOTED (nickname
--         dipakai perangkat lain) / ERR_NOT_FOUND (kandidat tidak ada)
CREATE OR REPLACE FUNCTION public.vote_polling(
    p_device_id text,
    p_user_key text,
    p_nama text,
    p_kandidat_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_status text;
    v_row public.polling_suara%ROWTYPE;
BEGIN
    IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
        RETURN 'ERR_NO_DEVICE';
    END IF;
    IF p_user_key IS NULL OR btrim(p_user_key) = '' THEN
        RETURN 'ERR_NO_LOGIN';
    END IF;
    IF p_kandidat_id IS NULL THEN
        RETURN 'ERR_NOT_FOUND';
    END IF;
    SELECT nilai INTO v_status FROM public.site_content WHERE kunci = 'polling_status';
    IF v_status IS NOT NULL AND upper(btrim(v_status)) = 'TUTUP' THEN
        RETURN 'ERR_CLOSED';
    END IF;
    PERFORM 1 FROM public.polling_kandidat WHERE id = p_kandidat_id;
    IF NOT FOUND THEN
        RETURN 'ERR_NOT_FOUND';
    END IF;
    p_user_key := lower(btrim(p_user_key));
    p_nama := left(COALESCE(NULLIF(btrim(p_nama), ''), 'Anonim'), 80);
    SELECT * INTO v_row FROM public.polling_suara WHERE device_id = p_device_id;
    IF FOUND THEN
        IF v_row.kandidat_id IS NOT DISTINCT FROM p_kandidat_id THEN
            RETURN 'OK_SAMA';
        END IF;
        UPDATE public.polling_suara
        SET kandidat_id = p_kandidat_id, user_key = p_user_key, nama = p_nama
        WHERE id = v_row.id;
        RETURN 'OK_GANTI';
    END IF;
    PERFORM 1 FROM public.polling_suara WHERE lower(user_key) = p_user_key;
    IF FOUND THEN
        RETURN 'ERR_VOTED';
    END IF;
    BEGIN
        INSERT INTO public.polling_suara (kandidat_id, device_id, user_key, nama)
        VALUES (p_kandidat_id, p_device_id, p_user_key, p_nama);
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_row FROM public.polling_suara WHERE device_id = p_device_id;
        IF FOUND THEN
            IF v_row.kandidat_id IS NOT DISTINCT FROM p_kandidat_id THEN
                RETURN 'OK_SAMA';
            END IF;
            UPDATE public.polling_suara
            SET kandidat_id = p_kandidat_id, user_key = p_user_key, nama = p_nama
            WHERE id = v_row.id;
            RETURN 'OK_GANTI';
        END IF;
        RETURN 'ERR_VOTED';
    END;
    RETURN 'OK';
END $$;

-- ============ 4. RPC HASIL LIVE (agregat, tanpa identitas) ============
CREATE OR REPLACE FUNCTION public.polling_hasil()
RETURNS TABLE (kandidat_id bigint, jumlah bigint)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT k.id, COUNT(s.id)::bigint
    FROM public.polling_kandidat k
    LEFT JOIN public.polling_suara s ON s.kandidat_id = k.id
    GROUP BY k.id;
$$;

CREATE OR REPLACE FUNCTION public.polling_total()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT COUNT(*)::bigint FROM public.polling_suara;
$$;

-- Pilihan perangkat ini (buat badge "pilihanmu"), null = belum vote
CREATE OR REPLACE FUNCTION public.polling_suara_saya(p_device_id text)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT kandidat_id FROM public.polling_suara WHERE device_id = p_device_id LIMIT 1;
$$;

-- ============ 5. RPC KELOLA KANDIDAT (hak "polling") ============
CREATE OR REPLACE FUNCTION public.polling_kandidat_tambah(
    p_user_id bigint, p_nomor integer, p_nama text, p_kelas text,
    p_foto text, p_visi text, p_misi text, p_order integer
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE nid bigint;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'polling') THEN RETURN -1; END IF;
    INSERT INTO public.polling_kandidat (nomor, nama, kelas, foto, visi, misi, display_order, created_by)
    VALUES (
        COALESCE(p_nomor, 1),
        left(COALESCE(NULLIF(btrim(p_nama), ''), 'Tanpa Nama'), 80),
        left(COALESCE(p_kelas, ''), 40),
        left(COALESCE(p_foto, ''), 300),
        left(COALESCE(p_visi, ''), 1000),
        left(COALESCE(p_misi, ''), 2000),
        COALESCE(p_order, 99),
        p_user_id
    )
    RETURNING id INTO nid;
    RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.polling_kandidat_ubah(
    p_user_id bigint, p_id bigint, p_nomor integer, p_nama text, p_kelas text,
    p_foto text, p_visi text, p_misi text, p_order integer
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'polling') THEN RETURN 'ERR_NO_AUTH'; END IF;
    UPDATE public.polling_kandidat SET
        nomor = COALESCE(p_nomor, nomor),
        nama = left(COALESCE(NULLIF(btrim(p_nama), nama), nama), 80),
        kelas = left(COALESCE(p_kelas, kelas), 40),
        foto = left(COALESCE(p_foto, foto), 300),
        visi = left(COALESCE(p_visi, visi), 1000),
        misi = left(COALESCE(p_misi, misi), 2000),
        display_order = COALESCE(p_order, display_order)
    WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.polling_kandidat_hapus(p_user_id bigint, p_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'polling') THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.polling_kandidat WHERE id = p_id;
    IF FOUND THEN RETURN 'OK'; END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- ============ 6. RPC SAKELAR + RESET (hak "polling") ============
CREATE OR REPLACE FUNCTION public.set_polling_status(p_user_id bigint, p_status text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'polling') THEN RETURN 'ERR_NO_AUTH'; END IF;
    p_status := upper(btrim(COALESCE(p_status, 'BUKA')));
    IF p_status NOT IN ('BUKA', 'TUTUP') THEN RETURN 'ERR_BAD_STATUS'; END IF;
    INSERT INTO public.site_content (kunci, nilai, updated_at, updated_by)
    VALUES ('polling_status', p_status, now(), p_user_id)
    ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, updated_at = now(), updated_by = EXCLUDED.updated_by;
    RETURN 'OK';
END $$;

-- Hapus SEMUA suara (mulai ronde baru). Kandidat tidak ikut terhapus.
CREATE OR REPLACE FUNCTION public.polling_reset(p_user_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'polling') THEN RETURN 'ERR_NO_AUTH'; END IF;
    DELETE FROM public.polling_suara;
    RETURN 'OK';
END $$;

-- ============ 7. GRANT KE ANON ============
REVOKE EXECUTE ON FUNCTION public.vote_polling(text, text, text, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.polling_hasil() FROM public;
REVOKE EXECUTE ON FUNCTION public.polling_total() FROM public;
REVOKE EXECUTE ON FUNCTION public.polling_suara_saya(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.polling_kandidat_tambah(bigint, integer, text, text, text, text, text, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.polling_kandidat_ubah(bigint, bigint, integer, text, text, text, text, text, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.polling_kandidat_hapus(bigint, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.set_polling_status(bigint, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.polling_reset(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.vote_polling(text, text, text, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.polling_hasil() TO anon;
GRANT EXECUTE ON FUNCTION public.polling_total() TO anon;
GRANT EXECUTE ON FUNCTION public.polling_suara_saya(text) TO anon;
GRANT EXECUTE ON FUNCTION public.polling_kandidat_tambah(bigint, integer, text, text, text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.polling_kandidat_ubah(bigint, bigint, integer, text, text, text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.polling_kandidat_hapus(bigint, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.set_polling_status(bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.polling_reset(bigint) TO anon;

-- ============ 8. STORAGE FOTO KANDIDAT (folder polling/) ============
DROP POLICY IF EXISTS "osis_foto_polling_select" ON storage.objects;
CREATE POLICY "osis_foto_polling_select" ON storage.objects FOR SELECT TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='polling');
DROP POLICY IF EXISTS "osis_foto_polling_insert" ON storage.objects;
CREATE POLICY "osis_foto_polling_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='osis-foto' AND (storage.foldername(name))[1]='polling');
DROP POLICY IF EXISTS "osis_foto_polling_delete" ON storage.objects;
CREATE POLICY "osis_foto_polling_delete" ON storage.objects FOR DELETE TO anon USING (bucket_id='osis-foto' AND (storage.foldername(name))[1]='polling');

-- ============ 9. SEED (aman di-run ulang, tidak menimpa status berjalan) ============
INSERT INTO public.site_content (kunci, nilai, updated_at) VALUES ('polling_status', 'BUKA', now()) ON CONFLICT (kunci) DO NOTHING;
INSERT INTO public.site_content (kunci, nilai, updated_at) VALUES ('polling_judul', 'Polling Wakil Ketua OSIS', now()) ON CONFLICT (kunci) DO NOTHING;
-- ============ 10. OPTIMASI: HASIL + TOTAL SEKALIGUS ============
-- Satu request untuk tiap tick auto-refresh (hemat ~1 request/klien/20 dtk).
-- Client lama (getPollingHasil 2 RPC) tetap jalan, tidak wajib migrasi ulang.
CREATE OR REPLACE FUNCTION public.polling_hasil_total()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT jsonb_build_object(
        'hasil', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kandidat_id', t.kandidat_id, 'jumlah', t.jumlah)), '[]'::jsonb)
                FROM (SELECT k.id AS kandidat_id, COUNT(s.id) AS jumlah
                      FROM public.polling_kandidat k
                      LEFT JOIN public.polling_suara s ON s.kandidat_id = k.id
                      GROUP BY k.id) t),
        'total', (SELECT COUNT(*) FROM public.polling_suara)
    );
$$;
REVOKE EXECUTE ON FUNCTION public.polling_hasil_total() FROM public;
GRANT EXECUTE ON FUNCTION public.polling_hasil_total() TO anon;
