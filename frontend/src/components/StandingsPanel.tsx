import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { StandingRow, Tournament } from '../types';
import { Card, ColorHistory, ErrorNote, Spinner } from './ui';

const TB_SHORT: Record<string, string> = {
  BUCHHOLZ: 'BH',
  BUCHHOLZ_CUT1: 'BH-1',
  BUCHHOLZ_MEDIAN: 'BHM',
  SONNEBORN_BERGER: 'SB',
  PROGRESSIVE: 'Prog',
  ARO: 'ARO',
  WINS: 'Wins',
  DIRECT_ENCOUNTER: 'DE',
};

export default function StandingsPanel({
  tournament,
  readOnly = false,
}: {
  tournament: Tournament;
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<StandingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .standings(tournament.id)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Failed to load standings'));
    return () => {
      alive = false;
    };
  }, [tournament.id, tournament.rounds.length]);

  if (error) return <ErrorNote message={error} />;
  if (!rows) return <Spinner />;
  if (rows.length === 0)
    return <Card className="p-6 text-sm text-slate-500">No ranked players yet.</Card>;

  const tbCodes = rows[0]?.tieBreaks.map((x) => x.code) ?? [];

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-left">
          <tr>
            <th className="px-3 py-2 w-10">#</th>
            <th className="px-3 py-2">Player</th>
            {!readOnly && <th className="px-3 py-2">Colours</th>}
            <th className="px-3 py-2 text-right">Pts</th>
            {tbCodes.map((c) => (
              <th key={c} className="px-3 py-2 text-right" title={c}>
                {TB_SHORT[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.player.id} className={row.player.status === 'WITHDRAWN' ? 'opacity-50' : ''}>
              <td className="px-3 py-2 font-semibold tabular-nums">{row.rank}</td>
              <td className="px-3 py-2">
                <span className="font-medium">{row.player.fullName}</span>
                {row.player.fideTitle !== 'NONE' && (
                  <span className="ml-1 text-xs text-amber-700 font-semibold">
                    {row.player.fideTitle}
                  </span>
                )}
                <span className="ml-2 text-xs text-slate-400">{row.player.pairingRating}</span>
              </td>
              {!readOnly && (
                <td className="px-3 py-2">
                  <ColorHistory colors={row.colors} />
                </td>
              )}
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {row.points.toFixed(1)}
              </td>
              {row.tieBreaks.map((tb) => (
                <td key={tb.code} className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {Number.isInteger(tb.value) ? tb.value : tb.value.toFixed(1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
