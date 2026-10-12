import { ScopeType } from "./scopes";

/**
 * The complete authority vocabulary (Part 1 §6 / migration 0077). Every verb
 * that exists in `permission_verbs` is listed here so the typed contract and
 * the database can never drift: the named authorities (`allocate`,
 * `register_customer`, `manage_workers`, `configure_providers`,
 * `view_performance`, `view_branches`, `create_branch`) exist precisely because
 * the generic CRUD verbs are too coarse to express a Vision boundary.
 */
export const PERMISSION_VERBS = [
  "view",
  "create",
  "edit",
  "approve",
  "reject",
  "suspend",
  "assign",
  "disburse",
  "export",
  "delete",
  "reverse",
  "configure",
  "allocate",
  "register_customer",
  "manage_workers",
  "configure_providers",
  "view_performance",
  "view_branches",
  "create_branch"
] as const;

export type PermissionVerb = (typeof PERMISSION_VERBS)[number];

export interface RoleAssignmentRef {
  roleKey: string;
  scopeType: ScopeType;
  branchIds: readonly string[];
}

export type PrincipalRole = {
  roleKey: string;
  scopeType: ScopeType;
  branchIds: readonly string[];
  permissions: readonly string[];
};

export function permissionCoversScope(
  assignment: Pick<RoleAssignmentRef, "scopeType" | "branchIds">,
  targetBranchId?: string | null
): boolean {
  switch (assignment.scopeType) {
    case ScopeType.CompanyWide:
    case ScopeType.HeadOffice:
      return true;
    case ScopeType.MultiBranch:
    case ScopeType.SingleBranch:
      return targetBranchId == null ? true : assignment.branchIds.includes(targetBranchId);
    case ScopeType.AssignedCustomersGroupsLoans:
      return false;
  }
}
