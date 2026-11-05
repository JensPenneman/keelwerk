/**
 * Whether a schema (or a surface node) is a `fields` shape with no own keys: the input a client
 * leaves out, which the surface emits as `void` and the validate stage reads as `{}`.
 */
export function isEmptyShape(schema: object): boolean {
  const fields: unknown = Reflect.get(schema, 'fields');
  return (
    Reflect.get(schema, 'kind') === 'shape' &&
    typeof fields === 'object' &&
    fields !== null &&
    Object.keys(fields).length === 0
  );
}
