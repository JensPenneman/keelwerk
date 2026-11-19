import { relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import type { Reporter } from 'vitest/node';
import { inFlightLine } from './in-flight-line.ts';
import { slowestLines } from './slowest-lines.ts';

const defaultHeartbeatMs = 60_000;
const slowestTestCount = 20;
const slowestFileCount = 10;

interface Timing {
  readonly name: string;
  readonly duration: number;
}

/**
 * Adds two things to the CI log of a Vitest run: every heartbeat, and when the process exits during
 * a run, the test files in flight; at the end of a run, the slowest tests and test files.
 */
export class CiTestReporter implements Reporter {
  readonly #write: (text: string) => void;
  readonly #now: () => number;
  readonly #heartbeatMs: number;
  readonly #started = new Map<string, number>();
  readonly #tests: Timing[] = [];
  readonly #files: Timing[] = [];
  #root = '';
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    options: {
      readonly write?: (text: string) => void;
      readonly now?: () => number;
      readonly heartbeatMs?: number;
    } = {},
  ) {
    this.#write =
      options.write ??
      ((text: string): void => {
        process.stdout.write(text);
      });
    this.#now = options.now ?? ((): number => performance.now());
    this.#heartbeatMs = options.heartbeatMs ?? defaultHeartbeatMs;
  }

  readonly #onExit = (): void => this.writeInFlight();

  /** Keeps `vitest.config.root`; paths are written relative to it. */
  onInit(vitest: { readonly config: { readonly root: string } }): void {
    this.#root = vitest.config.root;
  }

  /** Starts the heartbeat and adds one exit listener. */
  onTestRunStart(): void {
    this.#timer = setInterval(() => this.writeInFlight(), this.#heartbeatMs);
    this.#timer.unref();
    process.once('exit', this.#onExit);
  }

  /** Records the start of the file (the worker starts it now). */
  onTestModuleQueued(testModule: { readonly moduleId: string }): void {
    this.#started.set(this.#path(testModule.moduleId), this.#now());
  }

  /** Removes the file from the files in flight and records its wall time. */
  onTestModuleEnd(testModule: { readonly moduleId: string }): void {
    const path = this.#path(testModule.moduleId);
    const start = this.#started.get(path);
    if (start === undefined) {
      return;
    }
    this.#started.delete(path);
    this.#files.push({ name: path, duration: this.#now() - start });
  }

  /** Records the duration of one test case; a case without diagnostic is skipped. */
  onTestCaseResult(testCase: {
    readonly fullName: string;
    readonly module: { readonly moduleId: string };
    diagnostic(): { readonly duration: number } | undefined;
  }): void {
    const diagnostic = testCase.diagnostic();
    if (diagnostic === undefined) {
      return;
    }
    this.#tests.push({
      name: `${this.#path(testCase.module.moduleId)} > ${testCase.fullName}`,
      duration: diagnostic.duration,
    });
  }

  /** Stops the heartbeat, writes the slowest tests and files, then the files still in flight. */
  onTestRunEnd(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    process.off('exit', this.#onExit);
    for (const block of [
      slowestLines('Slowest tests', this.#tests, slowestTestCount),
      slowestLines('Slowest test files', this.#files, slowestFileCount),
    ]) {
      if (block.length > 0) {
        this.#write(`\n${block.join('\n')}\n`);
      }
    }
    this.writeInFlight();
  }

  /** Writes the line of the files in flight; nothing when no file runs. */
  writeInFlight(): void {
    const line = inFlightLine(this.#started, this.#now());
    if (line !== undefined) {
      this.#write(`${line}\n`);
    }
  }

  #path(moduleId: string): string {
    return this.#root === '' ? moduleId : relative(this.#root, moduleId);
  }
}
