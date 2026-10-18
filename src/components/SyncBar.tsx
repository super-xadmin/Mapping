// แถบสถานะการส่งข้อมูล: ออนไลน์/ออฟไลน์, รอส่งกี่รายการ, ส่งล่าสุดเมื่อไหร่
import { useEffect, useState } from "react";
import { bkkHHMMSS } from "../../shared/time";
import { isSharedKey } from "../../shared/i18n";
import { codeText, useI18n, type UiKey } from "../i18n";
import { clearFailed, discardHeld, syncNow, syncStore, type SyncError } from "../lib/outbox";
import { useStore } from "../lib/store";

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function useSyncErrorText() {
  const { t } = useI18n();
  return (e: SyncError | null) => {
    if (!e) return "";
    if ("key" in e) return t(e.key);
    return e.serverKey && isSharedKey(e.serverKey) ? t(e.serverKey, e.params) : e.text;
  };
}

const OPS = ["round.add", "round.start", "round.end", "chunk", "cal.start", "cal.end"];

export default function SyncBar({ compact = false }: { compact?: boolean }) {
  const { lang, t } = useI18n();
  const s = useStore(syncStore);
  const online = useOnline();
  const errText = useSyncErrorText();

  if (compact && !s.queued && !s.held && !s.lastError && !s.failed.length && online && !s.storageError) return null;
  const cls = s.storageError || s.authError ? "bad" : !online || s.lastError || s.held ? "warn" : "ok";
  return (
    <div className={`syncbar ${cls}`}>
      <span className="dot" />
      <span>
        {online ? t("sync.online") : t("sync.offline")} · {t("sync.pending", { n: s.pending })}
        {s.syncing ? ` · ${t("sync.sending")}` : s.lastOkAt ? ` · ${t("sync.last", { t: bkkHHMMSS(s.lastOkAt) })}` : ""}
      </span>
      {s.pending > 0 && !s.syncing && (
        <button className="link" onClick={() => void syncNow()}>{t("sync.now")}</button>
      )}
      {s.lastError && <div className="small">{errText(s.lastError)}</div>}
      {s.storageError && <div className="small">{t("sync.storage")}</div>}
      {s.held > 0 && (
        <div className="small">
          {t("sync.held", { n: s.held })}{" "}
          <button className="link" onClick={() => confirm(t("sync.discardConfirm", { n: s.held })) && discardHeld()}>{t("sync.discardHeld")}</button>
        </div>
      )}
      {s.failed.length > 0 && (
        <details className="small">
          <summary>{t("sync.failed", { n: s.failed.length })}</summary>
          <ul>
            {s.failed.map((f, i) => (
              <li key={i}>
                {bkkHHMMSS(f.at)} {OPS.includes(f.k) ? t(`op.${f.k}` as UiKey) : f.k}
                {f.points ? ` ${t("sync.points", { n: f.points })}` : ""}: {codeText(lang, f.code, f.error || t("sync.unknown"))}
              </li>
            ))}
          </ul>
          <button className="link" onClick={clearFailed}>{t("sync.clearFailed")}</button>
        </details>
      )}
    </div>
  );
}
