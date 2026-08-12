import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type EngineCheckResult,
  type EnginePairing,
  type EngineIdentity,
  type EnginePairingResult,
  EngineError,
  NoValidPairingError,
  type PairingEngine,
} from './port.js';
import { describeExitCode, runProcess, withTempDir } from './process.js';

export interface BbpOptions {
  /** Path to the bbpPairings binary. Defaults to env PAIRING_ENGINE_PATH. */
  binaryPath?: string;
  /** Timeout in ms before the engine process is killed. */
  timeoutMs?: number;
}

/**
 * Adapter for bbpPairings (C++ CLI, FIDE reference for the Dutch system).
 * We invoke it at arm's length via child_process + temp files (§6). The binary
 * is never run client-side and its path is configurable.
 */
export class BbpPairingsEngine implements PairingEngine {
  private readonly binaryPath: string;
  private readonly timeoutMs: number;

  constructor(opts: BbpOptions = {}) {
    this.binaryPath =
      opts.binaryPath ?? process.env.PAIRING_ENGINE_PATH ?? 'bbpPairings';
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async pairNextRound(trf: string): Promise<EnginePairingResult> {
    return withTempDir(async (dir) => {
      const input = join(dir, 'input.trf');
      const output = join(dir, 'output.txt');
      await writeFile(input, trf, 'utf8');

      const res = await this.run(['--dutch', input, '-p', output]);

      // Exit code 1 = no valid pairing exists (a domain condition, not a crash).
      if (res.code === 1) {
        throw new NoValidPairingError(
          res.stderr.trim() || 'Engine reported no valid pairing for this round',
        );
      }
      if (res.code !== 0) {
        throw new EngineError(
          `bbpPairings failed: ${describeExitCode(res.code)}`,
          res.code,
          res.stderr,
        );
      }

      const outText = await readFile(output, 'utf8').catch(() => '');
      return { pairings: parsePairingOutput(outText) };
    });
  }

  async checkTournament(trf: string): Promise<EngineCheckResult> {
    return withTempDir(async (dir) => {
      const input = join(dir, 'input.trf');
      const checklist = join(dir, 'checklist.txt');
      await writeFile(input, trf, 'utf8');

      const res = await this.run(['--dutch', input, '-c', '-l', checklist]);
      const raw = (await readFile(checklist, 'utf8').catch(() => '')) || res.stdout;

      if (res.code !== 0 && res.code !== 1) {
        throw new EngineError(
          `bbpPairings check failed: ${describeExitCode(res.code)}`,
          res.code,
          res.stderr,
        );
      }

      // During -c, exit 1 surfaces discrepancies rather than an error.
      const discrepancies = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((message) => ({ message }));

      return {
        ok: res.code === 0,
        discrepancies: res.code === 0 ? [] : discrepancies,
        rawOutput: raw,
      };
    });
  }

  /**
   * Identify the binary in use. Invoked with no arguments, bbpPairings prints a
   * banner naming its version; a build made from a working tree says
   * "non-release build" instead of a tag, which is exactly the distinction an
   * arbiter needs before running a rated event.
   */
  async describe(): Promise<EngineIdentity> {
    let banner = '';
    try {
      const res = await this.run([]);
      banner = (res.stdout || res.stderr).split(/\r?\n/)[0]?.trim() ?? '';
    } catch (err) {
      return {
        name: 'bbpPairings',
        version: err instanceof EngineError ? `unavailable (${err.message})` : 'unavailable',
        isEndorsedRelease: false,
      };
    }

    // A published release identifies itself as "- vX.Y.Z (Built ...)".
    const release = /-\s*v(\d+\.\d+\.\d+)/.exec(banner);
    return {
      name: 'bbpPairings',
      version: banner || 'unknown',
      isEndorsedRelease: release !== null,
    };
  }

  private run(args: string[]) {
    return runProcess(
      this.binaryPath,
      args,
      this.timeoutMs,
      `Pairing engine binary not found at "${this.binaryPath}". ` +
        `Set PAIRING_ENGINE_PATH to the bbpPairings executable.`,
    );
  }
}

/**
 * Parse bbpPairings -p output:
 *   <number of pairings>
 *   <white> <black>   (black = 0 means white receives a bye)
 *   ...
 */
export function parsePairingOutput(text: string): EnginePairing[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const declared = parseInt(lines[0]!, 10);
  const body = Number.isNaN(declared) ? lines : lines.slice(1);

  const pairings: EnginePairing[] = [];
  let board = 1;
  for (const line of body) {
    const [w, b] = line.split(/\s+/).map((n) => parseInt(n, 10));
    if (w === undefined || Number.isNaN(w)) continue;
    const black = b === undefined || Number.isNaN(b) ? 0 : b;
    pairings.push({ white: w, black, boardNumber: black === 0 ? 0 : board });
    if (black !== 0) board += 1;
  }

  // Number the bye board last so real games occupy boards 1..n.
  const bye = pairings.find((p) => p.black === 0);
  if (bye) bye.boardNumber = board;

  return pairings;
}
