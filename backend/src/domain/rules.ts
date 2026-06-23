// Business-rule validations (§5). These NEVER decide pairings — the engine does
// that. They let a human arbiter audit pairings and block FIDE-illegal manual
// edits. Functions are pure: (proposed change, current history) -> alerts.

import type { PairingResult, Round } from './types.js';
import {
  buildPlayerHistory,
  colorBalance,
  hasReceivedBye,
  hasWonByForfeit,
  opponentsOf,
  trailingColorStreak,
} from './scoring.js';

export type AlertSeverity = 'ERROR' | 'WARNING';

export interface ValidationAlert {
  code: string;
  severity: AlertSeverity;
  message: string;
  playerIds?: string[];
}

/** ERROR alerts must block the action; WARNING alerts only need acknowledgement. */
export function hasBlockingError(alerts: ValidationAlert[]): boolean {
  return alerts.some((a) => a.severity === 'ERROR');
}

/**
 * Validate a proposed manual pairing of `whiteId` vs `blackId` given prior
 * rounds. Raises:
 *  - rematch (ERROR) — players already met
 *  - same colour 3x in a row (WARNING)
 *  - colour difference |n| > 2 after this game (WARNING)
 */
export function validateManualPairing(
  whiteId: string,
  blackId: string,
  priorRounds: Round[],
): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];

  if (whiteId === blackId) {
    alerts.push({
      code: 'SELF_PAIRING',
      severity: 'ERROR',
      message: 'A player cannot be paired against themselves.',
      playerIds: [whiteId],
    });
    return alerts;
  }

  if (opponentsOf(whiteId, priorRounds).has(blackId)) {
    alerts.push({
      code: 'REMATCH',
      severity: 'ERROR',
      message: 'These players have already met in this tournament.',
      playerIds: [whiteId, blackId],
    });
  }

  alerts.push(...colorAlerts(whiteId, 'W', priorRounds));
  alerts.push(...colorAlerts(blackId, 'B', priorRounds));

  return alerts;
}

/** Colour alerts for giving `playerId` the given colour this round. */
export function colorAlerts(
  playerId: string,
  color: 'W' | 'B',
  priorRounds: Round[],
): ValidationAlert[] {
  const history = buildPlayerHistory(playerId, priorRounds);
  const alerts: ValidationAlert[] = [];

  // Same colour three times in a row (the new game makes the 3rd).
  const streak = trailingColorStreak(history, color);
  if (streak >= 2) {
    alerts.push({
      code: 'COLOR_STREAK',
      severity: 'WARNING',
      message: `Player would get ${color === 'W' ? 'white' : 'black'} ${streak + 1} times in a row.`,
      playerIds: [playerId],
    });
  }

  // Colour difference |n| > 2 after this game.
  const balance = colorBalance(history) + (color === 'W' ? 1 : -1);
  if (Math.abs(balance) > 2) {
    alerts.push({
      code: 'COLOR_DIFFERENCE',
      severity: 'WARNING',
      message: `Player's colour difference would reach ${balance} (|n| > 2).`,
      playerIds: [playerId],
    });
  }

  return alerts;
}

/**
 * Validate assigning a bye to a player. A full-point bye is blocked if the
 * player already received any bye, or already won by forfeit (Dutch rule, §5).
 */
export function validateByeAssignment(
  playerId: string,
  byeResult: Extract<PairingResult, 'FULL_POINT_BYE' | 'HALF_POINT_BYE' | 'ZERO_POINT_BYE'>,
  priorRounds: Round[],
): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];
  if (byeResult !== 'FULL_POINT_BYE') return alerts; // half/zero byes are requestable freely

  const history = buildPlayerHistory(playerId, priorRounds);
  if (hasReceivedBye(history)) {
    alerts.push({
      code: 'BYE_ALREADY_GIVEN',
      severity: 'ERROR',
      message: 'Player has already received a bye and cannot get another full-point bye.',
      playerIds: [playerId],
    });
  }
  if (hasWonByForfeit(playerId, priorRounds)) {
    alerts.push({
      code: 'BYE_AFTER_FORFEIT_WIN',
      severity: 'ERROR',
      message: 'Player already won by forfeit (W.O.) and cannot receive a full-point bye.',
      playerIds: [playerId],
    });
  }
  return alerts;
}

/**
 * Detect a retroactive result edit: changing a result in a round earlier than
 * the tournament's current round. Such an edit must never be accepted silently
 * — the caller must surface this and reprocess subsequent rounds (§5).
 */
export function detectRetroactiveEdit(
  editedRoundIndex: number,
  currentRound: number,
): ValidationAlert | null {
  if (editedRoundIndex < currentRound) {
    return {
      code: 'RETROACTIVE_EDIT',
      severity: 'WARNING',
      message:
        `Editing round ${editedRoundIndex} while the tournament is in round ${currentRound}. ` +
        'All later rounds depend on this result and may need reprocessing.',
    };
  }
  return null;
}
