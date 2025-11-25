const STATUS = require('../utils/constants').STATUS;

/**
 * Log response details before sending
 */
function logResponseBeforeSending(req, res, responseData, statusCode) {
    const endTime = Date.now();
    const duration = req.requestStartTime ? endTime - req.requestStartTime : 0;

    console.log('\n' + '='.repeat(80));
    console.log('🔄 PROCESSING RESPONSE IN setResponse');
    console.log('='.repeat(80));

    console.log('📊 Response Processing Details:');
    console.log(`   Route: ${req.method} ${req.originalUrl}`);
    console.log(`   Status Code: ${statusCode}`);
    console.log(`   Processing Duration: ${duration}ms`);
    console.log(`   Response Status: ${responseData.status}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);

    if (responseData.message) {
        console.log(`   Error Message: ${responseData.message}`);
    }

    console.log('\n📦 Response Payload:');
    const responseStr = JSON.stringify(responseData, null, 2);
    if (responseStr.length > 800) {
        console.log(responseStr.substring(0, 800) + '\n... (truncated in setResponse)');
    } else {
        console.log(responseStr);
    }

    console.log('\n' + '-'.repeat(80));
    console.log('📤 SENDING RESPONSE TO CLIENT');
    console.log('-'.repeat(80));
}

exports.setResponse = (req, res, next) => {
    const { status, data, message } = res.locals;

    if (status == STATUS.SUCCESS) {
        const responseData = {
            status: res.locals.status,
            message: res.locals.message || 'Success',
            data: res.locals.data,
        };

        // Log before sending successful response
        logResponseBeforeSending(req, res, responseData, 200);

        res.status(200).json(responseData);
    }
    else {
        const responseData = {
            status: res.locals.status || STATUS.FAILURE,
            message: res.locals.message || 'Something went wrong',
        };

        // Log before sending error response
        logResponseBeforeSending(req, res, responseData, 400);

        res.status(400).json(responseData);
    }
};
