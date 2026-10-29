/**
 *@NApiVersion 2.1
 *@NScriptType Suitelet
 *@NModuleScope SameAccount
 */
/**
 * Copyright (c) 2025, Xoriant Corporation and/or its affiliates. All rights reserved.
 *
 * @author Umar
 *
 * Script brief description:
 * This Suitelet is used to get the count of pending approval records and their associated vendor details.
 *
 *
 * Revision History:
 *
 * Date              Issue/Case         Author               	Issue Fix Summary
 * =============================================================================================
 * 2026/10/28                          	Rutuja Tembare           Initial version
 */
// Get the incoming request and the place where this script sends its reply.

define(['N/search', 'N/record', 'N/query', 'N/log'],
    // A GET request asks for approval history to display.
    function (search, record, query, log) {

        /**
         * Defines the function that is executed when a request is sent to a Suitelet.
                    // Read submitted JSON when present, otherwise use URL/form parameters.
         * @param {Object} context - The Suitelet context containing request and response objects.
         */
        // Log the received information to help troubleshoot requests.
        function onRequest(context) {
            var request = context.request;
            var response = context.response;
            var method = request.method;

            log.audit('Suitelet Request Method', method);
            // Save an approval-history record only for a recognized decision.
            try {
                if (method === 'GET') {
                    var requestParams = request.parameters;
                    // Tell the caller when it sends an unsupported decision.
                } else if (method === 'POST') {

                    var requestParams = request.body ? JSON.parse(request.body) : request.parameters;
                    // Send the result of saving, or the validation error, back to the caller.
                    var data;
                    log.audit('requestParams', JSON.stringify(requestParams));

                    //	var action = requestParams.approvals && requestParams.approvals.action;
                    // Explain that this Suitelet accepts only GET and POST requests.
                    var action = requestParams.action;
                    log.audit('action', action);

                    // Executing the code for the action extracted from Parameters.
                    // Log unexpected problems and return their message instead of leaving the caller without a response.
                    if (action == 'Approved' || action == 'Rejected') {
                        data = creatApprovalHistory(requestParams, action);
                    } else {
                        data = JSON.stringify({ error: 'Incorrect Action.' });
                    }

                    log.audit('doPost Function End');
                    response.write(data);

                } else {
                    response.write(JSON.stringify({ error: 'Unsupported HTTP Method' }));
                }

            } catch (err) {
                // Keep the list entry whose name matches the decision being saved.
                log.error('error', err);
                response.write(JSON.stringify({ success: false, error: err.name + ': ' + err.message }));
            }
        }

        // Set one field without allowing an invalid value to stop other fields from being saved.
        function setValueSafely(targetRecord, fieldId, value) {
            // Log the status lookup and the ID that will be used for the record.
            try {
                // Use the first bank-details record from the request.
                targetRecord.setValue({ fieldId: fieldId, value: value });
                return true;
            } catch (error) {
                // Stop when the caller did not include a bank-details record.
                log.error('Could not set approval history field: ' + fieldId, error);
                // Read the bank-details information needed for the history entry.
                return false;
            }
            // Start a new approval-history record to keep a copy of this decision.
        }
        // Copy who created the bank-details request and the role they used.

        // Function used to update VBD for Citi Integrator.
        // Copy the vendor and whether the bank-details record had been edited.
        function creatApprovalHistory(requestParams, action) {
            try {
                // Copy who last edited the record and the role used for that edit.
                var approvalsList = requestParams.approvals;
                log.audit(`postRequsePayload`, `postRequsePayload: ${JSON.stringify(approvalsList)}`);
                // Keep the before-and-after field values that were recorded for the request.
                var queryApprovaldIds = "SELECT name, id FROM customlist_ci_adv_approval_status WHERE name = 'Approved' OR name = 'Rejected'";
                //This is used to retrieve the internal id of the approval status with the name 'Approved' or 'Rejected'
                // Save the rejection reason, decision status, and time of the last change.
                var queryResults = query.runSuiteQL({ query: queryApprovaldIds }).asMappedResults();

                var approvalStatusId = queryResults.filter(function (result) {
                    // Link this history entry back to the bank-details record it describes.
                    if (result.name.toLowerCase() === action.toLowerCase()) {
                        // Save the history record and log its new internal ID.
                        return result.id;
                    } else {
                        return '';
                    }
                    // Log the failure and return its description to the caller.
                });
                log.audit('Approval Status Query', `queryResults: ${JSON.stringify(queryResults)} ApprovalListIds id: ${approvalStatusId[0].id}`);
                if (approvalsList.length > 0) {
                    var vendorBankDetailsId = approvalsList[0].VBDId;
                }
                else { log.audit('No approvals found in the request parameters'); return JSON.stringify({ error: 'No approvals found in the request parameters' }); }
                var systemNoteResult = getApprovalStatusSystemNote(vendorBankDetailsId);
                log.audit('System Note Result', `systemNoteResult: ${JSON.stringify(systemNoteResult)}`);
                // Identify the bank-details record that needs to be copied into history.
                const filterConditions = [];
                if (vendorBankDetailsId) {
                    filterConditions.push(['custrecord_ci_adv_vendor_bank_details', 'anyof', vendorBankDetailsId]);
                }
                if (systemNoteResult.requestedBy) {
                    filterConditions.push(["custrecord_ci_adv_createdby1", "anyof", systemNoteResult.requestedBy]);
                }
                if (systemNoteResult.vendorname) {
                    filterConditions.push(["custrecord_ci_adv_vendor_name", "anyof", systemNoteResult.vendorname]);
                }
                if (systemNoteResult.status) {
                    filterConditions.push(["custrecord_ci_adv_approval_status1", "anyof", systemNoteResult.status]);
                }
                if (systemNoteResult.lastModifiedAt) {
                    filterConditions.push(["custrecord_ci_adv_lastmodified_at1", "is", systemNoteResult.lastModifiedAt]);
                }
                if (systemNoteResult.modified !== '' && systemNoteResult.modified !== null && systemNoteResult.modified !== undefined) {
                    filterConditions.push(["custrecord_ci_adv_modified1", "is", systemNoteResult.modified]);
                }
                if (systemNoteResult.modifiedBy) {
                    filterConditions.push(["custrecord_ci_adv_modified_by1", "anyof", systemNoteResult.modifiedBy]);
                }
                if (systemNoteResult.modifiedByRole) {
                    filterConditions.push(["custrecord_ci_adv_modified_by_role1", "anyof", systemNoteResult.modifiedByRole]);
                }
                if (systemNoteResult.rejectedReason) {
                    filterConditions.push(["custrecord_ci_adv_reject_reason1", "is", systemNoteResult.rejectedReason]);
                }
                if (systemNoteResult.requestedByRole) {
                    filterConditions.push(["custrecord_ci_adv_creator_role1", "anyof", systemNoteResult.requestedByRole]);
                }
                if (systemNoteResult.oldValue) {
                    filterConditions.push(["custrecord_ci_old_values1", "contains", systemNoteResult.oldValue]);
                }
                if (systemNoteResult.newValue) {
                    filterConditions.push(["custrecord_ci_edited_values1", "contains", systemNoteResult.newValue]);
                }

                const filters = [];
                filterConditions.forEach((condition, index) => {
                    if (index > 0) {
                        filters.push('AND');
                    }
                    filters.push(condition);
                });
                //Checking Duplicate Approval History Record
                let approvalHistorySearch = search.create({
                    type: 'customrecord_ci_adv_approval_history',
                    filters: filters,
                    columns: [
                        'custrecord_ci_adv_vendor_name',
                    ]
                }).run().getRange({ start: 0, end: 1 });
                log.audit('Approval History Search Filters', JSON.stringify(filters));
                log.audit('Approval History Search Results', JSON.stringify(approvalHistorySearch));
                if(approvalHistorySearch && approvalHistorySearch.length > 0) {
                    log.audit('Approval History Record Exists', `Approval History Record already exists with ID: ${approvalHistorySearch[0].id}`);
                    return JSON.stringify({ approvalHistoryId: approvalHistorySearch[0].id });
                }
                else
                {
                    var approvalHistory = record.create({ type: 'customrecord_ci_adv_approval_history', isDynamic: true });
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_createdby1', systemNoteResult.requestedBy || '');
                    // Choose the bank-details fields needed to fill in the history record.
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_creator_role1', systemNoteResult.requestedByRole || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_vendor_name', systemNoteResult.vendorname || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_modified1', systemNoteResult.modified == null ? true : systemNoteResult.modified);
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_modified_by1', systemNoteResult.modifiedBy || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_modified_by_role1', systemNoteResult.modifiedByRole || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_old_values1', systemNoteResult.oldValue || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_edited_values1', systemNoteResult.newValue || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_reject_reason1', systemNoteResult.rejectedReason || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_approval_status1', systemNoteResult.status || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_lastmodified_at1', systemNoteResult.lastModifiedAt || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_vendor_bank_details', systemNoteResult.VBDId || '');
                    setValueSafely(approvalHistory, 'custrecord_ci_adv_created_at1', systemNoteResult.createdAt || '');
                    var approvalHistoryId = approvalHistory.save();
                    log.audit('Approval History Record Created', `Approval History Record Created with ID: ${approvalHistoryId}`);
                    return JSON.stringify({ approvalHistoryId: approvalHistoryId });
                }
              
            } catch (error) {
                log.error('Error in creatApprovalHistory', error);
                // Search for the selected record and request its most recently changed result.
                return 'Error occurred: ' + error.name + ': ' + error.message;
            }
        }
        // Return blank change details if the record could not be found.

        // Use the first search result to build the data for the history record.
        /**
        * Find who changed Approval Status and when.
                    // Read the latest system-note date and the user who made that change.
        *
        * Your existing Approval Routing API already uses System Notes
                    // Read the creator, vendor, and edit details from the bank-details record.
        * for this purpose.
        */
        const getApprovalStatusSystemNote = (recordId) => {
            try {
                let recordType = 'customrecord_ci_adv_entity_bank_details';
                let filters = new Array();
                filters.push(['internalid', 'anyof', recordId]);
                let columns = new Array();
                columns.push("custrecordci_adv_details")
                columns.push("custrecord_ci_adv_approval_status")
                columns.push("custrecord_ci_old_values")
                columns.push("custrecord_ci_edited_values")
                columns.push("custrecord_ci_adv_createdby")
                columns.push("custrecord_ci_adv_creator_role")
                columns.push("created")
                columns.push("custrecord_ci_adv_modified")
                columns.push("custrecord_ci_adv_modified_by")
                columns.push("custrecord_ci_adv_modified_by_role")
                columns.push("lastmodifiedby")
                columns.push("custrecord_ci_adv_reject_reason")
                columns.push("custrecord_ci_adv_lastmodified_at")
                columns.push("custrecord_ci_adv_created_at")
                columns.push(search.createColumn({ name: 'lastmodified', sort: search.Sort.DESC }))

                const systemNoteSearch = search.create({ type: recordType, filters: filters, columns: columns });
                const result = systemNoteSearch.run().getRange({ start: 0, end: 1 });

                if (!result || result.length === 0) { return { lastModifiedAt: '', lastModifiedBy: '' }; }
                const row = result[0];
                return {
                    requestedBy: row.getValue('custrecord_ci_adv_createdby'),
                    requestedByRole: row.getValue('custrecord_ci_adv_creator_role'),
                    vendorname: row.getValue('custrecordci_adv_details'),
                    modified: row.getValue('custrecord_ci_adv_modified'),
                    modifiedBy: row.getValue('custrecord_ci_adv_modified_by'),
                    modifiedByRole: row.getValue('custrecord_ci_adv_modified_by_role'),
                    lastModifiedAt: row.getValue('custrecord_ci_adv_lastmodified_at'),
                    createdAt: row.getValue('custrecord_ci_adv_created_at'),
                    oldValue: row.getValue('custrecord_ci_old_values'),
                    newValue: row.getValue('custrecord_ci_edited_values'),
                    status: row.getValue('custrecord_ci_adv_approval_status'),
                    rejectedReason: row.getValue('custrecord_ci_adv_reject_reason'),
                    VBDId: row.id,
                };
            } catch (e) {
                log.error({
                    title: 'System Note Search Failed - ' + recordId,
                    details: e
                });
                return {
                    requestedBy: '',
                    requestedByRole: '',
                    vendorname: '',
                    modified: '',
                    modifiedBy: '',
                    modifiedByRole: '',
                    lastModifiedAt: '',
                    createdAt: '',
                    oldValue: '',
                    newValue: '',
                    status: '',
                    rejectedReason: '',
                    VBDId: ''
                };
            }
        };
        /**
         * Retrieves the clean JSON object
         * @param {JSON} jsonValue
         * @returns {JSON} 
         */
        function cleanObject(jsonValue) {
            if (!jsonValue) {
                return {};
            }

            if (typeof jsonValue === 'object') {
                return jsonValue;
            }

            try {
                const parsedValue = JSON.parse(jsonValue);
                return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
                    ? parsedValue
                    : {};
            } catch (error) {
                log.error('Invalid JSON value', { jsonValue: jsonValue, error: error });
                return {};
            }
        }
        /**
         * Check if value is empty (null, undefined, empty array, empty object)
         * @param {string|[]|{}} stValue
         * @returns {boolean} - Returns true if the input value is empty
         */
        function isEmpty(stValue) {
            return ((stValue == 0 || stValue === '' || stValue == null || stValue == undefined) || (stValue.constructor === Array && stValue.length == 0) || (stValue.constructor === Object && (function (v) {
                for (var k in v)
                    return false;
                return true;
            })(stValue)));
        }

        return {
            onRequest: onRequest
        };
    });