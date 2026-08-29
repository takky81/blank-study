-- 関数まわりの指摘（Supabase の Security Advisor）に対応する。
--
-- 1. search_path を固定する
--    search_path が可変だと、呼び出し側が別のスキーマを先に置くことで
--    関数の中の名前解決をすり替えられる。空にして、名前は全て schema 付きで
--    書いてあるものだけを見るようにする（どちらの関数も public. と auth. で
--    修飾済み。型と組み込み関数は pg_catalog から解決される）。
alter function public.set_updated_at() set search_path = '';
alter function public.import_material(uuid, uuid, text, uuid, jsonb, jsonb) set search_path = '';

-- 2. 自動 RLS の関数を呼べないようにする
--    プロジェクトの「Enable automatic RLS」が作る SECURITY DEFINER の関数で、
--    既定では誰でも呼べる。イベントトリガとしての動作には実行権は要らないので、
--    明示的に呼ぶ経路だけ閉じる。ローカルには無いため、あるときだけ実行する。
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
