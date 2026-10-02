const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// JSON 요청 본문 파싱 미들웨어
app.use(express.json());

// 기본 라우트 테스트
app.get('/', (req, res) => {
  res.send('Hospital Management System Server Running!');
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});