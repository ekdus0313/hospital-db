// =====================================================
// routes/stats.js — 관리자 통계 (조원5 · 10주차)
//
//   /stats/departments  진료과별 환자 수 (R-0033)
//   /stats/payments     기간별 수납 금액 (R-0033)
//
// 지금은 빈 껍데기입니다. 팀장이 app.js 연결만 먼저 해 두었습니다.
// 조원5 가 작업계획서의 코드를 이 아래에 붙여 넣으면 두 화면이 열립니다.
// (이 파일이 없으면 app.js 의 require 가 실패해서 서버가 아예 뜨지 않습니다)
// =====================================================

const express = require('express');
const router = express.Router();

// ↓↓↓ 조원5 : 작업계획서 「조원5 — 통계 2개」 1단계 코드를 여기에 붙여 넣으세요 ↓↓↓

const db = require('../db/db');
const { requireRole } = require('./auth');


// ── ① 진료과별 환자 수 ──────────────────────────────
// 진료기록에는 진료과가 없다. 의사를 거쳐 진료과로 올라간다.
//   진료기록 → 직원 → 진료과
// COUNT(DISTINCT patient_no) 가 핵심 — 한 환자가 세 번 왔으면
// 환자 1명 · 진료 3건이다. DISTINCT 를 빼면 둘이 같은 숫자로 나와 틀린다.
router.get('/departments', requireRole('관리자'), async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT d.dept_code,
             d.dept_name,
             COUNT(DISTINCT mr.patient_no) AS patient_count,
             COUNT(*)                      AS record_count
      FROM   medical_record mr
      JOIN   employee       e ON e.employee_no = mr.employee_no
      JOIN   department     d ON d.dept_code   = e.dept_code
      GROUP BY d.dept_code, d.dept_name
      ORDER BY patient_count DESC, d.dept_name`);

    // 띠 길이를 그릴 기준 — 가장 큰 값. 0으로 나누지 않도록 최소 1.
    const maxCount = rows.length
      ? Math.max(...rows.map(r => Number(r.patient_count))) : 0;

    res.render('stats/departments', { rows, maxCount: maxCount || 1 });
  } catch (err) {
    console.error('진료과별 통계 오류:', err);
    res.status(500).send('통계를 불러오는 중 오류가 발생했습니다.');
  }
});


// ── ② 기간별 수납 금액 ──────────────────────────────
// pay_status = '완료' 를 빠뜨리면 아직 받지도 않은 돈이 매출로 잡힌다.
// 날짜는 반드시 ? 로 넘긴다. 글자로 이어 붙이면 SQL 인젝션이다.
router.get('/payments', requireRole('관리자'), async (req, res) => {
  try {
    // 기본값 — 이번 달 1일 ~ 오늘. 열자마자 숫자가 보이게.
    const [[def]] = await db.query(`
      SELECT DATE_FORMAT(CURDATE(), '%Y-%m-01') AS first_day,
             DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today`);

    const from = req.query.from || def.first_day;
    const to   = req.query.to   || def.today;

    if (from > to) {
      req.session.flash = { type: 'danger', text: '시작일이 종료일보다 늦습니다.' };
      return req.session.save(() => res.redirect('/stats/payments'));
    }

    // paid_at 은 DATETIME 이라 종료일 23:59:59 까지 포함해야
    // 종료일에 수납한 건이 빠지지 않는다.
    const [rows] = await db.query(`
      SELECT DATE_FORMAT(paid_at, '%Y-%m-%d') AS paid_day,
             COUNT(*)            AS pay_count,
             SUM(total_amount)   AS total_sum,
             SUM(patient_amount) AS patient_sum
      FROM   payment
      WHERE  pay_status = '완료'
        AND  paid_at >= ?
        AND  paid_at <  DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE_FORMAT(paid_at, '%Y-%m-%d')
      ORDER BY paid_day`, [from, to]);

    // 합계는 코드에서 더한다 (SQL 에 WITH ROLLUP 을 쓰지 않아도 된다)
    const sum = rows.reduce((a, r) => ({
      pay_count:   a.pay_count   + Number(r.pay_count),
      total_sum:   a.total_sum   + Number(r.total_sum),
      patient_sum: a.patient_sum + Number(r.patient_sum),
    }), { pay_count: 0, total_sum: 0, patient_sum: 0 });

    res.render('stats/payments', { rows, sum, from, to });
  } catch (err) {
    console.error('기간별 수납 통계 오류:', err);
    res.status(500).send('통계를 불러오는 중 오류가 발생했습니다.');
  }
});



module.exports = router;