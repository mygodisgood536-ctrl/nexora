const NF = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat("en-US");

/** Exact amount strings from the API are formatted with two decimals. */
export function money(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return NF.format(n);
}

export function moneyLabel(value: unknown, currency = "UGX"): string {
  return `${currency} ${money(value)}`;
}

export function whole(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return INT.format(n);
}

export function pct(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${NF.format(n)}%`;
}

/** ISO date or datetime -> short local date. */
export function day(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** ISO datetime -> short local date-time. */
export function when(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Picks the first present field from a snake_case or camelCase row. */
export function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function personName(row: Record<string, unknown>): string {
  const first = String(pick(row, ["first_name", "firstName"]) ?? "");
  const middle = String(pick(row, ["middle_name", "middleName"]) ?? "");
  const last = String(pick(row, ["last_name", "lastName"]) ?? "");
  return [first, middle, last].filter(Boolean).join(" ") || (String(pick(row, ["name", "customer_name", "actor_name"]) ?? ""));
}

export function id8(id: unknown): string {
  const s = String(id ?? "");
  return s.length > 8 ? `${s.slice(0, 8)}` : s;
}

export function todayParam(): string {
  return new Date().toISOString().slice(0, 10);
}