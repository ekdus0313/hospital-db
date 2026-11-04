// =====================================================
// routes/treatment.js — 진료·검사 (조원3)
//
// app.js 에서 '/treatment' 아래에 붙인다.
//   GET /treatment/doctor    의사 첫 화면 — 접수된 환자 목록
//   GET /treatment/history   진료 이력 조회
//   GET /treatment/tests     검사 목록
//
// 직종별 접근 제한 함수가 올라오면 주소 옆에 끼운다.
//   예) router.get('/doctor', 의사만, async (req, res) => { ... })
// =====================================================

const express = require('express');

const db = require('../db/db');
const { requireRole } = require('./auth');     // ← 추가

const router = express.Router();


// ① 의사 첫 화면 — 고른 날짜에 "나에게" 접수된 환자 목록
//    날짜를 안 고르면 오늘. 대기번호는 의사별·일자별로 1번부터라서
//    날짜를 거르지 않으면 어제 번호와 섞여 순서가 맞지 않는다.
router.get('/doctor', requireRole('의사'), async (req, res) => {
  try {
    const employeeNo = req.session.user.employee_no;

    const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    const date  = req.query.date || today;

    const [rows] = await db.query(`
      SELECT r.reservation_no,
             r.waiting_no,
             DATE_FORMAT(r.reception_at, '%H:%i') AS reception_at,
             p.patient_no,
             p.patient_name,
             d.dept_name,
             e.employee_name
      FROM   reservation      r
      JOIN   patient          p  ON p.patient_no   = r.patient_no
      JOIN   medical_schedule ms ON ms.schedule_no = r.schedule_no
      JOIN   employee         e  ON e.employee_no  = ms.employee_no
      JOIN   department       d  ON d.dept_code    = e.dept_code
      WHERE  r.reservation_status = '접수'
        AND  DATE(r.reception_at) = ?        -- 고른 날짜에 접수한 건만
        AND  ms.employee_no       = ?        -- 로그인한 의사 본인 환자만
      ORDER BY r.waiting_no
    `, [date, employeeNo]);

    res.render('treatment/doctor', { rows, date, today });
  } catch (err) {
    console.error('대기 환자 목록 조회 오류:', err);
    res.status(500).send('대기 환자 목록을 불러오는 중 오류가 발생했습니다.');
  }
});


// ② 진료 이력 조회
//    5주차 member3.sql 쿼리에서 환자번호 자리를 ? 로 바꿨다.
//    진단은 서브쿼리로 뽑는다. JOIN 으로 가져오면 진단 2건과 처방 3건이
//    곱해져 6줄이 되기 때문이다.
router.get('/history', async (req, res) => {
  const selected = req.query.patient || '';

  const [patients] = await db.query(`
    SELECT patient_no, patient_name
    FROM   patient
    ORDER BY patient_name
  `);

  let rows = [];
  if (selected) {
    [rows] = await db.query(`
      SELECT mr.medical_record_no,
             DATE_FORMAT(mr.treated_at, '%Y-%m-%d %H:%i') AS treated_at,
             p.patient_name,
             dp.dept_name,
             e.employee_name,
             mr.symptom,
             (SELECT GROUP_CONCAT(CONCAT(dg.diagnosis_type, ' ', ds.disease_name)
                                  ORDER BY CASE dg.diagnosis_type
                                               WHEN '주진단' THEN 1 ELSE 2 END
                                  SEPARATOR ' / ')
                FROM diagnosis dg
                JOIN disease   ds ON ds.disease_code = dg.disease_code
               WHERE dg.medical_record_no = mr.medical_record_no) AS diagnosis,
             GROUP_CONCAT(CONCAT(dr.drug_name, ' ',
                                 pr.dose_once,    '정 ',
                                 pr.dose_per_day, '회 ',
                                 pr.dose_days,    '일')
                          ORDER BY dr.drug_name
                          SEPARATOR ' / ')                        AS prescription
      FROM       medical_record mr
      JOIN       patient      p  ON p.patient_no         = mr.patient_no
      JOIN       employee     e  ON e.employee_no        = mr.employee_no
      JOIN       department   dp ON dp.dept_code         = e.dept_code
      LEFT JOIN  prescription pr ON pr.medical_record_no = mr.medical_record_no
      LEFT JOIN  drug         dr ON dr.drug_code         = pr.drug_code
      WHERE      p.patient_no = ?
      GROUP BY   mr.medical_record_no, mr.treated_at, p.patient_name,
                 dp.dept_name, e.employee_name, mr.symptom
      ORDER BY   mr.treated_at DESC
    `, [selected]);
  }

  res.render('treatment/history', { patients, rows, selected });
});


// ③ 검사 목록
//    아직 결과가 안 나온 '지시' 건을 위로 올린다.
//    검사일시·검사결과는 지시 시점에 비어 있어서 NULL 이 올 수 있다.
router.get('/tests', async (req, res) => {
  const [rows] = await db.query(`
    SELECT t.test_no,
           t.test_status,
           DATE_FORMAT(t.tested_at, '%Y-%m-%d %H:%i') AS tested_at,
           t.test_result,
           t.applied_price,
           ti.test_name,
           ti.test_category,
           p.patient_name,
           mr.medical_record_no
    FROM   test           t
    JOIN   test_item      ti ON ti.test_code         = t.test_code
    JOIN   medical_record mr ON mr.medical_record_no = t.medical_record_no
    JOIN   patient        p  ON p.patient_no         = mr.patient_no
    ORDER BY CASE t.test_status WHEN '지시' THEN 1 WHEN '완료' THEN 2 ELSE 3 END,
             t.test_no
  `);

  res.render('treatment/tests', { rows });
});


module.exports = router;