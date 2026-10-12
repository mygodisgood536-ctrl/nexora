## 4. Every role, one by one

Thirty-eight workspaces exist: 29 live roles plus 9 custom-role templates. Each is written out separately below, with its landing summary, its navigation groups, the pages inside each group, the actions it offers, the actions it must never offer, and the Branch Workplace rule that applies to it. Naming is taken directly from the built navigation model, so every page listed here exists in the product.

### 4.1 MD Board `md`

**Purpose.** Owns the company; sees everything, decides everything, authorises at the end of any chain.

**Landing summary.** Portfolio outstanding · Collected today · Pending approvals · Branches live

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Command**
  - Command dashboard `/`
  - Performance `/performance`
  - Reports `/reports`
- **Money**
  - Money & ledger `/money`
  - Reconciliation `/reconciliation`
  - End of day `/eod`
- **Branches**
  - Branch registry `/branches`
  - Branch workplace `/workplace`
- **People**
  - Workers `/people`
  - Roles & control `/control`
- **Customers**
  - Customers `/customers`
  - Groups `/groups`
- **Credit**
  - Applications & credit `/credit`
  - Approvals `/approvals`
- **Providers**
  - Payment providers `/providers`
  - Webhooks & health `/technical`
- **Approvals**
  - Approval inbox `/approvals`
- **Audit**
  - Audit trail `/audit`
- **Control**
  - Company control `/control`
  - Findings `/capability/findings`
- **Reports**
  - Report library `/reports`
  - Performance views `/performance`

### 4.2 Deputy MD Board `deputy_md`

**Purpose.** The MD's stand-in; the same board, with Control read-only unless the MD delegates a specific change.

**Landing summary.** Portfolio outstanding · Collected today · Pending approvals · Branches live

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Command**
  - Command dashboard `/`
  - Performance `/performance`
  - Reports `/reports`
- **Money**
  - Money & ledger `/money`
  - Reconciliation `/reconciliation`
- **Branches**
  - Branch registry `/branches`
  - Branch workplace `/workplace`
- **People**
  - Workers `/people`
  - Roles & control (read) `/control`
- **Customers**
  - Customers `/customers`
  - Groups `/groups`
- **Credit**
  - Applications & credit `/credit`
  - Approvals `/approvals`
- **Providers**
  - Payment providers `/providers`
- **Audit**
  - Audit trail `/audit`
- **Reports**
  - Report library `/reports`

### 4.3 Operations hub `gm`

**Purpose.** Runs day-to-day operations; normally a mid-chain or final approver.

**Landing summary.** Branch performance · Pending approvals · Workers active · Collected today

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Branch performance**
  - Performance views `/performance`
  - Branches `/branches`
  - Branch workplace `/workplace`
- **Workers**
  - Worker directory `/people`
- **Approvals**
  - Approval inbox `/approvals`
  - Applications `/credit`
- **Credit**
  - Applications & credit `/credit`
- **Providers**
  - Payment providers `/providers`
- **Reports**
  - Report library `/reports`
- **Audit**
  - Audit trail `/audit`

### 4.4 Operations hub (Assistant) `assistant_gm`

**Purpose.** Operational coverage for the GM: views everything the GM views, acts only where the chain includes this role.

**Landing summary.** Branch performance · Pending approvals · Workers active · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Branch performance**
  - Performance views `/performance`
  - Branches `/branches`
  - Branch workplace `/workplace`
- **Workers**
  - Worker directory `/people`
- **Approvals**
  - Approval inbox `/approvals`
- **Credit**
  - Applications `/credit`
- **Providers**
  - Payment providers (view) `/providers`
- **Reports**
  - Report library `/reports`
- **Audit**
  - Audit trail `/audit`

### 4.5 Operations hub `operations_manager`

**Purpose.** Process, branch operations and service levels.

**Landing summary.** Branch operations · Process exceptions · Workers in branch scope · Pending approvals

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Branch operations**
  - Branch registry `/branches`
  - Branch workplace `/workplace`
  - Performance `/performance`
