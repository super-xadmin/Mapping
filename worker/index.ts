// Cloudflare Worker: API ของ Mapping Log (หน้าเว็บเป็นไฟล์ static ที่ Cloudflare ให้บริการเอง)
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { translate } from "../shared/i18n";
import type { AppEnv } from "./env";
import { AppError, langOf, tr } from "./util";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { masterRoutes } from "./routes/master";
import { sessionRoutes } from "./routes/sessions";
import { calRoutes } from "./routes/calibrations";
import { syncRoutes } from "./routes/sync";
import { auditRoutes } from "./routes/audit";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  // กัน CSRF: คำขอที่แก้ไขข้อมูลต้องมาจากเว็บไซต์เดียวกัน
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: tr(c, "err.csrf"), code: "csrf" }, 403);
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Vary", "X-Lang, Accept-Language");
});

app.route("/auth", authRoutes);
app.route("/users", userRoutes);
app.route("/master", masterRoutes);
app.route("/sessions", sessionRoutes);
app.route("/calibrations", calRoutes);
app.route("/sync", syncRoutes);
app.route("/audit", auditRoutes);

app.notFound((c) => c.json({ error: tr(c, "err.notFoundApi"), code: "not_found" }, 404));
app.onError((err, c) => {
  // ข้อผิดพลาดที่ตั้งใจส่งให้ผู้ใช้ → แปลตามภาษาที่หน้าเว็บส่งมา
  if (err instanceof AppError) {
    // key = ข้อความต้นฉบับ (หน้าเว็บใช้แปลใหม่ได้เมื่อเปลี่ยนภาษา), code = รหัสสำหรับโปรแกรม
    return c.json(
      { ...err.extra, error: translate(langOf(c), err.key, err.params), code: err.code ?? err.key, key: err.key, params: err.params },
      err.status,
    );
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: tr(c, "err.internal"), code: "internal" }, 500);
});

export default app;
