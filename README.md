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
cd backend && npm test        # 106 tests: TRF round-trip, engine adapters, rules,
                              # state machine, tie-breaks, auth, sessions, lifecycle
cd backend && npm run typecheck
cd frontend && npm run typecheck
```

Tests run against the in-memory repository on purpose, so they stay fast and
need no database. The black-box tests against the real engine skip themselves
when the binary is absent.

## Security

**Sessions.** A short-lived access token lives **only in the page's memory** —
never `localStorage` or `sessionStorage`, so an injected script has nothing to
read. The long-lived refresh token is an **httpOnly cookie** (`Secure` in
production, `SameSite=Lax`, scoped to `/api/auth`), invisible to JavaScript. It
is **rotated on every use**; replaying a rotated token is refused, and if the
replay arrives long after the rotation — no longer explainable as two tabs
racing — every session for that account is revoked. Logout revokes server-side,
so the old cookie is dead.

Reloading the page restores the session from the cookie, so an F5 does not sign
you out.

**Hardening.** `helmet` sets CSP, HSTS, `nosniff`, frame and referrer policies.
CORS names exact origins (`CORS_ORIGIN`) with credentials. Credential routes —
login, register, forgot and reset password — are rate limited to 20 attempts per
15 minutes per IP. Expired tokens are swept hourly.

**Production refuses to boot** without `AUTH_SECRET`, `CORS_ORIGIN`, `APP_URL`,
`SMTP_HOST` (and `DATABASE_URL` when using Prisma). Starting in a weakened state
is worse than not starting.

Set `TRUST_PROXY=true` behind a reverse proxy, or the rate limiter sees the
proxy's IP for everyone. Set `ALLOW_REGISTRATION=false` to close sign-up once the
club's accounts exist.

> Upgrading from an older deployment signs everyone out once — sessions moved
> from `localStorage` to cookies. The old key is cleared automatically on load.

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

### Forgotten passwords

*Forgot your password?* on the sign-in screen e-mails a single-use link valid
for one hour. Only a SHA-256 hash of the token is stored, so a database leak
does not let anyone reset an account, and the endpoint answers identically
whether or not the address is registered so it cannot be used to discover which
e-mails have accounts.

Completing a reset **signs out every session opened before it** — otherwise
resetting because someone got in would leave their session alive.

**Without `SMTP_HOST`, the link is printed to the server log instead of being
sent.** That is workable for a single arbiter running the app on a laptop, but
it means anyone who can read the logs can take over any account: configure SMTP
(`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) before other
people have accounts. `APP_URL` must point at the frontend so the links work.

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

**Pin a published release.** A binary built from the working tree identifies
itself as *non-release build* and cannot be named by version — unsuitable for a
rated event, where the arbiter must be able to state which build produced the
pairings. Check out the tag:

```bash
pacman -S --needed --noconfirm mingw-w64-x86_64-gcc make git
cd /c/Trabalhos-Dev && git clone https://github.com/BieremaBoyzProgramming/bbpPairings.git
cd bbpPairings && git checkout v6.0.0 && make COMP=gcc
```

v6.0.0 (2026-02-01) is the release carrying the 2025 Dutch rules, effective the
same date. Running the binary with no arguments prints the version — the app
reads that banner and reports it with every conformity check.

### Cross-validation against JaVaFo

C.04.2 requires that different approved programs arrive at **identical**
pairings. Satisfying the FIDE invariants (no rematches, colour rules, byes) is a
weaker claim than matching what a reference implementation produces, so a second
endorsed engine is wired in purely to check that stronger claim.

```bash
mkdir -p /c/Trabalhos-Dev/javafo
curl -o /c/Trabalhos-Dev/javafo/javafo.jar http://www.rrweb.org/javafo/current/javafo.jar
# then set JAVAFO_PATH; a JRE is required
```

`tests/crossValidation.test.ts` plays whole tournaments, pairing every round
with both engines and comparing board by board. It skips unless both are
installed. JaVaFo can also drive the app directly (`PAIRING_ENGINE=javafo`).

**Result, and the caveat that matters.** On **even fields the two agree on every
board of every round** — verified across five full events (8 to 16 players).
That is what validates *our* side: the TRF we emit, the history we model, the
output we parse. A mismatch there would mean a bug in this codebase.

On **odd fields they diverge at the pairing-allocated bye**, because they
implement **different editions of the Dutch rules**:

