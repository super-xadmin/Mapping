// หน้าแรก: ปุ่มเริ่มงานใหม่ + งานวันนี้ (ทำต่อได้ในแตะเดียว) + ประวัติงานพร้อมตัวกรองแบบแตะ
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { STAGES, can, isLockedStage } from "../../shared/labels";
import { bkkDate } from "../../shared/time";
import type { Master, Session, SessionList } from "../../shared/types";
import { useI18n, type Formatters, type TFn } from "../i18n";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { exportSummaryCsv } from "../lib/exporters";
import { CalBadge, ErrorBox, StageBadge, useMedia } from "../components/ui";

const PAGE = 50;
const FILTER_KEYS = ["from", "to", "projectId", "driverId", "vehicleId", "stage", "cal", "q"] as const;
const CHIPS = [
  { id: "all", key: "c.all", stage: "", cal: "" },
  { id: "pending", key: "home.chipPending", stage: "submitted", cal: "" },
  { id: "redo", key: "home.chipRedo", stage: "returned", cal: "" },
  { id: "nocal", key: "home.chipNoCal", stage: "", cal: "missing" },
] as const;

/** ใครส่ง / ใครตรวจ ล่าสุด (ไว้ตามหาคนรับผิดชอบ) */
function flowLine(s: Session, t: TFn, f: Formatters): string {
  if (s.stage === "submitted") return t("home.submittedBy", { by: s.submittedBy ?? "-", at: f.dt(s.submittedAt) });
  if (s.stage === "passed") return t("home.passedBy", { by: s.qcBy ?? "-", at: f.dt(s.qcAt) });
  if (s.stage === "returned") return t("home.returnedBy", { by: s.qcBy ?? "-", note: s.qcNote ?? "" });
  return "";
}

/** สรุปความคืบหน้าของรอบ */
function progress(s: Session) {
  const done = s.rounds.filter((r) => r.endedAt != null).length;
  const running = s.rounds.some((r) => r.startedAt != null && r.endedAt == null);
  const km = s.rounds.reduce((a, r) => a + r.distanceM, 0);
  return { done, total: s.rounds.length, running, km };
}

