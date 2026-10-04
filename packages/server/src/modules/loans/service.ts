// Stage 7C - Lending domain (Part 1 Section 23 - application, approval,
// disbursement) + Part 1 Section 22 disburse-on-active-customer rule.
//
// Scope of this commit:
//   - Loan product + approval chain management (CRUD + listing)
//   - Loan application lifecycle: submit / list / get / withdraw
//   - Approval / rejection (single-decision for now; multi-stage chain
//     advancement follows the same pattern in a follow-up)
//   - Disbursement: creates a `loans` row + `repayment_schedule_rows`
//     when the application is approved and the customer is `active`
//     (Part 1 Section 22: disbursement blocked while va_pending)
//
// All writes append to the tenant audit trail.
import type pg from "pg";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";
import { withTenant, withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { allocateVaAccountNumber } from "../customers/service";
import { toCents } from "../payments/service";
import { postDisbursementJournal } from "../payments/accounting";
import { fullName, initialPasswordFor } from "../../lib/credential";
import { assertBranchAcceptsNewWork } from "../branches/service";
import { requireVerifiedFaceCapture } from "../face-captures/service";
import { listLoanApplicationEvidence, requireVerifiedLoanEvidence } from "../loan-evidence/service";

const BCRYPT_ROUNDS = 10;

export interface LoanActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CreateLoanProductInput {
  name: string;
  description?: string | null;
  minPrincipal: number;
  maxPrincipal: number;
  interestRate: number;
  interestMethod?: string | null;
  cycleDays: number;
  cycleCount: number;
  expectedRepaymentPerCycle: number;
  expectedSavingsPerCycle: number;
  approvalChainId: string;
}

export interface LoanProductRow {
  id: string;
  name: string;
  description: string | null;
  min_principal: string;
  max_principal: string;
  interest_rate: string;
  interest_method: string | null;
  cycle_days: number;
  cycle_count: number;
  expected_repayment_per_cycle: string;
  expected_savings_per_cycle: string;
  approval_chain_id: string;
  is_active: boolean;
  created_at: Date;
}

export interface CreateApprovalChainInput {
  name: string;
  description?: string | null;
  onRejection?: "return_to_applicant" | "previous_stage";
  steps: { stageOrder: number; stepName: string; roleId: string; mandatory?: boolean }[];
}

export interface ApprovalChainRow {
  id: string;
  name: string;
  description: string | null;
  on_rejection: string;
  created_at: Date;
}

export interface LoanApplicationTermsInput {
  repaymentMode: "weekly" | "daily";
  repaymentWeekday?: number | null;
  repaymentPeriods: number;
  interestPercentage: number;
  repaymentAmount: number;
}

export interface CreateApplicationInput {
  customerId: string;
  productId: string;
  principalAmount: number;
  terms?: LoanApplicationTermsInput | null;
}

export interface ApplicationRow {
  id: string;
  branch_id: string;
  customer_id: string;
  product_id: string;
  chain_id: string;
  principal_amount: string;
  status: string;
  current_stage_order: number | null;
  submitted_by: string;
  decided_by: string | null;
  decided_at: Date | null;
  rejection_reason: string | null;
  disbursed_at: Date | null;
  created_at: Date;
}

async function auditLoan(
  db: pg.PoolClient,
  companyId: string,
  branchId: string | null,
  actorUserId: string,
  action: string,
  entityType: "loan_products" | "approval_chains" | "loan_applications" | "loans" | "customers" | "loan_application_bank_details" | "loan_application_fees",
  entityId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string | null,
  meta: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
    [
      companyId, branchId, actorUserId, action, entityType, entityId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason,
      meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null,
    ]
  );
}
// ============================================================
// Loan products
// ============================================================

export async function createLoanProduct(
  actor: LoanActor,
  input: CreateLoanProductInput,
  meta: ActorMeta = {}
): Promise<LoanProductRow> {
  if (!input.name || input.name.trim().length < 2) {
    throw AppError.unprocessable("name must be at least 2 characters");
  }
  if (input.minPrincipal <= 0) {
    throw AppError.unprocessable("minPrincipal must be > 0");
  }
  if (input.maxPrincipal < input.minPrincipal) {
    throw AppError.unprocessable("maxPrincipal must be >= minPrincipal");
  }
  if (input.interestRate < 0) {
    throw AppError.unprocessable("interestRate must be >= 0");
  }
  if (input.cycleDays <= 0 || input.cycleCount <= 0) {
    throw AppError.unprocessable("cycleDays and cycleCount must be > 0");
  }
  if (input.expectedRepaymentPerCycle < 0 || input.expectedSavingsPerCycle < 0) {
    throw AppError.unprocessable("expectedRepaymentPerCycle and expectedSavingsPerCycle must be >= 0");
  }

  return withTenant(actor.companyId, null, async (db) => {
    // Verify the approval chain belongs to this company.
    const ch = await db.query<{ id: string }>(
      `SELECT id FROM approval_chains WHERE id=$1 AND company_id=$2`,
      [input.approvalChainId, actor.companyId]
    );
    if ((ch.rowCount ?? 0) === 0) {
      throw AppError.notFound("Approval chain not found in this company");
    }

    const inserted = await db.query<LoanProductRow>(
      `INSERT INTO loan_products (company_id, name, description, min_principal, max_principal,
                                 interest_rate, interest_method, cycle_days, cycle_count,
                                 expected_repayment_per_cycle, expected_savings_per_cycle,
                                 approval_chain_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, name, description, min_principal, max_principal,
                 interest_rate, interest_method, cycle_days, cycle_count,
                 expected_repayment_per_cycle, expected_savings_per_cycle,
                 approval_chain_id, is_active, created_at`,
      [
        actor.companyId, input.name.trim(), input.description ?? null,
        input.minPrincipal, input.maxPrincipal, input.interestRate,
        input.interestMethod ?? null, input.cycleDays, input.cycleCount,
        input.expectedRepaymentPerCycle, input.expectedSavingsPerCycle,
        input.approvalChainId, actor.sub,
      ]
    );
    const product = inserted.rows[0]!;
    await auditLoan(
      db, actor.companyId, actor.branchId, actor.sub,
      "loan_product.created", "loan_products", product.id,
      null,
      { name: product.name, min_principal: product.min_principal,
        max_principal: product.max_principal, interest_rate: product.interest_rate,
        cycle_days: product.cycle_days, cycle_count: product.cycle_count,
        approval_chain_id: product.approval_chain_id },
      null, meta
    );
    return product;
  });
}

export async function listLoanProducts(
  actor: LoanActor,
  options: { activeOnly?: boolean } = {}
): Promise<LoanProductRow[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const where = options.activeOnly ? "WHERE is_active=true" : "";
    const r = await db.query<LoanProductRow>(
      `SELECT id, name, description, min_principal, max_principal,
              interest_rate, interest_method, cycle_days, cycle_count,
              expected_repayment_per_cycle, expected_savings_per_cycle,
              approval_chain_id, is_active, created_at
         FROM loan_products ${where}
        ORDER BY name`,
      []
    );
    return r.rows;
  });
}

// ============================================================
// Approval chains
// ============================================================

