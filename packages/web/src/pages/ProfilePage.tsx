import { useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  KV,
  Modal,
  PageHeader,
  StatusBadge,
  Table,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe, useSession } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { Crumbs } from "./parts";

export function ProfilePage() {
  const me = useMe();
  const { refreshMe, logout } = useSession();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const roleCols: Column<{ roleKey: string; scopeType: string; branchIds: readonly string[]; permissions: readonly string[] }>[] = [
    { key: "role", header: "Role", render: (r) => <strong>{r.roleKey.replace(/_/g, " ")}</strong> },
    { key: "scope", header: "Scope", render: (r) => String(r.scopeType ?? "—").replace(/_/g, " ") },
    { key: "branches", header: "Branches", render: (r) => (r.branchIds?.length ? String(r.branchIds.length) : "all in scope") },
    { key: "permissions", header: "Verbs", render: (r) => `${r.permissions?.length ?? 0} verbs` },
  ];

  return (
    <>
      <PageHeader
        title="Your account"
        description="Who you are signed in as, which roles you hold, and how your credentials are protected."
        breadcrumbs={<Crumbs items={[{ label: "Account" }]} />}
      />

      <div className="nx-grid nx-grid--2">
        <section className="nx-panel">
          <h3 className="nx-h3">Session</h3>
          <KV
            items={[
              { label: "User id", value: <span className="nx-faint">{me.userId.slice(0, 8)}</span> },
              { label: "Company id", value: <span className="nx-faint">{me.companyId.slice(0, 8)}</span> },
              { label: "Branch", value: me.branchId ? me.branchId.slice(0, 8) : "Head office" },
              { label: "Active lens", value: me.activeRoleKey ? me.activeRoleKey.replace(/_/g, " ") : "default (union of your roles)" },
              { label: "Credential state", value: <StatusBadge status={me.credentialState} /> },
              { label: "Must change password", value: me.mustChangePassword ? <Badge tone="warning">yes</Badge> : "no" },
            ]}
          />
          <div className="nx-toolbar" style={{ marginTop: 12 }}>
            <Button size="sm" onClick={() => setChanging(true)}>Change password</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmLogout(true)}>Sign out</Button>
          </div>
        </section>

        <section className="nx-panel">
          <h3 className="nx-h3">Role lens</h3>
          <p className="nx-muted">
            The lens decides which role's permissions and scope the session uses. It changes what you can see — never what exists.
          </p>
          <LensSwitcher
            active={me.activeRoleKey}
            roles={me.roles.map((r) => r.roleKey)}
            onChanged={() => {
              void refreshMe();
              toast({ title: "Lens switched", tone: "success" });
            }}
          />
        </section>
      </div>

      <section className="nx-panel" style={{ marginTop: 16 }}>
        <h3 className="nx-h3">Roles held</h3>
        <Table
          columns={roleCols}
          rows={me.roles.map((r) => ({ ...r }))}
          rowKey={(r) => String(r.roleKey)}
          empty={<p className="nx-muted">No role assignment is active for you.</p>}
        />
      </section>

      {changing && <ChangePasswordModal onClose={() => setChanging(false)} onDone={() => { setChanging(false); void refreshMe(); }} />}
      {confirmLogout && (
        <ConfirmDialog
          open
          title="Sign out?"
          confirmLabel="Sign out"
          onClose={() => setConfirmLogout(false)}
          onConfirm={() => {
            setConfirmLogout(false);
            void logout();
          }}
          body="Your refresh cookie is cleared and the portal returns to the sign-in ritual."
        />
      )}
    </>
  );
}

function LensSwitcher({
  active,
  roles,
  onChanged
}: {
  active: string | null;
  roles: string[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <div className="nx-toolbar">
      <Button
        size="sm"
        variant={active === null ? "primary" : "secondary"}
        disabled={busy || active === null}
        onClick={() => {
          setBusy(true);
          void api("/auth/active-role", { method: "PUT", json: { roleKey: null } })
            .then(onChanged)
            .catch((err: Error) => toast({ title: "Could not switch lens", text: err.message, tone: "danger" }))
            .finally(() => setBusy(false));
        }}
      >
        Union of all roles
      </Button>
      {roles.map((key) => (
        <Button
          key={key}
          size="sm"
          variant={active === key ? "primary" : "secondary"}
          disabled={busy || active === key}
          onClick={() => {
            setBusy(true);
            void api("/auth/active-role", { method: "PUT", json: { roleKey: key } })
              .then(onChanged)
              .catch((err: Error) => toast({ title: "Could not switch lens", text: err.message, tone: "danger" }))
              .finally(() => setBusy(false));
          }}
        >
          {key.replace(/_/g, " ")}
        </Button>
      ))}
    </div>
  );
}

function ChangePasswordModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = newPassword.length > 0 && newPassword === confirmPassword;

  return (
    <Modal
      open
      onClose={onClose}
      title="Change your password"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !matches || totpCode.trim().length !== 6 || currentPassword.length === 0 || newPassword.length === 0}
            onClick={() => {
              setBusy(true);
              void api("/auth/change-password", {
                method: "POST",
                json: { currentPassword, newPassword, confirmPassword, totpCode }
              })
                .then(() => {
                  toast({ title: "Password changed", text: "Your session was cleared — sign in again with the new password.", tone: "success" });
                  onDone();
                })
                .catch((err: Error) => toast({ title: "Could not change the password", text: err.message, tone: "danger" }))
                .finally(() => setBusy(false));
            }}
          >
            Change password
          </Button>
        </>
      }
    >
      <p className="nx-muted">
        Your password is authorised by a live authenticator code — nobody, including an administrator, can read or set it.
      </p>
      <div className="nx-form-grid">
        <label className="nx-field">
          <span>Current password *</span>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>Authenticator code *</span>
          <input
            inputMode="numeric"
            maxLength={6}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <label className="nx-field">
          <span>New password *</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>Confirm new password *</span>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </label>
      </div>
      {!matches && confirmPassword.length > 0 && <p className="nx-error">The two new passwords do not match.</p>}
    </Modal>
  );
}