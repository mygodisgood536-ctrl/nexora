// Stage 7D — Accounting integration (Part 1 §21 step [9]; Part 2 §38–39).
//
// Nexora maintains standard financial statements generated automatically
// from the verified payment pipeline and the digital collection ledger.
// There is no manual entry screen anywhere; every verified payment posts
// a balanced double-entry to the company chart of accounts in the same
// transaction that records the ledger effects.
//
// Chart of accounts (per company, deterministically provisioned on first
// use, idempotent):
//   1000 Collection Account            asset      — electronic settlement account
//   1100 Loan Receivables              asset      — repayment principal collected
//   2100 Customer Savings Deposits     liability  — savings deposits owed to customers
//
// "Cash Book"/"Cash Flow" are standard accounting terminology only — Nexus
// handles no physical cash (§21 is a permanent constraint).
import type pg from "pg";

export const GL_ACCOUNT_CODES = {
  collection: "1000",
  loanReceivables: "1100",
  customerSavings: "2100",
  interestIncome: "4000",
  retainedEarnings: "3000"
} as const;

export interface ChartAccounts {
  collectionId: string;
  loanReceivablesId: string;
  customerSavingsId: string;
  interestIncomeId: string;
  retainedEarningsId: string;
}

const CHART: Array<{
  code: string;
  name: string;
  account_type: string;
  is_cash: boolean;
}> = [
  {
    code: GL_ACCOUNT_CODES.collection,
    name: "Collection Account (electronic settlement)",
    account_type: "asset",
    is_cash: true
  },
  {
    code: GL_ACCOUNT_CODES.loanReceivables,
    name: "Loan Receivables",
    account_type: "asset",
    is_cash: false
  },
  {
    code: GL_ACCOUNT_CODES.customerSavings,
    name: "Customer Savings Deposits",
    account_type: "liability",
    is_cash: false
  },
  // RULE 11.6.1 — an income statement and a financial position can only be
  // derived if the chart carries income and equity. Interest is earned as
  // principal is repaid, so it is credited to interest income; the residual is
  // retained in equity.
  {
    code: GL_ACCOUNT_CODES.retainedEarnings,
    name: "Retained Earnings",
    account_type: "equity",
    is_cash: false
  },
  {
    code: GL_ACCOUNT_CODES.interestIncome,
    name: "Interest Income",
    account_type: "income",
    is_cash: false
  }
];

/**
 * Provision the standard chart of accounts for a company. Runs inside the
 * tenant transaction so RLS scopes both the INSERT and the lookup. Safe to
 * call on every pipeline run — `ON CONFLICT (company_id, code) DO NOTHING`
 * makes it idempotent.
 */
export async function ensureChartOfAccounts(
  db: pg.PoolClient,
  companyId: string
): Promise<ChartAccounts> {
  for (const a of CHART) {
    await db.query(
      `INSERT INTO gl_accounts (company_id, code, name, account_type, is_cash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId, a.code, a.name, a.account_type, a.is_cash]
    );
  }
  const r = await db.query<{ code: string; id: string }>(
    `SELECT code, id FROM gl_accounts
      WHERE company_id=$1 AND code IN ($2, $3, $4, $5, $6)`,
    [companyId, GL_ACCOUNT_CODES.collection, GL_ACCOUNT_CODES.loanReceivables,
     GL_ACCOUNT_CODES.customerSavings, GL_ACCOUNT_CODES.retainedEarnings,
     GL_ACCOUNT_CODES.interestIncome]
  );
  const byCode = new Map<string, string>(r.rows.map((x) => [x.code, x.id]));
  const chart = {
    collectionId: byCode.get(GL_ACCOUNT_CODES.collection) ?? null,
    loanReceivablesId: byCode.get(GL_ACCOUNT_CODES.loanReceivables) ?? null,
    customerSavingsId: byCode.get(GL_ACCOUNT_CODES.customerSavings) ?? null,
    retainedEarningsId: byCode.get(GL_ACCOUNT_CODES.retainedEarnings) ?? null,
    interestIncomeId: byCode.get(GL_ACCOUNT_CODES.interestIncome) ?? null
  };
  if (!chart.collectionId || !chart.loanReceivablesId || !chart.customerSavingsId ||
      !chart.retainedEarningsId || !chart.interestIncomeId) {
    throw new Error(`chart of accounts provisioning failed for company ${companyId}`);
  }
  return chart as ChartAccounts;
}

export interface JournalPosting {
  paymentId: string;
  /** Value-date key (YYYY-MM-DD) — the provider's transaction date (§21 delayed webhooks). */
  entryDate: string;
  source: "payment_pipeline" | "reversal" | "system";
  description: string;
  createdBy: string | null;
  reversalOfEntryId?: string;
}

function fmtCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * Post the standard collection entry for one verified payment.
 *
 *   DR 1000 Collection Account   = amount received
 *   CR 1100 Loan Receivables     = principal collected (incl. cycle rollover)
 *   CR 2100 Customer Savings     = savings credited
 *   CR 4000 Interest Income      = interest recognised on this repayment
 *
 * RULE 11.6.1 — interest is income as it is earned, so recognising it here is
 * what makes an income statement derivable from the journal alone. A payment
 * that carries no interest (a pure savings top-up, or a loan with no interest)
 * simply omits the interest line; the entry stays balanced either way because
 * the caller asserts amount = principal + savings + interest.
 *
 * The entry is balanced by construction. The schema's deferred constraint
 * trigger verifies the balance at COMMIT and journal_entries/journal_lines are
 * append-only for the app role.
 */
export async function postPaymentJournal(
  db: pg.PoolClient,
  companyId: string,
  posting: JournalPosting & {
    amountCents: bigint;
    /** Principal portion — credited to Loan Receivables. */
    loanCreditCents: bigint;
    savingsCreditCents: bigint;
    /** Interest recognised on this repayment — credited to Interest Income. */
    interestCents?: bigint;
  }
): Promise<string> {
  const interestCents = posting.interestCents ?? 0n;
  if (posting.amountCents !==
      posting.loanCreditCents + posting.savingsCreditCents + interestCents) {
    throw new Error(
      `unbalanced journal source: amount/loan/savings/interest mismatch for payment ${posting.paymentId}`
    );
  }
  const chart = await ensureChartOfAccounts(db, companyId);
  const entry = await db.query<{ id: string }>(
    `INSERT INTO journal_entries
       (company_id, entry_date, description, source, payment_id,
        reversal_of_entry_id, created_by)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7)
     RETURNING id`,
    [companyId, posting.entryDate, posting.description, posting.source,
     posting.paymentId, posting.reversalOfEntryId ?? null, posting.createdBy]
  );
  const entryId = entry.rows[0]!.id;
  const lines: Array<[string, "debit" | "credit", bigint]> = [
    [chart.collectionId, "debit", posting.amountCents],
    [chart.loanReceivablesId, "credit", posting.loanCreditCents],
    [chart.customerSavingsId, "credit", posting.savingsCreditCents],
    [chart.interestIncomeId, "credit", interestCents]
  ];
  for (const [accountId, direction, amount] of lines) {
    if (amount === 0n) continue;
    await db.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, gl_account_id, direction, amount)
       VALUES ($1, $2, $3, $4, $5::numeric)`,
      [companyId, entryId, accountId, direction, fmtCents(amount)]
    );
  }
  return entryId;
}

