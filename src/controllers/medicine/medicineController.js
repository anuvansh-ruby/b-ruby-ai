const { fuzzySearchMedicine, batchFuzzySearch } = require('../../utils/fuzzyMedicineMatcher');
const { sendError } = require('../../middleware/setResponse');

/**
 * Medicine Controller
 * Handles API endpoints for medicine search functionality
 * 
 * Endpoints:
 * - GET /api/medicine/search - Search for a single medicine
 * - POST /api/medicine/batch-search - Search for multiple medicines
 */

/**
 * Search for medicines with fuzzy matching
 * 
 * @route GET /api/medicine/search
 * @query {string} q - Search query (medicine name) [required]
 * @query {number} limit - Maximum results (default: 20)
 * @query {string} salt - Composition/salt name for better matching
 * @query {number} minSimilarity - Minimum similarity threshold (default: 0.7)
 * 
 * @returns {Object} JSON response with medicine results
 * 
 * @example
 * GET /api/medicine/search?q=paracetamol&salt=Paracetamol 500mg
 * 
 * Response:
 * {
 *   "status": "SUCCESS",
 *   "message": "Medicine found",
 *   "data": {
 *     "medicines": [...],
 *     "search_query": "paracetamol",
 *     "results_count": 1,
 *     "match_type": "exact",
 *     "confidence": 1.0
 *   }
 * }
 */
exports.searchMedicines = async (req, res, next) => {
    try {
        const {
            q: query,
            limit = 20,
            salt,
            minSimilarity
        } = req.query;

        // Validation
        if (!query) {
            return sendError(res, 'Search query (q) is required', 400);
        }

        if (typeof query !== 'string' || query.trim().length < 2) {
            return sendError(res, 'Search query must be at least 2 characters long', 400);
        }

        // Parse numeric parameters
        const parsedLimit = parseInt(limit);
        const parsedMinSimilarity = minSimilarity ? parseFloat(minSimilarity) : 0.7;

        // Validate numeric parameters
        if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
            return sendError(res, 'Limit must be between 1 and 100', 400);
        }

        if (isNaN(parsedMinSimilarity) || parsedMinSimilarity < 0 || parsedMinSimilarity > 1) {
            return sendError(res, 'minSimilarity must be between 0 and 1', 400);
        }

        console.log(`\n📋 Medicine Search Request:`);
        console.log(`   Query: "${query}"`);
        if (salt) console.log(`   Salt: "${salt}"`);
        console.log(`   Limit: ${parsedLimit}`);
        console.log(`   Min Similarity: ${parsedMinSimilarity}`);

        // Perform fuzzy search
        const startTime = Date.now();
        const result = await fuzzySearchMedicine(query, {
            maxResults: parsedLimit,
            includeSalt: salt || null,
            minSimilarity: parsedMinSimilarity,
            preferExactMatch: true
        });
        const executionTime = Date.now() - startTime;

        // Handle no results
        if (!result.success) {
            console.log(`❌ No medicine found for "${query}" (${executionTime}ms)`);

            return sendError(
                res,
                result.message || 'No matching medicine found',
                404
            );
        }

        // Success response
        console.log(`✅ Medicine found: ${result.match.drug_name} (${executionTime}ms)`);
        console.log(`   Match Type: ${result.matchType}`);
        console.log(`   Confidence: ${result.confidence.toFixed(2)}`);

        res.locals = {
            status: 'SUCCESS',
            message: 'Medicine found',
            data: {
                medicines: [result.match],
                search_query: query,
                results_count: 1,
                match_type: result.matchType,
                confidence: result.confidence,
                execution_time_ms: executionTime
            }
        };

        next();

    } catch (error) {
        console.error('❌ Search medicines error:', error);
        console.error('Stack trace:', error.stack);

        res.locals = {
            status: 'FAILURE',
            message: 'Failed to search medicines',
            error: error.message
        };

        next();
    }
};

/**
 * Batch search for multiple medicines
 * 
 * @route POST /api/medicine/batch-search
 * @body {Array} medicines - Array of medicine objects [{medicine_name, medicine_salt}]
 * @body {number} minSimilarity - Minimum similarity threshold (default: 0.7)
 * @body {number} maxResults - Maximum results per medicine (default: 5)
 * 
 * @returns {Object} JSON response with batch search results
 * 
 * @example
 * POST /api/medicine/batch-search
 * Body:
 * {
 *   "medicines": [
 *     {"medicine_name": "Paracetamol", "medicine_salt": "Paracetamol 500mg"},
 *     {"medicine_name": "Aspirin", "medicine_salt": "Aspirin 75mg"}
 *   ],
 *   "minSimilarity": 0.7
 * }
 * 
 * Response:
 * {
 *   "status": "SUCCESS",
 *   "message": "Batch search completed",
 *   "data": {
 *     "total_searched": 2,
 *     "total_found": 2,
 *     "results": [...]
 *   }
 * }
 */
