CREATE TABLE `insurance` (
	`insurance_code`	VARCHAR(20)	NOT NULL,
	`insurance_name`	VARCHAR(50) NOT	NULL,
	`copay_rate`	INT NOT	NULL
);

CREATE TABLE `employee` (
	`employee_no`	VARCHAR(20)	NOT NULL,
	`employee_name`	VARCHAR(50)	NOT NULL,
	`job_type`	VARCHAR(20)	NOT NULL,
	`license_no`	VARCHAR(50)	NULL,
	`username`	VARCHAR(50)	NOT NULL,
	`password`	VARCHAR(60)	NOT NULL,
	`emp_status`	VARCHAR(20) NOT	NULL,
	`dept_code`	VARCHAR(20)	NOT NULL,
	UNIQUE (`username`)
);

CREATE TABLE `patient` (
	`patient_no`	VARCHAR(20)	NOT NULL,
	`patient_name`	VARCHAR(50)	NOT NULL,
	`ssn1`	VARCHAR(255)	NOT NULL,
	`ssn2`	VARCHAR(255)	NOT NULL,
	`birth_date`	DATE	NOT NULL,
	`gender`	VARCHAR(10)	NOT NULL,
	`phone`	VARCHAR(20)	NOT NULL,
	`address1`	VARCHAR(255)	NOT NULL,
	`address2`	VARCHAR(255)	NULL,
	`address3`	VARCHAR(255)	NULL,
	`zip_code`	VARCHAR(10)	NOT NULL,
	`username`	VARCHAR(50)	NOT NULL,
	`password`	VARCHAR(60)	NOT NULL,
	`created_at`	DATETIME NOT NULL,
	`insurance_code`	VARCHAR(20)	NOT NULL,
	UNIQUE (`username`),
    UNIQUE (`ssn1`, `ssn2`)
);

ALTER TABLE `insurance` ADD CONSTRAINT `PK_INSURANCE` PRIMARY KEY (
	`insurance_code`
);


ALTER TABLE `employee` ADD CONSTRAINT `PK_EMPLOYEE` PRIMARY KEY (
	`employee_no`
);

ALTER TABLE `patient` ADD CONSTRAINT `PK_PATIENT` PRIMARY KEY (
	`patient_no`
);
ALTER TABLE `patient` ADD CONSTRAINT `FK_insurance_TO_patient_1` FOREIGN KEY (
	`insurance_code`
)
REFERENCES `insurance` (
	`insurance_code`
);
ALTER TABLE `employee` ADD CONSTRAINT `FK_department_TO_employee_1` FOREIGN KEY (
	`dept_code`
)
REFERENCES `department` (
	`dept_code`
);
