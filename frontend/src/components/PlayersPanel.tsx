import { useState } from 'react';
import { api, ApiError } from '../api';
import type { FideTitle, PlayerStatus, Sex, Tournament } from '../types';
import { Button, Card, ErrorNote, StatusBadge } from './ui';

const TITLES: FideTitle[] = ['NONE', 'GM', 'IM', 'WGM', 'FM', 'WIM', 'CM', 'WFM', 'WCM'];
const STATUSES: PlayerStatus[] = ['ACTIVE', 'WITHDRAWN', 'PAUSED', 'LATE_ENTRY'];

export default function PlayersPanel({
  tournament: t,
  onChange,
}: {
  tournament: Tournament;
  onChange: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    sex: 'M' as Sex,
    fideTitle: 'NONE' as FideTitle,
    pairingRating: 1500,
    federation: '',
    fideId: '',
  });

  const draft = t.state === 'DRAFT';

  async function addPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return;
    setError(null);
    try {
      await api.addPlayer(t.id, {
        fullName: form.fullName.trim(),
        sex: form.sex,
        fideTitle: form.fideTitle,
        pairingRating: form.pairingRating,
        federation: form.federation || null,
        fideId: form.fideId || null,
      });
      setForm({ ...form, fullName: '', fideId: '' });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add player');
    }
  }

  async function changeStatus(playerId: string, status: PlayerStatus) {
    setError(null);
    try {
      await api.updatePlayer(t.id, playerId, { status });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update player');
    }
  }

  const sorted = [...t.players].sort(
    (a, b) => (a.startingRank ?? 9999) - (b.startingRank ?? 9999) || b.pairingRating - a.pairingRating,
  );

  return (
    <div className="grid gap-4">
      {error && <ErrorNote message={error} />}

      {draft && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Register player</h3>
          <form onSubmit={addPlayer} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2 lg:col-span-2"
              placeholder="Full name (Last, First)"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
            <select
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={form.sex}
              onChange={(e) => setForm({ ...form, sex: e.target.value as Sex })}
            >
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
            <select
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={form.fideTitle}
              onChange={(e) => setForm({ ...form, fideTitle: e.target.value as FideTitle })}
            >
              {TITLES.map((tt) => (
                <option key={tt} value={tt}>
                  {tt}
                </option>
              ))}
            </select>
            <input
              type="number"
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Rating"
              value={form.pairingRating}
              onChange={(e) => setForm({ ...form, pairingRating: Number(e.target.value) })}
            />
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="FED"
              maxLength={3}
              value={form.federation}
              onChange={(e) => setForm({ ...form, federation: e.target.value.toUpperCase() })}
            />
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm lg:col-span-5"
              placeholder="FIDE ID (optional)"
              value={form.fideId}
              onChange={(e) => setForm({ ...form, fideId: e.target.value })}
            />
            <Button type="submit">Add</Button>
          </form>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-3 py-2 w-10">#</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2 text-right">Rating</th>
              <th className="px-3 py-2">FED</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((p) => (
              <tr key={p.id} className={p.status === 'WITHDRAWN' ? 'opacity-50' : ''}>
                <td className="px-3 py-2 text-slate-400">{p.startingRank ?? '–'}</td>
                <td className="px-3 py-2 font-medium">
                  {p.fullName}
                  {p.sex === 'F' && <span className="ml-1 text-pink-500" title="Woman">♀</span>}
                </td>
                <td className="px-3 py-2">{p.fideTitle === 'NONE' ? '' : p.fideTitle}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.pairingRating}</td>
                <td className="px-3 py-2 text-slate-500">{p.federation}</td>
                <td className="px-3 py-2">
                  {draft ? (
                    <StatusBadge status={p.status} />
                  ) : (
                    <select
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                      value={p.status}
                      onChange={(e) => changeStatus(p.id, e.target.value as PlayerStatus)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
            {t.players.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  No players registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
