require('dotenv').config();
const express = require('express');
const cors = require('cors');
const doctorAuthMiddleware = require('./middleware/doctorAuthMiddleware');
const assistantAuthMiddleware = require('./middleware/assistantAuthMiddleware');
const { logRequest, logResponse } = require('./middleware/requestLogger');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Add request and response logging middleware
app.use(logRequest);
app.use(logResponse);


app.use('/api/v1/doctor', doctorAuthMiddleware.verifyDoctorJWT);
app.use('/api/v1/assistant', assistantAuthMiddleware.verifyAssistantJWT);

require('./routes/routes')(app);

const PORT = process.env.PORT || 6600;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

