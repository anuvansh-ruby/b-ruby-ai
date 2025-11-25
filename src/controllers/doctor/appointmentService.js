const pool = require('../../config/dbConnection');
const STATUS = require('../../utils/constants').STATUS;

/**
 * Appointment Service - Handles all appointment database operations
 * Following database schema instructions for dr_appointment and patients_records tables
 */

/**
 * Get all appointments for a doctor with patient details
 * @param {number} doctorId - Doctor's ID from JWT token
 * @returns {Object} - List of appointments with patient details
 */
exports.getDoctorAppointments = async function (doctorId) {
    try {
        const query = `
            SELECT 
                da.appointment_id,
                da.patient_id,
                da.dr_id,
                da.patient_pulse,
                da.patient_blood_pressure,
                da.patient_temprature,
                da.patient_height,
                da.patient_weight,
                da.prescription_url,
                da.summary_url,
                da.is_active,
                da.created_at,
                da.updated_at,
                pr.patient_first_name,
                pr.patient_last_name,
                pr.patient_email,
                pr.patient_phone_number,
                pr.patient_date_of_birth,
                pr.patient_address,
                pr.patient_last_visit_date,
                pr.patient_pin
            FROM dr_appointment da
            INNER JOIN patients_records pr ON da.patient_id = pr.patient_id
            WHERE da.dr_id = $1 
                AND da.is_active = 1 
                AND pr.is_active = 1
            ORDER BY da.updated_at DESC
        `;

        const { rows } = await pool.query(query, [doctorId]);

        return {
            status: STATUS.SUCCESS,
            data: rows
        };
    } catch (error) {
        console.error('Error fetching doctor appointments:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while fetching appointments',
            error: error.message
        };
    }
};

/**
 * Search appointments by patient name or email
 * @param {number} doctorId - Doctor's ID from JWT token
 * @param {string} searchQuery - Search term for patient name or email
 * @returns {Object} - Filtered list of appointments
 */
exports.searchDoctorAppointments = async function (doctorId, searchQuery) {
    try {
        const query = `
            SELECT 
                da.appointment_id,
                da.patient_id,
                da.dr_id,
                da.patient_pulse,
                da.patient_blood_pressure,
                da.patient_temprature,
                da.patient_height,
                da.patient_weight,
                da.prescription_url,
                da.summary_url,
                da.is_active,
                da.created_at,
                da.updated_at,
                pr.patient_first_name,
                pr.patient_last_name,
                pr.patient_email,
                pr.patient_phone_number,
                pr.patient_date_of_birth,
                pr.patient_address,
                pr.patient_last_visit_date,
                pr.patient_pin
            FROM dr_appointment da
            INNER JOIN patients_records pr ON da.patient_id = pr.patient_id
            WHERE da.dr_id = $1 
                AND da.is_active = 1 
                AND pr.is_active = 1
                AND (
                    LOWER(pr.patient_first_name) LIKE LOWER($2) OR
                    LOWER(pr.patient_last_name) LIKE LOWER($2) OR
                    LOWER(pr.patient_email) LIKE LOWER($2) OR
                    LOWER(CONCAT(pr.patient_first_name, ' ', pr.patient_last_name)) LIKE LOWER($2)
                )
            ORDER BY da.updated_at DESC
        `;

        const searchPattern = `%${searchQuery}%`;
        const { rows } = await pool.query(query, [doctorId, searchPattern]);

        return {
            status: STATUS.SUCCESS,
            data: rows
        };
    } catch (error) {
        console.error('Error searching doctor appointments:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while searching appointments',
            error: error.message
        };
    }
};

/**
 * Get specific appointment details
 * @param {number} appointmentId - Appointment ID
 * @param {number} doctorId - Doctor's ID from JWT token
 * @returns {Object} - Appointment details with patient info, transcription, and SOAP summary
 */
