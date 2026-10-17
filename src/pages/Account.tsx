import { useState } from "react";
import { useNavigate } from "react-router";
import { PASSWORD_MIN } from "../../shared/labels";
import { LangSwitch, useI18n } from "../i18n";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Account() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const forced = user.mustChangePassword;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setOk(false);
    if (f.newPassword !== f.confirm) return setErr(t("acc.mismatch"));
    setBusy(true);
    try {
      await api("/auth/password", { body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      setF({ currentPassword: "", newPassword: "", confirm: "" });
      setOk(true);
      await refresh();
      if (forced) nav("/", { replace: true });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="card">
        <h2>{t("nav.account")}</h2>
        <p>
          <b>{user.displayName}</b> <span className="muted">({user.username})</span>
          <br />
          {t("acc.role")}: {t(`role.${user.role}`)} <span className="muted">— {t(`roleDesc.${user.role}`)}</span>
        </p>
        <div className="row">
          <span className="muted">{t("acc.language")}:</span>
          <LangSwitch />
        </div>
      </div>
      <form className="card" onSubmit={submit}>
        <h3>{t("acc.changePw")}</h3>
        {forced && <div className="alert warn">{t("acc.forced")}</div>}
        <label className="field">
          <span>{t("acc.current")}</span>
          <input type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
        </label>
        <label className="field">
          <span>{t("acc.new", { n: PASSWORD_MIN })}</span>
          <input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
        </label>
        <label className="field">
          <span>{t("acc.confirm")}</span>
          <input type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </label>
        {err && <div className="alert bad">{err}</div>}
        {ok && <div className="alert ok">{t("acc.done")}</div>}
        <button className="pri" disabled={busy}>{t("acc.submit")}</button>
      </form>
    </div>
  );
}
