import { useState } from 'react';
import { useAuth } from '../auth';
import { Button, Card, ErrorNote } from '../components/ui';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, name, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-6">
      <Card className="p-6">
        <h1 className="text-lg font-semibold mb-1">
          {mode === 'login' ? 'Sign in' : 'Create your arbiter account'}
        </h1>
        <p className="text-sm text-slate-500 mb-4">
          Free and open — no tiers, no paywalls.
        </p>

        {error && (
          <div className="mb-3">
            <ErrorNote message={error} />
          </div>
        )}

        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600">E-mail</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2"
              required
            />
          </label>

          {mode === 'register' && (
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Name</span>
              <input
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2"
                required
              />
            </label>
          )}

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600">Password</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2"
              minLength={mode === 'register' ? 8 : undefined}
              required
            />
            {mode === 'register' && (
              <span className="text-xs text-slate-400">At least 8 characters.</span>
            )}
          </label>

          <Button type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <p className="mt-4 text-sm text-slate-500">
          {mode === 'login' ? "Don't have an account?" : 'Already registered?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            className="text-blue-600 hover:underline"
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </Card>
    </div>
  );
}
