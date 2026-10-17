import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { PASSWORD_MIN } from "../../shared/labels";
import { LangSwitch, useI18n } from "../i18n";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Brand, Spinner } from "../components/ui";

/** ตั้งค่าระบบครั้งแรก: สร้างผู้ดูแลระบบคนแรก */
export default function Setup() {
  const { loading, setupRequired, setupKeyConfigured, refresh } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [f, setF] = useState({ setupKey: "", username: "", displayName: "", password: "", confirm: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  if (loading) return <Spinner />;
  if (!setupRequired) return <Navigate to="/login" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (f.password !== f.confirm) return setErr(t("setup.mismatch"));
    setBusy(true);
    try {
      await api("/auth/setup", { body: f });
      await refresh();
      nav("/", { replace: true });
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
        <h1>{t("setup.title")}</h1>
        <p className="muted">{t("setup.intro")}</p>
        {!setupKeyConfigured && <div className="alert warn">{t("setup.noKey")}</div>}
        <label className="field">
          <span>{t("setup.key")}</span>
          <input type="password" required value={f.setupKey} onChange={set("setupKey")} />
        </label>
        <label className="field">
          <span>{t("setup.username")}</span>
          <input autoCapitalize="none" required pattern="[A-Za-z0-9._\-]{3,32}" value={f.username} onChange={set("username")} />
        </label>
        <label className="field">
          <span>{t("setup.displayName")}</span>
          <input required value={f.displayName} onChange={set("displayName")} placeholder={t("setup.displayNamePh")} />
        </label>
        <label className="field">
          <span>{t("setup.password", { n: PASSWORD_MIN })}</span>
          <input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={f.password} onChange={set("password")} />
        </label>
        <label className="field">
          <span>{t("setup.confirm")}</span>
          <input type="password" autoComplete="new-password" required value={f.confirm} onChange={set("confirm")} />
        </label>
        {err && <div className="alert bad">{err}</div>}
        <button className="pri wide big-ish" disabled={busy}>{t("setup.submit")}</button>
      </form>
    </div>
  );
}
