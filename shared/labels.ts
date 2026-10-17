// สิทธิ์ผู้ใช้ สถานะ และกติกาที่ใช้ร่วมกันทั้งฝั่งเว็บและ Worker
// (ข้อความที่แสดงผลอยู่ใน shared/i18n เช่น role.admin, qc.PASSED, cal.pre)
import type { Msg } from "./i18n";

export type Role = "admin" | "qc" | "field" | "viewer";
export const ROLES: Role[] = ["admin", "qc", "field", "viewer"];
export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as string[]).includes(r);

/** ตารางสิทธิ์ (ตรวจซ้ำที่ Worker ทุกครั้ง หน้าเว็บใช้แค่ซ่อนปุ่ม) */
export const can = {
  record: (r: Role) => r === "admin" || r === "qc" || r === "field",
  qc: (r: Role) => r === "admin" || r === "qc",
  admin: (r: Role) => r === "admin",
};

export type QcStatus = "PENDING" | "PASSED" | "REDO";
export const QC_STATUSES: QcStatus[] = ["PENDING", "PASSED", "REDO"];
export const isQc = (s: unknown): s is QcStatus => typeof s === "string" && (QC_STATUSES as string[]).includes(s);

export type CalKind = "pre" | "mid" | "post";
export const CAL_KINDS: CalKind[] = ["pre", "mid", "post"];
export const isCalKind = (k: unknown): k is CalKind => typeof k === "string" && (CAL_KINDS as string[]).includes(k);

export type MasterType = "drivers" | "vehicles" | "projects";

export const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
export const PASSWORD_MIN = 8;

export function passwordProblem(pw: unknown, username?: string): Msg | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return { key: "val.pwMin", params: { n: PASSWORD_MIN } };
  if (pw.length > 128) return { key: "val.pwLong" };
  if (username && pw.toLowerCase() === username.toLowerCase()) return { key: "val.pwSameAsUser" };
  return null;
}
