// ระบบ 3 ภาษาฝั่งหน้าเว็บ: เลือกภาษาครั้งเดียว จำไว้ในเครื่อง และส่งไปให้ Worker ทุกคำขอ (X-Lang)
import { useMemo } from "react";
import { HTML_LANG, LANGS, LANG_NAME, fill, isLang, isSharedKey, pickLang, translate, type Lang, type Msg, type Params, type SharedKey } from "../../shared/i18n";
import { fmtKm } from "../../shared/geo";
import { fmtClock, fmtDate, fmtDateTime, fmtDuration } from "../../shared/time";
import { createStore, lsGet, lsSet, useStore } from "../lib/store";
import { th } from "./th";
import { en } from "./en";
import { zh } from "./zh";

export type UiKey = keyof typeof th;
export type Key = UiKey | SharedKey;
export type { Lang };

const UI: Record<Lang, Record<UiKey, string>> = { th, en, zh };
const K_LANG = "mlog:lang";

/** ภาษาที่เลือกไว้ หรือภาษาของเบราว์เซอร์ (จีน → 中文, อังกฤษ → EN, อื่น ๆ → ไทย) */
function detect(): Lang {
  const saved = lsGet<unknown>(K_LANG, null);
  if (isLang(saved)) return saved;
  const nav = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  return pickLang(...nav);
}

export const langStore = createStore<{ lang: Lang }>({ lang: detect() });
export const getLang = (): Lang => langStore.get().lang;

function applyHtmlLang(l: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = HTML_LANG[l];
}
applyHtmlLang(getLang());

export function setLang(l: Lang) {
  if (l === getLang()) return;
  lsSet(K_LANG, l);
  applyHtmlLang(l);
  langStore.set({ lang: l });
}

const isUiKey = (k: string): k is UiKey => Object.prototype.hasOwnProperty.call(th, k);

export function tr(lang: Lang, key: Key, params?: Params): string {
  if (isUiKey(key)) return fill(UI[lang][key] ?? th[key], params);
  return translate(lang, key, params);
}

/** แปลนอก React (เช่น ข้อความ error ใน lib) ด้วยภาษาปัจจุบัน */
export const T = (key: Key, params?: Params) => tr(getLang(), key, params);

/** ข้อความจากเซิร์ฟเวอร์ที่มี key มาด้วย: แปลใหม่ตามภาษาปัจจุบัน ถ้าไม่รู้จัก key ใช้ข้อความเดิม */
export function codeText(lang: Lang, code: string | undefined, fallback: string): string {
  return code && isSharedKey(code) ? translate(lang, code) : fallback;
}

function makeFormatters(lang: Lang) {
  return {
    date: (d: string | null | undefined) => fmtDate(d, lang),
    clock: (ms: number | null | undefined, workDate?: string) => fmtClock(ms, workDate, lang),
    dur: (ms: number | null | undefined) => fmtDuration(ms, lang),
    dt: (ms: number | null | undefined) => fmtDateTime(ms, lang),
    km: (m: number | null | undefined) => fmtKm(m, lang),
    /** m/s → กม./ชม. */
    kmh: (mps: number | null | undefined) => (mps == null ? "-" : translate(lang, "unit.kmh", { v: (mps * 3.6).toFixed(0) })),
    meters: (m: number | null | undefined) => (m == null ? "-" : translate(lang, "unit.m", { v: m.toFixed(0) })),
    msg: (m: Msg) => translate(lang, m.key, m.params),
  };
}
export type Formatters = ReturnType<typeof makeFormatters>;
export type TFn = (key: Key, params?: Params) => string;

export function useI18n() {
  const { lang } = useStore(langStore);
  return useMemo(() => {
    const t: TFn = (key, params) => tr(lang, key, params);
    return { lang, t, f: makeFormatters(lang) };
  }, [lang]);
}

/** ปุ่มเลือกภาษา ไทย | EN | 中文 */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang } = useStore(langStore);
  return (
    <div className={`langs ${className}`} role="group" aria-label="ภาษา / Language / 语言">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={HTML_LANG[l]}
          className={l === lang ? "on" : ""}
          aria-pressed={l === lang}
          onClick={() => setLang(l)}
        >
          {LANG_NAME[l]}
        </button>
      ))}
    </div>
  );
}