export async function createApprovalChain(
  actor: LoanActor,
  input: CreateApprovalChainInput,
  meta: ActorMeta = {}
): Promise<ApprovalChainRow> {
  if (!input.name || input.name.trim().length < 2) {
    throw AppError.unprocessable("name must be at least 2 characters");
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw AppError.unprocessable("At least one approval step is required");
  }
  // Validate stage orders are unique and positive.
  const orders = input.steps.map((s) => s.stageOrder);
  if (orders.some((o) => o <= 0)) {
    throw AppError.unprocessable("stageOrder must be > 0");
  }
  if (new Set(orders).size !== orders.length) {
    throw AppError.unprocessable("stageOrder values must be unique");
  }
  // Validate all role IDs belong to this company.
  return withTenant(actor.companyId, null, async (db) => {
    for (const step of input.steps) {
      const r = await db.query<{ id: string }>(
        `SELECT id FROM roles WHERE id=$1 AND company_id=$2`,
        [step.roleId, actor.companyId]
      );
      if ((r.rowCount ?? 0) === 0) {
        throw AppError.unprocessable(`Role not found in this company: ${step.roleId}`);
      }
    }

    const onRejection = input.onRejection ?? "return_to_applicant";

    const chain = await db.query<ApprovalChainRow>(
      `INSERT INTO approval_chains (company_id, name, description, on_rejection, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, description, on_rejection, created_at`,
      [actor.companyId, input.name.trim(), input.description ?? null, onRejection, actor.sub]
    );
    const chainRow = chain.rows[0]!;

    for (const step of input.steps) {
      await db.query(
        `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id, mandatory)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [actor.companyId, chainRow.id, step.stageOrder, step.stepName, step.roleId, step.mandatory ?? false]
      );
    }

    await auditLoan(
      db, actor.companyId, actor.branchId, actor.sub,
      "approval_chain.created", "approval_chains", chainRow.id,
      null,
      { name: chainRow.name, steps: input.steps.length, on_rejection: onRejection },
      null, meta
    );
    return chainRow;
  });
}

export async function listApprovalChains(
  actor: LoanActor
): Promise<ApprovalChainRow[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<ApprovalChainRow>(
      `SELECT id, name, description, on_rejection, created_at
         FROM approval_chains ORDER BY name`,
      []
    );
    return r.rows;
  });
}

export interface ApprovalChainStepRow {
  id: string;
  stage_order: number;
  step_name: string;
  role_id: string;
  mandatory: boolean;
}

export async function getApprovalChainSteps(
  actor: LoanActor,
  chainId: string
): Promise<ApprovalChainStepRow[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<ApprovalChainStepRow>(
      `SELECT id, stage_order, step_name, role_id, mandatory
         FROM approval_chain_steps
        WHERE chain_id=$1
        ORDER BY stage_order`,
      [chainId]
    );
    return r.rows;
  });
}

// ============================================================
// Loan applications
// ============================================================

function calculateApplicationTerms(
  principalAmount: number,
  input: LoanApplicationTermsInput
): {
  repaymentMode: "weekly" | "daily";
  repaymentWeekday: number | null;
  repaymentPeriods: number;
  interestPercentage: number;
  repaymentAmount: number;
  calculatedInterest: number;
  calculatedTotalRepayment: number;
  tallyStatus: "matched";
} {
  if (!Number.isInteger(input.repaymentPeriods) || input.repaymentPeriods <= 0) {
    throw AppError.unprocessable("repaymentPeriods must be a positive integer");
  }
  if (!Number.isFinite(input.interestPercentage) || input.interestPercentage < 0) {
    throw AppError.unprocessable("interestPercentage must be >= 0");
  }
  if (!Number.isFinite(input.repaymentAmount) || input.repaymentAmount <= 0) {
    throw AppError.unprocessable("repaymentAmount must be > 0");
  }
  if (input.repaymentMode === "weekly") {
    if (input.repaymentWeekday === null || input.repaymentWeekday === undefined ||
        !Number.isInteger(input.repaymentWeekday) || input.repaymentWeekday < 0 || input.repaymentWeekday > 6) {
      throw AppError.unprocessable("weekly terms require repaymentWeekday between 0 and 6");
    }
  } else if (input.repaymentWeekday !== null && input.repaymentWeekday !== undefined) {
    throw AppError.unprocessable("daily terms cannot include repaymentWeekday");
  }
  const calculatedInterest = Math.round(principalAmount * (input.interestPercentage / 100) * 100) / 100;
  const calculatedTotalRepayment = Math.round((principalAmount + calculatedInterest) * 100) / 100;
  const enteredTotal = Math.round(input.repaymentAmount * input.repaymentPeriods * 100) / 100;
  if (Math.round(enteredTotal * 100) !== Math.round(calculatedTotalRepayment * 100)) {
    throw AppError.unprocessable(
      `NOT TALLY: entered repayment total ${enteredTotal.toFixed(2)} does not equal ` +
      `the calculated contractual repayment ${calculatedTotalRepayment.toFixed(2)}`
    );
  }
  return {
    repaymentMode: input.repaymentMode,
    repaymentWeekday: input.repaymentMode === "weekly" ? input.repaymentWeekday! : null,
    repaymentPeriods: input.repaymentPeriods,
    interestPercentage: input.interestPercentage,
    repaymentAmount: input.repaymentAmount,
    calculatedInterest,
    calculatedTotalRepayment,
    tallyStatus: "matched"
  };
}

export interface SaveApplicationTermsInput extends LoanApplicationTermsInput {
  applicationId: string;
}

export async function saveApplicationTerms(
  actor: LoanActor,
  input: SaveApplicationTermsInput,
  meta: ActorMeta = {}
): Promise<ApplicationTermsRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const existing = await db.query<{ id: string; principal_amount: string; status: string; branch_id: string }>(
      `SELECT id, principal_amount, status, branch_id
         FROM loan_applications WHERE id=$1 FOR UPDATE`,
      [input.applicationId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const application = existing.rows[0]!;
    if (["disbursed", "withdrawn"].includes(application.status)) {
      throw AppError.conflict(
        `Loan terms cannot be changed once the application is '${application.status}'`
      );
    }
    const terms = calculateApplicationTerms(Number(application.principal_amount), input);

    await db.query(
      `INSERT INTO loan_application_terms
         (application_id, company_id, branch_id, repayment_mode, repayment_weekday,
          repayment_periods, interest_percentage, repayment_amount,
          calculated_interest, calculated_total_repayment, tally_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (application_id) DO UPDATE
         SET repayment_mode=EXCLUDED.repayment_mode,
             repayment_weekday=EXCLUDED.repayment_weekday,
             repayment_periods=EXCLUDED.repayment_periods,
             interest_percentage=EXCLUDED.interest_percentage,
             repayment_amount=EXCLUDED.repayment_amount,
             calculated_interest=EXCLUDED.calculated_interest,
             calculated_total_repayment=EXCLUDED.calculated_total_repayment,
             tally_status=EXCLUDED.tally_status`,
      [
        input.applicationId,
        actor.companyId,
        application.branch_id,
        terms.repaymentMode,
        terms.repaymentWeekday,
        terms.repaymentPeriods,
        terms.interestPercentage,
        terms.repaymentAmount,
        terms.calculatedInterest,
        terms.calculatedTotalRepayment,
        terms.tallyStatus
      ]
    );

    await auditLoan(
      db, actor.companyId, application.branch_id, actor.sub,
      "loan_application.terms_saved", "loan_applications", input.applicationId,
      null,
      {
        repayment_mode: terms.repaymentMode,
        repayment_weekday: terms.repaymentWeekday,
        repayment_periods: terms.repaymentPeriods,
        interest_percentage: terms.interestPercentage,
        repayment_amount: terms.repaymentAmount,
        calculated_interest: terms.calculatedInterest,
        calculated_total_repayment: terms.calculatedTotalRepayment,
        tally_status: terms.tallyStatus
      },
      "Repayment terms recorded for the application",
      meta
    );

    const saved = await db.query<ApplicationTermsRow>(
      `SELECT application_id, repayment_mode, repayment_weekday, repayment_periods,
              interest_percentage, repayment_amount, calculated_interest,
              calculated_total_repayment, tally_status
         FROM loan_application_terms WHERE application_id=$1`,
      [input.applicationId]
    );
    return saved.rows[0]!;
  });
}

export interface ApplicationGuarantorRow {
  id: string;
  loan_application_id: string;
  customer_id: string;
  full_name: string;
  relationship: string;
  phone: string;
  address: string;
  occupation: string | null;
  house_address: string | null;
  street: string | null;
  direction_to_house: string | null;
  local_area_known_as: string | null;
  shop_address: string | null;
  child_name: string | null;
  average_daily_income: string | null;
  average_monthly_income: string | null;
  identification_type: string | null;
  identification_number: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface SaveApplicationGuarantorInput {
  applicationId: string;
  fullName: string;
  relationship: string;
  phone: string;
  address: string;
  occupation?: string | null;
  houseAddress?: string | null;
  street?: string | null;
  directionToHouse?: string | null;
  localAreaKnownAs?: string | null;
  shopAddress?: string | null;
  childName?: string | null;
  averageDailyIncome?: number | null;
  averageMonthlyIncome?: number | null;
  identificationType?: string | null;
  identificationNumber?: string | null;
}

const GUARANTOR_COLUMNS = `id, loan_application_id, customer_id, full_name, relationship, phone,
  address, occupation, house_address, street, direction_to_house, local_area_known_as,
  shop_address, child_name, average_daily_income, average_monthly_income,
  identification_type, identification_number, status, created_at, updated_at`;

export async function saveApplicationGuarantor(
  actor: LoanActor,
  input: SaveApplicationGuarantorInput,
  meta: ActorMeta = {}
): Promise<ApplicationGuarantorRow> {
  const required: [string, string][] = [
    [input.fullName, "fullName"],
    [input.relationship, "relationship"],
    [input.phone, "phone"],
    [input.address, "address"]
  ];
  for (const [value, field] of required) {
    if (!value || !value.trim()) {
      throw AppError.unprocessable(`${field} is required for the guarantor`);
    }
  }
  if (input.averageDailyIncome !== null && input.averageDailyIncome !== undefined &&
      (!Number.isFinite(input.averageDailyIncome) || input.averageDailyIncome < 0)) {
    throw AppError.unprocessable("averageDailyIncome must be >= 0");
  }
  if (input.averageMonthlyIncome !== null && input.averageMonthlyIncome !== undefined &&
      (!Number.isFinite(input.averageMonthlyIncome) || input.averageMonthlyIncome < 0)) {
    throw AppError.unprocessable("averageMonthlyIncome must be >= 0");
  }

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{
      id: string; branch_id: string; customer_id: string; status: string; submitted_by: string;
    }>(
      `SELECT id, branch_id, customer_id, status, submitted_by
         FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = application.rows[0]!;
    if (["disbursed", "withdrawn"].includes(app.status)) {
      throw AppError.conflict(`The guarantor cannot be changed once the application is '${app.status}'`);
    }

    const previous = await db.query<{ id: string; full_name: string; status: string }>(
      `SELECT id, full_name, status FROM loan_application_guarantors
        WHERE loan_application_id=$1 AND status='active'
        FOR UPDATE`,
      [input.applicationId]
    );
    const supersedes = (previous.rowCount ?? 0) > 0 ? previous.rows[0]!.id : null;
    if (supersedes) {
      await db.query(
        `UPDATE loan_application_guarantors SET status='superseded' WHERE id=$1 AND status='active'`,
        [supersedes]
      );
    }

    const inserted = await db.query<ApplicationGuarantorRow>(
      `INSERT INTO loan_application_guarantors
         (company_id, branch_id, loan_application_id, customer_id, full_name, relationship,
          phone, address, occupation, house_address, street, direction_to_house,
          local_area_known_as, shop_address, child_name, average_daily_income,
          average_monthly_income, identification_type, identification_number,
          status, supersedes_guarantor_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'active',$20,$21)
       RETURNING ${GUARANTOR_COLUMNS}`,
      [
        actor.companyId, app.branch_id, app.id, app.customer_id,
        input.fullName.trim(), input.relationship.trim(), input.phone.trim(), input.address.trim(),
        input.occupation ?? null, input.houseAddress ?? null, input.street ?? null,
        input.directionToHouse ?? null, input.localAreaKnownAs ?? null, input.shopAddress ?? null,
        input.childName ?? null, input.averageDailyIncome ?? null, input.averageMonthlyIncome ?? null,
        input.identificationType ?? null, input.identificationNumber ?? null,
        supersedes, actor.sub
      ]
    );
    const guarantor = inserted.rows[0]!;

    // RULE 19.4.3 — the guarantor is a first-class party, so the information
    // captured on the guarantor is also held as that party's information record.
    // The stage save may complete it later; neither write destroys the other.
    await db.query(
      `INSERT INTO loan_application_party_information
         (company_id, branch_id, loan_application_id, customer_id, party, guarantor_id,
          occupation, house_address, street, direction_to_house, child_name,
          local_area_known_as, shop_address, average_daily_income, average_monthly_income,
          saved_by)
       VALUES ($1,$2,$3,$4,'guarantor',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (loan_application_id, party) DO UPDATE
         SET guarantor_id=EXCLUDED.guarantor_id,
             occupation=COALESCE(EXCLUDED.occupation, loan_application_party_information.occupation),
             house_address=COALESCE(EXCLUDED.house_address, loan_application_party_information.house_address),
             street=COALESCE(EXCLUDED.street, loan_application_party_information.street),
             direction_to_house=COALESCE(EXCLUDED.direction_to_house, loan_application_party_information.direction_to_house),
             child_name=COALESCE(EXCLUDED.child_name, loan_application_party_information.child_name),
             local_area_known_as=COALESCE(EXCLUDED.local_area_known_as, loan_application_party_information.local_area_known_as),
             shop_address=COALESCE(EXCLUDED.shop_address, loan_application_party_information.shop_address),
             average_daily_income=COALESCE(EXCLUDED.average_daily_income, loan_application_party_information.average_daily_income),
             average_monthly_income=COALESCE(EXCLUDED.average_monthly_income, loan_application_party_information.average_monthly_income),
             saved_by=EXCLUDED.saved_by,
             saved_at=now()`,
      [
        actor.companyId, app.branch_id, app.id, app.customer_id, guarantor.id,
        guarantor.occupation, guarantor.house_address, guarantor.street,
        guarantor.direction_to_house, guarantor.child_name, guarantor.local_area_known_as,
        guarantor.shop_address, guarantor.average_daily_income, guarantor.average_monthly_income,
        actor.sub
      ]
    );

    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "loan_application.guarantor_saved", "loan_applications", app.id,
      (previous.rowCount ?? 0) > 0 ? previous.rows[0]! : null,
      {
        guarantor_id: guarantor.id,
        full_name: guarantor.full_name,
        relationship: guarantor.relationship,
        phone: guarantor.phone,
        address: guarantor.address,
        supersedes_guarantor_id: supersedes
      },
      supersedes ? "Guarantor replaced on the application" : "Guarantor recorded on the application",
      meta
    );
    return guarantor;
  });
}

export async function getActiveApplicationGuarantor(
  actor: LoanActor,
  applicationId: string
): Promise<ApplicationGuarantorRow | null> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const row = await db.query<ApplicationGuarantorRow>(
      `SELECT ${GUARANTOR_COLUMNS} FROM loan_application_guarantors
        WHERE loan_application_id=$1 AND status='active'`,
      [applicationId]
    );
    return (row.rowCount ?? 0) > 0 ? row.rows[0]! : null;
  });
}

export async function listApplicationGuarantors(
  actor: LoanActor,
  applicationId: string
): Promise<ApplicationGuarantorRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const { rows } = await db.query<ApplicationGuarantorRow>(
      `SELECT ${GUARANTOR_COLUMNS} FROM loan_application_guarantors
        WHERE loan_application_id=$1 ORDER BY created_at DESC`,
      [applicationId]
    );
    return rows;
  });
}

export interface ApplicationPartyInformationRow {
  id: string;
  loan_application_id: string;
  customer_id: string;
  party: "customer" | "guarantor";
  guarantor_id: string | null;
  next_of_kin_name: string | null;
  next_of_kin_relationship: string | null;
  next_of_kin_phone: string | null;
  occupation: string | null;
  house_address: string | null;
  street: string | null;
  direction_to_house: string | null;
  child_name: string | null;
  local_area_known_as: string | null;
  shop_address: string | null;
  average_daily_income: string | null;
  average_monthly_income: string | null;
  saved_at: Date;
  updated_at: Date;
}

const PARTY_INFORMATION_COLUMNS = `id, loan_application_id, customer_id, party, guarantor_id,
  next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, occupation, house_address,
  street, direction_to_house, child_name, local_area_known_as, shop_address,
  average_daily_income, average_monthly_income, saved_at, updated_at`;

/**
 * RULE 19.4.2 — the required information for each party must actually be on
 * record before the application may advance. A saved-but-blank row is not a
 * completed form, so every required field is checked and the missing ones are
 * named.
 */
export function missingPartyInformation(
  row: ApplicationPartyInformationRow | null,
  party: "customer" | "guarantor"
): string[] {
  if (row === null) {
    return [
      party === "customer"
        ? "The customer's required application information has not been saved yet"
        : "The guarantor's required application information has not been saved yet"
    ];
  }
  const required: [string, unknown][] = [
    ["next_of_kin_name", row.next_of_kin_name],
    ["next_of_kin_relationship", row.next_of_kin_relationship],
    ["next_of_kin_phone", row.next_of_kin_phone],
    ["occupation", row.occupation],
    ["house_address", row.house_address],
    ["street", row.street],
    ["direction_to_house", row.direction_to_house]
  ];
  if (party === "guarantor") {
    required.push(
      ["average_daily_income", row.average_daily_income],
      ["average_monthly_income", row.average_monthly_income]
    );
  } else {
    required.push(
      ["local_area_known_as", row.local_area_known_as],
      ["shop_address", row.shop_address]
    );
  }
  return required
    .filter(([, value]) => value === null || String(value).trim() === "")
    .map(([field]) => field);
}

