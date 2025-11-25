const STATUS = require('../utils/constants').STATUS;

/**
 * Generate curl command equivalent for the incoming request
 */
function generateCurlCommand(req) {
    const baseUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    let curlCommand = `curl -X ${req.method} "${baseUrl}"`;
    
    // Add headers
    Object.keys(req.headers).forEach(header => {
        if (header.toLowerCase() !== 'host' && header.toLowerCase() !== 'content-length') {
            curlCommand += ` \\\n  -H "${header}: ${req.headers[header]}"`;
        }
    });
    
    // Add data for POST/PUT/PATCH requests
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
        curlCommand += ` \\\n  -d '${JSON.stringify(req.body)}'`;
    }
    
    return curlCommand;
}

/**
 * Format request details for logging
 */
function formatRequestDetails(req) {
    return {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl,
        headers: req.headers,
        query: req.query,
        body: req.body,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || 'Unknown'
    };
}

/**
 * Request logger middleware
 */
exports.logRequest = (req, res, next) => {
    const startTime = Date.now();
    
    console.log('\n' + '='.repeat(80));
    console.log('📥 INCOMING REQUEST');
    console.log('='.repeat(80));
    
    // Log request details
    const requestDetails = formatRequestDetails(req);
    console.log('📋 Request Details:');
    console.log(JSON.stringify(requestDetails, null, 2));
    
    console.log('\n' + '-'.repeat(40));
    console.log('🔄 CURL Equivalent:');
    console.log('-'.repeat(40));
    console.log(generateCurlCommand(req));
    
    console.log('\n' + '='.repeat(80));
    console.log('⏱️  Request started at:', new Date().toISOString());
    console.log('='.repeat(80));
    
    // Store start time for response logging
    req.requestStartTime = startTime;
    
    next();
};

/**
 * Response logger middleware (to be used after processing)
 */
exports.logResponse = (req, res, next) => {
    const originalSend = res.send;
    const originalJson = res.json;
    
    // Override res.send
    res.send = function(data) {
        logResponseDetails(req, res, data);
        originalSend.call(this, data);
    };
    
    // Override res.json
    res.json = function(data) {
        logResponseDetails(req, res, data);
        originalJson.call(this, data);
    };
    
    next();
};

/**
 * Log response details
 */
function logResponseDetails(req, res, data) {
    const endTime = Date.now();
    const duration = req.requestStartTime ? endTime - req.requestStartTime : 0;
    
    console.log('\n' + '='.repeat(80));
    console.log('📤 OUTGOING RESPONSE');
    console.log('='.repeat(80));
    
    console.log('📊 Response Details:');
    console.log(`   Status Code: ${res.statusCode}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Response Size: ${JSON.stringify(data).length} bytes`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    
    console.log('\n📄 Response Headers:');
    const responseHeaders = res.getHeaders();
    console.log(JSON.stringify(responseHeaders, null, 2));
    
    if (data) {
        console.log('\n📦 Response Body:');
        // Truncate large responses for readability
        const responseStr = JSON.stringify(data, null, 2);
        if (responseStr.length > 1000) {
            console.log(responseStr.substring(0, 1000) + '\n... (truncated)');
        } else {
            console.log(responseStr);
        }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`✅ Request completed in ${duration}ms`);
    console.log('='.repeat(80) + '\n');
}