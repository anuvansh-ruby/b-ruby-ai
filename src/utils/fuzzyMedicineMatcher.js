const { medicinePool } = require('../config/multiDbConnection');

/**
 * Fuzzy Medicine Matcher Utility
 * Implements intelligent medicine search with multiple strategies:
 * 1. Exact match
 * 2. Fuzzy LIKE search
 * 3. PostgreSQL pg_trgm similarity search
 * 4. Composition-based search
 * 5. Generic drug search
 * 
 * Features:
 * - OCR error tolerance (O↔0, I↔1, S↔5)
 * - Suffix removal (tablet, capsule, syrup, etc.)
 * - Dosage extraction and matching
 * - Levenshtein distance similarity
 * - Multi-composition support
 */

// Common medicine suffixes to remove for better matching
const MEDICINE_SUFFIXES = [
    'tablet', 'tablets', 'tab', 'tabs',
    'capsule', 'capsules', 'cap', 'caps',
    'syrup', 'suspension', 'solution',
    'injection', 'inj',
    'cream', 'ointment', 'gel',
    'drops', 'drop',
    'powder', 'granules',
    'mr', 'sr', 'xr', 'er', 'cr', 'la', 'xl', 'ds'
];

// OCR common error mappings
const OCR_VARIATIONS = {
    'o': ['0', 'o'],
    '0': ['o', '0'],
    'i': ['1', 'i', 'l'],
    '1': ['i', '1', 'l'],
    'l': ['1', 'i', 'l'],
    's': ['5', 's'],
    '5': ['s', '5'],
    'z': ['2', 'z'],
    '2': ['z', '2'],
    'b': ['8', 'b'],
    '8': ['b', '8']
};

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1].toLowerCase() === str2[j - 1].toLowerCase() ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[len1][len2];
}

/**
 * Calculate similarity score between two strings (0-1)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score (0-1, higher is more similar)
 */
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    // Exact match
    if (s1 === s2) return 1.0;

    // Contains match
    if (s1.includes(s2) || s2.includes(s1)) {
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        return 0.8 * (shorter.length / longer.length);
    }

    // Levenshtein distance-based similarity
    const maxLength = Math.max(s1.length, s2.length);
    if (maxLength === 0) return 1.0;

    const distance = levenshteinDistance(s1, s2);
    return Math.max(0, 1 - (distance / maxLength));
}

/**
 * Extract strength/dosage information from medicine name
 * @param {string} medicineName - Medicine name (e.g., "Paracetamol 500mg")
 * @returns {Object} Extracted information
 */
function extractStrengthFromName(medicineName) {
    if (!medicineName) {
        return { name: '', strength: null, unit: null, fullDose: null };
    }

    // Pattern: number + optional decimal + unit
    const strengthPattern = /(\d+(?:\.\d+)?)\s*(mg|gm|ml|mcg|g|l|iu|%)/gi;
    const match = medicineName.match(strengthPattern);

    if (match && match.length > 0) {
        const fullDose = match[0].toLowerCase().trim();
        const numMatch = fullDose.match(/(\d+(?:\.\d+)?)/);
        const unitMatch = fullDose.match(/(mg|gm|ml|mcg|g|l|iu|%)/i);

        const strength = numMatch ? numMatch[1] : null;
        const unit = unitMatch ? unitMatch[1].toLowerCase() : null;

        // Remove dosage from name
        const name = medicineName.replace(strengthPattern, '').trim();

        return {
            name,
            strength,
            unit,
            fullDose
        };
    }

    return {
        name: medicineName.trim(),
        strength: null,
        unit: null,
        fullDose: null
    };
}

/**
 * Remove common medicine suffixes from name
 * @param {string} name - Medicine name
 * @returns {string} Cleaned name
 */
function removeSuffixes(name) {
    if (!name) return '';

    let cleaned = name.toLowerCase().trim();

    // Remove suffixes
    for (const suffix of MEDICINE_SUFFIXES) {
        const pattern = new RegExp(`\\s+${suffix}\\s*$`, 'gi');
        cleaned = cleaned.replace(pattern, '');
    }

    return cleaned.trim();
}

/**
 * Generate name variations for OCR error tolerance
 * @param {string} medicineName - Original medicine name
 * @returns {Array<string>} Array of name variations
 */
