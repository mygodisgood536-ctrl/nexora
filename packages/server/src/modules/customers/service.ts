// Stage 7A - Customer domain (Part 1 Section 22, Part 2 Section 26).
import type pg from "pg";
import { withTenant, withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";

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
  virtualAccount: {
    id: string;
    provider: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
    status: string;
  };
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
  status: string;
  suspended_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const CUSTOMER_COUNTER_KEY = "customer_seq";
const MAX_KYC_DOCS = 20;

async function auditCustomer(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  actorUserId: string,
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

async function allocateVaAccountNumber(
  client: pg.PoolClient,
  companyId: string
): Promise<string> {
  const r = await client.query<{ next_value: number }>(
    `SELECT next_value FROM company_counters
       WHERE company_id=$1 AND counter_key=$2
       FOR UPDATE`,
    [companyId, CUSTOMER_COUNTER_KEY]
  );
  const n = r.rows[0]?.next_value ?? 1;
  return String(1_000_000_000n + BigInt(n));
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

    const customerCode = await allocateCustomerCode(db, actor.companyId);
    const accountNumber = await allocateVaAccountNumber(db, actor.companyId);

    const inserted = await db.query<{ id: string; status: string; created_at: Date }>(
      `INSERT INTO customers (company_id, branch_id, customer_code, first_name, middle_name,
                              last_name, phone, email, address, kyc_documents, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       RETURNING id, status, created_at`,
      [
        actor.companyId, input.branchId, customerCode,
        input.firstName.trim(), input.middleName ?? null, input.lastName.trim(),
        input.phone ?? null, input.email ?? null, input.address.trim(),
        JSON.stringify(kycDocs), actor.sub,
      ]
    );
    const customerId = inserted.rows[0]!.id;

    // Part 1 Section 22: VA is issued immediately at customer creation.
    const vaInserted = await db.query<{
      id: string; provider: string; bank_name: string;
      account_name: string; account_number: string; status: string;
    }>(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
       RETURNING id, provider, bank_name, account_name, account_number, status`,
      [
        actor.companyId, input.branchId, customerId, "nexora-rails",
        "Nexora Rails Bank",
        `${input.firstName.trim()} ${input.lastName.trim()}`,
        accountNumber,
      ]
    );
    const va = vaInserted.rows[0]!;

    await auditCustomer(
      db, actor.companyId, input.branchId, actor.sub,
      "customer.created", customerId, null,
      { customer_code: customerCode, first_name: input.firstName.trim(),
        last_name: input.lastName.trim(), status: "va_pending",
        virtual_account_number: accountNumber },
      null, meta
    );
    await auditCustomer(
      db, actor.companyId, input.branchId, actor.sub,
      "virtual_account.issued", customerId, null,
      { va_id: va.id, account_number: accountNumber, status: "pending" },
      null, meta
    );

    return {
      id: customerId, customerCode, branchId: input.branchId,
      firstName: input.firstName.trim(), middleName: input.middleName ?? null,
      lastName: input.lastName.trim(), phone: input.phone ?? null,
      email: input.email ?? null, address: input.address.trim(),
      status: inserted.rows[0]!.status, kycComplete: false,
      virtualAccount: {
        id: va.id, provider: va.provider, bankName: va.bank_name,
        accountName: va.account_name, accountNumber: va.account_number,
        status: va.status,
      },
    };
  });
}

export async function getCustomer(
  actor: CustomerActor,
  customerId: string
): Promise<CustomerRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<CustomerRow>(
      `SELECT id, branch_id, customer_code, first_name, middle_name, last_name,
              phone, email, address, kyc_complete, kyc_documents, status,
              suspended_at, closed_at, created_at, updated_at
         FROM customers WHERE id=$1`,
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
      const allowed = ["va_pending", "active", "suspended", "closed"];
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
      `SELECT id, branch_id, customer_code, first_name, middle_name, last_name,
              phone, email, address, kyc_complete, kyc_documents, status,
              suspended_at, closed_at, created_at, updated_at
         FROM customers ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(totalRow.rows[0]?.count ?? "0", 10) };
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
      `SELECT id, branch_id, customer_code, first_name, middle_name, last_name,
              phone, email, address, kyc_complete, kyc_documents, status,
              suspended_at, closed_at, created_at, updated_at
         FROM customers WHERE id=$1`,
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
        RETURNING id, branch_id, customer_code, first_name, middle_name, last_name,
                  phone, email, address, kyc_complete, kyc_documents, status,
                  suspended_at, closed_at, created_at, updated_at`,
      [input.customerId, nextDocs, input.kycComplete]
    );
    const next = updated.rows[0]!;

    // Promote va_pending -> active when KYC is completed and an active VA exists.
    if (input.kycComplete && !prev.kyc_complete && prev.status === "va_pending") {
      const va = await db.query<{ status: string }>(
        `SELECT status FROM virtual_accounts
           WHERE customer_id=$1 AND status='active' LIMIT 1`,
        [input.customerId]
      );
      if ((va.rowCount ?? 0) > 0) {
        await db.query(
          `UPDATE customers SET status='active' WHERE id=$1`,
          [input.customerId]
        );
        next.status = "active";
        await auditCustomer(
          db, actor.companyId, next.branch_id, actor.sub,
          "customer.activated", input.customerId,
          { status: "va_pending" }, { status: "active" },
          "kyc complete and virtual account active", meta
        );
      }
    }

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
      `SELECT id, branch_id, customer_code, first_name, middle_name, last_name,
              phone, email, address, kyc_complete, kyc_documents, status,
              suspended_at, closed_at, created_at, updated_at
         FROM customers WHERE id=$1 FOR UPDATE`,
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
        RETURNING id, branch_id, customer_code, first_name, middle_name, last_name,
                  phone, email, address, kyc_complete, kyc_documents, status,
                  suspended_at, closed_at, created_at, updated_at`,
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
