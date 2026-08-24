import { ScopeType } from "./scopes";

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
  "configure"
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
