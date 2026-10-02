# 🏥 병원 예약 및 진료 관리 시스템

> 대학병원의 진료 예약부터 수납까지 전 과정을 하나의 데이터베이스로 관리하는 웹 애플리케이션

<p>
  <img src="https://img.shields.io/badge/Node.js-24.x-339933?style=flat-square&logo=node.js&logoColor=white">
  <img src="https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white">
  <img src="https://img.shields.io/badge/MySQL-8.0-4479A1?style=flat-square&logo=mysql&logoColor=white">
  <img src="https://img.shields.io/badge/EJS-template-B4CA65?style=flat-square">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square">
</p>

2026학년도 2학기 · 데이터베이스 설계 · **B반 6조**

<br>

## 📌 프로젝트 소개

대학병원은 진료과·의료진·환자 수가 많아 예약, 진료, 처방, 검사, 입원, 수납 정보가 부서마다 따로 관리되기 쉽습니다. 이로 인해 중복 예약, 병상 수 초과 입원, 진료비 누락 같은 문제가 발생합니다.

이 프로젝트는 그 전 과정을 **하나의 관계형 데이터베이스**로 묶어 관리하는 시스템을 설계하고 구현합니다.

ORM을 쓰지 않고 `mysql2`로 **SQL을 직접 작성**합니다. 과목의 목표가 데이터베이스 설계와 질의 작성이기 때문입니다.

<br>

## 🗂 설계 대상 데이터

15개 엔티티로 구성됩니다.

| 영역 | 테이블 |
|---|---|
| 기준정보 | `환자` `진료과` `직원` `진료일정` |
| 예약·접수 | `예약` |
| 진료 | `진료기록` `진단` |
| 처방 | `약품` `처방` |
| 검사 | `검사항목` `검사` |
| 입원 | `병실` `병상` `입원` |
| 수납 | `수납` |

**참조 데이터** — 질병코드(KCD 기준), 보험유형(본인부담률), 진찰료

### 설계 포인트

- **M:N 해소** — 진료기록↔질병, 진료기록↔약품이 각각 M:N이므로 `진단`과 `처방`을 교차 엔티티로 두고 복합키를 사용합니다.
- **동시성 제어** — 예약 건수 조회와 저장을 하나의 트랜잭션으로 처리해 정원 초과를 막습니다.
- **시점 금액 보존** — 약품 단가나 검사비가 바뀌어도 과거 금액이 유지되도록 등록 시점의 금액을 함께 저장합니다.
- **논리적 삭제** — FK로 묶인 데이터는 지우지 않고 상태값(`재직여부`, `사용여부`, `운영여부`)으로 관리합니다.

<br>

## 🛠 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 개발 언어 | JavaScript, SQL, HTML, CSS |
| 실행 환경 | Node.js 24.x |
| 프레임워크 | Express |
| 데이터베이스 | MySQL 8.0 |
| 화면 | EJS |
| 설계 도구 | ERDCloud |
| 협업 도구 | GitHub, Notion |

<br>

## 🚀 실행 방법

### 1. 저장소 받기

```bash
git clone https://github.com/<조원1아이디>/hospital-db.git
cd hospital-db
npm install
```

### 2. `.env` 파일 만들기

프로젝트 폴더 맨 위에 `.env` 파일을 만듭니다. **이 파일은 GitHub에 올라가지 않습니다.**

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=본인_MySQL_비밀번호
DB_NAME=hospital
PORT=3000
```

### 3. 데이터베이스 만들기

MySQL Workbench에서 아래를 실행합니다.

```sql
CREATE DATABASE hospital DEFAULT CHARACTER SET utf8mb4;
USE hospital;
```

이어서 `File → Open SQL Script`(`Ctrl+Shift+O`)로 아래 두 파일을 차례로 열고 ⚡ 아이콘을 눌러 실행합니다.

```
db/schema.sql     테이블 생성
db/seed.sql       테스트 데이터
```

> Workbench에서는 `SOURCE` 명령이 동작하지 않습니다. 반드시 `Open SQL Script`로 실행하세요.

### 4. 서버 실행

```bash
node app.js
```

브라우저에서 `http://localhost:3000` 으로 접속합니다.

<br>

## 📁 폴더 구조

