/** Automatic re-introductions share the worker's pairing budget with manual
 * requests. Back off without relaxing the receiver's admission limit. */
export class ReconnectBackoff {
  private readonly attempts = new Map<string, { after: number; delay: number }>();
  constructor(private readonly now = () => performance.now()) {}
  begin(address: string): boolean {
    const previous = this.attempts.get(address);
    const now = this.now();
    if (previous && now < previous.after) return false;
    const delay = previous ? Math.min(previous.delay * 2, 60000) : 15000;
    this.attempts.set(address, { after: now + delay, delay });
    return true;
  }
  reset(address: string): void {
    this.attempts.delete(address);
  }
  retain(addresses: readonly string[]): void {
    const current = new Set(addresses);
    for (const address of this.attempts.keys()) if (!current.has(address)) this.reset(address);
  }
}
