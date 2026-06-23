// The PairingEngine port (§6). The concrete engine is swappable behind this
// interface. We NEVER implement pairing/color/float logic ourselves — that is
// the engine's job. Our adapters only serialize input (TRF) and parse output.

/** One pairing as emitted by the engine: 1-based starting-rank numbers. */
export interface EnginePairing {
  /** White player's starting rank (TPN). */
  white: number;
  /**
   * Black player's starting rank, or 0 when the white player receives a bye
   * (matches the TRF/bbpPairings convention where opponent 0 = bye).
   */
  black: number;
  boardNumber: number;
}

export interface EnginePairingResult {
  /** Pairings for the next round, keyed by starting rank. */
  pairings: EnginePairing[];
  /** Engine checklist / diagnostics output (the -l file), if produced. */
  checklist?: string;
}

export interface EngineDiscrepancy {
  message: string;
  roundIndex?: number;
}

export interface EngineCheckResult {
  ok: boolean;
  discrepancies: EngineDiscrepancy[];
  rawOutput?: string;
}

/** Raised when no legal pairing exists for the round (engine exit code 1). */
export class NoValidPairingError extends Error {
  constructor(message = 'No valid pairing exists for this round') {
    super(message);
    this.name = 'NoValidPairingError';
  }
}

/** Raised for genuine engine failures (missing binary, crash, parse error). */
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface PairingEngine {
  /** Generate pairings for the next round given full tournament state as TRF. */
  pairNextRound(trf: string): Promise<EnginePairingResult>;
  /** Check an entire completed tournament for rule discrepancies. */
  checkTournament(trf: string): Promise<EngineCheckResult>;
}
