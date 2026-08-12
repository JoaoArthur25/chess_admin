import { useState } from 'react';
import { api, ApiError } from '../api';
import type { ConformityCheck, Tournament } from '../types';
import { Button, Card, ErrorNote } from './ui';

/**
 * Runs the engine's pairing-checker over the whole event.
 *
 * FIDE C.04.2 expects an endorsed system to ship a checker able to verify
 * tournaments run with it — this exposes exactly that, so the arbiter can
 * confirm conformity before submitting, and record which engine build produced
 * the pairings.
 */
export default function ConformityPanel({ tournament: t }: { tournament: Tournament }) {
  const [result, setResult] = useState<ConformityCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.checkTournament(t.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not run the check');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const incomplete = result && !result.finished;

  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-1">FIDE conformity check</h3>
      <p className="text-sm text-slate-600 mb-3">
        Runs the pairing engine's own checker over every round of this tournament.
        Run it before submitting the report to your federation.
      </p>

      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      <Button onClick={run} disabled={busy}>
        {busy ? 'Checking…' : result ? 'Run check again' : 'Run check'}
      </Button>

      {result && (
        <div className="mt-4 grid gap-3">
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              result.ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-red-300 bg-red-50 text-red-800'
            }`}
          >
            <strong>
              {result.ok
                ? 'No discrepancies found.'
                : `${result.discrepancies.length} discrepancy(ies) reported.`}
            </strong>{' '}
            Rounds checked: {result.roundsPlayed} of {result.roundsScheduled}.
          </div>

          {incomplete && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-md px-3 py-2">
              The tournament is not finished, so this is a partial check. Run it
              again once every round has been played.
            </p>
          )}

          {!result.ok && (
            <ul className="grid gap-1 text-sm">
              {result.discrepancies.map((d, i) => (
                <li key={i} className="rounded border border-red-200 bg-white px-3 py-1.5">
                  {d.roundIndex != null && (
                    <span className="font-semibold">Round {d.roundIndex}: </span>
                  )}
                  {d.message}
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="font-semibold text-slate-700 mb-1">Pairing engine used</div>
            <div className="font-mono text-xs text-slate-700 break-all">
              {result.engine.version}
            </div>
            {result.engine.isEndorsedRelease ? (
              <p className="text-xs text-emerald-800 mt-1">
                Published release — record this version with the tournament report.
              </p>
            ) : (
              <p className="text-xs text-amber-900 mt-1">
                <strong>Not a published release.</strong> This build cannot be
                identified by version, so it is unsuitable for a rated event. Install
                a released binary and point <code>PAIRING_ENGINE_PATH</code> at it.
              </p>
            )}
          </div>

          <p className="text-xs text-slate-500">
            A clean check means the engine found no rule violation in the pairings it
            can verify. It is not a FIDE certification of this application, and it
            does not replace your federation's own review.
          </p>
        </div>
      )}
    </Card>
  );
}
