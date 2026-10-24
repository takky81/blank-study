"""設問交換のエクスポートから取込ファイル (schema v1) を作るための補助ツール。

サブコマンド:
  prep    <export.json> <work>                    作業ディレクトリに order.json と in/cNN.txt を作る
  merge   <export.json> <work> <out.json> [opts]  out/cNN.json を検証・結合し、エラー0件なら取込ファイルを書く
  review  <import.json> <out.txt>                 取込ファイルを1問1行に縮め、要注意の印を付けて書き出す
  overlap <import.json>                           問題文と選択肢の単語一致チェックだけを行う
  applyfix <work> <import.json> <fix.json>        fix.json の {i, t?, a?, c?, e?} を out/cNN.json に反映する

merge のオプション:
  --create-for-perfect   正答率100%のキーワードに追加設問を必須とする
  --skip-doubt-create    疑義フラグのあるキーワードには追加設問を作らない（作っても捨てる）
  --forbid-digit-answer  模範解答が数値だけの設問をエラーにする（計算問題の禁止）

compact op（out/cNN.json の各要素）:
  {"k": チャンク内のキーワード番号, "q": 設問番号（省略で新規作成）, "t": 設問文, "a": 模範解答, "c": [誤答3つ], "e": 解説}
"""
import datetime
import json
import re
import sys
import uuid
from pathlib import Path

N = 40
sys.stdout.reconfigure(encoding='utf-8')


def load(p):
    return json.load(open(p, encoding='utf-8'))


def norm(v):
    out = ''.join(chr(ord(c) - 0xFEE0) if '！' <= c <= '～' else c for c in v)
    return out.replace('　', ' ').strip().lower()


# ---------------------------------------------------------------- 単語一致チェック
# 問題文の「語」ごとに、その語が選択肢に現れるかを調べ、選択肢ごとに一致度を合計する。
# 語の単位（ひらがなは助詞・活用語尾が大半なので数えない）:
#   - 英数字の語（2文字以上、大文字小文字・全角半角を同一視）
#   - 漢字の連続（2文字以上）
#   - カタカナの連続（3文字以上）
# 一致の判定（部分一致を拾い、偶然の一致は拾わない）:
#   - 英数字の語: 選択肢に同じ語がある
#   - 漢字の語: 2文字の部分列（例: 情報処理 → 情報, 報処, 処理）のどれかが選択肢の漢字語に含まれる
#   - カタカナの語: 3文字の部分列のどれかが選択肢のカタカナ語に含まれる（テスト／リクエストの「スト」は数えない）
# 一致度: 一致した語1つにつき1点。ただし4文字以上の英数字・カタカナ語は2点（固有の用語ほど強いヒントのため）
# 除外:
#   - 設問の決まり文句（「適切」「記述」「特徴」など）
#   - 4つの選択肢すべてに現れる部分列（選択肢を区別しないため）
# 判定: 正答の一致度 a が 2 以上で、誤答3つの最大値 d との差が max(1, a/3) 以上 → 修正必須（errors）
#       （正答も誤答も一致度が高く差がわずかな場合は、問題文の語が全選択肢に散らばっているだけなので除く）
STOP = set('''
適切 記述 説明 特徴 場合 目的 理由 方法 手法 次の 以下 以上 組合 合せ 一般 最も 用語 対象 関係 内容
'''.split())


def _words(text):
    s = norm(text)
    out = [('a', w) for w in re.findall(r'[a-z0-9][a-z0-9.+\-/]*[a-z0-9]', s)]
    out += [('k', w) for w in re.findall(r'[一-鿿々]{2,}', s)]
    out += [('c', w) for w in re.findall(r'[゠-ヿー]{3,}', s)]
    return out


def _grams(kind, w):
    if kind == 'a':
        return {w}
    n = 2 if kind == 'k' else 3
    return {w[i:i + n] for i in range(len(w) - n + 1)} - STOP


def _gramset(text):
    g = set()
    for kind, w in _words(text):
        g |= _grams(kind, w)
    return g


def overlap(question, answer, choices):
    """(正答の一致度, 誤答の一致度の最大, 正答で一致した問題文の語) を返す。"""
    sets = [_gramset(x) for x in [answer, *choices]]
    common = set.intersection(*sets)
    qwords = [(k, w, _grams(k, w) - common) for k, w in set(_words(question))]
    scores, hits = [], []
    for s in sets:
        matched = [(k, w) for k, w, g in qwords if g & s]
        scores.append(sum(2 if k in 'ac' and len(w) >= 4 else 1 for k, w in matched))
        hits.append(sorted(w for _, w in matched))
    return scores[0], max(scores[1:]), hits[0]


def overlap_error(question, answer, choices):
    a, d, words = overlap(question, answer, choices)
    if (a >= 2 and a - d >= max(1, a / 3)) or (a >= 1 and d == 0):
        return f'問題文との単語一致が正答だけ多い（正答{a}／誤答最大{d}：{" ".join(words)}）'
    return None


