export enum CompanyStatus {
  InSetup = "in_setup",
  PendingActivation = "pending_activation",
  Active = "active",
  Suspended = "suspended"
}

export enum BranchStatus {
  Active = "active",
  Suspended = "suspended",
  Closed = "closed"
}

export enum UserStatus {
  Invited = "invited",
  Active = "active",
  Suspended = "suspended",
  Terminated = "terminated"
}

export enum AssignmentType {
  Permanent = "permanent",
  Temporary = "temporary"
}

export enum CustomerStatus {
  VaPending = "va_pending",
  Active = "active",
  Suspended = "suspended",
  Closed = "closed"
}

export enum GroupStatus {
  Active = "active",
  Closed = "closed"
}

export enum VirtualAccountStatus {
  Pending = "pending",
  Active = "active",
  Replaced = "replaced",
  Closed = "closed"
}

export type PaymentPipelineStatus =
  | "received"
  | "verified"
  | "identified"
  | "allocated"
  | "posted"
  | "completed"
  | "duplicate_suppressed"
  | "unmatched"
  | "unallocated"
  | "incomplete_processing"
  | "reversed";
