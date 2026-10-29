require('dotenv').config();

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db/db');


function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.redirect('/auth/login');
        }

    if (!allowedRoles.includes(req.session.user.role)) {
        return res.status(403).send('접근 권한이 없습니다.');
    }
        next();
    };
}

//주민등록번호 뒷자리 암호화

function getEncryptionKey() {
    const key = process.env.SSN_ENCRYPTION_KEY;
    if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
        throw new Error('SSN_ENCRYPTION_KEY 설정 오류');
    }
    return Buffer.from(key, 'hex');
}

function encryptSSN(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm',getEncryptionKey(),iv
    );
    const encrypted = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return [
    'v1',
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex')
    ].join(':');
}

//공통함수

async function getInsuranceCodes() {
    const [rows] = await db.query(`
        SELECT insurance_code
        FROM insurance
        ORDER BY insurance_code
    `);
    return rows;
}

function safeOld(body = {}) {
    const { password, ssn1, ssn2, ...otherFields } = body;
    return otherFields;
}

async function renderRegister(
    res,
    message = null,
    status = 200,
    old = {}
) {
    try {
        const insuranceCodes = await getInsuranceCodes();
        return res.status(status).render('auth/register', {
        error: message,
        insuranceCodes,
        old
    });

    } catch (err) {
        console.error('회원가입 화면 오류:', err);
        return res.status(500).send(
            '회원가입 화면을 불러올 수 없습니다.'
        );
    }
}

function loginError(res, message, status = 401) {
    return res.status(status).render('auth/login', {
        error: message
    });
}

//로그인

router.get('/login', (req, res) => {
    return res.render('auth/login', {
        error: null
    });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        !username.trim() ||
        !password
        ) {
        return loginError(
            res,
            '아이디와 비밀번호를 입력해주세요.',
            400
        );
    }

    const loginId = username.trim();

    // 직원 계정 조회
    const [employees] = await db.query(`
        SELECT
            employee_no,
            employee_name,
            job_type,
            username,
            password,
            emp_status
        FROM employee
        WHERE username = ?
        `,  [loginId]);

    // 환자 계정 조회
    const [patients] = await db.query(`
        SELECT
            patient_no,
            patient_name,
            username,
            password
        FROM patient
        WHERE username = ?
        `, [loginId]);

    // 직원/환자 아이디가 중복되면 로그인 차단
    if (employees.length > 0 && patients.length > 0) {
        console.error('직원/환자 아이디 중복:', loginId);
        return loginError(
            res,
            '계정 확인이 필요합니다. 관리자에게 문의해주세요.'
        );
        }

    let sessionUser;

    if (employees.length > 0) {
      // 직원 로그인
        const employee = employees[0];

        const validPassword = await bcrypt.compare(
            password,
            employee.password
        );

        if (!validPassword) {
            return loginError(
            res,
            '아이디 또는 비밀번호가 올바르지 않습니다.'
            );
        }

        if (employee.emp_status !== '재직') {
            return loginError(
            res,
            '현재 로그인할 수 없는 직원 계정입니다.'
            );
        }

        sessionUser = {
            id: employee.employee_no,
            employee_no: employee.employee_no,
            username: employee.username,
            name: employee.employee_name,
            role: employee.job_type,
            accountType: 'employee'
        };

    } else if (patients.length > 0) {
      // 환자 로그인
        const patient = patients[0];

        const validPassword = await bcrypt.compare(
            password,
            patient.password
        );

        if (!validPassword) {
            return loginError(
            res,
            '아이디 또는 비밀번호가 올바르지 않습니다.'
            );
        }

        sessionUser = {
            id: patient.patient_no,
            patient_no: patient.patient_no,
            username: patient.username,
            name: patient.patient_name,
            role: 'patient',
            accountType: 'patient'
        };

    } else {
        return loginError(
            res,
            '아이디 또는 비밀번호가 올바르지 않습니다.'
        );
    }

    // 로그인 성공 후 세션 생성
    req.session.regenerate((err) => {
        if (err) {
            console.error('세션 생성 오류:', err);
            return res.status(500).send('로그인 처리 오류');
        }

        req.session.user = sessionUser;

        req.session.save((err) => {
            if (err) {
            console.error('세션 저장 오류:', err);
            return res.status(500).send('로그인 처리 오류');
            }

        // 관리자는 직원 목록 화면으로 이동
        if (sessionUser.role === '관리자') {
            return res.redirect('/auth/employees');
        }

        return res.redirect('/');
        });
    });

    } catch (err) {
        console.error('로그인 오류:', err);

    return res.status(500).send(
        '로그인 중 오류가 발생했습니다.'
    );
    }
});

//회원가입

router.get('/register', async (req, res) => {
    return renderRegister(res, null, 200, {});
});

