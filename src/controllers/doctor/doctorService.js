const pool = require('../../config/dbConnection');
const STATUS = require('../../utils/constants').STATUS;

/**
 * Doctor Service - Handles all doctor database operations
 * Following database schema instructions for doctors_records table
 */

/**
 * Get doctor data by phone number
 * @param {string} phoneNumber - Doctor's phone number
 * @returns {Object} - Doctor data or null if not found
 */
exports.getDoctorByPhone = async function (phoneNumber) {
    try {
        const query = `
            SELECT 
                dr_id, 
                dr_name, 
                dr_email, 
                dr_phone_number,
                dr_dob,
                dr_specialization,
                dr_highest_designation,
                dr_licence_id,
                dr_licence_type,
                dr_practice_start_date,
                dr_city,
                dr_state,
                dr_country,
                dr_pin,
                is_active,
                last_login,
                created_at,
                updated_at
            FROM doctors_records 
            WHERE dr_phone_number = $1 AND is_active = 1
        `;

        const { rows } = await pool.query(query, [phoneNumber]);
        return { status: STATUS.SUCCESS, data: rows[0] || null };
    } catch (error) {
        console.error('Error fetching doctor by phone:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database query error while fetching doctor',
            error: error.message
        };
    }
};

/**
 * Get doctor data by email
 * @param {string} email - Doctor's email
 * @returns {Object} - Doctor data or null if not found
 */
exports.getDoctorByEmail = async function (email) {
    try {
        const query = `
            SELECT 
                dr_id, 
                dr_name, 
                dr_email, 
                dr_phone_number,
                dr_dob,
                dr_specialization,
                dr_highest_designation,
                dr_licence_id,
                dr_licence_type,
                dr_practice_start_date,
                dr_city,
                dr_state,
                dr_country,
                dr_pin,
                is_active,
                last_login,
                created_at,
                updated_at
            FROM doctors_records 
            WHERE dr_email = $1 AND is_active = 1
        `;

        const { rows } = await pool.query(query, [email]);
        return { status: STATUS.SUCCESS, data: rows[0] || null };
    } catch (error) {
        console.error('Error fetching doctor by email:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database query error while fetching doctor',
            error: error.message
        };
    }
};

/**
 * Create new doctor in database
 * @param {Object} doctorData - Doctor information
 * @returns {Object} - Created doctor data
 */
exports.createDoctorInDB = async function (doctorData) {
    try {
        // Validate required fields according to schema
        const requiredFields = [
            'dr_name',
            'dr_phone_number',
            'dr_email'
        ];

        for (const field of requiredFields) {
            if (!doctorData[field]) {
                return {
                    status: STATUS.FAILURE,
                    message: `Missing required field: ${field}`
                };
            }
        }

        // Set default values for system fields
        const currentTime = new Date().toISOString();
        const doctorRecord = {
            ...doctorData,
            created_at: currentTime,
            updated_at: currentTime,
            last_login: currentTime,
            is_active: 1
        };

        // Build dynamic query
        const columns = Object.keys(doctorRecord).join(', ');
        const values = Object.values(doctorRecord);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

        const query = `
            INSERT INTO doctors_records (${columns}) 
            VALUES (${placeholders}) 
            RETURNING 
                dr_id, 
                dr_name, 
                dr_email, 
                dr_phone_number,
                dr_specialization,
                dr_highest_designation,
                dr_licence_id,
                dr_licence_type,
                created_at,
                updated_at
        `;

        const { rows } = await pool.query(query, values);

        if (rows && rows.length > 0) {
            return {
                status: STATUS.SUCCESS,
                data: rows[0],
                message: 'Doctor created successfully'
            };
        } else {
            return {
                status: STATUS.FAILURE,
                message: 'Failed to create doctor record'
            };
        }
    } catch (error) {
        console.error('Error creating doctor:', error);

        // Handle unique constraint violations
        if (error.code === '23505') {
            if (error.constraint && error.constraint.includes('email')) {
                return {
                    status: STATUS.FAILURE,
                    message: 'Email already exists. Please use a different email address.'
                };
            } else if (error.constraint && error.constraint.includes('phone')) {
                return {
                    status: STATUS.FAILURE,
                    message: 'Phone number already exists. Please use a different phone number.'
                };
            } else {
                return {
                    status: STATUS.FAILURE,
                    message: 'Doctor with this information already exists.'
                };
            }
        }

        return {
            status: STATUS.FAILURE,
            message: 'Database error while creating doctor',
            error: error.message
        };
    }
};

/**
 * Update doctor's last login timestamp
 * @param {number} doctorId - Doctor ID
 * @returns {Object} - Update result
 */
exports.updateLastLogin = async function (doctorId) {
    try {
        const query = `
            UPDATE doctors_records 
            SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
            WHERE dr_id = $1
            RETURNING dr_id, last_login
        `;

        const { rows } = await pool.query(query, [doctorId]);

        if (rows && rows.length > 0) {
            return {
                status: STATUS.SUCCESS,
                data: rows[0],
                message: 'Last login updated successfully'
            };
        } else {
            return {
                status: STATUS.FAILURE,
                message: 'Doctor not found or inactive'
            };
        }
    } catch (error) {
        console.error('Error updating last login:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while updating last login',
            error: error.message
        };
    }
};

