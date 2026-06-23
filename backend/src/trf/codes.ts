import type { PairingResult } from '../domain/types.js';
import type { TrfColor } from './types.js';

// TRF result codes (single char), per the FIDE TRF(x) / JaVaFo definition:
//   Played games:    W = win, D = draw, L = loss
//   Forfeit:         + = forfeit win, - = forfeit loss
//   Byes (opp = 0):  U = pairing-allocated (full-point) bye
//                    H = half-point bye
//                    Z = zero-point bye
// Color codes: 'w' white, 'b' black, '-' none (byes / unplayed).

export interface PlayerResultCode {
  color: TrfColor;
  code: string;
  opponentPresent: boolean; // false => opponent field is 0
}

/**
 * Map a pairing result to the TRF code for ONE side.
 * @param isWhite which side of the pairing this player is on.
 * @param hasOpponent false for single-player bye pairings.
 */
export function toTrfCode(
  result: PairingResult,
  isWhite: boolean,
  hasOpponent: boolean,
): PlayerResultCode {
  if (!hasOpponent) {
    switch (result) {
      case 'FULL_POINT_BYE':
        return { color: '-', code: 'U', opponentPresent: false };
      case 'HALF_POINT_BYE':
        return { color: '-', code: 'H', opponentPresent: false };
      case 'ZERO_POINT_BYE':
      default:
        return { color: '-', code: 'Z', opponentPresent: false };
    }
  }

  const color: TrfColor = isWhite ? 'w' : 'b';
  switch (result) {
    case 'WHITE_WIN':
      return { color, code: isWhite ? 'W' : 'L', opponentPresent: true };
    case 'BLACK_WIN':
      return { color, code: isWhite ? 'L' : 'W', opponentPresent: true };
    case 'DRAW':
      return { color, code: 'D', opponentPresent: true };
    case 'WHITE_WIN_FORFEIT':
      return { color, code: isWhite ? '+' : '-', opponentPresent: true };
    case 'BLACK_WIN_FORFEIT':
      return { color, code: isWhite ? '-' : '+', opponentPresent: true };
    case 'DOUBLE_FORFEIT':
      return { color, code: '-', opponentPresent: true };
    case 'PENDING':
    default:
      // Not yet played — should not normally be serialized; emit forfeit-loss
      // placeholder so the engine never sees a half-entered round.
      return { color, code: '-', opponentPresent: true };
  }
}

/** Points implied by a TRF result code (for the points/rank fields). */
export function pointsForCode(code: string): number {
  switch (code.toUpperCase()) {
    case 'W':
    case '+':
    case 'U':
    case 'F':
      return 1;
    case 'D':
    case 'H':
      return 0.5;
    default:
      return 0;
  }
}