export async function saveApplicationPartyInformation(
  actor: LoanActor,
  input: {
    applicationId: string;
    party: "customer" | "guarantor";
    nextOfKinName?: string | null;
    nextOfKinRelationship?: string | null;
    nextOfKinPhone?: string | null;
    occupation?: string | null;
    houseAddress?: string | null;
    street?: string | null;
    directionToHouse?: string | null;
    childName?: string | null;
    localAreaKnownAs?: string | null;
    shopAddress?: string | null;
    averageDailyIncome?: number | null;
    averageMonthlyIncome?: number | null;
  },
  meta: ActorMeta = {}
): Promise<ApplicationPartyInformationRow> {
  if (input.party !== "customer" && input.party !== "guarantor") {
    throw AppError.unprocessable("party must be customer or guarantor");
  }
  for (const [value, field] of [
    [input.averageDailyIncome, "averageDailyIncome"],
    [input.averageMonthlyIncome, "averageMonthlyIncome"]
  ] as [number | null | undefined, string][]) {
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw AppError.unprocessable(`${field} must be >= 0`);
    }
  }

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{
      id: string; branch_id: string; customer_id: string; status: string;
    }>(
      `SELECT id, branch_id, customer_id, status FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = application.rows[0]!;
    if (["disbursed", "withdrawn"].includes(app.status)) {
      throw AppError.conflict(
        `Party information cannot be changed once the application is '${app.status}'`
      );
    }

    let guarantorId: string | null = null;
    if (input.party === "guarantor") {
      const guarantor = await db.query<{ id: string }>(
        `SELECT id FROM loan_application_guarantors
          WHERE loan_application_id=$1 AND status='active'`,
        [input.applicationId]
      );
      if ((guarantor.rowCount ?? 0) === 0) {
        throw AppError.conflict(
          "Record the guarantor before saving guarantor information (RULE 19.4.3)"
        );
      }
      guarantorId = guarantor.rows[0]!.id;
    }

    const saved = await db.query<ApplicationPartyInformationRow>(
      `INSERT INTO loan_application_party_information
         (company_id, branch_id, loan_application_id, customer_id, party, guarantor_id,
          next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, occupation,
          house_address, street, direction_to_house, child_name, local_area_known_as,
          shop_address, average_daily_income, average_monthly_income, saved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (loan_application_id, party) DO UPDATE
         SET guarantor_id=EXCLUDED.guarantor_id,
             next_of_kin_name=EXCLUDED.next_of_kin_name,
             next_of_kin_relationship=EXCLUDED.next_of_kin_relationship,
             next_of_kin_phone=EXCLUDED.next_of_kin_phone,
             occupation=EXCLUDED.occupation,
             house_address=EXCLUDED.house_address,
             street=EXCLUDED.street,
             direction_to_house=EXCLUDED.direction_to_house,
             child_name=EXCLUDED.child_name,
             local_area_known_as=EXCLUDED.local_area_known_as,
             shop_address=EXCLUDED.shop_address,
             average_daily_income=EXCLUDED.average_daily_income,
             average_monthly_income=EXCLUDED.average_monthly_income,
             saved_by=EXCLUDED.saved_by,
             saved_at=now()
       RETURNING ${PARTY_INFORMATION_COLUMNS}`,
      [
        actor.companyId, app.branch_id, app.id, app.customer_id, input.party, guarantorId,
        input.nextOfKinName ?? null, input.nextOfKinRelationship ?? null, input.nextOfKinPhone ?? null,
        input.occupation ?? null, input.houseAddress ?? null, input.street ?? null,
        input.directionToHouse ?? null, input.childName ?? null, input.localAreaKnownAs ?? null,
        input.shopAddress ?? null, input.averageDailyIncome ?? null, input.averageMonthlyIncome ?? null,
        actor.sub
      ]
    );
    const row = saved.rows[0]!;

    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "loan_application.party_information_saved", "loan_applications", app.id,
      null,
      {
        party: row.party,
        next_of_kin_name: row.next_of_kin_name,
        occupation: row.occupation,
        house_address: row.house_address,
        street: row.street,
        direction_to_house: row.direction_to_house,
        child_name: row.child_name,
        local_area_known_as: row.local_area_known_as,
        shop_address: row.shop_address,
        average_daily_income: row.average_daily_income,
        average_monthly_income: row.average_monthly_income
      },
      "Application party information saved",
      meta
    );
    return row;
  });
}

async function upsertPartyInformationFromStage(
  db: pg.PoolClient,
  actor: LoanActor,
  app: { id: string; branch_id: string; customer_id: string },
  party: "customer" | "guarantor",
  payload: Record<string, unknown>,
  meta: ActorMeta
): Promise<void> {
  let guarantorId: string | null = null;
  if (party === "guarantor") {
    const guarantor = await db.query<{ id: string }>(
      `SELECT id FROM loan_application_guarantors
        WHERE loan_application_id=$1 AND status='active'`,
      [app.id]
    );
    if ((guarantor.rowCount ?? 0) === 0) {
      throw AppError.conflict(
        "Record the guarantor before completing guarantor information (RULE 19.4.3)"
      );
    }
    guarantorId = guarantor.rows[0]!.id;
  }

  const read = (key: string): string | number | null => {
    const value = payload[key];
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value).trim();
    return text === "" ? null : text;
  };

  const numeric = (key: string): number | null => {
    const value = read(key);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  await db.query(
    `INSERT INTO loan_application_party_information
       (company_id, branch_id, loan_application_id, customer_id, party, guarantor_id,
        next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, occupation,
        house_address, street, direction_to_house, child_name, local_area_known_as,
        shop_address, average_daily_income, average_monthly_income, saved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (loan_application_id, party) DO UPDATE
       SET guarantor_id=EXCLUDED.guarantor_id,
           next_of_kin_name=COALESCE(EXCLUDED.next_of_kin_name, loan_application_party_information.next_of_kin_name),
           next_of_kin_relationship=COALESCE(EXCLUDED.next_of_kin_relationship, loan_application_party_information.next_of_kin_relationship),
           next_of_kin_phone=COALESCE(EXCLUDED.next_of_kin_phone, loan_application_party_information.next_of_kin_phone),
           occupation=COALESCE(EXCLUDED.occupation, loan_application_party_information.occupation),
           house_address=COALESCE(EXCLUDED.house_address, loan_application_party_information.house_address),
           street=COALESCE(EXCLUDED.street, loan_application_party_information.street),
           direction_to_house=COALESCE(EXCLUDED.direction_to_house, loan_application_party_information.direction_to_house),
           child_name=COALESCE(EXCLUDED.child_name, loan_application_party_information.child_name),
           local_area_known_as=COALESCE(EXCLUDED.local_area_known_as, loan_application_party_information.local_area_known_as),
           shop_address=COALESCE(EXCLUDED.shop_address, loan_application_party_information.shop_address),
           average_daily_income=COALESCE(EXCLUDED.average_daily_income, loan_application_party_information.average_daily_income),
           average_monthly_income=COALESCE(EXCLUDED.average_monthly_income, loan_application_party_information.average_monthly_income),
           saved_by=EXCLUDED.saved_by,
           saved_at=now()`,
    [
      actor.companyId, app.branch_id, app.id, app.customer_id, party, guarantorId,
      read("nextOfKinName"), read("nextOfKinRelationship"), read("nextOfKinPhone"),
      read("occupation"), read("houseAddress") ?? read("address"), read("street"),
      read("directionToLocate") ?? read("directionToHouse"), read("childName"),
      read("localAreaKnownAs"), read("shopAddress"),
      numeric("averageDailyIncome"), numeric("averageMonthlyIncome"),
      actor.sub
    ]
  );
  await auditLoan(
    db, actor.companyId, app.branch_id, actor.sub,
    "loan_application.party_information_saved", "loan_applications", app.id,
    null,
    { party, source: "information_stage" },
    "Application party information recorded from the completed information stage",
    meta
  );
}

export async function getApplicationPartyInformation(
  actor: LoanActor,
  applicationId: string
): Promise<Record<"customer" | "guarantor", ApplicationPartyInformationRow | null>> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string }>(
      `SELECT id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const { rows } = await db.query<ApplicationPartyInformationRow>(
      `SELECT ${PARTY_INFORMATION_COLUMNS} FROM loan_application_party_information
        WHERE loan_application_id=$1`,
      [applicationId]
    );
    return {
      customer: rows.find((row) => row.party === "customer") ?? null,
      guarantor: rows.find((row) => row.party === "guarantor") ?? null
    };
  });
}

export interface ApplicationPreviewLoanHistoryLoan {
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
  schedule: Array<{
    id: string;
    cycle_number: number;
    due_date: string;
    expected_repayment: string;
    expected_savings: string;
    actual_repayment: string;
    actual_savings: string;
    paid_at: Date | null;
  }>;
}

export async function getApplicationPreview(
  actor: LoanActor,
  applicationId: string
): Promise<{
  application: ApplicationRow;
  customer: {
    id: string;
    customerCode: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    branchId: string;
    status: string;
  } | null;
  guarantor: ApplicationGuarantorRow | null;
  guarantorHistory: ApplicationGuarantorRow[];
  partyInformation: Record<"customer" | "guarantor", ApplicationPartyInformationRow | null>;
  group: {
    id: string;
    name: string;
    groupNumber: string | null;
    groupAddress: string | null;
    role: string | null;
  } | null;
  loanCycle: {
    cycleNumber: number;
    isReturningCustomer: boolean;
    priorLoanCount: number;
    completedLoanCount: number;
  };
  previousLoanHistory: ApplicationPreviewLoanHistoryLoan[];
  savingsBalance: string | null;
  terms: ApplicationTermsRow | null;
  bankDetails: ApplicationBankDetailsRow | null;
  fees: ApplicationFeeRow[];
  stages: { resumeStageKey: string | null; stages: ApplicationStageRow[] };
  evidence: Awaited<ReturnType<typeof listLoanApplicationEvidence>>;
  missingEvidence: string[];
  /** Information stages that must be completed before the form is ready. */
  missingPartyInformation: string[];
  readyForSubmission: boolean;
}> {
  const application = await getApplication(actor, applicationId);
  const [terms, bankDetails, fees, stages, evidence] = await Promise.all([
    getApplicationTerms(actor, applicationId),
    getApplicationBankDetails(actor, applicationId),
    getApplicationFees(actor, applicationId),
    getApplicationStages(actor, applicationId),
    listLoanApplicationEvidence(actor, applicationId)
  ]);

  const applicationIdValue = applicationId;
  const context = await withTenant(actor.companyId, actor.branchId, async (db) => {
    const customer = await db.query<{
      id: string;
      customer_code: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      phone: string | null;
      email: string | null;
      address: string | null;
      branch_id: string;
      status: string;
    }>(
      `SELECT id, customer_code, first_name, middle_name, last_name, phone, email,
              address, branch_id, status
         FROM customers WHERE id=$1`,
      [application.customer_id]
    );

    const membership = await db.query<{
      group_id: string;
      name: string;
      group_number: string | null;
      group_address: string | null;
      group_role: string | null;
    }>(
      `SELECT g.id AS group_id, g.name, g.group_number, g.group_address, gm.group_role
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
        WHERE gm.customer_id=$1 AND g.status='active'
        ORDER BY gm.joined_at ASC LIMIT 1`,
      [application.customer_id]
    );

    const previousLoans = await db.query<Omit<ApplicationPreviewLoanHistoryLoan, "schedule">>(
      `SELECT id, application_id, product_id, principal_amount, outstanding_principal,
              interest_rate, cycle_days, cycle_count, status, disbursed_at, completed_at
         FROM loans
        WHERE customer_id=$1 AND application_id <> $2
        ORDER BY disbursed_at DESC`,
      [application.customer_id, applicationIdValue]
    );
    const previousLoanIds = previousLoans.rows.map((loan) => loan.id);
    const previousSchedules = previousLoanIds.length > 0
      ? await db.query<{
          id: string; loan_id: string; cycle_number: number; due_date: string;
          expected_repayment: string; expected_savings: string;
          actual_repayment: string; actual_savings: string; paid_at: Date | null;
        }>(
          `SELECT id, loan_id, cycle_number, to_char(due_date,'YYYY-MM-DD') AS due_date,
                  expected_repayment, expected_savings, actual_repayment, actual_savings, paid_at
             FROM repayment_schedule_rows WHERE loan_id=ANY($1::uuid[])
            ORDER BY loan_id, cycle_number`,
          [previousLoanIds]
        )
      : { rows: [] as Array<{
          id: string; loan_id: string; cycle_number: number; due_date: string;
          expected_repayment: string; expected_savings: string;
          actual_repayment: string; actual_savings: string; paid_at: Date | null;
        }> };

    const savings = await db.query<{ balance: string }>(
      `SELECT COALESCE(balance,0)::text AS balance
         FROM savings_accounts WHERE customer_id=$1 AND status='active'
        ORDER BY created_at DESC LIMIT 1`,
      [application.customer_id]
    );

    return {
      customer: (customer.rowCount ?? 0) > 0
        ? {
            id: customer.rows[0]!.id,
            customerCode: customer.rows[0]!.customer_code,
            fullName: [customer.rows[0]!.first_name, customer.rows[0]!.middle_name, customer.rows[0]!.last_name]
              .filter(Boolean).join(" "),
            phone: customer.rows[0]!.phone,
            email: customer.rows[0]!.email,
            address: customer.rows[0]!.address,
            branchId: customer.rows[0]!.branch_id,
            status: customer.rows[0]!.status
          }
        : null,
      group: (membership.rowCount ?? 0) > 0
        ? {
            id: membership.rows[0]!.group_id,
            name: membership.rows[0]!.name,
            groupNumber: membership.rows[0]!.group_number,
            groupAddress: membership.rows[0]!.group_address,
            role: membership.rows[0]!.group_role
          }
        : null,
      previousLoanHistory: previousLoans.rows.map((loan) => ({
        ...loan,
        schedule: previousSchedules.rows
          .filter((row) => row.loan_id === loan.id)
          .map(({ loan_id: _loanId, ...row }) => row)
      })),
      savingsBalance: (savings.rowCount ?? 0) > 0 ? savings.rows[0]!.balance : null
    };
  });

  const [guarantor, guarantorHistory, partyInformation] = await Promise.all([
    getActiveApplicationGuarantor(actor, applicationId),
    listApplicationGuarantors(actor, applicationId),
    getApplicationPartyInformation(actor, applicationId)
  ]);

  const requiredEvidence = ["government_id", "house", "business", "loan_form", "default_form"];
  const missingEvidence: string[] = [];
  for (const type of requiredEvidence) {
    for (const party of ["customer", "guarantor"] as const) {
      if (!evidence.some((row) => row.evidence_type === type && row.party === party && row.verification_status === "verified")) {
        missingEvidence.push(`${type}:${party}`);
      }
    }
  }
  // RULE 19.4.2 — the required party information must be saved, and the
  // authoritative checkpoint for that is the completed stage (RULE 19.6.2), so
  // readiness reads the stage rather than trusting a separate record.
  const stageByKey = new Map(stages.stages.map((row) => [row.stage_key, row]));
  const informationStagesComplete = (["customer_info", "guarantor_info"] as const).every(
    (key) => stageByKey.get(key)?.status === "completed"
  );
  const outstandingStageKeys = (["customer_info", "guarantor_info"] as const)
    .filter((key) => stageByKey.get(key)?.status !== "completed")
    .map((key) => key);
  const readyForSubmission =
    terms?.tally_status === "matched" &&
    bankDetails?.match_status === "matched" &&
    guarantor !== null &&
    missingEvidence.length === 0 &&
    informationStagesComplete;

  return {
    application,
    customer: context.customer,
    guarantor,
    guarantorHistory,
    partyInformation,
    group: context.group,
    loanCycle: {
      cycleNumber: context.previousLoanHistory.length + 1,
      isReturningCustomer: context.previousLoanHistory.length > 0,
      priorLoanCount: context.previousLoanHistory.length,
      completedLoanCount: context.previousLoanHistory.filter((loan) => loan.status === "completed").length
    },
    previousLoanHistory: context.previousLoanHistory,
    savingsBalance: context.savingsBalance,
    terms,
    bankDetails,
    fees,
    stages,
    evidence,
    missingEvidence,
    missingPartyInformation: outstandingStageKeys,
    readyForSubmission
  };
}

