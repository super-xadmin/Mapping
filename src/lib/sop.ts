// ตรวจเส้นทางตามหลัก SOP การเก็บข้อมูลแผนที่ (คำนวณจาก GPS ไม่ต้องกดอะไรเพิ่ม)
//  1) วิ่งไป–กลับให้ครบทั้งสองฝั่ง (round trip / ทั้งสองเลน)
//  2) จุดเริ่มกับจุดจบอยู่ที่เดียวกัน (ปิดวง)
//  3) 1 วง (1 รอบ) ไม่เกิน 3 ชั่วโมง
// เป็นข้อแนะนำให้ผู้ตรวจ QC (ไม่บังคับ) เพราะ SOP ยกเว้นถนนทางเดียว/ถนนแคบที่วิ่งเที่ยวเดียวได้

export const SOP = {
  MAX_LOOP_MS: 3 * 3_600_000,
  WARN_LOOP_MS: 2.5 * 3_600_000,
  /** ≥ 80% ของเส้นทางมีทั้งขาไปและขากลับ = ผ่าน */
  COVERAGE_OK: 0.8,
  COVERAGE_WARN: 0.5,
  /** จุดเริ่ม–จุดจบห่างไม่เกิน 100 ม. = ปิดวง */
  CLOSE_OK_M: 100,
  SAMPLE_M: 20,
  /** หาเที่ยวสวนทางภายในรัศมีนี้ (รองรับถนนที่มีเกาะกลางกว้าง) */
  PAIR_RADIUS_M: 60,
  OPPOSITE_DEG: 135,
  MIN_SEG_M: 5,
  MIN_SAMPLES: 5,
};

type LL = { lat: number; lng: number };
type Sample = { x: number; y: number; h: number };

/** สุ่มจุดทุก ~20 ม. ตามเส้นทาง พร้อมทิศทางการวิ่ง (องศา) — ใช้พิกัดฉากรอบจุดอ้างอิง */
function sampleTrack(pts: LL[], ref: LL): { samples: Sample[]; lengthM: number } {
  const kx = Math.cos((ref.lat * Math.PI) / 180) * 111_320;
  const ky = 110_574;
  const samples: Sample[] = [];
  let lengthM = 0;
  let sinceSample = Infinity;
  let ax = NaN, ay = NaN;
  for (const p of pts) {
    const x = (p.lng - ref.lng) * kx;
    const y = (p.lat - ref.lat) * ky;
    if (Number.isNaN(ax)) {
      ax = x;
      ay = y;
      continue;
    }
    const dx = x - ax, dy = y - ay;
    const d = Math.hypot(dx, dy);
    if (d < SOP.MIN_SEG_M) continue; // ขยับน้อยเกินไป ทิศทางยังเชื่อไม่ได้
    const h = (Math.atan2(dx, dy) * 180) / Math.PI;
    lengthM += d;
    sinceSample += d;
    if (sinceSample >= SOP.SAMPLE_M) {
      samples.push({ x, y, h });
      sinceSample = 0;
    }
    ax = x;
    ay = y;
  }
  return { samples, lengthM };
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** สัดส่วนจุดที่มีเที่ยวสวนทางอยู่ใกล้ ๆ (= วิ่งครบทั้งไปและกลับ) */
function pairCoverage(samples: Sample[]): number | null {
  if (samples.length < SOP.MIN_SAMPLES) return null;
  const R = SOP.PAIR_RADIUS_M;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  samples.forEach((s, i) => {
    const k = key(Math.floor(s.x / R), Math.floor(s.y / R));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  let matched = 0;
  for (const s of samples) {
    const cx = Math.floor(s.x / R), cy = Math.floor(s.y / R);
    let found = false;
    for (let gx = cx - 1; gx <= cx + 1 && !found; gx++) {
      for (let gy = cy - 1; gy <= cy + 1 && !found; gy++) {
        for (const j of grid.get(key(gx, gy)) ?? []) {
          const o = samples[j];
          if (angleDiff(s.h, o.h) >= SOP.OPPOSITE_DEG && Math.hypot(o.x - s.x, o.y - s.y) <= R) {
            found = true;
            break;
          }
        }
      }
    }
    if (found) matched++;
  }
  return matched / samples.length;
}

function distM(a: LL, b: LL): number {
  const R = 6_371_000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(toR(b.lat - a.lat) / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(toR(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type LoopCheck = {
  lengthM: number;
  /** สัดส่วนเส้นทางที่วิ่งครบทั้งขาไปและขากลับ (0–1) — null = เส้นทางสั้นเกินไปที่จะบอกได้ */
  coverage: number | null;
  /** ระยะห่างจุดเริ่ม–จุดจบ (ม.) */
  startEndM: number | null;
};

/** ตรวจ 1 รอบ (1 วง) */
export function analyzeLoop(pts: LL[]): LoopCheck {
  if (pts.length < 2) return { lengthM: 0, coverage: null, startEndM: null };
  const { samples, lengthM } = sampleTrack(pts, pts[0]);
  return { lengthM, coverage: pairCoverage(samples), startEndM: distM(pts[0], pts[pts.length - 1]) };
}

/** ตรวจทั้งงาน (รวมทุกรอบ) — กรณีวิ่งขาไปกับขากลับแยกกันคนละรอบ */
export function analyzeJob(runs: LL[][]): number | null {
  const first = runs.find((r) => r.length)?.[0];
  if (!first) return null;
  return pairCoverage(runs.flatMap((r) => sampleTrack(r, first).samples));
}

export type Level = "ok" | "warn" | "bad";
export const coverageLevel = (c: number | null): Level | null =>
  c == null ? null : c >= SOP.COVERAGE_OK ? "ok" : c >= SOP.COVERAGE_WARN ? "warn" : "bad";
export const closedLevel = (m: number | null): Level | null => (m == null ? null : m <= SOP.CLOSE_OK_M ? "ok" : "bad");
export const timeLevel = (ms: number | null): Level | null =>
  ms == null ? null : ms > SOP.MAX_LOOP_MS ? "bad" : ms > SOP.WARN_LOOP_MS ? "warn" : "ok";
export const pct = (c: number) => Math.round(c * 100);
