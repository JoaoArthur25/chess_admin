import type { TrfPlayer, TrfTournament } from './types.js';

// Fixed-width column layout for the 001 player record (1-based start columns),
// following the FIDE TRF16 definition that bbpPairings / JaVaFo consume.
//   1   "001"
//   5   starting rank (w4)
//   10  sex (w1)
//   11  title (w3)
//   15  name (w33)
//   49  rating (w4)
//   54  federation (w3)
//   58  FIDE id (w11)
//   70  birth date (w10)
//   81  points (w4, one decimal)
//   86  rank (w4)
//   92  round blocks (each 10 wide): opp(w4) _ color(w1) _ result(w1)
const COL = {
  rank: 5,
  sex: 10,
  title: 11,
  name: 15,
  rating: 49,
  federation: 54,
  fideId: 58,
  birth: 70,
  points: 81,
  finalRank: 86,
  rounds: 92,
} as const;

type Align = 'left' | 'right';

/** Place `value` into a mutable char buffer at 1-based `start`, width `width`. */
function put(buf: string[], start: number, width: number, value: string, align: Align): void {
  let v = value ?? '';
  if (v.length > width) v = v.slice(0, width);
  const padded = align === 'right' ? v.padStart(width, ' ') : v.padEnd(width, ' ');
  for (let i = 0; i < width; i += 1) {
    buf[start - 1 + i] = padded[i]!;
  }
}

function formatPoints(points: number): string {
  // One decimal, right-justified into width 4 (e.g. " 1.0", "10.5").
  return points.toFixed(1).padStart(4, ' ');
}

export function serializePlayer(p: TrfPlayer): string {
  const buf: string[] = [];

  put(buf, 1, 3, '001', 'left');
  put(buf, COL.rank, 4, String(p.startingRank), 'right');
  put(buf, COL.sex, 1, p.sex, 'left');
  put(buf, COL.title, 3, p.title, 'left');
  put(buf, COL.name, 33, p.name, 'left');
  put(buf, COL.rating, 4, p.rating ? String(p.rating) : '0', 'right');
  put(buf, COL.federation, 3, p.federation, 'left');
  put(buf, COL.fideId, 11, p.fideId, 'left');
  put(buf, COL.birth, 10, p.birthDate, 'left');
  put(buf, COL.points, 4, formatPoints(p.points), 'right');
  put(buf, COL.finalRank, 4, String(p.rank), 'right');

  p.rounds.forEach((r, i) => {
    const start = COL.rounds + i * 10;
    put(buf, start, 4, r.opponent ? String(r.opponent) : '0000', 'right');
    put(buf, start + 5, 1, r.color, 'left');
    put(buf, start + 7, 1, r.result, 'left');
  });

  // buf is sparse — unwritten gaps between fields are holes, which join()
  // would render as '' and collapse the column layout. Map holes to spaces.
  return Array.from(buf, (c) => c ?? ' ')
    .join('')
    .replace(/\s+$/, '');
}

export function serializeTournament(t: TrfTournament): string {
  const lines: string[] = [];
  lines.push(`012 ${t.name}`);
  if (t.city) lines.push(`022 ${t.city}`);
  if (t.federation) lines.push(`032 ${t.federation}`);
  if (t.startDate) lines.push(`042 ${t.startDate}`);
  lines.push(`062 ${t.players.length}`);

  // Engine config lines.
  lines.push(`XXR ${t.numberOfRounds}`);
  lines.push(`XXC ${t.firstBoardColor}1`);

  // Acceleration (optional): one XXA line per player with per-round points.
  if (t.acceleration && t.acceleration.size > 0) {
    for (const [rank, pts] of [...t.acceleration.entries()].sort((a, b) => a[0] - b[0])) {
      const cells = pts.map((p) => p.toFixed(1)).join(' ');
      lines.push(`XXA ${String(rank).padStart(4, ' ')} ${cells}`);
    }
  }

  const players = [...t.players].sort((a, b) => a.startingRank - b.startingRank);
  for (const p of players) lines.push(serializePlayer(p));

  return lines.join('\n') + '\n';
}
