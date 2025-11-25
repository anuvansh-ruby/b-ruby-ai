const STATUS = require('../../utils/constants').STATUS;
const jwt = require('jsonwebtoken');
const crypto = require("crypto");
const axios = require('axios');
const redisRouter = require("../../utils/redisRouter");
const doctorService = require('./doctorService');
const assistantService = require('./assistantService');

/**
 * Doctor Authentication Controller
 * Handles login, registration, and forgot PIN functionality for doctors
 * Uses doctors_records table schema as per database instructions
 * 
 * UNIFIED LOGIN: This controller now handles both doctor and assistant login
 * - Checks doctors_records first
 * - If not found, checks assistant_records
 * - Returns appropriate user type and data
 */

// Generate 4-digit OTP
function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Utility to generate JWT token for doctors
function generateDoctorToken(payload) {
    return jwt.sign(
        payload,
        process.env.JWT_SECRET || 'ruby_ai_secret_key',
        { expiresIn: '7d' }
    );
}

// Send WhatsApp message via WasenderAPI with fallback handling
async function sendWhatsAppOTP(phoneNumber, otp, customMessage = null) {
    console.log('[WhatsApp OTP] Starting message send:', {
        phoneNumber,
        hasOTP: !!otp,
        hasCustomMessage: !!customMessage,
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
        apiTokenPresent: !!process.env.WHATSAPP_API_TOKEN,
        nodeEnv: process.env.NODE_ENV,
        envVars: Object.keys(process.env).filter(key => key.includes('WHATSAPP') || key.includes('API')),
    });

    if (!process.env.WASENDER_API_KEY) {
        console.error('[WhatsApp OTP] API Token missing in environment variables');
        throw new Error('WhatsApp API token not configured');
    }

    try {
        // WhatsApp API integration
        const url = 'https://wasenderapi.com/api/send-message';
        console.log('[WhatsApp OTP] Preparing API request:', {
            url,
            method: 'POST',
            timestamp: new Date().toISOString()
        });
        const message = customMessage || `🏥 Ruby AI Healthcare\n\nYour OTP for login is: ${otp}\n\nThis OTP will expire in 5 minutes.\n\nDo not share this OTP with anyone.`;

        console.log('[WhatsApp OTP] Building request:', {
            messageLength: message.length,
            phoneNumberFormat: phoneNumber.match(/^\+\d{10,15}$/) ? 'valid' : 'invalid',
            timestamp: new Date().toISOString()
        });

        const requestData = {
            to: phoneNumber,
            text: message
        };

        console.log('[WhatsApp OTP] Request configuration:', {
            endpoint: url,
            hasToken: !!process.env.WHATSAPP_API_TOKEN,
            tokenLength: process.env.WHATSAPP_API_TOKEN?.length,
            timestamp: new Date().toISOString()
        });

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
            console.log('[WhatsApp OTP] Sending API request...');
            const response = await axios(config);

            console.log('[WhatsApp OTP] API response received:', {
                status: response.status,
                statusText: response.statusText,
                hasData: !!response.data,
                responseTime: response.headers['x-response-time'],
                timestamp: new Date().toISOString()
            });

            if (response.data) {
                return { success: true, data: response.data };
            } else {
                console.error('[WhatsApp OTP] API response indicates failure:', {
                    responseData: response.data,
                    timestamp: new Date().toISOString()
                });
                throw new Error('WhatsApp API response indicates failure');
            }
        } catch (apiError) {
            console.error('[WhatsApp OTP] API Error:', {
                message: apiError.message,
                code: apiError.code,
                response: apiError.response?.data,
                status: apiError.response?.status,
                headers: apiError.response?.headers,
                timestamp: new Date().toISOString()
            });
            // Try again after a short delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                console.log('[WhatsApp OTP] Retrying API call after error...');
                const retryResponse = await axios(config);
                console.log('[WhatsApp OTP] Retry Response:', {
                    status: retryResponse.status,
                    data: retryResponse.data,
                    headers: retryResponse.headers
                });

                if (retryResponse.data && retryResponse.data.status === 'success') {
                    console.log('[WhatsApp OTP] Retry successful');
                    return { success: true, data: retryResponse.data };
                }
            } catch (retryError) {
                console.error('[WhatsApp OTP] Retry Failed:', {
                    error: retryError.message,
                    response: retryError.response?.data,
                    status: retryError.response?.status,
                    headers: retryError.response?.headers
                });
            }
            throw apiError;
        }
        /*
        const url = 'https://api.wasender.io/v1/messages';
        const message = customMessage || `🏥 Ruby AI Healthcare\n\nYour OTP for login is: ${otp}\n\nThis OTP will expire in 5 minutes.\n\nDo not share this OTP with anyone.`;

        const requestData = {
            phone: phoneNumber,
            message: message
        };

        const config = {
            method: 'POST',
            url: url,
            headers: {
                'Authorization': `Bearer ${process.env.WASENDER_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: requestData
        };

        const response = await axios(config);
        return { success: true, data: response.data };
        */
    } catch (error) {
        console.error('WhatsApp OTP Error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send OTP to doctor's phone number for login
 */
exports.sendDoctorLoginOTP = async (req, res, next) => {
    try {
        console.log('[Doctor Login] Starting OTP request...', {
            timestamp: new Date().toISOString(),
            clientIP: req.ip,
            userAgent: req.headers['user-agent']
        });

        const { phoneNumber } = req.body;
        console.log('[Doctor Login] Phone number received:', phoneNumber);

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

        // UNIFIED LOGIN: Check both doctors and assistants tables
        console.log('[Unified Login] Checking if user exists in doctors table:', {
            phoneNumber,
            timestamp: new Date().toISOString()
        });
        const doctorCheck = await doctorService.checkPhoneExists(phoneNumber);
        console.log('[Unified Login] Doctor check result:', {
            status: doctorCheck.status,
            exists: doctorCheck.exists,
            isActive: doctorCheck.isActive,
            timestamp: new Date().toISOString()
        });

        let userType = null;
        let userExists = false;
        let isActive = false;

        if (doctorCheck.exists) {
            userType = 'DOCTOR';
            userExists = true;
            isActive = doctorCheck.isActive;
            console.log('[Unified Login] User found in doctors table');
        } else {
            // Check assistant table
            console.log('[Unified Login] Doctor not found, checking assistants table:', {
                phoneNumber,
                timestamp: new Date().toISOString()
            });
            const assistantCheck = await assistantService.checkAssistantPhoneExists(phoneNumber);
            console.log('[Unified Login] Assistant check result:', {
                status: assistantCheck.status,
                exists: assistantCheck.exists,
                isActive: assistantCheck.isActive,
                timestamp: new Date().toISOString()
            });

            if (assistantCheck.status === STATUS.FAILURE) {
                console.error('[Unified Login] Failed to check assistant records:', assistantCheck);
                res.locals = {
                    status: STATUS.FAILURE,
                    message: "Error checking user records. Please try again."
                };
                return next();
            }

            if (assistantCheck.exists) {
                userType = 'ASSISTANT';
                userExists = true;
                isActive = assistantCheck.isActive;
                console.log('[Unified Login] User found in assistants table');
            }
        }

        // If user exists but is inactive, reject
        if (userExists && !isActive) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Your account is inactive. Please contact support."
            };
            return next();
        }

        // Store user type for verification step
        const userTypeKey = `user_type:${phoneNumber}`;
        if (userType) {
            await redisRouter.setToRedis(userTypeKey, userType, 300); // 5 min expiry
            console.log('[Unified Login] Stored user type in Redis:', { userType, phoneNumber });
        }

        // Generate and store OTP for both existing and new doctors
        console.log('[Doctor Login] Generating OTP');
        const otp = generateOTP();
        const otpKey = `doctor_login_otp:${phoneNumber}`;

        try {
            console.log('[Doctor Login] Storing OTP in Redis:', {
                key: otpKey,
                expiry: '300 seconds',
                timestamp: new Date().toISOString()
            });
            // Store OTP with 5-minute expiry
            await redisRouter.setToRedis(otpKey, otp, 300);
            console.log('[Doctor Login] Successfully stored OTP in Redis');

            // Verify the OTP was stored correctly
            const storedOTP = await redisRouter.getFromRedis(otpKey);
            console.log('[Doctor Login] Redis storage verification:', {
                stored: !!storedOTP,
                matches: storedOTP === otp,
                timestamp: new Date().toISOString()
            });
        } catch (redisError) {
            console.error('[Doctor Login] Redis OTP storage error:', {
                error: redisError.message,
                stack: redisError.stack,
                timestamp: new Date().toISOString()
            });
            throw redisError;
        }

        // Store attempt count to prevent spam
        const attemptKey = `doctor_otp_attempts:${phoneNumber}`;
        console.log('[Doctor Login] Checking previous attempts');
        const attempts = await redisRouter.getFromRedis(attemptKey) || 0;
        console.log('[Doctor Login] Previous attempts:', {
            count: attempts,
            key: attemptKey,
            timestamp: new Date().toISOString()
        });

        // if (parseInt(attempts) >= 3) {
        //     res.locals = {
        //         status: STATUS.FAILURE,
        //         message: "Too many OTP requests. Please try again after 15 minutes."
        //     };
        //     return next();
        // }

        await redisRouter.setToRedis(attemptKey, parseInt(attempts) + 1, 900); // 15 min TTL

        // Send WhatsApp OTP
        let whatsappSent = false;
        let otpDeliveryMethod = 'console'; // fallback method

        console.log('[Doctor Login] Attempting WhatsApp OTP delivery:', {
            phoneNumber,
            timestamp: new Date().toISOString(),
            apiToken: process.env.WASENDER_API_KEY ? 'Present' : 'Missing'
        });

        try {
            const whatsappResult = await sendWhatsAppOTP(phoneNumber, otp);
            whatsappSent = whatsappResult.success;
            otpDeliveryMethod = 'whatsapp';
            console.log('[Doctor Login] WhatsApp API Response:', {
                success: whatsappResult.success,
                data: whatsappResult.data,
                timestamp: new Date().toISOString()
            });
        } catch (whatsappError) {
            console.error('WhatsApp sending failed:', whatsappError);
            // OTP is logged to console for development/testing when WhatsApp fails
            otpDeliveryMethod = 'console';
        }

        // Prepare response message based on delivery method
        let responseMessage = "OTP sent successfully to your WhatsApp";
        if (!whatsappSent && process.env.NODE_ENV === 'development') {
            responseMessage = "OTP generated successfully (check console for development OTP)";
        } else if (!whatsappSent) {
            responseMessage = "OTP generated successfully (delivery pending - please contact support if not received)";
        }

        res.locals = {
            status: STATUS.SUCCESS,
            message: responseMessage,
            data: {
                phoneNumber: phoneNumber.replace(/(\+\d{2})\d{6}(\d{4})/, '$1******$2'),
                expiresIn: 300, // 5 minutes in seconds
                deliveryMethod: otpDeliveryMethod,
                whatsappSent: whatsappSent
            }
        };
        next();

    } catch (error) {
        console.error('[Doctor Login] Error Details:', {
            message: error.message,
            stack: error.stack,
            type: error.name,
            code: error.code,
            timestamp: new Date().toISOString()
        });

        if (error.message === 'WhatsApp API token not configured') {
            console.error('[Doctor Login] Configuration Error: WhatsApp API token missing');
            res.locals = {
                status: STATUS.FAILURE,
                message: "System configuration error. Please contact support."
            };
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            console.error('[Doctor Login] Network Error:', {
                code: error.code,
                host: error.address,
                port: error.port
            });
            res.locals = {
                status: STATUS.FAILURE,
                message: "Network error. Please try again."
            };
        } else {
            console.error('[Doctor Login] Unexpected Error:', error);
            res.locals = {
                status: STATUS.FAILURE,
                message: "Failed to send OTP. Please try again."
            };
        }
        next();
    }
};

