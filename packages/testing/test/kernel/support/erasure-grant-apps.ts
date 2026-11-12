import type { EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  core,
  defineApp,
  defineCommand,
  defineContribution,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  sameSubject,
  shape,
  within,
} from '@keelwerk/core';
import { type erasureDumpApp, erasureProbe } from './erasure-probe-module.ts';
import { relay } from './relay-module.ts';

const toCore = defineContribution(core, {});
const strangerBaseDef = defineModuleBase({
  id: 'stranger',
  version: '0.1.0',
  contributions: { toCore },
});
interface StrangerBase extends ModuleBaseType<typeof strangerBaseDef> {}
const strangerBase: StrangerBase = strangerBaseDef;

/** Allows every user to erase any subject, and holds no row of any subject. */
const anyone = defineRule(within(strangerBase, toCore), core.actions.eraseSubject, {
  effect: 'allow',
  principal: 'user',
  reason: 'Everyone erases.',
});

const strangerDef = defineModule(strangerBase, {
  contributes: { toCore: { policies: { eraseSubject: { anyone } } } },
});
interface Stranger extends ModuleType<typeof strangerDef> {}
const stranger: Stranger = strangerDef;

const strangerAppDef = defineApp({
  id: 'erasure-stranger',
  modules: [erasureProbe, relay, stranger] as const,
});
/**
 * The probe app with a module that grants every user the erasure of any subject and owns none.
 * Typed as the probe app: the kit's helpers use only the probe's actions.
 */
const strangerApp = strangerAppDef as unknown as typeof erasureDumpApp;

const holdBaseDef = defineModuleBase({
  id: 'hold',
  version: '0.1.0',
  contributions: { toCore },
});
interface HoldBase extends ModuleBaseType<typeof holdBaseDef> {}
const holdBase: HoldBase = holdBaseDef;

/** A legal hold: nobody, the operator included, erases while it stands. */
const legalHold = defineRule(within(holdBase, toCore), core.actions.eraseSubject, {
  effect: 'deny',
  reason: 'A legal hold keeps every subject.',
});

const holdDef = defineModule(holdBase, {
  contributes: { toCore: { policies: { eraseSubject: { legalHold } } } },
});
interface Hold extends ModuleType<typeof holdDef> {}
const hold: Hold = holdDef;

const heldAppDef = defineApp({
  id: 'erasure-held',
  modules: [erasureProbe, relay, hold] as const,
});
/** The probe app with a module that contributes a deny rule on the erasure (typed as the probe app). */
const heldApp = heldAppDef as unknown as typeof erasureDumpApp;

const releasedAppDef = defineApp({
  id: 'erasure-released',
  modules: [erasureProbe, relay, hold] as const,
  policies: { disable: ['hold.core.eraseSubject.legalHold'] },
});
/** The held app once the platform has disabled the hold's rule with `policies.disable` (typed as the probe app). */
const releasedApp = releasedAppDef as unknown as typeof erasureDumpApp;

/** A rule the platform writes in the app (`policies.add`): any user erases any subject. */
const addedRule = {
  id: 'platform.eraseSubject.anyone',
  module: 'platform',
  effect: 'allow',
  subject: { module: 'core' },
  actions: ['eraseSubject'],
  principal: 'user',
  disabled: false,
};

const addedAppDef = defineApp({
  id: 'erasure-added',
  modules: [erasureProbe, relay] as const,
  policies: { add: [addedRule] },
});
/** The probe app with a platform rule that grants every user the erasure of any subject (typed as the probe app). */
const addedApp = addedAppDef as unknown as typeof erasureDumpApp;

/** A parent that names its owner; it holds no data subject itself, so only its child's path reaches the owner. */
const parentDef = defineEntity({
  prefix: 'lkp',
  fields: { owner: field.subject() },
});
interface Parent extends EntityType<typeof parentDef> {}
const parent: Parent = parentDef;

