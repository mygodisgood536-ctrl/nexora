export enum ScopeType {
  CompanyWide = "company_wide",
  HeadOffice = "head_office",
  MultiBranch = "multi_branch",
  SingleBranch = "single_branch",
  AssignedCustomersGroupsLoans = "assigned_customers_groups_loans"
}

export const SCOPE_TYPE_LABELS: Record<ScopeType, string> = {
  [ScopeType.CompanyWide]: "Company-wide",
  [ScopeType.HeadOffice]: "Head Office",
  [ScopeType.MultiBranch]: "Multi-branch (named set)",
  [ScopeType.SingleBranch]: "Single branch",
  [ScopeType.AssignedCustomersGroupsLoans]: "Assigned customers/groups/loans"
};
