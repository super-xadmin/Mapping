import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import { can, type Role } from "../shared/labels";
import { LangSwitch, useI18n } from "./i18n";
import { AuthProvider, useAuth } from "./lib/auth";
import { api } from "./lib/api";
import { syncStore } from "./lib/outbox";
import { recStore } from "./lib/recorder";
import { useStore } from "./lib/store";
import SyncBar from "./components/SyncBar";
import { Brand, ErrorBox, Menu, Spinner } from "./components/ui";
import { Watermark } from "./components/Watermark";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Account from "./pages/Account";
import Dashboard from "./pages/Dashboard";
import NewSession from "./pages/NewSession";
import Recorder from "./pages/Recorder";
import SessionDetail from "./pages/SessionDetail";
import Admin from "./pages/Admin";

function Guard({ children }: { children: ReactNode }) {
  const { loading, user, setupRequired, error, refresh } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) {
    if (error) return <main><ErrorBox error={error} onRetry={() => void refresh()} /></main>;
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  if (user.mustChangePassword && loc.pathname !== "/account") return <Navigate to="/account" replace />;
  return <>{children}</>;
}

function RoleGate({ need, children }: { need: (r: Role) => boolean; children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useI18n();
  if (user && need(user.role)) return <>{children}</>;
  return <div className="card">{t("c.noPermission")}</div>;
}

function NotFound() {
  const { t } = useI18n();
  return <div className="card">{t("c.notFoundPage")} — <Link to="/">{t("c.goHome")}</Link></div>;
}

function Layout() {
  const { user, offline, signedOut } = useAuth();
  const { t } = useI18n();
  const rec = useStore(recStore);
  const sync = useStore(syncStore);
  const loc = useLocation();
  const nav = useNavigate();
  if (!user) return null;
  const onRecorder = loc.pathname.startsWith("/record/");
  const recSession = (rec.active ?? rec.cal)?.sessionId;

  async function logout() {
    if (rec.active || rec.cal) return alert(t("logout.recording"));
    if (sync.pending && !confirm(t("logout.pending", { n: sync.pending }))) return;
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    signedOut();
    nav("/login", { replace: true });
  }

  return (
    <>
      <header className="top">
        <Link to="/" className="brand" aria-label="Mapping Log"><Brand /></Link>
        <nav className="desk-only">
          <NavLink to="/" end>{t("nav.home")}</NavLink>
          {can.record(user.role) && <NavLink to="/sessions/new">{t("nav.new")}</NavLink>}
          {can.admin(user.role) && <NavLink to="/admin">{t("nav.admin")}</NavLink>}
        </nav>
        <LangSwitch />
        <Menu
          className="usermenu"
          title={t("nav.menu")}
          label={<><span className="desk-only menu-name">{user.displayName}</span><span aria-hidden>☰</span></>}
        >
          <div className="menu-head">
            <b>{user.displayName}</b>
            <small>{user.username} · {t(`role.${user.role}`)}</small>
          </div>
          <Link className="menu-item" to="/">{t("nav.home")}</Link>
          {can.record(user.role) && <Link className="menu-item" to="/sessions/new">{t("nav.new")}</Link>}
          {can.admin(user.role) && <Link className="menu-item" to="/admin">{t("nav.admin")}</Link>}
          <Link className="menu-item" to="/account">{t("nav.account")}</Link>
          <button type="button" className="menu-item danger" onClick={() => void logout()}>{t("nav.logout")}</button>
        </Menu>
      </header>
      {offline && <div className="banner warn">{t("c.offlineBanner")}</div>}
      {recSession && !onRecorder && (
        <Link className="banner rec" to={`/record/${recSession}`}>
          <span className="dot live" /> {rec.active ? t("c.recBanner", { label: rec.active.label }) : t("c.calBanner")} — <u>{t("c.backToRecorder")}</u>
        </Link>
      )}
      <main className={onRecorder ? "rec-main" : undefined}>
        {!onRecorder && <SyncBar compact />}
        <Outlet />
      </main>
      <Watermark name={user.displayName} username={user.username} />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route element={<Guard><Layout /></Guard>}>
          <Route index element={<Dashboard />} />
          <Route path="sessions/new" element={<RoleGate need={can.record}><NewSession /></RoleGate>} />
          <Route path="sessions/:id" element={<SessionDetail />} />
          <Route path="record/:id" element={<Recorder />} />
          <Route path="admin" element={<RoleGate need={can.admin}><Admin /></RoleGate>} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
