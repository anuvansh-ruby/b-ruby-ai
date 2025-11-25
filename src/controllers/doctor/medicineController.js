const { medicinePool } = require('../../config/multiDbConnection');

/**
 * Generate match count condition for scoring search results
 * Counts how many fields match the search term
 */
function generateMatchCountCondition(searchTerm) {
  const terms = searchTerm.toLowerCase().split(' ').filter(term => term.trim().length > 0);
  let allConditions = [];

  for (let term of terms) {
    let conditionParts = [];
    // Escape single quotes to prevent SQL injection
    const escapedTerm = term.replace(/'/g, "''");

    // Match against brand name (highest priority)
    conditionParts.push(`CASE WHEN LOWER(md.med_brand_name) LIKE '${escapedTerm}%' THEN 2 ELSE 0 END`);

    // Match against composition strengths and units
    for (let i = 1; i <= 5; i++) {
      conditionParts.push(`CASE WHEN md.med_composition_strength_${i} LIKE '%${escapedTerm}%' THEN 1 ELSE 0 END`);
      conditionParts.push(`CASE WHEN LOWER(md.med_composition_unit_${i}) LIKE '%${escapedTerm}%' THEN 1 ELSE 0 END`);
    }

    // Match against medicine type
    conditionParts.push(`CASE WHEN LOWER(md.med_type) LIKE '%${escapedTerm}%' THEN 1 ELSE 0 END`);

    // Match against drug/composition name
    conditionParts.push(`CASE WHEN LOWER(ud.drug_name) LIKE '%${escapedTerm}%' THEN 1 ELSE 0 END`);

    allConditions.push(conditionParts.join(' + '));
  }

  return allConditions.length > 0 ? allConditions.join(' + ') : '0';
}

/**
 * Generate WHERE clause for filtering search results
 * Returns records that match any of the search criteria
 */
function generateWhereClause(searchTerm) {
  const terms = searchTerm.toLowerCase().split(' ').filter(term => term.trim().length > 0);
  let whereParts = [];

  for (let term of terms) {
    // Escape single quotes to prevent SQL injection
    const escapedTerm = term.replace(/'/g, "''");

    whereParts.push(`LOWER(md.med_brand_name) LIKE '${escapedTerm}%'`);

    for (let i = 1; i <= 5; i++) {
      whereParts.push(`md.med_composition_strength_${i} LIKE '%${escapedTerm}%'`);
      whereParts.push(`LOWER(md.med_composition_unit_${i}) LIKE '%${escapedTerm}%'`);
    }

    whereParts.push(`LOWER(md.med_type) LIKE '%${escapedTerm}%'`);
    whereParts.push(`LOWER(ud.drug_name) LIKE '%${escapedTerm}%'`);
  }

  return whereParts.length > 0 ? whereParts.join(' OR ') : '1=0';
}

/**
 * Advanced medicine search with intelligent matching and scoring
 * Searches by medicine brand name, composition, strength, unit, and type
 */
const searchMedicines = async (req, res, next) => {
  try {
    const { query, limit = 10 } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long',
      });
    }

    const searchTerm = query.trim();
    const limitValue = Math.min(parseInt(limit) || 10, 50); // Max 50 results

    // Build advanced search query with match counting
    const searchSQL = `
      SELECT
        md.med_id as drug_id,
        md.med_brand_name as drug_name,
        CONCAT_WS(', ',
          CASE WHEN md.med_composition_name_1 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_1, ' ', COALESCE(md.med_composition_strength_1, ''), COALESCE(md.med_composition_unit_1, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_2 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_2, ' ', COALESCE(md.med_composition_strength_2, ''), COALESCE(md.med_composition_unit_2, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_3 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_3, ' ', COALESCE(md.med_composition_strength_3, ''), COALESCE(md.med_composition_unit_3, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_4 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_4, ' ', COALESCE(md.med_composition_strength_4, ''), COALESCE(md.med_composition_unit_4, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_5 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_5, ' ', COALESCE(md.med_composition_strength_5, ''), COALESCE(md.med_composition_unit_5, ''))
            ELSE NULL END
        ) as salt_name,
        md.med_manufacturer_name as manufacturer,
        md.med_type as drug_type,
        COALESCE(md.med_composition_strength_1, '') as strength,
        md.med_price as price,
        md.med_pack_size as pack_size,
        md.med_weightage,
        ud.drug_name as composition_drug_name,
        (
          ${generateMatchCountCondition(searchTerm)}
        ) AS match_count
      FROM
        med_details md
      LEFT JOIN unique_drugs ud 
        ON ud.id IN (
          md.med_composition_id_1, 
          md.med_composition_id_2, 
          md.med_composition_id_3, 
          md.med_composition_id_4, 
          md.med_composition_id_5
        )
      WHERE
        md.is_active = 1
        AND md.is_deactivated = 0
        AND (
          ${generateWhereClause(searchTerm)}
        )
      ORDER BY
        match_count DESC,
        md.med_weightage DESC NULLS LAST,
        md.med_brand_name
      LIMIT ${limitValue}
    `;

    console.log('🔍 Advanced Medicine Search Query:', {
      searchTerm,
      limit: limitValue,
      timestamp: new Date().toISOString()
    });

    const result = await medicinePool.query(searchSQL);

    console.log(`✅ Found ${result.rows.length} medicines matching "${searchTerm}"`);

    // Format results to remove internal scoring fields
    const formattedResults = result.rows.map(row => ({
      drug_id: row.drug_id,
      drug_name: row.drug_name,
      salt_name: row.salt_name,
      manufacturer: row.manufacturer,
      drug_type: row.drug_type,
      strength: row.strength,
      price: row.price,
      pack_size: row.pack_size,
      match_score: row.match_count // Include match score for debugging
    }));

    // Use res.locals for setResponse middleware
    const STATUS = require('../../utils/constants').STATUS;
    res.locals = {
      status: STATUS.SUCCESS,
      data: {
        medicines: formattedResults,
        count: result.rows.length,
        search_query: searchTerm
      }
    };

    next();
  } catch (error) {
    console.error('❌ Error searching medicines:', error);

    const STATUS = require('../../utils/constants').STATUS;
    res.locals = {
      status: STATUS.FAILURE,
      message: 'Failed to search medicines',
      error: error.message
    };

    next();
  }
};

