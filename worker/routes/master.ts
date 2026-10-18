// ข้อมูลหลัก: คนขับ/ทีม, รถ/อุปกรณ์, โปรเจกต์/พื้นที่ (ปิดใช้งานแทนการลบ เพื่อให้ข้อมูลย้อนหลังครบ)
// ทุกคนยกเว้นบัญชีดูอย่างเดียว เพิ่ม/แก้ไข/ปิดใช้งานได้ — ทุกครั้งบันทึกชื่อคนทำและเวลาไว้ใน audit_log
import { Hono } from "hono";
import { can } from "../../shared/labels";
import type { AppEnv } from "../env";
import { requireRole, requireUser } from "../auth";
import { STAGE_SQL } from "../rows";
import { audit, fail, now, readJson, str, uid } from "../util";

const TYPES = {
  drivers: { type: "drivers", table: "drivers", main: "name", sub: "team", ref: "driver_id", required: "err.req.drivers" },
  vehicles: { type: "vehicles", table: "vehicles", main: "plate", sub: "equipment", ref: "vehicle_id", required: "err.req.vehicles" },
  projects: { type: "projects", table: "projects", main: "name", sub: "area", ref: "project_id", required: "err.req.projects" },
} as const;
type TypeKey = keyof typeof TYPES;
type T = (typeof TYPES)[TypeKey];
const typeOf = (t: string) => (t in TYPES ? TYPES[t as TypeKey] : fail(404, "err.masterType"));

/** รายการที่ชื่อซ้ำ (ไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหน้า-หลัง) — ถ้ามีหลายรายการ เลือกรายการที่ใช้งานอยู่ก่อน */
const findSame = (DB: D1Database, t: T, name: string, exceptId = "") =>
  DB.prepare(`SELECT id, ${t.main} AS main, active FROM ${t.table} WHERE lower(trim(${t.main})) = lower(?) AND id != ? ORDER BY active DESC LIMIT 1`)
    .bind(name, exceptId)
    .first<{ id: string; main: string; active: number }>();

/** ใช้อยู่ในงานที่ส่งแล้ว / ผ่าน QC แล้วหรือไม่ (แก้ชื่อแล้วประวัติของงานเหล่านั้นจะเปลี่ยนตาม) */
const usedInLockedJob = async (DB: D1Database, t: T, id: string) =>
  !!(await DB.prepare(`SELECT 1 AS x FROM mapping_sessions s WHERE s.${t.ref} = ? AND (${STAGE_SQL}) IN ('submitted', 'passed') LIMIT 1`)
    .bind(id)
    .first());

export const masterRoutes = new Hono<AppEnv>();
masterRoutes.use("*", requireUser);

masterRoutes.get("/", async (c) => {
  const DB = c.env.DB;
  const sel = (t: T) =>
    DB.prepare(
      `SELECT x.id, x.${t.main}, x.${t.sub}, x.active, x.created_at, u.display_name AS created_by
       FROM ${t.table} x LEFT JOIN users u ON u.id = x.created_by ORDER BY x.active DESC, x.${t.main}`,
    );
  const [d, v, p] = await DB.batch<Record<string, unknown>>([sel(TYPES.drivers), sel(TYPES.vehicles), sel(TYPES.projects)]);
  const fix = (rows: Record<string, unknown>[]) =>
    rows.map(({ created_at, created_by, ...r }) => ({ ...r, active: !!r.active, createdBy: created_by ?? null, createdAt: created_at }));
  return c.json({ drivers: fix(d.results), vehicles: fix(v.results), projects: fix(p.results) });
});

masterRoutes.post("/:type", requireRole(can.master), async (c) => {
  const t = typeOf(c.req.param("type"));
  const b = await readJson(c);
  const main = str(b[t.main], 200) ?? fail(400, t.required);
  const sub = str(b[t.sub], 300);
  const DB = c.env.DB;
  const user = c.get("user");
  const same = await findSame(DB, t, main);
  if (same?.active) fail(409, "err.masterDup", { name: main }, { id: same.id }, "master_dup");
  if (same) {
    // เคยมีแต่ถูกปิดใช้งาน: เปิดใช้งานรายการเดิม (ข้อมูลย้อนหลังยังผูกกับรายการเดิม)
    await DB.batch([
      DB.prepare(`UPDATE ${t.table} SET active = 1 WHERE id = ?`).bind(same.id),
      audit(DB, user, "master.update", null, { type: t.type, name: same.main, active: true }),
    ]);
    return c.json({ id: same.id, reactivated: true });
  }
  const id = uid();
  await DB.batch([
    DB.prepare(`INSERT INTO ${t.table} (id, ${t.main}, ${t.sub}, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, main, sub, user.id, now()),
    audit(DB, user, "master.create", null, { type: t.type, name: main, detail: sub }),
  ]);
  return c.json({ id });
});

masterRoutes.patch("/:type/:id", requireRole(can.master), async (c) => {
  const t = typeOf(c.req.param("type"));
  const id = c.req.param("id");
  const b = await readJson(c);
  const DB = c.env.DB;
  const row = await DB.prepare(`SELECT ${t.main} AS main, ${t.sub} AS sub, active FROM ${t.table} WHERE id = ?`)
    .bind(id)
    .first<{ main: string; sub: string | null; active: number }>();
  if (!row) fail(404, "err.notFound");
  const sets: string[] = [];
  const vals: unknown[] = [];
  const changes: Record<string, unknown> = {};
  const user = c.get("user");
  // แก้ชื่อ/รายละเอียดของรายการที่อยู่ในงานที่ส่งแล้วหรือผ่าน QC แล้ว = เปลี่ยนประวัติงานเหล่านั้น → เฉพาะผู้ดูแลระบบ
  const renaming = (b[t.main] !== undefined && str(b[t.main], 200) !== row.main) || (b[t.sub] !== undefined && str(b[t.sub], 300) !== row.sub);
  if (renaming && !can.admin(user.role) && (await usedInLockedJob(DB, t, id))) fail(403, "err.masterInUse");
  if (b[t.main] !== undefined) {
    const v = str(b[t.main], 200) ?? fail(400, t.required);
    if (v !== row.main) {
      if (await findSame(DB, t, v, id)) fail(409, "err.masterDup", { name: v }, undefined, "master_dup");
      sets.push(`${t.main} = ?`); vals.push(v); changes.newName = v;
    }
  }
  if (b[t.sub] !== undefined) {
    const v = str(b[t.sub], 300);
    if (v !== row.sub) { sets.push(`${t.sub} = ?`); vals.push(v); changes.detail = v; changes.oldDetail = row.sub; }
  }
  if (b.active !== undefined && !!b.active !== !!row.active) {
    sets.push("active = ?"); vals.push(b.active ? 1 : 0); changes.active = !!b.active;
  }
  if (!sets.length) return c.json({ ok: true });
  await DB.batch([
    DB.prepare(`UPDATE ${t.table} SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
    audit(DB, user, "master.update", null, { type: t.type, name: row.main, ...changes }),
  ]);
  return c.json({ ok: true });
});
