# 決定表

仕様は観点ごとの決定表として `tables/*.jsonl` に持つ。書式は [docs/仕様書.md](../docs/仕様書.md) の §13 を参照。

```bash
npm run build   # tables/*.jsonl -> dist/index.html
```

`dist/index.html` をブラウザで開くと全ての決定表が並ぶ。各表の上の数値入力欄に列番号を入れると、その列に関係する行だけが残る。生成物はコミットしない。
