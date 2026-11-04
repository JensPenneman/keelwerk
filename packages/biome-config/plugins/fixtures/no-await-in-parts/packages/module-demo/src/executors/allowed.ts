export async function send(): Promise<number> {
  const response = await fetch('https://example.com');
  return response.status;
}
