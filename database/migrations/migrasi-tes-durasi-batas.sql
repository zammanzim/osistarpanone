-- =========================================================================
-- MIGRASI-TES-DURASI-BATAS — hasil durasi pengerjaan + batas tanggal/jam
-- Sifat: NON-DESTRUKTIF, idempoten (CREATE OR REPLACE FUNCTION), BEGIN..COMMIT.
-- Perubahan:
--   1. tes_daftar : ikutkan mulai_at di ringkasan saya_hasil
--   2. simpan_tes : dukung durasi_menit (0..1440) dan tutup_at (timestamptz ISO)
--   3. submit_tes : tolak pengumpulan setelah tutup_at (+2 menit grace auto-submit)
--                   & clamp p_mulai_at <= now() agar durasi tidak negatif
-- Cara pakai: Supabase SQL Editor > tempel > Run.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.tes_daftar(
  p_user_id     bigint,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_kelola boolean := false;
  v_lintas boolean := false;
  v_ang    bigint;
  v_res    jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  IF p_angkatan_id IS NOT NULL AND NOT public.osis_boleh_angkatan(p_user_id, p_angkatan_id) THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;

  v_kelola := public.osis_bisa(p_user_id, 'tes');
  v_lintas := public.osis_lintas_angkatan(p_user_id);
  SELECT angkatan_id INTO v_ang FROM public.osis_users WHERE id = p_user_id;

  IF NOT v_lintas AND v_ang IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(q)), '[]'::jsonb)
    INTO v_res
    FROM (
      SELECT
        t.id,
        t.angkatan_id,
        t.judul,
        t.deskripsi,
        t.kategori,
        t.status,
        t.pengaturan,
        t.created_by,
        t.pengunggah,
        t.created_at,
        t.updated_at,
        (SELECT count(*)::int FROM public.osis_tes_soal s WHERE s.tes_id = t.id) AS soal_count,
        (SELECT COALESCE(sum(s.poin), 0) FROM public.osis_tes_soal s WHERE s.tes_id = t.id) AS poin_maks,
        CASE WHEN v_kelola THEN
          (SELECT count(*)::int FROM public.osis_tes_hasil h WHERE h.tes_id = t.id)
        ELSE NULL END AS peserta_count,
        CASE WHEN v_kelola THEN
          (SELECT count(*)::int FROM public.osis_tes_hasil h WHERE h.tes_id = t.id AND h.status = 'menunggu_koreksi')
        ELSE NULL END AS menunggu_koreksi_count,
        (
          SELECT jsonb_build_object(
            'id', h.id,
            'status', h.status,
            'skor_total', CASE
              WHEN v_kelola OR COALESCE((t.pengaturan->>'tampil_nilai')::boolean, true) THEN h.skor_total
              ELSE NULL
            END,
            'skor_maks', h.skor_maks,
            'percobaan_ke', h.percobaan_ke,
            'mulai_at', h.mulai_at,
            'selesai_at', h.selesai_at
          )
          FROM public.osis_tes_hasil h
          WHERE h.tes_id = t.id AND h.user_id = p_user_id
          LIMIT 1
        ) AS saya_hasil
      FROM public.osis_tes t
      WHERE (
        (v_lintas AND (p_angkatan_id IS NULL OR t.angkatan_id = p_angkatan_id))
        OR (NOT v_lintas AND t.angkatan_id = v_ang)
      )
        AND (v_kelola OR t.status IN ('aktif', 'ditutup'))
      ORDER BY
        CASE t.status WHEN 'aktif' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
        t.created_at DESC,
        t.id DESC
    ) q;

  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.simpan_tes(
  p_user_id     bigint,
  p_id          bigint DEFAULT NULL,
  p_judul       text DEFAULT '',
  p_deskripsi   text DEFAULT '',
  p_kategori    text DEFAULT '',
  p_status      text DEFAULT 'draft',
  p_pengaturan  jsonb DEFAULT '{}'::jsonb,
  p_soal        jsonb DEFAULT NULL,
  p_angkatan_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ang         bigint;
  v_tes_id      bigint;
  v_judul       text;
  v_deskripsi   text;
  v_kategori    text;
  v_status      text;
  v_cfg         jsonb;
  v_durasi      integer;
  v_tutup_at    timestamptz;
  v_el          jsonb;
  v_ord         integer;
  v_soal_id     bigint;
  v_new_id      bigint;
  v_tipe        text;
  v_tanya       text;
  v_opsi        jsonb;
  v_kunci       jsonb;
  v_poin        numeric(8,2);
  v_wajib       boolean;
  v_bahas       text;
  v_keep_ids    bigint[] := '{}'::bigint[];
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  IF NOT public.osis_bisa(p_user_id, 'tes') THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;

  v_judul := left(COALESCE(NULLIF(btrim(p_judul), ''), 'Tanpa judul'), 180);
  v_deskripsi := left(btrim(COALESCE(p_deskripsi, '')), 2000);
  v_kategori := left(btrim(COALESCE(p_kategori, '')), 60);
  v_status := lower(btrim(COALESCE(p_status, 'draft')));
  IF v_status NOT IN ('draft', 'aktif', 'ditutup') THEN
    v_status := 'draft';
  END IF;

  IF p_pengaturan IS NULL OR jsonb_typeof(p_pengaturan) <> 'object' THEN
    p_pengaturan := '{}'::jsonb;
  END IF;

  v_durasi := 0;
  IF COALESCE(p_pengaturan->>'durasi_menit', '') ~ '^\d+$' THEN
    v_durasi := GREATEST(0, LEAST(1440, (p_pengaturan->>'durasi_menit')::integer));
  END IF;

  v_tutup_at := NULL;
  IF NULLIF(btrim(COALESCE(p_pengaturan->>'tutup_at', '')), '') IS NOT NULL THEN
    BEGIN
      v_tutup_at := (p_pengaturan->>'tutup_at')::timestamptz;
    EXCEPTION WHEN others THEN
      v_tutup_at := NULL;
    END;
  END IF;

  v_cfg := jsonb_build_object(
    'durasi_menit', v_durasi,
    'tutup_at',     CASE WHEN v_tutup_at IS NOT NULL THEN to_char(v_tutup_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE NULL END,
    'acak_soal',    COALESCE((p_pengaturan->>'acak_soal')::boolean, false),
    'acak_opsi',    COALESCE((p_pengaturan->>'acak_opsi')::boolean, false),
    'boleh_ulang',  COALESCE((p_pengaturan->>'boleh_ulang')::boolean, true),
    'tampil_nilai', COALESCE((p_pengaturan->>'tampil_nilai')::boolean, true),
    'tampil_kunci', COALESCE((p_pengaturan->>'tampil_kunci')::boolean, false)
  );

  IF p_id IS NOT NULL AND p_id > 0 THEN
    SELECT angkatan_id INTO v_ang FROM public.osis_tes WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'ERR_NOT_FOUND');
    END IF;
    IF NOT public.osis_boleh_angkatan(p_user_id, v_ang) THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;

    UPDATE public.osis_tes
       SET judul      = v_judul,
           deskripsi  = v_deskripsi,
           kategori   = v_kategori,
           status     = v_status,
           pengaturan = v_cfg,
           updated_at = now()
     WHERE id = p_id;
    v_tes_id := p_id;
  ELSE
    v_ang := public.osis_target_angkatan(p_user_id, p_angkatan_id);
    IF v_ang IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;

    INSERT INTO public.osis_tes (
      angkatan_id, judul, deskripsi, kategori, status, pengaturan, created_by
    ) VALUES (
      v_ang, v_judul, v_deskripsi, v_kategori, v_status, v_cfg, p_user_id
    ) RETURNING id INTO v_tes_id;
  END IF;

  IF p_soal IS NOT NULL THEN
    IF jsonb_typeof(p_soal) <> 'array' THEN
      RETURN jsonb_build_object('error', 'ERR_SOAL_INVALID');
    END IF;

    v_ord := 0;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_soal) LOOP
      CONTINUE WHEN jsonb_typeof(v_el) <> 'object';
      v_ord := v_ord + 1;

      v_tipe := lower(btrim(COALESCE(v_el->>'tipe', 'pg')));
      IF v_tipe NOT IN ('pg', 'multi', 'bs', 'isian', 'essay', 'skala', 'bobot') THEN
        v_tipe := 'pg';
      END IF;

      v_tanya := left(COALESCE(v_el->>'pertanyaan', ''), 4000);
      v_opsi := COALESCE(v_el->'opsi', '[]'::jsonb);
      v_kunci := CASE
        WHEN jsonb_typeof(v_el->'kunci') = 'object' THEN v_el->'kunci'
        ELSE '{}'::jsonb
      END;
      v_poin := GREATEST(0, LEAST(10000, COALESCE((v_el->>'poin')::numeric, 10)));
      IF v_tipe = 'bobot' AND jsonb_typeof(v_opsi) = 'array' THEN
        SELECT COALESCE(MAX(GREATEST(0, COALESCE((o->>'poin')::numeric, 0))), 0)
          INTO v_poin
          FROM jsonb_array_elements(v_opsi) AS o;
      END IF;
      v_wajib := COALESCE((v_el->>'wajib')::boolean, true);
      v_bahas := left(COALESCE(v_el->>'pembahasan', ''), 4000);

      v_soal_id := NULL;
      IF COALESCE(v_el->>'id', '') ~ '^\d+$' THEN
        v_soal_id := (v_el->>'id')::bigint;
      END IF;

      IF v_soal_id IS NOT NULL THEN
        UPDATE public.osis_tes_soal
           SET urutan     = v_ord * 10,
               tipe       = v_tipe,
               pertanyaan = v_tanya,
               opsi       = v_opsi,
               kunci      = v_kunci,
               poin       = v_poin,
               wajib      = v_wajib,
               pembahasan = v_bahas,
               updated_at = now()
         WHERE id = v_soal_id AND tes_id = v_tes_id
         RETURNING id INTO v_new_id;

        IF v_new_id IS NOT NULL THEN
          v_keep_ids := array_append(v_keep_ids, v_new_id);
          CONTINUE;
        END IF;
      END IF;

      INSERT INTO public.osis_tes_soal (
        tes_id, angkatan_id, urutan, tipe, pertanyaan, opsi, kunci, poin, wajib, pembahasan
      ) VALUES (
        v_tes_id, v_ang, v_ord * 10, v_tipe, v_tanya, v_opsi, v_kunci, v_poin, v_wajib, v_bahas
      ) RETURNING id INTO v_new_id;

      v_keep_ids := array_append(v_keep_ids, v_new_id);
    END LOOP;

    DELETE FROM public.osis_tes_soal
     WHERE tes_id = v_tes_id
       AND NOT (id = ANY(v_keep_ids));
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_tes_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_tes(
  p_user_id  bigint,
  p_tes_id   bigint,
  p_jawaban  jsonb DEFAULT '{}'::jsonb,
  p_mulai_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tes          public.osis_tes%ROWTYPE;
  v_kelola       boolean := false;
  v_boleh_ulang  boolean := true;
  v_tampil_nilai boolean := true;
  v_tutup_at     timestamptz;
  v_mulai_at     timestamptz;
  v_ada_hasil    boolean := false;
  v_soal         record;
  v_ans          jsonb;
  v_ans_str      text;
  v_ans_arr      text[];
  v_key_str      text;
  v_key_arr      text[];
  v_terima_arr   text[];
  v_hit          integer;
  v_wrong        integer;
  v_tot_key      integer;
  v_parsial      boolean;
  v_poin         numeric(10,2);
  v_maks_opsi    numeric(10,2);
  v_ok           boolean;
  v_skor_auto    numeric(10,2) := 0;
  v_skor_maks    numeric(10,2) := 0;
  v_has_manual   boolean := false;
  v_clean_jwb    jsonb := '{}'::jsonb;
  v_penilaian    jsonb := '{}'::jsonb;
  v_status_hasil text;
  v_hasil_id     bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    p_user_id := public.osis_id_dari_auth();
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
    END IF;
  END IF;

  SELECT * INTO v_tes FROM public.osis_tes WHERE id = p_tes_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ERR_NOT_FOUND');
  END IF;

  IF NOT public.osis_boleh_angkatan(p_user_id, v_tes.angkatan_id) THEN
    RETURN jsonb_build_object('error', 'ERR_NO_AUTH');
  END IF;

  v_kelola := public.osis_bisa(p_user_id, 'tes');
  IF v_tes.status <> 'aktif' THEN
    RETURN jsonb_build_object('error', 'ERR_TES_TUTUP');
  END IF;

  v_tutup_at := NULL;
  IF NULLIF(btrim(COALESCE(v_tes.pengaturan->>'tutup_at', '')), '') IS NOT NULL THEN
    BEGIN
      v_tutup_at := (v_tes.pengaturan->>'tutup_at')::timestamptz;
    EXCEPTION WHEN others THEN
      v_tutup_at := NULL;
    END;
  END IF;
  IF v_tutup_at IS NOT NULL AND now() > v_tutup_at + interval '2 minutes' THEN
    RETURN jsonb_build_object('error', 'ERR_BATAS_WAKTU');
  END IF;

  v_boleh_ulang := COALESCE((v_tes.pengaturan->>'boleh_ulang')::boolean, true);
  v_tampil_nilai := COALESCE((v_tes.pengaturan->>'tampil_nilai')::boolean, true);

  SELECT EXISTS (
    SELECT 1 FROM public.osis_tes_hasil WHERE tes_id = p_tes_id AND user_id = p_user_id
  ) INTO v_ada_hasil;

  IF v_ada_hasil AND NOT v_boleh_ulang THEN
    RETURN jsonb_build_object('error', 'ERR_SUDAH_MENGERJAKAN');
  END IF;

  IF p_jawaban IS NULL OR jsonb_typeof(p_jawaban) <> 'object' THEN
    p_jawaban := '{}'::jsonb;
  END IF;

  FOR v_soal IN
    SELECT * FROM public.osis_tes_soal
     WHERE tes_id = p_tes_id
     ORDER BY urutan ASC, id ASC
  LOOP
    v_ans := p_jawaban -> (v_soal.id::text);
    v_poin := 0;
    v_ok := NULL;

    IF v_soal.tipe = 'pg' THEN
      IF jsonb_typeof(v_ans) IN ('string', 'number') THEN
        v_ans_str := btrim(v_ans #>> '{}');
      ELSE
        v_ans_str := '';
      END IF;
      v_clean_jwb := v_clean_jwb || jsonb_build_object(v_soal.id::text, to_jsonb(v_ans_str));
      v_key_str := btrim(COALESCE(v_soal.kunci->>'id', ''));
      v_skor_maks := v_skor_maks + v_soal.poin;
      IF v_key_str <> '' AND v_ans_str <> '' THEN
        v_ok := (v_ans_str = v_key_str);
        v_poin := CASE WHEN v_ok THEN v_soal.poin ELSE 0 END;
      ELSIF v_key_str <> '' THEN
        v_ok := false;
      END IF;
      v_skor_auto := v_skor_auto + v_poin;
      v_penilaian := v_penilaian || jsonb_build_object(
        v_soal.id::text, jsonb_build_object('poin', v_poin, 'maks', v_soal.poin, 'benar', v_ok)
      );

    ELSIF v_soal.tipe = 'bobot' THEN
      IF jsonb_typeof(v_ans) IN ('string', 'number') THEN
        v_ans_str := btrim(v_ans #>> '{}');
      ELSE
        v_ans_str := '';
      END IF;
      v_clean_jwb := v_clean_jwb || jsonb_build_object(v_soal.id::text, to_jsonb(v_ans_str));

      v_maks_opsi := v_soal.poin;
      IF jsonb_typeof(v_soal.opsi) = 'array' THEN
        SELECT COALESCE(MAX(GREATEST(0, COALESCE((o->>'poin')::numeric, 0))), v_soal.poin)
          INTO v_maks_opsi
          FROM jsonb_array_elements(v_soal.opsi) AS o;
      END IF;
      v_skor_maks := v_skor_maks + v_maks_opsi;

      IF v_ans_str <> '' AND jsonb_typeof(v_soal.opsi) = 'array' THEN
        SELECT COALESCE((o->>'poin')::numeric, 0)
          INTO v_poin
          FROM jsonb_array_elements(v_soal.opsi) AS o
         WHERE (o->>'id') = v_ans_str
         LIMIT 1;
        v_poin := GREATEST(0, COALESCE(v_poin, 0));
      ELSE
        v_poin := 0;
      END IF;

      v_skor_auto := v_skor_auto + v_poin;
      v_penilaian := v_penilaian || jsonb_build_object(
        v_soal.id::text, jsonb_build_object('poin', v_poin, 'maks', v_maks_opsi, 'benar', NULL)
      );

    ELSIF v_soal.tipe = 'multi' THEN
      IF jsonb_typeof(v_ans) = 'array' THEN
        SELECT COALESCE(array_agg(DISTINCT val), '{}'::text[])
          INTO v_ans_arr
          FROM (
            SELECT btrim(x #>> '{}') AS val
            FROM jsonb_array_elements(v_ans) AS x
            WHERE jsonb_typeof(x) IN ('string', 'number')
              AND btrim(x #>> '{}') <> ''
          ) q;
      ELSE
        v_ans_arr := '{}'::text[];
      END IF;
      v_clean_jwb := v_clean_jwb || jsonb_build_object(v_soal.id::text, to_jsonb(v_ans_arr));

      IF jsonb_typeof(v_soal.kunci->'ids') = 'array' THEN
        SELECT COALESCE(array_agg(DISTINCT val), '{}'::text[])
          INTO v_key_arr
          FROM (
            SELECT btrim(x #>> '{}') AS val
            FROM jsonb_array_elements(v_soal.kunci->'ids') AS x
            WHERE btrim(x #>> '{}') <> ''
          ) q;
      ELSE
        v_key_arr := '{}'::text[];
      END IF;

      v_tot_key := COALESCE(array_length(v_key_arr, 1), 0);
      v_parsial := COALESCE((v_soal.kunci->>'parsial')::boolean, true);
      v_skor_maks := v_skor_maks + v_soal.poin;

      IF v_tot_key > 0 THEN
        SELECT count(*) INTO v_hit FROM unnest(v_ans_arr) a WHERE a = ANY(v_key_arr);
        SELECT count(*) INTO v_wrong FROM unnest(v_ans_arr) a WHERE NOT (a = ANY(v_key_arr));
        IF v_hit = v_tot_key AND v_wrong = 0 THEN
          v_ok := true;
          v_poin := v_soal.poin;
        ELSIF v_parsial AND v_hit > 0 AND v_wrong = 0 THEN
          v_ok := false;
          v_poin := ROUND((v_soal.poin * v_hit::numeric) / v_tot_key::numeric, 2);
        ELSE
          v_ok := false;
          v_poin := 0;
        END IF;
      END IF;

      v_skor_auto := v_skor_auto + v_poin;
      v_penilaian := v_penilaian || jsonb_build_object(
        v_soal.id::text, jsonb_build_object('poin', v_poin, 'maks', v_soal.poin, 'benar', v_ok)
      );

    ELSIF v_soal.tipe = 'bs' THEN
      IF jsonb_typeof(v_ans) = 'boolean' THEN
        v_ans_str := CASE WHEN (v_ans)::text = 'true' THEN 'benar' ELSE 'salah' END;
      ELSIF jsonb_typeof(v_ans) IN ('string', 'number') THEN
        v_ans_str := lower(btrim(v_ans #>> '{}'));
      ELSE
        v_ans_str := '';
      END IF;
      v_clean_jwb := v_clean_jwb || jsonb_build_object(v_soal.id::text, to_jsonb(v_ans_str));

      v_key_str := lower(btrim(COALESCE(v_soal.kunci->>'nilai', '')));
      v_skor_maks := v_skor_maks + v_soal.poin;
      IF v_key_str IN ('benar', 'salah') THEN
        v_ok := (v_ans_str = v_key_str);
        v_poin := CASE WHEN v_ok THEN v_soal.poin ELSE 0 END;
      END IF;

      v_skor_auto := v_skor_auto + v_poin;
      v_penilaian := v_penilaian || jsonb_build_object(
        v_soal.id::text, jsonb_build_object('poin', v_poin, 'maks', v_soal.poin, 'benar', v_ok)
      );

    ELSIF v_soal.tipe = 'isian' THEN
      IF jsonb_typeof(v_ans) IN ('string', 'number') THEN
        v_ans_str := left(btrim(v_ans #>> '{}'), 500);
      ELSE
        v_ans_str := '';
      END IF;
      v_clean_jwb := v_clean_jwb || jsonb_build_object(v_soal.id::text, to_jsonb(v_ans_str));

      IF jsonb_typeof(v_soal.kunci->'terima') = 'array' THEN
        SELECT COALESCE(array_agg(lower(btrim(x #>> '{}'))), '{}'::text[])
          INTO v_terima_arr
          FROM jsonb_array_elements(v_soal.kunci->'terima') AS x
          WHERE btrim(x #>> '{}') <> '';
      ELSE
        v_terima_arr := '{}'::text[];
      END IF;

      v_skor_maks := v_skor_maks + v_soal.poin;
      IF COALESCE(array_length(v_terima_arr, 1), 0) > 0 THEN
        v_ok := (v_ans_str <> '' AND lower(v_ans_str) = ANY(v_terima_arr));
        v_poin := CASE WHEN v_ok THEN v_soal.poin ELSE 0 END;
      END IF;

      v_skor_auto := v_skor_auto + v_poin;
      v_penilaian := v_penilaian || jsonb_build_object(
        v_soal.id::text, jsonb_build_object('poin', v_poin, 'maks', v_soal.poin, 'benar', v_ok)
      );

    ELSIF v_soal.tipe = 'skala' THEN
      IF jsonb_typeof(v_ans) IN ('string', 'number') THEN
        v_ans_str := btrim(v_ans #>> '{}');
      ELSE
        v_ans_str := '';
      END IF;
      v_clean_jwb := v_clean_jwb || jsonb_build_object(v_soal.id::text, to_jsonb(v_ans_str));

      v_key_str := btrim(COALESCE(v_soal.kunci->>'nilai', ''));
      IF v_key_str <> '' AND v_soal.poin > 0 THEN
        v_skor_maks := v_skor_maks + v_soal.poin;
        v_ok := (v_ans_str = v_key_str);
        v_poin := CASE WHEN v_ok THEN v_soal.poin ELSE 0 END;
        v_skor_auto := v_skor_auto + v_poin;
        v_penilaian := v_penilaian || jsonb_build_object(
          v_soal.id::text, jsonb_build_object('poin', v_poin, 'maks', v_soal.poin, 'benar', v_ok)
        );
      ELSE
        v_penilaian := v_penilaian || jsonb_build_object(
          v_soal.id::text, jsonb_build_object('poin', 0, 'maks', 0, 'benar', NULL)
        );
      END IF;

    ELSE
      -- essay: koreksi manual
      IF jsonb_typeof(v_ans) IN ('string', 'number') THEN
        v_ans_str := left(v_ans #>> '{}', 8000);
      ELSE
        v_ans_str := '';
      END IF;
      v_clean_jwb := v_clean_jwb || jsonb_build_object(v_soal.id::text, to_jsonb(v_ans_str));
      v_skor_maks := v_skor_maks + v_soal.poin;
      v_has_manual := true;
      v_penilaian := v_penilaian || jsonb_build_object(
        v_soal.id::text, jsonb_build_object('poin', 0, 'maks', v_soal.poin, 'benar', NULL, 'manual', true)
      );
    END IF;
  END LOOP;

  v_status_hasil := CASE WHEN v_has_manual THEN 'menunggu_koreksi' ELSE 'selesai' END;
  v_mulai_at := CASE WHEN p_mulai_at IS NULL THEN NULL ELSE LEAST(p_mulai_at, now()) END;

  INSERT INTO public.osis_tes_hasil (
    tes_id, angkatan_id, user_id, jawaban, penilaian,
    skor_otomatis, skor_manual, skor_total, skor_maks,
    status, catatan_koreksi, dikoreksi_oleh, percobaan_ke,
    mulai_at, selesai_at, updated_at
  ) VALUES (
    p_tes_id, v_tes.angkatan_id, p_user_id, v_clean_jwb, v_penilaian,
    v_skor_auto, 0, v_skor_auto, v_skor_maks,
    v_status_hasil, '', NULL, 1,
    v_mulai_at, now(), now()
  )
  ON CONFLICT (tes_id, user_id) DO UPDATE SET
    jawaban         = EXCLUDED.jawaban,
    penilaian       = EXCLUDED.penilaian,
    skor_otomatis   = EXCLUDED.skor_otomatis,
    skor_manual     = 0,
    skor_total      = EXCLUDED.skor_total,
    skor_maks       = EXCLUDED.skor_maks,
    status          = EXCLUDED.status,
    catatan_koreksi = '',
    dikoreksi_oleh  = NULL,
    percobaan_ke    = public.osis_tes_hasil.percobaan_ke + 1,
    mulai_at        = EXCLUDED.mulai_at,
    selesai_at      = now(),
    updated_at      = now()
  RETURNING id INTO v_hasil_id;

  RETURN jsonb_build_object(
    'ok', true,
    'hasil_id', v_hasil_id,
    'status', v_status_hasil,
    'tampil_nilai', v_tampil_nilai,
    'skor_total', CASE WHEN v_kelola OR v_tampil_nilai THEN v_skor_auto ELSE NULL END,
    'skor_maks', v_skor_maks
  );
END;
$function$;

COMMIT;
