import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineError } from './port.js';

// Shared plumbing for engines invoked as external processes. Both bbpPairings
// and JaVaFo speak the same CLI shape (TRF in, pairings out, via temp files),
// so the spawning, timeout and cleanup live here rather than in each adapter.

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command to completion, capturing output and enforcing a timeout. */
export function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  notFoundHint: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new EngineError(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      const e = err as NodeJS.ErrnoException;
      reject(new EngineError(e.code === 'ENOENT' ? notFoundHint : `Failed to spawn ${command}: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Run `fn` with a private temp directory, removed afterwards either way. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'chess-admin-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Explain a non-zero exit. Both engines follow the same table (documented in
 * the JaVaFo advanced user manual, which bbpPairings mirrors), and telling an
 * arbiter "wrongly formatted input" instead of "exited with code 3" is the
 * difference between an actionable message and a shrug.
 */
export function describeExitCode(code: number): string {
  switch (code) {
    case 2:
      return 'the engine hit an unexpected error';
    case 3:
      return 'the engine rejected the tournament file as wrongly formatted';
    case 4:
      return 'the engine ran out of memory or exceeded a size limit';
    case 5:
      return 'the engine could not read the input file';
    default:
      return `the engine exited with code ${code}`;
  }
}
