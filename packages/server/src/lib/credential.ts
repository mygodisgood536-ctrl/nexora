/**
 * Identity and credential law (Vision Part 5, RULE 4.2 / 5.1–5.4).
 * Shared by the auth, workers and platform services.
 */

export const CREDENTIAL_STATES = [
  "credential_issued",
  "ritual_in_progress",
  "secured",
  "credential_expired",
  "frozen",
  "portfolio_on_hold",
  "transferred",
  "suspended",
  "terminated"
] as const;
export type CredentialState = (typeof CREDENTIAL_STATES)[number];

/** States in which the account may still sign in — only into the ritual. */
export const RITUAL_STATES: ReadonlySet<CredentialState> = new Set([
  "credential_issued",
  "ritual_in_progress"
]);

/** States in which all login is blocked. */
export const LOGIN_BLOCKED_STATES: ReadonlySet<CredentialState> = new Set([
  "credential_expired",
  "frozen",
  "portfolio_on_hold",
  "transferred",
  "suspended",
  "terminated"
]);

export function stateBlockCode(state: string): string {
  switch (state) {
    case "credential_expired":
      return "CREDENTIAL_EXPIRED";
    case "frozen":
      return "ACCOUNT_FROZEN";
    case "portfolio_on_hold":
      return "PORTFOLIO_ON_HOLD";
    case "transferred":
      return "ACCOUNT_TRANSFERRED";
    case "suspended":
      return "ACCOUNT_SUSPENDED";
    case "terminated":
      return "ACCOUNT_TERMINATED";
    default:
      return "ACCOUNT_BLOCKED";
  }
}

/** RULE 5.2.1 — initial password is the at-sign plus the first name, first letter capitalised. */
export function initialPasswordFor(firstName: string): string {
  const cap = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  return `@${cap}`;
}

/** RULE 5.1.1 — the username is the exact full name in normal spelling and spacing. */
export function fullName(first: string, middle: string | null | undefined, last: string): string {
  return [first, middle || null, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export interface RitualSteps {
  change_password: boolean;
  authenticator_setup: boolean;
  authenticator_verify: boolean;
  profile: boolean;
}

export type RitualNextStep =
  | "change_password"
  | "authenticator_setup"
  | "authenticator_verify"
  | "profile"
  | "complete";

export function ritualProgress(p: {
  password_changed_at: Date | null;
  totp_secret_encrypted: string | null;
  totp_verified_at: Date | null;
  profile_completed_at: Date | null;
}): { steps: RitualSteps; nextStep: RitualNextStep } {
  const steps: RitualSteps = {
    change_password: p.password_changed_at !== null,
    authenticator_setup: p.totp_secret_encrypted !== null,
    authenticator_verify: p.totp_verified_at !== null,
    profile: p.profile_completed_at !== null
  };
  const nextStep: RitualNextStep = !steps.change_password
    ? "change_password"
    : !steps.authenticator_setup
    ? "authenticator_setup"
    : !steps.authenticator_verify
    ? "authenticator_verify"
    : !steps.profile
    ? "profile"
    : "complete";
  return { steps, nextStep };
}