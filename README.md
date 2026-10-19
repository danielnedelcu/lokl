# lokl

A local Services and Experiences marketplace, starting in Atlanta.
Providers list and get paid through Stripe Connect; lokl earns a
commission per booking, and destination guides bring people to listings.

Two Nuxt apps in one Turborepo: the public website with the providers'
dashboard (`apps/website`, port 3100), and the owner's admin app
(`apps/admin`, port 3101), on Supabase (Postgres with row-level security)
and Stripe Connect.

## Branching and releases

`main` is production, and it is protected: a pull request is required,
the four status checks must pass (`checks`, `database`, `e2e`, `stripe`),
and there is no bypassing them. Required approvals are off until a second
engineer joins.

Every change is a feature branch off `main`, merged through a PR; the
branch is deleted after the merge. There is no long-lived development
branch. Once hosting is connected, a preview of both apps for each PR is
where a change is tried before it merges, and a preview never uses the
production database's keys (`docs/deployment.md`, decision 1), so
previews stay off until a separate staging Supabase project exists.

## Working on it

```bash
npm install
npm run db:start      # the local Supabase stack
npm run dev           # both apps
npm run check:quick   # the checks your change needs, while working
npm run check:full    # every check, before pushing a branch
```

## Where to look next

| For | Read |
| --- | --- |
| conventions, in force | `CLAUDE.md` |
| how a change reaches production | `docs/deployment.md` |
| how the system fits together | `docs/architecture.md` |
| building UI | `docs/frontend.md` |
| what's done and what's next | `docs/TODO.md` |
| settled decisions and why | `docs/decisions.md` |
| why a feature is shaped the way it is | `docs/design/*.md` |
| the current schema, per table | `docs/schema/` (generated) |
