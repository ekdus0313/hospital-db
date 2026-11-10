const session = require('express-session');
const express = require('express');
const path = require('path');
require('dotenv').config();

const db = require('./db/db');
const { menuFor, roleLabelFor } = require('./lib/menu');   // 역할별 메뉴 (조원5)

const app = express();
const PORT = process.env.PORT || 3000;

// 화면(.ejs) 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 요청 본문 읽기
app.use(express.json());
app.use(express.urlencoded({ extended: true }));   // 폼으로 보낸 값

// CSS·이미지 같은 파일
app.use(express.static(path.join(__dirname, 'public')));

// 모든 라우터에서 로그인 세션 공유
if (!process.env.SESSION_SECRET) {
  throw new Error('.env에 SESSION_SECRET을 설정해주세요.');
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60
  }
}));

// 모든 EJS 화면에서 로그인 사용자 정보 사용
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  // 공통 레이아웃(views/layout/header.ejs)에서 쓰는 값 (조원5)
  res.locals.menu        = menuFor(res.locals.user);       // 역할별 메뉴
  res.locals.roleLabel   = roleLabelFor(res.locals.user);  // 머리말의 역할 이름
  res.locals.currentPath = req.path;                       // 지금 보고 있는 메뉴 강조용

  // 저장·취소 결과 알림 (조원5) — 한 번 보여 주고 지운다.
  //   쓰는 법: req.session.flash = { type: 'ok', text: '저장했습니다.' };  →  res.redirect(...)
  //   type: 'ok'(초록) · 'danger'(빨강) · 'warn'(주황) · 'info'(파랑)
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// 라우터 — 각자 만들면 자기 줄의 // 를 지우세요
app.use('/auth',        require('./routes/auth'));
app.use('/reservation', require('./routes/reservation'));
app.use('/treatment',   require('./routes/treatment'));
app.use('/admission',   require('./routes/admission'));
app.use('/patient',     require('./routes/patient'));   // 환자 화면 (조원5)

// 메인 화면 — 로그인 전에는 소개, 로그인 후에는 역할별 바로가기 (조원5)
app.get('/', async (req, res) => {
  let home = null;
  const user = req.session.user;
  if (user && user.role === 'patient') {
    try {
      home = await require('./routes/patient').loadPatientHome(user.patient_no);
    } catch (err) {
      console.error('메인 화면 요약 조회 오류:', err);
    }
  }
  res.render('index', { home });
});

// 없는 주소 — 메인 화면으로 돌려보낸다
app.use((req, res) => {
  res.status(404).render('index', { home: null });
});

// 마지막 그물 — 어느 라우터에서도 처리하지 못한 오류가 여기로 온다.
// 이게 없으면 Express 기본 오류 화면이 떠서 파일 경로와 SQL 이 그대로 보인다.
// ※ 인자가 네 개여야 Express 가 오류 처리기로 인식한다. next 를 안 써도 적는다.
app.use((err, req, res, next) => {
  console.error('처리되지 않은 오류:', err);
  res.status(500).send('요청을 처리하는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.');
});

app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  try {
    await db.query('SELECT 1');
    console.log('DB 연결 성공 — hospital');
  } catch (e) {
    console.error('DB 연결 실패:', e.message);
    console.error('.env 의 DB_USER / DB_PASSWORD / DB_NAME 을 확인하세요.');
  }
});