import { describe, expect, test } from 'vitest';
import { jsonLogger } from '../src/logging/json-logger.ts';

describe('the pino logger (S-46)', () => {
  test('writes JSON lines with the message first and the fields second, child bindings included', () => {
    const lines: string[] = [];
    const log = jsonLogger({ write: (line) => lines.push(line) }, 'debug');
    log.info('started', { port: 3000 });
    log.child({ app: 'shop' }).warn('slow', { ms: 900 });
    log.debug('phase');
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed[0]).toMatchObject({ level: 30, msg: 'started', port: 3000 });
    expect(parsed[1]).toMatchObject({ level: 40, msg: 'slow', ms: 900, app: 'shop' });
    expect(parsed[2]).toMatchObject({ level: 20, msg: 'phase' });
  });

  test('drops what is below the level', () => {
    const lines: string[] = [];
    jsonLogger({ write: (line) => lines.push(line) }).debug('quiet');
    expect(lines).toEqual([]);
  });
});