- **Process exceptions**
  - Exceptions queue `/reconciliation`
  - Webhook exceptions `/technical`
- **Workers (branch)**
  - Worker directory `/people`
- **Approvals**
  - Approval inbox `/approvals`
- **Reports**
  - Report library `/reports`

### 4.6 Operations hub (Assistant) `assistant_operations_manager`

**Purpose.** Operations support: branch inspection and process exception follow-up, minus configuration surfaces.

**Landing summary.** Branch operations · Process exceptions · Workers in branch scope · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Branch operations**
  - Branches (view) `/branches`
  - Branch workplace `/workplace`
  - Performance `/performance`
- **Process exceptions**
  - Exceptions queue `/reconciliation`
- **Workers (branch)**
  - Worker directory `/people`
- **Approvals**
  - Approval inbox `/approvals`
- **Reports**
  - Report library `/reports`

### 4.7 Administration hub `head_office_administrator`

**Purpose.** Executes the company's configuration day to day: profile, branding, roles, branches.

**Landing summary.** Roles enabled · Branches · Workers · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Company**
  - Company profile & branding `/control`
  - Roles `/control`
- **Branches**
  - Branch registry `/branches`
- **Workers**
  - Workers (view) `/people`
- **Providers (view)**
  - Payment providers `/providers`
- **Reports**
  - Report library `/reports`

### 4.8 Finance hub `finance_manager`

**Purpose.** The truth of money: reconciliation, exceptions, reversals, settlements, statements.

**Landing summary.** Unallocated payments · Unmatched items · Collected today · Exceptions open

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Reconciliation**
  - Settlement matching `/reconciliation`
  - Cash book `/money`
- **Exceptions**
  - Exceptions queue `/reconciliation`
  - Webhook exceptions `/technical`
- **Reversals**
  - Corrections & reversals `/reconciliation`
- **Settlements**
  - Settlement view `/money`
  - Provider status `/providers`
- **Statements**
  - Statements & ledger `/money`
  - Reports `/reports`
- **Provider status**
  - Payment providers `/providers`
- **Reports**
  - Report library `/reports`

### 4.9 Accounting hub `accountant`

**Purpose.** Postings, statements and schedules from the verified data.

**Landing summary.** Trial balance · Cash position · Collected today · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Ledger**
  - General ledger `/money`
  - Trial balance `/money`
- **Schedules**
  - Cash flow & schedules `/money`
- **Statements**
  - Income statement & position `/money`
  - Reports `/reports`
- **Reconciliation (assist)**
  - Reconciliation view `/reconciliation`
- **Reports**
  - Report library `/reports`

### 4.10 Accounting hub (reduced) `assistant_accountant`

**Purpose.** Accounting support: prepare schedules, view the ledger, assist reconciliation.

**Landing summary.** Trial balance · Cash position · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Ledger (view)**
  - General ledger `/money`
- **Schedules**
  - Cash flow & schedules `/money`
- **Statements (assist)**
  - Statements `/money`
- **Reconciliation (assist)**
  - Reconciliation view `/reconciliation`
- **Reports**
  - Report library `/reports`

### 4.11 Reconciliation hub `cash_bank_reconciliation_officer`

**Purpose.** Matches provider settlements to internal records and triages exceptions before Finance sees them.

**Landing summary.** Unmatched settlements · Unallocated · Exceptions open · Collected today

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Settlement matching**
  - Matching queue `/reconciliation`
- **Exceptions**
  - Exceptions queue `/reconciliation`
- **Provider statements**
  - Provider statements `/providers`
  - Cash book `/money`
- **Reports**
  - Reconciliation reports `/reports`

### 4.12 HR hub `hr_manager`

**Purpose.** Owns the workforce: who is here, how they perform, what happens to their seats.

**Landing summary.** Workers · Active today · Role assignments open · Branches

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **People**
  - Worker directory `/people`
  - Create worker `/people`
  - Account controls `/people`
- **Role assignments**
  - Assignments `/people`
  - Role catalogue `/control`
- **Worker performance**
  - Staff performance `/performance`
- **Organisation performance**
  - Company & branch performance `/performance`
  - Reports `/reports`

