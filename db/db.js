// =====================================================
// db/db.js — MySQL 연결
//
// 한 번 만들어두면 모든 routes 파일에서 가져다 쓴다.
//   const db = require('../db/db');
//   const [rows] = await db.query('SELECT * FROM patient');
//
// 연결을 매번 새로 여는 대신 풀(pool)에 미리 만들어두고
// 빌려 쓴다. 요청이 동시에 들어와도 서로 기다리지 않는다.
// =====================================================

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'hospital',

  waitForConnections: true,
  connectionLimit: 10,

  charset: 'utf8mb4',   // 한글이 깨지지 않게
  dateStrings: true,    // DATETIME 을 문자열로 받는다.
                        // 없으면 화면에 "Mon Oct 05 2026 10:38:00
                        // GMT+0900 (한국 표준시)" 처럼 나온다.
});

module.exports = pool;