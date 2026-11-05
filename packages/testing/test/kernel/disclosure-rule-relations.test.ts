import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  relation,
} from '@keelwerk/core';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';

const post = defineEntity({ prefix: 'post', fields: { open: field.boolean().index() } });
const topic = defineEntity({ prefix: 'topic', fields: { hot: field.boolean().index() } });
const link = defineEntity({
  prefix: 'link',
  fields: { commentId: field.string().index(), topicId: field.string().index() },
});
const comment = defineEntity({
  prefix: 'cmt',
  fields: { postId: field.string().index() },
  relations: {
    post: relation.one.own('post', { by: 'id', to: 'postId' }),
    topics: relation.through.own('topic', {
      by: 'commentId',
      to: 'id',
      join: 'link',
      via: 'topicId',
    }),
  },
});
const forumBase = defineModuleBase({
  id: 'forum',
  version: '0.1.0',
  entities: { post, topic, link, comment },
});
const forum = defineModule(forumBase, {
  policies: {
    post: {
      all: defineRule(forumBase, post, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
      }),
    },
    topic: {
      all: defineRule(forumBase, topic, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
      }),
    },
    link: {
      all: defineRule(forumBase, link, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
      }),
    },
    comment: {
      write: defineRule(forumBase, comment, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
      }),
      viaPost: defineRule(forumBase, comment, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) =>
          ctx.principal.claims.via === 'topics' ? false : { post: { is: { open: true } } },
      }),
      viaTopic: defineRule(forumBase, comment, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) =>
          ctx.principal.claims.via === 'post' ? false : { topics: { some: { hot: true } } },
      }),
    },
  },
});
const forumApp = defineApp({ id: 'forum-app', modules: [forum] });

type ForumOp =
  | { kind: 'post'; open: boolean }
  | { kind: 'topic'; hot: boolean }
  | { kind: 'comment'; post: number }
  | { kind: 'move'; comment: number; post: number }
  | { kind: 'togglePost'; post: number }
  | { kind: 'toggleTopic'; topic: number }
  | { kind: 'link'; comment: number; topic: number }
  | { kind: 'unlink'; comment: number }
  | { kind: 'archive'; comment: number };

const index = fc.nat(10);
const forumOps: fc.Arbitrary<ForumOp> = fc.oneof(
  fc.record({ kind: fc.constant('post' as const), open: fc.boolean() }),
  fc.record({ kind: fc.constant('topic' as const), hot: fc.boolean() }),
  fc.record({ kind: fc.constant('comment' as const), post: index }),
  fc.record({ kind: fc.constant('move' as const), comment: index, post: index }),
  fc.record({ kind: fc.constant('togglePost' as const), post: index }),
  fc.record({ kind: fc.constant('toggleTopic' as const), topic: index }),
  fc.record({ kind: fc.constant('link' as const), comment: index, topic: index }),
  fc.record({ kind: fc.constant('unlink' as const), comment: index }),
  fc.record({ kind: fc.constant('archive' as const), comment: index }),
);

