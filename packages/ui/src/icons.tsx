import type { SVGProps } from "react";

/** Minimal, consistent 20px stroke icon set (Part 17 component inventory). */
function Icon({ children, size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Icon>
);
export const IconMoney = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></Icon>
);
export const IconBranch = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M3 21h18M5 21V9l7-5 7 5v12M9.5 21v-5h5v5" /></Icon>
);
export const IconUsers = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 15.4c2 .7 3.5 2.3 4 4.6" /></Icon>
);
export const IconUser = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><circle cx="12" cy="8" r="3.75" /><path d="M4.5 20.5c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5" /></Icon>
);
export const IconCustomers = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><circle cx="12" cy="7.5" r="3.5" /><path d="M5 20c.9-3.4 3.7-5.2 7-5.2s6.1 1.8 7 5.2" /><path d="M3 8.5h2.5M3 12h2M19 8.5h2M19 12h2" /></Icon>
);
export const IconCredit = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 10h18M7 15h4" /></Icon>
);
export const IconProvider = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M8.5 3v5.5M15.5 3v5.5M6 8.5h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6v-3Z" /><path d="M12 17.5V21" /></Icon>
);
export const IconApprovals = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M12 3l7.5 3v5.5c0 4.4-3 8-7.5 9.5-4.5-1.5-7.5-5.1-7.5-9.5V6L12 3Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></Icon>
);
export const IconAudit = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 12.5h6M10 16h6" /></Icon>
);
export const IconControl = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" /></Icon>
);
export const IconReports = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12.5 16V8M17 16v-6" /></Icon>
);
export const IconPeople = IconUsers;
export const IconSettings = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h8M16 17h4" /><circle cx="16" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="14" cy="17" r="2" /></Icon>
);
export const IconSearch = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Icon>
);
export const IconBell = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5Z" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /></Icon>
);
export const IconPlus = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);
export const IconCheck = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>
);
export const IconX = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>
);
export const IconAlert = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M12 4.5 21 19.5H3L12 4.5Z" /><path d="M12 10v4M12 16.6v.4" /></Icon>
);
export const IconInfo = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.4" /></Icon>
);
export const IconChevronRight = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></Icon>
);
export const IconChevronDown = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="m5.5 9 6.5 6.5L18.5 9" /></Icon>
);
export const IconChevronLeft = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M14.5 5.5 8 12l6.5 6.5" /></Icon>
);
export const IconChevronUp = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="m5.5 15 6.5-6.5L18.5 15" /></Icon>
);
export const IconArrowRight = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M4 12h15M13.5 6.5 20 12l-6.5 5.5" /></Icon>
);
export const IconMenu = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
);
export const IconLogout = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" /><path d="M10 12h10.5M17.5 8.5 21 12l-3.5 3.5" /></Icon>
);
export const IconShield = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M12 3l7.5 3v5.5c0 4.4-3 8-7.5 9.5-4.5-1.5-7.5-5.1-7.5-9.5V6L12 3Z" /></Icon>
);
export const IconFile = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></Icon>
);
export const IconReceipt = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M6 3h12v18l-3-1.6-3 1.6-3-1.6L6 21V3Z" /><path d="M9.5 8h5M9.5 12h5" /></Icon>
);
export const IconCalendar = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Icon>
);
export const IconEye = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></Icon>
);
export const IconEdit = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m13.5 6 4 4" /></Icon>
);
export const IconBuilding = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2M10 20v-4h4v4" /></Icon>
);
export const IconWallet = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5v3" /><rect x="3.5" y="7.5" width="17" height="12" rx="2.5" /><circle cx="16.5" cy="13.5" r="1.25" /></Icon>
);
export const IconTrend = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="m3.5 16.5 5-5 3.5 3.5 7-7" /><path d="M14.5 8h4.5v4.5" /></Icon>
);
export const IconClipboard = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><rect x="5" y="5" width="14" height="16" rx="2.5" /><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" /></Icon>
);
export const IconMessage = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-5 4V6.5Z" /></Icon>
);
export const IconActivity = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M3 12.5h4l2.5-7 4 14 2.5-7h5" /></Icon>
);
export const IconDatabase = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><ellipse cx="12" cy="6" rx="7.5" ry="3" /><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" /><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" /></Icon>
);
export const IconCpu = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" /></Icon>
);
export const IconGrid = IconDashboard;
export const IconFolder = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.8c.7 0 1.4.3 1.9.8l1.1 1.2c.5.5 1.2.8 1.9.8H18A2.5 2.5 0 0 1 20.5 9.8V17A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17V7Z" /></Icon>
);
export const IconDownload = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" /></Icon>
);
export const IconFilter = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="M4 6h16l-6 7v5l-4 2v-7L4 6Z" /></Icon>
);
export const IconLock = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5" /></Icon>
);
export const IconKey = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><circle cx="8" cy="14" r="4" /><path d="m11 11 8-8M16 6l2.5 2.5M14 8l2 2" /></Icon>
);
export const IconLayers = (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <Icon {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3.5 12.5 8.5 4.7 8.5-4.7M3.5 16.5l8.5 4.7 8.5-4.7" /></Icon>
);
