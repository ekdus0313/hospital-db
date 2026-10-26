-- =====================================================================
-- db/queries/member4.sql  (조원4 · 5주차)
-- 진료비 계산 + 병상 현황 조회
-- Workbench에서는 아래 '진료번호' 자리에 실제 값을 넣어 실행한다.
-- 6주차에 routes/admission.js로 옮길 때는 그 자리를 ? 로 바꾼다.
-- =====================================================================
USE hospital;

-- ① 검사료 합계 (SUM)  — 7·9주차 진료비 계산에서 사용
--    지시 시점 검사비(applied_price)를 더한다. 취소된 검사는 뺀다.
--    검사가 하나도 없으면 NULL 대신 0이 나오도록 COALESCE를 씌운다.
SELECT COALESCE(SUM(applied_price), 0) AS test_amount
FROM test
WHERE medical_record_no = 'MR20261005-0031'
  AND COALESCE(test_status, '') <> '취소';
-- 기대값: 56300 (김한성, 업무분석서 06-6)


-- ② 약제료 합계 (SUM)  — 7·9주차 진료비 계산에서 사용
--    처방 시점 단가 × 총 투약량(1회 투약량 × 1일 투여횟수 × 투약일수)을 더한다.
SELECT COALESCE(SUM(applied_price * dose_once * dose_per_day * dose_days), 0) AS drug_amount
FROM prescription
WHERE medical_record_no = 'MR20261005-0031';
-- 기대값: 23730 (김한성, 업무분석서 06-4)


-- ③ 병실별 사용 중 병상 수 (COUNT)  — 6주차 관리자 첫 화면, 7주차 병상 현황 화면
--    병상이 0개인 병실도 보이도록 LEFT JOIN.
--    COUNT(CASE WHEN ... THEN 1 END)는 조건에 맞는 행만 센다.
SELECT r.ward,
       r.room_no,
       r.room_type,
       COUNT(b.bed_no)                                     AS total_beds,
       COUNT(CASE WHEN b.bed_status = '사용중' THEN 1 END) AS used_beds
FROM room r
LEFT JOIN bed b ON b.room_no = r.room_no
GROUP BY r.ward, r.room_no, r.room_type
ORDER BY r.room_no;
-- 기대값 (seed 기준): 5101 1/0, 5102 2/0, 5103 4/0 — 이수아가 퇴원해 사용중 병상이 없다.


-- ④ 병실료 (입원이 있는 진료만)  — 9주차 진료비 계산에서 사용
--    재원일수 = 퇴원일 − 입원일, 당일 입·퇴원은 1일 → GREATEST(…, 1)
--    날짜끼리 빼야 하므로 DATE()로 시각을 떼고 DATEDIFF.
SELECT a.admission_no,
       GREATEST(DATEDIFF(DATE(a.discharge_at), DATE(a.admit_at)), 1)               AS stay_days,
       r.daily_fee,
       GREATEST(DATEDIFF(DATE(a.discharge_at), DATE(a.admit_at)), 1) * r.daily_fee AS room_amount
FROM admission a
JOIN bed  b ON a.bed_no  = b.bed_no
JOIN room r ON b.room_no = r.room_no
WHERE a.medical_record_no = 'MR20261005-0033'
  AND a.discharge_at IS NOT NULL;
-- 기대값: 5일 × 42000 = 210000 (이수아, 업무분석서 06-5)


-- ⑤ 진료비 전체 계산 (①~④ 합치기)  — 업무분석서 06-6 금액 검증용, 9주차에 그대로 사용
--    주의: test와 prescription을 한 번에 JOIN하면 행이 곱해져 합계가 부풀려진다.
--          그래서 항목마다 따로 계산하는 서브쿼리로 쓴다.
--    본인부담금 = 청구금액 × copay_rate / 100, 10원 미만 절사 → FLOOR(x / 10) * 10
SELECT x.medical_record_no,
       x.patient_name,
       x.consult_amount,
       x.test_amount,
       x.drug_amount,
       x.room_amount,
       x.consult_amount + x.test_amount + x.drug_amount + x.room_amount AS total_amount,
       FLOOR((x.consult_amount + x.test_amount + x.drug_amount + x.room_amount)
             * x.copay_rate / 100 / 10) * 10                           AS patient_amount
FROM (
  SELECT m.medical_record_no,
         p.patient_name,
         i.copay_rate,
         (SELECT fee_amount FROM consultation_fee WHERE fee_code = 'F01') AS consult_amount,
         (SELECT COALESCE(SUM(t.applied_price), 0)
            FROM test t
           WHERE t.medical_record_no = m.medical_record_no
             AND COALESCE(t.test_status, '') <> '취소')                     AS test_amount,
         (SELECT COALESCE(SUM(pr.applied_price * pr.dose_once * pr.dose_per_day * pr.dose_days), 0)
            FROM prescription pr
           WHERE pr.medical_record_no = m.medical_record_no)                 AS drug_amount,
         (SELECT COALESCE(SUM(GREATEST(DATEDIFF(DATE(a.discharge_at), DATE(a.admit_at)), 1) * r.daily_fee), 0)
            FROM admission a
            JOIN bed  b ON a.bed_no  = b.bed_no
            JOIN room r ON b.room_no = r.room_no
           WHERE a.medical_record_no = m.medical_record_no
             AND a.discharge_at IS NOT NULL)                                 AS room_amount
  FROM medical_record m
  JOIN patient   p ON m.patient_no     = p.patient_no
  JOIN insurance i ON p.insurance_code = i.insurance_code
  WHERE m.medical_record_no IN ('MR20261005-0031', 'MR20261005-0033')
) x;
-- 기대값: 김한성 98430 / 29520, 이수아 301800 / 90540 (업무분석서 06-6, payment 테이블 값과 같음)
-- 진찰료 코드는 seed.sql의 'F01' (외래 진찰료 18,400)
