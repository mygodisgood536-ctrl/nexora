import type { ScopeType } from "./scopes";

/** One role assignment as stored in role_assignments (+ its branch set). */
export interface AssignmentInput {
  roleKey: string;
  scopeType: ScopeType;
  branchIds: readonly string[];
  assignmentType: "permanent" | "temporary";
  status: "active" | "ended";
  startsAt: Date;
  endsAt: Date | null;
}

/** Resolved, flattened authority for one role assignment. */
export interface EffectiveRole {
  roleKey: string;
  scopeType: ScopeType;
  branchIds: readonly string[];
  permissions: readonly string[];
}

export interface Principal {
  userId: string;
  companyId: string;
  branchId: string | null;
  roles: EffectiveRole[];
  permissions: readonly string[];
}

/**
 * A temporary assignment participates only while its window covers `now`
 * (Part 1 §17: auto-activates at start, auto-deactivates at end-of-day in
 * the company timezone; the boundary math is applied by the caller passing
 * the effective instant).
 */
export function isAssignmentActive(a: AssignmentInput, now: Date = new Date()): boolean {
  if (a.status !== "active") return false;
  if (a.startsAt.getTime() > now.getTime()) return false;
  if (a.endsAt !== null && a.endsAt.getTime() < now.getTime()) return false;
  return true;
}

/**
 * Permission merge rule (Part 1 §16): effective permissions are the UNION of
 * every currently-active assignment's grants whose scope covers the context.
 * There is no "highest role wins" and no downgrade: a restriction attached to
 * one role never subtracts from another role's grant.
 */
export function resolvePrincipal(input: {
  userId: string;
  companyId: string;
  branchId: string | null;
  assignments: ReadonlyArray<AssignmentInput & { permissions: readonly string[] }>;
  now?: Date;
}): Principal {
  const roles: EffectiveRole[] = [];
  const merged = new Set<string>();

  for (const a of input.assignments) {
    if (!isAssignmentActive(a, input.now)) continue;
    const effectiveBranches =
      a.scopeType === ("multi_branch" as ScopeType) || a.scopeType === ("single_branch" as ScopeType)
        ? a.branchIds
        : [];
    roles.push({
      roleKey: a.roleKey,
      scopeType: a.scopeType,
      branchIds: effectiveBranches,
      permissions: a.permissions
    });
    for (const p of a.permissions) merged.add(p);
  }

  return {
    userId: input.userId,
    companyId: input.companyId,
    branchId: input.branchId,
    roles,
    permissions: [...merged]
  };
}

/** Can this principal perform `verb` against data in `targetBranchId`? */
export function principalCan(
  principal: Principal,
  verb: string,
  targetBranchId?: string | null
): boolean {
  return principal.roles.some(
    (r) =>
      r.permissions.includes(verb) &&
      scopeCovers(r.scopeType, r.branchIds, targetBranchId ?? principal.branchId)
  );
}

function scopeCovers(
  scopeType: ScopeType,
  branchIds: readonly string[],
  targetBranchId: string | null | undefined
): boolean {
  switch (scopeType) {
    case "company_wide":
    case "head_office":
      return true;
    case "multi_branch":
    case "single_branch":
      return targetBranchId == null ? true : branchIds.includes(targetBranchId);
    case "assigned_customers_groups_loans":
      return false;
    default:
      return false;
  }
}
