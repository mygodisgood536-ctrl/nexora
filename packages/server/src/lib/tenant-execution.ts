/**
 * RULE 3.8 - multi-company concurrency and platform execution capacity.
 *
 * Two things live here, and nothing else in the product needs to know about
 * either of them:
 *
 * 1. `TenantExecutionContext`. Every outbound operation - a provider request,
 *    a webhook task, a notification fan-out, a report build, an AI execution -
 *    carries its company (and branch where it applies) in an explicit value
 *    that cannot be re-read from a shared mutable place. Secrets are resolved
 *    only inside that context, so no execution can read another tenant's
 *    credential.
 *
 * 2. `TenantLimiter`. Concurrency is bounded PER TENANT, never globally. Seven
 *    companies disbursing at once proceed at once; a single company hammering
 *    one provider is the only thing that queues, which is exactly the
 *    behaviour RULE 3.8.3 and RULE 3.8.4 require.
 */

export interface TenantScope {
  companyId: string;
  branchId?: string | null;
  /** A stable name for the resource being protected, e.g. "provider:monnify". */
  lane?: string;
}

export class TenantExecutionContext {
  readonly companyId: string;
  readonly branchId: string | null;
  readonly lane: string;
  /** Resolves this tenant's secrets. Never callable for another tenant. */
  private readonly secretResolver: (scope: { companyId: string; branchId: string | null }) => Promise<string | null>;

  private constructor(
    companyId: string,
    branchId: string | null,
    lane: string,
    secretResolver: (scope: { companyId: string; branchId: string | null }) => Promise<string | null>
  ) {
    this.companyId = companyId;
    this.branchId = branchId;
    this.lane = lane;
    this.secretResolver = secretResolver;
  }

  static forCompany(
    companyId: string,
    secretResolver: (scope: { companyId: string; branchId: string | null }) => Promise<string | null>,
    options: { branchId?: string | null; lane?: string } = {}
  ): TenantExecutionContext {
    if (!companyId) throw new Error("A tenant execution context requires a companyId");
    return new TenantExecutionContext(
      companyId,
      options.branchId ?? null,
      options.lane ?? "default",
      secretResolver
    );
  }

  /** Derives a child context that keeps the same company and secret boundary. */
  with(options: { branchId?: string | null; lane?: string }): TenantExecutionContext {
    return new TenantExecutionContext(
      this.companyId,
      options.branchId !== undefined ? options.branchId : this.branchId,
      options.lane ?? this.lane,
      this.secretResolver
    );
  }

  /** The only path to a secret. The company is bound, not passed in. */
  async secret(): Promise<string | null> {
    return this.secretResolver({ companyId: this.companyId, branchId: this.branchId });
  }

  get scope(): { companyId: string; branchId: string | null; lane: string } {
    return { companyId: this.companyId, branchId: this.branchId, lane: this.lane };
  }
}

interface LaneState {
  active: number;
  queue: Array<() => void>;
}

const DEFAULT_MAX_PER_LANE = Number(process.env.AI_MAX_CONCURRENCY_PER_TENANT ?? 8);
const DEFAULT_ACQUIRE_TIMEOUT_MS = Number(process.env.AI_LANE_WAIT_MS ?? 120_000);

/**
 * A semaphore whose keys are (company, lane) pairs. Two different companies
 * never contend, and no request waits on an unrelated tenant's work.
 */
export class TenantLimiter {
  private readonly lanes = new Map<string, LaneState>();

  constructor(
    private readonly maxPerLane: number = DEFAULT_MAX_PER_LANE,
    private readonly waitTimeoutMs: number = DEFAULT_ACQUIRE_TIMEOUT_MS
  ) {}

  private key(companyId: string, lane: string): string {
    return `${companyId}::${lane}`;
  }

  async run<T>(scope: TenantScope, fn: () => Promise<T>): Promise<T> {
    const key = this.key(scope.companyId, scope.lane ?? "default");
    await this.acquire(key, scope);
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }

  private acquire(key: string, scope: TenantScope): Promise<void> {
    const state = this.lanes.get(key) ?? { active: 0, queue: [] };
    this.lanes.set(key, state);
    if (state.active < this.maxPerLane) {
      state.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let handed = false;
      const settle = () => {
        if (handed) return;
        handed = true;
        clearTimeout(timer);
        // The releasing operation handed its slot over, so the count is
        // unchanged: this waiter now HOLDS the slot, it does not gain one.
        resolve();
      };
      const timer = setTimeout(() => {
        const index = state.queue.indexOf(settle);
        if (index >= 0) state.queue.splice(index, 1);
        reject(
          new Error(
            `Timed out waiting for execution capacity for company ${scope.companyId} (${scope.lane ?? "default"})`
          )
        );
      }, this.waitTimeoutMs);
      state.queue.push(settle);
    });
  }

  private release(key: string): void {
    const state = this.lanes.get(key);
    if (!state) return;
    const next = state.queue.shift();
    if (next) {
      next();
      return;
    }
    state.active = Math.max(0, state.active - 1);
    if (state.active === 0 && state.queue.length === 0) this.lanes.delete(key);
  }

  /** Test and diagnostics: how much work each tenant lane currently holds. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, state] of this.lanes) out[key] = state.active;
    return out;
  }
}

/** The platform-wide limiter. Per-tenant by construction, never global. */
export const tenantLimiter = new TenantLimiter();

/**
 * Runs independent company work concurrently and reports every outcome,
 * including the real reason for any failure. One company's failure never
 * cancels, corrupts or reports on another's (RULE 3.8.4, RULE 3.8.8).
 */
export async function runAcrossTenants<T>(
  items: Array<{ label: string; run: () => Promise<T> }>,
  opts: { maxParallel?: number } = {}
): Promise<
  Array<
    | { label: string; ok: true; value: T }
    | { label: string; ok: false; error: string }
  >
> {
  const limit = Math.max(1, opts.maxParallel ?? 8);
  const results: Array<
    { label: string; ok: true; value: T } | { label: string; ok: false; error: string }
  > = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index]!;
      try {
        results[index] = { label: item.label, ok: true, value: await item.run() };
      } catch (err) {
        results[index] = {
          label: item.label,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }
  }

  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
