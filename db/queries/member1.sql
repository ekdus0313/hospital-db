-- =====================================================
-- 로그인용 조회 (조원1) — R-0002, R-0003
-- 아이디로 계정을 찾아온다. 비밀번호 확인은 코드에서 한다.
--
-- 설계 메모
--  · password(해시)를 함께 가져와야 bcrypt.compare 로 비교할 수 있다.
--    이 쿼리는 로그인 검증 전용이다. 화면에 뿌리는 조회에서는 password 를 뺀다.
--  · 퇴직한 직원은 로그인할 수 없다 (업무분석서 03-5)
--  · 6주차에 routes/auth.js 로 옮길 때 아이디 자리를 ? 로 바꾼다.
-- =====================================================

-- ① 환자 로그인
SELECT patient_no, patient_name, username, password,
       phone, birth_date, insurance_code
FROM   patient
WHERE  username = 'hansung.kim';
-- 기대값: 김한성 1줄


-- ② 직원 로그인 (퇴직자 제외)
SELECT employee_no, employee_name, job_type, dept_code,
       username, password, emp_status
FROM   employee
WHERE  username   = 'minho.jung'
  AND  emp_status = '재직';
-- 기대값: 정민호 1줄
-- username 을 'taehun.kim' 으로 바꾸면 0줄 — 퇴직자라 로그인 불가 (정상)