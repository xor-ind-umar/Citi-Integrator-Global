/**
 *@NApiVersion 2.1
 *@NScriptType Suitelet
 *@NModuleScope SameAccount
 */
/**
 * Copyright (c) 2025, Xoriant Corporation and/or its affiliates. All rights reserved.
 *
 * @author Rutuja Tembare
 *
 * Script brief description:
 * This Suitelet is used to get the count of pending approval records and their associated vendor details.
 *
 *
 * Revision History:
 *
 * Date              Issue/Case         Author               	Issue Fix Summary
 * =============================================================================================
 * 2026/09/24                          	Rutuja Tembare           Initial version
 */

define(['N/search', 'N/record', 'N/query', 'N/log'],
	function (search, record, query, log) {

		/**
		 * Defines the function that is executed when a request is sent to a Suitelet.
		 * @param {Object} context - The Suitelet context containing request and response objects.
		 */
		function onRequest(context) {
			var request = context.request;
			var response = context.response;
			var method = request.method;

			log.audit('Suitelet Request Method', method);

			/* response.setHeader({
				name: 'Content-Type',
				type: 'application/json'
			}); */

			try {
				if (method === 'GET') {
					var requestParams = request.parameters;
					fetchApprovalHistory(context);
				} else if (method === 'POST') {

					var requestParams = request.body ? JSON.parse(request.body) : request.parameters;
					var data;
					log.audit('requestParams', JSON.stringify(requestParams));

					//	var action = requestParams.approvals && requestParams.approvals.action;
					var action = requestParams.action;
					log.audit('action', action);

					// Executing the code for the action extracted from Parameters.
					if (action == 'Approved' || action == 'Rejected') {
						data = saveVBDRecord(requestParams, action);
					} else {
						data = JSON.stringify({ error: 'Incorrect Action.' });
					}

					log.audit('doPost Function End');
					response.write(data);

				} else {
					response.write(JSON.stringify({ error: 'Unsupported HTTP Method' }));
				}

			} catch (err) {
				log.error('error', err);
				response.write(JSON.stringify({ success: false, error: err.name + ': ' + err.message }));
			}
		}

		// Function used to update VBD for Citi Integrator.
		function saveVBDRecord(requestParams, action) {
			try {
				var approvalsList = requestParams.approvals;
				log.audit(`postRequsePayload`, `postRequsePayload: ${JSON.stringify(approvalsList)}`);
				var queryApprovaldIds = "SELECT name, id FROM customlist_ci_adv_approval_status WHERE name = 'Approved' OR name = 'Rejected'";
				//This is used to retrieve the internal id of the approval status with the name 'Approved' or 'Rejected'
				var queryResults = query.runSuiteQL({ query: queryApprovaldIds }).asMappedResults();

				var approvalStatusId = queryResults.filter(function (result) {
					if (result.name.toLowerCase() === action.toLowerCase()) {
						return result.id;
					} else {
						return '';
					}
				});
				log.audit(`queryResults: ${JSON.stringify(queryResults)} ApprovalListIds id: ${approvalStatusId[0].id}`);
				if(approvalsList.length > 0){
					var vendorBankDetailsId = approvalsList[0].VBDId;
				}
				else{ log.audit('No approvals found in the request parameters'); return JSON.stringify({ error: 'No approvals found in the request parameters' }); }
				var values = { 'custrecord_ci_adv_approval_status': approvalStatusId[0].id };

				//This is used to add the rejection reason to the values object if the action is 'Rejected'
				if (action.toLowerCase() === 'rejected') {
					var rejectedReason = approvalsList[0].rejectionReason;
					values['custrecord_ci_adv_reject_reason'] = rejectedReason;
				}
				else{
					values['custrecord_ci_adv_reject_reason'] = '';
				}
				var submitResultId = record.submitFields({type: 'customrecord_ci_adv_entity_bank_details', id: vendorBankDetailsId, values: values});
				log.audit(`Values to submit ${JSON.stringify(values)} submitResultId ${submitResultId}`);
				var customrecordciadventitybankdetails = search.create({type: "customrecord_ci_adv_entity_bank_details",filters: [["internalid", "anyof", vendorBankDetailsId], "AND", ["systemnotes.field", "anyof", "CUSTRECORD_CI_ADV_APPROVAL_STATUS"]], columns: ['created', 'lastmodified', 'lastmodifiedby']
				}).run().getRange({ start: 0, end: 1 });
				var lastmodifiedby = '';
				var lastmodified = '';
				if (customrecordciadventitybankdetails.length > 0) {
					lastmodifiedby = customrecordciadventitybankdetails[0].getText('lastmodifiedby');
					lastmodified = customrecordciadventitybankdetails[0].getValue('lastmodified');
					log.audit('Last Modified Info', `lastmodifiedby: ${lastmodifiedby}, lastmodified: ${lastmodified}}`);
				}
				return JSON.stringify({
					Status: 'Record successfully submitted',
					'actioned at': lastmodified,
					'actioned by': lastmodifiedby
				});
			} catch (error) {
				log.error('Error in saveVBDRecord', error);
				return 'Error occurred: ' + error.name + ': ' + error.message;
			}
		}
		// Get Method Function.
		function fetchApprovalHistory(context) {
			try {
				let VBDlist = new Array();
				let userList = new Array();
				let approvalStatusList = 'customlist_ci_adv_approval_status';
				//let approvalValue = 'Approved' || 'Rejected';
				queryApprovaldIds = `SELECT id FROM ${approvalStatusList} WHERE name = 'Approved' OR name = 'Rejected'`;
				//This is used to retrieve the internal id of the approval status with the name 'Pending Approval'
				let queryResults = query.runSuiteQL({ query: queryApprovaldIds }).asMappedResults();
				// Convert each matching list row into the internal ID used by the search filter.
				let approvalStatusId = queryResults.map((result) => result.id);
				log.audit('approvalStatusId', approvalStatusId);

				// Searching the VBD details table by filterign the with specifc field called approval status.
				let VBDSearch = search.create({type: 'customrecord_ci_adv_entity_bank_details', filters: [['custrecord_ci_adv_approval_status', 'anyof', approvalStatusId], "AND", ["systemnotes.field", "anyof", "CUSTRECORD_CI_ADV_APPROVAL_STATUS"]],columns: ['custrecordci_adv_details', 'custrecord_ci_old_values','custrecord_ci_edited_values', 'custrecord_ci_adv_createdby', 'custrecord_ci_adv_creator_role', 'created', 'custrecord_ci_adv_modified', 'custrecord_ci_adv_modified_by', 'custrecord_ci_adv_modified_by_role', 'lastmodified','lastmodifiedby','custrecord_ci_adv_reject_reason','custrecord_ci_adv_approval_status']});

				VBDSearch = getFullResultSet(VBDSearch);
				log.audit('VBDSearch',`VBDSearch: ${JSON.stringify(VBDSearch)} VBDSearch length: ${VBDSearch.length}`);

				// Executing the code only when the Entitlement Manager search is not empty.
				if (!isEmpty(VBDSearch)) {
					// Traversing in the Entitlement List Array to populate the permissions from Entitlement Manager Search.
					for (let vbd = 0; vbd < VBDSearch.length; vbd++) {
						let modified = VBDSearch[vbd].getValue('custrecord_ci_adv_modified');
						let modifiedDate;
						//	if (VBDSearch[vbd].getText('custrecord_ci_adv_createdby') == currentUser.name) { isCreatorCurrentUser = true; }
						if(modified === false && modified === 'F'){modifiedDate = '';}else{modifiedDate = VBDSearch[vbd].getValue('lastmodified');}
						VBDlist.push({
							requestedBy: VBDSearch[vbd].getText('custrecord_ci_adv_createdby'),
							requestedByRole: VBDSearch[vbd].getText('custrecord_ci_adv_creator_role'),
							vendorname: VBDSearch[vbd].getText('custrecordci_adv_details'),
							createdAt: VBDSearch[vbd].getValue('created'),
							modified: modified,
							modifiedBy: VBDSearch[vbd].getText('custrecord_ci_adv_modified_by'),
							modifiedByRole: VBDSearch[vbd].getText('custrecord_ci_adv_modified_by_role'),
							lastModified: modifiedDate,
							oldValue: cleanObject(VBDSearch[vbd].getValue('custrecord_ci_old_values')),
							newValue: cleanObject(VBDSearch[vbd].getValue('custrecord_ci_edited_values')),
							actionedAt: VBDSearch[vbd].getValue('lastmodified'),
							actionedBy: VBDSearch[vbd].getText('lastmodifiedby'),
							status: VBDSearch[vbd].getText('custrecord_ci_adv_approval_status'),
							rejectedReason: VBDSearch[vbd].getValue('custrecord_ci_adv_reject_reason'),
							VBDId: VBDSearch[vbd].id,
							//isCreatorCurrentUser: isCreatorCurrentUser,

						});
						log.debug('VBDlist after processing create record', JSON.stringify(VBDlist));
					}
				}
				//userList.push({ isCurrentUserEntitled: isCurrentUserEntitled, currentUser: currentUser.name, currentuserId: currentUser.id, CurrentuserRole: currentUser.role });
				//var bodyVal = { 'approvalList': VBDlist, 'runtimeUser': userList };
				var bodyVal =  {'approvalHistory': VBDlist};
				log.audit(`Request Body`, 'bodyVal', JSON.stringify(bodyVal))
				context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=UTF-8' });
				context.response.write({ output: JSON.stringify(bodyVal) });

			} catch (error) {
				log.error('Error processing request', error);
				context.response.write({ output: JSON.stringify({ error: error.message }) });
			}

		}
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
		 * Retrieves the entire result set
		 * @param {search.Search} mySearch
		 * @returns {Array<search.Result>} searchResults - Returns an array of search results
		 */
		function getFullResultSet(mySearch) {
			var searchResults = [],
				pagedData;
			pagedData = mySearch.runPaged({ pageSize: 1000 });
			pagedData.pageRanges.forEach(function (pageRange) {
				var page = pagedData.fetch({ index: pageRange.index });
				page.data.forEach(function (result) {
					searchResults.push(result);
				});
			});
			return searchResults;
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