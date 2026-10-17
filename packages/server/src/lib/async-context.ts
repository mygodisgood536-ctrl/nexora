import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  tenant?: {
    companyId?: string;
    branchId?: string | null;
  };
  /**
   * RULE 14.3.1 / 18.17 - the role assignment used for this request. The
   * tenant transaction stamps it onto the connection as `app.role_used`, and
   * audit_logs.role_used defaults from that, so every audit writer records the
   * acting duty without each one having to pass it explicitly.
   */
  actor?: {
    userId?: string | null;
    roleKey?: string | null;
    companyId?: string | null;
    branchId?: string | null;
  };
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Records the authenticated actor on the current request context. Called from
 * the auth middleware once the token has been verified; a request that never
 * authenticates simply leaves the actor unset and no audit entry claims one.
 */
export function setRequestActor(actor: RequestContext["actor"]): void {
  const store = storage.getStore();
  if (store) store.actor = actor;
}