/**
 * Update doctor information
 * @param {number} doctorId - Doctor ID
 * @param {Object} updateData - Data to update
 * @returns {Object} - Update result
 */
exports.updateDoctorInfo = async function (doctorId, updateData) {
    try {
        if (!updateData || Object.keys(updateData).length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'No data provided for update'
            };
        }

        // Add system fields
        updateData.updated_at = new Date().toISOString();

        // Build dynamic update query
        const updateFields = Object.keys(updateData);
        const setClause = updateFields.map((field, index) => `${field} = $${index + 1}`).join(', ');
        const values = Object.values(updateData);
        values.push(doctorId); // Add dr_id as last parameter

        const query = `
            UPDATE doctors_records 
            SET ${setClause}
            WHERE dr_id = $${values.length} AND is_active = 1
            RETURNING dr_id, dr_name, dr_email, dr_phone_number, updated_at
        `;

        const { rows } = await pool.query(query, values);

        if (rows && rows.length > 0) {
            return {
                status: STATUS.SUCCESS,
                data: rows[0],
                message: 'Doctor information updated successfully'
            };
        } else {
            return {
                status: STATUS.FAILURE,
                message: 'Doctor not found or inactive'
            };
        }
    } catch (error) {
        console.error('Error updating doctor info:', error);

        // Handle unique constraint violations
        if (error.code === '23505') {
            if (error.constraint && error.constraint.includes('email')) {
                return {
                    status: STATUS.FAILURE,
                    message: 'Email already exists. Please use a different email address.'
                };
            } else if (error.constraint && error.constraint.includes('phone')) {
                return {
                    status: STATUS.FAILURE,
                    message: 'Phone number already exists. Please use a different phone number.'
                };
            }
        }

        return {
            status: STATUS.FAILURE,
            message: 'Database error while updating doctor information',
            error: error.message
        };
    }
};

/**
 * Deactivate doctor (soft delete)
 * @param {number} doctorId - Doctor ID
 * @returns {Object} - Deactivation result
 */
exports.deactivateDoctor = async function (doctorId) {
    try {
        const currentTime = new Date().toISOString();
        const query = `
            UPDATE doctors_records 
            SET is_active = 0, updated_at = $1
            WHERE dr_id = $2
            RETURNING dr_id, is_active
        `;

        const { rows } = await pool.query(query, [currentTime, doctorId]);

        if (rows && rows.length > 0) {
            return {
                status: STATUS.SUCCESS,
                data: rows[0],
                message: 'Doctor deactivated successfully'
            };
        } else {
            return {
                status: STATUS.FAILURE,
                message: 'Doctor not found'
            };
        }
    } catch (error) {
        console.error('Error deactivating doctor:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while deactivating doctor',
            error: error.message
        };
    }
};

/**
 * Check if phone number exists
 * @param {string} phoneNumber - Phone number to check
 * @returns {Object} - Existence check result
 */
exports.checkPhoneExists = async function (phoneNumber) {
    try {
        const query = `
            SELECT dr_id, is_active 
            FROM doctors_records 
            WHERE dr_phone_number = $1 AND is_active = 1
        `;

        const { rows } = await pool.query(query, [phoneNumber]);
        return {
            status: STATUS.SUCCESS,
            exists: rows.length > 0,
            isActive: rows.length > 0 ? rows[0].is_active === 1 : false,
            doctorId: rows.length > 0 ? rows[0].dr_id : null
        };
    } catch (error) {
        console.error('Error checking phone existence:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while checking phone number',
            error: error.message
        };
    }
};

/**
 * Check if email exists
 * @param {string} email - Email to check
 * @returns {Object} - Existence check result
 */
exports.checkEmailExists = async function (email) {
    try {
        const query = `
            SELECT dr_id, is_active 
            FROM doctors_records 
            WHERE dr_email = $1
        `;

        const { rows } = await pool.query(query, [email]);
        return {
            status: STATUS.SUCCESS,
            exists: rows.length > 0,
            isActive: rows.length > 0 ? rows[0].is_active === 1 : false,
            doctorId: rows.length > 0 ? rows[0].dr_id : null
        };
    } catch (error) {
        console.error('Error checking email existence:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while checking email',
            error: error.message
        };
    }
};

/**
 * Get doctor by ID
 * @param {number} doctorId - Doctor ID
 * @returns {Object} - Doctor data
 */
exports.getDoctorById = async function (doctorId) {
    try {
        const query = `
            SELECT 
                dr_id, 
                dr_name, 
                dr_email, 
                dr_phone_number,
                dr_dob,
                dr_specialization,
                dr_highest_designation,
                dr_licence_id,
                dr_licence_type,
                dr_practice_start_date,
                dr_city,
                dr_state,
                dr_country,
                dr_pin,
                is_active,
                last_login,
                created_at,
                updated_at
            FROM doctors_records 
            WHERE dr_id = $1 AND is_active = 1
        `;

        const { rows } = await pool.query(query, [doctorId]);

        if (rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Doctor not found or inactive'
            };
        }

        return {
            status: STATUS.SUCCESS,
            data: rows[0]
        };
    } catch (error) {
        console.error('Error fetching doctor by ID:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error while fetching doctor',
            error: error.message
        };
    }
};