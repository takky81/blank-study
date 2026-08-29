-- 取り込みの RPC を未ログインから閉じる。
--
-- 前のマイグレーションでは PUBLIC からしか実行権を外していなかった。
-- ローカルは anon にも既定で実行権が付くため、本番だけ拒否してローカルは
-- 関数の中の「ログインしていません」で弾く、という食い違いが残っていた。
-- 権限の側でそろえて、どちらの環境でも同じところで止まるようにする。

revoke execute on function public.import_material(uuid, uuid, text, uuid, jsonb, jsonb) from anon;
