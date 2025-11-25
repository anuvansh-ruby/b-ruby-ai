const { setResponse } = require('../middleware/setResponse');
const { verifyDoctorJWT } = require('../middleware/doctorAuthMiddleware');
const { verifyAssistantJWT, verifyAssistantOrDoctorJWT } = require('../middleware/assistantAuthMiddleware');

const doctorAuthController = require('../controllers/doctor/doctorAuthController');
const assistantAuthController = require('../controllers/doctor/assistantAuthController');
const appointmentController = require('../controllers/doctor/appointmentController');
const transcriptionController = require('../controllers/transcription/transcriptionController');
const aiSummaryController = require('../controllers/ai/aiSummaryController');
const medicineController = require('../controllers/doctor/medicineController');
const fuzzyMedicineController = require('../controllers/medicine/medicineController');
const prescriptionController = require('../controllers/doctor/prescriptionController');


module.exports = function (app) {
    app.get('/', (req, res) => {
        res.send('API is running...');
    });

    // ===== DOCTOR AUTHENTICATION ROUTES =====
    // Doctor login routes
    app.post('/api/doctor/send-login-otp', doctorAuthController.sendDoctorLoginOTP, setResponse);
    app.post('/api/doctor/verify-login-otp', doctorAuthController.verifyDoctorLoginOTP, setResponse);
    app.post('/api/doctor/resend-login-otp', doctorAuthController.resendDoctorLoginOTP, setResponse);

    // Doctor registration
    app.post('/api/doctor/register', doctorAuthController.registerDoctor, setResponse);

    // Unified PIN management (works for both doctors and assistants)
    app.post('/api/v1/setup-pin', verifyAssistantOrDoctorJWT, doctorAuthController.setupUserPIN, setResponse);

    // Doctor profile management (requires authentication)
    app.post('/api/v1/doctor/update-profile', doctorAuthController.updateDoctorProfile, setResponse);
    app.get('/api/v1/doctor/profile', doctorAuthController.getDoctorProfile, setResponse);
    app.post('/api/v1/doctor/logout', doctorAuthController.logoutDoctor, setResponse);

    // ===== ASSISTANT AUTHENTICATION ROUTES =====
    // Assistant registration (by doctor) - requires doctor authentication
    app.post('/api/v1/doctor/assistant/register', assistantAuthController.registerAssistant, setResponse);

    // Assistant login routes
    app.post('/api/assistant/send-login-otp', assistantAuthController.sendAssistantLoginOTP, setResponse);
    app.post('/api/assistant/verify-login-otp', assistantAuthController.verifyAssistantLoginOTP, setResponse);
    app.post('/api/assistant/resend-login-otp', assistantAuthController.resendAssistantLoginOTP, setResponse);

    // Doctor's assistant management (requires doctor authentication)
    app.get('/api/v1/doctor/assistants', assistantAuthController.getDoctorAssistants, setResponse);
    app.get('/api/v1/doctor/assistants/:assistantId', assistantAuthController.getAssistantDetails, setResponse);
    app.put('/api/v1/doctor/assistants/:assistantId', assistantAuthController.updateAssistant, setResponse);
    app.post('/api/v1/doctor/assistants/:assistantId/deactivate', assistantAuthController.deactivateAssistant, setResponse);

    // ===== DOCTOR APPOINTMENT ROUTES =====
    // Get all appointments for logged-in doctor
    app.get('/api/v1/doctor/appointments', appointmentController.getDoctorAppointments, setResponse);

    // Search appointments by patient name/email
    app.get('/api/v1/doctor/appointments/search', appointmentController.searchAppointments, setResponse);

    // Get specific appointment details
    app.get('/api/v1/doctor/appointments/:appointmentId', appointmentController.getAppointmentDetails, setResponse);

    // Create new appointment
    app.post('/api/v1/doctor/appointments', appointmentController.createAppointment, setResponse);

    // Update appointment vital signs
    app.put('/api/v1/doctor/appointments/:appointmentId/vitals', appointmentController.updateAppointmentVitals, setResponse);

    // Update appointment status
    app.put('/api/v1/doctor/appointments/:appointmentId/status', appointmentController.updateAppointmentStatus, setResponse);

    // Get patient history
    app.get('/api/v1/doctor/patients/:patientId/appointments', appointmentController.getPatientHistory, setResponse);

    // Get recent patients
    app.get('/api/v1/doctor/patients/recent', appointmentController.getRecentPatients, setResponse);

    // Get doctor's patients with pagination and search
    app.get('/api/v1/doctor/patients', appointmentController.getDoctorPatients, setResponse);

    // Create patient by doctor
    app.post('/api/v1/doctor/patients', appointmentController.createPatientByDoctor, setResponse);

    // ===== TRANSCRIPTION ROUTES =====
    // Health check for transcription service
    app.get('/api/v1/transcription/health', transcriptionController.healthCheck, setResponse);

    // Transcribe audio file (requires doctor authentication)
    app.post('/api/v1/doctor/transcription/transcribe',
        transcriptionController.upload.single('audio'),
        transcriptionController.handleMulterError,
        transcriptionController.transcribeAudio,
        setResponse
    );

    // Note: Removed duplicate unauthenticated endpoints for production security

    // ===== AI SUMMARY ROUTES =====
    // Convert transcription to SOAP format using Gemini AI (requires doctor authentication)
    app.post('/api/v1/doctor/transcription-to-soap',
        aiSummaryController.transcriptionToSOAP,
        setResponse
    );

    // ===== MEDICINE ROUTES (Legacy - anuvansh_drug_db) =====
    // Search medicines from anuvansh_drug_db
    app.get('/api/medicines/search',

        medicineController.searchMedicines,
        setResponse
    );

    // Get popular medicines
    app.get('/api/medicines/popular',

        medicineController.getPopularMedicines,
        setResponse
    );

    // Get medicine details by ID
    app.get('/api/medicines/:medicineId',

        medicineController.getMedicineById,
        setResponse
    );

    // Add medicine to patient prescription
    app.post('/api/prescriptions/medicines',

        medicineController.addMedicineToPatient,
        setResponse
    );

    // Get medicines for a prescription
    app.get('/api/prescriptions/:prescriptionId/medicines',

        medicineController.getPrescriptionMedicines,
        setResponse
    );

    // Delete medicine from prescription
    app.delete('/api/medicines/:medicineId',

        medicineController.deleteMedicine,
        setResponse
    );

    // ===== APPOINTMENT PRESCRIPTION & MEDICINE ROUTES =====
    // Get or create prescription for an appointment
    app.post('/api/appointments/:appointmentId/prescription',
        prescriptionController.getOrCreatePrescription,
        setResponse
    );

    // Add medicine to appointment
    app.post('/api/appointments/:appointmentId/medicines',
        prescriptionController.addMedicineToAppointment,
        setResponse
    );

    // Get medicines for an appointment
    app.get('/api/appointments/:appointmentId/medicines',
        prescriptionController.getAppointmentMedicines,
        setResponse
    );

    // Delete medicine from appointment
    app.delete('/api/appointments/medicines/:medicineId',
        prescriptionController.deleteAppointmentMedicine,
        setResponse
    );

    // Download prescription PDF
    app.get('/api/appointments/:appointmentId/prescription/pdf',
        prescriptionController.downloadPrescriptionPDF
    );

    // ===== FUZZY MEDICINE SEARCH ROUTES (New - medicine_db with pg_trgm) =====
    // Intelligent fuzzy search with OCR error tolerance
    app.get('/api/medicine/search',
        fuzzyMedicineController.searchMedicines,
        setResponse
    );

    // Batch search for multiple medicines (for OCR prescriptions)
    app.post('/api/medicine/batch-search',
        fuzzyMedicineController.batchSearchMedicines,
        setResponse
    );

    // Get medicine by ID from medicine database
    app.get('/api/medicine/:id',
        fuzzyMedicineController.getMedicineById,
        setResponse
    );
};