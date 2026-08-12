import { getAccessToken, notifySessionLost, refreshAccessToken } from './auth';
import type {
  ConformityCheck,
  ReportReadiness,
  PairingResult,
  Player,
  PlayerStatus,
  StandingRow,
  Tournament,
  TournamentSummary,
  ValidationAlert,
} from './types';

const BASE = '/api';

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

function send(path: string, init: RequestInit | undefined, token: string | null) {
  return fetch(BASE + path, {
    ...init,
    credentials: 'include', // the refresh cookie must travel with the request
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await send(path, init, getAccessToken());

  // The access token is short-lived; on 401 try exactly one refresh and replay.
  // refreshAccessToken() de-duplicates concurrent attempts, so a burst of
  // parallel requests causes a single round trip.
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      res = await send(path, init, fresh);
    } else {
      notifySessionLost();
    }
  }
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(msg, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  listTournaments: () => req<TournamentSummary[]>('/tournaments'),
  getTournament: (id: string) => req<Tournament>(`/tournaments/${id}`),
  createTournament: (input: { name: string; numberOfRounds: number; tieBreaks?: string[] }) =>
    req<Tournament>('/tournaments', { method: 'POST', body: JSON.stringify(input) }),
  deleteTournament: (id: string) => req<void>(`/tournaments/${id}`, { method: 'DELETE' }),
  updateTournament: (id: string, patch: Record<string, unknown>) =>
    req<Tournament>(`/tournaments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  startTournament: (id: string) =>
    req<Tournament>(`/tournaments/${id}/start`, { method: 'POST' }),
  generateNextRound: (id: string) =>
    req<{ round: unknown; tournament: Tournament }>(`/tournaments/${id}/rounds`, { method: 'POST' }),
  deleteLatestRound: (id: string) =>
    req<Tournament>(`/tournaments/${id}/rounds/latest`, { method: 'DELETE' }),

  addPlayer: (id: string, input: Partial<Player> & { fullName: string; sex: 'M' | 'F' }) =>
    req<Player>(`/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify(input) }),
  updatePlayer: (id: string, playerId: string, patch: { status?: PlayerStatus } & Record<string, unknown>) =>
    req<Tournament>(`/tournaments/${id}/players/${playerId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  removePlayer: (id: string, playerId: string) =>
    req<void>(`/tournaments/${id}/players/${playerId}`, { method: 'DELETE' }),

  enterResult: (id: string, pairingId: string, result: PairingResult) =>
    req<{ alerts: ValidationAlert[]; tournament: Tournament }>(
      `/tournaments/${id}/pairings/${pairingId}/result`,
      { method: 'POST', body: JSON.stringify({ result }) },
    ),

  setRoundPairings: (
    id: string,
    roundId: string,
    pairings: { whiteId: string; blackId: string | null }[],
    acknowledgeWarnings = false,
  ) =>
    req<{ applied: boolean; alerts: ValidationAlert[] }>(
      `/tournaments/${id}/rounds/${roundId}/pairings`,
      { method: 'PUT', body: JSON.stringify({ pairings, acknowledgeWarnings }) },
    ),

  checkTournament: (id: string) => req<ConformityCheck>(`/tournaments/${id}/check`),

  reportReadiness: (id: string) =>
    req<ReportReadiness>(`/tournaments/${id}/report-readiness`),

  standings: (id: string) => req<StandingRow[]>(`/tournaments/${id}/standings`),
  matrix: (id: string) => req<{ ranks: number[]; cells: (number | null)[][] }>(`/tournaments/${id}/matrix`),
  trf: (id: string) => req<string>(`/tournaments/${id}/trf`),
};

export { ApiError };
