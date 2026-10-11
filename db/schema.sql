CREATE TABLE department (
  dept_code  VARCHAR(20)   NOT NULL,              -- 부서코드
  dept_name  VARCHAR(50)   NOT NULL,              -- 부서명
  location   VARCHAR(255)  NOT NULL,              -- 위치
  phone      VARCHAR(20)   NOT NULL,              -- 전화번호
  PRIMARY KEY (dept_code),
  UNIQUE (dept_name)
);
CREATE TABLE `insurance` (
	`insurance_code`	VARCHAR(20)	NOT NULL,
	`insurance_name`	VARCHAR(50)	NULL,
	`copay_rate`	INT	NULL
);

CREATE TABLE `employee` (
	`employee_no`	VARCHAR(20)	NOT NULL,
	`employee_name`	VARCHAR(50)	NOT NULL,
	`job_type`	VARCHAR(20)	NOT NULL,
	`license_no`	VARCHAR(50)	NULL,
	`username`	VARCHAR(50)	NOT NULL,
	`password`	VARCHAR(60)	NOT NULL,
	`emp_status`	VARCHAR(20)	NULL,
	`dept_code`	VARCHAR(20)	NOT NULL
);

CREATE TABLE `patient` (
	`patient_no`	VARCHAR(20)	NOT NULL,
	`patient_name`	VARCHAR(50)	NOT NULL,
	`ssn1`	VARCHAR(255)	NOT NULL,
	`ssn2`	VARCHAR(255)	NOT NULL,
	`birth_date`	DATE	NOT NULL,
	`gender`	VARCHAR(10)	NOT NULL,
	`phone`	VARCHAR(20)	NOT NULL,
	`address1`	VARCHAR(255)	NOT NULL,
	`address2`	VARCHAR(255)	NULL,
	`address3`	VARCHAR(255)	NULL,
	`zip_code`	VARCHAR(10)	NOT NULL,
	`username`	VARCHAR(50)	NOT NULL,
	`password`	VARCHAR(60)	NOT NULL,
	`created_at`	DATETIME	NULL,
	`insurance_code`	VARCHAR(20)	NOT NULL
);

ALTER TABLE `insurance` ADD CONSTRAINT `PK_INSURANCE` PRIMARY KEY (
	`insurance_code`
);


ALTER TABLE `employee` ADD CONSTRAINT `PK_EMPLOYEE` PRIMARY KEY (
	`employee_no`
);

ALTER TABLE `patient` ADD CONSTRAINT `PK_PATIENT` PRIMARY KEY (
	`patient_no`
);
ALTER TABLE `patient` ADD CONSTRAINT `FK_insurance_TO_patient_1` FOREIGN KEY (
	`insurance_code`
)
REFERENCES `insurance` (
	`insurance_code`
);
ALTER TABLE `employee` ADD CONSTRAINT `FK_department_TO_employee_1` FOREIGN KEY (
	`dept_code`
)
REFERENCES `department` (
	`dept_code`
);
-- =====================================================================
-- db/member2.sql  (조원2 · 4주차 CREATE TABLE)
-- 진료과 · 진료일정 · 예약   — 팀 ERDCloud 칸 이름 그대로
-- medical_schedule · reservation 실행 전 employee · patient 가 먼저 있어야 한다.
-- =====================================================================


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
-- ============================================================
--  병원 예약 및 진료 관리 시스템 — 조원3 담당 테이블
--  진료기록 · 진단 · 질병코드 · 약품 · 처방 · 검사항목 · 검사
--
--  ※ 실행 순서 주의
--     이 파일 안에서도 부모 테이블이 먼저 와야 FK가 걸린다.
--     medical_record 는 patient(조원1), employee(조원1),
--     reservation(조원2) 을 가리키므로 이 파일만 단독 실행하면
--     거기서 에러가 난다. 정상이다.
--     혼자 확인할 때는 ① 묶음(drug, test_item, disease)만 실행한다.
-- ============================================================


-- ── ① 아무도 안 가리키는 테이블 (혼자서도 실행된다) ──────────

CREATE TABLE drug (
  drug_code    VARCHAR(20)  NOT NULL,
  drug_name    VARCHAR(50)  NOT NULL,
  ingredient   VARCHAR(50)  NOT NULL,
  drug_form    VARCHAR(20)  NOT NULL,
  unit_price   INT          NOT NULL,
  use_status   VARCHAR(20)  NOT NULL,
  PRIMARY KEY (drug_code)
);
-- unit_price : 현재 단가. 변경해도 이미 등록된 처방 금액은 그대로다.
-- use_status : 사용 / 미사용. 단종 약품은 삭제하지 않고 상태만 바꾼다.