/**
 * Verify OTP and login doctor OR assistant (unified login)
 */
exports.verifyDoctorLoginOTP = async (req, res, next) => {
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
        const otpKey = `doctor_login_otp:${phoneNumber}`;
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

        // Get user type from Redis (set during send OTP)
        const userTypeKey = `user_type:${phoneNumber}`;
        const userType = await redisRouter.getFromRedis(userTypeKey);

        console.log('[Unified Login] User type from Redis:', { userType, phoneNumber });

        // Try doctor first
        const doctorResult = await doctorService.getDoctorByPhone(phoneNumber);

        if (doctorResult.status === STATUS.SUCCESS && doctorResult.data) {
            // DOCTOR LOGIN
            const doctor = doctorResult.data;

            // Update last login for existing doctor
            await doctorService.updateLastLogin(doctor.dr_id);

            // Clear OTP data
            await redisRouter.delFromRedis(otpKey);
            await redisRouter.delFromRedis(`doctor_otp_attempts:${phoneNumber}`);
            await redisRouter.delFromRedis(userTypeKey);

            // Generate JWT token
            const tokenPayload = {
                userId: doctor.dr_id,
                doctorId: doctor.dr_id,
                phone: doctor.dr_phone_number,
                email: doctor.dr_email,
                name: doctor.dr_name,
                role: 'DOCTOR',
                specialization: doctor.dr_specialization,
                designation: doctor.dr_highest_designation,
                loginMethod: 'phone',
                verified: true,
                loginTime: new Date().toISOString()
            };

            const token = generateDoctorToken(tokenPayload);

            // Store user session in Redis
            const sessionKey = `doctor_session:${phoneNumber}`;
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
                    role: 'DOCTOR',
                    isExistingUser: true,
                    user: {
                        id: doctor.dr_id,
                        phoneNumber: doctor.dr_phone_number,
                        name: doctor.dr_name,
                        email: doctor.dr_email,
                        dateOfBirth: doctor.dr_dob,
                        specialization: doctor.dr_specialization,
                        designation: doctor.dr_highest_designation,
                        licenceId: doctor.dr_licence_id,
                        licenceType: doctor.dr_licence_type,
                        practiceStartDate: doctor.dr_practice_start_date,
                        city: doctor.dr_city,
                        state: doctor.dr_state,
                        country: doctor.dr_country,
                        pin: doctor.dr_pin,
                        verified: true
                    }
                }
            };
            return next();
        }

        // Try assistant
        const assistantResult = await assistantService.getAssistantByPhone(phoneNumber);

        if (assistantResult.status === STATUS.SUCCESS && assistantResult.data) {
            // ASSISTANT LOGIN
            const assistant = assistantResult.data;

            // Get doctor info for assistant
            const doctorInfo = await doctorService.getDoctorById(assistant.doctor_id);

            // Clear OTP data
            await redisRouter.delFromRedis(otpKey);
            await redisRouter.delFromRedis(`doctor_otp_attempts:${phoneNumber}`);
            await redisRouter.delFromRedis(userTypeKey);

            // Generate JWT token for assistant
            const tokenPayload = {
                userId: assistant.assistant_id,
                assistantId: assistant.assistant_id,
                doctorId: assistant.doctor_id,
                phone: assistant.assistant_mobile,
                email: assistant.assistant_email,
                name: assistant.assistant_name,
                role: 'ASSISTANT',
                loginMethod: 'phone',
                verified: true,
                loginTime: new Date().toISOString()
            };

            const token = generateDoctorToken(tokenPayload); // Using same JWT secret

            // Store user session in Redis
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
                    role: 'ASSISTANT',
                    isExistingUser: true,
                    user: {
                        id: assistant.assistant_id,
                        phoneNumber: assistant.assistant_mobile,
                        name: assistant.assistant_name,
                        email: assistant.assistant_email,
                        doctorId: assistant.doctor_id,
                        doctorName: doctorInfo?.data?.dr_name,
                        pin: assistant.assistant_pin,
                        verified: true
                    }
                }
            };
            return next();
        }

        // User doesn't exist - OTP verified but user needs to register (doctor only)
        await redisRouter.delFromRedis(otpKey);
        await redisRouter.delFromRedis(`doctor_otp_attempts:${phoneNumber}`);
        await redisRouter.delFromRedis(userTypeKey);

        res.locals = {
            status: STATUS.SUCCESS,
            message: "OTP verified successfully. Please complete your registration.",
            data: {
                isNewUser: true,
                requiresRegistration: true,
                role: 'DOCTOR' // New users are doctors (assistants are created by doctors)
            }
        };
        next();

    } catch (error) {
        console.error('Verify Doctor Login OTP Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "OTP verification failed. Please try again."
        };
        next();
    }
};

