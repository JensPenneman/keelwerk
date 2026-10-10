# Module systems in TypeScript backend frameworks

Date: 2026-10-08. Status: research note, input for `architecture.md` and the ADRs.

Scope: how TypeScript backend frameworks declare modules or plugins, how one module extends
another, whether the types follow a module being switched on or off, and which type-level
techniques make typed composition possible. It ends with a recommended approach for pennestack.
Package versions were checked with `npm view` on 2026-10-08; documentation and source were
read the same day.

## 1. The question pennestack has to answer

The brief requires an application defined as a set of modules that are individually toggleable,
where modules influence each other (accounts and authentication being the canonical pair) and
that influence is explicit and typed. Every framework surveyed answers two questions, and the
answers decide the design:

1. Where is a cross-module contribution declared: in the contributing module, in the receiving
   module, or in a central configuration object?
2. Does the type system see the contribution only when the contributing module is actually in
   the application, or whenever its code is in the compilation?

Only the frameworks that answer "in the contributing module" and "only when present" give what the
brief asks for. Those are the builder-chain and tuple-inference systems (Better Auth, Elysia,
Hono, Effect). The others either resolve at runtime (NestJS, Medusa, Strapi, Fastify) or run a
generator after the fact (Payload, Keystone, RedwoodJS, Wasp).

## 2. Survey

### 2.1 Comparison

