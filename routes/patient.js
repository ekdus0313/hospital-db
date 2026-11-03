// =====================================================
// routes/patient.js — 환자용 화면 3개 (조원5)
//
//   /patient/reservations  내 예약       (화면 P-02, R-0007·R-0009)
//   /patient/records       내 진료 이력  (화면 P-06, R-0014·R-0017·R-0021)
//   /patient/payments      내 수납 내역  (화면 P-08, R-0028)
//
// 세 화면 모두 환자만 들어올 수 있고(requireRole('patient')),
// 로그인한 환자 본인의 데이터만 보여 준다 (WHERE patient_no = ?).
// =====================================================

const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { requireRole } = require('./auth');


// ── 내 예약 ─────────────────────────────────────────
// 예약 → 진료일정 → 의사 → 진료과 를 이어 붙여(JOIN) 한 표로 보여 준다.
router.get('/reservations', requireRole('patient'), async (req, res) => {
  try {
    const patientNo = req.session.user.patient_no;

    const [rows] = await db.query(`
      SELECT r.reservation_no,
             DATE_FORMAT(r.reserved_at, '%Y-%m-%d %H:%i') AS reserved_at,
             d.dept_name,
             e.employee_name,
             r.reservation_type,
             r.reservation_status,
             r.waiting_no
      FROM      reservation      r
      JOIN      medical_schedule s ON s.schedule_no = r.schedule_no
      JOIN      employee         e ON e.employee_no = s.employee_no
      JOIN      department       d ON d.dept_code   = e.dept_code
      WHERE     r.patient_no = ?
      ORDER BY  r.reserved_at DESC
    `, [patientNo]);

    // 상단 요약: 아직 진료 전인 예약(예약·접수) 건수
    const upcoming = rows.filter(r =>
      r.reservation_status === '예약' || r.reservation_status === '접수'
    ).length;

    res.render('patient/reservations', { rows, upcoming });
  } catch (err) {
    console.error('내 예약 조회 오류:', err);
    res.status(500).send('예약 목록을 불러오는 중 오류가 발생했습니다.');
  }
});


// ── 내 진료 이력 ─────────────────────────────────────
// 진료기록 목록(최신순)을 먼저 가져오고,
// 진단·처방·검사는 진료번호별로 묶어서 각 진료 아래에 펼쳐 보여 준다.
router.get('/records', requireRole('patient'), async (req, res) => {
  try {
    const patientNo = req.session.user.patient_no;

    const [records] = await db.query(`
      SELECT mr.medical_record_no,
             DATE_FORMAT(mr.treated_at, '%Y-%m-%d %H:%i') AS treated_at,
             d.dept_name,
             e.employee_name,
             mr.symptom,
             mr.opinion
      FROM   medical_record mr
      JOIN   employee       e ON e.employee_no = mr.employee_no
      JOIN   department     d ON d.dept_code   = e.dept_code
      WHERE  mr.patient_no = ?
      ORDER  BY mr.treated_at DESC
    `, [patientNo]);

    const [diagnoses] = await db.query(`
      SELECT dg.medical_record_no, dg.disease_code, dz.disease_name, dg.diagnosis_type
      FROM   diagnosis      dg
      JOIN   disease        dz ON dz.disease_code       = dg.disease_code
      JOIN   medical_record mr ON mr.medical_record_no = dg.medical_record_no
      WHERE  mr.patient_no = ?
      ORDER  BY dg.diagnosis_type DESC        -- 주진단이 먼저
    `, [patientNo]);

    const [prescriptions] = await db.query(`
      SELECT pr.medical_record_no, dr.drug_name,
             pr.dose_once, pr.dose_per_day, pr.dose_days,
             pr.dose_once * pr.dose_per_day * pr.dose_days AS total_dose
      FROM   prescription   pr
      JOIN   drug           dr ON dr.drug_code          = pr.drug_code
      JOIN   medical_record mr ON mr.medical_record_no = pr.medical_record_no
      WHERE  mr.patient_no = ?
    `, [patientNo]);

    const [tests] = await db.query(`
      SELECT t.medical_record_no, ti.test_name,
             DATE_FORMAT(t.tested_at, '%Y-%m-%d %H:%i') AS tested_at,
             t.test_result, t.test_status
      FROM   test           t
      JOIN   test_item      ti ON ti.test_code          = t.test_code
      JOIN   medical_record mr ON mr.medical_record_no = t.medical_record_no
      WHERE  mr.patient_no = ?
    `, [patientNo]);

    // 진료번호별로 묶기
    const byRecord = (list, no) => list.filter(x => x.medical_record_no === no);
    const rows = records.map(r => ({
      ...r,
      diagnoses:     byRecord(diagnoses, r.medical_record_no),
      prescriptions: byRecord(prescriptions, r.medical_record_no),
      tests:         byRecord(tests, r.medical_record_no),
    }));

    res.render('patient/records', { rows });
  } catch (err) {
    console.error('내 진료 이력 조회 오류:', err);
    res.status(500).send('진료 이력을 불러오는 중 오류가 발생했습니다.');
  }
});


