const STATUS = require('../../utils/constants').STATUS;
const jwt = require('jsonwebtoken');
const axios = require('axios');
const redisRouter = require("../../utils/redisRouter");
const assistantService = require('./assistantService');
const doctorService = require('./doctorService');

/**
 * Assistant Authentication Controller
 * Handles assistant login, registration, and authentication
 * Assistants use same OTP + PIN flow as doctors
 */

// Generate 4-digit OTP
function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Utility to generate JWT token for assistants
function generateAssistantToken(payload) {
    return jwt.sign(
        payload,
        process.env.JWT_SECRET || 'ruby_ai_secret_key',
        { expiresIn: '7d' }
    );
}

// Send WhatsApp message (reusing same logic as doctor)
async function sendWhatsAppOTP(phoneNumber, otp, customMessage = null) {
    console.log('[WhatsApp OTP Assistant] Starting message send:', {
        phoneNumber,
        hasOTP: !!otp,
        hasCustomMessage: !!customMessage,
        timestamp: new Date().toISOString()
    });

    try {
        // WhatsApp API integration - always send messages
        const url = 'https://wasenderapi.com/api/send-message';
        console.log('[WhatsApp OTP Assistant] Using API endpoint:', url);
        const message = customMessage || `🏥 Ruby AI Healthcare\n\nYour OTP for login is: ${otp}\n\nThis OTP will expire in 5 minutes.\n\nDo not share this OTP with anyone.`;

        const requestData = {
            to: phoneNumber,
            text: message
        };

        const config = {
            method: 'POST',
            url: url,
            headers: {
                'Authorization': `Bearer ${process.env.WASENDER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: requestData
        };

        try {
            console.log('[WhatsApp OTP Assistant] Making API request:', {
                url,
                phoneNumber,
                timestamp: new Date().toISOString()
            });

            const response = await axios(config);
            console.log('[WhatsApp OTP Assistant] API Response:', {
                status: response.status,
                data: response.data,
                headers: response.headers
            });

            if (response.data && response.data.status === 'success') {
                console.log('[WhatsApp OTP Assistant] Message sent successfully');
                return { success: true, data: response.data };
            } else {
                console.error('[WhatsApp OTP Assistant] API returned failure status');
                throw new Error('WhatsApp API response indicates failure');
            }
        } catch (apiError) {
            console.error('[WhatsApp OTP Assistant] API Error:', {
                error: apiError.message,
                response: apiError.response?.data,
                status: apiError.response?.status,
                headers: apiError.response?.headers
            });
            // Try again after a short delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                const retryResponse = await axios(config);
                if (retryResponse.data && retryResponse.data.status === 'success') {
                    return { success: true, data: retryResponse.data };
                }
            } catch (retryError) {
                console.error('WhatsApp API Retry Failed:', retryError);
            }
            throw apiError;
        }
    } catch (error) {
        console.error('WhatsApp OTP Error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Register new assistant
 * Called by doctor to create assistant account
 */
exports.registerAssistant = async (req, res, next) => {
    try {
        const {
            firstName,
            lastName,
            email,
            phoneNumber,
            dateOfBirth,
            address
        } = req.body;

        // Get doctor ID from JWT token (doctor must be authenticated)
        const doctorData = req.doctor;

        if (!doctorData || !doctorData.doctorId) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Doctor authentication required to create assistant"
            };
            return next();
        }

        const doctorId = doctorData.doctorId;

        // Input validation
        const requiredFields = { firstName, lastName, email, phoneNumber };
        const missingFields = Object.entries(requiredFields)
            .filter(([key, value]) => !value)
            .map(([key]) => key);

        if (missingFields.length > 0) {
            res.locals = {
                status: STATUS.FAILURE,
                message: `Missing required fields: ${missingFields.join(', ')}`
            };
            return next();
        }

        // Validate phone number format
        const phoneRegex = /^\+\d{10,15}$/;
        if (!phoneRegex.test(phoneNumber)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Invalid phone number format. Please include country code."
            };
            return next();
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Invalid email format."
            };
            return next();
        }

        // Check if phone number already exists
        const phoneCheck = await assistantService.checkAssistantPhoneExists(phoneNumber);
        if (phoneCheck.status === STATUS.FAILURE) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Error checking existing records. Please try again."
            };
            return next();
        }

        if (phoneCheck.exists) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Phone number already registered for an assistant.",
                code: "PHONE_EXISTS"
            };
            return next();
        }

        // Check if email already exists
        const emailCheck = await assistantService.checkAssistantEmailExists(email);
        if (emailCheck.status === STATUS.FAILURE) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Error checking existing records. Please try again."
            };
            return next();
        }

        if (emailCheck.exists) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Email already exists for an assistant. Please use a different email.",
                code: "EMAIL_EXISTS"
            };
            return next();
        }

        // Create assistant record
        const assistantName = `${firstName} ${lastName}`;
        const assistantData = {
            assistant_name: assistantName,
            assistant_mobile: phoneNumber,
            assistant_email: email,
            doctor_id: doctorId,
            created_by: doctorId
        };

        const createResult = await assistantService.createAssistantInDB(assistantData);

        if (createResult.status === STATUS.SUCCESS) {
            const newAssistant = createResult.data;

            // Send WhatsApp notification to assistant with credentials
            const welcomeMessage = `🏥 Ruby AI Healthcare\n\nWelcome! You have been added as an assistant by Dr. ${doctorData.name}.\n\nYou can now login to the app using this phone number.\n\nThank you!`;
            await sendWhatsAppOTP(phoneNumber, '', welcomeMessage);

            res.locals = {
                status: STATUS.SUCCESS,
                message: "Assistant registered successfully",
                data: {
                    assistant: {
                        id: newAssistant.assistant_id,
                        name: newAssistant.assistant_name,
                        email: newAssistant.assistant_email,
                        phone: newAssistant.assistant_mobile,
                        doctorId: newAssistant.doctor_id,
                        role: 'assistant',
                        createdAt: newAssistant.created_at
                    }
                }
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: createResult.message || "Assistant registration failed"
            };
        }

        next();

    } catch (error) {
        console.error('Register Assistant Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Registration failed. Please try again."
        };
        next();
    }
};

/**
 * Send OTP to assistant's phone number for login
 */
exports.sendAssistantLoginOTP = async (req, res, next) => {
    try {
        console.log('[Assistant Login] Starting OTP request...', {
            timestamp: new Date().toISOString(),
            clientIP: req.ip,
            userAgent: req.headers['user-agent']
        });

        const { phoneNumber } = req.body;
        console.log('[Assistant Login] Phone number received:', phoneNumber);

        // Input validation
        if (!phoneNumber) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Phone number is required"
            };
            return next();
        }

        // Validate phone number format
        const phoneRegex = /^\+\d{10,15}$/;
        if (!phoneRegex.test(phoneNumber)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Invalid phone number format. Please include country code (e.g., +91xxxxxxxxxx)"
            };
            return next();
        }

        // Check if assistant exists
        const assistantCheck = await assistantService.checkAssistantPhoneExists(phoneNumber);
        if (assistantCheck.status === STATUS.FAILURE) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Error checking assistant records. Please try again."
            };
            return next();
        }

        if (!assistantCheck.exists) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Phone number not registered. Please contact your doctor.",
                code: "ASSISTANT_NOT_FOUND"
            };
            return next();
        }

        // If assistant exists but is inactive, reject
        if (!assistantCheck.isActive) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Your account is inactive. Please contact your doctor."
            };
            return next();
        }

        // Generate and store OTP
        const otp = generateOTP();
        const otpKey = `assistant_login_otp:${phoneNumber}`;

        // Store OTP with 5-minute expiry
        await redisRouter.setToRedis(otpKey, otp, 300);

        // Store attempt count to prevent spam
        const attemptKey = `assistant_otp_attempts:${phoneNumber}`;
        const attempts = await redisRouter.getFromRedis(attemptKey) || 0;

        await redisRouter.setToRedis(attemptKey, parseInt(attempts) + 1, 900); // 15 min TTL

        // Send WhatsApp OTP
        let whatsappSent = false;
        let otpDeliveryMethod = 'console';

        try {
            const whatsappResult = await sendWhatsAppOTP(phoneNumber, otp);
            whatsappSent = whatsappResult.success;
            otpDeliveryMethod = 'whatsapp';
        } catch (whatsappError) {
            console.error('WhatsApp sending failed:', whatsappError);
            otpDeliveryMethod = 'console';
        }

        // Prepare response message
        let responseMessage = "OTP sent successfully to your WhatsApp";
        if (!whatsappSent && process.env.NODE_ENV === 'development') {
            responseMessage = "OTP generated successfully (check console for development OTP)";
        }

        res.locals = {
            status: STATUS.SUCCESS,
            message: responseMessage,
            data: {
                phoneNumber: phoneNumber.replace(/(\+\d{2})\d{6}(\d{4})/, '$1******$2'),
                expiresIn: 300,
                deliveryMethod: otpDeliveryMethod,
                whatsappSent: whatsappSent
            }
        };
        next();

    } catch (error) {
        console.error('Send Assistant Login OTP Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to send OTP. Please try again."
        };
        next();
    }
};

/**
 * Verify OTP and login assistant
 */
exports.verifyAssistantLoginOTP = async (req, res, next) => {
    try {
        const { phoneNumber, otp } = req.body;

        // Input validation
        if (!phoneNumber || !otp) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Phone number and OTP are required"
            };
            return next();
        }

        // Get stored OTP from Redis
        const otpKey = `assistant_login_otp:${phoneNumber}`;
        const storedOtp = await redisRouter.getFromRedis(otpKey);

        if (!storedOtp) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "OTP expired or invalid. Please request a new OTP."
            };
            return next();
        }

        if (storedOtp !== otp) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Invalid OTP. Please check and try again."
            };
            return next();
        }

        // Get assistant data
        const assistantResult = await assistantService.getAssistantByPhone(phoneNumber);

        if (assistantResult.status === STATUS.FAILURE || !assistantResult.data) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Assistant not found. Please contact your doctor."
            };
            return next();
        }

        const assistant = assistantResult.data;

        // Get associated doctor information
        const doctorResult = await doctorService.getDoctorById(assistant.doctor_id);
        const doctorInfo = doctorResult.status === STATUS.SUCCESS ? doctorResult.data : null;

        // Clear OTP from Redis
        await redisRouter.delFromRedis(otpKey);
        await redisRouter.delFromRedis(`assistant_otp_attempts:${phoneNumber}`);

        // Generate JWT token
        const tokenPayload = {
            assistantId: assistant.assistant_id,
            phone: assistant.assistant_mobile,
            email: assistant.assistant_email,
            name: assistant.assistant_name,
            doctorId: assistant.doctor_id,
            role: 'assistant',
            loginMethod: 'phone',
            verified: true,
            loginTime: new Date().toISOString()
        };

        const token = generateAssistantToken(tokenPayload);

        // Store session in Redis
        const sessionKey = `assistant_session:${phoneNumber}`;
        const sessionData = {
            ...tokenPayload,
            token,
            lastActive: new Date().toISOString()
        };

        await redisRouter.setToRedis(sessionKey, sessionData, 7 * 24 * 60 * 60); // 7 days

        res.locals = {
            status: STATUS.SUCCESS,
            message: "OTP verified successfully",
            data: {
                token,
                role: 'assistant',
                user: {
                    id: assistant.assistant_id,
                    phoneNumber: assistant.assistant_mobile,
                    name: assistant.assistant_name,
                    email: assistant.assistant_email,
                    doctorId: assistant.doctor_id,
                    doctorName: doctorInfo?.dr_name,
                    verified: true,
                    role: 'assistant'
                }
            }
        };
        next();

    } catch (error) {
        console.error('Verify Assistant Login OTP Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "OTP verification failed. Please try again."
        };
        next();
    }
};

/**
 * Resend OTP for login
 */
exports.resendAssistantLoginOTP = async (req, res, next) => {
    try {
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Phone number is required"
            };
            return next();
        }

        // Check cooldown period
        const resendKey = `assistant_login_resend:${phoneNumber}`;
        const lastResend = await redisRouter.getFromRedis(resendKey);

        if (lastResend) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Please wait 30 seconds before requesting another OTP"
            };
            return next();
        }

        // Generate new OTP
        const otp = generateOTP();
        const otpKey = `assistant_login_otp:${phoneNumber}`;

        // Store OTP
        await redisRouter.setToRedis(otpKey, otp, 300);

        // Set resend cooldown
        await redisRouter.setToRedis(resendKey, Date.now(), 30);

        // Send WhatsApp OTP
        let whatsappSent = false;
        try {
            const whatsappResult = await sendWhatsAppOTP(phoneNumber, otp);
            whatsappSent = whatsappResult.success;
        } catch (error) {
            console.error('WhatsApp sending failed:', error);
        }

        res.locals = {
            status: STATUS.SUCCESS,
            message: whatsappSent ? "OTP resent successfully" : "OTP resent successfully (check console)",
            data: {
                phoneNumber: phoneNumber.replace(/(\+\d{2})\d{6}(\d{4})/, '$1******$2'),
                expiresIn: 300
            }
        };
        next();

    } catch (error) {
        console.error('Resend Assistant Login OTP Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to resend OTP. Please try again."
        };
        next();
    }
};

/**
 * Get all assistants for logged-in doctor
 */
exports.getDoctorAssistants = async (req, res, next) => {
    try {
        const doctorData = req.doctor;

        if (!doctorData || !doctorData.doctorId) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Doctor authentication required"
            };
            return next();
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const result = await assistantService.getAssistantsByDoctorId(
            doctorData.doctorId,
            page,
            limit
        );

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                message: "Assistants retrieved successfully",
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || "Failed to retrieve assistants"
            };
        }

        next();

    } catch (error) {
        console.error('Get Doctor Assistants Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to retrieve assistants. Please try again."
        };
        next();
    }
};

/**
 * Get specific assistant details
 */
exports.getAssistantDetails = async (req, res, next) => {
    try {
        const doctorData = req.doctor;
        const { assistantId } = req.params;

        if (!doctorData || !doctorData.doctorId) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Doctor authentication required"
            };
            return next();
        }

        if (!assistantId) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Assistant ID is required"
            };
            return next();
        }

        const result = await assistantService.getAssistantById(assistantId);

        if (result.status === STATUS.SUCCESS) {
            // Verify assistant belongs to this doctor (convert both to numbers)
            if (parseInt(result.data.doctor_id) !== parseInt(doctorData.doctorId)) {
                res.locals = {
                    status: STATUS.FAILURE,
                    message: "Unauthorized access to assistant"
                };
                return next();
            }

            res.locals = {
                status: STATUS.SUCCESS,
                message: "Assistant details retrieved successfully",
                data: {
                    assistant: result.data
                }
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || "Assistant not found"
            };
        }

        next();

    } catch (error) {
        console.error('Get Assistant Details Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to retrieve assistant details. Please try again."
        };
        next();
    }
};

/**
 * Update assistant information
 */
exports.updateAssistant = async (req, res, next) => {
    try {
        const doctorData = req.doctor;
        const { assistantId } = req.params;
        const updateData = req.body;

        console.log('Update Assistant Request:', {
            doctorId: doctorData?.doctorId,
            assistantId,
            updateData
        });

        if (!doctorData || !doctorData.doctorId) {
            console.log('❌ Doctor authentication failed');
            res.locals = {
                status: STATUS.FAILURE,
                message: "Doctor authentication required"
            };
            return next();
        }

        // Verify assistant belongs to this doctor
        const assistantCheck = await assistantService.getAssistantById(assistantId);

        console.log('Assistant Check Result:', {
            status: assistantCheck.status,
            assistantDoctorId: assistantCheck.data?.doctor_id,
            requestDoctorId: doctorData.doctorId,
            matches: assistantCheck.data?.doctor_id === doctorData.doctorId
        });

        if (assistantCheck.status === STATUS.FAILURE) {
            console.log('❌ Assistant not found');
            res.locals = {
                status: STATUS.FAILURE,
                message: "Assistant not found"
            };
            return next();
        }

        // Convert both to numbers for comparison (database returns string)
        if (parseInt(assistantCheck.data.doctor_id) !== parseInt(doctorData.doctorId)) {
            console.log('❌ Unauthorized: Assistant belongs to different doctor');
            res.locals = {
                status: STATUS.FAILURE,
                message: "Unauthorized access to assistant"
            };
            return next();
        }

        // Add updated_by field
        updateData.updated_by = doctorData.doctorId;

        const result = await assistantService.updateAssistantInfo(assistantId, updateData);

        if (result.status === STATUS.SUCCESS) {
            console.log('✅ Assistant updated successfully');
            res.locals = {
                status: STATUS.SUCCESS,
                message: "Assistant updated successfully",
                data: {
                    assistant: result.data
                }
            };
        } else {
            console.log('❌ Update failed:', result.message);
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || "Update failed"
            };
        }

        next();

    } catch (error) {
        console.error('Update Assistant Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to update assistant. Please try again."
        };
        next();
    }
};

/**
 * Deactivate assistant
 */
exports.deactivateAssistant = async (req, res, next) => {
    try {
        const doctorData = req.doctor;
        const { assistantId } = req.params;

        if (!doctorData || !doctorData.doctorId) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Doctor authentication required"
            };
            return next();
        }

        // Verify assistant belongs to this doctor
        const assistantCheck = await assistantService.getAssistantById(assistantId);
        if (assistantCheck.status === STATUS.FAILURE ||
            parseInt(assistantCheck.data.doctor_id) !== parseInt(doctorData.doctorId)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Unauthorized access to assistant"
            };
            return next();
        }

        const result = await assistantService.deactivateAssistant(
            assistantId,
            doctorData.doctorId
        );

        if (result.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                message: "Assistant deactivated successfully",
                data: result.data
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: result.message || "Deactivation failed"
            };
        }

        next();

    } catch (error) {
        console.error('Deactivate Assistant Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to deactivate assistant. Please try again."
        };
        next();
    }
};

/**
 * Setup PIN for assistant after first login
 */
exports.setupAssistantPIN = async (req, res, next) => {
    try {
        const { pin } = req.body;
        const assistantData = req.assistant || req.doctor; // From JWT middleware

        // Input validation
        if (!pin || !assistantData || !(assistantData.assistantId || assistantData.userId)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "PIN and authentication required"
            };
            return next();
        }

        // Validate PIN format (4 digits)
        if (!/^\d{4}$/.test(pin)) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "PIN must be exactly 4 digits"
            };
            return next();
        }

        // Convert PIN to integer for storage
        const pinInteger = parseInt(pin, 10);

        const assistantId = assistantData.assistantId || assistantData.userId;

        // Update assistant record with PIN
        const updateResult = await assistantService.updateAssistantInfo(assistantId, {
            assistant_pin: pinInteger
        });

        if (updateResult.status === STATUS.FAILURE) {
            res.locals = {
                status: STATUS.FAILURE,
                message: updateResult.message || "Failed to set PIN"
            };
            return next();
        }

        res.locals = {
            status: STATUS.SUCCESS,
            message: "PIN set successfully",
            data: {
                pinSetup: true
            }
        };
        next();

    } catch (error) {
        console.error('Setup Assistant PIN Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to set PIN. Please try again."
        };
        next();
    }
};
