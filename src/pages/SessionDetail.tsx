// รายละเอียดงาน: ข้อมูล, Calibration, รอบ, แผนที่ + เล่นย้อนหลัง, QC, ประวัติการทำงาน, Export
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { pathDistance } from "../../shared/geo";
import { QC_STATUSES, can, type QcStatus } from "../../shared/labels";
import { bkkHHMMSS } from "../../shared/time";
import { calComplete, type AuditEntry, type Calibration, type Master, type Session } from "../../shared/types";
import { useI18n } from "../i18n";
import { ApiError, api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeAudit } from "../lib/auditText";
import { exportGeoJson, exportGpx, exportPointsCsv } from "../lib/exporters";
import { decodeTrack, type TP, type TrackResponse } from "../lib/track";
import { SOP, analyzeJob, analyzeLoop, closedLevel, coverageLevel, pct, timeLevel, type LoopCheck } from "../lib/sop";
import CalibrationForm from "../components/CalibrationForm";
import TrackMap, { COLORS } from "../components/TrackMap";
import { CalBadge, ErrorBox, Menu, QcBadge, Spinner } from "../components/ui";

function Delay({ planned, actual }: { planned: number | null; actual: number | null }) {
  const { t } = useI18n();
  if (planned == null || actual == null) return null;
  const m = Math.round((actual - planned) / 60_000);
  if (Math.abs(m) < 5) return <span className="muted small"> {t("sd.onTime")}</span>;
  return <span className={`small ${m > 0 ? "warn-text" : "ok-text"}`}> {m > 0 ? t("sd.late", { m }) : t("sd.early", { m: -m })}</span>;
}

export default function SessionDetail() {
  const { id = "" } = useParams();
  return <DetailPage key={id} id={id} />;
}

