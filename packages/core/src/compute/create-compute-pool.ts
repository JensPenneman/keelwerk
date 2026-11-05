import { availableParallelism } from 'node:os';
import process from 'node:process';
import { Worker } from 'node:worker_threads';
import { errors } from '../errors/errors.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { Argon2idJob, Argon2idJobResult } from './run-argon2id-job.ts';

type Request =
  | { readonly op: 'hash'; readonly password: string; readonly salt: Uint8Array }
  | { readonly op: 'verify'; readonly password: string; readonly verifier: string };

interface Pending {
  readonly request: Request;
  readonly resolve: (value: string | boolean) => void;
  readonly reject: (error: Error) => void;
}

interface Slot {
  readonly worker: Worker;
  current: { readonly id: number; readonly pending: Pending } | undefined;
}

/**
 * The options a worker inherits from its process: those that only make sense for the main
 * script (`--input-type`, and the script text of `-e`/`--eval`/`-p`/`--print`) are dropped, or
 * the worker refuses to start when the process itself runs from a string.
 */
function workerExecArgv(argv: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const option = argv[i] ?? '';
    if (option.startsWith('--input-type')) {
      if (option === '--input-type') i += 1;
      continue;
    }
    if (['-e', '--eval', '-p', '--print', '-pe'].includes(option)) {
      i += 1;
      continue;
    }
    kept.push(option);
  }
  return kept;
}

/** Options of the pool. */
export interface ComputePoolOptions {
  /** Workers, which is also the number of computations that run at once; default one less than the cores, 1 to 4. */
  readonly size?: number;
}

/**
 * The kernel's computation pool (7.9.3): Argon2id runs in `node:worker_threads` workers, at most
 * `size` at a time, the rest queued, so the event loop never waits for a hash. `close` lets the
 * running and queued computations finish, stops the workers and refuses new ones.
 */
export function createComputePool(options: ComputePoolOptions = {}): ComputePool {
  const size = Math.max(1, options.size ?? Math.min(4, availableParallelism() - 1));
  // Run from source the worker is a .ts file; in the built package its .js sibling.
  const workerUrl = import.meta.url.endsWith('.ts')
    ? new URL('./argon2id-worker.ts', import.meta.url)
    : new URL('./argon2id-worker.js', import.meta.url);
  const slots: Slot[] = [];
  const queue: Pending[] = [];
  let nextId = 0;
  let closing: Promise<void> | undefined;
  let idle: (() => void) | undefined;

  const settle = (): void => {
    pump();
    if (idle !== undefined && queue.length === 0 && slots.every((s) => s.current === undefined)) {
      idle();
    }
  };

  const finish = (slot: Slot): void => {
    slot.current = undefined;
    settle();
  };

  const spawn = (): Slot => {
    const worker = new Worker(workerUrl, { execArgv: workerExecArgv(process.execArgv) });
    worker.unref();
    const slot: Slot = { worker, current: undefined };
    worker.on('message', (result: Argon2idJobResult) => {
      const running = slot.current;
      if (running === undefined || running.id !== result.id) return;
      if (result.ok) running.pending.resolve(result.value);
      else running.pending.reject(errors.internal(`the computation failed: ${result.message}`));
      finish(slot);
    });
    const lost = (reason: string): void => {
      const index = slots.indexOf(slot);
      if (index >= 0) slots.splice(index, 1);
      const running = slot.current;
      slot.current = undefined;
      running?.pending.reject(errors.internal(`the computation worker stopped: ${reason}`));
      settle();
    };
    worker.on('error', (error: Error) => lost(error.message));
    worker.on('exit', () => {
      if (slots.includes(slot)) lost('exited');
    });
    slots.push(slot);
    return slot;
  };

  function pump(): void {
    while (queue.length > 0) {
      const slot =
        slots.find((s) => s.current === undefined) ?? (slots.length < size ? spawn() : undefined);
      const pending = queue.shift();
      if (slot === undefined || pending === undefined) {
        if (pending !== undefined) queue.unshift(pending);
        return;
      }
      const id = nextId++;
      slot.current = { id, pending };
      const job: Argon2idJob = { id, ...pending.request };
      slot.worker.postMessage(job);
    }
  }

  const submit = <T extends string | boolean>(request: Request): Promise<T> => {
    if (closing !== undefined)
      return Promise.reject(errors.unavailable('the computation pool is closed'));
    return new Promise<T>((resolve, reject) => {
      queue.push({ request, resolve: (value) => resolve(value as T), reject });
      pump();
    });
  };

  return {
    argon2idHash: (password, salt) => submit<string>({ op: 'hash', password, salt }),
    argon2idVerify: (verifier, password) => submit<boolean>({ op: 'verify', password, verifier }),
    close() {
      closing ??= (async () => {
        if (queue.length > 0 || slots.some((s) => s.current !== undefined)) {
          await new Promise<void>((resolve) => {
            idle = resolve;
          });
        }
        const stopping = slots.splice(0).map((slot) => slot.worker.terminate());
        await Promise.all(stopping);
      })();
      return closing;
    },
  };
}
