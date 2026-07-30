## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily as needed. See `docs/agents/domain.md`.

## Git

Never stage or commit files under `.scratch/`. Issue/spec files there are working notes, not shipped code — implementation commits should only include the actual source/test changes.
