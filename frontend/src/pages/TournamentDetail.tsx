import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Tournament } from '../types';
import { Button, Card, ErrorNote, Spinner, StateBadge } from '../components/ui';
import PlayersPanel from '../components/PlayersPanel';
import RoundsPanel from '../components/RoundsPanel';
import StandingsPanel from '../components/StandingsPanel';
import MatrixPanel from '../components/MatrixPanel';

type Tab = 'players' | 'rounds' | 'standings' | 'matrix';

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('players');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      setT(await api.getTournament(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load tournament');
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!id) return null;
  if (!t) return error ? <ErrorNote message={error} /> : <Spinner />;

  const ranked = t.players.filter((p) => p.startingRank != null).length >= 2;
  const lastRound = [...t.rounds].sort((a, b) => b.index - a.index)[0];
  const lastComplete =
    !lastRound || lastRound.pairings.every((p) => p.result !== 'PENDING');
  const canGenerate =
    t.state === 'RUNNING' && t.rounds.length < t.numberOfRounds && lastComplete;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'players', label: `Players (${t.players.length})` },
    { key: 'rounds', label: `Rounds (${t.rounds.length}/${t.numberOfRounds})` },
    { key: 'standings', label: 'Standings' },
    { key: 'matrix', label: 'Matrix' },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-slate-500 hover:text-slate-900 text-sm">
          ← All tournaments
        </Link>
        <h1 className="text-xl font-semibold">{t.name}</h1>
        <StateBadge state={t.state} />
        <Link
          to={`/public/${t.id}`}
          className="ml-auto text-sm text-blue-600 hover:underline"
          target="_blank"
        >
          Public standings ↗
        </Link>
      </div>

      {/* Lifecycle controls */}
      <Card className="p-3 flex flex-wrap items-center gap-2">
        {t.state === 'DRAFT' && (
          <Button
            disabled={busy || t.players.length < 2}
            onClick={() => run(() => api.startTournament(t.id))}
          >
            Start tournament &amp; assign seeds
          </Button>
        )}
        {t.state === 'RUNNING' && (
          <Button
            variant="primary"
            disabled={busy || !canGenerate}
            onClick={() => run(() => api.generateNextRound(t.id))}
          >
            Generate round {t.rounds.length + 1}
          </Button>
        )}
        {t.state === 'RUNNING' && lastRound && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              confirm(`Discard round ${lastRound.index} and re-pair?`) &&
              run(() => api.deleteLatestRound(t.id))
            }
          >
            Discard round {lastRound.index}
          </Button>
        )}
        <a
          href={`/api/tournaments/${t.id}/trf`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-slate-600 hover:text-slate-900 underline ml-auto"
        >
          Export TRF(x)
        </a>
      </Card>

      {!ranked && t.state !== 'DRAFT' && (
        <ErrorNote message="Players are not seeded yet." />
      )}
      {error && <ErrorNote message={error} />}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab === tb.key
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'players' && <PlayersPanel tournament={t} onChange={reload} />}
      {tab === 'rounds' && <RoundsPanel tournament={t} onChange={reload} />}
      {tab === 'standings' && <StandingsPanel tournament={t} />}
      {tab === 'matrix' && <MatrixPanel tournament={t} />}
    </div>
  );
}
