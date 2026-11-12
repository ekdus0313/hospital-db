// =====================================================
// routes/reservation.js — 예약·접수 (조원2)
//
// app.js 에서 '/reservation' 아래에 붙인다.
//   GET  /reservation/office              원무 첫 화면 — 예약 목록
//   GET  /reservation/available           예약 가능 시간 조회
//   POST /reservation/create              예약하기        (8·9주차)
//   POST /reservation/:no/cancel          예약 취소        (8·9주차)
//   POST /reservation/:no/reception       접수 + 대기번호  (8·9주차)
//   GET  /reservation/schedules           진료 일정 목록 (원무)
//   POST /reservation/schedules/:no/close 휴진 처리 + 그 일정 예약 일괄 취소 (R-0031)
//
// 저장은 세 가지 모두 "검사 → 저장" 을 한 트랜잭션 안에서 한다.
// 검사와 저장 사이에 다른 사람이 끼어들지 못하게 FOR UPDATE 로 줄을 잠근다.
// =====================================================

const express = require('express');
const db = require('../db/db');
const { requireRole } = require('./auth');

const router = express.Router();


// ── 성공/실패 메시지 ─────────────────────────────────
// 공통 알림(app.js · header.ejs, 조원5)에 담고, 세션이 저장된 뒤 이동한다.
function flashRedirect(req, res, type, text, to) {
  req.session.flash = { type, text };
  req.session.save(() => res.redirect(to));
}

// 검사에서 걸리면 이 오류를 던진다. 메시지는 화면에 그대로 보여 준다.
class RuleError extends Error {}

// 연결 하나를 빌려 트랜잭션으로 work 를 실행한다.
// work 안에서 오류가 나면 전부 되돌리고(ROLLBACK) 오류를 다시 던진다.
async function inTransaction(work) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// 예약 후 돌아갈 화면 — 환자는 내 예약, 원무는 예약 목록
function listPathFor(user) {
  return user.role === 'patient' ? '/patient/reservations' : '/reservation/office';
}


