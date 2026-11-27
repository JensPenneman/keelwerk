import type { MarkCell, MarkKind, MarkPosition, MarkSite } from './mark-types.ts';

const yes = true;
const no = false;
type MarkCells = readonly [top: MarkCell, element: MarkCell, nested: MarkCell];

/**
 * The one definition of the positions (14.7.4). The composition check refuses every mark at a cell
 * that is `false`; the sealing code and every redaction ask the same table, so none can drift from
 * it. A personal member is sealed whole under its subject, so a list or set holding a personal
 * element is one member sealed whole where `element` is `yes`. A credential is sealed per value at
 * a command or effect (each element of a list of secrets), a row of an entity (top only) and a
 * module configuration (a top-level secret). Nothing inside a `json` member is looked into. A list
 * of verifiers is refused already by the surface (it has no field to show one), an older error.
 */
const cells: Readonly<Record<MarkSite, Readonly<Record<MarkKind, MarkCells>>>> = {
  entity: {
    personal: [yes, no, no],
    secret: [yes, no, no],
    verifier: [yes, 'unsurfacedFields', no],
  },
  domainEvent: {
    personal: [yes, yes, no],
    secret: [no, no, no],
    verifier: [no, 'unsurfacedSchemas', no],
  },
  processEvent: {
    personal: [yes, yes, no],
    secret: ['processEventCredential', 'processEventCredential', no],
    verifier: ['processEventCredential', 'processEventCredential', no],
  },
  streamRecord: {
    personal: [yes, yes, no],
    secret: ['streamRecordCredential', 'streamRecordCredential', no],
    verifier: ['streamRecordCredential', 'streamRecordCredential', no],
  },
  commandInput: { personal: [yes, yes, no], secret: [yes, yes, no], verifier: [no, no, no] },
  commandOutput: {
    personal: ['personalCommandOutput', 'personalCommandOutput', no],
    secret: [yes, yes, no],
    verifier: [no, no, no],
  },
  // The `with` of a continuation is kept in plaintext: nothing marked can be passed in it.
  outcomeInput: { personal: [no, no, no], secret: [no, no, no], verifier: [no, no, no] },
  effectInput: { personal: [yes, yes, no], secret: [yes, yes, no], verifier: [no, no, no] },
  effectOutput: {
    personal: ['personalEffectOutput', 'personalEffectOutput', no],
    secret: [yes, yes, no],
    verifier: [no, no, no],
  },
  configuration: { personal: [no, no, no], secret: [yes, no, no], verifier: [no, no, no] },
};

const positions = ['top', 'element', 'nested'] as const;

/** What the table says about a `kind` mark at `position` of `site`. */
export function cellOf(site: MarkSite, kind: MarkKind, position: MarkPosition): MarkCell {
  return cells[site][kind][positions.indexOf(position)] ?? no;
}
