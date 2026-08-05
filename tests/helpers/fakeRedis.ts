interface Entry {
  value: number;
  expiresAt: number | null;
}

// Every round trip costs a real turn of the event loop, which is the whole
// point: a caller that decides across two of them can be overtaken here the way
// it is over a network. The per-process path only drains microtasks, and closes
// the same window by accident.
export class FakeRedis {
  readonly store = new Map<string, Entry>();
  now = 0;
  latencyMs = 0;
  roundTrips = 0;
  failFrom: number | null = null;
  failWith: Error = new Error('connection lost');
  replyWith: unknown = undefined;

  live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  keysWithoutExpiry(): string[] {
    return [...this.store].filter(([, entry]) => entry.expiresAt === null).map(([key]) => key);
  }

  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const trip = (this.roundTrips += 1);
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    if (this.failFrom !== null && trip >= this.failFrom) {
      throw this.failWith;
    }
    if (this.replyWith !== undefined) {
      return this.replyWith;
    }
    return this.#run(script, options.keys, options.arguments);
  }

  // Reads its arguments exactly where the script reads them, so a max or a
  // window passed in the wrong place fails here too.
  #run(script: string, keys: string[], args: string[]): number {
    if (script.includes('DECR')) {
      for (const key of keys) {
        const entry = this.live(key);
        if (entry !== undefined && entry.value > 0) {
          entry.value -= 1;
        }
      }
      return 0;
    }
    if (!script.includes('INCR')) {
      throw new Error('This fake was never taught that script');
    }
    const windowMs = Number(args[keys.length]);
    let refused = 0;
    for (const [index, key] of keys.entries()) {
      const entry = this.live(key);
      if (entry !== undefined) {
        entry.expiresAt ??= this.now + windowMs;
      }
      if (refused === 0 && (entry?.value ?? 0) >= Number(args[index])) {
        refused = index + 1;
      }
    }
    if (refused > 0) {
      return refused;
    }
    for (const key of keys) {
      const entry = this.live(key);
      if (entry === undefined) {
        this.store.set(key, { value: 1, expiresAt: this.now + windowMs });
      } else {
        entry.value += 1;
        entry.expiresAt ??= this.now + windowMs;
      }
    }
    return 0;
  }
}
