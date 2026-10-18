// รูปแบบข้อมูลที่ส่งระหว่างหน้าเว็บกับ Worker
import type { CalKind, QcStatus, Role, Stage } from "./labels";

export interface Me {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface AuthState {
  setupRequired: boolean;
  setupKeyConfigured: boolean;
  user: Me | null;
}

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  lockedUntil: number | null;
  lastLoginAt: number | null;
  createdAt: number;
}

/** ใครเพิ่มรายการข้อมูลหลัก (รายการที่เพิ่มก่อน v3.2 ไม่มีชื่อ) */
interface MasterMeta { active: boolean; createdBy: string | null; createdAt: number }
export interface Driver extends MasterMeta { id: string; name: string; team: string | null }
export interface Vehicle extends MasterMeta { id: string; plate: string; equipment: string | null }
export interface Project extends MasterMeta { id: string; name: string; area: string | null }
export interface Master { drivers: Driver[]; vehicles: Vehicle[]; projects: Project[] }

export interface Round {
  id: string;
  seq: number;
  topic: string;
  plannedStart: number | null;
  plannedEnd: number | null;
  startedAt: number | null;
  endedAt: number | null;
  startedBy: string | null;
  endedBy: string | null;
  pointCount: number;
  distanceM: number;
  lastT: number | null;
  /** มีข้อมูลในเครื่องที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ */
  pending?: boolean;
}

export interface Calibration {
  id: string;
  seq: number;
  kind: CalKind;
  startedAt: number | null;
  endedAt: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number | null;
  pending?: boolean;
}

export interface Session {
  id: string;
  title: string;
  workDate: string;
  splitRounds: boolean;
  notes: string | null;
  /** ขั้นของงาน (คำนวณที่เซิร์ฟเวอร์จาก qcStatus + เวลาส่งงาน) */
  stage: Stage;
  /** การส่งงานครั้งล่าสุด (ถอนการส่งแล้ว = ว่าง) */
  submittedAt: number | null;
  submittedBy: string | null;
  submittedById: string | null;
  /** ผลตรวจ QC ครั้งล่าสุด (ผ่าน / ตีกลับ) */
  qcStatus: QcStatus;
  qcNote: string | null;
  qcBy: string | null;
  qcById: string | null;
  qcAt: number | null;
  driver: { id: string; name: string; team: string | null };
  vehicle: { id: string; plate: string; equipment: string | null };
  project: { id: string; name: string; area: string | null };
  createdBy: string | null;
  createdAt: number;
  rounds: Round[];
  calibrations: Calibration[];
}

export interface SessionList {
  sessions: Session[];
  hasMore: boolean;
}

export interface AuditEntry {
  id: number;
  at: number;
  userName: string | null;
  action: string;
  sessionId: string | null;
  detail: Record<string, unknown> | null;
  sessionTitle?: string | null;
  workDate?: string | null;
}

// ---------- การส่งข้อมูลแบบออฟไลน์ได้ (outbox) ----------

/** จุด GPS แบบย่อ: [dt_ms จาก t0, lat, lng, accuracy_m, speed_m/s, heading, altitude] */
export type PtArr = [number, number, number, number | null, number | null, number | null, number | null];

type OpBody =
  | { k: "round.add"; roundId: string; topic: string }
  | { k: "round.start"; roundId: string; t: number }
  | { k: "round.end"; roundId: string; t: number }
  | { k: "chunk"; roundId: string; t0: number; pts: PtArr[] }
  | { k: "cal.start"; calId: string; kind: CalKind; t: number }
  | { k: "cal.end"; calId: string; t: number };

export type SyncOp = { id: string; sessionId: string } & OpBody;

export interface SyncResult {
  id: string;
  ok: boolean;
  /** ข้อความตามภาษาของผู้ส่ง */
  error?: string;
  /** key ของข้อความ (หน้าเว็บใช้แปลใหม่เมื่อเปลี่ยนภาษา) */
  code?: string;
}

export const SYNC_MAX_OPS = 10; // จำนวนรายการต่อการส่ง 1 ครั้ง (D1 แผนฟรีจำกัด 50 query ต่อคำขอ)
export const CHUNK_MAX_POINTS = 300; // จุด GPS สูงสุดต่อ 1 ก้อน

/** มี Calibration ที่มีทั้งเวลาเริ่มและเวลาเสร็จอย่างน้อย 1 ครั้งหรือไม่ */
export function calComplete(cals: Pick<Calibration, "startedAt" | "endedAt">[]): boolean {
  return cals.some((c) => c.startedAt != null && c.endedAt != null);
}
