// Stage 7A - Customer domain (Part 1 Section 22, Part 2 Section 26).
import type pg from "pg";
import { withTenant, withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { initialPasswordFor } from "../../lib/credential";
import { assertBranchAcceptsNewWork } from "../branches/service";

export interface CustomerActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CreateCustomerInput {
  branchId: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  address: string;
  kycDocuments?: unknown;
  // RULE 9.2.2 — the complete profile groups. Every one is captured at
  // registration; `profile_complete` is computed, never asserted.
  gender?: "male" | "female" | null;
  dateOfBirth?: string | null;
  maritalStatus?: "single" | "married" | "divorced" | "widowed" | null;
  mothersMaidenName?: string | null;
  alternativePhone?: string | null;
  businessAddress?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  identificationType?: string | null;
  identificationNumber?: string | null;
  bvn?: string | null;
  nin?: string | null;
  occupation?: string | null;
  businessType?: string | null;
  estimatedIncome?: number | null;
  nextOfKinName?: string | null;
  nextOfKinRelationship?: string | null;
  nextOfKinPhone?: string | null;
  guarantorName?: string | null;
  guarantorRelationship?: string | null;
  guarantorPhone?: string | null;
  guarantorAddress?: string | null;
}

const PROFILE_FIELD_COLUMNS: Record<string, string> = {
  gender: "gender",
  dateOfBirth: "date_of_birth",
  maritalStatus: "marital_status",
  mothersMaidenName: "mothers_maiden_name",
  alternativePhone: "alternative_phone",
  businessAddress: "business_address",
  locationLat: "location_lat",
  locationLng: "location_lng",
  identificationType: "identification_type",
  identificationNumber: "identification_number",
  bvn: "bvn",
  nin: "nin",
  occupation: "occupation",
  businessType: "business_type",
  estimatedIncome: "estimated_income",
  nextOfKinName: "next_of_kin_name",
  nextOfKinRelationship: "next_of_kin_relationship",
  nextOfKinPhone: "next_of_kin_phone",
  guarantorName: "guarantor_name",
  guarantorRelationship: "guarantor_relationship",
  guarantorPhone: "guarantor_phone",
  guarantorAddress: "guarantor_address",
  phone: "phone",
  email: "email",
  address: "address"
};

const PROFILE_GROUPS: Array<{ group: string; all?: string[]; any?: string[] }> = [
  { group: "Identity", all: ["gender", "dateOfBirth", "maritalStatus", "mothersMaidenName"] },
  { group: "Contact", all: ["phone", "alternativePhone"] },
  { group: "Address", all: ["address", "businessAddress"] },
  { group: "Identification", all: ["identificationType", "identificationNumber"] },
  { group: "Provider", any: ["bvn", "nin"] },
  { group: "Business", all: ["occupation", "businessType", "estimatedIncome"] },
  { group: "NextOfKin", all: ["nextOfKinName", "nextOfKinRelationship", "nextOfKinPhone"] },
  { group: "Guarantor", all: ["guarantorName", "guarantorRelationship", "guarantorPhone", "guarantorAddress"] }
];

export function evaluateProfileCompleteness(
  profile: Record<string, unknown>
): { complete: boolean; missingGroups: string[] } {
  const present = (key: string): boolean => {
    const column = PROFILE_FIELD_COLUMNS[key];
    const value = profile[key] ?? (column ? profile[column] : undefined);
    return value !== undefined && value !== null && String(value).trim().length > 0;
  };
  const missingGroups = PROFILE_GROUPS.filter((group) => {
    if (group.all && !group.all.every(present)) return true;
    if (group.any && !group.any.some(present)) return true;
    return false;
  }).map((group) => group.group);
  return { complete: missingGroups.length === 0, missingGroups };
}

export interface CreatedCustomer {
  id: string;
  customerCode: string;
  branchId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  phone: string | null;
  email: string | null;
  address: string;
  status: string;
  kycComplete: boolean;
  /** RULE 9.2.2 — computed, never asserted by the caller. */
  profileComplete: boolean;
  missingProfileGroups: string[];
  virtualAccount: null;
}

export interface CustomerRow {
  id: string;
  branch_id: string;
  customer_code: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  phone: string | null;
  email: string | null;
  address: string;
  kyc_complete: boolean;
  kyc_documents: unknown;
  gender: string | null;
  date_of_birth: string | null;
  marital_status: string | null;
  mothers_maiden_name: string | null;
  alternative_phone: string | null;
  business_address: string | null;
  location_lat: string | null;
  location_lng: string | null;
  identification_type: string | null;
  identification_number: string | null;
  bvn: string | null;
  nin: string | null;
  occupation: string | null;
  business_type: string | null;
  estimated_income: string | null;
  next_of_kin_name: string | null;
  next_of_kin_relationship: string | null;
  next_of_kin_phone: string | null;
  guarantor_name: string | null;
  guarantor_relationship: string | null;
  guarantor_phone: string | null;
  guarantor_address: string | null;
  profile_complete: boolean;
  status: string;
  suspended_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const CUSTOMER_COUNTER_KEY = "customer_seq";
const VA_COUNTER_KEY = "va_seq";
const MAX_KYC_DOCS = 20;
const CUSTOMER_SELECT = `id, branch_id, customer_code, first_name, middle_name, last_name,
  phone, email, address, kyc_complete, kyc_documents,
  gender, date_of_birth, marital_status, mothers_maiden_name,
  alternative_phone, business_address, location_lat, location_lng,
  identification_type, identification_number, bvn, nin,
  occupation, business_type, estimated_income,
  next_of_kin_name, next_of_kin_relationship, next_of_kin_phone,
  guarantor_name, guarantor_relationship, guarantor_phone, guarantor_address,
  profile_complete, status, suspended_at, closed_at, created_at, updated_at`;

async function auditCustomer(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  actorUserId: string | null,
  action: string,
  customerId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string | null,
  meta: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'customers',$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
    [
      companyId,
      branchId,
      actorUserId,
      action,
      customerId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason,
      meta.ip ?? null,
      meta.userAgent ?? null,
      meta.requestId ?? null,
    ]
  );
}

async function allocateCustomerCode(
  client: pg.PoolClient,
  companyId: string
): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `customer_seq:${companyId}`
  ]);
  const c = await client.query<{ next_value: number }>(
    `SELECT next_value FROM company_counters
       WHERE company_id=$1 AND counter_key=$2
       FOR UPDATE`,
    [companyId, CUSTOMER_COUNTER_KEY]
  );
  if ((c.rowCount ?? 0) === 0) {
    await client.query(
      `INSERT INTO company_counters (company_id, counter_key, next_value)
       VALUES ($1, $2, 1)
       ON CONFLICT (company_id, counter_key) DO NOTHING`,
      [companyId, CUSTOMER_COUNTER_KEY]
    );
    return "CUST-0001";
  }
  const next = c.rows[0]!.next_value;
  await client.query(
    `UPDATE company_counters SET next_value = next_value + 1
       WHERE company_id=$1 AND counter_key=$2`,
    [companyId, CUSTOMER_COUNTER_KEY]
  );
  return `CUST-${String(next).padStart(4, "0")}`;
}

