import type { DriveExpectation } from './drive-expectation.ts';
import type { RequestMatcher } from './request-matcher.ts';

/** A driven `decide`: the requests it should yield with their answers, then what it should return. */
export interface DriveRun {
  /** The next request the handler should yield; `.answer(value)` is what it gets back. */
  expect(matcher: RequestMatcher): { answer(value: unknown): DriveRun };
  /** Runs the handler and asserts what it returned. */
  returns(expected: DriveExpectation): Promise<void>;
  /** Runs the handler and asserts that it failed with the error code. */
  throws(code: string): Promise<void>;
}
