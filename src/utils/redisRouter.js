const redisClient = require("../config/redisConnection");

/**
 * Check Redis connection status
 * @returns {boolean} True if connected, false otherwise
 */
function isRedisConnected() {
    return redisClient.isReady;
}

/**
 * Fetch data from Redis by key
 * @param {string} key
 * @returns {Promise<any>} Parsed JSON data or null
 */
async function getFromRedis(key) {
    try {
        if (!isRedisConnected()) {
            console.error('❌ Redis not connected during get operation', {
                key,
                timestamp: new Date().toISOString()
            });
            throw new Error('Redis not connected');
        }

        console.log('📍 Getting data from Redis:', {
            key,
            timestamp: new Date().toISOString()
        });

        const data = await redisClient.get(key);

        console.log('📍 Redis get result:', {
            key,
            found: !!data,
            timestamp: new Date().toISOString()
        });

        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('❌ Redis get error:', {
            key,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

/**
 * Store data in Redis with TTL (in seconds)
 * @param {string} key
 * @param {any} value
 * @param {number} ttlSeconds
 */
async function setToRedis(key, value, ttlSeconds = null) {
    try {
        if (!isRedisConnected()) {
            console.error('❌ Redis not connected during set operation', {
                key,
                timestamp: new Date().toISOString()
            });
            throw new Error('Redis not connected');
        }

        console.log('📍 Setting data in Redis:', {
            key,
            ttlSeconds,
            valueType: typeof value,
            timestamp: new Date().toISOString()
        });

        const stringValue = JSON.stringify(value);

        if (ttlSeconds) {
            // Set with expiration
            await redisClient.setEx(key, ttlSeconds, stringValue);
        } else {
            // Set without expiration (infinite TTL)
            await redisClient.set(key, stringValue);
        }

        console.log('✅ Redis set successful:', {
            key,
            ttlSeconds,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Redis set error:', {
            key,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

/**
 * Delete data from Redis
 * @param {string} key
 */
async function delFromRedis(key) {
    try {
        if (!isRedisConnected()) {
            console.error('❌ Redis not connected during delete operation', {
                key,
                timestamp: new Date().toISOString()
            });
            throw new Error('Redis not connected');
        }

        console.log('📍 Deleting data from Redis:', {
            key,
            timestamp: new Date().toISOString()
        });

        await redisClient.del(key);

        console.log('✅ Redis delete successful:', {
            key,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Redis delete error:', {
            key,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

module.exports = {
    getFromRedis,
    setToRedis,
    delFromRedis,
};
