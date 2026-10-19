#!/usr/bin/env bash
# Starts the local Supabase stack in CI, up to 3 attempts (2026-10-19): the
# images come from Supabase's public registry, which limits downloads from
# GitHub's shared runners ("toomanyrequests"), and the CLI's own retries
# are only seconds apart. Waits 30, then 60 seconds between attempts, and
# notes any retry in the job's summary. Also fetches pg_prove, the image
# db:test's `supabase test db` runs, so that step doesn't download it.
#
#   SUPABASE_EXCLUDE=... bash scripts/ci-supabase-start.sh
set -u
waits=(30 60)
note() { echo "$1"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- $1" >> "$GITHUB_STEP_SUMMARY"; }

for attempt in 1 2 3; do
  if supabase start -x "${SUPABASE_EXCLUDE:-}"; then
    [ "$attempt" -gt 1 ] && note "The local Supabase stack started on attempt $attempt of 3 (the image registry limited downloads)."
    # pg_prove, for db:test (not needed elsewhere, but cheap to have).
    for try in 1 2 3; do
      docker pull -q public.ecr.aws/supabase/pg_prove:3.36 >/dev/null 2>&1 && break
      [ "$try" -lt 3 ] && sleep "${waits[$((try - 1))]}"
    done
    exit 0
  fi
  if [ "$attempt" -lt 3 ]; then
    wait_s=${waits[$((attempt - 1))]}
    echo "::warning::supabase start failed (attempt $attempt of 3); trying again in ${wait_s}s."
    supabase stop --no-backup >/dev/null 2>&1 || true
    sleep "$wait_s"
  fi
done
note "The local Supabase stack didn't start after 3 attempts."
exit 1
