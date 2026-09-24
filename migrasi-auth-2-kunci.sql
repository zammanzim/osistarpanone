-- ============ MIGRASI AUTH BAGIAN 2: KUNCI (matikan password plaintext) ============
-- !!! JALANKAN TERAKHIR, setelah: frontend baru ter-deploy + bulk migrasi done !!!
-- Efek: kolom password tidak bisa dibaca siapa pun dari client (anon/autenticated).
-- Login lama (compare di browser) MATI TOTAL di sini — itu tujuannya.
-- Tulis tetap lewat RPC SECURITY DEFINER (jalan sebagai owner, tidak terpengaruh).
--
-- Kolom tabel: id, username, password, nama, jabatan, foto, bio, angkatan,
-- sekbid_id, auth_id, auth_email. Semua dibuka KECUALI password. auth_id dan
-- auth_email dibuka karena client memakainya di klausa WHERE (Postgres
-- mewajibkan hak SELECT untuk kolom yang dipakai di WHERE) dan menampilkannya.
-- =============================================================================

REVOKE ALL ON public.osis_users FROM anon, authenticated;
GRANT SELECT (id, username, nama, jabatan, foto, bio, angkatan, sekbid_id, auth_id, auth_email)
    ON public.osis_users TO anon, authenticated;

-- RLS tetap MATI untuk tabel ini (seperti sebelumnya) — keamanan kolom dipegang
-- oleh GRANT di atas. JANGAN enable RLS tanpa policy (deny-all = semua query pecah).
