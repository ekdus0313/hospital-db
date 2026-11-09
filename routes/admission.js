// =====================================================
// routes/admission.js — 입원·수납·관리자 (조원4)
//
// app.js 에서 '/admission' 아래에 붙인다.
//
//   [조회 — 6·7주차]
//   GET  /admission/beds                병상 현황 (관리자·원무)
//   GET  /admission/payments            수납 대상 목록 (원무·관리자)
//
//   [저장 — 8·9주차]
//   GET  /admission/new                 입원 수속 화면 (원무)
//   POST /admission/new                 입원 저장 + 병상 '사용중'
//   GET  /admission/inpatients          입원 현황 — 입원중 환자 목록 (원무·관리자)
//   POST /admission/:no/discharge       퇴원 처리 + 병상 '사용가능'
//   GET  /admission/payments/:mrno      진료비 계산 화면 (원무)
//   POST /admission/payments/:mrno      수납 처리 (결제수단·수납일시 기록)
//
// 저장은 모두 트랜잭션 안에서 "먼저 확인 → 문제 있으면 거절 → 없으면 저장".
// 여러 테이블을 같이 바꾸는 저장(입원+병상, 퇴원+병상)은 둘 다 되거나 둘 다 안 된다.
// =====================================================

const express = require('express');
const db = require('../db/db');
const { requireRole } = require('./auth');

const router = express.Router();

const FEE_CODE    = 'F01';                              // 외래 진찰료 (seed.sql)
const PAY_METHODS = ['현금', '신용카드', '체크카드'];


// ── 공통 함수 ────────────────────────────────────────

// 오늘 날짜를 'YYYYMMDD' 로 — 입원번호·수납번호 만들 때 쓴다
function today8() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// 다음 번호 만들기: 'H20261109-' + 001, 'B20261109-' + 0001
// 같은 날 마지막 번호 + 1. 트랜잭션 안에서 FOR UPDATE 로 읽어
// 두 사람이 동시에 같은 번호를 받지 않게 한다.
async function nextNo(conn, table, column, prefix, digits) {
  const [rows] = await conn.query(
    `SELECT ${column} AS no FROM ${table}
      WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1 FOR UPDATE`,
    [prefix + '%']
  );
  const last = rows.length ? Number(rows[0].no.slice(prefix.length)) : 0;
  return prefix + String(last + 1).padStart(digits, '0');
}

// 진료비 계산 — 5주차 member4.sql ⑤ 쿼리를 진료 1건용으로.
// 검사와 처방을 한 번에 JOIN 하면 행이 곱해지므로 항목마다 따로 더한다.
// 본인부담금 = 청구금액 × copay_rate / 100, 10원 미만 절사.
async function calcBill(conn, mrno) {
  const [rows] = await conn.query(`
    SELECT x.*,
           x.consult_amount + x.test_amount + x.drug_amount + x.room_amount AS total_amount,
           FLOOR((x.consult_amount + x.test_amount + x.drug_amount + x.room_amount)
                 * x.copay_rate / 100 / 10) * 10                            AS patient_amount
    FROM (
      SELECT m.medical_record_no,
             DATE_FORMAT(m.treated_at, '%Y-%m-%d %H:%i')   AS treated_at,
             p.patient_name,
             i.insurance_name,
             i.copay_rate,
             (SELECT fee_amount FROM consultation_fee WHERE fee_code = ?) AS consult_amount,
             (SELECT COALESCE(SUM(t.applied_price), 0)
                FROM test t
               WHERE t.medical_record_no = m.medical_record_no
                 AND COALESCE(t.test_status, '') <> '취소')                AS test_amount,
             (SELECT COALESCE(SUM(pr.applied_price * pr.dose_once * pr.dose_per_day * pr.dose_days), 0)
                FROM prescription pr
               WHERE pr.medical_record_no = m.medical_record_no)            AS drug_amount,
             (SELECT COALESCE(SUM(GREATEST(DATEDIFF(DATE(a.discharge_at), DATE(a.admit_at)), 1) * r.daily_fee), 0)
                FROM admission a
                JOIN bed  b ON b.bed_no  = a.bed_no
                JOIN room r ON r.room_no = b.room_no
               WHERE a.medical_record_no = m.medical_record_no
                 AND a.discharge_at IS NOT NULL)                            AS room_amount,
             (SELECT a.adm_status FROM admission a
               WHERE a.medical_record_no = m.medical_record_no)             AS adm_status,
             (SELECT pm.pay_status FROM payment pm
               WHERE pm.medical_record_no = m.medical_record_no)            AS pay_status
      FROM  medical_record m
      JOIN  patient   p ON p.patient_no     = m.patient_no
      JOIN  insurance i ON i.insurance_code = p.insurance_code
      WHERE m.medical_record_no = ?
    ) x
  `, [FEE_CODE, mrno]);
  return rows[0] || null;
}