def doubt_error(q, draft):
    """疑義の理由に対して直しが足りない更新を返す。"""
    reasons = set(q.get('doubtReasons') or [])
    if reasons - {'answer_guessable'} or q.get('doubtNote'):
        # 覚える価値・欠陥・あいまい・メモは、問い方（設問文か模範解答）を変える必要がある
        if q['questionText'] == draft['questionText'] and q['modelAnswer'] == draft['modelAnswer']:
            return f'疑義（{",".join(sorted(reasons)) or "メモ"}）なのに設問文も模範解答も変わっていない'
    elif sorted(q['choices']) == sorted(draft['choices']) and q['modelAnswer'] == draft['modelAnswer'] \
            and q['questionText'] == draft['questionText']:
        # 推測できる原因を消すには、誤答・ヒントの語・模範解答のどれかを変える必要がある
        return '疑義（answer_guessable）なのに設問文も選択肢も変わっていない'
    return None


# ---------------------------------------------------------------- prep
def cmd_prep(src, work):
    work = Path(work)
    (work / 'in').mkdir(parents=True, exist_ok=True)
    (work / 'out').mkdir(exist_ok=True)
    targets = load(src)['targets']

    def key(t):
        c = t['chapterContexts'][0]['chapter'] if t['chapterContexts'] else {'sortOrder': 1 << 30, 'title': ''}
        return (c['sortOrder'], t['keyword']['displayText'])
    targets.sort(key=key)
    json.dump([t['keyword']['id'] for t in targets], open(work / 'order.json', 'w'))
    for c in range(0, len(targets), N):
        lines = []
        for k, t in enumerate(targets[c:c + N]):
            m = t['metrics']
            ch = t['chapterContexts'][0]['chapter']['title'] if t['chapterContexts'] else ''
            acc = f"{round(m['accuracy'] * 100)}%({m['attempts']})" if m['attempts'] else '未解答'
            lines.append(f"## k{k} [{ch}] KW={t['keyword']['displayText']} / 正答率={acc}")
            for i, q in enumerate(t['questions']):
                f = f"[{','.join(q['requestedFlags'])}] " if q['requestedFlags'] else ''
                if 'doubt' in q['requestedFlags']:
                    f += f"理由={','.join(q.get('doubtReasons') or []) or 'なし'} "
                    if q.get('doubtNote'):
                        f += f"メモ=「{q['doubtNote']}」 "
                warn = overlap_error(q['questionText'], q['modelAnswer'], q['choices'])
                w = f' ⚠{warn}' if warn else ''
                lines.append(f" q{i} {f}Q:{q['questionText']} A:{q['modelAnswer']} X:{' | '.join(q['choices'])} "
                             f"E:{q['explanation'] or '(なし)'}{w}")
        (work / 'in' / f'c{c // N:02d}.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'keywords={len(targets)} chunks={(len(targets) + N - 1) // N}')


# ---------------------------------------------------------------- merge
def cmd_merge(src, work, dst, *opts):
    work = Path(work)
    create_for_perfect = '--create-for-perfect' in opts
    skip_doubt_create = '--skip-doubt-create' in opts
    forbid_digit = '--forbid-digit-answer' in opts
    by_id = {t['keyword']['id']: t for t in load(src)['targets']}
    order = load(work / 'order.json')
    ops, errors, skipped, dropped = [], [], 0, 0
    chunks = sorted(work.glob('out/c*.json'))
    for f in chunks:
        c = int(f.stem[1:])
        for n, o in enumerate(load(f)):
            where = f'{f.name}#{n}(k{o["k"]})'
            t = by_id[order[c * N + o['k']]]
            draft = {'questionText': o['t'].strip(), 'modelAnswer': o['a'].strip(),
                     'choices': [x.strip() for x in o['c']], 'explanation': o['e'].strip()}
            ch = [norm(x) for x in draft['choices']]
            if len(ch) != 3 or len(set(ch)) != 3 or '' in ch:
                errors.append(f'{where}: 誤答は重複のない3つが必要')
            if norm(draft['modelAnswer']) in ch:
                errors.append(f'{where}: 誤答が模範解答と重複')
            if not draft['modelAnswer'].isdigit() and norm(draft['modelAnswer']) in norm(draft['questionText']):
                errors.append(f'{where}: 設問文に模範解答 [{draft["modelAnswer"]}] が含まれる')
            if forbid_digit and re.fullmatch(r'[\d,.]+', norm(draft['modelAnswer'])):
                errors.append(f'{where}: 模範解答が数値（計算問題）')
            if not draft['questionText'] or not draft['explanation']:
                errors.append(f'{where}: 設問文か解説が空')
            warn = overlap_error(draft['questionText'], draft['modelAnswer'], draft['choices'])
            if warn:
                errors.append(f'{where}: {warn} | {draft["questionText"][:50]}')
            if 'q' in o:
                q = t['questions'][o['q']]
                same = all(q[k] == draft[k] for k in ('questionText', 'modelAnswer', 'explanation')) \
                    and q['choices'] == draft['choices']
                if same and not q['requestedFlags']:
                    skipped += 1
                    continue
                if 'doubt' in q['requestedFlags']:
                    err = doubt_error(q, draft)
                    if err:
                        errors.append(f'{where}: {err} | {draft["questionText"][:50]}')
                ops.append({'kind': 'update', 'keywordId': t['keyword']['id'], 'questionId': q['questionId'],
                            'expectedVersion': q['expectedVersion'], 'question': draft,
                            'sourceRequestedFlags': list(q['requestedFlags']),
                            'resolvedFlags': list(q['requestedFlags'])})
            elif skip_doubt_create and any('doubt' in q['requestedFlags'] for q in t['questions']):
                dropped += 1
            else:
                ops.append({'kind': 'create', 'keywordId': t['keyword']['id'], 'question': draft})

    # 網羅チェック
    updated = {o['questionId'] for o in ops if o['kind'] == 'update'}
    created = {o['keywordId'] for o in ops if o['kind'] == 'create'}
    covered = set(order[:len(chunks) * N])
    for kid in covered:
        t = by_id[kid]
        doubted = any('doubt' in q['requestedFlags'] for q in t['questions'])
        name = t['keyword']['displayText']
        for q in t['questions']:
            if q['requestedFlags'] and q['questionId'] not in updated:
                errors.append(f'{name}: フラグ付き設問が未修正 ({",".join(q["requestedFlags"])})')
            if not q['explanation'] and q['questionId'] not in updated:
                errors.append(f'{name}: 解説のない設問が未修正')
            if q['questionId'] not in updated and overlap_error(q['questionText'], q['modelAnswer'], q['choices']):
                errors.append(f'{name}: 既存設問が単語一致チェックに該当するのに未修正 | {q["questionText"][:50]}')
        if create_for_perfect and t['metrics']['attempts'] and t['metrics']['accuracy'] == 1 \
                and not (skip_doubt_create and doubted) and kid not in created:
            errors.append(f'{name}: 正答率100%なのに追加設問がない')
    if len(updated) != sum(o['kind'] == 'update' for o in ops):
        errors.append('同じ設問への update が重複')

    print(f'chunks={len(chunks)}/{(len(order) + N - 1) // N} ops={len(ops)} update={len(updated)} '
          f'create={len(ops) - len(updated)} skipped(変更なし)={skipped} dropped(疑義で作成せず)={dropped} '
          f'errors={len(errors)}')
    for e in errors:
        print(e)
    if not errors:
        out = {'schemaVersion': 1, 'exchangeId': str(uuid.uuid4()),
               'exportedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               'operations': ops}
        Path(dst).write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'wrote {dst}')
    return 1 if errors else 0


# ---------------------------------------------------------------- review / overlap
def cmd_review(imp, dst):
    lines = []
    for i, o in enumerate(load(imp)['operations']):
        q = o['question']
        a, c, t = q['modelAnswer'], q['choices'], q['questionText']
        marks = []
        if re.search(r'\d', a):
            marks.append('NUM')
        lens = [len(x) for x in c]
        if len(a) > 1.8 * max(lens) or len(a) < 0.5 * min(lens):
            marks.append('LEN')
        if overlap_error(t, a, c):
            marks.append('OVL')
        lines.append(f"{i} {'[' + ','.join(marks) + '] ' if marks else ''}{t} => {a} / {' | '.join(c)}")
    Path(dst).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{len(lines)} lines, marked={sum("[" in x.split(" ", 2)[1] for x in lines)}')


def cmd_overlap(imp):
    hits = 0
    for i, o in enumerate(load(imp)['operations']):
        q = o['question']
        w = overlap_error(q['questionText'], q['modelAnswer'], q['choices'])
        if w:
            hits += 1
            print(f'{i}: {w} | {q["questionText"][:60]} => {q["modelAnswer"]}')
    print(f'hits={hits}')


# ---------------------------------------------------------------- applyfix
def cmd_applyfix(work, imp, fix):
    ops = load(imp)['operations']
    fx = load(fix)
    want = {ops[f['i']]['question']['questionText']: f for f in fx}
    hit = set()
    for p in sorted(Path(work).glob('out/c*.json')):
        d = load(p)
        changed = False
        for e in d:
            f = want.get(e['t'])
            if f:
                for k in 'tace':
                    if k in f:
                        e[k] = f[k]
                hit.add(f['i'])
                changed = True
        if changed:
            json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('applied', len(hit), 'missing', sorted({f['i'] for f in fx} - hit))


if __name__ == '__main__':
    cmd, *args = sys.argv[1:]
    sys.exit({'prep': cmd_prep, 'merge': cmd_merge, 'review': cmd_review,
              'overlap': cmd_overlap, 'applyfix': cmd_applyfix}[cmd](*args) or 0)