| Framework (version checked) | Unit of composition | Contributing to another module's entities | Types follow toggling? | Configuration | Lifecycle and ordering |
|---|---|---|---|---|---|
| NestJS 12.1.2 | `@Module({ providers, controllers, imports, exports })` class; `DynamicModule` from `register()`, `forRoot()`, `forFeature()` | Not modelled; modules only share providers through dependency injection | No: injection by string or symbol token, the constructor parameter type is an assertion; graph resolved at bootstrap | Options object bound as a provider (`ConfigurableModuleBuilder`, `registerAsync` with `useFactory`/`inject`) | `onModuleInit`, `onApplicationBootstrap`, `onModuleDestroy`, `beforeApplicationShutdown`, `onApplicationShutdown`; init ordered by distance from the root module, shutdown reversed |
| Better Auth 1.7.7 | Plugin object `satisfies BetterAuthPlugin` in `plugins: [...]` (`id`, `schema`, `endpoints`, `hooks`, `middlewares`, `onRequest`, `onResponse`, `rateLimit`, `init`, `$Infer`) | `schema.user.fields` and `schema.session.fields` add columns to core tables; new tables; `hooks.before`/`after` with a `matcher` | Yes: `InferPluginTypes` and `InferDBFieldsFromPlugins` walk the `plugins` tuple; the client mirrors it with `$InferServerPlugin` | Plugin factory `(options) => plugin` | `init(ctx)` may patch context and options at creation; hooks run in plugin order; endpoint paths must be unique |
| Fastify 5.12.5, fastify-plugin 6.0.0 | Plugin function `(fastify, opts)`; `register()` opens an encapsulation scope (a DAG); `fp()` breaks it | `decorate`, `decorateRequest`, `decorateReply` | No: `declare module 'fastify'` augmentation is "not scope-aware"; `getDecorator<T>()` is the untyped alternative | `opts` typed per plugin (`FastifyPluginAsync<Options>`); options may be a function of the parent instance | avvio runs plugins in registration order; `after`/`ready`/`listen`; `fp` metadata `name`, `dependencies`, `decorators` checked against the graph; type providers re-applied per scope |
| Hono 4.13.13 | `new Hono<Env, Schema, BasePath>()`, chained `.get()`/`.post()`, `app.route(path, sub)` | Middleware sets `Variables` through `Env`; no entity model | Yes for routes: `route()` returns `Hono<E, MergeSchemaPath<SubSchema, MergePath<BasePath, SubPath>> \| S, ...>`, but only through an unbroken chain | Plain TypeScript; `createMiddleware<Env>()` | Middleware order is registration order; no module lifecycle |
| Elysia 1.4.30 | `new Elysia({ name, seed })` instance; `.use(plugin)` | `.decorate`, `.state`, `.derive`, `.resolve`, `.model`, `.macro`; hooks are `local` (default), `scoped` or `global`, lifted with `.as()` | Yes: seven `const in out` type parameters; `use()` intersects the plugin's singleton, definitions, metadata and routes into the caller | Config plugin is a function returning an instance | Hooks apply only to routes registered after them; `name` deduplicates; lazy plugins register after startup |
| Effect 4.0.2 | Services `Context.Service<Self, Shape>()("key")`; `Layer<ROut, E, RIn>` | None at data level; a layer requires other services, tracked in `RIn` | Yes: requirements accumulate as a union in `R`, `Layer.provide` discharges them, an unmet requirement is a compile error | Config is itself a service provided by a layer | Memoized by reference, since v4 also across `Effect.provide` calls; `Layer.fresh` opts out; scoped finalizers |
| Encore.ts 1.58.6 | Directory with `encore.service.ts` exporting `new Service(name, { middlewares })`; `api({...}, handler)` | None; cross-service calls through the generated `~encore/clients` | Not type-level: a static parser builds the model; names must be string literals at module scope and endpoints exported | Infrastructure declarations (`SQLDatabase`, topics, secrets) are the configuration | Middleware order is array order; model rebuilt on every build |
| Keystone 8.1.0 | `config({ lists: { Post: list({ fields, access, hooks, ui, db, graphql }) } })` | None across lists except relationships; one config object | Partly: generated `Lists`, `TypeInfo`, `Context` in `generated/keystone/types`, used as `satisfies Lists` | One object; `db.provider` is `postgresql`, `mysql` or `sqlite` through Prisma | Field hooks (parallel) then list hooks: `resolveInput`, `validate`, `beforeOperation`, `afterOperation`; access: operation, filter, item, then field |
| Payload 3.90.2 | `buildConfig({ collections, globals, plugins, db })`; plugin `(options) => (config) => config` | Plugin maps over `config.collections` and appends fields and hooks; spreads `hooks`, wraps `onInit` | Partly: `payload generate:types` writes a file that augments `GeneratedTypes`; without it helpers fall back to loose types | Plugin options closure; `db: postgresAdapter(...)`, `mongooseAdapter(...)`, `sqliteAdapter(...)` | Config validated, plugins in array order, defaults, sanitize, init; collection hooks from `beforeOperation` to `afterError` |
| Medusa 2.21.2 | `Module(name, { service, loaders })`, `MedusaService({ Post })`; `medusa-config.ts` `modules: [{ resolve, options }]` | Forbidden directly ("a module is unaware of any resources other than its own"); `defineLink()` creates a link table or a read-only link; workflows span modules | No at the boundary: `container.resolve(BLOG_MODULE)` is typed by annotation; `.medusa/types/*.d.ts` generated on build (v2.12.4+) for Query and the container, not to be imported | `options` read by loaders (`LoaderOptions<Options>`) | Loaders run in registration order before the service is instantiated, also during migrations; a throw stops the module |
| Vendure 3.7.4 | `@VendurePlugin({ imports, providers, entities, configuration, shopApiExtensions, adminApiExtensions, dashboard, compatibility })`, a NestJS module | `configuration: config => { config.customFields.Product.push({...}); return config }` | No: custom fields typed by `declare module` on `CustomProductFields`; import order matters; the docs cite TypeScript issue 46617 for multiple plugins augmenting one interface | Static `init(options)` convention; `compatibility` semver checked at bootstrap | NestJS hooks run in server and worker; `configuration` functions run before bootstrap in `plugins` order |
| Strapi 5.57.0 | Package with `server/src/index.ts` exporting `register`, `bootstrap`, `destroy`, `config`, `contentTypes`, `routes`, `controllers`, `services`, `policies`, `middlewares` | `src/extensions/<plugin>/content-types/<ct>/schema.json` overrides, or `strapi.contentType('plugin::x.y').attributes = {...}` in `register()` | No: content types are JSON; `strapi ts:generate-types` writes `types/generated/*.d.ts` with `declare module '@strapi/types'`, loose fallback when excluded | `config/plugins.ts` `{ enabled, resolve, config }` | `register()` before database and routes, `bootstrap()` after, `destroy()` on shutdown; load order: plugin content types, extension `schema.json`, `strapi-server`, app `register()` |
| RedwoodJS (Redwood GraphQL) 8.9.0 | SDL files and service modules globbed and merged by `makeMergedSchema`; `@requireAuth` or `@skipAuth` mandatory on every operation | None; a service is a resolver, relation resolvers by convention | Generated: `yarn rw g types` produces `QueryResolvers`, `MutationResolvers` through graphql-codegen and Prisma types | `redwood.toml`, `api/src/lib/auth.ts` | No plugin lifecycle; directive check at build time |
| Wasp 0.25 (`@wasp.sh/spec` 0.25.0) | `main.wasp.ts` exporting `app({ name, auth, spec: [route(), page(), query(fn, { entities }), job()] })` with `import ... with { type: "ref" }` | None; Prisma models are the entities, operations declare `entities: ["Task"]` | Generated: `wasp install` writes the spec package and `wasp/server/operations` types (`GetTasks<Input, Output>` types `context.entities`) | The spec object; `auth.methods` toggles providers | Compiler-driven; no runtime module lifecycle |