### 4.13 HR hub (reduced) `hr_officer`

**Purpose.** HR operations under the HR Manager: records, attendance and performance views.

**Landing summary.** Workers · Active today · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **People**
  - Worker directory `/people`
  - Create worker (where granted) `/people`
- **Records**
  - Worker records `/people`
- **Worker performance (view)**
  - Staff performance `/performance`

### 4.14 Audit hub `internal_auditor`

**Purpose.** Independent, unlimited, read-only assurance over everything.

**Landing summary.** Audit events (24h) · Open exceptions · Branches in scope · Findings open

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Performance**
  - Company performance `/performance`
  - Branch performance `/reports`
- **Explorers**
  - Customer explorer `/customers`
  - Loan explorer `/credit`
  - Payment explorer `/reconciliation`
- **Exception explorer**
  - Exceptions & reversals `/reconciliation`
  - Webhook exceptions `/technical`
- **Audit trail**
  - Audit trail `/audit`
  - Traceability chain `/trace`
- **Findings**
  - Findings & annotations `/capability/findings`
- **Reports**
  - Report library `/reports`

### 4.15 Audit hub (reduced) `audit_officer`

**Purpose.** Audit fieldwork: reads everything, drafts findings for the Internal Auditor.

**Landing summary.** Audit events (24h) · Open exceptions · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Performance**
  - Performance views `/performance`
- **Explorers**
  - Customer explorer `/customers`
  - Loan explorer `/credit`
  - Payment explorer `/reconciliation`
- **Audit trail**
  - Audit trail `/audit`
- **Findings (draft)**
  - Draft findings `/capability/findings`
- **Reports**
  - Report library `/reports`

### 4.16 Compliance hub `compliance_officer`

**Purpose.** Regulatory and policy compliance oversight with remediation demands.

**Landing summary.** Findings open · Branches in scope · Audit events (24h) · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Policy**
  - Policy checklist `/capability/policy_checklist`
- **Compliance findings**
  - Findings & remediation `/capability/findings`
- **Branch compliance**
  - Branch compliance view `/branches`
  - Branch performance `/performance`
- **Worker conduct**
  - Worker records `/people`
- **Audit trail (read)**
  - Audit trail `/audit`
- **Reports**
  - Report library `/reports`

### 4.17 Risk hub `risk_officer`

**Purpose.** Portfolio risk and control gaps.

**Landing summary.** Portfolio at risk · Outstanding portfolio · Branches in scope · Findings open

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Portfolio**
  - Portfolio at risk `/reports`
  - Loan explorer `/credit`
- **Concentration**
  - Concentration views `/reports`
  - Branch risk ranking `/branches`
- **Worker risk signals**
  - Worker performance `/performance`
- **Control gaps**
  - Risk findings `/capability/findings`
- **Reports**
  - Report library `/reports`

### 4.18 Credit hub `credit_manager`

**Purpose.** Credit policy, credit decisions and the credit stages of the approval chain.

**Landing summary.** Applications pending · Awaiting my decision · Disbursed this month · Portfolio at risk

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Applications**
  - Application queue `/credit`
  - My approvals `/approvals`
- **Credit assessment**
  - Assessments `/credit`
- **Products and chains**
  - Loan products & chains `/control`
- **Portfolio quality**
  - Portfolio quality `/reports`
- **Disbursement register**
  - Disbursement register `/credit`
- **Reports**
  - Report library `/reports`

### 4.19 Credit hub (reduced) `credit_officer`

**Purpose.** Credit assessment under the Credit Manager: assigned applications and decisions with reasons.

**Landing summary.** Assigned applications · Awaiting my decision · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Assigned applications**
  - My application queue `/credit`
  - My approvals `/approvals`
- **Assessment**
  - Assessment forms `/credit`
- **Customer & loan detail**
  - Customers `/customers`
- **Reports**
  - Reports `/reports`

### 4.20 Service hub `customer_service_manager`

**Purpose.** Customer service operations and escalations.

**Landing summary.** Customers · Corrections open · Branches · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Customer lookup**
  - Customer directory `/customers`
