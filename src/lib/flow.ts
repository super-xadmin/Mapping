// ส่งงาน → QC ตรวจ: เงื่อนไขที่ใช้ร่วมกันระหว่างหน้ารายละเอียดงานและหน้าบันทึก (เซิร์ฟเวอร์ตรวจซ้ำทุกครั้ง)
import { can } from "../../shared/labels";
import { calComplete, type Me, type Session } from "../../shared/types";
import type { TFn } from "../i18n";

/** สิ่งที่ต้องครบก่อนส่งงาน */
export function readinessChecks(s: Session, t: TFn) {
  return [
    { ok: calComplete(s.calibrations), text: t("qcpanel.chkCal") },
    { ok: !s.calibrations.some((c) => c.startedAt != null && c.endedAt == null), text: t("qcpanel.chkNoOpenCal") },
    { ok: !s.rounds.some((r) => r.startedAt && !r.endedAt), text: t("qcpanel.chkNoRunning") },
    { ok: s.rounds.some((r) => r.endedAt), text: t("qcpanel.chkEnded") },
  ];
}

export const isReady = (s: Session, t: TFn) => readinessChecks(s, t).every((c) => c.ok);

/** ส่งงานได้ไหม (สิทธิ์ + ขั้นของงาน) — ผู้ตรวจที่เพิ่งตีกลับงานนี้ไม่ต้องเห็นปุ่มส่ง (รอทีมภาคสนามแก้) */
export function canSubmit(s: Session, user: Me | null): boolean {
  return !!user && can.record(user.role) && (s.stage === "open" || (s.stage === "returned" && s.qcById !== user.id));
}
