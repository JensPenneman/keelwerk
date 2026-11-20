/** Reads the body to its end; a rejected read fails the test. */
export async function drained(response: Response): Promise<string> {
  return await response.text();
}