/**
 * Register new doctor with full details
 */
exports.registerDoctor = async (req, res, next) => {
    try {
        const {
            phoneNumber,
            name,
            email,
            dateOfBirth,
            specialization,
            designation,
            licenceId,
            licenceType,
            practiceStartDate,
            city,
            state,
            country,
            pin
        } = req.body;

        // Input validation
        const requiredFields = { phoneNumber, name, email };
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

        // Validate date of birth if provided
        if (dateOfBirth) {
            const birthDate = new Date(dateOfBirth);
            if (isNaN(birthDate.getTime()) || birthDate > new Date()) {
                res.locals = {
                    status: STATUS.FAILURE,
                    message: "Invalid date of birth."
                };
                return next();
            }
        }

        // Check if doctor already exists
        const phoneCheck = await doctorService.checkPhoneExists(phoneNumber);
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
                message: "Phone number already registered. Please login instead.",
                code: "PHONE_EXISTS"
            };
            return next();
        }

        // Check email uniqueness
        const emailCheck = await doctorService.checkEmailExists(email);
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
                message: "Email already exists. Please use a different email address.",
                code: "EMAIL_EXISTS"
            };
            return next();
        }

        // Create doctor record
        const doctorData = {
            dr_name: name,
            dr_phone_number: phoneNumber,
            dr_email: email,
            dr_dob: dateOfBirth ? new Date(dateOfBirth).toISOString() : null,
            dr_specialization: specialization,
            dr_highest_designation: designation,
            dr_licence_id: licenceId,
            dr_licence_type: licenceType,
            dr_practice_start_date: practiceStartDate ? new Date(practiceStartDate).toISOString() : null,
            dr_city: city,
            dr_state: state,
            dr_country: country,
            dr_pin: pin
        };

        const createResult = await doctorService.createDoctorInDB(doctorData);

        if (createResult.status === STATUS.SUCCESS) {
            const newDoctor = createResult.data;

            // Generate JWT token for the newly registered doctor
            const tokenPayload = {
                doctorId: newDoctor.dr_id,
                phone: newDoctor.dr_phone_number,
                email: newDoctor.dr_email,
                name: newDoctor.dr_name,
                specialization: newDoctor.dr_specialization,
                designation: newDoctor.dr_highest_designation,
                loginMethod: 'registration',
                verified: true,
                loginTime: new Date().toISOString()
            };

            const token = generateDoctorToken(tokenPayload);

            // Store user session in Redis
            const sessionKey = `doctor_session:${newDoctor.dr_phone_number}`;
            const sessionData = {
                ...tokenPayload,
                token,
                lastActive: new Date().toISOString()
            };

            await redisRouter.setToRedis(sessionKey, sessionData, 7 * 24 * 60 * 60); // 7 days

            res.locals = {
                status: STATUS.SUCCESS,
                message: "Doctor registered successfully",
                data: {
                    token,
                    doctor: {
                        id: newDoctor.dr_id,
                        phoneNumber: newDoctor.dr_phone_number,
                        name: newDoctor.dr_name,
                        email: newDoctor.dr_email,
                        dateOfBirth: newDoctor.dr_dob,
                        specialization: newDoctor.dr_specialization,
                        designation: newDoctor.dr_highest_designation,
                        licenceId: newDoctor.dr_licence_id,
                        licenceType: newDoctor.dr_licence_type,
                        practiceStartDate: newDoctor.dr_practice_start_date,
                        city: newDoctor.dr_city,
                        state: newDoctor.dr_state,
                        country: newDoctor.dr_country,
                        pin: newDoctor.dr_pin,
                        verified: true
                    },
                    requiresPinSetup: true
                }
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: createResult.message || "Doctor registration failed"
            };
        }

        next();

    } catch (error) {
        console.error('Register Doctor Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Registration failed. Please try again."
        };
        next();
    }
};

