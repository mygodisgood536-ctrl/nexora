import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Breadcrumbs,
  Count,
  IconButton,
  IconActivity,
  IconAlert,
  IconApprovals,
  IconAudit,
  IconBell,
  IconBranch,
  IconBuilding,
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClipboard,
  IconControl,
  IconCredit,
  IconCustomers,
  IconDashboard,
  IconEdit,
  IconFile,
  IconKey,
  IconLayers,
  IconLock,
  IconLogout,
  IconMenu,
  IconMessage,
  IconMoney,
  IconPeople,
  IconPlus,
  IconProvider,
  IconReceipt,
  IconReports,
  IconSearch,
  IconSettings,
  IconShield,
  IconTrend,
  IconUsers,
  IconWallet,
  IconX,
  cx,
  Menu,
  useToast,
  type Crumb
} from "@nexora/ui";
import { api } from "../lib/api";
import { useMe, useSession, type Me } from "../auth/SessionProvider";
import { workspaceFor, type Workspace } from "../workspaces/descriptors";
import { CommandPalette } from "./CommandPalette";

const ICONS: Record<string, (p: { size?: number }) => ReactNode> = {
  dashboard: (p) => <IconDashboard {...p} />,
  trend: (p) => <IconTrend {...p} />,
  reports: (p) => <IconReports {...p} />,
  money: (p) => <IconMoney {...p} />,
  clipboard: (p) => <IconClipboard {...p} />,
  wallet: (p) => <IconWallet {...p} />,
  branch: (p) => <IconBranch {...p} />,
  building: (p) => <IconBuilding {...p} />,
  users: (p) => <IconUsers {...p} />,
  key: (p) => <IconKey {...p} />,
  customers: (p) => <IconCustomers {...p} />,
  people: (p) => <IconPeople {...p} />,
  credit: (p) => <IconCredit {...p} />,
  approvals: (p) => <IconApprovals {...p} />,
  provider: (p) => <IconProvider {...p} />,
  activity: (p) => <IconActivity {...p} />,
  audit: (p) => <IconAudit {...p} />,
  file: (p) => <IconFile {...p} />,
  control: (p) => <IconControl {...p} />,
  settings: (p) => <IconSettings {...p} />,
  layers: (p) => <IconLayers {...p} />,
  alert: (p) => <IconAlert {...p} />,
  bell: (p) => <IconBell {...p} />,
  plus: (p) => <IconPlus {...p} />,
  edit: (p) => <IconEdit {...p} />,
  message: (p) => <IconMessage {...p} />,
  receipt: (p) => <IconReceipt {...p} />,
  calendar: (p) => <IconCalendar {...p} />,
  lock: (p) => <IconLock {...p} />,
  shield: (p) => <IconShield {...p} />,
  search: (p) => <IconSearch {...p} />
};

export function navIcon(name: string): ReactNode {
  const render = ICONS[name] ?? ICONS.dashboard;
  return render?.({ size: 17 }) ?? null;
}

/** Unread notification badge (RULE 8.9 - own inbox only), polled lightly. */
function useUnread(active: boolean): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const body = await api<{ count: number }>("/notifications/unread-count");
        if (!cancelled) setUnread(body.count ?? 0);
      } catch {
        /* badge is advisory only */
      }
    };
    void load();
    const timer = setInterval(() => void load(), 90_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);
  return unread;
}

