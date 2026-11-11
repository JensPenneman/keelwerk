import {
  type GraphQLSchema,
  isAbstractType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isUnionType,
} from 'graphql';

/**
 * How many items each list of the introspection types can answer at most, by `Type.field`: the
 * number of types and directives of the schema, and the largest number of fields, interfaces,
 * possible types, enum values, input fields, arguments or directive locations of any one type,
 * field or directive. An introspection answer repeats a selection once per item of every list
 * above it, so the measure multiplies the cost of a leaf by these sizes. Computed once at build.
 */
export function introspectionSizesOf(schema: GraphQLSchema): ReadonlyMap<string, number> {
  const types = Object.values(schema.getTypeMap());
  const directives = schema.getDirectives();
  const largest = (counts: Iterable<number>): number => Math.max(1, ...counts);
  const fieldsOf = types.flatMap((type) =>
    isObjectType(type) || isInterfaceType(type) ? Object.values(type.getFields()) : [],
  );
  return new Map([
    ['__Schema.types', Math.max(1, types.length)],
    ['__Schema.directives', Math.max(1, directives.length)],
    [
      '__Type.fields',
      largest(
        types.map((type) =>
          isObjectType(type) || isInterfaceType(type) ? Object.keys(type.getFields()).length : 0,
        ),
      ),
    ],
    [
      '__Type.interfaces',
      largest(
        types.map((type) =>
          isObjectType(type) || isInterfaceType(type) ? type.getInterfaces().length : 0,
        ),
      ),
    ],
    [
      '__Type.possibleTypes',
      largest(
        types.map((type) =>
          isAbstractType(type) && (isUnionType(type) || isInterfaceType(type))
            ? schema.getPossibleTypes(type).length
            : 0,
        ),
      ),
    ],
    [
      '__Type.enumValues',
      largest(types.map((type) => (isEnumType(type) ? type.getValues().length : 0))),
    ],
    [
      '__Type.inputFields',
      largest(
        types.map((type) => (isInputObjectType(type) ? Object.keys(type.getFields()).length : 0)),
      ),
    ],
    ['__Field.args', largest(fieldsOf.map((field) => field.args.length))],
    ['__Directive.args', largest(directives.map((directive) => directive.args.length))],
    ['__Directive.locations', largest(directives.map((directive) => directive.locations.length))],
  ]);
}
