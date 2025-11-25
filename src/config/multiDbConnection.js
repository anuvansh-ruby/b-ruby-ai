const { Pool } = require('pg');
require('dotenv').config();

/**
 * Multi-Database Connection Pool Manager
 * Manages separate connection pools for main application database and medicine database
 * 
 * Features:
 * - Dual connection pools for performance and scalability
 * - Graceful connection management with error handling
 * - Health check functionality
 * - Automatic reconnection on failure
 * - Event-driven monitoring
 */

// Main Application Database Configuration
const mainPoolConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT) || 5432,
    max: 50, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
    connectionTimeoutMillis: 10000, // How long to wait when connecting a new client (increased from 2s to 10s)
    query_timeout: 30000, // Query timeout in milliseconds
    statement_timeout: 30000, // Statement timeout in milliseconds
    ssl: {
        require: false,
        rejectUnauthorized: false
    }
};

// Medicine Database Configuration
const medicinePoolConfig = {
    host: process.env.MEDICINE_DB_HOST || process.env.DB_HOST || 'localhost',
    user: process.env.MEDICINE_DB_USER || process.env.DB_USER,
    password: process.env.MEDICINE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.MEDICINE_DB_NAME || 'medicine_db',
    port: parseInt(process.env.MEDICINE_DB_PORT || process.env.DB_PORT) || 5432,
    max: 50,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // How long to wait when connecting a new client (increased from 2s to 10s)
    query_timeout: 30000, // Query timeout in milliseconds
    statement_timeout: 30000, // Statement timeout in milliseconds
    ssl: {
        require: false,
        rejectUnauthorized: false
    }
};

// Create connection pools
const mainPool = new Pool(mainPoolConfig);
const medicinePool = new Pool(medicinePoolConfig);

// Event handlers for main pool
mainPool.on('connect', (client) => {
    console.log('✅ Main Database: New client connected');
});

mainPool.on('acquire', (client) => {
    console.log('🔄 Main Database: Client acquired from pool');
});

mainPool.on('remove', (client) => {
    console.log('🗑️  Main Database: Client removed from pool');
});

mainPool.on('error', (err, client) => {
    console.error('❌ Main Database Pool Error:', err);
    console.error('Error details:', {
        message: err.message,
        code: err.code,
        detail: err.detail
    });
});

// Event handlers for medicine pool
medicinePool.on('connect', (client) => {
    console.log('✅ Medicine Database: New client connected');
});

medicinePool.on('acquire', (client) => {
    console.log('🔄 Medicine Database: Client acquired from pool');
});

medicinePool.on('remove', (client) => {
    console.log('🗑️  Medicine Database: Client removed from pool');
});

medicinePool.on('error', (err, client) => {
    console.error('❌ Medicine Database Pool Error:', err);
    console.error('Error details:', {
        message: err.message,
        code: err.code,
        detail: err.detail
    });
});

/**
 * Get appropriate database pool based on database type
 * @param {string} database - 'main' or 'medicine'
 * @returns {Pool} PostgreSQL connection pool
 */
function getPool(database = 'main') {
    if (database === 'medicine') {
        return medicinePool;
    }
    return mainPool;
}

/**
 * Health check for both database connections
 * @returns {Promise<Object>} Health status of both databases
 */
