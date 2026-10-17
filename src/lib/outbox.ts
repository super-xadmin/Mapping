// คิวข้อมูลรอส่ง (outbox): ทุกการกระทำในภาคสนามเก็บลงเครื่องก่อน แล้วค่อยส่งขึ้นเซิร์ฟเวอร์
// ถ้าเน็ตหลุด ข้อมูลยังอยู่ในเครื่อง และส่งซ้ำอัตโนมัติโดยไม่เกิดข้อมูลซ้ำ
import { CHUNK_MAX_POINTS, SYNC_MAX_OPS, type PtArr, type SyncOp, type SyncResult } from "../../shared/types";
import type { UiKey } from "../i18n";
import { ApiError, api } from "./api";
import { createStore, lsGet, lsSet, newId } from "./store";

const K_OUT = "mlog:outbox";
const K_OPEN = "mlog:open";
const K_FAILED = "mlog:failed";
const BASE_DELAY = 10_000;
const MAX_DELAY = 120_000;

type OpenChunk = { id: string; sessionId: string; roundId: string; t0: number; pts: PtArr[] };
/** รายการที่เซิร์ฟเวอร์ไม่รับ (code = key ของข้อความ ใช้แปลใหม่เมื่อเปลี่ยนภาษา) */
export type FailedOp = { k: string; sessionId: string; error: string; code?: string; at: number; points?: number };
/** ข้อผิดพลาดล่าสุด: key ของข้อความบนหน้าเว็บ หรือข้อความจากเซิร์ฟเวอร์ */
export type SyncError = { key: UiKey } | { text: string; serverKey?: string; params?: Record<string, string | number> };

type SyncState = {
  /** รายการรอส่งทั้งหมด (รวมก้อนพิกัดที่กำลังเก็บ) */
  pending: number;
  /** รายการที่ปิดก้อนแล้วรอส่ง (ไม่นับก้อนที่กำลังเก็บ) */
  queued: number;
  syncing: boolean;
  lastOkAt: number | null;
  lastError: SyncError | null;
  authError: boolean;
  storageError: boolean;
  failed: FailedOp[];
};

let ops: SyncOp[] = lsGet<SyncOp[]>(K_OUT, []);
let open: OpenChunk | null = lsGet<OpenChunk | null>(K_OPEN, null);

export const syncStore = createStore<SyncState>({
  pending: ops.length + (open?.pts.length ? 1 : 0),
  queued: ops.length,
  syncing: false,
  lastOkAt: null,
  lastError: null,
  authError: false,
  storageError: false,
  failed: lsGet<FailedOp[]>(K_FAILED, []),
});

/** แจ้งหน้าจอเมื่อส่งข้อมูลสำเร็จ (detail = รายการ sessionId ที่เกี่ยวข้อง) */
export const syncEvents = new EventTarget();

function counts() {
  return { pending: ops.length + (open?.pts.length ? 1 : 0), queued: ops.length };
}

function persist() {
  const ok = lsSet(K_OUT, ops) && lsSet(K_OPEN, open);
  syncStore.set({ ...counts(), storageError: !ok });
}

