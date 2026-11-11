import {
  type ConstValueNode,
  GraphQLError,
  GraphQLScalarType,
  Kind,
  valueFromASTUntyped,
} from 'graphql';

type Check = (value: unknown) => boolean;

const isString: Check = (value) => typeof value === 'string';
const isSafeInteger: Check = (value) => typeof value === 'number' && Number.isSafeInteger(value);
const isJson: Check = (value) => value !== undefined;

interface ScalarSpec {
  readonly name: string;
  readonly description: string;
  readonly check: Check;
  readonly expected: string;
  readonly specifiedBy?: string;
}

/**
 * A scalar that checks the JSON type of a value and passes it on unchanged in both directions:
 * the core decodes and validates every value (one implementation, section 16.4.2), so the scalar
 * only keeps a value of the wrong JSON type out of the pipeline with a precise message.
 */
function scalarOf(spec: ScalarSpec): GraphQLScalarType {
  const verified = (value: unknown): unknown => {
    if (!spec.check(value)) {
      throw new GraphQLError(`${spec.name} must be ${spec.expected}.`);
    }
    return value;
  };
  return new GraphQLScalarType({
    name: spec.name,
    description: spec.description,
    // biome-ignore lint/style/useNamingConvention: the option name is graphql's
    ...(spec.specifiedBy === undefined ? {} : { specifiedByURL: spec.specifiedBy }),
    coerceInputValue: verified,
    coerceInputLiteral: (node: ConstValueNode) =>
      spec.name === 'JSON' || spec.name === 'RichText'
        ? valueFromASTUntyped(node)
        : verified(literalOf(node)),
    coerceOutputValue: verified,
  });
}

function literalOf(node: ConstValueNode): unknown {
  switch (node.kind) {
    case Kind.STRING:
      return node.value;
    case Kind.INT:
      return Number(node.value);
    default:
      return undefined;
  }
}

const specs: readonly ScalarSpec[] = [
  {
    name: 'Instant',
    description: 'An instant as an RFC 3339 string.',
    check: isString,
    expected: 'a string',
    specifiedBy: 'https://www.rfc-editor.org/rfc/rfc3339',
  },
  {
    name: 'LocalDate',
    description: 'A calendar date as an RFC 3339 full-date string.',
    check: isString,
    expected: 'a string',
  },
  {
    name: 'TimeZone',
    description: 'An IANA time zone name.',
    check: isString,
    expected: 'a string',
  },
  {
    name: 'SafeInt',
    description: 'An integer up to 2^53 - 1 in absolute value.',
    check: isSafeInteger,
    expected: 'a safe integer',
  },
  {
    name: 'BigInt',
    description: 'An integer of any size as a decimal string.',
    check: isString,
    expected: 'a string',
  },
  {
    name: 'Decimal',
    description: 'An exact decimal number as a string.',
    check: isString,
    expected: 'a string',
  },
  {
    name: 'Base64URL',
    description: 'Bytes as an unpadded base64url string.',
    check: isString,
    expected: 'a string',
  },
  {
    name: 'RichText',
    description: 'A rich text value in the wire form of section 14.5.4.',
    check: isJson,
    expected: 'a JSON value',
  },
  {
    name: 'JSON',
    description: 'Any JSON value.',
    check: isJson,
    expected: 'a JSON value',
    specifiedBy: 'https://www.rfc-editor.org/rfc/rfc8259',
  },
];

/** The scalars of section 16.6.1 beside the built-in `ID`: each passes its wire value through. */
export const keelwerkScalars = Object.fromEntries(
  specs.map((spec) => [spec.name, scalarOf(spec)]),
) as Readonly<
  Record<
    | 'Instant'
    | 'LocalDate'
    | 'TimeZone'
    | 'SafeInt'
    | 'BigInt'
    | 'Decimal'
    | 'Base64URL'
    | 'RichText'
    | 'JSON',
    GraphQLScalarType
  >
>;
