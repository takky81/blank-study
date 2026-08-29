-- Data API から触れる範囲を明示する。
--
-- 本番プロジェクトは「新しいテーブルを自動で公開する」を切ってあるため、
-- テーブルを作っただけでは anon / authenticated / service_role に権限が付かない。
-- ここで与える権限をそろえておけば、自動公開の設定に関わらず同じように動く。
--
-- 行の見え方は RLS が決める（owner_id = auth.uid()）。ここで与えるのは
-- 「テーブルに触れてよいか」だけで、RLS の代わりにはならない。

grant usage on schema public to anon, authenticated, service_role;

-- ログインした利用者。実際に読み書きできる行は RLS のポリシーが絞る
grant select, insert, update, delete on
  public.subjects,
  public.materials,
  public.chapters,
  public.keywords,
  public.keyword_stats,
  public.answer_logs
to authenticated;

-- テストの前準備と後片付けで使う。RLS を迂回する
grant all on
  public.subjects,
  public.materials,
  public.chapters,
  public.keywords,
  public.keyword_stats,
  public.answer_logs
to service_role;

-- 未ログインからは何も見えない（ポリシーも authenticated 限定だが、権限の側でも閉じる）
revoke all on
  public.subjects,
  public.materials,
  public.chapters,
  public.keywords,
  public.keyword_stats,
  public.answer_logs
from anon;

-- 取り込みの RPC。関数は既定で PUBLIC に実行権が付くため、明示して閉じる
revoke all on function public.import_material(uuid, uuid, text, uuid, jsonb, jsonb) from public;
grant execute on function public.import_material(uuid, uuid, text, uuid, jsonb, jsonb)
  to authenticated, service_role;
