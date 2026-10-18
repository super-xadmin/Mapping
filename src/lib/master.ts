// ข้อมูลหลัก (คนขับ / รถ / โปรเจกต์): ช่องข้อมูลของแต่ละประเภท และการเพิ่มรายการใหม่
import type { MasterType } from "../../shared/labels";
import type { Driver, Master, Project, Vehicle } from "../../shared/types";
import type { UiKey } from "../i18n";
import { ApiError, api } from "./api";

export const MASTER_TYPES: MasterType[] = ["drivers", "vehicles", "projects"];

export const MASTER_FIELDS: Record<MasterType, { main: string; sub: string; mainPh: UiKey; subPh: UiKey; title: UiKey }> = {
  drivers: { main: "name", sub: "team", mainPh: "adm.driversMain", subPh: "adm.driversSub", title: "col.driver" },
  vehicles: { main: "plate", sub: "equipment", mainPh: "adm.vehiclesMain", subPh: "adm.vehiclesSub", title: "col.vehicle" },
  projects: { main: "name", sub: "area", mainPh: "adm.projectsMain", subPh: "adm.projectsSub", title: "col.project" },
};

/** แถวของข้อมูลหลักในรูปแบบเดียวกันทุกประเภท */
export type MasterRow = { id: string; main: string; sub: string | null; active: boolean; createdBy: string | null; createdAt: number };

export function masterRows(m: Master | null, type: MasterType): MasterRow[] {
  if (!m) return [];
  if (type === "drivers") return m.drivers.map((d: Driver) => ({ ...d, main: d.name, sub: d.team }));
  if (type === "vehicles") return m.vehicles.map((v: Vehicle) => ({ ...v, main: v.plate, sub: v.equipment }));
  return m.projects.map((p: Project) => ({ ...p, main: p.name, sub: p.area }));
}

export type AddResult = { id: string; existed?: boolean; reactivated?: boolean };

/**
 * เพิ่มรายการใหม่ — ถ้ามีชื่อนี้อยู่แล้วคืนรายการเดิม (existed)
 * ถ้าเคยมีแต่ถูกปิดใช้งาน เซิร์ฟเวอร์จะเปิดใช้งานรายการเดิมให้ (reactivated)
 */
export async function addMaster(type: MasterType, main: string, sub: string): Promise<AddResult> {
  const f = MASTER_FIELDS[type];
  try {
    return await api<AddResult>(`/master/${type}`, { body: { [f.main]: main, [f.sub]: sub } });
  } catch (e) {
    const id = e instanceof ApiError && e.status === 409 ? (e.data as { id?: unknown } | undefined)?.id : undefined;
    if (typeof id === "string") return { id, existed: true };
    throw e;
  }
}
