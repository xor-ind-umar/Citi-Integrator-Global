/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * VENDOR BANK DETAILS MIGRATION VALIDATION  (CORRECTED v5 + PROFILE FILTER)
 *
 * v5 FIX (routing identifier comparison):
 *  - ROOT CAUSE: The profile-config field custrecord_default_bank_routing_id
 *    stores a DISPLAY TEXT value ("Bank Branch Number"), while the CIA field
 *    custrecord_ci_adv_routing_id_vb is a CUSTOM LIST field that stores the
 *    list INTERNAL ID (1 or 2). The old resolveRoutingForProfileCode() took
 *    getValue() from the config field (the text) and treated it as the
 *    expected "id", then compared that text against the CIA internal id.
 *    Result: Expected id "Bank Branch Number" vs Actual id "1" -> permanent
 *    false mismatch even though both represent the same routing value.
 *  - The expected routing value is now converted into the custom-list
 *    internal id (via resolveRoutingListInternalId), mirroring exactly what
 *    the migration Map/Reduce does before setValue(). The comparison is now
 *    internal-id vs internal-id.
 *  - Migration logic is NOT touched. Only validation comparison logic changed.
 *
 * v4 FIX (count logic):
 *  - ROOT CAUSE: scope was driven by source saved search
 *    'customsearch_cua_vendor_bank_details', which only returns vendors
 *    NOT yet migrated (checkbox = F / empty). After a successful migration
 *    those vendors leave scope, so validation only ever saw failed/skipped
 *    vendors that have no CIA record -> 0 matched / N unmatched every run.
 *  - The scope is now driven by the MIGRATED CIA records themselves
 *    (custrecord_ci_created_via_cua_mig = T). Each CIA record is compared
 *    back to its source vendor. This makes matched counts populate correctly.
 *  - All previously-confirmed field/account-type/routing logic is preserved.
 *
 * ADD THIS — PAYMENT PROCESS PROFILE FILTER:
 *  - The dashboard's multiselect lets the user scope a migration/validation
 *    run to specific OLD CUA Payment Profiles. The main Suitelet writes the
 *    selected internal IDs into a short-lived N/cache entry
 *    (CIA_MIGRATION_SELECTED_PROFILES / selected_profiles) — the same
 *    entry the Vendor migration M/R already reads. This script now reads
 *    the same cache entry and, if populated, narrows the validation scope
 *    to only the migrated vendors whose old profile
 *    (custentity_xor_pay_vendor_pmt_mtd_sdf, already loaded into
 *    vrow['ref_profile_id']) is in the selected set.
 *  - If the cache entry is empty/missing, NO filter is applied and ALL
 *    migrated CIA records are validated (existing behavior, unchanged).
 */

