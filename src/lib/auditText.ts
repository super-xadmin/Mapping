// แปลงประวัติการใช้งานเป็นข้อความตามภาษาที่เลือก
import { isCalKind, isQc, isRole, type MasterType } from "../../shared/labels";
import type { AuditEntry } from "../../shared/types";
import type { Formatters, TFn, UiKey } from "../i18n";

const FIELD: Record<string, UiKey> = {
  title: "au.fieldTitle", notes: "au.fieldNotes", driver_id: "au.fieldDriver", vehicle_id: "au.fieldVehicle", project_id: "au.fieldProject",
};
/** ข้อมูลเก่า (ก่อนมีหลายภาษา) เก็บชื่อประเภทเป็นภาษาไทย */
const LEGACY_MASTER: Record<string, MasterType> = { คนขับ: "drivers", รถ: "vehicles", โปรเจกต์: "projects" };

type D = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export function describeAudit(e: AuditEntry, t: TFn, f: Formatters, workDate?: string): string {
  const d: D = e.detail ?? {};
  const clock = (v: unknown) => f.clock(typeof v === "number" ? v : null, workDate);
  const kind = (v: unknown) => (isCalKind(v) ? t(`cal.${v}`) : s(v));
  const qc = (v: unknown) => (isQc(v) ? t(`qc.${v}`) : s(v));
  const role = (v: unknown) => (isRole(v) ? t(`role.${v}`) : s(v));
  const cal = (v: unknown) => {
    const x = (v ?? {}) as D;
    return `${kind(x.kind)} ${clock(x.startedAt)}–${x.endedAt == null ? t("calf.notDone") : clock(x.endedAt)}${x.note ? ` (${s(x.note)})` : ""}`;
  };
  const run = d.seq ? t("au.runN", { n: s(d.seq) }) : t("au.run");
  const masterType = (v: unknown) => {
    const k = typeof v === "string" ? (v in LEGACY_MASTER ? LEGACY_MASTER[v] : v) : "";
    return k === "drivers" || k === "vehicles" || k === "projects" ? t(`master.${k}`) : s(v);
  };

  switch (e.action) {
    case "session.create":
      return d.splitRounds
        ? t("au.sessionCreateSplit", { title: s(d.title), n: s(d.rounds) })
        : t("au.sessionCreate", { title: s(d.title) });
    case "session.update":
      return t("au.sessionUpdate", {
        fields: Object.keys((d.changes as D) ?? {})
          .map((k) => (FIELD[k] ? t(FIELD[k]) : k))
          .join(t("au.sep")),
      });
    case "session.delete":
      return t("au.sessionDelete", { title: s(d.title), date: f.date(s(d.workDate)) });
    case "round.add":
      return t("au.roundAdd", { topic: s(d.topic) });
    case "round.start":
      return t("au.roundStart", { run, topic: s(d.topic), t: clock(d.t) });
    case "round.end":
      return t("au.roundEnd", { run, topic: s(d.topic), t: clock(d.t) });
    case "cal.start":
      return t("au.calStart", { kind: kind(d.kind), t: clock(d.t) });
    case "cal.end":
      return t("au.calEnd", { kind: kind(d.kind), t: clock(d.t) });
    case "cal.create":
      return t("au.calCreate", { cal: cal(d) });
    case "cal.update":
      return t("au.calUpdate", { n: s(d.seq), before: cal(d.before), after: cal(d.after) });
    case "cal.delete":
      return t("au.calDelete", { n: s(d.seq), before: cal(d.before) });
    case "qc.update":
      return `${t("au.qcUpdate", { from: qc(d.from), to: qc(d.to) })}${d.note ? ` — ${s(d.note)}` : ""}`;
    case "auth.setup":
      return t("au.authSetup", { u: s(d.username) });
    case "auth.login":
      return t("au.authLogin");
    case "auth.login_failed":
      return t("au.authFailed", { u: s(d.username) });
    case "auth.locked":
      return t("au.authLocked", { u: s(d.username) });
    case "auth.password_change":
      return t("au.authPassword");
    case "user.create":
      return t("au.userCreate", { u: s(d.username), role: role(d.role) });
    case "user.update": {
      const parts: string[] = [];
      if (d.role) parts.push(t("au.userRole", { role: role(d.role) }));
      if (d.active === false) parts.push(t("au.userDisabled"));
      if (d.active === true) parts.push(t("au.userEnabled"));
      if (d.passwordReset) parts.push(t("au.userPwReset"));
      if (d.unlocked) parts.push(t("au.userUnlocked"));
      if (d.displayName) parts.push(t("au.userName", { name: s(d.displayName) }));
      const head = t("au.userUpdate", { u: s(d.username) });
      return parts.length ? `${head}: ${parts.join(t("au.sep"))}` : head;
    }
    case "master.create":
      return `${t("au.masterCreate", { type: masterType(d.type), name: s(d.name) })}${d.detail ? ` (${s(d.detail)})` : ""}`;
    case "master.update": {
      const state = d.active === false ? ` — ${t("au.userDisabled")}` : d.active === true ? ` — ${t("au.userEnabled")}` : "";
      return `${t("au.masterUpdate", { type: masterType(d.type), name: s(d.name) })}${state}`;
    }
    default:
      return e.action;
  }
}