async function healthCheck() {
    const results = {
        main: { status: 'unknown', error: null },
        medicine: { status: 'unknown', error: null }
    };

    // Check main database
    try {
        const mainClient = await mainPool.connect();
        const mainResult = await mainClient.query('SELECT NOW() as current_time, version() as version');
        mainClient.release();

        results.main = {
            status: 'connected',
            timestamp: mainResult.rows[0].current_time,
            version: mainResult.rows[0].version.split(',')[0],
            poolSize: mainPool.totalCount,
            idleConnections: mainPool.idleCount,
            waitingRequests: mainPool.waitingCount
        };
        console.log('✅ Main Database Health Check: OK');
    } catch (err) {
        results.main = {
            status: 'error',
            error: err.message,
            code: err.code
        };
        console.error('❌ Main Database Health Check: FAILED', err.message);
    }

    // Check medicine database
    try {
        const medicineClient = await medicinePool.connect();
        const medicineResult = await medicineClient.query('SELECT NOW() as current_time, version() as version');

        // Check if pg_trgm extension is installed
        const extensionCheck = await medicineClient.query(
            "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') as has_pg_trgm"
        );

        medicineClient.release();

        results.medicine = {
            status: 'connected',
            timestamp: medicineResult.rows[0].current_time,
            version: medicineResult.rows[0].version.split(',')[0],
            poolSize: medicinePool.totalCount,
            idleConnections: medicinePool.idleCount,
            waitingRequests: medicinePool.waitingCount,
            pg_trgm_enabled: extensionCheck.rows[0].has_pg_trgm
        };
        console.log('✅ Medicine Database Health Check: OK');

        if (!extensionCheck.rows[0].has_pg_trgm) {
            console.warn('⚠️  Warning: pg_trgm extension is not enabled in medicine database');
        }
    } catch (err) {
        results.medicine = {
            status: 'error',
            error: err.message,
            code: err.code
        };
        console.error('❌ Medicine Database Health Check: FAILED', err.message);
    }

    return results;
}

/**
 * Initialize and test database connections on startup
 * @returns {Promise<boolean>} True if both connections successful
 */
async function initializeDatabases() {
    console.log('\n🔌 Initializing Database Connections...\n');

    console.log('📊 Main Database Configuration:');
    console.log(`   Host: ${mainPoolConfig.host}:${mainPoolConfig.port}`);
    console.log(`   Database: ${mainPoolConfig.database}`);
    console.log(`   User: ${mainPoolConfig.user}`);
    console.log(`   Max Connections: ${mainPoolConfig.max}`);

    console.log('\n💊 Medicine Database Configuration:');
    console.log(`   Host: ${medicinePoolConfig.host}:${medicinePoolConfig.port}`);
    console.log(`   Database: ${medicinePoolConfig.database}`);
    console.log(`   User: ${medicinePoolConfig.user}`);
    console.log(`   Max Connections: ${medicinePoolConfig.max}\n`);

    const health = await healthCheck();

    const mainConnected = health.main.status === 'connected';
    const medicineConnected = health.medicine.status === 'connected';

    if (mainConnected && medicineConnected) {
        console.log('\n✅ All database connections established successfully!\n');
        return true;
    } else {
        console.error('\n❌ Database connection initialization failed:');
        if (!mainConnected) {
            console.error('   Main Database:', health.main.error);
        }
        if (!medicineConnected) {
            console.error('   Medicine Database:', health.medicine.error);
        }
        console.error('\n');
        return false;
    }
}

/**
 * Gracefully close all database connections
 * @returns {Promise<void>}
 */
async function closeDatabases() {
    console.log('\n🔌 Closing database connections...');

    try {
        await mainPool.end();
        console.log('✅ Main database pool closed');
    } catch (err) {
        console.error('❌ Error closing main database pool:', err.message);
    }

    try {
        await medicinePool.end();
        console.log('✅ Medicine database pool closed');
    } catch (err) {
        console.error('❌ Error closing medicine database pool:', err.message);
    }

    console.log('👋 All database connections closed\n');
}

// Handle process termination signals
process.on('SIGINT', async () => {
    console.log('\n⚠️  SIGINT received: Closing database connections...');
    await closeDatabases();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n⚠️  SIGTERM received: Closing database connections...');
    await closeDatabases();
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
    console.error('❌ Uncaught Exception:', err);
    await closeDatabases();
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    await closeDatabases();
    process.exit(1);
});

module.exports = {
    mainPool,
    medicinePool,
    getPool,
    healthCheck,
    initializeDatabases,
    closeDatabases
};
