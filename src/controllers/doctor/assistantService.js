const db = require('../../config/dbConnection');
const STATUS = require('../../utils/constants').STATUS;

/**
 * Assistant Service
 * Database operations for assistant management
 */

/**
 * Check if phone number exists in assistant records
 */
exports.checkAssistantPhoneExists = async (phoneNumber) => {
    try {
        const query = `
            SELECT assistant_id, doctor_id, is_active
            FROM assistant_records
            WHERE assistant_mobile = $1
        `;

        const result = await db.query(query, [phoneNumber]);

        return {
            status: STATUS.SUCCESS,
            exists: result.rows.length > 0,
            isActive: result.rows.length > 0 ? result.rows[0].is_active === 1 : false,
            data: result.rows.length > 0 ? result.rows[0] : null
        };
    } catch (error) {
        console.error('Check Assistant Phone Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error checking phone number',
            error: error.message
        };
    }
};

/**
 * Check if email exists in assistant records
 */
exports.checkAssistantEmailExists = async (email) => {
    try {
        const query = `
            SELECT assistant_id, doctor_id
            FROM assistant_records
            WHERE assistant_email = $1
        `;

        const result = await db.query(query, [email]);

        return {
            status: STATUS.SUCCESS,
            exists: result.rows.length > 0
        };
    } catch (error) {
        console.error('Check Assistant Email Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error checking email',
            error: error.message
        };
    }
};

/**
 * Get assistant by phone number (includes PIN field)
 */
exports.getAssistantByPhone = async (phoneNumber) => {
    try {
        const query = `
            SELECT 
                assistant_id,
                assistant_name,
                assistant_mobile,
                assistant_email,
                assistant_pin,
                doctor_id,
                is_active,
                created_at,
                updated_at
            FROM assistant_records
            WHERE assistant_mobile = $1 AND is_active = 1
        `;

        const result = await db.query(query, [phoneNumber]);

        if (result.rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Assistant not found',
                data: null
            };
        }

        return {
            status: STATUS.SUCCESS,
            data: result.rows[0]
        };
    } catch (error) {
        console.error('Get Assistant By Phone Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error retrieving assistant',
            error: error.message
        };
    }
};

/**
 * Get assistant by ID
 */
exports.getAssistantById = async (assistantId) => {
    try {
        const query = `
            SELECT 
                a.assistant_id,
                a.assistant_name,
                a.assistant_mobile,
                a.assistant_email,
                a.doctor_id,
                a.is_active,
                a.created_at,
                a.updated_at,
                d.dr_name as doctor_name,
                d.dr_email as doctor_email,
                d.dr_specialization as doctor_specialization
            FROM assistant_records a
            LEFT JOIN doctors_records d ON a.doctor_id = d.dr_id
            WHERE a.assistant_id = $1
        `;

        const result = await db.query(query, [assistantId]);

        if (result.rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Assistant not found',
                data: null
            };
        }

        return {
            status: STATUS.SUCCESS,
            data: result.rows[0]
        };
    } catch (error) {
        console.error('Get Assistant By ID Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error retrieving assistant',
            error: error.message
        };
    }
};

/**
 * Create new assistant in database
 */
exports.createAssistantInDB = async (assistantData) => {
    try {
        const {
            assistant_name,
            assistant_mobile,
            assistant_email,
            doctor_id,
            created_by
        } = assistantData;

        const query = `
            INSERT INTO assistant_records (
                assistant_name,
                assistant_mobile,
                assistant_email,
                doctor_id,
                created_by,
                is_active,
                created_at,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING 
                assistant_id,
                assistant_name,
                assistant_mobile,
                assistant_email,
                doctor_id,
                is_active,
                created_at,
                updated_at
        `;

        const values = [
            assistant_name,
            assistant_mobile,
            assistant_email,
            doctor_id,
            created_by || doctor_id
        ];

        const result = await db.query(query, values);

        return {
            status: STATUS.SUCCESS,
            message: 'Assistant created successfully',
            data: result.rows[0]
        };
    } catch (error) {
        console.error('Create Assistant Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error creating assistant',
            error: error.message
        };
    }
};

/**
 * Get all assistants for a doctor
 */