// ① 병상 현황 — 관리자 첫 화면 (원무도 입원 수속 때 빈 병상을 본다, R-0023)
router.get('/beds', requireRole('관리자', '원무'), async (req, res) => {
  try {
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

    // 입원 → 진료기록 → 환자 (입원 테이블에는 환자번호가 없다)
    const [beds] = await db.query(`
      SELECT b.bed_no,
             r.room_no,
             r.room_type,
             b.bed_status,
             p.patient_name,
             DATE_FORMAT(a.admit_at, '%Y-%m-%d') AS admit_at
      FROM      bed            b
      JOIN      room           r  ON r.room_no            = b.room_no
      LEFT JOIN admission      a  ON a.bed_no             = b.bed_no
                                 AND a.adm_status         = '입원중'
      LEFT JOIN medical_record mr ON mr.medical_record_no = a.medical_record_no
      LEFT JOIN patient        p  ON p.patient_no         = mr.patient_no
      ORDER BY  b.bed_no
    `);

    const total = rooms.reduce((sum, r) => sum + Number(r.total_beds), 0);
    const used  = rooms.reduce((sum, r) => sum + Number(r.used_beds), 0);
    const rate  = total === 0 ? 0 : Math.round((used / total) * 100);

    res.render('admission/beds', { rooms, beds, total, used, rate });
  } catch (err) {
    console.error('병상 현황 조회 오류:', err);
    res.status(500).send('병상 현황을 불러오는 중 오류가 발생했습니다.');
  }
});


