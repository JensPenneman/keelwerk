import type { TransportProblem } from '@keelwerk/core';
import type { GraphQLEnumValueConfigMap, GraphQLNamedType } from 'graphql';
import { graphqlProblem } from '../check/graphql-problem.ts';
import { enumValueName } from './enum-value-name.ts';
import { fixedTypesSubject } from './fixed-types-subject.ts';
import type { GraphqlMember } from './graphql-member.ts';
import type { GraphqlTypeTable } from './graphql-type-table.ts';
import { isGraphqlName } from './is-graphql-name.ts';

const rootTypes: ReadonlySet<string> = new Set(['Query', 'Mutation']);

/** A problem found while building: the subjects that asked for the type it belongs to are added when it is reported. */
interface Issue {
  readonly code: TransportProblem['code'];
  readonly typeName: string;
  readonly subjects: readonly string[];
  readonly message: string;
}

function listOf(parts: readonly string[]): string {
  const sorted = [...new Set(parts)].sort();
  if (sorted.length < 2) return sorted.join('');
  return `${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)}`;
}

function nameProblem(
  name: string,
  what: string,
  subject: string,
  typeName: string,
  rename: string,
): Issue | undefined {
  if (name.startsWith('__')) {
    return {
      code: 'reservedName',
      typeName,
      subjects: [subject],
      message: `${what} is called '${name}' in the type '${typeName}'; GraphQL reserves names that start with two underscores. ${rename}`,
    };
  }
  if (!isGraphqlName(name)) {
    return {
      code: 'unsupportedShape',
      typeName,
      subjects: [subject],
      message: `${what} is called '${name}' in the type '${typeName}', which is no GraphQL name (a letter or underscore, then letters, digits or underscores). ${rename}`,
    };
  }
  return undefined;
}

/**
 * A table that remembers every type it built, in the order it built them (`all`), and every problem
 * the build met (`problems`). It never throws: a name asked for under a second identity gets the
 * first type back and is recorded as a `nameCollision` for every subject involved (nested member
 * and enum names are not known before the build, so the build is where they are found); a member or
 * enum value that clashes or is no GraphQL name is left out and recorded. The build of the second
 * identity still runs and its type is kept in `losers`, so what only that identity would build is
 * found whichever identity the walk meets first. The schema draft resolves the thunks of every
 * built type and every loser, then reads the problems.
 */
export function typeTableOf(): GraphqlTypeTable & {
  all(): readonly GraphQLNamedType[];
  losers(): readonly GraphQLNamedType[];
  problems(): readonly TransportProblem[];
} {
  const built = new Map<string, GraphQLNamedType>();
  const losers: GraphQLNamedType[] = [];
  /** Per type name: each owner that asked for it and the subjects that asked for it as that owner. */
  const claims = new Map<string, Map<string, Set<string>>>();
  const issues: Issue[] = [];

  function viewOf(subject: string): GraphqlTypeTable {
    return {
      subject,
      named<T extends GraphQLNamedType>(name: string, owner: string, build: () => T): T {
        const owners = claims.get(name) ?? new Map<string, Set<string>>();
        claims.set(name, owners);
        const known = owners.has(owner);
        const subjects = owners.get(owner) ?? new Set<string>();
        owners.set(owner, subjects);
        subjects.add(subject);
        const held = built.get(name);
        if (held !== undefined) {
          if (!known) losers.push(build());
          return held as T;
        }
        const type = build();
        built.set(name, type);
        return type;
      },
      of: viewOf,
      members<T>(typeName: string, entries: readonly GraphqlMember<T>[]): Record<string, T> {
        const groups = new Map<string, GraphqlMember<T>[]>();
        for (const entry of entries) {
          const group = groups.get(entry.name);
          if (group === undefined) groups.set(entry.name, [entry]);
          else group.push(entry);
        }
        const out: Record<string, T> = {};
        for (const [name, group] of groups) {
          const first = group[0];
          if (first === undefined) continue;
          if (group.length > 1) {
            const takers = group.map((entry) => `${entry.from} of ${entry.subject}`);
            issues.push({
              code: 'nameCollision',
              typeName,
              subjects: group.map((entry) => entry.subject),
              message: `The name '${name}' in the type '${typeName}' is taken by ${listOf(takers)}. ${
                rootTypes.has(typeName)
                  ? 'Set hints.graphql.field on one of them.'
                  : 'Rename one of the members.'
              }`,
            });
          }
          const refused = nameProblem(
            name,
            `The ${first.from} of ${first.subject}`,
            first.subject,
            typeName,
            'Rename the member.',
          );
          if (refused === undefined) out[name] = first.config;
          else issues.push(refused);
        }
        return out;
      },
      enumValues(typeName: string, values: readonly string[]): GraphQLEnumValueConfigMap {
        const groups = new Map<string, string[]>();
        for (const value of new Set(values)) {
          const name = enumValueName(value);
          const group = groups.get(name);
          if (group === undefined) groups.set(name, [value]);
          else group.push(value);
        }
        const out: GraphQLEnumValueConfigMap = {};
        for (const [name, group] of groups) {
          const first = group[0];
          if (first === undefined) continue;
          if (group.length > 1) {
            issues.push({
              code: 'nameCollision',
              typeName,
              subjects: [subject],
              message: `The values ${listOf(group.map((value) => `'${value}'`))} of the enum '${typeName}' all become the GraphQL name '${name}'. Rename one of the values.`,
            });
          }
          const refused = nameProblem(
            name,
            `The value '${first}'`,
            subject,
            typeName,
            'Rename the value.',
          );
          if (refused === undefined) out[name] = { value: first };
          else issues.push(refused);
        }
        return out;
      },
    };
  }

  function collisions(): Issue[] {
    const found: Issue[] = [];
    for (const [name, owners] of claims) {
      if (owners.size < 2) continue;
      const subjects = [...owners.values()].flatMap((set) => [...set]);
      found.push({
        code: 'nameCollision',
        typeName: name,
        subjects: subjects.filter((subject) => subject !== fixedTypesSubject),
        message: `The type name '${name}' is taken by ${listOf(subjects)}, and they do not describe one type. Set hints.graphql.type (or hints.graphql.field) on one of them.`,
      });
    }
    return found;
  }

  return {
    ...viewOf('schema'),
    all: () => [...built.values()],
    losers: () => [...losers],
    problems: () =>
      [...collisions(), ...issues].flatMap((issue) => {
        const asked = [...(claims.get(issue.typeName)?.values() ?? [])].flatMap((set) => [...set]);
        return [...new Set([...issue.subjects, ...asked])]
          .filter((subject) => subject !== fixedTypesSubject)
          .sort()
          .map((subject) => graphqlProblem(issue.code, subject, issue.message));
      }),
  };
}