function RoleLens({ me, refreshMe }: { me: Me; refreshMe: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (me.roles.length <= 1) return null;
  const active = me.activeRoleKey ?? me.roles[0]?.roleKey ?? "";
  return (
    <Menu
      trigger={({ open, toggle }) => (
        <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
          <span className="nx-hide-mobile">{me.roles.find((r) => r.roleKey === active)?.roleKey.replace(/_/g, " ") ?? active}</span>
          <IconChevronDown size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="nx-palette__group">Role lens (RULE 9.7)</div>
          {me.roles.map((role) => (
            <button
              key={role.roleKey}
              className="nx-menu__item"
              disabled={busy || role.roleKey === active}
              onClick={() => {
                setBusy(true);
                void api("/auth/active-role", { method: "PUT", json: { roleKey: role.roleKey } })
                  .then(() => refreshMe())
                  .then(() => toast({ title: "Role lens switched", text: role.roleKey.replace(/_/g, " "), tone: "success" }))
                  .catch((err: Error) => toast({ title: "Could not switch role", text: err.message, tone: "danger" }))
                  .finally(() => {
                    setBusy(false);
                    close();
                  });
              }}
            >
              {role.roleKey.replace(/_/g, " ")}
              {role.roleKey === active && " (active)"}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}

export function Shell({ company, children }: { company: string; children: ReactNode }) {
  const me = useMe();
  const { logout, refreshMe } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const unread = useUnread(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const workspace: Workspace = useMemo(() => workspaceFor(me.activeRoleKey), [me.activeRoleKey]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const hit = workspace.groups.find((g) => g.items.some((i) => location.pathname === i.to || (i.to !== "/" && location.pathname.startsWith(i.to + "/"))));
    if (hit) setOpenGroups((prev) => (prev[hit.key] ? prev : { ...prev, [hit.key]: true }));
  }, [location.pathname, workspace]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const crumbs: Crumb[] = useMemo(() => {
    const items: Crumb[] = [{ label: workspace.label, onClick: () => navigate("/") }];
    const group = workspace.groups.find((g) => g.items.some((i) => location.pathname === i.to || (i.to !== "/" && location.pathname.startsWith(i.to + "/"))));
    const item = group?.items.find((i) => location.pathname === i.to || (i.to !== "/" && location.pathname.startsWith(i.to + "/")));
    if (group) items.push({ label: group.title });
    if (item) items.push({ label: item.label });
    return items;
  }, [location.pathname, workspace]);

  return (
    <div className={cx("nx-app", collapsed && "nx-app--collapsed")}>
      <aside className={cx("nx-sidebar", mobileOpen && "is-open")} style={mobileOpen ? { display: "flex" } : undefined}>
        <div className="nx-sidebar__brand">
          <span className="nx-sidebar__logo" aria-hidden="true">{company.slice(0, 1).toUpperCase()}</span>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div className="nx-sidebar__brand-name">{company}</div>
              <div className="nx-sidebar__brand-sub">{workspace.label}</div>
            </div>
          )}
          <div className="nx-grow" />
          <IconButton
            className="nx-hide-mobile"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
          </IconButton>
          <IconButton className="nx-mobile-only" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
            <IconX size={16} />
          </IconButton>
        </div>

        <nav className="nx-sidebar__scroll" aria-label="Workspace">
          {collapsed &&
            workspace.groups.flatMap((g) => g.items).map((item) => (
              <NavLink
                key={`${item.to}-${item.label}`}
                to={item.to}
                end={item.to === "/"}
                title={item.label}
                className={({ isActive }) => cx("nx-navitem", isActive && "is-active")}
                style={{ justifyContent: "center", padding: "10px 0" }}
              >
                <span className="nx-navitem__icon">{navIcon(item.icon)}</span>
              </NavLink>
            ))}

          {!collapsed &&
            workspace.groups.map((group) => {
              const open = openGroups[group.key] ?? false;
              return (
                <div className="nx-navgroup" key={group.key}>
                  <button
                    type="button"
                    className="nx-navgroup__head"
                    aria-expanded={open}
                    onClick={() => setOpenGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                  >
                    <span className="nx-grow">{group.title}</span>
                    {open ? <IconChevronLeft size={13} /> : <IconChevronDown size={13} />}
                  </button>
                  {open &&
                    group.items.map((item) => (
                      <NavLink
                        key={`${item.to}-${item.label}`}
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) => cx("nx-navitem", isActive && "is-active")}
                      >
                        <span className="nx-navitem__icon">{navIcon(item.icon)}</span>
                        <span>{item.label}</span>
                        {item.to === "/notifications" && unread > 0 && (
                          <span className="nx-navitem__badge"><Count n={unread} /></span>
                        )}
                      </NavLink>
                    ))}
                </div>
              );
            })}
        </nav>

        <div className="nx-sidebar__footer">
          <Avatar name={me.userId} size="sm" />
          {!collapsed && (
            <div style={{ minWidth: 0 }} className="nx-grow">
              <div style={{ fontSize: "var(--nx-text-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                {workspace.label}
              </div>
              <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {me.branchId ? `Branch ${me.branchId.slice(0, 8)}` : "Head office"}
              </div>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="nx-drawer-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="nx-content">
        <header className="nx-header">
          <IconButton className="nx-mobile-only" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <IconMenu size={18} />
          </IconButton>
          <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm" onClick={() => setPaletteOpen(true)} title="Search pages (Ctrl+K)">
            <IconSearch size={15} />
            <span className="nx-hide-mobile">Search pages</span>
            <span className="nx-kbd nx-hide-mobile">Ctrl K</span>
          </button>
          <div className="nx-header__spacer" />
          <RoleLens me={me} refreshMe={refreshMe} />
          <NavLink
            to="/notifications"
            title="Notifications"
            className={({ isActive }) => cx("nx-btn", isActive ? "nx-btn--secondary" : "nx-btn--ghost", "nx-btn--icon")}
            style={{ position: "relative" }}
          >
            <IconBell size={17} />
            {unread > 0 && <span style={{ position: "absolute", top: 2, right: 2 }}><Count n={unread} /></span>}
          </NavLink>
          <Menu
            trigger={({ toggle }) => (
              <IconButton aria-label="Account menu" onClick={toggle}>
                <Avatar name={me.userId} size="sm" />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                <div style={{ padding: "8px 10px", fontSize: "var(--nx-text-sm)" }}>
                  <strong>{company}</strong>
                  <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                    {me.roles.map((r) => r.roleKey.replace(/_/g, " ")).join(", ")}
                  </div>
                </div>
                <div className="nx-menu__sep" />
                <button className="nx-menu__item" onClick={() => { close(); navigate("/profile"); }}>
                  <IconSettings size={16} /> My profile
                </button>
                <button className="nx-menu__item" onClick={() => { close(); void logout(); }}>
                  <IconLogout size={16} /> Sign out
                </button>
              </>
            )}
          </Menu>
        </header>
        <main className="nx-main">
          <Breadcrumbs items={crumbs} />
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} workspace={workspace} />
    </div>
  );
}
