const jwt = require('jsonwebtoken');
const STATUS = require('../utils/constants').STATUS;
const redisRouter = require('../utils/redisRouter');
const doctorService = require('../controllers/doctor/doctorService');

exports.verifyDoctorJWT = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                status: STATUS.FAILURE,
                message: "Authorization header missing"
            });
        }

        const token = authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : authHeader;

        if (!token) {
            return res.status(401).json({
                status: STATUS.FAILURE,
                message: "Access token missing"
            });
        }

        // Verify JWT token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({
                    status: STATUS.FAILURE,
                    message: "Token expired. Please login again.",
                    code: "TOKEN_EXPIRED"
                });
            } else if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    status: STATUS.FAILURE,
                    message: "Invalid token. Please login again.",
                    code: "INVALID_TOKEN"
                });
            } else {
                return res.status(401).json({
                    status: STATUS.FAILURE,
                    message: "Token verification failed",
                    code: "TOKEN_ERROR"
                });
            }
        }

        // Try to get doctor session from Redis first
        const sessionKey = `doctor_session:${decoded.phone}`;
        let sessionData = await redisRouter.getFromRedis(sessionKey);
        let parsedSessionData = null;
        let doctorData = null;

        if (sessionData) {
            // Parse existing session data from Redis
            try {
                parsedSessionData = typeof sessionData === 'string'
                    ? JSON.parse(sessionData)
                    : sessionData;

                // Use doctor data from session if available
                doctorData = parsedSessionData.doctorData;
            } catch (parseError) {
                console.error('Session data parsing error:', parseError);
                // Continue to database fallback
                sessionData = null;
                parsedSessionData = null;
            }
        }

        // If no valid session data or doctor data, fetch from database
        if (!sessionData || !doctorData) {
            console.log(`Doctor session missing or incomplete for ID: ${decoded.doctorId}, fetching from database...`);

            // Fetch doctor data from database
            const dbDoctorResult = await doctorService.getDoctorById(decoded.doctorId);

            if (dbDoctorResult.status === STATUS.FAILURE || !dbDoctorResult.data) {
                return res.status(401).json({
                    status: STATUS.FAILURE,
                    message: "Doctor not found or inactive. Please login again.",
                    code: "DOCTOR_NOT_FOUND"
                });
            }

            const dbDoctor = dbDoctorResult.data;

            // Verify that the token data matches database data
            if (dbDoctor.dr_phone_number !== decoded.phone ||
                dbDoctor.dr_email !== decoded.email) {
                return res.status(401).json({
                    status: STATUS.FAILURE,
                    message: "Token data mismatch. Please login again.",
                    code: "TOKEN_DATA_MISMATCH"
                });
            }

            // Create/Update session data with fresh database information
            const currentTime = new Date().toISOString();
            parsedSessionData = {
                doctorId: dbDoctor.dr_id,
                loginTime: parsedSessionData?.loginTime || currentTime,
                lastActivity: currentTime,
                deviceInfo: parsedSessionData?.deviceInfo || 'unknown',
                doctorData: {
                    id: dbDoctor.dr_id,
                    name: dbDoctor.dr_name,
                    email: dbDoctor.dr_email,
                    phone: dbDoctor.dr_phone_number,
                    dateOfBirth: dbDoctor.dr_dob,
                    specialization: dbDoctor.dr_specialization,
                    designation: dbDoctor.dr_highest_designation,
                    licenceId: dbDoctor.dr_licence_id,
                    licenceType: dbDoctor.dr_licence_type,
                    practiceStartDate: dbDoctor.dr_practice_start_date,
                    city: dbDoctor.dr_city,
                    state: dbDoctor.dr_state,
                    country: dbDoctor.dr_country,
                    pin: dbDoctor.dr_pin,
                    lastLogin: dbDoctor.last_login,
                    isActive: dbDoctor.is_active === 1,
                    hasPinSetup: !!dbDoctor.dr_pin
                }
            };

            // Store updated session in Redis with 7-day expiry
            await redisRouter.setToRedis(sessionKey, JSON.stringify(parsedSessionData), 7 * 24 * 60 * 60);

            console.log(`Doctor session restored from database for ID: ${decoded.doctorId}`);
        } else {
            // Update last activity timestamp for existing session
            parsedSessionData.lastActivity = new Date().toISOString();
            await redisRouter.setToRedis(sessionKey, JSON.stringify(parsedSessionData), 7 * 24 * 60 * 60);
        }

        // Update doctor's last login in database (async, don't wait)
        doctorService.updateLastLogin(decoded.doctorId).catch(error => {
            console.error('Error updating last login:', error);
        });

        // Attach comprehensive doctor data to request
        req.doctor = {
            doctorId: decoded.doctorId,
            phone: decoded.phone,
            email: decoded.email,
            name: parsedSessionData.doctorData.name,
            specialization: parsedSessionData.doctorData.specialization,
            designation: parsedSessionData.doctorData.designation,
            licenceId: parsedSessionData.doctorData.licenceId,
            licenceType: parsedSessionData.doctorData.licenceType,
            practiceStartDate: parsedSessionData.doctorData.practiceStartDate,
            city: parsedSessionData.doctorData.city,
            state: parsedSessionData.doctorData.state,
            country: parsedSessionData.doctorData.country,
            dateOfBirth: parsedSessionData.doctorData.dateOfBirth,
            lastLogin: parsedSessionData.doctorData.lastLogin,
            isActive: parsedSessionData.doctorData.isActive,
            hasPinSetup: parsedSessionData.doctorData.hasPinSetup,
            sessionData: parsedSessionData,
            token: token
        };

        // Continue to next middleware
        next();

    } catch (error) {
        console.error('Doctor JWT Verification Error:', error);
        return res.status(401).json({
            status: STATUS.FAILURE,
            message: "Authentication failed. Please login again.",
            code: "AUTH_ERROR"
        });
    }
};