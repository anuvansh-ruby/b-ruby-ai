const { mainPool } = require('../../config/multiDbConnection');
const { sendError } = require('../../middleware/setResponse');
const { generatePrescriptionPDF } = require('../../utils/pdfGenerator');

/**
 * Prescription Controller
 * Handles prescription creation and medicine management for appointments
 */

/**
 * Get or create prescription for an appointment
 * 
 * @route POST /api/appointments/:appointmentId/prescription
 * @body {number} patientId - Patient ID [required]
 * 
 * @returns {Object} JSON response with prescription details
 */
exports.getOrCreatePrescription = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const { patientId } = req.body;
        const createdBy = req.user?.userId || req.user?.drId;

        console.log(`\n📋 Get/Create Prescription Request:`);
        console.log(`   Appointment ID: ${appointmentId}`);
        console.log(`   Patient ID: ${patientId}`);
        console.log(`   Created By: ${createdBy}`);

        // Validation
        if (!appointmentId || !patientId) {
            return sendError(res, 'Appointment ID and Patient ID are required', 400);
        }

        // Check if prescription already exists for this appointment
        const checkSQL = `
            SELECT 
                pp.prescription_id,
                pp.patient_id,
                pp.prescription_raw_url,
                pp.compiled_prescription_url,
                pp.created_at,
                pp.updated_at
            FROM patient_prescription pp
            INNER JOIN dr_appointment_details dad 
                ON pp.prescription_id = dad.prescription_id
            WHERE dad.appointment_id = $1 
                AND pp.is_active = 1
        `;

        const existingPrescription = await mainPool.query(checkSQL, [appointmentId]);

        if (existingPrescription.rows.length > 0) {
            console.log(`✅ Found existing prescription: ${existingPrescription.rows[0].prescription_id}`);

            res.locals = {
                status: 'SUCCESS',
                message: 'Prescription found',
                data: {
                    prescription: existingPrescription.rows[0],
                    isNew: false
                }
            };

            return next();
        }

        // Create new prescription
        const createPrescriptionSQL = `
            INSERT INTO patient_prescription 
                (patient_id, created_by)
            VALUES ($1, $2)
            RETURNING *
        `;

        const newPrescription = await mainPool.query(createPrescriptionSQL, [
            patientId,
            createdBy
        ]);

        const prescriptionId = newPrescription.rows[0].prescription_id;
        console.log(`✅ Created new prescription: ${prescriptionId}`);

        // Check if appointment_details exists for this appointment
        const checkDetailsSQL = `
            SELECT appointment_detail_id, prescription_id
            FROM dr_appointment_details
            WHERE appointment_id = $1 AND is_active = 1
        `;

        const existingDetails = await mainPool.query(checkDetailsSQL, [appointmentId]);

        if (existingDetails.rows.length > 0) {
            // Update existing appointment_details with prescription_id
            const updateDetailsSQL = `
                UPDATE dr_appointment_details
                SET prescription_id = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
                WHERE appointment_id = $3
                RETURNING *
            `;

            await mainPool.query(updateDetailsSQL, [
                prescriptionId,
                createdBy,
                appointmentId
            ]);

            console.log(`✅ Updated appointment_details with prescription_id`);
        } else {
            // Create new appointment_details record
            const createDetailsSQL = `
                INSERT INTO dr_appointment_details
                    (appointment_id, patient_id, prescription_id, dr_id, created_by)
                SELECT 
                    da.appointment_id,
                    da.patient_id,
                    $1,
                    da.dr_id,
                    $2
                FROM dr_appointment da
                WHERE da.appointment_id = $3
                RETURNING *
            `;

            await mainPool.query(createDetailsSQL, [
                prescriptionId,
                createdBy,
                appointmentId
            ]);

            console.log(`✅ Created appointment_details with prescription_id`);
        }

        res.locals = {
            status: 'SUCCESS',
            message: 'Prescription created successfully',
            data: {
                prescription: newPrescription.rows[0],
                isNew: true
            }
        };

        next();

    } catch (error) {
        console.error('❌ Get/Create prescription error:', error);
        console.error('Stack trace:', error.stack);

        res.locals = {
            status: 'FAILURE',
            message: 'Failed to get or create prescription',
            error: error.message
        };

        next();
    }
};

/**
 * Add medicine to appointment prescription
 * 
 * @route POST /api/appointments/:appointmentId/medicines
 * @body {number} patientId - Patient ID [required]
 * @body {string} medicineName - Medicine name [required]
 * @body {string} medicineSalt - Medicine composition/salt
 * @body {string} medicineFrequency - Dosage frequency
 * @body {number} drugId - Medicine database ID
 * 
 * @returns {Object} JSON response with medicine details
 */