exports.getAppointmentDetails = async function (appointmentId, doctorId) {
    try {
        const query = `
            SELECT 
                da.appointment_id,
                da.patient_id,
                da.dr_id,
                da.patient_pulse,
                da.patient_blood_pressure,
                da.patient_temprature,
                da.patient_height,
                da.patient_weight,
                da.prescription_url,
                da.summary_url,
                da.is_active,
                da.created_at AS appointment_created_at,
                da.updated_at AS appointment_updated_at,
                pr.patient_first_name,
                pr.patient_last_name,
                pr.patient_email,
                pr.patient_phone_number,
                pr.patient_date_of_birth,
                pr.patient_address,
                pr.patient_last_visit_date,
                pr.patient_pin,
                dad.appointment_detail_id,
                dad.appointment_summary,
                dad.appointemnt_transcription,
                dad.prescription_id,
                dad.created_at AS detail_created_at,
                dad.updated_at AS detail_updated_at
            FROM dr_appointment da
            INNER JOIN patients_records pr ON da.patient_id = pr.patient_id
            LEFT JOIN dr_appointment_details dad ON da.appointment_id = dad.appointment_id 
                AND dad.patient_id = da.patient_id 
                AND dad.dr_id = da.dr_id 
                AND dad.is_active = 1
            WHERE da.appointment_id = $1 
                AND da.dr_id = $2 
                AND da.is_active = 1 
                AND pr.is_active = 1
        `;

        const { rows } = await pool.query(query, [appointmentId, doctorId]);

        if (rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Appointment not found or access denied'
            };
        }

        return {
            status: STATUS.SUCCESS,
            data: rows[0]
        };
    } catch (error) {
        console.error('Error fetching appointment details:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while fetching appointment details',
            error: error.message
        };
    }
};

/**
 * Create new appointment for a patient
 * @param {number} patientId - Patient ID
 * @param {number} doctorId - Doctor's ID from JWT token
 * @param {number} createdBy - User ID who created the appointment
 * @param {Object} vitalSigns - Vital signs data (optional)
 * @returns {Object} - Created appointment details
 */
exports.createAppointment = async function (patientId, doctorId, createdBy, vitalSigns = {}) {
    try {
        // First check if patient exists and is active
        const patientCheckQuery = `
            SELECT patient_id, patient_first_name, patient_last_name, is_active 
            FROM patients_records 
            WHERE patient_id = $1 AND is_active = 1
        `;

        const patientResult = await pool.query(patientCheckQuery, [patientId]);

        if (patientResult.rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Patient not found or inactive'
            };
        }

        // Create the appointment with vital signs
        const currentTime = new Date().toISOString();
        const createQuery = `
            INSERT INTO dr_appointment (
                patient_id, 
                dr_id, 
                created_by, 
                updated_by, 
                created_at, 
                updated_at,
                patient_weight,
                patient_blood_pressure,
                patient_pulse,
                patient_temprature,
                patient_height,
                is_active
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1) 
            RETURNING *
        `;

        const { rows } = await pool.query(createQuery, [
            patientId,
            doctorId,
            createdBy,
            createdBy,
            currentTime,
            currentTime,
            vitalSigns.patient_weight,
            vitalSigns.patient_blood_pressure,
            vitalSigns.patient_pulse,
            vitalSigns.patient_temprature,
            vitalSigns.patient_height
        ]);

        if (rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Failed to create appointment'
            };
        }

        // Get the full appointment details with patient info
        const appointmentDetails = await this.getAppointmentDetails(rows[0].appointment_id, doctorId);

        return appointmentDetails;
    } catch (error) {
        console.error('Error creating appointment:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while creating appointment',
            error: error.message
        };
    }
};

/**
 * Update appointment vital signs
 * @param {number} appointmentId - Appointment ID
 * @param {number} doctorId - Doctor's ID from JWT token
 * @param {Object} vitals - Vital signs data
 * @param {number} updatedBy - User ID who updated the appointment
 * @returns {Object} - Updated appointment details
 */
