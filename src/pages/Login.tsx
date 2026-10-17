import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import type { Me } from "../../shared/types";
import { LangSwitch, useI18n } from "../i18n";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Brand, Spinner } from "../components/ui";

export default function Login() {
  const { loading, user, setupRequired, signedIn } = useAuth();
  const { t } = useI18n();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const raw = sp.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  if (loading) return <Spinner />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={user.mustChangePassword ? "/account" : next} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ user: Me }>("/auth/login", { body: { username, password } });
      signedIn(r.user);
      nav(r.user.mustChangePassword ? "/account" : next, { replace: true });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-top">
        <Brand light />
        <LangSwitch className="dark" />
      </div>
      <form className="card auth-card" onSubmit={submit}>
        <h1>{t("login.submit")}</h1>
        <p className="muted">{t("login.subtitle")}</p>
        <label className="field">
          <span>{t("login.username")}</span>
          <input autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("login.password")}</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="alert bad">{err}</div>}
        <button className="pri wide big-ish" disabled={busy}>{busy ? t("login.busy") : t("login.submit")}</button>
        <p className="muted small">{t("login.forgot")}</p>
      </form>
    </div>
  );
}
