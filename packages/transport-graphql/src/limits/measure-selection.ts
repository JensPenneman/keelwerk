import type { SelectionLimits, SelectionPath } from '@keelwerk/core';
import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLNamedType,
  type GraphQLType,
  getNamedType,
  getNullableType,
  isCompositeType,
  isInterfaceType,
  isListType,
  isObjectType,
  Kind,
  type OperationDefinitionNode,
  type SelectionNode,
  type ValueNode,
  valueFromASTUntyped,
  visit,
} from 'graphql';
import type { GraphqlProjection } from '../schema/graphql-projection.ts';
import type { GraphqlIdList } from './graphql-id-list.ts';
import type { GraphqlSelectionMeasure } from './graphql-selection-measure.ts';

type Variables = Readonly<Record<string, unknown>>;

interface Item {
  readonly selection: SelectionNode;
  /** The type the selection is on; `undefined` for a field the schema does not know (a placeholder with no entity). */
  readonly parent: GraphQLNamedType | undefined;
  readonly entities: readonly string[];
  /** The fragments being expanded on the way here: a spread of one of them is a cycle. */
  readonly spreads: ReadonlySet<string>;
  readonly fragments: ReadonlyMap<string, FragmentDefinitionNode>;
  /** The page sizes of the page fields above, multiplied: what one more page below costs, in pages. */
  readonly multiplier: number;
  /** The sizes of the introspection lists above, multiplied: how many times one leaf here is answered. */
  readonly weight: number;
}

/** Large enough to be over any limit, small enough never to overflow. */
const largestMultiplier = 1e9;

function argumentOf(field: FieldNode, name: string): ValueNode | undefined {
  return field.arguments?.find((argument) => argument.name.value === name)?.value;
}

/** What a field is in the schema, or `undefined` for `__typename` and a name the type lacks. `__schema` and `__type` answer the introspection types, so their selections cost like any other. */
function fieldTypeOf(
  projection: GraphqlProjection,
  parent: GraphQLNamedType | undefined,
  name: string,
): { readonly type: GraphQLType } | undefined {
  if (parent === undefined || name === '__typename') return undefined;
  const { schema } = projection;
  if (parent === schema.getQueryType() && (name === '__schema' || name === '__type')) {
    const type = schema.getType(name === '__schema' ? '__Schema' : '__Type');
    return type === undefined || type === null ? undefined : { type };
  }
  return isObjectType(parent) || isInterfaceType(parent) ? parent.getFields()[name] : undefined;
}

/**
 * Counts what the limits of section 16.4.12 look at, over every operation of every document of the
 * request (one request, even for a batch). `variables` holds the variables of each document, in
 * order. Every field with a selection set is walked, whether the schema knows it or not: an unknown
 * field, a scalar given a selection and a field picked directly on a union walk their children as
 * leaves of no entity, so no selection escapes the cost. A connection, a `...Get` field and `nodes`
 * cost one page each (ten); a page selected below pages costs its own cost multiplied by the page
 * size of every page above it, `first` or `last` read from the literal or the variables (the
 * type's largest page when absent, the number of ids for `nodes` and `...Get`). A list of the
 * introspection types answers once for every item of the schema (`introspectionSizes`), so a leaf
 * below one is charged the sizes of the lists above it, not 1. The id lists those fields carry are
 * returned for the gate to bound.
 */
