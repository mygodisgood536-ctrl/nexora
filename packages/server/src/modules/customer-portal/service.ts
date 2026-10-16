// Stage 7F — Customer Portal (Part 2 §25). Pre-auth login + scoped portal
// reads for the customer who was provisioned a Virtual Account and portal
// credentials at loan disbursement (RULE 9.5.1). All reads are resolved via
// the portal JWT (scope:'customer'), run under bypass RLS and are explicitly
// scoped to the token's company + customer so a customer can never observe
// another customer's records.
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { env } from "../../config/env";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../../lib/totp";
import { isLegacySecret, unwrapSecret, wrapSecret } from "../../lib/secret-vault";

const BCRYPT_ROUNDS = 10;

/** RULE 5.2.3.5 - an unused initial credential expires after the company window (default 7 days). */
const DEFAULT_RITUAL_WINDOW_HOURS = 168;

export interface PortalPrincipal {
  customerId: string;
  companyId: string;
  accessId: string;
  /** RULE 5.2.3c / 14.4.3 - bumped on password change so every outstanding session dies at once. */
  sessionEpoch: number;
}

export function signPortalToken(p: PortalPrincipal): string {
  return jwt.sign(
    { scope: "customer", sub: p.customerId, companyId: p.companyId, aid: p.accessId, ep: p.sessionEpoch },
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
      aid?: string;
      ep?: number;
    };
    if (claims.scope !== "customer") throw new Error("not a customer token");
    return {
      customerId: claims.sub,
      companyId: claims.companyId,
      accessId: claims.aid ?? "",
      sessionEpoch: typeof claims.ep === "number" ? claims.ep : 0
    };
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
  /** RULE 5.3.3 / 12.31 - which ritual step the customer must complete next. */
  ritual: PortalRitualState;
}

export interface PortalRitualState {
  credentialState: string;
  changePassword: boolean;
  authenticatorSetup: boolean;
  authenticatorVerify: boolean;
  authenticatorRequired: boolean;
  nextStep: "change_password" | "authenticator_setup" | "authenticator_verify" | "complete";
}

interface PortalAccessRow {
  id: string;
  company_id: string;
  customer_id: string;
  username: string;
  password_hash: string;
  status: string;
  credential_state: string;
  totp_secret_encrypted: string | null;
  totp_verified_at: Date | null;
  password_changed_at: Date | null;
  credential_issued_at: Date | null;
  credential_expires_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  session_epoch: number;
}

const ACCESS_COLUMNS = `id, company_id, customer_id, username, password_hash, status,
  credential_state, totp_secret_encrypted, totp_verified_at, password_changed_at,
  credential_issued_at, credential_expires_at, failed_login_attempts, locked_until,
  session_epoch`;

async function companyPortalPolicy(
  db: Pick<PoolClient, "query">,
  companyId: string
): Promise<{ authenticatorRequired: boolean; ritualWindowHours: number; lockoutThreshold: number; lockoutMinutes: number; passwordMinLength: number }> {
  const { rows } = await db.query<{
    customer_authenticator_required: boolean | null;
    credential_ritual_window_hours: number | null;
    lockout_threshold: number | null;
    lockout_minutes: number | null;
    password_min_length: number | null;
  }>(
    `SELECT customer_authenticator_required, credential_ritual_window_hours,
            lockout_threshold, lockout_minutes, password_min_length
       FROM company_settings WHERE company_id=$1`,
    [companyId]
  );
  const row = rows[0];
  return {
    authenticatorRequired: row?.customer_authenticator_required !== false,
    ritualWindowHours: row?.credential_ritual_window_hours ?? DEFAULT_RITUAL_WINDOW_HOURS,
    lockoutThreshold: row?.lockout_threshold ?? 5,
    lockoutMinutes: row?.lockout_minutes ?? 15,
    passwordMinLength: row?.password_min_length ?? 8
  };
}

