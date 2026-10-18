import { memo, useEffect, useState } from "react";
import { bkkDate, bkkHHMM, MINUTE_MS } from "../../shared/time";

// ลายน้ำชื่อบัญชีที่ล็อกอินอยู่ + วันเวลา ทับทั้งหน้าจอแบบจาง ๆ
// เพื่อให้ภาพที่แคปหน้าจอออกไปรู้ได้ว่ามาจากบัญชีไหน เมื่อไร
// (เว็บห้ามแคปหน้าจอไม่ได้จริง ลายน้ำช่วยให้ตามย้อนกลับได้และทำให้คนไม่กล้าส่งต่อ)

const ANGLE = -22; // องศาที่เอียง
const NAME_PX = 15;
const META_PX = 11.5;
const ROW = 92; // ระยะห่างระหว่างแถว
const MAX_NAME = 40;

const MARK = /\p{M}/u; // สระบน/ล่าง วรรณยุกต์ ไม่กินความกว้าง
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u; // จีน/ญี่ปุ่น/เกาหลี

/** ประมาณความกว้างตัวอักษร (เผื่อไว้มากกว่าจริงเล็กน้อย) เพื่อเว้นระยะไม่ให้ข้อความชนกัน */
function estWidth(s: string, px: number): number {
  let em = 0;
  for (const ch of s) em += MARK.test(ch) ? 0 : WIDE.test(ch) ? 1 : ch === " " ? 0.3 : 0.62;
  return em * px;
}

function clip(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : s;
}

/** เวลาปัจจุบัน: อัปเดตทุกต้นนาที และทันทีที่กลับมาเปิดแอป (มือถือพักเครื่องแล้ว timer หยุด) */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS) + 50);
    };
    function tick() {
      setNow(Date.now());
      schedule();
    }
    const onShow = () => {
      if (document.visibilityState === "visible") tick();
    };
    schedule();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, []);
  return now;
}

export const Watermark = memo(function Watermark({ name, username }: { name: string; username: string }) {
  const now = useMinuteClock();
  const line1 = clip(name.trim() || username, MAX_NAME);
  const line2 = `${username} · ${bkkDate(now)} ${bkkHHMM(now)}`;
  const w = Math.round(Math.min(600, Math.max(260, Math.max(estWidth(line1, NAME_PX), estWidth(line2, META_PX)) + 150)));
  const h = ROW * 2;
  // วางแบบสลับฟันปลา: กลางแถวบน + ขอบซ้าย/ขวาแถวล่าง (ต่อกันเป็นข้อความเต็มเมื่อปูซ้ำ)
  const item = (x: number, y: number) => (
    <g key={`${x},${y}`} transform={`translate(${x} ${y})`}>
      <text className="wm-name" y={-3} fontSize={NAME_PX}>{line1}</text>
      <text className="wm-meta" y={13} fontSize={META_PX}>{line2}</text>
    </g>
  );
  return (
    <svg className="watermark" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="mlog-wm" width={w} height={h} patternUnits="userSpaceOnUse" patternTransform={`rotate(${ANGLE})`}>
          {item(w / 2, h / 4)}
          {item(0, (3 * h) / 4)}
          {item(w, (3 * h) / 4)}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#mlog-wm)" />
    </svg>
  );
});
