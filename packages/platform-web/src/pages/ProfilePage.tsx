import { useEffect, useState } from "react";
import {
  Badge,
  Card,
  ErrorState,
  IconKey,
  IconShield,
  LoadingRow,
  NexoraWordmark,
  PageHeader
} from "@nexora/ui";
import { api } from "../lib/api";

interface OwnerAccount {
  email: string;
  fullName: string;
  authenticatorEnrolled: boolean;
  authenticatorVerified: boolean;
  lastLoginAt: string | null;
  locked: boolean;
  lockedUntil: string | null;
  createdAt: string;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

/**
 * The Platform Owner's own account page.
 *
 * RULE 3.2.1 - the owner console must contain everything it needs. This is the
 * owner's OWN surface: who they are, whether their authenticator is working,
 * when they last signed in, and whether the account is locked. It deliberately
 * shows nothing about any company: RULE 3.6.2 - the owner cannot, by
 * default, read a company's customers, loans, payments or accounting.
 */
export function ProfilePage() {
  const [account, setAccount] = useState<OwnerAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setAccount(await api<OwnerAccount>("/me/account"));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="nx-main">
        <PageHeader title="Your account" description="Platform Owner account details" />
        <Card><LoadingRow text="Loading your account…" /></Card>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="nx-main">
        <PageHeader title="Your account" description="Platform Owner account details" />
        <ErrorState title="Could not load your account" detail={error ?? "Unknown error"} />
      </div>
    );
  }

  return (
    <div className="nx-main">
      <PageHeader
        title="Your account"
        description="Your Platform Owner identity, security state and sign-in history"
      />

      <div className="nx-grid nx-grid--2">
        <Card title="Identity">
          <div className="nx-stack">
            <div className="nx-row" style={{ gap: 12 }}>
              <NexoraWordmark size={34} subtitle="Platform Owner" />
            </div>
            <div className="nx-stack nx-stack--sm">
              <div>
                <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>Full name</div>
                <div style={{ fontWeight: 600 }}>{account.fullName}</div>
              </div>
              <div>
                <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>Username</div>
                <div style={{ fontWeight: 600 }}>{account.email}</div>
              </div>
              <div>
                <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>Account created</div>
                <div>{when(account.createdAt)}</div>
              </div>
              <div>
                <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>Last sign-in</div>
                <div>{when(account.lastLoginAt)}</div>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Security">
          <div className="nx-stack">
            <div className="nx-row" style={{ gap: 10, alignItems: "flex-start" }}>
              <IconShield size={18} />
              <div>
                <div style={{ fontWeight: 600 }}>Authenticator</div>
                <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                  RULE 14.1.1 — the owner holds a verified authenticator, exactly like every worker
                  account. It is the second factor that authorises a sensitive action.
                </div>
              </div>
              <div className="nx-grow" />
              {account.authenticatorVerified ? (
                <Badge tone="success">Verified</Badge>
              ) : account.authenticatorEnrolled ? (
                <Badge tone="warning">Enrolled, not verified</Badge>
              ) : (
                <Badge tone="danger">Not set up</Badge>
              )}
            </div>

            <div className="nx-row" style={{ gap: 10, alignItems: "flex-start" }}>
              <IconKey size={18} />
              <div>
                <div style={{ fontWeight: 600 }}>Account lock</div>
                <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                  RULE 14.4.2 — repeated failed sign-ins lock the account for a cool-down period, and
                  the lockout is audited and notified.
                </div>
              </div>
              <div className="nx-grow" />
              {account.locked ? (
                <Badge tone="danger">Locked until {when(account.lockedUntil)}</Badge>
              ) : (
                <Badge tone="success">Not locked</Badge>
              )}
            </div>

            <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
              This page shows your own account only. A company&apos;s customers, loans, payments and
              accounting are not reachable from here (RULE 3.6.2); support access is a separate,
              audited session.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
