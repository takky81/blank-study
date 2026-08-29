# -*- coding: utf-8 -*-
"""モバイル版アートボードを書き出す。中身は本ファイルが唯一の原本。"""
import io

HEAD = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'BIZ UDPGothic', 'Hiragino Sans', 'Yu Gothic UI', 'Yu Gothic', Meiryo, sans-serif; background: #f5f8fc; color: #132a45; }
    a { color: #14559c; } a:hover { color: #0d3d75; }
    .top { height: 52px; border-bottom: 2px solid #132a45; display: flex; align-items: center; padding: 0 14px; gap: 10px; background: #fff; flex-shrink: 0; }
    .ttl { font-size: 16px; flex-grow: 1; }
    .ico { font-size: 19px; color: #42566e; width: 24px; text-align: center; flex-shrink: 0; }
    .body { flex-grow: 1; padding: 14px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .card { border: 2px solid #132a45; border-radius: 6px; background: #fff; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
    .btn { border: 2px solid #132a45; border-radius: 5px; min-height: 46px; display: flex; align-items: center; justify-content: center; padding: 0 16px; font-size: 15px; background: #fff; }
    .btn-p { border: 2px solid #132a45; border-radius: 5px; min-height: 46px; display: flex; align-items: center; justify-content: center; padding: 0 16px; font-size: 15px; background: #132a45; color: #f5f8fc; }
    .btn-s { border: 1.5px solid #7a8da5; border-radius: 5px; min-height: 44px; display: flex; align-items: center; justify-content: center; padding: 0 12px; font-size: 13px; color: #42566e; background: #fff; }
    .fld { border: 2px solid #132a45; border-radius: 5px; min-height: 46px; display: flex; align-items: center; padding: 0 12px; font-size: 15px; background: #fff; }
    .lbl { font-size: 12px; color: #42566e; }
    .muted { color: #566779; font-size: 12px; }
    .nav { height: 60px; border-top: 2px solid #132a45; display: flex; background: #fff; flex-shrink: 0; }
    .nav-i { flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 11px; color: #566779; }
    .sec-hd { padding: 9px 14px; border-bottom: 1.5px solid #c2cfdf; font-size: 12px; color: #42566e; background: #e8eef7; }
    .cb { width: 20px; height: 20px; border: 2px solid #132a45; border-radius: 3px; flex-shrink: 0; }
    .cb-on { width: 20px; height: 20px; border: 2px solid #132a45; border-radius: 3px; background: #132a45; flex-shrink: 0; }
    .rd { width: 19px; height: 19px; border: 2px solid #132a45; border-radius: 50%; flex-shrink: 0; }
    .rd-on { width: 19px; height: 19px; border: 5.5px solid #132a45; border-radius: 50%; background: #fff; flex-shrink: 0; }
    .opt { display: flex; align-items: center; gap: 11px; font-size: 15px; min-height: 46px; }
    .kw-blank { background: #bfdbfe; border: 2px solid #3f76b8; border-radius: 4px; display: inline-block; vertical-align: middle; height: 32px; line-height: 28px; min-width: 84px; padding: 0 9px; }
    .kw-wrong { background: #f3c4b6; border: 2px solid #b42318; border-radius: 4px; display: inline-block; vertical-align: middle; height: 32px; line-height: 28px; padding: 0 9px; }
    .kw-mask { background: #ccd6e3; border: 2px solid #7a8da5; border-radius: 4px; display: inline-block; vertical-align: middle; height: 32px; line-height: 28px; padding: 0 9px; }
    .lg { display: flex; align-items: center; gap: 6px; }
    .lg-c { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  </style>
</helmet>

<div style="width: 390px; height: 844px; display: flex; flex-direction: column; background: #f5f8fc;">
"""

FOOT = """</div>
</x-dc>
</body>
</html>
"""

NAV = """  <div class="nav">
    <div class="nav-i" style="color: #132a45;"><div style="font-size: 17px;">▤</div><div>学習</div></div>
    <div class="nav-i"><div style="font-size: 17px;">▧</div><div>履歴</div></div>
  </div>
"""

NAV_HIST = """  <div class="nav">
    <div class="nav-i"><div style="font-size: 17px;">▤</div><div>学習</div></div>
    <div class="nav-i" style="color: #132a45;"><div style="font-size: 17px;">▧</div><div>履歴</div></div>
  </div>
"""

FILES = {}

FILES["LoginM"] = """
  <div class="body" style="justify-content: center; gap: 20px; padding: 24px;">
    <div style="display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px;">
      <div style="font-size: 24px;">穴埋め学習</div>
      <div class="lbl">ログインしてください</div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 7px;">
      <div class="lbl">メールアドレス</div>
      <div class="fld" style="color: #566779;">you@example.com</div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 7px;">
      <div class="lbl">パスワード</div>
      <div class="fld" style="color: #566779;">••••••••</div>
    </div>
    <div class="btn-p" style="margin-top: 4px;">ログイン</div>
    <div style="font-size: 13px; color: #b42318; min-height: 18px;">メールアドレスまたはパスワードが違います</div>
    <div style="flex-grow: 1;"></div>
    <div class="muted" style="text-align: center;">サインアップ導線なし</div>
  </div>
"""

FILES["SubjectsM"] = """
  <div class="top">
    <div class="ttl">科目</div>
    <div class="ico">＋</div>
    <div class="ico">⋯</div>
  </div>
  <div class="body">
    <div class="card">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 17px; flex-grow: 1;">基本情報技術者</div>
        <div class="ico">›</div>
      </div>
      <div class="muted">教材 3 ・ キーワード 412 ・ 今日 23 問</div>
    </div>
    <div class="card">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 17px; flex-grow: 1;">生物基礎</div>
        <div class="ico">›</div>
      </div>
      <div class="muted">教材 2 ・ キーワード 186 ・ 今日 11 問</div>
    </div>
    <div class="card">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 17px; flex-grow: 1;">世界史</div>
        <div class="ico">›</div>
      </div>
      <div class="muted">教材 1 ・ キーワード 94 ・ 今日 4 問</div>
    </div>
    <div style="flex-grow: 1;"></div>
    <div class="muted" style="text-align: center;">長押しで名前の変更・削除・並べ替え</div>
  </div>
""" + NAV

FILES["MaterialsM"] = """
  <div class="top">
    <div class="ico">‹</div>
    <div class="ttl">基本情報技術者</div>
    <div class="ico">＋</div>
    <div class="ico">⋯</div>
  </div>
  <div class="body">
    <div style="border: 2px solid #132a45; border-radius: 6px; background: #dde7f5; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="font-size: 17px;">まとめて解答する</div>
        <div style="font-size: 12px; color: #42566e;">3 教材すべて ・ 412 問 ・ 今日 23 問</div>
      </div>
      <div class="btn-p">科目全体で解答</div>
    </div>

    <div style="display: flex; align-items: center; gap: 10px; margin-top: 2px;">
      <div style="font-size: 13px; color: #42566e;">教材ごとに解答する</div>
      <div style="flex-grow: 1; height: 1.5px; background: #c2cfdf;"></div>
    </div>

    <div class="card">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 16px; flex-grow: 1;">テクノロジ系</div>
        <div class="ico">⋯</div>
      </div>
      <div class="muted">210 問 ・ 正答率 85% ・ 今日 9 問</div>
      <div style="display: flex; gap: 8px; margin-top: 6px;">
        <div class="btn-p" style="flex-grow: 1;">解答</div>
        <div class="btn-s" style="flex-grow: 1;">編集</div>
      </div>
    </div>

    <div class="card">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 16px; flex-grow: 1;">マネジメント系</div>
        <div class="ico">⋯</div>
      </div>
      <div class="muted">88 問 ・ 正答率 72% ・ 今日 6 問</div>
      <div style="display: flex; gap: 8px; margin-top: 6px;">
        <div class="btn-p" style="flex-grow: 1;">解答</div>
        <div class="btn-s" style="flex-grow: 1;">編集</div>
      </div>
    </div>

    <div style="flex-grow: 1;"></div>
    <div class="muted" style="text-align: center;">⋯ からエクスポート・削除 ／ ＋ からインポート</div>
  </div>
""" + NAV

FILES["EditorM"] = """
  <div class="top">
    <div class="ico">‹</div>
    <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;">
      <div style="font-size: 15px;">2進数</div>
      <div style="font-size: 11px; color: #b42318;">未保存の変更あり</div>
    </div>
    <div style="border: 2px solid #132a45; border-radius: 5px; height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; background: #132a45; color: #f5f8fc;">保存</div>
  </div>

  <div style="height: 44px; border-bottom: 1.5px solid #c2cfdf; display: flex; background: #e8eef7; flex-shrink: 0;">
    <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #566779;">章</div>
    <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #566779;">編集</div>
    <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; background: #fff; border-bottom: 3px solid #132a45;">プレビュー</div>
  </div>

  <div style="height: 44px; border-bottom: 1.5px solid #c2cfdf; display: flex; align-items: center; padding: 0 14px; gap: 10px; background: #fff; flex-shrink: 0;">
    <div class="muted" style="flex-grow: 1;">文字を選択してから押す</div>
    <div style="border: 1.5px solid #7a8da5; border-radius: 5px; height: 32px; display: flex; align-items: center; padding: 0 12px; font-size: 12px; color: #42566e;">キーワードを作成</div>
  </div>

  <div style="flex-grow: 1; padding: 16px 14px; background: #fff; font-size: 15px; line-height: 2.3; display: flex; flex-direction: column; gap: 12px; min-height: 0;">
    <div style="font-size: 19px; line-height: 1.4;">2進数</div>
    <div>
      コンピュータは <span class="kw-blank">&nbsp;</span> で数を扱う。1桁を <span class="kw-blank">&nbsp;</span> と呼び、8桁をまとめたものを <span class="kw-blank">&nbsp;</span> という。
    </div>
    <div>
      <span style="background: #cfe3f5; border-bottom: 2px solid #6b93bd; padding: 1px 3px;">各桁に重み</span> を掛けて合計する。
    </div>
    <div style="flex-grow: 1;"></div>
    <div class="muted">空欄をタップすると編集ダイアログが開く</div>
  </div>
"""

FILES["StudySetupM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div class="ttl">出題設定</div>
  </div>
  <div class="body" style="gap: 14px;">

    <div style="border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column; min-height: 0;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 10px;"><span style="flex-grow: 1;">出題範囲</span><span>すべて選択</span></div>
      <div style="padding: 6px 14px 10px; display: flex; flex-direction: column;">
        <div class="opt"><span style="color: #566779; width: 12px;">▾</span><span class="cb-on"></span><span style="flex-grow: 1;">基本情報技術者</span><span class="muted">412</span></div>
        <div class="opt" style="padding-left: 24px;"><span style="color: #566779; width: 12px;">▾</span><span class="cb-on"></span><span style="flex-grow: 1;">テクノロジ系</span><span class="muted">210</span></div>
        <div class="opt" style="padding-left: 60px;"><span class="cb-on"></span><span style="flex-grow: 1;">基礎理論</span><span class="muted">64</span></div>
        <div class="opt" style="padding-left: 60px;"><span class="cb"></span><span style="flex-grow: 1; color: #566779;">アルゴリズム</span><span class="muted">58</span></div>
        <div class="opt" style="padding-left: 24px;"><span style="color: #566779; width: 12px;">▸</span><span class="cb"></span><span style="flex-grow: 1; color: #566779;">マネジメント系</span><span class="muted">88</span></div>
      </div>
    </div>

    <div style="display: flex; gap: 12px;">
      <div style="flex-grow: 1; flex-basis: 0; border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column; min-width: 0;">
        <div class="sec-hd">出題順</div>
        <div style="padding: 4px 12px 8px;">
          <div class="opt" style="font-size: 14px;"><span class="rd-on"></span><span>自動</span></div>
          <div class="opt" style="font-size: 14px;"><span class="rd"></span><span>出現順</span></div>
        </div>
      </div>
      <div style="flex-grow: 1; flex-basis: 0; border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column; min-width: 0;">
        <div class="sec-hd">解答形式</div>
        <div style="padding: 4px 12px 8px;">
          <div class="opt" style="font-size: 14px;"><span class="rd-on"></span><span>自動</span></div>
          <div class="opt" style="font-size: 14px;"><span class="rd"></span><span>選択肢</span></div>
          <div class="opt" style="font-size: 14px;"><span class="rd"></span><span>記述</span></div>
        </div>
      </div>
    </div>

    <div style="flex-grow: 1;"></div>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; align-items: baseline; gap: 10px;">
        <div style="font-size: 15px;">対象 122 問</div>
        <div class="muted">今日の復習 17 ・ 未出題 34</div>
      </div>
      <div class="btn-p" style="min-height: 52px; font-size: 17px;">開始する</div>
    </div>

  </div>
"""

FILES["StudyM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 4px;">
      <div style="font-size: 12px;">基礎理論 ・ 2進数</div>
      <div style="width: 100%; height: 5px; border: 1px solid #132a45; border-radius: 4px; overflow: hidden; background: #fff;">
        <div style="width: 32%; height: 100%; background: #132a45;"></div>
      </div>
    </div>
    <div style="font-size: 12px; color: #42566e;">12/122</div>
  </div>

  <div class="body">
    <div style="border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">章「2進数」</span>
        <span style="border: 1.5px solid #7a8da5; border-radius: 4px; padding: 4px 9px; background: #fff;">範囲を広げる ▾</span>
      </div>
      <div style="padding: 16px; font-size: 16px; line-height: 2.4;">
        コンピュータは 2進数 で数を扱う。1桁を <span class="kw-blank">&nbsp;</span> と呼び、8桁をまとめたものを <span class="kw-mask">〈単位〉</span> という。
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 9px;">
      <div class="btn" style="justify-content: flex-start; gap: 12px;"><span style="width: 22px; height: 22px; border: 1.5px solid #7a8da5; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #42566e;">1</span><span>バイト</span></div>
      <div class="btn" style="justify-content: flex-start; gap: 12px;"><span style="width: 22px; height: 22px; border: 1.5px solid #7a8da5; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #42566e;">2</span><span>ビット</span></div>
      <div class="btn" style="justify-content: flex-start; gap: 12px;"><span style="width: 22px; height: 22px; border: 1.5px solid #7a8da5; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #42566e;">3</span><span>ワード</span></div>
      <div class="btn" style="justify-content: flex-start; gap: 12px;"><span style="width: 22px; height: 22px; border: 1.5px solid #7a8da5; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #42566e;">4</span><span>ヘルツ</span></div>
    </div>

    <div style="flex-grow: 1;"></div>

    <div style="display: flex; align-items: center; gap: 14px;">
      <div class="lg"><span class="lg-c" style="background: #bfdbfe; border: 1.5px solid #3f76b8;"></span><span class="muted">今回の問題</span></div>
      <div class="lg"><span class="lg-c" style="background: #ccd6e3; border: 1.5px solid #7a8da5;"></span><span class="muted">伏せた語</span></div>
    </div>

    <div class="btn-p" style="min-height: 52px; font-size: 17px;">解答する</div>
  </div>
"""

FILES["StudyResultM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 4px;">
      <div style="font-size: 12px;">基礎理論 ・ 2進数</div>
      <div style="width: 100%; height: 5px; border: 1px solid #132a45; border-radius: 4px; overflow: hidden; background: #fff;">
        <div style="width: 36%; height: 100%; background: #132a45;"></div>
      </div>
    </div>
    <div style="font-size: 12px; color: #42566e;">13/122</div>
  </div>

  <div class="body" style="gap: 10px;">

    <div style="border: 2px solid #b42318; border-radius: 6px; background: #fef3f2; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 26px; height: 26px; border: 2px solid #b42318; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #b42318; font-size: 15px; flex-shrink: 0;">×</div>
        <div style="font-size: 16px; color: #b42318; flex-grow: 1;">不正解</div>
        <div class="muted">記述形式</div>
      </div>
      <div style="display: flex; gap: 10px;">
        <div style="flex-grow: 1; flex-basis: 0; display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <span class="muted">あなたの解答</span><span style="font-size: 15px; color: #b42318;">バイト</span>
        </div>
        <div style="flex-grow: 1; flex-basis: 0; display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <span class="muted">正答</span><span style="font-size: 15px;">ビット</span>
        </div>
      </div>
    </div>

    <div style="border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column; flex-grow: 1; min-height: 0;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">章「2進数」</span>
        <span style="border: 1.5px solid #7a8da5; border-radius: 4px; padding: 4px 9px; background: #fff;">範囲を広げる ▾</span>
      </div>
      <div style="padding: 14px; font-size: 15px; line-height: 2.5; display: flex; flex-direction: column; gap: 10px;">
        <div>コンピュータは 2進数 で数を扱う。1桁を <span class="kw-blank" style="min-width: 0;">ビット</span> と呼び、8桁をまとめたものを <span class="kw-wrong">バイト</span> という。</div>
        <div>速さには <span class="kw-mask">ヘルツ</span>、容量には <span class="kw-wrong">バイト</span> を用いる。</div>
      </div>
      <div style="flex-grow: 1;"></div>
      <div style="padding: 10px 14px; border-top: 1.5px solid #c2cfdf; display: flex; flex-direction: column; gap: 6px;">
        <div class="lg"><span class="lg-c" style="background: #bfdbfe; border: 1.5px solid #3f76b8;"></span><span class="muted">出題された空欄</span></div>
        <div class="lg"><span class="lg-c" style="background: #f3c4b6; border: 1.5px solid #b42318;"></span><span class="muted">答えた「バイト」が入る位置</span></div>
        <div class="lg"><span class="lg-c" style="background: #ccd6e3; border: 1.5px solid #7a8da5;"></span><span class="muted">解答中は伏せていた語</span></div>
      </div>
    </div>

    <div class="btn" style="min-height: 44px; font-size: 14px;">「バイト」を別解として登録する</div>
    <div class="btn-p" style="min-height: 52px; font-size: 17px;">次の問題へ</div>

  </div>
"""

FILES["HistoryM"] = """
  <div class="top">
    <div class="ttl">学習履歴</div>
    <div class="ico">⋯</div>
  </div>
  <div class="body" style="gap: 12px;">

    <div style="display: flex; gap: 10px;">
      <div class="card" style="flex-grow: 1; flex-basis: 0; gap: 2px; padding: 12px 14px; min-width: 0;">
        <div class="muted">今日の復習</div><div style="font-size: 22px;">23 問</div>
      </div>
      <div class="card" style="flex-grow: 1; flex-basis: 0; gap: 2px; padding: 12px 14px; min-width: 0;">
        <div class="muted">今週の復習</div><div style="font-size: 22px;">88 問</div>
      </div>
    </div>

    <div style="border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column;">
      <div class="sec-hd">科目 ・ 教材 ・ 章</div>
      <div style="padding: 6px 0;">
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px;">
          <span style="color: #566779; width: 12px;">▾</span>
          <span style="flex-grow: 1; font-size: 14px;">基本情報技術者</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #132a45; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 46%; background: #132a45;"></span><span style="width: 22%; background: #f3c4b6;"></span><span style="width: 32%; background: #dde4ed;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">78%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px 8px 36px;">
          <span style="color: #566779; width: 12px;">▾</span>
          <span style="flex-grow: 1; font-size: 14px;">テクノロジ系</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #132a45; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 62%; background: #132a45;"></span><span style="width: 14%; background: #f3c4b6;"></span><span style="width: 24%; background: #dde4ed;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">85%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px 8px 60px;">
          <span style="flex-grow: 1; font-size: 14px;">基礎理論</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #132a45; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 78%; background: #132a45;"></span><span style="width: 8%; background: #f3c4b6;"></span><span style="width: 14%; background: #dde4ed;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">91%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px 8px 60px;">
          <span style="flex-grow: 1; font-size: 14px;">アルゴリズム</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #132a45; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 24%; background: #132a45;"></span><span style="width: 44%; background: #f3c4b6;"></span><span style="width: 32%; background: #dde4ed;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">52%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px;">
          <span style="color: #566779; width: 12px;">▸</span>
          <span style="flex-grow: 1; font-size: 14px;">生物基礎</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #132a45; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 30%; background: #132a45;"></span><span style="width: 18%; background: #f3c4b6;"></span><span style="width: 52%; background: #dde4ed;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">64%</span>
        </div>
      </div>
      <div style="padding: 9px 14px; border-top: 1.5px solid #c2cfdf; display: flex; gap: 12px;">
        <div class="lg"><span class="lg-c" style="background: #132a45;"></span><span class="muted">定着</span></div>
        <div class="lg"><span class="lg-c" style="background: #f3c4b6; border: 1.5px solid #b42318;"></span><span class="muted">苦手</span></div>
        <div class="lg"><span class="lg-c" style="background: #dde4ed; border: 1.5px solid #7a8da5;"></span><span class="muted">未出題</span></div>
      </div>
    </div>

    <div style="border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column; flex-grow: 1; min-height: 0;">
      <div class="sec-hd">苦手キーワード</div>
      <div style="padding: 4px 0;">
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 14px;"><span style="flex-grow: 1; font-size: 14px;">スタック</span><span class="muted">31%</span></div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 14px;"><span style="flex-grow: 1; font-size: 14px;">二分探索木</span><span class="muted">38%</span></div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 14px;"><span style="flex-grow: 1; font-size: 14px;">スループット</span><span class="muted">44%</span></div>
      </div>
      <div style="flex-grow: 1;"></div>
      <div style="padding: 9px 14px; border-top: 1.5px solid #c2cfdf;" class="muted">日別の学習量は ⋯ から</div>
    </div>

  </div>
""" + NAV_HIST

FILES["KeywordDialogM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div class="ttl">キーワードを編集</div>
    <div style="border: 2px solid #132a45; border-radius: 5px; height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; background: #132a45; color: #f5f8fc;">確定</div>
  </div>
  <div class="body" style="gap: 18px;">

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: baseline; gap: 8px;">
        <div class="lbl" style="flex-grow: 1;">正答</div>
        <div class="muted">id = k71m2p</div>
      </div>
      <div style="display: flex; gap: 8px;"><div class="fld" style="flex-grow: 1;">ビット</div><div style="width: 46px; border: 1.5px solid #7a8da5; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: #42566e; background: #fff; flex-shrink: 0;">×</div></div>
      <div style="display: flex; gap: 8px;"><div class="fld" style="flex-grow: 1;">bit</div><div style="width: 46px; border: 1.5px solid #7a8da5; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: #42566e; background: #fff; flex-shrink: 0;">×</div></div>
      <div style="border: 2px dashed #7a8da5; border-radius: 5px; min-height: 44px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #566779;">＋ 正答を追加</div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div class="lbl">タグ</div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        <div style="border: 1.5px solid #132a45; border-radius: 16px; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; font-size: 14px; background: #fff;"><span>単位</span><span style="color: #566779;">×</span></div>
        <div style="border: 1.5px solid #132a45; border-radius: 16px; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; font-size: 14px; background: #fff;"><span>基礎理論</span><span style="color: #566779;">×</span></div>
        <div style="border: 1.5px dashed #7a8da5; border-radius: 16px; height: 34px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; color: #7a8da5;">＋ タグ</div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div class="lbl">誤答選択肢</div>
      <div style="display: flex; gap: 8px;">
        <div class="fld" style="flex-grow: 1; flex-basis: 0; min-width: 0;">バイト</div>
        <div class="fld" style="flex-grow: 1; flex-basis: 0; min-width: 0;">ワード</div>
        <div class="fld" style="width: 56px; justify-content: center; color: #7a8da5; flex-shrink: 0;">＋</div>
      </div>
      <div class="muted">空のままなら同じタグから自動で選ばれる</div>
    </div>

    <div style="flex-grow: 1;"></div>
    <div class="btn" style="border-color: #b42318; color: #b42318;">キーワードを解除</div>

  </div>
"""

FILES["ConflictDialogM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div class="ttl">差分の確認</div>
    <div style="border: 2px solid #132a45; border-radius: 5px; height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; background: #132a45; color: #f5f8fc;">適用</div>
  </div>
  <div class="body" style="gap: 12px;">

    <div class="muted" style="line-height: 1.7;">正答が一致しないキーワードが 2 件あります。<br>正答が1つ以上一致した 38 件は上書き済みです。</div>

    <div style="border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">id = a3f9k2 ・ 2進数</span>
        <span style="color: #b42318;">履歴 42 件</span>
      </div>
      <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
        <div style="border: 1.5px solid #c2cfdf; border-radius: 5px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 11px; color: #566779;">登録済み</div>
          <div style="font-size: 14px;">2進数 ・ バイナリ</div>
        </div>
        <div style="border: 1.5px solid #132a45; border-radius: 5px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 11px; color: #566779;">取り込む内容</div>
          <div style="font-size: 14px;">基数 ・ 底</div>
        </div>
        <div style="display: flex; flex-direction: column;">
          <div class="opt" style="font-size: 14px;"><span class="rd-on"></span><span>取り込む内容で上書き</span></div>
          <div class="opt" style="font-size: 14px; color: #42566e;"><span class="rd"></span><span>登録済みを残す</span></div>
        </div>
      </div>
    </div>

    <div style="border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">id = q4x8dz ・ 2進数</span>
        <span>履歴 0 件</span>
      </div>
      <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
        <div style="border: 1.5px solid #c2cfdf; border-radius: 5px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 11px; color: #566779;">登録済み</div>
          <div style="font-size: 14px;">バイト</div>
        </div>
        <div style="border: 1.5px solid #132a45; border-radius: 5px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 11px; color: #566779;">取り込む内容</div>
          <div style="font-size: 14px;">オクテット</div>
        </div>
      </div>
    </div>

    <div style="flex-grow: 1;"></div>
  </div>
"""

FILES["ImportDialogM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div class="ttl">インポート</div>
    <div style="border: 2px solid #132a45; border-radius: 5px; height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; background: #132a45; color: #f5f8fc;">取り込む</div>
  </div>
  <div class="body" style="gap: 14px;">

    <div class="card" style="gap: 3px; padding: 12px 14px;">
      <div class="muted">選択したファイル</div>
      <div style="font-size: 15px;">テクノロジ系.zip</div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div class="lbl">取り込む単位</div>
      <div style="display: flex; flex-direction: column;">
        <div class="opt"><span class="rd-on"></span><span>教材まるごと</span></div>
        <div class="opt"><span class="rd"></span><span>一部の章だけ</span></div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div class="lbl">取り込み先の科目</div>
      <div class="fld"><span style="flex-grow: 1;">基本情報技術者</span><span style="color: #566779;">▾</span></div>
    </div>

    <div style="border: 2px solid #132a45; border-radius: 6px; background: #fff; display: flex; flex-direction: column; flex-grow: 1; min-height: 0;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">zip の中身</span><span>12 章 ・ 210 キーワード</span>
      </div>
      <div style="padding: 6px 14px;">
        <div style="display: flex; align-items: center; gap: 9px; padding: 7px 0; font-size: 14px;"><span class="cb-on"></span><span style="color: #566779;">▾</span><span style="flex-grow: 1;">010_基礎理論</span><span class="muted">64</span></div>
        <div style="display: flex; align-items: center; gap: 9px; padding: 7px 0 7px 30px; font-size: 14px;"><span class="cb-on"></span><span style="flex-grow: 1;">010_2進数</span><span class="muted">22</span></div>
        <div style="display: flex; align-items: center; gap: 9px; padding: 7px 0 7px 30px; font-size: 14px;"><span class="cb-on"></span><span style="flex-grow: 1;">020_論理演算</span><span class="muted">18</span></div>
        <div style="display: flex; align-items: center; gap: 9px; padding: 7px 0; font-size: 14px;"><span class="cb-on"></span><span style="color: #566779;">▸</span><span style="flex-grow: 1;">020_アルゴリズム</span><span class="muted">58</span></div>
      </div>
      <div style="flex-grow: 1;"></div>
      <div style="padding: 9px 14px; border-top: 1.5px solid #c2cfdf;" class="muted">正答が一致しないものは次の画面で確認します</div>
    </div>

  </div>
"""

for name, body in FILES.items():
    io.open(name + ".dc.html", "w", encoding="utf-8", newline="\n").write(HEAD + body + FOOT)
    print("wrote", name + ".dc.html")