CREATE TABLE test_item (
  test_code      VARCHAR(20)  NOT NULL,
  test_name      VARCHAR(50)  NOT NULL,
  test_category  VARCHAR(20)  NOT NULL,
  test_price     INT          NOT NULL,
  use_status     VARCHAR(20)  NOT NULL,
  PRIMARY KEY (test_code)
);
-- test_category : 혈액검사 / 영상검사 / 기능검사
-- use_status    : 사용 / 미사용


CREATE TABLE disease (
  disease_code  VARCHAR(20)   NOT NULL,
  disease_name  VARCHAR(100)  NOT NULL,
  PRIMARY KEY (disease_code)
);
-- 한국표준질병·사인분류(KCD) 기준 참조 테이블


-- ── ② 남의 테이블을 가리키는 것 ──────────────────────────────
--    patient, employee, reservation 이 먼저 있어야 실행된다.

CREATE TABLE medical_record (
  medical_record_no  VARCHAR(20)   NOT NULL,
  treated_at         DATETIME      NOT NULL,
  symptom            VARCHAR(255)  NOT NULL,
  opinion            TEXT          NOT NULL,
  patient_no         VARCHAR(20)   NOT NULL,
  employee_no        VARCHAR(20)   NOT NULL,
  reservation_no     VARCHAR(20)   NOT NULL,
  PRIMARY KEY (medical_record_no),
  UNIQUE (reservation_no),
  FOREIGN KEY (patient_no)     REFERENCES patient(patient_no),
  FOREIGN KEY (employee_no)    REFERENCES employee(employee_no),
  FOREIGN KEY (reservation_no) REFERENCES reservation(reservation_no)
);
-- UNIQUE (reservation_no) : 예약 1건당 진료기록 1건 (업무분석서 08-3)
-- 작성된 진료기록은 삭제하지 않는다. 수정은 작성한 의사만 한다.


-- ── ③ 진료기록을 가리키는 것 ────────────────────────────────

CREATE TABLE diagnosis (
  medical_record_no  VARCHAR(20)  NOT NULL,
  disease_code       VARCHAR(20)  NOT NULL,
  diagnosis_type     VARCHAR(20)  NOT NULL,
  PRIMARY KEY (medical_record_no, disease_code),
  FOREIGN KEY (medical_record_no) REFERENCES medical_record(medical_record_no),
  FOREIGN KEY (disease_code)      REFERENCES disease(disease_code)
);
-- 복합키가 "같은 진료에 같은 질병코드 중복 등록" 을 막는다 (업무분석서 09-5)
-- diagnosis_type : 주진단 / 부진단. 진료 1건당 주진단은 반드시 1개.


CREATE TABLE prescription (
  medical_record_no  VARCHAR(20)  NOT NULL,
  drug_code          VARCHAR(20)  NOT NULL,
  dose_once          INT          NOT NULL,
  dose_per_day       INT          NOT NULL,
  dose_days          INT          NOT NULL,
  applied_price      INT          NOT NULL,
  PRIMARY KEY (medical_record_no, drug_code),
  FOREIGN KEY (medical_record_no) REFERENCES medical_record(medical_record_no),
  FOREIGN KEY (drug_code)         REFERENCES drug(drug_code)
);
-- 복합키가 "같은 진료에 같은 약품 두 번 처방" 을 막는다 (업무분석서 11-4)
-- applied_price : 처방 시점의 약품 단가. 이후 단가가 바뀌어도
--                 과거 처방 금액이 유지되도록 함께 저장한다 (업무분석서 11-6)
-- 약제료 = applied_price × (dose_once × dose_per_day × dose_days)


