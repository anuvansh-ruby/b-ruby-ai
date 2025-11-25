const jwt = require('jsonwebtoken');
const STATUS = require('../utils/constants').STATUS;

/**
 * Middleware to verify JWT token for assistant authentication
 * Extracts assistant data from token and attaches to req.assistant
 */
exports.verifyAssistantJWT = (req, res, next) => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Authentication required. Please provide a valid token.',
                code: 'NO_TOKEN'
            };
            return res.status(401).json(res.locals);
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ruby_ai_secret_key');

        // Validate token is for assistant (case-insensitive)
        const normalizedRole = decoded.role?.toLowerCase();
        if (normalizedRole !== 'assistant') {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Invalid token type. Assistant authentication required.',
                code: 'INVALID_ROLE'
            };
            return res.status(403).json(res.locals);
        }

        // Attach assistant data to request
        req.assistant = {
            assistantId: decoded.assistantId || decoded.userId,
            phone: decoded.phone,
            email: decoded.email,
            name: decoded.name,
            doctorId: decoded.doctorId,
            role: decoded.role,
            loginMethod: decoded.loginMethod,
            verified: decoded.verified
        };

        // Continue to next middleware/route handler
        next();

    } catch (error) {
        console.error('Assistant JWT Verification Error:', error);

        if (error.name === 'TokenExpiredError') {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Token has expired. Please login again.',
                code: 'TOKEN_EXPIRED'
            };
            return res.status(401).json(res.locals);
        }

        if (error.name === 'JsonWebTokenError') {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Invalid token. Please login again.',
                code: 'INVALID_TOKEN'
            };
            return res.status(401).json(res.locals);
        }

        res.locals = {
            status: STATUS.FAILURE,
            message: 'Authentication failed. Please try again.',
            code: 'AUTH_ERROR'
        };
        return res.status(401).json(res.locals);
    }
};

/**
 * Middleware to verify if assistant or doctor token
 * Useful for endpoints accessible by both roles
 */
exports.verifyAssistantOrDoctorJWT = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Authentication required. Please provide a valid token.',
                code: 'NO_TOKEN'
            };
            return res.status(401).json(res.locals);
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ruby_ai_secret_key');

        // Normalize role to lowercase for comparison
        const normalizedRole = decoded.role?.toLowerCase();

        console.log('🔍 JWT Verification:', {
            role: decoded.role,
            normalizedRole,
            assistantId: decoded.assistantId,
            userId: decoded.userId,
            doctorId: decoded.doctorId
        });

        // Check if role is either doctor or assistant (case-insensitive)
        if (normalizedRole === 'doctor') {
            req.doctor = {
                doctorId: decoded.doctorId || decoded.userId,
                phone: decoded.phone,
                email: decoded.email,
                name: decoded.name,
                specialization: decoded.specialization,
                designation: decoded.designation,
                role: decoded.role,
                loginMethod: decoded.loginMethod,
                verified: decoded.verified
            };
            req.userRole = 'doctor';
        } else if (normalizedRole === 'assistant') {
            req.assistant = {
                assistantId: decoded.assistantId || decoded.userId,
                phone: decoded.phone,
                email: decoded.email,
                name: decoded.name,
                doctorId: decoded.doctorId,
                role: decoded.role,
                loginMethod: decoded.loginMethod,
                verified: decoded.verified
            };
            req.userRole = 'assistant';
        } else {
            console.error('❌ Invalid role:', decoded.role);
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Invalid user role. Access denied.',
                code: 'INVALID_ROLE'
            };
            return res.status(403).json(res.locals);
        }

        next();

    } catch (error) {
        console.error('Combined JWT Verification Error:', error);

        if (error.name === 'TokenExpiredError') {
            res.locals = {
                status: STATUS.FAILURE,
                message: 'Token has expired. Please login again.',
                code: 'TOKEN_EXPIRED'
            };
            return res.status(401).json(res.locals);
        }

        res.locals = {
            status: STATUS.FAILURE,
            message: 'Authentication failed. Please try again.',
            code: 'AUTH_ERROR'
        };
        return res.status(401).json(res.locals);
    }
};
