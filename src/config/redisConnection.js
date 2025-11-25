const { createClient } = require("redis");

// Initialize Redis client with authentication
let redisClient = createClient({
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        reconnectStrategy: (retries) => {
            console.log(`🔄 Redis reconnection attempt ${retries}`);
            if (retries > 10) {
                console.error('❌ Max Redis reconnection attempts reached');
                return new Error('Max reconnection attempts reached');
            }
            return Math.min(retries * 100, 3000);
        },
    },
    // Log connection details for debugging
    legacyMode: false,
});

redisClient.on("error", (err) => {
    console.error("❌ Redis Client Error:", {
        message: err.message,
        stack: err.stack,
        code: err.code,
        timestamp: new Date().toISOString()
    });
});

redisClient.on("connect", () => {
    console.log("🔌 Redis client connecting...", {
        timestamp: new Date().toISOString()
    });
});

redisClient.on("ready", () => {
    console.log("✅ Redis client connected successfully!", {
        timestamp: new Date().toISOString()
    });
});

redisClient.on("reconnecting", () => {
    console.log("🔄 Redis client reconnecting...", {
        timestamp: new Date().toISOString()
    });
});

redisClient.on("end", () => {
    console.log("📍 Redis connection ended", {
        timestamp: new Date().toISOString()
    });
});

(async () => {
    try {
        // Connect to Redis with authentication from config
        await redisClient.connect();
        console.log('🔐 Connecting to Redis at %s:%s...', process.env.REDIS_HOST || '127.0.0.1', process.env.REDIS_PORT || 6379);

        // Test connection
        await redisClient.ping();
        console.log('✅ Redis connection test successful (PING)');
    } catch (error) {
        console.error('❌ Redis connection error:', {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
})();

module.exports = redisClient;
