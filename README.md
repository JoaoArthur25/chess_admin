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

## Engine & license (CLAUDE.md §6 action items — resolved)

**License: Apache-2.0.** Verified against `LICENSE.txt` of the built version
(commit `7dca5c0`, 2026-05-20): *"The source code of BBP Pairings is released
under the Apache License, Version 2.0."* It is **not** GPL, so the copyleft
concern raised in CLAUDE.md does not arise at all. We additionally invoke it at
arm's length (separate process, not linked), so there is no combined work.

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

### Black-box validation (§8)

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

## Notes / known limitations
- `FakePairingEngine` is for dev/tests only. It is intentionally a naive greedy
  Swiss (score-group fold) and may force a rare late rematch — strict
  no-rematch/colour correctness is the **real** engine's job, now verified by
  the black-box simulation tests described above.
- Prisma is pinned to v5 on purpose. Do not bump across majors without testing.
