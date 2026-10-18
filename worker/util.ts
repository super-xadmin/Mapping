import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { pickLang, translate, type Lang, type Params, type SharedKey } from "../shared/i18n";

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** ข้อผิดพลาดที่ตั้งใจส่งกลับให้ผู้ใช้ (แปลเป็นภาษาของผู้ใช้ตอนตอบกลับ) */
export class AppError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public key: SharedKey,
    public params?: Params,
    public extra?: Record<string, unknown>,
    public code?: string,
  ) {
    super(key);
  }
}

/** หยุดการทำงานและตอบกลับ { error: ข้อความตามภาษา, code, ...extra } */
export function fail(status: ContentfulStatusCode, key: SharedKey, params?: Params, extra?: Record<string, unknown>, code?: string): never {
  throw new AppError(status, key, params, extra, code);
}

/** ภาษาของผู้ใช้: header X-Lang (หน้าเว็บส่งมาทุกครั้ง) หรือ Accept-Language */
export const langOf = (c: Context): Lang => pickLang(c.req.header("x-lang"), c.req.header("accept-language"));
export const tr = (c: Context, key: SharedKey, params?: Params) => translate(langOf(c), key, params);

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    fail(400, "err.badJson");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "err.badJson");
  return body as Record<string, unknown>;
}

/** ข้อความที่ตัดช่องว่างแล้ว (ว่าง = null) */
export function str(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export const qs = (n: number) => Array(n).fill("?").join(",");

export const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : dflt;
};

/** คำสั่งบันทึกประวัติการใช้งาน (ใส่ใน batch เดียวกับการแก้ข้อมูล) */
export function audit(
  db: D1Database,
  user: { id: string; displayName: string } | null,
  action: string,
  sessionId: string | null,
  detail?: Record<string, unknown>,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_log (at, user_id, user_name, action, session_id, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(now(), user?.id ?? null, user?.displayName ?? null, action, sessionId, detail ? JSON.stringify(detail) : null);
}

/** บันทึกประวัติเฉพาะเมื่อคำสั่งก่อนหน้าใน batch เปลี่ยนข้อมูลจริง (ใช้คู่กับ UPDATE ที่มีเงื่อนไขกันกดชนกัน) */
export function auditIfChanged(
  db: D1Database,
  user: { id: string; displayName: string },
  action: string,
  sessionId: string,
  detail: Record<string, unknown>,
  at: number,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_log (at, user_id, user_name, action, session_id, detail) SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0")
    .bind(at, user.id, user.displayName, action, sessionId, Object.keys(detail).length ? JSON.stringify(detail) : null);
}
