// เริ่มงานใหม่แบบเร็ว: จำโปรเจกต์/คนขับ/รถที่ใช้ล่าสุด ตั้งชื่องานให้อัตโนมัติ แล้วไปหน้าบันทึกทันที
// ไม่มีคนขับ/รถ/โปรเจกต์ที่ต้องการ: กด "+ เพิ่มใหม่" ได้เลยในหน้านี้
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { MasterType } from "../../shared/labels";
import { addMinutesHHMM, bkkDate, bkkHHMM, resolvePlannedRounds, type PlannedRoundInput } from "../../shared/time";
import type { Master } from "../../shared/types";
import { useI18n } from "../i18n";
import { api, errMsg } from "../lib/api";
import { MASTER_FIELDS, addMaster, type AddResult } from "../lib/master";
import { SOP } from "../lib/sop";
import { lsGet, lsSet } from "../lib/store";

const K_LAST = "mlog:newjob:last";
type Last = { projectId?: string; driverId?: string; vehicleId?: string; splitRounds?: boolean };
type Opt = { id: string; main: string; sub?: string | null };
const RUN_DEFAULT_MIN = 120; // รอบใหม่ยาว 2 ชม. ตามค่าเริ่มต้น

/** เวลาปัจจุบันปัดขึ้นเป็นทุก 15 นาที (เวลาไทย) — ไม่ข้ามไปเที่ยงคืน (จะกลายเป็นเวลาที่ผ่านไปแล้วของวันทำงาน) */
function roundedNow(): string {
  const [h, m] = bkkHHMM(Date.now()).split(":").map(Number);
  return addMinutesHHMM("00:00", Math.min(Math.ceil((h * 60 + m) / 15) * 15, 23 * 60 + 45));
}

/** เพิ่มคนขับ / รถ / โปรเจกต์ใหม่จากหน้านี้ (อยู่ในฟอร์มสร้างงาน: กด Enter ต้องไม่ส่งฟอร์มหลัก) */
function QuickAdd({ type, onDone, onCancel }: { type: MasterType; onDone: (r: AddResult, name: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const c = MASTER_FIELDS[type];
  const [main, setMain] = useState("");
  const [sub, setSub] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    const name = main.trim();
    if (!name || busy) return;
    setBusy(true);
    setErr("");
    try {
      onDone(await addMaster(type, name, sub), name);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  };
  return (
    <div className="quick-add">
      <input autoFocus maxLength={200} aria-label={t(c.mainPh)} placeholder={`${t(c.mainPh)} *`} value={main} onChange={(e) => setMain(e.target.value)} onKeyDown={enter} />
      <input maxLength={300} aria-label={t(c.subPh)} placeholder={t(c.subPh)} value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={enter} />
      {err && <div className="alert bad small m0">{err}</div>}
      <div className="row m0">
        <button type="button" className="pri" disabled={!main.trim() || busy} onClick={() => void save()}>{t("c.add")}</button>
        <button type="button" onClick={onCancel}>{t("c.cancel")}</button>
      </div>
    </div>
  );
}

/** เลือกได้ด้วยการแตะครั้งเดียว (ถ้าตัวเลือกไม่เกิน 6 รายการ) ไม่งั้นเป็น dropdown — มีปุ่ม "+ เพิ่มใหม่" ต่อท้ายเสมอ */
function Choice(p: { label: string; type: MasterType; value: string; onChange: (v: string) => void; onAdded: (id: string) => Promise<void>; options: Opt[] }) {
  const { label, value, onChange, options } = p;
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const addBtn = (
    <button type="button" className="chip add-chip" aria-expanded={adding} onClick={() => { setAdding(!adding); setMsg(""); }}>
      {t("nj.addNew")}
    </button>
  );
  const extra = (
    <>
      {adding && (
        <QuickAdd
          type={p.type}
          onCancel={() => setAdding(false)}
          onDone={(r, name) => {
            setAdding(false);
            setMsg(r.existed ? t("nj.dupPicked", { name }) : r.reactivated ? t("md.reactivated", { name }) : "");
            void p.onAdded(r.id);
          }}
        />
      )}
      {msg && <div className="muted small">{msg}</div>}
    </>
  );
  if (options.length <= 6) {
    return (
      <div className="field">
        <span>{label} *</span>
        <div className="chips">
          <div className="chips m0" role="radiogroup" aria-label={label}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={o.id === value}
                className={`chip big-chip${o.id === value ? " on" : ""}`}
                onClick={() => onChange(o.id)}
              >
                <b>{o.main}</b>
                {o.sub && <small>{o.sub}</small>}
              </button>
            ))}
          </div>
          {addBtn}
        </div>
        {extra}
      </div>
    );
  }
  return (
    <div className="field">
      <span>{label} *</span>
      <div className="row m0">
        <select className="grow" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("c.choose")}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.main}{o.sub ? ` (${o.sub})` : ""}</option>
          ))}
        </select>
        {addBtn}
      </div>
      {extra}
    </div>
  );
}

