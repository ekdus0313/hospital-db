SELECT 
    patient_no,
    patient_name,
    username,
    password,
    phone,
    birth_date,
    insurance_code
FROM patient
WHERE 1=1
and username = ''
;

SELECT 
    employee_no,
    employee_name,
    job_type,
    dept_code,
    username,
    password,
    emp_status
FROM employee
WHERE 1=1
and username = ''
;