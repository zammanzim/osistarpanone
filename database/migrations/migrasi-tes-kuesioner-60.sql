-- =========================================================================
-- MIGRASI-TES-KUESIONER-60 — seed Kuesioner Penilaian (60 pertanyaan, 6 Aspek)
-- Prasyarat: jalankan database/migrations/migrasi-tes.sql terlebih dahulu.
-- Sifat: NON-DESTRUKTIF, idempoten (skip bila judul sudah ada di angkatan aktif).
-- Skala pilihan: Tidak pernah, Jarang, Kadang-kadang, Sering, Konsisten.
--   - Normal: Tidak pernah = 1 .. Konsisten = 5
--   - Label (R) / terbalik: Tidak pernah = 5 .. Konsisten = 1
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_ang         bigint;
  v_tes_id      bigint;
  v_opsi_normal jsonb := '[
    {"id":"1","teks":"Tidak pernah","poin":1},
    {"id":"2","teks":"Jarang","poin":2},
    {"id":"3","teks":"Kadang-kadang","poin":3},
    {"id":"4","teks":"Sering","poin":4},
    {"id":"5","teks":"Konsisten","poin":5}
  ]'::jsonb;
  v_opsi_balik jsonb := '[
    {"id":"1","teks":"Tidak pernah","poin":5},
    {"id":"2","teks":"Jarang","poin":4},
    {"id":"3","teks":"Kadang-kadang","poin":3},
    {"id":"4","teks":"Sering","poin":2},
    {"id":"5","teks":"Konsisten","poin":1}
  ]'::jsonb;
  v_item        record;
  v_ord         integer := 0;