async function startForum() {
  const runtime = await startTestRuntime(forumApp, { tenants: ['acme'] });
  const tenant = runtime.tenants.acme;
  const call = async (who: ReturnType<typeof testPrincipal>, action: string, input: unknown) => {
    const out = await runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input,
      carrier: testCarrier(tenant, who),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: crypto.randomUUID(),
    });
    if (!out.ok) throw out.error;
    return out.value;
  };
  const writer = testPrincipal('w');
  const check = async (ops: readonly ForumOp[], via: string, pick: number): Promise<boolean> => {
    const reader = testPrincipal('r', { claims: { via } });
    const posts: { id: string; open: boolean }[] = [];
    const topics: { id: string; hot: boolean }[] = [];
    const comments: { id: string; post: number; archived: boolean; touched: number }[] = [];
    const links = new Map<number, { id: string; topic: number }>();
    const visible = (at: number): Set<string> =>
      new Set(
        comments
          .filter((item) => {
            if (item.archived || item.touched < 0) return false;
            const viaPost = via !== 'topics' && posts[item.post]?.open === true;
            const link = links.get(comments.indexOf(item));
            const viaTopic =
              via !== 'post' && link !== undefined && topics[link.topic]?.hot === true;
            return at >= 0 && (viaPost || viaTopic);
          })
          .map((item) => item.id),
      );
    const marks: { state: string; queryState: string; seen: Set<string>; known: Set<string> }[] =
      [];
    const touches: Set<string>[] = [];
    let touching = new Set<string>();
    const record = async () => {
      touches.push(touching);
      touching = new Set();
      const got = (await call(reader, 'forum.comment.get', { ids: [] })) as { state: string };
      const page = (await call(reader, 'forum.comment.query', {})) as { queryState: string };
      marks.push({
        state: got.state,
        queryState: page.queryState,
        seen: visible(0),
        known: new Set(comments.map((item) => item.id)),
      });
    };
    const at = <T>(list: readonly T[], n: number): T | undefined =>
      list.length === 0 ? undefined : list[n % list.length];
    await record();
    for (const op of ops) {
      if (op.kind === 'post' || op.kind === 'topic') {
        const out = (await call(
          writer,
          `forum.${op.kind}.create`,
          op.kind === 'post' ? { open: op.open } : { hot: op.hot },
        )) as { id: string };
        if (op.kind === 'post') posts.push({ id: out.id, open: op.open });
        else topics.push({ id: out.id, hot: op.hot });
        continue;
      }
      if (op.kind === 'comment') {
        const target = at(posts, op.post);
        if (target === undefined) continue;
        const out = (await call(writer, 'forum.comment.create', { postId: target.id })) as {
          id: string;
        };
        comments.push({ id: out.id, post: posts.indexOf(target), archived: false, touched: 0 });
        touching.add(out.id);
      } else if (op.kind === 'move') {
        const target = at(comments, op.comment);
        const dest = at(posts, op.post);
        if (target === undefined || dest === undefined || target.archived) continue;
        await call(writer, 'forum.comment.update', { id: target.id, patch: { postId: dest.id } });
        target.post = posts.indexOf(dest);
        touching.add(target.id);
      } else if (op.kind === 'archive') {
        const target = at(comments, op.comment);
        if (target === undefined || target.archived) continue;
        await call(writer, 'forum.comment.archive', { id: target.id });
        target.archived = true;
        touching.add(target.id);
      } else if (op.kind === 'togglePost') {
        const target = at(posts, op.post);
        if (target === undefined) continue;
        target.open = !target.open;
        await call(writer, 'forum.post.update', { id: target.id, patch: { open: target.open } });
      } else if (op.kind === 'toggleTopic') {
        const target = at(topics, op.topic);
        if (target === undefined) continue;
        target.hot = !target.hot;
        await call(writer, 'forum.topic.update', { id: target.id, patch: { hot: target.hot } });
      } else if (op.kind === 'link') {
        const target = at(comments, op.comment);
        const dest = at(topics, op.topic);
        const key = target === undefined ? -1 : comments.indexOf(target);
        if (target === undefined || dest === undefined || links.has(key)) continue;
        const out = (await call(writer, 'forum.link.create', {
          commentId: target.id,
          topicId: dest.id,
        })) as { id: string };
        links.set(key, { id: out.id, topic: topics.indexOf(dest) });
      } else if (op.kind === 'unlink') {
        const target = at(comments, op.comment);
        const key = target === undefined ? -1 : comments.indexOf(target);
        const existing = links.get(key);
        if (existing === undefined) continue;
        await call(writer, 'forum.link.archive', { id: existing.id });
        links.delete(key);
      }
      await record();
    }
    const from = pick % marks.length;
    const mark = marks[from];
    if (mark === undefined) return false;
    const now = visible(0);
    const answer = (await call(reader, 'forum.comment.changes', {
      since: mark.state,
      max: 500,
    })) as {
      created: string[];
      changed: string[];
      archived: string[];
      cannotCalculateChanges?: boolean;
    };
    const answeredHere = answer.cannotCalculateChanges !== true;
    if (answeredHere) {
      const touched = new Set(touches.slice(from + 1).flatMap((set) => [...set]));
      const none = (): string[] => [];
      const expected = { created: none(), changed: none(), archived: none() };
      for (const id of touched) {
        if (now.has(id)) (mark.known.has(id) ? expected.changed : expected.created).push(id);
        else if (mark.seen.has(id)) expected.archived.push(id);
      }
      for (const list of [answer.created, answer.changed, answer.archived]) list.sort();
      for (const list of Object.values(expected)) list.sort();
      expect({
        created: answer.created,
        changed: answer.changed,
        archived: answer.archived,
      }).toEqual(expected);
    }
    const moved = (await call(reader, 'forum.comment.queryChanges', {
      sinceQueryState: mark.queryState,
    })) as { added: { id: string }[]; removed: string[]; cannotCalculateChanges?: boolean };
    if (moved.cannotCalculateChanges === true) return answeredHere;
    const added = new Set(moved.added.map((item) => item.id));
    const removed = new Set(moved.removed);
    for (const id of now) if (!mark.seen.has(id)) expect(added.has(id)).toBe(true);
    for (const id of mark.seen) if (!now.has(id)) expect(removed.has(id)).toBe(true);
    for (const id of added) expect(now.has(id)).toBe(true);
    for (const id of removed) expect(mark.seen.has(id)).toBe(true);
    return answeredHere;
  };
  return { check, stop: () => runtime.stop() };
}

// A comment that existed at the token and became readable since is changed, not created (section
// 15.2.6 step 2: created means its created event is after the token; fast-check seed 1469330072).
// biome-ignore format: one line for the whole operation list
const counterexample: ForumOp[] = [{ kind: 'post', open: true }, { kind: 'post', open: false }, { kind: 'comment', post: 0 }, { kind: 'comment', post: 3 }, { kind: 'move', comment: 3, post: 0 }, { kind: 'unlink', comment: 0 }, { kind: 'comment', post: 0 }];

describe('the disclosure rule over relation quantifiers (model test)', () => {
  test('changes and queryChanges never contradict a model of the full history', {
    timeout: 240_000,
  }, async () => {
    const forumRun = await startForum();
    let answered = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(forumOps, { minLength: 2, maxLength: 10 }),
        fc.constantFrom('post', 'topics', 'both'),
        fc.nat(10),
        async (ops, via, pick) => {
          if (await forumRun.check(ops, via, pick)) answered += 1;
        },
      ),
      {
        numRuns: 200,
        examples: [[counterexample, 'post', 2]],
      },
    );
    expect(answered).toBeGreaterThan(0);
    await forumRun.stop();
  });
});
