import { describe, expect, test } from 'vitest';
import {
  appOf,
  codes,
  commandOf,
  effectOf,
  moduleOf,
  registryOf,
} from '../../test/credential-shapes-kit.ts';
import { field } from '../fields/field.ts';
import { cellOf } from '../fields/mark-cells.ts';
import type { MarkKind, MarkPosition, MarkSite } from '../fields/mark-types.ts';
import { shape } from '../fields/shape.ts';
import { checkCredentialShapes } from './check-credential-shapes.ts';
import type { Registry } from './registry.ts';

/** What the registry answers for one kind at the three positions of a site: accepted, an older check's code, or this check's. */
type Outcome =
  | 'ok'
  | 'older'
  | 'personalNotSealed'
  | 'credentialNotSealed'
  | 'credentialInJson'
  | 'verifierOutsideEntity';
const [ok, older, pns, cns, cij, voe] = [
  'ok',
  'older',
  'personalNotSealed',
  'credentialNotSealed',
  'credentialInJson',
  'verifierOutsideEntity',
] as const;
type Row = readonly [top: Outcome, element: Outcome, nested: Outcome];

/** The table, written out by hand: the proof that the one definition says what the documentation says. */
const expected: Readonly<Record<MarkSite, Readonly<Record<MarkKind, Row>>>> = {
  entity: { personal: [ok, pns, pns], secret: [ok, cns, cij], verifier: [ok, older, cij] },
  domainEvent: { personal: [ok, ok, pns], secret: [cns, cns, cij], verifier: [cns, older, cij] },
  processEvent: {
    personal: [ok, ok, pns],
    secret: [older, older, cij],
    verifier: [older, older, cij],
  },
  streamRecord: {
    personal: [ok, ok, pns],
    secret: [older, older, cij],
    verifier: [older, older, cij],
  },
  commandInput: { personal: [ok, ok, pns], secret: [ok, ok, cij], verifier: [voe, voe, voe] },
  commandOutput: {
    personal: [older, older, pns],
    secret: [ok, ok, cij],
    verifier: [voe, voe, voe],
  },
  outcomeInput: { personal: [pns, pns, pns], secret: [cns, cns, cij], verifier: [voe, voe, voe] },
  effectInput: { personal: [ok, ok, pns], secret: [ok, ok, cij], verifier: [voe, voe, voe] },
  effectOutput: { personal: [older, older, pns], secret: [ok, ok, cij], verifier: [voe, voe, voe] },
  configuration: { personal: [pns, pns, pns], secret: [ok, cns, cij], verifier: [voe, voe, voe] },
};
const sites = Object.keys(expected) as MarkSite[];
const kinds: readonly MarkKind[] = ['personal', 'secret', 'verifier'];
const positions: readonly MarkPosition[] = ['top', 'element', 'nested'];

const leafOf = (kind: MarkKind) =>
  kind === 'personal'
    ? field.string().personal()
    : kind === 'secret'
      ? field.secret()
      : field.verifier();
const placed = (leaf: ReturnType<typeof leafOf>, position: MarkPosition): object =>
  position === 'top'
    ? leaf
    : position === 'element'
      ? field.list(leaf)
      : field.json(shape({ m: leaf }));

/** The problems of this check for a member declared at a site. */
function declared(site: MarkSite, member: object) {
  const members = shape({ member } as never);
  const events = { noted: members };
  const run = (registry: Registry, module: object = moduleOf()) =>
    checkCredentialShapes(appOf(module), registry);
  switch (site) {
    case 'entity':
      return run(registryOf(), moduleOf({ entities: { widget: { fields: { member } } } }));
    case 'domainEvent':
      return run(
        registryOf([], [], { 'probe.thing': { ref: 'probe.thing', module: 'probe', events } }),
      );
    case 'processEvent':
      return run(
        registryOf(
          [],
          [],
          {},
          { reactions: [{ id: 'probe.watch', module: 'probe', eventShapes: events }] },
        ),
      );
    case 'streamRecord':
      return run(
        registryOf(
          [],
          [],
          {},
          { streams: [{ ref: 'probe.log', module: 'probe', record: members }] },
        ),
      );
    case 'commandInput':
      return run(registryOf([commandOf({ input: members })]));
    case 'commandOutput':
      return run(registryOf([commandOf({ output: members })]));
    case 'outcomeInput':
      return run(registryOf([commandOf({ outcomeWith: members })]));
    case 'effectInput':
      return run(registryOf([], [effectOf({ input: members })]));
    case 'effectOutput':
      return run(registryOf([], [effectOf({ output: members })]));
    case 'configuration':
      return run(registryOf(), moduleOf({ base: { config: members } }));
  }
}

