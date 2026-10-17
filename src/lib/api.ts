// เรียก API ของ Worker — ส่งภาษาที่เลือก (X-Lang) ไปด้วย เพื่อให้ข้อความ error กลับมาเป็นภาษาเดียวกับหน้าเว็บ
import { T, getLang } from "../i18n";

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: unknown;
  /** key ของข้อความ (ถ้าเซิร์ฟเวอร์ส่งมา) ใช้แปลใหม่เมื่อเปลี่ยนภาษา */
  key?: string;
  params?: Record<string, string | number>;
  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
    if (data && typeof data === "object") {
      const d = data as { key?: unknown; params?: unknown };
      if (typeof d.key === "string") this.key = d.key;
      if (d.params && typeof d.params === "object") this.params = d.params as Record<string, string | number>;
    }
  }
}

/** status 0 = เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ออฟไลน์) */
export const isOffline = (e: unknown) => e instanceof ApiError && e.status === 0;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Lang": getLang() };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(T("net.offline"), 0, "offline");
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const data: unknown = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const obj = data && typeof data === "object" ? (data as { error?: string; code?: string }) : {};
    const code = obj.code;
    if (res.status === 401 || code === "must_change_password") {
      window.dispatchEvent(new CustomEvent("mlog:auth", { detail: code ?? "unauthorized" }));
    }
    throw new ApiError(obj.error ?? T("net.http", { status: res.status }), res.status, code, data);
  }
  return data as T;
}
