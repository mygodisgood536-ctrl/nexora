// Stage 7E — Accounting statements (Part 1 §21 step [9]; Part 2 §38–39).
//
// The payment pipeline already posts balanced double-entry records to the
// tenant chart of accounts (payments/accounting.ts). This module is the
// read surface: General Ledger, Trial Balance, Cash Book, and Cash Flow
// Statement — all derived exclusively from journal data, never from a
// manually maintained figure. "Cash Book"/"Cash Flow" are standard
// accounting terms only: Nexora handles no physical cash (§21 permanent
// constraint); the cash accounts are the verified electronic settlement
// account.
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export interface StatementActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface GlAccountInfo {
  code: string;
  name: string;
  accountType: string;
  isCash: boolean;
}

export interface LedgerItem {
  id: string;
  entryDate: string;
  description: string | null;
  source: string;
  paymentRef: string | null;
  glAccount: GlAccountInfo;
  direction: "debit" | "credit";
  amount: string;
  /** Running (debits − credits) balance on this account at this line. */
  runningBalance: string;
}

export interface LedgerFilter {
  from?: string | null;
  to?: string | null;
  accountCode?: string | null;
  limit?: number;
  offset?: number;
}

interface LedgerLineRow {
  id: string;
  entry_date: string;
  description: string | null;
  source: string;
  payment_ref: string | null;
  gl_code: string;
  gl_name: string;
  gl_account_type: string;
  gl_is_cash: boolean;
  direction: "debit" | "credit";
  amount: string;
}

function fmt2(v: string | null | undefined): string {
  if (v === null || v === undefined) return "0.00";
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

interface SumRow {
  debits: string;
  credits: string;
}

function dirSum(rows: SumRow | undefined): { debits: string; credits: string; balance: string } {
  const debits = fmt2(rows?.debits);
  const credits = fmt2(rows?.credits);
  return { debits, credits, balance: fmt2(String(Number(debits) - Number(credits))) };
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  accountType: string;
  isCash: boolean;
  debits: string;
  credits: string;
  /** signed debits − credits */
  balance: string;
}

interface TrialBalanceRawRow extends SumRow {
  code: string;
  name: string;
  account_type: string;
  is_cash: boolean;
}

export async function getTrialBalance(
  actor: StatementActor,
  asOf: string
): Promise<{
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebits: string;
  totalCredits: string;
  balanced: boolean;
}> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<TrialBalanceRawRow>(
      `SELECT ga.code, ga.name, ga.account_type, ga.is_cash,
              COALESCE(SUM(jl.amount) FILTER (WHERE jl.direction='debit'),0)::text AS debits,
              COALESCE(SUM(jl.amount) FILTER (WHERE jl.direction='credit'),0)::text AS credits
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN gl_accounts ga ON ga.id = jl.gl_account_id
        WHERE (je.entry_date <= $1::date)
        GROUP BY ga.code, ga.name, ga.account_type, ga.is_cash
        ORDER BY ga.code`,
      [asOf]
    );
    const raw = r.rows;
    const rows = raw.map((row) => {
      const summed = dirSum(row);
      return {
        code: row.code,
        name: row.name,
        accountType: row.account_type,
        isCash: row.is_cash,
        ...summed
      };
    });
    const totalDebits = fmt2(String(raw.reduce((sum, row) => sum + Number(row.debits), 0)));
    const totalCredits = fmt2(String(raw.reduce((sum, row) => sum + Number(row.credits), 0)));
    return {
      asOf,
      rows,
      totalDebits,
      totalCredits,
      balanced: totalDebits === totalCredits
    };
  });
}