- **Queries and tickets**
  - Tickets `/capability/tickets`
- **Escalations**
  - Escalations `/recovery`
- **Refund requests (raise)**
  - Raise correction `/service`
- **Reports**
  - Reports `/reports`

### 4.21 Service hub (reduced) `customer_service_officer`

**Purpose.** Customer queries and record support within scope.

**Landing summary.** My branch customers · Corrections open · Notifications

**Branch Workplace.** His own branch's records only.

**Navigation groups.**

- **Customer lookup**
  - Customer directory `/customers`
- **Own queue**
  - Tickets `/capability/tickets`
- **Profile updates**
  - Permitted fields `/customers`
- **Reports (own)**
  - Reports `/reports`

### 4.22 Reporting hub `mis_reporting_officer`

**Purpose.** Pure reporting: build, run, schedule, export.

**Landing summary.** Reports available · Branches in reports · Audit events (24h) · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Report library**
  - Run a report `/reports`
- **Report builder**
  - Builder `/capability/report_builder`
- **Scheduled reports**
  - Schedules `/capability/scheduled_reports`
- **Performance views (read)**
  - Performance `/performance`
- **Audit trail (metadata)**
  - Audit trail `/audit`

### 4.23 Technical hub `it_system_administrator`

**Purpose.** Technical health of the tenant: providers, integrations, webhooks, sessions.

**Landing summary.** Webhook exceptions · Providers configured · Notifications · Audit events (24h)

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Provider health**
  - Providers `/providers`
  - Health checks `/technical`
- **Webhook exceptions**
  - Webhook queue `/technical`
- **Integration settings**
  - Integration settings `/technical`
- **System logs**
  - System logs `/capability/system_logs`
  - Technical audit `/audit`
- **Sessions**
  - Active sessions `/capability/sessions`

### 4.24 Branch hub `branch_manager`

**Purpose.** Runs one branch: its customers, collections, workers and day-to-day discipline.

**Landing summary.** Collected today · Expected today · My customers · Pending approvals

**Branch Workplace.** His own branch's records only.

**Navigation groups.**

- **Branch dashboard**
  - Branch command `/`
  - My branch money `/performance`
- **My workers**
  - Branch workers `/people`
- **Groups**
  - Branch groups `/groups`
- **Customers**
  - Branch customers `/customers`
- **Loans and applications**
  - Applications `/credit`
  - Approvals `/approvals`
- **Collections ledger**
  - Collections ledger `/reconciliation`
  - Awaiting allocation `/field`
- **Reports**
  - Branch reports `/reports`
- **Notifications**
  - Notifications `/notifications`

### 4.25 Branch hub (delegated) `deputy_branch_manager`

**Purpose.** Branch coverage and delegated branch duties within company limits.

**Landing summary.** Collected today · Expected today · My customers · Pending approvals

**Branch Workplace.** His own branch's records only.

**Navigation groups.**

- **Branch dashboard**
  - Branch command `/`
  - My branch money `/performance`
- **Worker supervision**
  - Branch workers `/people`
- **Group management**
  - Branch groups `/groups`
- **Customers**
  - Branch customers `/customers`
- **Loans and applications**
  - Applications `/credit`
  - Approvals `/approvals`
- **Reports**
  - Branch reports `/reports`
- **Notifications**
  - Notifications `/notifications`

### 4.26 Area hub `area_manager`

**Purpose.** Oversight of a group of branches in a region.

**Landing summary.** Branches in area · Collected today (area) · Pending approvals · Workers in area

**Branch Workplace.** Every branch inside his area only.

**Navigation groups.**

- **Area performance**
  - Area performance `/performance`
  - Area command `/`
- **Branches in area**
  - My branches `/branches`
  - Branch workplaces `/workplace`
- **Worker performance in area**
  - Staff performance `/performance`
- **Approvals**
  - Approval inbox `/approvals`
- **Reports**
  - Area reports `/reports`

### 4.27 C.O. hub `collection_officer`

**Purpose.** The field worker: registers customers, submits applications, keeps customers paying, allocates money.

