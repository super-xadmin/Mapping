-- v3.2: ขั้นตอนส่งงาน → QC ตรวจ และให้ทุกคน (ยกเว้นบัญชีดูอย่างเดียว) เพิ่มข้อมูลหลักได้
-- (ห้ามแก้ไฟล์ migration เดิม — เพิ่มไฟล์ใหม่เสมอ)

-- ใครกดส่งงานครั้งล่าสุด เมื่อไร (ประวัติทุกขั้น: ส่ง / ถอน / ผ่าน / ตีกลับ อยู่ใน audit_log)
-- ขั้นของงานคำนวณจาก qc_status + submitted_at + qc_at (ดู STAGE_SQL ใน worker/rows.ts)
ALTER TABLE mapping_sessions ADD COLUMN submitted_at INTEGER;
ALTER TABLE mapping_sessions ADD COLUMN submitted_by TEXT REFERENCES users(id);

-- ใครเป็นคนเพิ่มคนขับ / รถ / โปรเจกต์ (รายการเก่าที่เพิ่มก่อนหน้านี้จะว่าง)
ALTER TABLE drivers ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE vehicles ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE projects ADD COLUMN created_by TEXT REFERENCES users(id);