export async function getGeneralLedger(
  actor: StatementActor,
  filter: LedgerFilter = {}
): Promise<{
  items: LedgerItem[];
  accounts: Array<{ glAccount: GlAccountInfo; debits: string; credits: string; balance: string }>;
  totals: { debits: string; credits: string; balance: string };
}> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.from) {
    conditions.push(`je.entry_date >= $${params.length + 1}::date`);
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push(`je.entry_date <= $${params.length + 1}::date`);
    params.push(filter.to);
  }
  if (filter.accountCode) {
    conditions.push(`ga.code = $${params.length + 1}`);
    params.push(filter.accountCode);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const rows = await db.query<LedgerLineRow>(
      `SELECT jl.id, to_char(je.entry_date,'YYYY-MM-DD') AS entry_date,
              je.description, je.source, p.provider_txn_ref AS payment_ref,
              ga.code AS gl_code, ga.name AS gl_name, ga.account_type AS gl_account_type,
              ga.is_cash AS gl_is_cash, jl.direction, jl.amount::text
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN gl_accounts ga ON ga.id = jl.gl_account_id
         LEFT JOIN payments p ON p.id = je.payment_id
         ${where}
        ORDER BY je.entry_date ASC, je.created_at ASC, jl.id ASC
        LIMIT 2000`,
      params
    );

    const runningPerAccount = new Map<string, number>();
    const perAccount: Map<string, { code: string; name: string; accountType: string; isCash: boolean; debits: number; credits: number }> = new Map();
    const items: LedgerItem[] = rows.rows.map((row) => {
      const key = row.gl_code;
      const acc = perAccount.get(key) ?? {
        code: row.gl_code,
        name: row.gl_name,
        accountType: row.gl_account_type,
        isCash: row.gl_is_cash,
        debits: 0,
        credits: 0
      };
      const amount = Number(row.amount);
      if (row.direction === "debit") acc.debits += amount;
      else acc.credits += amount;
      perAccount.set(key, acc);
      const running = (runningPerAccount.get(key) ?? 0) + (row.direction === "debit" ? amount : -amount);
      runningPerAccount.set(key, running);
      return {
        id: row.id,
        entryDate: row.entry_date,
        description: row.description,
        source: row.source,
        paymentRef: row.payment_ref,
        glAccount: { code: row.gl_code, name: row.gl_name, accountType: row.gl_account_type, isCash: row.gl_is_cash },
        direction: row.direction,
        amount: fmt2(row.amount),
        runningBalance: fmt2(String(running))
      };
    });

    const accounts = [...perAccount.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => ({
        glAccount: { code: a.code, name: a.name, accountType: a.accountType, isCash: a.isCash },
        debits: fmt2(String(a.debits)),
        credits: fmt2(String(a.credits)),
        balance: fmt2(String(a.debits - a.credits))
      }));
    const totals = {
      debits: fmt2(String(accounts.reduce((sum, a) => sum + Number(a.debits), 0))),
      credits: fmt2(String(accounts.reduce((sum, a) => sum + Number(a.credits), 0))),
      balance: fmt2(String(items.reduce((sum, i) => sum + Number(i.runningBalance), 0)))
    };
    return { items, accounts, totals };
  });
}

interface CashBookRow {
  id: string;
  entry_date: string;
  description: string | null;
  source: string;
  payment_ref: string | null;
  gl_code: string;
  gl_name: string;
  gl_account_type: string;
  gl_is_cash: boolean;
  direction: "debit" | "credit";
  amount: string;
}

export async function getCashBook(
  actor: StatementActor,
  filter: { from?: string | null; to?: string | null } = {}
): Promise<{
  items: Array<{
    id: string;
    entryDate: string;
    description: string | null;
    source: string;
    paymentRef: string | null;
    glAccount: GlAccountInfo;
    direction: "debit" | "credit";
    amount: string;
  }>;
  inflows: string;
  outflows: string;
  net: string;
}> {
  const conditions: string[] = ["ga.is_cash = TRUE"];
  const params: unknown[] = [];
  if (filter.from) {
    conditions.push(`je.entry_date >= $${params.length + 1}::date`);
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push(`je.entry_date <= $${params.length + 1}::date`);
    params.push(filter.to);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const rows = await db.query<CashBookRow>(
      `SELECT jl.id, to_char(je.entry_date,'YYYY-MM-DD') AS entry_date,
              je.description, je.source, p.provider_txn_ref AS payment_ref,
              ga.code AS gl_code, ga.name AS gl_name, ga.account_type AS gl_account_type,
              ga.is_cash AS gl_is_cash,
              jl.direction, jl.amount::text
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN gl_accounts ga ON ga.id = jl.gl_account_id
         LEFT JOIN payments p ON p.id = je.payment_id
         ${where}
        ORDER BY je.entry_date ASC, je.created_at ASC, jl.id ASC`,
      params
    );
    let inflows = 0;
    let outflows = 0;
    const items = rows.rows.map((row) => {
      const amount = Number(row.amount);
      if (row.direction === "debit") inflows += amount;
      else outflows += amount;
      return {
        id: row.id,
        entryDate: row.entry_date,
        description: row.description,
        source: row.source,
        paymentRef: row.payment_ref,
        glAccount: { code: row.gl_code, name: row.gl_name, accountType: row.gl_account_type, isCash: row.gl_is_cash },
        direction: row.direction,
        amount: fmt2(row.amount)
      };
    });
    return {
      items,
      inflows: fmt2(String(inflows)),
      outflows: fmt2(String(outflows)),
      net: fmt2(String(inflows - outflows))
    };
  });
}

