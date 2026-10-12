import { useState, type ReactNode } from "react";
import { ErrorState, LoadingRow, Pagination, SearchInput, Table, type Column } from "@nexora/ui";
import { useList } from "../lib/useResource";

export const PAGE_SIZE = 25;

/** Combines search + rowTable + pagination for every list page. */
export function ListTable<T>({
  rows,
  total,
  loading,
  error,
  offset,
  pageSize = PAGE_SIZE,
  onOffset,
  onReload,
  columns,
  rowKey,
  onRowClick,
  empty
}: {
  rows: T[];
  total: number;
  loading: boolean;
  error: string | null;
  offset: number;
  pageSize?: number;
  onOffset: (n: number) => void;
  onReload: () => void;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (loading) return <LoadingRow text="Loading…" />;
  if (error) return <ErrorState title="Could not load this view" detail={error} onRetry={onReload} />;
  return (
    <>
      <Table rows={rows} columns={columns} rowKey={rowKey} onRowClick={onRowClick} empty={empty} />
      {total > 0 && <Pagination total={total} limit={pageSize} offset={offset} onChange={onOffset} />}
    </>
  );
}

/** Debounce-free search wrapper for lists. */
export function useSearch() {
  const [search, setSearch] = useState("");
  return { search, setSearch };
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <SearchInput value={value} onChange={onChange} placeholder={placeholder ?? "Search…"} />;
}

export interface ListParams {
  search?: string;
  status?: string;
}

/** Convenience hook: mounts useList with search/status/offet wiring. */
export function useListPage<T>(path: string, params: ListParams = {}) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.status ?? "");
  const list = useList<T>(path, {
    params: { search: search || undefined, status: status || undefined },
    page: Math.floor(offset / PAGE_SIZE) + 1,
    pageSize: PAGE_SIZE
  });
  return { ...list, offset, setOffset, search, setSearch, status, setStatus };
}

export interface Crumb {
  label: string;
  to?: string;
}

/** Breadcrumb trail for PageHeader (words first, current page last). */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="nx-crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`}>
          {i > 0 && <span className="nx-faint"> / </span>}
          {c.to ? <a className="nx-link" href={c.to}>{c.label}</a> : <span className="nx-faint">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}