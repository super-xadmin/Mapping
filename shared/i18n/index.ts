// ระบบ 3 ภาษา (ไทย / English / 简体中文) — ส่วนที่ใช้ร่วมกันทั้ง Worker และหน้าเว็บ
import { th } from "./th";
import { en } from "./en";
import { zh } from "./zh";

export type Lang = "th" | "en" | "zh";
export const LANGS: Lang[] = ["th", "en", "zh"];
export const LANG_NAME: Record<Lang, string> = { th: "ไทย", en: "EN", zh: "中文" };
/** ค่า lang สำหรับแท็ก <html> (มีผลกับการเลือกฟอนต์จีน) */
export const HTML_LANG: Record<Lang, string> = { th: "th", en: "en", zh: "zh-CN" };

export type SharedKey = keyof typeof th;
export type Params = Record<string, string | number>;
/** ข้อความที่ยังไม่แปล: key + ค่าที่จะแทนใน {…} */
export type Msg = { key: SharedKey; params?: Params };

const MESSAGES: Record<Lang, Record<SharedKey, string>> = { th, en, zh };

export const isLang = (v: unknown): v is Lang => v === "th" || v === "en" || v === "zh";
export const isSharedKey = (k: unknown): k is SharedKey => typeof k === "string" && Object.prototype.hasOwnProperty.call(th, k);

/** แทนค่า {name} ในข้อความ */
export function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (params[k] === undefined ? all : String(params[k])));
}

export function translate(lang: Lang, key: SharedKey, params?: Params): string {
  return fill(MESSAGES[lang][key] ?? MESSAGES.th[key] ?? key, params);
}

export const msgText = (lang: Lang, m: Msg) => translate(lang, m.key, m.params);

/** เลือกภาษาจาก header X-Lang หรือ Accept-Language (ค่าเริ่มต้นภาษาไทย) */
export function pickLang(...candidates: (string | null | undefined)[]): Lang {
  for (const c of candidates) {
    const v = (c ?? "").trim().toLowerCase();
    if (!v) continue;
    if (v.startsWith("zh")) return "zh";
    if (v.startsWith("en")) return "en";
    if (v.startsWith("th")) return "th";
  }
  return "th";
}
