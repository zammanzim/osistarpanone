-- =========================================================================
-- HASIL WAWANCARA v2 — format pesan pembina
-- - hasil_kakasuh: JSON array nama kakak asuh di wawancara_calon (khusus LANJUT).
--   Contoh: ["Rizky Pratama","Dimas"]
-- - Wajib jalankan SETELAH: db/migrasi-hasil-wawancara.sql
-- - RPC simpan: tambah param p_kakasuh.
-- - RPC publik: kirim nama kakak asuh (return type berubah -> drop dulu).
-- - Template pesan LANJUT/GAGAL bisa diedit, disimpan di site_content:
--     kunci hasil_wawancara_tpl_lanjut / hasil_wawancara_tpl_gagal
--   Placeholder: {tanggal} (tgl wawancara calon), {kakasuh} (link WA kakak).
-- - Template default = teks pembina (sekali-insert, tidak menimpa yang ada).
-- Non-destruktif, aman dijalankan berulang.
-- =========================================================================

alter table public.wawancara_calon
  add column if not exists hasil_kakasuh text not null default '';

-- ---- Simpan/ubah hasil + kakak asuh (hanya hak "wawancara") ----
-- Tanda tangan lama (5 param) dibuang biar tidak ada overload dobel.
drop function if exists public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean);

create or replace function public.wawancara_hasil_simpan(
  p_user_id bigint,
  p_calon_id bigint,
  p_hasil text,
  p_catatan text default '',
  p_diumumkan boolean default false,
  p_kakasuh text default ''
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hasil text;
  v_kakasuh text;
begin
  if not public.osis_bisa(p_user_id, 'wawancara') then
    return 'ERR_NO_AUTH';
  end if;

  v_hasil := btrim(coalesce(p_hasil, ''));
  if v_hasil not in ('', 'lolos', 'tidak_lolos') then
    return 'ERR_HASIL';
  end if;

  v_kakasuh := left(btrim(coalesce(p_kakasuh, '')), 500);
  if v_hasil = '' then
    v_kakasuh := '';
  end if;

  update public.wawancara_calon set
    hasil = v_hasil,
    hasil_catatan = left(btrim(coalesce(p_catatan, '')), 1000),
    hasil_diumumkan = case when v_hasil = '' then false
                           else coalesce(p_diumumkan, false) end,
    hasil_kakasuh = v_kakasuh,
    hasil_updated_at = now(),
    hasil_updated_by = p_user_id,
    updated_at = now()
  where id = p_calon_id;

  if not found then
    return 'ERR_NOT_FOUND';
  end if;
  return 'OK';
end;
$$;

revoke all on function public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean, text) from public;
revoke all on function public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean, text) from anon;
grant execute on function public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean, text) to authenticated;

-- ---- Baca publik + nama kakak asuh (return type berubah) ----
drop function if exists public.wawancara_hasil_publik();

create or replace function public.wawancara_hasil_publik()
returns table (
  nama text,
  kelas text,
  tanggal date,
  hasil text,
  hasil_kakasuh text,
  hasil_updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.nama, c.kelas, c.tanggal, c.hasil, c.hasil_kakasuh, c.hasil_updated_at
  from public.wawancara_calon c
  where c.hasil_diumumkan = true
    and c.hasil in ('lolos', 'tidak_lolos')
  order by c.display_order asc, c.nama asc;
$$;

revoke all on function public.wawancara_hasil_publik() from public;
grant execute on function public.wawancara_hasil_publik() to anon, authenticated;

-- ---- Template pesan hasil (edit dibatasi hak "wawancara") ----
create or replace function public.wawancara_template_simpan(
  p_user_id bigint,
  p_tpl_lanjut text,
  p_tpl_gagal text
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.osis_bisa(p_user_id, 'wawancara') then
    return 'ERR_NO_AUTH';
  end if;

  insert into public.site_content (kunci, nilai, updated_at, updated_by)
  values
    ('hasil_wawancara_tpl_lanjut', left(coalesce(p_tpl_lanjut, ''), 4000), now(), p_user_id),
    ('hasil_wawancara_tpl_gagal', left(coalesce(p_tpl_gagal, ''), 4000), now(), p_user_id)
  on conflict (kunci) do update set
    nilai = excluded.nilai,
    updated_at = now(),
    updated_by = excluded.updated_by;
  return 'OK';
end;
$$;

revoke all on function public.wawancara_template_simpan(bigint, text, text) from public;
revoke all on function public.wawancara_template_simpan(bigint, text, text) from anon;
grant execute on function public.wawancara_template_simpan(bigint, text, text) to authenticated;

-- ---- Template default (teks pembina), sekali-insert saja ----
insert into public.site_content (kunci, nilai, updated_at)
values ('hasil_wawancara_tpl_lanjut',
E'Terimakasih atas partisipasi yang anda yang telah melaksanakan tes wawancara kesiapan yang dilaksanakan pada {tanggal}.
Dan hasil anda di nyatakan
LANJUT

Semoga hasil yang di dapat hari ini, bisa memicu motivasi kedepannya, dan tetap konsisten pada pendirian. Setelah ini silahkan hubungi kakak asuh terbaru kamu yaitu {kakasuh}.', now())
on conflict (kunci) do nothing;

insert into public.site_content (kunci, nilai, updated_at)
values ('hasil_wawancara_tpl_gagal',
E'Terimakasih atas partisipasi yang anda yang telah melaksanakan tes wawancara kesiapan yang dilaksanakan pada {tanggal}.
Dan hasil anda di nyatakan
GAGAL

mohon maaf, anda tidak bisa melanjutkan di keorganisasian ini

Semoga anda bisa lebih maju, dan termotivasi lagi di cabang extrakurikuler yang lain.', now())
on conflict (kunci) do nothing;
