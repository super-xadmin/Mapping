import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { QcStatus } from "../../shared/labels";
import { calComplete, type Calibration } from "../../shared/types";
import { useI18n } from "../i18n";

/** สัญลักษณ์แอป (โทนสีเดียวกับเว็บ super-x.tech) */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="brand-mark">
      <defs>
        <linearGradient id="bm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1C3564" />
          <stop offset="1" stopColor="#0A1530" />
        </linearGradient>
        <linearGradient id="bm-route" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#8EC96D" />
          <stop offset="0.5" stopColor="#4FC8E9" />
          <stop offset="1" stopColor="#1C8CC9" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#bm-bg)" />
      <path d="M118 386 C 196 296, 232 392, 302 300 S 356 252, 368 240" fill="none" stroke="url(#bm-route)" strokeWidth="34" strokeLinecap="round" />
      <circle cx="118" cy="386" r="34" fill="#8EC96D" />
      <circle cx="118" cy="386" r="14" fill="#0A1530" />
      <path d="M368 84c-48 0-86 38-86 86 0 64 86 148 86 148s86-84 86-148c0-48-38-86-86-86z" fill="#4FC8E9" />
      <circle cx="368" cy="170" r="32" fill="#0A1530" />
    </svg>
  );
}

/** ชื่อแอป + สัญลักษณ์ (light = ตัวอักษรสีขาว สำหรับพื้นเข้ม) */
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand-lockup${light ? " light" : ""}`}>
      <BrandMark />
      <span className="brand-text">
        <b>Mapping Log</b>
        <small>SUPERX AI</small>
      </span>
    </span>
  );
}

export function QcBadge({ status }: { status: QcStatus }) {
  const { t } = useI18n();
  return <span className={`badge qc-${status}`}>{t(`qc.${status}`)}</span>;
}

export function CalBadge({ cals }: { cals: Calibration[] }) {
  const { t } = useI18n();
  if (calComplete(cals)) return <span className="badge ok">{t("badge.calOk")}</span>;
  if (cals.some((c) => c.startedAt && !c.endedAt)) return <span className="badge warn">{t("badge.calOpen")}</span>;
  return <span className="badge bad">{t("badge.calNone")}</span>;
}

export function Pending() {
  const { t } = useI18n();
  return <span className="badge pending" title={t("c.pendingSyncTip")}>{t("c.pendingSync")}</span>;
}

export function Spinner({ text }: { text?: string }) {
  const { t } = useI18n();
  return <div className="muted center pad">{text ?? t("c.loading")}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string | null | undefined; onRetry?: () => void }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div className="alert bad">
      {error} {onRetry && <button className="link" onClick={onRetry}>{t("c.retry")}</button>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** เมนูแบบกดเปิด/ปิด (ปิดเองเมื่อแตะข้างนอก หรือเลือกรายการ) — ถ้าล้นขอบจอซ้ายจะชิดซ้ายแทน */
export function Menu({ label, title, children, className = "" }: { label: ReactNode; title?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return setAlignLeft(false);
    const r = popRef.current?.getBoundingClientRect();
    if (r && r.left < 8) setAlignLeft(true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`menu ${className}`} ref={ref}>
      <button type="button" className="menu-btn" title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div ref={popRef} className={`menu-pop${alignLeft ? " left" : ""}`} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * ปุ่มที่ต้องแตะ 2 ครั้งเพื่อยืนยัน (แทนกล่อง confirm ที่กดยากบนมือถือ)
 * แตะครั้งที่ 2 ต้องห่างจากครั้งแรกอย่างน้อย 400 ms — กันนิ้วแตะเบิ้ล (double-tap) โดยไม่ตั้งใจ
 */
export function useConfirmTap(timeoutMs = 4000, minGapMs = 400) {
  const [armed, setArmed] = useState<string | null>(null);
  const armedAt = useRef(0);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), timeoutMs);
    return () => clearTimeout(t);
  }, [armed, timeoutMs]);
  return {
    armed,
    tap(id: string, action: () => void) {
      if (armed !== id) {
        armedAt.current = Date.now();
        return setArmed(id);
      }
      if (Date.now() - armedAt.current < minGapMs) return;
      setArmed(null);
      action();
    },
    reset: () => setArmed(null),
  };
}

/**
 * กันแตะเบิ้ล: ปุ่มที่เพิ่งเปลี่ยนเป็นขั้นตอนใหม่ (stepKey เปลี่ยน) จะไม่รับการแตะในช่วงสั้น ๆ
 * เช่น แตะ "เสร็จสิ้น Calibration" สองทีติดกัน จะไม่กลายเป็นกด "เริ่มรอบ 1" ไปด้วย
 */
export function useTapGuard(stepKey: string, guardMs = 800) {
  const shownAt = useRef(0);
  useLayoutEffect(() => {
    shownAt.current = Date.now();
  }, [stepKey]);
  return (action: () => void) => () => {
    if (Date.now() - shownAt.current < guardMs) return;
    action();
  };
}

/** เวลาปัจจุบันที่อัปเดตทุก intervalMs (0 = ไม่อัปเดต) */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!intervalMs) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** ตรวจขนาดหน้าจอ เช่น useMedia("(max-width: 720px)") */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
