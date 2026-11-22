import { describe, expect, test } from 'vitest';
import { queueMemberBounds } from '../quotas/queue-member-bounds.ts';
import { checkLaneMembers } from './check-lane-members.ts';

const refused = (laneCap: number, laneWeight?: number) => () =>
  checkLaneMembers(laneWeight === undefined ? { laneCap } : { laneCap, laneWeight });
const refusedCap = (queuedCap: number) => () => checkLaneMembers({ laneCap: 4, queuedCap });

describe('checkLaneMembers', () => {
  test('a cap from 0 and a weight from 1 up to the bound are accepted, an absent weight too', () => {
    const { max } = queueMemberBounds;
    expect(refused(0)).not.toThrow();
    expect(refused(max)).not.toThrow();
    expect(refused(4, 1)).not.toThrow();
    expect(refused(4, max)).not.toThrow();
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, queueMemberBounds.max + 1])(
    'a cap of %s is refused as malformed',
    (laneCap) => {
      expect(refused(laneCap)).toThrow(expect.objectContaining({ code: 'core.malformed_request' }));
    },
  );

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, queueMemberBounds.max + 1])(
    'a weight of %s is refused as malformed',
    (laneWeight) => {
      expect(refused(4, laneWeight)).toThrow(
        expect.objectContaining({ code: 'core.malformed_request' }),
      );
    },
  );

  test('a queued cap from 0 up to the greatest safe whole number is accepted', () => {
    expect(refusedCap(0)).not.toThrow();
    expect(refusedCap(10_000)).not.toThrow();
    expect(refusedCap(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'a queued cap of %s is refused as malformed',
    (queuedCap) => {
      expect(refusedCap(queuedCap)).toThrow(
        expect.objectContaining({ code: 'core.malformed_request' }),
      );
    },
  );

  test('the refusal names the range of the member', () => {
    expect(refusedCap(-1)).toThrow('a queued cap is a safe whole number from 0');
    expect(refused(-1)).toThrow('a lane cap is a whole number from 0 to 2147483647');
    expect(refused(4, 0)).toThrow('a lane weight is a whole number from 1 to 2147483647');
  });
});