### 2.2 Dependency-injection modules: NestJS and Vendure

NestJS modules are classes with metadata. Encapsulation is strict: a module can inject only its own
providers and the `exports` of the modules it `imports`; `@Global()` lifts that. Dynamic modules
return the same metadata plus a `module` property, and `ConfigurableModuleBuilder` generates
`register()`/`registerAsync()` with an options token. The lifecycle is the clearest of all surveyed
frameworks: five hooks, initialized module by module from the leaves of the import graph to the
root and shut down in reverse. What NestJS does not give is typed composition: tokens are strings or
symbols, `@Inject(TOKEN) private readonly options: Options` is a promise the developer makes, and
a missing provider is discovered at bootstrap, not at compile time.

Vendure is a NestJS module with extras. Its `configuration` function mutates `VendureConfig` before
bootstrap, and that is how a plugin adds custom fields to a built-in entity, the direct analogue of
"authentication adds fields to accounts". The types for those fields come from `declare module`
augmentation of `CustomProductFields`. The docs document the price: import order matters, and a
TypeScript issue (46617) bites when several plugins augment the same interface. Removing the
plugin from `plugins` leaves the augmentation in place, so the type keeps claiming a field that no
longer exists.

### 2.3 Configuration objects with code generation: Payload, Keystone, Strapi

Payload's plugin is a function from config to config. It adds collections by spreading arrays,
contributes fields and hooks by mapping over `config.collections`, and chains `onInit`. Plugins run
in array order, after validation and before sanitization. Types come from `payload generate:types`,
which writes `declare module 'payload' { export interface GeneratedTypes extends Config {} }`; the
source checks `keyof GeneratedTypes extends never` and falls back to loose index-signature types
when the file is absent. Keystone keeps everything in one `config()` object with `list()` per
entity, has a precise hook order (field hooks in parallel, then list hooks, in the stages
`resolveInput`, `validate`, `beforeOperation`, `afterOperation`) and a four-layer access model
(operation, filter, item, field). Its generated `Lists` type is consumed with `satisfies Lists`. Strapi's content
types are JSON schemas; a plugin's content type is extended by an override file in
`src/extensions/` or by mutating `strapi.contentType(...)` in `register()`, and the docs warn that
"any plugin update could break this plugin's extensions".

The shared property: configuration is data, extension is mutation of that data, and a generator
informs the type system afterwards. This is the closest existing match to the brief's "live
generated database types", but the generator is a second compiler that must run, and a
contribution is invisible to the types until it has.

### 2.4 Builder chains with inference: Hono, Elysia, Better Auth, Fastify