BEGIN
  SELECT id INTO v_ang
    FROM public.angkatan
   WHERE kode = 'ADIABI-4'
   LIMIT 1;

  IF v_ang IS NULL THEN
    SELECT id INTO v_ang
      FROM public.angkatan
     WHERE aktif
     ORDER BY urutan DESC, id DESC
     LIMIT 1;
  END IF;

  IF v_ang IS NULL THEN
    RAISE EXCEPTION 'Master angkatan tidak ditemukan.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.osis_tes
     WHERE angkatan_id = v_ang
       AND judul = 'Kuesioner Penilaian (60 Pertanyaan)'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.osis_tes (
    angkatan_id,
    judul,
    deskripsi,
    kategori,
    status,
    pengaturan,
    pengunggah
  ) VALUES (
    v_ang,
    'Kuesioner Penilaian (60 Pertanyaan)',
    'Kuesioner penilaian 6 aspek (60 pertanyaan). Pilih frekuensi yang paling menggambarkan perilaku: 1 = Tidak pernah, 2 = Jarang, 3 = Kadang-kadang, 4 = Sering, 5 = Konsisten.',
    'Evaluasi',
    'aktif',
    jsonb_build_object(
      'durasi_menit', 0,
      'acak_soal', false,
      'acak_opsi', false,
      'boleh_ulang', true,
      'tampil_nilai', true,
      'tampil_kunci', true
    ),
    'Sistem OSIS'
  ) RETURNING id INTO v_tes_id;

  FOR v_item IN
    SELECT * FROM (VALUES
      -- Aspek 1 (1-10)
      (1,  'Aspek 1', false, 'Apakah dia selalu berusaha mengatakan kebenaran meskipun hal tersebut dapat merugikan dirinya?'),
      (2,  'Aspek 1', false, 'Apakah perkataan yang disampaikan sesuai dengan tindakan yang dilakukan?'),
      (3,  'Aspek 1', false, 'Apakah dia mengakui kesalahan tanpa harus terlebih dahulu diketahui orang lain?'),
      (4,  'Aspek 1', false, 'Apakah dia mampu menjaga rahasia yang dipercayakan kepadanya?'),
      (5,  'Aspek 1', false, 'Apakah dia tetap melakukan hal yang benar meskipun tidak ada orang yang mengawasi?'),
      (6,  'Aspek 1', true,  'Apakah dia pernah mengubah cerita untuk membuat dirinya terlihat lebih baik?'),
      (7,  'Aspek 1', true,  'Apakah dia menggunakan kepercayaan orang lain untuk kepentingan pribadinya?'),
      (8,  'Aspek 1', false, 'Apakah dia berani menyampaikan pendapat yang sebenarnya meskipun berbeda dengan mayoritas?'),
      (9,  'Aspek 1', false, 'Apakah dia menepati janji meskipun tidak ada keuntungan yang diperoleh?'),
      (10, 'Aspek 1', false, 'Apakah dia tetap memegang prinsip ketika menghadapi godaan atau tekanan?'),
      -- Aspek 2 (11-20)
      (11, 'Aspek 2', false, 'Apakah dia menyelesaikan pekerjaan yang sudah menjadi tanggung jawabnya?'),
      (12, 'Aspek 2', false, 'Apakah dia memiliki kebiasaan datang tepat waktu?'),
      (13, 'Aspek 2', false, 'Apakah dia mampu mengatur kegiatan sehari-hari tanpa harus selalu diingatkan?'),
      (14, 'Aspek 2', false, 'Apakah dia bersedia menerima konsekuensi dari keputusan yang dibuatnya?'),
      (15, 'Aspek 2', false, 'Apakah dia tetap menjalankan kewajiban meskipun sedang tidak bersemangat?'),
      (16, 'Aspek 2', true,  'Apakah dia sering mencari alasan untuk menghindari tanggung jawab?'),
      (17, 'Aspek 2', true,  'Apakah dia meninggalkan pekerjaan ketika menghadapi kesulitan?'),
      (18, 'Aspek 2', false, 'Apakah dia mampu menentukan prioritas antara kepentingan pribadi dan kewajibannya?'),
      (19, 'Aspek 2', false, 'Apakah dia berusaha memperbaiki pekerjaan ketika hasilnya belum sesuai harapan?'),
      (20, 'Aspek 2', false, 'Apakah dia konsisten menjalankan komitmen yang telah dibuat?'),
      -- Aspek 3 (21-30)
      (21, 'Aspek 3', false, 'Apakah dia mampu mengendalikan kemarahan ketika menghadapi situasi yang tidak menyenangkan?'),
      (22, 'Aspek 3', false, 'Apakah dia tetap bisa berpikir jernih ketika sedang menghadapi masalah?'),
      (23, 'Aspek 3', false, 'Apakah dia mampu menerima kritik tanpa langsung merasa diserang?'),
      (24, 'Aspek 3', false, 'Apakah dia bersedia meminta maaf ketika menyadari telah menyakiti orang lain?'),
      (25, 'Aspek 3', false, 'Apakah dia mampu menyelesaikan perbedaan pendapat tanpa memperbesar konflik?'),
      (26, 'Aspek 3', true,  'Apakah dia mudah melampiaskan kemarahan kepada orang yang tidak bersalah?'),
      (27, 'Aspek 3', true,  'Apakah dia sering membesar-besarkan masalah kecil?'),
      (28, 'Aspek 3', false, 'Apakah dia mampu mengendalikan ucapan ketika sedang kecewa?'),
      (29, 'Aspek 3', false, 'Apakah dia dapat menerima penolakan tanpa menunjukkan sikap bermusuhan?'),
      (30, 'Aspek 3', false, 'Apakah dia mampu menenangkan dirinya sebelum mengambil keputusan penting?'),
      -- Aspek 4 (31-40)
      (31, 'Aspek 4', false, 'Apakah dia memperlakukan orang lain dengan hormat tanpa membedakan status sosial?'),
      (32, 'Aspek 4', false, 'Apakah dia bersedia membantu orang lain tanpa selalu mengharapkan imbalan?'),
      (33, 'Aspek 4', false, 'Apakah dia mampu mendengarkan keluhan orang lain dengan sungguh-sungguh?'),
      (34, 'Aspek 4', false, 'Apakah dia memperhatikan perasaan orang lain sebelum mengucapkan sesuatu?'),
      (35, 'Aspek 4', false, 'Apakah dia tetap bersikap baik kepada orang yang tidak dapat memberikan keuntungan kepadanya?'),
      (36, 'Aspek 4', true,  'Apakah dia merendahkan orang yang dianggap memiliki kedudukan lebih rendah?'),
      (37, 'Aspek 4', true,  'Apakah dia senang membicarakan kekurangan atau keburukan orang lain?'),
      (38, 'Aspek 4', false, 'Apakah dia mampu menghargai keberhasilan orang lain tanpa merasa tersaingi?'),
      (39, 'Aspek 4', false, 'Apakah dia bersedia membantu ketika melihat seseorang mengalami kesulitan?'),
      (40, 'Aspek 4', false, 'Apakah dia menghormati perbedaan pendapat, latar belakang, dan pilihan hidup orang lain?'),
      -- Aspek 5 (41-50)
      (41, 'Aspek 5', false, 'Apakah dia mempertimbangkan dampak jangka panjang sebelum mengambil keputusan?'),
      (42, 'Aspek 5', false, 'Apakah dia mampu membedakan fakta dengan asumsi atau prasangka?'),
      (43, 'Aspek 5', false, 'Apakah dia bersedia mengubah pendapat ketika menemukan bukti yang lebih kuat?'),
      (44, 'Aspek 5', false, 'Apakah dia mampu belajar dari kesalahan yang pernah dilakukan?'),
      (45, 'Aspek 5', false, 'Apakah dia mempertimbangkan pendapat orang lain sebelum mengambil keputusan penting?'),
      (46, 'Aspek 5', true,  'Apakah dia mudah percaya terhadap informasi tanpa memeriksa kebenarannya?'),
      (47, 'Aspek 5', true,  'Apakah dia merasa pendapatnya selalu paling benar?'),
      (48, 'Aspek 5', false, 'Apakah dia mampu melihat suatu persoalan dari sudut pandang yang berbeda?'),
      (49, 'Aspek 5', false, 'Apakah dia dapat membedakan kepentingan pribadi dengan kepentingan bersama?'),
      (50, 'Aspek 5', false, 'Apakah dia mampu mengambil keputusan secara rasional meskipun sedang berada dalam tekanan lingkungan?'),
      -- Aspek 6 (51-60)
      (51, 'Aspek 6', false, 'Apakah sikapnya tetap sama ketika berhadapan dengan orang kaya maupun orang sederhana?'),
      (52, 'Aspek 6', false, 'Apakah dia tetap bersikap baik ketika tidak sedang membutuhkan bantuan orang lain?'),
      (53, 'Aspek 6', false, 'Apakah dia mampu menjaga perilakunya ketika tidak ada orang yang mengawasi?'),
      (54, 'Aspek 6', false, 'Apakah dia tetap menghargai orang lain ketika memiliki kedudukan atau kekuasaan lebih tinggi?'),
      (55, 'Aspek 6', false, 'Apakah dia mampu menerima keberhasilan orang lain tanpa merendahkan pencapaian tersebut?'),
      (56, 'Aspek 6', true,  'Apakah dia hanya menunjukkan kebaikan ketika ada kepentingan pribadi?'),
      (57, 'Aspek 6', true,  'Apakah dia mengubah sikap secara drastis ketika berhadapan dengan orang yang lebih berpengaruh?'),
      (58, 'Aspek 6', false, 'Apakah dia tetap menjalankan prinsip yang sama ketika situasi menguntungkan maupun merugikan dirinya?'),
      (59, 'Aspek 6', false, 'Apakah dia mampu bersikap adil meskipun harus mengesampingkan kepentingan pribadinya?'),
      (60, 'Aspek 6', false, 'Apakah dia tetap menghormati seseorang meskipun orang tersebut sudah tidak memiliki manfaat bagi dirinya?')
    ) AS q(no_urut, aspek, terbalik, teks)
    ORDER BY q.no_urut
  LOOP
    v_ord := v_ord + 1;
    INSERT INTO public.osis_tes_soal (
      tes_id,
      angkatan_id,
      urutan,
      tipe,
      pertanyaan,
      opsi,
      kunci,
      poin,
      wajib,
      pembahasan
    ) VALUES (
      v_tes_id,
      v_ang,
      v_ord * 10,
      'bobot',
      '[' || v_item.aspek || '] ' || v_item.teks,
      CASE WHEN v_item.terbalik THEN v_opsi_balik ELSE v_opsi_normal END,
      jsonb_build_object('terbalik', v_item.terbalik, 'aspek', v_item.aspek),
      5,
      true,
      CASE WHEN v_item.terbalik THEN v_item.aspek || ' · Skor terbalik (R): Tidak pernah = 5, Konsisten = 1' ELSE v_item.aspek || ' · Skor normal: Tidak pernah = 1, Konsisten = 5' END
    );
  END LOOP;
END $$;

COMMIT;
