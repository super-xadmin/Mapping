// เวลาไทย (Asia/Bangkok = UTC+7 ไม่มี Daylight Saving) — ใช้ร่วมกันทั้งฝั่งเว็บและ Worker
import { translate, type Lang, type Msg } from "./i18n";

export const TZ = "Asia/Bangkok";
const OFFSET_MS = 7 * 3_600_000;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const MAX_ROUND_MS = 16 * HOUR_MS; // รอบหนึ่งยาวได้ไม่เกิน 16 ชม.
export const MAX_PLAN_SPAN_MS = 24 * HOUR_MS; // ทุกรอบรวมกันต้องอยู่ในช่วง 24 ชม.
export const MAX_CAL_MS = 12 * HOUR_MS; // Calibration หนึ่งครั้งไม่เกิน 12 ชม.

/** วันที่ตามเวลาไทย 'YYYY-MM-DD' */
export function bkkDate(ms: number = Date.now()): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}
/** เวลา 'HH:MM' ตามเวลาไทย */
export function bkkHHMM(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(11, 16);
}
export function bkkHHMMSS(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(11, 19);
}

export function isDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}
export function isHHMM(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** เวลาเที่ยงคืนของวันที่ (เวลาไทย) */
export function dayStart(date: string): number {
  return Date.parse(`${date}T00:00:00+07:00`);
}
/** แปลงวันที่ + 'HH:MM' (เวลาไทย) เป็น epoch ms */
export function atBkk(date: string, hhmm: string, plusDays = 0): number {
  return Date.parse(`${date}T${hhmm}:00+07:00`) + plusDays * DAY_MS;
}
/** บวก/ลบนาทีจาก 'HH:MM' (วนรอบ 24 ชม.) */
export function addMinutesHHMM(hhmm: string, minutes: number): string {
  if (!isHHMM(hhmm)) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * แปลงเวลา HH:MM หลายค่าที่เรียงตามลำดับเหตุการณ์ให้เป็นเวลาจริง
 * ถ้าเวลาถัดไปน้อยกว่าเวลาก่อนหน้า ถือว่าข้ามเที่ยงคืนไปวันถัดไป (รองรับงานกะกลางคืน)
 */
export function resolveSequence(date: string, times: string[], firstPlusDays = 0): number[] {
  const out: number[] = [];
  let prev = -Infinity;
  times.forEach((t, i) => {
    let ms = atBkk(date, t, i === 0 ? firstPlusDays : 0);
    while (ms < prev) ms += DAY_MS;
    out.push(ms);
    prev = ms;
  });
  return out;
}

export type PlannedRoundInput = { topic: string; plannedStart: string; plannedEnd: string };
type Result<T> = ({ ok: true } & T) | { ok: false; error: Msg };

/** ตรวจและแปลงเวลาตามแผนของแต่ละรอบ (ใช้ทั้งตอนกรอกฟอร์มและที่ Worker) */
export function resolvePlannedRounds(date: string, rounds: PlannedRoundInput[]): Result<{ times: [number, number][] }> {
  if (!rounds.length) return { ok: false, error: { key: "val.needRound" } };
  for (const [i, r] of rounds.entries()) {
    if (!r.topic?.trim()) return { ok: false, error: { key: "val.roundTopic", params: { n: i + 1 } } };
    if (!isHHMM(r.plannedStart) || !isHHMM(r.plannedEnd)) return { ok: false, error: { key: "val.roundTimes", params: { n: i + 1 } } };
  }
  const abs = resolveSequence(date, rounds.flatMap((r) => [r.plannedStart, r.plannedEnd]));
  const times: [number, number][] = [];
  for (let i = 0; i < rounds.length; i++) {
    const s = abs[i * 2], e = abs[i * 2 + 1];
    if (e === s) return { ok: false, error: { key: "val.roundEndAfter", params: { n: i + 1 } } };
    if (e - s > MAX_ROUND_MS) return { ok: false, error: { key: "val.roundTooLong", params: { n: i + 1 } } };
    times.push([s, e]);
  }
  if (abs[abs.length - 1] - abs[0] > MAX_PLAN_SPAN_MS) return { ok: false, error: { key: "val.planSpan" } };
  return { ok: true, times };
}

/** ตรวจและแปลงเวลา Calibration ที่กรอกเอง (เวลาเสร็จเว้นว่างได้ ถ้ายังไม่เสร็จ) */
export function resolveCalTimes(
  date: string,
  start: string,
  end: string | null | undefined,
  startNextDay = false,
): Result<{ startedAt: number; endedAt: number | null }> {
  if (!isHHMM(start)) return { ok: false, error: { key: "val.calStart" } };
  if (end && !isHHMM(end)) return { ok: false, error: { key: "val.calEndFormat" } };
  const plus = startNextDay ? 1 : 0;
  if (!end) return { ok: true, startedAt: atBkk(date, start, plus), endedAt: null };
  const [s, e] = resolveSequence(date, [start, end], plus);
  if (e === s) return { ok: false, error: { key: "val.calEndAfter" } };
  if (e - s > MAX_CAL_MS) return { ok: false, error: { key: "val.calTooLong" } };
  return { ok: true, startedAt: s, endedAt: e };
}

/** จำนวนวันที่ต่างจากวันทำงาน (0 = วันเดียวกัน, 1 = วันถัดไป) */
export function dayOffset(ms: number, workDate: string): number {
  return Math.round((dayStart(bkkDate(ms)) - dayStart(workDate)) / DAY_MS);
}

// ---------- การแสดงผลตามภาษา ----------

/** HH:MM และบอก (+1 วัน) ถ้าไม่ใช่วันเดียวกับวันทำงาน */
export function fmtClock(ms: number | null | undefined, workDate?: string, lang: Lang = "th"): string {
  if (ms == null) return "-";
  const hhmm = bkkHHMM(ms);
  if (!workDate) return hhmm;
  const d = dayOffset(ms, workDate);
  return d === 0 ? hhmm : `${hhmm} (${translate(lang, "unit.dayOffset", { n: `${d > 0 ? "+" : ""}${d}` })})`;
}

export function fmtDuration(ms: number | null | undefined, lang: Lang = "th"): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "-";
  const m = Math.round(ms / MINUTE_MS);
  if (m < 60) return translate(lang, "unit.min", { m });
  return translate(lang, "unit.hmin", { h: Math.floor(m / 60), m: m % 60 });
}

/** นาฬิกาจับเวลา 1:02:03 */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** '2026-10-17' → '17 ต.ค. 2569' / '17 Oct 2026' / '2026年10月17日' */
export function fmtDate(date: string | null | undefined, lang: Lang = "th"): string {
  if (!date || !isDateStr(date)) return "-";
  const [y, m, d] = date.split("-").map(Number);
  if (lang === "zh") return `${y}年${m}月${d}日`;
  if (lang === "en") return `${d} ${EN_MONTHS[m - 1]} ${y}`;
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

export function fmtDateTime(ms: number | null | undefined, lang: Lang = "th"): string {
  if (ms == null) return "-";
  return `${fmtDate(bkkDate(ms), lang)} ${bkkHHMM(ms)}`;
}
