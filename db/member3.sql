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
