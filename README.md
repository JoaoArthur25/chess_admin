# Chess Admin

Open-source, web-based, fully responsive **Swiss-system chess tournament manager**.
The polished UX of paid SaaS, the transparency and zero cost of free software, and
FIDE professional credibility by **delegating pairings to an officially endorsed
engine** (we never invent a pairing algorithm — see the architecture note below).

- **Open & free** — MIT licensed, no feature tiers, no paywalls, no telemetry.
- **Responsive** — works on phone, tablet, desktop.
- **FIDE-compliant** — built to the FIDE Handbook C.04 Dutch system (2025 edition,
  effective 2026-02-01); pairings produced by the `bbpPairings` reference engine.

## The one architectural rule

We do **not** implement Swiss pairing, colour allocation, or float selection.
That is delegated to a FIDE-endorsed engine behind the `PairingEngine` port. Our
job is everything *around* the engine: model the domain correctly, persist a
complete history, serialize/deserialize TRF(x), enforce business rules, and
provide the UI. If you feel tempted to write pairing logic — stop.

## Monorepo layout

```
backend/    Node + Express + TypeScript, Prisma (PostgreSQL), pairing engine adapters
frontend/   React + Vite + TypeScript + TailwindCSS (responsive-first)
```

## Build phases (status)

| Phase | Scope | Status |
|------|-------|--------|
| 1 | Foundation: schema, domain model, `PairingEngine` port + `FakePairingEngine` | ✅ |
| 2 | TRF(x) module: serializer + deserializer, round-trip tests | ✅ |
| 3 | Engine integration: `BbpPairingsEngine` wrapper (child-process + temp files) | ✅ |
| 4 | Lifecycle: create/register/run/results/next-round, state machine, REST API + UI | ✅ |
| 5 | Audit & validations: colour history, opponents matrix, bye/colour/rematch alerts | ✅ |
| 6 | Standings & tie-breaks (Buchholz, BH-1, median, SB, progressive, ARO, wins, DE), public view | ✅ |
| 7 | Polish: responsive passes, TRF export, docs; `JaVaFoEngine` adapter (future) | ✅ / future |

## Running it (no database required)

The backend defaults to an **in-memory repository** and the **deterministic fake
pairing engine**, so you can run the whole app with zero external dependencies.

```bash
# Terminal 1 — backend API (http://localhost:4000)
cd backend
npm install
npm run dev            # REPO=memory PAIRING_ENGINE=fake by default

# Terminal 2 — frontend (http://localhost:5173, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

Open the app, create a tournament, register players, **Start** (assigns the
Tournament Pairing Numbers), then **Generate round 1**, enter results, and
generate subsequent rounds. The public read-only standings live at
`/public/:id`.

### Tests & typecheck

```bash
cd backend && npm test        # 37 tests: TRF round-trip, fake engine, rules,
                              # state machine, tie-breaks, full lifecycle
cd backend && npm run typecheck
cd frontend && npm run typecheck
```

## Production: PostgreSQL + the real engine

```bash
# 1) Point at Postgres and run migrations
cd backend
cp .env.example .env          # set DATABASE_URL, REPO=prisma
npx prisma migrate dev --name init

# 2) Use the real FIDE engine
#    Build bbpPairings (https://github.com/BieremaBoyzProgramming/bbpPairings)
#    then set in .env:
#      PAIRING_ENGINE=bbp
#      PAIRING_ENGINE_PATH=/absolute/path/to/bbpPairings
npm run build && npm start
```

The engine is invoked **server-side only**, via `child_process.spawn` + temp
files. Exit codes are handled per the contract: `0` success, `1` = no valid
pairing for the round (a domain condition, surfaced as HTTP 409, not a crash),
other non-zero = engine error (stderr captured).

## Engine & license action items (from CLAUDE.md §6)

- `bbpPairings` is invoked at **arm's length** as a separate process (not linked),
  so even a GPL build is "mere aggregation" and does not impose copyleft on this
  codebase. **Before distributing**, verify `LICENSE.txt` of the exact engine
  version you ship and document it here.
- Pin the engine version and verify its CLI flags against its README — the
  adapter targets the `--dutch ... -p ... [-l ...]` / `-c` forms.

## Notes / known limitations

- Tie-break Buchholz-family values use the classic sum-of-opponents'-scores form.
  The FIDE "virtual opponent" adjustment for unplayed games (byes/forfeits) is a
  documented follow-up; it only affects ordering *within* already-tied groups.
- `FakePairingEngine` is for dev/tests only. It is intentionally a naive greedy
  Swiss (score-group fold) and may force a rare late rematch — strict
  no-rematch/colour correctness is the **real** engine's job, to be covered by
  black-box simulation tests once the binary is wired in.
- Prisma is pinned to v5 on purpose. Do not bump across majors without testing.
