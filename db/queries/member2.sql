-- =====================================================
-- 예약 가능 시간 조회 (조원2)
-- 진료과별로 정원이 남은 향후 진료 일정을 보여준다.
--
-- 설계 메모
--  · 예약이 없는 일정도 조회해야 하므로 reservation 은 LEFT JOIN 한다.
--  · 취소된 예약은 인원에 포함하지 않도록 상태 조건을 ON 절에 둔다.
--  · GROUP BY + COUNT 로 예약 인원을 세고, HAVING 으로 마감 일정을 제외한다.
--  · 조회할 진료과는 WHERE 절의 진료과코드를 바꾸어 선택한다.
-- =====================================================
SELECT
    ms.schedule_no                         AS 일정번호,
    ms.schedule_date                       AS 진료일자,
    ms.start_time                          AS 시작시간,
    ms.end_time                            AS 종료시간,
    d.dept_name                            AS 진료과,
    e.employee_name                        AS 담당의사,
    ms.capacity                            AS 정원,
    COUNT(r.reservation_no)                AS 예약인원,
    ms.capacity - COUNT(r.reservation_no)  AS 예약가능인원
FROM       medical_schedule ms
JOIN       employee         e ON e.employee_no = ms.employee_no
JOIN       department       d ON d.dept_code   = e.dept_code
LEFT JOIN  reservation      r ON r.schedule_no = ms.schedule_no
                               AND r.reservation_status <> '취소'
WHERE      ms.operation_status = '정상'
  AND      e.emp_status        = '재직'
  AND      e.job_type          = '의사'
  AND      d.dept_code         = 'D01'  -- 조회할 진료과. D01은 소화기내과
  AND      TIMESTAMP(ms.schedule_date, ms.start_time) > NOW()
GROUP BY   ms.schedule_no, ms.schedule_date, ms.start_time, ms.end_time,
           d.dept_name, e.employee_name, ms.capacity
HAVING     COUNT(r.reservation_no) < ms.capacity
ORDER BY   ms.schedule_date, ms.start_time, e.employee_name;