define(['N/query', 'N/file', 'N/search', 'N/record', 'N/log', 'N/url', 'N/cache'],
    function (query, file, search, record, log, url, cache) {

        'use strict';

        var VERBOSE_LOGGING = true;
        var VERBOSE_VENDOR_LIMIT = 50;

        var REPORT_FOLDER_NAME = 'Citi Integrator Migration Error Report';
        var REPORT_FILE_PREFIX = 'Vendor_Bank_Validation_';

        var CIA_RECORD_TYPE = 'customrecord_ci_adv_entity_bank_details';
        var CIA_LINK_FIELD = 'custrecordci_adv_details';

        var SRC_PROFILE_RECORD = 'customrecord_xor_pay_pros_prfle_sdf';
        var SRC_PROFILE_CODE_FLD = 'custrecord_xor_pay_ppf_code_sdf';
        var SRC_PROFILE_CODE_LIST = 'customrecord_xor_pay_prof_cd_list_sdf';

        var VENDOR_PMT_PROFILE_FLD = 'custentity_xor_pay_vendor_pmt_mtd_sdf';

        var SRC_ACCT_TYPE_RECORD = 'customrecord_xor_pay_dbt_acc_ty_lt_sdf';
        var SRC_ACCT_TYPE_CODE_FLD = 'custrecord_xor_pay_vend_bk_acc_ty_cd_sdf';

        var VENDOR_ACCT_TYPE_FLD = 'custentity_xor_pay_bank_acct_type_sdf';

        var TGT_ACCT_TYPE_RECORD = 'customrecord_ci_adv_bk_acc_ty_lt';
        var TGT_ACCT_TYPE_CODE_FLD = 'custrecord_ci_adv_bk_acc_type_code';

        var CIA_ACCT_TYPE_FLD = 'custrecord_ci_bank_acct_type';

        var VENDOR_DELIVERY_FLD = 'custentity_xor_pay_delivery_method_sdf';
        var CIA_DELIVERY_FLD = 'custrecord_ci_adv_delivery_methd';

        var PROFILE_CONFIG_RECORD = 'customrecord_ci_profile_mig_config';
        var PROFILE_CONFIG_SOURCE_PROFILE = 'custrecord_source_profile';
        var PROFILE_CONFIG_IN_SCOPE = 'custrecord_in_scope';
        var PROFILE_CONFIG_ROUTING = 'custrecord_default_bank_routing_id';

        var CIA_PROFILE_REF_FLD = 'custrecord_ci_adv_profile_name';
        var CI_PROS_PROFILE_RECORD = 'customrecord_ci_adv_pros_profile';
        var CI_PROS_PROFILE_CODE_FLD = 'custrecord_ci_adv_code';
        var CIA_PROFILE_CODE_LIST = 'customrecord_ci_adv_prof_cd_list_sdf';

        var CIA_ROUTING_FLD = 'custrecord_ci_adv_routing_id_vb';
        var CIA_PRIMARY_FLAG = 'custrecord_ci_adv_primary_account';
        var CIA_CREATED_VIA_MIG_FLAG = 'custrecord_ci_created_via_cua_mig';

        // v5 FIX: the custom list that backs CIA_ROUTING_FLD. The CIA field
        // stores the INTERNAL ID of this list (1 = Bank Branch Number,
        // 2 = SWIFT / BIC), NOT the display text.
        var ROUTING_LIST_TYPE = 'customlist_routing_identifier_list';

        // v5 FIX: fallback text -> internal id map (matches NetSuite XML).
        // Used only if the live list search cannot resolve the value.
        var ROUTING_TEXT_TO_ID_FALLBACK = {
            'BANK BRANCH NUMBER': '1',
            'SWIFT / BIC': '2',
            'SWIFT/BIC': '2'
        };

        // ADD THIS — Payment Process Profile filter cache (same name/key
        // the main dashboard Suitelet and Vendor migration M/R already use).
        var SELECTED_PROFILES_CACHE_NAME = 'CIA_MIGRATION_SELECTED_PROFILES';
        var SELECTED_PROFILES_CACHE_KEY = 'selected_profiles';

        function getSelectedProfileIds() {
            try {
                var profileCache = cache.getCache({
                    name: SELECTED_PROFILES_CACHE_NAME,
                    scope: cache.Scope.PROTECTED
                });
                var raw = profileCache.get({
                    key: SELECTED_PROFILES_CACHE_KEY,
                    loader: function () { return ''; } // no cached value = no filter
                });
                if (!raw) return null; // null = no filter, validate everything migrated
                var ids = String(raw)
                    .split(',')
                    .map(function (s) { return s.trim(); })
                    .filter(Boolean);
                return ids.length ? ids : null;
            } catch (e) {
                err('PROFILE_FILTER', 'getSelectedProfileIds error', { message: e.message });
                return null; // fail open — never block validation on a cache read error
            }
        }

        // ---- categories that count as a HARD (unmatched) issue ----
        var HARD_CATEGORIES = {
            'Field Mismatch': true,
            'Missing Record': true
        };

        function isHardCategory(cat) {
            return !!HARD_CATEGORIES[cat];
        }

        var RUN_ID = 'RUN-' + new Date().getTime();
        var _verboseVendorCount = 0;

        function dbg(tag, title, details) { log.debug({ title: '[' + RUN_ID + '][' + tag + '] ' + title, details: details }); }
        function aud(tag, title, details) { log.audit({ title: '[' + RUN_ID + '][' + tag + '] ' + title, details: details }); }
        function err(tag, title, details) { log.error({ title: '[' + RUN_ID + '][' + tag + '] ' + title, details: details }); }
        function vdbg(tag, title, details) { if (!VERBOSE_LOGGING) return; log.debug({ title: '[' + RUN_ID + '][V][' + tag + '] ' + title, details: details }); }
        function shouldVerboseVendor() { return VERBOSE_LOGGING && _verboseVendorCount < VERBOSE_VENDOR_LIMIT; }

        var FIELD_MAP = [
            { sourceField: 'custentity_xor_pay_bank_acct_no_sdf', targetField: 'custrecord_ci_adv_account_number', label: 'Bank Account Number', type: 'equal' },
            { sourceField: 'custentity_xor_pay_bank_acc_name_sdf', targetField: 'custrecord_ci_adv_bank_acct_name', label: 'Bank Account Name', type: 'equal' },
            { sourceField: 'custentity_xor_pay_bank_branch_no_sdf', targetField: 'custrecord_ci_adv_branch_number', label: 'Bank Branch Number', type: 'equal' },
            { sourceField: 'custentity_xor_pay_mem_id_sdf', targetField: 'custrecord_ci_adv_bank_bic', label: 'Bank BIC / Member ID', type: 'equal' },
            { sourceField: 'custentity_xor_pay_vendor_bank_addr1_sdf', targetField: 'custrecord_ci_adv_bank_addr1', label: 'Bank Address Line 1', type: 'equal' },
            { sourceField: 'custentity_xor_pay_bank_address_2_sdf', targetField: 'custrecord_ci_adv_bank_addr2', label: 'Bank Address Line 2', type: 'equal' },
            { sourceField: 'custentity_xor_pay_bank_name_sdf', targetField: 'custrecord_ci_adv_bank_name', label: 'Bank Name', type: 'equal' },
            { sourceField: 'custentity_xor_pay_spl_hd_cd_sdf', targetField: 'custrecord_ci_adv_spl_handl_code', label: 'Special Handling Code', type: 'equal' },
            { sourceField: 'custentity_xor_pay_form_code_sdf', targetField: 'custrecord_ci_adv_form_code1', label: 'Form Code', type: 'equal' },
            { sourceField: 'custentity_xor_pay_vendor_temp_name_sdf', targetField: 'custrecord_ci_adv_template_name1', label: 'Template Name', type: 'equal' },
            { sourceField: 'custentity_xor_pay_vend_post_urid_sdf', targetField: 'custrecord_ci_adv_delivery_post_urid', label: 'Delivery Post URID', type: 'equal' },
            { sourceField: 'custentity_xor_pay_vendor_iban_sdf', targetField: 'custrecord_ci_adv_vbd_bank_iban', label: 'Bank IBAN', type: 'equal' },
            { sourceField: 'custentity_xor_pay_vendor_dob_sdf', targetField: 'custrecord_ci_adv_vendor_dob', label: 'Vendor Date of Birth', type: 'date' }
        ];

        var SEPA_PROFILE_NUMBERS = ['795', '848', '938', '939'];

        var ACCOUNT_TYPE_MAPPING = {
            'Checking': 'CACC', 'Current a/c': 'CACC', 'Current': 'CACC', 'CACC': 'CACC',
            'Savings': 'SVGS', 'Saving': 'SVGS', 'Savings a/c': 'SVGS', 'Salary': 'SVGS',
            'Non Resident': 'SVGS', 'Resident': 'SVGS'
        };

        var DELIVERY_METHOD_MAPPING = {
            'EMAIL': 'Email', 'Email': 'Email', 'EMAL': 'Email',
            'FAX': 'Fax', 'Fax': 'Fax', 'FAXI': 'Fax',
            'POST': 'POST', 'Mobile': 'Mobile', 'FPS': 'FPS',
            'CRCD': 'CRCD', 'CRDB': 'CRDB',
            'Organization Identifier': 'Organization Identifier',
            'Oraganization Number': 'Oraganization Number',
            'Australian Business Number': 'Australian Business Number',
            'IND Legal Entity Identifier Reg.': 'IND Legal Entity Identifier Reg.'
        };

        function mapProfileCode(oldCode) {
            if (!oldCode) return '';
            if (oldCode.indexOf('CITIUA_') !== 0) return oldCode;
            var parts = oldCode.split('_');
            if (parts.length < 3) return oldCode.replace('CITIUA_', 'CITI_');
            var country = parts[1];
            var cleanProfileNum = parts[2].replace('-STD', '');
            var isSEPA = false;
            for (var i = 0; i < SEPA_PROFILE_NUMBERS.length; i++) {
                if (cleanProfileNum === SEPA_PROFILE_NUMBERS[i]) { isSEPA = true; break; }
            }
            var newParts = ['CITI'];
            newParts.push(isSEPA ? 'SEPA' : country);
            newParts.push(cleanProfileNum);
            for (var j = 3; j < parts.length; j++) newParts.push(parts[j]);
            return newParts.join('_');
        }

        function onRequest(context) {
            var startTime = new Date().getTime();
            try {
                aud('START', 'Vendor Bank Validation Started', {
                    runId: RUN_ID, method: context.request.method,
                    params: context.request.parameters, verboseLogging: VERBOSE_LOGGING
                });

                var activeMappings = getActiveMappings();
                aud('MAPPINGS', 'Active field mappings resolved', {
                    activeCount: activeMappings.length, totalDefined: FIELD_MAP.length
                });

                // ============================================================
                // v4 FIX: scope is driven by MIGRATED CIA records, not the
                // source saved search. Load all CIA bank-detail records that
                // were created via the CUA migration, keyed by their linked
                // vendor id. Each becomes one validated unit.
                // ============================================================
                var ciaByVendor = loadMigratedCiaRecords(activeMappings);
                var scopeVendorIds = Object.keys(ciaByVendor);

                aud('SCOPE', 'Migrated CIA scope resolved', {
                    migratedCiaCount: scopeVendorIds.length
                });

                if (scopeVendorIds.length === 0) {
                    var emptyFileId = buildCsv([], 0, 0);
                    return writeResponse(context, {
                        status: 'complete', records_validated: 0,
                        validated_count: 0, unvalidated_count: 0, file_id: emptyFileId
                    }, { validated: 0, matched: 0, unmatched: 0 });
                }

                var vendorRows = loadVendorRows(scopeVendorIds, activeMappings);
                aud('VENDOR', 'Vendor source rows loaded', {
                    vendorRowKeys: Object.keys(vendorRows).length, inScope: scopeVendorIds.length
                });

                // ============================================================
                // ADD THIS — PAYMENT PROCESS PROFILE FILTER
                //
                // vrow['ref_profile_id'] (set below in loadVendorRows, from
                // VENDOR_PMT_PROFILE_FLD) is the vendor's OLD CUA Payment
                // Profile — the exact same field/value the dashboard
                // multiselect and Vendor migration M/R already filter on.
                // If a selection is active, narrow scopeVendorIds to just
                // those vendors before running any comparison logic.
                // ============================================================
                var selectedProfileIds = getSelectedProfileIds();
                if (selectedProfileIds) {
                    var beforeFilterCount = scopeVendorIds.length;
                    scopeVendorIds = scopeVendorIds.filter(function (vendorId) {
                        var vrow = vendorRows[vendorId];
                        // Missing source vendor is itself a validation issue —
                        // don't let the profile filter hide it.
                        if (!vrow) return true;
                        var profileId = vrow['ref_profile_id'];
                        return profileId && selectedProfileIds.indexOf(String(profileId)) !== -1;
                    });
                    aud('PROFILE_FILTER', 'Scope filtered by selected Payment Process Profiles', {
                        selectedProfileIds: selectedProfileIds,
                        beforeFilterCount: beforeFilterCount,
                        afterFilterCount: scopeVendorIds.length
                    });
                } else {
                    aud('PROFILE_FILTER', 'No profile filter active - validating all migrated vendors', {});
                }

                if (scopeVendorIds.length === 0) {
                    var emptyFilteredFileId = buildCsv([], 0, 0);
                    return writeResponse(context, {
                        status: 'complete', records_validated: 0,
                        validated_count: 0, unvalidated_count: 0, file_id: emptyFilteredFileId
                    }, { validated: 0, matched: 0, unmatched: 0, profileFiltered: !!selectedProfileIds });
                }
                // ─────────────────────────────────────────────────────────────

                // v5 FIX: added routingIdByText cache so the text->internalId
                // resolution is only done once per distinct routing text.
                var caches = {
                    profileCodeByProfileId: {},
                    routingByProfileCode: {},
                    ciaProfileCodeByRefId: {},
                    routingIdByText: {}
                };

                var validationResults = [];
                var missingVendorCount = 0;
                var withHardIssuesCount = 0;
                var withWarningsOnlyCount = 0;

                var hardFieldTally = {};

                scopeVendorIds.forEach(function (vendorId) {

                    var cia = ciaByVendor[vendorId];
                    var vrow = vendorRows[vendorId];

                    // CIA record exists but its source vendor cannot be loaded.
                    if (!vrow) {
                        missingVendorCount++;
                        withHardIssuesCount++;
                        validationResults.push({
                            sourceid: vendorId, targetid: cia.id,
                            hardIssue: true,
                            failedFields: [{
                                field: 'Source Vendor', category: 'Missing Record',
                                source: 'No source vendor found for id ' + vendorId,
                                target: 'CIA record ' + cia.id,
                                description: 'A migrated bank record exists, but its linked source vendor could not be loaded for comparison.'
                            }]
                        });
                        tallyHard(hardFieldTally, 'Source Vendor (Missing)');
                        return;
                    }

                    var failedFields = [];
                    var verboseThisVendor = shouldVerboseVendor();
                    if (verboseThisVendor) _verboseVendorCount++;

                    activeMappings.forEach(function (m) {

                        // Routing Identifier
                        var routingId = String(cia[CIA_ROUTING_FLD] || '').trim();

                        // If routing is Bank Branch Number, ignore BIC validation
                        if (routingId === '1' &&
                            m.targetField === 'custrecord_ci_adv_bank_bic') {
                            return;
                        }

                        // If routing is SWIFT / BIC, ignore Branch Number validation
                        if (routingId === '2' &&
                            m.targetField === 'custrecord_ci_adv_branch_number') {
                            return;
                        }

                        var srcRaw = vrow['src_' + m.sourceField];
                        var tgtRaw = cia[m.targetField];

                        var ok = (m.type === 'date')
                            ? sameDate(srcRaw, tgtRaw)
                            : same(srcRaw, tgtRaw);

                        if (!ok) {
                            failedFields.push({
                                field: m.label,
                                category: 'Field Mismatch',
                                source: displayValue(srcRaw),
                                target: displayValue(tgtRaw),
                                description: buildMismatchDescription(m.label, srcRaw, tgtRaw)
                            });
                        }
                    });

                    validateAccountType(vendorId, vrow, cia, failedFields, verboseThisVendor);
                    validateDeliveryMethod(vendorId, vrow, cia, failedFields, verboseThisVendor);
                    validateProfileAndRouting(vendorId, vrow, cia, failedFields, caches, verboseThisVendor);

                    if (!isTrue(cia[CIA_PRIMARY_FLAG])) {
                        failedFields.push({
                            field: 'Primary Account Flag', category: 'Flag Warning',
                            source: 'Expected: T', target: displayValue(cia[CIA_PRIMARY_FLAG]),
                            description: 'The migrated bank record is not marked as the Primary Account. Review if this account should be primary.'
                        });
                    }
                    if (!isTrue(cia[CIA_CREATED_VIA_MIG_FLAG])) {
                        failedFields.push({
                            field: 'Created Via CUA Migration Flag', category: 'Flag Warning',
                            source: 'Expected: T', target: displayValue(cia[CIA_CREATED_VIA_MIG_FLAG]),
                            description: 'This record is not flagged as created by the CUA migration process.'
                        });
                    }

                    if (failedFields.length) {
                        var hardOnes = failedFields.filter(function (f) { return isHardCategory(f.category); });
                        var hasHard = hardOnes.length > 0;
                        if (hasHard) {
                            withHardIssuesCount++;
                            hardOnes.forEach(function (f) { tallyHard(hardFieldTally, f.field); });
                            if (verboseThisVendor) {
                                vdbg('UNMATCH', 'Vendor ' + vendorId + ' has HARD issues', {
                                    vendorId: vendorId, ciaId: cia.id,
                                    hardFields: hardOnes.map(function (f) {
                                        return { field: f.field, source: f.source, target: f.target };
                                    })
                                });
                            }
                        } else {
                            withWarningsOnlyCount++;
                        }

                        validationResults.push({
                            sourceid: vendorId, targetid: cia.id,
                            hardIssue: hasHard, failedFields: failedFields
                        });
                    }
                });

                // ---- COUNTS (driven by migrated CIA population) ----
                var totalValidated = scopeVendorIds.length;
                var unmatchedCount = withHardIssuesCount;
                var matchedCount = totalValidated - unmatchedCount;

                aud('SUMMARY', 'Validation complete', {
                    migratedCiaValidated: totalValidated,
                    missingSourceVendor: missingVendorCount,
                    withHardIssues: withHardIssuesCount,
                    withWarningsOnly: withWarningsOnlyCount,
                    matched: matchedCount, unmatched: unmatchedCount,
                    hardFieldTally: hardFieldTally,
                    profileFiltered: !!selectedProfileIds,
                    elapsedMs: (new Date().getTime() - startTime)
                });

                var fileId = buildCsv(validationResults, matchedCount, unmatchedCount);

                return writeResponse(context, {
                    status: 'complete',
                    records_validated: totalValidated,
                    validated_count: matchedCount,
                    unvalidated_count: unmatchedCount,
                    file_id: fileId
                }, { validated: totalValidated, matched: matchedCount, unmatched: unmatchedCount, hardFieldTally: hardFieldTally, profileFiltered: !!selectedProfileIds });

            } catch (e) {
                err('FATAL', 'Vendor Bank Validation Error', { name: e.name, message: e.message, stack: e.stack });
                context.response.write(JSON.stringify({
                    status: 'error', records_validated: 0, validated_count: 0,
                    unvalidated_count: 0, file_id: null,
                    error: (e.name ? e.name + ': ' : '') + e.message, run_id: RUN_ID
                }, null, 4));
            }
        }

        function tallyHard(tally, key) {
            tally[key] = (tally[key] || 0) + 1;
        }

        // ============================================================
        // v4: Load CIA records created via migration, keyed by vendor id.
        // This is the authoritative validation population.
        // ============================================================
        function loadMigratedCiaRecords(activeMappings) {
            var map = {};
            var cols = [CIA_LINK_FIELD];
            activeMappings.forEach(function (m) { cols.push(m.targetField); });
            cols.push(CIA_ACCT_TYPE_FLD, CIA_DELIVERY_FLD, CIA_PROFILE_REF_FLD,
                CIA_ROUTING_FLD, CIA_PRIMARY_FLAG, CIA_CREATED_VIA_MIG_FLAG);

            var uniqueCols = [];
            cols.forEach(function (c) {
                if (c && c !== 'id' && c !== 'internalid' && uniqueCols.indexOf(c) === -1) uniqueCols.push(c);
            });

            var totalLoaded = 0, dupCount = 0, noVendorLink = 0;
            var sampleKeys = [];

            var ciaSearch = search.create({
                type: CIA_RECORD_TYPE,
                // Only records produced by the migration. This is what the
                // dashboard "Migrated Records" count also represents.
                filters: [[CIA_CREATED_VIA_MIG_FLAG, 'is', 'T']],
                columns: uniqueCols.map(function (c) { return search.createColumn({ name: c }); })
            });

            var paged = ciaSearch.runPaged({ pageSize: 1000 });
            paged.pageRanges.forEach(function (pr) {
                var page = paged.fetch({ index: pr.index });
                page.data.forEach(function (res) {
                    var vendorId = String(res.getValue({ name: CIA_LINK_FIELD }) || '');
                    if (!vendorId) { noVendorLink++; return true; }

                    var obj = { id: res.id };
                    uniqueCols.forEach(function (c) {
                        obj[c] = res.getValue({ name: c });
                        try { obj[c + '__text'] = res.getText({ name: c }); }
                        catch (txtErr) { obj[c + '__text'] = ''; }
                    });

                    if (!map[vendorId]) {
                        map[vendorId] = obj;
                        totalLoaded++;
                        if (sampleKeys.length < 10) sampleKeys.push(vendorId);
                    } else {
                        // Keep the primary account if duplicates exist.
                        if (isTrue(obj[CIA_PRIMARY_FLAG]) && !isTrue(map[vendorId][CIA_PRIMARY_FLAG])) {
                            map[vendorId] = obj;
                        }
                        dupCount++;
                    }
                    return true;
                });
            });

            aud('CIA', 'Migrated CIA load finished', {
                vendorsWithCia: totalLoaded,
                duplicateCiaIgnored: dupCount,
                ciaWithNoVendorLink: noVendorLink,
                sampleCiaVendorKeys: sampleKeys
            });
            return map;
        }

        function loadVendorRows(vendorIds, activeMappings) {
            var rows = {};
            var cols = ['internalid'];
            activeMappings.forEach(function (m) { cols.push(m.sourceField); });
            cols.push(VENDOR_ACCT_TYPE_FLD, VENDOR_DELIVERY_FLD, VENDOR_PMT_PROFILE_FLD);

            var uniqueCols = [];
            cols.forEach(function (c) { if (uniqueCols.indexOf(c) === -1) uniqueCols.push(c); });

            var chunks = chunkArray(vendorIds, 1000);
            var totalLoaded = 0;

            chunks.forEach(function (chunk) {
                var vSearch = search.create({
                    type: search.Type.VENDOR,
                    filters: [['internalid', 'anyof', chunk]],
                    columns: uniqueCols.map(function (c) { return search.createColumn({ name: c }); })
                });
                var paged = vSearch.runPaged({ pageSize: 1000 });
                paged.pageRanges.forEach(function (pr) {
                    var page = paged.fetch({ index: pr.index });
                    page.data.forEach(function (res) {
                        var vid = String(res.id);
                        var obj = {};
                        activeMappings.forEach(function (m) {
                            obj['src_' + m.sourceField] = res.getValue({ name: m.sourceField });
                        });
                        obj['ref_acctType_id'] = res.getValue({ name: VENDOR_ACCT_TYPE_FLD });
                        obj['ref_acctType_text'] = safeGetText(res, VENDOR_ACCT_TYPE_FLD);
                        obj['ref_delivery_id'] = res.getValue({ name: VENDOR_DELIVERY_FLD });
                        obj['ref_delivery_text'] = safeGetText(res, VENDOR_DELIVERY_FLD);
                        obj['ref_profile_id'] = res.getValue({ name: VENDOR_PMT_PROFILE_FLD });
                        obj['ref_profile_text'] = safeGetText(res, VENDOR_PMT_PROFILE_FLD);
                        rows[vid] = obj;
                        totalLoaded++;
                        return true;
                    });
                });
            });

            aud('VENDOR', 'Vendor load finished', { vendorsLoaded: totalLoaded, requested: vendorIds.length });
            return rows;
        }

        function safeGetText(res, fieldId) {
            try { return res.getText({ name: fieldId }); }
            catch (e) { return ''; }
        }

        function resolveSourceAccountTypeCode(srcRefId, srcName) {
            var rawCode = '';
            var codeFromField = false;
            if (exists(srcRefId)) {
                rawCode = lookupSingle(SRC_ACCT_TYPE_RECORD, srcRefId, SRC_ACCT_TYPE_CODE_FLD);
                if (exists(rawCode)) { codeFromField = true; }
            }
            if (!exists(rawCode)) {
                var nm = String(srcName || '').trim();
                rawCode = ACCOUNT_TYPE_MAPPING[nm] || '';
            }
            return { code: String(rawCode).trim(), fromCodeField: codeFromField };
        }

        function eqCode(a, b) {
            return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
        }

        function nameHasMapping(name) {
            return !!ACCOUNT_TYPE_MAPPING[String(name || '').trim()];
        }

        function validateAccountType(vendorId, vrow, cia, failedFields, verbose) {
            var srcRefId = vrow['ref_acctType_id'];
            var tgtRefId = cia[CIA_ACCT_TYPE_FLD];
            var srcHas = exists(srcRefId), tgtHas = exists(tgtRefId);
            if (!srcHas && !tgtHas) return;

            var srcResolved = srcHas
                ? resolveSourceAccountTypeCode(srcRefId, vrow['ref_acctType_text'])
                : { code: '', fromCodeField: false };
            var srcCode = srcResolved.code;
            var srcName = String(vrow['ref_acctType_text'] || '').trim();

            if (srcHas && !tgtHas) {
                var derivable = exists(srcCode) && (srcResolved.fromCodeField || nameHasMapping(srcName));
                failedFields.push({
                    field: 'Bank Account Type',
                    category: derivable ? 'Field Mismatch' : 'Expected Warning - Unmapped',
                    source: displayValue(srcName) + ' (code: ' + displayValue(srcCode) +
                        (srcResolved.fromCodeField ? '' : ' [from name fallback]') + ')',
                    target: derivable ? 'Blank (expected mapped value)' : 'Blank (no mapping - left empty by migration)',
                    description: derivable
                        ? 'The source vendor account type "' + displayValue(srcName) + '" (code ' + displayValue(srcCode) + ') was not copied to the migrated record.'
                        : 'The source account type "' + displayValue(srcName) + '" has no code and no name mapping, so it was intentionally left blank.'
                });
                return;
            }

            if (!srcHas && tgtHas) {
                var addedCode = lookupSingle(TGT_ACCT_TYPE_RECORD, tgtRefId, TGT_ACCT_TYPE_CODE_FLD);
                failedFields.push({
                    field: 'Bank Account Type', category: 'Expected Warning - Value Added',
                    source: 'Blank / Empty',
                    target: displayValue(cia[CIA_ACCT_TYPE_FLD + '__text']) + ' (code: ' + displayValue(addedCode) + ')',
                    description: 'Source vendor has no account type, but migrated record has "' + displayValue(addedCode) + '". Review if expected.'
                });
                return;
            }

            var tgtCode = lookupSingle(TGT_ACCT_TYPE_RECORD, tgtRefId, TGT_ACCT_TYPE_CODE_FLD);

            if (!exists(srcCode)) {
                failedFields.push({
                    field: 'Bank Account Type', category: 'Expected Warning - Unmapped',
                    source: displayValue(srcName) + ' (no derivable code)',
                    target: displayValue(cia[CIA_ACCT_TYPE_FLD + '__text']) + ' (code: ' + displayValue(tgtCode) + ')',
                    description: 'Source account type "' + displayValue(srcName) + '" has no code or mapping; cannot validate against migrated code "' + displayValue(tgtCode) + '".'
                });
                return;
            }

            if (!eqCode(srcCode, tgtCode)) {
                failedFields.push({
                    field: 'Bank Account Type', category: 'Field Mismatch',
                    source: displayValue(srcName) + ' (code: ' + displayValue(srcCode) +
                        (srcResolved.fromCodeField ? '' : ' [from name fallback]') + ')',
                    target: displayValue(cia[CIA_ACCT_TYPE_FLD + '__text']) + ' (code: ' + displayValue(tgtCode) + ')',
                    description: 'Account type mismatch. Expected code "' + displayValue(srcCode) + '" but migrated record has "' + displayValue(tgtCode) + '".'
                });
            }
        }

        function validateDeliveryMethod(vendorId, vrow, cia, failedFields, verbose) {
            var srcRefId = vrow['ref_delivery_id'];
            var tgtRefId = cia[CIA_DELIVERY_FLD];
            var srcHas = exists(srcRefId), tgtHas = exists(tgtRefId);
            if (!srcHas && !tgtHas) return;

            var srcText = String(vrow['ref_delivery_text'] || '').trim();
            var expectedName = DELIVERY_METHOD_MAPPING[srcText] || srcText;

            if (srcHas && !tgtHas) {
                var mappedExists = !!DELIVERY_METHOD_MAPPING[srcText];
                failedFields.push({
                    field: 'Delivery Method',
                    category: mappedExists ? 'Field Mismatch' : 'Expected Warning - Unmapped',
                    source: displayValue(srcText) + ' (expected: ' + displayValue(expectedName) + ')',
                    target: mappedExists ? 'Blank (expected mapped value)' : 'Blank (no mapping - left empty by migration)',
                    description: mappedExists
                        ? 'Source delivery method "' + displayValue(srcText) + '" (-> "' + displayValue(expectedName) + '") was not copied.'
                        : 'Source delivery method "' + displayValue(srcText) + '" has no mapping; left blank intentionally.'
                });
                return;
            }

            if (!srcHas && tgtHas) {
                failedFields.push({
                    field: 'Delivery Method', category: 'Expected Warning - Value Added',
                    source: 'Blank / Empty',
                    target: displayValue(cia[CIA_DELIVERY_FLD + '__text']),
                    description: 'Source vendor has no delivery method, but migrated record has "' + displayValue(cia[CIA_DELIVERY_FLD + '__text']) + '". Review if expected.'
                });
                return;
            }

            var tgtName = String(cia[CIA_DELIVERY_FLD + '__text'] || '').trim();
            if (expectedName.trim().toUpperCase() !== tgtName.trim().toUpperCase()) {
                failedFields.push({
                    field: 'Delivery Method', category: 'Field Mismatch',
                    source: displayValue(srcText) + ' (expected: ' + displayValue(expectedName) + ')',
                    target: displayValue(tgtName),
                    description: 'Delivery method mismatch. Expected "' + displayValue(expectedName) + '" but got "' + displayValue(tgtName) + '".'
                });
            }
        }

        function validateProfileAndRouting(vendorId, vrow, cia, failedFields, caches, verbose) {
            var profileId = vrow['ref_profile_id'];
            var ciaProfileRefId = cia[CIA_PROFILE_REF_FLD];

            var ciaStoredCode = '';
            if (exists(ciaProfileRefId)) {
                if (caches.ciaProfileCodeByRefId[ciaProfileRefId] === undefined) {
                    caches.ciaProfileCodeByRefId[ciaProfileRefId] = resolveCiaProfileCode(ciaProfileRefId);
                }
                ciaStoredCode = String(caches.ciaProfileCodeByRefId[ciaProfileRefId] || '').trim();
            }

            if (!exists(profileId)) {
                if (exists(ciaStoredCode)) {
                    failedFields.push({
                        field: 'Payment Profile Code', category: 'Profile Warning',
                        source: 'Blank / Empty', target: displayValue(ciaStoredCode),
                        description: 'Source vendor has no payment profile, but migrated record has profile code "' + displayValue(ciaStoredCode) + '".'
                    });
                }
                return;
            }

            var originalCode = caches.profileCodeByProfileId[profileId];
            if (originalCode === undefined) {
                originalCode = resolveSourceProfileCode(profileId);
                caches.profileCodeByProfileId[profileId] = originalCode;
            }

            var expectedCode = mapProfileCode(String(originalCode || '').trim());

            if (!(!exists(expectedCode) && !exists(ciaStoredCode)) &&
                String(expectedCode).trim().toUpperCase() !== String(ciaStoredCode).trim().toUpperCase()) {
                failedFields.push({
                    field: 'Payment Profile Code', category: 'Field Mismatch',
                    source: displayValue(originalCode) +
                        (expectedCode && expectedCode !== originalCode ? ' (expected: ' + expectedCode + ')' : ''),
                    target: displayValue(ciaStoredCode),
                    description: 'Profile code mismatch. Source "' + displayValue(originalCode) + '" should convert to "' + displayValue(expectedCode) + '" but record has "' + displayValue(ciaStoredCode) + '".'
                });
            }

            var expectedRouting = caches.routingByProfileCode[originalCode];
            if (expectedRouting === undefined) {
                expectedRouting = resolveRoutingForProfileCode(originalCode, caches);
                caches.routingByProfileCode[originalCode] = expectedRouting;
            }

            var ciaRoutingId = String(cia[CIA_ROUTING_FLD] || '').trim();
            var ciaRoutingText = String(cia[CIA_ROUTING_FLD + '__text'] || '').trim();

            // ============================================================
            // v5 FIX: expectedRouting.id is now the CUSTOM LIST INTERNAL ID
            // (converted from the config field's display text), so we are
            // comparing internal-id vs internal-id, exactly like the
            // migration Map/Reduce stored it. The old code compared the
            // config display text ("Bank Branch Number") against the CIA
            // internal id ("1"), producing a permanent false mismatch.
            // ============================================================
            if (!exists(expectedRouting.id)) {
                if (exists(ciaRoutingId)) {
                    failedFields.push({
                        field: 'Bank Routing Identifier', category: 'Routing Warning',
                        source: 'No in-scope config (or unresolvable list value) for "' + displayValue(originalCode) + '"',
                        target: displayValue(ciaRoutingText || ciaRoutingId) + ' [id ' + displayValue(ciaRoutingId) + ']',
                        description: 'No in-scope migration config / resolvable routing list id for profile "' + displayValue(originalCode) + '", but record has routing "' + displayValue(ciaRoutingText || ciaRoutingId) + '". Confirm if expected.'
                    });
                }
                return;
            }

            // Internal-id vs internal-id comparison.
            if (String(expectedRouting.id).trim() !== ciaRoutingId) {
                failedFields.push({
                    field: 'Bank Routing Identifier', category: 'Field Mismatch',
                    source: 'Expected: ' + displayValue(expectedRouting.text || expectedRouting.id) + ' [id ' + displayValue(expectedRouting.id) + ', profile ' + displayValue(originalCode) + ']',
                    target: displayValue(ciaRoutingText || ciaRoutingId) + ' [id ' + displayValue(ciaRoutingId) + ']',
                    description: 'Routing mismatch (compared by custom-list internal id). Config expects internal id "' + displayValue(expectedRouting.id) + '" ("' + displayValue(expectedRouting.text || expectedRouting.id) + '") but record shows internal id "' + displayValue(ciaRoutingId) + '" ("' + displayValue(ciaRoutingText || ciaRoutingId) + '").'
                });
            }
        }

        function resolveCiaProfileCode(prosProfileId) {
            if (!exists(prosProfileId)) return '';
            try {
                var lk = search.lookupFields({ type: CI_PROS_PROFILE_RECORD, id: prosProfileId, columns: [CI_PROS_PROFILE_CODE_FLD] });
                var codeField = lk[CI_PROS_PROFILE_CODE_FLD];
                var codeListId = '', codeListText = '';
                if (Array.isArray(codeField) && codeField.length > 0) { codeListId = codeField[0].value; codeListText = codeField[0].text; }
                else if (codeField && typeof codeField === 'object') { codeListId = codeField.value; codeListText = codeField.text; }
                else { codeListText = codeField; }

                if (codeListText && !/^\d+$/.test(String(codeListText))) return String(codeListText).trim();
                if (codeListId && /^\d+$/.test(String(codeListId))) {
                    var nameLk = search.lookupFields({ type: CIA_PROFILE_CODE_LIST, id: codeListId, columns: ['name'] });
                    return String(nameLk.name || '').trim();
                }
                return '';
            } catch (e) {
                err('PROFILE', 'resolveCiaProfileCode error', { prosProfileId: prosProfileId, message: e.message });
                return '';
            }
        }

        function resolveSourceProfileCode(profileId) {
            try {
                var lk = search.lookupFields({ type: SRC_PROFILE_RECORD, id: profileId, columns: [SRC_PROFILE_CODE_FLD] });
                var pcField = lk[SRC_PROFILE_CODE_FLD];
                var pcId = '', pcText = '';
                if (Array.isArray(pcField) && pcField.length > 0) { pcId = pcField[0].value; pcText = pcField[0].text; }
                else if (pcField && typeof pcField === 'object') { pcId = pcField.value; pcText = pcField.text; }
                else { pcText = pcField; }

                if (pcText && !/^\d+$/.test(String(pcText))) return String(pcText).trim();
                if (pcId && /^\d+$/.test(String(pcId))) {
                    var nameLk = search.lookupFields({ type: SRC_PROFILE_CODE_LIST, id: pcId, columns: ['name'] });
                    return String(nameLk.name || '').trim();
                }
                return '';
            } catch (e) {
                err('PROFILE', 'resolveSourceProfileCode error', { profileId: profileId, message: e.message });
                return '';
            }
        }

        // ============================================================
        // v5 FIX: Resolve a routing DISPLAY TEXT (e.g. "Bank Branch Number")
        // to its CUSTOM LIST INTERNAL ID (e.g. "1") on
        // customlist_routing_identifier_list. This mirrors exactly what the
        // migration Map/Reduce does before setValue() on the CIA field, so
        // the validation compares like-for-like (internal id vs internal id).
        //
        // If the input already looks like a numeric internal id, it is
        // returned as-is. Resolution order:
        //   1) cache
        //   2) custom-list search by name
        //   3) hardcoded fallback map (matches NetSuite XML)
        // Returns the internal id as a string, or '' if unresolvable.
        // ============================================================
        function resolveRoutingListInternalId(routingText, caches) {
            var raw = String(routingText || '').trim();
            if (!raw) return '';

            // Already an internal id -> nothing to convert.
            if (/^\d+$/.test(raw)) return raw;

            var key = raw.toUpperCase();

            if (caches && caches.routingIdByText && caches.routingIdByText[key] !== undefined) {
                return caches.routingIdByText[key];
            }

            var resolvedId = '';

            // 1) Live custom-list lookup by display name.
            try {
                var listSearch = search.create({
                    type: ROUTING_LIST_TYPE,
                    filters: [['name', 'is', raw]],
                    columns: [search.createColumn({ name: 'internalid' })]
                });
                var r = listSearch.run().getRange({ start: 0, end: 1 });
                if (r && r.length > 0) {
                    resolvedId = String(r[0].getValue({ name: 'internalid' }) || '').trim();
                }
            } catch (e) {
                err('ROUTING', 'resolveRoutingListInternalId list search error', { routingText: raw, message: e.message });
            }

            // 2) Hardcoded fallback (matches NetSuite XML internal ids).
            if (!resolvedId) {
                resolvedId = ROUTING_TEXT_TO_ID_FALLBACK[key] || '';
            }

            if (caches && caches.routingIdByText) {
                caches.routingIdByText[key] = resolvedId;
            }

            return resolvedId;
        }

        // ============================================================
        // v5 FIX: now returns { id: <custom-list internal id>, text: <display> }.
        //
        // PREVIOUS BEHAVIOUR (the bug):
        //   The config field custrecord_default_bank_routing_id stores a
        //   DISPLAY TEXT ("Bank Branch Number"). getValue() returned that
        //   text, and it was assigned to .id. That text was then compared
        //   directly against the CIA custom-list internal id ("1"),
        //   yielding Expected="Bank Branch Number" vs Actual="1" forever.
        //
        // NEW BEHAVIOUR:
        //   We read the config display text, then convert it to the custom
        //   list internal id (1 / 2) via resolveRoutingListInternalId(),
        //   exactly like the migration does, and return that as .id.
        // ============================================================
        function resolveRoutingForProfileCode(profileCode, caches) {
            if (!exists(profileCode)) return { id: '', text: '' };
            try {
                var cfg = search.create({
                    type: PROFILE_CONFIG_RECORD,
                    filters: [[PROFILE_CONFIG_SOURCE_PROFILE, 'is', profileCode], 'AND', [PROFILE_CONFIG_IN_SCOPE, 'is', 'T']],
                    columns: [search.createColumn({ name: PROFILE_CONFIG_ROUTING })]
                });
                var r = cfg.run().getRange({ start: 0, end: 1 });
                if (r && r.length > 0) {
                    // Raw value AND text from the config field.
                    var rawValue = String(r[0].getValue({ name: PROFILE_CONFIG_ROUTING }) || '').trim();
                    var rawText = '';
                    try { rawText = String(r[0].getText({ name: PROFILE_CONFIG_ROUTING }) || '').trim(); } catch (e) { rawText = ''; }

                    // The config field holds display text (e.g. "Bank Branch
                    // Number"). Prefer the text; fall back to the raw value.
                    var displayText = rawText || rawValue;

                    // Convert that display text into the routing custom-list
                    // internal id (1 / 2) -- same as the migration.
                    var internalId = resolveRoutingListInternalId(displayText, caches);

                    return { id: internalId, text: displayText };
                }
                return { id: '', text: '' };
            } catch (e) {
                err('ROUTING', 'resolveRoutingForProfileCode error', { profileCode: profileCode, message: e.message });
                return { id: '', text: '' };
            }
        }

        function buildMismatchDescription(label, srcRaw, tgtRaw) {
            var s = displayValue(srcRaw), t = displayValue(tgtRaw);
            if (!exists(srcRaw) && exists(tgtRaw))
                return 'The "' + label + '" is empty on source, but migrated record has "' + t + '".';
            if (exists(srcRaw) && !exists(tgtRaw))
                return 'The "' + label + '" has "' + s + '" on source, but migrated record is empty.';
            return 'The "' + label + '" does not match. Source "' + s + '" vs migrated "' + t + '".';
        }

        function buildCsv(validationResults, matchedCount, unmatchedCount) {
            var headerRow = ['Vendor Internal Id', 'CIA Bank Detail Id', 'Issue Type', 'Category', 'Field', 'CUA / Expected Value', 'CI Field Value', 'Error Description (Plain English)','Validation Date'].join(',');
            var csvRows = [headerRow];

            (validationResults || []).forEach(function (rec) {
                rec.failedFields.forEach(function (f) {
                    var issueType = isHardCategory(f.category) ? 'Unmatched' : 'Warning';
                    csvRows.push([
                        csv(rec.sourceid), csv(rec.targetid), csv(issueType),
                        csv(f.category || 'Vendor Bank Details'), csv(f.field),
                        csv(f.source), csv(f.target),
                        csv(f.description || defaultDescription(f)), new Date()
                    ].join(','));
                });
            });

            var hasIssues = csvRows.length > 1;
            if (!hasIssues) {
                csvRows = [headerRow];
                csvRows.push([
                    csv('ALL'), csv('ALL'), csv('Success'), csv('Success'), csv('All Fields'),
                    csv('Matched: ' + (matchedCount || 0)), csv('Unmatched: ' + (unmatchedCount || 0)),
                    csv('All records validated successfully. No mismatches found.')
                ].join(','));
            }

            var folderId = getFolderIdByName(REPORT_FOLDER_NAME);
            var fileName = REPORT_FILE_PREFIX + new Date().getTime() + '.csv';
            var csvFile = file.create({ name: fileName, fileType: file.Type.CSV, contents: csvRows.join('\n'), folder: folderId });
            var fileId = csvFile.save();
            aud('CSV', 'Validation CSV saved', { fileName: fileName, fileId: fileId, hasIssues: hasIssues });
            return fileId;
        }

        function defaultDescription(f) {
            var cat = f.category || '';
            if (cat === 'Missing Record') return 'No matching record was found for comparison.';
            if (cat.indexOf('Warning') !== -1) return 'Non-blocking warning. Review whether action is needed.';
            return 'The value on source and migrated record do not match.';
        }

        function writeResponse(context, dashboardShape, debugExtra) {
            var isDebug = context.request.parameters &&
                (context.request.parameters.debug === 'T' || context.request.parameters.debug === 'true');
            var base = {
                status: dashboardShape.status,
                records_validated: dashboardShape.records_validated,
                validated_count: dashboardShape.validated_count,
                unvalidated_count: dashboardShape.unvalidated_count,
                file_id: dashboardShape.file_id
            };
            if (isDebug) { base.run_id = RUN_ID; base.detail = debugExtra; }
            context.response.write(JSON.stringify(base, null, isDebug ? 4 : 0));
        }

        function getActiveMappings() {
            var sourceFields = record.create({ type: 'vendor' }).getFields();
            var targetFields = record.create({ type: CIA_RECORD_TYPE }).getFields();
            var sourceSet = {}, targetSet = {};
            sourceFields.forEach(function (f) { sourceSet[f] = true; });
            targetFields.forEach(function (f) { targetSet[f] = true; });

            var skipped = [];
            var active = FIELD_MAP.filter(function (m) {
                var valid = sourceSet[m.sourceField] && targetSet[m.targetField];
                if (!valid) skipped.push({ label: m.label, sourceExists: !!sourceSet[m.sourceField], targetExists: !!targetSet[m.targetField] });
                return valid;
            });
            if (skipped.length) err('MAPPINGS', 'FIELDS SKIPPED', { skippedCount: skipped.length, skipped: skipped });
            return active;
        }

        function lookupSingle(recordType, id, fieldId) {
            try {
                var lk = search.lookupFields({ type: recordType, id: id, columns: [fieldId] });
                var v = lk[fieldId];
                if (Array.isArray(v) && v.length > 0) return String(v[0].text || v[0].value || '').trim();
                if (v && typeof v === 'object') return String(v.text || v.value || '').trim();
                return String(v || '').trim();
            } catch (e) {
                err('LOOKUP', 'lookupSingle error', { recordType: recordType, id: id, fieldId: fieldId, message: e.message });
                return '';
            }
        }

        function chunkArray(arr, size) {
            var out = [];
            for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
            return out;
        }

        function exists(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }

        function isTrue(v) {
            return v === true || v === 'T' || v === 't' || v === 'true' ||
                v === 'TRUE' || v === '1' || v === 1 || v === 'Yes' || v === 'yes';
        }

        function displayValue(val) { return !exists(val) ? 'Blank / Empty' : val; }

        function csv(v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }

        function getFolderIdByName(folderName) {
            var result = search.create({
                type: search.Type.FOLDER,
                filters: [['name', 'is', folderName], 'AND', ['parent', 'anyof', '@NONE@']],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });
            return result.length ? result[0].getValue('internalid') : null;
        }

        function same(a, b) {
            var aBool = toCheckboxBool(a);
            var bBool = toCheckboxBool(b);
            if (aBool !== null && bBool !== null) return aBool === bBool;
            return String(a === null || a === undefined ? '' : a).trim().toUpperCase() ===
                String(b === null || b === undefined ? '' : b).trim().toUpperCase();
        }

        function toCheckboxBool(v) {
            if (v === true || v === 'true' || v === 'TRUE' || v === 'T' || v === 't') return true;
            if (v === false || v === 'false' || v === 'FALSE' || v === 'F' || v === 'f') return false;
            return null;
        }

        function sameDate(srcRaw, tgtRaw) {
            if (!exists(srcRaw) && !exists(tgtRaw)) return true;
            if (!exists(srcRaw) || !exists(tgtRaw)) return false;
            var srcDate = parseSourceDob(srcRaw);
            var tgtDate = parseAnyDate(tgtRaw);
            if (!srcDate || !tgtDate) return String(srcRaw).trim() === String(tgtRaw).trim();
            return srcDate.getFullYear() === tgtDate.getFullYear() &&
                srcDate.getMonth() === tgtDate.getMonth() &&
                srcDate.getDate() === tgtDate.getDate();
        }

        function parseSourceDob(raw) {
            try {
                var parts = String(raw).split('/');
                if (parts.length !== 3) { var d2 = new Date(raw); return isNaN(d2.getTime()) ? null : d2; }
                var d = new Date(parts[2], Number(parts[0]) - 1, Number(parts[1]));
                return isNaN(d.getTime()) ? null : d;
            } catch (e) { return null; }
        }

        function parseAnyDate(raw) {
            try { var d = new Date(raw); return isNaN(d.getTime()) ? null : d; }
            catch (e) { return null; }
        }

        return { onRequest: onRequest };
    });