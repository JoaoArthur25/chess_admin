import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Player, StandingRow, Tournament } from '../types';

const RESULT_LABEL: Record<string, string> = {
  PENDING: '',
  WHITE_WIN: '1 - 0',
  BLACK_WIN: '0 - 1',
  DRAW: '½ - ½',
  WHITE_WIN_FORFEIT: '+ / -',
  BLACK_WIN_FORFEIT: '- / +',
  DOUBLE_FORFEIT: '- / -',
  FULL_POINT_BYE: 'bye (1)',
  HALF_POINT_BYE: 'bye (½)',
  ZERO_POINT_BYE: 'bye (0)',
};

/**
 * Printable sheets for the playing hall: the round's board list and the
 * standings. Public on purpose — the arbiter prints from whatever device is at
 * hand, and posting these on the wall is the point.
 *
 * Layout is plain black-on-white; `print.css` hides the app chrome.
 */
export default function PrintView() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const roundParam = params.get('round');
  const kind = params.get('view') === 'standings' ? 'standings' : 'round';

  const [t, setT] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<StandingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getTournament(id)
      .then(setT)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'));
    if (kind === 'standings') {
      api.standings(id).then(setStandings).catch(() => setStandings([]));
    }
  }, [id, kind]);

  const byId = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of t?.players ?? []) m.set(p.id, p);
    return m;
  }, [t]);

  if (error) return <p className="p-6 text-red-700">{error}</p>;
  if (!t) return <p className="p-6">Loading…</p>;

  const round =
    kind === 'round'
      ? [...t.rounds].sort((a, b) => b.index - a.index).find(
          (r) => (roundParam ? r.index === Number(roundParam) : true),
        )
      : undefined;

  const name = (pid: string | null) => {
    if (!pid) return '—';
    const p = byId.get(pid);
    if (!p) return pid;
    return `${p.fullName}${p.fideTitle !== 'NONE' ? ` (${p.fideTitle})` : ''}`;
  };
  const rating = (pid: string | null) => (pid ? (byId.get(pid)?.pairingRating ?? '') : '');

  return (
    <div className="print-sheet">
      <header className="print-header">
        <h1>{t.name}</h1>
        <p>
          {[t.city, t.federation].filter(Boolean).join(' · ')}
          {t.city || t.federation ? ' · ' : ''}
          {kind === 'round' && round
            ? `Round ${round.index} of ${t.numberOfRounds}`
            : 'Final standings'}
        </p>
        {t.timeControl && <p className="print-sub">Time control: {t.timeControl}</p>}
      </header>

      {kind === 'round' && round && (
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: '3rem' }}>Bd</th>
              <th>White</th>
              <th style={{ width: '4rem' }}>Rtg</th>
              <th style={{ width: '6rem' }}>Result</th>
              <th>Black</th>
              <th style={{ width: '4rem' }}>Rtg</th>
            </tr>
          </thead>
          <tbody>
            {[...round.pairings]
              .sort((a, b) => a.boardNumber - b.boardNumber)
              .map((p) => (
                <tr key={p.id}>
                  <td>{p.boardNumber}</td>
                  <td>{name(p.whiteId)}</td>
                  <td>{rating(p.whiteId)}</td>
                  <td className="print-result">{RESULT_LABEL[p.result] ?? p.result}</td>
                  <td>{p.blackId ? name(p.blackId) : <em>bye</em>}</td>
                  <td>{rating(p.blackId)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {kind === 'standings' && (
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: '3rem' }}>#</th>
              <th>Player</th>
              <th style={{ width: '4rem' }}>Rtg</th>
              <th style={{ width: '4rem' }}>Pts</th>
              {(standings?.[0]?.tieBreaks ?? []).map((tb) => (
                <th key={tb.code} style={{ width: '4rem' }}>
                  {tb.code.slice(0, 4)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(standings ?? []).map((row) => (
              <tr key={row.player.id}>
                <td>{row.rank}</td>
                <td>
                  {row.player.fullName}
                  {row.player.fideTitle !== 'NONE' && ` (${row.player.fideTitle})`}
                </td>
                <td>{row.player.pairingRating}</td>
                <td>{row.points.toFixed(1)}</td>
                {row.tieBreaks.map((tb) => (
                  <td key={tb.code}>
                    {Number.isInteger(tb.value) ? tb.value : tb.value.toFixed(1)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="print-footer">
        {t.chiefArbiter && <span>Chief arbiter: {t.chiefArbiter}</span>}
        <span className="print-noprint">
          <button onClick={() => window.print()}>Print this sheet</button>
        </span>
      </footer>
    </div>
  );
}
