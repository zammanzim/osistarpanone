-- ============================================================
-- MIGRASI: changelog DB-driven (ganti changelog.json manual)
-- Jalankan SEKALI di Supabase SQL Editor. Aman di-run ulang.
--
-- Halaman publik: /changelog.html (baca bebas, tanpa login).
-- Kelola (tambah/ubah/hapus): /osis/changelog.html, hak "changelog"
--   (diatur super_admin di halaman Akses; super_admin selalu bisa).
-- Seed: 41 entri v1.0.0 → v6.2.0, idempotent via ON CONFLICT.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.changelog (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    versi text NOT NULL UNIQUE,
    tanggal date NOT NULL DEFAULT CURRENT_DATE,
    tipe text NOT NULL DEFAULT 'patch' CHECK (tipe IN ('major', 'minor', 'patch')),
    judul text NOT NULL DEFAULT '',
    deskripsi text NOT NULL DEFAULT '',
    komit text NOT NULL DEFAULT '',
    pesan text NOT NULL DEFAULT '',
    files integer NOT NULL DEFAULT 0,
    tambah integer NOT NULL DEFAULT 0,
    kurang integer NOT NULL DEFAULT 0,
    created_by bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changelog_tanggal ON public.changelog (tanggal DESC, id DESC);

ALTER TABLE public.changelog ENABLE ROW LEVEL SECURITY;

-- Baca: publik boleh lihat (halaman changelog tanpa login).
DROP POLICY IF EXISTS "changelog_public_select" ON public.changelog;
CREATE POLICY "changelog_public_select" ON public.changelog
    FOR SELECT USING (true);

-- Tulis: cuma lewat function (cek hak "changelog").
-- Tambah entri baru, balikin id (>0). Error: -1 no auth, -2 versi kosong, -3 versi sudah ada.
CREATE OR REPLACE FUNCTION public.buat_changelog(
    p_user_id bigint,
    p_versi text,
    p_tipe text DEFAULT 'patch',
    p_judul text DEFAULT '',
    p_deskripsi text DEFAULT '',
    p_komit text DEFAULT '',
    p_pesan text DEFAULT '',
    p_files integer DEFAULT 0,
    p_tambah integer DEFAULT 0,
    p_kurang integer DEFAULT 0,
    p_tanggal text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
    v_tanggal date;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'changelog') THEN
        RETURN -1;
    END IF;
    IF p_versi IS NULL OR btrim(p_versi) = '' THEN
        RETURN -2;
    END IF;
    IF EXISTS (SELECT 1 FROM public.changelog WHERE versi = btrim(p_versi)) THEN
        RETURN -3;
    END IF;
    IF p_tipe IS NULL OR p_tipe NOT IN ('major', 'minor', 'patch') THEN
        RETURN -4;
    END IF;
    BEGIN
        v_tanggal := COALESCE(NULLIF(btrim(p_tanggal), '')::date, CURRENT_DATE);
    EXCEPTION WHEN OTHERS THEN
        v_tanggal := CURRENT_DATE;
    END;
    INSERT INTO public.changelog (versi, tanggal, tipe, judul, deskripsi, komit, pesan, files, tambah, kurang, created_by)
    VALUES (
        btrim(p_versi),
        v_tanggal,
        p_tipe,
        left(COALESCE(p_judul, ''), 80),
        left(COALESCE(p_deskripsi, ''), 500),
        left(COALESCE(p_komit, ''), 64),
        left(COALESCE(p_pesan, ''), 200),
        GREATEST(COALESCE(p_files, 0), 0),
        GREATEST(COALESCE(p_tambah, 0), 0),
        GREATEST(COALESCE(p_kurang, 0), 0),
        p_user_id
    )
    RETURNING id INTO new_id;
    RETURN new_id;
END $$;

-- Ubah entri (versi tidak bisa diubah biar tidak tabrakan unique).
-- Error: ERR_NO_AUTH / ERR_NOT_FOUND / ERR_TIPE.
CREATE OR REPLACE FUNCTION public.update_changelog(
    p_user_id bigint,
    p_id bigint,
    p_tipe text DEFAULT NULL,
    p_judul text DEFAULT NULL,
    p_deskripsi text DEFAULT NULL,
    p_tanggal text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_tanggal date;
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'changelog') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    IF p_tipe IS NOT NULL AND p_tipe NOT IN ('major', 'minor', 'patch') THEN
        RETURN 'ERR_TIPE';
    END IF;
    IF p_tanggal IS NOT NULL AND btrim(p_tanggal) <> '' THEN
        BEGIN
            v_tanggal := btrim(p_tanggal)::date;
        EXCEPTION WHEN OTHERS THEN
            RETURN 'ERR_TANGGAL';
        END;
    END IF;
    UPDATE public.changelog SET
        tipe = COALESCE(p_tipe, tipe),
        judul = CASE WHEN p_judul IS NULL THEN judul ELSE left(p_judul, 80) END,
        deskripsi = CASE WHEN p_deskripsi IS NULL THEN deskripsi ELSE left(p_deskripsi, 500) END,
        tanggal = COALESCE(v_tanggal, tanggal)
    WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

-- Hapus entri. Error: ERR_NO_AUTH / ERR_NOT_FOUND.
CREATE OR REPLACE FUNCTION public.hapus_changelog(
    p_user_id bigint,
    p_id bigint
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.osis_bisa(p_user_id, 'changelog') THEN
        RETURN 'ERR_NO_AUTH';
    END IF;
    DELETE FROM public.changelog WHERE id = p_id;
    IF FOUND THEN
        RETURN 'OK';
    END IF;
    RETURN 'ERR_NOT_FOUND';
END $$;

REVOKE EXECUTE ON FUNCTION public.buat_changelog(bigint, text, text, text, text, text, text, integer, integer, integer, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_changelog(bigint, bigint, text, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.hapus_changelog(bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.buat_changelog(bigint, text, text, text, text, text, text, integer, integer, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_changelog(bigint, bigint, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.hapus_changelog(bigint, bigint) TO anon;

-- ============================================================
-- SEED: 41 entri v1.0.0 → v6.2.0 (idempotent)
-- ============================================================
INSERT INTO public.changelog (versi, tanggal, tipe, judul, deskripsi, komit, pesan, files, tambah, kurang) VALUES
('v1.0.0','2026-09-02','major','Rilis awal','Fondasi web: halaman utama, login, agenda, aspirasi, galeri, kegiatan, lagu, prestasi, sekbid, visitor, dan database awal.','3a17f1604dc5a8e23e57d5eb7f0ed4cef85a9edb','domain baru',22,8996,0),
('v1.1.0','2026-09-05','minor','Iterasi modul awal','Halaman osis/index dan menu OSIS baru, rombak modul awal.','f550cca4d3940833b0a495447a8e39d5aeb016c8','mmm',14,2695,1006),
('v2.0.0','2026-09-06','major','Modul inti OSIS','8 modul inti baru: Anggota, Dokumen, Evaluasi, Keuangan, Notulensi, Profil, Proker, Task beserta halamannya.','b3a5935c3c5654fdf9c74716106368b7d9013f6d','06sep',20,11225,23),
('v2.1.0','2026-09-06','minor','Fondasi PWA + Dashboard','Fondasi PWA (manifest, service worker, offline, ikon), fitur Dashboard, Formulir, dan Sidebar.','b7022938823da973bb28a2b6005b43696f6b4e3e','testpwa',44,3406,841),
('v2.1.1','2026-09-06','patch','Hapus foto sekbid','Hapus 15 file foto sekbid dan penyesuaian template.','c7fcae59e6eb31adb50968c136b5061fb2634b6a','06sepnew',32,38,21),
('v2.1.2','2026-09-06','patch','Fix CSS tap','Fix kecil CSS webkit-tap.','f52d5f26992815249ba197526bbcc86a76dcfaec','webkittap',1,4,0),
('v2.1.3','2026-09-07','patch','Config domain','Tambah file CNAME untuk custom domain.','d2dcb0977e2f46dfd7bf467cfcdfbcb8f4b75aab','Create CNAME',1,1,0),
('v2.2.0','2026-09-08','minor','Form publik + SEO','Form publik baru dan dasar SEO (robots.txt, sitemap.xml).','247281ee23f8729cb2f1b4c37829f6832a5f428e','08sep',23,851,87),
('v2.2.1','2026-09-09','patch','Hapus sitemap','Hapus sitemap.xml.','baf7ea23ea785c38a9ed55c183d5eb298c4318f0','deletesitemap',1,0,8),
('v2.2.2','2026-09-09','patch','Tambah sitemap','Tambah sitemap.xml.','836aac166484f25c6a92fa0e5b9c6537e6e4d16e','addsitemap',1,8,0),
('v2.3.0','2026-09-15','minor','Visitor tracking','Fitur pencatatan pengunjung.','874347a2941e03a579d3944994e6a7be0497ad05','visitor',4,273,59),
('v3.0.0','2026-09-17','major','Restruktur + Absensi & Tabungan','Restruktur osis/ ke osisbin/ dan duplikat jsbin/. Fitur baru Absensi dan Tabungan, rewrite keuangan.','b5718f7c49cf7d926fdde9c1e8cb90c7767f4508','serius',63,17018,1048),
('v3.1.0','2026-09-17','minor','Perbaikan galeri & home','Perbaikan galeri, home, dan style.','0b1d22f9b4ceed3882a6d9158bc22fb8742e1172','serius2',4,641,93),
('v3.2.0','2026-09-17','minor','Perbaikan aspirasi & lagu','Perbaikan aspirasi, home, lagu, dan site-edit.','ca5022501a59aa78beb070858b55c4c06a31302b','serius3',14,1584,28),
('v3.3.0','2026-09-18','minor','Perbaikan Agenda','Perbaikan modul agenda dan database.','2144a547d41f4bc03a973dfcd619532a7502ffdf','18sept',8,793,185),
('v4.0.0','2026-09-19','major','Sistem Akses + Outbox offline','Sistem hak akses baru dan sinkron offline (outbox 1210 baris), rewrite db.js, refresh ikon.','849b290e533a77388fe81ad0afe1ff6a189c4673','seriusasli1',77,9891,1909),
('v4.0.1','2026-09-19','patch','Integrasi Supabase JS','Tambah supabase.min.js dan penyesuaian kecil tersebar.','5961cdc25fda9af441444c7671936a582c2d5fd2','seriusasli2',38,397,125),
('v4.1.0','2026-09-20','minor','Fitur Program bulanan & tahunan','Halaman program bulanan dan tahunan baru (js/program.js).','93e256a87b75dc4dc84875924aca2f2f710897fc','seriusasli4',10,2012,5),
('v4.2.0','2026-09-20','minor','Fitur Pengurus','Modul pengurus baru (js/pengurus.js) dan halaman anggota.','0052ba38207353313fc1b56f44e2dbaf9b27a373','seriusasli5',34,3102,334),
('v4.2.1','2026-09-21','patch','Fix PWA','Perbaikan PWA (pwa.js, service worker, CSS).','814efcf598e6292f69073ccff356044f963bcd4c','pwafix',4,83,26),
('v4.2.2','2026-09-21','patch','Fix robots.txt','Perbaikan robots.txt.','211dc600e812ef211cff071641c8675bf336ebfb','fix robots',1,1,1),
('v4.3.0','2026-09-21','minor','Migrasi sidebar + orientasi','Migrasi sidebar SQL, perbaikan orientasi/layout, dan update template OSIS.','9725949b5bcc1ba74e68470f5d956999a44553ca','orienatation',33,1511,175),
('v4.3.1','2026-09-21','patch','Refresh manifest & ikon','Refresh icons, manifest.webmanifest, dan service worker.','d1a8d48e4c9a871b93fb46487c7ff8f5abe92d89','manifest',7,3,3),
('v4.4.0','2026-09-22','minor','Fitur Polling + Poster','Dua fitur baru: Polling (polling.html) dan Poster (osis/poster.html), plus halaman jepun dan limit lagu.','127f8782ca4f079523a13d6613971c2fc8b5fca8','seriusaseli6',30,3233,32),
('v4.5.0','2026-09-23','minor','Perbaikan absensi & agenda','Perbaikan sedang absensi, agenda, akses, tabungan, dan home.','61cfaccc6077afae2097c812a3ae10ff97e40c65','seriusasli6',15,1447,468),
('v4.5.1','2026-09-23','patch','Fix kecil index','Perbaikan 1 baris di index.html.','106dd83447f76e6dadbcf0929fbdb48252ab3a22','polwakilang',1,1,3),
('v4.5.2','2026-09-23','patch','Fix agenda & akses','Perbaikan agenda, akses, dashboard, sekbid, dan outbox.','a5f4ea6e1f6adbd4e679877dd6cb0fa1cca85106','seriusasli8',10,229,156),
('v4.6.0','2026-09-24','minor','Role super admin','Tambah role super admin via migrasi-super-admin.sql.','ba2c48bc07368e84e3aae7a925d8a22bdf458f2c','superadmin',2,208,4),
('v4.7.0','2026-09-24','minor','Tandai lagu selesai','Fitur tandai lagu selesai (migrasi-lagu-selesai.sql).','ca2c808adae601dad8234545edd30f4e89a4b560','markdonesong',7,246,8),
('v4.8.0','2026-09-24','minor','Fitur Informasi','Halaman Informasi baru (js/informasi.js, osis/informasi.html) plus label pengunggah.','7bc60d75082ea582f43591954cf20b73f4d6e496','informasi',24,1201,28),
('v5.0.0','2026-09-24','major','Cleanup duplikat + Worker R2','BREAKING cleanup: hapus jsbin/ dan osisbin/ (-23 ribu baris). Arsitektur baru Worker R2 presign.','0ce348e5e684515f19176e6c9424d53cdc2854ea','dbr2',56,492,23167),
('v5.1.0','2026-09-24','minor','Tooling migrasi R2','Tambah package.json, tool migrate-supabase-to-r2, dan worker presign.','0fdcd35287e09fca3d0b4e0a8f64c31859e9eed8','dbr2',6,541,7),
('v6.0.0','2026-09-24','major','Migrasi ke Supabase Auth + R2 presign','BREAKING: sistem login pindah ke Supabase Auth, media via presign R2 per hak akses. Termasuk 2 migrasi SQL fondasi/kunci.','509a51466fc94b908d318cc3a70a1deb6c90251f','Migrasi login ke Supabase Auth + presign R2 per hak akses',27,540,107),
('v6.0.1','2026-09-24','patch','Normalisasi template','Normalisasi massal 16 file HTML (header/template).','316fc7ed3cf48f820cb685b98a47e8782ca44d43','112',16,56,56),
('v6.0.2','2026-09-24','patch','Fixup auth lanjutan','Perbaikan lanjutan migrasi auth: login, osis-auth, profil, dan template.','478bc30175d129b528189ba3aed1b6b147bc84a9','1123',23,230,135),
('v6.1.0','2026-09-24','minor','Halaman Profil Saya','Halaman osis/profil.html baru, update menu sidebar, dan precache SW. Tool reset-password.','4379f692fd3491488930644cae24b7ca0f08f0fe','Halaman Profil Saya + menu sidebar + precache',5,312,3),
('v6.1.1','2026-09-24','patch','Toggle super admin','Tambah toggle role super admin di halaman Akses.','39a599544e8171390541552066ece3e756734ffa','Toggle super admin di halaman Akses',4,35,3),
('v6.1.2','2026-09-24','patch','Chip user ke profil','Chip user di header sekarang bisa diklik menuju halaman profil.','0fed47b7023d3f4d741824897efccf974218c047','Chip user header klik ke profil',19,26,20),
('v6.1.3','2026-09-25','patch','Filter periode pengurus','Dropdown pengurus kini menyembunyikan periode masa depan.','c232fab6e081d891fd24bc35247c8a717b5ee671','Sembunyikan periode masa depan di dropdown pengurus',3,7,4),
('v6.1.4','2026-09-25','patch','Fix kecil pengurus','Perbaikan kecil index.html, js/pengurus.js, dan sw.js.','9cf91b7a8644b5efc77bd478ea7c0763961c5f55','ee',3,4,7),
('v6.2.0','2026-09-26','minor','Fitur Arsip + Notifikasi','Modul Arsip baru (js/arsip.js, migrasi-arsip.sql) dan sistem notice (js/notice.js). Update agenda, galeri, kegiatan, prestasi.','1c63574e2bd81df5ba673587fa7a300a47d411c5','unreleased',32,1944,132),
('v6.3.0','2026-09-27','minor','Changelog DB + kelola inline','Riwayat versi pindah ke database + bisa ditambah/ubah/hapus langsung di halaman changelog (hak changelog). Termasuk halaman publik, migrasi seed 41 versi, dan precache offline.','15e8600f8329e352a5a5ba6b1ae7a3bc0126fcd6','Changelog DB + kelola inline di halaman publik',13,1919,14)
ON CONFLICT (versi) DO NOTHING;
