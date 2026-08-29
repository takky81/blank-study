-- 穴埋め学習アプリ 初期スキーマ
-- docs/仕様書.md §3 データモデル に対応する。

-- ---------------------------------------------------------------------------
-- 共通
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- subjects（科目）
-- ---------------------------------------------------------------------------

create table public.subjects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index subjects_owner_sort_idx on public.subjects (owner_id, sort_order);

create trigger subjects_set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- materials（教材）
-- ---------------------------------------------------------------------------

create table public.materials (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.subjects (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index materials_subject_sort_idx on public.materials (subject_id, sort_order);
create index materials_owner_idx on public.materials (owner_id);

create trigger materials_set_updated_at
  before update on public.materials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chapters（章）
-- 階層は parent_id の自己参照で表す。親を消すと子も消える。
-- ---------------------------------------------------------------------------

create table public.chapters (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references public.materials (id) on delete cascade,
  parent_id    uuid references public.chapters (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  title        text not null check (btrim(title) <> ''),
  body         text not null default '',
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index chapters_material_parent_sort_idx
  on public.chapters (material_id, parent_id, sort_order);
create index chapters_owner_idx on public.chapters (owner_id);

create trigger chapters_set_updated_at
  before update on public.chapters
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- keywords（キーワード）
-- 章を消してもキーワードは残す。chapter_id を null にし、
-- アプリが is_active を false にして出題対象から外す（仕様書 §3.7）。
-- ---------------------------------------------------------------------------

create table public.keywords (
  id             uuid primary key default gen_random_uuid(),
  material_id    uuid not null references public.materials (id) on delete cascade,
  chapter_id     uuid references public.chapters (id) on delete set null,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  doc_id         text not null check (doc_id ~ '^[a-z0-9]{6}$'),
  answers        text[] not null check (array_length(answers, 1) >= 1),
  tags           text[] not null default '{}',
  wrong_choices  text[] not null default '{}',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint keywords_doc_id_unique unique (material_id, doc_id)
);

create index keywords_material_active_idx on public.keywords (material_id, is_active);
create index keywords_chapter_idx on public.keywords (chapter_id);
create index keywords_owner_idx on public.keywords (owner_id);
-- 同じタグのキーワードを引くため（誤答選択肢の生成・伏せ字の判定）
create index keywords_tags_idx on public.keywords using gin (tags);

create trigger keywords_set_updated_at
  before update on public.keywords
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- keyword_stats（学習状態 / SRS）
-- ---------------------------------------------------------------------------

create table public.keyword_stats (
  keyword_id        uuid primary key references public.keywords (id) on delete cascade,
  owner_id          uuid not null references auth.users (id) on delete cascade,
  total_count       int not null default 0 check (total_count >= 0),
  correct_count     int not null default 0 check (correct_count >= 0),
  repetition        int not null default 0 check (repetition >= 0),
  ease_factor       numeric not null default 2.5 check (ease_factor >= 1.3),
  interval_days     numeric not null default 0 check (interval_days >= 0),
  due_at            timestamptz,
  last_answered_at  timestamptz,
  constraint keyword_stats_correct_le_total check (correct_count <= total_count)
);

-- 出題順の抽出（due_at の昇順）で使う
create index keyword_stats_owner_due_idx on public.keyword_stats (owner_id, due_at);

-- ---------------------------------------------------------------------------
-- answer_logs（解答履歴の明細）
-- ---------------------------------------------------------------------------

create table public.answer_logs (
  id           uuid primary key default gen_random_uuid(),
  keyword_id   uuid not null references public.keywords (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  format       text not null check (format in ('choice', 'text')),
  input        text not null,
  is_correct   boolean not null,
  expanded     boolean not null default false,
  answered_at  timestamptz not null default now()
);

-- 直近10件の判定と日別の集計で使う
create index answer_logs_owner_answered_idx
  on public.answer_logs (owner_id, answered_at desc);
create index answer_logs_keyword_idx on public.answer_logs (keyword_id);

-- ---------------------------------------------------------------------------
-- RLS
-- すべてのテーブルで owner_id = auth.uid() を基本ポリシーとする（仕様書 §2.3）。
-- ---------------------------------------------------------------------------

alter table public.subjects       enable row level security;
alter table public.materials      enable row level security;
alter table public.chapters       enable row level security;
alter table public.keywords       enable row level security;
alter table public.keyword_stats  enable row level security;
alter table public.answer_logs    enable row level security;

create policy subjects_owner on public.subjects
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy materials_owner on public.materials
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy chapters_owner on public.chapters
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy keywords_owner on public.keywords
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy keyword_stats_owner on public.keyword_stats
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy answer_logs_owner on public.answer_logs
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
