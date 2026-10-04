import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export type CompanyAiIntent =
  | "customer_loan_history"
  | "overdue_summary"
  | "branch_collection_summary";

export interface CompanyAiActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface CompanyAiMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CompanyAiQuery {
  intent: CompanyAiIntent;
  question: string;
  customerId?: string | null;
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface CompanyAiAnswer {
  intent: CompanyAiIntent;
  question: string;
  answer: Record<string, unknown>;
  citations: Array<Record<string, unknown>>;
  createdAt: Date;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(value: string | null | undefined, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (!DATE_RE.test(value)) throw AppError.unprocessable(`${label} must be YYYY-MM-DD`);
  return value;
}

async function auditQuery(
  db: pg.PoolClient,
  actor: CompanyAiActor,
  input: CompanyAiQuery,
  answer: Record<string, unknown>,
  citations: Array<Record<string, unknown>>,
  createdAt: Date,
  meta: CompanyAiMeta
): Promise<void> {
  await db.query(
    `INSERT INTO company_ai_query_log
       (company_id, branch_id, actor_user_id, intent, question, answer, citations, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
    [
      actor.companyId,
      actor.branchId,
      actor.sub,
      input.intent,
      input.question,
      JSON.stringify(answer),
      JSON.stringify(citations),
      createdAt
    ]
  );
}

export async function answerCompanyQuestion(
  actor: CompanyAiActor,
  input: CompanyAiQuery,
  meta: CompanyAiMeta = {}
): Promise<CompanyAiAnswer> {
  if (!input.question?.trim() || input.question.trim().length > 1000) {
    throw AppError.unprocessable("question must be between 1 and 1000 characters");
  }
  const from = requireDate(input.from, "from");
  const to = requireDate(input.to, "to");
  if ((from === null) !== (to === null)) {
    throw AppError.unprocessable("from and to must be provided together");
  }
  if (from !== null && from > to!) throw AppError.unprocessable("from must not be after to");

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    let answer: Record<string, unknown>;
    let citations: Array<Record<string, unknown>> = [];
    if (input.intent === "customer_loan_history") {
      if (!input.customerId) throw AppError.unprocessable("customerId is required for this intent");
      const customer = await db.query<{
        id: string; first_name: string; middle_name: string | null; last_name: string; customer_code: string;
      }>(
        `SELECT id, first_name, middle_name, last_name, customer_code
           FROM customers WHERE id=$1`,
        [input.customerId]
      );
      if ((customer.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
      const c = customer.rows[0]!;
      const loans = await db.query<{
        id: string; status: string; principal_amount: string; outstanding_principal: string;
        cycle_count: number; disbursed_at: Date;
      }>(
        `SELECT id, status, principal_amount, outstanding_principal, cycle_count, disbursed_at
           FROM loans WHERE customer_id=$1 ORDER BY disbursed_at DESC`,
        [input.customerId]
      );
      const savings = await db.query<{ balance: string }>(
        `SELECT COALESCE(balance,0)::text AS balance
           FROM savings_accounts WHERE customer_id=$1 AND status='active'
          ORDER BY created_at DESC LIMIT 1`,
        [input.customerId]
      );
      answer = {
        customer: {
          id: c.id,
          name: [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(" "),
          customerCode: c.customer_code
        },
        loans: loans.rows,
        savingsBalance: savings.rows[0]?.balance ?? "0.00",
        canApplyForLoan: !loans.rows.some((loan) => loan.status === "active" || loan.status === "overdue")
      };
      citations = [{ table: "loans", recordId: c.id }, { table: "savings_accounts", recordId: c.id }];
    } else if (input.intent === "overdue_summary") {
      const branchId = input.branchId ?? actor.branchId;
      const overdue = await db.query<{ loan_count: string; customer_count: string; outstanding: string }>(
        `SELECT count(*)::text AS loan_count,
                count(DISTINCT customer_id)::text AS customer_count,
                COALESCE(SUM(outstanding_principal),0)::text AS outstanding
           FROM loans
          WHERE status='overdue'
            AND ($1::uuid IS NULL OR branch_id=$1)`,
        [branchId]
      );
      const row = overdue.rows[0]!;
      answer = {
        scope: branchId ? "branch" : "company",
        branchId,
        overdueLoanCount: Number(row.loan_count),
        overdueCustomerCount: Number(row.customer_count),
        outstandingPrincipal: row.outstanding
      };
      citations = [{ table: "loans", status: "overdue", branchId }];
    } else if (input.intent === "branch_collection_summary") {
      const branchId = input.branchId ?? actor.branchId;
      if (!branchId) throw AppError.unprocessable("branchId is required for this intent");
      const periodFrom = from ?? "1900-01-01";
      const periodTo = to ?? new Date().toISOString().slice(0, 10);
      const summary = await db.query<{
        expected_repayment: string; actual_repayment: string; expected_savings: string; actual_savings: string;
      }>(
        `SELECT COALESCE(SUM(r.expected_repayment),0)::text AS expected_repayment,
                COALESCE(SUM(r.actual_repayment),0)::text AS actual_repayment,
                COALESCE(SUM(r.expected_savings),0)::text AS expected_savings,
                COALESCE(SUM(r.actual_savings),0)::text AS actual_savings
           FROM repayment_schedule_rows r
           JOIN loans l ON l.id=r.loan_id
          WHERE l.branch_id=$1 AND r.due_date BETWEEN $2::date AND $3::date`,
        [branchId, periodFrom, periodTo]
      );
      const row = summary.rows[0]!;
      answer = {
        branchId,
        from: periodFrom,
        to: periodTo,
        expectedRepayment: row.expected_repayment,
        actualRepayment: row.actual_repayment,
        expectedSavings: row.expected_savings,
        actualSavings: row.actual_savings
      };
      citations = [{ table: "repayment_schedule_rows", branchId, from: periodFrom, to: periodTo }];
    } else {
      throw AppError.unprocessable("Unsupported company AI intent");
    }

    const createdAt = new Date();
    await auditQuery(db, actor, input, answer, citations, createdAt, meta);
    return { intent: input.intent, question: input.question.trim(), answer, citations, createdAt };
  });
}

export function companyAiCapabilities(): { intents: CompanyAiIntent[]; readOnly: true } {
  return {
    intents: ["customer_loan_history", "overdue_summary", "branch_collection_summary"],
    readOnly: true
  };
}

/**
 * RULE 21.3.2 - the grounding handed to the model.
 *
 * Every fact below is produced by the same tenant-scoped, permission-respecting
 * queries the deterministic answers use, so the model can only ever see records
 * the authenticated user is authorised to reach. "Search" through the AI is not
 * a way around that, and it is not a way around branch scope either.
 */
export async function buildGroundingFor(
  actor: CompanyAiActor,
  input: Omit<CompanyAiQuery, "question">
): Promise<{
  label: string;
  facts: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
}> {
  if (input.intent === "customer_loan_history") {
    if (!input.customerId) throw AppError.unprocessable("customerId is required for this intent");
    return withTenant(actor.companyId, actor.branchId, async (db) => {
      const customer = await db.query<{
        id: string; first_name: string; middle_name: string | null; last_name: string;
        customer_code: string; status: string; branch_id: string;
      }>(
        `SELECT id, first_name, middle_name, last_name, customer_code, status, branch_id
           FROM customers WHERE id=$1`,
        [input.customerId]
      );
      if ((customer.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
      const c = customer.rows[0]!;
      const loans = await db.query<{
        id: string; status: string; principal_amount: string; outstanding_principal: string;
        cycle_count: number; disbursed_at: Date;
      }>(
        `SELECT id, status, principal_amount, outstanding_principal, cycle_count, disbursed_at
           FROM loans WHERE customer_id=$1 ORDER BY disbursed_at DESC`,
        [input.customerId]
      );
      const savings = await db.query<{ balance: string }>(
        `SELECT COALESCE(balance,0)::text AS balance
           FROM savings_accounts WHERE customer_id=$1 AND status='active'
          ORDER BY created_at DESC LIMIT 1`,
        [input.customerId]
      );
      return {
        label: `the customer record of ${[c.first_name, c.middle_name, c.last_name]
          .filter(Boolean)
          .join(" ")} (${c.customer_code})`,
        facts: [
          {
            customer: {
              id: c.id,
              name: [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(" "),
              customerCode: c.customer_code,
              status: c.status,
              branchId: c.branch_id
            },
            loans: loans.rows.map((l) => ({
              id: l.id,
              status: l.status,
              principalAmount: l.principal_amount,
              outstandingPrincipal: l.outstanding_principal,
              cycleCount: l.cycle_count,
              disbursedAt: l.disbursed_at
            })),
            savingsBalance: savings.rows[0]?.balance ?? "0.00"
          }
        ],
        citations: [
          { table: "customers", recordId: c.id },
          { table: "loans", recordId: c.id },
          { table: "savings_accounts", recordId: c.id }
        ]
      };
    });
  }

  if (input.intent === "overdue_summary") {
    const branchId = input.branchId ?? actor.branchId;
    return withTenant(actor.companyId, actor.branchId, async (db) => {
      const rows = await db.query<{
        loan_count: string; customer_count: string; outstanding: string;
      }>(
        `SELECT count(*)::text AS loan_count,
                count(DISTINCT customer_id)::text AS customer_count,
                COALESCE(SUM(outstanding_principal),0)::text AS outstanding
           FROM loans
          WHERE status='overdue'
            AND ($1::uuid IS NULL OR branch_id=$1)`,
        [branchId]
      );
      const row = rows.rows[0]!;
      return {
        label: branchId ? "this branch's overdue book" : "this company's overdue book",
        facts: [
          {
            scope: branchId ? "branch" : "company",
            branchId,
            overdueLoanCount: Number(row.loan_count),
            overdueCustomerCount: Number(row.customer_count),
            outstandingPrincipal: row.outstanding
          }
        ],
        citations: [{ table: "loans", status: "overdue", branchId }]
      };
    });
  }

  const branchId = input.branchId ?? actor.branchId;
  if (!branchId) throw AppError.unprocessable("branchId is required for this intent");
  const periodFrom = input.from ?? "1900-01-01";
  const periodTo = input.to ?? new Date().toISOString().slice(0, 10);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const rows = await db.query<{
      expected_repayment: string; actual_repayment: string;
      expected_savings: string; actual_savings: string;
    }>(
      `SELECT COALESCE(SUM(r.expected_repayment),0)::text AS expected_repayment,
              COALESCE(SUM(r.actual_repayment),0)::text AS actual_repayment,
              COALESCE(SUM(r.expected_savings),0)::text AS expected_savings,
              COALESCE(SUM(r.actual_savings),0)::text AS actual_savings
         FROM repayment_schedule_rows r
         JOIN loans l ON l.id=r.loan_id
        WHERE l.branch_id=$1 AND r.due_date BETWEEN $2::date AND $3::date`,
      [branchId, periodFrom, periodTo]
    );
    const row = rows.rows[0]!;
    return {
      label: `this branch's collection position from ${periodFrom} to ${periodTo}`,
      facts: [
        {
          branchId,
          from: periodFrom,
          to: periodTo,
          expectedRepayment: row.expected_repayment,
          actualRepayment: row.actual_repayment,
          expectedSavings: row.expected_savings,
          actualSavings: row.actual_savings
        }
      ],
      citations: [{ table: "repayment_schedule_rows", branchId, from: periodFrom, to: periodTo }]
    };
  });
}