/**
 * Test authentication - demonstrates how user data is extracted from JWT token
 */
exports.testAuth = async (req, res, next) => {
    try {
        const doctorData = req.doctor; // Extracted from JWT by middleware

        res.locals = {
            status: STATUS.SUCCESS,
            message: "Authentication successful",
            data: {
                message: "Token verified successfully",
                authenticatedUser: {
                    id: doctorData.doctorId,
                    name: doctorData.name,
                    email: doctorData.email,
                    phone: doctorData.phone,
                    specialization: doctorData.specialization,
                    hasPinSetup: doctorData.hasPinSetup
                },
                timestamp: new Date().toISOString()
            }
        };
        next();

    } catch (error) {
        console.error('Test Auth Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Authentication test failed"
        };
        next();
    }
};

/**
 * Get doctor profile
 */
exports.getDoctorProfile = async (req, res, next) => {
    try {
        const doctorData = req.doctor; // From JWT middleware

        if (!doctorData) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Doctor authentication required"
            };
            return next();
        }

        // Return comprehensive doctor profile data
        res.locals = {
            status: STATUS.SUCCESS,
            message: "Profile retrieved successfully",
            data: {
                doctor: {
                    id: doctorData.doctorId,
                    name: doctorData.name,
                    email: doctorData.email,
                    phone: doctorData.phone,
                    dateOfBirth: doctorData.dateOfBirth,
                    specialization: doctorData.specialization,
                    designation: doctorData.designation,
                    licenceId: doctorData.licenceId,
                    licenceType: doctorData.licenceType,
                    practiceStartDate: doctorData.practiceStartDate,
                    city: doctorData.city,
                    state: doctorData.state,
                    country: doctorData.country,
                    lastLogin: doctorData.lastLogin,
                    isActive: doctorData.isActive,
                    hasPinSetup: doctorData.hasPinSetup
                }
            }
        };
        next();

    } catch (error) {
        console.error('Get Doctor Profile Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to retrieve profile. Please try again."
        };
        next();
    }
};