/**
 * Get medicine details by ID
 */
const getMedicineById = async (req, res) => {
  try {
    const { medicineId } = req.params;

    const medicineSQL = `
      SELECT 
        md.med_id as drug_id,
        md.med_brand_name as drug_name,
        CONCAT_WS(', ',
          CASE WHEN md.med_composition_name_1 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_1, ' ', COALESCE(md.med_composition_strength_1, ''), COALESCE(md.med_composition_unit_1, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_2 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_2, ' ', COALESCE(md.med_composition_strength_2, ''), COALESCE(md.med_composition_unit_2, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_3 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_3, ' ', COALESCE(md.med_composition_strength_3, ''), COALESCE(md.med_composition_unit_3, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_4 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_4, ' ', COALESCE(md.med_composition_strength_4, ''), COALESCE(md.med_composition_unit_4, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_5 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_5, ' ', COALESCE(md.med_composition_strength_5, ''), COALESCE(md.med_composition_unit_5, ''))
            ELSE NULL END
        ) as salt_name,
        md.med_manufacturer_name as manufacturer,
        md.med_type as drug_type,
        COALESCE(md.med_composition_strength_1, '') as strength,
        md.med_price as price,
        md.med_pack_size as pack_size,
        md.med_weightage,
        md.med_composition_name_1,
        md.med_composition_strength_1,
        md.med_composition_unit_1,
        md.med_composition_name_2,
        md.med_composition_strength_2,
        md.med_composition_unit_2,
        md.med_composition_name_3,
        md.med_composition_strength_3,
        md.med_composition_unit_3,
        md.med_composition_name_4,
        md.med_composition_strength_4,
        md.med_composition_unit_4,
        md.med_composition_name_5,
        md.med_composition_strength_5,
        md.med_composition_unit_5
      FROM med_details md
      WHERE md.med_id = $1
        AND md.is_active = 1
        AND md.is_deactivated = 0
    `;

    const result = await medicinePool.query(medicineSQL, [medicineId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Medicine details retrieved successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error getting medicine details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get medicine details',
      error: error.message,
    });
  }
};

/**
 * Get popular/frequently prescribed medicines
 */
