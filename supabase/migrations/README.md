# ArogyaOS – AI Health Memory · Supabase Migrations

This folder contains the database schema for **ArogyaOS – AI Health Memory**.
It is intentionally scoped to the five hackathon features — **no**
appointments, clinics, billing, pharmacy, doctors, or hospital-management
tables exist anywhere in this schema.

## Files

| File | Contents |
| --- | --- |
| `0001_arogyaos_ai_health_memory.sql` | Core schema: 6 tables, foreign keys, indexes, checks, RLS |
| `0002_voice_conversations_and_async_processing.sql` | Incremental: `voice_conversations`, `report_processing_jobs`, `medical_reports.processing_status`, `ai_insights` debug columns, full schema comments |

## Feature → table mapping

| Hackathon feature | Tables |
| --- | --- |
| 1. AI Medical Report → Action Plan | `medical_reports`, `ai_insights` |
| 2. AI Health Journey | `medical_reports`, `health_metrics` |
| 3. Adaptive Personal Baseline Engine (APBE) | `health_metrics`, `personal_baselines` |
| 4. AI Doctor Visit Copilot | `doctor_briefs` |
| 5. Multilingual Voice Health Assistant | `profiles.preferred_language`, `health_metrics`, `voice_conversations` |
| Async report pipeline (shared infrastructure) | `report_processing_jobs`, `medical_reports.processing_status` |

## How to apply

**Option A — Supabase SQL Editor (fastest for a hackathon):**
1. Open your project dashboard → SQL Editor → New query.
2. Paste the entire contents of `0001_arogyaos_ai_health_memory.sql` and run it.
3. Then paste `0002_voice_conversations_and_async_processing.sql` and run it.
   (Both are idempotent-friendly: helpers use `create or replace`, new tables
   and columns use `IF NOT EXISTS`, and new policies are `DROP POLICY IF
   EXISTS`-guarded.)

**Option B — Supabase CLI (repeatable):**
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## What the schema does

- **Auth:** Supabase Auth owns identities (`auth.users`). There is **no**
  separate `users` table. `profiles` is a 1:1 public extension of
  `auth.users` (FK + `on delete cascade`), and a `security definer` trigger
  (`on_auth_user_created`) auto-creates a profile row on sign-up.
- **Row Level Security** is enabled on all eight tables. Every policy is
  per-user:
  - `profiles`, `medical_reports`, `personal_baselines`, `doctor_briefs`,
    `voice_conversations` → `auth.uid() = user_id`
  - `health_metrics`, `ai_insights`, `report_processing_jobs` → ownership
    inherited through the parent `medical_reports` row (subquery), so users
    can't touch metrics/insights/jobs of someone else's report.
- **Foreign keys** cascade on delete (user → reports → metrics/insights/jobs).
- **UUID primary keys** everywhere (`gen_random_uuid()`).
- **`created_at` timestamps** on all tables; `updated_at` is
  auto-maintained by a trigger on `profiles` and `personal_baselines`.
- **Constraints** that keep data sane: `upload_status` enum,
  `processing_status` enums, `gender` values, `age` bounds,
  `personal_status` enum, `confidence_score` 0–1, and
  `UNIQUE (user_id, metric_name)` on baselines so APBE upserts cleanly.

## Notes & conventions

- **Async processing flow:** uploading a report sets
  `medical_reports.processing_status = 'uploaded'`. A worker inserts a
  `report_processing_jobs` row, advances it
  `pending → running → completed | failed`, and mirrors the stage back onto
  the report (`extracting → analyzing → completed | failed`).
- **Blood pressure:** store as two metric rows —
  `blood_pressure_systolic` and `blood_pressure_diastolic` — so APBE z-scores
  stay numeric. (`metric_value` is `numeric`.)
- **AI writes:** the Grok pipeline typically writes `ai_insights`,
  `personal_baselines`, and job status server-side using the **service role
  key**, which bypasses RLS. Client reads use the anon key + RLS.
- **`ai_insights.report_id` is UNIQUE** — one analysis per report. Re-running
  the AI should `INSERT ... ON CONFLICT (report_id) DO UPDATE`.
- **Storage:** upload PDF reports to a private storage bucket (e.g.
  `reports`) and store the object path in `medical_reports.file_url`. Add
  storage bucket policies when you wire up uploads.

## Quick RLS sanity check

Run in the SQL Editor after applying both migrations (replace the UUIDs):

```sql
-- user_a uploads a report
insert into medical_reports (user_id, report_title, report_type)
values ('<user_a_uuid>', 'CBC Aug 2026', 'blood_test');

-- as user_b (set the role to their JWT), this must return 0 rows:
set role authenticated;
select * from medical_reports;
reset role;
```
