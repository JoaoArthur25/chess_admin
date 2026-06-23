import { Link, Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white shadow">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-lg">
            <span aria-hidden className="text-2xl">♟</span>
            Chess Admin
          </Link>
          <span className="ml-auto text-xs sm:text-sm text-slate-300">
            Open &amp; free Swiss-system manager
          </span>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 text-center text-xs text-slate-500 py-4">
        FIDE Dutch system · pairings delegated to an endorsed engine · MIT licensed
      </footer>
    </div>
  );
}
