// ข้อมูลหลัก: คนขับ / รถ / โปรเจกต์ — ทุกคนยกเว้นบัญชีดูอย่างเดียว เพิ่ม แก้ไข และปิดใช้งานได้
// (ทุกครั้งเซิร์ฟเวอร์บันทึกชื่อคนทำและเวลาไว้ในประวัติการใช้งาน)
import { useCallback, useEffect, useState } from "react";
import type { MasterType } from "../../shared/labels";
import type { Master } from "../../shared/types";
import { useI18n } from "../i18n";
import { api, errMsg } from "../lib/api";
import { MASTER_FIELDS, MASTER_TYPES, addMaster, masterRows, type MasterRow } from "../lib/master";
import { ErrorBox } from "../components/ui";

export default function MasterData() {
  const { t } = useI18n();
  const [m, setM] = useState<Master | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => api<Master>("/master").then(setM).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => {
    void load();
  }, [load]);
  const report = {
    error: (e: string) => { setNote(""); setErr(e); },
    note: (n: string) => { setErr(""); setNote(n); },
  };
  return (
    <>
      <div className="card">
        <h2 className="m0">{t("md.title")}</h2>
        <p className="muted small m0">{t("md.help")}</p>
      </div>
      <ErrorBox error={err} />
      {note && <div className="alert ok">{note}</div>}
      <div className="grid three">
        {MASTER_TYPES.map((k) => <MasterSection key={k} k={k} rows={masterRows(m, k)} reload={load} report={report} />)}
      </div>
    </>
  );
}

type Report = { error: (e: string) => void; note: (n: string) => void };

function MasterSection({ k, rows, reload, report }: { k: MasterType; rows: MasterRow[]; reload: () => void; report: Report }) {
  const { t, f } = useI18n();
  const c = MASTER_FIELDS[k];
  const [main, setMain] = useState("");
  const [sub, setSub] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const name = main.trim();
      const r = await addMaster(k, name, sub);
      if (r.existed) report.error(t("err.masterDup", { name }));
      else {
        report.note(r.reactivated ? t("md.reactivated", { name }) : "");
        setMain("");
        setSub("");
      }
      reload();
    } catch (e) {
      report.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      await api(`/master/${k}/${id}`, { method: "PATCH", body });
      report.note("");
      reload();
      return true;
    } catch (e) {
      report.error(errMsg(e));
      return false;
    }
  }
  function toggle(r: MasterRow) {
    if (r.active && !confirm(t("adm.disableConfirm"))) return;
    void patch(r.id, { active: !r.active });
  }

  return (
    <div className="card">
      <h3>{t(c.title)}</h3>
      <form className="stack" onSubmit={add}>
        <input required maxLength={200} placeholder={t(c.mainPh)} value={main} onChange={(e) => setMain(e.target.value)} />
        <input maxLength={300} placeholder={t(c.subPh)} value={sub} onChange={(e) => setSub(e.target.value)} />
        <button className="pri" disabled={busy}>{t("c.add")}</button>
      </form>
      {!rows.length && <p className="muted small">{t("md.empty")}</p>}
      <table className="compact master-list">
        <tbody>
          {rows.map((r) =>
            editing === r.id ? (
              <EditRow key={r.id} k={k} r={r} onCancel={() => setEditing(null)} onSave={async (body) => (await patch(r.id, body)) && setEditing(null)} />
            ) : (
              <tr key={r.id} className={r.active ? "" : "inactive"}>
                <td>
                  {r.main}
                  {r.sub && <div className="muted small">{r.sub}</div>}
                  {r.createdBy && <div className="muted small">{t("md.addedBy", { by: r.createdBy, at: f.dt(r.createdAt) })}</div>}
                </td>
                <td className="right nowrap">
                  {r.active && <button className="link" onClick={() => setEditing(r.id)}>{t("c.edit")}</button>}{" "}
                  <button className="link" onClick={() => toggle(r)}>{r.active ? t("c.disable") : t("c.enable")}</button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function EditRow({ k, r, onSave, onCancel }: { k: MasterType; r: MasterRow; onSave: (body: Record<string, unknown>) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const c = MASTER_FIELDS[k];
  const [main, setMain] = useState(r.main);
  const [sub, setSub] = useState(r.sub ?? "");
  return (
    <tr>
      <td colSpan={2}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave({ [c.main]: main, [c.sub]: sub }); }}>
          <input required autoFocus maxLength={200} aria-label={t(c.mainPh)} placeholder={t(c.mainPh)} value={main} onChange={(e) => setMain(e.target.value)} />
          <input maxLength={300} aria-label={t(c.subPh)} placeholder={t(c.subPh)} value={sub} onChange={(e) => setSub(e.target.value)} />
          {main.trim() !== r.main && <p className="warn-text small m0">{t("md.editHint")}</p>}
          <div className="row m0">
            <button className="pri" disabled={!main.trim()}>{t("c.save")}</button>
            <button type="button" onClick={onCancel}>{t("c.cancel")}</button>
          </div>
        </form>
      </td>
    </tr>
  );
}