// ── 내 수납 내역 ─────────────────────────────────────
// 진료기록 기준으로 수납을 LEFT JOIN 한다.
// 수납 행이 없으면 금액은 비어 있고 상태는 '미수납'으로 표시한다 (R-0028).
router.get('/payments', requireRole('patient'), async (req, res) => {
  try {
    const patientNo = req.session.user.patient_no;

    const [rows] = await db.query(`
      SELECT mr.medical_record_no,
             DATE_FORMAT(mr.treated_at, '%Y-%m-%d') AS treated_at,
             d.dept_name,
             pm.payment_no,
             pm.consult_amount, pm.test_amount, pm.drug_amount, pm.room_amount,
             pm.total_amount, pm.patient_amount,
             pm.pay_method,
             DATE_FORMAT(pm.paid_at, '%Y-%m-%d %H:%i') AS paid_at,
             COALESCE(pm.pay_status, '미수납')          AS pay_status
      FROM      medical_record mr
      JOIN      employee       e  ON e.employee_no        = mr.employee_no
      JOIN      department     d  ON d.dept_code          = e.dept_code
      LEFT JOIN payment        pm ON pm.medical_record_no = mr.medical_record_no
      WHERE     mr.patient_no = ?
      ORDER BY  mr.treated_at DESC
    `, [patientNo]);

    // 상단 요약: 수납 완료된 본인부담금 합계
    const paidTotal = rows
      .filter(r => r.pay_status === '완료')
      .reduce((sum, r) => sum + Number(r.patient_amount || 0), 0);

    res.render('patient/payments', { rows, paidTotal });
  } catch (err) {
    console.error('내 수납 내역 조회 오류:', err);
    res.status(500).send('수납 내역을 불러오는 중 오류가 발생했습니다.');
  }
});


// ── 메인 화면(/)용 요약 — app.js 의 '/' 에서 부른다 ─────
// 다음 예약 1건, 최근 진료 1건, 미수납 건수
async function loadPatientHome(patientNo) {
  const [[next]] = await db.query(`
    SELECT DATE_FORMAT(r.reserved_at, '%Y.%m') AS ym,
           DATE_FORMAT(r.reserved_at, '%d')    AS day,
           DATE_FORMAT(r.reserved_at, '%H:%i') AS hm,
           DAYOFWEEK(r.reserved_at)            AS dow,
           d.dept_name, e.employee_name, r.reservation_status
    FROM   reservation      r
    JOIN   medical_schedule s ON s.schedule_no = r.schedule_no
    JOIN   employee         e ON e.employee_no = s.employee_no
    JOIN   department       d ON d.dept_code   = e.dept_code
    WHERE  r.patient_no = ?
      AND  r.reservation_status IN ('예약', '접수')
      AND  r.reserved_at >= NOW()
    ORDER  BY r.reserved_at
    LIMIT  1
  `, [patientNo]);

  const [[recent]] = await db.query(`
    SELECT DATE_FORMAT(mr.treated_at, '%Y-%m-%d') AS treated_at,
           d.dept_name, e.employee_name,
           (SELECT dz.disease_name
              FROM diagnosis dg JOIN disease dz ON dz.disease_code = dg.disease_code
             WHERE dg.medical_record_no = mr.medical_record_no AND dg.diagnosis_type = '주진단'
             LIMIT 1) AS main_dx
    FROM   medical_record mr
    JOIN   employee       e ON e.employee_no = mr.employee_no
    JOIN   department     d ON d.dept_code   = e.dept_code
    WHERE  mr.patient_no = ?
    ORDER  BY mr.treated_at DESC
    LIMIT  1
  `, [patientNo]);

  const [[unpaid]] = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM      medical_record mr
    LEFT JOIN payment        pm ON pm.medical_record_no = mr.medical_record_no
    WHERE     mr.patient_no = ?
      AND     COALESCE(pm.pay_status, '미수납') <> '완료'
  `, [patientNo]);

  return { next: next || null, recent: recent || null, unpaid: unpaid.cnt };
}


module.exports = router;
module.exports.loadPatientHome = loadPatientHome;