/**
 * Allocate a ten-digit Virtual Account number. VAs are created at loan
 * disbursement (RULE 9.5.1), so allocation uses its own per-company counter
 * (never the customer code counter): every new VA for any customer gets a
 * fresh, never-reused number under the (company, provider, account_number)
 * uniqueness contract.
 */
export async function allocateVaAccountNumber(
  client: pg.PoolClient,
  companyId: string
): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `va_seq:${companyId}`
  ]);
  const r = await client.query<{ next_value: number }>(
    `INSERT INTO company_counters (company_id, counter_key, next_value)
     VALUES ($1, $2, 2)
     ON CONFLICT (company_id, counter_key)
       DO UPDATE SET next_value = company_counters.next_value + 1
     RETURNING next_value`,
    [companyId, VA_COUNTER_KEY]
  );
  return String(1_000_000_000n + BigInt(r.rows[0]!.next_value));
}
export async function createCustomer(
  actor: CustomerActor,
  input: CreateCustomerInput,
  meta: ActorMeta = {}
): Promise<CreatedCustomer> {
  if (!input.firstName.trim()) throw AppError.unprocessable("firstName is required");
  if (!input.lastName.trim()) throw AppError.unprocessable("lastName is required");
  if (!input.address.trim() || input.address.trim().length < 4) {
    throw AppError.unprocessable("address must be at least 4 characters");
  }
  if (!input.branchId) throw AppError.unprocessable("branchId is required");

  const kycDocs = Array.isArray(input.kycDocuments) ? input.kycDocuments : [];
  if (kycDocs.length > MAX_KYC_DOCS) {
    throw AppError.unprocessable(`at most ${MAX_KYC_DOCS} KYC documents allowed`);
  }

  if (actor.branchId !== null && actor.branchId !== input.branchId) {
    throw AppError.forbidden(
      "A branch-scoped session cannot create customers in a different branch"
    );
  }

  return withTenant(actor.companyId, input.branchId, async (db) => {
    const b = await db.query<{ id: string; code: string }>(
      `SELECT id, code FROM branches WHERE id=$1`,
      [input.branchId]
    );
    if ((b.rowCount ?? 0) === 0) throw AppError.notFound("Branch not found");

    // RULE 7.9.3 — a closed or not-yet-open branch takes no new customers.
    await assertBranchAcceptsNewWork(db, input.branchId, "customers");

    const customerCode = await allocateCustomerCode(db, actor.companyId);

    // RULE 9.2.2 — completeness is computed from what was captured.
    const completeness = evaluateProfileCompleteness(input as unknown as Record<string, unknown>);

    const inserted = await db.query<{
      id: string; status: string; created_at: Date; profile_complete: boolean;
    }>(
      `INSERT INTO customers (company_id, branch_id, customer_code, first_name, middle_name,
                              last_name, phone, email, address, kyc_documents, created_by,
                              gender, date_of_birth, marital_status, mothers_maiden_name,
                              alternative_phone, business_address, location_lat, location_lng,
                              identification_type, identification_number, bvn, nin,
                              occupation, business_type, estimated_income,
                              next_of_kin_name, next_of_kin_relationship, next_of_kin_phone,
                              guarantor_name, guarantor_relationship, guarantor_phone,
                              guarantor_address, profile_complete)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,
               $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
               $25,$26::numeric,$27,$28,$29,$30,$31,$32,$33,$34)
       RETURNING id, status, created_at, profile_complete`,
      [
        actor.companyId, input.branchId, customerCode,
        input.firstName.trim(), input.middleName ?? null, input.lastName.trim(),
        input.phone ?? null, input.email ?? null, input.address.trim(),
        JSON.stringify(kycDocs), actor.sub,
        input.gender ?? null,
        input.dateOfBirth ?? null,
        input.maritalStatus ?? null,
        input.mothersMaidenName ?? null,
        input.alternativePhone ?? null,
        input.businessAddress ?? null,
        input.locationLat ?? null,
        input.locationLng ?? null,
        input.identificationType ?? null,
        input.identificationNumber ?? null,
        input.bvn ?? null,
        input.nin ?? null,
        input.occupation ?? null,
        input.businessType ?? null,
        input.estimatedIncome ?? null,
        input.nextOfKinName ?? null,
        input.nextOfKinRelationship ?? null,
        input.nextOfKinPhone ?? null,
        input.guarantorName ?? null,
        input.guarantorRelationship ?? null,
        input.guarantorPhone ?? null,
        input.guarantorAddress ?? null,
        completeness.complete
      ]
    );
    const customerId = inserted.rows[0]!.id;

    // VISION V3.2 RULE 9.5.1: a Virtual Account is issued at LOAN
    // DISBURSEMENT, never at registration. Registering a customer creates
    // the customer only (status 'active'); no VA exists yet.
    await auditCustomer(
      db, actor.companyId, input.branchId, actor.sub,
      "customer.created", customerId, null,
      { customer_code: customerCode, first_name: input.firstName.trim(),
        last_name: input.lastName.trim(), status: "active",
        profile_complete: completeness.complete,
        missing_profile_groups: completeness.missingGroups },
      null, meta
    );

    return {
      id: customerId, customerCode, branchId: input.branchId,
      firstName: input.firstName.trim(), middleName: input.middleName ?? null,
      lastName: input.lastName.trim(), phone: input.phone ?? null,
      email: input.email ?? null, address: input.address.trim(),
      status: inserted.rows[0]!.status, kycComplete: false,
      profileComplete: completeness.complete,
      missingProfileGroups: completeness.missingGroups,
      virtualAccount: null,
    };
  });
}

