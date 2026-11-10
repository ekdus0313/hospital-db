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
// =====================================================

const express = require('express');

const db = require('../db/db');
const { requireRole } = require('./auth');

const router = express.Router();


// 오늘 날짜를 DB 의 시계에서 가져온다.
//
// Node 의 new Date().toISOString() 은 UTC 기준이라
// 한국 시각 0시~9시 사이에는 하루 전 날짜가 나온다.
// 그런데 저장되는 시각은 MySQL 의 NOW() 라서,
// 그대로 쓰면 "번호에 찍힌 날짜"와 "기록된 시각의 날짜"가 어긋난다.
// 일련번호도 날짜별로 세기 때문에 하루에 같은 번호가 두 번 나올 수 있다.
// 그래서 번호용 날짜도 NOW() 와 같은 시계에서 가져온다.
async function dbToday() {
  const [[row]] = await db.query(`
    SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS dashed,   -- 2026-11-11
           DATE_FORMAT(NOW(), '%Y%m%d')   AS compact   -- 20261111
  `);
  return row;
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


// ③ 검사 목록 + 검사실의 결과 입력 화면
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

  res.render('treatment/tests', { rows, error: req.query.error || null });
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


// ⑤ 진료기록 저장
//    예약 1건당 진료 1건이라 UNIQUE(reservation_no) 가 걸려 있다.
//    두 번 저장하면 DB 가 거부하고, 그 에러를 메시지로 바꿔 돌려준다.
router.post('/record', requireRole('의사'), async (req, res) => {
  const { reservation_no, patient_no, symptom, opinion } = req.body;

  try {
    if (!symptom || !symptom.trim()) {
      return res.status(400).send('증상을 입력해주세요.');
    }

    // 진료번호 만들기 — MR + 오늘 날짜 + 네 자리 일련번호
    const { compact: ymd } = await dbToday();
    const [[seq]] = await db.query(`
      SELECT COUNT(*) + 1 AS n
      FROM   medical_record
      WHERE  medical_record_no LIKE ?
    `, [`MR${ymd}-%`]);
    const recordNo = `MR${ymd}-${String(seq.n).padStart(4, '0')}`;

    await db.query(`
      INSERT INTO medical_record
        (medical_record_no, treated_at, symptom, opinion,
         patient_no, employee_no, reservation_no)
      VALUES (?, NOW(), ?, ?, ?, ?, ?)
    `, [recordNo, symptom.trim(), (opinion || '').trim(),
        patient_no, req.session.user.employee_no, reservation_no]);

    // 진료가 끝났으니 예약 상태를 바꾼다 (삭제하지 않는다)
    await db.query(`
      UPDATE reservation SET reservation_status = '진료완료'
      WHERE  reservation_no = ?
    `, [reservation_no]);

    res.redirect('/treatment/record/' + recordNo);

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).send('이미 이 예약으로 진료기록이 작성되었습니다.');
    }
    console.error('진료기록 저장 오류:', err);
    res.status(500).send('저장 중 오류가 발생했습니다.');
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
      record,
      diagnoses,
      prescriptions,
      tests,
      diseases,
      drugs,
      testItems,
      error: req.query.error || null
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

  try {
    if (!disease_code || !diagnosis_type) {
      return res.redirect(back + '?error=' +
        encodeURIComponent('질병과 구분을 선택해주세요.'));
    }

    if (diagnosis_type === '주진단') {
      const [[dup]] = await db.query(`
        SELECT COUNT(*) AS n
        FROM   diagnosis
        WHERE  medical_record_no = ? AND diagnosis_type = '주진단'
      `, [medical_record_no]);

      if (dup.n > 0) {
        return res.redirect(back + '?error=' +
          encodeURIComponent('주진단은 이미 등록되어 있습니다.'));
      }
    }

    await db.query(`
      INSERT INTO diagnosis (medical_record_no, disease_code, diagnosis_type)
      VALUES (?, ?, ?)
    `, [medical_record_no, disease_code, diagnosis_type]);

    res.redirect(back);

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.redirect(back + '?error=' +
        encodeURIComponent('이미 등록된 병명입니다.'));
    }
    console.error('진단 등록 오류:', err);
    res.status(500).send('저장 중 오류가 발생했습니다.');
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

  const fail = (msg) =>
    res.redirect(back + '?error=' + encodeURIComponent(msg));

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

    res.redirect(back);

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return fail('이미 처방된 약품입니다.');
    }
    console.error('처방 등록 오류:', err);
    res.status(500).send('저장 중 오류가 발생했습니다.');
  }
});


// ⑨ 검사 지시 — 의사가 지시만 한다. 검사일시·결과는 비워 둔다.
//    UNIQUE(진료번호, 검사코드) 라서 같은 검사를 두 번 지시하면 DB 가 거부한다.
//    검사비도 지시 시점의 가격을 복사해서 저장한다. (처방과 같은 이유)
router.post('/test', requireRole('의사'), async (req, res) => {
  const { medical_record_no, test_code } = req.body;
  const back = '/treatment/record/' + medical_record_no;

  const fail = (msg) =>
    res.redirect(back + '?error=' + encodeURIComponent(msg));

  try {
    if (!test_code) return fail('검사항목을 선택해주세요.');

    // 중단된 검사항목은 지시할 수 없다 + 지금 가격을 가져온다
    const [[item]] = await db.query(`
      SELECT test_price, use_status
      FROM   test_item
      WHERE  test_code = ?
    `, [test_code]);

    if (!item)                      return fail('등록되지 않은 검사항목입니다.');
    if (item.use_status !== '사용') return fail('더 이상 사용하지 않는 검사항목입니다.');

    // 검사번호 만들기 — EX + 오늘 날짜 + 네 자리 일련번호
    const { compact: ymd } = await dbToday();
    const [[seq]] = await db.query(`
      SELECT COUNT(*) + 1 AS n
      FROM   test
      WHERE  test_no LIKE ?
    `, [`EX${ymd}-%`]);
    const testNo = `EX${ymd}-${String(seq.n).padStart(4, '0')}`;

    await db.query(`
      INSERT INTO test
        (test_no, tested_at, test_result, applied_price,
         test_status, medical_record_no, test_code)
      VALUES (?, NULL, NULL, ?, '지시', ?, ?)
    `, [testNo, item.test_price, medical_record_no, test_code]);

    res.redirect(back);

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return fail('이미 지시된 검사입니다.');
    }
    console.error('검사 지시 오류:', err);
    res.status(500).send('저장 중 오류가 발생했습니다.');
  }
});


// ⑩ 검사 결과 입력 — 검사실만 할 수 있다.
//    '지시' 상태일 때만 바뀐다. WHERE 에 상태를 넣었으므로
//    이미 '완료' 된 검사는 결과가 덮어써지지 않는다.
router.post('/test/result', requireRole('검사실'), async (req, res) => {
  const { test_no, test_result } = req.body;
  const back = '/treatment/tests';

  const fail = (msg) =>
    res.redirect(back + '?error=' + encodeURIComponent(msg));

  try {
    if (!test_result || !test_result.trim()) {
      return fail('검사 결과를 입력해주세요.');
    }

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

    res.redirect(back);

  } catch (err) {
    console.error('검사 결과 입력 오류:', err);
    res.status(500).send('저장 중 오류가 발생했습니다.');
  }
});


module.exports = router;