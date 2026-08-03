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
| 1 | Foundation: schema, domain model, `PairingEngine` port + `FakePairingEngine`, auth | ✅ |
| 2 | TRF(x) module: serializer + deserializer, round-trip tests | ✅ |
| 3 | Engine integration: `BbpPairingsEngine` wrapper (child-process + temp files) | ✅ |
| 4 | Lifecycle: create/register/run/results/next-round, state machine, REST API + UI | ✅ |
| 5 | Audit & validations: colour history, opponents matrix, bye/colour/rematch alerts | ✅ |
| 6 | Standings & tie-breaks (Buchholz + FIDE virtual opponent, BH-1, median, SB, progressive, ARO, wins, DE), public view | ✅ |
| 7 | Polish: responsive passes, TRF export, docs; `JaVaFoEngine` adapter (future) | ✅ / future |

## Running it (no database required)

The backend defaults to an **in-memory repository** and the **deterministic fake
pairing engine**, so you can run the whole app with zero external dependencies.

```bash
# Terminal 1 — backend API (http://localhost:4000)
cd backend
npm install
npm run dev            # REPO=memory PAIRING_ENGINE=fake by default

# Terminal 2 — frontend (http://localhost:5183, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

Open the app, create a tournament, register players, **Start** (assigns the
Tournament Pairing Numbers), then **Generate round 1**, enter results, and
generate subsequent rounds. The public read-only standings live at
`/public/:id`.

The frontend port is pinned (`strictPort`) so it never silently moves to
another one.

### Tests & typecheck

```bash
cd backend && npm test        # 72 tests: TRF round-trip, engine adapters, rules,
                              # state machine, tie-breaks, auth, lifecycle
cd backend && npm run typecheck
cd frontend && npm run typecheck
```

Tests run against the in-memory repository on purpose, so they stay fast and
need no database. The black-box tests against the real engine skip themselves
when the binary is absent.

## Accounts & permissions

Arbiters register at the login screen (e-mail + password, min 8 chars). Passwords
are hashed with scrypt; session tokens are HMAC-SHA256 signed with a fixed
algorithm (no JWT header parsing, so algorithm-confusion attacks don't apply).

| Area | Who |
|------|-----|
| Standings, pairings, matrix, TRF export (read) | **Anyone** — no account, so players/spectators can check from a phone |
| Creating/running tournaments, entering results | The **owning arbiter** only |

A tournament belongs to the arbiter who created it. Requests for someone else's
event return **404** rather than 403, so the API never confirms which ids exist
to a non-owner.

**`AUTH_SECRET` is mandatory in production** — the server refuses to start
without it rather than falling back to a built-in default. In development a
random per-process secret is used, so sessions reset when you restart.

### Configuration

Copy `backend/.env.example` to `backend/.env` and fill it in. Generate a secret
with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The file is read by `src/loadEnv.ts`, imported first in the entrypoint. On boot
the server prints the repository and engine it resolved:

```
Chess Admin API listening on http://localhost:4000
  repository: memory     <- or "prisma"
  engine:     fake       <- or "bbp"