function JobCard({ s, canRec, big = false }: { s: Session; canRec: boolean; big?: boolean }) {
  const { t, f } = useI18n();
  const nav = useNavigate();
  const p = progress(s);
  const recordable = canRec && !isLockedStage(s.stage);
  const who = flowLine(s, t, f);
  return (
    <div className={`job-card${big ? " big-card" : ""}`} onClick={() => nav(`/sessions/${s.id}`)} role="link" tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && nav(`/sessions/${s.id}`)}>
      <div className="row between m0">
        <span className="muted small">{f.date(s.workDate)}</span>
        <StageBadge stage={s.stage} />
      </div>
      <Link to={`/sessions/${s.id}`} className="job-title" onClick={(e) => e.stopPropagation()}>{s.title}</Link>
      <div className="muted small">
        {s.project.name}{s.project.area ? ` (${s.project.area})` : ""} · {s.driver.name} · {s.vehicle.plate}
      </div>
      <div className="row m0 small">
        <CalBadge cals={s.calibrations} />
        {p.running ? <span className="badge live-badge">● {t("home.running")}</span> : null}
        <span className="muted">{t("home.runsDone", { done: p.done, total: p.total })} · {f.km(p.km)}</span>
      </div>
      {who && <div className={`small flow-line ${s.stage === "returned" ? "bad-text" : "muted"}`}>{who}</div>}
      {s.splitRounds && s.rounds.length > 1 && (
        <ul className="mini-runs">
          {s.rounds.map((r) => (
            <li key={r.id}>
              {r.seq}. {r.topic}:{" "}
              {!r.startedAt ? (
                <span className="muted">{t("home.notStarted")}</span>
              ) : (
                <>{f.clock(r.startedAt, s.workDate)}–{r.endedAt ? f.clock(r.endedAt, s.workDate) : <b className="live-text">{t("home.running")}</b>}</>
              )}
            </li>
          ))}
        </ul>
      )}
      {recordable && big && (
        <Link className="btn go wide" to={`/record/${s.id}`} onClick={(e) => e.stopPropagation()}>
          ▶ {t("home.continue")}
        </Link>
      )}
      {recordable && !big && (
        <Link className="small" to={`/record/${s.id}`} onClick={(e) => e.stopPropagation()}>{t("home.continue")} →</Link>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { lang, t, f } = useI18n();
  const mobile = useMedia("(max-width: 720px)");
  const [sp, setSp] = useSearchParams();
  const [master, setMaster] = useState<Master | null>(null);
  const [list, setList] = useState<Session[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const query = sp.toString();
  const canRec = !!user && can.record(user.role);

  useEffect(() => {
    api<Master>("/master").then(setMaster).catch(() => {});
  }, []);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setErr("");
      try {
        const params = new URLSearchParams(query);
        params.set("limit", String(PAGE));
        params.set("offset", String(offset));
        const r = await api<SessionList>(`/sessions?${params}`);
        setList((old) => (offset ? [...old, ...r.sessions] : r.sessions));
        setHasMore(r.hasMore);
      } catch (e) {
        setErr(errMsg(e));
      } finally {
        setLoading(false);
      }
    },
    [query],
  );
  useEffect(() => {
    void load(0);
  }, [load]);

  function applyFilters(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = String(fd.get(k) ?? "").trim();
      if (v) next.set(k, v);
    }
    setSp(next);
  }
  function chip(c: (typeof CHIPS)[number]) {
    const next = new URLSearchParams(sp);
    next.delete("qc");
    next.delete("stage");
    next.delete("cal");
    if (c.stage) next.set("stage", c.stage);
    if (c.cal) next.set("cal", c.cal);
    setSp(next);
  }

  const fv = (k: string) => sp.get(k) ?? "";
  const activeChip = CHIPS.find((c) => c.stage === fv("stage") && c.cal === fv("cal"))?.id ?? "";
  const advanced = FILTER_KEYS.filter((k) => k !== "stage" && k !== "cal" && sp.get(k)).length;
  const filtered = FILTER_KEYS.some((k) => sp.get(k));
  const today = bkkDate();
  const todays = filtered ? [] : list.filter((s) => s.workDate === today);
  const history = filtered ? list : list.filter((s) => s.workDate !== today);
  const inactive = t("c.inactiveSuffix");

  return (
    <>
      {canRec && (
        <Link className="btn go start-btn" to="/sessions/new">＋ {t("home.start")}</Link>
      )}

      {todays.length > 0 && (
        <section>
          <h2 className="section-title">{t("home.today")} · {f.date(today)}</h2>
          <div className="job-grid">
            {todays.map((s) => <JobCard key={s.id} s={s} canRec={canRec} big />)}
          </div>
        </section>
      )}

      <section>
        <div className="row between">
          <h2 className="section-title m0">{t("home.history")}</h2>
          <button className="small-btn" disabled={!list.length} onClick={() => exportSummaryCsv(list, lang)}>⬇ {t("home.exportCsv")}</button>
        </div>
        <div className="chips scroll-x">
          {CHIPS.map((c) => (
            <button key={c.id} type="button" className={`chip${activeChip === c.id ? " on" : ""}`} aria-pressed={activeChip === c.id} onClick={() => chip(c)}>
              {t(c.key)}
            </button>
          ))}
          <button type="button" className={`chip${showFilters || advanced ? " on-outline" : ""}`} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
            🔍 {t("home.filters")}{advanced ? ` (${advanced})` : ""}
          </button>
        </div>

        {showFilters && (
          <form className="card filters" onSubmit={applyFilters} key={query}>
            <label className="field"><span>{t("filter.from")}</span><input type="date" name="from" defaultValue={fv("from")} /></label>
            <label className="field"><span>{t("filter.to")}</span><input type="date" name="to" defaultValue={fv("to")} /></label>
            <label className="field">
              <span>{t("col.project")}</span>
              <select name="projectId" defaultValue={fv("projectId")}>
                <option value="">{t("c.all")}</option>
                {master?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : inactive}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("col.driver")}</span>
              <select name="driverId" defaultValue={fv("driverId")}>
                <option value="">{t("c.all")}</option>
                {master?.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.active ? "" : inactive}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("col.vehicle")}</span>
              <select name="vehicleId" defaultValue={fv("vehicleId")}>
                <option value="">{t("c.all")}</option>
                {master?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.active ? "" : inactive}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("filter.qc")}</span>
              <select name="stage" defaultValue={fv("stage")}>
                <option value="">{t("c.all")}</option>
                {STAGES.map((k) => <option key={k} value={k}>{t(`stage.${k}`)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("filter.cal")}</span>
              <select name="cal" defaultValue={fv("cal")}>
                <option value="">{t("c.all")}</option>
                <option value="ok">{t("filter.calOk")}</option>
                <option value="missing">{t("filter.calMissing")}</option>
              </select>
            </label>
            <label className="field full"><span>{t("filter.q")}</span><input name="q" defaultValue={fv("q")} /></label>
            <div className="row end full">
              <button className="pri">{t("filter.apply")}</button>
              <button type="button" onClick={() => setSp(new URLSearchParams())}>{t("filter.clear")}</button>
            </div>
          </form>
        )}

        <ErrorBox error={err} onRetry={() => void load(0)} />
        {!loading && !history.length && !todays.length && (
          <div className="card muted center">{filtered ? t("home.emptyFiltered") : t("home.empty")}</div>
        )}

        {mobile ? (
          <div className="job-list">
            {history.map((s) => <JobCard key={s.id} s={s} canRec={canRec} />)}
          </div>
        ) : (
          history.length > 0 && (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("col.date")}</th><th>{t("col.job")}</th><th>{t("col.project")}</th><th>{t("col.driver")}</th><th>{t("col.vehicle")}</th>
                    <th>{t("col.cal")}</th><th>{t("col.runs")}</th><th>{t("col.distance")}</th><th>{t("col.qc")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((s) => (
                    <tr key={s.id}>
                      <td className="nowrap">{f.date(s.workDate)}</td>
                      <td>
                        <Link to={`/sessions/${s.id}`}><b>{s.title}</b></Link>
                        {canRec && !isLockedStage(s.stage) && (
                          <div><Link className="small" to={`/record/${s.id}`}>{t("home.continue")} →</Link></div>
                        )}
                      </td>
                      <td>{s.project.name}<div className="muted small">{s.project.area}</div></td>
                      <td>{s.driver.name}<div className="muted small">{s.driver.team}</div></td>
                      <td>{s.vehicle.plate}<div className="muted small">{s.vehicle.equipment}</div></td>
                      <td>
                        {s.calibrations.length ? (
                          s.calibrations.map((c) => (
                            <div key={c.id} className="small nowrap">
                              {t(`cal.${c.kind}`)} {f.clock(c.startedAt, s.workDate)}–{c.endedAt ? f.clock(c.endedAt, s.workDate) : "…"}
                            </div>
                          ))
                        ) : (
                          <CalBadge cals={s.calibrations} />
                        )}
                      </td>
                      <td>
                        {s.rounds.map((r) => (
                          <div key={r.id} className="small">
                            {s.splitRounds ? `${r.seq}. ${r.topic}: ` : ""}
                            {!r.startedAt ? (
                              <span className="muted">{t("home.notStarted")}</span>
                            ) : (
                              <>
                                {f.clock(r.startedAt, s.workDate)}–
                                {r.endedAt ? f.clock(r.endedAt, s.workDate) : <b className="live-text">{t("home.running")}</b>}
                              </>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="nowrap">{f.km(s.rounds.reduce((a, r) => a + r.distanceM, 0))}</td>
                      <td>
                        <StageBadge stage={s.stage} />
                        {flowLine(s, t, f) && <div className={`small ${s.stage === "returned" ? "bad-text" : "muted"}`}>{flowLine(s, t, f)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {loading && <div className="muted center pad">{t("c.loading")}</div>}
        {hasMore && !loading && (
          <div className="center pad"><button onClick={() => void load(list.length)}>{t("c.loadMore")}</button></div>
        )}
      </section>
    </>
  );
}