exports.getAssistantsByDoctorId = async (doctorId, page = 1, limit = 20) => {
    try {
        const offset = (page - 1) * limit;

        const countQuery = `
            SELECT COUNT(*) as total
            FROM assistant_records
            WHERE doctor_id = $1 AND is_active = 1
        `;

        const dataQuery = `
            SELECT 
                assistant_id,
                assistant_name,
                assistant_mobile,
                assistant_email,
                doctor_id,
                is_active,
                created_at,
                updated_at
            FROM assistant_records
            WHERE doctor_id = $1 AND is_active = 1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const countResult = await db.query(countQuery, [doctorId]);
        const dataResult = await db.query(dataQuery, [doctorId, limit, offset]);

        const total = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);

        return {
            status: STATUS.SUCCESS,
            data: {
                assistants: dataResult.rows,
                pagination: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalItems: total,
                    itemsPerPage: limit,
                    hasNext: page < totalPages,
                    hasPrevious: page > 1
                }
            }
        };
    } catch (error) {
        console.error('Get Assistants By Doctor Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error retrieving assistants',
            error: error.message
        };
    }
};

/**
 * Update assistant information
 */
exports.updateAssistantInfo = async (assistantId, updateData) => {
    try {
        const allowedFields = [
            'assistant_name',
            'assistant_email',
            'assistant_mobile',
            'assistant_pin',
            'is_active',
            'updated_by'
        ];

        // Map frontend field names to database field names
        const fieldMapping = {
            'firstName': 'assistant_name',
            'lastName': 'assistant_name', // Will be combined with firstName
            'email': 'assistant_email',
            'phoneNumber': 'assistant_mobile',
            'isActive': 'is_active',
            'assistant_name': 'assistant_name',
            'assistant_email': 'assistant_email',
            'assistant_mobile': 'assistant_mobile',
            'assistant_pin': 'assistant_pin',
            'is_active': 'is_active',
            'updated_by': 'updated_by'
        };

        // Handle firstName + lastName combination
        if (updateData.firstName || updateData.lastName) {
            const firstName = updateData.firstName || '';
            const lastName = updateData.lastName || '';
            updateData.assistant_name = `${firstName} ${lastName}`.trim();
            delete updateData.firstName;
            delete updateData.lastName;
        }

        // Convert boolean isActive to integer (0 or 1)
        if (updateData.isActive !== undefined && typeof updateData.isActive === 'boolean') {
            updateData.isActive = updateData.isActive ? 1 : 0;
        }
        if (updateData.is_active !== undefined && typeof updateData.is_active === 'boolean') {
            updateData.is_active = updateData.is_active ? 1 : 0;
        }

        // Map field names
        const mappedData = {};
        Object.keys(updateData).forEach(key => {
            const mappedKey = fieldMapping[key];
            if (mappedKey && updateData[key] !== undefined) {
                mappedData[mappedKey] = updateData[key];
            }
        });

        const updateFields = [];
        const values = [];
        let paramCount = 1;

        Object.keys(mappedData).forEach(key => {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = $${paramCount}`);
                values.push(mappedData[key]);
                paramCount++;
            }
        });

        if (updateFields.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'No valid fields to update'
            };
        }

        // Add updated_at timestamp
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

        values.push(assistantId);

        const query = `
            UPDATE assistant_records
            SET ${updateFields.join(', ')}
            WHERE assistant_id = $${paramCount}
            RETURNING 
                assistant_id,
                assistant_name,
                assistant_mobile,
                assistant_email,
                doctor_id,
                is_active,
                created_at,
                updated_at
        `;

        const result = await db.query(query, values);

        if (result.rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Assistant not found'
            };
        }

        return {
            status: STATUS.SUCCESS,
            message: 'Assistant updated successfully',
            data: result.rows[0]
        };
    } catch (error) {
        console.error('Update Assistant Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error updating assistant',
            error: error.message
        };
    }
};

/**
 * Deactivate assistant (soft delete)
 */
exports.deactivateAssistant = async (assistantId, deactivatedBy) => {
    try {
        const query = `
            UPDATE assistant_records
            SET 
                is_active = 0,
                updated_by = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE assistant_id = $2
            RETURNING assistant_id, assistant_name
        `;

        const result = await db.query(query, [deactivatedBy, assistantId]);

        if (result.rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Assistant not found'
            };
        }

        return {
            status: STATUS.SUCCESS,
            message: 'Assistant deactivated successfully',
            data: result.rows[0]
        };
    } catch (error) {
        console.error('Deactivate Assistant Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error deactivating assistant',
            error: error.message
        };
    }
};

/**
 * Reactivate assistant
 */
exports.reactivateAssistant = async (assistantId, reactivatedBy) => {
    try {
        const query = `
            UPDATE assistant_records
            SET 
                is_active = 1,
                updated_by = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE assistant_id = $2
            RETURNING assistant_id, assistant_name
        `;

        const result = await db.query(query, [reactivatedBy, assistantId]);

        if (result.rows.length === 0) {
            return {
                status: STATUS.FAILURE,
                message: 'Assistant not found'
            };
        }

        return {
            status: STATUS.SUCCESS,
            message: 'Assistant reactivated successfully',
            data: result.rows[0]
        };
    } catch (error) {
        console.error('Reactivate Assistant Error:', error);
        return {
            status: STATUS.FAILURE,
            message: 'Database error reactivating assistant',
            error: error.message
        };
    }
};

/**
 * Verify assistant has access to specific doctor's resources
 */
exports.verifyAssistantAccess = async (assistantId, doctorId) => {
    try {
        const query = `
            SELECT assistant_id, doctor_id
            FROM assistant_records
            WHERE assistant_id = $1 AND doctor_id = $2 AND is_active = 1
        `;

        const result = await db.query(query, [assistantId, doctorId]);

        return {
            status: STATUS.SUCCESS,
            hasAccess: result.rows.length > 0
        };
    } catch (error) {
        console.error('Verify Assistant Access Error:', error);
        return {
            status: STATUS.FAILURE,
            hasAccess: false,
            error: error.message
        };
    }
};
