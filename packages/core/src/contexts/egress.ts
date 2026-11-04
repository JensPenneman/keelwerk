/** What an executor may send out (section 12.3). */
export interface Egress {
  fetch(
    url: string,
    init?: {
      readonly method?: string;
      readonly body?: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ readonly status: number; text(): Promise<string> }>;
}
