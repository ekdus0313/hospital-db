// =====================================================
// routes/reservation.js — 예약·접수 (조원2)
//
// app.js 에서 '/reservation' 아래에 붙인다.
//   GET /reservation/office      원무 첫 화면 — 예약 목록
//   GET /reservation/available   예약 가능 시간 조회
//
// 직종별 접근 제한 함수가 올라오면 주소 옆에 끼운다.
//   예) router.get('/office', 원무만, async (req, res) => { ... })
// =====================================================

const express = require('express');
const db = require('../db/db');

const router = express.Router();


// ① 원무 첫 화면 — 예약 목록
//    테스트 데이터가 전부 10월 5일이라 날짜로 거르지 않고 전부 보여준다.
router.get('/office', async (req, res) => {
  const [rows] = await db.query(`
    SELECT r.reservation_no,
           DATE_FORMAT(r.reserved_at, '%Y-%m-%d %H:%i') AS reserved_at,
           p.patient_name,
           d.dept_name,
           e.employee_name,
           r.reservation_type,
           r.reservation_status,
           r.waiting_no
    FROM   reservation      r
    JOIN   patient          p  ON p.patient_no  = r.patient_no
    JOIN   medical_schedule ms ON ms.schedule_no = r.schedule_no
    JOIN   employee         e  ON e.employee_no = ms.employee_no
    JOIN   department       d  ON d.dept_code   = e.dept_code
    ORDER BY r.reserved_at, r.reservation_no
  `);

  res.render('reservation/office', { rows });
});


// ② 예약 가능 시간 조회
//    진료과 → 의사 → 날짜 를 차례로 고르면 시간 목록이 나온다.
//    고른 값은 주소 뒤 ?dept=D01&doctor=E10021&date=2026-12-14 로 넘어온다.
//    5주차 member2.sql 쿼리에서 진료과코드 자리를 ? 로 바꾸고 의사·날짜 조건을 더했다.
router.get('/available', async (req, res) => {
  // 진료과를 바꾸면 앞에서 고른 의사·날짜가 새 진료과와 안 맞을 수 있다.
  // 아래에서 목록에 없는 값이면 비운다.
  let dept   = req.query.dept   || '';
  let doctor = req.query.doctor || '';
  let date   = req.query.date   || '';

  // 진료과 — 재직 중인 의사가 있는 과만 (원무과·전산팀 제외)
  const [depts] = await db.query(`
    SELECT d.dept_code, d.dept_name
    FROM   department d
    WHERE  d.dept_code IN (SELECT dept_code FROM employee
                           WHERE job_type = '의사' AND emp_status = '재직')
    ORDER BY d.dept_code
  `);
  if (!depts.some(d => d.dept_code === dept)) dept = '';

  // 의사 — 진료과를 골랐을 때만
  let doctors = [];
  if (dept) {
    [doctors] = await db.query(`
      SELECT employee_no, employee_name
      FROM   employee
      WHERE  dept_code = ? AND job_type = '의사' AND emp_status = '재직'
      ORDER BY employee_name
    `, [dept]);
  }
  if (!doctors.some(d => d.employee_no === doctor)) doctor = '';

  // 날짜 — 의사를 골랐을 때만. 지금 이후의 정상 일정이 있는 날짜
  let dates = [];
  if (doctor) {
    [dates] = await db.query(`
      SELECT DISTINCT DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date
      FROM   medical_schedule
      WHERE  employee_no = ?
        AND  operation_status = '정상'
        AND  TIMESTAMP(schedule_date, start_time) > NOW()
      ORDER BY schedule_date
    `, [doctor]);
  }
  if (!dates.some(d => d.schedule_date === date)) date = '';

  // 시간 목록 — 셋 다 골랐을 때만
  let rows = [];
  if (dept && doctor && date) {
    [rows] = await db.query(`
      SELECT ms.schedule_no,
             DATE_FORMAT(ms.start_time, '%H:%i')   AS start_time,
             DATE_FORMAT(ms.end_time,   '%H:%i')   AS end_time,
             ms.capacity,
             COUNT(r.reservation_no)               AS reserved_count,
             ms.capacity - COUNT(r.reservation_no) AS remaining
      FROM       medical_schedule ms
      JOIN       employee         e ON e.employee_no = ms.employee_no
      LEFT JOIN  reservation      r ON r.schedule_no = ms.schedule_no
                                   AND r.reservation_status <> '취소'
      WHERE      ms.operation_status = '정상'
        AND      e.emp_status        = '재직'
        AND      e.job_type          = '의사'
        AND      e.dept_code         = ?
        AND      ms.employee_no      = ?
        AND      ms.schedule_date    = ?
        AND      TIMESTAMP(ms.schedule_date, ms.start_time) > NOW()
      GROUP BY   ms.schedule_no, ms.start_time, ms.end_time, ms.capacity
      HAVING     COUNT(r.reservation_no) < ms.capacity
      ORDER BY   ms.start_time
    `, [dept, doctor, date]);
  }

  res.render('reservation/available', {
    depts, doctors, dates, rows,
    selected: { dept, doctor, date },
  });
});


module.exports = router;
