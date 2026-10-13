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