exports.updateAppointmentVitals = async function (appointmentId, doctorId, vitals, updatedBy) {
    try {
        // Verify appointment belongs to the doctor
        const checkQuery = `
            SELECT appointment_id 
            FROM dr_appointment 
            WHERE appointment_id = $1 AND dr_id = $2 AND is_active = 1
        `;

        const checkResult = await pool.query(checkQuery, [appointmentId, doctorId]);

        if (checkResult.rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Appointment not found or access denied'
            };
        }

        // Build dynamic update query for vitals
        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        if (vitals.patient_pulse !== undefined) {
            updateFields.push(`patient_pulse = $${paramIndex++}`);
            values.push(vitals.patient_pulse);
        }
        if (vitals.patient_blood_pressure !== undefined) {
            updateFields.push(`patient_blood_pressure = $${paramIndex++}`);
            values.push(vitals.patient_blood_pressure);
        }
        if (vitals.patient_temprature !== undefined) {
            updateFields.push(`patient_temprature = $${paramIndex++}`);
            values.push(vitals.patient_temprature);
        }
        if (vitals.patient_height !== undefined) {
            updateFields.push(`patient_height = $${paramIndex++}`);
            values.push(vitals.patient_height);
        }
        if (vitals.patient_weight !== undefined) {
            updateFields.push(`patient_weight = $${paramIndex++}`);
            values.push(vitals.patient_weight);
        }

        if (updateFields.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'No vital signs provided for update'
            };
        }

        // Add system fields
        updateFields.push(`updated_by = $${paramIndex++}`);
        updateFields.push(`updated_at = $${paramIndex++}`);
        values.push(updatedBy, new Date().toISOString());

        // Add where conditions
        values.push(appointmentId, doctorId);

        const updateQuery = `
            UPDATE dr_appointment 
            SET ${updateFields.join(', ')}
            WHERE appointment_id = $${paramIndex++} AND dr_id = $${paramIndex++}
            RETURNING *
        `;

        const { rows } = await pool.query(updateQuery, values);

        if (rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Failed to update appointment vitals'
            };
        }

        // Get the full appointment details with patient info
        const appointmentDetails = await this.getAppointmentDetails(appointmentId, doctorId);

        return appointmentDetails;
    } catch (error) {
        console.error('Error updating appointment vitals:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while updating appointment vitals',
            error: error.message
        };
    }
};

/**
 * Get patient history (all appointments for a patient)
 * @param {number} patientId - Patient ID
 * @param {number} doctorId - Doctor's ID from JWT token
 * @returns {Object} - List of patient's appointments with details including transcription and SOAP summary
 */
exports.getPatientHistory = async function (patientId, doctorId) {
    try {
        const query = `
            SELECT 
                da.appointment_id,
                da.patient_id,
                da.dr_id,
                da.patient_pulse,
                da.patient_blood_pressure,
                da.patient_temprature,
                da.patient_height,
                da.patient_weight,
                da.prescription_url,
                da.summary_url,
                da.is_active,
                da.created_at AS appointment_created_at,
                da.updated_at AS appointment_updated_at,
                pr.patient_first_name,
                pr.patient_last_name,
                pr.patient_email,
                pr.patient_phone_number,
                pr.patient_date_of_birth,
                pr.patient_address,
                pr.patient_last_visit_date,
                pr.patient_pin,
                dad.appointment_detail_id,
                dad.appointment_summary,
                dad.appointemnt_transcription,
                dad.prescription_id,
                dad.created_at AS detail_created_at,
                dad.updated_at AS detail_updated_at
            FROM dr_appointment da
            INNER JOIN patients_records pr ON da.patient_id = pr.patient_id
            LEFT JOIN dr_appointment_details dad ON da.appointment_id = dad.appointment_id 
                AND dad.patient_id = da.patient_id 
                AND dad.dr_id = da.dr_id 
                AND dad.is_active = 1
            WHERE da.patient_id = $1 
                AND da.dr_id = $2 
                AND da.is_active = 1 
                AND pr.is_active = 1
            ORDER BY da.created_at DESC
        `;

        const { rows } = await pool.query(query, [patientId, doctorId]);

        return {
            status: STATUS.SUCCESS,
            data: rows
        };
    } catch (error) {
        console.error('Error fetching patient history:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while fetching patient history',
            error: error.message
        };
    }
};

/**
 * Get recent patients (patients with recent appointments)
 * @param {number} doctorId - Doctor's ID from JWT token
 * @param {number} limit - Number of recent patients to fetch (default: 10)
 * @returns {Object} - List of recent patients
 */