```

**Check that line against what you configured.** A `.env` that is present but
not being read is easy to miss, and the app keeps working — just with the
in-memory store and the fake engine instead of what you asked for.

## Running with PostgreSQL (data survives restarts)

The in-memory repository loses everything when the process stops — fine for a
demo, not for a real event. For persistence:

```bash
docker compose up -d
```

That starts Postgres 16 on host port **5433** (deliberately not 5432, so it
cannot collide with another local Postgres) with a named volume, so data
outlives the container. Then in `backend/.env`:

```
REPO=prisma
DATABASE_URL=postgresql://chess:chess@localhost:5433/chess_admin?schema=public
```

Apply the schema and start:

```bash
cd backend && npx prisma migrate deploy && npm run dev
```

Use `migrate dev` instead of `deploy` when you change `schema.prisma` and want a
new migration generated. On boot the server prints the repository and engine it
resolved — confirm it says `repository: prisma`.

Stop with `docker compose down` (keeps data) or `docker compose down -v` (wipes
the volume).

Optionally seed a demo arbiter and tournament:

```bash
cd backend && npm run seed
```

That prints the credentials to sign in with (`demo@chess-admin.local`).

### Backup and restore

Take a backup before and after each event. Writing through stdout avoids any
path translation issues on Windows shells:

```bash
docker exec chess-admin-db pg_dump -U chess -d chess_admin -Fc > backup.dump
```

Restore into a fresh database:

```bash
docker exec -i chess-admin-db pg_restore -U chess -d chess_admin --clean < backup.dump
```

**Rehearse the restore before you rely on it.** A backup you have never
restored is a guess, not a backup — restore into a scratch database
(`CREATE DATABASE restore_test OWNER chess;`) and confirm the tournaments and
player counts are what you expect.

### The real FIDE engine

Build `bbpPairings` (see below), then in `backend/.env`:

```
PAIRING_ENGINE=bbp
PAIRING_ENGINE_PATH=/absolute/path/to/bbpPairings.exe
```

The engine is invoked **server-side only**, via `child_process.spawn` + temp
files. Exit codes are handled per the contract: `0` success, `1` = no valid
pairing for the round (a domain condition, surfaced as HTTP 409, not a crash),
other non-zero = engine error (stderr captured).

## Engine & license

**License: Apache-2.0.** Verified against `LICENSE.txt` of the built version
(commit `7dca5c0`, 2026-05-20): *"The source code of BBP Pairings is released
under the Apache License, Version 2.0."* It is **not** GPL, so no copyleft
obligation reaches this codebase. We additionally invoke it at arm's length
(separate process, not linked), so there is no combined work.

**CLI contract: verified against the real binary.** The adapter's
`--dutch <in> -p <out>` and `-c` forms work as documented, and the `-p` output
format (`<count>` then `<white> <black>` lines, `0` = bye) parses correctly.

### Building the engine (Windows / MSYS2)

```bash
pacman -S --needed --noconfirm mingw-w64-x86_64-gcc make git
cd /c/Trabalhos-Dev && git clone https://github.com/BieremaBoyzProgramming/bbpPairings.git
cd bbpPairings && make COMP=gcc     # produces bbpPairings.exe
```

Then set `PAIRING_ENGINE=bbp` and `PAIRING_ENGINE_PATH=<abs path>/bbpPairings.exe`.
Keep the engine **outside** this repository — it is a separate program with its
own license, and that separation is what keeps the two works independent.

### Black-box validation

`tests/realEngine.test.ts` runs full tournaments through the real engine and
asserts the FIDE invariants on every round: no rematches, colour difference
within |2|, never the same colour three times running, at most one bye per
player, everyone paired exactly once per round. It **skips automatically** when
the binary is absent, so the suite still passes on a machine without it.

One case worth knowing: a small field can legitimately dead-end. With 6 players,
the not-yet-played graph after 3 rounds can be two disjoint triangles — a
2-regular graph with no perfect matching, so a 4th round is impossible without a
rematch. The engine exits 1 and we surface **409**, never a crash. That path is
covered by a test.

## Running a tournament in the hall

**Printable sheets.** Every round has a *Print board list* link, and the header
has *Print standings*. Both open a plain black-on-white sheet at `/print/:id`
with a Print button; the app chrome is hidden by the print stylesheet. These
pages are **public**, so you can print from any device at the venue without
signing in.

**FIDE rating report.** The *Details* tab collects the administrative data the
federation needs — city, federation, end date, tournament type, chief arbiter,
deputy arbiters and time control. It shows a readiness banner listing whatever
is still missing. The fields are optional: a club event runs and exports fine
without them, and nothing is ever blocked over them. *Export TRF(x)* downloads
the report; when the data is complete it carries header lines `012`–`122`.

## Manual pairing (arbiter override)

The engine owns automatic pairing. When an arbiter must override it, open a
round that has **no results yet** and use *Edit pairings*: choosing a player for
a slot swaps them with whoever was there, so the round always keeps exactly the
same players. The backend re-validates every change and

- **refuses** (409) rematches and illegal byes,
- **refuses** (400) dropping or duplicating a player,
- **refuses** (409) re-pairing a round that already has results,
- **returns colour warnings unapplied** (same colour 3× running, colour
  difference beyond |2|) until the arbiter explicitly confirms.

## Known limitations

Documented honestly — none of these compromise the architecture, but they matter
before running an officially rated event.

- **The local engine build is not an official release.** It is compiled from
  source and identifies itself as a *non-release build*. For a rated tournament,
  pin a published release of bbpPairings.
- **TRF export has not been read by a third-party tool.** It is validated
  against the pairing engine, which is strong, but not against Swiss-Manager or
  Vega, nor against official FIDE sample tournaments; the exact edition (TRF16
  vs TRF25) is not formally confirmed. This is the largest conformance gap.
- **The Prisma adapter has no automated tests.** It has been exercised end to
  end by hand, but the queries themselves lack integration tests.
- **Simulation scale is modest.** The black-box tests cover dozens of
  tournaments; FIDE's endorsement process uses thousands. The harness is in
  place to scale up.
- **Sessions cannot be revoked.** Tokens last 12 hours and sign-out is
  client-side only — there is no revocation list or silent refresh.
- **Manual pairing is swap-only.** The arbiter can rearrange players across
  boards but cannot yet assign a bye by hand or flip colours directly.
- **The rating report is not machine-validated against FIDE.** The header lines
  are emitted per the TRF spec and the file is accepted by the pairing engine,
  but it has not been submitted to a federation nor checked by FIDE's own
  importer.
- **Acceleration is unused.** The serializer supports `XXA` lines and the schema
  reserves a field, but nothing drives it (only relevant for large events).
- **No production infrastructure.** No CI/CD, hosting, HTTPS or backup routine.
- `FakePairingEngine` is for dev/tests only. It is intentionally a naive greedy
  Swiss (score-group fold) and may force a rare late rematch — strict
  no-rematch/colour correctness is the **real** engine's job.
- Prisma is pinned to v5 on purpose. Do not bump across majors without testing.
