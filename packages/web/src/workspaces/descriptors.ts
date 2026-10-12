export interface NavItem {
  to: string;
  label: string;
  icon: string;
}

export interface NavGroup {
  key: string;
  title: string;
  items: NavItem[];
}

export interface SummaryBlock {
  label: string;
  metric: string;
}

/**
 * RULE 12.0.3 / 12.0.4 - every role gets its own workspace: a landing
 * summary of vital numbers, named groups that open on click, and the role's
 * own pages. One descriptor per role key (Part 12, sections 12.1-12.31);
 * pages resolve to real, permission-guarded routes in the router.
 */
export interface Workspace {
  key: string;
  label: string;
  purpose: string;
  blocks: SummaryBlock[];
  groups: NavGroup[];
  /** Branch Workplace visibility (RULE 7.2.1 vs 7.2.2). */
  workplace: "all" | "area" | "own" | "none";
}

const G = (key: string, title: string, items: Array<[string, string, string]>): NavGroup => ({
  key,
  title,
  items: items.map(([to, label, icon]) => ({ to, label, icon }))
});

export const WORKSPACES: Record<string, Workspace> = {
  /* ---------------- 12.1 MD - the MD Board (Part 4) ---------------- */
  md: {
    key: "md",
    label: "MD Board",
    purpose: "Owns the company; sees everything, decides everything, authorises at the end of any chain.",
    blocks: [
      { label: "Portfolio outstanding", metric: "portfolio" },
      { label: "Collected today", metric: "collections_today" },
      { label: "Pending approvals", metric: "pending_approvals" },
      { label: "Branches live", metric: "branches" }
    ],
    workplace: "all",
    groups: [
      G("command", "Command", [["/", "Command dashboard", "dashboard"], ["/performance", "Performance", "trend"], ["/reports", "Reports", "reports"]]),
      G("money", "Money", [["/money", "Money & ledger", "money"], ["/reconciliation", "Reconciliation", "clipboard"], ["/eod", "End of day", "wallet"]]),
      G("branches", "Branches", [["/branches", "Branch registry", "branch"], ["/workplace", "Branch workplace", "building"]]),
      G("people", "People", [["/people", "Workers", "users"], ["/control", "Roles & control", "key"]]),
      G("customers", "Customers", [["/customers", "Customers", "customers"], ["/groups", "Groups", "people"]]),
      G("credit", "Credit", [["/credit", "Applications & credit", "credit"], ["/approvals", "Approvals", "approvals"]]),
      G("providers", "Providers", [["/providers", "Payment providers", "provider"], ["/technical", "Webhooks & health", "activity"]]),
      G("approvals", "Approvals", [["/approvals", "Approval inbox", "approvals"]]),
      G("audit", "Audit", [["/audit", "Audit trail", "audit"]]),
      G("control", "Control", [["/control", "Company control", "control"], ["/findings", "Findings", "file"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"], ["/performance", "Performance views", "trend"]])
    ]
  },

  /* ---------------- 12.2 Deputy MD ---------------- */
  deputy_md: {
    key: "deputy_md",
    label: "Deputy MD Board",
    purpose: "The MD's stand-in; the same board, with Control read-only unless the MD delegates a specific change.",
    blocks: [
      { label: "Portfolio outstanding", metric: "portfolio" },
      { label: "Collected today", metric: "collections_today" },
      { label: "Pending approvals", metric: "pending_approvals" },
      { label: "Branches live", metric: "branches" }
    ],
    workplace: "all",
    groups: [
      G("command", "Command", [["/", "Command dashboard", "dashboard"], ["/performance", "Performance", "trend"], ["/reports", "Reports", "reports"]]),
      G("money", "Money", [["/money", "Money & ledger", "money"], ["/reconciliation", "Reconciliation", "clipboard"]]),
      G("branches", "Branches", [["/branches", "Branch registry", "branch"], ["/workplace", "Branch workplace", "building"]]),
      G("people", "People", [["/people", "Workers", "users"], ["/control", "Roles & control (read)", "key"]]),
      G("customers", "Customers", [["/customers", "Customers", "customers"], ["/groups", "Groups", "people"]]),
      G("credit", "Credit", [["/credit", "Applications & credit", "credit"], ["/approvals", "Approvals", "approvals"]]),
      G("providers", "Providers", [["/providers", "Payment providers", "provider"]]),
      G("audit", "Audit", [["/audit", "Audit trail", "audit"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },

  /* ---------------- 12.3 GM ---------------- */
  gm: {
    key: "gm",
    label: "Operations hub",
    purpose: "Runs day-to-day operations; normally a mid-chain or final approver.",
    blocks: [
      { label: "Branch performance", metric: "branch_performance" },
      { label: "Pending approvals", metric: "pending_approvals" },
      { label: "Workers active", metric: "workers" },
      { label: "Collected today", metric: "collections_today" }
    ],
    workplace: "all",
    groups: [
      G("operations", "Branch performance", [["/performance", "Performance views", "trend"], ["/branches", "Branches", "branch"], ["/workplace", "Branch workplace", "building"]]),
      G("workers", "Workers", [["/people", "Worker directory", "users"]]),
      G("approvals", "Approvals", [["/approvals", "Approval inbox", "approvals"], ["/credit", "Applications", "credit"]]),
      G("credit", "Credit", [["/credit", "Applications & credit", "credit"]]),
      G("providers", "Providers", [["/providers", "Payment providers", "provider"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]]),
      G("audit", "Audit", [["/audit", "Audit trail", "audit"]])
    ]
  },

  /* ---------------- 12.4 Assistant GM ---------------- */
  assistant_gm: {
    key: "assistant_gm",
    label: "Operations hub (Assistant)",
    purpose: "Operational coverage for the GM: views everything the GM views, acts only where the chain includes this role.",
    blocks: [
      { label: "Branch performance", metric: "branch_performance" },
      { label: "Pending approvals", metric: "pending_approvals" },
      { label: "Workers active", metric: "workers" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("operations", "Branch performance", [["/performance", "Performance views", "trend"], ["/branches", "Branches", "branch"], ["/workplace", "Branch workplace", "building"]]),
      G("workers", "Workers", [["/people", "Worker directory", "users"]]),
      G("approvals", "Approvals", [["/approvals", "Approval inbox", "approvals"]]),
      G("credit", "Credit", [["/credit", "Applications", "credit"]]),
      G("providers", "Providers", [["/providers", "Payment providers (view)", "provider"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]]),
      G("audit", "Audit", [["/audit", "Audit trail", "audit"]])
    ]
  },

  /* ---------------- 12.5 / 12.6 Operations ---------------- */
  operations_manager: {
    key: "operations_manager",
    label: "Operations hub",
    purpose: "Process, branch operations and service levels.",
    blocks: [
      { label: "Branch operations", metric: "branch_performance" },
      { label: "Process exceptions", metric: "exceptions" },
      { label: "Workers in branch scope", metric: "workers" },
      { label: "Pending approvals", metric: "pending_approvals" }
    ],
    workplace: "all",
    groups: [
      G("branch_operations", "Branch operations", [["/branches", "Branch registry", "branch"], ["/workplace", "Branch workplace", "building"], ["/performance", "Performance", "trend"]]),
      G("exceptions", "Process exceptions", [["/reconciliation", "Exceptions queue", "alert"], ["/technical", "Webhook exceptions", "activity"]]),
      G("workers", "Workers (branch)", [["/people", "Worker directory", "users"]]),
      G("approvals", "Approvals", [["/approvals", "Approval inbox", "approvals"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },
  assistant_operations_manager: {
    key: "assistant_operations_manager",
    label: "Operations hub (Assistant)",
    purpose: "Operations support: branch inspection and process exception follow-up, minus configuration surfaces.",
    blocks: [
      { label: "Branch operations", metric: "branch_performance" },
      { label: "Process exceptions", metric: "exceptions" },
      { label: "Workers in branch scope", metric: "workers" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("branch_operations", "Branch operations", [["/branches", "Branches (view)", "branch"], ["/workplace", "Branch workplace", "building"], ["/performance", "Performance", "trend"]]),
      G("exceptions", "Process exceptions", [["/reconciliation", "Exceptions queue", "alert"]]),
      G("workers", "Workers (branch)", [["/people", "Worker directory", "users"]]),
      G("approvals", "Approvals", [["/approvals", "Approval inbox", "approvals"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },

  /* ---------------- 12.7 Head Office Administrator ---------------- */
  head_office_administrator: {
    key: "head_office_administrator",
    label: "Administration hub",
    purpose: "Executes the company's configuration day to day: profile, branding, roles, branches.",
    blocks: [
      { label: "Roles enabled", metric: "roles_enabled" },
      { label: "Branches", metric: "branches" },
      { label: "Workers", metric: "workers" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("company", "Company", [["/control", "Company profile & branding", "settings"], ["/control", "Roles", "key"]]),
      G("branches", "Branches", [["/branches", "Branch registry", "branch"]]),
      G("workers", "Workers", [["/people", "Workers (view)", "users"]]),
      G("providers", "Providers (view)", [["/providers", "Payment providers", "provider"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },

  /* ---------------- 12.8-12.11 Finance family ---------------- */
  finance_manager: {
    key: "finance_manager",
    label: "Finance hub",
    purpose: "The truth of money: reconciliation, exceptions, reversals, settlements, statements.",
    blocks: [
      { label: "Unallocated payments", metric: "unallocated" },
      { label: "Unmatched items", metric: "unmatched" },
      { label: "Collected today", metric: "collections_today" },
      { label: "Exceptions open", metric: "exceptions" }
    ],
    workplace: "all",
    groups: [
      G("reconciliation", "Reconciliation", [["/reconciliation", "Settlement matching", "clipboard"], ["/money", "Cash book", "money"]]),
      G("exceptions", "Exceptions", [["/reconciliation", "Exceptions queue", "alert"], ["/technical", "Webhook exceptions", "activity"]]),
      G("reversals", "Reversals", [["/reconciliation", "Corrections & reversals", "receipt"]]),
      G("settlements", "Settlements", [["/money", "Settlement view", "wallet"], ["/providers", "Provider status", "provider"]]),
      G("statements", "Statements", [["/money", "Statements & ledger", "file"], ["/reports", "Reports", "reports"]]),
      G("providers", "Provider status", [["/providers", "Payment providers", "provider"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },
  accountant: {
    key: "accountant",
    label: "Accounting hub",
    purpose: "Postings, statements and schedules from the verified data.",
    blocks: [
      { label: "Trial balance", metric: "trial_balance" },
      { label: "Cash position", metric: "cash_position" },
      { label: "Collected today", metric: "collections_today" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("ledger", "Ledger", [["/money", "General ledger", "money"], ["/money", "Trial balance", "clipboard"]]),
      G("schedules", "Schedules", [["/money", "Cash flow & schedules", "trend"]]),
      G("statements", "Statements", [["/money", "Income statement & position", "file"], ["/reports", "Reports", "reports"]]),
      G("reconciliation", "Reconciliation (assist)", [["/reconciliation", "Reconciliation view", "clipboard"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },
  assistant_accountant: {
    key: "assistant_accountant",
    label: "Accounting hub (reduced)",
    purpose: "Accounting support: prepare schedules, view the ledger, assist reconciliation.",
    blocks: [
      { label: "Trial balance", metric: "trial_balance" },
      { label: "Cash position", metric: "cash_position" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("ledger", "Ledger (view)", [["/money", "General ledger", "money"]]),
      G("schedules", "Schedules", [["/money", "Cash flow & schedules", "trend"]]),
      G("statements", "Statements (assist)", [["/money", "Statements", "file"]]),
      G("reconciliation", "Reconciliation (assist)", [["/reconciliation", "Reconciliation view", "clipboard"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },
  cash_bank_reconciliation_officer: {
    key: "cash_bank_reconciliation_officer",
    label: "Reconciliation hub",
    purpose: "Matches provider settlements to internal records and triages exceptions before Finance sees them.",
    blocks: [
      { label: "Unmatched settlements", metric: "unmatched" },
      { label: "Unallocated", metric: "unallocated" },
      { label: "Exceptions open", metric: "exceptions" },
      { label: "Collected today", metric: "collections_today" }
    ],
    workplace: "all",
    groups: [
      G("matching", "Settlement matching", [["/reconciliation", "Matching queue", "clipboard"]]),
      G("exceptions", "Exceptions", [["/reconciliation", "Exceptions queue", "alert"]]),
      G("statements", "Provider statements", [["/providers", "Provider statements", "file"], ["/money", "Cash book", "money"]]),
      G("reports", "Reports", [["/reports", "Reconciliation reports", "reports"]])
    ]
  },

  /* ---------------- 12.12 / 12.13 HR family ---------------- */
  hr_manager: {
    key: "hr_manager",
    label: "HR hub",
    purpose: "Owns the workforce: who is here, how they perform, what happens to their seats.",
    blocks: [
      { label: "Workers", metric: "workers" },
      { label: "Active today", metric: "workers_active_today" },
      { label: "Role assignments open", metric: "assignments_open" },
      { label: "Branches", metric: "branches" }
    ],
    workplace: "all",
    groups: [
      G("people", "People", [["/people", "Worker directory", "users"], ["/people", "Create worker", "plus"], ["/people", "Account controls", "lock"]]),
      G("assignments", "Role assignments", [["/people", "Assignments", "layers"], ["/control", "Role catalogue", "key"]]),
      G("performance", "Worker performance", [["/performance", "Staff performance", "trend"]]),
      G("organisation", "Organisation performance", [["/performance", "Company & branch performance", "trend"], ["/reports", "Reports", "reports"]])
    ]
  },
  hr_officer: {
    key: "hr_officer",
    label: "HR hub (reduced)",
    purpose: "HR operations under the HR Manager: records, attendance and performance views.",
    blocks: [
      { label: "Workers", metric: "workers" },
      { label: "Active today", metric: "workers_active_today" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("people", "People", [["/people", "Worker directory", "users"], ["/people", "Create worker (where granted)", "plus"]]),
      G("records", "Records", [["/people", "Worker records", "file"]]),
      G("performance", "Worker performance (view)", [["/performance", "Staff performance", "trend"]])
    ]
  },

  /* ---------------- 12.14-12.17 Audit / compliance / risk ---------------- */
  internal_auditor: {
    key: "internal_auditor",
    label: "Audit hub",
    purpose: "Independent, unlimited, read-only assurance over everything.",
    blocks: [
      { label: "Audit events (24h)", metric: "audit_events" },
      { label: "Open exceptions", metric: "exceptions" },
      { label: "Branches in scope", metric: "branches" },
      { label: "Findings open", metric: "findings" }
    ],
    workplace: "all",
    groups: [
      G("performance", "Performance", [["/performance", "Company performance", "trend"], ["/reports", "Branch performance", "branch"]]),
      G("explorers", "Explorers", [["/customers", "Customer explorer", "customers"], ["/credit", "Loan explorer", "credit"], ["/reconciliation", "Payment explorer", "money"]]),
      G("exceptions", "Exception explorer", [["/reconciliation", "Exceptions & reversals", "alert"], ["/technical", "Webhook exceptions", "activity"]]),
      G("trail", "Audit trail", [["/audit", "Audit trail", "audit"], ["/trace", "Traceability chain", "layers"]]),
      G("findings", "Findings", [["/findings", "Findings & annotations", "clipboard"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },
  audit_officer: {
    key: "audit_officer",
    label: "Audit hub (reduced)",
    purpose: "Audit fieldwork: reads everything, drafts findings for the Internal Auditor.",
    blocks: [
      { label: "Audit events (24h)", metric: "audit_events" },
      { label: "Open exceptions", metric: "exceptions" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("performance", "Performance", [["/performance", "Performance views", "trend"]]),
      G("explorers", "Explorers", [["/customers", "Customer explorer", "customers"], ["/credit", "Loan explorer", "credit"], ["/reconciliation", "Payment explorer", "money"]]),
      G("trail", "Audit trail", [["/audit", "Audit trail", "audit"]]),
      G("findings", "Findings (draft)", [["/findings", "Draft findings", "clipboard"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },
  compliance_officer: {
    key: "compliance_officer",
    label: "Compliance hub",
    purpose: "Regulatory and policy compliance oversight with remediation demands.",
    blocks: [
      { label: "Findings open", metric: "findings" },
      { label: "Branches in scope", metric: "branches" },
      { label: "Audit events (24h)", metric: "audit_events" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("policy", "Policy", [["/capability/policy_checklist", "Policy checklist", "file"]]),
      G("findings", "Compliance findings", [["/findings", "Findings & remediation", "clipboard"]]),
      G("branches", "Branch compliance", [["/branches", "Branch compliance view", "branch"], ["/performance", "Branch performance", "trend"]]),
      G("conduct", "Worker conduct", [["/people", "Worker records", "users"]]),
      G("trail", "Audit trail (read)", [["/audit", "Audit trail", "audit"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },
  risk_officer: {
    key: "risk_officer",
    label: "Risk hub",
    purpose: "Portfolio risk and control gaps.",
    blocks: [
      { label: "Portfolio at risk", metric: "portfolio_at_risk" },
      { label: "Outstanding portfolio", metric: "portfolio" },
      { label: "Branches in scope", metric: "branches" },
      { label: "Findings open", metric: "findings" }
    ],
    workplace: "all",
    groups: [
      G("portfolio", "Portfolio", [["/reports", "Portfolio at risk", "trend"], ["/credit", "Loan explorer", "credit"]]),
      G("concentration", "Concentration", [["/reports", "Concentration views", "reports"], ["/branches", "Branch risk ranking", "branch"]]),
      G("signals", "Worker risk signals", [["/performance", "Worker performance", "users"]]),
      G("gaps", "Control gaps", [["/findings", "Risk findings", "clipboard"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },

  /* ---------------- 12.18 / 12.19 Credit ---------------- */
  credit_manager: {
    key: "credit_manager",
    label: "Credit hub",
    purpose: "Credit policy, credit decisions and the credit stages of the approval chain.",
    blocks: [
      { label: "Applications pending", metric: "applications_pending" },
      { label: "Awaiting my decision", metric: "pending_approvals" },
      { label: "Disbursed this month", metric: "disbursed_month" },
      { label: "Portfolio at risk", metric: "portfolio_at_risk" }
    ],
    workplace: "all",
    groups: [
      G("applications", "Applications", [["/credit", "Application queue", "credit"], ["/approvals", "My approvals", "approvals"]]),
      G("assessment", "Credit assessment", [["/credit", "Assessments", "file"]]),
      G("catalogue", "Products and chains", [["/control", "Loan products & chains", "layers"]]),
      G("quality", "Portfolio quality", [["/reports", "Portfolio quality", "trend"]]),
      G("disbursement", "Disbursement register", [["/credit", "Disbursement register", "wallet"]]),
      G("reports", "Reports", [["/reports", "Report library", "reports"]])
    ]
  },
  credit_officer: {
    key: "credit_officer",
    label: "Credit hub (reduced)",
    purpose: "Credit assessment under the Credit Manager: assigned applications and decisions with reasons.",
    blocks: [
      { label: "Assigned applications", metric: "applications_pending" },
      { label: "Awaiting my decision", metric: "pending_approvals" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("applications", "Assigned applications", [["/credit", "My application queue", "credit"], ["/approvals", "My approvals", "approvals"]]),
      G("assessment", "Assessment", [["/credit", "Assessment forms", "file"]]),
      G("detail", "Customer & loan detail", [["/customers", "Customers", "customers"]]),
      G("reports", "Reports", [["/reports", "Reports", "reports"]])
    ]
  },

  /* ---------------- 12.20 / 12.21 Service ---------------- */
  customer_service_manager: {
    key: "customer_service_manager",
    label: "Service hub",
    purpose: "Customer service operations and escalations.",
    blocks: [
      { label: "Customers", metric: "customers" },
      { label: "Corrections open", metric: "exceptions" },
      { label: "Branches", metric: "branches" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("lookup", "Customer lookup", [["/customers", "Customer directory", "customers"]]),
      G("tickets", "Queries and tickets", [["/capability/tickets", "Tickets", "message"]]),
      G("escalations", "Escalations", [["/recovery", "Escalations", "alert"]]),
      G("refunds", "Refund requests (raise)", [["/service", "Raise correction", "receipt"]]),
      G("reports", "Reports", [["/reports", "Reports", "reports"]])
    ]
  },
  customer_service_officer: {
    key: "customer_service_officer",
    label: "Service hub (reduced)",
    purpose: "Customer queries and record support within scope.",
    blocks: [
      { label: "My branch customers", metric: "customers" },
      { label: "Corrections open", metric: "exceptions" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "own",
    groups: [
      G("lookup", "Customer lookup", [["/customers", "Customer directory", "customers"]]),
      G("tickets", "Own queue", [["/capability/tickets", "Tickets", "message"]]),
      G("records", "Profile updates", [["/customers", "Permitted fields", "edit"]]),
      G("reports", "Reports (own)", [["/reports", "Reports", "reports"]])
    ]
  },

  /* ---------------- 12.22 MIS & Reporting ---------------- */
  mis_reporting_officer: {
    key: "mis_reporting_officer",
    label: "Reporting hub",
    purpose: "Pure reporting: build, run, schedule, export.",
    blocks: [
      { label: "Reports available", metric: "reports_available" },
      { label: "Branches in reports", metric: "branches" },
      { label: "Audit events (24h)", metric: "audit_events" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "all",
    groups: [
      G("library", "Report library", [["/reports", "Run a report", "reports"]]),
      G("builder", "Report builder", [["/capability/report_builder", "Builder", "edit"]]),
      G("scheduled", "Scheduled reports", [["/capability/scheduled_reports", "Schedules", "calendar"]]),
      G("performance", "Performance views (read)", [["/performance", "Performance", "trend"]]),
      G("trail", "Audit trail (metadata)", [["/audit", "Audit trail", "audit"]])
    ]
  },

  /* ---------------- 12.23 IT & System Administrator ---------------- */
  it_system_administrator: {
    key: "it_system_administrator",
    label: "Technical hub",
    purpose: "Technical health of the tenant: providers, integrations, webhooks, sessions.",
    blocks: [
      { label: "Webhook exceptions", metric: "exceptions" },
      { label: "Providers configured", metric: "providers" },
      { label: "Notifications", metric: "unread" },
      { label: "Audit events (24h)", metric: "audit_events" }
    ],
    workplace: "all",
    groups: [
      G("providers", "Provider health", [["/providers", "Providers", "provider"], ["/technical", "Health checks", "activity"]]),
      G("webhooks", "Webhook exceptions", [["/technical", "Webhook queue", "alert"]]),
      G("integrations", "Integration settings", [["/technical", "Integration settings", "settings"]]),
      G("logs", "System logs", [["/capability/system_logs", "System logs", "file"], ["/audit", "Technical audit", "audit"]]),
      G("sessions", "Sessions", [["/capability/sessions", "Active sessions", "lock"]])
    ]
  },

  /* ---------------- 12.24-12.26 Branch / Area ---------------- */
  branch_manager: {
    key: "branch_manager",
    label: "Branch hub",
    purpose: "Runs one branch: its customers, collections, workers and day-to-day discipline.",
    blocks: [
      { label: "Collected today", metric: "collections_today" },
      { label: "Expected today", metric: "expected_today" },
      { label: "My customers", metric: "customers" },
      { label: "Pending approvals", metric: "pending_approvals" }
    ],
    workplace: "own",
    groups: [
      G("dashboard", "Branch dashboard", [["/", "Branch command", "dashboard"], ["/performance", "My branch money", "money"]]),
      G("workers", "My workers", [["/people", "Branch workers", "users"]]),
      G("groups", "Groups", [["/groups", "Branch groups", "people"]]),
      G("customers", "Customers", [["/customers", "Branch customers", "customers"]]),
      G("loans", "Loans and applications", [["/credit", "Applications", "credit"], ["/approvals", "Approvals", "approvals"]]),
      G("collections", "Collections ledger", [["/reconciliation", "Collections ledger", "clipboard"], ["/field", "Awaiting allocation", "wallet"]]),
      G("reports", "Reports", [["/reports", "Branch reports", "reports"]]),
      G("notifications", "Notifications", [["/notifications", "Notifications", "bell"]])
    ]
  },
  deputy_branch_manager: {
    key: "deputy_branch_manager",
    label: "Branch hub (delegated)",
    purpose: "Branch coverage and delegated branch duties within company limits.",
    blocks: [
      { label: "Collected today", metric: "collections_today" },
      { label: "Expected today", metric: "expected_today" },
      { label: "My customers", metric: "customers" },
      { label: "Pending approvals", metric: "pending_approvals" }
    ],
    workplace: "own",
    groups: [
      G("dashboard", "Branch dashboard", [["/", "Branch command", "dashboard"], ["/performance", "My branch money", "money"]]),
      G("workers", "Worker supervision", [["/people", "Branch workers", "users"]]),
      G("groups", "Group management", [["/groups", "Branch groups", "people"]]),
      G("customers", "Customers", [["/customers", "Branch customers", "customers"]]),
      G("loans", "Loans and applications", [["/credit", "Applications", "credit"], ["/approvals", "Approvals", "approvals"]]),
      G("reports", "Reports", [["/reports", "Branch reports", "reports"]]),
      G("notifications", "Notifications", [["/notifications", "Notifications", "bell"]])
    ]
  },
  area_manager: {
    key: "area_manager",
    label: "Area hub",
    purpose: "Oversight of a group of branches in a region.",
    blocks: [
      { label: "Branches in area", metric: "branches" },
      { label: "Collected today (area)", metric: "collections_today" },
      { label: "Pending approvals", metric: "pending_approvals" },
      { label: "Workers in area", metric: "workers" }
    ],
    workplace: "area",
    groups: [
      G("area", "Area performance", [["/performance", "Area performance", "trend"], ["/", "Area command", "dashboard"]]),
      G("branches", "Branches in area", [["/branches", "My branches", "branch"], ["/workplace", "Branch workplaces", "building"]]),
      G("workers", "Worker performance in area", [["/performance", "Staff performance", "users"]]),
      G("approvals", "Approvals", [["/approvals", "Approval inbox", "approvals"]]),
      G("reports", "Reports", [["/reports", "Area reports", "reports"]])
    ]
  },

  /* ---------------- 12.27-12.29 Field world ---------------- */
  collection_officer: {
    key: "collection_officer",
    label: "C.O. hub",
    purpose: "The field worker: registers customers, submits applications, keeps customers paying, allocates money.",
    blocks: [
      { label: "Expected today", metric: "expected_today" },
      { label: "Realised today", metric: "collections_today" },
      { label: "Collection rate", metric: "collection_rate" },
      { label: "Awaiting allocation", metric: "unallocated" }
    ],
    workplace: "none",
    groups: [
      G("today", "Today", [["/", "Today dashboard", "dashboard"], ["/performance", "My performance", "trend"]]),
      G("customers", "My Customers", [["/customers", "My customers", "customers"]]),
      G("groups", "My Groups", [["/groups", "My groups", "people"]]),
      G("register", "Register Customer", [["/customers", "Registration form", "plus"]]),
      G("application", "New Loan Application", [["/credit", "New application", "credit"]]),
      G("ledger", "Collections Ledger", [["/field", "My ledger", "clipboard"]]),
      G("allocation", "Awaiting Allocation", [["/field", "Allocation queue", "wallet"]]),
      G("performance", "My Performance", [["/performance", "Trend & ranking", "trend"]]),
      G("notifications", "Notifications", [["/notifications", "Notifications", "bell"]]),
      G("support", "Support", [["/capability/support", "Raise a query", "message"]])
    ]
  },
  senior_collection_officer: {
    key: "senior_collection_officer",
    label: "C.O. hub (senior)",
    purpose: "The same field function with light mentoring and escalation over junior officers.",
    blocks: [
      { label: "Expected today", metric: "expected_today" },
      { label: "Realised today", metric: "collections_today" },
      { label: "Team overdue cases", metric: "exceptions" },
      { label: "Awaiting allocation", metric: "unallocated" }
    ],
    workplace: "none",
    groups: [
      G("today", "Today", [["/", "Today dashboard", "dashboard"], ["/performance", "My performance", "trend"]]),
      G("team", "Team overdue cases", [["/recovery", "Junior officer overdue", "alert"]]),
      G("customers", "My Customers", [["/customers", "My customers", "customers"]]),
      G("groups", "My Groups", [["/groups", "My groups", "people"]]),
      G("register", "Register Customer", [["/customers", "Registration form", "plus"]]),
      G("application", "New Loan Application", [["/credit", "New application", "credit"]]),
      G("ledger", "Collections Ledger", [["/field", "My ledger", "clipboard"]]),
      G("allocation", "Awaiting Allocation", [["/field", "Allocation queue", "wallet"]]),
      G("notifications", "Notifications", [["/notifications", "Notifications", "bell"]])
    ]
  },
  recovery_officer: {
    key: "recovery_officer",
    label: "Recovery hub",
    purpose: "Aged-debt recovery across branches where assigned.",
    blocks: [
      { label: "My overdue cases", metric: "exceptions" },
      { label: "Escalations open", metric: "escalations" },
      { label: "Collected on cases", metric: "collections_today" },
      { label: "Notifications", metric: "unread" }
    ],
    workplace: "none",
    groups: [
      G("cases", "My overdue cases", [["/recovery", "Case list", "alert"]]),
      G("detail", "Case detail", [["/recovery", "Loans & payments (read)", "credit"]]),
      G("contact", "Contact log", [["/recovery", "Contact log", "message"]]),
      G("escalations", "Escalations", [["/recovery", "Escalations", "trend"]]),
      G("performance", "Recovery performance", [["/performance", "My performance", "trend"]]),
      G("notifications", "Notifications", [["/notifications", "Notifications", "bell"]])
    ]
  },

  /* ---------------- 12.30 Custom roles ---------------- */
  template_finance_officer: {
    key: "template_finance_officer",
    label: "Finance workspace (custom)",
    purpose: "Custom role built from the Finance Officer template: exactly the granted permissions.",
    blocks: [{ label: "Unallocated", metric: "unallocated" }, { label: "Collected today", metric: "collections_today" }],
    workplace: "all",
    groups: [
      G("money", "Money", [["/money", "Cash book", "money"], ["/reconciliation", "Reconciliation", "clipboard"]]),
      G("reports", "Reports", [["/reports", "Reports", "reports"]])
    ]
  },
  template_hr_assistant: {
    key: "template_hr_assistant",
    label: "HR workspace (custom)",
    purpose: "Custom role built from the HR Assistant template.",
    blocks: [{ label: "Workers", metric: "workers" }, { label: "Notifications", metric: "unread" }],
    workplace: "all",
    groups: [G("people", "People", [["/people", "Worker directory", "users"]]), G("performance", "Performance", [["/performance", "Staff", "trend"]])]
  },
  template_administrative_officer: {
    key: "template_administrative_officer",
    label: "Administration workspace (custom)",
    purpose: "Custom role built from the Administrative Officer template.",
    blocks: [{ label: "Branches", metric: "branches" }, { label: "Workers", metric: "workers" }],
    workplace: "all",
    groups: [G("admin", "Administration", [["/control", "Company control", "settings"], ["/branches", "Branches", "branch"]])]
  },
  template_loan_processing_officer: {
    key: "template_loan_processing_officer",
    label: "Loan processing workspace (custom)",
    purpose: "Custom role built from the Loan Processing Officer template.",
    blocks: [{ label: "Applications pending", metric: "applications_pending" }, { label: "Awaiting approvals", metric: "pending_approvals" }],
    workplace: "all",
    groups: [G("credit", "Applications", [["/credit", "Processing queue", "credit"], ["/approvals", "Approvals", "approvals"]])]
  },
  template_credit_analyst: {
    key: "template_credit_analyst",
    label: "Credit analysis workspace (custom)",
    purpose: "Custom role built from the Credit Analyst template.",
    blocks: [{ label: "Assigned applications", metric: "applications_pending" }, { label: "Portfolio at risk", metric: "portfolio_at_risk" }],
    workplace: "all",
    groups: [G("credit", "Credit", [["/credit", "Applications", "credit"], ["/reports", "Portfolio", "reports"]])]
  },
  template_operations_officer: {
    key: "template_operations_officer",
    label: "Operations workspace (custom)",
    purpose: "Custom role built from the Operations Officer template.",
    blocks: [{ label: "Branch performance", metric: "branch_performance" }, { label: "Workers", metric: "workers" }],
    workplace: "all",
    groups: [G("ops", "Operations", [["/performance", "Performance", "trend"], ["/branches", "Branches", "branch"]])]
  },
  template_portfolio_manager: {
    key: "template_portfolio_manager",
    label: "Portfolio workspace (custom)",
    purpose: "Custom role built from the Portfolio Manager template.",
    blocks: [{ label: "Portfolio outstanding", metric: "portfolio" }, { label: "Portfolio at risk", metric: "portfolio_at_risk" }],
    workplace: "all",
    groups: [G("portfolio", "Portfolio", [["/reports", "Portfolio views", "trend"], ["/credit", "Loans", "credit"]])]
  },
  template_treasury_officer: {
    key: "template_treasury_officer",
    label: "Treasury workspace (custom)",
    purpose: "Custom role built from the Treasury Officer template.",
    blocks: [{ label: "Cash position", metric: "cash_position" }, { label: "Unallocated", metric: "unallocated" }],
    workplace: "all",
    groups: [G("treasury", "Treasury", [["/money", "Cash book", "money"], ["/reconciliation", "Reconciliation", "clipboard"]])]
  },
  template_data_reporting_analyst: {
    key: "template_data_reporting_analyst",
    label: "Reporting workspace (custom)",
    purpose: "Custom role built from the Data/Reporting Analyst template.",
    blocks: [{ label: "Reports available", metric: "reports_available" }, { label: "Audit events (24h)", metric: "audit_events" }],
    workplace: "all",
    groups: [G("reporting", "Reporting", [["/reports", "Report library", "reports"], ["/performance", "Performance", "trend"]])]
  }
};

/** Fallback for a role key with no explicit descriptor (custom built roles). */
export function workspaceFor(roleKey: string | null | undefined): Workspace {
  if (roleKey && WORKSPACES[roleKey]) return WORKSPACES[roleKey]!;
  return WORKSPACES.template_operations_officer!;
}
