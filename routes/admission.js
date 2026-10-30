// =====================================================
// routes/admission.js — 입원·수납·관리자 (조원4)
//
// app.js 에서 '/admission' 아래에 붙인다.
//   GET /admission/beds       관리자 첫 화면 — 병상 현황
//   GET /admission/payments   수납 대상 목록
//
// 접근 제한 — requireRole (routes/auth.js, 조원1)
//   로그인 안 했으면 로그인 화면으로, 역할이 다르면 403 으로 막는다.
//   병상 현황 : 관리자 + 원무 (원무가 입원 등록 때 빈 병상을 본다, R-0023)
//   수납 대상 : 원무 + 관리자 (수납은 원무 업무, R-0027)
// =====================================================

const express = require('express');
const db = require('../db/db');
const { requireRole } = require('./auth');

const router = express.Router();


// ① 관리자 첫 화면 — 병상 현황
//    5주차 member4.sql ③ 쿼리(병실별 사용 중 병상 수)를 그대로 썼다.
//    병실에는 '만실' 칸을 두지 않고, 병상 상태를 세서 그때그때 계산한다.
router.get('/beds', requireRole('관리자', '원무'), async (req, res) => {
  // 병실별 요약 — 병상이 0개인 병실도 보이도록 LEFT JOIN
  const [rooms] = await db.query(`
    SELECT r.ward,
           r.room_no,
           r.room_type,
           r.daily_fee,
           COUNT(b.bed_no)                                     AS total_beds,
           COUNT(CASE WHEN b.bed_status = '사용중' THEN 1 END) AS used_beds
    FROM      room r
    LEFT JOIN bed  b ON b.room_no = r.room_no
    GROUP BY  r.ward, r.room_no, r.room_type, r.daily_fee
    ORDER BY  r.room_no
  `);

  // 병상별 상세 — 사용중이면 누가 입원해 있는지 같이 보여준다
  const [beds] = await db.query(`
    SELECT b.bed_no,
           r.room_no,
           r.room_type,
           b.bed_status,
           p.patient_name,
           DATE_FORMAT(a.admit_at, '%Y-%m-%d') AS admit_at
    FROM      bed       b
    JOIN      room      r ON r.room_no    = b.room_no
    LEFT JOIN admission a ON a.bed_no     = b.bed_no
                         AND a.adm_status = '입원중'
    LEFT JOIN patient   p ON p.patient_no = a.patient_no
    ORDER BY  b.bed_no
  `);

  // 전체 합계와 가동률 (사용중 ÷ 전체)
  const total = rooms.reduce((sum, r) => sum + Number(r.total_beds), 0);
  const used  = rooms.reduce((sum, r) => sum + Number(r.used_beds), 0);
  const rate  = total === 0 ? 0 : Math.round((used / total) * 100);

  res.render('admission/beds', { rooms, beds, total, used, rate });
});


// ② 수납 대상 목록
//    수납이 끝나지 않은 진료를 보여준다.
//    - 수납 행이 아직 없는 진료 (진료비 계산 전)
//    - 수납 행은 있지만 상태가 '미수납'인 진료
//    LEFT JOIN 으로 붙여서, 수납 행이 없으면 상태를 '미수납'으로 표시한다 (R-0028).
//    입원 중인 환자는 병실료가 정해지지 않았으니 퇴원 후 정산이라고 알려준다.
router.get('/payments', requireRole('원무', '관리자'), async (req, res) => {
  const [rows] = await db.query(`
    SELECT mr.medical_record_no,
           DATE_FORMAT(mr.treated_at, '%Y-%m-%d %H:%i') AS treated_at,
           p.patient_name,
           d.dept_name,
           e.employee_name,
           pm.payment_no,
           pm.total_amount,
           pm.patient_amount,
           COALESCE(pm.pay_status, '미수납')            AS pay_status,
           (SELECT a.adm_status
              FROM admission a
             WHERE a.medical_record_no = mr.medical_record_no
             ORDER BY a.admit_at DESC
             LIMIT 1)                                   AS adm_status
    FROM      medical_record mr
    JOIN      patient        p  ON p.patient_no         = mr.patient_no
    JOIN      employee       e  ON e.employee_no        = mr.employee_no
    JOIN      department     d  ON d.dept_code          = e.dept_code
    LEFT JOIN payment        pm ON pm.medical_record_no = mr.medical_record_no
    WHERE     pm.payment_no IS NULL
       OR     pm.pay_status = '미수납'
    ORDER BY  mr.treated_at
  `);

  res.render('admission/payments', { rows });
});


module.exports = router;
