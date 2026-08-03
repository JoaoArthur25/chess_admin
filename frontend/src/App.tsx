import { Link, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Login from './pages/Login';
import { Spinner } from './components/ui';

/**
 * Public pages stay open — players and spectators check standings from their
 * phones without an account (product pillar). Everything else is arbiter-only.
 */
function Gate() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  // Public: spectators check standings, the arbiter prints board lists from
  // whatever device is at hand, and password reset must obviously work for
  // someone who cannot sign in.
  const isPublic =
    pathname.startsWith('/public/') ||
    pathname.startsWith('/print/') ||
    pathname.startsWith('/reset-password');

  if (isPublic) return <Outlet />;
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Login />;
  return <Outlet />;
}

function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="bg-slate-900 text-white shadow">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2 font-semibold text-lg">
          <span aria-hidden className="text-2xl">♟</span>
          Chess Admin
        </Link>
        {user ? (
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-300 hidden sm:inline">{user.name}</span>
            <button onClick={() => void logout()} className="text-slate-300 hover:text-white underline">
              Sign out
            </button>
          </div>
        ) : (
          <span className="ml-auto text-xs sm:text-sm text-slate-300">
            Open &amp; free Swiss-system manager
          </span>
        )}
      </div>
    </header>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
          <Gate />
        </main>
        <footer className="border-t border-slate-200 text-center text-xs text-slate-500 py-4">
          FIDE Dutch system · pairings delegated to an endorsed engine · MIT licensed
        </footer>
      </div>
    </AuthProvider>
  );
}
