import { cellOf } from '../fields/mark-cells.ts';
import type { Mark, MarkSite } from '../fields/mark-types.ts';
import { marksOfShape } from '../fields/marks-of-shape.ts';
import { refusalText } from '../fields/refusal-text.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';
import { runtimeModule } from './runtime-module.ts';

interface Site {
  readonly site: MarkSite;
  readonly module: string;
  readonly ref: string;
  /** The place, as the message names it: 'The input of the command'. */
  readonly what: string;
}

/** The sites where a verifier is only ever a top-level field of an entity. */
const verifierSites: ReadonlySet<MarkSite> = new Set([
  'commandInput',
  'commandOutput',
  'outcomeInput',
  'effectInput',
  'effectOutput',
  'configuration',
]);

/** The member a path starts with: `rows[].token` is `rows`. */
const memberOf = (path: string): string => path.split(/[.[]/)[0] ?? path;

function codeOf(site: MarkSite, mark: Mark): string {
  if (mark.kind === 'personal') return 'personalNotSealed';
  if (mark.kind === 'verifier' && verifierSites.has(site)) return 'verifierOutsideEntity';
  return mark.position === 'nested' ? 'credentialInJson' : 'credentialNotSealed';
}

/** The problems of the marks found in one declared shape: one for each mark at a position the site refuses. */
function problemsOf(schema: object, site: Site): readonly CompositionProblem[] {
  const { module, ref } = site;
  const marks = marksOfShape(schema);
  // One mark per member: a member marked personal as a whole takes no personal mark inside it.
  const whole = new Set(
    marks
      .filter((mark) => mark.kind === 'personal' && mark.position === 'top')
      .map((mark) => mark.path),
  );
  const problems: CompositionProblem[] = [];
  for (const mark of marks) {
    const cell = cellOf(site.site, mark.kind, mark.position);
    const inside =
      mark.kind === 'personal' && mark.position !== 'top' && whole.has(memberOf(mark.path));
    if (typeof cell === 'string' || (cell === true && !inside)) continue;
    const text = inside
      ? `'${memberOf(mark.path)}' is marked personal as a whole, which takes no personal mark inside it. Drop the mark on '${mark.path}'.`
      : refusalText(site.site, mark);
    const subject =
      mark.kind === 'personal'
        ? `marks '${mark.path}' personal`
        : `declares the ${mark.kind} '${mark.path}'`;
    problems.push(
      compositionError(
        codeOf(site.site, mark),
        `${site.what} '${ref}' of module '${module}' ${subject}: ${text}`,
        { module, ref },
      ),
    );
  }
  return problems;
}

/**
 * The one rule over every shape a module declares (14.7.4): a personal mark, a secret and a verifier
 * stand exactly where the kernel protects them at that site (`fields/mark-cells.ts`, the table the
 * sealing code and every redaction read too) and are refused at every other position, with one
 * error for each mark: `personalNotSealed`, `credentialInJson` (inside a json member),
 * `credentialNotSealed` and `verifierOutsideEntity`. A member marked personal as a whole takes no
 * personal mark inside it, wherever that inner mark would stand. A position another check refuses
 * already (a credential at a process event or a stream record, a personal member at a command or
 * effect output) is left to that check. The sites are an entity, a command's input, output and
 * continuation input, an effect's input and output, a module configuration, the payload of a
 * domain event, an event of a process and a stream record. The shapes the kernel builds are not a
 * module's declaration and are not checked: a generated action, and a row or page output
 * (`entityOutput`, which includes the default output of an entity command).
 */
export function checkCredentialShapes(
  app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  /** The one walk: every declared shape goes through it. */
  const refuse = (schema: object, site: Site): void => {
    problems.push(...problemsOf(schema, site));
  };
  for (const module of app.modules) {
    const runtime = runtimeModule(module);
    const entities = [
      ...Object.entries(runtime.entities).map(
        ([name, entity]) => [`${module.id}.${name}`, entity] as const,
      ),
      ...runtime.contributes.flatMap((contribution) =>
        Object.entries(contribution.entities).map(
          ([name, patch]) => [`${contribution.to.id}.${name}`, patch] as const,
        ),
      ),
      ...runtime.conditional.flatMap((conditional) =>
        Object.entries(conditional.entities).map(
          ([name, patch]) => [`${module.id}.${name}`, patch] as const,
        ),
      ),
    ];
    for (const [ref, entity] of entities) {
      refuse(entity, { site: 'entity', module: module.id, ref, what: 'The entity' });
    }
    const { config } = runtime.base;
    if (config !== undefined) {
      const ref = `${module.id}.config`;
      refuse(config, { site: 'configuration', module: module.id, ref, what: 'The configuration' });
    }
  }
  for (const action of registry.actions.values()) {
    if (action.kind !== 'command' || action.generated !== undefined) continue;
    const { module, ref } = action;
    refuse(action.input, { site: 'commandInput', module, ref, what: 'The input of the command' });
    // The default row output of an entity command is kernel-built (`entityOutput`); an output the
    // module declared is checked in full, whatever its members are called.
    if (action.entityOutput === undefined) {
      refuse(action.output, {
        site: 'commandOutput',
        module,
        ref,
        what: 'The output of the command',
      });
    }
    if (action.outcomeWith !== undefined) {
      const what = 'The continuation input of the command';
      refuse(action.outcomeWith, { site: 'outcomeInput', module, ref, what });
    }
  }
  for (const { module, ref, input, output } of registry.effects.values()) {
    refuse(input, { site: 'effectInput', module, ref, what: 'The input of the effect' });
    refuse(output, { site: 'effectOutput', module, ref, what: 'The output of the effect' });
  }
  // The payloads the kernel stores as declared: a domain event, an event of a process, a stream record.
  for (const { module, ref, events } of registry.entities.values()) {
    for (const [name, schema] of Object.entries(events)) {
      if (schema === null) continue;
      const what = `The '${name}' event of the entity`;
      refuse(schema, { site: 'domainEvent', module, ref, what });
    }
  }
  for (const { module, id: ref, eventShapes } of registry.reactions.values()) {
    for (const [name, schema] of Object.entries(eventShapes ?? {})) {
      const what = `The '${name}' event of the process`;
      refuse(schema, { site: 'processEvent', module, ref, what });
    }
  }
  for (const { module, ref, record } of registry.streams.values()) {
    refuse(record, { site: 'streamRecord', module, ref, what: 'The record of the stream' });
  }
  return problems;
}
