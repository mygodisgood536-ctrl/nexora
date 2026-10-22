import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Button,
  Count,
  IconButton,
  IconBell,
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconCpu,
  IconDashboard,
  IconLayers,
  IconLogout,
  IconMenu,
  IconMessage,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShield,
  IconTrend,
  IconUser,
  IconUsers,
  IconX,
  NexoraMark,
  cx,
  Menu
} from "@nexora/ui";
import { api, getToken } from "../lib/api";

interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
}

const NAV_GROUPS: Array<{ title: string; items: NavEntry[] }> = [
  {
    title: "Platform",
    items: [
      { to: "/", label: "Dashboard", icon: <IconDashboard size={17} /> },
      { to: "/companies", label: "Companies", icon: <IconBuilding size={17} /> },
      { to: "/drafts", label: "Drafts", icon: <IconLayers size={17} /> },
      { to: "/usage", label: "Users & usage", icon: <IconUsers size={17} /> }
    ]
  },
  {
    title: "Operations",
    items: [
      { to: "/health", label: "Platform health", icon: <IconCpu size={17} /> },
      { to: "/activity", label: "Platform activity", icon: <IconTrend size={17} /> },
      { to: "/notifications", label: "Notifications", icon: <IconBell size={17} /> },
      { to: "/support", label: "Support access", icon: <IconShield size={17} /> }
    ]
  },
  {
    title: "Configuration",
    items: [
      { to: "/announcements", label: "Announcements", icon: <IconMessage size={17} /> },
      { to: "/settings", label: "Global settings", icon: <IconSettings size={17} /> },
      { to: "/configuration", label: "Platform configuration", icon: <IconSettings size={17} /> },
      { to: "/ai", label: "AI insights", icon: <IconCpu size={17} /> },
      { to: "/audit", label: "Audit trail", icon: <IconShield size={17} /> }
    ]
  }
];

export function Shell({
  ownerEmail,
  onLogout,
  unread,
  children
}: {
  ownerEmail: string;
  onLogout: () => void;
  unread: number;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className={cx("nx-app", collapsed && "nx-app--collapsed")}>
      <aside className={cx("nx-sidebar", mobileOpen && "is-open")} style={mobileOpen ? { display: "flex" } : undefined}>
        <div className="nx-sidebar__brand">
          <NexoraMark size={28} />
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div className="nx-sidebar__brand-name">Nexora</div>
              <div className="nx-sidebar__brand-sub">Platform Owner</div>
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

        <div className="nx-sidebar__scroll">
          {!collapsed &&
            NAV_GROUPS.map((group) => (
              <div className="nx-navgroup" key={group.title}>
                <div className="nx-navgroup__title">{group.title}</div>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) => cx("nx-navitem", isActive && "is-active")}
                  >
                    <span className="nx-navitem__icon">{item.icon}</span>
                    {!collapsed && <span>{item.label}</span>}
                    {item.to === "/notifications" && unread > 0 && !collapsed && (
                      <span className="nx-navitem__badge"><Count n={unread} /></span>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          {collapsed &&
            NAV_GROUPS.flatMap((g) => g.items).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                title={item.label}
                className={({ isActive }) => cx("nx-navitem", isActive && "is-active")}
                style={{ justifyContent: "center", padding: "10px 0" }}
              >
                <span className="nx-navitem__icon">{item.icon}</span>
              </NavLink>
            ))}
        </div>

        <div className="nx-sidebar__footer">
          <button
            type="button"
            className="nx-row"
            style={{ background: "none", border: 0, padding: 0, cursor: "pointer", minWidth: 0, flex: 1, textAlign: "left" }}
            onClick={() => navigate("/profile")}
            title="Your account"
          >
            <Avatar name={ownerEmail} size="sm" />
            {!collapsed && (
              <div style={{ minWidth: 0 }} className="nx-grow">
                <div style={{ fontSize: "var(--nx-text-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                  Platform Owner
                </div>
                <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ownerEmail}
                </div>
              </div>
            )}
          </button>
          <IconButton aria-label="Sign out" onClick={onLogout} title="Sign out">
            <IconLogout size={16} />
          </IconButton>
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
          <div className="nx-row nx-hide-mobile" style={{ color: "var(--nx-text-muted)", fontSize: "var(--nx-text-sm)" }}>
            <IconSearch size={15} />
            <span>Platform Owner console - every action here is audited (RULE 3.7.1)</span>
          </div>
          <div className="nx-header__spacer" />
          <Button variant="primary" size="sm" icon={<IconPlus size={15} />} onClick={() => navigate("/companies/new")}>
            Create company
          </Button>
          <NavLink
            to="/notifications"
            title="Notifications"
            className={({ isActive }) => cx("nx-btn", isActive ? "nx-btn--secondary" : "nx-btn--ghost", "nx-btn--icon")}
            style={{ position: "relative" }}
          >
            <IconBell size={17} />
            {unread > 0 && (
              <span style={{ position: "absolute", top: 2, right: 2 }}><Count n={unread} /></span>
            )}
          </NavLink>
          <Menu
            trigger={({ toggle }) => (
              <IconButton aria-label="Account menu" onClick={toggle}>
                <Avatar name={ownerEmail} size="sm" />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                <div style={{ padding: "8px 10px", fontSize: "var(--nx-text-sm)" }}>
                  <strong>Cornelius Adedeji Victor</strong>
                  <div className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{ownerEmail}</div>
                </div>
                <div className="nx-menu__sep" />
                <button
                  className="nx-menu__item"
                  onClick={() => {
                    close();
                    navigate("/profile");
                  }}
                >
                  <IconUser size={16} /> Your account
                </button>
                <button className="nx-menu__item" onClick={() => { close(); onLogout(); }}>
                  <IconLogout size={16} /> Sign out
                </button>
              </>
            )}
          </Menu>
        </header>
        <main className="nx-main">{children}</main>
      </div>
    </div>
  );
}

/** Loads the unread platform notification count (RULE 3.7.3 attention queue). */
export function useUnreadCount(active: boolean): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!active || !getToken()) return;
    let cancelled = false;
    void (async () => {
      try {
        const audit = await api<unknown>("/audit?limit=50");
        const rows = Array.isArray(audit) ? audit : [];
        const recent = rows.filter((r) => {
          const row = r as { created_at?: string; action?: string };
          const at = row.created_at ? new Date(row.created_at).getTime() : 0;
          return Date.now() - at < 7 * 24 * 3600 * 1000;
        }).length;
        if (!cancelled) setUnread(recent);
      } catch {
        /* badge is advisory only */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);
  return unread;
}