// ① 원무 첫 화면 — 예약 목록
//    테스트 데이터가 전부 10월 5일이라 날짜로 거르지 않고 전부 보여준다.
router.get('/office', requireRole('원무'), async (req, res) => {
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
router.get('/available', requireRole('원무', 'patient'), async (req, res) => {
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

  // 원무는 어느 환자의 예약인지 골라야 한다. 환자는 본인으로 정해진다.
  let patients = [];
  if (req.session.user.role === '원무' && rows.length) {
    [patients] = await db.query(`
      SELECT patient_no, patient_name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date
      FROM   patient
      ORDER BY patient_name
    `);
  }

  res.render('reservation/available', {
    depts, doctors, dates, rows, patients,
    selected: { dept, doctor, date },
  });
});


// ③ 예약하기
//    예약 가능 시간 화면에서 시간(schedule_no)을 골라 보낸다.
//
//    정원 검사는 트랜잭션이 필요하다.
//    두 사람이 동시에 "남은 자리 1" 을 보고 둘 다 저장하면 정원을 넘는다.
//    → 일정 줄을 FOR UPDATE 로 잠그면, 같은 일정에 대한 두 번째 요청은
//      첫 번째가 COMMIT 할 때까지 기다렸다가 바뀐 예약 수를 보고 검사한다.
router.post('/create', requireRole('원무', 'patient'), async (req, res) => {
  const user = req.session.user;
  const scheduleNo = String(req.body.schedule_no || '');
  const patientNo  = user.role === 'patient' ? user.patient_no : String(req.body.patient_no || '');

  // 실패하면 고르던 화면으로 돌려보낸다
  const back = '/reservation/available?' + new URLSearchParams({
    dept: req.body.dept || '', doctor: req.body.doctor || '', date: req.body.date || '',
  });

  if (!scheduleNo) return flashRedirect(req, res, 'danger', '예약할 시간을 선택해 주세요.', back);
  if (!patientNo)  return flashRedirect(req, res, 'danger', '예약할 환자를 선택해 주세요.', back);

  // 예약번호가 겹치면(PK 중복) 몇 번 다시 시도한다
  const createWithRetry = async (tries = 3) => {
    try {
      return await inTransaction(createOnce);
    } catch (err) {
      const pkClash = err.code === 'ER_DUP_ENTRY' && /PRIMARY/.test(err.message);
      if ((pkClash || err.code === 'ER_LOCK_DEADLOCK') && tries > 1) return createWithRetry(tries - 1);
      throw err;
    }
  };

  const createOnce = async (conn) => {
    // 1) 일정 잠그고 읽기
    const [[ms]] = await conn.query(`
      SELECT ms.schedule_no, ms.schedule_date, ms.start_time, ms.end_time,
             ms.capacity, ms.operation_status, e.dept_code, e.emp_status,
             TIMESTAMP(ms.schedule_date, ms.start_time) > NOW() AS is_future,
             ms.schedule_date = CURDATE()                     AS is_today
      FROM   medical_schedule ms
      JOIN   employee         e ON e.employee_no = ms.employee_no
      WHERE  ms.schedule_no = ?
      FOR UPDATE
    `, [scheduleNo]);

    if (!ms)                              throw new RuleError('없는 진료 일정입니다.');
    if (ms.operation_status !== '정상')    throw new RuleError('휴진인 일정은 예약할 수 없습니다.');
    if (ms.emp_status !== '재직')          throw new RuleError('진료하지 않는 의사의 일정입니다.');
    if (!ms.is_future)                    throw new RuleError('이미 시작된 시간은 예약할 수 없습니다.');

    // 2) 환자 확인 (원무가 고른 값이 실제로 있는지)
    const [[patient]] = await conn.query(
      'SELECT patient_no FROM patient WHERE patient_no = ?', [patientNo]);
    if (!patient) throw new RuleError('없는 환자입니다.');

    // 3) 같은 일정에 이미 예약이 있는지 — 취소한 예약도 UNIQUE 에 걸리므로 같이 본다
    const [[same]] = await conn.query(`
      SELECT reservation_status FROM reservation
      WHERE  patient_no = ? AND schedule_no = ?
    `, [patientNo, scheduleNo]);
    if (same && same.reservation_status === '취소') {
      throw new RuleError('이 시간대는 예약했다가 취소한 기록이 있어 다시 예약할 수 없습니다. 다른 시간을 선택해 주세요.');
    }
    if (same) throw new RuleError('이미 이 시간대에 예약되어 있습니다.');

    // 4) 같은 날짜·같은 진료과에 살아 있는 예약이 있는지
    const [dup] = await conn.query(`
      SELECT r.reservation_no
      FROM   reservation      r
      JOIN   medical_schedule ms ON ms.schedule_no = r.schedule_no
      JOIN   employee         e  ON e.employee_no  = ms.employee_no
      WHERE  r.patient_no = ?
        AND  ms.schedule_date = ?
        AND  e.dept_code = ?
        AND  r.reservation_status IN ('예약', '접수')
    `, [patientNo, ms.schedule_date, ms.dept_code]);
    if (dup.length) throw new RuleError('같은 날 같은 진료과에 이미 예약이 있습니다.');

    // 5) 정원 검사 — 일정 줄을 잠근 상태라 이 숫자는 COMMIT 전까지 바뀌지 않는다
    const [[{ cnt }]] = await conn.query(`
      SELECT COUNT(*) AS cnt FROM reservation
      WHERE  schedule_no = ? AND reservation_status <> '취소'
    `, [scheduleNo]);
    if (cnt >= ms.capacity) throw new RuleError('정원이 다 찼습니다. 다른 시간을 선택해 주세요.');

    // 6) 예약번호 R{오늘날짜}-{4자리 순번} — 같은 날 만든 마지막 번호 +1
    //    다른 일정을 동시에 예약하면 같은 번호가 나올 수 있다.
    //    그때는 PK 중복 오류가 나고, 아래 createWithRetry 가 처음부터 다시 한다.
    const [[{ prefix }]] = await conn.query(
      `SELECT CONCAT('R', DATE_FORMAT(NOW(), '%Y%m%d'), '-') AS prefix`);
    const [[last]] = await conn.query(`
      SELECT reservation_no FROM reservation
      WHERE  reservation_no LIKE ?
      ORDER BY reservation_no DESC
      LIMIT 1
    `, [prefix + '%']);
    const seq = last ? Number(last.reservation_no.slice(prefix.length)) + 1 : 1;
    const newNo = prefix + String(seq).padStart(4, '0');

    // 7) 예약시각 — 진료 시간을 정원으로 나눈 칸 중 cnt 번째 칸
    //    예) 09:00~12:00, 정원 12명 → 15분 간격, 세 번째 예약은 09:30
    await conn.query(`
      INSERT INTO reservation (reservation_no, schedule_no, reserved_at, reservation_type,
                               reservation_status, canceled_at, reception_at, waiting_no,
                               patient_no, created_at)
      VALUES (?, ?,
              TIMESTAMP(?, ?) + INTERVAL
                FLOOR(TIME_TO_SEC(TIMEDIFF(?, ?)) / ? * ?) SECOND,
              ?, '예약', NULL, NULL, NULL, ?, NOW())
    `, [newNo, scheduleNo,
        ms.schedule_date, ms.start_time,
        ms.end_time, ms.start_time, ms.capacity, cnt,
        ms.is_today ? '당일' : '사전예약', patientNo]);

    return newNo;
  };

  try {
    const reservationNo = await createWithRetry();
    return flashRedirect(req, res, 'ok', `예약되었습니다. (예약번호 ${reservationNo})`, listPathFor(user));
  } catch (err) {
    let text;
    if (err instanceof RuleError) {
      text = err.message;
    } else if (err.code === 'ER_DUP_ENTRY') {
      // 검사를 지나쳤어도 DB 의 UNIQUE 가 마지막으로 막아 준다
      text = '이미 이 시간대에 예약되어 있습니다.';
    } else {
      console.error('예약 저장 오류:', err);
      text = '예약 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.';
    }
    return flashRedirect(req, res, 'danger', text, back);
  }
});


// ④ 예약 취소 (원무) — 삭제하지 않고 상태 '취소' + 취소일시 기록
//
//    '예약' 상태일 때만 취소된다 (접수·진료완료는 취소 불가).
//    검사를 UPDATE 의 WHERE 에 같이 넣었으므로
//    동시에 접수·취소가 들어와도 둘 중 하나만 성공한다.
//    (환자 본인 취소는 routes/patient.js — 조원5)
router.post('/:no/cancel', requireRole('원무'), async (req, res) => {
  const no = req.params.no;
  try {
    const [result] = await db.query(`
      UPDATE reservation
      SET    reservation_status = '취소',
             canceled_at        = NOW()
      WHERE  reservation_no     = ?
        AND  reservation_status = '예약'
    `, [no]);

    if (result.affectedRows === 1) {
      return flashRedirect(req, res, 'ok', `예약 ${no} 을(를) 취소했습니다.`, '/reservation/office');
    }

    // 왜 안 됐는지 알려 주기
    const [[r]] = await db.query(
      'SELECT reservation_status FROM reservation WHERE reservation_no = ?', [no]);
    const text = !r ? '없는 예약입니다.'
               : r.reservation_status === '취소' ? '이미 취소된 예약입니다.'
               : `'${r.reservation_status}' 상태인 예약은 취소할 수 없습니다.`;
    return flashRedirect(req, res, 'danger', text, '/reservation/office');
  } catch (err) {
    console.error('예약 취소 오류:', err);
    return flashRedirect(req, res, 'danger', '취소 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.', '/reservation/office');
  }
});


// ⑤ 접수 — 상태 '접수' + 접수일시 + 대기번호
//
//    대기번호는 담당 의사·접수일자별로 1번부터 매긴다.
//    둘이 동시에 접수하면 같은 번호를 받을 수 있으므로,
//    담당 의사 줄을 FOR UPDATE 로 잠가 같은 의사의 접수를 한 줄로 세운다.
router.post('/:no/reception', requireRole('원무'), async (req, res) => {
  try {
    const waitingNo = await inTransaction(async (conn) => {
      // 1) 예약 잠그고 읽기
      const [[r]] = await conn.query(`
        SELECT r.reservation_status, ms.employee_no, ms.operation_status,
               ms.schedule_date = CURDATE() AS is_today
        FROM   reservation      r
        JOIN   medical_schedule ms ON ms.schedule_no = r.schedule_no
        WHERE  r.reservation_no = ?
        FOR UPDATE
      `, [req.params.no]);

      if (!r)                              throw new RuleError('없는 예약입니다.');
      if (r.reservation_status !== '예약')  throw new RuleError(`'${r.reservation_status}' 상태인 예약은 접수할 수 없습니다.`);
      if (r.operation_status !== '정상')    throw new RuleError('휴진인 일정은 접수할 수 없습니다.');
      if (!r.is_today)                     throw new RuleError('진료 당일에만 접수할 수 있습니다.');

      // 2) 담당 의사 줄을 잠근 뒤, 오늘 그 의사에게 매긴 가장 큰 번호 + 1
      await conn.query('SELECT employee_no FROM employee WHERE employee_no = ? FOR UPDATE',
                       [r.employee_no]);
      const [[{ next_no }]] = await conn.query(`
        SELECT COALESCE(MAX(r.waiting_no), 0) + 1 AS next_no
        FROM   reservation      r
        JOIN   medical_schedule ms ON ms.schedule_no = r.schedule_no
        WHERE  ms.employee_no     = ?
          AND  DATE(r.reception_at) = CURDATE()
      `, [r.employee_no]);

      await conn.query(`
        UPDATE reservation
        SET    reservation_status = '접수',
               reception_at       = NOW(),
               waiting_no         = ?
        WHERE  reservation_no     = ?
      `, [next_no, req.params.no]);

      return next_no;
    });

    return flashRedirect(req, res, 'ok', `접수했습니다. 대기번호 ${waitingNo}번`, '/reservation/office');
  } catch (err) {
    let text = err.message;
    if (!(err instanceof RuleError)) {
      console.error('접수 오류:', err);
      text = '접수 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.';
    }
    return flashRedirect(req, res, 'danger', text, '/reservation/office');
  }
});


// ⑥ 진료 일정 목록 — 오늘 이후 일정과 살아 있는 예약 수, [휴진] 버튼
router.get('/schedules', requireRole('원무'), async (req, res) => {
  const [rows] = await db.query(`
    SELECT ms.schedule_no,
           DATE_FORMAT(ms.schedule_date, '%Y-%m-%d') AS schedule_date,
           DATE_FORMAT(ms.start_time, '%H:%i')       AS start_time,
           DATE_FORMAT(ms.end_time,   '%H:%i')       AS end_time,
           d.dept_name,
           e.employee_name,
           ms.capacity,
           ms.operation_status,
           COUNT(CASE WHEN r.reservation_status = '예약' THEN 1 END) AS reserved_count,
           COUNT(CASE WHEN r.reservation_status IN ('접수', '진료완료') THEN 1 END) AS received_count
    FROM      medical_schedule ms
    JOIN      employee         e ON e.employee_no = ms.employee_no
    JOIN      department       d ON d.dept_code   = e.dept_code
    LEFT JOIN reservation      r ON r.schedule_no = ms.schedule_no
    WHERE     ms.schedule_date >= CURDATE()
    GROUP BY  ms.schedule_no, ms.schedule_date, ms.start_time, ms.end_time,
              d.dept_name, e.employee_name, ms.capacity, ms.operation_status
    ORDER BY  ms.schedule_date, ms.start_time, e.employee_name
  `);

  res.render('reservation/schedules', { rows });
});


// ⑦ 휴진 처리 (R-0031)
//    일정을 '휴진' 으로 바꾸고, 그 일정의 '예약' 상태 예약을 전부 '취소' + 취소일시.
//    두 UPDATE 를 한 트랜잭션으로 묶는다 — 하나만 되고 하나가 실패하면
//    "휴진인데 예약은 살아 있는" 상태가 남기 때문이다.
//    일정 줄을 FOR UPDATE 로 잠가, 휴진 처리 중에 새 예약·접수가 끼어들지 못하게 한다.
//    (예약하기·접수도 같은 일정 줄을 잠그므로 차례로 처리된다)
router.post('/schedules/:no/close', requireRole('원무'), async (req, res) => {
  const no = req.params.no;
  try {
    const canceled = await inTransaction(async (conn) => {
      const [[ms]] = await conn.query(`
        SELECT operation_status, schedule_date >= CURDATE() AS not_past
        FROM   medical_schedule
        WHERE  schedule_no = ?
        FOR UPDATE
      `, [no]);

      if (!ms)                            throw new RuleError('없는 진료 일정입니다.');
      if (ms.operation_status === '휴진')  throw new RuleError('이미 휴진 처리된 일정입니다.');
      if (!ms.not_past)                   throw new RuleError('지난 일정은 휴진 처리할 수 없습니다.');

      // 이미 접수했거나 진료가 끝난 환자가 있으면 막는다 (환자가 병원에 와 있다)
      const [[{ cnt }]] = await conn.query(`
        SELECT COUNT(*) AS cnt FROM reservation
        WHERE  schedule_no = ? AND reservation_status IN ('접수', '진료완료')
      `, [no]);
      if (cnt > 0) throw new RuleError(`이미 접수된 환자가 ${cnt}명 있어 휴진 처리할 수 없습니다.`);

      await conn.query(
        "UPDATE medical_schedule SET operation_status = '휴진' WHERE schedule_no = ?", [no]);

      const [result] = await conn.query(`
        UPDATE reservation
        SET    reservation_status = '취소',
               canceled_at        = NOW()
        WHERE  schedule_no        = ?
          AND  reservation_status = '예약'
      `, [no]);

      return result.affectedRows;
    });

    return flashRedirect(req, res, 'ok',
      `일정 ${no} 을(를) 휴진 처리했습니다. 예약 ${canceled}건이 함께 취소되었습니다.`,
      '/reservation/schedules');
  } catch (err) {
    let text = err.message;
    if (!(err instanceof RuleError)) {
      console.error('휴진 처리 오류:', err);
      text = '휴진 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.';
    }
    return flashRedirect(req, res, 'danger', text, '/reservation/schedules');
  }
});


module.exports = router;
