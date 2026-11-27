import { type AnyField, field, shape } from '@keelwerk/core';

/** The sites where a module declares a shape (the nine of WP-166; an effect's input and output count as one). */
const sites = [
  'entity',
  'domainEvent',
  'processEvent',
  'streamRecord',
  'commandInput',
  'commandOutput',
  'outcomeInput',
  'effectInput',
  'effectOutput',
  'configuration',
] as const;
type Site = (typeof sites)[number];

/** What marks a leaf: personal, a secret, a verifier, or a credential that is also marked personal. */
const kinds = ['personal', 'secret', 'verifier', 'secretPersonal', 'verifierPersonal'] as const;
type Kind = (typeof kinds)[number];

/** What a placement is built from: the marked leaf and the site's ways to mark a member personal. */
interface Parts {
  readonly leaf: AnyField;
  /** Marks a member personal, naming the subject of the site (and the options of `.personal()`, if any). */
  readonly personal: (member: AnyField, options?: object) => AnyField;
  /** Marks a member personal, naming another subject than the site's. */
  readonly other: (member: AnyField) => AnyField;
}

/** Which kinds a placement is built for: all three plain marks, a personal one only, or the credentials that are also personal too. */
type Scope = 'all' | 'personal' | 'credentials';

/** One position the field builders allow a mark at, how to build it and the value that carries a marker. */
interface Placement {
  readonly name: string;
  readonly scope: Scope;
  /** The only site this placement is declared at (the field modifiers of an entity), if any. */
  readonly at?: Site;
  readonly build: (parts: Parts) => AnyField;
  readonly value: (marker: string) => unknown;
}

const json = (members: Record<string, AnyField>): AnyField =>
  field.json(shape(members as never)) as AnyField;
const list = (member: AnyField): AnyField => field.list(member) as never;
const text = field.string({ maxLength: 100 });

const positional: readonly Omit<Placement, 'scope'>[] = [
  { name: 'top', build: (p) => p.leaf, value: (m) => m },
  { name: 'optional', build: (p) => p.leaf.optional() as never, value: (m) => m },
  { name: 'list', build: (p) => list(p.leaf), value: (m) => [m] },
  { name: 'optionalList', build: (p) => list(p.leaf).optional() as never, value: (m) => [m] },
  { name: 'set', build: (p) => field.set(p.leaf) as never, value: (m) => new Set([m]) },
  { name: 'listOfLists', build: (p) => list(list(p.leaf)), value: (m) => [[m]] },
  {
    name: 'setOfLists',
    build: (p) => field.set(list(p.leaf)) as never,
    value: (m) => new Set([[m]]),
  },
  { name: 'nested', build: (p) => json({ m: p.leaf }), value: (m) => ({ m }) },
  {
    name: 'jsonInJson',
    build: (p) => json({ inner: json({ m: p.leaf }) }),
    value: (m) => ({ inner: { m } }),
  },
  { name: 'listOfJson', build: (p) => list(json({ m: p.leaf })), value: (m) => [{ m }] },
  { name: 'jsonWithList', build: (p) => json({ m: list(p.leaf) }), value: (m) => ({ m: [m] }) },
];

/** A member marked personal as a whole, over a value that holds no mark inside, and one that holds a mark. */
const whole: readonly Omit<Placement, 'scope'>[] = [
  { name: 'wholeList', build: (p) => p.personal(list(field.string())), value: (m) => [m] },
  {
    name: 'wholeSet',
    build: (p) => p.personal(field.set(field.string()) as never),
    value: (m) => new Set([m]),
  },
  {
    name: 'wholeJson',
    build: (p) => p.personal(json({ e: field.string() })),
    value: (m) => ({ e: m }),
  },
  {
    name: 'wholeJsonWithList',
    build: (p) => p.personal(json({ e: list(field.string()) })),
    value: (m) => ({ e: [m] }),
  },
  {
    name: 'listOfWholeJson',
    build: (p) => list(p.personal(json({ e: field.string() }))),
    value: (m) => [{ e: m }],
  },
  {
    name: 'wholeListInnerSame',
    build: (p) => p.personal(list(p.personal(field.string()))),
    value: (m) => [m],
  },
  {
    name: 'wholeListInnerOther',
    build: (p) => p.personal(list(p.other(field.string()))),
    value: (m) => [m],
  },
  {
    name: 'wholeJsonInnerSame',
    build: (p) => p.personal(json({ e: p.personal(field.string()) })),
    value: (m) => ({ e: m }),
  },
  {
    name: 'wholeJsonInnerOther',
    build: (p) => p.personal(json({ e: p.other(field.string()) })),
    value: (m) => ({ e: m }),
  },
];

