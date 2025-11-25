const appointmentService = require('./appointmentService');
const STATUS = require('../../utils/constants').STATUS;

/**
 * Appointment Controller - Handles appointment-related HTTP requests
 * All routes are protected by doctorAuthMiddleware
 */

/**
 * Get all appointments for the logged-in doctor
 * GET /doctor/appointments
 */
exports.getDoctorAppointments = async (req, res, next) => {
    try {
        // Doctor ID comes from JWT token (set by doctorAuthMiddleware)
        const doctorId = req.doctor.doctorId;

        const result = await appointmentService.getDoctorAppointments(doctorId);

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to fetch appointments'
            };
        }
        next();
    } catch (error) {
        console.error('Error in getDoctorAppointments:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Search appointments by patient name or email
 * GET /doctor/appointments/search?query=searchTerm
 */
exports.searchAppointments = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const { query } = req.query;

        if (!query || query.trim().length === 0) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Search query is required'
            };
            return next();
        }

        const result = await appointmentService.searchDoctorAppointments(doctorId, query.trim());

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to search appointments'
            };
        }
        next();
    } catch (error) {
        console.error('Error in searchAppointments:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Get specific appointment details
 * GET /doctor/appointments/:appointmentId
 */
exports.getAppointmentDetails = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const { appointmentId } = req.params;

        if (!appointmentId || isNaN(appointmentId)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Valid appointment ID is required'
            };
            return next();
        }

        const result = await appointmentService.getAppointmentDetails(
            parseInt(appointmentId),
            doctorId
        );

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Appointment not found'
            };
        }
        next();
    } catch (error) {
        console.error('Error in getAppointmentDetails:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Create new appointment
 * POST /doctor/appointments
 * Body: { patient_id: number, patient_weight?: string, patient_blood_pressure?: string, patient_pulse?: string, patient_temprature?: string, patient_height?: string }
 */
exports.createAppointment = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const createdBy = req.doctor.doctorId; // Doctor creating the appointment
        const {
            patient_id,
            patient_weight,
            patient_blood_pressure,
            patient_pulse,
            patient_temprature,
            patient_height
        } = req.body;

        if (!patient_id || isNaN(patient_id)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Valid patient ID is required'
            };
            return next();
        }

        // Prepare vital signs data
        const vitalSigns = {
            patient_weight: patient_weight || null,
            patient_blood_pressure: patient_blood_pressure || null,
            patient_pulse: patient_pulse || null,
            patient_temprature: patient_temprature || null,
            patient_height: patient_height || null
        };

        const result = await appointmentService.createAppointment(
            parseInt(patient_id),
            doctorId,
            createdBy,
            vitalSigns
        );

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to create appointment'
            };
        }
        next();
    } catch (error) {
        console.error('Error in createAppointment:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Update appointment vital signs
 * PUT /doctor/appointments/:appointmentId/vitals
 * Body: { patient_pulse?, patient_blood_pressure?, patient_temprature?, patient_height?, patient_weight? }
 */
exports.updateAppointmentVitals = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const updatedBy = req.doctor.doctorId; // Doctor updating the appointment
        const { appointmentId } = req.params;
        const vitals = req.body;

        if (!appointmentId || isNaN(appointmentId)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Valid appointment ID is required'
            };
            return next();
        }

        // Validate that at least one vital sign is provided
        const validVitals = ['patient_pulse', 'patient_blood_pressure', 'patient_temprature', 'patient_height', 'patient_weight'];
        const hasValidVital = validVitals.some(vital => vitals[vital] !== undefined);

        if (!hasValidVital) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'At least one vital sign must be provided'
            };
            return next();
        }

        const result = await appointmentService.updateAppointmentVitals(
            parseInt(appointmentId),
            doctorId,
            vitals,
            updatedBy
        );

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to update appointment vitals'
            };
        }
        next();
    } catch (error) {
        console.error('Error in updateAppointmentVitals:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Get patient history (all appointments for a specific patient)
 * GET /doctor/patients/:patientId/appointments
 */
exports.getPatientHistory = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const { patientId } = req.params;

        if (!patientId || isNaN(patientId)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Valid patient ID is required'
            };
            return next();
        }

        const result = await appointmentService.getPatientHistory(
            parseInt(patientId),
            doctorId
        );

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to fetch patient history'
            };
        }
        next();
    } catch (error) {
        console.error('Error in getPatientHistory:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Get recent patients
 * GET /doctor/patients/recent?limit=10
 */
exports.getRecentPatients = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const limit = parseInt(req.query.limit) || 10;

        if (limit <= 0 || limit > 50) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Limit must be between 1 and 50'
            };
            return next();
        }

        const result = await appointmentService.getRecentPatients(doctorId, limit);

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to fetch recent patients'
            };
        }
        next();
    } catch (error) {
        console.error('Error in getRecentPatients:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Update appointment status
 * PUT /doctor/appointments/:appointmentId/status
 * Body: { is_active: boolean }
 */
exports.updateAppointmentStatus = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const updatedBy = req.doctor.doctorId; // Doctor updating the appointment
        const { appointmentId } = req.params;
        const { is_active } = req.body;

        if (!appointmentId || isNaN(appointmentId)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Valid appointment ID is required'
            };
            return next();
        }

        if (typeof is_active !== 'boolean') {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'is_active must be a boolean value'
            };
            return next();
        }

        const result = await appointmentService.updateAppointmentStatus(
            parseInt(appointmentId),
            doctorId,
            is_active,
            updatedBy
        );

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to update appointment status'
            };
        }
        next();
    } catch (error) {
        console.error('Error in updateAppointmentStatus:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Get doctor's patients with pagination and search
 * GET /doctor/patients?page=1&limit=10&search=searchTerm
 */
exports.getDoctorPatients = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';

        if (page <= 0) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Page must be greater than 0'
            };
            return next();
        }

        if (limit <= 0 || limit > 100) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Limit must be between 1 and 100'
            };
            return next();
        }

        const result = await appointmentService.getDoctorPatients(
            doctorId,
            page,
            limit,
            search.trim()
        );

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to fetch patients'
            };
        }
        next();
    } catch (error) {
        console.error('Error in getDoctorPatients:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};

/**
 * Create patient by doctor
 * POST /doctor/patients
 * Body: { patient_first_name, patient_last_name, patient_email, patient_phone_number, patient_date_of_birth, patient_address, patient_pin }
 */
exports.createPatientByDoctor = async (req, res, next) => {
    try {
        const doctorId = req.doctor.doctorId;
        const createdBy = req.doctor.doctorId; // Doctor creating the patient
        const {
            patient_first_name,
            patient_last_name,
            patient_email,
            patient_phone_number,
            patient_date_of_birth,
            patient_address,
            patient_pin
        } = req.body;

        // Validate required fields
        if (!patient_first_name || !patient_first_name.trim()) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Patient first name is required'
            };
            return next();
        }

        if (!patient_phone_number || !patient_phone_number.trim()) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Patient phone number is required'
            };
            return next();
        }

        if (!patient_date_of_birth) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Patient date of birth is required'
            };
            return next();
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(patient_email.trim())) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Invalid email format'
            };
            return next();
        }

        // Phone number validation (basic)
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        if (!phoneRegex.test(patient_phone_number.replace(/[\s\-\(\)]/g, ''))) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Invalid phone number format'
            };
            return next();
        }

        const result = await appointmentService.createPatientByDoctor({
            patient_first_name: patient_first_name.trim(),
            patient_last_name: patient_last_name ? patient_last_name.trim() : '', // Allow empty last name
            patient_email: patient_email.trim().toLowerCase(),
            patient_phone_number: patient_phone_number.trim(),
            patient_date_of_birth,
            patient_address: patient_address ? patient_address.trim() : '',
            patient_pin: patient_pin || 0,
            created_by_dr_id: doctorId,
            created_by: createdBy
        });

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || 'Failed to create patient'
            };
        }
        next();
    } catch (error) {
        console.error('Error in createPatientByDoctor:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Internal server error'
        };
        next();
    }
};