function generateMedicineNameVariations(medicineName) {
    if (!medicineName) return [];

    const variations = new Set();
    const cleaned = medicineName.trim();

    // Original name
    variations.add(cleaned);
    variations.add(cleaned.toLowerCase());

    // Extract name without dosage
    const extracted = extractStrengthFromName(cleaned);
    if (extracted.name && extracted.name !== cleaned) {
        variations.add(extracted.name);
        variations.add(extracted.name.toLowerCase());
    }

    // Remove suffixes
    const withoutSuffix = removeSuffixes(cleaned);
    if (withoutSuffix && withoutSuffix !== cleaned.toLowerCase()) {
        variations.add(withoutSuffix);
    }

    // Generate OCR variations (limit to avoid explosion)
    const baseVariations = Array.from(variations).slice(0, 3);
    for (const base of baseVariations) {
        // Only generate variations for key characters
        const lowerBase = base.toLowerCase();

        // Replace common OCR errors (limit to 2-3 variations)
        if (lowerBase.includes('o') || lowerBase.includes('0')) {
            variations.add(lowerBase.replace(/o/g, '0'));
            variations.add(lowerBase.replace(/0/g, 'o'));
        }
        if (lowerBase.includes('i') || lowerBase.includes('1') || lowerBase.includes('l')) {
            variations.add(lowerBase.replace(/i/g, '1'));
            variations.add(lowerBase.replace(/1/g, 'i'));
            variations.add(lowerBase.replace(/l/g, 'i'));
        }
        if (lowerBase.includes('s') || lowerBase.includes('5')) {
            variations.add(lowerBase.replace(/s/g, '5'));
            variations.add(lowerBase.replace(/5/g, 's'));
        }
    }

    return Array.from(variations).filter(v => v.length >= 2);
}

/**
 * Build full composition string from medicine data
 * @param {Object} medicine - Medicine record
 * @returns {string|null} Composition string (e.g., "Paracetamol 500mg + Caffeine 65mg")
 */
function buildCompositionString(medicine) {
    const parts = [];

    for (let i = 1; i <= 5; i++) {
        const name = medicine[`composition${i}_name`];
        const strength = medicine[`composition${i}_strength`];
        const unit = medicine[`composition${i}_unit`];

        if (name) {
            const dose = (strength && unit) ? ` ${strength}${unit}` : '';
            parts.push(`${name}${dose}`);
        }
    }

    return parts.length > 0 ? parts.join(' + ') : null;
}

/**
 * Build dose string from strength and unit
 * @param {string} strength - Strength value
 * @param {string} unit - Unit (mg, ml, etc.)
 * @returns {string|null} Dose string
 */
function buildDoseString(strength, unit) {
    if (strength && unit) {
        return `${strength}${unit}`;
    }
    return null;
}

/**
 * Format medicine result to standardized structure
 * @param {Object} medicine - Raw medicine record from database
 * @returns {Object} Formatted medicine object
 */
function formatMedicineResult(medicine) {
    return {
        med_drug_id: medicine.med_id,
        drug_name: medicine.med_brand_name,
        med_generic_id: medicine.med_generic_id,

        // Composition 1
        composition1_id: medicine.med_composition_id_1,
        composition1_name: medicine.med_composition_name_1,
        composition1_strength: medicine.med_composition_strength_1,
        composition1_unit: medicine.med_composition_unit_1,
        composition1_dose: buildDoseString(
            medicine.med_composition_strength_1,
            medicine.med_composition_unit_1
        ),

        // Composition 2
        composition2_id: medicine.med_composition_id_2,
        composition2_name: medicine.med_composition_name_2,
        composition2_strength: medicine.med_composition_strength_2,
        composition2_unit: medicine.med_composition_unit_2,
        composition2_dose: buildDoseString(
            medicine.med_composition_strength_2,
            medicine.med_composition_unit_2
        ),

        // Composition 3
        composition3_id: medicine.med_composition_id_3,
        composition3_name: medicine.med_composition_name_3,
        composition3_strength: medicine.med_composition_strength_3,
        composition3_unit: medicine.med_composition_unit_3,
        composition3_dose: buildDoseString(
            medicine.med_composition_strength_3,
            medicine.med_composition_unit_3
        ),

        // Composition 4
        composition4_id: medicine.med_composition_id_4,
        composition4_name: medicine.med_composition_name_4,
        composition4_strength: medicine.med_composition_strength_4,
        composition4_unit: medicine.med_composition_unit_4,
        composition4_dose: buildDoseString(
            medicine.med_composition_strength_4,
            medicine.med_composition_unit_4
        ),

        // Composition 5
        composition5_id: medicine.med_composition_id_5,
        composition5_name: medicine.med_composition_name_5,
        composition5_strength: medicine.med_composition_strength_5,
        composition5_unit: medicine.med_composition_unit_5,
        composition5_dose: buildDoseString(
            medicine.med_composition_strength_5,
            medicine.med_composition_unit_5
        ),

        // Full composition string
        composition: buildCompositionString(medicine),

        // Other details
        mrp: medicine.med_price,
        manufacturer: medicine.med_manufacturer_name,
        pack_size: medicine.med_pack_size,
        med_type: medicine.med_type,
        med_weightage: medicine.med_weightage
    };
}

