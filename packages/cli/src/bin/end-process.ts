/** A stream that tells, through a callback, when what was written to it has been handed on. */
interface Writing {
  write(text: string, callback: () => void): unknown;
}

/** What the end of the process writes to and calls: the standard streams and `exit`. */
interface Ending {
  readonly streams: readonly Writing[];
  readonly exit: (code: number) => unknown;
}

/** Settles once what was written to the stream has been handed on, or the stream cannot take it. */
const written = (stream: Writing): Promise<void> =>
  new Promise((resolve) => {
    stream.write('', () => resolve());
  });

/**
 * Runs the command, and when it has returned and its output is written out to every stream ends
 * the process with its code, so that nothing a command left open, such as a connection that is
 * still waiting for a database, keeps the process alive.
 */
export async function endProcess(
  run: () => Promise<number>,
  { streams, exit }: Ending,
): Promise<void> {
  const code = await run();
  await Promise.all(streams.map(written));
  exit(code);
}
