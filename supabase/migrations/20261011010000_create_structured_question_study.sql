-- Structured question study: dedicated SRS state and immutable answer events.

alter table public.structured_questions
  add constraint structured_questions_id_owner_unique unique (id, owner_id);

create table public.structured_question_stats (
  question_id         uuid primary key,
  owner_id            uuid not null references auth.users (id) on delete cascade,
  asked_count         integer not null default 0 check (asked_count >= 0),
  correct_count       integer not null default 0 check (correct_count >= 0),
  consecutive_correct integer not null default 0 check (consecutive_correct >= 0),
  interval_days       integer not null default 0 check (interval_days >= 0),
  ease_factor         numeric not null default 2.5 check (ease_factor >= 1.3),
  due_at              timestamptz,
  updated_at           timestamptz not null default now(),
  constraint structured_question_stats_correct_le_asked
    check (correct_count <= asked_count),
  constraint structured_question_stats_question_owner_fkey
    foreign key (question_id, owner_id)
    references public.structured_questions (id, owner_id) on delete cascade
);

create index structured_question_stats_owner_due_idx
  on public.structured_question_stats (owner_id, due_at, question_id);

create table public.structured_question_answer_logs (
  id               uuid primary key default gen_random_uuid(),
  question_id      uuid not null,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  question_version bigint not null check (question_version >= 1),
  answer           text not null,
  mode             text not null check (mode in ('choice', 'written')),
  is_correct       boolean not null,
  answered_at      timestamptz not null default now(),
  constraint structured_question_answer_logs_question_owner_fkey
    foreign key (question_id, owner_id)
    references public.structured_questions (id, owner_id) on delete cascade
);

create index structured_question_answer_logs_owner_question_answered_idx
  on public.structured_question_answer_logs
  (owner_id, question_id, answered_at desc, id);