// ② 수납 대상 목록 — 수납 행이 없거나 '미수납'인 진료 (R-0028)
router.get('/payments', requireRole('원무', '관리자'), async (req, res) => {
  try {
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
             a.adm_status
      FROM      medical_record mr
      JOIN      patient        p  ON p.patient_no         = mr.patient_no
      JOIN      employee       e  ON e.employee_no        = mr.employee_no
      JOIN      department     d  ON d.dept_code          = e.dept_code
      LEFT JOIN payment        pm ON pm.medical_record_no = mr.medical_record_no
      LEFT JOIN admission      a  ON a.medical_record_no  = mr.medical_record_no
      WHERE     pm.payment_no IS NULL
         OR     pm.pay_status = '미수납'
      ORDER BY  mr.treated_at
    `);
    res.render('admission/payments', { rows, msg: req.query.msg, err: req.query.err });
  } catch (err) {
    console.error('수납 대상 조회 오류:', err);
    res.status(500).send('수납 대상을 불러오는 중 오류가 발생했습니다.');
  }
});


// ③ 입원 수속 화면 — 원무가 "진료기록"과 "빈 병상"만 고른다.
//    환자·주치의는 진료기록에서 따라온다 (입원 테이블에는 두지 않는다).
router.get('/new', requireRole('원무'), async (req, res) => {
  try {
    // 입원 근거로 고를 수 있는 진료:
    //   아직 입원 기록이 없고(진료 1건당 입원 1건), 수납이 끝나지 않았고
    //   (끝났으면 병실료를 더할 곳이 없다), 환자가 지금 입원중이 아닌 진료
    const [records] = await db.query(`
      SELECT mr.medical_record_no,
             DATE_FORMAT(mr.treated_at, '%Y-%m-%d %H:%i') AS treated_at,
             p.patient_name,
             e.employee_name
      FROM      medical_record mr
      JOIN      patient        p  ON p.patient_no         = mr.patient_no
      JOIN      employee       e  ON e.employee_no        = mr.employee_no
      LEFT JOIN admission      a  ON a.medical_record_no  = mr.medical_record_no
      LEFT JOIN payment        pm ON pm.medical_record_no = mr.medical_record_no
      WHERE a.admission_no IS NULL
        AND (pm.payment_no IS NULL OR pm.pay_status <> '완료')
        AND NOT EXISTS (SELECT 1
                          FROM admission a2
                          JOIN medical_record m2 ON m2.medical_record_no = a2.medical_record_no
                         WHERE m2.patient_no = mr.patient_no
                           AND a2.adm_status = '입원중')
      ORDER BY mr.treated_at DESC
    `);

    const [beds] = await db.query(`
      SELECT b.bed_no, r.room_type, r.daily_fee
      FROM   bed  b
      JOIN   room r ON r.room_no = b.room_no
      WHERE  b.bed_status = '사용가능'
      ORDER  BY b.bed_no
    `);

    res.render('admission/new', { records, beds, err: req.query.err });
  } catch (err) {
    console.error('입원 수속 화면 오류:', err);
    res.status(500).send('입원 수속 화면을 불러오는 중 오류가 발생했습니다.');
  }
});


// ④ 입원 저장 — 입원 INSERT + 병상 '사용중'을 한 트랜잭션으로
router.post('/new', requireRole('원무'), async (req, res) => {
  const { medical_record_no, bed_no } = req.body;
  const fail = msg => res.redirect('/admission/new?err=' + encodeURIComponent(msg));

  if (!medical_record_no || !bed_no) return fail('진료기록과 병상을 모두 골라 주세요.');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // [9주차] 1. 진료기록이 있는지 — 잠가서 같은 진료로 동시에 입원하지 못하게
    const [mr] = await conn.query(
      'SELECT patient_no FROM medical_record WHERE medical_record_no = ? FOR UPDATE',
      [medical_record_no]
    );
    if (mr.length === 0) throw new Error('없는 진료기록입니다.');

    // [9주차] 2. 이 진료로 이미 입원했는지 (진료 1건당 입원 1건 — UNIQUE 도 막지만 먼저 알려 준다)
    const [dupAdm] = await conn.query(
      'SELECT 1 FROM admission WHERE medical_record_no = ?', [medical_record_no]
    );
    if (dupAdm.length) throw new Error('이미 입원 처리된 진료입니다.');

    // [9주차] 3. 이미 수납이 끝난 진료인지 — 병실료를 합산할 수납이 없다
    const [paid] = await conn.query(
      "SELECT 1 FROM payment WHERE medical_record_no = ? AND pay_status = '완료'",
      [medical_record_no]
    );
    if (paid.length) throw new Error('이미 수납이 끝난 진료라 입원 근거로 쓸 수 없습니다.');

    // [9주차] 4. 같은 환자가 지금 입원중인지 (R-0023: 동시에 두 건 입원 불가)
    //         입원 테이블에 환자번호가 없으므로 진료기록을 거쳐 확인한다
    const [inpatient] = await conn.query(`
      SELECT 1
      FROM   admission a
      JOIN   medical_record m ON m.medical_record_no = a.medical_record_no
      WHERE  m.patient_no = ? AND a.adm_status = '입원중'
    `, [mr[0].patient_no]);
    if (inpatient.length) throw new Error('이미 입원 중인 환자입니다.');

    // [9주차] 5. 병상 잡기 — '사용가능'일 때만 '사용중'으로 바뀐다 (R-0025)
    //         두 사람이 같은 병상을 동시에 골라도 한 명만 바꾸는 데 성공한다
    const [upd] = await conn.query(
      "UPDATE bed SET bed_status = '사용중' WHERE bed_no = ? AND bed_status = '사용가능'",
      [bed_no]
    );
    if (upd.affectedRows === 0) throw new Error('이미 사용중인 병상입니다. 다른 병상을 골라 주세요.');

    // 6. 입원 저장
    const admissionNo = await nextNo(conn, 'admission', 'admission_no', `H${today8()}-`, 3);
    await conn.query(`
      INSERT INTO admission (admission_no, admit_at, discharge_at, adm_status, bed_no, medical_record_no)
      VALUES (?, NOW(), NULL, '입원중', ?, ?)
    `, [admissionNo, bed_no, medical_record_no]);

    await conn.commit();
    res.redirect('/admission/inpatients?msg=' + encodeURIComponent(`${admissionNo} 입원 처리했습니다 (병상 ${bed_no}).`));
  } catch (err) {
    await conn.rollback();
    if (err.code) console.error('입원 저장 오류:', err);
    fail(err.code === 'ER_DUP_ENTRY' ? '이미 입원 처리된 진료입니다.'
         : err.code ? '저장 중 오류가 발생했습니다.' : err.message);
  } finally {
    conn.release();
  }
});


// ⑤ 입원 현황 — 지금 입원중인 환자와 퇴원 버튼
router.get('/inpatients', requireRole('원무', '관리자'), async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.admission_no,
             DATE_FORMAT(a.admit_at, '%Y-%m-%d %H:%i')  AS admit_at,
             GREATEST(DATEDIFF(CURDATE(), DATE(a.admit_at)), 1) AS days_so_far,
             a.bed_no,
             r.room_type,
             p.patient_name,
             e.employee_name                             AS doctor_name,
             a.medical_record_no
      FROM   admission      a
      JOIN   bed            b  ON b.bed_no             = a.bed_no
      JOIN   room           r  ON r.room_no            = b.room_no
      JOIN   medical_record mr ON mr.medical_record_no = a.medical_record_no
      JOIN   patient        p  ON p.patient_no         = mr.patient_no
      JOIN   employee       e  ON e.employee_no        = mr.employee_no
      WHERE  a.adm_status = '입원중'
      ORDER  BY a.admit_at
    `);
    res.render('admission/inpatients', { rows, msg: req.query.msg, err: req.query.err });
  } catch (err) {
    console.error('입원 현황 조회 오류:', err);
    res.status(500).send('입원 현황을 불러오는 중 오류가 발생했습니다.');
  }
});


