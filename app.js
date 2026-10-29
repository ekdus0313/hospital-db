const session = require('express-session');
const express = require('express');
const path = require('path');
require('dotenv').config();

const db = require('./db/db');

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
  next();
});

// 라우터 — 각자 만들면 자기 줄의 // 를 지우세요
app.use('/auth',        require('./routes/auth'));
app.use('/reservation', require('./routes/reservation'));
app.use('/treatment',   require('./routes/treatment'));
app.use('/admission',   require('./routes/admission'));

app.get('/', (req, res) => {
  res.send('Hospital Management System Server Running!');
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