export interface ApplicationBankDetailsRow {
  application_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  identity_name: string;
  match_status: "matched" | "mismatch";
  created_at: Date;
}

function normalizeIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function saveApplicationBankDetails(
  actor: LoanActor,
  input: {
    applicationId: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
    identityName: string;
  },
  meta: ActorMeta = {}
): Promise<ApplicationBankDetailsRow> {
  if (!input.bankName?.trim() || !input.accountNumber?.trim() ||
      !input.accountName?.trim() || !input.identityName?.trim()) {
    throw AppError.unprocessable("bankName, accountNumber, accountName and identityName are required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{
      id: string; branch_id: string; customer_id: string; status: string;
    }>(
      `SELECT id, branch_id, customer_id, status FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = application.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== app.branch_id) {
      throw AppError.forbidden("Cannot edit bank details for another branch's application");
    }
    if (app.status === "disbursed" || app.status === "withdrawn") {
      throw AppError.conflict(`Bank details cannot be changed after the application is '${app.status}'`);
    }
    const customer = await db.query<{
      first_name: string; middle_name: string | null; last_name: string;
    }>(
      `SELECT first_name, middle_name, last_name FROM customers WHERE id=$1`,
      [app.customer_id]
    );
    if ((customer.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const expectedName = fullName(
      customer.rows[0]!.first_name,
      customer.rows[0]!.middle_name,
      customer.rows[0]!.last_name
    );
    const matchStatus = normalizeIdentity(input.accountName) === normalizeIdentity(expectedName) &&
      normalizeIdentity(input.identityName) === normalizeIdentity(expectedName)
      ? "matched"
      : "mismatch";
    await db.query(
      `INSERT INTO loan_application_bank_details
         (application_id, company_id, branch_id, bank_name, account_number,
          account_name, identity_name, match_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (application_id) DO NOTHING`,
      [
        app.id,
        actor.companyId,
        app.branch_id,
        input.bankName.trim(),
        input.accountNumber.trim(),
        input.accountName.trim(),
        input.identityName.trim(),
        matchStatus,
        actor.sub
      ]
    );
    const saved = await db.query<ApplicationBankDetailsRow>(
      `SELECT application_id, bank_name, account_number, account_name, identity_name,
              match_status, created_at
         FROM loan_application_bank_details WHERE application_id=$1`,
      [app.id]
    );
    const row = saved.rows[0]!;
    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "loan_application.bank_details_recorded", "loan_application_bank_details", app.id,
      null,
      {
        application_id: app.id,
        bank_name: row.bank_name,
        account_number: row.account_number,
        account_name: row.account_name,
        identity_name: row.identity_name,
        match_status: row.match_status
      },
      null, meta
    );
    return row;
  });
}

export async function getApplicationBankDetails(
  actor: LoanActor,
  applicationId: string
): Promise<ApplicationBankDetailsRow | null> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string }>(
      `SELECT id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const row = await db.query<ApplicationBankDetailsRow>(
      `SELECT application_id, bank_name, account_number, account_name, identity_name,
              match_status, created_at
         FROM loan_application_bank_details WHERE application_id=$1`,
      [applicationId]
    );
    return (row.rowCount ?? 0) > 0 ? row.rows[0]! : null;
  });
}

export async function requireMatchedBankDetails(
  db: pg.PoolClient,
  companyId: string,
  applicationId: string
): Promise<void> {
  const row = await db.query<{ match_status: string }>(
    `SELECT match_status FROM loan_application_bank_details
      WHERE company_id=$1 AND application_id=$2`,
    [companyId, applicationId]
  );
  if ((row.rowCount ?? 0) === 0) {
    throw AppError.conflict("Verified customer bank details are required before disbursement");
  }
  if (row.rows[0]!.match_status !== "matched") {
    throw AppError.conflict("Customer bank details do not match the verified application identity");
  }
}

export interface ApplicationFeeRow {
  id: string;
  application_id: string;
  fee_type: string;
  amount: string;
  status: string;
  financial_payment_id: string | null;
  created_at: Date;
}

export async function saveApplicationFee(
  actor: LoanActor,
  input: {
    applicationId: string;
    feeType: string;
    amount: number;
    status: "obligation" | "waived" | "pending_payment";
  },
  meta: ActorMeta = {}
): Promise<ApplicationFeeRow> {
  if (!input.feeType?.trim() || input.feeType.trim().length < 2) {
    throw AppError.unprocessable("feeType is required");
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw AppError.unprocessable("amount must be >= 0");
  }
  if (!["obligation", "waived", "pending_payment"].includes(input.status)) {
    throw AppError.unprocessable("invalid fee status");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string; branch_id: string; status: string }>(
      `SELECT id, branch_id, status FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = application.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== app.branch_id) {
      throw AppError.forbidden("Cannot add fees to another branch's application");
    }
    if (app.status === "disbursed" || app.status === "withdrawn") {
      throw AppError.conflict(`Fees cannot be changed after the application is '${app.status}'`);
    }
    await db.query(
      `INSERT INTO loan_application_fees
         (application_id, company_id, branch_id, fee_type, amount, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (application_id, fee_type) DO NOTHING`,
      [app.id, actor.companyId, app.branch_id, input.feeType.trim(), input.amount, input.status, actor.sub]
    );
    const row = await db.query<ApplicationFeeRow>(
      `SELECT id, application_id, fee_type, amount, status, financial_payment_id, created_at
         FROM loan_application_fees WHERE application_id=$1 AND fee_type=$2`,
      [app.id, input.feeType.trim()]
    );
    const fee = row.rows[0]!;
    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "loan_application.fee_recorded", "loan_application_fees", fee.id,
      null,
      { application_id: app.id, fee_type: fee.fee_type, amount: fee.amount, status: fee.status,
        financial_payment_id: fee.financial_payment_id },
      null, meta
    );
    return fee;
  });
}

export async function getApplicationFees(
  actor: LoanActor,
  applicationId: string
): Promise<ApplicationFeeRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string }>(
      `SELECT id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const rows = await db.query<ApplicationFeeRow>(
      `SELECT id, application_id, fee_type, amount, status, financial_payment_id, created_at
         FROM loan_application_fees WHERE application_id=$1 ORDER BY created_at`,
      [applicationId]
    );
    return rows.rows;
  });
}

export type ApplicationStageKey =
  | "customer_info"
  | "guarantor_info"
  | "loan_terms"
  | "identity_documents"
  | "house"
  | "business"
  | "bank_details"
  | "final_preview";

const APPLICATION_STAGE_SEQUENCE: Record<ApplicationStageKey, number> = {
  customer_info: 1,
  guarantor_info: 2,
  loan_terms: 3,
  identity_documents: 4,
  house: 5,
  business: 6,
  bank_details: 7,
  final_preview: 8
};

const APPLICATION_STAGE_REQUIRED_FIELDS: Partial<Record<ApplicationStageKey, string[]>> = {
  customer_info: [
    "nextOfKinName",
    "occupation",
    "address",
    "directionToLocate",
    "localAreaKnownAs",
    "shopAddress",
    "averageDailyIncome",
    "averageMonthlyIncome"
  ],
  guarantor_info: [
    "fullName",
    "fatherHusbandName",
    "maritalStatus",
    "phone",
    "address"
  ]
};

export interface ApplicationStageRow {
  id: string;
  application_id: string;
  stage_key: string;
  sequence: number;
  status: string;
  payload: Record<string, unknown>;
  saved_at: Date;
  updated_at: Date;
}

function hasStageFields(payload: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => {
    const value = payload[field];
    return value !== undefined && value !== null && String(value).trim().length > 0;
  });
}

export async function saveApplicationStage(
  actor: LoanActor,
  applicationId: string,
  input: {
    stageKey: ApplicationStageKey;
    status: "draft" | "saved" | "completed";
    payload: Record<string, unknown>;
  },
  meta: ActorMeta = {}
): Promise<ApplicationStageRow> {
  if (!Object.prototype.hasOwnProperty.call(APPLICATION_STAGE_SEQUENCE, input.stageKey)) {
    throw AppError.unprocessable("Unknown application stage");
  }
  if (!["draft", "saved", "completed"].includes(input.status)) {
    throw AppError.unprocessable("Invalid application stage status");
  }
  const required = APPLICATION_STAGE_REQUIRED_FIELDS[input.stageKey] ?? [];
  if (input.status === "completed" && !hasStageFields(input.payload, required)) {
    throw AppError.unprocessable(
      `Stage '${input.stageKey}' cannot be completed until required fields are saved`
    );
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string; branch_id: string; customer_id: string; status: string }>(
      `SELECT id, branch_id, customer_id, status FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = application.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== app.branch_id) {
      throw AppError.forbidden("Cannot edit another branch's application stage");
    }
    if (app.status === "disbursed" || app.status === "withdrawn") {
      throw AppError.conflict(`Application stages cannot be changed after '${app.status}'`);
    }
    const saved = await db.query<ApplicationStageRow>(
      `INSERT INTO loan_application_stages
         (application_id, company_id, branch_id, stage_key, sequence, status, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (application_id, stage_key) DO UPDATE
         SET status=EXCLUDED.status, payload=EXCLUDED.payload, saved_at=now(), updated_at=now()
       RETURNING id, application_id, stage_key, sequence, status, payload, saved_at, updated_at`,
      [
        applicationId,
        actor.companyId,
        app.branch_id,
        input.stageKey,
        APPLICATION_STAGE_SEQUENCE[input.stageKey],
        input.status,
        JSON.stringify(input.payload)
      ]
    );
    const stage = saved.rows[0]!;

    // RULE 19.4.3 — the information stage is also the first-class party record,
    // written from the same authoritative save, so the guarantor is a real
    // party with its own information rather than a text field.
    if (input.status === "completed" && (input.stageKey === "customer_info" || input.stageKey === "guarantor_info")) {
      await upsertPartyInformationFromStage(
        db,
        actor,
        app,
        input.stageKey === "customer_info" ? "customer" : "guarantor",
        input.payload,
        meta
      );
    }

    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "loan_application.stage_saved", "loan_applications", applicationId,
      null,
      { stage_key: stage.stage_key, status: stage.status, payload: stage.payload },
      null, meta
    );
    return stage;
  });
}

export async function getApplicationStages(
  actor: LoanActor,
  applicationId: string
): Promise<{ resumeStageKey: string | null; stages: ApplicationStageRow[] }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string }>(
      `SELECT id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const rows = await db.query<ApplicationStageRow>(
      `SELECT id, application_id, stage_key, sequence, status, payload, saved_at, updated_at
         FROM loan_application_stages WHERE application_id=$1 ORDER BY sequence`,
      [applicationId]
    );
    const completed = rows.rows.filter((row) => row.status === "completed");
    const last = completed[completed.length - 1];
    const next = Object.entries(APPLICATION_STAGE_SEQUENCE)
      .sort((a, b) => a[1] - b[1])
      .find(([key]) => !completed.some((row) => row.stage_key === key));
    return {
      resumeStageKey: next ? next[0] : last?.stage_key ?? null,
      stages: rows.rows
    };
  });
}

