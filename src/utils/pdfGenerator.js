const puppeteer = require('puppeteer');
const { mainPool } = require('../config/multiDbConnection');

/**
 * Generate HTML template for prescription PDF
 */
function generatePrescriptionHTML(data) {
    const { doctor, patient, appointment, medicines } = data;

    const currentDate = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Arial', sans-serif;
                padding: 40px;
                color: #333;
            }
            
            .header {
                text-align: center;
                border-bottom: 3px solid #2c3e50;
                padding-bottom: 20px;
                margin-bottom: 30px;
            }
            
            .header h1 {
                color: #2c3e50;
                font-size: 28px;
                margin-bottom: 5px;
            }
            
            .header .subtitle {
                color: #7f8c8d;
                font-size: 14px;
                margin-bottom: 10px;
            }
            
            .doctor-info {
                background: #ecf0f1;
                padding: 15px;
                border-radius: 5px;
                margin-bottom: 20px;
            }
            
            .doctor-info h2 {
                color: #2c3e50;
                font-size: 20px;
                margin-bottom: 10px;
            }
            
            .doctor-info p {
                margin: 5px 0;
                font-size: 13px;
                color: #555;
            }
            
            .patient-info {
                display: flex;
                justify-content: space-between;
                margin-bottom: 30px;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 5px;
            }
            
            .patient-info .section {
                flex: 1;
            }
            
            .patient-info h3 {
                color: #2c3e50;
                font-size: 16px;
                margin-bottom: 10px;
                border-bottom: 2px solid #3498db;
                padding-bottom: 5px;
            }
            
            .patient-info p {
                margin: 5px 0;
                font-size: 13px;
            }
            
            .vitals {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 10px;
                margin-bottom: 30px;
            }
            
            .vital-box {
                background: #fff;
                border: 1px solid #ddd;
                padding: 10px;
                border-radius: 5px;
                text-align: center;
            }
            
            .vital-box .label {
                font-size: 11px;
                color: #7f8c8d;
                margin-bottom: 5px;
            }
            
            .vital-box .value {
                font-size: 16px;
                font-weight: bold;
                color: #2c3e50;
            }
            
            .medicines-section {
                margin-top: 30px;
            }
            
            .medicines-section h3 {
                color: #2c3e50;
                font-size: 18px;
                margin-bottom: 15px;
                padding-bottom: 10px;
                border-bottom: 2px solid #3498db;
            }
            
            .medicine-table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 30px;
            }
            
            .medicine-table th {
                background: #3498db;
                color: white;
                padding: 12px;
                text-align: left;
                font-size: 13px;
                font-weight: 600;
            }
            
            .medicine-table td {
                padding: 12px;
                border-bottom: 1px solid #ddd;
                font-size: 13px;
            }
            
            .medicine-table tr:nth-child(even) {
                background: #f8f9fa;
            }
            
            .medicine-table tr:hover {
                background: #e8f4f8;
            }
            
            .footer {
                margin-top: 50px;
                padding-top: 20px;
                border-top: 2px solid #ecf0f1;
                text-align: center;
            }
            
            .signature {
                margin-top: 60px;
                text-align: right;
            }
            
            .signature-line {
                border-top: 2px solid #2c3e50;
                width: 250px;
                margin-left: auto;
                margin-bottom: 5px;
            }
            
            .signature-text {
                font-size: 13px;
                color: #555;
            }
            
            .footer-note {
                font-size: 11px;
                color: #7f8c8d;
                margin-top: 10px;
            }
            
            .prescription-date {
                text-align: right;
                font-size: 13px;
                color: #555;
                margin-bottom: 20px;
            }
            
            @media print {
                body {
                    padding: 20px;
                }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>MEDICAL PRESCRIPTION</h1>
            <p class="subtitle">Rx</p>
        </div>
        
        <div class="doctor-info">
            <h2>Dr. ${doctor.dr_name || 'N/A'}</h2>
            <p><strong>Specialization:</strong> ${doctor.dr_specialization || 'General Physician'}</p>
            ${doctor.dr_highest_designation ? `<p><strong>Qualification:</strong> ${doctor.dr_highest_designation}</p>` : ''}
            ${doctor.dr_licence_id ? `<p><strong>License No:</strong> ${doctor.dr_licence_id}</p>` : ''}
            <p><strong>Phone:</strong> ${doctor.dr_phone_number || 'N/A'}</p>
            <p><strong>Email:</strong> ${doctor.dr_email || 'N/A'}</p>
        </div>
        
        <div class="prescription-date">
            <strong>Date:</strong> ${currentDate}
        </div>
        
        <div class="patient-info">
            <div class="section">
                <h3>Patient Information</h3>
                <p><strong>Name:</strong> ${patient.patient_first_name || ''} ${patient.patient_last_name || ''}</p>
                <p><strong>Phone:</strong> ${patient.patient_phone_number || 'N/A'}</p>
                <p><strong>Email:</strong> ${patient.patient_email || 'N/A'}</p>
                ${patient.patient_date_of_birth ? `<p><strong>DOB:</strong> ${new Date(patient.patient_date_of_birth).toLocaleDateString('en-IN')}</p>` : ''}
            </div>
            <div class="section">
                <h3>Appointment Details</h3>
                <p><strong>Appointment ID:</strong> #${appointment.appointment_id}</p>
                <p><strong>Date:</strong> ${new Date(appointment.created_at).toLocaleDateString('en-IN')}</p>
            </div>
        </div>
        
        ${appointment.patient_height || appointment.patient_weight || appointment.patient_blood_pressure || appointment.patient_pulse ? `
        <div class="vitals">
            ${appointment.patient_height ? `
            <div class="vital-box">
                <div class="label">Height</div>
                <div class="value">${appointment.patient_height}</div>
            </div>
            ` : ''}
            ${appointment.patient_weight ? `
            <div class="vital-box">
                <div class="label">Weight</div>
                <div class="value">${appointment.patient_weight}</div>
            </div>
            ` : ''}
            ${appointment.patient_blood_pressure ? `
            <div class="vital-box">
                <div class="label">Blood Pressure</div>
                <div class="value">${appointment.patient_blood_pressure}</div>
            </div>
            ` : ''}
            ${appointment.patient_pulse ? `
            <div class="vital-box">
                <div class="label">Pulse</div>
                <div class="value">${appointment.patient_pulse}</div>
            </div>
            ` : ''}
            ${appointment.patient_temprature ? `
            <div class="vital-box">
                <div class="label">Temperature</div>
                <div class="value">${appointment.patient_temprature}</div>
            </div>
            ` : ''}
        </div>
        ` : ''}
        
        <div class="medicines-section">
            <h3>Prescribed Medications</h3>
            <table class="medicine-table">
                <thead>
                    <tr>
                        <th style="width: 5%;">#</th>
                        <th style="width: 40%;">Medicine Name</th>
                        <th style="width: 35%;">Composition</th>
                        <th style="width: 20%;">Frequency</th>
                    </tr>
                </thead>
                <tbody>
                    ${medicines.map((med, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td><strong>${med.medicine_name || 'N/A'}</strong></td>
                            <td>${med.medicine_salt || '-'}</td>
                            <td>${med.medicine_frequency || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="signature">
            <div class="signature-line"></div>
            <p class="signature-text">Dr. ${doctor.dr_name || 'N/A'}</p>
            <p class="signature-text">${doctor.dr_specialization || 'General Physician'}</p>
        </div>
        
        <div class="footer">
            <p class="footer-note">This is a computer-generated prescription.</p>
            <p class="footer-note">Please follow the prescribed medications and dosage as instructed.</p>
        </div>
    </body>
    </html>
    `;
}

/**
 * Fetch all data needed for prescription PDF
 */
async function fetchPrescriptionData(appointmentId) {
    try {
        console.log(`\n📋 Fetching prescription data for appointment ${appointmentId}`);

        // 1. Get appointment details with doctor and patient info
        const appointmentQuery = `
            SELECT 
                da.*,
                dr.dr_name,
                dr.dr_email,
                dr.dr_phone_number,
                dr.dr_specialization,
                dr.dr_highest_designation,
                dr.dr_licence_id,
                dr.dr_licence_type,
                pr.patient_first_name,
                pr.patient_last_name,
                pr.patient_email,
                pr.patient_phone_number,
                pr.patient_date_of_birth,
                pr.patient_address
            FROM dr_appointment da
            INNER JOIN doctors_records dr ON da.dr_id = dr.dr_id
            INNER JOIN patients_records pr ON da.patient_id = pr.patient_id
            WHERE da.appointment_id = $1 AND da.is_active = 1
        `;

        const appointmentResult = await mainPool.query(appointmentQuery, [appointmentId]);

        if (appointmentResult.rows.length === 0) {
            throw new Error(`Appointment ${appointmentId} not found`);
        }

        const appointmentData = appointmentResult.rows[0];
        console.log(`✅ Found appointment for Dr. ${appointmentData.dr_name}`);

        // 2. Get prescription ID from appointment_details
        const prescriptionQuery = `
            SELECT prescription_id
            FROM dr_appointment_details
            WHERE appointment_id = $1 AND is_active = 1
        `;

        const prescriptionResult = await mainPool.query(prescriptionQuery, [appointmentId]);

        if (prescriptionResult.rows.length === 0) {
            throw new Error('No prescription found for this appointment');
        }

        const prescriptionId = prescriptionResult.rows[0].prescription_id;
        console.log(`✅ Found prescription ID: ${prescriptionId}`);

        // 3. Get medicines for this prescription
        const medicinesQuery = `
            SELECT 
                medicine_name,
                medicine_salt,
                medicine_frequency,
                created_at
            FROM patient_medicine
            WHERE prescription_id = $1 AND is_active = 1
            ORDER BY created_at ASC
        `;

        const medicinesResult = await mainPool.query(medicinesQuery, [prescriptionId]);
        console.log(`✅ Found ${medicinesResult.rows.length} medicines`);

        if (medicinesResult.rows.length === 0) {
            throw new Error('No medicines found for this prescription');
        }

        // Structure the data
        return {
            doctor: {
                dr_name: appointmentData.dr_name,
                dr_email: appointmentData.dr_email,
                dr_phone_number: appointmentData.dr_phone_number,
                dr_specialization: appointmentData.dr_specialization,
                dr_highest_designation: appointmentData.dr_highest_designation,
                dr_licence_id: appointmentData.dr_licence_id,
                dr_licence_type: appointmentData.dr_licence_type
            },
            patient: {
                patient_first_name: appointmentData.patient_first_name,
                patient_last_name: appointmentData.patient_last_name,
                patient_email: appointmentData.patient_email,
                patient_phone_number: appointmentData.patient_phone_number,
                patient_date_of_birth: appointmentData.patient_date_of_birth,
                patient_address: appointmentData.patient_address
            },
            appointment: {
                appointment_id: appointmentData.appointment_id,
                created_at: appointmentData.created_at,
                patient_height: appointmentData.patient_height,
                patient_weight: appointmentData.patient_weight,
                patient_blood_pressure: appointmentData.patient_blood_pressure,
                patient_pulse: appointmentData.patient_pulse,
                patient_temprature: appointmentData.patient_temprature
            },
            medicines: medicinesResult.rows
        };

    } catch (error) {
        console.error('❌ Error fetching prescription data:', error);
        throw error;
    }
}

/**
 * Generate prescription PDF using Puppeteer
 */
async function generatePrescriptionPDF(appointmentId) {
    let browser = null;

    try {
        console.log(`\n🔄 Generating PDF for appointment ${appointmentId}`);

        // Fetch all data
        const prescriptionData = await fetchPrescriptionData(appointmentId);

        // Generate HTML
        const html = generatePrescriptionHTML(prescriptionData);

        // Launch Puppeteer
        console.log('🚀 Launching browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        // Set content
        await page.setContent(html, {
            waitUntil: 'networkidle0'
        });

        // Generate PDF
        console.log('📄 Generating PDF...');
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            }
        });

        console.log('✅ PDF generated successfully');

        return {
            success: true,
            pdfBuffer,
            fileName: `Prescription_${appointmentId}_${Date.now()}.pdf`,
            prescriptionData
        };

    } catch (error) {
        console.error('❌ Error generating PDF:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed');
        }
    }
}

module.exports = {
    generatePrescriptionPDF,
    generatePrescriptionHTML,
    fetchPrescriptionData
};
