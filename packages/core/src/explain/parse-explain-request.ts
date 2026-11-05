import { errors } from '../errors/errors.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { ExplainAs, ExplainRequest } from './explain-request.ts';

const kinds: readonly PrincipalKind[] = ['anonymous', 'user', 'service', 'operator', 'system'];

function text(body: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw errors.validation(`"${name}" must be a non-empty string.`);
  }
  return value;
}

function asOf(body: Readonly<Record<string, unknown>>): ExplainAs | undefined {
  const given = text(body, 'as');
  if (given === undefined) return undefined;
  const [kind, ...rest] = given.split(':');
  const known = kinds.find((candidate) => candidate === kind);
  if (known === undefined) {
    throw errors.validation(`"as" is <kind>[:<id>] with a kind of ${kinds.join(', ')}.`);
  }
  const id = rest.join(':');
  if (known !== 'anonymous' && known !== 'system' && id === '') {
    throw errors.validation(`"as" needs an id for a ${known} principal: ${known}:<id>.`);
  }
  const roles = body.roles;
  if (roles !== undefined && !(Array.isArray(roles) && roles.every((r) => typeof r === 'string'))) {
    throw errors.validation('"roles" must be a list of strings.');
  }
  return {
    kind: known,
    ...(id === '' ? {} : { id }),
    roles: (roles as string[] | undefined) ?? [],
  };
}

function answersOf(body: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const { answers } = body;
  if (answers === undefined) return undefined;
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    throw errors.validation('"answers" must map an effect reference to its outcome.');
  }
  return answers as Record<string, unknown>;
}

/** Reads the input of `core.explain`; anything else is `validation`. */
export function parseExplainRequest(input: unknown): ExplainRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw errors.validation('The explain request must be an object.');
  }
  const body = input as Readonly<Record<string, unknown>>;
  const backend = text(body, 'backend');
  const tenant = text(body, 'tenant');
  const scope = {
    ...(backend === undefined ? {} : { backend }),
    ...(tenant === undefined ? {} : { tenant }),
  };
  const mode = body.mode;
  if (mode === 'trace') {
    const id = text(body, 'id');
    if (id === undefined)
      throw errors.validation('A trace needs the "id" of a command, event or effect.');
    return { mode, id, ...scope };
  }
  if (mode !== 'decision' && mode !== 'dry-run') {
    throw errors.validation('"mode" is decision, dry-run or trace.');
  }
  const ref = text(body, 'ref');
  if (ref === undefined) throw errors.validation('An action reference ("ref") is required.');
  const as = asOf(body);
  const common = {
    ...scope,
    ref,
    ...(body.input === undefined ? {} : { input: body.input }),
    ...(as === undefined ? {} : { as }),
  };
  if (mode === 'decision') return { mode, ...common };
  const commandId = text(body, 'commandId');
  const answers = answersOf(body);
  return {
    mode,
    ...common,
    ...(commandId === undefined ? {} : { commandId }),
    ...(answers === undefined ? {} : { answers }),
  };
}
