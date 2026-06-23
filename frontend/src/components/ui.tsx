import type { ReactNode } from 'react';
import type { PlayerStatus, TournamentState } from '../types';

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const styles: Record<string, string> = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700',
    secondary: 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-500',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-white shadow-sm border border-slate-200 ${className}`}>
      {children}
    </div>
  );
}

const STATE_STYLES: Record<TournamentState, string> = {
  DRAFT: 'bg-amber-100 text-amber-800',
  RUNNING: 'bg-emerald-100 text-emerald-800',
  FINISHED: 'bg-slate-200 text-slate-700',
};

export function StateBadge({ state }: { state: TournamentState }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_STYLES[state]}`}>
      {state}
    </span>
  );
}

const STATUS_STYLES: Record<PlayerStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  WITHDRAWN: 'bg-red-100 text-red-700',
  LATE_ENTRY: 'bg-blue-100 text-blue-700',
  PAUSED: 'bg-amber-100 text-amber-800',
};

export function StatusBadge({ status }: { status: PlayerStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

/** Colour-history chips (W/B), per §5 "display each player's colour history". */
export function ColorHistory({ colors }: { colors: (('W' | 'B') | null)[] }) {
  return (
    <span className="inline-flex gap-0.5">
      {colors.map((c, i) => (
        <span
          key={i}
          title={c === 'W' ? 'White' : c === 'B' ? 'Black' : 'Bye'}
          className={`inline-block h-4 w-4 rounded-sm text-[9px] leading-4 text-center font-bold ${
            c === 'W'
              ? 'bg-board-light text-slate-700 border border-slate-300'
              : c === 'B'
                ? 'bg-board-dark text-white'
                : 'bg-slate-200 text-slate-400'
          }`}
        >
          {c ?? '–'}
        </span>
      ))}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="py-10 text-center text-slate-500">{label}</div>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
      {message}
    </div>
  );
}
