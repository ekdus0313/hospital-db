// =====================================================
// routes/treatment.js — 진료·처방·검사 (조원3)
//
// app.js 에서 '/treatment' 아래에 붙인다.
//   GET  /treatment/doctor        의사 첫 화면 — 접수된 환자 목록
//   GET  /treatment/history       진료 이력 조회
//   GET  /treatment/tests         검사 목록 + 결과 입력
//   GET  /treatment/record/new    진료기록 작성 화면
//   POST /treatment/record        진료기록 저장
//   GET  /treatment/record/:no    진료기록 상세 — 진단·처방·검사 추가
//   POST /treatment/diagnosis     진단 등록
//   POST /treatment/prescription  처방 등록
//   POST /treatment/test          검사 지시
//   POST /treatment/test/result   검사 결과 입력
//
// [9주차] 규칙을 지키는 코드
//   · 테이블 두 개를 같이 바꾸는 저장은 트랜잭션으로 묶는다 (둘 다 되거나 둘 다 안 되거나)
//   · 번호는 같은 날 마지막 번호 + 1, 트랜잭션 안에서 잠그고 읽는다
//   · 화면에서 받은 값을 믿지 않는다 — 환자번호는 예약에서 다시 찾는다
//   · 알림은 공통 flash 로 (조원5가 만든 구조)
// =====================================================

const express = require('express');

const db = require('../db/db');
const { requireRole } = require('./auth');

const router = express.Router();


// ── 공통 함수 ────────────────────────────────────────

// 오늘 날짜를 DB 의 시계에서 가져온다.
//
// Node 의 new Date().toISOString() 은 UTC 기준이라
// 한국 시각 0시~9시 사이에는 하루 전 날짜가 나온다.
// 그런데 저장되는 시각은 MySQL 의 NOW() 라서,
// 그대로 쓰면 "번호에 찍힌 날짜"와 "기록된 시각의 날짜"가 어긋난다.
// 그래서 번호용 날짜도 NOW() 와 같은 시계에서 가져온다.
async function dbToday(conn = db) {
  const [[row]] = await conn.query(`
    SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS dashed,   -- 2026-11-11
           DATE_FORMAT(NOW(), '%Y%m%d')   AS compact   -- 20261111
  `);
  return row;
}

// 다음 번호 만들기: 'MR20261111-' + 0001, 'EX20261111-' + 0001
//
// 개수 + 1 로 세면 행을 하나라도 지웠을 때 번호가 겹친다.
// (3건 있다가 1건 지우면 다음이 3번인데 3번은 이미 있다 → PK 위반)
// 그래서 마지막 번호 + 1 로 센다.
// 트랜잭션 안에서 FOR UPDATE 로 읽어 두 사람이 같은 번호를 받지 않게 한다.
//
// ※ routes/admission.js 의 nextNo 와 같은 함수다.
//    9주차 이후에 lib/ 로 옮겨 하나만 두는 게 좋다.
async function nextNo(conn, table, column, prefix, digits) {
  const [rows] = await conn.query(
    `SELECT ${column} AS no FROM ${table}
      WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1 FOR UPDATE`,
    [prefix + '%']
  );
  const last = rows.length ? Number(rows[0].no.slice(prefix.length)) : 0;
  return prefix + String(last + 1).padStart(digits, '0');
}

// 알림 남기고 이동 — 공통 flash 구조 (조원5, app.js 참고)
// type: 'ok'(초록) · 'danger'(빨강) · 'warn'(주황) · 'info'(파랑)
function flashTo(req, res, type, text, to) {
  req.session.flash = { type, text };
  req.session.save(() => res.redirect(to));
}