exports.addMedicineToAppointment = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;

        // Support both snake_case and camelCase for compatibility
        const {
            patientId,
            patient_id,
            medicineName,
            medicine_name,
            medicineSalt,
            medicine_salt,
            medicineFrequency,
            medicine_frequency,
            drugId,
            drug_id
        } = req.body;

        // Use snake_case if provided, otherwise camelCase
        const patientIdValue = patient_id || patientId;
        const medicineNameValue = medicine_name || medicineName;
        const medicineSaltValue = medicine_salt || medicineSalt;
        const medicineFrequencyValue = medicine_frequency || medicineFrequency;
        const drugIdValue = drug_id || drugId;

        const createdBy = req.user?.userId || req.user?.drId || req.doctor?.doctorId;

        console.log(`\n💊 Add Medicine to Appointment Request:`);
        console.log(`   Appointment ID: ${appointmentId}`);
        console.log(`   Patient ID: ${patientIdValue}`);
        console.log(`   Medicine Name: ${medicineNameValue}`);
        console.log(`   Medicine Salt: ${medicineSaltValue}`);
        console.log(`   Frequency: ${medicineFrequencyValue}`);
        console.log(`   Drug ID: ${drugIdValue}`);
        console.log(`   Created By: ${createdBy}`);

        // Validation
        if (!appointmentId || !patientIdValue || !medicineNameValue) {
            res.locals = {
                status: 'FAILURE',
                message: 'Appointment ID, Patient ID, and Medicine Name are required'
            };
            return next();
        }

        // Get or create prescription for this appointment
        const prescriptionResult = await getOrCreatePrescriptionInternal(
            appointmentId,
            patientIdValue,
            createdBy
        );

        if (!prescriptionResult.success) {
            res.locals = {
                status: 'FAILURE',
                message: prescriptionResult.message
            };
            return next();
        }

        const prescriptionId = prescriptionResult.prescriptionId;
        console.log(`✅ Using prescription ID: ${prescriptionId}`);

        // Insert medicine
        const insertMedicineSQL = `
            INSERT INTO patient_medicine 
                (prescription_id, medicine_name, medicine_salt, medicine_frequency, created_by, updated_by, is_active)
            VALUES ($1, $2, $3, $4, $5, $5, 1)
            RETURNING *
        `;

        const medicineResult = await mainPool.query(insertMedicineSQL, [
            prescriptionId,
            medicineNameValue,
            medicineSaltValue || null,
            medicineFrequencyValue || null,
            createdBy
        ]);

        console.log(`✅ Medicine added successfully: ${medicineResult.rows[0].medicin_id}`);

        res.locals = {
            status: 'SUCCESS',
            message: 'Medicine added to appointment successfully',
            data: {
                medicine: medicineResult.rows[0],
                prescriptionId: prescriptionId
            }
        };

        next();

    } catch (error) {
        console.error('❌ Add medicine to appointment error:', error);
        console.error('Stack trace:', error.stack);

        res.locals = {
            status: 'FAILURE',
            message: 'Failed to add medicine to appointment',
            error: error.message
        };

        next();
    }
};

/**
 * Get medicines for an appointment
 * 
 * @route GET /api/appointments/:appointmentId/medicines
 * 
 * @returns {Object} JSON response with medicines list
 */
