import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ToastProvider, ErrorState, LoadingRow, Button } from "@nexora/ui";
import { api, getToken, platformLogout, setToken } from "./lib/api";
import { Shell, useUnreadCount } from "./shell/Shell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { CreateCompanyPage } from "./pages/CreateCompanyPage";
import { CompanyDetailPage } from "./pages/CompanyDetailPage";
import { AiConfigurationPage } from "./pages/AiConfigurationPage";
import { DraftsPage } from "./pages/DraftsPage";
import { UsagePage } from "./pages/UsagePage";
import { HealthPage } from "./pages/HealthPage";
import { ActivityPage } from "./pages/ActivityPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SupportAccessPage } from "./pages/SupportAccessPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { GlobalSettingsPage } from "./pages/GlobalSettingsPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";
import { AiInsightsPage } from "./pages/AiInsightsPage";
import { AuditTrailPage } from "./pages/AuditTrailPage";

type Session =
  | { state: "checking" }
  | { state: "anon" }
  | { state: "authed"; email: string };

export default function App() {
  const [session, setSession] = useState<Session>(() => (getToken() ? { state: "checking" } : { state: "anon" }));
  const [bootError, setBootError] = useState<string | null>(null);
  const navigate = useNavigate();
  const unread = useUnreadCount(session.state === "authed");

  const check = useCallback(async () => {
    if (!getToken()) {
      setSession({ state: "anon" });
      return;
    }
    setSession({ state: "checking" });
    setBootError(null);
    try {
      const me = await api<{ ownerId?: string; email?: string }>("/me");
      setSession({ state: "authed", email: me.email ?? "owner" });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        setToken(null);
        setSession({ state: "anon" });
      } else {
        setBootError((err as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function logout() {
    await platformLogout();
    setSession({ state: "anon" });
    navigate("/login");
  }

  if (session.state === "checking") {
    return (
      <div className="nx-main" style={{ maxWidth: 560, paddingTop: 80 }}>
        <div className="nx-card nx-card--pad">
          <LoadingRow text="Restoring your platform session…" />
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="nx-main" style={{ maxWidth: 720, paddingTop: 80 }}>
        <ErrorState
          title="Could not reach the platform API"
          detail={bootError}
          onRetry={() => void check()}
        />
        <div style={{ marginTop: 16 }}>
          <Button onClick={() => { setToken(null); setSession({ state: "anon" }); }}>Sign in again</Button>
        </div>
      </div>
    );
  }

  if (session.state === "anon") {
    return (
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage onSignedIn={() => void check()} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <Shell ownerEmail={session.email} onLogout={() => void logout()} unread={unread}>
        <PageRoutes />
      </Shell>
    </ToastProvider>
  );
}

function Guarded({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * RULE 3.6.4 / 3.6.5 - the AI provider/model configuration is operated for ONE
 * explicitly identified company at a time. The company is resolved from the
 * route and confirmed against the platform API before the page renders, so the
 * page can never show a stale or mismatched company's identity. The server
 * resolves and validates the company again on every write, so the frontend
 * never gets to decide which company it is configuring.
 */
function CompanyAiConfigurationRoute() {
  const { id } = useParams();
  const [company, setCompany] = useState<{ name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await api<{ company: { name: string } }>(`/companies/${id}/detail`);
        if (!cancelled) setCompany({ name: detail.company.name });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="nx-main">
        <ErrorState title="Could not load this company" detail={error} />
      </div>
    );
  }
  if (!company || !id) {
    return (
      <div className="nx-main">
        <div className="nx-card nx-card--pad">
          <LoadingRow text="Loading the company…" />
        </div>
      </div>
    );
  }
  return <AiConfigurationPage companyId={id} companyName={company.name} />;
}

function PageRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Guarded><DashboardPage /></Guarded>} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/companies" element={<CompaniesPage />} />
      <Route path="/companies/new" element={<CreateCompanyPage />} />
      <Route path="/companies/:id" element={<CompanyDetailPage />} />
      <Route
        path="/companies/:id/ai-configuration"
        element={
          <CompanyAiConfigurationRoute />
        }
      />
      <Route path="/drafts" element={<DraftsPage />} />
      <Route path="/usage" element={<UsagePage />} />
      <Route path="/health" element={<HealthPage />} />
      <Route path="/activity" element={<ActivityPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/support" element={<SupportAccessPage />} />
      <Route path="/announcements" element={<AnnouncementsPage />} />
      <Route path="/settings" element={<GlobalSettingsPage />} />
      <Route path="/configuration" element={<ConfigurationPage />} />
      <Route path="/ai" element={<AiInsightsPage />} />
      <Route path="/audit" element={<AuditTrailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
