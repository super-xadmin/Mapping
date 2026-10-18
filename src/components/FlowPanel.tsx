// ส่งงาน / ตรวจ QC: ปุ่มตามขั้นของงานและสิทธิ์ + ประวัติทุกขั้น (ใคร เมื่อไร หมายเหตุ) ไว้ตามหาคนรับผิดชอบ
// กำลังทำ/ตีกลับ → คนบันทึกกดส่งงาน · รอตรวจ → คนส่งถอนได้ / ผู้ตรวจ QC คนอื่นกดผ่านหรือตีกลับ · ผ่าน → ล็อก (QC ตีกลับได้)
import { useState } from "react";
import { can, type QcAction } from "../../shared/labels";
import type { AuditEntry, Session } from "../../shared/types";
import { useI18n, type Formatters, type TFn } from "../i18n";
import { ApiError, api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeAudit } from "../lib/auditText";
import { canSubmit as canSubmitJob, readinessChecks } from "../lib/flow";
import { pendingOps, syncStore } from "../lib/outbox";
import { useStore } from "../lib/store";
import { StageBadge } from "./ui";

type Level = "ok" | "warn" | "bad";
const FLOW_ACTIONS = new Set(["qc.submit", "qc.withdraw", "qc.pass", "qc.return", "qc.update"]);

/** ข้อความของแต่ละขั้นในประวัติการส่งงาน/ตรวจ */
function flowLabel(e: AuditEntry, t: TFn, f: Formatters, workDate: string) {
  switch (e.action) {
    case "qc.submit": return t("flow.ev.submit");
    case "qc.withdraw": return t("flow.ev.withdraw");
    case "qc.pass": return t("flow.ev.pass");
    case "qc.return": return e.detail?.from === "passed" ? t("flow.ev.unpass") : t("flow.ev.return");
    default: return describeAudit({ ...e, detail: { ...e.detail, note: null } }, t, f, workDate); // ข้อมูลก่อน v3.2
  }
}

