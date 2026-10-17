// ฟอร์มกรอกเวลา Calibration เอง (ชม.:นาที) — ใช้ทั้งเพิ่มใหม่และแก้ไข
import { useState } from "react";
import { CAL_KINDS, type CalKind } from "../../shared/labels";
import { bkkHHMM, dayOffset, resolveCalTimes } from "../../shared/time";
import type { Calibration } from "../../shared/types";
import { useI18n } from "../i18n";
import { api, errMsg } from "../lib/api";

type Props = {
  sessionId: string;
  workDate: string;
  initial?: Calibration;
  defaultKind?: CalKind;
  onDone: () => void;
  onCancel: () => void;
};

export default function CalibrationForm({ sessionId, workDate, initial, defaultKind = "pre", onDone, onCancel }: Props) {
  const { t, f } = useI18n();
  const [kind, setKind] = useState<CalKind>(initial?.kind ?? defaultKind);
  const [start, setStart] = useState(initial?.startedAt ? bkkHHMM(initial.startedAt) : "");
  const [end, setEnd] = useState(initial?.endedAt ? bkkHHMM(initial.endedAt) : "");
  const [nextDay, setNextDay] = useState(initial?.startedAt ? dayOffset(initial.startedAt, workDate) > 0 : false);
  const [note, setNote] = useState(initial?.note ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = start ? resolveCalTimes(workDate, start, end || null, nextDay) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!preview) return setErr(t("calf.needStart"));
    if (!preview.ok) return setErr(f.msg(preview.error));
    setBusy(true);
    try {
      const body = { kind, start, end: end || null, startNextDay: nextDay, note };
      if (initial) await api(`/calibrations/${initial.id}`, { method: "PATCH", body });
      else await api(`/sessions/${sessionId}/calibrations`, { body });
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="subcard" onSubmit={submit}>
      {!initial && <h3 className="m0">{t("calf.title")}</h3>}
      <div className="chips" role="radiogroup" aria-label={t("calf.kind")}>
        {CAL_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === kind} className={`chip ${k === kind ? "on" : ""}`} onClick={() => setKind(k)}>
            {t(`cal.${k}`)}
          </button>
        ))}
      </div>
      <div className="two-col">
        <label className="field">
          <span>{t("calf.start")} *</span>
          <input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("calf.end")}</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>{t("c.notes")}</span>
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t("calf.notePh")} />
      </label>
      <label className="check">
        <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} />
        {t("calf.nextDay")}
      </label>
      {preview?.ok && (
        <p className="muted small">
          {t("calf.preview", {
            v: `${f.clock(preview.startedAt, workDate)} – ${preview.endedAt ? f.clock(preview.endedAt, workDate) : t("calf.notDone")}${
              preview.endedAt ? ` (${f.dur(preview.endedAt - preview.startedAt)})` : ""
            }`,
          })}
        </p>
      )}
      {err && <div className="alert bad">{err}</div>}
      <div className="row">
        <button className="pri" disabled={busy}>{initial ? t("calf.saveEdit") : t("calf.add")}</button>
        <button type="button" onClick={onCancel}>{t("c.cancel")}</button>
      </div>
    </form>
  );
}
