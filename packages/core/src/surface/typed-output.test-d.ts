import { describe, expectTypeOf, test } from 'vitest';
import { defineApp } from '../dsl/define-app.ts';
import { defineModule } from '../dsl/define-module.ts';
import { defineModuleBase } from '../dsl/define-module-base.ts';
import { defineQuery } from '../dsl/define-query.ts';
import { typedOutput } from '../dsl/typed-output.ts';
import type { AppActionTree } from '../model/app-action-tree.ts';

interface Report {
  readonly a: string;
}

const base = defineModuleBase({ id: 'docs', version: '0.1.0' });
const report = defineQuery(base, {
  output: typedOutput<Report>(),
  read: () => ({ a: 'x' }),
});
const wrong = defineQuery(base, {
  output: typedOutput<Report>(),
  // @ts-expect-error the result must be a Report
  read: () => ({ a: 1 }),
});
const docs = defineModule(base, { actions: { report } });
const app = defineApp({ id: 'typed-output', modules: [docs] });
type Tree = AppActionTree<typeof app>;

describe('a module query with a typed output', () => {
  test('the action tree carries the type and a wrong read result is an error', () => {
    expectTypeOf<Tree['docs']['actions']['report']['output']>().toEqualTypeOf<Report>();
    expectTypeOf(wrong).not.toBeAny();
  });
});
