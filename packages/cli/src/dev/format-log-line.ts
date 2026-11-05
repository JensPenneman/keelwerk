/** The pino levels, by number. */
const levels: Readonly<Record<number, string>> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/**
 * One line of the app's JSON log as the terminal shows it: the message of an `info` line as it is
 * (the explain stream writes `POST /api/... → accounts.register 201 12 ms allow ...`), anything
 * above it with its level in front and its fields behind; a debug line is dropped; text that is not JSON is shown as it came.
 */
export function formatLogLine(line: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  if (typeof parsed !== 'object' || parsed === null) return line;
  const level = Reflect.get(parsed, 'level');
  const message = Reflect.get(parsed, 'msg');
  if (typeof message !== 'string') return line;
  const name = typeof level === 'number' ? (levels[level] ?? 'info') : 'info';
  if (name === 'debug' || name === 'trace') return undefined;
  if (name === 'info') return message;
  const { level: _level, time: _time, msg: _msg, ...fields } = parsed as Record<string, unknown>;
  const detail = Object.keys(fields).length === 0 ? '' : ` ${JSON.stringify(fields)}`;
  return `${name}: ${message}${detail}`;
}
