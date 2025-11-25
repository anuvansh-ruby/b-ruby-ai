const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const STATUS = require('../../utils/constants').STATUS;
const pool = require('../../config/dbConnection');

// Configure multer to use memory storage (RAM) instead of disk storage
const storage = multer.memoryStorage();

// File filter to accept only audio files
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'audio/wav',
        'audio/mpeg',
        'audio/mp3',
        'audio/mp4',
        'audio/aac',
        'audio/ogg',
        'audio/webm'
    ];

    if (allowedMimeTypes.includes(file.mimetype) || file.originalname.endsWith('.wav')) {
        cb(null, true);
    } else {
        cb(new Error('Only audio files are allowed'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 200 * 1024 * 1024, // 200MB limit (supports ~1+ hour audio recordings)
    },
    fileFilter: fileFilter,
});

// Health check for transcription service
const healthCheck = (req, res, next) => {
    try {
        res.locals.status = STATUS.SUCCESS;
        res.locals.data = {
            status: 'OK',
            message: 'Transcription service is running',
            timestamp: new Date().toISOString(),
            geminiReady: !!process.env.GEMINI_API_KEY,
        };
        next();
    } catch (error) {
        console.error('Transcription health check error:', error);
        res.locals.status = STATUS.FAILURE;
        res.locals.message = 'Transcription service health check failed';
        next();
    }
};