/**
 * Update doctor profile
 */
exports.updateDoctorProfile = async (req, res, next) => {
    try {
        const doctorId = req.doctor?.doctorId;

        if (!doctorId) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Doctor authentication required"
            };
            return next();
        }

        const updateData = req.body;

        // Remove fields that shouldn't be updated via this endpoint
        delete updateData.dr_id;
        delete updateData.dr_phone_number; // Phone number changes require separate verification
        delete updateData.created_at;
        delete updateData.updated_at;

        const updateResult = await doctorService.updateDoctorInfo(doctorId, updateData);

        if (updateResult.status === STATUS.SUCCESS) {
            res.locals = {
                status: STATUS.SUCCESS,
                message: "Profile updated successfully",
                data: {
                    doctor: updateResult.data
                }
            };
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: updateResult.message || "Profile update failed"
            };
        }

        next();

    } catch (error) {
        console.error('Update Doctor Profile Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Profile update failed. Please try again."
        };
        next();
    }
};

/**
 * Resend OTP for login
 */
exports.resendDoctorLoginOTP = async (req, res, next) => {
    try {
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Phone number is required"
            };
            return next();
        }

        // Check cooldown period (30 seconds between resends)
        const resendKey = `doctor_login_resend:${phoneNumber}`;
        const lastResend = await redisRouter.getFromRedis(resendKey);

        if (lastResend) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Please wait 30 seconds before requesting another OTP"
            };
            return next();
        }

        // Check if doctor exists
        const doctorCheck = await doctorService.checkPhoneExists(phoneNumber);
        if (doctorCheck.status === STATUS.FAILURE) {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Error checking doctor records. Please try again."
            };
            return next();
        }

        // Generate new OTP
        const otp = generateOTP();
        const otpKey = `doctor_login_otp:${phoneNumber}`;

        // Store OTP with 5-minute expiry
        await redisRouter.setToRedis(otpKey, otp, 300);

        // Set resend cooldown
        await redisRouter.setToRedis(resendKey, Date.now(), 30); // 30 seconds

        // Send WhatsApp OTP
        let whatsappSent = false;
        let otpDeliveryMethod = 'console'; // fallback method

        try {
            const whatsappResult = await sendWhatsAppOTP(phoneNumber, otp);
            whatsappSent = whatsappResult.success;
            otpDeliveryMethod = 'whatsapp';
        } catch (whatsappError) {
            console.error('WhatsApp sending failed:', whatsappError);
            otpDeliveryMethod = 'console';
        }

        // Prepare response message
        let responseMessage = "OTP resent successfully to your WhatsApp";
        if (!whatsappSent && process.env.NODE_ENV === 'development') {
            responseMessage = "OTP resent successfully (check console for development OTP)";
        } else if (!whatsappSent) {
            responseMessage = "OTP resent successfully (delivery pending - please contact support if not received)";
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
        console.error('Resend Doctor Login OTP Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to resend OTP. Please try again."
        };
        next();
    }
};

