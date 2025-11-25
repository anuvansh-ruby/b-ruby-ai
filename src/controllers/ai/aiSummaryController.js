const { GoogleGenerativeAI } = require('@google/generative-ai');
const STATUS = require('../../utils/constants').STATUS;
const pool = require('../../config/dbConnection');

/**
 * AI Summary Controller - Handles AI-powered summarization
 * Uses Google Gemini AI to convert transcription to SOAP format
 */

/**
 * Convert transcription text to SOAP format
 * POST /api/ai/transcription-to-soap
 * Body: { transcription: string, patientContext?: object, appointmentId?: number, patientId?: number }
 */
exports.transcriptionToSOAP = async (req, res, next) => {
    try {
        const { transcription, patientContext, appointmentId, patientId } = req.body;
        const doctorId = req.doctor.doctorId;

        // Validate input
        if (!transcription || transcription.trim().length === 0) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Transcription text is required'
            };
            return next();
        }

        console.log(`Doctor ${doctorId} requesting SOAP summary for transcription of ${transcription.length} characters`);
        console.log(`📋 SOAP request - Appointment: ${appointmentId}, Patient: ${patientId}`);

        // Get Gemini API key from environment
        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) {
            console.error('GEMINI_API_KEY not found in environment variables');
            res.locals = {
                status: STATUS.FAILURE,
                message: 'AI service configuration error'
            };
            return next();
        }

        // Prepare the prompt for Gemini
        const prompt = buildSOAPPrompt(transcription, patientContext);

        // Call Gemini API
        const geminiResponse = await callGeminiAPI(geminiApiKey, prompt);

        if (geminiResponse.success) {
            const soapSummary = geminiResponse.soap;
            let appointmentDetailId = null;

            // Save SOAP summary to database if appointment_id and patient_id are provided
            if (appointmentId && patientId && doctorId) {
                try {
                    console.log('💾 Saving SOAP summary to database...');

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
                            SET appointment_summary = $1,
                                updated_at = CURRENT_TIMESTAMP,
                                updated_by = $2
                            WHERE appointment_detail_id = $3
                            RETURNING appointment_detail_id
                        `;

                        await pool.query(updateQuery, [soapSummary, doctorId, appointmentDetailId]);
                        console.log(`✅ Updated SOAP summary in appointment_details (ID: ${appointmentDetailId})`);
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
                            (appointment_id, patient_id, dr_id, prescription_id, appointment_summary, created_by, updated_by, created_at, updated_at, is_active)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
                            RETURNING appointment_detail_id
                        `;

                        const result = await pool.query(insertQuery, [
                            appointmentId,
                            patientId,
                            doctorId,
                            prescriptionId,
                            soapSummary,
                            doctorId,
                            doctorId
                        ]);

                        appointmentDetailId = result.rows[0].appointment_detail_id;
                        console.log(`✅ Created appointment_details with SOAP summary (ID: ${appointmentDetailId})`);
                    }

                } catch (dbError) {
                    console.error('❌ Database error while saving SOAP summary:', dbError);
                    // Don't fail the whole request, just log the error
                }
            } else {
                console.log('⚠️  Skipping database save - missing appointment_id, patient_id, or doctor_id');
            }

            res.locals = {
                status: STATUS.SUCCESS,
                data: {
                    soap: soapSummary,
                    originalTranscription: transcription,
                    generatedAt: new Date().toISOString(),
                    appointmentDetailId: appointmentDetailId,
                    saved: appointmentDetailId !== null
                },
                message: 'SOAP summary generated successfully'
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: geminiResponse.error || 'Failed to generate SOAP summary'
            };
        }
        next();

    } catch (err) {
        console.error('Error in transcriptionToSOAP:', err);
        res.locals = {
            status: STATUS.FAILURE,
            message: err.message || 'An error occurred while processing the request'
        };
        next();
    }
};

/**
 * Build SOAP format prompt for Gemini AI
 */
