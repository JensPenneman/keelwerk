import { describe, expect, test } from 'vitest';
import { command, registryWith } from './support/effects-kit.ts';
import { dry } from './support/explain-kit.ts';

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

describe('redaction in a dry run (section 16.11.3)', () => {
  const plain = registryWith({
    actions: [
      command('add', (_i: unknown, ctx: Writes) => [
        ctx.write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' }),
      ]),
    ],
  });
  const entry = plain.entities.get('library.book');
  if (entry === undefined) throw new Error('the fixture has no library.book');
  const { addedBy, isbn } = entry.descriptor.fields;
  if (addedBy === undefined || isbn === undefined) throw new Error('the book lacks its fields');
  const registry = {
    ...plain,
    entities: new Map([
      ...plain.entities,
      [
        entry.ref,
        {
          ...entry,
          descriptor: {
            ...entry.descriptor,
            fields: {
              ...entry.descriptor.fields,
              addedBy: { ...addedBy, hidden: { history: true } },
              isbn: { ...isbn, sealed: true },
            },
          },
        },
      ] as const,
    ]),
  };

  test('the values of a hidden and of a secret field are not in the report', async () => {
    const report = await dry(registry, 'library.add').run();
    if (report.status !== 'decided') throw new Error('unreachable');
    expect(report.events[0]?.data).toMatchObject({
      values: { title: 'T', isbn: '[redacted]', addedBy: '[redacted]' },
    });
    expect(JSON.stringify(report)).not.toContain('t-1');
  });
});