/** A row whose data subject is a path through a reference (`parentId.owner`) and that holds a personal value. */
const childDef = defineEntity({
  prefix: 'lkc',
  dataSubject: 'parentId.owner',
  fields: { parentId: field.ref.own('parent'), note: field.string().personal() },
});
interface Child extends EntityType<typeof childDef> {}
const child: Child = childDef;

/** A row on the same reference path that holds no personal value at all: no key and no reference is ever written for it. */
const leafDef = defineEntity({
  prefix: 'lkl',
  dataSubject: 'parentId.owner',
  fields: { parentId: field.ref.own('parent'), label: field.string() },
});
interface Leaf extends EntityType<typeof leafDef> {}
const leaf: Leaf = leafDef;

const linkedToCore = defineContribution(core, {});
const linkedBaseDef = defineModuleBase({
  id: 'linked',
  version: '0.1.0',
  contributions: { toCore: linkedToCore },
  entities: { parent, child, leaf },
});
interface LinkedBase extends ModuleBaseType<typeof linkedBaseDef> {}
const linkedBase: LinkedBase = linkedBaseDef;

/** Writes a parent for `owner` (the spelling is kept as given) and a child with a personal note. */
const link = defineCommand(linkedBase, {
  input: shape({ owner: field.subject(), note: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const parentId = yield* ctx.newId(parent);
    const childId = yield* ctx.newId(child);
    return [
      ctx.write.linked.parent.create({ id: parentId, owner: input.owner }),
      ctx.write.linked.child.create({ id: childId, parentId, note: input.note }),
    ];
  },
});

/** Writes a parent for `owner` and a leaf that holds no personal value. */
const linkLeaf = defineCommand(linkedBase, {
  input: shape({ owner: field.subject(), label: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const parentId = yield* ctx.newId(parent);
    const leafId = yield* ctx.newId(leaf);
    return {
      events: [
        ctx.write.linked.parent.create({ id: parentId, owner: input.owner }),
        ctx.write.linked.leaf.create({ id: leafId, parentId, label: input.label }),
      ],
      result: { leafId },
    };
  },
  output: shape({ leafId: field.ref.own('leaf') }),
});

/** A command any signed-in user runs; it writes nothing, so only its receipt remains. */
const touch = defineCommand(linkedBase, {
  input: shape({}),
  principal: 'user',
  decide: () => ({}),
});

/** A user erases their own subject, written in any spelling. */
const ownErase = defineRule(within(linkedBase, linkedToCore), core.actions.eraseSubject, {
  effect: 'allow',
  principal: 'user',
  when: (context, input) =>
    sameSubject(
      context.principal.subject,
      String((input as { readonly subjectId?: unknown }).subjectId),
    ),
  reason: 'A user erases their own subject.',
});

const linkedDef = defineModule(linkedBase, {
  actions: { link, linkLeaf, touch },
  contributes: { toCore: { policies: { eraseSubject: { ownErase } } } },
  policies: {
    link: { operators: defineRule(linkedBase, link, { effect: 'allow', principal: 'operator' }) },
    touch: { users: defineRule(linkedBase, touch, { effect: 'allow', principal: 'user' }) },
    linkLeaf: {
      operators: defineRule(linkedBase, linkLeaf, { effect: 'allow', principal: 'operator' }),
    },
  },
});
interface Linked extends ModuleType<typeof linkedDef> {}
const linked: Linked = linkedDef;

const linkedAppDef = defineApp({
  id: 'erasure-linked',
  modules: [erasureProbe, relay, linked] as const,
});
/**
 * The probe app with a module whose only row of a subject is reached through a reference path
 * (typed as the probe app, plus the module's own `linked.link`).
 */
const linkedApp = linkedAppDef as unknown as typeof erasureDumpApp;

export {
  addedApp as erasureAddedApp,
  heldApp as erasureHeldApp,
  linkedApp as erasureLinkedApp,
  releasedApp as erasureReleasedApp,
  strangerApp as erasureStrangerApp,
};