exports.getAppointmentMedicines = async (req, res, next) => {
    let client;
    try {
        const { appointmentId } = req.params;

        console.log(`\n📋 Get Appointment Medicines Request: ${appointmentId}`);

        // Get a client from the pool with better error handling
        try {
            client = await mainPool.connect();
            console.log('✅ Database client acquired');
        } catch (connectionError) {
            console.error('❌ Failed to acquire database client:', connectionError);
            throw new Error('Database connection failed. Please try again.');
        }

        // Get prescription ID for this appointment
        const prescriptionSQL = `
            SELECT pp.prescription_id
            FROM patient_prescription pp
            INNER JOIN dr_appointment_details dad 
                ON pp.prescription_id = dad.prescription_id
            WHERE dad.appointment_id = $1 
                AND pp.is_active = 1
        `;

        const prescriptionResult = await client.query(prescriptionSQL, [appointmentId]);

        let prescriptionId;

        if (prescriptionResult.rows.length === 0) {
            console.log(`ℹ️ No prescription found for appointment ${appointmentId}, creating one...`);

            // Get appointment and patient details
            const appointmentSQL = `
                SELECT da.patient_id, da.dr_id, dad.appointment_detail_id
                FROM dr_appointment da
                LEFT JOIN dr_appointment_details dad ON da.appointment_id = dad.appointment_id
                WHERE da.appointment_id = $1 AND da.is_active = 1
            `;

            const appointmentResult = await client.query(appointmentSQL, [appointmentId]);

            if (appointmentResult.rows.length === 0) {
                console.error(`❌ Appointment ${appointmentId} not found`);
                res.locals = {
                    status: 'FAILURE',
                    message: 'Appointment not found'
                };
                return next();
            }

            const { patient_id, dr_id, appointment_detail_id } = appointmentResult.rows[0];
            console.log(`📝 Creating prescription for patient ${patient_id}, doctor ${dr_id}`);

            // Create prescription
            const createPrescriptionSQL = `
                INSERT INTO patient_prescription (patient_id, is_active, created_by, updated_by)
                VALUES ($1, 1, $2, $2)
                RETURNING prescription_id
            `;

            const newPrescriptionResult = await client.query(createPrescriptionSQL, [patient_id, dr_id]);
            prescriptionId = newPrescriptionResult.rows[0].prescription_id;

            console.log(`✅ Created prescription ${prescriptionId}`);

            // Link prescription to appointment details if appointment_detail_id exists
            if (appointment_detail_id) {
                const linkSQL = `
                    UPDATE dr_appointment_details 
                    SET prescription_id = $1, updated_by = $2
                    WHERE appointment_detail_id = $3
                `;
                await client.query(linkSQL, [prescriptionId, dr_id, appointment_detail_id]);
                console.log(`✅ Linked prescription to appointment details`);
            } else {
                // Create appointment details if it doesn't exist
                const createDetailsSQL = `
                    INSERT INTO dr_appointment_details (
                        appointment_id, patient_id, dr_id, prescription_id, 
                        is_active, created_by, updated_by
                    )
                    VALUES ($1, $2, $3, $4, 1, $3, $3)
                `;
                await client.query(createDetailsSQL, [appointmentId, patient_id, dr_id, prescriptionId]);
                console.log(`✅ Created appointment details with prescription`);
            }
        } else {
            prescriptionId = prescriptionResult.rows[0].prescription_id;
        }

        // Get medicines for this prescription
        const medicinesSQL = `
            SELECT 
                medicin_id,
                medicine_name,
                medicine_salt,
                medicine_frequency,
                created_at,
                updated_at
            FROM patient_medicine
            WHERE prescription_id = $1 AND is_active = 1
            ORDER BY created_at DESC
        `;

        const medicinesResult = await client.query(medicinesSQL, [prescriptionId]);

        console.log(`✅ Found ${medicinesResult.rows.length} medicines`);

        res.locals = {
            status: 'SUCCESS',
            message: 'Appointment medicines retrieved successfully',
            data: {
                medicines: medicinesResult.rows,
                count: medicinesResult.rows.length,
                prescriptionId: prescriptionId
            }
        };

        next();

    } catch (error) {
        console.error('❌ Get appointment medicines error:', error);
        console.error('Stack trace:', error.stack);

        res.locals = {
            status: 'FAILURE',
            message: 'Failed to get appointment medicines',
            error: error.message
        };

        next();
    } finally {
        // Always release the client back to the pool
        if (client) {
            client.release();
            console.log('✅ Database client released');
        }
    }
};

/**
 * Delete medicine from appointment
 * 
 * @route DELETE /api/appointments/medicines/:medicineId
 * 
 * @returns {Object} JSON response
 */
exports.deleteAppointmentMedicine = async (req, res, next) => {
    try {
        const { medicineId } = req.params;
        const updatedBy = req.user?.userId || req.user?.drId;

        console.log(`\n🗑️ Delete Medicine Request: ${medicineId}`);

        const deleteSQL = `
            UPDATE patient_medicine 
            SET is_active = 0, updated_by = $1, updated_at = CURRENT_TIMESTAMP
            WHERE medicin_id = $2
            RETURNING *
        `;

        const result = await mainPool.query(deleteSQL, [updatedBy, medicineId]);

        if (result.rows.length === 0) {
            return sendError(res, 'Medicine not found', 404);
        }

        console.log(`✅ Medicine deleted successfully`);

        res.locals = {
            status: 'SUCCESS',
            message: 'Medicine removed successfully',
            data: result.rows[0]
        };

        next();

    } catch (error) {
        console.error('❌ Delete medicine error:', error);
        console.error('Stack trace:', error.stack);

        res.locals = {
            status: 'FAILURE',
            message: 'Failed to delete medicine',
            error: error.message
        };

        next();
    }
};

