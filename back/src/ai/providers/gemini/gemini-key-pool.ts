export interface GeminiKeyLease {
  index: number;
  key: string;
}

interface KeySlot {
  key: string;
  blockedUntil: number;
}

/**
 * In-memory round-robin pool. Selection is synchronous, so concurrent requests
 * are distributed before their first network await. Cooldowns intentionally do
 * not persist secrets or key fingerprints outside the process.
 */
export class GeminiKeyPool {
  private readonly slots: KeySlot[];
  private cursor = 0;

  constructor(
    keys: readonly string[],
    private readonly defaultCooldownMs: number,
    private readonly now: () => number = Date.now
  ) {
    this.slots = [...new Set(keys.map((key) => key.trim()).filter(Boolean))]
      .map((key) => ({ key, blockedUntil: 0 }));
  }

  get size(): number {
    return this.slots.length;
  }

  acquire(excluded: ReadonlySet<number> = new Set()): GeminiKeyLease | null {
    const now = this.now();
    for (let offset = 0; offset < this.slots.length; offset += 1) {
      const index = (this.cursor + offset) % this.slots.length;
      const slot = this.slots[index];
      if (slot === undefined || excluded.has(index) || slot.blockedUntil > now) continue;
      this.cursor = (index + 1) % this.slots.length;
      return { index, key: slot.key };
    }
    return null;
  }

  quarantine(index: number, cooldownMs: number = this.defaultCooldownMs): void {
    const slot = this.slots[index];
    if (slot === undefined) return;
    slot.blockedUntil = Math.max(slot.blockedUntil, this.now() + Math.max(0, cooldownMs));
  }

  nextAvailableInMs(): number {
    if (this.slots.length === 0) return 0;
    const now = this.now();
    return Math.max(0, Math.min(...this.slots.map((slot) => slot.blockedUntil - now)));
  }
}
