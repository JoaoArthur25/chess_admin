import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Tournament } from '../types';
import { Card, ErrorNote, Spinner } from './ui';

/** Opponents matrix (§5): cell shows the round two seeds met, or blank. */
export default function MatrixPanel({ tournament }: { tournament: Tournament }) {
  const [data, setData] = useState<{ ranks: number[]; cells: (number | null)[][] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .matrix(tournament.id)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Failed to load matrix'));
    return () => {
      alive = false;
    };
  }, [tournament.id, tournament.rounds.length]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Spinner />;
  if (data.ranks.length === 0)
    return <Card className="p-6 text-sm text-slate-500">No ranked players yet.</Card>;

  return (
    <Card className="overflow-auto">
      <p className="px-3 pt-3 text-xs text-slate-500">
        Each cell shows the round in which two seeds met. Used to prevent rematches.
      </p>
      <table className="text-xs m-3 border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white p-1" />
            {data.ranks.map((r) => (
              <th key={r} className="p-1 text-slate-400 font-medium w-7 text-center">
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.ranks.map((rowRank, i) => (
            <tr key={rowRank}>
              <th className="sticky left-0 bg-white p-1 text-slate-400 font-medium text-right pr-2">
                {rowRank}
              </th>
              {data.ranks.map((_colRank, j) => {
                const v = data.cells[i]?.[j] ?? null;
                const diagonal = i === j;
                return (
                  <td
                    key={j}
                    className={`h-7 w-7 text-center border border-slate-100 ${
                      diagonal
                        ? 'bg-slate-200'
                        : v != null
                          ? 'bg-emerald-100 text-emerald-800 font-semibold'
                          : ''
                    }`}
                  >
                    {diagonal ? '' : (v ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