export async function createApplication(
  actor: LoanActor,
  input: CreateApplicationInput,
  meta: ActorMeta = {}
): Promise<ApplicationRow> {
  if (!input.customerId) throw AppError.unprocessable("customerId is required");
  if (!input.productId) throw AppError.unprocessable("productId is required");
  if (input.principalAmount <= 0) {
    throw AppError.unprocessable("principalAmount must be > 0");
  }

  return withTenant(actor.companyId, null, async (db) => {
    const cust = await db.query<{ id: string; branch_id: string; status: string }>(
      `SELECT id, branch_id, status FROM customers WHERE id=$1`,
      [input.customerId]
    );
    if ((cust.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const customer = cust.rows[0]!;
    if (customer.status !== "active") {
      throw AppError.conflict(
        `A loan application cannot be created while the customer status is '${customer.status}'`
      );
    }

    const activeLoan = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM loans
        WHERE customer_id=$1 AND status IN ('active','overdue')
        LIMIT 1`,
      [customer.id]
    );
    if ((activeLoan.rowCount ?? 0) > 0) {
      throw AppError.conflict(
        "This customer already has an active loan; complete the current loan cycle before applying again"
      );
    }

    if (actor.branchId !== null && actor.branchId !== customer.branch_id) {
      throw AppError.forbidden(
        "A branch-scoped session cannot submit an application for a customer in a different branch"
      );
    }

    await requireVerifiedFaceCapture(db, {
      companyId: actor.companyId,
      customerId: customer.id,
      captureFor: "registration",
      party: "customer",
      label: "A verified customer registration face capture"
    });
    await requireVerifiedFaceCapture(db, {
      companyId: actor.companyId,
      customerId: customer.id,
      captureFor: "registration",
      party: "guarantor",
      label: "A verified guarantor registration face capture"
    });

    // RULE 7.9.3 — a closed or not-yet-open branch takes no new loans.
    await assertBranchAcceptsNewWork(db, customer.branch_id, "loans");

    const product = await db.query<{
      id: string;
      min_principal: string;
      max_principal: string;
      approval_chain_id: string;
      is_active: boolean;
    }>(
      `SELECT id, min_principal, max_principal, approval_chain_id, is_active
         FROM loan_products WHERE id=$1`,
      [input.productId]
    );
    if ((product.rowCount ?? 0) === 0) throw AppError.notFound("Loan product not found");
    const p = product.rows[0]!;
    if (!p.is_active) throw AppError.unprocessable("Loan product is not active");
    if (input.principalAmount < Number(p.min_principal) ||
        input.principalAmount > Number(p.max_principal)) {
      throw AppError.unprocessable(
        `principalAmount must be between ${p.min_principal} and ${p.max_principal}`
      );
    }

    const firstStage = await db.query<{ stage_order: number }>(
      `SELECT MIN(stage_order) AS stage_order FROM approval_chain_steps WHERE chain_id=$1`,
      [p.approval_chain_id]
    );
    const currentStage = firstStage.rows[0]?.stage_order ?? null;
    const terms = input.terms
      ? calculateApplicationTerms(input.principalAmount, input.terms)
      : null;

    const inserted = await db.query<ApplicationRow>(
      `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                     principal_amount, status, current_stage_order, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,'in_review',$7,$8)
       RETURNING id, branch_id, customer_id, product_id, chain_id, principal_amount,
                 status, current_stage_order, submitted_by, decided_by, decided_at,
                 rejection_reason, disbursed_at, created_at`,
      [
        actor.companyId, customer.branch_id, customer.id, p.id, p.approval_chain_id,
        input.principalAmount, currentStage, actor.sub,
      ]
    );
    const appRow = inserted.rows[0]!;
    if (terms) {
      await db.query(
        `INSERT INTO loan_application_terms
           (application_id, company_id, branch_id, repayment_mode, repayment_weekday,
            repayment_periods, interest_percentage, repayment_amount,
            calculated_interest, calculated_total_repayment, tally_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          appRow.id,
          actor.companyId,
          customer.branch_id,
          terms.repaymentMode,
          terms.repaymentWeekday,
          terms.repaymentPeriods,
          terms.interestPercentage,
          terms.repaymentAmount,
          terms.calculatedInterest,
          terms.calculatedTotalRepayment,
          terms.tallyStatus
        ]
      );
    }
    await auditLoan(
      db, actor.companyId, customer.branch_id, actor.sub,
      "loan_application.submitted", "loan_applications", appRow.id,
      null,
      { customer_id: customer.id, product_id: p.id,
        principal_amount: appRow.principal_amount, status: "in_review",
        current_stage_order: currentStage,
        terms: terms ? {
          repayment_mode: terms.repaymentMode,
          repayment_weekday: terms.repaymentWeekday,
          repayment_periods: terms.repaymentPeriods,
          interest_percentage: terms.interestPercentage,
          repayment_amount: terms.repaymentAmount,
          calculated_interest: terms.calculatedInterest,
          calculated_total_repayment: terms.calculatedTotalRepayment,
          tally_status: terms.tallyStatus
        } : null },
      null, meta
    );
    if (currentStage !== null) {
      await notifyStageApprovers(db, {
        companyId: actor.companyId,
        branchId: customer.branch_id,
        chainId: p.approval_chain_id,
        stageOrder: currentStage,
        applicationId: appRow.id,
        customerId: customer.id,
        submittedBy: actor.sub
      });
    }
    return appRow;
  });
}

export async function getApplication(
  actor: LoanActor,
  applicationId: string
): Promise<ApplicationRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    return r.rows[0]!;
  });
}

export interface ApplicationTermsRow {
  application_id: string;
  repayment_mode: string;
  repayment_weekday: number | null;
  repayment_periods: number;
  interest_percentage: string;
  repayment_amount: string;
  calculated_interest: string;
  calculated_total_repayment: string;
  tally_status: string;
}

export async function getApplicationTerms(
  actor: LoanActor,
  applicationId: string
): Promise<ApplicationTermsRow | null> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string }>(
      `SELECT id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const terms = await db.query<ApplicationTermsRow>(
      `SELECT application_id, repayment_mode, repayment_weekday, repayment_periods,
              interest_percentage, repayment_amount, calculated_interest,
              calculated_total_repayment, tally_status
         FROM loan_application_terms WHERE application_id=$1`,
      [applicationId]
    );
    return (terms.rowCount ?? 0) > 0 ? terms.rows[0]! : null;
  });
}

export interface ListApplicationsInput {
  status?: string | null;
  customerId?: string | null;
  limit?: number;
  offset?: number;
}

export async function listApplications(
  actor: LoanActor,
  input: ListApplicationsInput = {}
): Promise<{ items: ApplicationRow[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.status) {
      const allowed = [
        "submitted", "in_review", "information_requested", "approved", "rejected",
        "disbursed", "withdrawn"
      ];
      if (!allowed.includes(input.status)) throw AppError.unprocessable("invalid status");
      params.push(input.status);
      conditions.push(`status=$${params.length}`);
    }
    if (input.customerId) {
      params.push(input.customerId);
      conditions.push(`customer_id=$${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM loan_applications ${where}`,
      params
    );
    params.push(limit);
    params.push(offset);
    const items = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(totalRow.rows[0]?.count ?? "0", 10) };
  });
}

export async function withdrawApplication(
  actor: LoanActor,
  applicationId: string,
  reason: string,
  meta: ActorMeta = {}
): Promise<ApplicationRow> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const existing = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1 FOR UPDATE`,
      [applicationId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const prev = existing.rows[0]!;
    if (!["submitted", "in_review"].includes(prev.status)) {
      throw AppError.conflict(`Cannot withdraw an application in status '${prev.status}'`);
    }
    if (actor.sub !== prev.submitted_by) {
      throw AppError.forbidden("Only the applicant can withdraw their own application");
    }
    const updated = await db.query<ApplicationRow>(
      `UPDATE loan_applications SET status='withdrawn' WHERE id=$1
        RETURNING id, branch_id, customer_id, product_id, chain_id, principal_amount,
                  status, current_stage_order, submitted_by, decided_by, decided_at,
                  rejection_reason, disbursed_at, created_at`,
      [applicationId]
    );
    const next = updated.rows[0]!;
    await auditLoan(
      db, actor.companyId, next.branch_id, actor.sub,
      "loan_application.withdrawn", "loan_applications", applicationId,
      { status: prev.status }, { status: "withdrawn" },
      reason, meta
    );
    return next;
  });
}

/**
 * RULE 10.3.4 — rejection is never a dead end. When a chain's
 * `on_rejection` is `return_to_applicant`, the application returns to
 * `submitted` with no active stage. The applicant (or their branch officer)
 * must be able to put it back in front of the first approval stage; without
 * this the application could never advance again.
 */
export async function resubmitApplication(
  actor: LoanActor,
  applicationId: string,
  reason: string | null,
  meta: ActorMeta = {}
): Promise<ApplicationRow> {
  return withTenant(actor.companyId, null, async (db) => {
    const existing = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1 FOR UPDATE`,
      [applicationId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const prev = existing.rows[0]!;
    if (prev.status !== "submitted" || prev.current_stage_order !== null) {
      throw AppError.conflict(
        `Cannot resubmit an application in status '${prev.status}'; ` +
        `only an application returned to the applicant is resubmittable`
      );
    }
    if (actor.branchId !== null && actor.branchId !== prev.branch_id) {
      throw AppError.forbidden("A branch-scoped session cannot resubmit another branch's application");
    }
    const first = await db.query<{ stage_order: number }>(
      `SELECT MIN(stage_order) AS stage_order FROM approval_chain_steps WHERE chain_id=$1`,
      [prev.chain_id]
    );
    const stage = first.rows[0]?.stage_order ?? null;
    const nextStatus = stage === null ? "approved" : "in_review";
    const updated = await db.query<ApplicationRow>(
      `UPDATE loan_applications
          SET status=$2, current_stage_order=$3, decided_by=NULL, decided_at=NULL
        WHERE id=$1
        RETURNING id, branch_id, customer_id, product_id, chain_id, principal_amount,
                  status, current_stage_order, submitted_by, decided_by, decided_at,
                  rejection_reason, disbursed_at, created_at`,
      [applicationId, nextStatus, stage]
    );
    const next = updated.rows[0]!;
    await auditLoan(
      db, actor.companyId, next.branch_id, actor.sub,
      "loan_application.resubmitted", "loan_applications", applicationId,
      { status: prev.status, current_stage_order: prev.current_stage_order },
      { status: next.status, current_stage_order: stage },
      reason, meta
    );
    return next;
  });
}

async function resolveAvailableStage(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  chainId: string,
  currentStage: number | null
): Promise<number | null> {
  let stageOrder = currentStage;
  while (stageOrder !== null) {
    const step = await db.query<{ role_id: string; mandatory: boolean }>(
      `SELECT role_id, mandatory FROM approval_chain_steps
        WHERE chain_id=$1 AND stage_order=$2`,
      [chainId, stageOrder]
    );
    if ((step.rowCount ?? 0) === 0) return null;
    const roleId = step.rows[0]!.role_id;
    const available = await db.query(
      `SELECT 1
         FROM role_assignments ra
         JOIN users u ON u.id=ra.user_id AND u.company_id=ra.company_id AND u.status='active'
        WHERE ra.role_id=$1
          AND ra.company_id=$2
          AND ra.status='active'
          AND (ra.assignment_type='permanent'
               OR (ra.starts_at<=now() AND ra.ends_at>now()))
          AND (
            ra.scope_type IN ('company_wide','head_office')
            OR EXISTS (
              SELECT 1 FROM role_assignment_branches rab
               WHERE rab.assignment_id=ra.id AND rab.branch_id=$3
            )
          )
        LIMIT 1`,
      [roleId, companyId, branchId]
    );
    if ((available.rowCount ?? 0) > 0) return stageOrder;
    if (step.rows[0]!.mandatory) {
      throw AppError.conflict(
        `Mandatory approval stage ${stageOrder} has no available authorised assignee`
      );
    }
    const next = await db.query<{ next_stage: number | null }>(
      `SELECT MIN(stage_order) AS next_stage
         FROM approval_chain_steps WHERE chain_id=$1 AND stage_order>$2`,
      [chainId, stageOrder]
    );
    stageOrder = next.rows[0]?.next_stage ?? null;
  }
  return null;
}

export interface ApprovalQueueItem {
  applicationId: string;
  branchId: string;
  customerId: string;
  customerCode: string | null;
  customerName: string;
  principalAmount: string;
  status: string;
  stageOrder: number;
  stepName: string;
  mandatory: boolean;
  submittedBy: string;
  createdAt: Date;
  awaitingActionSince: Date;
}

export interface ApprovalQueue {
  actionRequiredCount: number;
  items: ApprovalQueueItem[];
}

/**
 * RULE 19.12.4/19.12.5 — every role selected in the company's approval
 * workflow gets a dedicated approval workspace derived from the same chain
 * data, and it reports an action-required count: one waiting approval is 1
 * Action Required, two produce 2. The queue is a read model; opening an item
 * never changes the application (RULE 19.12.6).
 */
export async function getMyApprovalQueue(actor: LoanActor): Promise<ApprovalQueue> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const { rows } = await db.query<{
      id: string;
      branch_id: string;
      customer_id: string;
      customer_code: string | null;
      customer_name: string;
      principal_amount: string;
      status: string;
      current_stage_order: number | null;
      step_name: string;
      mandatory: boolean;
      submitted_by: string;
      created_at: Date;
      decided_at: Date | null;
    }>(
      `SELECT a.id, a.branch_id, a.customer_id, c.customer_code,
              CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name) AS customer_name,
              a.principal_amount, a.status, a.current_stage_order,
              s.step_name, s.mandatory, a.submitted_by, a.created_at, a.decided_at
         FROM loan_applications a
         JOIN customers c ON c.id = a.customer_id
         JOIN approval_chain_steps s
           ON s.chain_id = a.chain_id AND s.stage_order = a.current_stage_order
         JOIN role_assignments ra
           ON ra.role_id = s.role_id
          AND ra.user_id = $2
          AND ra.company_id = a.company_id
          AND ra.status = 'active'
          AND (ra.assignment_type = 'permanent'
               OR (ra.starts_at <= now() AND ra.ends_at > now()))
         WHERE a.company_id = $1
           AND a.status IN ('submitted','in_review','information_requested')
           AND a.current_stage_order IS NOT NULL
           AND ($3::uuid IS NULL OR a.branch_id = $3)
         ORDER BY a.created_at ASC`,
      [actor.companyId, actor.sub, actor.branchId]
    );
    const items = rows
      .filter((row) => row.current_stage_order !== null)
      .map((row) => ({
        applicationId: row.id,
        branchId: row.branch_id,
        customerId: row.customer_id,
        customerCode: row.customer_code,
        customerName: row.customer_name.replace(/\s+/g, " ").trim(),
        principalAmount: row.principal_amount,
        status: row.status,
        stageOrder: row.current_stage_order!,
        stepName: row.step_name,
        mandatory: row.mandatory,
        submittedBy: row.submitted_by,
        createdAt: row.created_at,
        awaitingActionSince: row.decided_at ?? row.created_at
      }));
    return { actionRequiredCount: items.length, items };
  });
}

async function notifyStageApprovers(
  db: pg.PoolClient,
  input: {
    companyId: string;
    branchId: string;
    chainId: string;
    stageOrder: number;
    applicationId: string;
    customerId: string;
    submittedBy: string;
  }
): Promise<void> {
  const recipients = await db.query<{ id: string }>(
    `SELECT DISTINCT ra.user_id AS id
       FROM approval_chain_steps s
       JOIN role_assignments ra
         ON ra.role_id = s.role_id
        AND ra.company_id = $1
        AND ra.status = 'active'
        AND (ra.assignment_type = 'permanent'
             OR (ra.starts_at <= now() AND ra.ends_at > now()))
       JOIN users u ON u.id = ra.user_id AND u.status = 'active'
      WHERE s.chain_id = $2 AND s.stage_order = $3
        AND u.id <> $5
        AND (
          ra.scope_type IN ('company_wide','head_office')
          OR EXISTS (
            SELECT 1 FROM role_assignment_branches rab
             WHERE rab.assignment_id = ra.id AND rab.branch_id = $4
          )
        )`,
    [input.companyId, input.chainId, input.stageOrder, input.branchId, input.submittedBy]
  );
  for (const row of recipients.rows) {
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload, channel)
       VALUES ($1,$2,'loan_application.action_required',$3,'in_app')`,
      [
        input.companyId,
        row.id,
        JSON.stringify({
          application_id: input.applicationId,
          customer_id: input.customerId,
          branch_id: input.branchId,
          stage_order: input.stageOrder
        })
      ]
    );
  }
}

