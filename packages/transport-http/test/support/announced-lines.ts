import { type LoggedLine, recordingLogger } from '@keelwerk/testing';

/**
 * A recording logger and, for each message, a promise that settles with the first line logged with it
 * (also when the line was logged before the call). A case that waits for a line the host writes when
 * something ends awaits that promise instead of polling the lines.
 */
export function announcedLines() {
  const lines: LoggedLine[] = [];
  const announced = new Map<string, PromiseWithResolvers<LoggedLine>>();
  const announcement = (message: string): PromiseWithResolvers<LoggedLine> => {
    const found = announced.get(message) ?? Promise.withResolvers<LoggedLine>();
    announced.set(message, found);
    return found;
  };
  const push = lines.push.bind(lines);
  lines.push = (...added: LoggedLine[]): number => {
    for (const line of added) announcement(line.message).resolve(line);
    return push(...added);
  };
  return {
    lines,
    log: recordingLogger(lines),
    logged: (message: string): Promise<LoggedLine> => announcement(message).promise,
  };
}