describe('the positions of every kind at every site', () => {
  test('the one definition says what the documentation says', () => {
    for (const site of sites) {
      for (const kind of kinds) {
        positions.forEach((position, index) => {
          const cell = cellOf(site, kind, position);
          const want = expected[site][kind][index];
          expect(cell === true, `${site} ${kind} ${position}`).toBe(want === ok);
          expect(typeof cell === 'string', `${site} ${kind} ${position}`).toBe(want === older);
        });
      }
    }
  });

  test('each mark at each position is accepted, left to an older check, or refused with exactly one error of its code', () => {
    for (const site of sites) {
      for (const kind of kinds) {
        positions.forEach((position, index) => {
          const want = expected[site][kind][index];
          const problems = declared(site, placed(leafOf(kind), position));
          const label = `${site} ${kind} ${position}`;
          expect(codes(problems), label).toEqual(want === ok || want === older ? [] : [want]);
        });
      }
    }
  });

  test('a refusal says what the table says at its place: what is not protected here and what is', () => {
    for (const site of sites) {
      for (const kind of kinds) {
        positions.forEach((position, index) => {
          const want = expected[site][kind][index];
          if (want === ok || want === older) return;
          const [problem] = declared(site, placed(leafOf(kind), position));
          const text = problem?.message.split(': ').slice(1).join(': ') ?? '';
          const here = positions
            .filter((other) => expected[site][kind][positions.indexOf(other)] === ok)
            .map(
              (other) =>
                ({
                  top: 'a top-level member',
                  element: 'the element of a list or set',
                  nested: 'a member inside a json member',
                })[other],
            );
          expect(text, `${site} ${kind} ${position}`).toContain(
            `the kernel does not protect a ${kind} mark on `,
          );
          expect(text).toContain(
            here.length === 0
              ? `it protects no ${kind} mark.`
              : `it protects a ${kind} mark only on ${here.join(' or ')}.`,
          );
          expect(text).not.toMatch(
            /clear|erasure|plaintext|unsealed|instead|Declare|Mark the|Keep/,
          );
        });
      }
    }
  });
});

describe('one personal mark per member', () => {
  const mark = (subject: string) => field.string().personal({ subject } as never);
  const wholes: readonly (readonly [string, (inner: object) => object])[] = [
    ['a list of marked elements', (inner) => field.list(inner as never).personal()],
    ['a set of marked elements', (inner) => field.set(inner as never).personal()],
    [
      'a json member holding a marked member',
      (inner) => field.json(shape({ m: inner as never })).personal(),
    ],
  ];

  test.each(wholes)(
    '%s marked personal as a whole is refused where the member or its inner mark could stand, naming the same subject or another',
    (_name, whole) => {
      for (const site of sites) {
        if (expected[site].personal[0] !== ok) continue;
        for (const inner of ['owner', 'other']) {
          const problems = declared(site, whole(mark(inner)));
          expect(codes(problems), `${site} ${inner}`).toEqual(['personalNotSealed']);
          expect(problems[0]?.message).toMatch(
            /marks 'member[^']*' personal: 'member' is marked personal as a whole, which takes no personal mark inside it\. Drop the mark on 'member/,
          );
        }
      }
    },
  );
});
