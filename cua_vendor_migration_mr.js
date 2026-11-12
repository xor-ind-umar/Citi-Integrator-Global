/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */

define(['N/record', 'N/search', 'N/log', 'N/file', 'N/format'], function (
    record,
    search,
    log,
    file,
    format
) {

    // ============================================================
    // TEST MODE
    // ============================================================

    var TEST_MODE = false;
    var VERBOSE_SETVALUE_LOGGING = true;

    // ============================================================
    // ERROR REPORT CONFIG
    // ============================================================

    var REPORT_FOLDER_NAME = 'Citi Integrator Migration Error Report';
    var REPORT_FILE_PREFIX = 'Vendor_Migration_Error_Report_';

    // ============================================================
    // MIGRATION STATUS FIELD
    // ============================================================

    var MIGRATION_CHECKBOX_FIELD = 'custentity_xor_pay_ci_vendor_mgrt_sts';

    // ============================================================
    // CHEQUE NUMBER DEFAULT (US585)
    //
    // ADDED :
    // The "Cheque Number" field (custrecord_ci_adv_cheque_number) is
    // mandatory in the new CI solution for US585 but is NOT present in
    // the source CUA data.
    // value for this field instead of mapping it from CUA.
    //
    // The value must be a short string that fits within the field's
    // 10-character limit. "city migration" (14 chars) exceeds that limit,
    // so we use "CityMig" (7 chars). Change ONLY this constant if a
    // different default string is required by the business.
    // ============================================================

    //Change 1 Cheque Number constants 
    var CHEQUE_NUMBER_FIELD = 'custrecord_ci_adv_cheque_number';
    var CHEQUE_NUMBER_DEFAULT_VALUE = 'CityMig'; // <= 10 chars

    // ============================================================
    // MANDATORY FIELDS ON CI RECORD (must be present before save)
    //
    // CHANGED: Bank Branch Number is no longer mandatory. Per the
    // business rule, the ONLY blocking fields are payment-profile /
    // routing / parent-vendor related. This object is intentionally
    // left empty so genuinely mandatory fields can be re-added later
    // without restructuring the validation loop.
    // ============================================================

    var MANDATORY_CIA_FIELDS = {
        // (none) - all previously-mandatory bank fields are now optional
    };

    // ============================================================
    // CRITICAL FIELDS
    //
    // These are the ONLY fields that block a vendor migration.
    // If any of these cannot be set (setValue throws) or cause a
    // save() failure, the vendor migration HARD-FAILS and is skipped.
    //
    // Everything NOT in this set is treated as OPTIONAL: if it fails to
    // set or causes a save() failure, it is dropped (cleared), a warning
    // is logged, and the save is retried so the vendor still migrates.
    //
    // Business-critical (blocking) fields:
    //   - Parent Vendor link
    //   - Payment Profile
    //   - Payment Profile Code
    //   - Routing Identifier
    // Active Payment Profile and Routing Identifier validation
    // are enforced earlier in the migration flow.
    // ============================================================

    var CRITICAL_FIELDS = {
        'custrecordci_adv_details': true,             // link to vendor (Parent Vendor)
        'custrecord_ci_adv_profile_name': true,       // Payment Profile
        'custrecord_ci_adv_vendor_cuappf_code': true, // Payment Profile Code
        'custrecord_ci_adv_routing_id_vb': true       // Routing Identifier
    };

    function isCriticalField(fieldId) {
        return CRITICAL_FIELDS.hasOwnProperty(fieldId) && CRITICAL_FIELDS[fieldId] === true;
    }

    // Max number of times we will retry save() while dropping offending
    // optional fields. Prevents an infinite loop if parsing the error
    // field name ever fails to converge.
    var MAX_SAVE_RETRIES = 12;

    // ============================================================
    // USER EVENT VALIDATION ERROR DETECTION
    //
    // The "CI Vendor Validations" User Event performs profile-specific
    // validations in beforeSubmit and throws a VALIDATION_ERROR when a
    // value does not satisfy the Payment Profile rules. Those errors are
    // NOT NetSuite field-value errors - they should be surfaced to
    // business users as a clear "Skipped + reason + recommended action"
    // row in the report rather than as a generic system exception.
    //
    // We recognize them by the standard custom error name and/or by the
    // characteristic message pattern thrown by the User Event.
    // ============================================================

    var USER_EVENT_VALIDATION_ERROR_NAMES = {
        'VALIDATION_ERROR': true,
        'CIA_VALIDATION_ERROR': true,
        'CIA_VENDOR_VALIDATION_ERROR': true
    };

    // Message fragments that indicate a User Event business-validation
    // failure (as opposed to a core NetSuite field-value error).
    var USER_EVENT_VALIDATION_MESSAGE_PATTERN =
        /please enter value for the field|please enter value|validation rule|does not satisfy|is required for the (selected )?profile|required for the payment profile|invalid for the (selected )?profile|profile validation/i;

    function isUserEventValidationError(err) {
        if (!err) return false;

        var name = '';
        var message = '';
        try {
            name = (err.name || '') + '';
            message = (err.message || '') + '';
        } catch (ignore) { /* no-op */ }

        if (USER_EVENT_VALIDATION_ERROR_NAMES.hasOwnProperty(String(name).toUpperCase())) {
            return true;
        }

        // SuiteScript user errors raised with error.create often surface a
        // VALIDATION_ERROR-style name; also match the characteristic message.
        if (USER_EVENT_VALIDATION_MESSAGE_PATTERN.test(message)) {
            return true;
        }

        return false;
    }

    // ============================================================
    // USER-FRIENDLY FIELD LABELS
    // ============================================================

    var FIELD_LABELS = {
        'custrecord_ci_adv_payment_detail_1': 'Payment Detail 1',
        'custrecord_ci_adv_payment_detail_2': 'Payment Detail 2',
        'custrecord_ci_adv_payment_detail_3': 'Payment Detail 3',
        'custrecord_ci_adv_payment_detail_4': 'Payment Detail 4',
        'custrecord_ci_adv_account_number': 'Bank Account Number',
        'custrecord_ci_adv_bank_acct_name': 'Bank Account Name',
        'custrecord_ci_adv_branch_number': 'Bank Branch Number',
        'custrecord_ci_adv_bank_bic': 'Bank BIC / Member ID',
        'custrecord_ci_adv_bank_addr1': 'Bank Address Line 1',
        'custrecord_ci_adv_bank_addr2': 'Bank Address Line 2',
        'custrecord_ci_adv_bank_name': 'Bank Name',
        'custrecord_ci_adv_bank_code': 'Bank Code',    // Purushottam added this line on 5th October 2026
        'custrecord_ci_adv_vbd_bank_country': 'Bank Country', // Purushottam added this line on 5th October 2026
        'custrecord_ci_adv_spl_handl_code': 'Special Handling Code',
        'custrecord_ci_adv_form_code1': 'Form Code',
        'custrecord_ci_adv_return_addr_logo1': 'Return Address Logo',
        'custrecord_ci_adv_template_name1': 'Template Name',
        'custrecord_ci_adv_k_symbol': 'K Symbol',
        'custrecord_ci_adv_vo_motive_code': 'VO Motive Code',
        'custrecord_ci_adv_vendor_fps': 'Vendor FPS',
        'custrecord_ci_adv_vendor_dob': 'Vendor Date of Birth',
        'custrecord_ci_adv_duns_eangln': 'DUNS / EAN GLN',
        'custrecord_ci_adv_delivery_post_urid': 'Delivery Post URID',
        'custrecord_ci_adv_vendor_res_status': 'Vendor Residency Status',
        'custrecord_ci_adv_vendor_citi_sts': 'Vendor Citi Status',
        'custrecord_ci_adv_vendor_dob_country': 'DOB Country',
        'custrecord_ci_adv_vendor_dob_city': 'DOB City',
        'custrecord_ci_adv_vbd_bank_iban': 'Bank IBAN',
        'custrecord_ci_adv_vendor_passport_no': 'Vendor Passport No.',
        'custrecord_ci_adv_beneficiary_typ': 'Beneficiary Type',
        'custrecord_ci_bank_acct_type': 'Bank Account Type',
        'custrecord_ci_adv_delivery_methd': 'Delivery Method',
        'custrecord_ci_adv_profile_name': 'Payment Profile',
        'custrecord_ci_adv_routing_id_vb': 'Bank Routing Identifier',
        'custrecord_ci_adv_vendor_cuappf_code': 'Payment Profile Code',
        //Change 2 Field label entry
        // ADDED: label for the Cheque Number field (US585 default value).
        'custrecord_ci_adv_cheque_number': 'Cheque Number',
        'custrecord_ci_adv_scheme_name': 'Scheme Name' //Umar added thi line on 13th August 2026
    };

    // ============================================================
    // FIELD MAPPING
    // ============================================================

    var FIELD_MAPPING = {
        'custentity_xor_pay_payment_detail_1': 'custrecord_ci_adv_payment_detail_1',
        'custentity_xor_pay_payment_detail_2': 'custrecord_ci_adv_payment_detail_2',
        'custentity_xor_pay_payment_detail_3': 'custrecord_ci_adv_payment_detail_3',
        'custentity_xor_pay_payment_detail_4': 'custrecord_ci_adv_payment_detail_4',
        'custentity_xor_pay_bank_acct_no_sdf': 'custrecord_ci_adv_account_number',
        'custentity_xor_pay_bank_acc_name_sdf': 'custrecord_ci_adv_bank_acct_name',
        'custentity_xor_pay_bank_branch_no_sdf': 'custrecord_ci_adv_branch_number',
        'custentity_xor_pay_mem_id_sdf': 'custrecord_ci_adv_bank_bic',
        'custentity_xor_pay_vendor_bank_addr1_sdf': 'custrecord_ci_adv_bank_addr1',
        'custentity_xor_pay_bank_address_2_sdf': 'custrecord_ci_adv_bank_addr2',
        'custentity_xor_pay_bank_name_sdf': 'custrecord_ci_adv_bank_name',
        'custentity_xor_pay_bank_id_code_sdf': 'custrecord_ci_adv_bank_code', // Purushottam added this line on 5th October 2026
        'custentity_xor_pay_bank_country_sdf': 'custrecord_ci_adv_vbd_bank_country', // Purushottam added this line on 5th October 2026
        'custentity_xor_pay_spl_hd_cd_sdf': 'custrecord_ci_adv_spl_handl_code',
        'custentity_xor_pay_form_code_sdf': 'custrecord_ci_adv_form_code1',
        'custentity_xor_pay_address_logo_sdf': 'custrecord_ci_adv_return_addr_logo1',
        'custentity_xor_pay_vendor_temp_name_sdf': 'custrecord_ci_adv_template_name1',
        'custentity_xor_pay_vendor_ksymbol_sdf': 'custrecord_ci_adv_k_symbol',
        'custentity_xor_pay_vendor_vo_code_sdf': 'custrecord_ci_adv_vo_motive_code',
        'custentity_xor_pay_vendor_fps_sdf': 'custrecord_ci_adv_vendor_fps',
        'custentity_xor_pay_vendor_dob_sdf': 'custrecord_ci_adv_vendor_dob',
        'custentity_xor_pay_vend_duns_sdf': 'custrecord_ci_adv_duns_eangln',
        'custentity_xor_pay_vend_post_urid_sdf': 'custrecord_ci_adv_delivery_post_urid',
        'custentity_xor_pay_vendor_res_status_sdf': 'custrecord_ci_adv_vendor_res_status',
        'custentity_xor_pay_vend_citi_sts_sdf': 'custrecord_ci_adv_vendor_citi_sts',
        'custentity_xor_pay_cua_dob_country': 'custrecord_ci_adv_vendor_dob_country',
        'custentity_xor_pay_cua_dob_city': 'custrecord_ci_adv_vendor_dob_city',
        'custentity_xor_pay_vendor_iban_sdf': 'custrecord_ci_adv_vbd_bank_iban',
        'custentity_xor_pay_vend_passport_no_sdf': 'custrecord_ci_adv_vendor_passport_no',
        'custentity_xor_pay_vend_benf_ty_sdf': 'custrecord_ci_adv_beneficiary_typ',
        'custentity_xor_pay_bank_acct_type_sdf': 'custrecord_ci_bank_acct_type', //Umar added this line on 13th August 2026.
        'custentity_xor_pay_delivery_method_sdf': 'custrecord_ci_adv_delivery_methd', //Umar added this line on 13th August 2026
        'custentity_xor_pay_vend_schm_name_sdf': 'custrecord_ci_adv_scheme_name', //Umar added this line on 13th August 2026
    };

    // Fields that must be re-asserted immediately before save (scalar/critical).
    //
    // CHANGED: only re-assert the routing identifier (the lone scalar/list
    // critical value that is recomputed late in the flow). The bank
    // scalar fields are now optional, so re-asserting them is unnecessary
    // (and undesirable - we don't want them resurrecting after being
    // dropped on a save retry).
    var CRITICAL_REASSERT_FIELDS = [
        'custrecord_ci_adv_routing_id_vb'
    ];

    // ============================================================
    // REFERENCE FIELDS
    // ============================================================

    var REFERENCE_FIELDS = {
        'custentity_xor_pay_bank_acct_type_sdf': {
            targetField: 'custrecord_ci_bank_acct_type',
            sourceRecordType: 'customrecord_xor_pay_dbt_acc_ty_lt_sdf',
            targetRecordType: 'customrecord_ci_adv_bk_acc_ty_lt',
            targetMatchField: 'custrecord_ci_adv_bk_acc_type_code',
            friendlyLabel: 'Bank Account Type'
        },
        'custentity_xor_pay_delivery_method_sdf': {
            targetField: 'custrecord_ci_adv_delivery_methd',
            sourceRecordType: 'customrecord_xor_pay_delvry_mtd_lt_sdf',
            targetRecordType: 'customrecord_ci_adv_delivery_method_lst',
            targetMatchField: 'name',
            friendlyLabel: 'Delivery Method'
        },
        'custentity_xor_pay_vendor_pmt_mtd_sdf': {
            targetField: 'custrecord_ci_adv_profile_name',
            sourceRecordType: 'customrecord_xor_pay_pros_prfle_sdf',
            targetRecordType: 'customrecord_ci_adv_pros_profile',
            friendlyLabel: 'Payment Profile'
        },
        'custentity_xor_pay_vend_schm_name_sdf': { //Umar added this on 13th August 2026
            targetField: 'custrecord_ci_adv_scheme_name',
            sourceRecordType: 'customrecord_xor_pay_schm_name_lt_sdf',
            targetRecordType: 'customrecord_ci_adv_schema_name_lst',
            targetMatchField: 'custrecord_ci_adv_schema_code',
            friendlyLabel: 'Scheme Name'
        }
    };

    // Reference target fields that are CRITICAL. If a reference field maps
    // to a target field NOT in this list (e.g. Delivery Method, Bank
    // Account Type), a mapping failure is treated as OPTIONAL: skip the
    // field with a warning instead of skipping the whole vendor.
    //
    // CHANGED: Bank Account Type removed -> now optional. Only Payment
    // Profile remains a blocking reference field.
    var CRITICAL_REFERENCE_TARGET_FIELDS = {
        'custrecord_ci_adv_profile_name': true
    };

    // ============================================================
    // ROUTING IDENTIFIER LIST (customlist_routing_identifier_list)
    // ============================================================

    var ROUTING_IDENTIFIER_MAP = {
        'bank branch number': 1,
        'branch number': 1,
        'swift / bic': 2,
        'swift/bic': 2,
        'swift bic': 2,
        'bic': 2,
        'swift': 2
    };

    function normalizeRoutingKey(text) {
        if (text === null || text === undefined) return '';
        return String(text).trim().toLowerCase().replace(/\s+/g, ' ');
    }

    // ============================================================
    // HELPER - PUSH ERROR INTO PER-VENDOR LIST
    // ============================================================

    function addError(errors, category, message) {
        errors.push({ category: category, message: message });
    }

    // ============================================================
    // HELPER - RESOLVE VENDOR NAME
    // ============================================================

    function resolveVendorName(vendorData, vendorId) {
        var candidateKeys = ['companyname', 'entityid', 'altname', 'name'];

        for (var i = 0; i < candidateKeys.length; i++) {
            var v = vendorData[candidateKeys[i]];
            if (v !== null && v !== undefined && v !== '') {
                if (typeof v === 'object' && v.text) return v.text;
                if (typeof v === 'string') return v;
            }
        }

        try {
            if (vendorId) {
                var lookup = search.lookupFields({
                    type: search.Type.VENDOR,
                    id: vendorId,
                    columns: ['entityid', 'companyname', 'altname']
                });
                return lookup.companyname || lookup.entityid || lookup.altname || '';
            }
        } catch (lookupErr) {
            log.error({
                title: 'Vendor name lookup failed',
                details: { vendorId: vendorId, err: lookupErr.message }
            });
        }

        return '';
    }

    // ============================================================
    // DYNAMIC PROFILE CODE MAPPING
    // ============================================================

    var SEPA_PROFILE_NUMBERS = ['795', '848', '938', '939'];

    var AUTO_ACTIVATE_PROFILES = {
        'CITI_GB_393_ONS_C12_01': true,
        'CITI_US_500_ONS_C12_01': true,
        'CITI_US_2PH_ONS_C12_01': true,
        'CITI_US_5_ONS_C12_01': true,
        'CITI_US_4PH_ONS_C12_01': true,
        'CITI_NO_599_ONS_C12_01': true
    };

    function shouldAutoActivateProfile(profileCode) {
        return AUTO_ACTIVATE_PROFILES.hasOwnProperty(profileCode);
    }

    function mapProfileCode(oldCode) {
        if (!oldCode) return '';
        if (oldCode.indexOf('CITIUA_') !== 0) return oldCode;

        var parts = oldCode.split('_');
        if (parts.length < 3) return oldCode.replace('CITIUA_', 'CITI_');

        var country = parts[1];
        var profileNum = parts[2];
        var cleanProfileNum = profileNum.replace('-STD', '');

        var isSEPA = false;
        for (var i = 0; i < SEPA_PROFILE_NUMBERS.length; i++) {
            if (cleanProfileNum === SEPA_PROFILE_NUMBERS[i]) { isSEPA = true; break; }
        }

        var newParts = ['CITI'];
        if (isSEPA) { newParts.push('SEPA'); } else { newParts.push(country); }
        newParts.push(cleanProfileNum);
        for (var j = 3; j < parts.length; j++) newParts.push(parts[j]);

        return newParts.join('_');
    }

    // ============================================================
    // ACCOUNT TYPE MAPPING
    // ============================================================

    var ACCOUNT_TYPE_MAPPING = {
        'Checking': 'CACC', 'Current a/c': 'CACC', 'Current': 'CACC', 'CACC': 'CACC',
        'Savings': 'SVGS', 'Saving': 'SVGS', 'Savings a/c': 'SVGS', 'Salary': 'SVGS',
        'Non Resident': 'SVGS', 'Resident': 'SVGS'
    };

    // ============================================================
    // DELIVERY METHOD MAPPING
    // ============================================================

    var DELIVERY_METHOD_MAPPING = {
        'EMAIL': 'Email', 'Email': 'Email', 'EMAL': 'Email',
        'FAX': 'Fax', 'Fax': 'Fax', 'FAXI': 'Fax',
        'POST': 'POST',
        'Mobile': 'Mobile',
        'FPS': 'FPS',
        'CRCD': 'CRCD',
        'CRDB': 'CRDB',
        'Organization Identifier': 'Organization Identifier',
        'Oraganization Number': 'Oraganization Number',
        'Australian Business Number': 'Australian Business Number',
        'IND Legal Entity Identifier Reg.': 'IND Legal Entity Identifier Reg.'
    };
    // ============================================================
    // SCHEME NAME  MAPPING - Umar added this on 13th August 2026.
    // ============================================================

    var SHCEME_NAME_MAPPING = {
        'AlienRegistrationNumber': 'ARNU', 'Bank Party Identification': 'BANK', 'BLEI': 'BLEI',
        'Customer Identification Number': 'CUST', 'Data Universal Numbering System': 'DUNS', 'Drivers License Number': 'DRLC',
        'Employee Identification Number': 'EMPL',
        'Id Card Number': 'NIDN',
        'Tax Identification Number': 'TXID',
    };

    // ============================================================
    // HELPERS - EXTRACT LOOKUP TEXT/VALUE
    // ============================================================

    function extractLookupText(fieldVal) {
        if (!fieldVal) return '';
        if (typeof fieldVal === 'string') return fieldVal;
        if (Array.isArray(fieldVal) && fieldVal.length > 0) {
            return fieldVal[0].text || String(fieldVal[0].value || '');
        }
        if (typeof fieldVal === 'object' && fieldVal.text !== undefined) {
            return fieldVal.text || '';
        }
        return String(fieldVal);
    }

    function extractLookupValue(fieldVal) {
        if (!fieldVal) return '';
        if (typeof fieldVal === 'string') return fieldVal;
        if (Array.isArray(fieldVal) && fieldVal.length > 0) {
            return String(fieldVal[0].value || fieldVal[0].text || '');
        }
        if (typeof fieldVal === 'object' && fieldVal.value !== undefined) {
            return String(fieldVal.value);
        }
        return String(fieldVal);
    }

    // ============================================================
    // HELPER - RESOLVE ROUTING IDENTIFIER TEXT -> LIST INTERNAL ID
    // ============================================================

    function resolveRoutingInternalId(routingText) {
        if (routingText === null || routingText === undefined || routingText === '') {
            return null;
        }

        if (/^\d+$/.test(String(routingText).trim())) {
            return Number(String(routingText).trim());
        }

        var key = normalizeRoutingKey(routingText);
        if (ROUTING_IDENTIFIER_MAP.hasOwnProperty(key)) {
            return ROUTING_IDENTIFIER_MAP[key];
        }

        log.error({
            title: 'Routing identifier not in map',
            details: { routingText: routingText, normalizedKey: key }
        });

        return null;
    }

    // ============================================================
    // HELPER - EXTRACT OFFENDING FIELD ID FROM A SAVE ERROR
    //
    // NetSuite INVALID_FLD_VALUE / mandatory errors usually embed the
    // failing field's internal id in the message. We scan the message
    // (and the record's mapped fields) to find which field caused it.
    // ============================================================

    function extractOffendingFieldId(err, candidateFieldIds) {
        var haystack = '';
        try {
            haystack += (err && err.message) ? err.message : '';
            haystack += ' ';
            haystack += (err && err.toString) ? err.toString() : '';
        } catch (ignore) { /* no-op */ }

        var lower = haystack.toLowerCase();

        // Direct scan: does the error text mention any of our field ids?
        // field - causing the WRONG field to be cleared on save retry
        // (e.g. clearing Vendor Date of Birth when the real problem was
        // DOB Country). Checking longest-first guarantees the most
        // specific/correct field id matches first.
        // ============================================================
        var sortedCandidates = candidateFieldIds.slice().sort(function (a, b) {
            return String(b).length - String(a).length;
        });

        for (var i = 0; i < sortedCandidates.length; i++) {
            var fid = sortedCandidates[i];
            if (fid && lower.indexOf(String(fid).toLowerCase()) !== -1) {
                return fid;
            }
        }

        // Fallback: try to pull a custom field id token from the message.
        var match = haystack.match(/cust[a-z0-9_]+/i);
        if (match && match[0]) {
            var token = match[0].toLowerCase();
            for (var j = 0; j < candidateFieldIds.length; j++) {
                if (String(candidateFieldIds[j]).toLowerCase() === token) {
                    return candidateFieldIds[j];
                }
            }
        }

        return null;
    }

    // ============================================================
    // HELPER - PARSE A USER EVENT VALIDATION MESSAGE INTO A
    // BUSINESS-FRIENDLY { fieldLabel, reason, recommendedAction }
    //
    // The User Event typically throws messages like:
    //   "Bank Name - Please enter value for the field"
    //   "Bank BIC - Please enter value for the field"
    //
    // We try to extract the human field label (left of the dash), map it
    // back to a known label where possible, and build a clear reason +
    // recommended action. If we cannot parse a specific field, we fall
    // back to a generic-but-still-friendly explanation that preserves the
    // raw validation text.
    // ============================================================

    function buildValidationFriendlyMessage(err, profileCode, mappedData) {
        var rawMessage = '';
        try {
            rawMessage = ((err && err.message) ? err.message : '').toString().trim();
        } catch (ignore) {
            rawMessage = '';
        }

        if (!rawMessage) {
            rawMessage = 'A Payment Profile validation rule was not satisfied.';
        }

        var fieldLabel = '';

        // Pattern 1: "<Field Label> - <message>"
        var dashSplit = rawMessage.split(/\s+-\s+/);
        if (dashSplit.length >= 2 && dashSplit[0]) {
            var candidate = dashSplit[0].trim();
            // A field label is normally short and not a sentence.
            if (candidate.length > 0 && candidate.length <= 60 &&
                !/please|error|invalid|value for the field/i.test(candidate)) {
                fieldLabel = candidate;
            }
        }

        // Pattern 2: a recognised label literally appears in the message.
        if (!fieldLabel) {
            for (var fid in FIELD_LABELS) {
                if (!FIELD_LABELS.hasOwnProperty(fid)) continue;
                var lbl = FIELD_LABELS[fid];
                if (lbl && rawMessage.toLowerCase().indexOf(lbl.toLowerCase()) !== -1) {
                    fieldLabel = lbl;
                    break;
                }
            }
        }

        var reason;
        var recommendedAction;

        if (fieldLabel) {
            reason = 'Validation message: "' + rawMessage + '".';

            recommendedAction = 'Review and correct the vendor\'s ' + fieldLabel +
                ' according to the Payment Profile requirements, then rerun the ' +
                'migration for this vendor.';
        } else {
            reason = 'One or more field values do not satisfy the Payment Profile ' +
                'validation rules' +
                (profileCode ? ' for profile ' + profileCode : '') + '. ' +
                'Original validation message: "' + rawMessage + '".';

            recommendedAction = 'Review the vendor\'s payment/bank details against ' +
                'the selected Payment Profile validation rules, correct the ' +
                'flagged value(s), then rerun the migration for this vendor.';
        }

        return {
            fieldLabel: fieldLabel,
            reason: reason,
            recommendedAction: recommendedAction,
            rawMessage: rawMessage
        };
    }

    // ============================================================
    // GET INPUT DATA
    // ============================================================

    function getInputData() {
        try {
            log.audit({
                title: 'Vendor Migration Started',
                details: TEST_MODE ? 'TEST MODE' : 'LIVE MIGRATION MODE'
            });

            var vendorSearch = search.load({ id: 'customsearch_cua_vendor_bank_details' });

            var existingExpr = vendorSearch.filterExpression;

            var migrationClause = [
                [MIGRATION_CHECKBOX_FIELD, 'is', 'F'],
                'OR',
                [MIGRATION_CHECKBOX_FIELD, 'isempty', '']
            ];

            var newExpr;
            if (Array.isArray(existingExpr) && existingExpr.length > 0) {
                newExpr = [existingExpr, 'AND', migrationClause];
            } else {
                newExpr = migrationClause;
            }

            vendorSearch.filterExpression = newExpr;

            log.audit({
                title: 'Saved Search Loaded',
                details: 'customsearch_cua_vendor_bank_details — running with migration-status filter'
            });

            return vendorSearch;

        } catch (e) {
            log.error({ title: 'getInputData Error', details: JSON.stringify(e) });
            throw e;
        }
    }

    // ============================================================
    // MAP
    // ============================================================

    function map(context) {

        var vendorData;
        var vendorErrors = [];
        var vendorWarnings = [];   // non-fatal optional-field issues
        var vendorName = '';
        var ciaRecordId = null;
        var vendorIdForCatch = '';
        var profileCodeForCatch = '';   // Payment Profile Code for reporting
        var paymentProfileMappingFailed = false;

        try {

            var result = JSON.parse(context.value);

            vendorData = { id: result.id };

            if (result.values) {
                Object.keys(result.values).forEach(function (colName) {
                    var val = result.values[colName];
                    if (Array.isArray(val) && val.length > 0 && val[0].value !== undefined) {
                        vendorData[colName] = val[0].value;
                    } else if (val && typeof val === 'object' && val.value !== undefined) {
                        vendorData[colName] = val.value;
                    } else {
                        vendorData[colName] = val;
                    }
                });
            }

            var vendorId = vendorData.id;
            vendorIdForCatch = vendorId;
            vendorName = resolveVendorName(vendorData, vendorId);
            log.audit({
                title: 'START Processing Vendor',
                details: {
                    vendorId: vendorId,
                    vendorName: vendorName
                }
            });

            var mappedData = {};
            //var profileConfig = null;

            // ====================================================
            // LINK CI RECORD TO VENDOR
            // ====================================================

            mappedData['custrecordci_adv_details'] = vendorId;
            mappedData['custrecord_ci_adv_primary_account'] = true;
            mappedData['custrecord_ci_created_via_cua_mig'] = true;

            // ====================================================
            // NORMAL FIELD MAPPING
            // ====================================================

            Object.keys(FIELD_MAPPING).forEach(function (oldFieldId) {
                var newFieldId = FIELD_MAPPING[oldFieldId];
                mappedData[newFieldId] = vendorData[oldFieldId];
            });

            // ====================================================
            // CHEQUE NUMBER DEFAULT VALUE (US585)
            // Change 3 Setting the default value in map()
            // ADDED : The Cheque Number field is
            // mandatory in the new CI solution for US585 but not present
            // in CUA. We set a hardcoded DEFAULT value here (NOT mapped
            // from CUA). Kept within the 10-character limit.
            // ====================================================

            mappedData[CHEQUE_NUMBER_FIELD] = CHEQUE_NUMBER_DEFAULT_VALUE;

            log.audit({
                title: 'Cheque Number - Default Applied (US585)',
                details: {
                    vendorId: vendorId,
                    fieldId: CHEQUE_NUMBER_FIELD,
                    defaultValue: CHEQUE_NUMBER_DEFAULT_VALUE,
                    length: String(CHEQUE_NUMBER_DEFAULT_VALUE).length
                }
            });

            log.audit({
                title: 'Branch Number - After Mapping',
                details: {
                    vendorId: vendorId,
                    sourceValue: vendorData['custentity_xor_pay_bank_branch_no_sdf'],
                    sourceValueType: typeof vendorData['custentity_xor_pay_bank_branch_no_sdf'],
                    mappedValue: mappedData['custrecord_ci_adv_branch_number']
                }
            });

            // ====================================================
            // REFERENCE FIELD MAPPING
            // ====================================================

            var skipDueToInactiveProfile = false;

            Object.keys(REFERENCE_FIELDS).forEach(function (oldFieldId) {

                var referenceConfig = REFERENCE_FIELDS[oldFieldId];
                var oldValue = vendorData[oldFieldId];
                var friendlyLabel = referenceConfig.friendlyLabel;
                var targetIsCritical = CRITICAL_REFERENCE_TARGET_FIELDS.hasOwnProperty(referenceConfig.targetField);

                if (oldValue !== null && typeof oldValue === 'object' && oldValue.value !== undefined) {
                    oldValue = oldValue.value;
                }

                if (!oldValue) { return; }

                var mappedId = getMappedReferenceId(
                    oldValue,
                    referenceConfig.sourceRecordType,
                    referenceConfig.targetRecordType,
                    referenceConfig.targetMatchField
                );

                var profileDisplay = '';

                if (mappedId && oldFieldId === 'custentity_xor_pay_vendor_pmt_mtd_sdf') {

                    /* profileDisplay =
                        (mappedId.profileName || '') +
                        (mappedId.profileCode
                            ? ' (' + mappedId.profileCode + ')'
                            : ''); */

                    profileDisplay = mappedId.profileCode || mappedId.profileName || '';

                    profileCodeForCatch = profileDisplay;
                }

                log.audit('Reference Mapping Result', {
                    vendorId: vendorId,
                    field: friendlyLabel,
                    sourceValue: oldValue,
                    mappedId: mappedId
                });

                // Source CUA Payment Profile inactive -> out of scope.
                if (mappedId && mappedId.sourceInactive === true) {

                    addError(
                        vendorErrors,
                        'Out of Scope',
                        'The source CUA Payment Profile "' +
                        mappedId.profileName +
                        ' (' +
                        mappedId.profileCode +
                        ')" is inactive.'
                    );

                    log.audit({
                        title: 'Skipped - Source CUA Payment Profile Inactive',
                        details: { vendorId: vendorId, sourceProfileId: oldValue }
                    });


                    //removed becuse the error is repeated - Gan

                    /*   context.write({
                          key: 'ERROR_ROW',
                          value: JSON.stringify({
                              vendorId: vendorId,
                              vendorName: vendorName,
                              profileCode: profileCodeForCatch,
                              status: 'Skipped',
                              category: 'Out of Scope',
                              message: 'The source CUA Payment Profile (ID ' + oldValue +
                                  ') is Inactive. The vendor was skipped (out of scope).',
                              recommendedAction: 'Activate the source CUA Payment Profile if this vendor should be migrated, then rerun the migration.'
                          })
                      }); */

                    skipDueToInactiveProfile = true;
                    return;
                }

                if (!mappedId || mappedId.mappingFound === false) {

                    if (oldFieldId === 'custentity_xor_pay_vendor_pmt_mtd_sdf') {

                        paymentProfileMappingFailed = true;

                        addError(
                            vendorErrors,
                            'Mapping Not Found',
                            'Could not map the source CUA Payment Profile "' +
                            profileDisplay +
                            '" to a CI Payment Profile. Please verify that the corresponding CI Payment Profile exists in the new setup.'
                        );

                        context.write({
                            key: 'UNMAPPED_PROFILE',
                            value: JSON.stringify({ vendorId: vendorId, oldValue: oldValue })
                        });

                        log.audit({
                            title: 'EXIT',
                            details: {
                                vendorId: vendorId,
                                reason: 'Reference Mapping Failed - ' + friendlyLabel
                            }
                        });

                        return;
                    }


                    // Only CRITICAL reference target fields (Payment Profile)
                    // stop migration. All other reference fields (Bank Account
                    // Type, Delivery Method) are OPTIONAL -> warn and skip.
                    if (targetIsCritical) {
                        addError(
                            vendorErrors,
                            'Mapping Not Found',
                            'Could not map "' + friendlyLabel +
                            '" from the old system value to the new system. The vendor was NOT migrated to ' +
                            'avoid saving an incorrect default value. Please verify ' +
                            'the corresponding ' + friendlyLabel + ' exists in the new setup.'
                        );

                        log.audit('Critical Reference Mapping Missing', {
                            vendorId: vendorId, field: friendlyLabel, oldValue: oldValue
                        });

                        context.write({
                            key: 'ERROR_ROW',
                            value: JSON.stringify({
                                vendorId: vendorId,
                                vendorName: vendorName,
                                profileCode: profileCodeForCatch,
                                status: 'Skipped',
                                category: 'Mapping Not Found',
                                message: 'Could not map "' + friendlyLabel +
                                    '" from the source system. The vendor was skipped to avoid saving an incorrect default value.',
                                recommendedAction: 'Verify the corresponding ' + friendlyLabel + ' exists in the new setup, then rerun the migration.'
                            })
                        });
                    } else {
                        // Optional reference field: just skip it with a warning.
                        addError(
                            vendorWarnings,
                            'Optional Field Skipped',
                            'Could not map optional field "' + friendlyLabel +
                            '" from the source system. It was left blank; the vendor was still migrated.'
                        );

                        log.audit('Optional Reference Mapping Missing - skipped', {
                            vendorId: vendorId, field: friendlyLabel, oldValue: oldValue
                        });
                    }

                    return;
                }

                mappedData[referenceConfig.targetField] = Number(mappedId.targetId);

                if (referenceConfig.targetField === 'custrecord_ci_adv_profile_name') {

                    mappedData['custrecord_ci_adv_vendor_cuappf_code'] = mappedId.profileCode;
                    // Capture for the catch/report so we always know which
                    // profile was being migrated when a failure occurs.
                    profileCodeForCatch = profileDisplay || mappedId.profileCode || profileCodeForCatch;

                    try {

                        var routingIdentifier =
                            getRoutingIdentifierFromProfile(mappedId.targetId, mappedData);

                        if (routingIdentifier) {
                            mappedData['custrecord_ci_adv_routing_id_vb'] = routingIdentifier;
                        }

                    } catch (e) {

                        addError(
                            vendorErrors,
                            'Configuration Error',
                            e.message
                        );

                        paymentProfileMappingFailed = true;
                        return;
                    }
                }
            });

            // ====================================================
            // STOP IF SOURCE CUA PAYMENT PROFILE IS INACTIVE
            // ====================================================

            if (skipDueToInactiveProfile) {
                flushVendorErrors(context, vendorId, vendorName, vendorErrors, profileCodeForCatch);
                return;
            }


            //STOP IF PAYMENT PROFILE MAPPING FAILED
            if (paymentProfileMappingFailed) {
                flushVendorErrors(
                    context,
                    vendorId,
                    vendorName,
                    vendorErrors,
                    profileCodeForCatch
                );
                return;
            }

            // ====================================================
            // SPECIAL PROFILES HANDLING PL555/499/821
            // ====================================================
            
            var specialProfiles = {
                'CITIUA_PL_555_ONS_C12_01': true,
                'CITIUA_US_499_ONS_C12_01': true,
                'CITIUA_US_821_ONS_C12_01': true
            };

            if (specialProfiles[profileCodeForCatch]) {

              log.audit({
             title: 'SPECIAL PROFILE BLOCK HIT',
             details: {
             vendorId: vendorId,
             profileCode: profileCodeForCatch
        }
    });

                var accountNumber =
                    vendorData['custentity_xor_pay_bank_acct_no_sdf'];

                var iban =
                    vendorData['custentity_xor_pay_vendor_iban_sdf'];
              
                if (profileCodeForCatch === 'CITIUA_PL_555_ONS_C12_01') {
                    mappedData['custrecord_ci_adv_vbd_bank_iban'] =
                        iban && String(iban).trim() !== '' ? iban : accountNumber;
                } else { // Always keep CIA IBAN blank for 499/821
                mappedData['custrecord_ci_adv_vbd_bank_iban'] = '';
                }

                // Both blank -> skip vendor
                if (
                    (!accountNumber || String(accountNumber).trim() === '') &&
                    (!iban || String(iban).trim() === '')
                ) {

                    addError(
                        vendorErrors,
                        'Missing Data',
                        profileCodeForCatch +
                        ' requires either Bank Account Number or Bank IBAN. Both fields are blank.'
                    );
                }

                // First preference = Account Number
                if (accountNumber &&
                    String(accountNumber).trim() !== ''
                ) {
                    mappedData['custrecord_ci_adv_account_number'] =
                        accountNumber;

                } else if (
                    iban &&
                    String(iban).trim() !== ''
                ) {

                    mappedData['custrecord_ci_adv_account_number'] =
                        iban;
                }
                log.audit({
                    title: 'PL555/499/821 Account Number Override',
                    details: {
                        vendorId: vendorId,
                        profileCode: profileCodeForCatch,
                        accountNumber: accountNumber,
                        iban: iban,
                        finalAccountNumber:
                            mappedData['custrecord_ci_adv_account_number'],
                        finalIban:
                            mappedData['custrecord_ci_adv_vbd_bank_iban']
                    }
                });
            }

            // ====================================================
            // CHECK MIGRATION STATUS
            // ====================================================


            var migrationCompleted = vendorData[MIGRATION_CHECKBOX_FIELD];
            if (migrationCompleted === true || migrationCompleted === 'T') {

                log.audit({
                    title: 'EXIT',
                    details: {
                        vendorId: vendorId,
                        reason: 'Already Migrated'
                    }
                });

                return;
            }

            // ====================================================
            // TEST MODE
            // ====================================================

            if (TEST_MODE) {
                flushVendorErrors(context, vendorId, vendorName, vendorErrors, profileCodeForCatch);
                return;
            }

            // ====================================================
            // DUPLICATE CHECK
            // ====================================================

            var existingBankDetailSearch = search.create({
                type: 'customrecord_ci_adv_entity_bank_details',
                filters: [['custrecordci_adv_details', 'anyof', vendorId]],
                columns: ['internalid']
            });

            var existingBankDetail = existingBankDetailSearch.run().getRange({ start: 0, end: 1 });

            if (existingBankDetail && existingBankDetail.length > 0) {
                var existingCiaRecordId = existingBankDetail[0].id;
                var flagUpdateError = '';
                try {
                  /*   record.submitFields({
                        type: record.Type.VENDOR,
                        id: vendorId,
                        values: { custentity_xor_pay_ci_vendor_mgrt_sts: true }
                    }); */
                    log.audit({
                        title: 'Existing CI record found - flag corrected',
                        details: { vendorId: vendorId, ciaRecordId: existingCiaRecordId }
                    });
                } catch (flagErr) {
                    flagUpdateError = flagErr.message || flagErr.name || 'Unknown error';
                    log.error({
                        title: 'Could not flip migration flag for existing record',
                        details: { vendorId: vendorId, error: flagErr.message }
                    });
                }
                context.write({
                    key: 'ERROR_ROW',
                    value: JSON.stringify({
                        vendorId: vendorId,
                        vendorName: vendorName,
                        profileCode: profileCodeForCatch,
                        status: 'Skipped',
                        category: 'CI Record Already Exists',
                        message: 'A CI Vendor Bank Details record already exists (ID ' + existingCiaRecordId + ').' +
                            (flagUpdateError ? ' The migration flag could not be updated: ' + flagUpdateError : '.'),
                        recommendedAction: flagUpdateError
                            ? 'Review the existing CI record and then rerun the migration if needed.'
                            : 'Review the existing CI record if necessary; no new record was created.'
                    })
                });
                log.audit({
                    title: 'EXIT',
                    details: {
                        vendorId: vendorId,
                        reason: 'CI Record Already Exists'
                    }
                });
                return;
            }

            // ====================================================
            // DOB CONVERSION  (OPTIONAL FIELD - never fatal)
            // ====================================================

            if (mappedData['custrecord_ci_adv_vendor_dob']) {
                try {

                    mappedData['custrecord_ci_adv_vendor_dob'] = format.parse({
                        value: mappedData['custrecord_ci_adv_vendor_dob'],
                        type: format.Type.DATE
                    });

                    /* var rawDob = mappedData['custrecord_ci_adv_vendor_dob'];
                    var dobParts = rawDob.split('/');
                    mappedData['custrecord_ci_adv_vendor_dob'] = new Date(
                        dobParts[2], dobParts[0] - 1, dobParts[1]
                    ); */
                } catch (dobError) {
                    addError(
                        vendorWarnings,
                        'Optional Field Skipped',
                        'Vendor Date of Birth value "' +
                        mappedData['custrecord_ci_adv_vendor_dob'] +
                        '" could not be parsed (expected MM/DD/YYYY). ' +
                        'It was left blank; the vendor was still migrated.'
                    );
                    delete mappedData['custrecord_ci_adv_vendor_dob'];
                }
            }

            // ====================================================
            // VALIDATE BANK NAME (OPTIONAL - never fatal)
            //
            // CHANGED: Bank Name is no longer business-critical. If it is
            // empty or contains invalid characters, we drop it and warn
            // instead of skipping the entire vendor.
            // ====================================================
            /* 
                        var bankName = mappedData['custrecord_ci_adv_bank_name'];
            
                        if (!bankName) {
                            addError(
                                vendorWarnings,
                                'Optional Field Skipped',
                                'Bank Name is empty on the vendor. It was left blank; ' +
                                'the vendor was still migrated.'
                            );
                            delete mappedData['custrecord_ci_adv_bank_name'];
                        } else if (/[^A-Za-z0-9 ]/.test(bankName)) {
                            addError(
                                vendorWarnings,
                                'Optional Field Skipped',
                                'Bank Name "' + bankName + '" contains special characters ' +
                                '(only letters, numbers and spaces are allowed). It was ' +
                                'left blank; the vendor was still migrated.'
                            );
                            delete mappedData['custrecord_ci_adv_bank_name'];
                        } */

            // ====================================================
            // VALIDATE PROFILE / ROUTING (CRITICAL)
            // ====================================================


            if (vendorData.custentity_xor_pay_vendor_pmt_mtd_sdf &&
                !mappedData['custrecord_ci_adv_profile_name']) {
                addError(vendorErrors, 'Missing Data',
                    'The vendor has a Payment Method on the old record but no matching Payment Profile could be created in the new system.');
            }

            // ====================================================
            // VALIDATE MANDATORY CI FIELDS BEFORE SAVE (CRITICAL)
            //
            // MANDATORY_CIA_FIELDS is now empty; loop retained so genuinely
            // mandatory fields can be re-introduced later without rework.
            // ====================================================

            Object.keys(MANDATORY_CIA_FIELDS).forEach(function (fieldId) {
                var v = mappedData[fieldId];
                if (v === null || v === undefined || String(v).trim() === '') {
                    addError(
                        vendorErrors,
                        'Missing Data',
                        MANDATORY_CIA_FIELDS[fieldId] +
                        ' is required but is empty on the source vendor. ' +
                        'Please populate it before migrating this vendor.'
                    );
                }
            });

            // ====================================================
            // IF ANY CRITICAL ERRORS, WRITE THEM ALL AND STOP
            // ====================================================

            log.audit('Vendor Errors Before Create', {
                vendorId: vendorId,
                errors: JSON.stringify(vendorErrors),
                warnings: JSON.stringify(vendorWarnings)
            });

            if (vendorErrors.length > 0) {

                log.audit({
                    title: 'EXIT',
                    details: {
                        vendorId: vendorId,
                        reason: 'Vendor Errors',
                        errors: JSON.stringify(vendorErrors)
                    }
                });

                flushVendorErrors(context, vendorId, vendorName, vendorErrors, profileCodeForCatch);
                return;
            }

            // ====================================================
            // RESOLVE ROUTING IDENTIFIER TO LIST INTERNAL ID (CRITICAL)
            // ====================================================

            var routingText = mappedData['custrecord_ci_adv_routing_id_vb'];

            if (routingText) {

                var routingInternalId = resolveRoutingInternalId(routingText);

                if (!routingInternalId) {

                    addError(
                        vendorErrors,
                        'Mapping Not Found',
                        'The Bank Routing Identifier "' + routingText +
                        '" could not be resolved to a value in the Routing Identifier List.'
                    );

                    flushVendorErrors(context, vendorId, vendorName, vendorErrors, profileCodeForCatch);
                    return;
                }

                mappedData['custrecord_ci_adv_routing_id_vb'] = routingInternalId;
            }

            // ====================================================
            // CREATE CI RECORD (standard mode)
            // ====================================================

            log.audit('Reached CI Record Creation', { vendorId: vendorId });

            var ciaRecord = record.create({
                type: 'customrecord_ci_adv_entity_bank_details',
                isDynamic: false
            });

            log.audit({
                title: 'Mapped Data Before setValue',
                details: JSON.stringify(mappedData)
            });

            // ----------------------------------------------------
            // SET FIELD VALUES
            //
            // setValue failures are classified:
            //   - Critical field -> hard error (skip vendor).
            //   - Optional field -> drop it, log a warning, keep going.
            // ----------------------------------------------------

            // Track which optional fields actually got set so we can
            // selectively clear them on a save() retry.
            var setOptionalFields = {};

            Object.keys(mappedData).forEach(function (fieldId) {
                var val = mappedData[fieldId];
                if (val === null || val === '' || val === undefined) return;
                if (fieldId === 'custrecord_ci_adv_branch_number') {
                    log.audit({
                        title: 'Branch Number - Before setValue',
                        details: { vendorId: vendorId, value: val, valueType: typeof val }
                    });
                }

                try {
                    ciaRecord.setValue({ fieldId: fieldId, value: val });

                    if (!isCriticalField(fieldId)) {
                        setOptionalFields[fieldId] = true;
                    }

                    if (fieldId === 'custrecord_ci_adv_branch_number') {
                        var readBack;
                        try {
                            readBack = ciaRecord.getValue({ fieldId: fieldId });
                        } catch (rbErr) {
                            readBack = '[getValue failed: ' + rbErr.message + ']';
                        }
                        log.audit({
                            title: 'Branch Number - After setValue (in-memory read-back)',
                            details: { vendorId: vendorId, readBack: readBack }
                        });
                    }
                    // Change 4 In-memory read-back after setValue
                    // ADDED: in-memory read-back for the Cheque Number default
                    // so we can confirm the value was set before save (US585).
                    if (fieldId === CHEQUE_NUMBER_FIELD) {
                        var chqReadBack;
                        try {
                            chqReadBack = ciaRecord.getValue({ fieldId: fieldId });
                        } catch (chqRbErr) {
                            chqReadBack = '[getValue failed: ' + chqRbErr.message + ']';
                        }
                        log.audit({
                            title: 'Cheque Number - After setValue (in-memory read-back)',
                            details: { vendorId: vendorId, setTo: val, readBack: chqReadBack }
                        });
                    }

                    if (fieldId === 'custrecord_ci_bank_acct_type') {
                        var acctReadBack;
                        try {
                            acctReadBack = ciaRecord.getValue({ fieldId: fieldId });
                        } catch (arbErr) {
                            acctReadBack = '[getValue failed: ' + arbErr.message + ']';
                        }
                        log.audit({
                            title: 'Bank Account Type - After setValue (in-memory read-back)',
                            details: { vendorId: vendorId, setTo: val, readBack: acctReadBack }
                        });
                    }
                } catch (setErr) {
                    var label = FIELD_LABELS[fieldId] || fieldId;

                    if (isCriticalField(fieldId)) {
                        // CRITICAL field failed to set -> hard error.
                        addError(
                            vendorErrors,
                            'Field Set Error',
                            'Could not set the critical "' + label + '" field. ' +
                            'Reason: ' + (setErr.message || setErr.name || 'unknown')
                        );
                        log.error({
                            title: 'Critical setValue failed',
                            details: { vendorId: vendorId, fieldId: fieldId, value: val, error: setErr.message }
                        });
                    } else {
                        // OPTIONAL field failed to set -> drop with warning.
                        addError(
                            vendorWarnings,
                            'Optional Field Skipped',
                            'Optional field "' + label + '" could not be set (' +
                            (setErr.message || setErr.name || 'unknown') +
                            '). It was left blank; the vendor was still migrated.'
                        );
                        log.audit({
                            title: 'Optional setValue failed - skipped',
                            details: { vendorId: vendorId, fieldId: fieldId, value: val, error: setErr.message }
                        });
                        // Remove so re-assert / save logic ignores it.
                        delete mappedData[fieldId];
                    }
                }
            });

            // Only CRITICAL setValue failures abort the vendor.
            if (vendorErrors.length > 0) {
                flushVendorErrors(context, vendorId, vendorName, vendorErrors, profileCodeForCatch);
                return;
            }

            // ----------------------------------------------------
            // RE-ASSERT CRITICAL SCALAR FIELDS RIGHT BEFORE SAVE
            // ----------------------------------------------------

            CRITICAL_REASSERT_FIELDS.forEach(function (fieldId) {
                var val = mappedData[fieldId];
                if (val === null || val === '' || val === undefined) return;
                try {
                    var current = ciaRecord.getValue({ fieldId: fieldId });
                    if (current === null || current === '' || current === undefined ||
                        String(current).trim() !== String(val).trim()) {
                        ciaRecord.setValue({ fieldId: fieldId, value: val });
                        log.audit({
                            title: 'Critical field re-asserted before save',
                            details: { vendorId: vendorId, fieldId: fieldId, expected: val, foundBefore: current }
                        });
                    }
                } catch (reErr) {
                    log.error({
                        title: 'Critical re-assert failed',
                        details: { vendorId: vendorId, fieldId: fieldId, error: reErr.message }
                    });
                }
            });

            log.audit({
                title: 'Branch Number - Immediately Before save()',
                details: {
                    vendorId: vendorId,
                    inMemory: ciaRecord.getValue({ fieldId: 'custrecord_ci_adv_branch_number' })
                }
            });

            log.audit({
                title: 'Routing Identifier Before Save',
                details: {
                    vendorId: vendorId,
                    routingInternalId: routingInternalId,
                    routingText: routingText
                }
            });

            // ----------------------------------------------------
            // SAVE WITH OPTIONAL-FIELD RETRY
            //
            // If save() throws because of an OPTIONAL field
            // (e.g. INVALID_FLD_VALUE on Vendor Residency Status),
            // we identify the offending field, clear it, log a
            // warning, and retry. If the offending field is CRITICAL
            // (or cannot be identified), we hard-fail the vendor.
            //
            // SPECIAL CASE: if save() throws a VALIDATION_ERROR raised by
            // the "CI Vendor Validations" User Event (beforeSubmit), we
            // do NOT treat it as an optional field-value error. Instead we
            // surface it to business users as a clear "Skipped" row with a
            // friendly reason + recommended action and stop processing this
            // vendor (no data is modified - the record is never saved).
            // ----------------------------------------------------

            log.audit('About To Save CI Record', { vendorId: vendorId });

            var saveAttempt = 0;
            var saved = false;
            var userEventValidationHandled = false;

            while (!saved && saveAttempt <= MAX_SAVE_RETRIES) {
                saveAttempt++;
                try {
                    ciaRecordId = ciaRecord.save({
                        enableSourcing: false,
                        ignoreMandatoryFields: false
                    });
                    saved = true;
                } catch (saveErr) {

                    // -------------------------------------------------
                    // 1) USER EVENT BUSINESS-VALIDATION FAILURE
                    //    -> surface as friendly Skipped row, do not retry.
                    // -------------------------------------------------
                    if (isUserEventValidationError(saveErr)) {

                        var friendly = buildValidationFriendlyMessage(
                            saveErr,
                            profileCodeForCatch || mappedData['custrecord_ci_adv_vendor_cuappf_code'],
                            mappedData
                        );

                        log.audit({
                            title: 'CI User Event validation failed - vendor skipped',
                            details: {
                                vendorId: vendorId,
                                profileCode: profileCodeForCatch || mappedData['custrecord_ci_adv_vendor_cuappf_code'],
                                field: friendly.fieldLabel,
                                rawMessage: friendly.rawMessage,
                                attempt: saveAttempt
                            }
                        });

                        flushVendorValidationFailure(
                            context,
                            vendorId,
                            vendorName,
                            profileCodeForCatch || mappedData['custrecord_ci_adv_vendor_cuappf_code'],
                            friendly
                        );

                        // Record any optional-field warnings gathered so far too.
                        if (vendorWarnings.length > 0) {
                            flushVendorWarnings(
                                context, vendorId, vendorName, vendorWarnings,
                                profileCodeForCatch || mappedData['custrecord_ci_adv_vendor_cuappf_code']
                            );
                        }

                        userEventValidationHandled = true;
                        break; // stop trying to save this vendor
                    }

                    // -------------------------------------------------
                    // 2) STANDARD OPTIONAL FIELD-VALUE ERROR -> drop & retry.
                    // -------------------------------------------------

                    // Build the set of optional fields that are still set and
                    // therefore candidates to be the culprit.
                    var optionalCandidates = Object.keys(setOptionalFields).filter(function (fid) {
                        return mappedData[fid] !== undefined && mappedData[fid] !== null && mappedData[fid] !== '';
                    });

                    var offendingFieldId = extractOffendingFieldId(saveErr, optionalCandidates);

                    // If we couldn't pin it to a specific optional field via the
                    // message, but there ARE optional candidates and the error
                    // looks like a field value error, drop them one at a time
                    // (most-recently-added first) as a fallback.
                    var errStr = ((saveErr && saveErr.message) || '') + ' ' +
                        ((saveErr && saveErr.name) || '');
                    var looksLikeFieldValueError =
                        /INVALID_FLD_VALUE|invalid field value|that field value is not valid|invalid value/i.test(errStr);

                    if (!offendingFieldId && looksLikeFieldValueError && optionalCandidates.length > 0) {
                        offendingFieldId = optionalCandidates[optionalCandidates.length - 1];
                        log.audit({
                            title: 'Save error not tied to a named field - dropping an optional candidate',
                            details: {
                                vendorId: vendorId,
                                droppedCandidate: offendingFieldId,
                                error: errStr,
                                remainingCandidates: optionalCandidates.length
                            }
                        });
                    }

                    if (offendingFieldId && !isCriticalField(offendingFieldId)) {
                        // OPTIONAL field caused the save failure -> clear & retry.
                        var optLabel = FIELD_LABELS[offendingFieldId] || offendingFieldId;
                        try {
                            ciaRecord.setValue({ fieldId: offendingFieldId, value: '' });
                        } catch (clearErr) {
                            // setText/empty fallback for list fields.
                            try {
                                ciaRecord.setValue({ fieldId: offendingFieldId, value: null });
                            } catch (clearErr2) {
                                log.error({
                                    title: 'Could not clear offending optional field',
                                    details: { vendorId: vendorId, fieldId: offendingFieldId, error: clearErr2.message }
                                });
                            }
                        }

                        delete mappedData[offendingFieldId];
                        delete setOptionalFields[offendingFieldId];

                        addError(
                            vendorWarnings,
                            'Optional Field Skipped',
                            'Optional field "' + optLabel + '" had an invalid value (' +
                            (saveErr.message || saveErr.name || 'invalid value') +
                            ') and was cleared so the vendor could be migrated.'
                        );

                        log.audit({
                            title: 'Optional field cleared after save failure - retrying save',
                            details: {
                                vendorId: vendorId,
                                offendingFieldId: offendingFieldId,
                                attempt: saveAttempt,
                                error: saveErr.message
                            }
                        });

                        // loop and retry save
                    } else {
                        // CRITICAL field (or unidentifiable) caused failure ->
                        // genuine business failure, re-throw to outer catch.
                        log.error({
                            title: 'Save failed on a critical/unidentifiable field',
                            details: {
                                vendorId: vendorId,
                                offendingFieldId: offendingFieldId || '[unknown]',
                                attempt: saveAttempt,
                                error: saveErr.message,
                                stack: saveErr.stack
                            }
                        });
                        throw saveErr;
                    }
                }
            }

            // If a User Event validation failure was handled, this vendor is
            // already reported as Skipped - stop here without further work.
            if (userEventValidationHandled) {
                log.audit({
                    title: 'EXIT',
                    details: {
                        vendorId: vendorId,
                        reason: 'User Event Validation Failed (Skipped)'
                    }
                });
                return;
            }

            if (!saved) {
                // Exhausted retries without success.
                addError(
                    vendorErrors,
                    'System Error',
                    'The CI Vendor Bank Details record could not be saved after ' +
                    MAX_SAVE_RETRIES + ' attempts dropping optional fields. ' +
                    'Please review the field values for this vendor.'
                );
                flushVendorErrors(context, vendorId, vendorName, vendorErrors, profileCodeForCatch);
                return;
            }

            // ----------------------------------------------------
            // POST-SAVE VERIFICATION LOGGING
            // ----------------------------------------------------

            try {
                var routingLookup = search.lookupFields({
                    type: 'customrecord_ci_adv_entity_bank_details',
                    id: ciaRecordId,
                    columns: ['custrecord_ci_adv_routing_id_vb']
                });

                log.audit({
                    title: 'Routing Identifier After Save',
                    details: {
                        vendorId: vendorId,
                        raw: JSON.stringify(routingLookup),
                        text: extractLookupText(routingLookup.custrecord_ci_adv_routing_id_vb),
                        value: extractLookupValue(routingLookup.custrecord_ci_adv_routing_id_vb)
                    }
                });
            } catch (rlErr) {
                log.error({
                    title: 'Routing After Save lookup failed',
                    details: { vendorId: vendorId, error: rlErr.message }
                });
            }


            // ----------------------------------------------------
            // CHEQUE NUMBER VERIFICATION (DB read) - US585
            // Change 5 Post-save DB verification log
            // ADDED: read the Cheque Number back from the saved record so
            // you can confirm from the logs that the default value was
            // actually persisted (i.e. migrated) for US585.
            // ----------------------------------------------------

            try {
                var chequeLookup = search.lookupFields({
                    type: 'customrecord_ci_adv_entity_bank_details',
                    id: ciaRecordId,
                    columns: [CHEQUE_NUMBER_FIELD]
                });

                var savedChequeVal = chequeLookup
                    ? chequeLookup[CHEQUE_NUMBER_FIELD]
                    : '';

                log.audit({
                    title: 'Cheque Number - After Save (DB read) [US585]',
                    details: {
                        vendorId: vendorId,
                        ciaRecordId: ciaRecordId,
                        expected: CHEQUE_NUMBER_DEFAULT_VALUE,
                        savedValue: savedChequeVal,
                        migrated: (String(savedChequeVal) === String(CHEQUE_NUMBER_DEFAULT_VALUE))
                    }
                });
            } catch (chqErr) {
                log.error({
                    title: 'Cheque Number After Save lookup failed',
                    details: { vendorId: vendorId, error: chqErr.message }
                });
            }

            // ----------------------------------------------------
            // BANK ACCOUNT TYPE VERIFICATION (DB read)
            // ----------------------------------------------------

            try {
                var acctTypeExpected = mappedData['custrecord_ci_bank_acct_type'];
                if (acctTypeExpected !== null && acctTypeExpected !== undefined && acctTypeExpected !== '') {
                    var acctTypeLookup = search.lookupFields({
                        type: 'customrecord_ci_adv_entity_bank_details',
                        id: ciaRecordId,
                        columns: ['custrecord_ci_bank_acct_type']
                    });

                    log.audit({
                        title: 'Bank Account Type - After Save (DB read)',
                        details: {
                            vendorId: vendorId,
                            ciaRecordId: ciaRecordId,
                            expectedInternalId: acctTypeExpected,
                            savedValue: extractLookupValue(acctTypeLookup.custrecord_ci_bank_acct_type),
                            savedText: extractLookupText(acctTypeLookup.custrecord_ci_bank_acct_type)
                        }
                    });
                }
            } catch (atErr) {
                log.error({
                    title: 'Bank Account Type After Save lookup failed',
                    details: { vendorId: vendorId, error: atErr.message }
                });
            }

            // ----------------------------------------------------
            // BRANCH NUMBER VERIFICATION + BACKSTOP
            //
            // NOTE: Branch Number is now OPTIONAL. The backstop only runs
            // if a value was actually mapped and still present (i.e. not
            // dropped). It will never block migration.
            // ----------------------------------------------------

            try {
                var savedBranchLookup = search.lookupFields({
                    type: 'customrecord_ci_adv_entity_bank_details',
                    id: ciaRecordId,
                    columns: ['custrecord_ci_adv_branch_number']
                });

                var savedBranchVal = savedBranchLookup
                    ? savedBranchLookup['custrecord_ci_adv_branch_number']
                    : '';

                log.audit({
                    title: 'Branch Number - After Save (DB read)',
                    details: {
                        vendorId: vendorId,
                        ciaRecordId: ciaRecordId,
                        savedBranch: savedBranchVal,
                        expected: mappedData['custrecord_ci_adv_branch_number']
                    }
                });

                var expectedBranch = mappedData['custrecord_ci_adv_branch_number'];
                var branchEmptyInDb = (savedBranchVal === null || savedBranchVal === '' || savedBranchVal === undefined);

                if (expectedBranch !== null && expectedBranch !== '' &&
                    expectedBranch !== undefined && branchEmptyInDb) {
                    try {
                        record.submitFields({
                            type: 'customrecord_ci_adv_entity_bank_details',
                            id: ciaRecordId,
                            values: { 'custrecord_ci_adv_branch_number': expectedBranch },
                            options: { enableSourcing: false, ignoreMandatoryFields: true }
                        });

                        var recheck = search.lookupFields({
                            type: 'customrecord_ci_adv_entity_bank_details',
                            id: ciaRecordId,
                            columns: ['custrecord_ci_adv_branch_number']
                        });

                        log.audit({
                            title: 'Branch Number - Backstop submitFields applied',
                            details: {
                                vendorId: vendorId,
                                ciaRecordId: ciaRecordId,
                                wrote: expectedBranch,
                                afterBackstop: recheck['custrecord_ci_adv_branch_number']
                            }
                        });
                    } catch (backErr) {
                        // Branch is optional; a failed backstop is only a warning.
                        log.audit({
                            title: 'Branch Number backstop submitFields failed (optional - ignored)',
                            details: { vendorId: vendorId, ciaRecordId: ciaRecordId, error: backErr.message }
                        });
                        addError(
                            vendorWarnings,
                            'Optional Field Skipped',
                            'Bank Branch Number could not be written after save (' +
                            backErr.message + '). The vendor was still migrated.'
                        );
                    }
                }
            } catch (branchVerifyErr) {
                log.error({
                    title: 'Branch verification failed',
                    details: { vendorId: vendorId, error: branchVerifyErr.message }
                });
            }

            log.audit({ title: 'CI Record Created', details: { vendorId: vendorId, ciaRecordId: ciaRecordId } });

            // ----------------------------------------------------
            // UPDATE MIGRATION STATUS
            // ----------------------------------------------------

            record.submitFields({
                type: record.Type.VENDOR,
                id: vendorId,
                values: { custentity_xor_pay_ci_vendor_mgrt_sts: true }
            });

            // ----------------------------------------------------
            // RECORD ANY NON-FATAL WARNINGS TO THE REPORT
            // (vendor was migrated, but with dropped optional fields)
            // ----------------------------------------------------

            if (vendorWarnings.length > 0) {
                flushVendorWarnings(context, vendorId, vendorName, vendorWarnings, profileCodeForCatch);
            }

        } catch (e) {

            log.audit({
                title: 'EXIT',
                details: {
                    vendorId: vendorIdForCatch,
                    reason: 'Exception',
                    error: e.message
                }
            });

            log.error('Migration Exception', {
                vendorId: vendorIdForCatch,
                error: e.name,
                message: e.message,
                stack: e.stack
            });

            // If a record was actually saved before the error, this is a
            // post-save (logging/verification) failure, NOT a migration failure.
            if (ciaRecordId) {
                log.error({
                    title: 'Post-save step failed (record WAS created)',
                    details: {
                        vendorId: vendorIdForCatch,
                        ciaRecordId: ciaRecordId,
                        errorName: e.name,
                        errorMessage: e.message,
                        stack: e.stack
                    }
                });
                try {
                    record.submitFields({
                        type: record.Type.VENDOR,
                        id: vendorIdForCatch,
                        values: { custentity_xor_pay_ci_vendor_mgrt_sts: true }
                    });
                } catch (flagErr) {
                    log.error({
                        title: 'Could not flip migration flag after post-save error',
                        details: { vendorId: vendorIdForCatch, error: flagErr.message }
                    });
                }

                // Still record any warnings collected before the post-save error.
                if (vendorWarnings && vendorWarnings.length > 0) {
                    try {
                        flushVendorWarnings(context, vendorIdForCatch, vendorName || '', vendorWarnings, profileCodeForCatch);
                    } catch (wErr) {
                        log.error({ title: 'Warning flush failed (post-save)', details: wErr });
                    }
                }
                return;
            }

            // ----------------------------------------------------
            // CATCH-ALL FOR USER EVENT VALIDATION FAILURE
            //
            // If a VALIDATION_ERROR from the CI Vendor Validations User
            // Event ever reaches this outer catch (e.g. thrown outside the
            // save-retry loop), surface it the same business-friendly way
            // rather than as a generic system exception.
            // ----------------------------------------------------
            if (isUserEventValidationError(e)) {
                var friendlyCatch = buildValidationFriendlyMessage(e, profileCodeForCatch);

                log.audit({
                    title: 'CI User Event validation failed (outer catch) - vendor skipped',
                    details: {
                        vendorId: vendorIdForCatch,
                        profileCode: profileCodeForCatch,
                        field: friendlyCatch.fieldLabel,
                        rawMessage: friendlyCatch.rawMessage
                    }
                });

                try {
                    flushVendorValidationFailure(
                        context, vendorIdForCatch, vendorName || '',
                        profileCodeForCatch, friendlyCatch
                    );
                    if (vendorWarnings && vendorWarnings.length > 0) {
                        flushVendorWarnings(context, vendorIdForCatch, vendorName || '', vendorWarnings, profileCodeForCatch);
                    }
                } catch (vfErr) {
                    log.error({ title: 'Validation failure flush failed', details: vfErr });
                }
                return;
            }

            // Genuine failure before save.
            addError(
                vendorErrors,
                'System Error',
                'Unexpected error while migrating this vendor: ' +
                (e.message || e.name || 'Unknown error') +
                '. Please contact the administrator.'
            );

            log.error({
                title: 'Vendor Migration Failed',
                details: {
                    vendorId: vendorIdForCatch,
                    errorName: e.name,
                    errorMessage: e.message,
                    stack: e.stack
                }
            });

            try {
                flushVendorErrors(context, vendorIdForCatch, vendorName || '', vendorErrors, profileCodeForCatch);
            } catch (writeErr) {
                log.error({ title: 'Error flush failed', details: writeErr });
            }
        }
    }

    // ============================================================
    // WRITE ALL COLLECTED ERRORS FOR A VENDOR (status = Skipped)
    // ============================================================

    function flushVendorErrors(context, vendorId, vendorName, vendorErrors, profileCode) {

        if (!vendorErrors || vendorErrors.length === 0) return;

        var seen = {};

        vendorErrors.forEach(function (err) {
            var key = (err.category || '') + '||' + (err.message || '');
            if (seen[key]) return;
            seen[key] = true;

            context.write({
                key: 'ERROR_ROW',
                value: JSON.stringify({
                    vendorId: vendorId,
                    vendorName: vendorName,
                    profileCode: profileCode || '',
                    status: 'Skipped',
                    category: err.category || 'Error',
                    message: err.message || '',
                    recommendedAction: err.recommendedAction ||
                        'Review and correct the indicated issue, then rerun the migration for this vendor.'
                })
            });
        });

        log.audit({
            title: 'Vendor skipped with ' + vendorErrors.length + ' issue(s)',
            details: { vendorId: vendorId, vendorName: vendorName, profileCode: profileCode || '', issues: vendorErrors }
        });
    }

    // ============================================================
    // WRITE A USER EVENT VALIDATION FAILURE (status = Skipped)
    //
    // Produces a single, rich, business-friendly row capturing the
    // Payment Profile, the validation reason, and the recommended action.
    // ============================================================

    function flushVendorValidationFailure(context, vendorId, vendorName, profileCode, friendly) {

        var reason = (friendly && friendly.reason)
            ? friendly.reason
            : 'One or more field values do not satisfy the Payment Profile validation rules.';

        var recommendedAction = (friendly && friendly.recommendedAction)
            ? friendly.recommendedAction
            : 'Review the vendor\'s payment/bank details against the selected ' +
            'Payment Profile validation rules, correct the flagged value(s), ' +
            'then rerun the migration for this vendor.';

        context.write({
            key: 'ERROR_ROW',
            value: JSON.stringify({
                vendorId: vendorId,
                vendorName: vendorName,
                profileCode: profileCode || '',
                status: 'Skipped',
                category: 'Payment Profile Validation Failed',
                message: reason,
                recommendedAction: recommendedAction
            })
        });

        log.audit({
            title: 'Vendor skipped - Payment Profile validation failed',
            details: {
                vendorId: vendorId,
                vendorName: vendorName,
                profileCode: profileCode || '',
                reason: reason,
                recommendedAction: recommendedAction
            }
        });
    }

    // ============================================================
    // WRITE NON-FATAL WARNINGS FOR A MIGRATED VENDOR
    // (status = Migrated with Warnings)
    // ============================================================

    function flushVendorWarnings(context, vendorId, vendorName, vendorWarnings, profileCode) {

        if (!vendorWarnings || vendorWarnings.length === 0) return;

        var seen = {};

        vendorWarnings.forEach(function (warn) {
            var key = (warn.category || '') + '||' + (warn.message || '');
            if (seen[key]) return;
            seen[key] = true;

            context.write({
                key: 'ERROR_ROW',
                value: JSON.stringify({
                    vendorId: vendorId,
                    vendorName: vendorName,
                    profileCode: profileCode || '',
                    status: 'Migrated with Warnings',
                    category: warn.category || 'Warning',
                    message: warn.message || '',
                    recommendedAction: warn.recommendedAction ||
                        'No action required - the vendor was migrated; the listed optional field was left blank.'
                })
            });
        });

        log.audit({
            title: 'Vendor migrated with ' + vendorWarnings.length + ' warning(s)',
            details: { vendorId: vendorId, vendorName: vendorName, profileCode: profileCode || '', warnings: vendorWarnings }
        });
    }

    // ============================================================
    // REDUCE
    // ============================================================

    function reduce(context) {

        if (context.key === 'UNMAPPED_PROFILE') {
            log.audit({ title: 'Unmapped Profile Summary', details: context.values });
        }

        if (context.key === 'ERROR_ROW') {
            context.values.forEach(function (val) {
                context.write({ key: 'ERROR_ROW', value: val });
            });
        }
    }

    // ============================================================
    // SUMMARIZE
    // ============================================================

    function summarize(summary) {

        var mapErrorCount = 0;
        summary.mapSummary.errors.iterator().each(function (key, error) {
            mapErrorCount++;
            log.error({ title: 'Map Error for key: ' + key, details: error });
            return true;
        });

        if (summary.inputSummary.error) {
            log.error({ title: 'Input Error', details: summary.inputSummary.error });
        }

        try {

            // Extended header: now includes Payment Profile and Recommended Action.
            var csv = 'Vendor ID,Vendor Name,Payment Profile,Status,Issue Category,Issue Description,Recommended Action\n';
            var rowCount = 0;
            var skippedVendors = {};
            var warnedVendors = {};
            var grouped = {};

            summary.output.iterator().each(function (key, value) {
                if (key !== 'ERROR_ROW' || !value) return true;
                try {
                    var row = JSON.parse(value);
                    var vid = String(row.vendorId || '');
                    if (!grouped[vid]) grouped[vid] = [];
                    grouped[vid].push(row);
                    if (String(row.status) === 'Skipped') {
                        skippedVendors[vid] = true;
                    } else if (String(row.status) === 'Migrated with Warnings') {
                        warnedVendors[vid] = true;
                    }
                } catch (parseErr) {
                    log.error({ title: 'CSV row parse error', details: parseErr });
                }
                return true;
            });

            Object.keys(grouped).sort().forEach(function (vid) {
                grouped[vid].forEach(function (row) {
                    var vendorId = String(row.vendorId || '').replace(/"/g, '""');
                    var vendorName2 = String(row.vendorName || '').replace(/"/g, '""');
                    var profileCode = String(row.profileCode || '').replace(/"/g, '""');
                    var status = String(row.status || '').replace(/"/g, '""');
                    var category = String(row.category || '').replace(/"/g, '""');
                    var message = String(row.message || '').replace(/"/g, '""');
                    var recommendedAction = String(row.recommendedAction || '').replace(/"/g, '""');

                    csv += '"' + vendorId + '",' +
                        '"' + vendorName2 + '",' +
                        '"' + profileCode + '",' +
                        '"' + status + '",' +
                        '"' + category + '",' +
                        '"' + message + '",' +
                        '"' + recommendedAction + '"\n';
                    rowCount++;
                });
            });

            log.audit({
                title: 'Migration Summary',
                details: {
                    testMode: TEST_MODE,
                    mapStageErrors: mapErrorCount,
                    inputError: summary.inputSummary.error ? 1 : 0,
                    skippedVendors: Object.keys(skippedVendors).length,
                    migratedWithWarnings: Object.keys(warnedVendors).length,
                    totalIssueRows: rowCount,
                    vendorsWithIssues: Object.keys(grouped).length
                }
            });

            if (rowCount === 0) {
                log.audit({
                    title: 'No error rows - CSV not created',
                    details: 'All vendors migrated successfully (or nothing to migrate).'
                });
                return;
            }

            var folderId = null;
            var folderSearch = search.create({
                type: 'folder',
                filters: [['name', 'is', REPORT_FOLDER_NAME], 'AND', ['parent', 'anyof', '@NONE@']],
                columns: ['internalid']
            });

            var folderResult = folderSearch.run().getRange({ start: 0, end: 1 });
            if (folderResult && folderResult.length > 0) {
                folderId = folderResult[0].getValue('internalid');
            }

            if (!folderId) {
                log.error({
                    title: 'Report folder not found',
                    details: 'Folder "' + REPORT_FOLDER_NAME + '" does not exist at top level.'
                });
                return;
            }

            var now = new Date();
            var pad = function (n) { return (n < 10 ? '0' : '') + n; };
            var dateStamp =
                now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '_' +
                pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());

            var fileName = REPORT_FILE_PREFIX + dateStamp + '.csv';

            var fileObj = file.create({
                name: fileName,
                fileType: file.Type.CSV,
                contents: csv,
                folder: folderId
            });

            var fileId = fileObj.save();

            log.audit({
                title: 'Error report CSV saved',
                details: {
                    fileId: fileId, fileName: fileName, folderId: folderId,
                    rowCount: rowCount, uniqueVendors: Object.keys(grouped).length
                }
            });

        } catch (csvErr) {
            log.error({
                title: 'Failed to build/save error CSV',
                details: { name: csvErr.name, message: csvErr.message, stack: csvErr.stack }
            });
        }
    }

    // ============================================================
    // REFERENCE FIELD REMAPPING
    // ============================================================

    function getMappedReferenceId(oldInternalId, sourceRecordType, targetRecordType, targetMatchField) {

        try {

            var isProfileSource = (sourceRecordType === 'customrecord_xor_pay_pros_prfle_sdf');

            var sourceColumns;
            if (isProfileSource) {
                sourceColumns = ['name', 'custrecord_xor_pay_ppf_code_sdf', 'isinactive'];
            } else {
                sourceColumns = ['name'];
            }

            var lookupResult = search.lookupFields({
                type: sourceRecordType,
                id: oldInternalId,
                columns: sourceColumns
            });

            //Changes made to generate the message with the old profile code and name in case of an inactive source profile - Gan
            var oldName = extractLookupText(lookupResult.name);
            var oldProfileCode = '';

            if (isProfileSource) {

                var pcField = lookupResult.custrecord_xor_pay_ppf_code_sdf;
                oldProfileCode = extractLookupText(pcField);

                if (!oldProfileCode || /^\d+$/.test(oldProfileCode)) {
                    var pcInternalId = extractLookupValue(pcField);
                    if (pcInternalId && /^\d+$/.test(pcInternalId)) {
                        try {
                            var pcLookup = search.lookupFields({
                                type: 'customrecord_xor_pay_prof_cd_list_sdf',
                                id: pcInternalId,
                                columns: ['name']
                            });
                            oldProfileCode = extractLookupText(pcLookup.name);
                        } catch (pcErr) {
                            log.error({
                                title: 'Profile Code direct lookup failed',
                                details: {
                                    pcInternalId: pcInternalId,
                                    error: pcErr.message
                                }
                            });
                        }
                    }
                }

                var srcInactive = lookupResult.isinactive;

                if (srcInactive === true || srcInactive === 'T') {
                    log.audit({
                        title: 'Source CUA Payment Profile is Inactive',
                        details: { sourceProfileId: oldInternalId }
                    });

                    return {
                        sourceInactive: true,
                        profileCode: oldProfileCode,
                        profileName: oldName
                    };
                }
            }
            var mappedName = oldName;

            if (isProfileSource) {
                mappedName = mapProfileCode(oldProfileCode);
                if (!mappedName) { mappedName = oldName; }
            } else if (sourceRecordType === 'customrecord_xor_pay_dbt_acc_ty_lt_sdf') {
                mappedName = ACCOUNT_TYPE_MAPPING[oldName] || oldName;
            } else if (sourceRecordType === 'customrecord_xor_pay_delvry_mtd_lt_sdf') {
                mappedName = DELIVERY_METHOD_MAPPING[oldName] || oldName;
            }
            else if (sourceRecordType === 'customrecord_xor_pay_schm_name_lt_sdf') { // Umar added this on 13th August 2026
                mappedName = SHCEME_NAME_MAPPING[oldName] || oldName;
            }

            if (mappedName !== null && mappedName !== undefined) {
                mappedName = String(mappedName).trim();
            }

            var matchField = (targetMatchField && String(targetMatchField).trim())
                ? String(targetMatchField).trim()
                : 'name';

            var targetSearch;

            if (targetRecordType === 'customrecord_ci_adv_pros_profile') {
                var profileLookup = getPaymentProfileId(mappedName, oldProfileCode);

                log.audit({
                    title: 'Payment Profile Lookup',
                    details: profileLookup
                });

                if (!profileLookup) {

                    return {
                        targetId: null,
                        profileCode: oldProfileCode,
                        profileName: oldName,
                        mappingFound: false
                    };
                }

                return {
                    targetId: profileLookup.paymentProfileId,
                    profileCode: oldProfileCode,
                    profileName: oldName,
                    autoCreated: false
                };

            } else {

                targetSearch = search.create({
                    type: targetRecordType,
                    filters: [
                        [matchField, 'is', mappedName]
                    ],
                    columns: [
                        'internalid',
                        matchField
                    ]
                }).run().getRange(0, 1); // Umar added this on 13th August 2026.
                log.debug("targetId", targetSearch && targetSearch.length > 0 ? targetSearch[0].id : 0);// Umar added this on 13th August 2026.
                return { // Umar added this on 13th August 2026.
                    targetId: targetSearch && targetSearch.length > 0 ? targetSearch[0].id : 0 // Umar added this on 13th August 2026.
                } // Umar added this on 13th August 2026.
            }

        } catch (e) {
            log.error({
                title: 'Reference Mapping Error',
                details: {
                    oldInternalId: oldInternalId, sourceRecordType: sourceRecordType,
                    targetRecordType: targetRecordType, errorName: e.name, errorMessage: e.message
                }
            });
            return null;
        }
    }

    function getRoutingIdentifierFromProfile(profileId, mappedData) {

        if (!profileId) {
            return null;
        }

        try {

            var lookup = search.lookupFields({
                type: 'customrecord_ci_adv_pros_profile',
                id: profileId,
                columns: ['custrecord_ci_adv_profile_json']
            });

            var profileJson = lookup.custrecord_ci_adv_profile_json;

            if (!profileJson) {
                return null;
            }

            var json = JSON.parse(profileJson);

            if (!json.fieldDetails || !json.fieldDetails.length) {
                return null;
            }

            var routingField = null;

            // Find Routing Identifier field in Profile JSON
            for (var i = 0; i < json.fieldDetails.length; i++) {

                var field = json.fieldDetails[i];

                if ((field.fieldName || '').toUpperCase() === 'ROUTING IDENTIFIER') {
                    routingField = field;
                    break;
                }
            }

            // New Requirement:
            // If Routing Identifier field is not present in JSON
            // do NOT set Routing Identifier on VBD record.
            if (!routingField) {
                return null;
            }

            if (!routingField.defaultValue) {
                return null;
            }

            var routingDefault = normalizeRoutingKey(routingField.defaultValue);

            var branchNumber = mappedData['custrecord_ci_adv_branch_number'];

            var bicCode = mappedData['custrecord_ci_adv_bank_bic'];

            var hasBranch =
                branchNumber !== null &&
                branchNumber !== undefined &&
                String(branchNumber).trim() !== '';

            var hasBic =
                bicCode !== null &&
                bicCode !== undefined &&
                String(bicCode).trim() !== '';

            // ====================================================
            // CASE 1
            // Routing Identifier Default = Bank Branch Number
            //
            // If Branch Number missing and BIC exists
            // => use SWIFT / BIC
            //
            // Else keep default as Bank Branch Number
            // ====================================================

            if (routingDefault === 'bank branch number' ||
                routingDefault === 'branch number') {

                if (!hasBranch && hasBic) {

                    log.audit({
                        title: 'Routing Identifier Fallback',
                        details: {
                            profileId: profileId,
                            defaultRouting: 'Bank Branch Number',
                            reason: 'Bank Branch Number missing, using SWIFT / BIC'
                        }
                    });

                    return 'SWIFT / BIC';
                }

                return 'Bank Branch Number';
            }

            // ====================================================
            // CASE 2
            // Routing Identifier Default = SWIFT / BIC
            //
            // If BIC missing and Branch Number exists
            // => use Bank Branch Number
            //
            // Else keep default as SWIFT / BIC
            // ====================================================

            if (routingDefault === 'swift / bic' ||
                routingDefault === 'swift/bic' ||
                routingDefault === 'swift bic' ||
                routingDefault === 'bic' ||
                routingDefault === 'swift') {

                if (!hasBic && hasBranch) {

                    log.audit({
                        title: 'Routing Identifier Fallback',
                        details: {
                            profileId: profileId,
                            defaultRouting: 'SWIFT / BIC',
                            reason: 'BIC missing, using Bank Branch Number'
                        }
                    });

                    return 'Bank Branch Number';
                }

                return 'SWIFT / BIC';
            }

            // Any other Routing Identifier default value
            return null;

        } catch (e) {

            log.error({
                title: 'Invalid Payment Profile JSON',
                details: {
                    profileId: profileId,
                    error: e.message
                }
            });

            var profileLookup = search.lookupFields({
                type: 'customrecord_ci_adv_pros_profile',
                id: profileId,
                columns: ['custrecord_ci_adv_code.name']
            });

            var profileCode = extractLookupText(profileLookup['custrecord_ci_adv_code.name']) || profileId;

            throw new Error(
                'Invalid Payment Profile JSON for Payment Profile "' +
                profileCode +
                '": ' +
                e.message
            );
        }
    }
    function getPaymentProfileId(profileCode, oldProfileCode) {

        if (!profileCode) {
            return null;
        }

        var codeSearch = search.create({
            type: 'customrecord_ci_adv_prof_cd_list_sdf',
            filters: [
                ['name', 'is', profileCode]
            ],
            columns: [
                'internalid'
            ]
        });

        var codeResults = codeSearch.run().getRange({
            start: 0,
            end: 100
        });

        if (!codeResults.length) {
            return null;
        }

        for (var i = 0; i < codeResults.length; i++) {

            var profileCodeId = codeResults[i].getValue('internalid');

            log.audit({
                title: 'Checking Profile Code',
                details: {
                    profileCode: profileCode,
                    profileCodeId: profileCodeId
                }
            });

            var profileSearch = search.create({
                type: 'customrecord_ci_adv_pros_profile',
                filters: [
                    ['custrecord_ci_adv_code', 'anyof', profileCodeId]
                ],
                columns: [
                    'internalid',
                    'isinactive'
                ]
            });
            var profileResults = profileSearch.run().getRange({
                start: 0,
                end: 2
            });

            log.audit({
                title: 'Payment Profile Search Result',
                details: {
                    profileCode: profileCode,
                    profileCodeId: profileCodeId,
                    resultCount: profileResults.length
                }
            });

            if (profileResults.length > 1) {
                log.audit({
                    title: 'Duplicate Payment Profiles Found',
                    details: {
                        profileCodeId: profileCodeId,
                        profileCode: profileCode,
                        count: profileResults.length
                    }
                });
            }

            if (!profileResults.length) {
                continue;
            }

            var paymentProfileId = profileResults[0].getValue('internalid');
            var inactive = profileResults[0].getValue('isinactive');

            log.audit({
                title: 'Payment Profile Found',
                details: {
                    paymentProfileId: paymentProfileId,
                    inactive: inactive
                }
            });

            if (inactive === true || inactive === 'T') {

                if (!shouldAutoActivateProfile(profileCode)) {
                    continue;
                }

                try {

                    record.submitFields({
                        type: 'customrecord_ci_adv_pros_profile',
                        id: paymentProfileId,
                        values: {
                            isinactive: false
                        }
                    });

                    log.audit({
                        title: 'Payment Profile Auto Activated',
                        details: {
                            paymentProfileId: paymentProfileId,
                            profileCode: oldProfileCode
                        }
                    });

                } catch (e) {

                    log.error({
                        title: 'Auto Activation Failed',
                        details: e
                    });

                    continue;
                }
            }

            return {
                paymentProfileId: paymentProfileId,
                profileCodeId: profileCodeId
            };
        }

        return null;
    }

    // ============================================================
    // EXPORTS
    // ============================================================

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };

});
