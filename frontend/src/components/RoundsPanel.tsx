import { useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { PairingResult, Player, Round, Tournament, ValidationAlert } from '../types';
import { Card, ErrorNote } from './ui';
import EditPairings from './EditPairings';

const GAME_OPTIONS: { value: PairingResult; label: string }[] = [
  { value: 'PENDING', label: '— result —' },
  { value: 'WHITE_WIN', label: '1–0 (White)' },
  { value: 'DRAW', label: '½–½' },
  { value: 'BLACK_WIN', label: '0–1 (Black)' },
  { value: 'WHITE_WIN_FORFEIT', label: '+/− (Black W.O.)' },
  { value: 'BLACK_WIN_FORFEIT', label: '−/+ (White W.O.)' },
  { value: 'DOUBLE_FORFEIT', label: '−/− (Double W.O.)' },
];

const BYE_LABEL: Record<string, string> = {
  FULL_POINT_BYE: 'Bye (1)',
  HALF_POINT_BYE: 'Bye (½)',
  ZERO_POINT_BYE: 'Bye (0)',
};

export default function RoundsPanel({
  tournament: t,
  onChange,
}: {
  tournament: Tournament;
  onChange: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<ValidationAlert[]>([]);
  const byId = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of t.players) m.set(p.id, p);
    return m;
  }, [t.players]);

  const rounds = [...t.rounds].sort((a, b) => b.index - a.index);
  const latestIndex = rounds[0]?.index ?? 0;
  // Follow the latest round as new ones are generated (useState's initial value
  // would freeze on the round that existed when this panel first mounted).
  const [openRound, setOpenRound] = useState<number>(latestIndex);
  const [editingRound, setEditingRound] = useState<string | null>(null);
  const [trackedLatest, setTrackedLatest] = useState<number>(latestIndex);
  if (trackedLatest !== latestIndex) {
    setTrackedLatest(latestIndex);
    setOpenRound(latestIndex);
  }

  async function setResult(pairingId: string, result: PairingResult) {
    setError(null);
    try {
      const res = await api.enterResult(t.id, pairingId, result);
      setAlerts(res.alerts ?? []);
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save result');
    }
  }

  function name(id: string | null): string {
    if (!id) return '—';
    const p = byId.get(id);
    return p ? `${p.fullName}${p.fideTitle !== 'NONE' ? ` (${p.fideTitle})` : ''}` : id;
  }

  if (rounds.length === 0) {
    return (
      <Card className="p-6 text-sm text-slate-500">
        No rounds generated yet. Start the tournament and generate round 1.
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {error && <ErrorNote message={error} />}
      {alerts.length > 0 && (
        <div className="grid gap-1">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`rounded-md px-3 py-2 text-sm border ${
                a.severity === 'ERROR'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <span className="font-semibold">{a.severity}:</span> {a.message}
            </div>
          ))}
        </div>
      )}

      {rounds.map((r) => (
        <RoundBlock
          key={r.id}
          round={r}
          open={openRound === r.index}
          onToggle={() => setOpenRound(openRound === r.index ? -1 : r.index)}
          name={name}
          onResult={setResult}
          tournamentId={t.id}
          players={t.players}
          editing={editingRound === r.id}
          onEdit={() => setEditingRound(r.id)}
          onCancelEdit={() => setEditingRound(null)}
          onEdited={async () => {
            setEditingRound(null);
            await onChange();
          }}
        />
      ))}
    </div>
  );
}

function RoundBlock({
  round: r,
  open,
  onToggle,
  name,
  onResult,
  tournamentId,
  players,
  editing,
  onEdit,
  onCancelEdit,
  onEdited,
}: {
  round: Round;
  open: boolean;
  onToggle: () => void;
  name: (id: string | null) => string;
  onResult: (pairingId: string, result: PairingResult) => void;
  tournamentId: string;
  players: Player[];
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onEdited: () => Promise<void>;
}) {
  const games = r.pairings.filter((p) => p.blackId !== null);
  const byes = r.pairings.filter((p) => p.blackId === null);
  const done = r.pairings.filter((p) => p.result !== 'PENDING').length;
  // Re-pairing is only legal while no result has been entered.
  const canEdit = done === 0;

  return (
    <Card>
      <div className="w-full flex items-center gap-2 px-4 py-3">
        <button onClick={onToggle} className="flex items-center gap-2 text-left flex-1">
          <span className="font-semibold">Round {r.index}</span>
          <span className="text-xs text-slate-500">
            {done}/{r.pairings.length} results · {r.status}
          </span>
        </button>
        {open && canEdit && !editing && (
          <button
            onClick={onEdit}
            className="text-xs text-blue-600 hover:underline whitespace-nowrap"
          >
            Edit pairings
          </button>
        )}
        <button onClick={onToggle} className="text-slate-400" aria-label="Toggle round">
          {open ? '▾' : '▸'}
        </button>
      </div>

      {open && editing && (
        <EditPairings
          tournamentId={tournamentId}
          round={r}
          players={players}
          onDone={onEdited}
          onCancel={onCancelEdit}
        />
      )}

      {open && !editing && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-3 py-2 w-12">Bd</th>
                <th className="px-3 py-2">White</th>
                <th className="px-3 py-2">Black</th>
                <th className="px-3 py-2 w-44">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {games.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 text-slate-400 tabular-nums">{p.boardNumber}</td>
                  <td className="px-3 py-2">{name(p.whiteId)}</td>
                  <td className="px-3 py-2">{name(p.blackId)}</td>
                  <td className="px-3 py-2">
                    <select
                      value={p.result}
                      onChange={(e) => onResult(p.id, e.target.value as PairingResult)}
                      className="rounded border border-slate-300 px-2 py-1 text-sm w-full"
                    >
                      {GAME_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {byes.map((p) => (
                <tr key={p.id} className="bg-slate-50/50">
                  <td className="px-3 py-2 text-slate-400 tabular-nums">{p.boardNumber}</td>
                  <td className="px-3 py-2">{name(p.whiteId)}</td>
                  <td className="px-3 py-2 text-slate-400 italic" colSpan={1}>
                    bye
                  </td>
                  <td className="px-3 py-2 text-slate-600">{BYE_LABEL[p.result] ?? p.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
