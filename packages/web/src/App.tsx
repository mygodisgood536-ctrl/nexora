import { Navigate, Route, Routes } from "react-router-dom";
import { LoadingRow } from "@nexora/ui";
import { LoginPage } from "./auth/LoginPage";
import { RitualFlow } from "./auth/RitualFlow";
import { Splash } from "./auth/Splash";
import { useSession } from "./auth/SessionProvider";
import { companyName, companyTheme } from "./lib/theme";
import { Shell } from "./shell/Shell";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { AuditPage } from "./pages/AuditPage";
import { BranchesPage } from "./pages/BranchesPage";
import { CapabilityPage } from "./pages/CapabilityPage";
import { ControlPage } from "./pages/ControlPage";
import { CreditDetailPage } from "./pages/CreditDetailPage";
import { CreditPage } from "./pages/CreditPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { CustomersPage } from "./pages/CustomersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EodPage } from "./pages/EodPage";
import { FieldPage } from "./pages/FieldPage";
import { FindingsPage } from "./pages/FindingsPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { GroupsPage } from "./pages/GroupsPage";
import { MoneyPage } from "./pages/MoneyPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PerformancePage } from "./pages/PerformancePage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { ReconciliationPage } from "./pages/ReconciliationPage";
import { RecoveryPage } from "./pages/RecoveryPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ServicePage } from "./pages/ServicePage";
import { TechnicalPage } from "./pages/TechnicalPage";
import { TracePage } from "./pages/TracePage";
import { WorkerDetailPage } from "./pages/WorkerDetailPage";
import { WorkplacePage } from "./pages/WorkplacePage";

export default function App() {
  const { state } = useSession();

  /* The splash sits above whatever the session resolves to, so it never gates
     sign-in, never intercepts a route and never delays a deep link. */
  if (state.state === "booting") {
    return (
      <>
        <main className="nx-boot">
          <LoadingRow text="Checking your session…" />
        </main>
        <Splash />
      </>
    );
  }

  if (state.state === "anon") {
    return (
      <>
        <LoginPage theme={companyTheme()} />
        <Splash />
      </>
    );
  }

  if (state.state === "ritual") {
    return (
      <>
        <RitualFlow ritual={state.ritual} company={companyName()} />
        <Splash />
      </>
    );
  }

  return (
    <Shell company={companyName()}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />

        <Route path="/money" element={<MoneyPage />} />
        <Route path="/reconciliation" element={<ReconciliationPage />} />
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/eod" element={<EodPage />} />

        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/workplace" element={<WorkplacePage />} />

        <Route path="/people" element={<PeoplePage />} />
        <Route path="/people/:id" element={<WorkerDetailPage />} />

        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />

        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:id" element={<GroupDetailPage />} />

        <Route path="/credit" element={<CreditPage />} />
        <Route path="/credit/:id" element={<CreditDetailPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />

        <Route path="/audit" element={<AuditPage />} />
        <Route path="/findings" element={<FindingsPage />} />
        <Route path="/trace" element={<TracePage />} />
        <Route path="/control" element={<ControlPage />} />
        <Route path="/capability/:key" element={<CapabilityPage />} />

        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/performance" element={<PerformancePage />} />

        <Route path="/field" element={<FieldPage />} />
        <Route path="/recovery" element={<RecoveryPage />} />
        <Route path="/service" element={<ServicePage />} />
        <Route path="/technical" element={<TechnicalPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}