function buildSOAPPrompt(transcription, patientContext) {
    const currentDate = new Date().toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const patientName = patientContext?.patientName || '[Patient Name]';
    const patientAge = patientContext?.patientAge || '[Age]';
    const patientGender = patientContext?.patientGender || '[Sex]';

    return `You are a medical documentation assistant specialized in Indian medical practices. Convert the following doctor-patient conversation transcription into a properly formatted SOAP note with Indian medical context.

Patient Information:
- Name: ${patientName}
- Age: ${patientAge}
- Gender: ${patientGender}
${patientContext?.previousConditions ? `- Previous Conditions: ${patientContext.previousConditions}` : ''}

Transcription:
${transcription}

Please provide a structured SOAP note in the following EXACT format:

Date: ${currentDate}
Patient Name: ${patientName}
Age / Sex: ${patientAge} / ${patientGender}


Subjective (Patient History)
[Extract what the patient reported from the conversation - their symptoms, complaints, history. Write in clear, concise sentences.]

Objective (Doctor's Examination)
[Extract physical examination findings, vital signs, and observations mentioned by the doctor. If not mentioned in the transcription, write "Not documented in transcription."]

Assessment / Diagnosis
[Extract or infer the doctor's diagnosis or medical assessment from the conversation. Be specific and clinical.]

Plan
Lab Tests:
[List any lab tests or investigations mentioned. If none, write "None prescribed" or leave blank]

Medications (with Indian Brand Names):
[List medications in this format, using common Indian brand names:
1. [Brand Name] [Strength] – [Frequency and timing]
2. [Brand Name] [Strength] – [Frequency and timing]
Use Indian brand names like: Pantocid, Domstal, Digene, Crocin, Combiflam, Azithral, Augmentin, Metrogyl, etc.
If medications are mentioned by generic names, suggest appropriate Indian brands.]

Follow-up: [Extract follow-up instructions - e.g., "3 days", "1 week", "2 weeks", "PRN", or as mentioned]


IMPORTANT GUIDELINES:
- Use simple, clear medical language
- For medications, ALWAYS use Indian brand names commonly prescribed in India
- Include dosage, frequency, and timing (before/after meals, etc.)
- Be concise but complete
- If information is not in the transcription, note it as "Not documented in transcription" or leave blank
- Follow the exact format structure shown above
- Use proper spacing and line breaks as shown`;
}

async function callGeminiAPI(apiKey, prompt) {
    try {
        console.log('Initializing Google Generative AI SDK...');

        // Initialize the SDK with the API key
        const genAI = new GoogleGenerativeAI(apiKey);

        // Get the generative model with configuration
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                temperature: 0.4,
                topK: 32,
                topP: 1,
                maxOutputTokens: 2048,
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        });

        console.log('Calling Gemini API with SDK...');
        console.log('Prompt length:', prompt.length, 'characters');

        // Generate content
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const generatedText = response.text();

        console.log('Gemini API response received successfully');
        console.log('Generated text length:', generatedText.length, 'characters');

        return {
            success: true,
            soap: generatedText
        };

    } catch (error) {
        console.error('Gemini API call error details:');
        console.error('Error message:', error.message);
        console.error('Error name:', error.name);
        console.error('Full error:', error);

        // Handle specific SDK errors
        if (error.message?.includes('API_KEY') || error.message?.includes('API key')) {
            return {
                success: false,
                error: 'AI service authentication error. Please check your GEMINI_API_KEY in .env file.'
            };
        } else if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
            return {
                success: false,
                error: 'AI service rate limit exceeded. Please try again later.'
            };
        } else if (error.message?.includes('model') || error.message?.includes('not found')) {
            return {
                success: false,
                error: 'AI model not found or not accessible. Please ensure you have access to gemini-pro.'
            };
        } else if (error.message?.includes('timeout')) {
            return {
                success: false,
                error: 'AI service request timeout. Please try again.'
            };
        } else if (error.message?.includes('network') || error.message?.includes('connection')) {
            return {
                success: false,
                error: 'Cannot reach AI service. Please check your internet connection.'
            };
        }

        return {
            success: false,
            error: `Failed to connect to AI service: ${error.message}`
        };
    }
}

/**
 * Test Gemini API connection
 * GET /api/ai/test-connection
 */
exports.testGeminiConnection = async (req, res, next) => {
    try {
        const geminiApiKey = process.env.GEMINI_API_KEY;

        if (!geminiApiKey) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Gemini API key not configured'
            };
            return next();
        }

        const testPrompt = "Respond with 'OK' if you can receive this message.";
        const result = await callGeminiAPI(geminiApiKey, testPrompt);

        if (result.success) {
            res.locals = {
                status: STATUS.SUCCESS,
                data: {
                    connected: true,
                    message: 'Gemini AI service is operational'
                }
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.error || 'Failed to connect to Gemini AI'
            };
        }
        next();

    } catch (error) {
        console.error('Error testing Gemini connection:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: 'Failed to test AI service connection'
        };
        next();
    }
};