function ritualStateFor(row: PortalAccessRow, authenticatorRequired: boolean): PortalRitualState {
  const changePassword = row.password_changed_at !== null;
  const authenticatorSetup = row.totp_secret_encrypted !== null;
  // RULE 9.6.4 / 18.1 - when the company has switched the customer
  // authenticator off, the customer is secured once the password is changed.
  const authenticatorVerify = !authenticatorRequired || row.totp_verified_at !== null;
  const nextStep: PortalRitualState["nextStep"] = !changePassword
    ? "change_password"
    : !authenticatorSetup
    ? "authenticator_setup"
    : !authenticatorVerify
    ? "authenticator_verify"
    : "complete";
  return {
    credentialState: row.credential_state,
    changePassword,
    authenticatorSetup,
    authenticatorVerify,
    authenticatorRequired,
    nextStep
  };
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
    const access = await db.query<PortalAccessRow>(
      `SELECT ${ACCESS_COLUMNS}
         FROM customer_portal_access pa
         JOIN companies c ON c.id = pa.company_id
        WHERE c.slug=$1 AND pa.username=$2`,
      [input.company.trim(), input.identifier.trim()]
    );
    // RULE 2.4.3 - the response never reveals whether the account exists.
    if ((access.rowCount ?? 0) === 0) {
      throw AppError.unauthorized("Invalid portal credentials");
    }
    // RULE 5.1.4 - the username is the full name, so a same-name collision
    // must never resolve to an arbitrary customer. Fail closed.
    if ((access.rowCount ?? 0) > 1) {
      throw new AppError(
        409,
        "PORTAL_USERNAME_AMBIGUOUS",
        "Portal credentials are ambiguous for this company; contact the company"
      );
    }
    const row = access.rows[0]!;
    if (row.status === "disabled" || row.credential_state === "disabled") {
      throw AppError.unauthorized("Invalid portal credentials");
    }

    const policy = await companyPortalPolicy(db, row.company_id);

    // RULE 14.4.2 - a locked-out customer is refused before the password is
    // even compared, so lockout cannot be used as an oracle.
    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      throw AppError.unauthorized("Invalid portal credentials");
    }

    const ok = await bcrypt.compare(input.password, row.password_hash);

    if (!ok) {
      // RULE 14.4.2 / 5.10.1 - repeated failed logins lock the account.
      const attempts = row.failed_login_attempts + 1;
      const lockedUntil =
        attempts >= policy.lockoutThreshold ? new Date(Date.now() + policy.lockoutMinutes * 60_000) : null;
      await db.query(
        `UPDATE customer_portal_access
            SET failed_login_attempts=$2, locked_until=COALESCE($3, locked_until)
          WHERE id=$1`,
        [row.id, attempts, lockedUntil]
      );
      throw AppError.unauthorized("Invalid portal credentials");
    }

    // A successful login clears the failure counter (RULE 14.4.2).
    await db.query(
      `UPDATE customer_portal_access SET failed_login_attempts=0, locked_until=NULL WHERE id=$1`,
      [row.id]
    );

    // RULE 5.2.3.5 - an initial credential that was never used expires after the
    // company's window. It is marked expired, audited in the same row, and can
    // only be re-issued by an authorised worker.
    const issuedAt = row.credential_issued_at ?? new Date();
    const expiresAt =
      row.credential_expires_at ?? new Date(issuedAt.getTime() + policy.ritualWindowHours * 3_600_000);
    if (row.password_changed_at === null && expiresAt.getTime() < Date.now()) {
      await db.query(
        `UPDATE customer_portal_access
            SET credential_state='credential_expired', locked_until=$2
          WHERE id=$1`,
        [row.id, new Date(Date.now() + policy.lockoutMinutes * 60_000)]
      );
      throw new AppError(
        403,
        "CREDENTIAL_EXPIRED",
        "Your initial portal credential has expired; contact the company to be re-issued"
      );
    }

    const customer = await db.query<{ id: string; customer_code: string; status: string }>(
      `SELECT id, customer_code, status FROM customers WHERE id=$1`,
      [row.customer_id]
    );
    if ((customer.rowCount ?? 0) === 0) throw AppError.unauthorized("Invalid portal credentials");
    const c = customer.rows[0]!;
    if (c.status === "closed" || c.status === "suspended") {
      throw AppError.unauthorized("Invalid portal credentials");
    }

    await db.query(
      `UPDATE customer_portal_access SET status='active', last_login_at=now() WHERE id=$1`,
      [row.id]
    );

    const token = signPortalToken({
      customerId: row.customer_id,
      companyId: row.company_id,
      accessId: row.id,
      sessionEpoch: row.session_epoch
    });
    return {
      token,
      customer: { id: c.id, customerCode: c.customer_code },
      ritual: ritualStateFor(row, policy.authenticatorRequired)
    };
  });
}