exports.getRecentPatients = async function (doctorId, limit = 10) {
    try {
        const query = `
            SELECT DISTINCT ON (da.patient_id)
                da.appointment_id,
                da.patient_id,
                da.dr_id,
                da.patient_pulse,
                da.patient_blood_pressure,
                da.patient_temprature,
                da.patient_height,
                da.patient_weight,
                da.prescription_url,
                da.summary_url,
                da.is_active,
                da.created_at,
                da.updated_at,
                pr.patient_first_name,
                pr.patient_last_name,
                pr.patient_email,
                pr.patient_phone_number,
                pr.patient_date_of_birth,
                pr.patient_address,
                pr.patient_last_visit_date,
                pr.patient_pin
            FROM dr_appointment da
            INNER JOIN patients_records pr ON da.patient_id = pr.patient_id
            WHERE da.dr_id = $1 
                AND da.is_active = 1 
                AND pr.is_active = 1
            ORDER BY da.patient_id, da.updated_at DESC
            LIMIT $2
        `;

        const { rows } = await pool.query(query, [doctorId, limit]);

        return {
            status: STATUS.SUCCESS,
            data: rows
        };
    } catch (error) {
        console.error('Error fetching recent patients:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while fetching recent patients',
            error: error.message
        };
    }
};

/**
 * Update appointment status (activate/deactivate)
 * @param {number} appointmentId - Appointment ID
 * @param {number} doctorId - Doctor's ID from JWT token
 * @param {boolean} isActive - New status
 * @param {number} updatedBy - User ID who updated the appointment
 * @returns {Object} - Update result
 */
exports.updateAppointmentStatus = async function (appointmentId, doctorId, isActive, updatedBy) {
    try {
        const query = `
            UPDATE dr_appointment 
            SET is_active = $1, updated_by = $2, updated_at = $3
            WHERE appointment_id = $4 AND dr_id = $5
            RETURNING appointment_id, is_active
        `;

        const { rows } = await pool.query(query, [
            isActive ? 1 : 0,
            updatedBy,
            new Date().toISOString(),
            appointmentId,
            doctorId
        ]);

        if (rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Appointment not found or access denied'
            };
        }

        return {
            status: STATUS.SUCCESS,
            data: { success: true, appointment: rows[0] },
            message: `Appointment ${isActive ? 'activated' : 'deactivated'} successfully`
        };
    } catch (error) {
        console.error('Error updating appointment status:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while updating appointment status',
            error: error.message
        };
    }
};

/**
 * Get doctor's patients with pagination and search
 * @param {number} doctorId - Doctor's ID from JWT token
 * @param {number} page - Page number (1-based)
 * @param {number} limit - Number of patients per page
 * @param {string} search - Search term for patient name or phone number
 * @returns {Object} - Paginated list of distinct patients
 */