/**
 * Try exact match search
 * @param {Array<string>} variations - Name variations to try
 * @returns {Promise<Object|null>} Medicine result or null
 */
async function tryExactMatch(variations) {
    for (const variant of variations) {
        try {
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
                WHERE md.is_active = 1 
                    AND md.is_deactivated = 0
                    AND LOWER(md.med_brand_name) = LOWER($1)
                ORDER BY md.med_weightage DESC NULLS LAST
                LIMIT 1
            `;

            const result = await medicinePool.query(query, [variant]);

            if (result.rows.length > 0) {
                return {
                    success: true,
                    match: formatMedicineResult(result.rows[0]),
                    confidence: 1.0,
                    matchType: 'exact',
                    searchTerm: variant
                };
            }
        } catch (error) {
            console.error(`Error in exact match search for "${variant}":`, error.message);
        }
    }

    return null;
}

/**
 * Try fuzzy LIKE search
 * @param {Array<string>} variations - Name variations to try
 * @param {number} maxResults - Maximum results to return
 * @returns {Promise<Array>} Array of fuzzy matches
 */
async function tryFuzzyLikeSearch(variations, maxResults = 5) {
    const fuzzyResults = [];

    for (const variant of variations) {
        try {
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
                    md.med_weightage,
                    CASE
                        WHEN LOWER(md.med_brand_name) = LOWER($1) THEN 100
                        WHEN LOWER(md.med_brand_name) LIKE LOWER($1) || '%' THEN 90
                        WHEN LOWER(md.med_brand_name) LIKE '%' || LOWER($1) || '%' THEN 80
                        ELSE 70
                    END as match_score
                FROM med_details md
                WHERE md.is_active = 1 
                    AND md.is_deactivated = 0
                    AND LOWER(md.med_brand_name) LIKE '%' || LOWER($1) || '%'
                ORDER BY match_score DESC, md.med_weightage DESC NULLS LAST
                LIMIT $2
            `;

            const result = await medicinePool.query(query, [variant, maxResults]);

            for (const row of result.rows) {
                // Calculate similarity score
                const similarity = calculateSimilarity(variant, row.med_brand_name);

                fuzzyResults.push({
                    medicine: formatMedicineResult(row),
                    similarity,
                    matchScore: row.match_score,
                    searchTerm: variant
                });
            }
        } catch (error) {
            console.error(`Error in fuzzy LIKE search for "${variant}":`, error.message);
        }
    }

    return fuzzyResults;
}

/**
 * Try pg_trgm composition-based search
 * @param {string} salt - Composition/salt name
 * @param {number} maxResults - Maximum results
 * @returns {Promise<Array>} Array of composition matches
 */