Hono accumulates a route schema in its `S` type parameter; `route()` re-keys a sub-application's
schema under the mount path and unions it with the parent's. The runtime returns `this`; the
accumulation is type-only, which is why the docs insist on chaining and warn that a standalone
controller typed `(c: Context)` loses path parameters. For large applications the docs prescribe
compiling the client type once, splitting clients per sub-application, project references and
identical Hono versions on both sides, because a mismatch produces "Type instantiation is
excessively deep". Context variables are typed through the `Env` generic; the docs describe the
alternative, augmenting `ContextVariableMap`, as unsafe because the type then applies where the
middleware never ran.

Elysia goes furthest. Its class has seven type parameters, all `const in out`, and `use()`
intersects the plugin's decorators, store, derived values, models and routes into the caller.
Scope is both runtime and type-level: lifting a `response` schema to `scoped` changes the parent's
types. Plugins with a `name` are deduplicated, and the best-practice page says "1 Elysia instance =
1 controller" for the same reason Hono does.

Better Auth is the closest match to pennestack's requirement, because its plugins contribute
schema to another module's tables. `InferPluginTypes` walks the `plugins` tuple
(`readonly [unknown, ...unknown[]]`) and falls back to `UnionToIntersection` for plain arrays;
`InferDBFieldsFromPlugins<"user", Plugins>` recurses with `[infer P, ...infer Rest]` and asks
whether `P extends { schema: { user: { fields: infer Fields } } }`. The client declares
`$InferServerPlugin: {} as ReturnType<typeof myPlugin>`, a type-only mirror. The docs also offer a
`BetterAuthPluginRegistry` augmentation and state that it "affects only TypeScript; users must still
add the plugin to `plugins` at runtime", which is exactly the split this note is about.

Fastify's encapsulation DAG is a good runtime model, and `fastify-plugin` metadata (`name`,
`dependencies`, `decorators`) checks the graph at load. Its types are the counter-example: the
TypeScript reference says declaration merging "is not scope-aware", so a plugin's augmentation
applies "whether or not the plugin is used", and type providers must be re-applied in every scope.

### 2.5 Effect and Encore.ts