exports.getDoctorPatients = async function (doctorId, page = 1, limit = 10, search = '') {
    try {
        const offset = (page - 1) * limit;

        // Build base query for distinct patients from appointments
        let baseQuery = `
            FROM (
                SELECT DISTINCT ON (da.patient_id)
                    da.patient_id,
                    pr.patient_first_name,
                    pr.patient_last_name,
                    pr.patient_email,
                    pr.patient_phone_number,
                    pr.patient_date_of_birth,
                    pr.patient_address,
                    pr.patient_last_visit_date,
                    da.updated_at as last_appointment_date
                FROM dr_appointment da
                INNER JOIN patients_records pr ON da.patient_id = pr.patient_id
                WHERE da.dr_id = $1 
                    AND da.is_active = 1 
                    AND pr.is_active = 1
                ORDER BY da.patient_id, da.updated_at DESC
            ) distinct_patients
        `;

        let whereClause = '';
        let searchPattern = '';
        let queryParams = [doctorId];
        let paramIndex = 2;

        // Add search filter if provided
        if (search && search.trim().length > 0) {
            searchPattern = `%${search.trim()}%`;
            whereClause = `
                WHERE (
                    LOWER(distinct_patients.patient_first_name) LIKE LOWER($${paramIndex}) OR
                    LOWER(distinct_patients.patient_last_name) LIKE LOWER($${paramIndex}) OR
                    LOWER(CONCAT(distinct_patients.patient_first_name, ' ', distinct_patients.patient_last_name)) LIKE LOWER($${paramIndex}) OR
                    distinct_patients.patient_phone_number LIKE $${paramIndex}
                )
            `;
            queryParams.push(searchPattern);
            paramIndex++;
        }

        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(*) as total_count
            ${baseQuery}
            ${whereClause}
        `;

        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total_count);
        const totalPages = Math.ceil(totalCount / limit);

        // Get paginated results
        const dataQuery = `
            SELECT 
                distinct_patients.patient_id,
                distinct_patients.patient_first_name,
                distinct_patients.patient_last_name,
                distinct_patients.patient_email,
                distinct_patients.patient_phone_number,
                distinct_patients.patient_date_of_birth,
                distinct_patients.patient_address,
                distinct_patients.patient_last_visit_date,
                distinct_patients.last_appointment_date
            ${baseQuery}
            ${whereClause}
            ORDER BY distinct_patients.last_appointment_date DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);
        const dataResult = await pool.query(dataQuery, queryParams);

        // Format the results for frontend consumption
        const patients = dataResult.rows.map(patient => {
            const firstName = patient.patient_first_name || '';
            const lastName = patient.patient_last_name || '';
            const fullName = `${firstName} ${lastName}`.trim() || `Patient ${patient.patient_id}`;

            // Generate avatar letter from first name or use 'P' for Patient
            const avatarLetter = firstName ? firstName.charAt(0).toUpperCase() : 'P';

            // Generate a color based on patient ID for consistency
            const colors = [0xFF64C8BE, 0xFF1979D2, 0xFF9C27B0, 0xFF4CAF50, 0xFFFF9800];
            const avatarColor = colors[patient.patient_id % colors.length];

            // Format last visit date
            const lastVisit = patient.patient_last_visit_date
                ? `Last visit on ${new Date(patient.patient_last_visit_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    hour12: true
                })}`
                : 'No previous visits';

            return {
                id: patient.patient_id,
                patientId: patient.patient_id,
                patientName: fullName,
                phoneNumber: patient.patient_phone_number || '',
                email: patient.patient_email || '',
                dateOfBirth: patient.patient_date_of_birth || '',
                address: patient.patient_address || '',
                lastVisit: lastVisit,
                avatar: avatarLetter,
                avatarColor: avatarColor,
                lastAppointmentDate: patient.last_appointment_date
            };
        });

        return {
            status: STATUS.SUCCESS,
            data: {
                patients: patients,
                pagination: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalCount: totalCount,
                    limit: limit,
                    hasNextPage: page < totalPages,
                    hasPreviousPage: page > 1
                }
            }
        };
    } catch (error) {
        console.error('Error fetching doctor patients:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while fetching patients',
            error: error.message
        };
    }
};

/**
 * Create patient by doctor
 * @param {Object} patientData - Patient data object
 * @returns {Object} - Created patient details
 */