// ① 의사 첫 화면 — 고른 날짜에 "나에게" 접수된 환자 목록
//    날짜를 안 고르면 오늘. 대기번호는 의사별·일자별로 1번부터라서
//    날짜를 거르지 않으면 어제 번호와 섞여 순서가 맞지 않는다.
router.get('/doctor', requireRole('의사'), async (req, res) => {
  try {
    const employeeNo = req.session.user.employee_no;

    const { dashed: today } = await dbToday();
    const date = req.query.date || today;

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
router.get('/history', requireRole('의사'), async (req, res) => {
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


// ③ 검사 목록 + 검사실의 결과 입력 화면
//    아직 결과가 안 나온 '지시' 건을 위로 올린다.
//    검사일시·검사결과는 지시 시점에 비어 있어서 NULL 이 올 수 있다.
router.get('/tests', requireRole('의사', '검사실'), async (req, res) => {
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


// ④ 진료기록 작성 화면 — 대기 환자 목록에서 "진료 시작" 을 누르면 온다
router.get('/record/new', requireRole('의사'), async (req, res) => {
  try {
    const reservationNo = req.query.reservation;
    if (!reservationNo) return res.status(400).send('예약번호가 없습니다.');

    // 이 예약이 내 것이고 접수 상태인지 확인하면서 환자 정보도 가져온다
    const [[info]] = await db.query(`
      SELECT r.reservation_no,
             p.patient_no,
             p.patient_name,
             DATE_FORMAT(r.reception_at, '%Y-%m-%d %H:%i') AS reception_at
      FROM   reservation      r
      JOIN   patient          p  ON p.patient_no   = r.patient_no
      JOIN   medical_schedule ms ON ms.schedule_no = r.schedule_no
      WHERE  r.reservation_no     = ?
        AND  r.reservation_status = '접수'
        AND  ms.employee_no       = ?
    `, [reservationNo, req.session.user.employee_no]);

    if (!info) return res.status(404).send('접수된 예약을 찾을 수 없습니다.');

    res.render('treatment/record-new', { info });
  } catch (err) {
    console.error('진료기록 작성 화면 오류:', err);
    res.status(500).send('화면을 불러오는 중 오류가 발생했습니다.');
  }
});


// ⑤ 진료기록 저장  [9주차 트랜잭션]
//
//    테이블 두 개를 같이 바꾼다.
//      1. medical_record 에 INSERT
//      2. reservation 의 상태를 '진료완료' 로 UPDATE
//
//    1만 되고 2가 안 되면, 진료기록은 생겼는데 예약은 '접수' 로 남는다.
//    그러면 그 환자가 대기 목록에 계속 떠 있고, 다시 진료를 시작하면
//    UNIQUE(reservation_no) 에 걸려 아무것도 못 하는 상태가 된다.
//    그래서 트랜잭션으로 묶어 둘 다 되거나 둘 다 안 되게 한다.
//
//    환자번호는 화면에서 받지 않고 예약에서 다시 찾는다.
//    숨겨진 칸(hidden)은 사용자가 고칠 수 있어서 믿으면 안 된다.
router.post('/record', requireRole('의사'), async (req, res) => {
  const { reservation_no, symptom, opinion } = req.body;
  const employeeNo = req.session.user.employee_no;
  const back = '/treatment/doctor';

  if (!reservation_no) {
    return flashTo(req, res, 'danger', '예약번호가 없습니다.', back);
  }
  if (!symptom || !symptom.trim()) {
    return flashTo(req, res, 'danger', '증상을 입력해주세요.', back);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 예약을 잠그고 확인한다.
    //   · 있는 예약인가
    //   · 아직 '접수' 상태인가 (이미 진료했거나 취소됐으면 안 된다)
    //   · 내 진료일정의 예약인가 (남의 환자를 진료할 수 없다)
    // 잠가 두면 확인과 저장 사이에 상태가 바뀌지 않는다.
    const [rv] = await conn.query(`
      SELECT r.patient_no,
             r.reservation_status,
             ms.employee_no
      FROM   reservation      r
      JOIN   medical_schedule ms ON ms.schedule_no = r.schedule_no
      WHERE  r.reservation_no = ?
      FOR UPDATE
    `, [reservation_no]);

    if (rv.length === 0)                      throw new Error('없는 예약입니다.');
    if (rv[0].reservation_status !== '접수')  throw new Error(`'${rv[0].reservation_status}' 상태인 예약으로는 진료기록을 쓸 수 없습니다.`);
    if (rv[0].employee_no !== employeeNo)     throw new Error('본인에게 접수된 환자만 진료할 수 있습니다.');

    // 진료번호 만들기 — MR + 오늘 날짜 + 네 자리
    const { compact: ymd } = await dbToday(conn);
    const recordNo = await nextNo(conn, 'medical_record', 'medical_record_no', `MR${ymd}-`, 4);

    // 1. 진료기록 저장 — 환자번호는 위에서 읽은 예약의 값을 쓴다
    await conn.query(`
      INSERT INTO medical_record
        (medical_record_no, treated_at, symptom, opinion,
         patient_no, employee_no, reservation_no)
      VALUES (?, NOW(), ?, ?, ?, ?, ?)
    `, [recordNo, symptom.trim(), (opinion || '').trim(),
        rv[0].patient_no, employeeNo, reservation_no]);

    // 2. 예약 상태 바꾸기 — 지우지 않고 상태만 바꾼다
    //    WHERE 에 상태를 한 번 더 걸어 두면 '접수'가 아닌 예약은 안 바뀐다
    const [upd] = await conn.query(`
      UPDATE reservation
      SET    reservation_status = '진료완료'
      WHERE  reservation_no = ? AND reservation_status = '접수'
    `, [reservation_no]);

    if (upd.affectedRows === 0) throw new Error('예약 상태가 바뀌어 저장하지 못했습니다.');

    await conn.commit();
    flashTo(req, res, 'ok', `${recordNo} 진료기록을 저장했습니다.`,
            '/treatment/record/' + recordNo);

  } catch (err) {
    await conn.rollback();
    if (err.code) console.error('진료기록 저장 오류:', err);
    flashTo(req, res, 'danger',
            err.code === 'ER_DUP_ENTRY' ? '이미 이 예약으로 진료기록이 작성되었습니다.'
            : err.code                  ? '저장 중 오류가 발생했습니다.'
            :                             err.message,
            back);
  } finally {
    conn.release();
  }
});


// ⑥ 진료기록 상세 — 진단·처방·검사를 여기서 추가한다
router.get('/record/:no', requireRole('의사'), async (req, res) => {
  try {
    const recordNo = req.params.no;

    const [[record]] = await db.query(`
      SELECT mr.medical_record_no,
             DATE_FORMAT(mr.treated_at, '%Y-%m-%d %H:%i') AS treated_at,
             mr.symptom,
             mr.opinion,
             p.patient_no,
             p.patient_name,
             e.employee_name
      FROM   medical_record mr
      JOIN   patient        p ON p.patient_no  = mr.patient_no
      JOIN   employee       e ON e.employee_no = mr.employee_no
      WHERE  mr.medical_record_no = ?
        AND  mr.employee_no       = ?
    `, [recordNo, req.session.user.employee_no]);

    if (!record) return res.status(404).send('진료기록을 찾을 수 없습니다.');

    // 이미 등록된 진단
    const [diagnoses] = await db.query(`
      SELECT dg.disease_code, ds.disease_name, dg.diagnosis_type
      FROM   diagnosis dg
      JOIN   disease   ds ON ds.disease_code = dg.disease_code
      WHERE  dg.medical_record_no = ?
      ORDER BY CASE dg.diagnosis_type WHEN '주진단' THEN 1 ELSE 2 END
    `, [recordNo]);

    // 이미 등록된 처방 — 약제료는 적용 단가 × 총 투약량
    const [prescriptions] = await db.query(`
      SELECT pr.drug_code, dr.drug_name, dr.drug_form,
             pr.dose_once, pr.dose_per_day, pr.dose_days,
             pr.applied_price,
             pr.applied_price * pr.dose_once * pr.dose_per_day * pr.dose_days AS amount
      FROM   prescription pr
      JOIN   drug         dr ON dr.drug_code = pr.drug_code
      WHERE  pr.medical_record_no = ?
      ORDER BY dr.drug_name
    `, [recordNo]);

    // 이미 지시한 검사
    const [tests] = await db.query(`
      SELECT t.test_no, t.test_status, t.applied_price,
             DATE_FORMAT(t.tested_at, '%Y-%m-%d %H:%i') AS tested_at,
             t.test_result,
             ti.test_name, ti.test_category
      FROM   test      t
      JOIN   test_item ti ON ti.test_code = t.test_code
      WHERE  t.medical_record_no = ?
      ORDER BY t.test_no
    `, [recordNo]);

    // 고를 수 있는 질병코드
    const [diseases] = await db.query(`
      SELECT disease_code, disease_name
      FROM   disease
      ORDER BY disease_code
    `);

    // 고를 수 있는 약품 — 단종된 약은 빼고 '사용' 중인 것만
    const [drugs] = await db.query(`
      SELECT drug_code, drug_name, drug_form, unit_price
      FROM   drug
      WHERE  use_status = '사용'
      ORDER BY drug_name
    `);

    // 고를 수 있는 검사항목 — '사용' 중인 것만
    const [testItems] = await db.query(`
      SELECT test_code, test_name, test_category, test_price
      FROM   test_item
      WHERE  use_status = '사용'
      ORDER BY test_category, test_name
    `);

    res.render('treatment/record-detail', {
      record, diagnoses, prescriptions, tests, diseases, drugs, testItems
    });
  } catch (err) {
    console.error('진료기록 상세 조회 오류:', err);
    res.status(500).send('화면을 불러오는 중 오류가 발생했습니다.');
  }
});


// ⑦ 진단 등록
//    (진료번호, 질병코드) 가 복합키라서 같은 병명을 두 번 넣으면
//    DB 가 거부한다. 그 에러를 메시지로 바꿔 돌려준다.
//    주진단이 하나뿐이어야 하는 건 DB 가 모르므로 코드에서 먼저 센다.
router.post('/diagnosis', requireRole('의사'), async (req, res) => {
  const { medical_record_no, disease_code, diagnosis_type } = req.body;
  const back = '/treatment/record/' + medical_record_no;
  const fail = msg => flashTo(req, res, 'danger', msg, back);

  try {
    if (!disease_code || !diagnosis_type) return fail('질병과 구분을 선택해주세요.');
    if (!['주진단', '부진단'].includes(diagnosis_type)) return fail('진단 구분이 올바르지 않습니다.');

    // 내 진료기록인지 확인 — 주소만 바꿔서 남의 진료에 진단을 달 수 없게
    const [[mine]] = await db.query(`
      SELECT 1 AS ok FROM medical_record
      WHERE  medical_record_no = ? AND employee_no = ?
    `, [medical_record_no, req.session.user.employee_no]);
    if (!mine) return fail('본인이 작성한 진료기록이 아닙니다.');

    if (diagnosis_type === '주진단') {
      const [[dup]] = await db.query(`
        SELECT COUNT(*) AS n
        FROM   diagnosis
        WHERE  medical_record_no = ? AND diagnosis_type = '주진단'
      `, [medical_record_no]);

      if (dup.n > 0) return fail('주진단은 이미 등록되어 있습니다.');
    }

    await db.query(`
      INSERT INTO diagnosis (medical_record_no, disease_code, diagnosis_type)
      VALUES (?, ?, ?)
    `, [medical_record_no, disease_code, diagnosis_type]);

    flashTo(req, res, 'ok', '진단을 등록했습니다.', back);

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail('이미 등록된 병명입니다.');
    console.error('진단 등록 오류:', err);
    fail('저장 중 오류가 발생했습니다.');
  }
});


// ⑧ 처방 등록
//    (진료번호, 약품코드) 가 복합키라서 같은 약을 두 번 넣으면 DB 가 거부한다.
//    적용 단가는 약품의 지금 단가를 복사해서 저장한다.
//    약값이 나중에 바뀌어도 과거 영수증 금액이 변하면 안 되기 때문이다.
router.post('/prescription', requireRole('의사'), async (req, res) => {
  const { medical_record_no, drug_code,
          dose_once, dose_per_day, dose_days } = req.body;
  const back = '/treatment/record/' + medical_record_no;
  const fail = msg => flashTo(req, res, 'danger', msg, back);

  try {
    if (!drug_code) return fail('약품을 선택해주세요.');

    const once   = Number(dose_once);
    const perDay = Number(dose_per_day);
    const days   = Number(dose_days);

    if (!Number.isInteger(once)   || once   < 1 ||
        !Number.isInteger(perDay) || perDay < 1 ||
        !Number.isInteger(days)   || days   < 1) {
      return fail('투약량·투여횟수·투약일수는 1 이상의 정수여야 합니다.');
    }

    // 내 진료기록인지 확인
    const [[mine]] = await db.query(`
      SELECT 1 AS ok FROM medical_record
      WHERE  medical_record_no = ? AND employee_no = ?
    `, [medical_record_no, req.session.user.employee_no]);
    if (!mine) return fail('본인이 작성한 진료기록이 아닙니다.');

    // 단종된 약은 처방할 수 없다 + 지금 단가를 가져온다
    const [[drug]] = await db.query(`
      SELECT unit_price, use_status
      FROM   drug
      WHERE  drug_code = ?
    `, [drug_code]);

    if (!drug)                      return fail('등록되지 않은 약품입니다.');
    if (drug.use_status !== '사용') return fail('더 이상 사용하지 않는 약품입니다.');

    await db.query(`
      INSERT INTO prescription
        (medical_record_no, drug_code, dose_once, dose_per_day, dose_days, applied_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [medical_record_no, drug_code, once, perDay, days, drug.unit_price]);

    flashTo(req, res, 'ok', `${drug_code} 처방을 등록했습니다.`, back);

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail('이미 처방된 약품입니다.');
    console.error('처방 등록 오류:', err);
    fail('저장 중 오류가 발생했습니다.');
  }
});


// ⑨ 검사 지시 — 의사가 지시만 한다. 검사일시·결과는 비워 둔다.
//    UNIQUE(진료번호, 검사코드) 라서 같은 검사를 두 번 지시하면 DB 가 거부한다.
//    검사비도 지시 시점의 가격을 복사해서 저장한다. (처방과 같은 이유)
//
//    검사번호를 만들기 때문에 트랜잭션 안에서 처리한다.
//    번호를 읽고 INSERT 하는 사이에 다른 사람이 같은 번호를 쓰면 안 된다.
router.post('/test', requireRole('의사'), async (req, res) => {
  const { medical_record_no, test_code } = req.body;
  const back = '/treatment/record/' + medical_record_no;
  const fail = msg => flashTo(req, res, 'danger', msg, back);

  if (!test_code) return fail('검사항목을 선택해주세요.');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 내 진료기록인지 확인하면서 잠근다
    const [mine] = await conn.query(`
      SELECT 1 AS ok FROM medical_record
      WHERE  medical_record_no = ? AND employee_no = ?
      FOR UPDATE
    `, [medical_record_no, req.session.user.employee_no]);
    if (mine.length === 0) throw new Error('본인이 작성한 진료기록이 아닙니다.');

    // 중단된 검사항목은 지시할 수 없다 + 지금 가격을 가져온다
    const [item] = await conn.query(`
      SELECT test_price, use_status
      FROM   test_item
      WHERE  test_code = ?
    `, [test_code]);

    if (item.length === 0)              throw new Error('등록되지 않은 검사항목입니다.');
    if (item[0].use_status !== '사용')  throw new Error('더 이상 사용하지 않는 검사항목입니다.');

    // 검사번호 만들기 — EX + 오늘 날짜 + 네 자리
    const { compact: ymd } = await dbToday(conn);
    const testNo = await nextNo(conn, 'test', 'test_no', `EX${ymd}-`, 4);

    await conn.query(`
      INSERT INTO test
        (test_no, tested_at, test_result, applied_price,
         test_status, medical_record_no, test_code)
      VALUES (?, NULL, NULL, ?, '지시', ?, ?)
    `, [testNo, item[0].test_price, medical_record_no, test_code]);

    await conn.commit();
    flashTo(req, res, 'ok', `${testNo} 검사를 지시했습니다.`, back);

  } catch (err) {
    await conn.rollback();
    if (err.code) console.error('검사 지시 오류:', err);
    fail(err.code === 'ER_DUP_ENTRY' ? '이미 지시된 검사입니다.'
         : err.code                  ? '저장 중 오류가 발생했습니다.'
         :                             err.message);
  } finally {
    conn.release();
  }
});


// ⑩ 검사 결과 입력 — 검사실만 할 수 있다.
//    '지시' 상태일 때만 바뀐다. WHERE 에 상태를 넣었으므로
//    이미 '완료' 된 검사는 결과가 덮어써지지 않는다.
router.post('/test/result', requireRole('검사실'), async (req, res) => {
  const { test_no, test_result } = req.body;
  const back = '/treatment/tests';
  const fail = msg => flashTo(req, res, 'danger', msg, back);

  try {
    if (!test_result || !test_result.trim()) return fail('검사 결과를 입력해주세요.');

    const [result] = await db.query(`
      UPDATE test
      SET    tested_at   = NOW(),
             test_result = ?,
             test_status = '완료'
      WHERE  test_no     = ?
        AND  test_status = '지시'
    `, [test_result.trim(), test_no]);

    if (result.affectedRows === 0) {
      return fail('지시 상태인 검사가 아닙니다. 이미 결과가 입력되었을 수 있습니다.');
    }

    flashTo(req, res, 'ok', `${test_no} 검사 결과를 저장했습니다.`, back);

  } catch (err) {
    console.error('검사 결과 입력 오류:', err);
    fail('저장 중 오류가 발생했습니다.');
  }
});


module.exports = router;