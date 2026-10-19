-- =========================================================================
-- HASIL WAWANCARA CALON OSIS
-- - Hasil keputusan per calon: '' (belum) / 'lolos' / 'tidak_lolos'.
-- - Catatan hasil = catatan khusus keputusan (bukan catatan wawancara).
-- - hasil_diumumkan = penanda tampil di halaman publik.
-- - RPC simpan hasil butuh hak "wawancara".
-- - RPC publik hanya mengembalikan kolom aman (tanpa jawaban wawancara).
-- Non-destruktif: aman dijalankan berulang.
-- =========================================================================

alter table public.wawancara_calon
  add column if not exists hasil text not null default '',
  add column if not exists hasil_catatan text not null default '',
  add column if not exists hasil_diumumkan boolean not null default false,
  add column if not exists hasil_updated_at timestamptz,
  add column if not exists hasil_updated_by bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'wawancara_calon_hasil_cek'
      and conrelid = 'public.wawancara_calon'::regclass
  ) then
    alter table public.wawancara_calon
      add constraint wawancara_calon_hasil_cek
      check (hasil in ('', 'lolos', 'tidak_lolos'));
  end if;
end $$;

-- Simpan/ubah hasil. Hanya pemegang hak "wawancara" (atau super_admin).
create or replace function public.wawancara_hasil_simpan(
  p_user_id bigint,
  p_calon_id bigint,
  p_hasil text,
  p_catatan text default '',
  p_diumumkan boolean default false
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hasil text;
begin
  if not public.osis_bisa(p_user_id, 'wawancara') then
    return 'ERR_NO_AUTH';
  end if;

  v_hasil := btrim(coalesce(p_hasil, ''));
  if v_hasil not in ('', 'lolos', 'tidak_lolos') then
    return 'ERR_HASIL';
  end if;

  update public.wawancara_calon set
    hasil = v_hasil,
    hasil_catatan = left(btrim(coalesce(p_catatan, '')), 1000),
    hasil_diumumkan = case when v_hasil = '' then false
                           else coalesce(p_diumumkan, false) end,
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

revoke all on function public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean) from public;
revoke all on function public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean) from anon;
grant execute on function public.wawancara_hasil_simpan(bigint, bigint, text, text, boolean) to authenticated;

-- Baca hasil untuk halaman publik (tanpa login). Kolom aman saja.
create or replace function public.wawancara_hasil_publik()
returns table (
  nama text,
  kelas text,
  tanggal date,
  hasil text,
  hasil_catatan text,
  hasil_updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.nama, c.kelas, c.tanggal, c.hasil, c.hasil_catatan, c.hasil_updated_at
  from public.wawancara_calon c
  where c.hasil_diumumkan = true
    and c.hasil in ('lolos', 'tidak_lolos')
  order by c.display_order asc, c.nama asc;
$$;

revoke all on function public.wawancara_hasil_publik() from public;
grant execute on function public.wawancara_hasil_publik() to anon, authenticated;