/** The modifiers an entity field can carry beside a mark: lookups, hidden, default, maskable. */
const modifiers: readonly Omit<Placement, 'scope' | 'at'>[] = [
  { name: 'unique', build: (p) => p.leaf.unique() as never, value: (m) => m },
  { name: 'index', build: (p) => p.leaf.index() as never, value: (m) => m },
  { name: 'hidden', build: (p) => p.leaf.hidden() as never, value: (m) => m },
  { name: 'defaulted', build: (p) => p.leaf.default('DEFAULT' as never) as never, value: (m) => m },
  { name: 'maskable', build: (p) => p.leaf.maskable() as never, value: (m) => m },
  { name: 'hiddenUnique', build: (p) => p.leaf.hidden().unique() as never, value: (m) => m },
];

/** The lookup options of a personal field: what each blind index answers, and how values compare. */
const lookups: readonly (readonly [string, object])[] = [
  ['Eq', { queries: ['eq'] }],
  ['Prefix', { queries: ['prefix'] }],
  ['Contains', { queries: ['contains'] }],
  ['Search', { queries: ['search'] }],
  ['Every', { queries: ['eq', 'prefix', 'contains'], normalize: 'caseless' }],
  ['Email', { queries: ['eq'], normalize: 'email' }],
];

const placements: readonly Placement[] = [
  ...positional.map((p) => ({ ...p, scope: 'all' as const })),
  ...positional
    .filter((p) => ['top', 'list', 'nested'].includes(p.name))
    .map((p) => ({ ...p, scope: 'credentials' as const })),
  ...whole.map((p) => ({ ...p, scope: 'personal' as const })),
  ...modifiers.map((p) => ({ ...p, scope: 'all' as const, at: 'entity' as const })),
  ...lookups.map(([name, options]) => ({
    name: `lookup${name}`,
    scope: 'personal' as const,
    at: 'entity' as const,
    build: (p: Parts) => p.personal(text, options),
    value: (m: string) => m,
  })),
];

/** One combination of the grid: a mark of a kind at a position of one site. */
interface Combo {
  readonly site: Site;
  readonly kind: Kind;
  readonly placement: Placement;
  readonly name: string;
}

const isCredentialAlsoPersonal = (kind: Kind) =>
  kind === 'secretPersonal' || kind === 'verifierPersonal';

/** Every kind at every position at every site (a position built for one kind or one site is left out for the others). */
const grid: readonly Combo[] = sites.flatMap((site) =>
  kinds.flatMap((kind) =>
    placements
      .filter(
        (placement) =>
          (placement.at === undefined || placement.at === site) &&
          (placement.scope === 'all'
            ? !isCredentialAlsoPersonal(kind)
            : placement.scope === 'personal'
              ? kind === 'personal'
              : isCredentialAlsoPersonal(kind)),
      )
      .map((placement) => ({
        site,
        kind,
        placement,
        name: `${kind}${placement.name.charAt(0).toUpperCase()}${placement.name.slice(1)}`,
      })),
  ),
);

/** The member a combination declares at its site. */
function memberOf(
  combo: Combo,
  personal: (member: AnyField, options?: object) => AnyField,
  other: (member: AnyField) => AnyField,
): AnyField {
  const credential = (combo.kind.startsWith('secret') ? field.secret() : field.verifier()) as never;
  const leaf: AnyField =
    combo.kind === 'personal'
      ? personal(field.string())
      : isCredentialAlsoPersonal(combo.kind)
        ? personal(credential)
        : credential;
  return combo.placement.build({ leaf, personal, other });
}

/** The marker one value of a member carries: unique per site, member and subject. */
const markerOf = (site: Site, member: string, subject: string): string =>
  `MARK-${site}-${member}-${subject}`.toUpperCase();

export type { Combo, Kind, Placement, Site };
export { grid, kinds, markerOf, memberOf, placements, sites };
