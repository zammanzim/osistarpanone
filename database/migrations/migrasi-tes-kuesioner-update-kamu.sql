-- =========================================================================
-- MIGRASI-TES-KUESIONER-UPDATE-KAMU
-- Ubah redaksi 60 soal Kuesioner Penilaian dari orang ke-3 ("Apakah dia...")
-- menjadi sapaan langsung ke pembaca ("Apakah kamu...", "dirimu", "-mu").
-- Non-destruktif: update by (tes_id, urutan) agar id soal & hasil peserta
-- yang sudah masuk di osis_tes_hasil tetap utuh.
-- =========================================================================

BEGIN;

UPDATE public.osis_tes
   SET deskripsi  = 'Kuesioner penilaian diri 6 aspek (60 pertanyaan). Pilih frekuensi yang paling menggambarkan dirimu: 1 = Tidak pernah, 2 = Jarang, 3 = Kadang-kadang, 4 = Sering, 5 = Konsisten.',
       updated_at = now()
 WHERE judul = 'Kuesioner Penilaian (60 Pertanyaan)';

WITH data_baru(urutan, aspek, teks) AS (
  VALUES
    -- Aspek 1 (1-10)
    (10,  'Aspek 1', 'Apakah kamu selalu berusaha mengatakan kebenaran meskipun hal tersebut dapat merugikan dirimu?'),
    (20,  'Aspek 1', 'Apakah perkataan yang kamu sampaikan sesuai dengan tindakan yang kamu lakukan?'),
    (30,  'Aspek 1', 'Apakah kamu mengakui kesalahan tanpa harus terlebih dahulu diketahui orang lain?'),
    (40,  'Aspek 1', 'Apakah kamu mampu menjaga rahasia yang dipercayakan kepadamu?'),
    (50,  'Aspek 1', 'Apakah kamu tetap melakukan hal yang benar meskipun tidak ada orang yang mengawasi?'),
    (60,  'Aspek 1', 'Apakah kamu pernah mengubah cerita untuk membuat dirimu terlihat lebih baik?'),
    (70,  'Aspek 1', 'Apakah kamu menggunakan kepercayaan orang lain untuk kepentingan pribadimu?'),
    (80,  'Aspek 1', 'Apakah kamu berani menyampaikan pendapat yang sebenarnya meskipun berbeda dengan mayoritas?'),
    (90,  'Aspek 1', 'Apakah kamu menepati janji meskipun tidak ada keuntungan yang diperoleh?'),
    (100, 'Aspek 1', 'Apakah kamu tetap memegang prinsip ketika menghadapi godaan atau tekanan?'),
    -- Aspek 2 (11-20)
    (110, 'Aspek 2', 'Apakah kamu menyelesaikan pekerjaan yang sudah menjadi tanggung jawabmu?'),
    (120, 'Aspek 2', 'Apakah kamu memiliki kebiasaan datang tepat waktu?'),
    (130, 'Aspek 2', 'Apakah kamu mampu mengatur kegiatan sehari-hari tanpa harus selalu diingatkan?'),
    (140, 'Aspek 2', 'Apakah kamu bersedia menerima konsekuensi dari keputusan yang kamu buat?'),
    (150, 'Aspek 2', 'Apakah kamu tetap menjalankan kewajiban meskipun sedang tidak bersemangat?'),
    (160, 'Aspek 2', 'Apakah kamu sering mencari alasan untuk menghindari tanggung jawab?'),
    (170, 'Aspek 2', 'Apakah kamu meninggalkan pekerjaan ketika menghadapi kesulitan?'),
    (180, 'Aspek 2', 'Apakah kamu mampu menentukan prioritas antara kepentingan pribadi dan kewajibanmu?'),
    (190, 'Aspek 2', 'Apakah kamu berusaha memperbaiki pekerjaan ketika hasilnya belum sesuai harapan?'),
    (200, 'Aspek 2', 'Apakah kamu konsisten menjalankan komitmen yang telah kamu buat?'),
    -- Aspek 3 (21-30)
    (210, 'Aspek 3', 'Apakah kamu mampu mengendalikan kemarahan ketika menghadapi situasi yang tidak menyenangkan?'),
    (220, 'Aspek 3', 'Apakah kamu tetap bisa berpikir jernih ketika sedang menghadapi masalah?'),
    (230, 'Aspek 3', 'Apakah kamu mampu menerima kritik tanpa langsung merasa diserang?'),
    (240, 'Aspek 3', 'Apakah kamu bersedia meminta maaf ketika menyadari telah menyakiti orang lain?'),
    (250, 'Aspek 3', 'Apakah kamu mampu menyelesaikan perbedaan pendapat tanpa memperbesar konflik?'),
    (260, 'Aspek 3', 'Apakah kamu mudah melampiaskan kemarahan kepada orang yang tidak bersalah?'),
    (270, 'Aspek 3', 'Apakah kamu sering membesar-besarkan masalah kecil?'),
    (280, 'Aspek 3', 'Apakah kamu mampu mengendalikan ucapan ketika sedang kecewa?'),
    (290, 'Aspek 3', 'Apakah kamu dapat menerima penolakan tanpa menunjukkan sikap bermusuhan?'),
    (300, 'Aspek 3', 'Apakah kamu mampu menenangkan dirimu sebelum mengambil keputusan penting?'),
    -- Aspek 4 (31-40)
    (310, 'Aspek 4', 'Apakah kamu memperlakukan orang lain dengan hormat tanpa membedakan status sosial?'),
    (320, 'Aspek 4', 'Apakah kamu bersedia membantu orang lain tanpa selalu mengharapkan imbalan?'),
    (330, 'Aspek 4', 'Apakah kamu mampu mendengarkan keluhan orang lain dengan sungguh-sungguh?'),
    (340, 'Aspek 4', 'Apakah kamu memperhatikan perasaan orang lain sebelum mengucapkan sesuatu?'),
    (350, 'Aspek 4', 'Apakah kamu tetap bersikap baik kepada orang yang tidak dapat memberikan keuntungan kepadamu?'),
    (360, 'Aspek 4', 'Apakah kamu merendahkan orang yang dianggap memiliki kedudukan lebih rendah?'),
    (370, 'Aspek 4', 'Apakah kamu senang membicarakan kekurangan atau keburukan orang lain?'),
    (380, 'Aspek 4', 'Apakah kamu mampu menghargai keberhasilan orang lain tanpa merasa tersaingi?'),
    (390, 'Aspek 4', 'Apakah kamu bersedia membantu ketika melihat seseorang mengalami kesulitan?'),
    (400, 'Aspek 4', 'Apakah kamu menghormati perbedaan pendapat, latar belakang, dan pilihan hidup orang lain?'),
    -- Aspek 5 (41-50)
    (410, 'Aspek 5', 'Apakah kamu mempertimbangkan dampak jangka panjang sebelum mengambil keputusan?'),
    (420, 'Aspek 5', 'Apakah kamu mampu membedakan fakta dengan asumsi atau prasangka?'),
    (430, 'Aspek 5', 'Apakah kamu bersedia mengubah pendapat ketika menemukan bukti yang lebih kuat?'),
    (440, 'Aspek 5', 'Apakah kamu mampu belajar dari kesalahan yang pernah kamu lakukan?'),
    (450, 'Aspek 5', 'Apakah kamu mempertimbangkan pendapat orang lain sebelum mengambil keputusan penting?'),
    (460, 'Aspek 5', 'Apakah kamu mudah percaya terhadap informasi tanpa memeriksa kebenarannya?'),
    (470, 'Aspek 5', 'Apakah kamu merasa pendapatmu selalu paling benar?'),
    (480, 'Aspek 5', 'Apakah kamu mampu melihat suatu persoalan dari sudut pandang yang berbeda?'),
    (490, 'Aspek 5', 'Apakah kamu dapat membedakan kepentingan pribadi dengan kepentingan bersama?'),
    (500, 'Aspek 5', 'Apakah kamu mampu mengambil keputusan secara rasional meskipun sedang berada dalam tekanan lingkungan?'),
    -- Aspek 6 (51-60)
    (510, 'Aspek 6', 'Apakah sikapmu tetap sama ketika berhadapan dengan orang kaya maupun orang sederhana?'),
    (520, 'Aspek 6', 'Apakah kamu tetap bersikap baik ketika tidak sedang membutuhkan bantuan orang lain?'),
    (530, 'Aspek 6', 'Apakah kamu mampu menjaga perilakumu ketika tidak ada orang yang mengawasi?'),
    (540, 'Aspek 6', 'Apakah kamu tetap menghargai orang lain ketika memiliki kedudukan atau kekuasaan lebih tinggi?'),
    (550, 'Aspek 6', 'Apakah kamu mampu menerima keberhasilan orang lain tanpa merendahkan pencapaian tersebut?'),
    (560, 'Aspek 6', 'Apakah kamu hanya menunjukkan kebaikan ketika ada kepentingan pribadi?'),
    (570, 'Aspek 6', 'Apakah kamu mengubah sikap secara drastis ketika berhadapan dengan orang yang lebih berpengaruh?'),
    (580, 'Aspek 6', 'Apakah kamu tetap menjalankan prinsip yang sama ketika situasi menguntungkan maupun merugikan dirimu?'),
    (590, 'Aspek 6', 'Apakah kamu mampu bersikap adil meskipun harus mengesampingkan kepentingan pribadimu?'),
    (600, 'Aspek 6', 'Apakah kamu tetap menghormati seseorang meskipun orang tersebut sudah tidak memiliki manfaat bagi dirimu?')
)
UPDATE public.osis_tes_soal s
   SET pertanyaan = '[' || d.aspek || '] ' || d.teks,
       updated_at = now()
  FROM public.osis_tes t,
       data_baru d
 WHERE s.tes_id = t.id
   AND t.judul = 'Kuesioner Penilaian (60 Pertanyaan)'
   AND s.urutan = d.urutan;

COMMIT;