interface CashFlowRow {
  source: string;
  direction: "debit" | "credit";
  is_cash: boolean;
  amount: string;
}

export async function getCashFlowStatement(
  actor: StatementActor,
  filter: { from?: string | null; to?: string | null } = {}
): Promise<{
  from: string | null;
  to: string | null;
  openingBalance: string;
  closingBalance: string;
  netCashFlow: string;
  categories: Array<{ source: string; inflows: string; outflows: string; net: string }>;
  totals: { inflows: string; outflows: string };
}> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    if (filter.from) {
      const f = new Date(`${filter.from}T00:00:00Z`);
      if (Number.isNaN(f.getTime())) throw AppError.unprocessable("invalid from date");
    }
    if (filter.to) {
      const t = new Date(`${filter.to}T00:00:00Z`);
      if (Number.isNaN(t.getTime())) throw AppError.unprocessable("invalid to date");
    }
    const period = await db.query<CashFlowRow>(
      `SELECT je.source, jl.direction, ga.is_cash, jl.amount::text
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN gl_accounts ga ON ga.id = jl.gl_account_id
        WHERE ga.is_cash = TRUE
          AND ($1::date IS NULL OR je.entry_date >= $1::date)
          AND ($2::date IS NULL OR je.entry_date <= $2::date)`,
      [filter.from ?? null, filter.to ?? null]
    );
    const opening = await db.query<{ net: string }>(
      `SELECT COALESCE(SUM(
         CASE WHEN jl.direction='debit' THEN jl.amount ELSE -jl.amount END),0)::text AS net
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN gl_accounts ga ON ga.id = jl.gl_account_id
        WHERE ga.is_cash = TRUE
          AND ($1::date IS NOT NULL AND je.entry_date < $1::date)`,
      [filter.from ?? null]
    );

    const map = new Map<string, { inflows: number; outflows: number }>();
    for (const row of period.rows) {
      const entry = map.get(row.source) ?? { inflows: 0, outflows: 0 };
      const amount = Number(row.amount);
      if (row.direction === "debit") entry.inflows += amount;
      else entry.outflows += amount;
      map.set(row.source, entry);
    }
    const categories = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([source, v]) => ({
        source,
        inflows: fmt2(String(v.inflows)),
        outflows: fmt2(String(v.outflows)),
        net: fmt2(String(v.inflows - v.outflows))
      }));
    const totals = {
      inflows: fmt2(String(categories.reduce((sum, c) => sum + Number(c.inflows), 0))),
      outflows: fmt2(String(categories.reduce((sum, c) => sum + Number(c.outflows), 0)))
    };
    const openingBalance = fmt2(opening.rows[0]?.net);
    const closingBalance = fmt2(String(Number(openingBalance) + Number(totals.inflows) - Number(totals.outflows)));
    return {
      from: filter.from ?? null,
      to: filter.to ?? null,
      openingBalance,
      closingBalance,
      netCashFlow: fmt2(String(Number(totals.inflows) - Number(totals.outflows))),
      categories,
      totals
    };
  });
}

/**
 * RULE 11.6.1 — the Income Statement, derived exclusively from the journal.
 * Nothing is keyed in: every figure is the sum of posted journal lines for the
 * period, classified by the account's own type. Income is a credit balance;
 * expenses are a debit balance.
 */
