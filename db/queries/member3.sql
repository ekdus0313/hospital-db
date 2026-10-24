-- =====================================================
-- 진료 이력 조회 (조원3) — R-0014
-- 한 환자의 진료 이력을 1건당 1줄로 보여준다.
--
-- 설계 메모
--  · 진단은 서브쿼리로 뽑는다. JOIN 으로 가져오면 진단 2건과
--    처방 3건이 곱해져 6줄이 되고, DISTINCT 를 쓰면 주진단을
--    먼저 놓는 정렬을 할 수 없기 때문이다.
--  · 처방은 JOIN 후 GROUP BY 로 한 칸에 묶는다.
--  · 처방이 없는 진료도 목록에 나와야 하므로 LEFT JOIN 을 쓴다.
-- =====================================================
SELECT
    mr.medical_record_no                          AS 진료번호,
    DATE_FORMAT(mr.treated_at, '%Y-%m-%d %H:%i')  AS 진료일시,
    p.patient_name                                AS 환자,
    dp.dept_name                                  AS 진료과,
    e.employee_name                               AS 담당의사,
    mr.symptom                                    AS 증상,
    (SELECT GROUP_CONCAT(CONCAT(dg.diagnosis_type, ' ', ds.disease_name)
                         ORDER BY CASE dg.diagnosis_type
                                      WHEN '주진단' THEN 1
                                      ELSE 2
                                  END
                         SEPARATOR ' / ')
       FROM diagnosis dg
       JOIN disease   ds ON ds.disease_code = dg.disease_code
      WHERE dg.medical_record_no = mr.medical_record_no)   AS 진단,
    GROUP_CONCAT(CONCAT(dr.drug_name, ' ',
                        pr.dose_once,    '정 ',
                        pr.dose_per_day, '회 ',
                        pr.dose_days,    '일')
                 ORDER BY dr.drug_name
                 SEPARATOR ' / ')                 AS 처방
FROM       medical_record mr
JOIN       patient      p  ON p.patient_no         = mr.patient_no
JOIN       employee     e  ON e.employee_no        = mr.employee_no
JOIN       department   dp ON dp.dept_code         = e.dept_code
LEFT JOIN  prescription pr ON pr.medical_record_no = mr.medical_record_no
LEFT JOIN  drug         dr ON dr.drug_code         = pr.drug_code
WHERE      p.patient_no = 'P2026000123'        -- 김한성. 이수아는 'P2025004871'
GROUP BY   mr.medical_record_no, mr.treated_at, p.patient_name,
           dp.dept_name, e.employee_name, mr.symptom
ORDER BY   mr.treated_at DESC;