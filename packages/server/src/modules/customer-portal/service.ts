// Stage 7F — Customer Portal (Part 2 §25). Pre-auth login + scoped portal
// reads for the customer who was provisioned a Virtual Account and portal
// credentials at loan disbursement (RULE 9.5.1). All reads are resolved via
// the portal JWT (scope:'customer'), run under bypass RLS and are explicitly
// scoped to the token's company + customer so a customer can never observe
// another customer's records.
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { env } from "../../config/env";

const BCRYPT_ROUNDS = 10;

export interface PortalPrincipal {
  customerId: string;
  companyId: string;
}

export function signPortalToken(p: PortalPrincipal): string {
  return jwt.sign(
    { scope: "customer", sub: p.customerId, companyId: p.companyId },
    env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "2h" }
  );
}

export function verifyPortalToken(token: string): PortalPrincipal {
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as {
      scope?: string;
      sub: string;
      companyId: string;
    };
    if (claims.scope !== "customer") throw new Error("not a customer token");
    return { customerId: claims.sub, companyId: claims.companyId };
  } catch {
    throw AppError.unauthorized("Invalid or expired customer portal session");
  }
}

export async function isPortalEnabled(companySlug: string): Promise<boolean> {
  return withBypass(async (db) => {
    const r = await db.query<{ enabled: boolean }>(
      `SELECT s.customer_portal_enabled AS enabled
         FROM company_settings s
         JOIN companies c ON c.id = s.company_id
        WHERE c.slug=$1`,
      [companySlug]
    );
    return (r.rowCount ?? 0) > 0 && r.rows[0]!.enabled;
  });
}

export interface PortalLoginResult {
  token: string;
  customer: { id: string; customerCode: string };
}

export async function loginCustomerPortal(input: {
  company: string;
  identifier: string;
  password: string;
}): Promise<PortalLoginResult> {
  if (!input.company.trim()) throw AppError.unprocessable("company is required");
  if (!input.identifier.trim()) throw AppError.unprocessable("identifier is required");
  if (!input.password) throw AppError.unprocessable("password is required");

  const enabled = await isPortalEnabled(input.company.trim());
  if (!enabled) {
    throw new AppError(403, "PORTAL_DISABLED", "The customer portal is disabled for this company");
  }

  return withBypass(async (db) => {
    const access = await db.query<{
      id: string;
      company_id: string;
      customer_id: string;
      username: string;
      password_hash: string;
      status: string;
    }>(
      `SELECT pa.id, pa.company_id, pa.customer_id, pa.username, pa.password_hash, pa.status
         FROM customer_portal_access pa
         JOIN companies c ON c.id = pa.company_id
        WHERE c.slug=$1 AND pa.username=$2`,
      [input.company.trim(), input.identifier.trim()]
    );
    if ((access.rowCount ?? 0) === 0) {
      throw AppError.unauthorized("Invalid portal credentials");
    }
    // RULE 5.2.4 — the username is the full name, so a same-name collision
    // must never resolve to an arbitrary customer. Fail closed.
    if ((access.rowCount ?? 0) > 1) {
      throw new AppError(
        409,
        "PORTAL_USERNAME_AMBIGUOUS",
        "Portal credentials are ambiguous for this company; contact the company"
      );
    }
    const row = access.rows[0]!;
    if (row.status === "disabled") throw AppError.unauthorized("Portal access is disabled");
    const ok = await bcrypt.compare(input.password, row.password_hash);
    if (!ok) throw AppError.unauthorized("Invalid portal credentials");

    const customer = await db.query<{ id: string; customer_code: string; status: string }>(
      `SELECT id, customer_code, status FROM customers WHERE id=$1`,
      [row.customer_id]
    );
    if ((customer.rowCount ?? 0) === 0) throw AppError.unauthorized("Invalid portal credentials");
    const c = customer.rows[0]!;
    if (c.status === "closed" || c.status === "suspended") {
      throw AppError.unauthorized("The customer account is not active");
    }

    await db.query(
      `UPDATE customer_portal_access SET status='active', last_login_at=now() WHERE id=$1`,
      [row.id]
    );

    const token = signPortalToken({ customerId: row.customer_id, companyId: row.company_id });
    return { token, customer: { id: c.id, customerCode: c.customer_code } };
  });
}

async function portalCustomer(p: PortalPrincipal): Promise<{
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
}> {
  return withBypass(async (db) => {
    const r = await db.query<{
      id: string; customer_code: string; first_name: string; last_name: string;
    }>(
      `SELECT id, customer_code, first_name, last_name FROM customers WHERE id=$1 AND company_id=$2`,
      [p.customerId, p.companyId]
    );
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const c = r.rows[0]!;
    return {
      id: c.id,
      customerCode: c.customer_code,
      firstName: c.first_name,
      lastName: c.last_name,
    };
  });
}

export async function portalMe(p: PortalPrincipal): Promise<object> {
  const c = await portalCustomer(p);
  return {
    id: c.id,
    customerCode: c.customerCode,
    firstName: c.firstName,
    lastName: c.lastName,
  };
}

