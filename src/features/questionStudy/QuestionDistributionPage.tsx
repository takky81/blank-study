import { useEffect, useState } from 'react';

import { loadSubjectDistribution, type SubjectDistributionSource } from './distributionApi';
import { binAccuracy, binAskedCount } from './histogram';
import { QuestionHistogram } from './QuestionHistogram';

export type DistributionUnit = 'question' | 'keyword';

const UNIT_OPTIONS: readonly { value: DistributionUnit; label: string }[] = [
  { value: 'question', label: '設問ごと' },
  { value: 'keyword', label: 'キーワードごと' },
];

type View =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; source: SubjectDistributionSource };

export type QuestionDistributionPageProps = {
  subjectId: string;
  onExit: () => void;
  load?: (subjectId: string) => Promise<SubjectDistributionSource>;
};

/** 科目単位で、構造化設問の正答率と出題回数の分布を表示する。 */
export function QuestionDistributionPage({ subjectId, onExit, load = loadSubjectDistribution }: QuestionDistributionPageProps) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [unit, setUnit] = useState<DistributionUnit>('question');

  useEffect(() => {
    let active = true;
    setView({ kind: 'loading' });
    load(subjectId).then(
      (source) => { if (active) setView({ kind: 'ready', source }); },
      () => { if (active) setView({ kind: 'error' }); },
    );
    return () => { active = false; };
  }, [subjectId, load, attempt]);

  const backButton = <button type="button" className="btn-s h-11 px-4" onClick={onExit}>範囲選択へ戻る</button>;
  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5 p-4 break-words sm:px-10 sm:py-7">
      {children}
    </div>
  );

  if (view.kind === 'loading') {
    return shell(<>
      <h1 className="text-[22px]">成績分布</h1>
      <p role="status" aria-busy="true" className="text-[13px] text-muted">読み込んでいます…</p>
    </>);
  }
  if (view.kind === 'error') {
    return shell(<>
      <h1 className="text-[22px]">成績分布</h1>
      <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">成績分布を読み込めませんでした</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-p h-12 px-8" onClick={() => setAttempt((n) => n + 1)}>再読み込み</button>
        {backButton}
      </div>
    </>);
  }
  const { source } = view;
  if (source.kind === 'not-found') {
    return shell(<>
      <h1 className="text-[22px]">成績分布</h1>
      <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">指定された科目を表示できません</p>
      <div>{backButton}</div>
    </>);
  }

  const heading = <h1 className="text-[22px]">成績分布<span className="ml-2 text-[15px] text-muted">{source.subjectName}</span></h1>;
  if (source.byQuestion.length === 0) {
    return shell(<>
      {heading}
      <p className="text-[14px]">この科目に有効な設問はありません</p>
      <div>{backButton}</div>
    </>);
  }

  const points = unit === 'question' ? source.byQuestion : source.byKeyword;
  return shell(<>
    {heading}
    <fieldset className="card flex flex-col p-3">
      <legend className="px-1 text-[14px]">集計単位</legend>
      <div role="radiogroup" aria-label="集計単位" className="flex flex-wrap gap-x-4">
        {UNIT_OPTIONS.map((option) => (
          <label key={option.value} className="flex h-11 items-center gap-3 px-2 text-[14px]">
            <input type="radio" name="distribution-unit" className="h-4.5 w-4.5 accent-ink"
              checked={unit === option.value} onChange={() => setUnit(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
    <QuestionHistogram title="正答率" bins={binAccuracy(points)} total={points.length} />
    <QuestionHistogram title="出題回数" bins={binAskedCount(points)} total={points.length} />
    <div>{backButton}</div>
  </>);
}
