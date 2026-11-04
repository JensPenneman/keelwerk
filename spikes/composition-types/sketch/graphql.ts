import { contracts } from '../src/contracts.ts';
import { defineModule, type ModuleType } from '../src/define-module.ts';
import { defineModuleBase, type ModuleBaseType } from '../src/define-module-base.ts';

interface GraphqlBase extends ModuleBaseType<typeof graphqlBaseDef> {}

const graphqlBaseDef = defineModuleBase({
  id: 'graphql',
  version: '0.1.0',
  requires: [contracts.httpHost],
});
const graphqlBase: GraphqlBase = graphqlBaseDef;
const graphqlDef = defineModule(graphqlBase, {});

/** Stand-in for @keelwerk/transport-graphql. */
export interface Graphql extends ModuleType<typeof graphqlDef> {}

/** The GraphQL transport module. */
export const graphql: Graphql = graphqlDef;