// Transcribe audio file (processing in RAM)
const transcribeAudio = async (req, res, next) => {
    try {
        // Check if Gemini API key is configured
        if (!process.env.GEMINI_API_KEY) {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = 'Gemini API key not configured. Please set GEMINI_API_KEY environment variable.';
            return next();
        }

        // Check if file was uploaded
        if (!req.file) {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = 'No audio file provided. Please upload an audio file.';
            return next();
        }

        // Extract appointment_id and patient_id from request body
        const appointmentId = req.body.appointment_id ? parseInt(req.body.appointment_id) : null;
        const patientId = req.body.patient_id ? parseInt(req.body.patient_id) : null;
        const doctorId = req.doctor?.doctorId; // From authentication middleware

        console.log(`📋 Transcription request - Appointment: ${appointmentId}, Patient: ${patientId}, Doctor: ${doctorId}`);

        // File is now in memory as a buffer (req.file.buffer)
        const audioBuffer = req.file.buffer;
        console.log(`Processing transcription from memory buffer`);
        console.log(`File size: ${req.file.size} bytes`);
        console.log(`File mimetype: ${req.file.mimetype}`);
        console.log(`Original filename: ${req.file.originalname}`);

        // Verify buffer has content
        if (!audioBuffer || audioBuffer.length === 0) {
            throw new Error('Audio buffer is empty');
        }

        console.log('Starting Google Gemini transcription from memory...');

        // Initialize Gemini AI
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        // Use Gemini 2.5 Flash model for audio transcription (latest model)
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
        });

        // Determine MIME type
        let mimeType = req.file.mimetype || 'audio/wav';

        // Create the comprehensive prompt for transcription with medical focus
        const prompt = `Transcribe the provided audio recording completely and accurately, word-for-word. Your ONLY task is to convert speech to text.

**STRICT TRANSCRIPTION RULES:**

1. **Raw Transcription Only:**
   - Transcribe EVERYTHING spoken in the audio exactly as heard
   - DO NOT add any commentary, apologies, explanations, or meta-statements about the audio content
   - DO NOT refuse transcription or state what the audio "appears to be" or "does not contain"
   - DO NOT make judgments about whether content matches expected format
   - Transcribe the actual spoken words, regardless of topic or context

2. **Speaker Identification:**
   - Label speakers as "Speaker A:", "Speaker B:", etc. based on distinct voices
   - If medical context is evident, you may use "Doctor:", "Patient:", "Attendant:"
   - Maintain consistent labels throughout the transcript

3. **Language & Accuracy:**
   - Detect and transcribe in the ORIGINAL SPOKEN LANGUAGE using appropriate script (Devanagari for Hindi, Latin for English, etc.)
   - Preserve exact wording, including medical terms, medication names, numbers, measurements, and dates
   - Capture all spoken content verbatim, including questions, responses, and statements

4. **Formatting:**
   - Start each speaker's turn on a new line with their label
   - Use paragraph breaks between topic changes or long monologues for readability
   - Omit non-speech sounds like [cough], [laughter], background noise descriptions
   - Include all meaningful speech, including filler words if they're part of natural speech

**IMPORTANT:** Your response must ONLY contain the transcript. Do not include:
- "I'm sorry, but..." statements
- "The audio appears to be..." descriptions
- "This is not a medical consultation" disclaimers
- Any meta-commentary about the audio content
- Explanations about what you're transcribing

**Output Format:**
Speaker A: [Exact words spoken]
Speaker B: [Exact words spoken]

[Continue for entire audio duration]

Begin transcription immediately without preamble.`;

        // Prepare the audio part for Gemini using the proper SDK method
        const audioPart = {
            inlineData: {
                data: audioBuffer.toString('base64'),
                mimeType: mimeType
            }
        };

        console.log('Sending audio to Gemini for transcription...');
        console.log(`Audio MIME type: ${mimeType}`);

        // Generate content with audio using the proper method
        const result = await model.generateContent([
            prompt,
            audioPart
        ]);

        const response = await result.response;
        const transcriptionText = response.text();

        console.log('Transcription completed successfully');
        console.log(`Transcribed text length: ${transcriptionText?.length || 0} characters`);

        // Save transcription to database if appointment_id and patient_id are provided
        let appointmentDetailId = null;
        if (appointmentId && patientId && doctorId) {
            try {
                console.log('💾 Saving transcription to database...');

                // Check if dr_appointment_details record already exists for this appointment
                const checkDetailsQuery = `
                    SELECT appointment_detail_id, prescription_id
                    FROM dr_appointment_details
                    WHERE appointment_id = $1 AND patient_id = $2 AND dr_id = $3 AND is_active = 1
                `;
                const checkDetailsResult = await pool.query(checkDetailsQuery, [appointmentId, patientId, doctorId]);

                if (checkDetailsResult.rows.length > 0) {
                    // Update existing record
                    const existingRecord = checkDetailsResult.rows[0];
                    appointmentDetailId = existingRecord.appointment_detail_id;

                    const updateQuery = `
                        UPDATE dr_appointment_details
                        SET appointemnt_transcription = $1,
                            updated_at = CURRENT_TIMESTAMP,
                            updated_by = $2
                        WHERE appointment_detail_id = $3
                        RETURNING appointment_detail_id
                    `;

                    await pool.query(updateQuery, [transcriptionText, doctorId, appointmentDetailId]);
                    console.log(`✅ Updated transcription in appointment_details (ID: ${appointmentDetailId})`);
                } else {
                    // Create new prescription for new record
                    console.log('Creating new prescription record...');
                    const createPrescriptionQuery = `
                        INSERT INTO patient_prescription
                        (patient_id, created_by, updated_by, created_at, updated_at, is_active)
                        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
                        RETURNING prescription_id
                    `;
                    const newPrescription = await pool.query(createPrescriptionQuery, [
                        patientId,
                        doctorId,
                        doctorId
                    ]);
                    const prescriptionId = newPrescription.rows[0].prescription_id;
                    console.log(`✅ Created prescription (ID: ${prescriptionId})`);

                    // Insert new record
                    const insertQuery = `
                        INSERT INTO dr_appointment_details
                        (appointment_id, patient_id, dr_id, prescription_id, appointemnt_transcription, created_by, updated_by, created_at, updated_at, is_active)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
                        RETURNING appointment_detail_id
                    `;

                    const result = await pool.query(insertQuery, [
                        appointmentId,
                        patientId,
                        doctorId,
                        prescriptionId,
                        transcriptionText,
                        doctorId,
                        doctorId
                    ]);

                    appointmentDetailId = result.rows[0].appointment_detail_id;
                    console.log(`✅ Created appointment_details with transcription (ID: ${appointmentDetailId})`);
                }

            } catch (dbError) {
                console.error('❌ Database error while saving transcription:', dbError);
                // Don't fail the whole request, just log the error
                // The transcription was successful, so we'll still return it
            }
        } else {
            console.log('⚠️  Skipping database save - missing appointment_id, patient_id, or doctor_id');
        }

        // Return the transcription result
        res.locals.status = STATUS.SUCCESS;
        res.locals.data = {
            text: transcriptionText,
            language: 'auto-detected', // Language is auto-detected by Gemini
            timestamp: new Date().toISOString(),
            appointmentDetailId: appointmentDetailId,
            saved: appointmentDetailId !== null,
        };

        // No file cleanup needed - buffer will be garbage collected automatically
        console.log('Memory buffer will be automatically released by garbage collector');
        next();

    } catch (error) {
        console.error('Transcription error:', error);

        // Handle specific Gemini API errors
        if (error.message?.includes('API key') || error.message?.includes('API_KEY')) {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = 'Invalid or missing Gemini API key';
        } else if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = 'Rate limit exceeded. Please try again later.';
        } else if (error.message?.includes('file format') || error.message?.includes('mime type')) {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = 'Unsupported audio format. Please use WAV, MP3, or MP4.';
        } else if (error.message?.includes('model') || error.message?.includes('not found')) {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = 'Gemini model not accessible. Please check your API configuration.';
        } else {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = error.message || 'Failed to transcribe audio';
        }

        next();
    }
};

// Multer error handling middleware
const handleMulterError = (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = 'File too large. Maximum size is 200MB.';
        } else {
            res.locals.status = STATUS.FAILURE;
            res.locals.message = `Upload error: ${error.message}`;
        }
    } else if (error.message === 'Only audio files are allowed') {
        res.locals.status = STATUS.FAILURE;
        res.locals.message = 'Only audio files are allowed';
    } else {
        res.locals.status = STATUS.FAILURE;
        res.locals.message = 'File upload failed';
    }
    next();
};

module.exports = {
    upload,
    healthCheck,
    transcribeAudio,
    handleMulterError
};