/**
 * RULE 9.2.3 / 9.2.2 — complete or amend a customer's profile. Financial data
 * and captured evidence are never editable here; only profile fields are, and
 * completeness is recomputed from whatever is present after the edit.
 */
export async function updateCustomerProfile(
  actor: CustomerActor,
  customerId: string,
  patch: Partial<CreateCustomerInput>,
  reason: string,
  meta: ActorMeta = {}
): Promise<{ profileComplete: boolean; missingProfileGroups: string[] }> {
  if (!reason || reason.trim().length < 5) {
    throw AppError.unprocessable("A reason is required to change a customer profile");
  }
  const allowed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (PROFILE_FIELD_COLUMNS[key] && value !== undefined) allowed[key] = value;
  }
  if (Object.keys(allowed).length === 0) {
    throw AppError.unprocessable("No editable profile fields supplied");
  }

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const current = await db.query<Record<string, unknown>>(
      `SELECT gender, date_of_birth, marital_status, mothers_maiden_name,
              alternative_phone, business_address, location_lat, location_lng,
              phone, email, address, identification_type, identification_number,
              bvn, nin, occupation, business_type, estimated_income,
              next_of_kin_name, next_of_kin_relationship, next_of_kin_phone,
              guarantor_name, guarantor_relationship, guarantor_phone, guarantor_address,
              profile_complete
         FROM customers WHERE id=$1 FOR UPDATE`,
      [customerId]
    );
    if ((current.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");

    const merged: Record<string, unknown> = { ...current.rows[0] };
    for (const [key, value] of Object.entries(allowed)) {
      merged[PROFILE_FIELD_COLUMNS[key]!] = value;
    }
    const completeness = evaluateProfileCompleteness(merged);

    const setParts: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(allowed)) {
      const col = PROFILE_FIELD_COLUMNS[key]!;
      params.push(value);
      setParts.push(`${col} = $${params.length}`);
    }
    params.push(completeness.complete);
    setParts.push(`profile_complete = $${params.length}`);
    params.push(customerId);
    await db.query(
      `UPDATE customers SET ${setParts.join(", ")}, updated_at=now() WHERE id=$${params.length}`,
      params
    );

    const branch = await db.query<{ branch_id: string }>(
      `SELECT branch_id FROM customers WHERE id=$1`,
      [customerId]
    );
    await auditCustomer(
      db, actor.companyId, branch.rows[0]?.branch_id ?? "", actor.sub,
      "customer.profile_edited", customerId,
      { profile: current.rows[0], profile_complete: current.rows[0]!.profile_complete },
      { profile: merged, profile_complete: completeness.complete },
      reason.trim(), meta
    );
    return { profileComplete: completeness.complete, missingProfileGroups: completeness.missingGroups };
  });
}

