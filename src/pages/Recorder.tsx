// หน้าบันทึกภาคสนาม (มือถือ): ทำทีละขั้นด้วยปุ่มใหญ่ปุ่มเดียวด้านล่าง
// Calibration ก่อนวิ่ง → รอบ 1 → รอบ 2 … → Calibration หลังวิ่ง → เสร็จ (ทำงานได้แม้ออฟไลน์)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { haversine } from "../../shared/geo";
import { can, type CalKind } from "../../shared/labels";
import { fmtElapsed } from "../../shared/time";
import type { Calibration, Round, Session } from "../../shared/types";
import { useI18n } from "../i18n";
import { ApiError, api, errMsg, isOffline } from "../lib/api";
import { useAuth } from "../lib/auth";
import { pendingOps, recentlySent, syncEvents, syncStore } from "../lib/outbox";
import { MAX_ACCURACY_M, liveTrack, recStore, recorder, type ActiveCal } from "../lib/recorder";
import { dropSession, finishedKey, readSession, saveSession } from "../lib/sessionCache";
import { lsGet, lsSet, useStore } from "../lib/store";
import { applyPending } from "../lib/track";
import { SOP, analyzeLoop, coverageLevel, pct, timeLevel } from "../lib/sop";
import CalibrationForm from "../components/CalibrationForm";
import SyncBar, { useOnline } from "../components/SyncBar";
import TrackMap from "../components/TrackMap";
import { CalBadge, ErrorBox, Menu, Pending, QcBadge, Spinner, useConfirmTap, useNow, useTapGuard } from "../components/ui";

const K_MAP = "mlog:showMap";
/** มีจุด GPS ใหม่ภายในเวลานี้ = น่าจะกำลังบันทึกอยู่บนเครื่องอื่น */
const LIVE_ELSEWHERE_MS = 2 * 60_000;

/** ขั้นต่อไปที่ต้องทำ (ตัดสินจากข้อมูลงาน + สถานะในเครื่อง) */
type Next =
  | { a: "locked" }
  | { a: "readonly" }
  | { a: "endRun"; roundId: string; seq: number | null }
  | { a: "endCal"; cal: Calibration; local: boolean }
  | { a: "orphan"; round: Round }
  | { a: "busy" }
  | { a: "preCal"; round: Round }
  | { a: "startRun"; round: Round }
  | { a: "postCal" }
  | { a: "done" };

type Ctx = {
  canRec: boolean;
  activeRoundId: string | null;
  /** Calibration ที่เริ่มบนเครื่องนี้ (อาจยังไม่ถึงเซิร์ฟเวอร์ หรือเซิร์ฟเวอร์ไม่รับเพราะงานถูกล็อก) */
  localCal: ActiveCal | null;
  busy: boolean;
  finishedAt: number | null;
  pick: string | null;
};

function nextAction(s: Session, x: Ctx): Next {
  // สิ่งที่กำลังบันทึกอยู่บนเครื่องนี้ต้องหยุดได้เสมอ (แม้งานจะถูกล็อกหรือสิทธิ์ถูกเปลี่ยนระหว่างทาง)
  if (x.activeRoundId) return { a: "endRun", roundId: x.activeRoundId, seq: s.rounds.find((r) => r.id === x.activeRoundId)?.seq ?? null };
  if (x.localCal) {
    const c = s.calibrations.find((c) => c.id === x.localCal!.calId);
    if (!c) {
      const { calId, kind, startedAt } = x.localCal;
      const cal: Calibration = { id: calId, seq: 0, kind, startedAt, endedAt: null, note: null, createdBy: null, createdAt: startedAt, updatedAt: null };
      return { a: "endCal", cal, local: true };
    }
    if (c.endedAt == null) return { a: "endCal", cal: c, local: true };
  }
  if (s.qcStatus === "PASSED") return { a: "locked" };
  if (!x.canRec) return { a: "readonly" };
  const openCal = s.calibrations.find((c) => c.startedAt != null && c.endedAt == null);
  if (openCal) return { a: "endCal", cal: openCal, local: false };
  const orphan = s.rounds.find((r) => r.startedAt != null && r.endedAt == null);
  if (orphan) return { a: "orphan", round: orphan };
  if (x.busy) return { a: "busy" };
  const todo = s.rounds.filter((r) => r.startedAt == null);
  if (todo.length) {
    const round = todo.find((r) => r.id === x.pick) ?? todo[0];
    const anyStarted = s.rounds.some((r) => r.startedAt != null);
    return !s.calibrations.length && !anyStarted ? { a: "preCal", round } : { a: "startRun", round };
  }
  // "จบงานโดยไม่ทำ Calibration หลังวิ่ง" ใช้ได้จนกว่าจะเริ่มรอบใหม่หลังจากนั้น
  const finished = x.finishedAt != null && !s.rounds.some((r) => (r.startedAt ?? 0) > x.finishedAt!);
  if (!finished && !s.calibrations.some((c) => c.kind === "post")) return { a: "postCal" };
  return { a: "done" };
}

