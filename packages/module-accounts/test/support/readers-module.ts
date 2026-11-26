import {
  core,
  defineContribution,
  defineFill,
  defineModule,
  defineModuleBase,
  type Membership,
  type ModuleBaseType,
  type ModuleType,
  within,
} from '@keelwerk/core';

/** The person to whom the module gives a membership of its own kind. */
const readerSubject = 'reader';

const toCore = defineContribution(core, {});
const readersBaseDef = defineModuleBase({
  id: 'readers',
  version: '0.0.0',
  contributions: { toCore },
});
interface ReadersBase extends ModuleBaseType<typeof readersBaseDef> {}
const readersBase: ReadersBase = readersBaseDef;

const enrichers = defineFill(within(readersBase, toCore), 'principalEnrichers', () => [
  {
    id: 'readers.enrich',
    // biome-ignore lint/correctness/useYield: the answer needs no load
    *enrich(principal) {
      if (principal.kind !== 'user' || principal.subject !== readerSubject) return {};
      const memberships: readonly Membership[] = [
        { kind: 'readers.directory', id: 'one', role: 'reader' },
      ];
      return { memberships };
    },
  },
]);

const readersDef = defineModule(readersBase, {
  contributes: { toCore: { extensionPoints: { principalEnrichers: enrichers } } },
});
interface Readers extends ModuleType<typeof readersDef> {}
/** An application's own module: it gives one person a membership of its own kind, the kind its directory rule asks for. */
const readers: Readers = readersDef;

export { readerSubject, readers };