export async function portalLoans(p: PortalPrincipal): Promise<Array<Record<string, unknown>>> {
  return withBypass(async (db) => {
    const r = await db.query(
      `SELECT id, principal_amount, interest_rate, cycle_days, cycle_count,
              expected_repayment_per_cycle, expected_savings_per_cycle,
              outstanding_principal, status, disbursed_at
         FROM loans
        WHERE customer_id=$1 AND company_id=$2
        ORDER BY disbursed_at DESC NULLS LAST`,
      [p.customerId, p.companyId]
    );
    return r.rows.map((row) => ({
      id: row.id,
      principalAmount: row.principal_amount,
      interestRate: row.interest_rate,
      cycleDays: row.cycle_days,
      cycleCount: row.cycle_count,
      expectedRepaymentPerCycle: row.expected_repayment_per_cycle,
      expectedSavingsPerCycle: row.expected_savings_per_cycle,
      outstandingPrincipal: row.outstanding_principal,
      status: row.status,
      disbursedAt: row.disbursed_at ? (row.disbursed_at as Date).toISOString() : null,
    }));
  });
}

export async function portalLoanDetail(p: PortalPrincipal, loanId: string): Promise<object> {
  return withBypass(async (db) => {
    const loan = await db.query(
      `SELECT id, principal_amount, interest_rate, cycle_days, cycle_count,
              expected_repayment_per_cycle, expected_savings_per_cycle,
              outstanding_principal, status, disbursed_at
         FROM loans WHERE id=$1 AND customer_id=$2 AND company_id=$3`,
      [loanId, p.customerId, p.companyId]
    );
    if ((loan.rowCount ?? 0) === 0) throw AppError.notFound("Loan not found");
    const l = loan.rows[0]!;

    const schedule = await db.query(
      `SELECT id, cycle_number, due_date, expected_repayment, expected_savings,
              actual_repayment, actual_savings, paid_at
         FROM repayment_schedule_rows WHERE loan_id=$1 ORDER BY cycle_number`,
      [loanId]
    );
    return {
      id: l.id,
      principalAmount: l.principal_amount,
      interestRate: l.interest_rate,
      cycleDays: l.cycle_days,
      cycleCount: l.cycle_count,
      expectedRepaymentPerCycle: l.expected_repayment_per_cycle,
      expectedSavingsPerCycle: l.expected_savings_per_cycle,
      outstandingPrincipal: l.outstanding_principal,
      status: l.status,
      disbursedAt: l.disbursed_at ? (l.disbursed_at as Date).toISOString() : null,
      repaymentSchedule: schedule.rows.map((s) => ({
        id: s.id,
        cycleNumber: s.cycle_number,
        dueDate: (s.due_date as Date).toISOString().slice(0, 10),
        expectedRepayment: s.expected_repayment,
        expectedSavings: s.expected_savings,
        actualRepayment: s.actual_repayment,
        actualSavings: s.actual_savings,
        paidAt: s.paid_at ? (s.paid_at as Date).toISOString() : null,
      })),
    };
  });
}

export async function portalSavings(p: PortalPrincipal): Promise<object> {
  return withBypass(async (db) => {
    const r = await db.query(
      `SELECT id, balance, status FROM savings_accounts
        WHERE customer_id=$1 AND company_id=$2`,
      [p.customerId, p.companyId]
    );
    if ((r.rowCount ?? 0) === 0) {
      return { accountId: null, balance: "0", status: null };
    }
    const s = r.rows[0]!;
    return { accountId: s.id, balance: s.balance, status: s.status };
  });
}

export async function portalVirtualAccount(p: PortalPrincipal): Promise<object> {
  return withBypass(async (db) => {
    const r = await db.query(
      `SELECT id, provider, bank_name, account_name, account_number, status
         FROM virtual_accounts
        WHERE customer_id=$1 AND company_id=$2 AND status='active'
        ORDER BY created_at DESC LIMIT 1`,
      [p.customerId, p.companyId]
    );
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound("No virtual account for this customer");
    const v = r.rows[0]!;
    return {
      id: v.id,
      provider: v.provider,
      bankName: v.bank_name,
      accountName: v.account_name,
      accountNumber: v.account_number,
      status: v.status,
    };
  });
}

export async function portalPayments(p: PortalPrincipal): Promise<Array<Record<string, unknown>>> {
  return withBypass(async (db) => {
    const r = await db.query(
      `SELECT id, provider, provider_txn_ref, amount, status, value_date, received_at
         FROM payments
        WHERE customer_id=$1 AND company_id=$2
        ORDER BY received_at DESC`,
      [p.customerId, p.companyId]
    );
    return r.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      providerTxnRef: row.provider_txn_ref,
      amount: row.amount,
      status: row.status,
      valueDate: (row.value_date as Date).toISOString(),
      receivedAt: (row.received_at as Date).toISOString(),
    }));
  });
}

export async function portalReceipts(p: PortalPrincipal): Promise<Array<Record<string, unknown>>> {
  return withBypass(async (db) => {
    const r = await db.query(
      `SELECT r.id, r.receipt_number, r.amount, r.issued_at, p.id AS payment_id
         FROM receipts r
         JOIN payments p ON p.id = r.payment_id
        WHERE p.customer_id=$1 AND p.company_id=$2
        ORDER BY r.issued_at DESC`,
      [p.customerId, p.companyId]
    );
    return r.rows.map((row) => ({
      id: row.id,
      receiptNumber: row.receipt_number,
      amount: row.amount,
      issuedAt: (row.issued_at as Date).toISOString(),
      paymentId: row.payment_id,
    }));
  });
}