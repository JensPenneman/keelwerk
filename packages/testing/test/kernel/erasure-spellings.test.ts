import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { bootErasureRules, stopBooted } from './support/erasure-rules-kit.ts';

afterEach(stopBooted);

const hyphenatedOf = (compact: string): string =>
  [8, 4, 4, 4, 12]
    .map((length, at, lengths) => {
      const from = lengths.slice(0, at).reduce((sum, part) => sum + part, 0);
      return compact.slice(from, from + length);
    })
    .join('-');

type Booted = Awaited<ReturnType<typeof bootErasureRules>>;

/** The threads of the subject as the kernel reads them: archived and erased ones included. */
async function threadsOf(runtime: Booted['runtime']) {
  const descriptor = runtime.app.registry.entities.get('probe.thread')?.descriptor;
  if (descriptor === undefined) throw new Error('no thread entity');
  return runtime.adapter.unit(
    runtime.namespace,
    { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme?.id ?? '' },
    async (unit) =>
      (await unit.rows.find(descriptor, { includeArchived: true, includeErased: true })).rows,
    { readOnly: true },
  );
}

describe('a subject is erased under every spelling it is stored in (14.7.5)', () => {
  for (const stored of ['hyphenated', 'compact'] as const) {
    const asked = stored === 'hyphenated' ? 'compact' : 'hyphenated';
    const spell = (id: string, form: 'hyphenated' | 'compact') =>
      form === 'compact' ? id.replaceAll('-', '') : hyphenatedOf(id.replaceAll('-', ''));

    /** Two threads of one subject stored as `stored`: one holds a personal value (a key and a reference), one holds none. */
    const plant = async (booted: Booted) => {
      const subject = crypto.randomUUID();
      const text = spell(subject, stored);
      await booted.operator.invoke('probe.open', {
        ownerId: text as never,
        title: 'sealed',
        topic: 'a private topic',
      });
      await booted.operator.invoke('probe.open', { ownerId: text as never, title: 'plain' });
      expect(await threadsOf(booted.runtime)).toHaveLength(2);
      return spell(subject, asked);
    };

    const erasedAll = async (booted: Booted) => {
      await booted.runtime.drainJobs();
      await booted.worker.pass();
      const rows = await threadsOf(booted.runtime);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.kwErasedAt).toBeDefined();
        expect(row.archivedAt).toBeDefined();
      }
    };

    test(`an operator's erasure asked as ${asked} reaches the rows stored as ${stored}`, {
      timeout: 60_000,
    }, async () => {
      const booted = await bootErasureRules();
      const subjectId = await plant(booted);
      const accepted = await booted.operator.invoke(
        'core.eraseSubject',
        { subjectId, reason: 'operator' } as never,
        { prefer: 'async' },
      );
      expect(accepted).toMatchObject({ status: 'accepted' });
      await erasedAll(booted);
    });

    test(`the probe's contributed rule lets a user holding the ${stored} spelling erase it asked as ${asked}`, {
      timeout: 60_000,
    }, async () => {
      const booted = await bootErasureRules();
      const subjectId = await plant(booted);
      const own = createLocalClient(booted.runtime, {
        principal: testPrincipal(spell(subjectId, stored)),
        tenant: 'acme',
      });
      const accepted = await own.invoke(
        'core.eraseSubject',
        { subjectId, reason: 'subjectRequest' } as never,
        { prefer: 'async' },
      );
      expect(accepted).toMatchObject({ status: 'accepted' });
      await erasedAll(booted);
    });
  }
});
