import { describe, expect, test } from 'vitest';
import { queueMemberBounds } from '../quotas/queue-member-bounds.ts';
import { checkLaneMembers } from './check-lane-members.ts';

const refused = (laneCap: number, laneWeight?: number) => () =>
  checkLaneMembers(laneWeight === undefined ? { laneCap } : { laneCap, laneWeight });

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

  test('the refusal names the range of the member', () => {
    expect(refused(-1)).toThrow('a lane cap is a whole number from 0 to 2147483647');
    expect(refused(4, 0)).toThrow('a lane weight is a whole number from 1 to 2147483647');
  });
});