// ⑥ 퇴원 — 입원 '퇴원'·퇴원일시 + 병상 '사용가능'을 한 트랜잭션으로
router.post('/:no/discharge', requireRole('원무'), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // [9주차] 입원중인 입원만 퇴원할 수 있다 (두 번 누르면 두 번째는 거절)
    const [rows] = await conn.query(
      "SELECT bed_no FROM admission WHERE admission_no = ? AND adm_status = '입원중' FOR UPDATE",
      [req.params.no]
    );
    if (rows.length === 0) throw new Error('이미 퇴원했거나 없는 입원입니다.');

    await conn.query(
      "UPDATE admission SET discharge_at = NOW(), adm_status = '퇴원' WHERE admission_no = ?",
      [req.params.no]
    );
    await conn.query(
      "UPDATE bed SET bed_status = '사용가능' WHERE bed_no = ?",
      [rows[0].bed_no]
    );

    await conn.commit();
    res.redirect('/admission/payments?msg=' + encodeURIComponent(
      `${req.params.no} 퇴원 처리했습니다. 병상 ${rows[0].bed_no} 이(가) 비었습니다. 아래에서 진료비를 정산하세요.`));
  } catch (err) {
    await conn.rollback();
    if (err.code) console.error('퇴원 처리 오류:', err);
    res.redirect('/admission/inpatients?err=' + encodeURIComponent(
      err.code ? '퇴원 처리 중 오류가 발생했습니다.' : err.message));
  } finally {
    conn.release();
  }
});