/** ปิดก้อนพิกัดปัจจุบันแล้วย้ายเข้าคิว */
function sealOpen() {
  if (open && open.pts.length) {
    ops.push({ id: open.id, sessionId: open.sessionId, k: "chunk", roundId: open.roundId, t0: open.t0, pts: open.pts });
  }
  open = null;
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewOp = DistOmit<SyncOp, "id">;

/** เพิ่มรายการเข้าคิว (เรียงลำดับเสมอ: พิกัดที่ค้างจะถูกปิดก้อนก่อน) */
export function enqueue(op: NewOp) {
  sealOpen();
  ops.push({ ...op, id: newId() } as SyncOp);
  persist();
  void syncNow();
}

/** เพิ่มจุด GPS 1 จุด ([lat, lng, acc, speed, heading, alt]) */
export function addPoint(sessionId: string, roundId: string, t: number, v: [number, number, number | null, number | null, number | null, number | null]) {
  if (open && (open.roundId !== roundId || open.pts.length >= CHUNK_MAX_POINTS)) {
    sealOpen();
    lsSet(K_OUT, ops);
  }
  if (!open) open = { id: newId(), sessionId, roundId, t0: t, pts: [] };
  open.pts.push([t - open.t0, ...v]);
  const ok = lsSet(K_OPEN, open);
  syncStore.set({ ...counts(), storageError: !ok });
}

/** รายการที่ยังไม่ได้ส่ง (includeOpen = รวมก้อนพิกัดที่กำลังเก็บ) */
export function pendingOps(sessionId?: string, includeOpen = true): SyncOp[] {
  const all: SyncOp[] = includeOpen && open?.pts.length
    ? [...ops, { id: open.id, sessionId: open.sessionId, k: "chunk", roundId: open.roundId, t0: open.t0, pts: open.pts }]
    : [...ops];
  return sessionId ? all.filter((o) => o.sessionId === sessionId) : all;
}

/**
 * รายการที่เพิ่งส่งสำเร็จ (เก็บไว้ในหน่วยความจำสั้น ๆ) — ใช้แสดงผลต่อจนกว่าหน้าจอจะโหลดข้อมูลชุดใหม่จากเซิร์ฟเวอร์
 * ไม่งั้นช่วงเสี้ยววินาทีหลังส่ง หน้าจอจะเห็นข้อมูลเก่า (เช่น รอบที่เพิ่งจบกลับเป็น "กำลังวิ่ง")
 * ไม่รวมก้อนพิกัด เพราะการนับจุดซ้ำไม่ได้ (รายการอื่นใส่ซ้ำได้โดยไม่เปลี่ยนผล)
 */
let recent: { op: SyncOp; at: number }[] = [];
const RECENT_MS = 10 * 60_000;
export function recentlySent(sessionId: string, since: number): SyncOp[] {
  return recent.filter((x) => x.op.sessionId === sessionId && x.at >= since).map((x) => x.op);
}

let syncing = false;
let delay = BASE_DELAY;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function syncNow(): Promise<void> {
  if (syncing) return;
  syncing = true;
  syncStore.set({ syncing: true });
  const touched = new Set<string>();
  try {
    if (open?.pts.length && navigator.onLine !== false) {
      sealOpen();
      persist();
    }
    while (ops.length) {
      const batch = ops.slice(0, SYNC_MAX_OPS);
      let res: { results: SyncResult[] };
      try {
        res = await api<{ results: SyncResult[] }>("/sync", { body: { ops: batch } });
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(String(e), 0);
        if (err.status === 401 || err.code === "must_change_password") {
          syncStore.set({ authError: true, lastError: { key: "sync.errAuth" } });
        } else {
          syncStore.set({
            lastError: err.status === 0 ? { key: "sync.errOffline" } : { text: err.message, serverKey: err.key, params: err.params },
          });
          delay = Math.min(delay * 2, MAX_DELAY);
        }
        break;
      }
      const byId = new Map(res.results.map((r) => [r.id, r]));
      const sent = new Set(batch.map((o) => o.id));
      const failedNow: FailedOp[] = [];
      for (const op of batch) {
        touched.add(op.sessionId);
        const r = byId.get(op.id);
        if (r && !r.ok)
          failedNow.push({
            k: op.k, sessionId: op.sessionId, error: r.error ?? "", code: r.code, at: Date.now(),
            points: op.k === "chunk" ? op.pts.length : undefined,
          });
      }
      ops = ops.filter((o) => !sent.has(o.id));
      const doneAt = Date.now();
      recent = [
        ...recent.filter((x) => doneAt - x.at < RECENT_MS),
        ...batch.filter((op) => op.k !== "chunk" && byId.get(op.id)?.ok).map((op) => ({ op, at: doneAt })),
      ].slice(-300);
      if (failedNow.length) {
        const failed = [...failedNow, ...syncStore.get().failed].slice(0, 50);
        lsSet(K_FAILED, failed);
        syncStore.set({ failed });
      }
      persist();
      delay = BASE_DELAY;
      syncStore.set({ lastOkAt: Date.now(), lastError: null, authError: false });
    }
  } finally {
    syncing = false;
    syncStore.set({ syncing: false });
    if (touched.size) syncEvents.dispatchEvent(new CustomEvent("synced", { detail: [...touched] }));
  }
}

export function clearFailed() {
  lsSet(K_FAILED, null);
  syncStore.set({ failed: [] });
}

export function startSyncLoop() {
  const tick = async () => {
    await syncNow();
    timer = setTimeout(tick, ops.length || open?.pts.length ? delay : 30_000);
  };
  const kick = () => {
    delay = BASE_DELAY;
    void syncNow();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && kick());
  if (timer) clearTimeout(timer);
  void tick();
}
