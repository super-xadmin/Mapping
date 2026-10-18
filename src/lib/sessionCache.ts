// สำเนางานที่เปิดล่าสุด (ไว้เปิดหน้าบันทึกได้ตอนออฟไลน์) — เก็บแค่ MAX งานล่าสุด
// เพื่อไม่ให้กินพื้นที่ localStorage ที่ต้องใช้เก็บพิกัด GPS ที่รอส่ง
import type { Session } from "../../shared/types";
import { lsGet, lsSet } from "./store";

const K_INDEX = "mlog:sess-index";
const MAX = 20;
const sessKey = (id: string) => `mlog:sess:${id}`;
export const finishedKey = (id: string) => `mlog:finished:${id}`;

/** at = เวลาที่เริ่มโหลดข้อมูลชุดนี้จากเซิร์ฟเวอร์ */
export type CachedSession = { at: number; s: Session };

export function readSession(id: string): CachedSession | null {
  const v = lsGet<unknown>(sessKey(id), null);
  if (!v || typeof v !== "object") return null;
  // รูปแบบเก่า (เวอร์ชันก่อน) เก็บ Session ตรง ๆ
  if ("s" in v && "at" in v) return { ...(v as CachedSession), s: upgrade((v as CachedSession).s) };
  if ("id" in v && "rounds" in v) return { at: 0, s: upgrade(v as Session) };
  return null;
}

/** สำเนาที่บันทึกก่อน v3.2 ยังไม่มีขั้นของงาน (stage) — เดาจากสถานะ QC จนกว่าจะโหลดข้อมูลใหม่ได้ */
function upgrade(s: Session): Session {
  if (s.stage) return s;
  const stage = s.qcStatus === "PASSED" ? "passed" : s.qcStatus === "REDO" ? "returned" : "open";
  return { ...s, stage, submittedAt: null, submittedBy: null, submittedById: null, qcById: null };
}

export function saveSession(id: string, s: Session, at: number) {
  lsSet(sessKey(id), { at, s } satisfies CachedSession);
  const index = lsGet<string[]>(K_INDEX, []).filter((x) => x !== id);
  index.unshift(id);
  lsSet(K_INDEX, index.slice(0, MAX));
  prune(index.slice(0, MAX));
}

export function dropSession(id: string) {
  lsSet(sessKey(id), null);
  lsSet(finishedKey(id), null);
  lsSet(K_INDEX, lsGet<string[]>(K_INDEX, []).filter((x) => x !== id));
}

/** ลบสำเนางานเก่าที่ไม่อยู่ในรายการล่าสุด (รวมของเวอร์ชันก่อนที่ไม่มีรายการ) */
function prune(keep: string[]) {
  try {
    const keepSet = new Set(keep);
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const m = /^mlog:(?:sess|finished):(.+)$/.exec(k);
      if (m && !keepSet.has(m[1])) drop.push(k);
    }
    for (const k of drop) localStorage.removeItem(k);
  } catch {
    /* localStorage ใช้ไม่ได้ */
  }
}
