require('dotenv').config();

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db/db');

function flashTo(req, res, type, text, url) {
    req.session.flash = { type, text };
    return res.redirect(url);
}
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
        SELECT insurance_code, insurance_name, copay_rate
        FROM insurance
        ORDER BY insurance_code
    `);
    return rows;
}

// 입력 오류 안내에 쓸 화면 표시 이름
const FIELD_LABELS = {
    patient_name: '이름',
    username: '아이디',
    password: '비밀번호',
    ssn1: '주민등록번호 앞자리',
    ssn2: '주민등록번호 뒷자리',
    birth_date: '생년월일',
    gender: '성별',
    phone: '전화번호',
    zip_code: '우편번호',
    address1: '기본주소',
    address2: '상세주소',
    address3: '참고항목',
    insurance_code: '보험 유형'
};

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
            '아이디와 비밀번호를 모두 입력해 주세요.',
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
            '계정 확인이 필요합니다. 병원 관리자에게 문의해 주세요.'
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
            '아이디 또는 비밀번호가 맞지 않습니다. 다시 확인해 주세요.'
            );
        }

        if (employee.emp_status !== '재직') {
            return loginError(
            res,
            '재직 중이 아닌 직원 계정은 로그인할 수 없습니다. 병원 관리자에게 문의해 주세요.'
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
            '아이디 또는 비밀번호가 맞지 않습니다. 다시 확인해 주세요.'
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
            '아이디 또는 비밀번호가 맞지 않습니다. 다시 확인해 주세요.'
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
        '로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.'
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
            `다음 항목을 다시 확인해 주세요: ${invalidFields.map(f => FIELD_LABELS[f] || f).join(', ')}`,
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
            '생년월일을 다시 확인해 주세요. 오늘 이후 날짜는 입력할 수 없습니다.',
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
            '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.',
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
            '보험 유형을 목록에서 선택해 주세요.',
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

    const year = new Date().getFullYear();
    const prefix = `P${year}`;

    const [rows] = await db.query(`
        SELECT MAX(patient_no) AS last_no
        FROM patient
        WHERE patient_no REGEXP ?
    `, [`^${prefix}[0-9]{6}$`]);

    const lastNo = rows[0].last_no;

    const nextNo = lastNo
        ? Number(lastNo.slice(-6)) + 1
        : 1;

    if (nextNo > 999999) {
        throw new Error('환자번호 생성 범위를 초과했습니다.');
    }

    const patientNo =
        prefix + String(nextNo).padStart(6, '0');

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
            '이미 가입된 아이디 또는 주민등록번호입니다. 가입한 적이 있다면 로그인해 주세요.',
            400,
            old
            );
        }

        return await renderRegister(
            res,
            '회원가입 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
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

// 내 정보 수정 화면
router.get('/profile', requireRole('patient'), async (req, res) => {
    try {
        const patientNo = req.session.user.patient_no;
        const [patients] = await db.query(`
            SELECT
                patient_name,
                username,
                phone,
                zip_code,
                address1,
                address2,
                address3
            FROM patient
            WHERE patient_no = ?
        `, [patientNo]);

        if (patients.length === 0) {
            return res.status(404).send(
                '환자 정보를 찾을 수 없습니다.'
            );
        }
        return res.render('auth/profile', {
            patient: patients[0],
            error: null,
            success: req.query.success === '1'
                ? '회원정보가 수정되었습니다.'
                : null
        });
    } catch (err) {
        console.error('정보 조회 오류:', err);
        return res.status(500).send(
            '정보를 불러오는 중 오류가 발생했습니다.'
        );
    }
});

router.post('/profile', requireRole('patient'), async (req, res) => {
    try {
        const patientNo = req.session.user.patient_no;
        const {
            phone,
            zip_code,
            address1,
            address2,
            address3
        } = req.body;
        if (
            typeof phone !== 'string' ||
            !/^[0-9-]{9,20}$/.test(phone) ||
            typeof zip_code !== 'string' ||
            !/^[0-9]{5}$/.test(zip_code) ||
            typeof address1 !== 'string' ||
            !address1.trim() ||
            address1.length > 255 ||
            (address2 != null &&
                (typeof address2 !== 'string' ||
                address2.length > 255)) ||
            (address3 != null &&
                (typeof address3 !== 'string' ||
                address3.length > 255))
        ) {
            return res.status(400).send(
                '입력값을 확인해주세요.'
            );
        }
        const [result] = await db.query(`
            UPDATE patient
            SET
                phone = ?,
                zip_code = ?,
                address1 = ?,
                address2 = ?,
                address3 = ?
            WHERE patient_no = ?
        `, [
            phone,
            zip_code,
            address1.trim(),
            address2 || null,
            address3 || null,
            patientNo
        ]);
        if (result.affectedRows === 0) {
            return res.status(404).send(
                '환자 정보를 찾을 수 없습니다.'
            );
        }
        return res.redirect('/auth/profile?success=1');
    } catch (err) {
        console.error('정보 수정 오류:', err);

        return res.status(500).send(
            '정보 수정 중 오류가 발생했습니다.'
        );
    }
});
// 비밀번호 변경 화면
router.get('/change-password', requireRole('patient'), (req, res) => {
    return res.render('auth/change-password', {
        error: null,
        success: null
    });
})
router.post('/change-password', requireRole('patient'), async (req, res) => {
    const {
        currentPassword,
        newPassword,
        confirmPassword
    } = req.body;
    try {
        const patientNo = req.session.user.patient_no;
        if (
            typeof currentPassword !== 'string' ||
            typeof newPassword !== 'string' ||
            typeof confirmPassword !== 'string' ||
            !currentPassword ||
            !newPassword ||
            !confirmPassword
        ) {
            return res.status(400).render('auth/change-password', {
                error: '모든 항목을 입력해주세요.',
                success: null
            });
        }
        if (
            newPassword.length < 8 ||
            Buffer.byteLength(newPassword, 'utf8') > 72
        ) {
            return res.status(400).render('auth/change-password', {
                error: '새 비밀번호는 8자 이상, 72바이트 이하로 입력해주세요.',
                success: null
            });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).render('auth/change-password', {
                error: '새 비밀번호가 일치하지 않습니다.',
                success: null
            });
        }
        const [patients] = await db.query(`
            SELECT password
            FROM patient
            WHERE patient_no = ?
        `, [patientNo]);

        if (patients.length === 0) {
            return res.status(404).render('auth/change-password', {
                error: '환자 정보를 찾을 수 없습니다.',
                success: null
            });
        }
        const validPassword = await bcrypt.compare(
            currentPassword,
            patients[0].password
        );
        if (!validPassword) {
            return res.status(400).render('auth/change-password', {
                error: '현재 비밀번호가 올바르지 않습니다.',
                success: null
            });
        }
        const samePassword = await bcrypt.compare(
            newPassword,
            patients[0].password
        );

        if (samePassword) {
            return res.status(400).render('auth/change-password', {
                error: '기존 비밀번호와 다른 비밀번호를 입력해주세요.',
                success: null
            });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        const [result] = await db.query(`
            UPDATE patient
            SET password = ?
            WHERE patient_no = ?
            AND password = ?
        `, [
            hashedPassword,
            patientNo,
            patients[0].password
        ]);

        if (result.affectedRows === 0) {
            return res.status(409).render('auth/change-password', {
                error: '비밀번호가 변경되었습니다. 다시 시도해주세요.',
                success: null
            });
        }

        return res.render('auth/change-password', {
            error: null,
            success: '비밀번호가 성공적으로 변경되었습니다.'
        });

    } catch (err) {
        console.error('비밀번호 변경 오류:', err);

        return res.status(500).render('auth/change-password', {
            error: '비밀번호 변경 중 오류가 발생했습니다.',
            success: null
        });
    }
});

// 직원 등록 화면
router.get('/employees/new', requireRole('관리자'), async (req, res) => {
    try {
        const [departments] = await db.query(`
            SELECT dept_code, dept_name
            FROM department
            ORDER BY dept_code
        `);

        return res.render('auth/employee-form', {
            employee: null,
            departments,
            mode: 'new'
        });
    } catch (err) {
        console.error('직원 등록 화면 오류:', err);
        return flashTo(req, res, 'danger',
            '직원 등록 화면을 불러오지 못했습니다.',
            '/auth/employees');
    }
});
router.post('/employees/new', requireRole('관리자'), async (req, res) => {
    try {
        const {
            employee_no,
            employee_name,
            job_type,
            license_no,
            username,
            password,
            dept_code
        } = req.body;

        if (!employee_no?.trim() ||
            !employee_name?.trim() ||
            !job_type ||
            !username?.trim() ||
            !password ||
            !dept_code ||
            employee_no.length > 20 ||
            employee_name.length > 50 ||
            username.length > 50 ||
            (license_no && license_no.length > 50) ||
            password.length < 8 ||
            Buffer.byteLength(password, 'utf8') > 72 ||
            !['관리자', '의사', '검사실', '원무'].includes(job_type)) {

            return flashTo(req, res, 'danger',
                '입력 항목을 다시 확인해주세요.',
                '/auth/employees/new');
        }
        const [employees] = await db.query(`
            SELECT employee_no
            FROM employee
            WHERE username = ? OR employee_no = ?
        `, [username.trim(), employee_no.trim()]);

        const [patients] = await db.query(`
            SELECT patient_no
            FROM patient
            WHERE username = ?
        `, [username.trim()]);

        if (employees.length > 0 || patients.length > 0) {
            return flashTo(req, res, 'danger',
                '이미 사용 중인 아이디 또는 사번입니다.',
                '/auth/employees/new');
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        await db.query(`
            INSERT INTO employee (
                employee_no,
                employee_name,
                job_type,
                license_no,
                username,
                password,
                emp_status,
                dept_code
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            employee_no.trim(),
            employee_name.trim(),
            job_type,
            license_no || null,
            username.trim(),
            hashedPassword,
            '재직',
            dept_code
        ]);

        return flashTo(req, res, 'ok',
            '직원이 등록되었습니다.',
            '/auth/employees');

    } catch (err) {
        console.error('직원 등록 오류:', err);
        return flashTo(req, res, 'danger',
            '직원 등록 중 오류가 발생했습니다.',
            '/auth/employees/new');
    }
});