/**
 * RULE 5.3.3 - until the ritual completes, the customer reaches nothing except
 * the ritual screens. This is the customer-world equivalent of the worker gate
 * in middleware/auth.ts, and it is enforced at the data layer rather than by
 * hiding navigation.
 */
async function requireSecuredPortal(p: PortalPrincipal): Promise<void> {
  const row = await withBypass(async (db) => {
    const r = await db.query<PortalAccessRow>(
      `SELECT ${ACCESS_COLUMNS} FROM customer_portal_access WHERE id=$1 AND customer_id=$2 AND company_id=$3`,
      [p.accessId, p.customerId, p.companyId]
    );
    return (r.rowCount ?? 0) > 0 ? r.rows[0]! : null;
  });
  if (!row) throw AppError.unauthorized("Invalid or expired customer portal session");
  // RULE 5.2.3c / 14.4.3 - a password change bumps the epoch, so every session
  // minted before it stops verifying immediately.
  if (p.sessionEpoch !== row.session_epoch) {
    throw AppError.unauthorized("Invalid or expired customer portal session");
  }
  if (row.status === "disabled" || row.credential_state === "disabled") {
    throw AppError.unauthorized("Invalid or expired customer portal session");
  }
  const policy = await withBypass((db) => companyPortalPolicy(db, p.companyId));
  const ritual = ritualStateFor(row, policy.authenticatorRequired);
  if (ritual.nextStep !== "complete") {
    throw new AppError(
      403,
      "CREDENTIAL_RITUAL_REQUIRED",
      `Complete the ${ritual.nextStep.replace("_", " ")} step to continue`
    );
  }
}

export async function portalRitual(p: PortalPrincipal): Promise<PortalRitualState> {
  const row = await withBypass(async (db) => {
    const r = await db.query<PortalAccessRow>(
      `SELECT ${ACCESS_COLUMNS} FROM customer_portal_access WHERE id=$1 AND customer_id=$2 AND company_id=$3`,
      [p.accessId, p.customerId, p.companyId]
    );
    return (r.rowCount ?? 0) > 0 ? r.rows[0]! : null;
  });
  if (!row) throw AppError.unauthorized("Invalid or expired customer portal session");
  const policy = await withBypass((db) => companyPortalPolicy(db, p.companyId));
  return ritualStateFor(row, policy.authenticatorRequired);
}

/**
 * RULE 5.2.4 / 5.3.1 step 1 - the customer changes the generated initial
 * password. RULE 5.2.3c - the initial credential is destroyed at the same
 * instant: the hash is overwritten, the state advances, and the session epoch is
 * bumped so every outstanding session dies.
 */