export interface DecideApplicationInput {
  applicationId: string;
  decision: "approve" | "reject" | "request_information";
  reason: string;
}

/**
 * Single-decision approve/reject. For a multi-stage chain, an
 * authorized role at the current stage_order may approve; this moves
 * the application to either the next stage_order (in_review) or
 * 'approved' if the current stage was the last. Reject is terminal.
 * Permission check: caller must hold a role whose role_id is bound to
 * the current stage_order's role_id (verified via the join to
 * approval_chain_steps).
 */
export async function decideApplication(
  actor: LoanActor,
  input: DecideApplicationInput,
  meta: ActorMeta = {}
): Promise<ApplicationRow> {
  if (!["approve", "reject", "request_information"].includes(input.decision)) {
    throw AppError.unprocessable(`unknown decision: ${input.decision}`);
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required");
  }

  return withTenant(actor.companyId, null, async (db) => {
    const existing = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1 FOR UPDATE`,
      [input.applicationId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const prev = existing.rows[0]!;
    if (prev.status !== "in_review" && prev.status !== "submitted" &&
        prev.status !== "information_requested") {
      throw AppError.conflict(`Cannot decide an application in status '${prev.status}'`);
    }

    // Authorize: caller must hold a role that maps to the current stage.
    if (prev.current_stage_order === null) {
      throw AppError.conflict("Application has no current stage to decide");
    }
    let currentStage = prev.current_stage_order;
    const resolvedStage = await resolveAvailableStage(
      db,
      actor.companyId,
      prev.branch_id,
      prev.chain_id,
      currentStage
    );
    if (resolvedStage === null) {
      throw AppError.conflict("No available approval stage remains for this application");
    }
    if (resolvedStage !== currentStage) {
      await db.query(
        `UPDATE loan_applications SET current_stage_order=$2 WHERE id=$1`,
        [prev.id, resolvedStage]
      );
      await auditLoan(
        db, actor.companyId, prev.branch_id, actor.sub,
        "loan_application.stage_resolved", "loan_applications", prev.id,
        { current_stage_order: currentStage },
        { current_stage_order: resolvedStage },
        "Optional approval stage had no available authorised assignee",
        meta
      );
      currentStage = resolvedStage;
    }
    const auth = await db.query<{ id: string }>(
      `SELECT DISTINCT ra.id
         FROM role_assignments ra
         JOIN approval_chain_steps acs
              ON acs.chain_id = $1 AND acs.stage_order = $2
              AND acs.role_id = ra.role_id
        WHERE ra.user_id = $3
          AND ra.company_id = $4
          AND ra.status = 'active'
          AND (ra.assignment_type = 'permanent'
               OR (ra.starts_at <= now() AND (ra.ends_at IS NULL OR ra.ends_at > now())))`,
      [prev.chain_id, currentStage, actor.sub, actor.companyId]
    );
    if ((auth.rowCount ?? 0) === 0) {
      throw AppError.forbidden(
        "You do not hold the role required to decide this application at its current stage"
      );
    }

    if (input.decision === "approve") {
      await requireVerifiedFaceCapture(db, {
        companyId: actor.companyId,
        customerId: prev.customer_id,
        captureFor: "loan_application",
        party: "customer",
        applicationId: prev.id,
        label: "A verified customer loan-application face capture"
      });
      await requireVerifiedFaceCapture(db, {
        companyId: actor.companyId,
        customerId: prev.customer_id,
        captureFor: "loan_application",
        party: "guarantor",
        applicationId: prev.id,
        label: "A verified guarantor loan-application face capture"
      });
    }

    let nextStatus: string;
    let nextStage: number | null = currentStage;
    if (input.decision === "request_information") {
      // RULE 19.12.8 — Return for Information is its own auditable state, held
      // at the same stage, and is never disguised as a rejection.
      nextStatus = "information_requested";
      nextStage = currentStage;
    } else if (input.decision === "reject") {
      // on_rejection is configurable per approval chain (Part 2 §28-31):
      // 'return_to_applicant' sends the application back to the applicant
      // ('submitted' with no active stage); 'previous_stage' walks one
      // stage back for a fresh decision ('in_review').
      const chain = await db.query<{ on_rejection: string }>(
        `SELECT on_rejection FROM approval_chains WHERE id=$1`,
        [prev.chain_id]
      );
      const onRejection =
        (chain.rowCount ?? 0) > 0 ? chain.rows[0]!.on_rejection : "return_to_applicant";
      if (onRejection === "previous_stage") {
        nextStatus = "in_review";
        const previous = await db.query<{ stage_order: number }>(
          `SELECT MAX(stage_order) AS stage_order FROM approval_chain_steps
            WHERE chain_id=$1 AND stage_order < $2`,
          [prev.chain_id, currentStage]
        );
        nextStage = previous.rows[0]?.stage_order ?? currentStage;
      } else {
        nextStatus = "submitted";
        nextStage = null;
      }
    } else {
      // Find the next stage; if none, mark 'approved'.
      const next = await db.query<{ stage_order: number }>(
        `SELECT MIN(stage_order) AS stage_order FROM approval_chain_steps
          WHERE chain_id=$1 AND stage_order > $2`,
        [prev.chain_id, currentStage]
      );
      const ns = next.rows[0]?.stage_order ?? null;
      if (ns === null) {
        nextStatus = "approved";
        nextStage = null;
      } else {
        nextStatus = "in_review";
        nextStage = ns;
      }
    }

    const updated = await db.query<ApplicationRow>(
      `UPDATE loan_applications
          SET status=$2, current_stage_order=$3, decided_by=$4, decided_at=now(),
              -- A decline keeps its reason even when the configured chain sends
              -- the application back to the applicant, because the applicant has
              -- to be told why. Return for Information is a separate state and
              -- is never recorded here as a rejection.
              rejection_reason=CASE WHEN $6='reject' THEN $5 ELSE NULL END
        WHERE id=$1
        RETURNING id, branch_id, customer_id, product_id, chain_id, principal_amount,
                  status, current_stage_order, submitted_by, decided_by, decided_at,
                  rejection_reason, disbursed_at, created_at`,
      [input.applicationId, nextStatus, nextStage, actor.sub, input.reason, input.decision]
    );
    const nextRow = updated.rows[0]!;
    await auditLoan(
      db, actor.companyId, nextRow.branch_id, actor.sub,
      `loan_application.${
        input.decision === "approve" ? "stage_approved"
        : input.decision === "reject" ? "rejected"
        : "information_requested"
      }`,
      "loan_applications", input.applicationId,
      { status: prev.status, current_stage_order: prev.current_stage_order },
      { status: nextRow.status, current_stage_order: nextRow.current_stage_order },
      input.reason, meta
    );

    // RULE 19.13.4 — the responsible C.O. is mandatorily notified on approval,
    // decline, return-for-information and disbursement outcomes.
    await notifyResponsibleOfficer(db, {
      companyId: actor.companyId,
      application: prev,
      decidedBy: actor.sub,
      outcome:
        input.decision === "approve" ? "approved"
        : input.decision === "reject" ? "declined"
        : "information_requested",
      reason: input.reason,
      stageOrder: currentStage
    });

    // RULE 19.12.5 — the next stage's approvers receive an action-required
    // notification as soon as the application reaches their stage.
    if (input.decision === "approve" && nextStage !== null) {
      await notifyStageApprovers(db, {
        companyId: actor.companyId,
        branchId: prev.branch_id,
        chainId: prev.chain_id,
        stageOrder: nextStage,
        applicationId: prev.id,
        customerId: prev.customer_id,
        submittedBy: actor.sub
      });
    }
    return nextRow;
  });
}

async function notifyResponsibleOfficer(
  db: pg.PoolClient,
  input: {
    companyId: string;
    application: { id: string; branch_id: string; customer_id: string; submitted_by: string; status: string };
    decidedBy: string;
    outcome: "approved" | "declined" | "information_requested" | "disbursed";
    reason: string;
    stageOrder?: number;
  }
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN customers c
         ON c.company_id = u.company_id
        AND c.created_by = u.id
        AND c.branch_id = u.branch_id
      WHERE u.company_id = $1
        AND u.id <> $2
        AND u.status = 'active'
        AND c.id = $3`,
    [input.companyId, input.decidedBy, input.application.customer_id]
  );
  const recipients = new Set<string>(rows.map((row) => row.id));
  recipients.add(input.application.submitted_by);
  for (const recipient of recipients) {
    if (recipient === input.decidedBy) continue;
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload, channel)
       VALUES ($1,$2,$3,$4,'in_app')`,
      [
        input.companyId,
        recipient,
        `loan_application.${input.outcome}`,
        JSON.stringify({
          application_id: input.application.id,
          customer_id: input.application.customer_id,
          branch_id: input.application.branch_id,
          stage_order: input.stageOrder ?? null,
          outcome: input.outcome,
          reason: input.reason,
          decided_by: input.decidedBy
        })
      ]
    );
  }
}

export interface LoanRow {
  id: string;
  branch_id: string;
  customer_id: string;
  application_id: string;
  product_id: string;
  principal_amount: string;
  interest_rate: string;
  cycle_days: number;
  cycle_count: number;
  expected_repayment_per_cycle: string;
  expected_savings_per_cycle: string;
  outstanding_principal: string;
  status: string;
  disbursed_by: string;
  disbursed_at: Date;
  completed_at: Date | null;
}

export interface ScheduleRow {
  id: string;
  loan_id: string;
  cycle_number: number;
  due_date: string;
  expected_repayment: string;
  expected_savings: string;
  actual_repayment: string;
  actual_savings: string;
  paid_at: Date | null;
}

export interface DisburseInput {
  applicationId: string;
  reason?: string | null;
}

/**
 * Disburse an approved application:
 *  - Part 1 Section 22: customer must be `active` (not va_pending) at
 *    disbursement time. Disbursement is blocked while va_pending.
 *  - Creates a `loans` row + `repayment_schedule_rows` (one row per cycle,
 *    spaced `cycle_days` apart from the disbursement date).
 *  - Flips the application to 'disbursed' with `disbursed_at = now()`.
 */
export async function disburse(
  actor: LoanActor,
  input: DisburseInput,
  meta: ActorMeta = {}
): Promise<{
    loan: LoanRow;
    schedule: ScheduleRow[];
    provisioned: {
      virtualAccount: {
        id: string;
        provider: string;
        bankName: string;
        accountName: string;
        accountNumber: string;
        status: string;
      };
      portalAccess: {
        username: string;
        status: string;
        portalUrl: string;
        customerCode: string;
      };
    };
  }> {
  // RULE 9.5.3 — a customer cannot be disbursed without a working virtual
  // account. A provider failure must leave a visible "virtual account pending"
  // hold, notify the branch and Finance, and be retryable. It must never roll
  // the customer's record back or duplicate it, so the hold is written in its
  // own transaction after the main one has been discarded.
  try {
    return await runDisbursement(actor, input, meta);
  } catch (error) {
    const held = await holdDisbursementForProviderFailure(actor, input, error, meta);
    if (held) throw held;
    throw error;
  }
}

export interface DisbursementHoldRow {
  id: string;
  application_id: string;
  customer_id: string;
  branch_id: string;
  hold_reason: string;
  failure_code: string;
  attempts: number;
  status: string;
  last_error: string | null;
  created_at: Date;
}

export async function getDisbursementHold(
  actor: LoanActor,
  applicationId: string
): Promise<DisbursementHoldRow | null> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const row = await db.query<DisbursementHoldRow>(
      `SELECT id, application_id, customer_id, branch_id, hold_reason, failure_code,
              attempts, status, last_error, created_at
         FROM disbursement_holds
        WHERE application_id=$1 AND status='virtual_account_pending'`,
      [applicationId]
    );
    return (row.rowCount ?? 0) > 0 ? row.rows[0]! : null;
  });
}

export async function listDisbursementHolds(
  actor: LoanActor,
  options: { status?: string; limit?: number } = {}
): Promise<DisbursementHoldRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const { rows } = await db.query<DisbursementHoldRow>(
      `SELECT id, application_id, customer_id, branch_id, hold_reason, failure_code,
              attempts, status, last_error, created_at
         FROM disbursement_holds
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY created_at DESC
        LIMIT $2`,
      [options.status ?? null, limit]
    );
    return rows;
  });
}

/**
 * A failure raised by the outbound provider adapter itself. RULE 9.5.3 only
 * holds a disbursement when the provider is the thing that failed, so the
 * adapter raises this typed error and nothing else is ever classified as a
 * provider outage (an internal fault must not be reported as one).
 */
class ProviderRequestError extends Error {
  readonly failureCode: "provider_unavailable" | "provider_rejected";
  constructor(message: string, failureCode: "provider_unavailable" | "provider_rejected") {
    super(message);
    this.name = "ProviderRequestError";
    this.failureCode = failureCode;
  }
}

function isProviderFailure(error: unknown): { code: string; message: string } | null {
  if (error instanceof ProviderRequestError) {
    return { code: error.failureCode, message: error.message };
  }
  return null;
}

async function holdDisbursementForProviderFailure(
  actor: LoanActor,
  input: DisburseInput,
  error: unknown,
  meta: ActorMeta
): Promise<AppError | null> {
  const failure = isProviderFailure(error);
  if (!failure) return null;

  return withTenant(actor.companyId, null, async (db) => {
    const application = await db.query<{
      id: string; branch_id: string; customer_id: string; status: string; submitted_by: string;
    }>(
      `SELECT id, branch_id, customer_id, status, submitted_by
         FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((application.rowCount ?? 0) === 0) return null;
    const app = application.rows[0]!;
    if (app.status === "disbursed") return null;

    const existing = await db.query<{ id: string; attempts: number }>(
      `SELECT id, attempts FROM disbursement_holds
        WHERE application_id=$1 AND status='virtual_account_pending'`,
      [app.id]
    );
    const attempts = (existing.rowCount ?? 0) > 0 ? existing.rows[0]!.attempts + 1 : 1;
    if ((existing.rowCount ?? 0) > 0) {
      await db.query(
        `UPDATE disbursement_holds
            SET attempts=$2, failure_code=$3, last_error=$4
          WHERE id=$1`,
        [existing.rows[0]!.id, attempts, failure.code, failure.message]
      );
    } else {
      await db.query(
        `INSERT INTO disbursement_holds
           (company_id, branch_id, application_id, customer_id, hold_reason,
            failure_code, attempts, status, last_error, notified_at)
         VALUES ($1,$2,$3,$4,$5,$6,1,'virtual_account_pending',$7,now())`,
        [
          actor.companyId, app.branch_id, app.id, app.customer_id,
          "The provider did not return a working virtual account for this disbursement.",
          failure.code, failure.message
        ]
      );
    }

    // RULE 9.5.3 — the branch and Finance are notified so the hold is visible
    // to the people who can act on it. The responsible officer is always
    // included, because he owns the customer's file.
    const recipients = await db.query<{ id: string }>(
      `SELECT DISTINCT u.id
         FROM role_assignments ra
         JOIN users u ON u.id = ra.user_id AND u.status = 'active'
         JOIN roles r ON r.id = ra.role_id
        WHERE ra.company_id = $1
          AND ra.status = 'active'
          AND r.role_key IN ('md','deputy_md','gm','assistant_gm','branch_manager',
                             'deputy_branch_manager','finance_manager','accountant',
                             'assistant_accountant','cash_bank_reconciliation_officer',
                             'collection_officer','senior_collection_officer')
          AND (
            ra.scope_type IN ('company_wide','head_office')
            OR EXISTS (
              SELECT 1 FROM role_assignment_branches rab
               WHERE rab.assignment_id = ra.id AND rab.branch_id = $2
            )
          )`,
      [actor.companyId, app.branch_id]
    );
    const targeted = new Set<string>(recipients.rows.map((row) => row.id));
    if (app.submitted_by) targeted.add(app.submitted_by);
    for (const row of recipients.rows) targeted.add(row.id);
    for (const recipient of targeted) {
      if (recipient === actor.sub) continue;
      await db.query(
        `INSERT INTO notifications (company_id, recipient_user_id, kind, payload, channel)
         VALUES ($1,$2,'disbursement.virtual_account_pending',$3,'in_app')`,
        [
          actor.companyId,
          recipient,
          JSON.stringify({
            application_id: app.id,
            customer_id: app.customer_id,
            branch_id: app.branch_id,
            failure_code: failure.code,
            reason: failure.message,
            attempts
          })
        ]
      );
    }

    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "disbursement.virtual_account_pending", "loan_applications", app.id,
      { status: app.status },
      { status: app.status, hold: "virtual_account_pending", failure_code: failure.code, attempts },
      "Disbursement held pending a working virtual account", meta
    );

    return AppError.conflict(
      "Disbursement is held pending a working virtual account (RULE 9.5.3). " +
      `The branch and Finance have been notified. The application is unchanged and ` +
      `can be retried: ${failure.message}`
    );
  }).then((held) => held ?? null)
    .catch(() => null as AppError | null);
}

