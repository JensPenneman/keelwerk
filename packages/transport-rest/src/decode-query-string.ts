import type { ErrorIssue, FieldNode } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { parseSort } from './parse-sort.ts';
import type { RestRoute } from './rest-route.ts';

type ParamType = 'string' | 'integer' | 'float' | 'boolean' | 'json' | 'sort' | 'fields';

interface ParamSpec {
  readonly type: ParamType;
  readonly list: boolean;
}

const queryParams: Readonly<Record<string, ParamSpec>> = {
  first: { type: 'integer', list: false },
  after: { type: 'string', list: false },
  last: { type: 'integer', list: false },
  before: { type: 'string', list: false },
  total: { type: 'boolean', list: false },
  archived: { type: 'boolean', list: false },
  filter: { type: 'json', list: false },
  sort: { type: 'sort', list: false },
  fields: { type: 'fields', list: false },
};

const changesParams: Readonly<Record<string, ParamSpec>> = {
  since: { type: 'string', list: false },
  max: { type: 'integer', list: false },
};

/** Parameters every route accepts and the input never sees. */
const ignored: ReadonlySet<string> = new Set(['keelwerk-version']);

function specOf(node: FieldNode): ParamSpec {
  switch (node.kind) {
    case 'integer':
      return { type: node.wide ? 'string' : 'integer', list: false };
    case 'float':
      return { type: 'float', list: false };
    case 'boolean':
      return { type: 'boolean', list: false };
    case 'list':
    case 'set':
      return { type: specOf(node.item).type, list: true };
    default:
      return { type: 'string', list: false };
  }
}

function specsOf(route: RestRoute): Readonly<Record<string, ParamSpec>> {
  switch (route.action.generated) {
    case 'query':
      return queryParams;
    case 'changes':
      return changesParams;
    default: {
      const input = route.action.input;
      const own =
        input.kind === 'shape'
          ? Object.fromEntries(
              Object.entries(input.fields).map(([name, node]) => [name, specOf(node)]),
            )
          : {};
      return {
        ...own,
        ...(own.filter !== undefined && { filter: queryParams.filter }),
        ...(own.sort !== undefined && { sort: queryParams.sort }),
      } as Readonly<Record<string, ParamSpec>>;
    }
  }
}

function convert(
  type: ParamType,
  raw: string,
): { readonly value: unknown } | { readonly problem: string } {
  switch (type) {
    case 'string':
      return { value: raw };
    case 'integer': {
      const value = Number(raw);
      return raw !== '' && Number.isSafeInteger(value)
        ? { value }
        : { problem: 'Expected an integer.' };
    }
    case 'float': {
      const value = Number(raw);
      return raw !== '' && Number.isFinite(value) ? { value } : { problem: 'Expected a number.' };
    }
    case 'boolean':
      return raw === 'true' || raw === 'false'
        ? { value: raw === 'true' }
        : { problem: "Expected 'true' or 'false'." };
    case 'json':
      try {
        return { value: JSON.parse(raw) as unknown };
      } catch {
        return { problem: 'Expected JSON.' };
      }
    case 'sort': {
      const keys = parseSort(raw);
      return keys === undefined
        ? { problem: 'Expected keys like displayName,-createdAt.' }
        : { value: keys };
    }
    case 'fields': {
      const names = raw.split(',').filter((name) => name !== '');
      return names.length > 0
        ? { value: names }
        : { problem: 'Expected field names separated by commas.' };
    }
  }
}

/**
 * The query string of a `GET` as an input (section 16.5.2): scalars become `name=value`, lists
 * repeat the parameter, `filter` is JSON and `sort` uses the compact form. Anything the input does
 * not declare is a `validation` error naming the parameter.
 */
export function decodeQueryString(
  route: RestRoute,
  params: URLSearchParams,
): Record<string, unknown> {
  const specs = specsOf(route);
  const input: Record<string, unknown> = {};
  const issues: ErrorIssue[] = [];
  for (const name of new Set(params.keys())) {
    if (ignored.has(name)) {
      continue;
    }
    const spec = Object.hasOwn(specs, name) ? specs[name] : undefined;
    if (spec === undefined) {
      issues.push({ path: [name], message: 'Unknown parameter.' });
      continue;
    }
    const values = params.getAll(name);
    if (!spec.list && values.length > 1) {
      issues.push({ path: [name], message: 'The parameter must not repeat.' });
      continue;
    }
    const converted: unknown[] = [];
    for (const raw of values) {
      const result = convert(spec.type, raw);
      if ('problem' in result) {
        issues.push({ path: [name], message: result.problem });
      } else {
        converted.push(result.value);
      }
    }
    if (converted.length === values.length) {
      input[name] = spec.list ? converted : converted[0];
    }
  }
  if (issues.length > 0) {
    throw errors.validation('The query string is invalid.', { issues });
  }
  return input;
}
