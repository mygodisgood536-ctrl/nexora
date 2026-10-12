import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";
import { IconAlert, IconCheck, IconInfo, IconSearch, IconX } from "./icons";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ==========================================================================
   Formatters (RULE 11.1.1 - one vocabulary; long numbers stay legible)
   ========================================================================== */

const moneyFmt = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });
const moneyFmtNoSymbol = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat("en-NG");

export function formatMoney(value: number | string | null | undefined, opts: { symbol?: boolean } = {}): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return opts.symbol === false ? moneyFmtNoSymbol.format(n) : moneyFmt.format(n);
}

export function formatNumber(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? intFmt.format(n) : "—";
}

export function formatPercent(value: number | string | null | undefined, digits = 1): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (Number.isNaN(mins)) return "—";
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return formatDate(d);
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${(parts[0] ?? "")[0]}${(parts[parts.length - 1] ?? "")[0]}`.toUpperCase();
}

/* ==========================================================================
   Button
   ========================================================================== */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  block,
  loading,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(
        "nx-btn",
        `nx-btn--${variant}`,
        size !== "md" && `nx-btn--${size}`,
        block && "nx-btn--block",
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="nx-spinner" style={{ borderTopColor: "currentColor", width: 14, height: 14 }} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  variant = "ghost",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={cx("nx-btn", `nx-btn--${variant}`, "nx-btn--icon", className)} {...rest}>
      {children}
    </button>
  );
}

/* ==========================================================================
   Forms
   ========================================================================== */

export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  children
}: {
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="nx-field">
      {label != null && (
        <label className="nx-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="nx-label__req" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? <span className="nx-error-text" role="alert">{error}</span> : hint ? <span className="nx-hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("nx-input", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("nx-select", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("nx-textarea", className)} {...rest} />;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx("nx-search", className)}>
      <span className="nx-search__icon"><IconSearch size={16} /></span>
      <input
        className="nx-input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

export function Checkbox({
  label,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="nx-check">
      <input type="checkbox" {...rest} />
      <span>
        {label}
        {hint && <span className="nx-hint" style={{ display: "block" }}>{hint}</span>}
      </span>
    </label>
  );
}

export function Switch({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="nx-switch">
      <input type="checkbox" role="switch" {...rest} />
      <span className="nx-switch__track" />
      <span>{label}</span>
    </label>
  );
}

/* ==========================================================================
   Surfaces
   ========================================================================== */

export function Card({
  title,
  actions,
  children,
  padded = true,
  raised,
  footer,
  className,
  headId
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  raised?: boolean;
  footer?: ReactNode;
  className?: string;
  headId?: string;
}) {
  return (
    <section className={cx("nx-card", raised && "nx-card--raised", className)}>
      {(title != null || actions) && (
        <header className="nx-card__head" aria-labelledby={headId}>
          {title != null && <h3 className="nx-card__title" id={headId}>{title}</h3>}
          <div className="nx-grow" />
          {actions}
        </header>
      )}
      <div className={cx("nx-card__body", !padded && "nx-card__body--flush")}>{children}</div>
      {footer && <footer className="nx-card__foot">{footer}</footer>}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
}) {
  return (
    <div className="nx-stack nx-stack--sm">
      {breadcrumbs}
      <div className="nx-page-head">
        <div className="nx-stack nx-stack--sm" style={{ minWidth: 0 }}>
          {eyebrow && <span className="nx-eyebrow">{eyebrow}</span>}
          <h1 className="nx-h1">{title}</h1>
          {description && <p className="nx-muted" style={{ maxWidth: "78ch" }}>{description}</p>}
        </div>
        {actions && <div className="nx-page-head__actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent,
  icon
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className={cx("nx-stat", accent && "nx-stat--accent")}>
      <span className="nx-stat__label">
        {icon}
        {label}
      </span>
      <span className="nx-stat__value">{value}</span>
      {hint && <span className="nx-stat__hint">{hint}</span>}
    </div>
  );
}

/* ==========================================================================
   Badges / status (words first, colour supports - RULE 13.5.3)
   ========================================================================== */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function toneForStatus(status: string | null | undefined): Tone {
  const s = (status ?? "").toLowerCase();
  if (["active", "approved", "paid", "posted", "allocated", "completed", "resolved", "verified", "live", "healthy", "open-ok", "success"].some((k) => s.includes(k))) return "success";
  if (["pending", "awaiting", "review", "draft", "processing", "scheduled", "in_setup", "setup", "partial", "queued"].some((k) => s.includes(k))) return "warning";
  if (["failed", "rejected", "overdue", "default", "suspended", "frozen", "closed-bad", "error", "exception", "unmatched", "unallocated", "terminated"].some((k) => s.includes(k))) return "danger";
  if (["info", "new"].some((k) => s.includes(k))) return "info";
  return "neutral";
}

export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("nx-badge", `nx-badge--${tone}`)}>
      {dot && <span className="nx-dot" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  return <Badge tone={toneForStatus(status)} dot>{label ?? (status ? String(status).replace(/_/g, " ") : "unknown")}</Badge>;
}

export function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="nx-count">{n > 99 ? "99+" : n}</span>;
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="nx-chip">{children}</span>;
}

/* ==========================================================================
   Tabs
   ========================================================================== */

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="nx-tabs" role="tablist">
      {items.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={value === t.key}
          className={cx("nx-tab", value === t.key && "is-active")}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count != null && <span className="nx-faint" style={{ marginLeft: 6, fontSize: "0.75rem" }}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ==========================================================================
   Table
   ========================================================================== */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  width?: string;
  hideBelow?: "760px" | "1000px";
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  empty
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="nx-table-wrap">
      <table className={cx("nx-table", onRowClick && "nx-table--clickable")}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={cx(c.numeric && "nx-num")}
                style={{
                  width: c.width,
                  display: c.hideBelow ? undefined : undefined
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={cx(selectedKey != null && selectedKey === key && "is-selected")}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.numeric && "nx-num")}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onChange
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (nextOffset: number) => void;
}) {
  const page = Math.floor(offset / Math.max(limit, 1)) + 1;
  const pages = Math.max(1, Math.ceil(total / Math.max(limit, 1)));
  return (
    <div className="nx-pagination">
      <span>
        {total === 0 ? "No records" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
      </span>
      <div className="nx-grow" />
      <Button size="sm" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
        Previous
      </Button>
      <span className="nx-faint">
        Page {page} of {pages}
      </span>
      <Button size="sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}>
        Next
      </Button>
    </div>
  );
}

/* ==========================================================================
   Progress / Avatar / Breadcrumbs
   ========================================================================== */

export function Progress({
  value,
  max = 100,
  tone,
  label
}: {
  value: number;
  max?: number;
  tone?: "success" | "warning" | "danger";
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1)) * 100));
  return (
    <div
      className={cx("nx-progress", tone && `nx-progress--${tone}`)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="nx-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name, size = "md", src }: { name?: string; size?: "sm" | "md" | "lg"; src?: string | null }) {
  return (
    <span className={cx("nx-avatar", size !== "md" && `nx-avatar--${size}`)} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

export interface Crumb {
  label: ReactNode;
  onClick?: () => void;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="nx-breadcrumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="nx-row" style={{ gap: 6 }}>
          {i > 0 && <span className="nx-breadcrumbs__sep">/</span>}
          {i === items.length - 1 ? (
            <span aria-current="page">{c.label}</span>
          ) : c.onClick ? (
            <button type="button" onClick={c.onClick}>{c.label}</button>
          ) : (
            <span>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ==========================================================================
   States
   ========================================================================== */

export function EmptyState({
  title,
  text,
  icon,
  action
}: {
  title: ReactNode;
  text?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="nx-empty">
      <span className="nx-empty__icon">{icon ?? <IconInfo size={26} />}</span>
      <span className="nx-empty__title">{title}</span>
      {text && <p className="nx-empty__text">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", onRetry, detail }: { title?: ReactNode; onRetry?: () => void; detail?: ReactNode }) {
  return (
    <div className="nx-errorstate" role="alert">
      <IconAlert size={20} />
      <div className="nx-stack nx-stack--sm nx-grow">
        <strong>{title}</strong>
        {detail && <span style={{ color: "var(--nx-text-secondary)" }}>{detail}</span>}
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function PermissionDenied({ text, action }: { text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="nx-permission">
      <span className="nx-row" style={{ gap: 8, color: "var(--nx-warning)" }}>
        <IconAlert size={18} />
        <strong>Not available to your role</strong>
      </span>
      <p className="nx-muted" style={{ maxWidth: "64ch" }}>
        {text ?? "Your role does not include this page. If you believe you need it, ask your Head Office administrator to grant the permission on your role assignment."}
      </p>
      {action}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", radius }: { height?: number | string; width?: number | string; radius?: number }) {
  return <span className="nx-skeleton" style={{ display: "block", height, width, borderRadius: radius }} />;
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="nx-stack nx-stack--sm" style={{ padding: "var(--nx-space-4)" }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="nx-row" style={{ gap: "var(--nx-space-4)" }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} height={14} width={c === 0 ? "28%" : "17%"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function LoadingRow({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="nx-loading-row">
      <span className="nx-spinner" />
      {text}
    </div>
  );
}

/* ==========================================================================
   Modal / Drawer / Confirm
   ========================================================================== */

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="nx-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("nx-modal", wide && "nx-modal--wide")} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <header className="nx-modal__head">
          <h3 className="nx-card__title">{title}</h3>
          <div className="nx-grow" />
          <IconButton aria-label="Close dialog" onClick={onClose}><IconX size={16} /></IconButton>
        </header>
        <div className="nx-modal__body">{children}</div>
        {footer && <div className="nx-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="nx-drawer-overlay" onMouseDown={onClose} />
      <aside className="nx-drawer" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <header className="nx-modal__head">
          <h3 className="nx-card__title">{title}</h3>
          <div className="nx-grow" />
          <IconButton aria-label="Close panel" onClick={onClose}><IconX size={16} /></IconButton>
        </header>
        <div className="nx-modal__body nx-grow">{children}</div>
        {footer && <div className="nx-modal__foot">{footer}</div>}
      </aside>
    </>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "primary",
  busy
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: ButtonVariant;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}

/* ==========================================================================
   Toasts (13.5.3 - never colour alone: title + text always present)
   ========================================================================== */

export interface ToastInput {
  title: ReactNode;
  text?: ReactNode;
  tone?: "accent" | "success" | "danger" | "warning";
  ms?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastCtx = createContext<(t: ToastInput) => void>(() => undefined);

export function useToast(): (t: ToastInput) => void {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), t.ms ?? 4200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="nx-toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx("nx-toast", t.tone && t.tone !== "accent" && `nx-toast--${t.tone}`)}>
            <span
              style={{
                color:
                  t.tone === "success" ? "var(--nx-success)"
                  : t.tone === "danger" ? "var(--nx-danger)"
                  : t.tone === "warning" ? "var(--nx-warning)"
                  : "var(--nx-color-accent)"
              }}
            >
              {t.tone === "danger" || t.tone === "warning" ? <IconAlert size={18} /> : t.tone === "success" ? <IconCheck size={18} /> : <IconInfo size={18} />}
            </span>
            <div className="nx-grow">
              <div className="nx-toast__title">{t.title}</div>
              {t.text && <div className="nx-toast__text">{t.text}</div>}
            </div>
            <button
              type="button"
              className="nx-btn nx-btn--ghost nx-btn--icon"
              aria-label="Dismiss"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <IconX size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ==========================================================================
   Dropdown menu
   ========================================================================== */

export function Menu({
  trigger,
  children,
  align = "right"
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div className="nx-menu" style={align === "left" ? { left: 0, right: "auto" } : undefined}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   Definition list / timeline
   ========================================================================== */

export function KV({ items }: { items: Array<{ label: ReactNode; value: ReactNode }> }) {
  return (
    <dl className="nx-kv">
      {items.map((it, i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ items }: { items: Array<{ id: string; title: ReactNode; meta?: ReactNode; body?: ReactNode }> }) {
  return (
    <div className="nx-timeline">
      {items.map((it) => (
        <div className="nx-timeline__item" key={it.id}>
          <span className="nx-timeline__marker" />
          <div className="nx-grow">
            <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: "var(--nx-text-md)" }}>{it.title}</strong>
              {it.meta && <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{it.meta}</span>}
            </div>
            {it.body && <div className="nx-muted" style={{ fontSize: "var(--nx-text-sm)" }}>{it.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
   Summary blocks helper (RULE 12.0.3 - landing summary, groups, pages)
   ========================================================================== */

export function SummaryGrid({ children }: { children: ReactNode }) {
  return <div className="nx-grid nx-grid--4">{children}</div>;
}

export function SectionGroup({
  title,
  children,
  actions
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="nx-stack nx-stack--sm">
      {(title != null || actions) && (
        <div className="nx-row nx-row--between">
          {title && <h2 className="nx-h3">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
