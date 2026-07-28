import { useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { Player, Round, ValidationAlert } from '../types';
import { Button, ErrorNote } from './ui';

interface Row {
  whiteId: string;
  blackId: string | null;
}

/**
 * Manual re-pairing (§5). The engine still owns automatic pairing; this is the
 * arbiter override. The backend re-validates everything — this UI only makes
 * the intent easy to express and surfaces the alerts it gets back.
 */
export default function EditPairings({
  tournamentId,
  round,
  players,
  onDone,
  onCancel,
}: {
  tournamentId: string;
  round: Round;
  players: Player[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(
    round.pairings.map((p) => ({ whiteId: p.whiteId, blackId: p.blackId })),
  );
  const [alerts, setAlerts] = useState<ValidationAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsAck, setNeedsAck] = useState(false);

  /** Players that belong to this round — the only legal pool for an edit. */
  const pool = useMemo(() => {
    const ids = new Set<string>();
    for (const p of round.pairings) {
      ids.add(p.whiteId);
      if (p.blackId) ids.add(p.blackId);
    }
    return players
      .filter((p) => ids.has(p.id))
      .sort((a, b) => (a.startingRank ?? 0) - (b.startingRank ?? 0));
  }, [round.pairings, players]);

  /** Swap a slot's occupant with wherever the chosen player currently sits. */
  function assign(rowIndex: number, slot: 'whiteId' | 'blackId', playerId: string) {
    setNeedsAck(false);
    setAlerts([]);
    setRows((prev) => {
      const next = prev.map((r) => ({ ...r }));
      const target = next[rowIndex]!;
      const displaced = target[slot];
      // Byes have no occupant to swap back, and the UI never offers a select
      // for them — nothing sensible to do.
      if (displaced === null || displaced === playerId) return prev;

      // Put the displaced player wherever the chosen one currently sits.
      outer: for (let i = 0; i < next.length; i += 1) {
        for (const s of ['whiteId', 'blackId'] as const) {
          if (next[i]![s] === playerId) {
            next[i]![s] = displaced;
            break outer;
          }
        }
      }
      target[slot] = playerId;
      return next;
    });
  }

  async function save(acknowledge: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setRoundPairings(tournamentId, round.id, rows, acknowledge);
      setAlerts(res.alerts ?? []);
      if (res.applied) {
        await onDone();
      } else {
        setNeedsAck(true);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const body = e.body as { alerts?: ValidationAlert[] } | undefined;
        setAlerts(body?.alerts ?? []);
      } else {
        setError('Could not save pairings');
      }
    } finally {
      setBusy(false);
    }
  }

  const label = (p: Player) =>
    `${p.startingRank ?? '–'}. ${p.fullName}${p.fideTitle !== 'NONE' ? ` (${p.fideTitle})` : ''}`;

  return (
    <div className="border-t border-slate-100 p-3 bg-amber-50/40">
      <p className="text-xs text-slate-600 mb-3">
        Pick a player to place them in that slot — whoever was there swaps into their old
        spot, so the round always keeps the same players.
      </p>

      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {alerts.length > 0 && (
        <div className="grid gap-1 mb-3">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`rounded-md px-3 py-2 text-sm border ${
                a.severity === 'ERROR'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              <span className="font-semibold">{a.severity}:</span> {a.message}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-500 text-left">
            <tr>
              <th className="px-2 py-1 w-10">Bd</th>
              <th className="px-2 py-1">White</th>
              <th className="px-2 py-1">Black</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                <td className="px-2 py-1">
                  <select
                    value={row.whiteId}
                    onChange={(e) => assign(i, 'whiteId', e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1"
                  >
                    {pool.map((p) => (
                      <option key={p.id} value={p.id}>
                        {label(p)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  {row.blackId === null ? (
                    <span className="text-slate-400 italic">bye</span>
                  ) : (
                    <select
                      value={row.blackId}
                      onChange={(e) => assign(i, 'blackId', e.target.value)}
                      className="w-full rounded border border-slate-300 px-2 py-1"
                    >
                      {pool.map((p) => (
                        <option key={p.id} value={p.id}>
                          {label(p)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <Button onClick={() => save(needsAck)} disabled={busy}>
          {busy ? 'Saving…' : needsAck ? 'Save anyway' : 'Save pairings'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {needsAck && (
          <span className="self-center text-xs text-amber-800">
            Review the warnings above, then confirm.
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Pairings come from the FIDE engine. Overriding them is your call as arbiter —
        rematches and illegal byes are still refused.
      </p>
    </div>
  );
}