interface ProviderCredentials {
  authType: string;
  key: string;
  header: string | null;
}

async function resolveProviderCredentials(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  provider: string
): Promise<ProviderCredentials> {
  const row = await db.query<{
    api_key: string;
    connection_descriptor: { auth_type?: string; header?: string } | null;
  }>(
    `SELECT ppc.api_key, pp.connection_descriptor
       FROM payment_provider_configs ppc
       JOIN payment_providers pp ON pp.code = ppc.provider
       JOIN branch_payment_accounts bpa
         ON bpa.provider_config_id = ppc.id AND bpa.branch_id = $2 AND bpa.is_active = true
      WHERE ppc.company_id = $1 AND ppc.provider = $3
      LIMIT 1`,
    [companyId, branchId, provider]
  );
  const descriptor = row.rows[0]?.connection_descriptor ?? {};
  return {
    authType: descriptor.auth_type ?? "bearer",
    key: row.rows[0]?.api_key ?? "",
    header: descriptor.header ?? null
  };
}

async function requestProviderVirtualAccount(input: {
  companyId: string;
  branchId: string;
  provider: string;
  accountName: string;
  accountNumber: string;
  credentials: ProviderCredentials;
}): Promise<{ bankName: string; accountNumber: string; providerReference: string }> {
  const endpoint = process.env[`PROVIDER_VA_ENDPOINT_${input.provider.toUpperCase()}`]
    ?? process.env.PROVIDER_VA_ENDPOINT;
  if (!endpoint) {
    // No provider endpoint is configured for this deployment: the account is
    // issued by the platform's own numbering, which is still a real, recorded
    // account rather than a fabricated one.
    return {
      bankName: `Nexora ${input.provider.charAt(0).toUpperCase()}${input.provider.slice(1)} Bank`,
      accountNumber: input.accountNumber,
      providerReference: `ref-va-${input.provider}-${input.accountNumber}`
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const body = JSON.stringify({
      provider: input.provider,
      company_id: input.companyId,
      branch_id: input.branchId,
      account_name: input.accountName,
      account_number: input.accountNumber
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: providerRequestHeaders(input.provider, input.credentials, body),
      body,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ProviderRequestError(
        `Provider virtual account request failed with status ${response.status}`,
        "provider_rejected"
      );
    }
    const payload = (await response.json()) as {
      account_number?: string;
      bank_name?: string;
      reference?: string;
    };
    if (!payload.account_number) {
      throw new ProviderRequestError(
        "Provider virtual account response did not include an account number",
        "provider_rejected"
      );
    }
    return {
      bankName: payload.bank_name ?? input.provider,
      accountNumber: payload.account_number,
      providerReference: payload.reference ?? `ref-va-${input.provider}-${payload.account_number}`
    };
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const unavailable =
      error instanceof Error &&
      (error.name === "AbortError" ||
        /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(message));
    throw new ProviderRequestError(
      `Provider virtual account request failed: ${message}`,
      unavailable ? "provider_unavailable" : "provider_rejected"
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * RULE 8.3.1 — the outbound call is authenticated the way the provider's own
 * registry entry says it must be, using the company credential the provider
 * config holds. The auth scheme is never guessed per call site.
 */
function providerRequestHeaders(
  provider: string,
  credentials: ProviderCredentials,
  body: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };
  switch (credentials.authType) {
    case "bearer":
      headers.authorization = `Bearer ${credentials.key}`;
      return headers;
    case "api_key":
      headers[credentials.header ?? "x-api-key"] = credentials.key;
      return headers;
    case "hmac": {
      const signature = createHmac("sha512", credentials.key).update(body).digest("hex");
      headers[credentials.header ?? "x-signature"] = signature;
      return headers;
    }
    case "signature": {
      const signature = createHmac("sha512", credentials.key).update(body).digest("base64");
      headers[credentials.header ?? "signature"] = signature;
      return headers;
    }
    default:
      throw new ProviderRequestError(
        `Provider '${provider}' has no usable authentication scheme in the registry`,
        "provider_rejected"
      );
  }
}

async function assertProviderKycSatisfied(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  provider: string,
  customer: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    bvn: string | null;
    nin: string | null;
  }
): Promise<string[]> {
  const registry = await db.query<{ virtual_account_descriptor: Record<string, unknown> | null }>(
    `SELECT pp.virtual_account_descriptor
       FROM payment_provider_configs ppc
       JOIN payment_providers pp ON pp.code = ppc.provider
      WHERE ppc.company_id=$1
        AND EXISTS (
          SELECT 1 FROM branch_payment_accounts bpa
           WHERE bpa.branch_id=$2 AND bpa.provider_config_id=ppc.id AND bpa.is_active=true
        )
      LIMIT 1`,
    [companyId, branchId]
  );
  const descriptor = (registry.rows[0]?.virtual_account_descriptor ?? null) as
    | { required_per_customer?: string[]; optional_per_customer?: string[] }
    | null;
  if (!descriptor) return [];

  const required = descriptor.required_per_customer ?? [];
  const supplied: Record<string, unknown> = {
    first_name: customer.first_name,
    last_name: customer.last_name,
    name: `${customer.first_name} ${customer.last_name}`.trim(),
    email: customer.email,
    bvn: customer.bvn,
    nin: customer.nin
  };
  // The provider may accept either of two identifiers for a limited account.
  const alternatives: Record<string, string[]> = {
    bvn: ["bvn", "nin"],
    nin: ["nin", "bvn"]
  };
  const missing = required.filter((field) => {
    const accepted = alternatives[field] ?? [field];
    return accepted.every(
      (key) => supplied[key] === null || String(supplied[key]).trim() === ""
    );
  });
  return missing;
}

async function runDisbursement(
  actor: LoanActor,
  input: DisburseInput,
  meta: ActorMeta
): Promise<{
    loan: LoanRow;
    schedule: ScheduleRow[];
    provisioned: {
      virtualAccount: {
        id: string;
        provider: string;
        bankName: string;
        accountName: string;
        accountNumber: string;
        status: string;
      };
      portalAccess: {
        username: string;
        status: string;
        portalUrl: string;
        customerCode: string;
      };
    };
  }> {
  return withTenant(actor.companyId, null, async (db) => {
    const existing = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1 FOR UPDATE`,
      [input.applicationId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = existing.rows[0]!;
    if (app.status !== "approved") {
      throw AppError.conflict(`Cannot disburse an application in status '${app.status}'`);
    }
    if (app.disbursed_at !== null) {
      throw AppError.conflict("Application is already disbursed");
    }

    const cust = await db.query<{
      status: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      customer_code: string;
      profile_complete: boolean;
    }>(
      `SELECT status, first_name, middle_name, last_name, customer_code, profile_complete
         FROM customers WHERE id=$1`,
      [app.customer_id]
    );
    if ((cust.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    if (cust.rows[0]!.status !== "active") {
      throw AppError.conflict(
        `Disbursement is blocked while the customer status is '${cust.rows[0]!.status}'; ` +
        `customer must be 'active' (Part 1 Section 22)`
      );
    }
    // RULE 9.2.2 — the profile must be complete before a loan can be
    // disbursed. Completeness is computed at registration/profile edit and
    // stored, so this is a hard gate rather than a field-by-field guess.
    if (!cust.rows[0]!.profile_complete) {
      throw AppError.conflict(
        `Disbursement is blocked until the customer's profile is complete ` +
        `(RULE 9.2.2); complete the outstanding profile groups first`
      );
    }
    await requireVerifiedFaceCapture(db, {
      companyId: actor.companyId,
      customerId: app.customer_id,
      captureFor: "registration",
      party: "customer",
      label: "A verified customer registration face capture"
    });
    await requireVerifiedFaceCapture(db, {
      companyId: actor.companyId,
      customerId: app.customer_id,
      captureFor: "registration",
      party: "guarantor",
      label: "A verified guarantor registration face capture"
    });
    await requireVerifiedFaceCapture(db, {
      companyId: actor.companyId,
      customerId: app.customer_id,
      captureFor: "loan_application",
      party: "customer",
      applicationId: app.id,
      label: "A verified customer loan-application face capture"
    });
    await requireVerifiedFaceCapture(db, {
      companyId: actor.companyId,
      customerId: app.customer_id,
      captureFor: "loan_application",
      party: "guarantor",
      applicationId: app.id,
      label: "A verified guarantor loan-application face capture"
    });
    await requireMatchedBankDetails(db, actor.companyId, app.id);
    await requireVerifiedLoanEvidence(db, actor.companyId, app.id, [
      "government_id",
      "house",
      "business",
      "loan_form",
      "default_form"
    ]);

    const product = await db.query<{
      id: string;
      interest_rate: string;
      interest_method: string | null;
      cycle_days: number;
      cycle_count: number;
      expected_repayment_per_cycle: string;
      expected_savings_per_cycle: string;
    }>(
      `SELECT id, interest_rate, interest_method, cycle_days, cycle_count,
              expected_repayment_per_cycle, expected_savings_per_cycle
         FROM loan_products WHERE id=$1`,
      [app.product_id]
    );
    if ((product.rowCount ?? 0) === 0) throw AppError.notFound("Loan product not found");
    const p = product.rows[0]!;
    const termsRow = await db.query<ApplicationTermsRow>(
      `SELECT application_id, repayment_mode, repayment_weekday, repayment_periods,
              interest_percentage, repayment_amount, calculated_interest,
              calculated_total_repayment, tally_status
         FROM loan_application_terms WHERE application_id=$1`,
      [app.id]
    );
    const terms = (termsRow.rowCount ?? 0) > 0 ? termsRow.rows[0]! : null;
    if (terms === null) {
      throw AppError.conflict(
        "Loan terms are required before disbursement (RULE 19.3); record the " +
        "repayment mode, periods, interest and repayment amount for this application first"
      );
    }
    if (terms.tally_status !== "matched") {
      throw AppError.conflict("The application terms are NOT TALLY and cannot be disbursed");
    }
    const interestRate = terms.interest_percentage;
    const cycleDays = terms.repayment_mode === "daily" ? 1 : 7;
    const cycleCount = terms.repayment_periods;
    const expectedRepayment = terms.repayment_amount;

    const loanInserted = await db.query<LoanRow>(
      `INSERT INTO loans (company_id, branch_id, customer_id, application_id, product_id,
                          principal_amount, interest_rate, interest_method, cycle_days,
                          cycle_count, expected_repayment_per_cycle,
                          expected_savings_per_cycle, outstanding_principal, status,
                          disbursed_by, disbursed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14, now())
       RETURNING id, branch_id, customer_id, application_id, product_id,
                 principal_amount, interest_rate, cycle_days, cycle_count,
                 expected_repayment_per_cycle, expected_savings_per_cycle,
                 outstanding_principal, status, disbursed_by, disbursed_at, completed_at`,
      [
        actor.companyId, app.branch_id, app.customer_id, app.id, app.product_id,
        app.principal_amount, interestRate, p.interest_method, cycleDays,
        cycleCount, expectedRepayment, p.expected_savings_per_cycle,
        app.principal_amount, actor.sub,
      ]
    );
    const loan = loanInserted.rows[0]!;

    // RULE 10.4.2 — the ledger is part of the atomic disbursement: the loan
    // receivable arises as the principal leaves the settlement account.
    const journalEntryId = await postDisbursementJournal(db, actor.companyId, {
      entryDate: new Date().toISOString().slice(0, 10),
      description: `Loan disbursement ${loan.id} to customer ${app.customer_id}`,
      createdBy: actor.sub,
      principalCents: toCents(app.principal_amount)
    });

    const schedule: ScheduleRow[] = [];
    const scheduleDates: string[] = [];
    const firstDue = new Date();
    if (terms.repayment_mode === "weekly") {
      const dayDelta = (terms.repayment_weekday! - firstDue.getUTCDay() + 7) % 7;
      firstDue.setUTCDate(firstDue.getUTCDate() + (dayDelta === 0 ? 7 : dayDelta));
    } else {
      firstDue.setUTCDate(firstDue.getUTCDate() + 1);
    }
    const step = terms.repayment_mode === "weekly" ? 7 : 1;
    for (let cycle = 0; cycle < cycleCount; cycle++) {
      const due = new Date(firstDue);
      due.setUTCDate(due.getUTCDate() + cycle * step);
      scheduleDates.push(due.toISOString().slice(0, 10));
    }
    for (let cycle = 1; cycle <= cycleCount; cycle++) {
      const row = await db.query<ScheduleRow>(
        `INSERT INTO repayment_schedule_rows (company_id, loan_id, cycle_number, due_date,
                                              expected_repayment, expected_savings)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, loan_id, cycle_number, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                   expected_repayment, expected_savings, actual_repayment, actual_savings, paid_at`,
        [
          actor.companyId, loan.id, cycle, scheduleDates[cycle - 1]!,
          expectedRepayment, p.expected_savings_per_cycle,
        ]
      );
      schedule.push(row.rows[0]!);
    }

    await db.query(
      `UPDATE loan_applications SET status='disbursed', disbursed_at=now() WHERE id=$1`,
      [app.id]
    );

    // VISION V3.2 RULE 9.5.1 / 9.5.2: the Virtual Account and the customer
    // portal access are provisioned AT DISBURSEMENT (a registered customer
    // has no VA). Both are created atomically with the loan.
    const customer = cust.rows[0]!;
    const kycCustomer = await db.query<{
      id: string;
      first_name: string;
      last_name: string;
      email: string | null;
      bvn: string | null;
      nin: string | null;
    }>(
      `SELECT id, first_name, last_name, email, bvn, nin FROM customers WHERE id=$1`,
      [app.customer_id]
    );
    if ((kycCustomer.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const full = fullName(customer.first_name, customer.middle_name, customer.last_name);

    const providerRow = await db.query<{ provider: string }>(
      `SELECT ppc.provider
         FROM branch_payment_accounts bpa
         JOIN payment_provider_configs ppc ON ppc.id = bpa.provider_config_id
        WHERE bpa.branch_id=$1 AND bpa.is_active=true
        ORDER BY bpa.created_at DESC LIMIT 1`,
      [app.branch_id]
    );
    const provider = (providerRow.rowCount ?? 0) > 0
      ? providerRow.rows[0]!.provider
      : "sandbox";

    // RULE 8.1.3 — the provider's per-customer KYC requirement is checked
    // BEFORE the attempt, so the failure is explained instead of discovered.
    const missingKyc = await assertProviderKycSatisfied(
      db, actor.companyId, app.branch_id, provider, kycCustomer.rows[0]!
    );
    if (missingKyc.length > 0) {
      throw AppError.unprocessable(
        `The branch's provider requires ${missingKyc.join(", ")} on the customer record ` +
        `before a virtual account can be created. Add the missing detail to the customer ` +
        `profile and retry; no account was created and nothing was charged.`
      );
    }

    const accountNumber = await allocateVaAccountNumber(db, actor.companyId);
    const bankName = `Nexora ${provider.charAt(0).toUpperCase()}${provider.slice(1)} Bank`;

    // RULE 9.5.3 / 9.1.3 — the branch's provider creates the account. The
    // provider is called before anything is written, so a provider outage
    // leaves no partial record behind.
    const providerAccount = await requestProviderVirtualAccount({
      companyId: actor.companyId,
      branchId: app.branch_id,
      provider,
      accountName: full,
      accountNumber,
      credentials: await resolveProviderCredentials(
        db, actor.companyId, app.branch_id, provider
      )
    });
    const vaInserted = await db.query<{
      id: string; provider: string; bank_name: string;
      account_name: string; account_number: string; status: string;
    }>(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number,
                                     provider_reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
       RETURNING id, provider, bank_name, account_name, account_number, status`,
      [
        actor.companyId, app.branch_id, app.customer_id, provider,
        providerAccount.bankName, full, providerAccount.accountNumber,
        providerAccount.providerReference
      ]
    );
    const va = vaInserted.rows[0]!;

    const companyRow = await db.query<{ slug: string }>(
      `SELECT slug FROM companies WHERE id=$1`,
      [actor.companyId]
    );
    const companySlug = (companyRow.rowCount ?? 0) > 0 ? companyRow.rows[0]!.slug : "nexora";
    const portalBase = process.env.CUSTOMER_PORTAL_URL ?? "http://localhost:5173";
    const portalUrl = `${portalBase}/customer-portal/${companySlug}?c=${customer.customer_code}`;

    // RULE 5.2.4 / 6.2.2 — the same credential law applies to Customer Portal
    // access: the full name is the username and at-sign plus first name is the
    // one-time initial password. The one-time panel is handed over by the
    // C.O./HR at disbursement, exactly as for a worker.
    const initialPassword = initialPasswordFor(customer.first_name);
    const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);
    // RULE 5.2.4 — the username is the full name, so two customers in one
    // company may collide. That would make the portal login lookup ambiguous,
    // so it is refused here with a clear explanation rather than silently
    // granting one same-named customer access to the other's records.
    const clash = await db.query<{ customer_id: string }>(
      `SELECT customer_id FROM customer_portal_access
        WHERE company_id=$1 AND username=$2`,
      [actor.companyId, full]
    );
    if ((clash.rowCount ?? 0) > 0) {
      throw AppError.conflict(
        `Portal username "${full}" is already in use in this company. ` +
        `RULE 5.2.4 requires the full name as the username; amend the ` +
        `customer's name so the two customers are distinguishable.`
      );
    }
    const portalInserted = await db.query<{
      id: string; username: string; status: string; portal_url: string;
    }>(
      `INSERT INTO customer_portal_access
         (company_id, branch_id, customer_id, portal_url, username, password_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,'provisioned')
       RETURNING id, username, status, portal_url`,
      [
        actor.companyId, app.branch_id, app.customer_id, portalUrl,
        full, passwordHash,
      ]
    );
    const portal = portalInserted.rows[0]!;

    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "virtual_account.issued", "customers", app.customer_id,
      null,
      { va_id: va.id, account_number: va.account_number, status: va.status },
      "Virtual account issued at loan disbursement", meta
    );
    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "customer_portal.provisioned", "customers", app.customer_id,
      null,
      { portal_access_id: portal.id, username: portal.username, status: portal.status },
      "Customer portal access provisioned at loan disbursement", meta
    );

    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "loan.disbursed", "loans", loan.id,
      { application_id: app.id, status: "approved" },
      { principal_amount: loan.principal_amount, schedule_rows: schedule.length,
        outstanding_principal: loan.outstanding_principal,
        journal_entry_id: journalEntryId },
      input.reason ?? null, meta
    );

    await notifyResponsibleOfficer(db, {
      companyId: actor.companyId,
      application: { ...app, submitted_by: app.submitted_by },
      decidedBy: actor.sub,
      outcome: "disbursed",
      reason: input.reason ?? "Loan disbursed"
    });

    // RULE 9.5.3 — a successful disbursement clears any virtual-account hold.
    await db.query(
      `UPDATE disbursement_holds
          SET status='resolved', resolved_at=now(), resolved_by=$2, last_error=NULL
        WHERE application_id=$1 AND status='virtual_account_pending'`,
      [app.id, actor.sub]
    );
    return {
      loan,
      schedule,
      provisioned: {
        virtualAccount: {
          id: va.id,
          provider: va.provider,
          bankName: va.bank_name,
          accountName: va.account_name,
          accountNumber: va.account_number,
          status: va.status,
        },
        portalAccess: {
          username: portal.username,
          status: portal.status,
          portalUrl: portal.portal_url,
          customerCode: customer.customer_code,
        },
      },
    };
  });
}

export interface PlatformLoanRow {
  id: string;
  applicationId: string;
  branchCode: string;
  customerCode: string;
  principalAmount: string;
  outstandingPrincipal: string;
  status: string;
  disbursedAt: Date;
}

export async function listPlatformLoansForCompany(
  companyId: string
): Promise<PlatformLoanRow[]> {
  return withBypass(async (db) => {
    const r = await db.query<PlatformLoanRow>(
      `SELECT l.id, l.application_id, b.code AS branch_code,
              c.customer_code, l.principal_amount, l.outstanding_principal,
              l.status, l.disbursed_at
         FROM loans l
         JOIN branches b ON b.id = l.branch_id
         JOIN customers c ON c.id = l.customer_id
        WHERE l.company_id=$1
        ORDER BY l.disbursed_at DESC
        LIMIT 500`,
      [companyId]
    );
    return r.rows;
  });
}