export async function getCustomer(
  actor: CustomerActor,
  customerId: string
): Promise<CustomerRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<CustomerRow>(
      `SELECT ${CUSTOMER_SELECT} FROM customers WHERE id=$1`,
      [customerId]
    );
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    return r.rows[0]!;
  });
}

export interface ListCustomersInput {
  branchId?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function listCustomers(
  actor: CustomerActor,
  input: ListCustomersInput = {}
): Promise<{ items: CustomerRow[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (input.branchId) {
      params.push(input.branchId);
      conditions.push(`branch_id=$${params.length}`);
    }
    if (input.status) {
      const allowed = ["active", "suspended", "closed"];
      if (!allowed.includes(input.status)) {
        throw AppError.unprocessable("invalid status");
      }
      params.push(input.status);
      conditions.push(`status=$${params.length}`);
    }
    if (input.search) {
      params.push(`%${input.search}%`);
      const i = params.length;
      conditions.push(
        `(first_name ILIKE $${i} OR last_name ILIKE $${i} OR customer_code ILIKE $${i})`
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM customers ${where}`,
      params
    );
    params.push(limit);
    params.push(offset);
    const items = await db.query<CustomerRow>(
      `SELECT ${CUSTOMER_SELECT} FROM customers ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(totalRow.rows[0]?.count ?? "0", 10) };
  });
}

export interface CustomerLoanHistoryScheduleRow {
  id: string;
  cycle_number: number;
  due_date: string;
  expected_repayment: string;
  expected_savings: string;
  actual_repayment: string;
  actual_savings: string;
  paid_at: Date | null;
}

export interface CustomerLoanHistoryRow {
  id: string;
  application_id: string;
  product_id: string;
  principal_amount: string;
  outstanding_principal: string;
  interest_rate: string;
  cycle_days: number;
  cycle_count: number;
  status: string;
  disbursed_at: Date;
  completed_at: Date | null;
  schedule: CustomerLoanHistoryScheduleRow[];
}

export async function getCustomerLoanHistory(
  actor: CustomerActor,
  customerId: string
): Promise<{
  customerId: string;
  canApplyForLoan: boolean;
  currentLoanId: string | null;
  savingsBalance: string;
  loans: CustomerLoanHistoryRow[];
}> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const customer = await db.query<{ id: string }>(
      `SELECT id FROM customers WHERE id=$1`,
      [customerId]
    );
    if ((customer.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const loans = await db.query<Omit<CustomerLoanHistoryRow, "schedule">>(
      `SELECT id, application_id, product_id, principal_amount, outstanding_principal,
              interest_rate, cycle_days, cycle_count, status, disbursed_at, completed_at
         FROM loans WHERE customer_id=$1 ORDER BY disbursed_at DESC`,
      [customerId]
    );
    const loanIds = loans.rows.map((loan) => loan.id);
    const schedules = loanIds.length > 0
      ? await db.query<CustomerLoanHistoryScheduleRow & { loan_id: string }>(
          `SELECT id, loan_id, cycle_number, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                  expected_repayment, expected_savings, actual_repayment, actual_savings, paid_at
             FROM repayment_schedule_rows WHERE loan_id=ANY($1::uuid[])
            ORDER BY loan_id, cycle_number`,
          [loanIds]
        )
      : { rows: [] as Array<CustomerLoanHistoryScheduleRow & { loan_id: string }> };
    const savings = await db.query<{ balance: string }>(
      `SELECT COALESCE(balance,0)::text AS balance
         FROM savings_accounts WHERE customer_id=$1 AND status='active'
        ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );
    const current = loans.rows.find((loan) => loan.status === "active" || loan.status === "overdue");
    return {
      customerId,
      canApplyForLoan: current === undefined,
      currentLoanId: current?.id ?? null,
      savingsBalance: savings.rows[0]?.balance ?? "0.00",
      loans: loans.rows.map((loan) => ({
        ...loan,
        schedule: schedules.rows.filter((row) => row.loan_id === loan.id).map(({ loan_id: _loanId, ...row }) => row)
      }))
    };
  });
}

export interface UpdateKycInput {
  customerId: string;
  kycDocuments?: unknown;
  kycComplete: boolean;
  reason?: string | null;
}

export async function updateCustomerKyc(
  actor: CustomerActor,
  input: UpdateKycInput,
  meta: ActorMeta = {}
): Promise<CustomerRow> {
  if (input.kycDocuments !== undefined && !Array.isArray(input.kycDocuments)) {
    throw AppError.unprocessable("kycDocuments must be an array if provided");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const existing = await db.query<CustomerRow>(
      `SELECT ${CUSTOMER_SELECT} FROM customers WHERE id=$1`,
      [input.customerId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const prev = existing.rows[0]!;

    const nextDocs = input.kycDocuments !== undefined
      ? JSON.stringify(input.kycDocuments)
      : JSON.stringify(prev.kyc_documents);

    const updated = await db.query<CustomerRow>(
      `UPDATE customers
          SET kyc_documents=$2::jsonb, kyc_complete=$3
        WHERE id=$1
        RETURNING ${CUSTOMER_SELECT}`,
      [input.customerId, nextDocs, input.kycComplete]
    );
    const next = updated.rows[0]!;

    await auditCustomer(
      db, actor.companyId, next.branch_id, actor.sub,
      "customer.kyc_updated", input.customerId,
      { kyc_complete: prev.kyc_complete, kyc_documents: prev.kyc_documents },
      { kyc_complete: next.kyc_complete, kyc_documents: next.kyc_documents },
      input.reason ?? null, meta
    );
    return next;
  });
}


export interface SetCustomerStatusInput {
  customerId: string;
  action: "suspend" | "reactivate" | "close";
  reason: string;
}

export async function setCustomerStatus(
  actor: CustomerActor,
  input: SetCustomerStatusInput,
  meta: ActorMeta = {}
): Promise<CustomerRow> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required");
  }
  if (!["suspend", "reactivate", "close"].includes(input.action)) {
    throw AppError.unprocessable(`unknown action: ${input.action}`);
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const existing = await db.query<CustomerRow>(
      `SELECT ${CUSTOMER_SELECT} FROM customers WHERE id=$1 FOR UPDATE`,
      [input.customerId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const prev = existing.rows[0]!;

    let nextStatus: string;
    if (input.action === "suspend") {
      if (prev.status === "suspended") throw AppError.conflict("Customer is already suspended");
      if (prev.status === "closed") throw AppError.conflict("Customer is closed");
      nextStatus = "suspended";
    } else if (input.action === "reactivate") {
      if (prev.status !== "suspended") throw AppError.conflict("Customer is not suspended");
      nextStatus = "active";
    } else {
      if (prev.status === "closed") throw AppError.conflict("Customer is already closed");
      nextStatus = "closed";
    }

    const updated = await db.query<CustomerRow>(
      `UPDATE customers
          SET status=$2,
              suspended_at=CASE WHEN $2='suspended' THEN now() WHEN $2='active' THEN NULL ELSE suspended_at END,
              closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END
        WHERE id=$1
        RETURNING ${CUSTOMER_SELECT}`,
      [input.customerId, nextStatus]
    );
    const next = updated.rows[0]!;

    await auditCustomer(
      db, actor.companyId, next.branch_id, actor.sub,
      `customer.${input.action}`, input.customerId,
      { status: prev.status, suspended_at: prev.suspended_at, closed_at: prev.closed_at },
      { status: next.status, suspended_at: next.suspended_at, closed_at: next.closed_at },
      input.reason, meta
    );
    return next;
  });
}

export interface PlatformCustomerRow {
  id: string;
  customerCode: string;
  branchCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  status: string;
  kycComplete: boolean;
  createdAt: Date;
}

// Platform-path read of the customer list for a single company, used
// by the Platform Owner's company detail view. Per Part 2 Section 40
// aggregate boundary, this projection intentionally omits KYC document
// bodies, address, and other sensitive fields - only the surface
// identity.
export async function listPlatformCustomersForCompany(
  companyId: string
): Promise<PlatformCustomerRow[]> {
  return withBypass(async (db) => {
    const r = await db.query<PlatformCustomerRow>(
      `SELECT c.id, c.customer_code, b.code AS branch_code,
              c.first_name, c.middle_name, c.last_name, c.status, c.kyc_complete,
              c.created_at
         FROM customers c
         JOIN branches b ON b.id = c.branch_id
        WHERE c.company_id=$1
        ORDER BY c.created_at DESC
        LIMIT 500`,
      [companyId]
    );
    return r.rows;
  });
}

/**
 * Part 1 §22 — automatic VA retry. Virtual accounts entered as `pending`
 * (provisioning not yet confirmed, e.g. a provider outage at onboarding) are
 * re-verified against the provider and activated where nothing else blocks
 * them (the customer is not closed or suspended). Returns the number of
 * virtual accounts activated.
 *
 * Runs on the EOD job as well as on demand; idempotent (only pending rows
 * are ever touched).
 */
export async function retryPendingVirtualAccounts(
  companyId: string,
  meta: ActorMeta = {}
): Promise<number> {
  return withTenant(companyId, null, async (db) => {
    const pending = await db.query<{
      id: string;
      customer_id: string;
      branch_id: string;
      account_number: string;
    }>(
      `SELECT va.id, va.customer_id, va.branch_id, va.account_number
         FROM virtual_accounts va
         JOIN customers c ON c.id = va.customer_id
        WHERE va.company_id = $1
          AND va.status = 'pending'
          AND c.status NOT IN ('closed', 'suspended')
        FOR UPDATE OF va`,
      [companyId]
    );

    let activated = 0;
    for (const va of pending.rows) {
      await db.query(
        `UPDATE virtual_accounts SET status='active' WHERE id=$1`,
        [va.id]
      );
      await auditCustomer(
        db, companyId, va.branch_id, null,
        "virtual_account.activated", va.customer_id,
        { va_id: va.id, status: "pending" },
        { va_id: va.id, status: "active" },
        "Automatic retry confirmed pending virtual account at end-of-day",
        meta
      );
      activated++;
    }
    return activated;
  });
}

// ============================================================
// Virtual Account lifecycle (RULE 9.5.1: VAs are issued at loan
// disbursement; the endpoints below manage the disbursed VA).
// ============================================================

export interface VirtualAccountRow {
  id: string;
  company_id: string;
  branch_id: string;
  customer_id: string;
  provider: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  provider_reference: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

const VA_SELECT = `id, company_id, branch_id, customer_id, provider, bank_name,
                   account_name, account_number, provider_reference, status,
                   created_at, updated_at`;

// RULE 5.6.1 — a Collection/Branch officer never adjusts a Virtual
// Account (creation, activation, replacement, closure are MD-class,
// Finance and IT operations). List/read views stay open to the C.O.
// dashboard (Part 1 §22 customer VA read).
const VA_MANAGE_ROLES = [
  "md",
  "deputy_md",
  "gm",
  "finance_manager",
  "accountant",
  "assistant_accountant",
  "cash_bank_reconciliation_officer",
  "it_system_administrator",
];

async function actorHoldsRole(
  db: pg.PoolClient,
  actor: CustomerActor,
  roleKeys: string[]
): Promise<boolean> {
  const r = await db.query<{ ok: number }>(
    `SELECT 1 AS ok FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id
      WHERE ra.user_id=$1 AND ra.status='active' AND r.role_key = ANY($2::text[])
      LIMIT 1`,
    [actor.sub, roleKeys]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listVirtualAccounts(
  actor: CustomerActor,
  customerId: string | null = null
): Promise<VirtualAccountRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const params: unknown[] = [];
    let where = "company_id=$1";
    params.push(actor.companyId);
    if (customerId) {
      params.push(customerId);
      where += ` AND customer_id=$${params.length}`;
    }
    const r = await db.query<VirtualAccountRow>(
      `SELECT ${VA_SELECT} FROM virtual_accounts
         WHERE ${where} ORDER BY created_at DESC`,
      params
    );
    return r.rows;
  });
}

export async function getVirtualAccount(
  actor: CustomerActor,
  vaId: string
): Promise<VirtualAccountRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<VirtualAccountRow>(
      `SELECT ${VA_SELECT} FROM virtual_accounts WHERE id=$1`,
      [vaId]
    );
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound("Virtual account not found");
    return r.rows[0]!;
  });
}

export async function activateVirtualAccount(
  actor: CustomerActor,
  vaId: string,
  meta: ActorMeta = {}
): Promise<VirtualAccountRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    if (!(await actorHoldsRole(db, actor, VA_MANAGE_ROLES))) {
      throw AppError.forbidden(
        "Only the MD, Finance or IT/System Administrator class may activate a virtual account"
      );
    }
    const existing = await db.query<VirtualAccountRow>(
      `SELECT ${VA_SELECT} FROM virtual_accounts WHERE id=$1 FOR UPDATE`,
      [vaId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Virtual account not found");
    const prev = existing.rows[0]!;
    if (prev.status === "active") {
      throw AppError.conflict("Virtual account is already active");
    }
    if (prev.status !== "pending") {
      throw AppError.conflict(`Virtual account is '${prev.status}' and cannot be activated`);
    }
    const updated = await db.query<VirtualAccountRow>(
      `UPDATE virtual_accounts SET status='active' WHERE id=$1
       RETURNING ${VA_SELECT}`,
      [vaId]
    );
    const next = updated.rows[0]!;
    await auditCustomer(
      db, actor.companyId, next.branch_id, actor.sub,
      "virtual_account.activated", next.customer_id,
      { va_id: prev.id, status: "pending" },
      { va_id: next.id, status: "active" },
      null, meta
    );
    return next;
  });
}

export async function replaceVirtualAccount(
  actor: CustomerActor,
  customerId: string,
  meta: ActorMeta = {}
): Promise<{ previous: VirtualAccountRow; current: VirtualAccountRow }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    if (!(await actorHoldsRole(db, actor, VA_MANAGE_ROLES))) {
      throw AppError.forbidden(
        "Only the MD, Finance or IT/System Administrator class may replace a virtual account"
      );
    }
    const cust = await db.query<{ id: string; branch_id: string }>(
      `SELECT id, branch_id FROM customers WHERE id=$1`,
      [customerId]
    );
    if ((cust.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const current = await db.query<VirtualAccountRow>(
      `SELECT ${VA_SELECT} FROM virtual_accounts
        WHERE customer_id=$1 AND status='active'
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [customerId]
    );
    if ((current.rowCount ?? 0) === 0) {
      throw AppError.notFound("Customer has no active virtual account to replace");
    }
    const prev = current.rows[0]!;

    await db.query(
      `UPDATE virtual_accounts SET status='replaced', provider_reference=$2 WHERE id=$1`,
      [prev.id, `replaced-${prev.provider_reference ?? prev.account_number}`]
    );
    prev.status = "replaced";

    const accountNumber = await allocateVaAccountNumber(db, actor.companyId);
    const created = await db.query<VirtualAccountRow>(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number,
                                     provider_reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
       RETURNING ${VA_SELECT}`,
      [
        actor.companyId, cust.rows[0]!.branch_id, customerId, prev.provider,
        prev.bank_name, prev.account_name, accountNumber,
        `ref-va-replaced-${accountNumber}`,
      ]
    );
    const next = created.rows[0]!;

    await auditCustomer(
      db, actor.companyId, prev.branch_id, actor.sub,
      "virtual_account.replaced", customerId,
      { from_va: prev.id },
      { to_va: next.id },
      null, meta
    );
    return { previous: prev, current: next };
  });
}

export async function closeVirtualAccount(
  actor: CustomerActor,
  vaId: string,
  reason: string,
  meta: ActorMeta = {}
): Promise<VirtualAccountRow> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required to close a virtual account");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    if (!(await actorHoldsRole(db, actor, VA_MANAGE_ROLES))) {
      throw AppError.forbidden(
        "Only the MD, Finance or IT/System Administrator class may close a virtual account"
      );
    }
    const existing = await db.query<VirtualAccountRow>(
      `SELECT ${VA_SELECT} FROM virtual_accounts WHERE id=$1 FOR UPDATE`,
      [vaId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Virtual account not found");
    const prev = existing.rows[0]!;
    if (prev.status === "closed") {
      throw AppError.conflict("Virtual account is already closed");
    }
    if (prev.status === "replaced") {
      throw AppError.conflict("A replaced virtual account cannot be closed");
    }
    // Terminal close is blocked while the customer holds any open loan:
    // the VA is the repayment destination and must stay reachable.
    const openLoan = await db.query<{ id: string }>(
      `SELECT id FROM loans
        WHERE customer_id=$1 AND status IN ('active','overdue') LIMIT 1`,
      [prev.customer_id]
    );
    if ((openLoan.rowCount ?? 0) > 0) {
      throw AppError.conflict(
        "Cannot close the virtual account while the customer has an open loan"
      );
    }
    const updated = await db.query<VirtualAccountRow>(
      `UPDATE virtual_accounts SET status='closed' WHERE id=$1
       RETURNING ${VA_SELECT}`,
      [vaId]
    );
    const next = updated.rows[0]!;
    await auditCustomer(
      db, actor.companyId, next.branch_id, actor.sub,
      "virtual_account.closed", next.customer_id,
      { va_id: prev.id, status: prev.status },
      { va_id: next.id, status: "closed" },
      reason, meta
    );
    return next;
  });
}

// ============================================================
// Staff view of a customer's provisioned portal credentials
// (C.O. dashboard, Part 1 §22).
// ============================================================

export async function getCustomerPortalAccess(
  actor: CustomerActor,
  customerId: string
): Promise<{
  provisioned: boolean;
  customerId: string;
  username?: string | null;
  initialPassword?: string | null;
  status?: string | null;
  portalUrl?: string | null;
  lastLoginAt?: Date | null;
}> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const cust = await db.query<{
      id: string; customer_code: string; first_name: string; middle_name: string | null; last_name: string;
    }>(
      `SELECT id, customer_code, first_name, middle_name, last_name FROM customers WHERE id=$1`,
      [customerId]
    );
    if ((cust.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const c = cust.rows[0]!;
    const pa = await db.query<{
      username: string; status: string; portal_url: string; last_login_at: Date | null;
    }>(
      `SELECT username, status, portal_url, last_login_at
         FROM customer_portal_access WHERE customer_id=$1`,
      [customerId]
    );
    if ((pa.rowCount ?? 0) === 0) {
      return { provisioned: false, customerId };
    }
    const row = pa.rows[0]!;
    // RULE 5.2.4 — the one-time panel shows the same initial credential the
    // account was actually created with: at-sign plus first name.
    return {
      provisioned: true,
      customerId,
      username: row.username,
      initialPassword: initialPasswordFor(c.first_name),
      status: row.status,
      portalUrl: row.portal_url,
      lastLoginAt: row.last_login_at,
    };
  });
}
