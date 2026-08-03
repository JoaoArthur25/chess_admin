import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorNote } from '../components/ui';

async function post(path: string, body: unknown): Promise<{ message?: string }> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (data && typeof data === 'object' && 'error' in data && String(data.error)) ||
        'Request failed',
    );
  }
  return data ?? {};
}

/** Choose a new password from an e-mailed link (`/reset-password?token=…`). */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-6">
      <Card className="p-6">
        <h1 className="text-lg font-semibold mb-4">Choose a new password</h1>

        {!token && (
          <ErrorNote message="This link is missing its token. Request a new reset e-mail." />
        )}

        {done ? (
          <>
            <p className="text-sm text-emerald-700 mb-4">
              Your password has been updated. Any session opened before now has been
              signed out.
            </p>
            <Link to="/" className="text-blue-600 hover:underline text-sm">
              Go to sign in
            </Link>
          </>
        ) : (
          <>
            {error && (
              <div className="mb-3">
                <ErrorNote message={error} />
              </div>
            )}
            <form onSubmit={submit} className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-slate-600">New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  required
                />
                <span className="text-xs text-slate-400">At least 8 characters.</span>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-slate-600">Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2"
                  required
                />
              </label>
              <Button type="submit" disabled={busy || !token}>
                {busy ? 'Saving…' : 'Set new password'}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
