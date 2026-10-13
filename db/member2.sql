-- =====================================================================
-- db/member2.sql  (조원2 · 4주차 CREATE TABLE)
-- 진료과 · 진료일정 · 예약   — 팀 ERDCloud 칸 이름 그대로
-- medical_schedule · reservation 실행 전 employee · patient 가 먼저 있어야 한다.
-- =====================================================================

CREATE TABLE department (
  dept_code  VARCHAR(20)   NOT NULL,              -- 부서코드
  dept_name  VARCHAR(50)   NOT NULL,              -- 부서명
  location   VARCHAR(255)  NOT NULL,              -- 위치
  phone      VARCHAR(20)   NOT NULL,              -- 전화번호
  PRIMARY KEY (dept_code),
  UNIQUE (dept_name)
);

CREATE TABLE medical_schedule (
  schedule_no      VARCHAR(20)  NOT NULL,         -- 진료일정번호
  schedule_date    DATE         NOT NULL,         -- 진료일자
  start_time       TIME         NOT NULL,         -- 진료시작시간
  end_time         TIME         NOT NULL,         -- 진료종료시간
  capacity         INT          NOT NULL,         -- 예약가능인원
  operation_status VARCHAR(20)  NOT NULL,         -- 정상·휴진
  employee_no      VARCHAR(20)  NOT NULL,         -- 담당 의사
  PRIMARY KEY (schedule_no),
  UNIQUE (employee_no, schedule_date, start_time),
  FOREIGN KEY (employee_no) REFERENCES employee(employee_no),
  CHECK (end_time > start_time),
  CHECK (capacity > 0)
);
-- UNIQUE : 같은 의사에게 같은 날짜·시작시간의 일정이 중복되지 않게 한다.
-- 휴진 일정은 삭제하지 않고 operation_status 를 변경해 이력을 보존한다.

CREATE TABLE reservation (
  reservation_no     VARCHAR(20)  NOT NULL,       -- 예약번호
  schedule_no        VARCHAR(20)  NOT NULL,       -- 진료일정
  reserved_at        DATETIME     NOT NULL,       -- 예약일시
  reservation_type   VARCHAR(20)  NOT NULL,       -- 사전예약·당일
  reservation_status VARCHAR(20)  NOT NULL,       -- 예약·접수·진료완료·취소
  canceled_at        DATETIME     NULL,           -- 취소 전에는 비어 있음
  reception_at       DATETIME     NULL,           -- 접수 전에는 비어 있음
  waiting_no         INT          NULL,           -- 접수 전에는 비어 있음
  patient_no         VARCHAR(20)  NOT NULL,       -- 환자
  created_at         DATETIME     NOT NULL,       -- 등록일시
  PRIMARY KEY (reservation_no),
  UNIQUE (patient_no, schedule_no),
  FOREIGN KEY (schedule_no) REFERENCES medical_schedule(schedule_no),
  FOREIGN KEY (patient_no)  REFERENCES patient(patient_no)
);
-- UNIQUE (patient_no, schedule_no) : 같은 환자의 동일 일정 중복 예약을 막는다.
-- 같은 날짜·진료과의 중복 예약 및 capacity 초과 여부는 일정 정보를 조회한 뒤
-- 예약 저장과 한 트랜잭션으로 검사한다.
-- 대기번호는 담당 의사·접수일자별로 1번부터 부여한다. employee_no와 접수일자는
-- 상위 일정에서 조회해야 하므로 접수 저장 트랜잭션에서 중복 여부를 검사한다.
-- reception_at·waiting_no 는 접수할 때 함께 기록하고, canceled_at 은 취소할 때 기록한다.
-- 접수된 예약은 변경·취소할 수 없으며, 취소 시 삭제 대신 상태와 시각을 기록한다.
