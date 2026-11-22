import { expect, test } from 'vitest';
import { announcedLines } from './support/announced-lines.ts';

test('a line logged before anyone asked for it is handed over when it is asked for', async () => {
  const { lines, log, logged } = announcedLines();
  log.info('ended', { code: 1000 });
  const line = await logged('ended');
  expect(line).toMatchObject({ level: 'info', message: 'ended', fields: { code: 1000 } });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe(line);
});
