// =====================================================
// lib/menu.js — 역할별 메뉴 (조원5)
//
// 공통 레이아웃(views/layout/header.ejs)의 상단 메뉴와
// 메인 화면(views/index.ejs)의 바로가기 카드가 이 목록 하나를 같이 쓴다.
// 새 화면을 만들면 여기 한 줄만 추가하면 메뉴와 메인 화면에 둘 다 나온다.
//
// 키는 세션의 user.role 값과 같아야 한다.
//   환자만 영어('patient'), 직원은 직종 그대로('의사' '검사실' '원무' '관리자')
// =====================================================

const MENUS = {
  patient: [
    { label: '내 예약',      href: '/patient/reservations', desc: '예약 목록과 진행 상태' },
    { label: '예약하기',     href: '/reservation/available', desc: '진료과·의사·날짜로 빈 시간 찾기' },
    { label: '내 진료 이력', href: '/patient/records',      desc: '진단·처방·검사 결과' },
    { label: '내 수납 내역', href: '/patient/payments',     desc: '진료비와 본인부담금' },
  ],
  '의사': [
    { label: '대기 환자',  href: '/treatment/doctor',  desc: '접수된 환자를 대기번호 순으로' },
    { label: '진료 이력',  href: '/treatment/history', desc: '환자별 과거 진료·진단·처방' },
    { label: '검사 목록',  href: '/treatment/tests',   desc: '지시한 검사와 결과' },
  ],
  '검사실': [
    { label: '검사 목록',  href: '/treatment/tests',   desc: '지시된 검사와 결과 입력' },
  ],
  '원무': [
    { label: '예약 목록',      href: '/reservation/office',    desc: '전체 예약과 접수 상태' },
    { label: '예약 가능 시간', href: '/reservation/available', desc: '진료과·의사별 빈 시간' },
    { label: '수납 대상',      href: '/admission/payments',    desc: '아직 수납하지 않은 진료' },
  ],
  '관리자': [
    { label: '병상 현황', href: '/admission/beds',     desc: '병실별 사용 중 병상과 가동률' },
    { label: '직원 목록', href: '/auth/employees',     desc: '직원 정보와 재직 상태' },
    { label: '수납 대상', href: '/admission/payments', desc: '아직 수납하지 않은 진료' },
  ],
};

// 머리말에 보여 줄 한글 역할 이름
const ROLE_LABELS = {
  patient: '환자',
  '의사': '의사',
  '검사실': '검사실',
  '원무': '원무',
  '관리자': '관리자',
};

// 로그인한 사람의 메뉴 (로그인 안 했으면 빈 배열)
function menuFor(user) {
  if (!user) return [];
  return MENUS[user.role] || [];
}

function roleLabelFor(user) {
  if (!user) return '';
  return ROLE_LABELS[user.role] || user.role;
}

module.exports = { MENUS, menuFor, roleLabelFor };