// ⑦ 진료비 계산 화면 — 수납 버튼을 누르면 오는 곳
router.get('/payments/:mrno', requireRole('원무'), async (req, res) => {
  try {
    const bill = await calcBill(db, req.params.mrno);
    if (!bill) return res.status(404).send('없는 진료기록입니다.');
    res.render('admission/pay', { bill, methods: PAY_METHODS, err: req.query.err });
  } catch (err) {
    console.error('진료비 계산 오류:', err);
    res.status(500).send('진료비를 계산하는 중 오류가 발생했습니다.');
  }
});


// ⑧ 수납 처리 — 금액은 화면에서 받지 않고 서버에서 다시 계산한다
router.post('/payments/:mrno', requireRole('원무'), async (req, res) => {
  const mrno = req.params.mrno;
  const { pay_method } = req.body;
  const back = msg => res.redirect(`/admission/payments/${encodeURIComponent(mrno)}?err=` + encodeURIComponent(msg));

  // [9주차] 결제수단은 정해진 값만
  if (!PAY_METHODS.includes(pay_method)) return back('결제수단을 골라 주세요.');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 진료기록을 잠가서 같은 진료를 두 명이 동시에 수납하지 못하게
    const [mr] = await conn.query(
      'SELECT 1 FROM medical_record WHERE medical_record_no = ? FOR UPDATE', [mrno]
    );
    if (mr.length === 0) throw new Error('없는 진료기록입니다.');

    const bill = await calcBill(conn, mrno);

    // [9주차] 입원중이면 병실료가 정해지지 않았다 → 퇴원 후 정산
    if (bill.adm_status === '입원중') throw new Error('입원 중인 환자입니다. 퇴원 처리 후 수납해 주세요.');
    // [9주차] 이미 수납 완료면 거절 (두 번 결제 방지)
    if (bill.pay_status === '완료') throw new Error('이미 수납이 끝난 진료입니다.');

    if (bill.pay_status === '미수납') {
      // 미수납 행이 이미 있으면 금액을 다시 계산한 값으로 덮어쓰고 완료로
      await conn.query(`
        UPDATE payment
           SET consult_amount = ?, test_amount = ?, drug_amount = ?, room_amount = ?,
               total_amount = ?, patient_amount = ?,
               pay_method = ?, paid_at = NOW(), pay_status = '완료', fee_code = ?
         WHERE medical_record_no = ?
      `, [bill.consult_amount, bill.test_amount, bill.drug_amount, bill.room_amount,
          bill.total_amount, bill.patient_amount, pay_method, FEE_CODE, mrno]);
    } else {
      // 수납 행이 없으면 새로 만든다
      const paymentNo = await nextNo(conn, 'payment', 'payment_no', `B${today8()}-`, 4);
      await conn.query(`
        INSERT INTO payment (payment_no, consult_amount, test_amount, drug_amount, room_amount,
                             total_amount, patient_amount, pay_method, paid_at, pay_status,
                             fee_code, medical_record_no)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), '완료', ?, ?)
      `, [paymentNo, bill.consult_amount, bill.test_amount, bill.drug_amount, bill.room_amount,
          bill.total_amount, bill.patient_amount, pay_method, FEE_CODE, mrno]);
    }

    await conn.commit();
    res.redirect('/admission/payments?msg=' + encodeURIComponent(
      `${bill.patient_name} 님 ${Number(bill.patient_amount).toLocaleString()}원 수납 완료 (${pay_method}).`));
  } catch (err) {
    await conn.rollback();
    if (err.code) console.error('수납 처리 오류:', err);
    back(err.code === 'ER_DUP_ENTRY' ? '이미 수납이 끝난 진료입니다.'
         : err.code ? '수납 처리 중 오류가 발생했습니다.' : err.message);
  } finally {
    conn.release();
  }
});


module.exports = router;