export default function NewSession() {
  const nav = useNavigate();
  const { t, f } = useI18n();
  const today = bkkDate();
  const [m, setM] = useState<Master | null>(null);
  const [form, setForm] = useState(() => {
    const last = lsGet<Last>(K_LAST, {});
    return { projectId: "", driverId: "", vehicleId: "", workDate: today, title: "", notes: "", splitRounds: !!last.splitRounds };
  });
  const [editDate, setEditDate] = useState(false);
  const [rounds, setRounds] = useState<PlannedRoundInput[]>(() => {
    const start = roundedNow();
    return [{ topic: "", plannedStart: start, plannedEnd: addMinutesHHMM(start, RUN_DEFAULT_MIN) }];
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Master>("/master")
      .then((mm) => {
        setM(mm);
        const last = lsGet<Last>(K_LAST, {});
        // ใช้ค่าที่เลือกล่าสุด (ถ้ายังใช้งานอยู่) หรือเลือกให้เลยถ้ามีตัวเลือกเดียว
        const pick = (list: { id: string; active: boolean }[], lastId?: string) => {
          const act = list.filter((x) => x.active);
          if (lastId && act.some((x) => x.id === lastId)) return lastId;
          return act.length === 1 ? act[0].id : "";
        };
        setForm((x) => ({
          ...x,
          projectId: x.projectId || pick(mm.projects, last.projectId),
          driverId: x.driverId || pick(mm.drivers, last.driverId),
          vehicleId: x.vehicleId || pick(mm.vehicles, last.vehicleId),
        }));
      })
      .catch((e) => setErr(errMsg(e)));
  }, []);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((x) => ({ ...x, [k]: v }));
  /** เพิ่มรายการใหม่แล้ว: โหลดรายการใหม่ แล้วเลือกรายการนั้นให้ */
  const added = useCallback(
    (k: "projectId" | "driverId" | "vehicleId") => async (id: string) => {
      try {
        setM(await api<Master>("/master"));
      } catch (e) {
        setErr(errMsg(e));
      }
      setForm((x) => ({ ...x, [k]: id }));
    },
    [],
  );
  const setR = (i: number, k: keyof PlannedRoundInput, v: string) => setRounds((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addRun = () =>
    setRounds((rs) => {
      const start = rs[rs.length - 1]?.plannedEnd || roundedNow();
      return [...rs, { topic: "", plannedStart: start, plannedEnd: addMinutesHHMM(start, RUN_DEFAULT_MIN) }];
    });

  const projects = m?.projects.filter((p) => p.active) ?? [];
  const drivers = m?.drivers.filter((d) => d.active) ?? [];
  const vehicles = m?.vehicles.filter((v) => v.active) ?? [];
  const missing = m && (!drivers.length || !vehicles.length || !projects.length);
  const project = projects.find((p) => p.id === form.projectId);
  const vehicle = vehicles.find((v) => v.id === form.vehicleId);
  const autoTitle = [project?.name, vehicle?.plate].filter(Boolean).join(" · ");
  const plan = form.splitRounds && form.workDate ? resolvePlannedRounds(form.workDate, rounds) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!form.projectId || !form.driverId || !form.vehicleId) return setErr(t("err.refsRequired"));
    if (plan && !plan.ok) return setErr(f.msg(plan.error));
    const title = form.title.trim() || autoTitle;
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/sessions", { body: { ...form, title, rounds } });
      lsSet(K_LAST, { projectId: form.projectId, driverId: form.driverId, vehicleId: form.vehicleId, splitRounds: form.splitRounds } satisfies Last);
      nav(`/record/${r.id}`);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <form className="newjob" onSubmit={submit}>
      <div className="card">
        <h2>{t("nj.title")}</h2>
        {missing && <div className="alert warn">{t("nj.missingAdd")}</div>}
        <Choice label={t("col.project")} type="projects" value={form.projectId} onChange={(v) => set("projectId", v)} onAdded={added("projectId")}
          options={projects.map((p) => ({ id: p.id, main: p.name, sub: p.area }))} />
        <Choice label={t("col.driver")} type="drivers" value={form.driverId} onChange={(v) => set("driverId", v)} onAdded={added("driverId")}
          options={drivers.map((d) => ({ id: d.id, main: d.name, sub: d.team }))} />
        <Choice label={t("col.vehicle")} type="vehicles" value={form.vehicleId} onChange={(v) => set("vehicleId", v)} onAdded={added("vehicleId")}
          options={vehicles.map((v) => ({ id: v.id, main: v.plate, sub: v.equipment }))} />

        <div>
          <div className="field">
            <span>{t("nj.date")}</span>
            {editDate ? (
              <input type="date" required value={form.workDate} onChange={(e) => set("workDate", e.target.value)} />
            ) : (
              <div className="date-line">
                <b>{form.workDate === today ? `${t("c.today")} · ${f.date(form.workDate)}` : f.date(form.workDate)}</b>
                <button type="button" className="link" onClick={() => setEditDate(true)}>{t("nj.change")}</button>
              </div>
            )}
          </div>
          <label className="field">
            <span>{t("nj.jobName")}</span>
            <input maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={autoTitle ? t("nj.jobNamePh", { auto: autoTitle }) : ""} />
          </label>
        </div>
      </div>

      <div className="card">
        <label className="switch">
          <input type="checkbox" checked={form.splitRounds} onChange={(e) => set("splitRounds", e.target.checked)} />
          <span className="switch-ui" aria-hidden />
          <b>{t("nj.split")}</b>
        </label>
        <p className="muted small">{form.splitRounds ? t("nj.splitHelp") : t("nj.noSplitHelp")}</p>
        <p className="sop-note">{t("nj.sopHint")}</p>
        {form.splitRounds && (
          <>
            <div className="round-list">
              {rounds.map((r, i) => (
                <div className="round-item" key={i}>
                  <div className="row between m0">
                    <b>{t("nj.run", { n: i + 1 })}</b>
                    {rounds.length > 1 && (
                      <button type="button" className="link bad-text" onClick={() => setRounds(rounds.filter((_, j) => j !== i))}>{t("c.delete")}</button>
                    )}
                  </div>
                  <label className="field">
                    <span>{t("nj.topic")} *</span>
                    <input required value={r.topic} maxLength={200} onChange={(e) => setR(i, "topic", e.target.value)} placeholder={t("nj.topicPh")} />
                  </label>
                  <div className="two-col">
                    <label className="field"><span>{t("nj.start")} *</span><input type="time" required value={r.plannedStart} onChange={(e) => setR(i, "plannedStart", e.target.value)} /></label>
                    <label className="field"><span>{t("nj.end")} *</span><input type="time" required value={r.plannedEnd} onChange={(e) => setR(i, "plannedEnd", e.target.value)} /></label>
                  </div>
                  {plan?.ok && (
                    <div className="muted small">
                      {t("nj.planned", {
                        v: `${f.clock(plan.times[i][0], form.workDate)} – ${f.clock(plan.times[i][1], form.workDate)} (${f.dur(plan.times[i][1] - plan.times[i][0])})`,
                      })}
                    </div>
                  )}
                  {plan?.ok && plan.times[i][1] - plan.times[i][0] > SOP.MAX_LOOP_MS && (
                    <div className="warn-text small">⚠ {t("nj.over3h", { n: i + 1 })}</div>
                  )}
                </div>
              ))}
            </div>
            {plan && !plan.ok && <div className="alert warn">{f.msg(plan.error)}</div>}
            <button type="button" onClick={addRun}>{t("nj.addRun")}</button>
            <p className="muted small">{t("nj.nightHint")}</p>
          </>
        )}
      </div>

      <details className="card notes-box">
        <summary>{t("nj.notes")}</summary>
        <textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </details>

      {err && <div className="alert bad">{err}</div>}
      <div className="actionbar">
        <button className="big go" disabled={busy || !m}>
          <span className="big-label">{t("nj.submit")}</span>
          <span className="big-sub">{t("nj.calNote")}</span>
        </button>
      </div>
    </form>
  );
}