/** ประเภท Calibration ที่เหมาะกับช่วงนี้ของวัน */
function suggestKind(s: Session): CalKind {
  if (!s.rounds.some((r) => r.startedAt != null)) return "pre";
  return s.rounds.every((r) => r.endedAt != null) ? "post" : "mid";
}

/** รหัสของขั้นปัจจุบัน — เปลี่ยนเมื่อไหร่ ปุ่มใหญ่จะไม่รับการแตะช่วงสั้น ๆ (การเลือกรอบอื่นไม่นับว่าเปลี่ยนขั้น) */
const stepKeyOf = (n: Next) =>
  n.a === "endRun" ? `endRun:${n.roundId}` : n.a === "endCal" ? `endCal:${n.cal.id}` : n.a === "orphan" ? `orphan:${n.round.id}` : n.a;

type StepIcon = "done" | "live" | "next" | "todo" | "warn";
type Step = { key: string; icon: StepIcon; title: string; sub?: string; pending?: boolean; onPick?: () => void; picked?: boolean };

/** ปุ่มใหญ่ด้านล่าง: ไม่รับการแตะช่วงสั้น ๆ หลังเปลี่ยนเป็นขั้นใหม่ (กันแตะเบิ้ลแล้วข้ามขั้น) */
function BigButton(p: {
  stepKey: string; tone: string; label: string; sub?: string; armed?: boolean; armedNote?: string; disabled?: boolean; onClick: () => void;
}) {
  const { t } = useI18n();
  const guard = useTapGuard(p.stepKey);
  return (
    <button type="button" className={`big ${p.tone}${p.armed ? " armed" : ""}`} disabled={p.disabled} onClick={guard(p.onClick)}>
      <span className="big-label">{p.armed ? t("c.tapToConfirm") : p.label}</span>
      {(p.sub || p.armed) && <span className="big-sub">{p.armed ? p.label : p.sub}</span>}
      {p.armed && p.armedNote && <span className="big-note">⚠ {p.armedNote}</span>}
    </button>
  );
}

/** เปลี่ยนงาน (เช่น กด "ไปที่งานนั้น") = เริ่มหน้าใหม่ทั้งหมด ไม่ให้สถานะของงานเดิมค้าง */
export default function Recorder() {
  const { id = "" } = useParams();
  return <RecorderPage key={id} id={id} />;
}

