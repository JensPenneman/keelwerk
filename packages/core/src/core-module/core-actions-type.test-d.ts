import { describe, expectTypeOf, test } from 'vitest';
import { defineApp } from '../dsl/define-app.ts';
import type { Id } from '../ids/id.ts';
import type { CapabilitiesDocument } from '../invoker/capabilities-document.ts';
import type { AppActionTree } from '../model/app-action-tree.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { CompositionReportDocument } from '../surface/composition-report-document.ts';
import type { MeDocument } from './me-document.ts';

const app = defineApp({ id: 'only-core', modules: [] });
type Tree = AppActionTree<typeof app>;

describe('the action types of the core module (decision 104, S-26)', () => {
  test('the commands carry their input and the instance id', () => {
    expectTypeOf<Tree['core']['entities']['tenant']['enter']['input']>().toEqualTypeOf<{
      readonly reason: string;
      readonly id: Id<'core.tenant'>;
      readonly ifVersion?: number;
    }>();
    expectTypeOf<
      Tree['core']['entities']['tenant']['setApiVersion']['input']['apiVersion']
    >().toEqualTypeOf<string>();
    expectTypeOf<
      Tree['core']['entities']['operatorToken']['revoke']['kind']
    >().toEqualTypeOf<'command'>();
    expectTypeOf<Tree['core']['entities']['tenant']['enter']['kind']>().toEqualTypeOf<'command'>();
    // A command that creates takes no instance id (F-11b change note, WP-56).
    expectTypeOf<Tree['core']['entities']['operatorToken']['issue']['input']>().toEqualTypeOf<{
      readonly label: string;
      readonly ttl?: string | undefined;
    }>();
    expectTypeOf<
      Tree['core']['entities']['operatorToken']['issue']['output']['token']
    >().toEqualTypeOf<string>();
    expectTypeOf<Tree['core']['actions']['introspect']['kind']>().toEqualTypeOf<'query'>();
  });

  test('the introspection queries answer typed documents that are not shapes', () => {
    expectTypeOf<Tree['core']['actions']['introspect']['output']>().toEqualTypeOf<ApiSurface>();
    expectTypeOf<
      Tree['core']['actions']['composition']['output']
    >().toEqualTypeOf<CompositionReportDocument>();
    expectTypeOf<
      Tree['core']['actions']['capabilities']['output']
    >().toEqualTypeOf<CapabilitiesDocument>();
    expectTypeOf<Tree['core']['actions']['me']['output']>().toEqualTypeOf<MeDocument>();
  });
});