function DetailPage({ id }: { id: string }) {
  const { user } = useAuth();
  const { lang, t, f } = useI18n();
  const nav = useNavigate();
  const [s, setS] = useState<Session | null>(null);
  const [tracks, setTracks] = useState<Record<string, TP[]>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState("");
  const [calEdit, setCalEdit] = useState<Calibration | "new" | null>(null);
  const [editInfo, setEditInfo] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [playRound, setPlayRound] = useState("");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sess, tr, au] = await Promise.all([
        api<Session>(`/sessions/${id}`),
        api<TrackResponse>(`/sessions/${id}/track`),
        api<AuditEntry[]>(`/sessions/${id}/audit`),
      ]);
      setS(sess);
      setTracks(decodeTrack(tr));
      setAudit(au);
      setErr("");
    } catch (e) {
      setErr(errMsg(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const pr = s?.rounds.find((r) => r.id === playRound) ?? s?.rounds.find((r) => tracks[r.id]?.length);
  const prPts = pr ? tracks[pr.id] ?? [] : [];
  const pp = prPts.length ? prPts[Math.min(idx, prPts.length - 1)] : null;

  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [pr?.id]);
  useEffect(() => {
    if (!playing || !prPts.length) return;
    const step = Math.max(1, Math.ceil(prPts.length / 300));
    const timer = setInterval(() => {
      setIdx((i) => {
        if (i >= prPts.length - 1) {
          setPlaying(false);
          return i;
        }
        return Math.min(prPts.length - 1, i + step);
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing, prPts.length]);

  const runLabel = useCallback(
    (seq: number, topic: string) => (s?.splitRounds ? t("step.run", { n: seq, topic }) : topic),
    [s?.splitRounds, t],
  );
  const mapTracks = useMemo(
    () =>
      (s?.rounds ?? [])
        .filter((r) => !hidden[r.id])
        .map((r) => ({
          id: r.id,
          color: COLORS[(r.seq - 1) % COLORS.length],
          label: runLabel(r.seq, r.topic),
          points: (tracks[r.id] ?? []).map((p) => [p.lat, p.lng] as [number, number]),
        })),
    [s, tracks, hidden, runLabel],
  );

  // ตรวจเส้นทางตาม SOP: ไป–กลับครบ, ปิดวง, ไม่เกิน 3 ชม.
  const sopRuns = useMemo(() => {
    const out: Record<string, LoopCheck> = {};
    for (const r of s?.rounds ?? []) if (tracks[r.id]?.length) out[r.id] = analyzeLoop(tracks[r.id]);
    return out;
  }, [s, tracks]);
  const sopJob = useMemo(() => analyzeJob((s?.rounds ?? []).map((r) => tracks[r.id] ?? [])), [s, tracks]);

  if (!s) return err ? <ErrorBox error={err} onRetry={() => void load()} /> : <Spinner />;

  const wd = s.workDate;
  const canRec = !!user && can.record(user.role);
  const locked = s.qcStatus === "PASSED";
  const editable = canRec && !locked;
  const dist = (rid: string) => pathDistance(tracks[rid] ?? []);
  const total = s.rounds.reduce((a, r) => a + dist(r.id), 0);
  const hasTrack = s.rounds.some((r) => tracks[r.id]?.length);

  async function delCal(c: Calibration) {
    if (!confirm(t("sd.calDelConfirm", { n: c.seq }))) return;
    try {
      await api(`/calibrations/${c.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      alert(errMsg(e));
    }
  }
  async function delSession() {
    if (!confirm(t("sd.deleteConfirm", { title: s!.title }))) return;
    try {
      await api(`/sessions/${s!.id}`, { method: "DELETE" });
      nav("/", { replace: true });
    } catch (e) {
      alert(errMsg(e));
    }
  }

  return (
    <>
      <div className="card">
        <div className="row between">
          <div className="clip">
            <h2 className="m0">{s.title}</h2>
            <div className="row small m0">
              <QcBadge status={s.qcStatus} />
              <CalBadge cals={s.calibrations} />
              <span className="muted">{f.date(wd)} · {t("sd.totalDist", { v: f.km(total) })} · {t("sd.runsCount", { n: s.rounds.length })}</span>
            </div>
          </div>
          <div className="row">
            {editable && <Link className="btn go" to={`/record/${s.id}`}>▶ {t("sd.record")}</Link>}
            <Menu className="export-menu" title={t("sd.export")} label={<>⬇ {t("sd.export")}</>}>
              <button type="button" className="menu-item" disabled={!hasTrack} onClick={() => exportGpx(s, tracks, lang)}>GPX</button>
              <button type="button" className="menu-item" disabled={!hasTrack} onClick={() => exportGeoJson(s, tracks)}>GeoJSON</button>
              <button type="button" className="menu-item" disabled={!hasTrack} onClick={() => exportPointsCsv(s, tracks)}>CSV ({t("sd.colPoints")})</button>
            </Menu>
          </div>
        </div>
        {editInfo ? (
          <EditInfo s={s} onDone={() => { setEditInfo(false); void load(); }} onCancel={() => setEditInfo(false)} />
        ) : (
          <div className="grid info">
            <div><label>{t("col.project")}</label>{s.project.name}<div className="muted small">{s.project.area}</div></div>
            <div><label>{t("col.driver")}</label>{s.driver.name}<div className="muted small">{s.driver.team}</div></div>
            <div><label>{t("col.vehicle")}</label>{s.vehicle.plate}<div className="muted small">{s.vehicle.equipment}</div></div>
            <div><label>{t("c.notes")}</label>{s.notes || "-"}</div>
            <div><label>{t("sd.createdBy")}</label>{s.createdBy ?? "-"}<div className="muted small">{f.dt(s.createdAt)}</div></div>
          </div>
        )}
        <div className="row">
          {editable && !editInfo && <button className="link" onClick={() => setEditInfo(true)}>{t("sd.editInfo")}</button>}
          {user && can.admin(user.role) && <button className="link bad-text" onClick={() => void delSession()}>{t("sd.delete")}</button>}
        </div>
      </div>

      {/* ---------- Calibration ---------- */}
      <div className="card">
        <div className="row between">
          <h3 className="m0">{t("col.cal")}</h3>
          {editable && calEdit === null && <button onClick={() => setCalEdit("new")}>{t("sd.calAdd")}</button>}
        </div>
        {!calComplete(s.calibrations) && <div className="alert bad">{t("sd.calMissing")}</div>}
        {s.calibrations.length > 0 && (
          <div className="table-wrap">
            <table className="cards-on-mobile">
              <thead>
                <tr>
                  <th>#</th><th>{t("sd.colType")}</th><th>{t("sd.colStart")}</th><th>{t("sd.colFinish")}</th><th>{t("sd.colDuration")}</th>
                  <th>{t("sd.colBy")}</th><th>{t("c.notes")}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {s.calibrations.map((c) => (
                  <tr key={c.id}>
                    <td data-label="#">{c.seq}</td>
                    <td data-label={t("sd.colType")}>{t(`cal.${c.kind}`)}</td>
                    <td data-label={t("sd.colStart")} className="nowrap">{f.clock(c.startedAt, wd)}</td>
                    <td data-label={t("sd.colFinish")} className="nowrap">{c.endedAt ? f.clock(c.endedAt, wd) : <span className="warn-text">{t("sd.notFinished")}</span>}</td>
                    <td data-label={t("sd.colDuration")} className="nowrap">{c.startedAt && c.endedAt ? f.dur(c.endedAt - c.startedAt) : "-"}</td>
                    <td data-label={t("sd.colBy")}>{c.createdBy ?? "-"}{c.updatedAt && <div className="muted small">{t("sd.lastEdit", { v: f.dt(c.updatedAt) })}</div>}</td>
                    <td data-label={t("c.notes")}>{c.note ?? ""}</td>
                    <td className="nowrap">
                      {editable && (
                        <>
                          <button className="link" onClick={() => setCalEdit(c)}>{t("c.edit")}</button>{" "}
                          <button className="link bad-text" onClick={() => void delCal(c)}>{t("c.delete")}</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {calEdit && (
          <CalibrationForm
            key={calEdit === "new" ? "new" : calEdit.id}
            sessionId={s.id}
            workDate={wd}
            initial={calEdit === "new" ? undefined : calEdit}
            onCancel={() => setCalEdit(null)}
            onDone={() => { setCalEdit(null); void load(); }}
          />
        )}
      </div>

      {/* ---------- รอบ ---------- */}
      <div className="card table-wrap">
        <div className="row between">
          <h3 className="m0">{s.splitRounds ? t("sd.runsTitle") : t("sd.runsTitleSingle")}</h3>
          {sopJob != null && (
            <span className={`badge ${coverageLevel(sopJob)}`} title={t("sop.checkRoundTrip")}>⇄ {t("sop.jobCoverage", { p: pct(sopJob) })}</span>
          )}
        </div>
        <table className="cards-on-mobile">
          <thead>
            <tr>
              <th>{t("sd.colShow")}</th><th>{t("sd.colRun")}</th><th>{t("sd.colTopic")}</th><th>{t("sd.colPlanned")}</th><th>{t("sd.colActual")}</th>
              <th>{t("sd.colDuration")}</th><th>{t("col.distance")}</th><th>{t("sop.colRoundTrip")}</th><th>{t("sop.colClosed")}</th>
              <th>{t("sd.colPoints")}</th><th>{t("sd.colBy")}</th>
            </tr>
          </thead>
          <tbody>
            {s.rounds.map((r) => (
              <tr key={r.id}>
                <td data-label={t("sd.colShow")}><input type="checkbox" checked={!hidden[r.id]} onChange={(e) => setHidden({ ...hidden, [r.id]: !e.target.checked })} /></td>
                <td data-label={t("sd.colRun")}><span className="swatch" style={{ background: COLORS[(r.seq - 1) % COLORS.length] }} />{r.seq}</td>
                <td data-label={t("sd.colTopic")}>{r.topic}</td>
                <td data-label={t("sd.colPlanned")} className="nowrap">{r.plannedStart ? `${f.clock(r.plannedStart, wd)} – ${f.clock(r.plannedEnd, wd)}` : "-"}</td>
                <td data-label={t("sd.colActual")}>
                  {r.startedAt ? (
                    <>
                      {f.clock(r.startedAt, wd)}<Delay planned={r.plannedStart} actual={r.startedAt} /> –{" "}
                      {r.endedAt ? <>{f.clock(r.endedAt, wd)}<Delay planned={r.plannedEnd} actual={r.endedAt} /></> : <b className="live-text">{t("home.running")}</b>}
                    </>
                  ) : (
                    <span className="muted">{t("home.notStarted")}</span>
                  )}
                </td>
                <td data-label={t("sd.colDuration")} className="nowrap">
                  {r.startedAt && r.endedAt ? (
                    <span className={timeLevel(r.endedAt - r.startedAt) === "bad" ? "bad-text" : ""} title={t("sop.checkTime")}>
                      {f.dur(r.endedAt - r.startedAt)}{r.endedAt - r.startedAt > SOP.MAX_LOOP_MS ? " ⚠" : ""}
                    </span>
                  ) : "-"}
                </td>
                <td data-label={t("col.distance")} className="nowrap">{f.km(dist(r.id))}</td>
                <td data-label={t("sop.colRoundTrip")} className="nowrap">
                  {sopRuns[r.id]?.coverage != null ? (
                    <span className={`badge ${coverageLevel(sopRuns[r.id].coverage)}`}>{pct(sopRuns[r.id].coverage!)}%</span>
                  ) : "-"}
                </td>
                <td data-label={t("sop.colClosed")} className="nowrap">
                  {sopRuns[r.id]?.startEndM != null && r.endedAt ? (
                    <span className={`badge ${closedLevel(sopRuns[r.id].startEndM)}`}>
                      {closedLevel(sopRuns[r.id].startEndM) === "ok" ? "✓ " : ""}{f.meters(sopRuns[r.id].startEndM)}
                    </span>
                  ) : "-"}
                </td>
                <td data-label={t("sd.colPoints")}>{tracks[r.id]?.length ?? 0}</td>
                <td data-label={t("sd.colBy")} className="small">{r.startedBy ?? "-"}{r.endedBy && r.endedBy !== r.startedBy ? ` / ${r.endedBy}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- แผนที่ + เล่นย้อนหลัง ---------- */}
      <div className="card">
        {hasTrack ? (
          <div className="row">
            <b>{t("sd.replay")}:</b>
            <select className="auto" value={pr?.id ?? ""} onChange={(e) => setPlayRound(e.target.value)}>
              {s.rounds.map((r) => (
                <option key={r.id} value={r.id} disabled={!tracks[r.id]?.length}>{runLabel(r.seq, r.topic)}</option>
              ))}
            </select>
            <button onClick={() => setPlaying(!playing)} disabled={!prPts.length}>{playing ? t("sd.pause") : t("sd.play")}</button>
            <input className="grow" type="range" min={0} max={Math.max(0, prPts.length - 1)} value={Math.min(idx, Math.max(0, prPts.length - 1))} onChange={(e) => setIdx(Number(e.target.value))} />
            <span className="muted small nowrap">
              {pp && `${bkkHHMMSS(pp.t)} · ${pp.spd != null ? `${f.kmh(pp.spd)} · ` : ""}±${f.meters(pp.acc)}`}
            </span>
          </div>
        ) : (
          <p className="muted">{t("sd.noGps")}</p>
        )}
        {hasTrack && <TrackMap tracks={mapTracks} marker={pp ? [pp.lat, pp.lng] : null} fitKey={`${s.id}:${hasTrack}`} />}
      </div>

      <div className="grid two">
        {user && can.qc(user.role) && (
          <QcPanel
            s={s}
            onDone={() => void load()}
            sop={hasTrack ? [
              { level: coverageLevel(sopJob), text: `${t("sop.checkRoundTrip")}${sopJob != null ? ` — ${pct(sopJob)}%` : ""}` },
              {
                level: worst(s.rounds.filter((r) => r.endedAt && sopRuns[r.id]).map((r) => closedLevel(sopRuns[r.id].startEndM))),
                text: t("sop.checkClosed"),
              },
              { level: worst(s.rounds.filter((r) => r.startedAt && r.endedAt).map((r) => timeLevel(r.endedAt! - r.startedAt!))), text: t("sop.checkTime") },
            ] : []}
          />
        )}
        <div className="card">
          <h3>{t("sd.history")}</h3>
          <ul className="timeline">
            {audit.map((e) => (
              <li key={e.id}>
                <span className="muted small nowrap">{f.dt(e.at)}</span>
                <span>{describeAudit(e, t, f, wd)}</span>
                <span className="muted small">{e.userName ?? t("c.system")}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

type Level = "ok" | "warn" | "bad";
/** ผลแย่ที่สุดของหลายรอบ (ไม่มีข้อมูล = null) */
function worst(levels: (Level | null)[]): Level | null {
  const xs = levels.filter((x): x is Level => x != null);
  if (!xs.length) return null;
  return xs.includes("bad") ? "bad" : xs.includes("warn") ? "warn" : "ok";
}

function QcPanel({ s, onDone, sop }: { s: Session; onDone: () => void; sop: { level: Level | null; text: string }[] }) {
  const { t, f } = useI18n();
  const [status, setStatus] = useState<QcStatus>(s.qcStatus);
  const [note, setNote] = useState(s.qcNote ?? "");
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const checks = [
    { ok: calComplete(s.calibrations), text: t("qcpanel.chkCal") },
    { ok: !s.calibrations.some((c) => c.startedAt != null && c.endedAt == null), text: t("qcpanel.chkNoOpenCal") },
    { ok: !s.rounds.some((r) => r.startedAt && !r.endedAt), text: t("qcpanel.chkNoRunning") },
    { ok: s.rounds.some((r) => r.endedAt), text: t("qcpanel.chkEnded") },
  ];
  async function save() {
    setErr([]);
    setBusy(true);
    try {
      await api(`/sessions/${s.id}/qc`, { method: "PATCH", body: { status, note } });
      onDone();
    } catch (e) {
      const problems = e instanceof ApiError && e.data && typeof e.data === "object" ? (e.data as { problems?: string[] }).problems : undefined;
      setErr(problems ?? [errMsg(e)]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <h3>{t("qcpanel.title")}</h3>
      <ul className="checklist">
        {checks.map((c) => <li key={c.text} className={c.ok ? "ok-text" : "bad-text"}>{c.ok ? "✓" : "✗"} {c.text}</li>)}
      </ul>
      {sop.some((x) => x.level) && (
        <div className="sop-box">
          <div className="sop-head">{t("sop.advisory")}</div>
          <ul className="checklist m0">
            {sop.filter((x) => x.level).map((x) => (
              <li key={x.text} className={x.level === "ok" ? "ok-text" : "warn-text"}>{x.level === "ok" ? "✓" : "⚠"} {x.text}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="field">
        <span>{t("qcpanel.status")}</span>
        <div className="chips" role="radiogroup" aria-label={t("qcpanel.status")}>
          {QC_STATUSES.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={k === status} className={`chip qc-chip qc-${k}${k === status ? " on" : ""}`} onClick={() => setStatus(k)}>
              {t(`qc.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>{t("c.notes")}</span>
        <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("qcpanel.notePh")} />
      </label>
      {err.length > 0 && <div className="alert bad">{err.map((x) => <div key={x}>{x}</div>)}</div>}
      <button className="pri" disabled={busy} onClick={() => void save()}>{t("qcpanel.save")}</button>
      {s.qcBy && <p className="muted small">{t("qcpanel.lastBy", { by: s.qcBy, at: f.dt(s.qcAt) })}</p>}
      {s.qcStatus === "PASSED" && (
        <p className="muted small">{t("qcpanel.lockedHint", { pending: t("qc.PENDING"), redo: t("qc.REDO") })}</p>
      )}
    </div>
  );
}

function EditInfo({ s, onDone, onCancel }: { s: Session; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [m, setM] = useState<Master | null>(null);
  const [form, setForm] = useState({ title: s.title, notes: s.notes ?? "", driverId: s.driver.id, vehicleId: s.vehicle.id, projectId: s.project.id });
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Master>("/master").then(setM).catch((e) => setErr(errMsg(e)));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/sessions/${s.id}`, { method: "PATCH", body: form });
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  const opt = <T extends { id: string; active: boolean }>(xs: T[] | undefined, cur: string, label: (x: T) => string) =>
    (xs ?? []).filter((x) => x.active || x.id === cur).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>);
  return (
    <form className="subcard" onSubmit={save}>
      <div className="grid">
        <label className="field"><span>{t("nj.jobName")}</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="field"><span>{t("col.project")}</span><select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{opt(m?.projects, form.projectId, (p) => p.name)}</select></label>
        <label className="field"><span>{t("col.driver")}</span><select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>{opt(m?.drivers, form.driverId, (d) => d.name)}</select></label>
        <label className="field"><span>{t("col.vehicle")}</span><select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>{opt(m?.vehicles, form.vehicleId, (v) => v.plate)}</select></label>
      </div>
      <label className="field"><span>{t("c.notes")}</span><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      {err && <div className="alert bad">{err}</div>}
      <div className="row"><button className="pri">{t("c.save")}</button><button type="button" onClick={onCancel}>{t("c.cancel")}</button></div>
    </form>
  );
}