router.post(
    '/register',
    [
        body('patient_name')
        .isString()
        .trim()
        .notEmpty()
        .isLength({ max: 50 }),

    body('username')
        .isString()
        .trim()
        .isLength({ min: 4, max: 50 })
        .matches(/^[a-zA-Z0-9_]+$/),

    body('password')
        .isString()
        .isLength({ min: 8 })
        .custom(value =>Buffer.byteLength(value, 'utf8') <= 72
        ),

    body('ssn1')
        .isString()
        .matches(/^\d{6}$/),

    body('ssn2')
        .isString()
        .matches(/^\d{7}$/),

    body('birth_date')
        .isString()
        .isISO8601({ strict: true }),

    body('gender')
        .isIn(['남', '여', '기타']),

    body('phone')
        .isString()
        .matches(/^[0-9-]{9,20}$/),

    body('address1')
        .isString()
        .trim()
        .notEmpty()
        .isLength({ max: 255 }),

    body('address2')
        .optional({ values: 'falsy' })
        .isString()
        .trim()
        .isLength({ max: 255 }),

    body('address3')
        .optional({ values: 'falsy' })
        .isString()
        .trim()
        .isLength({ max: 255 }),

    body('zip_code')
        .isString()
        .matches(/^[0-9]{5}$/),

    body('insurance_code')
        .isString()
        .trim()
        .notEmpty()
        .isLength({ max: 20 })
    ],

    async (req, res) => {
        const old = safeOld(req.body);

    try {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const invalidFields = [
            ...new Set(
            errors.array().map(error => error.path)
            )
        ];

        return await renderRegister(
            res,
            `입력값을 확인해주세요: ${invalidFields.join(', ')}`,
            400,
            old
            );
        }

        const {
            patient_name,
            username,
            password,
            ssn1,
            ssn2,
            birth_date,
            gender,
            phone,
            address1,
            address2,
            address3,
            zip_code,
            insurance_code
        } = req.body;

        const birth = new Date(
            birth_date + 'T00:00:00Z'
        );

        if (
            Number.isNaN(birth.getTime()) ||
            birth.toISOString().slice(0, 10) !== birth_date ||
            birth > new Date()
        ) {
            return await renderRegister(
            res,
            '생년월일이 올바르지 않습니다.',
            400,
            old
            );
        }

      // 환자 아이디 중복 확인
        const [existingPatients] = await db.query(`
            SELECT patient_no
            FROM patient
            WHERE username = ?
        `, [username]);

      // 직원 아이디 중복 확인
        const [existingEmployees] = await db.query(`
            SELECT employee_no
            FROM employee
            WHERE username = ?
        `, [username]);

        if (
            existingPatients.length > 0 ||
            existingEmployees.length > 0
        ) {
            return await renderRegister(
            res,
            '이미 사용 중인 아이디입니다.',
            400,
            old
            );
        }

      // 보험코드 확인
        const [insurance] = await db.query(`
            SELECT insurance_code
            FROM insurance
            WHERE insurance_code = ?
        `, [insurance_code]);

        if (insurance.length === 0) {
            return await renderRegister(
            res,
            '올바른 보험코드를 선택해주세요.',
            400,
            old
            );
        }

      // 주민등록번호 저장 방식
      const storedSsn1 = ssn1;           // 앞자리 평문 저장
      const encryptedSsn2 = encryptSSN(ssn2); // 뒷자리 암호화

      // 비밀번호 해시
        const hashedPassword = await bcrypt.hash(
            password,
            12
        );

        const patientNo =
            'P' + crypto.randomBytes(8).toString('hex');

        await db.query(`
            INSERT INTO patient (
            patient_no,
            patient_name,
            ssn1,
            ssn2,
            birth_date,
            gender,
            phone,
            address1,
            address2,
            address3,
            zip_code,
            username,
            password,
            created_at,
            insurance_code
            )
            VALUES (
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            NOW(), ?
            )
        `, [
            patientNo,
            patient_name,
            storedSsn1,
            encryptedSsn2,
            birth_date,
            gender,
            phone,
            address1,
            address2 || null,
            address3 || null,
            zip_code,
            username,
            hashedPassword,
            insurance_code
        ]);

        console.log('회원가입 성공:', patientNo);

        return res.redirect('/auth/login');

    } catch (err) {
        console.error(
            '회원가입 오류:',
            err.code,
            err.message
        );

        if (err.code === 'ER_DUP_ENTRY') {
            return await renderRegister(
            res,
            '중복된 아이디 또는 환자번호입니다.',
            400,
            old
            );
        }

        return await renderRegister(
            res,
            '회원가입 처리 중 오류가 발생했습니다.',
            500,
            old
        );
        }
    }
);

//로그아웃

router.post('/logout', (req, res) => {
    if (!req.session) {
        return res.redirect('/auth/login');
    }

    req.session.destroy((err) => {
        if (err) {
        console.error('로그아웃 오류:', err);
        return res.status(500).send(
            '로그아웃 중 오류가 발생했습니다.'
        );
        }

        res.clearCookie('connect.sid');
        return res.redirect('/auth/login');
    });
    });

//접근 제한 테스트

router.get(
    '/patient',
    requireRole('patient'),
    (req, res) => {
        res.send('환자 전용 페이지입니다.');
    }
);

router.get(
    '/doctor',
    requireRole('의사'),
    (req, res) => {
        res.send('의사 전용 페이지입니다.');
    }
);

router.get(
    '/nurse',
    requireRole('간호사'),
    (req, res) => {
        res.send('간호사 전용 페이지입니다.');
    }
);

router.get(
    '/admin',
    requireRole('관리자'),
    (req, res) => {
        return res.redirect('/auth/employees');
    }
);

//관리자용

router.get(
    '/employees',
    requireRole('관리자'),
    async (req, res) => {
        try {
        const [employees] = await db.query(`
            SELECT
            e.employee_no,
            e.employee_name,
            e.job_type,
            e.license_no,
            e.username,
            e.emp_status,
            e.dept_code,
            d.dept_name
            FROM employee AS e
            LEFT JOIN department AS d
            ON e.dept_code = d.dept_code
            ORDER BY e.employee_no ASC
        `);

        return res.render('auth/employees', {
            employees,
            adminName: req.session.user.name
        });

        } catch (err) {
        console.error('직원 목록 조회 오류:', err);

        return res.status(500).send(
            '직원 목록을 불러오는 중 오류가 발생했습니다.'
        );
        }
    }
);

module.exports = router;
module.exports.requireRole = requireRole;
