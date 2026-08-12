import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePairingOutput } from './bbpPairings.js';
import {
  type EngineCheckResult,
  EngineError,
  type EngineIdentity,
  type EnginePairingResult,
  NoValidPairingError,
  type PairingEngine,
} from './port.js';
import { describeExitCode, runProcess, withTempDir } from './process.js';

export interface JaVaFoOptions {
  /** Path to javafo.jar. Defaults to env JAVAFO_PATH. */
  jarPath?: string;
  /** The `java` executable. Defaults to env JAVA_BIN, then PATH. */
  javaBin?: string;
  timeoutMs?: number;
}

/**
 * Adapter for JaVaFo — Roberto Ricca's engine, the FIDE reference implementation
 * of the Dutch system.
 *
 * Its purpose here is CROSS-VALIDATION rather than production pairing:
 * C.04.2 requires that different approved programs arrive at identical
 * pairings, so running the same TRF through two endorsed engines and comparing
 * is the strongest conformance evidence available to us. Nothing stops it being
 * used as the primary engine (PAIRING_ENGINE=javafo) — the port makes them
 * interchangeable — but it costs a JVM.
 *
 * The CLI mirrors bbpPairings (or rather, bbpPairings mirrors this one):
 *   java -jar javafo.jar <input.trf> -p [output] [-l [checklist]]
 *   java -jar javafo.jar <input.trf> -c
 * JaVaFo implements only the Dutch system, so there is no --dutch flag.
 */
export class JaVaFoEngine implements PairingEngine {
  private readonly jarPath: string;
  private readonly javaBin: string;
  private readonly timeoutMs: number;

  constructor(opts: JaVaFoOptions = {}) {
    this.jarPath = opts.jarPath ?? process.env.JAVAFO_PATH ?? 'javafo.jar';
    this.javaBin = opts.javaBin ?? process.env.JAVA_BIN ?? 'java';
    this.timeoutMs = opts.timeoutMs ?? 60_000; // JVM startup is not free
  }

  private run(args: string[]) {
    return runProcess(
      this.javaBin,
      ['-jar', this.jarPath, ...args],
      this.timeoutMs,
      `Java or javafo.jar not found (java="${this.javaBin}", jar="${this.jarPath}"). ` +
        `Install a JRE and set JAVAFO_PATH to javafo.jar.`,
    );
  }

  async pairNextRound(trf: string): Promise<EnginePairingResult> {
    return withTempDir(async (dir) => {
      const input = join(dir, 'input.trf');
      const output = join(dir, 'output.txt');
      await writeFile(input, trf, 'utf8');

      const res = await this.run([input, '-p', output]);

      // Exit 1 is "no valid pairing exists" — a domain condition, not a crash.
      if (res.code === 1) {
        throw new NoValidPairingError(
          res.stderr.trim() || 'JaVaFo reported no valid pairing for this round',
        );
      }
      if (res.code !== 0) {
        throw new EngineError(
          `JaVaFo failed: ${describeExitCode(res.code)}`,
          res.code,
          res.stderr,
        );
      }

      // Same output shape as bbpPairings: a count, then "white black" lines.
      const outText = await readFile(output, 'utf8').catch(() => '');
      return { pairings: parsePairingOutput(outText) };
    });
  }

  async checkTournament(trf: string): Promise<EngineCheckResult> {
    return withTempDir(async (dir) => {
      const input = join(dir, 'input.trf');
      const checklist = join(dir, 'checklist.txt');
      await writeFile(input, trf, 'utf8');

      const res = await this.run([input, '-c', '-l', checklist]);
      const raw = (await readFile(checklist, 'utf8').catch(() => '')) || res.stdout;

      if (res.code !== 0 && res.code !== 1) {
        throw new EngineError(
          `JaVaFo check failed: ${describeExitCode(res.code)}`,
          res.code,
          res.stderr,
        );
      }

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

  async describe(): Promise<EngineIdentity> {
    try {
      // Invoked with no arguments, JaVaFo prints its banner and usage.
      const res = await this.run([]);
      const banner = (res.stdout || res.stderr).split(/\r?\n/).find((l) => /javafo/i.test(l));
      const version = banner?.trim() || 'JaVaFo (version not reported)';
      return {
        name: 'JaVaFo',
        version,
        isEndorsedRelease: /\d+\.\d+/.test(version),
      };
    } catch (err) {
      return {
        name: 'JaVaFo',
        version: err instanceof EngineError ? `unavailable (${err.message})` : 'unavailable',
        isEndorsedRelease: false,
      };
    }
  }
}