function RecorderPage({ id }: { id: string }) {
  const { user } = useAuth();
  const { t, f } = useI18n();
  const nav = useNavigate();
  const rec = useStore(recStore);
  const sync = useStore(syncStore);
  const online = useOnline();
  const cached = useMemo(() => readSession(id), [id]);
  const [server, setServer] = useState<Session | null>(cached?.s ?? null);
  const [fromCache, setFromCache] = useState(false);
  const [err, setErr] = useState("");
  const [panel, setPanel] = useState<null | "manualCal" | "addRun" | "sync">(null);
  const [pick, setPick] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(() => lsGet<boolean>(K_MAP, true));
  const [finishedAt, setFinishedAt] = useState<number | null>(() => {
    const v = lsGet<unknown>(finishedKey(id), null);
    return typeof v === "number" ? v : v === true ? 1 : null; // true = ค่าจากเวอร์ชันก่อน
  });
  const [newTopic, setNewTopic] = useState("");
  const confirmTap = useConfirmTap();
  const fetchedAt = useRef(cached?.at ?? 0); // เวลาที่เริ่มโหลดข้อมูลชุดที่แสดงอยู่

  /** โหลดข้อมูลล่าสุด (คืนค่า null ถ้าโหลดไม่ได้) — ข้ามผลของคำขอเก่าที่ตอบกลับช้ากว่าคำขอใหม่ */
  const load = useCallback(async (): Promise<Session | null> => {
    const startedAt = Date.now();
    try {
      const s = await api<Session>(`/sessions/${id}`);
      if (startedAt < fetchedAt.current) return s;
      fetchedAt.current = startedAt;
      setServer(s);
      setFromCache(false);
      setErr("");
      saveSession(id, s, startedAt);
      return s;
    } catch (e) {
      if (isOffline(e)) setFromCache(true);
      else {
        setErr(errMsg(e));
        // งานถูกลบแล้ว: เลิกบันทึกในเครื่อง (ส่งขึ้นไปก็ไม่มีที่เก็บ)
        if (e instanceof ApiError && e.status === 404) {
          const r = recStore.get();
          if (r.active?.sessionId === id) recorder.forgetRound(r.active.roundId);
          if (r.cal?.sessionId === id) recorder.forgetCal(r.cal.calId);
          dropSession(id);
          setServer(null);
        }
      }
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
    const onSynced = (e: Event) => {
      if ((e as CustomEvent<string[]>).detail.includes(id)) void load();
    };
    syncEvents.addEventListener("synced", onSynced);
    const refresh = setInterval(() => navigator.onLine && void load(), 60_000); // รับการเปลี่ยนแปลงจากเครื่องอื่น
    return () => {
      syncEvents.removeEventListener("synced", onSynced);
      clearInterval(refresh);
    };
  }, [id, load]);

  const activeHere = rec.active?.sessionId === id ? rec.active : null;
  const activeElsewhere = rec.active && rec.active.sessionId !== id ? rec.active : null;
  const calElsewhere = rec.cal && rec.cal.sessionId !== id ? rec.cal : null;
  const localCal = rec.cal?.sessionId === id ? rec.cal : null;

  // เปิด GPS เฉพาะเมื่อบันทึกได้ (ไม่ขอสิทธิ์ตำแหน่งในงานที่ล็อกแล้ว หรือบัญชีดูอย่างเดียว)
  const wantGps = !!activeHere || (!!server && !!user && can.record(user.role) && server.qcStatus !== "PASSED");
  useEffect(() => (wantGps ? recorder.attachView() : undefined), [wantGps]);

  // Calibration ที่เริ่มในเครื่องนี้ แต่ถูกกดเสร็จ/ลบจากที่อื่นแล้ว → เลิกแสดงว่ากำลังทำ
  useEffect(() => {
    if (!server || !localCal) return;
    const c = server.calibrations.find((x) => x.id === localCal.calId);
    if (c?.endedAt != null) return recorder.forgetCal(localCal.calId);
    // ถูกลบ: ไม่มีในข้อมูลที่โหลดหลังเริ่มเกิน 30 วินาที และไม่มีรายการค้างส่ง/เพิ่งส่ง
    const mine = (o: { k: string; calId?: string }) => (o.k === "cal.start" || o.k === "cal.end") && o.calId === localCal.calId;
    const inFlight = pendingOps(id).some(mine) || recentlySent(id, fetchedAt.current).some(mine);
    if (!c && !inFlight && fetchedAt.current > localCal.startedAt + 30_000) recorder.forgetCal(localCal.calId);
  }, [server, localCal, id]);

  // รอบที่บันทึกอยู่ในเครื่องนี้ ถูกกดจบจากเครื่องอื่นแล้ว → หยุดบันทึก
  useEffect(() => {
    if (!server || fromCache || !activeHere) return;
    const r = server.rounds.find((x) => x.id === activeHere.roundId);
    if (r?.endedAt == null || fetchedAt.current <= activeHere.startedAt) return;
    if (!pendingOps(id).some((o) => o.k === "round.end" && o.roundId === r.id)) recorder.forgetRound(r.id);
  }, [server, fromCache, activeHere, id]);

  // ข้อมูลเซิร์ฟเวอร์ + รายการที่เพิ่งส่ง (หลังโหลดชุดนี้) + รายการที่ยังรอส่ง
  // ไม่นับก้อนพิกัดที่กำลังเก็บ (ไม่งั้นรอบที่กำลังวิ่งจะขึ้น "รอซิงก์" ตลอด)
  const s = server ? applyPending(applyPending(server, recentlySent(id, fetchedAt.current), false), pendingOps(id, false)) : null;
  const openCal = s?.calibrations.find((c) => c.startedAt != null && c.endedAt == null) ?? null;
  const now = useNow(activeHere || openCal || localCal ? 1000 : 30_000);

  const mapTracks = useMemo(
    () => [{ id: "live", label: t("rec.liveTrack"), color: "#1C8CC9", points: activeHere ? liveTrack.slice() : [] }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rec.trackVersion, activeHere?.roundId, t],
  );

  // ตรวจเส้นทางตาม SOP ของรอบที่กำลังวิ่ง — ไป–กลับ คำนวณใหม่ทุก ~5 จุด (และทันทีตอนกดจบรอบ)
  const armedEnd = !!confirmTap.armed?.startsWith("endRun:");
  const sopLive = useMemo(
    () => (activeHere && liveTrack.length > 1 ? analyzeLoop(liveTrack.map(([lat, lng]) => ({ lat, lng }))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(rec.trackVersion / 5), activeHere?.roundId, armedEnd],
  );
  // ระยะจากจุดเริ่มถึงจุดล่าสุด: คำนวณทุกจุด (ใช้ตัดสินว่ากลับถึงจุดเริ่มหรือยัง)
  const lastPt = liveTrack[liveTrack.length - 1];
  const fromStartM = activeHere && liveTrack.length > 1 ? haversine(liveTrack[0][0], liveTrack[0][1], lastPt[0], lastPt[1]) : null;

  if (!s) return err ? <ErrorBox error={err} onRetry={() => void load()} /> : <Spinner />;

  const wd = s.workDate;
  const canRec = !!user && can.record(user.role);
  const editable = canRec && s.qcStatus !== "PASSED";
  const busy = !!activeElsewhere || !!calElsewhere;
  const next = nextAction(s, { canRec, activeRoundId: activeHere?.roundId ?? null, localCal, busy, finishedAt, pick });
  const idle = editable && !activeHere && !openCal && !localCal && !busy;
  const runName = (seq: number | null, topic: string) => (s.splitRounds && seq != null ? t("step.run", { n: seq, topic }) : topic);
  const planText = (r: Round) => (r.plannedStart ? t("step.planned", { v: `${f.clock(r.plannedStart, wd)}–${f.clock(r.plannedEnd, wd)}` }) : "");
  const runLabel = (r: Round) => (s.splitRounds ? `${s.title} · #${r.seq} ${r.topic}` : s.title);
  const pos = rec.pos;
  const dist = (m: number) => (m < 1000 ? f.meters(m) : f.km(m));
  const runElapsed = activeHere ? now - activeHere.startedAt : 0;
  // สิ่งที่ยังไม่ครบตาม SOP (แสดงตอนกดจบรอบ — เตือนเฉย ๆ ไม่บังคับ)
  const sopIssues: string[] = [];
  if (sopLive) {
    if (sopLive.coverage != null && sopLive.coverage < SOP.COVERAGE_OK) sopIssues.push(t("sop.roundTrip", { p: pct(sopLive.coverage) }));
    if (fromStartM != null && fromStartM > SOP.CLOSE_OK_M) sopIssues.push(t("sop.fromStart", { d: dist(fromStartM) }));
  }
  if (runElapsed > SOP.MAX_LOOP_MS) sopIssues.push(t("sop.loopTime", { e: fmtElapsed(runElapsed) }));

  // ---------- การกระทำ ----------
  function startCal(kind: CalKind) {
    if (activeHere) return;
    if (calElsewhere) return alert(t("rec.calElsewhere"));
    recorder.startCal(id, kind);
    setPanel(null);
  }
  function startRun(r: Round) {
    if (activeElsewhere) return alert(t("rec.elsewhere", { label: activeElsewhere.label }));
    recorder.startRound(id, r.id, runLabel(r));
    setPick(null);
    setPanel(null);
  }
  /** หยุดรอบ/Calibration ของเครื่องนี้ — งานที่ล็อกแล้วหรือบันทึกไม่ได้ หยุดในเครื่องอย่างเดียว (เซิร์ฟเวอร์ไม่รับแล้ว) */
  function stopRun(roundId: string) {
    if (editable) recorder.endRound();
    else recorder.forgetRound(roundId);
  }
  function stopCal(cal: Calibration) {
    if (editable) recorder.endCal(id, cal.id);
    else recorder.forgetCal(cal.id);
  }
  /** บันทึก GPS ต่อในเครื่องนี้ — โหลดข้อมูลล่าสุดก่อน เผื่อรอบนี้ถูกจบไปแล้วจากเครื่องอื่น */
  async function resume(r: Round) {
    if (activeElsewhere) return alert(t("rec.elsewhere", { label: activeElsewhere.label }));
    const fresh = await load();
    const latest = fresh?.rounds.find((x) => x.id === r.id);
    if (fresh && (!latest || latest.endedAt != null || latest.startedAt == null)) return;
    if (recStore.get().active) return;
    recorder.resumeRound(id, r.id, latest?.startedAt ?? r.startedAt!, runLabel(r));
  }
  function finishDay() {
    const at = Date.now();
    lsSet(finishedKey(id), at);
    setFinishedAt(at);
  }
  function addRun(e: React.FormEvent) {
    e.preventDefault();
    const topic = newTopic.trim();
    if (!topic) return;
    recorder.addRound(id, topic);
    setNewTopic("");
    setPanel(null);
  }
  function toggleMap() {
    lsSet(K_MAP, !showMap);
    setShowMap(!showMap);
  }

  // ---------- ขั้นตอนทั้งหมดของงาน ----------
  const anyStarted = s.rounds.some((r) => r.startedAt != null);
  const steps: Step[] = [];
  if (!s.calibrations.length) {
    steps.push(
      anyStarted
        ? { key: "precal", icon: "warn", title: t("step.preCal"), sub: t("step.skipped") }
        : { key: "precal", icon: next.a === "preCal" ? "next" : "todo", title: t("step.preCal"), sub: next.a === "preCal" ? t("step.next") : undefined },
    );
  }
  const timed: { at: number; step: Step }[] = [];
  for (const c of s.calibrations) {
    const st = c.startedAt ?? c.createdAt;
    timed.push({
      at: st,
      step: {
        key: c.id,
        icon: c.endedAt ? "done" : "live",
        title: t("step.cal", { kind: t(`cal.${c.kind}`) }),
        sub: c.endedAt
          ? `${f.clock(c.startedAt, wd)}–${f.clock(c.endedAt, wd)} (${f.dur(c.endedAt - st)})`
          : `${f.clock(c.startedAt, wd)}– · ${fmtElapsed(now - st)}${c.id === localCal?.calId ? "" : ` · ${t("step.otherDevice")}`}`,
        pending: c.pending,
      },
    });
  }
  for (const r of s.rounds) {
    if (r.startedAt == null) continue;
    const isLiveHere = activeHere?.roundId === r.id;
    const extra = [r.distanceM ? f.km(r.distanceM) : "", r.pointCount ? t("step.points", { n: r.pointCount }) : ""].filter(Boolean).join(" · ");
    timed.push({
      at: r.startedAt,
      step: {
        key: r.id,
        icon: r.endedAt ? "done" : "live",
        title: runName(r.seq, r.topic),
        sub: r.endedAt
          ? `${f.clock(r.startedAt, wd)}–${f.clock(r.endedAt, wd)} (${f.dur(r.endedAt - r.startedAt)})${extra ? ` · ${extra}` : ""}`
          : isLiveHere
            ? `${f.clock(r.startedAt, wd)}– · ${fmtElapsed(now - r.startedAt)}`
            : t("step.runningOther"),
        pending: r.pending,
      },
    });
  }
  timed.sort((a, b) => a.at - b.at).forEach((x) => steps.push(x.step));
  const todo = s.rounds.filter((r) => r.startedAt == null);
  const chosen = next.a === "startRun" || next.a === "preCal" ? next.round.id : null;
  const canPick = s.splitRounds && todo.length > 1 && next.a === "startRun";
  for (const r of todo) {
    steps.push({
      key: r.id,
      icon: r.id === chosen && next.a === "startRun" ? "next" : "todo",
      title: runName(r.seq, r.topic),
      sub: [planText(r) || t("step.notStarted"), r.id === chosen && next.a === "startRun" ? t("step.next") : ""].filter(Boolean).join(" · "),
      pending: r.pending,
      picked: canPick && r.id === chosen,
      onPick: canPick ? () => setPick(r.id) : undefined,
    });
  }
  if (!s.calibrations.some((c) => c.kind === "post") && next.a !== "done") {
    steps.push({
      key: "postcal",
      icon: next.a === "postCal" ? "next" : "todo",
      title: t("step.postCal"),
      sub: next.a === "postCal" ? `${t("step.next")} · ${t("step.optional")}` : t("step.optional"),
    });
  }

  // ---------- ปุ่มหลัก + ปุ่มรอง ----------
  const stepKey = stepKeyOf(next);
  let primary: ReactNode = null;
  const secondary: ReactNode[] = [];
  const sec = (key: string, label: string, action: () => void, confirm = false) => (
    <button
      key={key}
      type="button"
      className={`sec${confirm && confirmTap.armed === key ? " armed" : ""}`}
      onClick={() => (confirm ? confirmTap.tap(key, action) : action())}
    >
      {confirm && confirmTap.armed === key ? `${t("c.tapToConfirm")} — ${label}` : label}
    </button>
  );
  const detailsBtn = (
    <Link className="big neutral" to={`/sessions/${id}`}>
      <span className="big-label">{t("act.toDetails")}</span>
    </Link>
  );
  // รอบที่เริ่มไว้แล้วแต่ไม่ได้บันทึกบนเครื่องนี้: ถ้ามีจุดใหม่เมื่อไม่นานมานี้ แปลว่าอีกเครื่องยังบันทึกอยู่
  const orphanLast = next.a === "orphan" ? (next.round.lastT ?? next.round.startedAt ?? 0) : 0;
  const liveElsewhere = next.a === "orphan" && now - orphanLast < LIVE_ELSEWHERE_MS;

  switch (next.a) {
    case "locked":
    case "readonly":
      primary = detailsBtn;
      break;
    case "endRun":
      primary = (
        <BigButton
          stepKey={stepKey}
          tone="stop"
          armed={confirmTap.armed === stepKey}
          armedNote={sopIssues.length ? t("sop.endWarn", { issues: sopIssues.join(", ") }) : undefined}
          label={s.splitRounds && next.seq != null ? t("act.endRun", { n: next.seq }) : t("act.endSingle")}
          sub={`${fmtElapsed(now - activeHere!.startedAt)} · ${f.km(rec.dist)}`}
          onClick={() => confirmTap.tap(stepKey, () => stopRun(next.roundId))}
        />
      );
      break;
    case "endCal": {
      const st = next.cal.startedAt ?? now;
      const when = t("act.startedAt", { t: f.clock(st, wd), e: fmtElapsed(now - st) });
      primary = (
        <BigButton
          stepKey={stepKey}
          tone="cal-stop"
          // Calibration ที่เริ่มจากเครื่องอื่น: ต้องแตะยืนยัน 2 ครั้ง
          armed={!next.local && confirmTap.armed === stepKey}
          label={t("act.endCal")}
          sub={next.local ? when : `${t("step.otherDevice")} · ${when}`}
          onClick={() => (next.local ? stopCal(next.cal) : confirmTap.tap(stepKey, () => stopCal(next.cal)))}
        />
      );
      break;
    }
    case "orphan": {
      const resumeBtn = (asPrimary: boolean) =>
        asPrimary ? (
          <BigButton
            key="resume"
            stepKey={stepKey}
            tone="go"
            armed={confirmTap.armed === `resume:${next.round.id}`}
            label={t("act.resume")}
            sub={runName(next.round.seq, next.round.topic)}
            disabled={!!activeElsewhere}
            onClick={() => confirmTap.tap(`resume:${next.round.id}`, () => void resume(next.round))}
          />
        ) : (
          sec(`resume:${next.round.id}`, t("act.resume"), () => void resume(next.round), true)
        );
      const endBtn = sec(`endRemote:${next.round.id}`, t("act.endRemote"), () => recorder.endRoundRemote(id, next.round.id), true);
      if (liveElsewhere) {
        primary = detailsBtn;
        if (!activeElsewhere) secondary.push(resumeBtn(false));
        secondary.push(endBtn);
      } else {
        primary = resumeBtn(true);
        secondary.push(endBtn);
      }
      break;
    }
    case "busy":
      primary = (
        <Link className="big neutral" to={`/record/${(activeElsewhere ?? calElsewhere)!.sessionId}`}>
          <span className="big-label">{t("rec.goThere")} →</span>
        </Link>
      );
      break;
    case "preCal":
      primary = <BigButton stepKey={stepKey} tone="cal" label={t("act.startPreCal")} onClick={() => startCal("pre")} />;
      secondary.push(sec("skipCal", t("act.skipCalShort"), () => startRun(next.round), true));
      secondary.push(sec("manualCal", t("act.manualCalShort"), () => setPanel("manualCal")));
      break;
    case "startRun":
      primary = (
        <BigButton
          stepKey={stepKey}
          tone="go"
          label={s.splitRounds ? t("act.startRun", { n: next.round.seq }) : t("act.startSingle")}
          sub={s.splitRounds ? [next.round.topic, planText(next.round)].filter(Boolean).join(" · ") : undefined}
          onClick={() => startRun(next.round)}
        />
      );
      break;
    case "postCal":
      primary = <BigButton stepKey={stepKey} tone="cal" label={t("act.startPostCal")} onClick={() => startCal("post")} />;
      secondary.push(sec("finish", t("act.finishNoPost"), finishDay, !s.calibrations.some((c) => c.endedAt != null)));
      if (s.splitRounds) secondary.push(sec("addRun", t("act.addRun"), () => setPanel("addRun")));
      break;
    case "done":
      primary = detailsBtn;
      if (editable && s.splitRounds) secondary.push(sec("addRun", t("act.addRun"), () => setPanel("addRun")));
      break;
  }

  // ---------- สถานะ GPS / การส่งข้อมูล ----------
  const gpsPill = rec.gpsError
    ? { cls: "bad", text: t("pill.gpsErr") }
    : pos
      ? { cls: pos.acc <= 20 ? "ok" : pos.acc <= MAX_ACCURACY_M ? "warn" : "bad", text: t("pill.gps", { m: pos.acc.toFixed(0) }) }
      : rec.watching
        ? { cls: "warn", text: t("pill.gpsWait") }
        : null;
  const syncBad = sync.storageError || sync.authError || sync.failed.length > 0;
  const syncPill = !online
    ? { cls: "warn", text: `${t("pill.offline")}${sync.pending ? ` · ${t("pill.pending", { n: sync.pending })}` : ""}` }
    : sync.syncing && sync.queued
      ? { cls: "warn", text: t("pill.syncing") }
      : sync.queued
        ? { cls: syncBad ? "bad" : "warn", text: t("pill.pending", { n: sync.queued }) }
        : sync.failed.length
          ? { cls: "bad", text: t("pill.failed", { n: sync.failed.length }) }
          : { cls: sync.storageError || sync.authError ? "bad" : "ok", text: t("pill.synced") };
  const totalKm = s.rounds.reduce((a, r) => a + r.distanceM, 0);

  return (
    <div className="recorder">
      <div className="rec-head">
        <Link to="/" className="icon-btn" aria-label={t("c.back")}>←</Link>
        <div className="grow clip">
          <h2 className="m0 ellipsis">{s.title}</h2>
          <div className="muted small">
            {f.date(wd)} · {s.project.name} · {s.driver.name} · {s.vehicle.plate}
            {s.vehicle.equipment ? ` (${s.vehicle.equipment})` : ""}
          </div>
        </div>
        <Menu className="rec-menu" title={t("rec.menu")} label="⋯">
          {idle && next.a !== "preCal" && next.a !== "postCal" && (
            <button type="button" className="menu-item" onClick={() => startCal(suggestKind(s))}>
              {t("act.startCal", { kind: t(`cal.${suggestKind(s)}`) })}
            </button>
          )}
          {editable && <button type="button" className="menu-item" onClick={() => setPanel("manualCal")}>{t("act.manualCal")}</button>}
          {editable && s.splitRounds && <button type="button" className="menu-item" onClick={() => setPanel("addRun")}>{t("act.addRun")}</button>}
          <button type="button" className="menu-item" onClick={() => nav(`/sessions/${id}`)}>{t("act.details")}</button>
          <button type="button" className="menu-item" onClick={toggleMap}>{showMap ? t("act.hideMap") : t("act.showMap")}</button>
          <button type="button" className="menu-item" onClick={() => setPanel("sync")}>{t("act.syncStatus")}</button>
        </Menu>
      </div>

      <div className="pills">
        {gpsPill && <span className={`pill ${gpsPill.cls}`}>{gpsPill.text}</span>}
        <button type="button" className={`pill ${syncPill.cls}`} onClick={() => setPanel(panel === "sync" ? null : "sync")}>☁ {syncPill.text}</button>
        <QcBadge status={s.qcStatus} />
        <CalBadge cals={s.calibrations} />
      </div>

      <ErrorBox error={err} onRetry={() => void load()} />
      {fromCache && <div className="alert warn small">{t("rec.fromCache")}</div>}
      {s.qcStatus === "PASSED" && <div className="alert ok">{t("rec.locked")}</div>}
      {!canRec && <div className="alert warn">{t("rec.viewer")}</div>}
      {activeElsewhere && <div className="alert warn">{t("rec.elsewhere", { label: activeElsewhere.label })}</div>}
      {calElsewhere && !activeElsewhere && <div className="alert warn">{t("rec.calElsewhere")}</div>}
      {rec.gpsError && (
        <div className="alert bad">
          {t(`gps.${rec.gpsError}`)} {typeof window !== "undefined" && !window.isSecureContext ? t("gps.https") : ""}
        </div>
      )}
      {(panel === "sync" || syncBad) && <SyncBar />}

      {panel === "manualCal" && editable && (
        <CalibrationForm
          sessionId={id}
          workDate={wd}
          defaultKind={suggestKind(s)}
          onCancel={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            void load();
          }}
        />
      )}
      {panel === "addRun" && editable && (
        <form className="subcard row" onSubmit={addRun}>
          <input className="grow" autoFocus placeholder={t("rec.addRunPh")} value={newTopic} maxLength={200} onChange={(e) => setNewTopic(e.target.value)} />
          <button className="pri" disabled={!newTopic.trim()}>{t("c.add")}</button>
          <button type="button" onClick={() => setPanel(null)}>{t("c.cancel")}</button>
        </form>
      )}

      {/* ---------- กำลังบันทึก: ตัวเลขใหญ่อ่านง่าย ---------- */}
      {activeHere && (
        <div className="card live">
          <div className="live-head">
            <span className="dot live" /> {t("live.recording")} ·{" "}
            {runName(next.a === "endRun" ? next.seq : null, s.rounds.find((r) => r.id === activeHere.roundId)?.topic ?? activeHere.label)}
          </div>
          <div className="live-timer">{fmtElapsed(now - activeHere.startedAt)}</div>
          <div className="live-grid">
            <Stat label={t("live.distance")} value={f.km(rec.dist)} />
            <Stat label={t("live.speed")} value={f.kmh(rec.speed)} />
            <Stat label={t("live.accuracy")} value={pos ? `±${f.meters(pos.acc)}` : "…"} bad={!!pos && pos.acc > MAX_ACCURACY_M} />
          </div>
          <div className="sop-row" aria-label={t("sop.title")}>
            <span className={`pill ${coverageLevel(sopLive?.coverage ?? null) === "ok" ? "ok" : ""}`}>
              ⇄ {t("sop.roundTrip", { p: sopLive?.coverage != null ? pct(sopLive.coverage) : 0 })}
            </span>
            <span className={`pill ${sopLive && sopLive.lengthM > 300 && (fromStartM ?? Infinity) <= SOP.CLOSE_OK_M ? "ok" : ""}`}>
              ⟲ {t("sop.fromStart", { d: dist(fromStartM ?? 0) })}
            </span>
            <span className={`pill ${timeLevel(runElapsed) ?? ""}`}>⏱ {t("sop.loopTime", { e: fmtElapsed(runElapsed) })}</span>
          </div>
          {runElapsed > SOP.WARN_LOOP_MS && (
            <div className={`alert ${runElapsed > SOP.MAX_LOOP_MS ? "bad" : "warn"} small`}>
              {runElapsed > SOP.MAX_LOOP_MS ? t("sop.overTime") : t("sop.nearTime")}
            </div>
          )}
          <div className="muted small">
            {t("live.points", { n: rec.count })} · {rec.wakeLock ? t("live.wakeOn") : t("live.wakeOff")}
            <br />
            {t("sop.liveHint")}
          </div>
        </div>
      )}
      {!activeHere && next.a === "endCal" && (
        <div className="card live cal">
          <div className="live-head"><span className="dot live" /> {t("live.calRunning", { kind: t(`cal.${next.cal.kind}`) })}</div>
          <div className="live-timer">{fmtElapsed(now - (next.cal.startedAt ?? now))}</div>
        </div>
      )}
      {next.a === "orphan" && (
        <div className="alert warn">
          <b>{liveElsewhere ? t("orphan.liveTitle", { n: next.round.seq }) : t("orphan.title", { n: next.round.seq })}</b>
          <br />
          {liveElsewhere ? t("orphan.liveHelp", { t: f.clock(orphanLast, wd) }) : t("orphan.help")}
        </div>
      )}
      {next.a === "startRun" && !s.calibrations.length && (
        <div className="alert warn row between m0">
          <span>{t("rec.noCalWarn")}</span>
          <button type="button" onClick={() => startCal(suggestKind(s))}>{t("act.startCal", { kind: t(`cal.${suggestKind(s)}`) })}</button>
        </div>
      )}
      {next.a === "done" && (
        <div className="card done-card">
          <h3 className="m0">{t("done.title")}</h3>
          <p>{t("done.summary", { runs: s.rounds.length, km: f.km(totalKm), cals: s.calibrations.length })}</p>
          <p className="muted small m0">{t("done.next")}</p>
        </div>
      )}

      {/* ---------- ขั้นตอนของงาน ---------- */}
      <div className="card">
        <h3 className="steps-title">{t("steps.title")}</h3>
        <ol className="steps">
          {steps.map((st) => (
            <li key={st.key} className={`step ${st.icon}${st.picked ? " picked" : ""}${st.onPick ? " pickable" : ""}`}>
              {st.onPick ? (
                <button type="button" className="step-btn" onClick={st.onPick} aria-pressed={!!st.picked}>
                  <StepBody st={st} />
                </button>
              ) : (
                <StepBody st={st} />
              )}
            </li>
          ))}
        </ol>
        {canPick && <p className="muted small m0">{t("steps.tapHint")}</p>}
      </div>

      {showMap && (
        <>
          <TrackMap height="clamp(220px, 38vh, 420px)" follow tracks={mapTracks} marker={pos ? [pos.lat, pos.lng] : null} />
          <p className="muted small">
            {pos ? t("rec.position", { lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6), acc: pos.acc.toFixed(0) }) : ""}
          </p>
        </>
      )}
      <p className="muted small">{t("rec.keepScreen")}</p>

      {(primary || secondary.length > 0) && (
        <div className="actionbar">
          {secondary.length > 0 && <div className="sec-row">{secondary}</div>}
          {primary}
        </div>
      )}
    </div>
  );
}

function StepBody({ st }: { st: Step }) {
  return (
    <>
      <span className="step-icon" aria-hidden>{st.icon === "done" ? "✓" : st.icon === "warn" ? "!" : ""}</span>
      <span className="step-text">
        <span className="step-title">
          <b>{st.title}</b> {st.pending && <Pending />}
        </span>
        {st.sub && <small>{st.sub}</small>}
      </span>
    </>
  );
}

/** ตัวเลขใหญ่ + หน่วยตัวเล็ก (เช่น "12.3" + "กม.") */
function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  const i = value.indexOf(" ");
  return (
    <div>
      <span>{label}</span>
      <b className={bad ? "bad-text" : ""}>
        {i > 0 ? value.slice(0, i) : value}
        {i > 0 && <small> {value.slice(i + 1)}</small>}
      </b>
    </div>
  );
}
