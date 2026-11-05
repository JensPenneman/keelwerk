// Benchmarks of the composition types of `@keelwerk/core` (architecture 13.11, S-18): the type
// instantiations of `defineApp` over 3 and over 25 modules, each module requiring its two
// predecessors. attest runs them on this package's own TypeScript 6.0.3; a count more than 15 %
// above the recorded one fails (`pnpm bench:types`). The modules are small on purpose: the
// instantiations of the real-sized synthetic modules are budgeted by `pnpm budgets`.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: twenty-five explicit module literals, the point of the benchmark
import { bench } from '@ark/attest';
import {
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  field,
  shape,
} from '@keelwerk/core';

const item01 = defineEntity({
  prefix: 'iaa',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.string().optional(),
  },
});
const m01Base = defineModuleBase({
  id: 'm01',
  version: '0.1.0',
  requires: [],
  entities: { item: item01 },
});
const m01 = defineModule(m01Base, {
  actions: {
    touch: defineCommand(m01Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item02 = defineEntity({
  prefix: 'iab',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m01, 'item').optional(),
  },
});
const m02Base = defineModuleBase({
  id: 'm02',
  version: '0.1.0',
  requires: [m01],
  entities: { item: item02 },
});
const m02 = defineModule(m02Base, {
  actions: {
    touch: defineCommand(m02Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item03 = defineEntity({
  prefix: 'iac',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m02, 'item').optional(),
  },
});
const m03Base = defineModuleBase({
  id: 'm03',
  version: '0.1.0',
  requires: [m01, m02],
  entities: { item: item03 },
});
const m03 = defineModule(m03Base, {
  actions: {
    touch: defineCommand(m03Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item04 = defineEntity({
  prefix: 'iad',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m03, 'item').optional(),
  },
});
const m04Base = defineModuleBase({
  id: 'm04',
  version: '0.1.0',
  requires: [m02, m03],
  entities: { item: item04 },
});
const m04 = defineModule(m04Base, {
  actions: {
    touch: defineCommand(m04Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item05 = defineEntity({
  prefix: 'iae',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m04, 'item').optional(),
  },
});
const m05Base = defineModuleBase({
  id: 'm05',
  version: '0.1.0',
  requires: [m03, m04],
  entities: { item: item05 },
});
const m05 = defineModule(m05Base, {
  actions: {
    touch: defineCommand(m05Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item06 = defineEntity({
  prefix: 'iaf',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m05, 'item').optional(),
  },
});
const m06Base = defineModuleBase({
  id: 'm06',
  version: '0.1.0',
  requires: [m04, m05],
  entities: { item: item06 },
});
const m06 = defineModule(m06Base, {
  actions: {
    touch: defineCommand(m06Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item07 = defineEntity({
  prefix: 'iag',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m06, 'item').optional(),
  },
});
const m07Base = defineModuleBase({
  id: 'm07',
  version: '0.1.0',
  requires: [m05, m06],
  entities: { item: item07 },
});
const m07 = defineModule(m07Base, {
  actions: {
    touch: defineCommand(m07Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item08 = defineEntity({
  prefix: 'iah',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m07, 'item').optional(),
  },
});
const m08Base = defineModuleBase({
  id: 'm08',
  version: '0.1.0',
  requires: [m06, m07],
  entities: { item: item08 },
});
const m08 = defineModule(m08Base, {
  actions: {
    touch: defineCommand(m08Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item09 = defineEntity({
  prefix: 'iai',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m08, 'item').optional(),
  },
});
const m09Base = defineModuleBase({
  id: 'm09',
  version: '0.1.0',
  requires: [m07, m08],
  entities: { item: item09 },
});
const m09 = defineModule(m09Base, {
  actions: {
    touch: defineCommand(m09Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item10 = defineEntity({
  prefix: 'iaj',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m09, 'item').optional(),
  },
});
const m10Base = defineModuleBase({
  id: 'm10',
  version: '0.1.0',
  requires: [m08, m09],
  entities: { item: item10 },
});
const m10 = defineModule(m10Base, {
  actions: {
    touch: defineCommand(m10Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item11 = defineEntity({
  prefix: 'iak',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m10, 'item').optional(),
  },
});
const m11Base = defineModuleBase({
  id: 'm11',
  version: '0.1.0',
  requires: [m09, m10],
  entities: { item: item11 },
});
const m11 = defineModule(m11Base, {
  actions: {
    touch: defineCommand(m11Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item12 = defineEntity({
  prefix: 'ial',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m11, 'item').optional(),
  },
});
const m12Base = defineModuleBase({
  id: 'm12',
  version: '0.1.0',
  requires: [m10, m11],
  entities: { item: item12 },
});
const m12 = defineModule(m12Base, {
  actions: {
    touch: defineCommand(m12Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item13 = defineEntity({
  prefix: 'iam',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m12, 'item').optional(),
  },
});
const m13Base = defineModuleBase({
  id: 'm13',
  version: '0.1.0',
  requires: [m11, m12],
  entities: { item: item13 },
});
const m13 = defineModule(m13Base, {
  actions: {
    touch: defineCommand(m13Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item14 = defineEntity({
  prefix: 'ian',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m13, 'item').optional(),
  },
});
const m14Base = defineModuleBase({
  id: 'm14',
  version: '0.1.0',
  requires: [m12, m13],
  entities: { item: item14 },
});
const m14 = defineModule(m14Base, {
  actions: {
    touch: defineCommand(m14Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item15 = defineEntity({
  prefix: 'iao',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m14, 'item').optional(),
  },
});
const m15Base = defineModuleBase({
  id: 'm15',
  version: '0.1.0',
  requires: [m13, m14],
  entities: { item: item15 },
});
const m15 = defineModule(m15Base, {
  actions: {
    touch: defineCommand(m15Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item16 = defineEntity({
  prefix: 'iap',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m15, 'item').optional(),
  },
});
const m16Base = defineModuleBase({
  id: 'm16',
  version: '0.1.0',
  requires: [m14, m15],
  entities: { item: item16 },
});
const m16 = defineModule(m16Base, {
  actions: {
    touch: defineCommand(m16Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item17 = defineEntity({
  prefix: 'iaq',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m16, 'item').optional(),
  },
});
const m17Base = defineModuleBase({
  id: 'm17',
  version: '0.1.0',
  requires: [m15, m16],
  entities: { item: item17 },
});
const m17 = defineModule(m17Base, {
  actions: {
    touch: defineCommand(m17Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item18 = defineEntity({
  prefix: 'iar',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m17, 'item').optional(),
  },
});
const m18Base = defineModuleBase({
  id: 'm18',
  version: '0.1.0',
  requires: [m16, m17],
  entities: { item: item18 },
});
const m18 = defineModule(m18Base, {
  actions: {
    touch: defineCommand(m18Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item19 = defineEntity({
  prefix: 'ias',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m18, 'item').optional(),
  },
});
const m19Base = defineModuleBase({
  id: 'm19',
  version: '0.1.0',
  requires: [m17, m18],
  entities: { item: item19 },
});
const m19 = defineModule(m19Base, {
  actions: {
    touch: defineCommand(m19Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item20 = defineEntity({
  prefix: 'iat',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m19, 'item').optional(),
  },
});
const m20Base = defineModuleBase({
  id: 'm20',
  version: '0.1.0',
  requires: [m18, m19],
  entities: { item: item20 },
});
const m20 = defineModule(m20Base, {
  actions: {
    touch: defineCommand(m20Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item21 = defineEntity({
  prefix: 'iau',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m20, 'item').optional(),
  },
});
const m21Base = defineModuleBase({
  id: 'm21',
  version: '0.1.0',
  requires: [m19, m20],
  entities: { item: item21 },
});
const m21 = defineModule(m21Base, {
  actions: {
    touch: defineCommand(m21Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item22 = defineEntity({
  prefix: 'iav',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m21, 'item').optional(),
  },
});
const m22Base = defineModuleBase({
  id: 'm22',
  version: '0.1.0',
  requires: [m20, m21],
  entities: { item: item22 },
});
const m22 = defineModule(m22Base, {
  actions: {
    touch: defineCommand(m22Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item23 = defineEntity({
  prefix: 'iaw',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m22, 'item').optional(),
  },
});
const m23Base = defineModuleBase({
  id: 'm23',
  version: '0.1.0',
  requires: [m21, m22],
  entities: { item: item23 },
});
const m23 = defineModule(m23Base, {
  actions: {
    touch: defineCommand(m23Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item24 = defineEntity({
  prefix: 'iax',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m23, 'item').optional(),
  },
});
const m24Base = defineModuleBase({
  id: 'm24',
  version: '0.1.0',
  requires: [m22, m23],
  entities: { item: item24 },
});
const m24 = defineModule(m24Base, {
  actions: {
    touch: defineCommand(m24Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

const item25 = defineEntity({
  prefix: 'iay',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    link: field.ref(m24, 'item').optional(),
  },
});
const m25Base = defineModuleBase({
  id: 'm25',
  version: '0.1.0',
  requires: [m23, m24],
  entities: { item: item25 },
});
const m25 = defineModule(m25Base, {
  actions: {
    touch: defineCommand(m25Base, { input: shape({ name: field.string() }), decide: () => [] }),
  },
});

// attest needs each `bench` call as a statement of its own.
bench('defineApp over 3 modules', () =>
  defineApp({ id: 'bench-3', modules: [m01, m02, m03] as const }),
).types([14875, 'instantiations']);
bench('defineApp over 25 modules', () =>
  defineApp({
    id: 'bench-25',
    modules: [
      m01,
      m02,
      m03,
      m04,
      m05,
      m06,
      m07,
      m08,
      m09,
      m10,
      m11,
      m12,
      m13,
      m14,
      m15,
      m16,
      m17,
      m18,
      m19,
      m20,
      m21,
      m22,
      m23,
      m24,
      m25,
    ] as const,
  }),
).types([51678, 'instantiations']);