/**
 * Generate and download prescription PDF
 * 
 * @route GET /api/appointments/:appointmentId/prescription/pdf
 * 
 * @returns {File} PDF file download
 */
exports.downloadPrescriptionPDF = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;

        console.log(`\n📄 PDF Download Request for Appointment: ${appointmentId}`);

        // Validation
        if (!appointmentId) {
            return sendError(res, 'Appointment ID is required', 400);
        }

        // Generate PDF
        const result = await generatePrescriptionPDF(appointmentId);

        if (!result.success) {
            return sendError(res, 'Failed to generate PDF', 500);
        }

        // Set headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
        res.setHeader('Content-Length', result.pdfBuffer.length);

        console.log(`✅ Sending PDF: ${result.fileName}`);

        // Send PDF buffer
        res.send(result.pdfBuffer);

    } catch (error) {
        console.error('❌ Download prescription PDF error:', error);
        console.error('Stack trace:', error.stack);

        // Send JSON error response
        res.status(500).json({
            status: 'FAILURE',
            message: error.message || 'Failed to generate prescription PDF',
            error: error.message
        });
    }
};

/**
 * Internal helper function to get or create prescription
 */
async function getOrCreatePrescriptionInternal(appointmentId, patientId, createdBy) {
    try {
        // Check if prescription exists
        const checkSQL = `
            SELECT pp.prescription_id
            FROM patient_prescription pp
            INNER JOIN dr_appointment_details dad 
                ON pp.prescription_id = dad.prescription_id
            WHERE dad.appointment_id = $1 
                AND pp.is_active = 1
        `;

        const existing = await mainPool.query(checkSQL, [appointmentId]);

        if (existing.rows.length > 0) {
            console.log(`✅ Found existing prescription: ${existing.rows[0].prescription_id}`);
            return {
                success: true,
                prescriptionId: existing.rows[0].prescription_id
            };
        }

        // Verify appointment exists before creating prescription
        const appointmentCheckSQL = `
            SELECT appointment_id, patient_id, dr_id
            FROM dr_appointment
            WHERE appointment_id = $1 AND is_active = 1
        `;

        const appointmentExists = await mainPool.query(appointmentCheckSQL, [appointmentId]);

        if (appointmentExists.rows.length === 0) {
            console.error(`❌ Appointment ${appointmentId} does not exist`);
            return {
                success: false,
                message: `Appointment with ID ${appointmentId} does not exist`
            };
        }

        const appointment = appointmentExists.rows[0];
        console.log(`✅ Appointment found: ID=${appointment.appointment_id}, Patient=${appointment.patient_id}, Doctor=${appointment.dr_id}`);

        // Create new prescription
        const createSQL = `
            INSERT INTO patient_prescription 
                (patient_id, created_by)
            VALUES ($1, $2)
            RETURNING prescription_id
        `;

        const newPrescription = await mainPool.query(createSQL, [patientId, createdBy]);
        const prescriptionId = newPrescription.rows[0].prescription_id;
        console.log(`✅ Created new prescription: ${prescriptionId}`);

        // Link to appointment
        const checkDetailsSQL = `
            SELECT appointment_detail_id
            FROM dr_appointment_details
            WHERE appointment_id = $1 AND is_active = 1
        `;

        const existingDetails = await mainPool.query(checkDetailsSQL, [appointmentId]);

        if (existingDetails.rows.length > 0) {
            console.log(`✅ Updating existing appointment_details`);
            await mainPool.query(
                `UPDATE dr_appointment_details
                 SET prescription_id = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE appointment_id = $3`,
                [prescriptionId, createdBy, appointmentId]
            );
        } else {
            console.log(`✅ Creating new appointment_details`);
            const insertResult = await mainPool.query(
                `INSERT INTO dr_appointment_details
                    (appointment_id, patient_id, prescription_id, dr_id, created_by)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [appointmentId, patientId, prescriptionId, appointment.dr_id, createdBy]
            );
            console.log(`✅ Created appointment_details: ${insertResult.rows[0].appointment_detail_id}`);
        }

        return {
            success: true,
            prescriptionId: prescriptionId
        };

    } catch (error) {
        console.error('Error in getOrCreatePrescriptionInternal:', error);
        return {
            success: false,
            message: error.message
        };
    }
}

module.exports = exports;