**Landing summary.** Expected today · Realised today · Collection rate · Awaiting allocation

**Branch Workplace.** None. A branch worker never enters the Branch Workplace (prohibition 16).

**Navigation groups.**

- **Today**
  - Today dashboard `/`
  - My performance `/performance`
- **My Customers**
  - My customers `/customers`
- **My Groups**
  - My groups `/groups`
- **Register Customer**
  - Registration form `/customers`
- **New Loan Application**
  - New application `/credit`
- **Collections Ledger**
  - My ledger `/field`
- **Awaiting Allocation**
  - Allocation queue `/field`
- **My Performance**
  - Trend & ranking `/performance`
- **Notifications**
  - Notifications `/notifications`
- **Support**
  - Raise a query `/capability/support`

### 4.28 C.O. hub (senior) `senior_collection_officer`

**Purpose.** The same field function with light mentoring and escalation over junior officers.

**Landing summary.** Expected today · Realised today · Team overdue cases · Awaiting allocation

**Branch Workplace.** None. A branch worker never enters the Branch Workplace (prohibition 16).

**Navigation groups.**

- **Today**
  - Today dashboard `/`
  - My performance `/performance`
- **Team overdue cases**
  - Junior officer overdue `/recovery`
- **My Customers**
  - My customers `/customers`
- **My Groups**
  - My groups `/groups`
- **Register Customer**
  - Registration form `/customers`
- **New Loan Application**
  - New application `/credit`
- **Collections Ledger**
  - My ledger `/field`
- **Awaiting Allocation**
  - Allocation queue `/field`
- **Notifications**
  - Notifications `/notifications`

### 4.29 Recovery hub `recovery_officer`

**Purpose.** Aged-debt recovery across branches where assigned.

**Landing summary.** My overdue cases · Escalations open · Collected on cases · Notifications

**Branch Workplace.** None. A branch worker never enters the Branch Workplace (prohibition 16).

**Navigation groups.**

- **My overdue cases**
  - Case list `/recovery`
- **Case detail**
  - Loans & payments (read) `/recovery`
- **Contact log**
  - Contact log `/recovery`
- **Escalations**
  - Escalations `/recovery`
- **Recovery performance**
  - My performance `/performance`
- **Notifications**
  - Notifications `/notifications`

### 4.30 Custom-role templates `template_*`

A company may enable a custom role built from one of these templates. Each template is a starting navigation set that the company's administrator then adjusts. Templates are not separate people and must not be given screens of their own beyond what is listed.

- **Finance workspace (custom)** `template_finance_officer` — Custom role built from the Finance Officer template: exactly the granted permissions.
  - Cash book `/money`
  - Reconciliation `/reconciliation`
  - Reports `/reports`
- **HR workspace (custom)** `template_hr_assistant` — Custom role built from the HR Assistant template.
  - Worker directory `/people`
  - Staff `/performance`
- **Administration workspace (custom)** `template_administrative_officer` — Custom role built from the Administrative Officer template.
  - Company control `/control`
  - Branches `/branches`
- **Loan processing workspace (custom)** `template_loan_processing_officer` — Custom role built from the Loan Processing Officer template.
  - Processing queue `/credit`
  - Approvals `/approvals`
- **Credit analysis workspace (custom)** `template_credit_analyst` — Custom role built from the Credit Analyst template.
  - Applications `/credit`
  - Portfolio `/reports`
- **Operations workspace (custom)** `template_operations_officer` — Custom role built from the Operations Officer template.
  - Performance `/performance`
  - Branches `/branches`
- **Portfolio workspace (custom)** `template_portfolio_manager` — Custom role built from the Portfolio Manager template.
  - Portfolio views `/reports`
  - Loans `/credit`
- **Treasury workspace (custom)** `template_treasury_officer` — Custom role built from the Treasury Officer template.
  - Cash book `/money`
  - Reconciliation `/reconciliation`
- **Reporting workspace (custom)** `template_data_reporting_analyst` — Custom role built from the Data/Reporting Analyst template.
  - Report library `/reports`
  - Performance `/performance`