export async function getIncomeStatement(
  actor: StatementActor,
  filter: { from?: string | null; to?: string | null } = {}
): Promise<{
  from: string | null;
  to: string | null;
  income: Array<{ code: string; name: string; amount: string }>;
  expenses: Array<{ code: string; name: string; amount: string }>;
  totalIncome: string;
  totalExpenses: string;
  netSurplus: string;
}> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<{ code: string; name: string; account_type: string; amount: string }>(
      `SELECT ga.code, ga.name, ga.account_type,
              COALESCE(SUM(
                CASE WHEN jl.direction = 'credit' THEN jl.amount
                     WHEN jl.direction = 'debit' THEN -jl.amount END
              ), 0)::text AS amount
         FROM gl_accounts ga
         LEFT JOIN (
           SELECT jl.gl_account_id, jl.direction, jl.amount
             FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.journal_entry_id
            WHERE ($1::date IS NULL OR je.entry_date >= $1::date)
              AND ($2::date IS NULL OR je.entry_date <= $2::date)
         ) jl ON jl.gl_account_id = ga.id
        WHERE ga.account_type IN ('income','expense')
        GROUP BY ga.code, ga.name, ga.account_type
        ORDER BY ga.code`,
      [filter.from ?? null, filter.to ?? null]
    );
    const income = r.rows
      .filter((x) => x.account_type === "income")
      .map((x) => ({ code: x.code, name: x.name, amount: fmt2(x.amount) }));
    const expenses = r.rows
      .filter((x) => x.account_type === "expense")
      .map((x) => ({ code: x.code, name: x.name, amount: fmt2(x.amount) }));
    const totalIncome = fmt2(String(income.reduce((s, x) => s + Number(x.amount), 0)));
    const totalExpenses = fmt2(String(expenses.reduce((s, x) => s + Number(x.amount), 0)));
    return {
      from: filter.from ?? null,
      to: filter.to ?? null,
      income,
      expenses,
      totalIncome,
      totalExpenses,
      netSurplus: fmt2(String(Number(totalIncome) - Number(totalExpenses)))
    };
  });
}

/**
 * RULE 11.6.1 — the Financial Position (balance sheet) as at the `to` date,
 * derived from cumulative posted balances. Assets and expenses carry debit
 * balances; liabilities, equity and income carry credit balances.
 */
export async function getFinancialPosition(
  actor: StatementActor,
  filter: { from?: string | null; to?: string | null } = {}
): Promise<{
  asAt: string | null;
  assets: Array<{ code: string; name: string; amount: string }>;
  liabilities: Array<{ code: string; name: string; amount: string }>;
  equity: Array<{ code: string; name: string; amount: string }>;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  retainedEarnings: string;
}> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<{ code: string; name: string; account_type: string; amount: string }>(
      `SELECT ga.code, ga.name, ga.account_type,
              COALESCE(SUM(
                CASE
                  WHEN ga.account_type IN ('liability','equity','income')
                    THEN CASE WHEN jl.direction = 'credit' THEN jl.amount ELSE -jl.amount END
                  ELSE CASE WHEN jl.direction = 'debit' THEN jl.amount ELSE -jl.amount END
                END
              ), 0)::text AS amount
         FROM gl_accounts ga
         LEFT JOIN (
           SELECT jl.gl_account_id, jl.direction, jl.amount, je.entry_date
             FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.journal_entry_id
            WHERE ($1::date IS NULL OR je.entry_date <= $1::date)
         ) jl ON jl.gl_account_id = ga.id
        WHERE ga.account_type IN ('asset','liability','equity','income')
        GROUP BY ga.code, ga.name, ga.account_type
        ORDER BY ga.code`,
      [filter.to ?? null]
    );
    const pick = (t: string) =>
      r.rows.filter((x) => x.account_type === t)
        .map((x) => ({ code: x.code, name: x.name, amount: fmt2(x.amount) }));
    const assets = pick("asset");
    const liabilities = pick("liability");
    const equityRows = pick("equity");
    const income = pick("income");

    // Earnings recognised but not yet distributed sit in equity.
    const retained = fmt2(String(income.reduce((s, x) => s + Number(x.amount), 0)));
    const totalAssets = fmt2(String(assets.reduce((s, x) => s + Number(x.amount), 0)));
    const totalLiabilities = fmt2(String(liabilities.reduce((s, x) => s + Number(x.amount), 0)));
    const totalEquity = fmt2(
      String(equityRows.reduce((s, x) => s + Number(x.amount), 0) + Number(retained))
    );
    return {
      asAt: filter.to ?? null,
      assets,
      liabilities,
      equity: equityRows,
      totalAssets,
      totalLiabilities,
      totalEquity,
      retainedEarnings: retained
    };
  });
}