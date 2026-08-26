import { useEffect, useState } from "react";
import type { AuthFn } from "./CreateWizard";

const CARD = "rounded bg-[var(--nxp-color-surface)] p-4 shadow-[var(--nxp-shadow-card)]";

interface BranchRow {
  id: string;
  code: string;
  slug: string;
  name: string;
  status: string;
  portal_url: string;
  created_at: string;
  closed_at?: string | null;
}

/**
 * Branches Overview tab (PO Spec §8): read-only structural list — names,
 * codes, portal URLs, lifecycle. Deliberately carries no financial columns
 * and never will (Section 40 boundary).
 */
export function BranchesPanel(props: {
  authed: AuthFn;
  companyId: string;
  onError: (message: string) => void;
}) {
  const { authed, companyId, onError } = props;
  const [rows, setRows] = useState<BranchRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    authed<BranchRow[]>(`/companies/${companyId}/branches`)
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      })
      .catch((err: Error) => {
        if (!cancelled) onError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, companyId, onError]);

  return (
    <div className={CARD} data-testid="branches-panel">
      <strong className="text-sm">Branches Overview</strong>
      {rows === null ? (
        <p className="mt-2 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm">No branches created yet</p>
      ) : (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left">
              <th className="pr-3">Name</th><th className="pr-3">Code</th>
              <th className="pr-3">Status</th><th className="pr-3">Portal URL</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-[var(--nxp-color-surface-raised)]">
                <td className="py-1 pr-3 font-medium">{b.name}</td>
                <td className="pr-3">{b.code}</td>
                <td className="pr-3">{b.status}</td>
                <td className="pr-3"><code>{b.portal_url}</code></td>
                <td>{new Date(b.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
