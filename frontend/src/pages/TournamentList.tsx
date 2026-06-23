import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { TournamentSummary } from '../types';
import { Button, Card, ErrorNote, Spinner, StateBadge } from '../components/ui';

export default function TournamentList() {
  const [list, setList] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rounds, setRounds] = useState(7);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  async function load() {
    try {
      setList(await api.listTournaments());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load tournaments');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const t = await api.createTournament({
        name: name.trim(),
        numberOfRounds: rounds,
        tieBreaks: ['BUCHHOLZ', 'BUCHHOLZ_CUT1', 'SONNEBORN_BERGER'],
      });
      navigate(`/t/${t.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create tournament');
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-xl font-semibold mb-4">Tournaments</h1>
        {error && <ErrorNote message={error} />}
        {list === null ? (
          <Spinner />
        ) : list.length === 0 ? (
          <Card className="p-6 text-slate-500 text-sm">
            No tournaments yet. Create your first one →
          </Card>
        ) : (
          <ul className="grid gap-3">
            {list.map((t) => (
              <li key={t.id}>
                <Link to={`/t/${t.id}`}>
                  <Card className="p-4 hover:border-slate-400 transition flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{t.name}</span>
                        <StateBadge state={t.state} />
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {t.playerCount} players · {t.numberOfRounds} rounds ·{' '}
                        round {t.currentRound}/{t.numberOfRounds}
                      </div>
                    </div>
                    <span className="text-slate-400">→</span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <Card className="p-4 sticky top-4">
          <h2 className="font-semibold mb-3">New tournament</h2>
          <form onSubmit={create} className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Spring Club Open 2026"
                className="rounded-md border border-slate-300 px-3 py-2"
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Number of rounds</span>
              <input
                type="number"
                min={1}
                max={20}
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create tournament'}
            </Button>
          </form>
        </Card>
      </section>
    </div>
  );
}