export default function FlowPanel({ s, audit, sop, onDone }: {
  s: Session; audit: AuditEntry[]; sop: { level: Level | null; text: string }[]; onDone: () => void;
}) {
  const { user } = useAuth();
  const { t, f } = useI18n();
  useStore(syncStore); // แสดงผลใหม่เมื่อข้อมูลในเครื่องส่งขึ้นไปแล้ว
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const mine = !!s.submittedById && s.submittedById === user.id;
  const canSubmit = canSubmitJob(s, user);
  const canReview = can.qc(user.role) && (s.stage === "submitted" || s.stage === "passed");
  const checks = readinessChecks(s, t);
  const ready = checks.every((c) => c.ok);
  const localPending = pendingOps(s.id).length; // ข้อมูลของงานนี้ที่ยังอยู่ในเครื่องนี้
  const unstarted = s.rounds.filter((r) => r.startedAt == null).length;
  const trail = audit.filter((e) => FLOW_ACTIONS.has(e.action));

  async function act(action: QcAction) {
    setErr([]);
    if (action === "return" && !note.trim()) return setErr([t("err.returnNote")]);
    if (action === "submit" && !confirm(t("flow.submitConfirm"))) return;
    if (action === "withdraw" && !confirm(t("flow.withdrawConfirm"))) return;
    setBusy(true);
    try {
      await api(`/sessions/${s.id}/qc`, { body: { action, note } });
      setNote("");
      onDone();
    } catch (e) {
      const problems = e instanceof ApiError && e.data && typeof e.data === "object" ? (e.data as { problems?: string[] }).problems : undefined;
      setErr([errMsg(e), ...(problems ?? [])]);
    } finally {
      setBusy(false);
    }
  }

  const checklist = (
    <ul className="checklist">
      {checks.map((c) => <li key={c.text} className={c.ok ? "ok-text" : "bad-text"}>{c.ok ? "✓" : "✗"} {c.text}</li>)}
    </ul>
  );
  // ข้อแนะนำตาม SOP: ให้คนส่งเห็นก่อนส่ง และผู้ตรวจเห็นตอนตรวจ (ไม่บังคับ)
  const sopBox = sop.some((x) => x.level) && (
    <div className="sop-box">
      <div className="sop-head">{t("sop.advisory")}</div>
      <ul className="checklist m0">
        {sop.filter((x) => x.level).map((x) => (
          <li key={x.text} className={x.level === "ok" ? "ok-text" : "warn-text"}>{x.level === "ok" ? "✓" : "⚠"} {x.text}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="card flow">
      <div className="row between m0">
        <h3 className="m0">{t("qcpanel.title")}</h3>
        <StageBadge stage={s.stage} />
      </div>

      {s.stage === "submitted" && (
        <div className="alert warn">{t("flow.waiting", { by: s.submittedBy ?? "-", at: f.dt(s.submittedAt) })}</div>
      )}
      {s.stage === "passed" && (
        <div className="alert ok">
          {t("flow.passedInfo", { by: s.qcBy ?? "-", at: f.dt(s.qcAt) })}
          {s.qcNote && <div className="small">{t("c.notes")}: {s.qcNote}</div>}
        </div>
      )}
      {s.stage === "returned" && (
        <div className="alert bad">
          {t("flow.returnedInfo", { by: s.qcBy ?? "-", at: f.dt(s.qcAt) })}
          {s.qcNote && <div><b>{t("flow.reason", { note: s.qcNote })}</b></div>}
        </div>
      )}

      {canSubmit && (
        <>
          <div className="flow-sub">{t("flow.checkTitle")}</div>
          {checklist}
          {unstarted > 0 && <div className="alert warn small">{t("flow.unstarted", { n: unstarted })}</div>}
          {localPending > 0 && <div className="alert warn small">{t("flow.pendingLocal", { n: localPending })}</div>}
          {sopBox}
          <label className="field">
            <span>{t("c.notes")}</span>
            <textarea rows={2} maxLength={1000} placeholder={t("flow.notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="pri" disabled={busy || !ready || localPending > 0} onClick={() => void act("submit")}>{t("flow.submit")}</button>
          <p className="muted small">{t("flow.submitHint")}</p>
        </>
      )}

      {s.stage === "submitted" && mine && (
        <button disabled={busy} onClick={() => void act("withdraw")}>{t("flow.withdraw")}</button>
      )}

      {canReview && mine && <p className="muted small">{t("flow.mine")}</p>}
      {canReview && !mine && (
        <>
          {s.stage === "submitted" && checklist}
          {s.stage === "submitted" && sopBox}
          <label className="field">
            <span>{t("flow.qcNote")}</span>
            <textarea rows={3} maxLength={1000} placeholder={t("qcpanel.notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="row">
            {s.stage === "submitted" && (
              <button className="ok-solid" disabled={busy} onClick={() => void act("pass")}>{t("flow.pass")}</button>
            )}
            <button className="bad" disabled={busy} onClick={() => void act("return")}>
              {s.stage === "passed" ? t("flow.unpass") : t("flow.return")}
            </button>
          </div>
        </>
      )}

      {err.length > 0 && <div className="alert bad">{err.map((x) => <div key={x}>{x}</div>)}</div>}

      <div className="flow-sub">{t("flow.trail")}</div>
      {trail.length ? (
        <ol className="flow-trail">
          {trail.map((e) => {
            const kind = e.action === "qc.return" ? "return" : e.action.slice(3);
            const n = typeof e.detail?.note === "string" ? e.detail.note : "";
            return (
              <li key={e.id} className={`ev-${kind}`}>
                <b>{flowLabel(e, t, f, s.workDate)}</b>
                <span className="muted small">{e.userName ?? t("c.system")} · {f.dt(e.at)}</span>
                {n && <span className="note small">“{n}”</span>}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted small">{t("flow.none")}</p>
      )}
    </div>
  );
}