CREATE TABLE test (
  test_no            VARCHAR(20)   NOT NULL,
  tested_at          DATETIME      NULL,
  test_result        VARCHAR(255)  NULL,
  applied_price      INT           NOT NULL,
  test_status        VARCHAR(20)   NOT NULL,
  medical_record_no  VARCHAR(20)   NOT NULL,
  test_code          VARCHAR(20)   NOT NULL,
  PRIMARY KEY (test_no),
  UNIQUE (medical_record_no, test_code),
  FOREIGN KEY (medical_record_no) REFERENCES medical_record(medical_record_no),
  FOREIGN KEY (test_code)         REFERENCES test_item(test_code)
);
-- tested_at, test_result : 의사가 지시한 시점에는 비어 있고
--                          검사실이 결과를 입력할 때 채운다. 그래서 NULL 허용.
-- UNIQUE : 같은 진료에 같은 검사항목을 두 번 지시할 수 없다 (업무분석서 13-2)
-- applied_price : 지시 시점의 검사비용 (업무분석서 13-3)
-- test_status   : 지시 / 완료 / 취소
-- =====================================================================
-- db/member4.sql  (조원4 · 4주차 CREATE TABLE)
-- 병실 · 병상 · 입원 · 진찰료 · 수납   — 팀 ERDCloud 칸 이름 그대로
-- 순서: 부모 먼저. patient · employee · medical_record 가 먼저 있어야 한다.
-- =====================================================================

CREATE TABLE room (
  room_no      VARCHAR(20)  NOT NULL,              -- 병실번호
  ward         VARCHAR(20)  NOT NULL,              -- 병동
  room_type    VARCHAR(20)  NOT NULL,              -- 1인실·2인실·4인실·6인실
  daily_fee    INT          NOT NULL,              -- 1일 병실료
  PRIMARY KEY (room_no)
);

CREATE TABLE bed (
  bed_no       VARCHAR(20)  NOT NULL,              -- 병상번호
  bed_status   VARCHAR(20)  NOT NULL DEFAULT '사용가능',  -- 사용가능·사용중
  room_no      VARCHAR(20)  NOT NULL,              -- 소속 병실
  PRIMARY KEY (bed_no),
  FOREIGN KEY (room_no) REFERENCES room(room_no)
);

CREATE TABLE admission (
  admission_no      VARCHAR(20)  NOT NULL,         -- 입원번호 H20261006-007
  admit_at          DATETIME     NOT NULL,         -- 입원일시
  discharge_at      DATETIME     NULL,             -- 퇴원일시 (입원 중엔 비어 있음)
  adm_status        VARCHAR(20)  NOT NULL DEFAULT '입원중',  -- 입원중·퇴원
  bed_no            VARCHAR(20)  NOT NULL,         -- 배정 병상
  patient_no        VARCHAR(20)  NOT NULL,         -- 환자
  medical_record_no VARCHAR(20)  NOT NULL,         -- 입원 근거 진료
  employee_no       VARCHAR(20)  NOT NULL,         -- 주치의
  PRIMARY KEY (admission_no),
  FOREIGN KEY (bed_no)            REFERENCES bed(bed_no),
  FOREIGN KEY (patient_no)        REFERENCES patient(patient_no),
  FOREIGN KEY (medical_record_no) REFERENCES medical_record(medical_record_no),
  FOREIGN KEY (employee_no)       REFERENCES employee(employee_no)
);

CREATE TABLE consultation_fee (
  fee_code     VARCHAR(20)  NOT NULL,              -- 수가코드
  fee_name     VARCHAR(50)  NOT NULL,              -- 항목명
  fee_amount   INT          NOT NULL,              -- 금액
  PRIMARY KEY (fee_code)
);

CREATE TABLE payment (
  payment_no        VARCHAR(20)  NOT NULL,         -- 수납번호 B20261005-0038
  consult_amount    INT          NOT NULL,         -- 진찰료
  test_amount       INT          NOT NULL DEFAULT 0,  -- 검사료
  drug_amount       INT          NOT NULL DEFAULT 0,  -- 약제료
  room_amount       INT          NOT NULL DEFAULT 0,  -- 병실료
  total_amount      INT          NOT NULL,         -- 청구금액
  patient_amount    INT          NOT NULL,         -- 본인부담금
  pay_method        VARCHAR(20)  NULL,             -- 결제수단 (미수납이면 비어 있음)
  paid_at           DATETIME     NULL,             -- 수납일시 (미수납이면 비어 있음)
  pay_status        VARCHAR(20)  NOT NULL DEFAULT '미수납',  -- 미수납·완료
  fee_code          VARCHAR(20)  NOT NULL,         -- 적용한 진찰료
  medical_record_no VARCHAR(20)  NOT NULL,         -- 진료번호
  PRIMARY KEY (payment_no),
  UNIQUE (medical_record_no),                      -- 진료 1건당 수납 1건
  FOREIGN KEY (fee_code)          REFERENCES consultation_fee(fee_code),
  FOREIGN KEY (medical_record_no) REFERENCES medical_record(medical_record_no)
);