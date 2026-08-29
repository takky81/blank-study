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
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kurenaido&display=swap">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Zen Kurenaido', 'Hiragino Maru Gothic ProN', 'Yu Gothic', sans-serif; background: #faf9f5; color: #26251f; }
    a { color: #8a6d1f; } a:hover { color: #5f4a12; }
    .top { height: 52px; border-bottom: 2px solid #26251f; display: flex; align-items: center; padding: 0 14px; gap: 10px; background: #fff; flex-shrink: 0; }
    .ttl { font-size: 16px; flex-grow: 1; }
    .ico { font-size: 19px; color: #6b6a62; width: 24px; text-align: center; flex-shrink: 0; }
    .body { flex-grow: 1; padding: 14px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .card { border: 2px solid #26251f; border-radius: 6px; background: #fff; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
    .btn { border: 2px solid #26251f; border-radius: 5px; min-height: 46px; display: flex; align-items: center; justify-content: center; padding: 0 16px; font-size: 15px; background: #fff; }
    .btn-p { border: 2px solid #26251f; border-radius: 5px; min-height: 46px; display: flex; align-items: center; justify-content: center; padding: 0 16px; font-size: 15px; background: #26251f; color: #faf9f5; }
    .btn-s { border: 1.5px solid #a8a69c; border-radius: 5px; min-height: 44px; display: flex; align-items: center; justify-content: center; padding: 0 12px; font-size: 13px; color: #6b6a62; background: #fff; }
    .fld { border: 2px solid #26251f; border-radius: 5px; min-height: 46px; display: flex; align-items: center; padding: 0 12px; font-size: 15px; background: #fff; }
    .lbl { font-size: 12px; color: #6b6a62; }
    .muted { color: #8a887d; font-size: 12px; }
    .nav { height: 60px; border-top: 2px solid #26251f; display: flex; background: #fff; flex-shrink: 0; }
    .nav-i { flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 11px; color: #8a887d; }
    .sec-hd { padding: 9px 14px; border-bottom: 1.5px solid #c9c7bd; font-size: 12px; color: #6b6a62; background: #f2f1ea; }
    .cb { width: 20px; height: 20px; border: 2px solid #26251f; border-radius: 3px; flex-shrink: 0; }
    .cb-on { width: 20px; height: 20px; border: 2px solid #26251f; border-radius: 3px; background: #26251f; flex-shrink: 0; }
    .rd { width: 19px; height: 19px; border: 2px solid #26251f; border-radius: 50%; flex-shrink: 0; }
    .rd-on { width: 19px; height: 19px; border: 5.5px solid #26251f; border-radius: 50%; background: #fff; flex-shrink: 0; }
    .opt { display: flex; align-items: center; gap: 11px; font-size: 15px; min-height: 46px; }
    .kw-blank { background: #fde68a; border: 2px solid #d9a441; border-radius: 4px; display: inline-block; vertical-align: middle; height: 32px; line-height: 28px; min-width: 84px; padding: 0 9px; }
    .kw-wrong { background: #f0b39a; border: 2px solid #c2410c; border-radius: 4px; display: inline-block; vertical-align: middle; height: 32px; line-height: 28px; padding: 0 9px; }
    .kw-mask { background: #d9d7cd; border: 2px solid #a8a69c; border-radius: 4px; display: inline-block; vertical-align: middle; height: 32px; line-height: 28px; padding: 0 9px; }
    .lg { display: flex; align-items: center; gap: 6px; }
    .lg-c { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  </style>
</helmet>

<div style="width: 390px; height: 844px; display: flex; flex-direction: column; background: #faf9f5;">
"""

FOOT = """</div>
</x-dc>
</body>
</html>
"""

NAV = """  <div class="nav">
    <div class="nav-i" style="color: #26251f;"><div style="font-size: 17px;">▤</div><div>学習</div></div>
    <div class="nav-i"><div style="font-size: 17px;">▧</div><div>履歴</div></div>
  </div>
"""

NAV_HIST = """  <div class="nav">
    <div class="nav-i"><div style="font-size: 17px;">▤</div><div>学習</div></div>
    <div class="nav-i" style="color: #26251f;"><div style="font-size: 17px;">▧</div><div>履歴</div></div>
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
      <div class="fld" style="color: #8a887d;">you@example.com</div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 7px;">
      <div class="lbl">パスワード</div>
      <div class="fld" style="color: #8a887d;">••••••••</div>
    </div>
    <div class="btn-p" style="margin-top: 4px;">ログイン</div>
    <div style="font-size: 13px; color: #c2410c; min-height: 18px;">メールアドレスまたはパスワードが違います</div>
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
    <div style="border: 2px solid #26251f; border-radius: 6px; background: #eeebe0; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="font-size: 17px;">まとめて解答する</div>
        <div style="font-size: 12px; color: #6b6a62;">3 教材すべて ・ 412 問 ・ 今日 23 問</div>
      </div>
      <div class="btn-p">科目全体で解答</div>
    </div>

    <div style="display: flex; align-items: center; gap: 10px; margin-top: 2px;">
      <div style="font-size: 13px; color: #6b6a62;">教材ごとに解答する</div>
      <div style="flex-grow: 1; height: 1.5px; background: #c9c7bd;"></div>
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
      <div style="font-size: 11px; color: #c2410c;">未保存の変更あり</div>
    </div>
    <div style="border: 2px solid #26251f; border-radius: 5px; height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; background: #26251f; color: #faf9f5;">保存</div>
  </div>

  <div style="height: 44px; border-bottom: 1.5px solid #c9c7bd; display: flex; background: #f2f1ea; flex-shrink: 0;">
    <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #8a887d;">章</div>
    <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #8a887d;">編集</div>
    <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; background: #fff; border-bottom: 3px solid #26251f;">プレビュー</div>
  </div>

  <div style="height: 44px; border-bottom: 1.5px solid #c9c7bd; display: flex; align-items: center; padding: 0 14px; gap: 10px; background: #fff; flex-shrink: 0;">
    <div class="muted" style="flex-grow: 1;">文字を選択してから押す</div>
    <div style="border: 1.5px solid #a8a69c; border-radius: 5px; height: 32px; display: flex; align-items: center; padding: 0 12px; font-size: 12px; color: #6b6a62;">キーワードを作成</div>
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

    <div style="border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column; min-height: 0;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 10px;"><span style="flex-grow: 1;">出題範囲</span><span>すべて選択</span></div>
      <div style="padding: 6px 14px 10px; display: flex; flex-direction: column;">
        <div class="opt"><span style="color: #8a887d; width: 12px;">▾</span><span class="cb-on"></span><span style="flex-grow: 1;">基本情報技術者</span><span class="muted">412</span></div>
        <div class="opt" style="padding-left: 24px;"><span style="color: #8a887d; width: 12px;">▾</span><span class="cb-on"></span><span style="flex-grow: 1;">テクノロジ系</span><span class="muted">210</span></div>
        <div class="opt" style="padding-left: 60px;"><span class="cb-on"></span><span style="flex-grow: 1;">基礎理論</span><span class="muted">64</span></div>
        <div class="opt" style="padding-left: 60px;"><span class="cb"></span><span style="flex-grow: 1; color: #8a887d;">アルゴリズム</span><span class="muted">58</span></div>
        <div class="opt" style="padding-left: 24px;"><span style="color: #8a887d; width: 12px;">▸</span><span class="cb"></span><span style="flex-grow: 1; color: #8a887d;">マネジメント系</span><span class="muted">88</span></div>
      </div>
    </div>

    <div style="display: flex; gap: 12px;">
      <div style="flex-grow: 1; flex-basis: 0; border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column; min-width: 0;">
        <div class="sec-hd">出題順</div>
        <div style="padding: 4px 12px 8px;">
          <div class="opt" style="font-size: 14px;"><span class="rd-on"></span><span>自動</span></div>
          <div class="opt" style="font-size: 14px;"><span class="rd"></span><span>出現順</span></div>
        </div>
      </div>
      <div style="flex-grow: 1; flex-basis: 0; border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column; min-width: 0;">
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
      <div style="width: 100%; height: 5px; border: 1px solid #26251f; border-radius: 4px; overflow: hidden; background: #fff;">
        <div style="width: 32%; height: 100%; background: #26251f;"></div>
      </div>
    </div>
    <div style="font-size: 12px; color: #6b6a62;">12/122</div>
  </div>

  <div class="body">
    <div style="border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">章「2進数」</span>
        <span style="border: 1.5px solid #a8a69c; border-radius: 4px; padding: 4px 9px; background: #fff;">範囲を広げる ▾</span>
      </div>
      <div style="padding: 16px; font-size: 16px; line-height: 2.4;">
        コンピュータは 2進数 で数を扱う。1桁を <span class="kw-blank">&nbsp;</span> と呼び、8桁をまとめたものを <span class="kw-mask">〈単位〉</span> という。
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 9px;">
      <div class="btn" style="justify-content: flex-start; gap: 12px;"><span style="width: 22px; height: 22px; border: 1.5px solid #a8a69c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b6a62;">1</span><span>バイト</span></div>
      <div class="btn" style="justify-content: flex-start; gap: 12px;"><span style="width: 22px; height: 22px; border: 1.5px solid #a8a69c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b6a62;">2</span><span>ビット</span></div>
      <div class="btn" style="justify-content: flex-start; gap: 12px;"><span style="width: 22px; height: 22px; border: 1.5px solid #a8a69c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b6a62;">3</span><span>ワード</span></div>
      <div class="btn" style="justify-content: flex-start; gap: 12px;"><span style="width: 22px; height: 22px; border: 1.5px solid #a8a69c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b6a62;">4</span><span>ヘルツ</span></div>
    </div>

    <div style="flex-grow: 1;"></div>

    <div style="display: flex; align-items: center; gap: 14px;">
      <div class="lg"><span class="lg-c" style="background: #fde68a; border: 1.5px solid #d9a441;"></span><span class="muted">今回の問題</span></div>
      <div class="lg"><span class="lg-c" style="background: #d9d7cd; border: 1.5px solid #a8a69c;"></span><span class="muted">伏せた語</span></div>
    </div>

    <div class="btn-p" style="min-height: 52px; font-size: 17px;">解答する</div>
  </div>
"""

FILES["StudyResultM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 4px;">
      <div style="font-size: 12px;">基礎理論 ・ 2進数</div>
      <div style="width: 100%; height: 5px; border: 1px solid #26251f; border-radius: 4px; overflow: hidden; background: #fff;">
        <div style="width: 36%; height: 100%; background: #26251f;"></div>
      </div>
    </div>
    <div style="font-size: 12px; color: #6b6a62;">13/122</div>
  </div>

  <div class="body" style="gap: 10px;">

    <div style="border: 2px solid #c2410c; border-radius: 6px; background: #fff7ed; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 26px; height: 26px; border: 2px solid #c2410c; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #c2410c; font-size: 15px; flex-shrink: 0;">×</div>
        <div style="font-size: 16px; color: #c2410c; flex-grow: 1;">不正解</div>
        <div class="muted">記述形式</div>
      </div>
      <div style="display: flex; gap: 10px;">
        <div style="flex-grow: 1; flex-basis: 0; display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <span class="muted">あなたの解答</span><span style="font-size: 15px; color: #c2410c;">バイト</span>
        </div>
        <div style="flex-grow: 1; flex-basis: 0; display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <span class="muted">正答</span><span style="font-size: 15px;">ビット</span>
        </div>
      </div>
    </div>

    <div style="border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column; flex-grow: 1; min-height: 0;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">章「2進数」</span>
        <span style="border: 1.5px solid #a8a69c; border-radius: 4px; padding: 4px 9px; background: #fff;">範囲を広げる ▾</span>
      </div>
      <div style="padding: 14px; font-size: 15px; line-height: 2.5; display: flex; flex-direction: column; gap: 10px;">
        <div>コンピュータは 2進数 で数を扱う。1桁を <span class="kw-blank" style="min-width: 0;">ビット</span> と呼び、8桁をまとめたものを <span class="kw-wrong">バイト</span> という。</div>
        <div>速さには <span class="kw-mask">ヘルツ</span>、容量には <span class="kw-wrong">バイト</span> を用いる。</div>
      </div>
      <div style="flex-grow: 1;"></div>
      <div style="padding: 10px 14px; border-top: 1.5px solid #c9c7bd; display: flex; flex-direction: column; gap: 6px;">
        <div class="lg"><span class="lg-c" style="background: #fde68a; border: 1.5px solid #d9a441;"></span><span class="muted">出題された空欄</span></div>
        <div class="lg"><span class="lg-c" style="background: #f0b39a; border: 1.5px solid #c2410c;"></span><span class="muted">答えた「バイト」が入る位置</span></div>
        <div class="lg"><span class="lg-c" style="background: #d9d7cd; border: 1.5px solid #a8a69c;"></span><span class="muted">解答中は伏せていた語</span></div>
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

    <div style="border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column;">
      <div class="sec-hd">科目 ・ 教材 ・ 章</div>
      <div style="padding: 6px 0;">
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px;">
          <span style="color: #8a887d; width: 12px;">▾</span>
          <span style="flex-grow: 1; font-size: 14px;">基本情報技術者</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #26251f; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 46%; background: #26251f;"></span><span style="width: 22%; background: #f0b39a;"></span><span style="width: 32%; background: #e8e6dd;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">78%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px 8px 36px;">
          <span style="color: #8a887d; width: 12px;">▾</span>
          <span style="flex-grow: 1; font-size: 14px;">テクノロジ系</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #26251f; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 62%; background: #26251f;"></span><span style="width: 14%; background: #f0b39a;"></span><span style="width: 24%; background: #e8e6dd;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">85%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px 8px 60px;">
          <span style="flex-grow: 1; font-size: 14px;">基礎理論</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #26251f; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 78%; background: #26251f;"></span><span style="width: 8%; background: #f0b39a;"></span><span style="width: 14%; background: #e8e6dd;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">91%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px 8px 60px;">
          <span style="flex-grow: 1; font-size: 14px;">アルゴリズム</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #26251f; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 24%; background: #26251f;"></span><span style="width: 44%; background: #f0b39a;"></span><span style="width: 32%; background: #e8e6dd;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">52%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 14px;">
          <span style="color: #8a887d; width: 12px;">▸</span>
          <span style="flex-grow: 1; font-size: 14px;">生物基礎</span>
          <span style="width: 62px; height: 10px; border: 1.5px solid #26251f; border-radius: 3px; overflow: hidden; display: flex; flex-shrink: 0;"><span style="width: 30%; background: #26251f;"></span><span style="width: 18%; background: #f0b39a;"></span><span style="width: 52%; background: #e8e6dd;"></span></span>
          <span class="muted" style="width: 34px; text-align: right;">64%</span>
        </div>
      </div>
      <div style="padding: 9px 14px; border-top: 1.5px solid #c9c7bd; display: flex; gap: 12px;">
        <div class="lg"><span class="lg-c" style="background: #26251f;"></span><span class="muted">定着</span></div>
        <div class="lg"><span class="lg-c" style="background: #f0b39a; border: 1.5px solid #c2410c;"></span><span class="muted">苦手</span></div>
        <div class="lg"><span class="lg-c" style="background: #e8e6dd; border: 1.5px solid #a8a69c;"></span><span class="muted">未出題</span></div>
      </div>
    </div>

    <div style="border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column; flex-grow: 1; min-height: 0;">
      <div class="sec-hd">苦手キーワード</div>
      <div style="padding: 4px 0;">
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 14px;"><span style="flex-grow: 1; font-size: 14px;">スタック</span><span class="muted">31%</span></div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 14px;"><span style="flex-grow: 1; font-size: 14px;">二分探索木</span><span class="muted">38%</span></div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 14px;"><span style="flex-grow: 1; font-size: 14px;">スループット</span><span class="muted">44%</span></div>
      </div>
      <div style="flex-grow: 1;"></div>
      <div style="padding: 9px 14px; border-top: 1.5px solid #c9c7bd;" class="muted">日別の学習量は ⋯ から</div>
    </div>

  </div>
""" + NAV_HIST

FILES["KeywordDialogM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div class="ttl">キーワードを編集</div>
    <div style="border: 2px solid #26251f; border-radius: 5px; height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; background: #26251f; color: #faf9f5;">確定</div>
  </div>
  <div class="body" style="gap: 18px;">

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: baseline; gap: 8px;">
        <div class="lbl" style="flex-grow: 1;">正答</div>
        <div class="muted">id = k71m2p</div>
      </div>
      <div style="display: flex; gap: 8px;"><div class="fld" style="flex-grow: 1;">ビット</div><div style="width: 46px; border: 1.5px solid #a8a69c; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: #6b6a62; background: #fff; flex-shrink: 0;">×</div></div>
      <div style="display: flex; gap: 8px;"><div class="fld" style="flex-grow: 1;">bit</div><div style="width: 46px; border: 1.5px solid #a8a69c; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: #6b6a62; background: #fff; flex-shrink: 0;">×</div></div>
      <div style="border: 2px dashed #a8a69c; border-radius: 5px; min-height: 44px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #8a887d;">＋ 正答を追加</div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div class="lbl">タグ</div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        <div style="border: 1.5px solid #26251f; border-radius: 16px; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; font-size: 14px; background: #fff;"><span>単位</span><span style="color: #8a887d;">×</span></div>
        <div style="border: 1.5px solid #26251f; border-radius: 16px; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; font-size: 14px; background: #fff;"><span>基礎理論</span><span style="color: #8a887d;">×</span></div>
        <div style="border: 1.5px dashed #a8a69c; border-radius: 16px; height: 34px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; color: #a8a69c;">＋ タグ</div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div class="lbl">誤答選択肢</div>
      <div style="display: flex; gap: 8px;">
        <div class="fld" style="flex-grow: 1; flex-basis: 0; min-width: 0;">バイト</div>
        <div class="fld" style="flex-grow: 1; flex-basis: 0; min-width: 0;">ワード</div>
        <div class="fld" style="width: 56px; justify-content: center; color: #a8a69c; flex-shrink: 0;">＋</div>
      </div>
      <div class="muted">空のままなら同じタグから自動で選ばれる</div>
    </div>

    <div style="flex-grow: 1;"></div>
    <div class="btn" style="border-color: #c2410c; color: #c2410c;">キーワードを解除</div>

  </div>
"""

FILES["ConflictDialogM"] = """
  <div class="top">
    <div class="ico">✕</div>
    <div class="ttl">差分の確認</div>
    <div style="border: 2px solid #26251f; border-radius: 5px; height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; background: #26251f; color: #faf9f5;">適用</div>
  </div>
  <div class="body" style="gap: 12px;">

    <div class="muted" style="line-height: 1.7;">正答が一致しないキーワードが 2 件あります。<br>正答が1つ以上一致した 38 件は上書き済みです。</div>

    <div style="border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">id = a3f9k2 ・ 2進数</span>
        <span style="color: #c2410c;">履歴 42 件</span>
      </div>
      <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
        <div style="border: 1.5px solid #c9c7bd; border-radius: 5px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 11px; color: #8a887d;">登録済み</div>
          <div style="font-size: 14px;">2進数 ・ バイナリ</div>
        </div>
        <div style="border: 1.5px solid #26251f; border-radius: 5px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 11px; color: #8a887d;">取り込む内容</div>
          <div style="font-size: 14px;">基数 ・ 底</div>
        </div>
        <div style="display: flex; flex-direction: column;">
          <div class="opt" style="font-size: 14px;"><span class="rd-on"></span><span>取り込む内容で上書き</span></div>
          <div class="opt" style="font-size: 14px; color: #6b6a62;"><span class="rd"></span><span>登録済みを残す</span></div>
        </div>
      </div>
    </div>

    <div style="border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">id = q4x8dz ・ 2進数</span>
        <span>履歴 0 件</span>
      </div>
      <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
        <div style="border: 1.5px solid #c9c7bd; border-radius: 5px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 11px; color: #8a887d;">登録済み</div>
          <div style="font-size: 14px;">バイト</div>
        </div>
        <div style="border: 1.5px solid #26251f; border-radius: 5px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 11px; color: #8a887d;">取り込む内容</div>
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
    <div style="border: 2px solid #26251f; border-radius: 5px; height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; background: #26251f; color: #faf9f5;">取り込む</div>
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
      <div class="fld"><span style="flex-grow: 1;">基本情報技術者</span><span style="color: #8a887d;">▾</span></div>
    </div>

    <div style="border: 2px solid #26251f; border-radius: 6px; background: #fff; display: flex; flex-direction: column; flex-grow: 1; min-height: 0;">
      <div class="sec-hd" style="display: flex; align-items: center; gap: 8px;">
        <span style="flex-grow: 1;">zip の中身</span><span>12 章 ・ 210 キーワード</span>
      </div>
      <div style="padding: 6px 14px;">
        <div style="display: flex; align-items: center; gap: 9px; padding: 7px 0; font-size: 14px;"><span class="cb-on"></span><span style="color: #8a887d;">▾</span><span style="flex-grow: 1;">010_基礎理論</span><span class="muted">64</span></div>
        <div style="display: flex; align-items: center; gap: 9px; padding: 7px 0 7px 30px; font-size: 14px;"><span class="cb-on"></span><span style="flex-grow: 1;">010_2進数</span><span class="muted">22</span></div>
        <div style="display: flex; align-items: center; gap: 9px; padding: 7px 0 7px 30px; font-size: 14px;"><span class="cb-on"></span><span style="flex-grow: 1;">020_論理演算</span><span class="muted">18</span></div>
        <div style="display: flex; align-items: center; gap: 9px; padding: 7px 0; font-size: 14px;"><span class="cb-on"></span><span style="color: #8a887d;">▸</span><span style="flex-grow: 1;">020_アルゴリズム</span><span class="muted">58</span></div>
      </div>
      <div style="flex-grow: 1;"></div>
      <div style="padding: 9px 14px; border-top: 1.5px solid #c9c7bd;" class="muted">正答が一致しないものは次の画面で確認します</div>
    </div>

  </div>
"""

for name, body in FILES.items():
    io.open(name + ".dc.html", "w", encoding="utf-8", newline="\n").write(HEAD + body + FOOT)
    print("wrote", name + ".dc.html")
