import { type LoggedLine, recordingLogger } from '@keelwerk/testing';

/**
 * A recording logger and `closed(n)`, which settles when the host has written its n-th line 'live socket
 * closed' (the host writes it when its side of a socket has ended and its place is given back): a signal
 * of the product, so a case waits on it and never polls.
 */
export function closingLines() {
  const lines: LoggedLine[] = [];
  const waits: { readonly n: number; readonly resolve: () => void }[] = [];
  const count = (): number => lines.filter((line) => line.message === 'live socket closed').length;
  const push = lines.push.bind(lines);
  lines.push = (...added: LoggedLine[]): number => {
    const length = push(...added);
    for (const wait of waits) if (count() >= wait.n) wait.resolve();
    return length;
  };
  return {
    log: recordingLogger(lines),
    closed: (n: number): Promise<void> =>
      count() >= n
        ? Promise.resolve()
        : new Promise((resolve) => {
            waits.push({ n, resolve });
          }),
  };
}