router.get('/employees/:employeeNo/edit',
    requireRole('관리자'), async (req, res) => {

    try {
        const [employees] = await db.query(`
            SELECT employee_no, employee_name, job_type,
                   license_no, username, emp_status, dept_code
            FROM employee
            WHERE employee_no = ?
        `, [req.params.employeeNo]);

        if (employees.length === 0 ||
            employees[0].emp_status !== '재직') {
            return flashTo(req, res, 'danger',
                '수정 가능한 직원을 찾을 수 없습니다.',
                '/auth/employees');
        }

        const [departments] = await db.query(`
            SELECT dept_code, dept_name
            FROM department
            ORDER BY dept_code
        `);

        return res.render('auth/employee-form', {
            employee: employees[0],
            departments,
            mode: 'edit'
        });

    } catch (err) {
        console.error('직원 수정 화면 오류:', err);
        return flashTo(req, res, 'danger',
            '직원 정보를 불러오지 못했습니다.',
            '/auth/employees');
    }
});

router.post('/employees/:employeeNo/edit',
    requireRole('관리자'), async (req, res) => {

    try {
        const employeeNo = req.params.employeeNo;
        const {
            employee_name,
            job_type,
            license_no,
            username,
            dept_code
        } = req.body;

        const editUrl =
            '/auth/employees/' +
            encodeURIComponent(employeeNo) + '/edit';

        if (!employee_name?.trim() ||
            !job_type ||
            !username?.trim() ||
            !dept_code ||
            employee_name.length > 50 ||
            username.length > 50 ||
            (license_no && license_no.length > 50) ||
            !['관리자', '의사', '검사실', '원무'].includes(job_type)) {

            return flashTo(req, res, 'danger',
                '입력 항목을 다시 확인해주세요.',
                editUrl);
        }

        if (employeeNo === req.session.user.employee_no &&
            job_type !== '관리자') {
            return flashTo(req, res, 'danger',
                '본인의 관리자 권한은 변경할 수 없습니다.',
                editUrl);
        }
        const [employees] = await db.query(`
            SELECT employee_no
            FROM employee
            WHERE username = ?
            AND employee_no <> ?
        `, [username.trim(), employeeNo]);

        const [patients] = await db.query(`
            SELECT patient_no
            FROM patient
            WHERE username = ?
        `, [username.trim()]);

        if (employees.length > 0 || patients.length > 0) {
            return flashTo(req, res, 'danger',
                '이미 사용 중인 아이디입니다.',
                editUrl);
        }

        const [result] = await db.query(`
            UPDATE employee
            SET employee_name = ?,
                job_type = ?,
                license_no = ?,
                username = ?,
                dept_code = ?
            WHERE employee_no = ?
            AND emp_status = '재직'
        `, [
            employee_name.trim(),
            job_type,
            license_no || null,
            username.trim(),
            dept_code,
            employeeNo
        ]);

        if (result.affectedRows === 0) {
            return flashTo(req, res, 'danger',
                '수정 가능한 직원을 찾을 수 없습니다.',
                '/auth/employees');
        }

        return flashTo(req, res, 'ok',
            '직원 정보가 수정되었습니다.',
            '/auth/employees');

    } catch (err) {
        console.error('직원 수정 오류:', err);
        return flashTo(req, res, 'danger',
            '직원 수정 중 오류가 발생했습니다.',
            '/auth/employees');
    }
});
router.post('/employees/:employeeNo/retire',
    requireRole('관리자'), async (req, res) => {

    try {
        const employeeNo = req.params.employeeNo;

        if (employeeNo === req.session.user.employee_no) {
            return flashTo(req, res, 'danger',
                '본인 계정은 퇴직 처리할 수 없습니다.',
                '/auth/employees');
        }

        const [result] = await db.query(`
            UPDATE employee
            SET emp_status = '퇴직'
            WHERE employee_no = ?
            AND emp_status = '재직'
        `, [employeeNo]);

        if (result.affectedRows === 0) {
            return flashTo(req, res, 'warn',
                '이미 퇴직했거나 존재하지 않는 직원입니다.',
                '/auth/employees');
        }

        return flashTo(req, res, 'ok',
            '직원이 퇴직 처리되었습니다.',
            '/auth/employees');

    } catch (err) {
        console.error('직원 퇴직 처리 오류:', err);
        return flashTo(req, res, 'danger',
            '퇴직 처리 중 오류가 발생했습니다.',
            '/auth/employees');
    }
});

