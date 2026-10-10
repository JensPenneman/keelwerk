# 2. An own field model, with Standard Schema as the only external schema interface

Date: 2026-10-08

## Status

Accepted

## Context

Entities and action payloads need, from one declaration: a TypeScript type, a runtime validator,
a JSON Schema (OpenAPI), a GraphQL type, a database column and, later, a protobuf field and a CLI
flag. The brief requires that GraphQL, REST and tRPC derive from the same definitions and that
types are live and exact.

Candidates examined (research: interfaces-and-devx.md section 2, data-layer.md section 2):

- Adopt one validation library (Zod 4.6.5, Valibot 1.5.0, ArkType 2.2.8) as the schema language.
  Each has its own introspection API, so every projection would be written against one vendor,
  and every module author would be bound to it.
- Depend only on Standard Schema (`@standard-schema/spec` 1.1.0, with Standard JSON Schema).
  Every major library implements it and tRPC, oRPC, Pothos and Hono consume it. It gives
  `validate` and a JSON Schema export, but it cannot be walked: GraphQL object and input types,
  columns, protobuf fields and CLI flags cannot be derived from a validate function, and JSON
  Schema to GraphQL is lossy (unions, nullability, identifiers).
- Use a database-first schema (Drizzle table objects, Prisma's contract). Drizzle schemas are per
  dialect; Prisma's is a generated client. Neither covers action payloads.

## Decision

pennestack defines its own small field model (`field.*` builders and `shape()`), owned by
`@pennestack/core`. A field carries, at the value level, its kind, modifiers and constraints and,
at the type level, its TypeScript type and optionality. The field model implements Standard
Schema 1.1 (validation and JSON Schema), so a `shape()` is accepted wherever a Standard Schema is,
and it is walkable, so every projection (types, validators, JSON Schema, GraphQL, columns,
protobuf, CLI) is derived exactly.

Standard Schema is the only schema interface a framework package depends on. Action inputs and
outputs may be free-form Standard Schemas from any library; they are projected through Standard
JSON Schema and a JSON Schema to GraphQL converter with a `JSON` scalar fallback. Zod 4.6.5 is the
default in examples and tests and a dependency of no framework package.

Entities must use the field model (a free-form schema cannot define columns or merge types).

## Consequences

- One declaration yields every projection, and the type system sees the same shape as the
  runtime. Transports and adapters depend on a model the project controls, not on a vendor's
  introspection API.
- The field model is a DSL the project must own and maintain, and its projections must stay
  consistent; this is substantial work before the first transport exists. The research notes
  estimate the runtime at a few hundred lines per projection; the type-level part is the cost.
- Module authors learn one small builder set instead of a validation library, and may still use
  their preferred library for action payloads.
- A later schema library needs no framework change as long as it implements Standard Schema.
- Free-form inputs lose precision in GraphQL (the `JSON` scalar fallback); authors who need exact
  GraphQL types use `shape()`.
