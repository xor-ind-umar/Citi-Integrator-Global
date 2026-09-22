/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */

define([
    'N/ui/serverWidget',
    'N/query',
    'N/log',
    'N/task',
    'N/runtime',
    'N/url',
    'N/search',
    'N/https',
    'N/file',
    'N/record',
    'N/cache'
], function (
    serverWidget,
    query,
    log,
    task,
    runtime,
    url,
    search,
    https,
    file,
    record,
    cache
) {

    const REPORT_FOLDER_NAME = 'Citi Integrator Migration Error Report';

    const REPORT_PREFIXES = {
        configuration: 'Configuration_Migration_Error_Report_',
        account: 'Account_Migration_Error_Report_',
        vendorBank: 'Vendor_Migration_Error_Report_',
        paymentFile: 'PFI_Migration_Error_Report_'
    };
    const VALIDATION_REPORT_PREFIXES = {
        configuration: 'Configuration_Validation_Error_Report_',
        account: 'Account_Validation_Error_Report_',
        vendorBank: 'Vendor_Bank_Validation_',
        paymentFile: 'PFI_Migration_Validation_'
    };

    // ADD THIS — maps client stepKey -> REPORT_PREFIXES key
    const STEP_TO_PREFIX_KEY = {
        configuration: 'configuration',
        account: 'account',
        vendorbank: 'vendorBank',
        paymentfile: 'paymentFile'
    };

    // ─── Validation suitelet config (one entry per record type) ──────────────
    const VALIDATION_SUITELETS = {
        configuration: {
            scriptId: 'customscript_ci_config_validation_slt',
            deploymentId: 'customdeploy_ci_config_valid'
        },
        account: {
            scriptId: 'customscript_cia_accounts_validation_slt',
            deploymentId: 'customdeploy_cia_accounts_validation_slt'
        },
        vendorbank: {
            scriptId: 'customscript_vendor_validation_sl',
            deploymentId: 'customdeploy_vendor_validation_sl'
        },
        paymentfile: {
            scriptId: 'customscript_cua_ci_pfi_validation',
            deploymentId: 'customdeploy_cua_ci_pfi_validation'
        }
    };

    // ─── Payment Process Profile multiselect config ───────────────────────────
    // CHANGED — the multiselect now sources from the OLD CUA Payment
    // Profile record (customrecord_xor_pay_pros_prfle_sdf), not the new CI
    // profile. Selecting a profile now filters vendors directly on their
    // existing custentity_xor_pay_vendor_pmt_mtd_sdf value — no old->new
    // mapping resolution is needed for the count/filter anymore (that
    // resolution still happens later, inside the Vendor M/R, purely to
    // build the migrated record — unrelated to this filter).
    const PAYMENT_PROFILE_RECORD_TYPE = 'customrecord_xor_pay_pros_prfle_sdf';

    // Selected profile IDs are passed to the Vendor migration M/R via
    // N/cache instead of a script parameter, so no manual script parameter
    // setup is required on the deployment record.
    const SELECTED_PROFILES_CACHE_NAME = 'CIA_MIGRATION_SELECTED_PROFILES';
    const SELECTED_PROFILES_CACHE_KEY = 'selected_profiles';

    // Same vendor migration status/profile fields the Vendor M/R uses,
    // needed here to compute the live "pending" count for selected profiles.
    const VENDOR_MIGRATION_CHECKBOX_FIELD = 'custentity_xor_pay_ci_vendor_mgrt_sts';
    const VENDOR_OLD_PROFILE_FIELD = 'custentity_xor_pay_vendor_pmt_mtd_sdf';
    // ─────────────────────────────────────────────────────────────────────────

    function getCount(sqlQuery) {
        var results = query.runSuiteQL({ query: sqlQuery }).asMappedResults();
        if (results && results.length > 0) return results[0].total || 0;
        return 0;
    }

    function getSavedSearchCount(searchId) {
        try {
            var savedSearch = search.load({ id: searchId });
            var pagedData = savedSearch.runPaged({ pageSize: 1000 });
            return pagedData.count || 0;
        } catch (e) {
            log.error({ title: 'Error loading saved search: ' + searchId, details: e });
            return 0;
        }
    }

    /**
     * Fetches all active CI Payment Process Profile records, returning
     * { id, name } pairs used to populate the multiselect options.
     */
    function getPaymentProfileOptions() {
        var options = [];
        try {
            var profileInternalIds = compareCuaAndCIProfiles()
            log.debug("profileInternalIds", profileInternalIds)
            var profileSearch = search.create({
                type: PAYMENT_PROFILE_RECORD_TYPE,
                filters: [
                    ['isinactive', 'is', 'F'], "AND", ["internalid", "anyof", internalIds]
                ],
                columns: [
                    search.createColumn({ name: 'name', sort: search.Sort.ASC })
                ]
            });
             options.push({
                    id: 0,
                    name: ' '
            });
            profileSearch.run().each(function (result) {
                options.push({
                    id: result.id,
                    name: result.getValue('name') || result.getText('name') || ('Profile ' + result.id)
                });
                return true; // keep iterating (fine for < 4000 results)
            });

        } catch (e) {
            log.error({ title: 'getPaymentProfileOptions Error', details: e });
        }
        return options;
    }
    function compareCuaAndCIProfiles()
    {
        var CIProfilequery = "SELECT BUILTIN.DF(custrecord_ci_adv_code) from customrecord_ci_adv_pros_profile";
        var CIqResults = queryProfile(CIProfilequery)
       
        log.debug("CIqResults", CIqResults)
        log.debug("CIqResults length", CIqResults.length)
        var CICode = CIqResults.map(function (item) {
            item = item.expr1;
            log.debug("item", item); 
           // if (item) { var match = item.match(/_[A-Z]+_[A-Z0-9]+_/); return match ? match[0] : null; }
            if (item) { var match = item.match(/(_\d[A-Z0-9_]+)/); return match ? match[0] : null; }
        }).filter(function(val) {
            return val !== null;
        });
        log.debug("CICodes", CICode)
        log.debug("CICodes length", CICode.length)
        
        var CUAProfileQuery = "SELECT BUILTIN.DF(custrecord_xor_pay_ppf_code_sdf), id from customrecord_xor_pay_pros_prfle_sdf WHERE isinactive = 'F'";
        var CUAqResults = queryProfile(CUAProfileQuery);

        log.debug("CUAqResults", CUAqResults)
        log.debug("CUAqResults length", CUAqResults.length)
        // var CUACode = CUAqResults.map(function (a) { return a.expr1 })
        CUACode = CUAqResults.map(function (cua) {
            internalid = cua.id;
            cua = cua.expr1;
           // if (cua){var cuaMatch = cua.match(/_[A-Z]+_[A-Z0-9]+_/);return [cuaMatch ? cuaMatch[0] : null, internalid];}
            if (cua){var cuaMatch = cua.match(/(_\d[A-Z0-9_]+)/);return [cuaMatch ? cuaMatch[0] : null, internalid];}
        }).filter(function (val) {
            return val !== null;
        })
        log.debug("CUACode",CUACode)
        log.debug("CUACode length",CUACode.length)
        var cleanCode = function(str){return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');} 

        // Create a mapped lookup set from List B for performance
        var CICodeMap = CICode.map(function (b) {
            return cleanCode(b)
        });
        // Find elements of List A present in List B (with slight variations ignored)
        var matchedCodes = CUACode.filter(function (codeA) {
            if (codeA)
            {
                try {
                    var normalizedA = cleanCode(codeA[0]);
                    //log.debug("normalizedA",normalizedA)
                    // Check exact match or partial/fuzzy contains depending on identity rule
                    return CICodeMap.some(function (normalizedB) {
                        try {
                            return normalizedB === normalizedA || normalizedB.includes(normalizedA)
                        } catch (error) {
                           log.audit("error", error);
                        }
                    
                    });
                } catch (e) {
                    log.audit('Error msg CUA codes',e)
                }
            }
        });
        log.debug("Matched codes in CI list", matchedCodes)
        log.debug("Matched codes in CI list length", matchedCodes.length)
       return internalIds = matchedCodes.map(function (ids) {
            return ids[1]
        })
    }
    function queryProfile(queryResolve)
    {
        return query.runSuiteQL({
            query : queryResolve
        }).asMappedResults()
    }

    // ============================================================
    // LIVE "PENDING FOR SELECTED PROFILES" COUNT
    //
    // The Start Migration button should only be enabled when there is
    // actually something to migrate for the selected profile(s). Since the
    // multiselect now sources from the OLD CUA Payment Profile record
    // (customrecord_xor_pay_pros_prfle_sdf), the selected IDs are already
    // the same IDs stored on each vendor's custentity_xor_pay_vendor_pmt_mtd_sdf
    // field — no mapping resolution is needed here, just a direct filter.
    //
    // Accounts are NOT included in this count: there is no field linking
    // an Account (or its CIA bank-detail record) to a Payment Profile in
    // the current data model, so Accounts cannot be scoped by profile.
    // This is surfaced to the client as accountsFiltered: false so the UI
    // can say so explicitly rather than imply a false total.
    // ============================================================

    /**
     * Counts NOT-YET-MIGRATED vendors (from the same base search the
     * Vendor migration M/R uses) whose custentity_xor_pay_vendor_pmt_mtd_sdf
     * (old CUA Payment Profile) is in the given selectedProfileIds set.
     */
    function getPendingVendorCountForSelectedProfiles(selectedProfileIds) {
        try {
            var vendorSearch = search.load({ id: 'customsearch_cua_vendor_bank_details' });

            var existingExpr = vendorSearch.filterExpression;
            var migrationClause = [
                [VENDOR_MIGRATION_CHECKBOX_FIELD, 'is', 'F'],
                'OR',
                [VENDOR_MIGRATION_CHECKBOX_FIELD, 'isempty', '']
            ];
            var profileClause = [VENDOR_OLD_PROFILE_FIELD, 'anyof', selectedProfileIds];

            var newExpr;
            if (Array.isArray(existingExpr) && existingExpr.length > 0) {
                newExpr = [existingExpr, 'AND', migrationClause, 'AND', profileClause];
            } else {
                newExpr = [migrationClause, 'AND', profileClause];
            }

            vendorSearch.filterExpression = newExpr;

            return vendorSearch.runPaged({ pageSize: 1000 }).count || 0;

        } catch (e) {
            log.error({ title: 'getPendingVendorCountForSelectedProfiles Error', details: e });
            return 0;
        }
    }
    function getPendingAccountCountForSelectedProfiles(selectedProfileIds) {
        try {
            var totalCount = 0;
            // 1. Fetch the parent records (equivalent to your first search for internalid 291 and 159)
            var parentSql =
                "SELECT id, name, custrecord_xor_pay_ppf_code_sdf, " +
                "SUBSTR(BUILTIN.DF(custrecord_xor_pay_ppf_code_sdf), 8, 2) AS ctrCode " +
                "FROM customrecord_xor_pay_pros_prfle_sdf " +
                "WHERE id IN ((" + selectedProfileIds.join(",") + "))";

            var parentResults = query.runSuiteQL({ query: parentSql }).asMappedResults();
            var ignoreCountryCode = [];
            // 2. Loop through each parent result, just like your .each() loop
            parentResults.forEach(function (parent) {
               try {
                 var ctrCode = parent.ctraccord; // Extracted country code
                log.debug("result", parent);
                ctrCode = (parent.ctrcode && (parent.ctrcode != null || parent.ctrcode != '') ? parent.ctrcode : '').toString().trim();
                log.debug("PendingAccountCount - Country Code:", ctrCode);
                if(ignoreCountryCode.includes(ctrCode))
                {
                    log.debug("The Bank account for this code is already included:","Skip it")
                    return;
                }
                ignoreCountryCode.push(ctrCode)

                // 3. Query the bank details record filtered by the country code from the subsidiary join
                // Note: In SuiteQL, joined record fields use specific table/field relationships. 
                // We join the subsidiary table to access its country and country ID.
                // var childSql =
                //     "SELECT COUNT(B.id) AS match_count " +
                //     "FROM customrecord_xor_pay_bank_details_sdf B " +
                //     "LEFT JOIN subsidiary S ON B.custrecord_xor_cbd_subsidiary_sdf = S.id " +
                //     "LEFT JOIN account A ON B.custrecord_xor_cbd_bank_acct_sdf = A.id " +
                //     "WHERE B.isinactive = 'F' " +
                //     "AND B.custrecord_xor_cbd_subsidiary_sdf IS NOT NULL " +
                //     "AND S.country = ?" +
                //     "AND (" +  // This tells that the account is not yet migrated.
                //     "A.custrecord_xor_pay_ci_acct_mgrt_sts IS NULL " +  // This tells that the account is not yet migrated.
                //     "OR A.custrecord_xor_pay_ci_acct_mgrt_sts = 'F' " +  // This tells that the account is not yet migrated.
                //     ")" +  // This tells that the account is not yet migrated.
                //     "AND A.isinactive = 'F'"; // SuiteQL country code field maps directly via the subsidiary table
                   
                     var childSql = 
                        "SELECT COUNT(*) AS match_count FROM (" +
                        "    SELECT B.custrecord_xor_cbd_bank_acct_sdf " +
                        "    FROM customrecord_xor_pay_bank_details_sdf B " +
                        "    LEFT JOIN subsidiary S ON B.custrecord_xor_cbd_subsidiary_sdf = S.id " +
                        "    LEFT JOIN account A ON B.custrecord_xor_cbd_bank_acct_sdf = A.id " +
                        "    WHERE B.isinactive = 'F' " +
                        "    AND B.custrecord_xor_cbd_subsidiary_sdf IS NOT NULL " +
                        "    AND S.country = ? " +
                        "    AND (" + 
                        "        A.custrecord_xor_pay_ci_acct_mgrt_sts IS NULL " + 
                        "        OR A.custrecord_xor_pay_ci_acct_mgrt_sts = 'F'" + 
                        "    )" + 
                        "    AND A.isinactive = 'F' " +
                        "    GROUP BY B.custrecord_xor_cbd_bank_acct_sdf" +
                        ") AS subquery_alias"; // <-- Added missing subquery alias here

                // If S.country returns the 2-letter code or text name depending on your account setup, 
                // adjust the condition accordingly. Alternatively, you can use expression mapping.
                var childResults = query.runSuiteQL({
                    query: childSql,
                params: [ctrCode]
                }).asMappedResults();   

                var searchResultCount12 = (childResults || childResults.length > 0) && childResults[0] ? parseInt(childResults[0].match_count, 10) : 0;
                totalCount += searchResultCount12;
                log.debug("Non Migrated Accounts' count of the selected profile for "+ctrCode+" retrieved from the company bank details: ", totalCount);
               } catch (e) {
                 log.error({ title: 'getPendingAccountCountForSelectedProfiles Countrycodebased Error', details: e });
               }
            });
            return totalCount || 0;
        } catch (e) {
            log.error({ title: 'getPendingAccountCountForSelectedProfiles Error', details: e });
            return 0;
        }
    }

    /**
     * ADD THIS — Counts ALL vendors (regardless of migration status) from
     * the base search whose old profile is in selectedProfileIds. Combined
     * with the pending count above, this gives oldCount/migratedCount/
     * pendingCount all scoped to the selection, so the table's Total
     * Records / Migrated Records / Non Migrated Records cells can show
     * profile-scoped numbers instead of the global unfiltered ones.
     */
    function getVendorCountsForSelectedProfiles(selectedProfileIds) {
        var result = { oldCount: 0, migratedCount: 0, pendingCount: 0 };
        try {
            var totalSearch = search.load({ id: 'customsearch_cua_vendor_bank_details' });
            var existingExpr = totalSearch.filterExpression;
            var profileClause = [VENDOR_OLD_PROFILE_FIELD, 'anyof', selectedProfileIds];

            totalSearch.filterExpression = (Array.isArray(existingExpr) && existingExpr.length > 0)
                ? [existingExpr, 'AND', profileClause]
                : profileClause;

            result.oldCount = totalSearch.runPaged({ pageSize: 1000 }).count || 0;
            result.pendingCount = getPendingVendorCountForSelectedProfiles(selectedProfileIds);
            result.migratedCount = Math.max(result.oldCount - result.pendingCount, 0);

        } catch (e) {
            log.error({ title: 'getVendorCountsForSelectedProfiles Error', details: e });
        }
        return result;
    }
    function getAccountCountsForSelectedProfiles(selectedProfileIds) {
        log.debug("selectedProfileIds",selectedProfileIds)
        var result = { oldCount: 0, migratedCount: 0, pendingCount: 0 };
        try {
            var totalCount = 0;
            // 1. Fetch the parent records (equivalent to your first search for internalid 291 and 159)
            var parentSql =
                "SELECT id, name, custrecord_xor_pay_ppf_code_sdf, " +
                "SUBSTR(BUILTIN.DF(custrecord_xor_pay_ppf_code_sdf), 8, 2) AS ctrCode " +
                "FROM customrecord_xor_pay_pros_prfle_sdf " +
                "WHERE id IN ((" + selectedProfileIds.join(",") + "))";

            var parentResults = query.runSuiteQL({ query: parentSql }).asMappedResults();
            var ignoreCountryCode = [];
            // 2. Loop through each parent result, just like your .each() loop
            parentResults.forEach(function (parent) {
                try {
                     var ctrCode = parent.ctraccord; // Extracted country code
                    log.debug("AccountCounts - Resulted Query", parent);
                    ctrCode = (parent.ctrcode && (parent.ctrcode != null || parent.ctrcode != '') ? parent.ctrcode : '').toString().trim();
                    log.debug("AccountCounts - Country Code:", ctrCode);
                    if(ignoreCountryCode.includes(ctrCode))
                    {
                        log.debug("The Bank account for this code is already included:","Skip it")
                        return;
                    }
                    ignoreCountryCode.push(ctrCode)
                    // 3. Query the bank details record filtered by the country code from the subsidiary join
                    // Note: In SuiteQL, joined record fields use specific table/field relationships. 
                    // We join the subsidiary table to access its country and country ID.
                  /*   var childSql =
                        "SELECT COUNT(B.id) AS match_count " +
                        "FROM customrecord_xor_pay_bank_details_sdf B " +
                        "LEFT JOIN subsidiary S ON B.custrecord_xor_cbd_subsidiary_sdf = S.id " +
                        "WHERE B.isinactive = 'F' " +
                        "AND B.custrecord_xor_cbd_subsidiary_sdf IS NOT NULL " +
                        "AND S.country = ?"; // SuiteQL country code field maps directly via the subsidiary table
                        "GROUP BY  = ?";  */
                     var childSql = 
                        "SELECT COUNT(*) AS match_count FROM (" +
                        "    SELECT B.custrecord_xor_cbd_bank_acct_sdf " +
                        "    FROM customrecord_xor_pay_bank_details_sdf B " +
                        "    LEFT JOIN subsidiary S ON B.custrecord_xor_cbd_subsidiary_sdf = S.id " +
                        "    WHERE B.isinactive = 'F' " +
                        "    AND B.custrecord_xor_cbd_subsidiary_sdf IS NOT NULL " +
                        "    AND S.country = ? " +
                        "    GROUP BY B.custrecord_xor_cbd_bank_acct_sdf" +
                        ")"; 

                    // If S.country returns the 2-letter code or text name depending on your account setup, 
                    // adjust the condition accordingly. Alternatively, you can use expression mapping.
                    var childResults = query.runSuiteQL({ query: childSql, params: [ctrCode] }).asMappedResults();
                    log.debug("childResults", childResults);
                    log.debug("childResults length", childResults.length);
                    var searchResultCount12 = (childResults || childResults.length > 0) && childResults[0] ? parseInt(childResults[0].match_count, 10) : 0;
                    totalCount += searchResultCount12;
                    log.debug("Accounts' count of the selected profile for "+ctrCode+" retrieved from the company bank details: ", totalCount);
                } catch (e) {
                    log.error({ title: 'getAccountCountsForSelectedProfiles Countrycodebased Error', details: e });
                }
            });
            result.oldCount = totalCount || 0;
            result.pendingCount = getPendingAccountCountForSelectedProfiles(selectedProfileIds);
            result.migratedCount = Math.max(result.oldCount - result.pendingCount, 0);

        } catch (e) {
            log.error({ title: 'getAccountCountsForSelectedProfiles Error', details: e });
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    function updateValues(selectedProfileIds, customRecProfileIds) {
        // Implementation for updating values
        customRecProfileIds = customRecProfileIds || []; 
        selectedProfileIds = selectedProfileIds || [];

        // If customRecProfileIds is empty, return selectedProfileIds
        if (customRecProfileIds.length === 0) {return selectedProfileIds;}

        /* //Check if selectedProfileIds has a atleast one value that is already present in customRecProfileIds.
        var hasExistingValue = selectedProfileIds.some(function (item) {
            return customRecProfileIds.indexOf(item) !== -1;
        });
       */
        var newValue = selectedProfileIds.filter(function (item) {
            return customRecProfileIds.indexOf(item) === -1;
        });
        /* // If user is working with existing selection.
        // selectedProfileIds represents the updated selection.
        if (hasExistingValue) return selectedProfileIds; */

        if (newValue.length > 0) {
            return customRecProfileIds.concat(newValue);
        }
       return selectedProfileIds
        /* // No existing value selected,
        // Keep the existing values in customRecProfileIds and add new values from selectedProfileIds.
        return customRecProfileIds.concat(selectedProfileIds.filter(function (item) {
            return customRecProfileIds.indexOf(item) === -1;
        })); */
    }
    function setSelectedVendorProfiles(selectedProfileIds)
    {
        var srchResults = search.create({ type: 'customrecord_ci_adv_capture_mi', filters: ["internalid", "is", 1], columns: ["custrecord_ci_adv_payment_profiles"] }).run().getRange(0, 1);
        var customRecProfileIds = srchResults && srchResults.length > 0 ? srchResults[0].getValue("custrecord_ci_adv_payment_profiles") : '';
       
        // normalize to arrays, protect against null/undefined
        customRecProfileIds = customRecProfileIds ? customRecProfileIds.split(',') : [];
      /*   log.debug("selectedProfileIds", selectedProfileIds)
        log.debug("customRecProfileIds", customRecProfileIds) */
        var concatSelectedProfileIds = updateValues(selectedProfileIds, customRecProfileIds);
      //  log.debug("concatSelectedProfileIds", concatSelectedProfileIds)
        return record.submitFields({ type: "customrecord_ci_adv_capture_mi", id: 1, values: { custrecord_ci_adv_payment_profiles: concatSelectedProfileIds } });
    }

    function triggerMapReduce(scriptId, deploymentId) {
        try {
            var mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: scriptId,
                deploymentId: deploymentId
            });
            var taskId = mrTask.submit();
            log.audit({
                title: 'Map Reduce Triggered',
                details: { scriptId: scriptId, deploymentId: deploymentId, taskId: taskId }
            });
            return taskId;
        } catch (e) {
            log.error({ title: 'Error Triggering MR', details: e });
            throw e;
        }
    }

    function getSavedSearchUrl(searchId) {
        var baseUrl = url.resolveDomain({ hostType: url.HostType.APPLICATION });
        return 'https://' + baseUrl +
            '/app/common/search/savedsearchresults.nl?searchid=' + searchId + '&saverun=T';
    }

    function getReportFolderId(folderName) {
        try {
            var folderSearch = search.create({
                type: 'folder',
                filters: [['name', 'is', folderName], 'AND', ['parent', 'anyof', '@NONE@']],
                columns: ['internalid']
            });
            var result = folderSearch.run().getRange({ start: 0, end: 1 });
            return result && result.length > 0 ? result[0].getValue('internalid') : null;
        } catch (e) {
            log.error({ title: 'getReportFolderId Error', details: e });
            return null;
        }
    }

    function getLatestReportFileUrl(folderId, namePrefix) {

        if (!folderId) return '';

        try {

            var fileSearch = search.create({
                type: 'file',
                filters: [
                    ['folder', 'anyof', folderId],
                    'AND',
                    ['name', 'startswith', namePrefix]
                ],
                columns: [
                    search.createColumn({
                        name: 'created',
                        sort: search.Sort.DESC
                    }),
                    'url',
                    'name',
                    'folder'
                ]
            });

            var results = fileSearch.run().getRange({
                start: 0,
                end: 100
            });

            for (var i = 0; i < results.length; i++) {

                // Ignore files returned from Archive subfolders
                if (
                    String(results[i].getValue('folder')) !==
                    String(folderId)
                ) {
                    continue;
                }

                var relativeUrl = results[i].getValue('url');
                var baseUrl = url.resolveDomain({
                    hostType: url.HostType.APPLICATION
                });

                return 'https://' + baseUrl + relativeUrl;
            }

            return '';

        } catch (e) {
            log.error({
                title: 'getLatestReportFileUrl Error',
                details: e
            });

            return '';
        }
    }

    function getExecutionLogUrl(scriptId, deploymentId) {
        try {
            var scriptSearch = search.create({
                type: 'scriptdeployment',
                filters: [['script.scriptid', 'is', scriptId]],
                columns: ['script.internalid']
            });
            var scriptResult = scriptSearch.run().getRange({ start: 0, end: 1 });
            var scriptInternalId = scriptResult && scriptResult.length > 0
                ? scriptResult[0].getValue({ name: 'internalid', join: 'script' })
                : '';

            var deploymentSearch = search.create({
                type: 'scriptdeployment',
                filters: [['scriptid', 'is', deploymentId]],
                columns: ['internalid']
            });
            var deploymentResult = deploymentSearch.run().getRange({ start: 0, end: 1 });
            var deploymentInternalId = deploymentResult && deploymentResult.length > 0
                ? deploymentResult[0].getValue('internalid')
                : '';

            if (scriptInternalId && deploymentInternalId) {
                var baseUrl = url.resolveDomain({ hostType: url.HostType.APPLICATION });
                return 'https://' + baseUrl +
                    '/app/common/scripting/mapreducescriptstatus.nl' +
                    '?sortcol=dcreated' +
                    '&sortdir=DESC' +
                    '&date=TODAY' +
                    '&scripttype=' + encodeURIComponent(scriptInternalId) +
                    '&primarykey=' + encodeURIComponent(deploymentInternalId);
            }
            return '';
        } catch (e) {
            log.error({ title: 'Error getting execution log URL', details: e });
            return '';
        }
    }

    function isDeploymentRunning(deploymentScriptId) {
        return search.create({
            type: 'scheduledscriptinstance',
            filters: [
                ['scriptdeployment.scriptid', 'is', deploymentScriptId],
                'AND',
                ['status', 'anyof', ['PROCESSING', 'PENDING']]
            ]
        }).runPaged().count > 0;
    }

    function checkRunningMigration(context) {
        try {
            var runningStep = null;

            if (isDeploymentRunning('customdeploy_cua_config_migration_mr')) {
                runningStep = {
                    step: 'configuration',
                    stepLabel: 'Configuration',
                    logUrl: getExecutionLogUrl('customscript_cua_config_migration_mr', 'customdeploy_cua_config_migration_mr')
                };
            } else if (isDeploymentRunning('customdeploy_cua_account_migration_mr')) {
                runningStep = {
                    step: 'account',
                    stepLabel: 'Account',
                    logUrl: getExecutionLogUrl('customscript_cua_account_migration_mr', 'customdeploy_cua_account_migration_mr')
                };
            } else if (isDeploymentRunning('customdeploy_vendor_bank_mr')) {
                runningStep = {
                    step: 'vendorbank',
                    stepLabel: 'Vendor Bank',
                    logUrl: getExecutionLogUrl('customscript_cua_vendor_migration_mr', 'customdeploy_vendor_bank_mr')
                };
            } else if (isDeploymentRunning('customdeploy_cua_pfi_migration_mr')) {
                runningStep = {
                    step: 'paymentfile',
                    stepLabel: 'Payment File',
                    logUrl: getExecutionLogUrl('customscript_cua_pfi_migration_mr', 'customdeploy_cua_pfi_migration_mr')
                };
            }

            context.response.write(JSON.stringify({
                success: true,
                running: !!runningStep,
                step: runningStep && runningStep.step,
                stepLabel: runningStep && runningStep.stepLabel,
                logUrl: runningStep && runningStep.logUrl
            }));
        } catch (e) {
            log.error({ title: 'checkRunningMigration Error', details: e });
            context.response.write(JSON.stringify({ success: false, running: false, error: e.message }));
        }
    }

    function getMigrationCounts() {
        var oldAccountCount = getSavedSearchCount('customsearch_ci_acct_migration_search');
        var migratedAccountCount = getSavedSearchCount('customsearch_cia_pmt_acct_config_search');
        var oldVendorBankCount = getSavedSearchCount('customsearch_cua_vendor_bank_details');
        var migratedVendorBankCount = getSavedSearchCount('customsearch_cia_vend_bank_dtl_search');
        var oldPaymentFileCount = getSavedSearchCount('customsearch_ci_pmt_file_info_search');
        var migratedPaymentFileCount = getSavedSearchCount('customsearch_cia_pmt_file_info_search');
        var oldConfigurationCount = getSavedSearchCount('customsearch_sftp_configuration');
        var migratedConfigurationCount = getSavedSearchCount('customsearch_cia_sftp_configuration');

        var ciAdvConfigMigCheckedCount = getCount(
            "SELECT COUNT(*) AS total FROM customrecord_ci_adv_general_config WHERE isinactive = 'F' AND custrecord_ci_adv_mig_config_from_cua = 'T'"
        );
        var ciAdvSftpMigCheckedCount = getCount(
            "SELECT COUNT(*) AS total FROM customrecord_ci_adv_sftp_config WHERE isinactive = 'F' AND custrecord_ci_adv_mig_sftp_conf_from_cua = 'T'"
        );
        var cuaConfigMigCheckedCount = getCount(
            "SELECT COUNT(*) AS total FROM customrecord_xor_pay_config WHERE isinactive = 'F' AND custrecord_xor_pay_ci_conf_mgrt_sts = 'T'"
        );
        var cuaSftpConfigMigCheckedCount = getCount(
            "SELECT COUNT(*) AS total FROM customrecord_xor_pay_sftp_config WHERE isinactive = 'F' AND custrecord_xor_pay_ci_sftp_mgrt_sts = 'T'"
        );

        var anyCheckboxChecked =
            ciAdvConfigMigCheckedCount > 0 &&
            ciAdvSftpMigCheckedCount > 0 &&
            cuaConfigMigCheckedCount > 0 &&
            cuaSftpConfigMigCheckedCount > 0;

        return {
            oldAccountCount: oldAccountCount,
            migratedAccountCount: migratedAccountCount,
            oldVendorBankCount: oldVendorBankCount,
            migratedVendorBankCount: migratedVendorBankCount,
            oldPaymentFileCount: oldPaymentFileCount,
            migratedPaymentFileCount: migratedPaymentFileCount,
            oldConfigurationCount: oldConfigurationCount,
            migratedConfigurationCount: migratedConfigurationCount,
            ciAdvConfigMigCheckedCount: ciAdvConfigMigCheckedCount,
            ciAdvSftpMigCheckedCount: ciAdvSftpMigCheckedCount,
            cuaConfigMigCheckedCount: cuaConfigMigCheckedCount,
            cuaSftpConfigMigCheckedCount: cuaSftpConfigMigCheckedCount,
            anyCheckboxChecked: anyCheckboxChecked,
            configurationPending: oldConfigurationCount > 0 && !anyCheckboxChecked,
            accountPending: oldAccountCount > migratedAccountCount,
            vendorPending: oldVendorBankCount > migratedVendorBankCount,
            paymentPending: oldPaymentFileCount > migratedPaymentFileCount
        };
    }

    function getNextPendingStep(counts, lastCompletedStep) {
        var steps = [
            {
                step: 'configuration',
                label: 'Configuration',
                scriptId: 'customscript_cua_config_migration_mr',
                deploymentId: 'customdeploy_cua_config_migration_mr',
                shouldRun: counts.configurationPending
            },
            {
                step: 'account',
                label: 'Accounts',
                scriptId: 'customscript_cua_account_migration_mr',
                deploymentId: 'customdeploy_cua_account_migration_mr',
                shouldRun: counts.accountPending
            },
            {
                step: 'vendorbank',
                label: 'Vendor Bank Details',
                scriptId: 'customscript_cua_vendor_migration_mr',
                deploymentId: 'customdeploy_vendor_bank_mr',
                shouldRun: counts.vendorPending
            },
            {
                step: 'paymentfile',
                label: 'Payment File Information',
                scriptId: 'customscript_cua_pfi_migration_mr',
                deploymentId: 'customdeploy_cua_pfi_migration_mr',
                shouldRun: counts.paymentPending
            }
        ];

        var startIndex = 0;
        if (lastCompletedStep) {
            for (var i = 0; i < steps.length; i++) {
                if (steps[i].step === lastCompletedStep) {
                    startIndex = i + 1;
                    break;
                }
            }
        }

        for (var j = startIndex; j < steps.length; j++) {
            if (steps[j].shouldRun) return steps[j];
        }

        return null;
    }

    /**
     * Calls the validation suitelet for a given record type and returns a
     * normalised object:
     *   { status, recordsValidated, validatedCount, unvalidatedCount, fileId, fileUrl, error }
     *
     * Only called explicitly via action=runValidation after migration completes.
     * NOT called on page load or during refreshCounts.
     */
    function runValidation(stepKey) {
        log.debug('runValidation', 'stepKey = ' + stepKey);

        var defaultResult = {
            status: 'pending',
            recordsValidated: 0,
            validatedCount: 0,
            unvalidatedCount: 0,
            fileId: null,
            fileUrl: '',
            error: ''
        };

        try {
            var suiteletConfig = VALIDATION_SUITELETS[stepKey];
            if (!suiteletConfig) {
                return Object.assign({}, defaultResult, {
                    status: 'error',
                    error: 'No validation suitelet configured for step: ' + stepKey
                });
            }

            var response = https.requestSuitelet({
                scriptId: suiteletConfig.scriptId,
                deploymentId: suiteletConfig.deploymentId,
                method: https.Method.GET
            });

            log.debug('runValidation response for ' + stepKey, response.body);

            if (response.code !== 200) {
                log.error({
                    title: 'runValidation HTTP error for ' + stepKey,
                    details: 'HTTP ' + response.code + ': ' + response.body
                });
                return Object.assign({}, defaultResult, { status: 'error', error: 'HTTP ' + response.code });
            }

            var parsed = JSON.parse(response.body);
            if (!parsed || !parsed.status) return defaultResult;

            var fileUrl = '';
            if (parsed.status === 'complete' && parsed.file_id) {
                var fileObj = file.load({ id: parsed.file_id });
                var baseUrl = url.resolveDomain({ hostType: url.HostType.APPLICATION });
                fileUrl = 'https://' + baseUrl + fileObj.url;
            }

            return {
                status: parsed.status,
                recordsValidated: parsed.records_validated || 0,
                validatedCount: parsed.validated_count || 0,
                unvalidatedCount: parsed.unvalidated_count || 0,
                fileId: parsed.file_id || null,
                fileUrl: fileUrl,
                error: ''
            };

        } catch (e) {
            log.error({ title: 'runValidation Error for ' + stepKey, details: e });
            return Object.assign({}, defaultResult, { status: 'error', error: e.message });
        }
    }

    /**
     * Gets the internal ID of the "Archive" folder. If it doesn't exist, creates it under the main report folder.
     * @returns 
     */
    function getArchiveFolderId(folderName) {

        var parentFolderId = getReportFolderId(REPORT_FOLDER_NAME);

        var folderSearch = search.create({
            type: 'folder',
            filters: [
                ['parent', 'anyof', parentFolderId],
                'AND',
                ['name', 'is', folderName]
            ],
            columns: ['internalid']
        });

        var result = folderSearch.run().getRange({
            start: 0,
            end: 1
        });

        if (result.length) {
            return result[0].getValue('internalid');
        }

        var archiveFolder = record.create({
            type: record.Type.FOLDER
        });

        archiveFolder.setValue({
            fieldId: 'name',
            value: folderName
        });

        archiveFolder.setValue({
            fieldId: 'parent',
            value: parentFolderId
        });

        return archiveFolder.save();
    }

    /**
     * Archives previous reports for a given step key by moving them to an "Archive" folder.
     * @param {*} stepKey 
     * @returns 
     */
    function archivePreviousReports(stepKey, REPORT_PREFIXES) {
        try {
            var prefixKey = STEP_TO_PREFIX_KEY[stepKey];
            if (!prefixKey) return;
            var folderName = '';
            var reportFolderId = getReportFolderId(REPORT_FOLDER_NAME);
            if (!reportFolderId) return;
            if (REPORT_PREFIXES[prefixKey] && REPORT_PREFIXES[prefixKey].indexOf('Validation') === -1) folderName = 'Archive';
            else  folderName = 'Validation Archive';
            var archiveFolderId = getArchiveFolderId(folderName); // helper below

            var fileSearch = search.create({
                type: 'file',
                filters: [
                    ['folder', 'is', reportFolderId], 
                    'AND',
                    ['name', 'startswith', REPORT_PREFIXES[prefixKey]]
                ],
                columns: ['internalid', 'name', 'folder']
            });

            fileSearch.run().each(function (result) {

                if (
                    String(result.getValue('folder')) !==
                    String(reportFolderId)
                ) {
                    return true;
                }

                try {

                    log.audit({
                        title: 'Archiving Report',
                        details: result.getValue('name')
                    });

                    var fileObj = file.load({
                        id: result.getValue('internalid')
                    });

                    fileObj.folder = archiveFolderId;
                    fileObj.save();

                } catch (e) {
                    log.error('Archive File Error', e);
                }

                return true;
            });
        } catch (e) {
            log.error('archivePreviousReports Error', e);
        }
    }

    function onRequest(context) {
        try {
            var request = context.request;

            /* ── STATUS CHECK ─────────────────────────────────────────── */
            if (request.method === 'GET' && request.parameters.action === 'checkStatus') {
                var taskId = request.parameters.taskId;
                try {
                    var taskStatus = task.checkStatus({ taskId: taskId });
                    context.response.write(JSON.stringify({ success: true, status: taskStatus.status }));
                } catch (e) {
                    log.error({ title: 'checkStatus Error', details: e });
                    context.response.write(JSON.stringify({ success: false, error: e.message }));
                }
                return;
            }

            /* ── RUN VALIDATION ───────────────────────────────────────── */
            // Runs the validation validation. The client script only calls this AFTER
            // a migration step has finished running - either right after it
            // completes, or when the page loads and a step is already done.
            // It never runs while a migration is still in progress.
            if (request.method === 'GET' && request.parameters.action === 'runValidation') {
                var stepKey = request.parameters.step;
                if (!stepKey) {
                    context.response.write(JSON.stringify({ success: false, error: 'Missing step parameter' }));
                    return;
                }
                try {
                    var validationResult = runValidation(stepKey);
                    context.response.write(JSON.stringify({ success: true, step: stepKey, validation: validationResult }));
                } catch (e) {
                    log.error({ title: 'runValidation action error', details: e });
                    context.response.write(JSON.stringify({ success: false, error: e.message }));
                }
                return;
            }

            /* ── GET ERROR REPORT (on-demand, per step) ─────────────────────────── */
            if (request.method === 'GET' && request.parameters.action === 'getErrorReport') {
                var stepKey = request.parameters.step;
                var prefixKey = STEP_TO_PREFIX_KEY[stepKey];
                if (!prefixKey) {
                    context.response.write(JSON.stringify({ success: false, error: 'Unknown step: ' + stepKey }));
                    return;
                }
                try {
                    var folderId = getReportFolderId(REPORT_FOLDER_NAME);
                    var reportUrl = getLatestReportFileUrl(folderId, REPORT_PREFIXES[prefixKey]);
                    context.response.write(JSON.stringify({ success: true, step: stepKey, reportUrl: reportUrl }));
                } catch (e) {
                    log.error({ title: 'getErrorReport Error', details: e });
                    context.response.write(JSON.stringify({ success: false, error: e.message }));
                }
                return;
            }

            /* ── CHECK PENDING ────────────────────────────────────────── */
            if (request.method === 'GET' && request.parameters.action === 'checkPending') {
                try {
                    var counts = getMigrationCounts();
                    var hasPending =
                        counts.configurationPending ||
                        counts.accountPending ||
                        counts.vendorPending ||
                        counts.paymentPending;

                    context.response.write(JSON.stringify({ success: true, hasPending: hasPending }));
                } catch (e) {
                    log.error({ title: 'checkPending Error', details: e });
                    context.response.write(JSON.stringify({ success: false, hasPending: true, error: e.message }));
                }
                return;
            }

            /* ── REFRESH COUNTS ───────────────────────────────────────── */
            if (request.method === 'GET' && request.parameters.action === 'refreshCounts') {
                try {
                    var counts = getMigrationCounts();
                    context.response.write(JSON.stringify({
                        success: true,
                        oldAccountCount: counts.oldAccountCount,
                        migratedAccountCount: counts.migratedAccountCount,
                        oldVendorBankCount: counts.oldVendorBankCount,
                        migratedVendorBankCount: counts.migratedVendorBankCount,
                        oldPaymentFileCount: counts.oldPaymentFileCount,
                        migratedPaymentFileCount: counts.migratedPaymentFileCount,
                        oldConfigurationCount: counts.oldConfigurationCount,
                        migratedConfigurationCount: counts.migratedConfigurationCount,
                        configurationPending: counts.configurationPending,
                        accountPending: counts.accountPending,
                        vendorPending: counts.vendorPending,
                        paymentPending: counts.paymentPending
                        // NOTE: validationStatuses intentionally omitted —
                        // validation runs only after M/R completion.
                    }));
                } catch (e) {
                    log.error({ title: 'refreshCounts Error', details: e });
                    context.response.write(JSON.stringify({ success: false, error: e.message }));
                }
                return;
            }

            /* ── CHECK RUNNING MIGRATION ──────────────────────────────── */
            if (request.method === 'GET' && request.parameters.action === 'checkRunningMigration') {
                return checkRunningMigration(context);
            }

            /* ── GET SELECTED PROFILE TOTALS (multiselect selection) ────
             * Returns the real PENDING count: not-yet-migrated Vendor Bank
             * Details whose custentity_xor_pay_vendor_pmt_mtd_sdf (old CUA
             * Payment Profile) is in the selected set. This is the number
             * that determines whether the Start Migration button should be
             * enabled for this selection. Accounts are explicitly excluded
             * (accountsFiltered: false) since there is no field linking
             * Accounts to a Payment Profile in the current data model.
             * ─────────────────────────────────────────────────────────── */
            if (request.method === 'GET' && request.parameters.action === 'getSelectedProfileTotals') {
                var profilesParam = request.parameters.profiles || '';
                var profileIds = profilesParam
                    .split(',')
                    .map(function (s) { return s.trim(); })
                    .filter(Boolean);

                if (profileIds.length === 0) {
                    context.response.write(JSON.stringify({
                        success: true,
                        oldCount: 0,
                        migratedCount: 0,
                        pendingCount: 0,
                        vendorPendingCount: 0,
                        accountsFiltered: false,
                        totalCount: 0
                    }));
                    return;
                }

                try {
                    // CHANGED — now returns oldCount/migratedCount/pendingCount
                    // scoped to the selected profiles, so the table's Total
                    // Records / Migrated Records / Non Migrated Records cells
                    // for Vendor Bank Details can display filtered numbers
                    // directly, not just the pending count.
                    var storeProfileList = setSelectedVendorProfiles(profileIds);
                    var vendorCounts = getVendorCountsForSelectedProfiles(profileIds);
                    log.debug("storeProfileList Id",storeProfileList)
                    var accountCounts = getAccountCountsForSelectedProfiles(profileIds);
                    context.response.write(JSON.stringify({
                        success: true,
                        oldCount: vendorCounts.oldCount,
                        migratedCount: vendorCounts.migratedCount,
                        pendingCount: vendorCounts.pendingCount,
                        vendorPendingCount: vendorCounts.pendingCount, // kept for backward compatibility
                        accountsFiltered: false,
                        totalCount: vendorCounts.pendingCount,
                        oldAccountCount: accountCounts.oldCount,
                        migratedAccountCount: accountCounts.migratedCount,
                        pendingAccountCount: accountCounts.pendingCount,
                        accountPendingCount: accountCounts.pendingCount, // kept for backward compatibility
                        totalAccountCount: accountCounts.pendingCount
                    }));
                } catch (e) {
                    log.error({ title: 'getSelectedProfileTotals Error', details: e });
                    context.response.write(JSON.stringify({ success: false, error: e.message }));
                }
                return;
            }

            /* ── AJAX POST ────────────────────────────────────────────── */
            if (request.method === 'POST') {
                try {
                    var requestType = request.parameters.type;
                    if (requestType !== 'start') throw new Error('Unsupported request type: ' + requestType);

                    var counts = getMigrationCounts();
                    var lastStep = request.parameters.lastStep;
                    var nextStep = getNextPendingStep(counts, lastStep);

                    if (!nextStep) {
                        context.response.write(JSON.stringify({
                            success: true,
                            done: true,
                            message: 'All migration steps are already complete.'
                        }));
                        return;
                    }

                    log.audit({
                        title: 'Archiving Previous Reports',
                        details: 'Step: ' + nextStep.step
                    });
                    archivePreviousReports(nextStep.step,REPORT_PREFIXES);
                    archivePreviousReports(nextStep.step,VALIDATION_REPORT_PREFIXES);
                    // Write the selection to a short-lived cache entry
                    // (not a task.create() script parameter). Both the
                    // Suitelet and the Vendor M/R read/write the same
                    // cache name/key.
                    var selectedProfiles = request.parameters.profiles || '';
                    try {
                        var profileCache = cache.getCache({
                            name: SELECTED_PROFILES_CACHE_NAME,
                            scope: cache.Scope.PROTECTED
                        });
                        if (selectedProfiles) {
                            profileCache.put({
                                key: SELECTED_PROFILES_CACHE_KEY,
                                value: selectedProfiles,
                                ttl: 86400 // 24 hours — comfortably longer than any single migration run
                            });
                        } else {
                            profileCache.remove({ key: SELECTED_PROFILES_CACHE_KEY });
                        }
                    } catch (cacheErr) {
                        log.error({ title: 'Selected Profiles Cache Write Error', details: cacheErr });
                    }

                    var taskId = triggerMapReduce(nextStep.scriptId, nextStep.deploymentId);

                    context.response.write(JSON.stringify({
                        success: true,
                        taskId: taskId,
                        step: nextStep.step,
                        stepLabel: nextStep.label,
                        logUrl: getExecutionLogUrl(nextStep.scriptId, nextStep.deploymentId)
                    }));

                } catch (e) {
                    var errMsg = e && e.message ? e.message : String(e);
                    var resp = { success: false, error: (e.name ? e.name + ': ' : '') + errMsg };

                    if (
                        (e && e.name === 'MAP_REDUCE_ALREADY_RUNNING') ||
                        (errMsg && errMsg.indexOf('MAP_REDUCE') !== -1) ||
                        (errMsg && errMsg.toLowerCase().indexOf('already') !== -1)
                    ) {
                        resp.errorCode = 'MR_ALREADY_RUNNING';
                        if (nextStep) {
                            resp.step = nextStep.step;
                            resp.stepLabel = nextStep.label;
                        }
                        try {
                            resp.logUrl = getExecutionLogUrl(
                                nextStep && nextStep.scriptId ? nextStep.scriptId : '',
                                nextStep && nextStep.deploymentId ? nextStep.deploymentId : ''
                            );
                        } catch (zg) { /* ignore */ }
                    }

                    context.response.write(JSON.stringify(resp));
                }
                return;
            }

            /* ── PAGE LOAD (GET, no action) ───────────────────────────── */

            var form = serverWidget.createForm({
                // title: 'Citi Integrator to Citi Integrator Advanced Migration Dashboard'
                title: 'Citi Universal Adapter to Citi Integrator Global Migration Dashboard'
            });

            form.clientScriptModulePath = './cia migration report cs.js';

            var links = {
                account: {
                    cua: getSavedSearchUrl('customsearch_ci_acct_migration_search'),
                    cia: getSavedSearchUrl('customsearch_cia_pmt_acct_config_search')
                },
                vendorBank: {
                    cua: getSavedSearchUrl('customsearch_cua_vendor_bank_details'),
                    cia: getSavedSearchUrl('customsearch_cia_vend_bank_dtl_search')
                },
                paymentFile: {
                    cua: getSavedSearchUrl('customsearch_ci_pmt_file_info_search'),
                    cia: getSavedSearchUrl('customsearch_cia_pmt_file_info_search')
                },
                configuration: {
                    cua: getSavedSearchUrl('customsearch_sftp_configuration'),
                    cia: getSavedSearchUrl('customsearch_cia_sftp_configuration')
                }
            };

            var reportFolderId = getReportFolderId(REPORT_FOLDER_NAME);

            var logLinks = {
                account: getLatestReportFileUrl(reportFolderId, REPORT_PREFIXES.account),
                vendorBank: getLatestReportFileUrl(reportFolderId, REPORT_PREFIXES.vendorBank),
                paymentFile: getLatestReportFileUrl(reportFolderId, REPORT_PREFIXES.paymentFile),
                configuration: getLatestReportFileUrl(reportFolderId, REPORT_PREFIXES.configuration)
            };

            var counts = getMigrationCounts();
            log.debug("counts",counts)
            var disableStartButton = !(
                counts.configurationPending ||
                counts.accountPending ||
                counts.vendorPending ||
                counts.paymentPending
            );

            form.addButton({
                id: 'custpage_btn_start',
                label: 'Start Migration',
                functionName: "triggerMigration('start')"
            });

            form.addButton({
                id: 'custpage_btn_refresh_counts',
                label: 'Refresh',
                functionName: 'refreshCountsDisplay()'
            });

            // ── Payment Process Profile multiselect, added right after the
            // Refresh button. Options are populated from a search against
            // the CI Payment Process Profile record type.
            var profileField = form.addField({
                id: 'custpage_selected_profiles',
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Payment Process Profiles'
            });
            profileField.setHelpText({
                help: 'Select one or more Payment Process Profiles to scope the migration to. ' +
                    'The Start Migration button will be disabled if no records are pending for the selection.'
            });

            // CHANGED — the previous client-side attempts to enlarge this
            // field via CSS/DOM overrides never stuck, because NetSuite's
            // multiselect widget recalculates its own height from an
            // internal "displaySize" setting (confirmed via DevTools:
            // data-settings shows "height":4, "displaySize":"MEDIUM") on
            // every refresh/interaction, wiping out any client-side
            // override. updateDisplaySize() is the correct native API for
            // this — it sets the actual value the widget builds itself
            // from, so there's nothing left to fight or reapply.
            profileField.updateDisplaySize({
                height: 12,
                width: 420
            });

            var profileOptions = getPaymentProfileOptions();
            profileOptions.forEach(function (opt) {
                profileField.addSelectOption({
                    value: opt.id,
                    text: opt.name
                });
            });
            // CHANGED — removed the standalone cia_profile_count_display
            // banner field. The selected-profile info now renders inside
            // the "Vendor Bank Details" and "Account" rows of the table
            // itself, via selectedProfileNote-<stepKey> divs added in row().
            // ─────────────────────────────────────────────────────────────
            log.debug("disableStartButton",disableStartButton)
            if (disableStartButton) {
                form.addField({
                    id: 'custpage_disable_start',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: ' '
                }).defaultValue = `
                            <script>
                                setTimeout(function(){
                                    var btn = document.getElementById('custpage_btn_start');
                                    if (btn) {
                                        btn.disabled        = true;
                                        btn.style.opacity   = '0.5';
                                        btn.style.cursor    = 'not-allowed';
                                    }
                                }, 500);
                            </script>`;
            }

            // ── Embed migration state for client-side use ────────────────────
            var migrationState = {
                configuration: {
                    oldCount: counts.oldConfigurationCount,
                    migratedCount: counts.migratedConfigurationCount,
                    pending: counts.configurationPending
                },
                account: {
                    oldCount: counts.oldAccountCount,
                    migratedCount: counts.migratedAccountCount,
                    pending: counts.accountPending
                },
                vendorbank: {
                    oldCount: counts.oldVendorBankCount,
                    migratedCount: counts.migratedVendorBankCount,
                    pending: counts.vendorPending
                },
                paymentfile: {
                    oldCount: counts.oldPaymentFileCount,
                    migratedCount: counts.migratedPaymentFileCount,
                    pending: counts.paymentPending
                }
            };

            var htmlField = form.addField({
                id: 'custpage_dashboard',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Summary'
            });


            var html = '<script>window.CIA_MIGRATION_STATE = ' + JSON.stringify(migrationState) + ';</script>';
            html += '<h3 style="font-family:Arial; color:#2c3e50;">Migration Status</h3>';
            html += '<div style="margin-bottom:20px;"></div>';
            html += '<div style="font-family: Arial; font-size: 12px;">';

            html += `
            <div id="cia_status_banner" style="
                display:none;
                margin:0 0 12px 0;
                padding:10px 14px;
                border-radius:4px;
                font-family:Arial;
                font-size:13px;
                font-weight:bold;
                border-left:4px solid #2980b9;
                background:#d6eaf8;
                color:#1a5276;
            "></div>
            `;

            html += `<table style="width:100%; border-collapse:collapse;">`;

            html += `
            <tr style="background:#2c3e50; color:white;">
                <th style="text-align:left; padding:12px;">Record</th>
                <th style="text-align:left; padding:12px;">Citi Universal Adapter</th>
                <th style="text-align:left; padding:12px;">Citi Integrator Global</th>
                <th style="text-align:left; padding:12px;">Validation Status</th>
            </tr>
            `;
            
            /**
             * Renders one table row.
             * Validation Status always starts as "Pending" — client populates it
             * either from sessionStorage cache (instant) or via runValidation fetch.
             */
            function row(stepKey, label, oldCount, oldLink, newCount, newLink, scriptLogLink, isAlt) {
                var bg = isAlt ? '#f5f5f5' : '#ffffff';
                var failedCount = Math.max(oldCount - newCount, 0);
                var migratedColor = '#27ae60';
                var failedColor = failedCount === 0 ? '#27ae60' : '#c0392b';

                var scriptLogLinkHtml;
                if (failedCount === 0) {
                    scriptLogLinkHtml = `<span style="color:#27ae60; font-size:11px; font-weight:bold;">No error report</span>`;
                } else {
                    // CHANGED: no longer render scriptLogLink here directly.
                    // Report may be stale/Old from a previous run — client fetches fresh via getErrorReport.
                    scriptLogLinkHtml = `<span style="color:#999; font-size:11px;">No report yet</span>`;
                }
                var statusCellHtml = `
                <div>
                    <b id="valStatus-${stepKey}" style="color:#999;">&#8212; Pending</b>
                </div>
                <div id="valValidated-${stepKey}"   style="display:none;"></div>
                <div id="valUnvalidated-${stepKey}" style="display:none;"></div>
                <div id="valCount-${stepKey}"       style="display:none;"></div>
                <div id="valDownload-${stepKey}"    style="display:none;"></div>`;

                return `
                <tr id="row-${stepKey}" style="background:${bg};">

                    <td style="padding:12px; vertical-align:top;">${label}</td>

                    <td style="padding:12px; vertical-align:top;">
                        <div><b id="oldCount-${stepKey}" style="color:#000000;">Total Records: ${oldCount}</b></div>
                        <div style="margin-top:6px;"><a href="${oldLink}" target="_blank" style="color:#2980b9; text-decoration:none;">View Details</a></div>
                        <div id="selectedProfileNote-${stepKey}" style="display:none; margin-top:8px; font-size:11px; color:#1a5276; background:#f5f9fc; border-left:3px solid #2980b9; padding:5px 8px; border-radius:3px;"></div>
                    </td>

                    <td style="padding:12px; vertical-align:top;">
                        <div><b id="newCount-${stepKey}" style="color:${migratedColor};">Migrated Records: ${newCount}</b></div>
                        <div style="margin-top:4px;"><b id="failedCount-${stepKey}" style="color:${failedColor};">Non Migrated Records: ${failedCount}</b></div>
                        <div style="margin-top:6px;"><a href="${newLink}" target="_blank" style="color:#2980b9; text-decoration:none;">View Details</a></div>
                        <div id="scriptLog-${stepKey}" style="margin-top:8px;">${scriptLogLinkHtml}</div>
                    </td>

                    <td style="padding:12px; vertical-align:top;">
                        ${statusCellHtml}
                    </td>

                </tr>
                `;          
            }

            html += row('configuration', 'Configuration', counts.oldConfigurationCount, links.configuration.cua, counts.migratedConfigurationCount, links.configuration.cia, logLinks.configuration, false);
            html += row('account', 'Account', counts.oldAccountCount, links.account.cua, counts.migratedAccountCount, links.account.cia, logLinks.account, true);
            html += row('vendorbank', 'Vendor Bank Details', counts.oldVendorBankCount, links.vendorBank.cua, counts.migratedVendorBankCount, links.vendorBank.cia, logLinks.vendorBank, false);
            html += row('paymentfile', 'Payment File Information', counts.oldPaymentFileCount, links.paymentFile.cua, counts.migratedPaymentFileCount, links.paymentFile.cia, logLinks.paymentFile, true);

            html += '</table>';
            html += '</div>';

            htmlField.defaultValue = html;
            context.response.writePage(form);

        } catch (e) {
            log.error({ title: 'Suitelet Error', details: e });
            context.response.write({ output: JSON.stringify(e) });
        }
    }

    return { onRequest: onRequest };
});