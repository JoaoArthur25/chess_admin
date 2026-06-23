import type { TrfColor, TrfPlayer, TrfRoundResult, TrfTournament } from './types.js';

function slice(line: string, start: number, width: number): string {
  return line.slice(start - 1, start - 1 + width).trim();
}

function parseColor(c: string): TrfColor {
  const lc = c.toLowerCase();
  if (lc === 'w') return 'w';
  if (lc === 'b') return 'b';
  return '-';
}

/**
 * Parse a 001 player record. The header fields (cols 1-89) are read by column;
 * the round section (col 90+) is tokenized into groups of 3 (opponent, color,
 * result) which is robust to small whitespace variations across engines.
 */
export function parsePlayer(line: string): TrfPlayer {
  const startingRank = parseInt(slice(line, 5, 4), 10) || 0;
  const sexRaw = slice(line, 10, 1).toLowerCase();
  const sex = sexRaw === 'm' ? 'm' : sexRaw === 'w' ? 'w' : '';
  const title = slice(line, 11, 3);
  const name = slice(line, 15, 33);
  const rating = parseInt(slice(line, 49, 4), 10) || 0;
  const federation = slice(line, 54, 3);
  const fideId = slice(line, 58, 11);
  const birthDate = slice(line, 70, 10);
  const points = parseFloat(slice(line, 81, 4)) || 0;
  const rank = parseInt(slice(line, 86, 4), 10) || 0;

  const rounds: TrfRoundResult[] = [];
  const roundSection = line.length >= 90 ? line.slice(89) : '';
  const tokens = roundSection.trim().split(/\s+/).filter((t) => t.length > 0);
  for (let i = 0; i + 3 <= tokens.length; i += 3) {
    const opp = tokens[i];
    const col = tokens[i + 1];
    const res = tokens[i + 2];
    if (opp === undefined || col === undefined || res === undefined) break;
    rounds.push({
      opponent: parseInt(opp, 10) || 0,
      color: parseColor(col),
      result: res,
    });
  }

  return {
    startingRank,
    sex: sex as TrfPlayer['sex'],
    title,
    name,
    rating,
    federation,
    fideId,
    birthDate,
    points,
    rank,
    rounds,
  };
}

export function parseTournament(text: string): TrfTournament {
  const lines = text.split(/\r?\n/);
  const players: TrfPlayer[] = [];
  let name = '';
  let city = '';
  let federation = '';
  let startDate = '';
  let numberOfRounds = 0;
  let firstBoardColor: 'white' | 'black' = 'white';
  const acceleration = new Map<number, number[]>();

  for (const raw of lines) {
    if (raw.length === 0) continue;
    const id = raw.slice(0, 3);
    switch (id) {
      case '001':
        players.push(parsePlayer(raw));
        break;
      case '012':
        name = raw.slice(3).trim();
        break;
      case '022':
        city = raw.slice(3).trim();
        break;
      case '032':
        federation = raw.slice(3).trim();
        break;
      case '042':
        startDate = raw.slice(3).trim();
        break;
      case 'XXR':
        numberOfRounds = parseInt(raw.slice(3).trim(), 10) || 0;
        break;
      case 'XXC': {
        const v = raw.slice(3).trim().toLowerCase();
        firstBoardColor = v.startsWith('black') ? 'black' : 'white';
        break;
      }
      case 'XXA': {
        const parts = raw.slice(3).trim().split(/\s+/);
        const rank = parseInt(parts[0] ?? '', 10);
        if (!Number.isNaN(rank)) {
          acceleration.set(
            rank,
            parts.slice(1).map((p) => parseFloat(p) || 0),
          );
        }
        break;
      }
      default:
        break; // ignore unknown header / extension lines
    }
  }

  // If XXR was absent, infer round count from the longest player history.
  if (numberOfRounds === 0) {
    numberOfRounds = players.reduce((m, p) => Math.max(m, p.rounds.length), 0);
  }

  const result: TrfTournament = {
    name,
    city,
    federation,
    startDate,
    numberOfRounds,
    firstBoardColor,
    players,
  };
  if (acceleration.size > 0) result.acceleration = acceleration;
  return result;
}
