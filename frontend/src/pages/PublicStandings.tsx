import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Tournament } from '../types';
import { ErrorNote, Spinner, StateBadge } from '../components/ui';
import StandingsPanel from '../components/StandingsPanel';

/** Read-only standings view for players/spectators (mobile-friendly). */
export default function PublicStandings() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const tick = () =>
      api
        .getTournament(id)
        .then(setT)
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'));
    void tick();
    // Auto-refresh so spectators see live results.
    const iv = setInterval(tick, 15000);
    return () => clearInterval(iv);
  }, [id]);

  if (error) return <ErrorNote message={error} />;
  if (!t) return <Spinner />;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{t.name}</h1>
        <StateBadge state={t.state} />
        <span className="text-sm text-slate-500">
          Round {t.currentRound}/{t.numberOfRounds}
        </span>
        <span className="ml-auto text-xs text-slate-400">Live · refreshes every 15s</span>
      </div>
      <StandingsPanel tournament={t} readOnly />
    </div>
  );
}
