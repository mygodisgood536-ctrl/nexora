import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Input, cx } from "@nexora/ui";
import { navIcon } from "./Shell";
import type { Workspace } from "../workspaces/descriptors";

/**
 * RULE 12.0.2 / Part 17 - every page of the workspace is reachable with the
 * keyboard: Ctrl/Cmd-K opens a search over the role's own nav items.
 */
export function CommandPalette({
  open,
  onClose,
  workspace
}: {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const flat = workspace.groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.title })));
    const seen = new Set<string>();
    return flat
      .filter((item) => {
        const key = `${item.to}|${item.label}`;
        if (seen.has(key)) return false;
        seen.add(key);
        if (!q) return true;
        return item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q) || item.to.includes(q);
      })
      .slice(0, 40);
  }, [query, workspace]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function go(to: string): void {
    onClose();
    navigate(to);
  }

  return (
    <Modal open={open} onClose={onClose} title="Jump to a page">
      <div className="nx-stack nx-stack--sm">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${workspace.label.toLowerCase()} pages…`}
          aria-label="Search pages"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              go(results[active]!.to);
            }
          }}
        />
        <div className="nx-palette">
          {results.length === 0 && (
            <p className="nx-muted" style={{ padding: "10px 12px", fontSize: "var(--nx-text-sm)" }}>
              Nothing in this workspace matches “{query}”. Pages you do not have permission for are
              never listed.
            </p>
          )}
          {results.map((item, i) => (
            <button
              key={`${item.to}-${item.label}`}
              type="button"
              className={cx("nx-palette__item", i === active && "is-active")}
              onClick={() => go(item.to)}
              onMouseEnter={() => setActive(i)}
            >
              {navIcon(item.icon)}
              <span className="nx-grow">{item.label}</span>
              <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{item.group}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
