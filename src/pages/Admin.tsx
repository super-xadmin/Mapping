// จัดการระบบ (ผู้ดูแลระบบ): ผู้ใช้งาน, ประวัติการใช้งานทั้งระบบ
// (คนขับ / รถ / โปรเจกต์ ย้ายไปหน้า "ข้อมูลหลัก" ที่ทุกคนยกเว้นบัญชีดูอย่างเดียวใช้ได้)
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { PASSWORD_MIN, ROLES, type Role } from "../../shared/labels";
import type { AuditEntry, UserRow } from "../../shared/types";
import { useI18n, type UiKey } from "../i18n";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeAudit } from "../lib/auditText";
import { ErrorBox } from "../components/ui";

const TABS: Record<"users" | "audit", UiKey> = { users: "adm.tabUsers", audit: "adm.tabAudit" };
type Tab = keyof typeof TABS;

export default function Admin() {
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  if (sp.get("tab") === "master") return <Navigate to="/master" replace />; // ลิงก์เดิม
  const tab = (sp.get("tab") as Tab) in TABS ? (sp.get("tab") as Tab) : "users";
  return (
    <>
      <div className="tabs">
        {(Object.keys(TABS) as Tab[]).map((k) => (
          <button key={k} className={k === tab ? "active" : ""} onClick={() => setSp({ tab: k })}>{t(TABS[k])}</button>
        ))}
      </div>
      {tab === "users" && <Users />}
      {tab === "audit" && <AuditLog />}
    </>
  );
}

function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => chars[b % chars.length]).join("");
}

function Users() {
  const { user: me } = useAuth();
  const { t, f } = useI18n();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ username: "", displayName: "", role: "field" as Role, password: tempPassword() });
  const [created, setCreated] = useState<string | null>(null);
  const load = useCallback(() => api<UserRow[]>("/users").then(setUsers).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api("/users", { body: form });
      setCreated(t("adm.created", { u: form.username, pw: form.password }));
      setForm({ username: "", displayName: "", role: "field", password: tempPassword() });
      void load();
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  async function patch(u: UserRow, body: Record<string, unknown>, done?: string) {
    setErr("");
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body });
      if (done) setCreated(done);
      void load();
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  function resetPw(u: UserRow) {
    const pw = tempPassword();
    if (confirm(t("adm.resetConfirm", { name: u.displayName, pw })))
      void patch(u, { password: pw }, t("adm.resetDone", { u: u.username, pw }));
  }

  return (
    <>
      <form className="card" onSubmit={create}>
        <h3>{t("adm.addUser")}</h3>
        <div className="grid">
          <label className="field"><span>{t("adm.username")}</span>
            <input required autoCapitalize="none" pattern="[A-Za-z0-9._\-]{3,32}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label className="field"><span>{t("adm.displayName")}</span>
            <input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
          <label className="field"><span>{t("adm.role")}</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
            </select></label>
          <label className="field"><span>{t("adm.tempPw", { n: PASSWORD_MIN })}</span>
            <input required minLength={PASSWORD_MIN} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        </div>
        <p className="muted small">{t(`roleDesc.${form.role}`)}</p>
        <button className="pri">{t("adm.create")}</button>
      </form>
      {created && <div className="alert ok">{created}</div>}
      <ErrorBox error={err} />
      <div className="card table-wrap">
        <table className="cards-on-mobile">
          <thead><tr><th>{t("adm.colUser")}</th><th>{t("adm.colRole")}</th><th>{t("adm.colStatus")}</th><th>{t("adm.colLastLogin")}</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "inactive"}>
                <td data-label={t("adm.colUser")}><b>{u.displayName}</b><div className="muted small">{u.username}</div></td>
                <td data-label={t("adm.colRole")}>
                  <select value={u.role} disabled={u.id === me?.id} onChange={(e) => void patch(u, { role: e.target.value })}>
                    {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                  </select>
                </td>
                <td data-label={t("adm.colStatus")}>
                  {!u.active ? <span className="badge">{t("c.inactive")}</span> : u.lockedUntil ? <span className="badge bad">{t("adm.locked")}</span> : <span className="badge ok">{t("c.active")}</span>}
                  {u.mustChangePassword && <div className="muted small">{t("adm.mustChange")}</div>}
                </td>
                <td data-label={t("adm.colLastLogin")} className="small">{u.lastLoginAt ? f.dt(u.lastLoginAt) : "-"}</td>
                <td className="nowrap">
                  <button className="link" onClick={() => resetPw(u)}>{t("adm.resetPw")}</button>
                  {u.lockedUntil && <button className="link" onClick={() => void patch(u, { unlock: true })}>{t("adm.unlock")}</button>}
                  {u.id !== me?.id && (
                    <button className="link" onClick={() => void patch(u, { active: !u.active })}>{u.active ? t("c.disable") : t("c.enable")}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AuditLog() {
  const { t, f } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async (before?: number) => {
    try {
      const r = await api<{ entries: AuditEntry[]; hasMore: boolean }>(`/audit?limit=100${before ? `&before=${before}` : ""}`);
      setEntries((old) => (before ? [...old, ...r.entries] : r.entries));
      setHasMore(r.hasMore);
    } catch (e) {
      setErr(errMsg(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="card table-wrap">
      <ErrorBox error={err} />
      <table className="cards-on-mobile">
        <thead><tr><th>{t("adm.colTime")}</th><th>{t("adm.colUser")}</th><th>{t("adm.colAction")}</th><th>{t("adm.colJob")}</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td data-label={t("adm.colTime")} className="nowrap small">{f.dt(e.at)}</td>
              <td data-label={t("adm.colUser")}>{e.userName ?? "-"}</td>
              <td data-label={t("adm.colAction")}>{describeAudit(e, t, f, e.workDate ?? undefined)}</td>
              <td data-label={t("adm.colJob")}>
                {e.sessionId && e.sessionTitle ? (
                  <Link to={`/sessions/${e.sessionId}`}>{e.sessionTitle}<span className="muted small"> ({f.date(e.workDate)})</span></Link>
                ) : e.sessionId ? <span className="muted small">{t("adm.deletedJob")}</span> : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && <div className="center pad"><button onClick={() => void load(entries[entries.length - 1]?.id)}>{t("c.loadMore")}</button></div>}
    </div>
  );
}