| Engine | Build | Rules edition |
|--------|-------|---------------|
| bbpPairings | v6.0.0 (2026-02-01) | 2025 Dutch rules |
| JaVaFo | 2.2 (circa 2018) | preceding edition |

`rrweb.org/javafo/current` still serves 2.2, so there is no JaVaFo build on the
2025 rules. The consequence is worth stating plainly: **cross-validation with
JaVaFo cannot confirm conformance to the 2026 bye rule** — only that everything
else lines up. The test asserts the divergence is confined to the bye and fails
loudly if the engines ever agree on the bye and still differ elsewhere, which
would point back at us.

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

### Submitting for rating

An arbiter does **not** upload to FIDE directly. The chief arbiter hands the TRF
to the **Rating Officer of the federation** where the event took place, and that
officer uploads it to the FIDE Rating Server. There is therefore no public FIDE
importer you can test a file against — the closest equivalent is asking your
federation's Rating Officer to look at a sample, which they do routinely.

Two things worth knowing before running a rated event:

- **The deadline is strict.** The report must arrive in time for the rating list
  the tournament was registered for. If it misses the third list after the event
  ends, it is not rated at all.
- **The Rating Officer can reject the event** (Rating Regulations art. 9.1) if it
  does not meet the required standards.

**Format: we target TRF16 on purpose.** TRF16 is accepted by every federation;
TRF25 (2025) is newer and federations must be asked before it is used. TRF25
mostly adds team-tournament support and in-tournament data exchange, and
standardises as `142`/`152` what are still the `XXR`/`XXC` extension lines here —
none of which affects an individual Swiss event. Moving to TRF25 is a deliberate
future choice, not a gap.

To sanity-check an export without involving the federation, open it in
Swiss-Manager, Vega, a TRF editor, or upload it to chess-results.

### FIDE conformity check

C.04.2 expects an endorsed system to ship a checker able to verify tournaments
run with it. The *Details* tab has a **Run check** button that feeds the whole
event through the engine's own checker (`--dutch … -c`) and reports any
discrepancy, along with the engine build that produced the pairings.

Run it before submitting a report. A clean result means the engine found no rule
violation in what it can verify — it is **not** a FIDE certification of this
application, and does not replace the federation's review.

**Chess Admin is not itself a FIDE-endorsed program.** The pairings come from an
endorsed engine, which is a strong guarantee for the pairings themselves, but the
layer around it — seeding, history, TRF serialisation — is ours, and that is
exactly where our own bugs have been found. Reproducibility against another
endorsed program has not yet been verified; see *Known limitations*.

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

- **Reproducibility is verified only on even fields.** Cross-validation against
  JaVaFo matches board for board across full events with no bye, but the two
  engines follow different editions of the Dutch rules, so odd fields cannot be
  compared. See *Cross-validation* above.
- **Chess Admin is not an endorsed program.** It delegates to one, but FIDE
  endorses programs, not wrappers; it does not appear in C.04 Annex 3.
- **TRF export has not been read by a third-party tool.** It is validated
  against the pairing engine, which is strong, but not against Swiss-Manager,
  Vega or a federation's own tooling. This is the largest conformance gap — see
  *Submitting for rating* above for how to close it.
- **The Prisma adapter has no automated tests.** It has been exercised end to
  end by hand, but the queries themselves lack integration tests.
- **Simulation scale is modest.** The black-box tests cover dozens of
  tournaments; FIDE's endorsement process uses thousands. The harness is in
  place to scale up.
- **Rate limiting is per-process and in-memory.** It resets on restart and is
  not shared across instances; a horizontally scaled deployment needs a shared
  store (Redis) for the limiter to mean anything.
- **No audit log.** Sign-ins, password changes and tournament edits are not
  recorded, so there is no trail if a result is disputed.
- **Manual pairing is swap-only.** The arbiter can rearrange players across
  boards but cannot yet assign a bye by hand or flip colours directly.
- **The rating report has never been through a real submission.** The header
  lines follow the TRF16 spec and the file is accepted by the pairing engine,
  but no federation Rating Officer has yet processed one.
- **Acceleration is unused.** The serializer supports `XXA` lines and the schema
  reserves a field, but nothing drives it (only relevant for large events).
- **No production infrastructure.** No CI/CD, hosting, HTTPS or backup routine.
- `FakePairingEngine` is for dev/tests only. It is intentionally a naive greedy
  Swiss (score-group fold) and may force a rare late rematch — strict
  no-rematch/colour correctness is the **real** engine's job.
- Prisma is pinned to v5 on purpose. Do not bump across majors without testing.
