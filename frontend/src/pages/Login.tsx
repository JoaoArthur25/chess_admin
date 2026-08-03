import { useState } from 'react';
import { useAuth } from '../auth';
import { Button, Card, ErrorNote } from '../components/ui';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'login') await login(email, password);
      else if (mode === 'register') await register(email, name, password);
      else {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => null);
        setNotice(
          data?.message ?? 'If that e-mail has an account, a reset link has been sent.',
        );
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  const title =
    mode === 'login'
      ? 'Sign in'
      : mode === 'register'
        ? 'Create your arbiter account'
        : 'Reset your password';

  return (
    <div className="mx-auto max-w-sm py-6">
      <Card className="p-6">
        <h1 className="text-lg font-semibold mb-1">{title}</h1>
        <p className="text-sm text-slate-500 mb-4">
          {mode === 'forgot'
            ? 'We will e-mail you a link to choose a new one.'
            : 'Free and open — no tiers, no paywalls.'}
        </p>

        {error && (
          <div className="mb-3">
            <ErrorNote message={error} />
          </div>
        )}

        {notice && (
          <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
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

          {mode !== 'forgot' && (
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
          )}

          <Button type="submit" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'register'
                  ? 'Create account'
                  : 'Send reset link'}
          </Button>
        </form>

        <div className="mt-4 grid gap-1 text-sm text-slate-500">
          {mode === 'login' && (
            <p>
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  setError(null);
                  setNotice(null);
                }}
                className="text-blue-600 hover:underline"
              >
                Forgot your password?
              </button>
            </p>
          )}
          <p>
            {mode === 'register' ? 'Already registered?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'register' ? 'login' : mode === 'forgot' ? 'login' : 'register');
                setError(null);
                setNotice(null);
              }}
              className="text-blue-600 hover:underline"
            >
              {mode === 'register' ? 'Sign in' : mode === 'forgot' ? 'Back to sign in' : 'Create one'}
            </button>
          </p>
        </div>
      </Card>
    </div>
  );
}