async function tryCompositionSearch(salt, maxResults = 5) {
    if (!salt) return [];

    const extracted = extractStrengthFromName(salt);
    const compositionResults = [];

    try {
        let query;
        let params;

        if (extracted.strength && extracted.unit) {
            // Search with strength matching
            query = `
                SELECT DISTINCT
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
                    md.med_weightage,
                    GREATEST(
                        similarity(LOWER(COALESCE(md.med_composition_name_1, '')), LOWER($1)),
                        similarity(LOWER(COALESCE(md.med_composition_name_2, '')), LOWER($1)),
                        similarity(LOWER(COALESCE(md.med_composition_name_3, '')), LOWER($1)),
                        similarity(LOWER(COALESCE(md.med_composition_name_4, '')), LOWER($1)),
                        similarity(LOWER(COALESCE(md.med_composition_name_5, '')), LOWER($1))
                    ) as comp_similarity,
                    CASE
                        WHEN (LOWER(md.med_composition_name_1) % LOWER($1)
                              AND md.med_composition_strength_1 = $2 
                              AND LOWER(md.med_composition_unit_1) = LOWER($3)) THEN 100
                        WHEN (LOWER(md.med_composition_name_2) % LOWER($1)
                              AND md.med_composition_strength_2 = $2 
                              AND LOWER(md.med_composition_unit_2) = LOWER($3)) THEN 100
                        WHEN (LOWER(md.med_composition_name_3) % LOWER($1)
                              AND md.med_composition_strength_3 = $2 
                              AND LOWER(md.med_composition_unit_3) = LOWER($3)) THEN 100
                        WHEN (LOWER(md.med_composition_name_4) % LOWER($1)
                              AND md.med_composition_strength_4 = $2 
                              AND LOWER(md.med_composition_unit_4) = LOWER($3)) THEN 100
                        WHEN (LOWER(md.med_composition_name_5) % LOWER($1)
                              AND md.med_composition_strength_5 = $2 
                              AND LOWER(md.med_composition_unit_5) = LOWER($3)) THEN 100
                        WHEN LOWER(md.med_composition_name_1) % LOWER($1) THEN 80
                        WHEN LOWER(md.med_composition_name_2) % LOWER($1) THEN 80
                        WHEN LOWER(md.med_composition_name_3) % LOWER($1) THEN 80
                        WHEN LOWER(md.med_composition_name_4) % LOWER($1) THEN 80
                        WHEN LOWER(md.med_composition_name_5) % LOWER($1) THEN 80
                        ELSE 70
                    END as comp_match_score
                FROM med_details md
                WHERE md.is_active = 1 
                    AND md.is_deactivated = 0
                    AND (
                        LOWER(md.med_composition_name_1) % LOWER($1)
                        OR LOWER(md.med_composition_name_2) % LOWER($1)
                        OR LOWER(md.med_composition_name_3) % LOWER($1)
                        OR LOWER(md.med_composition_name_4) % LOWER($1)
                        OR LOWER(md.med_composition_name_5) % LOWER($1)
                    )
                ORDER BY comp_match_score DESC, comp_similarity DESC, md.med_weightage DESC NULLS LAST
                LIMIT $4
            `;

            params = [extracted.name || salt, extracted.strength, extracted.unit, maxResults];
        } else {
            // Search without strength matching
            query = `
                SELECT DISTINCT
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
                    md.med_weightage,
                    GREATEST(
                        similarity(LOWER(COALESCE(md.med_composition_name_1, '')), LOWER($1)),
                        similarity(LOWER(COALESCE(md.med_composition_name_2, '')), LOWER($1)),
                        similarity(LOWER(COALESCE(md.med_composition_name_3, '')), LOWER($1)),
                        similarity(LOWER(COALESCE(md.med_composition_name_4, '')), LOWER($1)),
                        similarity(LOWER(COALESCE(md.med_composition_name_5, '')), LOWER($1))
                    ) as comp_similarity
                FROM med_details md
                WHERE md.is_active = 1 
                    AND md.is_deactivated = 0
                    AND (
                        LOWER(md.med_composition_name_1) % LOWER($1)
                        OR LOWER(md.med_composition_name_2) % LOWER($1)
                        OR LOWER(md.med_composition_name_3) % LOWER($1)
                        OR LOWER(md.med_composition_name_4) % LOWER($1)
                        OR LOWER(md.med_composition_name_5) % LOWER($1)
                    )
                ORDER BY comp_similarity DESC, md.med_weightage DESC NULLS LAST
                LIMIT $2
            `;

            params = [extracted.name || salt, maxResults];
        }

        const result = await medicinePool.query(query, params);

        for (const row of result.rows) {
            compositionResults.push({
                medicine: formatMedicineResult(row),
                similarity: row.comp_similarity || 0.7,
                matchScore: row.comp_match_score || 80,
                searchTerm: salt
            });
        }
    } catch (error) {
        console.error(`Error in composition search for "${salt}":`, error.message);
    }

    return compositionResults;
}

/**
 * Main fuzzy search function with multiple strategies
 * @param {string} medicineName - Medicine name to search
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Search result
 */