const getPopularMedicines = async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const limitValue = Math.min(parseInt(limit) || 20, 50);

    // Get most commonly prescribed medicines based on weightage
    const popularSQL = `
      SELECT 
        md.med_id as drug_id,
        md.med_brand_name as drug_name,
        CONCAT_WS(', ',
          CASE WHEN md.med_composition_name_1 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_1, ' ', COALESCE(md.med_composition_strength_1, ''), COALESCE(md.med_composition_unit_1, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_2 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_2, ' ', COALESCE(md.med_composition_strength_2, ''), COALESCE(md.med_composition_unit_2, ''))
            ELSE NULL END,
          CASE WHEN md.med_composition_name_3 IS NOT NULL 
            THEN CONCAT(md.med_composition_name_3, ' ', COALESCE(md.med_composition_strength_3, ''), COALESCE(md.med_composition_unit_3, ''))
            ELSE NULL END
        ) as salt_name,
        md.med_manufacturer_name as manufacturer,
        md.med_type as drug_type,
        md.med_price as price,
        md.med_pack_size as pack_size,
        md.med_weightage as popularity_score
      FROM med_details md
      WHERE md.is_active = 1
        AND md.is_deactivated = 0
      ORDER BY md.med_weightage DESC NULLS LAST, md.med_brand_name
      LIMIT $1
    `;

    const result = await medicinePool.query(popularSQL, [limitValue]);

    return res.status(200).json({
      success: true,
      message: 'Popular medicines retrieved successfully',
      data: {
        medicines: result.rows,
        count: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Error getting popular medicines:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get popular medicines',
      error: error.message,
    });
  }
};

/**
 * Add medicine to patient prescription
 */
const addMedicineToPatient = async (req, res) => {
  try {
    const { mainPool } = require('../../config/multiDbConnection');
    const { prescriptionId, medicineName, medicineSalt, medicineFrequency } = req.body;
    const createdBy = req.user?.userId || req.user?.drId; // From JWT token

    if (!prescriptionId || !medicineName) {
      return res.status(400).json({
        success: false,
        message: 'Prescription ID and medicine name are required',
      });
    }

    // Verify prescription exists
    const prescriptionCheck = await mainPool.query(
      'SELECT prescription_id FROM patient_prescription WHERE prescription_id = $1 AND is_active = 1',
      [prescriptionId]
    );

    if (prescriptionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found',
      });
    }

    // Insert medicine
    const insertSQL = `
      INSERT INTO patient_medicine 
        (prescription_id, medicine_name, medicine_salt, medicine_frequency, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const result = await mainPool.query(insertSQL, [
      prescriptionId,
      medicineName,
      medicineSalt || null,
      medicineFrequency || null,
      createdBy,
    ]);

    return res.status(201).json({
      success: true,
      message: 'Medicine added to prescription successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error adding medicine to prescription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add medicine to prescription',
      error: error.message,
    });
  }
};

/**
 * Get medicines for a prescription
 */
const getPrescriptionMedicines = async (req, res) => {
  try {
    const { mainPool } = require('../../config/multiDbConnection');
    const { prescriptionId } = req.params;

    const medicinesSQL = `
      SELECT 
        medicin_id,
        medicine_name,
        medicine_salt,
        medicine_frequency,
        created_at,
        updated_at
      FROM patient_medicine
      WHERE prescription_id = $1 AND is_active = 1
      ORDER BY created_at DESC
    `;

    const result = await mainPool.query(medicinesSQL, [prescriptionId]);

    return res.status(200).json({
      success: true,
      message: 'Prescription medicines retrieved successfully',
      data: {
        medicines: result.rows,
        count: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Error getting prescription medicines:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get prescription medicines',
      error: error.message,
    });
  }
};

/**
 * Delete medicine from prescription
 */
const deleteMedicine = async (req, res) => {
  try {
    const { mainPool } = require('../../config/multiDbConnection');
    const { medicineId } = req.params;
    const updatedBy = req.user?.userId || req.user?.drId;

    const deleteSQL = `
      UPDATE patient_medicine 
      SET is_active = 0, updated_by = $1, updated_at = CURRENT_TIMESTAMP
      WHERE medicin_id = $2
      RETURNING *
    `;

    const result = await mainPool.query(deleteSQL, [updatedBy, medicineId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Medicine removed successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error deleting medicine:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete medicine',
      error: error.message,
    });
  }
};

module.exports = {
  searchMedicines,
  getMedicineById,
  getPopularMedicines,
  addMedicineToPatient,
  getPrescriptionMedicines,
  deleteMedicine,
};