const DEPT_BACK = '/auth/admin/departments';

router.get('/admin/departments', requireRole('관리자'), async (req, res) => {
    const [rows] = await db.query(
        'SELECT * FROM department ORDER BY dept_code'
    );

    res.render('auth/admin-departments', { rows });
});
router.post('/admin/departments', requireRole('관리자'), async (req, res) => {
    const { dept_code, dept_name, location, phone } = req.body;

    if (!dept_code?.trim() || !dept_name?.trim() ||
        !location?.trim() || !phone?.trim()) {
        return flashTo(req, res, 'danger', '빈 칸이 있습니다.', DEPT_BACK);
    }

    if (!/^[0-9-]{9,20}$/.test(phone.trim())) {
        return flashTo(req, res, 'danger',
            '전화번호 형식이 올바르지 않습니다.', DEPT_BACK);
    }

    try {
        await db.query(
            `INSERT INTO department
            (dept_code, dept_name, location, phone)
            VALUES (?, ?, ?, ?)`,
            [dept_code.trim(), dept_name.trim(),
            location.trim(), phone.trim()]
        );

        return flashTo(req, res, 'ok',
            `${dept_name}을(를) 등록했습니다.`, DEPT_BACK);

    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return flashTo(req, res, 'danger',
                '이미 있는 진료과코드이거나 같은 이름의 진료과가 있습니다.',
                DEPT_BACK);
        }

        throw err;
    }
});

