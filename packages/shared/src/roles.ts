export type RoleCategory =
  | "executive"
  | "finance"
  | "hr_admin"
  | "audit_compliance"
  | "credit_loans"
  | "customer_accounts"
  | "operations_field"
  | "other";

export interface RoleDefinition {
  readonly key: string;
  readonly name: string;
  readonly category: RoleCategory;
}

export const ROLE_CATEGORIES: ReadonlyArray<{ key: RoleCategory; label: string }> = [
  { key: "executive", label: "Executive" },
  { key: "finance", label: "Finance" },
  { key: "hr_admin", label: "HR/Admin" },
  { key: "audit_compliance", label: "Audit/Compliance" },
  { key: "credit_loans", label: "Credit/Loans" },
  { key: "customer_accounts", label: "Customer/Accounts" },
  { key: "operations_field", label: "Operations/Field" },
  { key: "other", label: "Other" }
];

export const BUILT_IN_ROLES: ReadonlyArray<RoleDefinition> = [
  { key: "md", name: "MD", category: "executive" },
  { key: "deputy_md", name: "Deputy MD", category: "executive" },
  { key: "gm", name: "GM", category: "executive" },
  { key: "assistant_gm", name: "Assistant GM", category: "executive" },
  { key: "head_office_administrator", name: "Head Office Administrator", category: "executive" },
  { key: "operations_manager", name: "Operations Manager", category: "executive" },
  { key: "assistant_operations_manager", name: "Assistant Operations Manager", category: "executive" },
  { key: "finance_manager", name: "Finance Manager", category: "finance" },
  { key: "accountant", name: "Accountant", category: "finance" },
  { key: "assistant_accountant", name: "Assistant Accountant", category: "finance" },
  { key: "cash_bank_reconciliation_officer", name: "Cash/Bank Reconciliation Officer", category: "finance" },
  { key: "hr_manager", name: "HR Manager", category: "hr_admin" },
  { key: "hr_officer", name: "HR Officer", category: "hr_admin" },
  { key: "internal_auditor", name: "Internal Auditor", category: "audit_compliance" },
  { key: "audit_officer", name: "Audit Officer", category: "audit_compliance" },
  { key: "compliance_officer", name: "Compliance Officer", category: "audit_compliance" },
  { key: "risk_officer", name: "Risk Officer", category: "audit_compliance" },
  { key: "credit_manager", name: "Credit Manager", category: "credit_loans" },
  { key: "credit_officer", name: "Credit Officer", category: "credit_loans" },
  { key: "customer_service_officer", name: "Customer Service Officer", category: "customer_accounts" },
  { key: "customer_service_manager", name: "Customer Service Manager", category: "customer_accounts" },
  { key: "area_manager", name: "Area Manager", category: "operations_field" },
  { key: "branch_manager", name: "Branch Manager", category: "operations_field" },
  { key: "deputy_branch_manager", name: "Deputy/Assistant Branch Manager", category: "operations_field" },
  { key: "collection_officer", name: "Collection Officer", category: "operations_field" },
  { key: "senior_collection_officer", name: "Senior Collection Officer", category: "operations_field" },
  { key: "recovery_officer", name: "Recovery Officer", category: "other" },
  { key: "mis_reporting_officer", name: "MIS/Reporting Officer", category: "other" },
  { key: "it_system_administrator", name: "IT/System Administrator", category: "other" }
];

export const CUSTOM_ROLE_TEMPLATES: ReadonlyArray<RoleDefinition> = [
  { key: "template_finance_officer", name: "Finance Officer", category: "finance" },
  { key: "template_hr_assistant", name: "HR Assistant", category: "hr_admin" },
  { key: "template_administrative_officer", name: "Administrative Officer", category: "hr_admin" },
  { key: "template_loan_processing_officer", name: "Loan Processing Officer", category: "credit_loans" },
  { key: "template_credit_analyst", name: "Credit Analyst", category: "credit_loans" },
  { key: "template_operations_officer", name: "Operations Officer", category: "operations_field" },
  { key: "template_portfolio_manager", name: "Portfolio Manager", category: "other" },
  { key: "template_treasury_officer", name: "Treasury Officer", category: "other" },
  { key: "template_data_reporting_analyst", name: "Data/Reporting Analyst", category: "other" }
];

const builtInKeys = new Set(BUILT_IN_ROLES.map((r) => r.key));

export function isBuiltInRoleKey(key: string): boolean {
  return builtInKeys.has(key);
}

/**
 * RULE 6.1.1 / 4.5.1 — company roles are organised into two worlds, and the
 * difference is scope. Head Office roles inspect and govern the whole company;
 * branch roles belong to a branch. The creation endpoint must ask which world
 * the worker belongs to and then validate that the chosen role and the chosen
 * scope agree, so a Head Office role can never be created inside a branch
 * workplace and a branch role can never be created without a branch.
 */
export type RoleWorld = "head_office" | "branch";

const BRANCH_WORLD_KEYS: ReadonlySet<string> = new Set([
  "area_manager",
  "branch_manager",
  "deputy_branch_manager",
  "collection_officer",
  "senior_collection_officer",
  "recovery_officer"
]);

export function roleWorldFor(roleKey: string): RoleWorld {
  return BRANCH_WORLD_KEYS.has(roleKey) ? "branch" : "head_office";
}

export function isHeadOfficeRoleKey(roleKey: string): boolean {
  return roleWorldFor(roleKey) === "head_office";
}