/**
 * Logout doctor
 */
exports.logoutDoctor = async (req, res, next) => {
    try {
        const doctorId = req.doctor?.doctorId;

        if (doctorId) {
            // Clear session from Redis
            const sessionKey = `doctor_session:${doctorId}`;
            await redisRouter.delFromRedis(sessionKey);
        }

        res.locals = {
            status: STATUS.SUCCESS,
            message: "Logout successful"
        };
        next();

    } catch (error) {
        console.error('Logout Doctor Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Logout failed. Please try again."
        };
        next();
    }
};

/**
 * Unified PIN setup for both doctors and assistants
 * Determines user type from JWT token and updates appropriate table
 */
exports.setupUserPIN = async (req, res, next) => {
    try {
        const { pin } = req.body;

        // Get user data from either doctor or assistant middleware
        const userData = req.doctor || req.assistant;
        const userRole = req.doctor ? 'doctor' : 'assistant';

        console.log('📌 Setup PIN Request:', {
            role: userRole,
            userId: userData?.doctorId || userData?.assistantId,
            hasPin: !!pin
        });

        // Input validation
        if (!pin || !userData) {
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

        let updateResult;

        if (userRole === 'doctor') {
            // Update doctor record with PIN
            console.log('📌 Updating doctor PIN for ID:', userData.doctorId);
            updateResult = await doctorService.updateDoctorInfo(userData.doctorId, {
                dr_pin: pinInteger
            });
        } else if (userRole === 'assistant') {
            // Update assistant record with PIN
            console.log('📌 Updating assistant PIN for ID:', userData.assistantId);
            updateResult = await assistantService.updateAssistantInfo(userData.assistantId, {
                assistant_pin: pinInteger
            });
        } else {
            res.locals = {
                status: STATUS.FAILURE,
                message: "Invalid user role"
            };
            return next();
        }

        if (updateResult.status === STATUS.FAILURE) {
            console.error('❌ PIN update failed:', updateResult.message);
            res.locals = {
                status: STATUS.FAILURE,
                message: updateResult.message || "Failed to set PIN"
            };
            return next();
        }

        console.log('✅ PIN set successfully for', userRole);
        res.locals = {
            status: STATUS.SUCCESS,
            message: "PIN set successfully",
            data: {
                pinSetup: true,
                role: userRole
            }
        };
        next();

    } catch (error) {
        console.error('Setup User PIN Error:', error);
        res.locals = {
            status: STATUS.FAILURE,
            message: "Failed to set PIN. Please try again."
        };
        next();
    }
};