async function fuzzySearchMedicine(medicineName, options = {}) {
    const {
        minSimilarity = 0.7,
        maxResults = 5,
        includeSalt = null,
        preferExactMatch = true
    } = options;

    const startTime = Date.now();

    // Input validation
    if (!medicineName || typeof medicineName !== 'string' || medicineName.trim().length < 2) {
        return {
            success: false,
            message: 'Medicine name must be at least 2 characters long',
            confidence: 0
        };
    }

    console.log(`🔍 Fuzzy searching for: "${medicineName}"`);
    if (includeSalt) {
        console.log(`   With composition: "${includeSalt}"`);
    }

    // Step 1: Generate variations
    const variations = generateMedicineNameVariations(medicineName);
    console.log(`   Generated ${variations.length} name variations`);

    // Step 2: Try exact match
    if (preferExactMatch) {
        console.log('   Trying exact match...');
        const exactMatch = await tryExactMatch(variations);

        if (exactMatch) {
            const executionTime = Date.now() - startTime;
            console.log(`✅ Found exact match in ${executionTime}ms`);
            return exactMatch;
        }
    }

    // Step 3: Try fuzzy LIKE search
    console.log('   Trying fuzzy LIKE search...');
    const fuzzyResults = await tryFuzzyLikeSearch(variations, maxResults);

    // Step 4: Try composition-based search (if provided and no results yet)
    if (includeSalt && fuzzyResults.length === 0) {
        console.log('   Trying composition-based search...');
        const compositionResults = await tryCompositionSearch(includeSalt, maxResults);
        fuzzyResults.push(...compositionResults);
    }

    // Step 5: Sort and return best match
    if (fuzzyResults.length > 0) {
        // Sort by: match score DESC, similarity DESC, weightage DESC
        fuzzyResults.sort((a, b) => {
            if (b.matchScore !== a.matchScore) {
                return b.matchScore - a.matchScore;
            }
            if (b.similarity !== a.similarity) {
                return b.similarity - a.similarity;
            }
            return (b.medicine.med_weightage || 0) - (a.medicine.med_weightage || 0);
        });

        const bestMatch = fuzzyResults[0];

        // Check if similarity meets threshold
        if (bestMatch.similarity >= minSimilarity) {
            const executionTime = Date.now() - startTime;
            console.log(`✅ Found fuzzy match in ${executionTime}ms (similarity: ${bestMatch.similarity.toFixed(2)})`);

            return {
                success: true,
                match: bestMatch.medicine,
                confidence: bestMatch.similarity,
                matchType: bestMatch.matchScore === 100 ? 'exact-composition' : 'fuzzy',
                searchTerm: bestMatch.searchTerm
            };
        }
    }

    // No match found
    const executionTime = Date.now() - startTime;
    console.log(`❌ No match found in ${executionTime}ms`);

    return {
        success: false,
        message: 'No matching medicine found',
        confidence: 0
    };
}

/**
 * Batch fuzzy search for multiple medicines
 * @param {Array} medicines - Array of {medicine_name, medicine_salt}
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Array of search results
 */
async function batchFuzzySearch(medicines, options = {}) {
    if (!Array.isArray(medicines) || medicines.length === 0) {
        return [];
    }

    console.log(`🔍 Starting batch fuzzy search for ${medicines.length} medicines...`);
    const startTime = Date.now();

    const results = [];

    for (let i = 0; i < medicines.length; i++) {
        const medicine = medicines[i];

        console.log(`\n[${i + 1}/${medicines.length}] Searching: ${medicine.medicine_name}`);

        const searchResult = await fuzzySearchMedicine(
            medicine.medicine_name,
            {
                ...options,
                includeSalt: medicine.medicine_salt
            }
        );

        results.push({
            original: medicine,
            searchResult: searchResult,
            index: i
        });
    }

    const executionTime = Date.now() - startTime;
    const successCount = results.filter(r => r.searchResult.success).length;

    console.log(`\n✅ Batch search completed in ${executionTime}ms`);
    console.log(`   Found matches: ${successCount}/${medicines.length}`);

    return results;
}

module.exports = {
    fuzzySearchMedicine,
    batchFuzzySearch,
    generateMedicineNameVariations,
    extractStrengthFromName,
    calculateSimilarity,
    formatMedicineResult,
    buildCompositionString,
    buildDoseString
};
