-- ─────────────────────────────────────────────────────────────────────────────
-- ProjectPastel — Migration v6: AI session summarizer
-- Paste into the Supabase SQL Editor and click Run.
--
--   ai_usage                    one row per Claude API message (usage meter)
--   summary_jobs                in-progress / finished summarizer runs (resumable)
--   campaign_references         per-campaign characters/NPCs/locations doc
--   campaign_reference_versions previous versions of that doc (auto, for undo)
--
-- All tables are editor-only: no public read access.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Usage ────────────────────────────────────────────────────────────────────

create table if not exists ai_usage (
  id                 uuid        primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  message_id         text        unique,               -- dedupes repeat logging
  kind               text        not null,             -- 'draft' | 'final'
  batch              boolean     not null default true,
  model              text        not null default 'claude-opus-5-5',
  input_tokens       integer     not null default 0,
  output_tokens      integer     not null default 0,
  cache_write_tokens integer     not null default 0,
  cache_read_tokens  integer     not null default 0,
  -- Cost of this one message in USD, priced by the model that handled it.
  -- The usage meter sums every row, whatever the model, against the $100.
  -- USD per million tokens (input / output / cache write / cache read):
  --   claude-opus-5-5    4 / 20 / 5    / 0.20   (editor's "Opus" choice)
  --   claude-opus-5      5 / 25 / 6.25 / 0.50   (Opus refusal fallback)
  --   claude-sonnet-5-5  2 / 10 / 2.5  / 0.10   (editor's "Sonnet" choice)
  --   claude-sonnet-5    2 / 10 / 2.5  / 0.20   (Sonnet refusal fallback)
  --   anything else is priced like claude-opus-5, so the meter errs toward over-counting.
  -- Message Batches are billed at 50%. Keep in sync with MODELS in workers/summarizer/worker.js.
  cost_usd           numeric generated always as (
    (case model
       when 'claude-opus-5-5'   then input_tokens * 4 + output_tokens * 20 + cache_write_tokens * 5   + cache_read_tokens * 0.2
       when 'claude-sonnet-5-5' then input_tokens * 2 + output_tokens * 10 + cache_write_tokens * 2.5 + cache_read_tokens * 0.1
       when 'claude-sonnet-5'   then input_tokens * 2 + output_tokens * 10 + cache_write_tokens * 2.5 + cache_read_tokens * 0.2
       else                          input_tokens * 5 + output_tokens * 25 + cache_write_tokens * 6.25 + cache_read_tokens * 0.5
     end)
    / 1000000.0 * (case when batch then 0.5 else 1 end)
  ) stored
);
create index if not exists ai_usage_created_at_idx on ai_usage (created_at);

-- ── Summarizer jobs ──────────────────────────────────────────────────────────

create table if not exists summary_jobs (
  id                 uuid        primary key default gen_random_uuid(),
  campaign_id        uuid        not null references campaigns(id) on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  stage              text        not null default 'draft',   -- draft | clarify | final | review | done
  -- new | submitting | running | processing | ready | error | canceled | closed
  -- submitting/processing are short "claims" so two open tabs never act twice.
  status             text        not null default 'new',
  batch_id           text,
  error              text,
  model_choice       text        not null default 'opus',  -- 'opus' | 'sonnet', picked by the editor
  use_fallback       boolean     not null default false,   -- retry on the fallback model after a refusal
  transcript         text        not null,
  draft              text,
  clarifications     jsonb       not null default '[]',
  answers            jsonb       not null default '[]',
  reference_base     text,                    -- reference doc exactly as sent to the final pass
  summary_edits      jsonb       not null default '[]',  -- Claude's line edits to the draft
  reference_edits    jsonb       not null default '[]',  -- Claude's line edits to reference_base
  final_md           text,                    -- draft with the accepted edits applied
  reference_proposed text,                    -- reference_base with the accepted edits applied
  wiki_entry_url     text                     -- link to the wiki entry once saved (prevents accidental duplicates)
);
create index if not exists summary_jobs_campaign_idx on summary_jobs (campaign_id, created_at desc);

-- ── Campaign reference docs ──────────────────────────────────────────────────

create table if not exists campaign_references (
  campaign_id uuid        primary key references campaigns(id) on delete cascade,
  content     text        not null default '',
  updated_at  timestamptz not null default now()
);

create table if not exists campaign_reference_versions (
  id          uuid        primary key default gen_random_uuid(),
  campaign_id uuid        not null references campaigns(id) on delete cascade,
  content     text        not null,
  created_at  timestamptz not null default now()
);
create index if not exists campaign_reference_versions_idx on campaign_reference_versions (campaign_id, created_at desc);

-- Keep the previous text every time a reference doc changes.
-- ponytail: versions are never pruned; add a cleanup if the table ever gets big.
create or replace function _ppastel_keep_reference_version()
returns trigger language plpgsql as $$
begin
  if old.content is distinct from new.content and old.content <> '' then
    insert into campaign_reference_versions (campaign_id, content, created_at)
    values (old.campaign_id, old.content, old.updated_at);
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists campaign_references_version on campaign_references;
create trigger campaign_references_version
  before update on campaign_references
  for each row execute function _ppastel_keep_reference_version();

drop trigger if exists summary_jobs_updated_at on summary_jobs;
create trigger summary_jobs_updated_at
  before update on summary_jobs
  for each row execute function _ppastel_set_updated_at();

-- ── Row Level Security: signed-in editors only ───────────────────────────────

alter table ai_usage                    enable row level security;
alter table summary_jobs                enable row level security;
alter table campaign_references         enable row level security;
alter table campaign_reference_versions enable row level security;

create policy "auth read ai_usage"   on ai_usage for select using (auth.role() = 'authenticated');
create policy "auth insert ai_usage" on ai_usage for insert with check (auth.role() = 'authenticated');

create policy "auth all summary_jobs"        on summary_jobs                for all using (auth.role() = 'authenticated');
create policy "auth all campaign_references" on campaign_references         for all using (auth.role() = 'authenticated');
create policy "auth read reference_versions" on campaign_reference_versions for select using (auth.role() = 'authenticated');
-- The version trigger inserts as the editor, so editors also need insert.
create policy "auth insert reference_versions" on campaign_reference_versions for insert with check (auth.role() = 'authenticated');