```
hospital-db/
├── app.js                  서버 시작 파일
├── .env                    각자 만듦 (GitHub에 올라가지 않음)
├── db/
│   ├── db.js               DB 연결
│   ├── schema.sql          테이블 생성 SQL
│   └── seed.sql            테스트 데이터
├── routes/                 주소별 처리
│   ├── auth.js             로그인 · 회원가입
│   ├── reservation.js      예약 · 접수
│   ├── treatment.js        진료 · 처방 · 검사
│   └── admission.js        입원 · 수납 · 관리자
├── views/                  EJS 화면 파일
│   └── layout/             공통 머리말 · 꼬리말 · 메뉴
└── public/                 CSS, 이미지
```

<br>

## 👥 팀원 및 역할

| 팀원 | 담당 영역 | 설계 테이블 | 주요 파일 |
|---|---|---|---|
| **장다연** | 로그인·회원가입<br>GitHub·데이터 관리 | 환자, 직원 | `routes/auth.js`<br>`db/schema.sql` |
| **임기범** | 예약·접수 | 진료과, 진료일정, 예약 | `routes/reservation.js` |
| **이승직** 👑 | 진료·처방·검사 | 진료기록, 진단, 약품,<br>처방, 검사항목, 검사 | `routes/treatment.js` |
| **장재원** | 입원·수납·관리자 | 병실, 병상, 입원, 수납 | `routes/admission.js` |
| **이윤채** | 화면 설계·구현 | — | `views/`<br>`public/style.css` |

> 👑 팀장 · 자기가 설계한 테이블은 자기가 코드로 만듭니다.

<br>

## 🤝 협업 규칙

- `main` 브랜치에 **직접 push 하지 않습니다.** 각자 브랜치를 만들어 작업하고 Pull Request로 합칩니다.
- **남의 파일을 고치지 않습니다.** 고쳐야 하면 담당자에게 먼저 말합니다.
- 작업 시작 전에 **반드시 `git pull`** 합니다.
- `db/schema.sql`은 조원1이 취합합니다.

```bash
git checkout -b feature/예약화면
# 작업 후
git add .
git commit -m "예약 화면 추가"
git push origin feature/예약화면
```

### 브랜치 이름

```
feature/기능이름        새 기능
fix/고치는것            버그 수정
```

<br>

## 🗓 진행 일정

| 주차 | 기간 | 내용 |
|:---:|---|---|
| 1 | 09/29 ~ 10/05 | 개발 환경 세팅과 팀 규칙 |
| 2 | 10/06 ~ 10/12 | 테이블에 들어갈 칸 정하기 |
| 3 | 10/13 ~ 10/19 | ERD 그리기와 통합 |
| 4 | 10/20 ~ 10/26 | 테이블 정의서와 CREATE TABLE |
| 5 | 10/27 ~ 11/02 | 테스트 데이터 넣고 SQL 연습 |
| 6 | 11/03 ~ 11/09 | 로그인과 각자의 첫 화면 |
| 7 | 11/10 ~ 11/16 | 보여 주는 화면 만들기 |
| 8 | 11/17 ~ 11/23 | 저장하는 화면 만들기 |
| 9 | 11/24 ~ 11/30 | 규칙을 지키는 코드 넣기 |
| 10 | 12/01 ~ 12/07 | 관리자 기능과 통합 테스트 |
| 11 | 12/08 ~ 12/14 | 시연 영상과 제출 |

<br>

## 📄 산출물

| 문서 | 내용 |
|---|---|
| 프로젝트 제안서 | 주제 선정, 주요 기능, 설계 대상 데이터 |
| 요구사항 명세서 | 기능 요구사항 33건 (R-0001 ~ R-0033) |
| 업무분석서 | 단위업무 16건의 업무 규칙과 관리 데이터 |
| 주차별 세부 실행 계획서 | 11주 실행 계획 |
| ERD · 테이블 정의서 | 3 ~ 4주차 산출 |

<br>

## ⚙️ 설계 범위에서 제외한 것

- 직원 급여·근태, 약품 재고·구매
- 응급실·수술실 업무, 의료영상 저장
- 건강보험 청구 (회원가입 시 입력한 보험유형을 그대로 사용)
- 결제대행사·카드사 연동 (결제수단과 금액만 관리)
- 입원 중 회진 기록

<br>

---

<p align="center">
  <sub>2026학년도 2학기 · 데이터베이스 설계 · B반 6조</sub>
</p>