exports.createPatientByDoctor = async function (patientData) {
    try {
        const {
            patient_first_name,
            patient_last_name,
            patient_email,
            patient_phone_number,
            patient_date_of_birth,
            patient_address,
            patient_pin,
            created_by_dr_id,
            created_by
        } = patientData;

        // Check if patient with same email already exists
        const existingPatientQuery = `
            SELECT * 
            FROM patients_records 
            WHERE LOWER(patient_email) = LOWER($1)
        `;

        const existingPatientResult = await pool.query(existingPatientQuery, [patient_email]);

        if (existingPatientResult.rows.length > 0) {
            const existingPatient = existingPatientResult.rows[0];
            if (existingPatient.is_active === 1) {
                // Return existing patient instead of error
                const firstName = existingPatient.patient_first_name || '';
                const lastName = existingPatient.patient_last_name || '';
                const fullName = `${firstName} ${lastName}`.trim();
                const avatarLetter = firstName ? firstName.charAt(0).toUpperCase() : 'P';
                const colors = [0xFF64C8BE, 0xFF1979D2, 0xFF9C27B0, 0xFF4CAF50, 0xFFFF9800];
                const avatarColor = colors[existingPatient.patient_id % colors.length];

                const formattedPatient = {
                    id: existingPatient.patient_id,
                    patientId: existingPatient.patient_id,
                    patientName: fullName,
                    phoneNumber: existingPatient.patient_phone_number,
                    email: existingPatient.patient_email,
                    dateOfBirth: existingPatient.patient_date_of_birth,
                    address: existingPatient.patient_address || '',
                    lastVisit: existingPatient.patient_last_visit_date ? new Date(existingPatient.patient_last_visit_date).toLocaleDateString() : 'No visits yet',
                    avatar: avatarLetter,
                    avatarColor: avatarColor,
                    createdAt: existingPatient.created_at
                };

                return {
                    status: STATUS.SUCCESS,
                    message: 'Patient already exists',
                    data: formattedPatient
                };
            }
        }

        // Check if patient with same phone number already exists
        const existingPhoneQuery = `
            SELECT * 
            FROM patients_records 
            WHERE patient_phone_number = $1
        `;

        const existingPhoneResult = await pool.query(existingPhoneQuery, [patient_phone_number]);

        if (existingPhoneResult.rows.length > 0) {
            const existingPhone = existingPhoneResult.rows[0];
            if (existingPhone.is_active === 1) {
                // Return existing patient instead of error
                const firstName = existingPhone.patient_first_name || '';
                const lastName = existingPhone.patient_last_name || '';
                const fullName = `${firstName} ${lastName}`.trim();
                const avatarLetter = firstName ? firstName.charAt(0).toUpperCase() : 'P';
                const colors = [0xFF64C8BE, 0xFF1979D2, 0xFF9C27B0, 0xFF4CAF50, 0xFFFF9800];
                const avatarColor = colors[existingPhone.patient_id % colors.length];

                const formattedPatient = {
                    id: existingPhone.patient_id,
                    patientId: existingPhone.patient_id,
                    patientName: fullName,
                    phoneNumber: existingPhone.patient_phone_number,
                    email: existingPhone.patient_email,
                    dateOfBirth: existingPhone.patient_date_of_birth,
                    address: existingPhone.patient_address || '',
                    lastVisit: existingPhone.patient_last_visit_date ? new Date(existingPhone.patient_last_visit_date).toLocaleDateString() : 'No visits yet',
                    avatar: avatarLetter,
                    avatarColor: avatarColor,
                    createdAt: existingPhone.created_at
                };

                return {
                    status: STATUS.SUCCESS,
                    message: 'Patient already exists',
                    data: formattedPatient
                };
            }
        }

        // Create the patient
        const currentTime = new Date().toISOString();
        const createQuery = `
            INSERT INTO patients_records (
                patient_first_name,
                patient_last_name,
                patient_email,
                patient_phone_number,
                patient_date_of_birth,
                patient_address,
                patient_pin,
                created_by_dr_id,
                created_by,
                updated_by,
                created_at,
                updated_at,
                patient_last_visit_date,
                is_active
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1) 
            RETURNING *
        `;

        const { rows } = await pool.query(createQuery, [
            patient_first_name,
            patient_last_name,
            patient_email,
            patient_phone_number,
            patient_date_of_birth,
            patient_address,
            patient_pin,
            created_by_dr_id,
            created_by,
            created_by, // updated_by same as created_by initially
            currentTime,
            currentTime,
            currentTime // patient_last_visit_date set to creation time
        ]);

        if (rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Failed to create patient'
            };
        }

        const createdPatient = rows[0];

        // Format the response for frontend consumption
        const firstName = createdPatient.patient_first_name || '';
        const lastName = createdPatient.patient_last_name || '';
        const fullName = `${firstName} ${lastName}`.trim();
        const avatarLetter = firstName ? firstName.charAt(0).toUpperCase() : 'P';
        const colors = [0xFF64C8BE, 0xFF1979D2, 0xFF9C27B0, 0xFF4CAF50, 0xFFFF9800];
        const avatarColor = colors[createdPatient.patient_id % colors.length];

        const formattedPatient = {
            id: createdPatient.patient_id,
            patientId: createdPatient.patient_id,
            patientName: fullName,
            phoneNumber: createdPatient.patient_phone_number,
            email: createdPatient.patient_email,
            dateOfBirth: createdPatient.patient_date_of_birth,
            address: createdPatient.patient_address || '',
            lastVisit: 'Just created',
            avatar: avatarLetter,
            avatarColor: avatarColor,
            createdAt: createdPatient.created_at
        };

        return {
            status: STATUS.SUCCESS,
            data: formattedPatient,
            message: 'Patient created successfully'
        };
    } catch (error) {
        console.error('Error creating patient:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while creating patient',
            error: error.message
        };
    }
};