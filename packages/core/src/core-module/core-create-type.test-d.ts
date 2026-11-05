import { describe, expectTypeOf, test } from 'vitest';
import { defineApp } from '../dsl/define-app.ts';
import type { Id } from '../ids/id.ts';
import type { AppActionTree } from '../model/app-action-tree.ts';

const app = defineApp({ id: 'only-core', modules: [] });
type Tree = AppActionTree<typeof app>;

describe('the explicit create commands of the control plane (S-109)', () => {
  test('core.backend.create takes the backend values and answers the id', () => {
    expectTypeOf<Tree['core']['entities']['backend']['create']['input']>().toEqualTypeOf<{
      readonly name: string;
      readonly app: string;
      readonly placement: string;
      readonly apiVersion?: string | undefined;
      readonly config?: Record<string, unknown> | undefined;
    }>();
    expectTypeOf<Tree['core']['entities']['backend']['create']['output']>().toEqualTypeOf<{
      readonly id: Id<'core.backend'>;
    }>();
  });

  test('core.tenant.create takes the tenant values and answers the id', () => {
    expectTypeOf<Tree['core']['entities']['tenant']['create']['input']>().toEqualTypeOf<{
      readonly backendId: Id<'core.backend'>;
      readonly name: string;
      readonly placement?: string | undefined;
      readonly apiVersion?: string | undefined;
      readonly domains?: readonly string[] | undefined;
    }>();
    expectTypeOf<Tree['core']['entities']['tenant']['create']['output']>().toEqualTypeOf<{
      readonly id: Id<'core.tenant'>;
    }>();
  });
});