export function measureSelection(
  documents: readonly DocumentNode[],
  projection: GraphqlProjection,
  limits: SelectionLimits,
  variables: readonly (Variables | undefined)[] = [],
): GraphqlSelectionMeasure {
  const {
    schema,
    entityTypes,
    connectionTypes,
    getResultTypes,
    pageSizes,
    nodesBound,
    introspectionSizes,
  } = projection;
  const paths: SelectionPath[] = [];
  const idLists: GraphqlIdList[] = [];
  let operations = 0;
  let aliases = 0;
  let tokens = 0;
  let connectionPages = 0;
  const maxSteps = 50 * (limits.cost + 1);
  let steps = 0;
  const over = (): boolean => paths.length + 10 * connectionPages > limits.cost;

  for (const [index, document] of documents.entries()) {
    tokens += document.tokenCount ?? 0;
    visit(document, {
      [Kind.FIELD]: (node) => {
        if (node.alias !== undefined) aliases += 1;
      },
    });
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of document.definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(definition.name.value, definition);
      }
    }
    for (const definition of document.definitions) {
      if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
      operations += 1;
      if (over() || steps > maxSteps) continue;
      const root =
        definition.operation === 'query'
          ? schema.getQueryType()
          : definition.operation === 'mutation'
            ? schema.getMutationType()
            : schema.getSubscriptionType();
      if (root === undefined || root === null) continue;
      const given = variables[index];
      const variableOf = (name: string, operation: OperationDefinitionNode): unknown => {
        if (given !== undefined && Object.hasOwn(given, name)) return given[name];
        const fallback = operation.variableDefinitions?.find(
          (candidate) => candidate.variable.name.value === name,
        )?.defaultValue;
        return fallback === undefined ? undefined : valueFromASTUntyped(fallback);
      };
      /** The integer an argument carries, from the literal or the variable; `undefined` when it has none. */
      const integerOf = (value: ValueNode | undefined): number | undefined => {
        if (value === undefined) return undefined;
        const held =
          value.kind === Kind.INT
            ? Number(value.value)
            : value.kind === Kind.VARIABLE
              ? variableOf(value.name.value, definition)
              : undefined;
        return typeof held === 'number' && Number.isFinite(held) ? Math.max(0, held) : undefined;
      };
      /** How many ids a list argument carries, from the literal or the variable. */
      const countOf = (value: ValueNode | undefined): number => {
        if (value === undefined || value.kind === Kind.NULL) return 0;
        if (value.kind === Kind.LIST) return value.values.length;
        if (value.kind === Kind.VARIABLE) {
          const held = variableOf(value.name.value, definition);
          if (Array.isArray(held)) return held.length;
          return held === undefined || held === null ? 0 : 1;
        }
        return 1;
      };
      const stack: Item[] = [];
      const push = (
        selections: readonly SelectionNode[],
        parent: GraphQLNamedType | undefined,
        entities: readonly string[],
        spreads: ReadonlySet<string>,
        multiplier: number,
        weight: number,
      ): void => {
        for (let at = selections.length - 1; at >= 0; at -= 1) {
          const selection = selections[at];
          if (selection !== undefined) {
            stack.push({ selection, parent, entities, spreads, fragments, multiplier, weight });
          }
        }
      };
      const enter = (
        condition: string | undefined,
        parent: GraphQLNamedType | undefined,
        entities: readonly string[],
      ): {
        readonly type: GraphQLNamedType | undefined;
        readonly entities: readonly string[];
      } => {
        const named = condition === undefined ? parent : schema.getType(condition);
        if (named === undefined || named === null || !isCompositeType(named)) {
          return { type: parent, entities };
        }
        const ref = entityTypes.get(named.name);
        return {
          type: named,
          entities:
            ref !== undefined && named.name !== parent?.name ? [...entities, ref] : entities,
        };
      };
      /** A page field: its cost is `multiplier` pages; what is below it is multiplied by its size. */
      const page = (multiplier: number, size: number): number => {
        connectionPages += multiplier;
        return Math.min(multiplier * Math.max(1, size), largestMultiplier);
      };
      push(definition.selectionSet.selections, root, [], new Set(), 1, 1);
      while (stack.length > 0 && !over()) {
        steps += 1;
        if (steps > maxSteps) break;
        const item = stack.pop();
        if (item === undefined) break;
        const { selection, parent, entities, spreads, multiplier } = item;
        if (selection.kind === Kind.FIELD) {
          const name = selection.name.value;
          const def = fieldTypeOf(projection, parent, name);
          const named = def === undefined ? undefined : getNamedType(def.type);
          const children = selection.selectionSet;
          const weight = Math.min(
            item.weight *
              (def !== undefined && isListType(getNullableType(def.type))
                ? (introspectionSizes.get(`${parent?.name}.${name}`) ?? 1)
                : 1),
            largestMultiplier,
          );
          if (name === '__typename' || children === undefined) {
            const path = {
              entities: def === undefined && name !== '__typename' ? [] : entities,
              field: name,
            };
            const copies = Math.min(weight, Math.max(1, limits.cost + 1 - paths.length));
            for (let copy = 0; copy < copies; copy += 1) paths.push(path);
            continue;
          }
          if (named === undefined || !isCompositeType(named)) {
            push(children.selections, undefined, [], spreads, multiplier, weight);
            continue;
          }
          let below = multiplier;
          if (parent === schema.getQueryType() && name === 'nodes') {
            const count = countOf(argumentOf(selection, 'ids'));
            idLists.push({ field: name, count, max: nodesBound });
            below = page(multiplier, count);
          } else if (getResultTypes.has(named.name)) {
            const count = countOf(argumentOf(selection, 'ids'));
            idLists.push({ field: name, count, max: pageSizes.get(named.name) ?? count });
            below = page(multiplier, count);
          } else if (connectionTypes.has(named.name)) {
            const largest = pageSizes.get(named.name) ?? 1;
            const size =
              integerOf(argumentOf(selection, 'first')) ??
              integerOf(argumentOf(selection, 'last')) ??
              largest;
            below = page(multiplier, size);
          }
          const ref = entityTypes.get(named.name);
          push(
            children.selections,
            named,
            ref === undefined ? entities : [...entities, ref],
            spreads,
            below,
            weight,
          );
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          const next = enter(selection.typeCondition?.name.value, parent, entities);
          push(
            selection.selectionSet.selections,
            next.type,
            next.entities,
            spreads,
            multiplier,
            item.weight,
          );
        } else {
          const name = selection.name.value;
          const fragment = item.fragments.get(name);
          if (fragment === undefined || spreads.has(name)) continue;
          const next = enter(fragment.typeCondition.name.value, parent, entities);
          push(
            fragment.selectionSet.selections,
            next.type,
            next.entities,
            new Set([...spreads, name]),
            multiplier,
            item.weight,
          );
        }
      }
      if (steps > maxSteps) {
        while (paths.length <= limits.cost) paths.push({ entities: [], field: '__exhausted' });
      }
    }
  }
  return { paths, aliases, operations, tokens, connectionPages, idLists };
}
