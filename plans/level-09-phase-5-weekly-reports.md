# Level 9 Phase 5: Weekly Progress Reports — Implementation Spec

> Status: Complete

## Context

The ROADMAP describes "Weekly progress reports with burndown charts" as the final Level 9 capability. Daily digests cover overnight activity, but there's no weekly summary showing trends across days — velocity, cost trajectory, per-project progress. Phase 5 adds weekly report generation with per-day completion counts (burndown data), a weekly scheduler, push notification, and API endpoints.

## What Was Built

- **`weekly_reports` table** — Stores generated reports with id, generated_at, week_start, week_end, report_text (markdown), report_json (structured), task_count, total_cost, viewed_at
- **`weeklyReportStmts`** — Prepared statements: insert, getLatest, getById, list, markViewed
- **`generateWeeklyReport(weekStart)`** — Aggregates 7 days of task/goal activity across all projects. Builds:
  - Per-project breakdown (tasks, cost, commits, goals completed)
  - Daily breakdown table (burndown data: completed + failed per day for 7 days)
  - Velocity comparison vs previous week with trend (up/down/stable)
  - One-line summary + full markdown report
  - Stores in `weekly_reports` table, broadcasts `weekly_report_ready` via WebSocket
- **`getISOWeek()` helper** — Calculates ISO week number for week-based gating
- **Weekly report scheduler** — Hourly `setInterval` gating on: ISO week number (prevent duplicate), day-of-week (default Sunday), hour (default 8:00 AM). Sends ntfy.sh push notification with first line. Startup check after 15s.
- **API endpoints**:
  - `GET /api/weekly-report/latest` — Returns latest report, marks as viewed, parses report_json
  - `POST /api/weekly-report/generate` — Force generation for last 7 days (or `?since=` param)
  - `GET /api/weekly-report/history` — List of past reports (last 20)

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Burndown data is retrospective (calculated from `completed_at` timestamps) rather than requiring a separate task history table — simpler, zero overhead
- Velocity trend uses 20% threshold (same as `/api/analytics`): >120% = up, <80% = down, else stable
- Weekly scheduler gates on ISO week number (not just date) to handle edge cases around year boundaries
- Configurable via `~/.claude-remote/config.json`: `weekly_report_day` (0=Sunday, default), `weekly_report_hour` (default 8)
- Goals completed count queries the `goals` table directly using `completed_at` and `status = 'completed'`

## Verification

1. `POST /api/weekly-report/generate` — verify report generated with per-project breakdown and daily burndown
2. `GET /api/weekly-report/latest` — verify returns structured report with text + JSON including daily_breakdown
3. `GET /api/weekly-report/history` — verify list of past reports
4. Verify `report_json.daily_breakdown` has 7 entries with date and completion counts
5. Verify scheduler gates on day-of-week and week number

## Drift Notes

None.
