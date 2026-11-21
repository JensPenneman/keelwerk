import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ChildConfig } from './child-config.ts';

const childFile = new URL('./worker-child.ts', import.meta.url).pathname;

/** A child process of the measurement and the lines it has written so far. */
export interface Child {
  /** Settles when the child has written `line` (rejects if it ends first). */
  said(line: string): Promise<void>;
  send(line: string): void;
  /** Ends its input and waits for it to stop its runtime and exit. */
  stop(): Promise<void>;
}

function start(config: ChildConfig): Child {
  const process: ChildProcess = spawn(
    globalThis.process.execPath,
    ['--conditions=@keelwerk/source', childFile, JSON.stringify(config)],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const heard: string[] = [];
  const waiting: { line: string; resolve: () => void }[] = [];
  const ended = new Promise<number | null>((resolve) => process.once('exit', resolve));
  if (process.stdout === null || process.stdin === null) throw new Error('the child has no pipes');
  createInterface({ input: process.stdout }).on('line', (line) => {
    heard.push(line);
    for (const waiter of waiting.filter((one) => one.line === line)) waiter.resolve();
  });
  return {
    said: (line) =>
      heard.includes(line)
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            waiting.push({ line, resolve });
            void ended.then((code) =>
              reject(new Error(`a child ended with ${code} before ${line}`)),
            );
          }),
    send: (line) => {
      process.stdin?.write(`${line}\n`);
    },
    stop: async () => {
      process.stdin?.end();
      const code = await ended;
      if (code !== 0) throw new Error(`a child ended with ${code}`);
    },
  };
}

/** Starts the children (one process each) and waits until every one has joined. */
export async function runChildren(configs: readonly ChildConfig[]): Promise<readonly Child[]> {
  const children = configs.map(start);
  await Promise.all(children.map((child) => child.said('ready')));
  return children;
}