exports.batchSearchMedicines = async (req, res, next) => {
    try {
        const {
            medicines,
            minSimilarity = 0.7,
            maxResults = 5
        } = req.body;

        // Validation
        if (!medicines) {
            return sendError(res, 'medicines array is required', 400);
        }

        if (!Array.isArray(medicines)) {
            return sendError(res, 'medicines must be an array', 400);
        }

        if (medicines.length === 0) {
            return sendError(res, 'medicines array cannot be empty', 400);
        }

        if (medicines.length > 100) {
            return sendError(res, 'Maximum 100 medicines allowed per batch', 400);
        }

        // Validate each medicine object
        for (let i = 0; i < medicines.length; i++) {
            const medicine = medicines[i];

            if (!medicine.medicine_name) {
                return sendError(
                    res,
                    `medicine_name is required for medicine at index ${i}`,
                    400
                );
            }

            if (typeof medicine.medicine_name !== 'string' || medicine.medicine_name.trim().length < 2) {
                return sendError(
                    res,
                    `medicine_name at index ${i} must be at least 2 characters long`,
                    400
                );
            }
        }

        // Parse numeric parameters
        const parsedMinSimilarity = parseFloat(minSimilarity);
        const parsedMaxResults = parseInt(maxResults);

        if (isNaN(parsedMinSimilarity) || parsedMinSimilarity < 0 || parsedMinSimilarity > 1) {
            return sendError(res, 'minSimilarity must be between 0 and 1', 400);
        }

        if (isNaN(parsedMaxResults) || parsedMaxResults < 1 || parsedMaxResults > 20) {
            return sendError(res, 'maxResults must be between 1 and 20', 400);
        }

        console.log(`\n📋 Batch Medicine Search Request:`);
        console.log(`   Total Medicines: ${medicines.length}`);
        console.log(`   Min Similarity: ${parsedMinSimilarity}`);
        console.log(`   Max Results per Medicine: ${parsedMaxResults}`);

        // Perform batch search
        const startTime = Date.now();
        const results = await batchFuzzySearch(medicines, {
            minSimilarity: parsedMinSimilarity,
            maxResults: parsedMaxResults,
            preferExactMatch: true
        });
        const executionTime = Date.now() - startTime;

        // Format results
        const formattedResults = results.map(result => ({
            original_name: result.original.medicine_name,
            original_salt: result.original.medicine_salt,
            index: result.index,
            found: result.searchResult.success,
            medicine: result.searchResult.success ? result.searchResult.match : null,
            match_type: result.searchResult.matchType || null,
            confidence: result.searchResult.confidence || 0,
            error: result.searchResult.success ? null : result.searchResult.message
        }));

        const totalFound = formattedResults.filter(r => r.found).length;
        const successRate = ((totalFound / medicines.length) * 100).toFixed(1);

        console.log(`\n✅ Batch search completed in ${executionTime}ms`);
        console.log(`   Total Searched: ${medicines.length}`);
        console.log(`   Total Found: ${totalFound}`);
        console.log(`   Success Rate: ${successRate}%`);

        res.locals = {
            status: 'SUCCESS',
            message: 'Batch search completed',
            data: {
                total_searched: medicines.length,
                total_found: totalFound,
                success_rate: parseFloat(successRate),
                execution_time_ms: executionTime,
                results: formattedResults
            }
        };

        next();

    } catch (error) {
        console.error('❌ Batch search medicines error:', error);
        console.error('Stack trace:', error.stack);

        res.locals = {
            status: 'FAILURE',
            message: 'Failed to perform batch search',
            error: error.message
        };

        next();
    }
};

/**
 * Get medicine by ID
 * 
 * @route GET /api/medicine/:id
 * @param {number} id - Medicine ID
 * 
 * @returns {Object} JSON response with medicine details
 */
exports.getMedicineById = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Validation
        if (!id) {
            return sendError(res, 'Medicine ID is required', 400);
        }

        const medicineId = parseInt(id);

        if (isNaN(medicineId) || medicineId < 1) {
            return sendError(res, 'Invalid medicine ID', 400);
        }

        console.log(`\n📋 Get Medicine by ID Request: ${medicineId}`);

        const { medicinePool } = require('../../config/multiDbConnection');
        const { formatMedicineResult } = require('../../utils/fuzzyMedicineMatcher');

        const query = `
            SELECT 
                md.med_id,
                md.med_brand_name,
                md.med_generic_id,
                md.med_composition_id_1,
                md.med_composition_name_1,
                md.med_composition_strength_1,
                md.med_composition_unit_1,
                md.med_composition_id_2,
                md.med_composition_name_2,
                md.med_composition_strength_2,
                md.med_composition_unit_2,
                md.med_composition_id_3,
                md.med_composition_name_3,
                md.med_composition_strength_3,
                md.med_composition_unit_3,
                md.med_composition_id_4,
                md.med_composition_name_4,
                md.med_composition_strength_4,
                md.med_composition_unit_4,
                md.med_composition_id_5,
                md.med_composition_name_5,
                md.med_composition_strength_5,
                md.med_composition_unit_5,
                md.med_price,
                md.med_manufacturer_name,
                md.med_pack_size,
                md.med_type,
                md.med_weightage
            FROM med_details md
            WHERE md.med_id = $1
                AND md.is_active = 1
                AND md.is_deactivated = 0
        `;

        const result = await medicinePool.query(query, [medicineId]);

        if (result.rows.length === 0) {
            console.log(`❌ Medicine not found with ID: ${medicineId}`);
            return sendError(res, 'Medicine not found', 404);
        }

        const medicine = formatMedicineResult(result.rows[0]);

        console.log(`✅ Medicine found: ${medicine.drug_name}`);

        res.locals = {
            status: 'SUCCESS',
            message: 'Medicine found',
            data: {
                medicine
            }
        };

        next();

    } catch (error) {
        console.error('❌ Get medicine by ID error:', error);
        console.error('Stack trace:', error.stack);

        res.locals = {
            status: 'FAILURE',
            message: 'Failed to get medicine',
            error: error.message
        };

        next();
    }
};

module.exports = exports;