Effect models services, not entities. A service is a class keyed by a string
(`Context.Service<Self, Shape>()("key")`, the v4 form; v3 used `Context.Tag`). Requirements
accumulate as a union in the third parameter of `Effect<A, E, R>`, `Layer<ROut, E, RIn>` discharges
them with `Layer.provide`, and an unmet requirement is a compile error. Layers are memoized by
reference, in v4 across `Effect.provide` calls, with `Layer.fresh` to opt out. Schema lives in the
core package as `Schema<Type, Encoded, Requirements>`. Effect 4.0.0 was published on 2026-10-01,
and the migration from 3.x is substantial (services, layers and most of Schema's API). Encore.ts
takes the opposite route: a static parser reads the source and builds the application model, so
resource names must be string literals at module scope and endpoints must be exported. It is
precise but depends on its own toolchain, which conflicts with the brief's requirement that the
compiler and linter "always know what to do" on their own.

### 2.6 RedwoodJS and Wasp

Redwood merges SDL files with service modules and generates resolver types with graphql-codegen;
the build fails when an operation lacks an auth directive. The project split on 2025-04-04 into
Redwood GraphQL (maintained, "no new features planned") and RedwoodSDK. Wasp replaced its DSL with
a TypeScript spec in 0.24 (June 2026): `app({ spec: [...] })` with `with { type: "ref" }` imports,
a per-project generated `@wasp.sh/spec` package, and operation types such as
`GetTasks<Input, Output>` that type `context.entities` from the declared `entities`. Both are
spec-plus-generator systems without a notion of third-party modules contributing to each other's
entities.

## 3. Type-level techniques

Version note. TypeScript 5.9.3 (2025-09-30) is the last 5.x release; 6.0 (2026-03-23) is the last
JavaScript-based line with new defaults (`strict` on, `module` `esnext`, `types` empty); 7.0
(2026-07-08) is the Go port, "compatible with TypeScript 6.0's type-checking", without a
programmatic API until 7.1; template-literal inference now keeps Unicode code points together.
The techniques below behave the same in all three; the limits quoted come from `checker.ts` at
tag v5.9.3 and typescript-go's `checker.go`.

### 3.1 Builder accumulator generics

Every chain-based framework uses one shape: a method returns the same runtime object with a new
type argument.

```ts
class Builder<const Acc extends Record<string, unknown> = {}> {
  add<const K extends string, V>(key: K, value: V): Builder<Acc & { [P in K]: V }> {
    return this as never
  }
  build(): Prettify<Acc> { return undefined as never }
}
type Prettify<T> = { [K in keyof T]: T[K] } & {}
```

Rules that follow: the chain must be unbroken (a statement boundary drops the accumulated type);
each call re-instantiates the whole accumulator, so cost grows with chain length; and recursive
self-referencing generics benefit from explicit variance (`in out`, TypeScript 4.7), which lets
the checker compare type arguments instead of structures and avoids wrong results on circular
types. Elysia annotates all seven parameters for this reason.

### 3.2 `const` type parameters, `satisfies`, `NoInfer`

A `const` type parameter (5.0) infers `["a", "b"]` instead of `string[]` without `as const` at the
call site, provided the constraint is `readonly` (a mutable constraint silently falls back to the
widened type). `satisfies` (4.9) checks an expression against a type while keeping its inferred
type, which is why Keystone's `satisfies Lists` and Better Auth's `satisfies BetterAuthPlugin`
work. It does not make properties literal unless the target type asks for literals, so a
`defineModule()` identity function with a `const` parameter is the better boundary. `NoInfer`
(5.4) stops a parameter from contributing inference candidates, which keeps "the tuple is the
source of truth" positions honest: an option that names a module id should not widen the id union.

### 3.3 Tuple to intersection

Two ways exist. The recursive walk `T extends readonly [infer H, ...infer R]` is ordered and exact
but recursive. `UnionToIntersection<T[number]>` (type-fest's definition: a distributive
conditional type placing the union in a function parameter, so inference yields the intersection)
is non-recursive but loses order and collapses on `any`. Better Auth uses both. A third form
avoids recursion and unions of objects: map over the small union of module ids and look each module
up with `Extract<Ms[number], { id: Id }>`. Its depth is constant in the number of modules; this is
what section 4 uses.

### 3.4 Declaration merging, and why global augmentation breaks toggling

Interfaces with the same name merge, `declare module "x"` patches an existing module's exports,
and `declare global` patches the global scope. All three are applied by the compilation, not by
a value: an augmentation is in effect whenever its file is part of the program. Four frameworks
document the consequence. Fastify: augmentations apply "whether or not the plugin is used". Hono:
`ContextVariableMap` types variables where the middleware never ran. Vendure: import order and
issue 46617. Payload and Strapi: a generated augmentation that goes stale until regenerated. A
module selection expressed as a value (a tuple) and a type contribution expressed as an
augmentation can never agree by construction. Pennestack must therefore not use augmentation for
anything that depends on which modules are selected.

### 3.5 Branded identifiers

Effect keys, Elysia names, Medusa module names and Better Auth ids are all string literals; the
literal is what lets a mapped type find a module. Branding the id (`string & { [tag]: 'ModuleId' }`,
the pattern of type-fest's `Tagged`) prevents an arbitrary string from being used where a module id
is expected, and the runtime registry keys on the same string, so the type-level lookup and the
runtime lookup cannot diverge.

### 3.6 Inference limits and error quality

The checker stops with "Type instantiation is excessively deep and possibly infinite" at 100 nested
instantiations or 5,000,000 instantiations caused by one statement, and after 1000 iterations of a
tail-recursive conditional type; it reports "union type that is too complex to represent" when an
intersection of unions would expand to 100,000 or more constituents, and a tuple of 10,000 or more
elements is rejected. TypeScript 5.9 added caching of instantiations on mappers, explicitly to
reduce depth errors in libraries like Zod and tRPC. Error messages for failed conditional types
print the conditional, not the intent; the mitigations are naming intermediate types (names appear
in hovers), `Prettify` on every public derived type, `satisfies` at the module boundary so errors
appear in the module rather than at `defineApp`, and the Hono pattern of computing `typeof app`
once in its own project and consuming it through project references.

## 4. Recommendation for pennestack

Define the application from a tuple of modules. Each module declares what it provides, what it
requires (hard, compile-time checked) and what it contributes to other modules (soft: ignored when
the target module is absent). Contributions in both directions between accounts and authentication
are then expressible without a dependency cycle.

```ts
// Not shown: EntityDefinition, EntityContribution, FieldDefinition, ActionMap, ServiceMap, App,
// and UnionToIntersection (section 3.3).
interface ModuleDefinition<
  Id extends string,
  Entities extends Record<string, EntityDefinition>,
  Contributions extends Partial<Record<string, Record<string, EntityContribution>>>,
  Requires extends string,
> {
  readonly id: Id
  readonly requires?: readonly Requires[]
  readonly provides: { readonly entities: Entities; readonly actions?: ActionMap; readonly services?: ServiceMap }
  readonly contributes?: Contributions // keyed by target module id, then entity name
  readonly lifecycle?: { setup?(ctx: SetupContext): Promise<void>; start?(ctx: AppContext): Promise<void>; stop?(ctx: AppContext): Promise<void> }
}
type AnyModule = ModuleDefinition<string, any, any, string>

declare function defineModule<const M extends AnyModule>(m: M): M

type Ids<Ms extends readonly AnyModule[]> = Ms[number]['id']
type ById<Ms extends readonly AnyModule[], Id extends string> = Extract<Ms[number], { id: Id }>

// Fields other modules contribute to entity E of module Id. One mapped type over the ids, no recursion.
type ContributedFields<Ms extends readonly AnyModule[], Id extends string, E extends string> =
  UnionToIntersection<{
    [C in Ids<Ms>]: ById<Ms, C> extends { contributes: { [K in Id]: { [N in E]: { fields: infer F } } } } ? F : {}
  }[Ids<Ms>]>

type FieldTypes<F> = { [K in keyof F]: F[K] extends FieldDefinition<infer T> ? T : never }

type AppEntities<Ms extends readonly AnyModule[]> = {
  [Id in Ids<Ms>]: {
    [E in keyof ById<Ms, Id>['provides']['entities'] & string]: Prettify<
      FieldTypes<ById<Ms, Id>['provides']['entities'][E]['fields'] & ContributedFields<Ms, Id, E>>
    >
  }
}

// Distributive lookup: a module literal without a `requires` key contributes nothing.
type RequiredIds<Ms extends readonly AnyModule[]> =
  Ms[number] extends infer M ? (M extends { requires: readonly (infer R)[] } ? R : never) : never
type MissingRequirements<Ms extends readonly AnyModule[]> = Exclude<RequiredIds<Ms> & string, Ids<Ms>>

declare function defineApp<const Ms extends readonly AnyModule[]>(
  config: { modules: Ms } &
    ([MissingRequirements<Ms>] extends [never] ? {} : { missingModules: MissingRequirements<Ms> }),
): App<Ms>
```

The accounts and authentication pair then reads:

```ts
const accounts = defineModule({
  id: 'accounts',
  provides: { entities: { profile: { fields: { displayName: field.string() } } } },
})

const auth = defineModule({
  id: 'auth',
  requires: ['accounts'],
  provides: { entities: { credential: { fields: { hash: field.string() } } } },
  contributes: {
    accounts: { profile: { fields: { lastLoginAt: field.timestamp().optional() }, hooks: { afterCreate: [touchLogin] } } },
  },
})

const app = defineApp({ modules: [accounts, auth] })
type Profile = AppEntities<typeof app.modules>['accounts']['profile']
// { displayName: string; lastLoginAt: Date | undefined }. Remove `auth` from the tuple and `lastLoginAt` is gone.
// (Making the key optional is the field builder's job, not shown here.)
```

The sketch type-checks with TypeScript 5.9.3 and 7.0.2, including the negative cases: removing
`auth` makes `lastLoginAt` an error, `defineApp({ modules: [auth] })` fails on the missing
requirement, and a contribution to an absent module is ignored. A first draft looked up
`Ms[number]['requires']` directly; on a module literal without a `requires` key that resolves to
`unknown` and the check always failed, which is why `RequiredIds` is a distributive `infer`.
An equivalent form puts the check in a conditional rest parameter with `NoInfer<Ms>`.

Runtime mirror. `defineApp` builds a registry keyed by the same ids, validates `requires` again
(for dynamic selections and JavaScript callers), orders modules topologically by `requires` with
tuple order breaking ties, applies contributions in that order, and runs `setup` (schema and
contribution registration, before the data layer connects), `start` (after the data layer and
before transports listen) and `stop` in reverse. This mirrors NestJS's init-by-depth and
Strapi's register-then-bootstrap, which are the two clearest lifecycle models surveyed.
Contributed hooks run after the owner's hooks of the same stage, in module order, as Keystone
orders field hooks before list hooks.

Rules for the implementation:

- No `declare module` or `declare global` in any module package for anything that depends on the
  selection. Module-internal interfaces may use ordinary merging.
- All literal capture goes through `const` type parameters on `defineModule` and `defineApp`;
  every constraint is `readonly`.
- Derived types are mapped types keyed by module id (section 3.3). Recursion is allowed only
  where tuple order matters, written tail-recursively with an accumulator.
- Every public derived type is named and wrapped in `Prettify`.
- A `Conflicts<Ms>` type rejects two modules contributing the same field name to the same entity
  with different types, at `defineApp`, instead of silently intersecting to `never`.
- Transports (GraphQL, REST, tRPC) derive from `AppEntities` and `AppActions`, never from the
  module tuple directly, so their instantiation cost is paid once.
- A type-level test suite asserts that removing a module removes its contributions, and
  `tsc --generateTrace` runs in CI on the two reference platforms to watch instantiation counts.
- Escape hatch for large applications: export `type App = typeof app` from one file, consume it
  through project references, as Hono recommends.

Data layer. The derived entity types are the input to the data layer, not its output: a
`field.*` builder carries both the runtime column definition and the static type, in the style of
Drizzle's schema inference. Whether the brief's "live generated types" are satisfied by pure
inference or need a generator for database-introspected schemas is an open question for the
data-layer research.

## 5. Risks and open questions

Risks: instantiation cost grows with modules times entities times contributors, and transports
multiply it; a wrong `any` in a module definition collapses `UnionToIntersection`; TypeScript 7's
template-literal change argues against parsing ids with template-literal types; Effect 4.0 is
nine days old at the time of writing, so if pennestack adopts its service model it adopts a
fresh major.

Open questions: whether a contribution to an entity the target module does not define is an error
or ignored; whether a module may contribute to itself; whether application-level actions are
contributions to a pseudo-module `app`; how module ids are versioned when a module is split; and
whether the authorization layer (CASL-style conditions per action) is itself a contribution target
so that modules can add conditions to each other's actions.

## Sources

Read on 2026-10-08: the official documentation of each framework in section 2.1 (the pages on
modules, plugins, hooks, access, type generation and lifecycle), plus source where the docs were
silent: `better-auth` (`packages/better-auth/src/types/models.ts`, `packages/core/src/db/type.ts`,
`packages/core/src/types/plugin.ts`), `hono` (`src/hono-base.ts`), `elysia` (`src/index.ts`),
`payload` (`packages/payload/src/index.ts`), `effect` (`migration/*.md`), `keystone`
(`examples/usecase-blog/schema.ts`); the TypeScript release notes for 4.5, 4.7, 4.9, 5.0, 5.4 and
5.9, the handbook page on declaration merging, the announcements of TypeScript 6.0 and 7.0,
`src/compiler/checker.ts` at tag v5.9.3 and typescript-go's `internal/checker/checker.go`;
type-fest `union-to-intersection.d.ts` and `tagged.d.ts`; the RedwoodJS community announcement of
2025-04-04.
