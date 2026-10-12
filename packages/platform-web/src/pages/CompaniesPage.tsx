import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  IconBuilding,
  IconPlus,
  IconButton,
  IconChevronDown,
  IconChevronUp,
  LoadingRow,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  EmptyState,
  ErrorState,
  formatDate,
  formatRelative,
  Menu,
  type Column
} from "@nexora/ui";
import { api, type Json } from "../lib/api";

interface CompanyRow extends Json {
  id: string;
  name: string;
  slug: string;
  codePrefix: string;
  portalUrl: string | null;
  status: string;
  planTier: string | null;
  createdAt: string;
  lastActivityAt: string | null;
  branches: number;
  workers: number;
  rolesEnabled: number;
  setupComplete: boolean;
}

type SortKey = "created_at" | "name" | "status" | "last_activity_at";

const LIMIT = 20;

export function CompaniesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortKey>("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset), sort, order });
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const page = await api<{ items: CompanyRow[]; total: number }>(`/companies?${params.toString()}`);
      setRows(page.items ?? []);
      setTotal(page.total ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [offset, search, status, sort, order]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    setOffset(0);
  }, [search, status, sort, order]);

  function toggleSort(key: SortKey) {
    if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setOrder(key === "name" || key === "status" ? "asc" : "desc");
    }
  }

  const SortHead = ({ label, k }: { label: string; k: SortKey }) => (
    <button type="button" className="nx-row" style={{ gap: 4, background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }} onClick={() => toggleSort(k)}>
      {label}
      {sort === k && (order === "asc" ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />)}
    </button>
  );

  const columns: Column<CompanyRow>[] = [
    {
      key: "name",
      header: <SortHead label="Company" k="name" />,
      render: (r) => (
        <div className="nx-stack nx-stack--sm" style={{ gap: 2 }}>
          <strong>{r.name}</strong>
          <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{r.slug}.nexora.app - {r.codePrefix}</span>
        </div>
      )
    },
    {
      key: "status",
      header: <SortHead label="Status" k="status" />,
      render: (r) => (
        <div className="nx-row" style={{ gap: 8 }}>
          <StatusBadge status={r.status} />
          {!r.setupComplete && r.status === "in_setup" && <Badge tone="warning">draft</Badge>}
        </div>
      )
    },
    { key: "branches", header: "Branches", numeric: true, hideBelow: "760px", render: (r) => <span className="nx-num">{r.branches}</span> },
    { key: "workers", header: "Workers", numeric: true, hideBelow: "760px", render: (r) => <span className="nx-num">{r.workers}</span> },
    { key: "roles", header: "Roles on", numeric: true, hideBelow: "1000px", render: (r) => <span className="nx-num">{r.rolesEnabled}</span> },
    {
      key: "created",
      header: <SortHead label="Created" k="created_at" />,
      hideBelow: "760px",
      render: (r) => <span title={formatDate(r.createdAt)}>{formatDate(r.createdAt)}</span>
    },
    {
      key: "activity",
      header: <SortHead label="Last activity" k="last_activity_at" />,
      hideBelow: "1000px",
      render: (r) => <span className="nx-muted">{r.lastActivityAt ? formatRelative(r.lastActivityAt) : "never"}</span>
    },
    {
      key: "actions",
      header: "",
      width: "48px",
      render: (r) => (
        <Menu
          trigger={({ toggle }) => (
            <IconButton aria-label={`Actions for ${r.name}`} onClick={toggle} size="sm">
              <span style={{ letterSpacing: 1, fontWeight: 700 }}>⋯</span>
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <button className="nx-menu__item" onClick={() => { close(); navigate(`/companies/${r.id}`); }}>
                <IconBuilding size={15} /> Open company detail
              </button>
              <button className="nx-menu__item" onClick={() => { close(); void navigator.clipboard?.writeText(r.portalUrl ?? `${r.slug}.nexora.app`); }}>
                <IconBuilding size={15} /> Copy portal URL
              </button>
              {r.status === "in_setup" && (
                <button className="nx-menu__item" onClick={() => { close(); navigate("/drafts"); }}>
                  <IconBuilding size={15} /> Open drafts
                </button>
              )}
            </>
          )}
        </Menu>
      )
    }
  ];

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Companies workspace"
        description="Structural and aggregate facts only - search, filter, sort and paginate, then open the exact company by id (RULE 3.6)."
        actions={
          <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => navigate("/companies/new")}>
            Create company
          </Button>
        }
      />

      <Card padded={false}>
        <div className="nx-contextbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, slug or code prefix…" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" style={{ width: 170 }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="in_setup">In setup</option>
            <option value="suspended">Suspended</option>
          </Select>
          <div className="nx-grow" />
          <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{total} companies</span>
          <Button size="sm" onClick={() => void load()} disabled={loading}>Refresh</Button>
        </div>

        {loading ? (
          <LoadingRow text="Loading companies…" />
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState title="Companies could not load" detail={error} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconBuilding size={26} />}
            title={search || status ? "No companies match this filter" : "No companies yet"}
            text={search || status ? "Clear the filters to see every company on the platform." : "Create the first company to start the platform."}
            action={
              search || status ? (
                <Button onClick={() => { setSearch(""); setStatus(""); }}>Clear filters</Button>
              ) : (
                <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => navigate("/companies/new")}>Create company</Button>
              )
            }
          />
        ) : (
          <>
            <Table columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/companies/${r.id}`)} />
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--nx-border)" }}>
              <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />
            </div>
          </>
        )}
      </Card>

      <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
        Financial records of a company are never shown here. Aggregate drill-down lives behind a
        time-bound support session (RULE 3.6.2 / 3.7.2).
      </p>
    </div>
  );
}
