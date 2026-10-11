-- Structured question bank: question master and referential invariants.
-- This follows the reserved 20261011000000 design slot without rewriting an
-- existing migration.

alter table public.keywords
  add constraint keywords_id_material_owner_unique
  unique (id, material_id, owner_id);

create table public.structured_questions (
  id                       uuid primary key default gen_random_uuid(),
  keyword_id               uuid not null,
  material_id              uuid not null,
  owner_id                 uuid not null references auth.users (id) on delete cascade,
  question_text            text not null check (btrim(question_text) <> ''),
  model_answer             text not null check (btrim(model_answer) <> ''),
  choices                  jsonb not null default '[]'::jsonb
                           check (
                             jsonb_typeof(choices) = 'array'
                             and not jsonb_path_exists(
                               choices,
                               '$[*] ? (@.type() != "string")'
                             )
                           ),
  explanation              text,
  sort_order               integer not null default 0 check (sort_order >= 0),
  is_active                boolean not null default true,
  doubt_flag               boolean not null default false,
  explanation_request_flag boolean not null default false,
  version                  bigint not null default 1 check (version >= 1),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint structured_questions_keyword_material_owner_fkey
    foreign key (keyword_id, material_id, owner_id)
    references public.keywords (id, material_id, owner_id) on delete cascade
);

create index structured_questions_keyword_sort_idx
  on public.structured_questions (keyword_id, sort_order, id);

create index structured_questions_material_keyword_sort_idx
  on public.structured_questions (material_id, keyword_id, sort_order, id);

create index structured_questions_owner_flags_idx
  on public.structured_questions (owner_id, doubt_flag, explanation_request_flag);

create or replace function public.set_structured_question_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version = old.version + 1;
  new.updated_at = now();
  return new;
end;
$$;

create trigger structured_questions_set_version
  before update on public.structured_questions
  for each row execute function public.set_structured_question_version();
