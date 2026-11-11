import {
  type GraphQLInputType,
  type GraphQLOutputType,
  getNullableType,
  isEnumType,
  isInputObjectType,
  isListType,
  isObjectType,
  isUnionType,
} from 'graphql';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A wire value beside its schema input type, with every enum position changed to the enum value's
 * GraphQL name (what a client sends: `open` becomes `OPEN`). Walks `NonNull`, lists and input
 * objects; a key the type does not know and everything inside a scalar such as `JSON` stay as they are.
 */
export function enumNamesIn(type: GraphQLInputType, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const inner = getNullableType(type);
  if (isListType(inner)) {
    return Array.isArray(value)
      ? value.map((item) => enumNamesIn(inner.ofType, item))
      : enumNamesIn(inner.ofType, value);
  }
  if (isEnumType(inner)) {
    return inner.getValues().find((candidate) => candidate.value === value)?.name ?? value;
  }
  if (isInputObjectType(inner) && isRecord(value)) {
    const fields = inner.getFields();
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => {
        const field = fields[key];
        return [key, field === undefined ? member : enumNamesIn(field.type, member)];
      }),
    );
  }
  return value;
}

/**
 * An answer value beside its schema output type, with every enum position changed back to the wire
 * value (`OPEN` becomes `open`), so the shared cases keep reading wire values. Walks `NonNull`,
 * lists, objects and unions (the member is named by `__typename`); unknown keys pass through.
 */
export function enumValuesIn(type: GraphQLOutputType, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const inner = getNullableType(type);
  if (isListType(inner)) {
    return Array.isArray(value) ? value.map((item) => enumValuesIn(inner.ofType, item)) : value;
  }
  if (isEnumType(inner)) return inner.getValue(String(value))?.value ?? value;
  if (!isRecord(value)) return value;
  const object = isUnionType(inner)
    ? inner.getTypes().find((member) => member.name === value.__typename)
    : isObjectType(inner)
      ? inner
      : undefined;
  if (object === undefined) return value;
  const fields = object.getFields();
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => {
      const field = fields[key];
      return [key, field === undefined ? member : enumValuesIn(field.type, member)];
    }),
  );
}