export async function portalChangePassword(
  p: PortalPrincipal,
  input: { newPassword: string }
): Promise<PortalRitualState> {
  return withBypass(async (db) => {
    const found = await db.query<PortalAccessRow>(
      `SELECT ${ACCESS_COLUMNS} FROM customer_portal_access
        WHERE id=$1 AND customer_id=$2 AND company_id=$3 FOR UPDATE`,
      [p.accessId, p.customerId, p.companyId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.unauthorized("Invalid or expired customer portal session");
    const row = found.rows[0]!;
    const policy = await companyPortalPolicy(db, p.companyId);

    if (input.newPassword.length < policy.passwordMinLength) {
      throw AppError.unprocessable(`New password must be at least ${policy.passwordMinLength} characters`);
    }
    // RULE 5.3.1 - the new password must not equal the initial credential, the
    // username, or the person's own name.
    const forbidden = [initialPasswordForForCustomer(row.username), row.username.toLowerCase()];
    if (forbidden.includes(input.newPassword.toLowerCase())) {
      throw AppError.unprocessable(
        "New password must not equal the initial credential or the username"
      );
    }

    const nextEpoch = row.session_epoch + 1;
    await db.query(
      `UPDATE customer_portal_access
          SET password_hash=$2,
              password_changed_at=now(),
              credential_state='ritual_in_progress',
              session_epoch=$3,
              credential_expires_at=NULL
        WHERE id=$1`,
      [row.id, await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS), nextEpoch]
    );

    const refreshed = { ...row, password_changed_at: new Date(), session_epoch: nextEpoch };
    return ritualStateFor(refreshed, policy.authenticatorRequired);
  });
}

/** RULE 5.3.1 step 2 - enrol the authenticator; it binds nothing until verified. */
export async function portalTotpSetup(p: PortalPrincipal): Promise<{ secret: string; otpauthUri: string }> {
  return withBypass(async (db) => {
    const found = await db.query<PortalAccessRow>(
      `SELECT ${ACCESS_COLUMNS} FROM customer_portal_access
        WHERE id=$1 AND customer_id=$2 AND company_id=$3 FOR UPDATE`,
      [p.accessId, p.customerId, p.companyId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.unauthorized("Invalid or expired customer portal session");
    const row = found.rows[0]!;

    // RULE 5.3.1 step 1 must be done first: setup alone never secures an account.
    if (row.password_changed_at === null) {
      throw AppError.conflict("Change your password before setting up an authenticator");
    }
    // RULE 14.2.1 - a verified authenticator is never silently replaced.
    if (row.totp_verified_at !== null) {
      throw AppError.conflict("An authenticator is already enrolled on this account");
    }

    const secret = generateTotpSecret();
    await db.query(
      `UPDATE customer_portal_access
          SET totp_secret_encrypted=$2, totp_verified_at=NULL, credential_state='ritual_in_progress'
        WHERE id=$1`,
      [row.id, wrapSecret(secret, row.id)]
    );
    return { secret, otpauthUri: otpauthUri(row.username, secret) };
  });
}

/** RULE 14.2.1 - only a live code binds the authenticator and secures the account. */
export async function portalTotpVerify(
  p: PortalPrincipal,
  input: { code: string }
): Promise<PortalRitualState> {
  return withBypass(async (db) => {
    const found = await db.query<PortalAccessRow>(
      `SELECT ${ACCESS_COLUMNS} FROM customer_portal_access
        WHERE id=$1 AND customer_id=$2 AND company_id=$3 FOR UPDATE`,
      [p.accessId, p.customerId, p.companyId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.unauthorized("Invalid or expired customer portal session");
    const row = found.rows[0]!;
    const policy = await companyPortalPolicy(db, p.companyId);

    const encoded = row.totp_secret_encrypted;
    const secret = encoded && !isLegacySecret(encoded) ? unwrapSecret(encoded, row.id) : null;
    if (!secret) {
      throw AppError.unprocessable("Set up an authenticator before verifying it");
    }
    if (!verifyTotp(secret, input.code ?? "")) {
      throw AppError.unauthorized("Authenticator code is invalid or expired");
    }

    const nextEpoch = row.session_epoch + 1;
    await db.query(
      `UPDATE customer_portal_access
          SET totp_verified_at=now(), credential_state='secured', session_epoch=$2
        WHERE id=$1`,
      [row.id, nextEpoch]
    );

    const refreshed = { ...row, totp_verified_at: new Date(), session_epoch: nextEpoch };
    return ritualStateFor(refreshed, policy.authenticatorRequired);
  });
}

/** RULE 5.2.1 - the initial password is the at-sign plus the first name. */
function initialPasswordForForCustomer(fullNameValue: string): string {
  const first = fullNameValue.trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  return `@${first.charAt(0).toUpperCase()}${first.slice(1)}`;
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
  await requireSecuredPortal(p);
  const c = await portalCustomer(p);
  return {
    id: c.id,
    customerCode: c.customerCode,
    firstName: c.firstName,
    lastName: c.lastName,
  };
}

export async function portalLoans(p: PortalPrincipal): Promise<Array<Record<string, unknown>>> {
  await requireSecuredPortal(p);
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
  await requireSecuredPortal(p);
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
  await requireSecuredPortal(p);
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
  await requireSecuredPortal(p);
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
  await requireSecuredPortal(p);
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
  await requireSecuredPortal(p);
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