router.post('/admin/departments/:code/edit', requireRole('관리자'), async (req, res) => {
    const { dept_name, location, phone } = req.body;

    if (!dept_name?.trim() || !location?.trim() || !phone?.trim()) {
        return flashTo(req, res, 'danger', '빈 칸이 있습니다.', DEPT_BACK);
    }

    if (!/^[0-9-]{9,20}$/.test(phone.trim())) {
        return flashTo(req, res, 'danger',
            '전화번호 형식이 올바르지 않습니다.', DEPT_BACK);
    }

    try {
        const [r] = await db.query(
            `UPDATE department
             SET dept_name = ?, location = ?, phone = ?
             WHERE dept_code = ?`,
            [dept_name.trim(), location.trim(),
             phone.trim(), req.params.code]
        );

        if (r.affectedRows === 0) {
            return flashTo(req, res, 'danger',
                '없는 진료과입니다.', DEPT_BACK);
        }

        return flashTo(req, res, 'ok',
            '수정했습니다.', DEPT_BACK);

    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return flashTo(req, res, 'danger',
                '같은 이름의 진료과가 이미 있습니다.', DEPT_BACK);
        }

        throw err;
    }
});

router.post('/admin/departments/:code/delete', requireRole('관리자'), async (req, res) => {
    try {
        const [r] = await db.query(
            'DELETE FROM department WHERE dept_code = ?',
            [req.params.code]
        );

        if (r.affectedRows === 0) {
            return flashTo(req, res, 'danger',
                '없는 진료과입니다.', DEPT_BACK);
        }

        return flashTo(req, res, 'ok',
            '삭제했습니다.', DEPT_BACK);

    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2' ||
            err.code === 'ER_ROW_IS_REFERENCED') {
            return flashTo(req, res, 'danger',
                '소속 직원 또는 연결된 데이터가 있어 삭제할 수 없습니다.',
                DEPT_BACK);
        }

        throw err;
    }
});

module.exports = router;
module.exports.requireRole = requireRole;