/**
 * Post the disbursement entry (RULE 10.4.2 — the ledger is generated
 * atomically with the loan, its schedule, the virtual account and the portal
 * access).
 *
 *   DR 1100 Loan Receivables   = principal disbursed (the receivable arises)
 *   CR 1000 Collection Account = principal leaving the settlement account
 *
 * `payment_id` is NULL: a disbursement is not a provider payment, it is the
 * origination side of the same double-entry relationship. Every later
 * repayment credits the receivable back down through `postPaymentJournal`.
 */
export async function postDisbursementJournal(
  db: pg.PoolClient,
  companyId: string,
  posting: {
    entryDate: string;
    description: string;
    createdBy: string | null;
    principalCents: bigint;
  }
): Promise<string> {
  if (posting.principalCents <= 0n) {
    throw new Error("disbursement journal requires a positive principal amount");
  }
  const chart = await ensureChartOfAccounts(db, companyId);
  const entry = await db.query<{ id: string }>(
    `INSERT INTO journal_entries
       (company_id, entry_date, description, source, payment_id, created_by)
     VALUES ($1, $2::date, $3, 'system', NULL, $4)
     RETURNING id`,
    [companyId, posting.entryDate, posting.description, posting.createdBy]
  );
  const entryId = entry.rows[0]!.id;
  const lines: Array<[string, "debit" | "credit", bigint]> = [
    [chart.loanReceivablesId, "debit", posting.principalCents],
    [chart.collectionId, "credit", posting.principalCents]
  ];
  for (const [accountId, direction, amount] of lines) {
    if (amount === 0n) continue;
    await db.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, gl_account_id, direction, amount)
       VALUES ($1, $2, $3, $4, $5::numeric)`,
      [companyId, entryId, accountId, direction, fmtCents(amount)]
    );
  }
  return entryId;
}

/**
 * Reversal accounting (§21): create a linked reversal entry that mirrors the
 * original — every line's debit/credit is swapped — and points back at it via
 * `reversal_of_entry_id`. The original entry is never edited or deleted.
 */
export async function postReversalJournal(
  db: pg.PoolClient,
  companyId: string,
  posting: JournalPosting & {
    originalEntryId: string;
  }
): Promise<string> {
  const lines = await db.query<{ gl_account_id: string; direction: string; amount: string }>(
    `SELECT gl_account_id, direction, amount FROM journal_lines
      WHERE journal_entry_id=$1`,
    [posting.originalEntryId]
  );
  if ((lines.rowCount ?? 0) === 0) {
    throw new Error(
      `cannot reverse: original journal entry ${posting.originalEntryId} has no lines`
    );
  }
  const entry = await db.query<{ id: string }>(
    `INSERT INTO journal_entries
       (company_id, entry_date, description, source, payment_id,
        reversal_of_entry_id, created_by)
     VALUES ($1, $2::date, $3, 'reversal', $4, $5, $6)
     RETURNING id`,
    [companyId, posting.entryDate, posting.description, posting.paymentId,
     posting.originalEntryId, posting.createdBy]
  );
  const entryId = entry.rows[0]!.id;
  for (const ln of lines.rows) {
    await db.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, gl_account_id, direction, amount)
       VALUES ($1, $2, $3, $4, $5::numeric)`,
      [companyId, entryId, ln.gl_account_id,
       ln.direction === "debit" ? "credit" : "debit", ln.amount]
    );
  }
  return entryId;
}