/** What an asynchronously accepted command answers with (section 4.7). */
export interface CommandReceipt {
  readonly commandId: string;
  readonly status: 'accepted';
}
