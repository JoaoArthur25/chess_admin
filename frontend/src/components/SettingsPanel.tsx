import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { ReportReadiness, Tournament } from '../types';
import { Button, Card, ErrorNote } from './ui';

const TYPES = [
  'Individual: Swiss-System',
  'Individual: Round Robin',
  'Team: Swiss-System',
];

function isoDate(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

/**
 * Administrative data for the FIDE rating report. Optional for a club event —
 * the panel shows what is still missing instead of blocking anything.
 */
export default function SettingsPanel({
  tournament: t,
  onChange,
}: {
  tournament: Tournament;
  onChange: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    city: t.city ?? '',
    federation: t.federation ?? '',
    endDate: isoDate(t.endDate),
    tournamentType: t.tournamentType ?? '',
    chiefArbiter: t.chiefArbiter ?? '',
    deputyArbiters: t.deputyArbiters ?? '',
    timeControl: t.timeControl ?? '',
  });
  const [readiness, setReadiness] = useState<ReportReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadReadiness() {
    try {
      setReadiness(await api.reportReadiness(t.id));
    } catch {
      setReadiness(null);
    }
  }

  useEffect(() => {
    void loadReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, t.state, t.city, t.federation, t.endDate, t.chiefArbiter, t.timeControl]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateTournament(t.id, {
        city: form.city || null,
        federation: form.federation || null,
        endDate: form.endDate || null,
        tournamentType: form.tournamentType || null,
        chiefArbiter: form.chiefArbiter || null,
        deputyArbiters: form.deputyArbiters || null,
        timeControl: form.timeControl || null,
      });
      setSaved(true);
      await onChange();
      await loadReadiness();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const field = (
    label: string,
    key: keyof typeof form,
    extra: { placeholder?: string; maxLength?: number; type?: string } = {},
  ) => (
    <label className="grid gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <input
        type={extra.type ?? 'text'}
        maxLength={extra.maxLength}
        placeholder={extra.placeholder}
        value={form[key]}
        onChange={(e) => {
          setSaved(false);
          setForm({ ...form, [key]: e.target.value });
        }}
        className="rounded-md border border-slate-300 px-3 py-2"
      />
    </label>
  );

  return (
    <div className="grid gap-4">
      {error && <ErrorNote message={error} />}

      {readiness && (
        <Card
          className={`p-4 ${
            readiness.ready
              ? 'border-emerald-300 bg-emerald-50'
              : 'border-amber-300 bg-amber-50'
          }`}
        >
          <h3 className="font-semibold text-sm mb-1">
            {readiness.ready
              ? 'Ready for FIDE rating submission'
              : 'Not yet ready for FIDE rating submission'}
          </h3>
          {readiness.missing.length > 0 && (
            <p className="text-sm text-amber-900">
              Missing: {readiness.missing.join(', ')}.
            </p>
          )}
          {!readiness.finished && (
            <p className="text-sm text-amber-900">
              The tournament must be finished before the report is final.
            </p>
          )}
          <p className="text-xs text-slate-600 mt-2">
            These fields are optional for a club event — you can run and export
            the tournament without them. They are only required if you intend to
            submit the result to the federation for rating.
          </p>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Tournament details (FIDE report)</h3>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          {field('City', 'city', { placeholder: 'Joinville' })}
          {field('Federation', 'federation', { placeholder: 'BRA', maxLength: 3 })}
          {field('End date', 'endDate', { type: 'date' })}
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600">Tournament type</span>
            <input
              list="tournament-types"
              value={form.tournamentType}
              onChange={(e) => {
                setSaved(false);
                setForm({ ...form, tournamentType: e.target.value });
              }}
              placeholder="Individual: Swiss-System"
              className="rounded-md border border-slate-300 px-3 py-2"
            />
            <datalist id="tournament-types">
              {TYPES.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          {field('Chief arbiter', 'chiefArbiter', { placeholder: 'Surname, Name' })}
          {field('Deputy arbiters', 'deputyArbiters', {
            placeholder: 'Surname, Name; Surname, Name',
          })}
          <div className="sm:col-span-2">
            {field('Time control', 'timeControl', {
              placeholder: '90 min + 30 sec/move',
            })}
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </Button>
            {saved && <span className="text-sm text-emerald-700">Saved.</span>}
          </div>
        </form>
      </Card>
    </div>
  );
}
