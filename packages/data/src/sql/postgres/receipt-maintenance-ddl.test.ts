import { expect, test } from 'vitest';
import { commandReceiptTable } from './command-receipt-table.ts';
import { frameworkSteps } from './framework-steps.ts';

const control = { control: true } as const;

const step = frameworkSteps.find((candidate) => candidate.id === '0006');
if (step === undefined) throw new Error('no framework step 0006');

const render = (root: string, options: { readonly control?: boolean }): string =>
  `${step
    .ddl(root, options)
    .map((statement) => `${statement};`)
    .join('\n\n')}\n`;

test('step 0006 of a namespace and of the control store is the stored format', async () => {
  await expect(render('example', {})).toMatchFileSnapshot('./golden/namespace-0006.sql');
  await expect(render('kw__control', control)).toMatchFileSnapshot('./golden/control-0006.sql');
});

test('step 0006 replaces the receipt maintenance policy by select and delete, only where the table is', () => {
  for (const [root, options] of [
    ['example', {}],
    ['kw__control', control],
  ] as const) {
    const [block, ...rest] = step.ddl(root, options);
    expect(rest).toEqual([]);
    expect(block).toContain(`if to_regclass('"${root}".${commandReceiptTable}') is not null then`);
    for (const policy of ['maintenance', 'maintenance_select', 'maintenance_delete']) {
      expect(block).toContain(
        `drop policy if exists ${policy} on "${root}".${commandReceiptTable};`,
      );
    }
    expect(block).toContain(
      `create policy maintenance_select on "${root}".${commandReceiptTable} for select `,
    );
    expect(block).toContain(
      `create policy maintenance_delete on "${root}".${commandReceiptTable} for delete `,
    );
    expect(block).not.toMatch(/create policy maintenance on|for (all|insert|update)/);
  }
  expect(step.ddl('kw__root', control)).toEqual(step.ddl('kw__root', {}));
  expect(step.grants('example', 'kw_app', {})).toEqual([]);
});
