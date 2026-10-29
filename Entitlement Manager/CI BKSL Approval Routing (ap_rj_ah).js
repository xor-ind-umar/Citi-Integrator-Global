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

define(['N/search', 'N/record', 'N/query', 'N/log', 'N/format', 'N/https','N/runtime'],
	function (search, record, query, log, format, https, runtime) {

		/**
		 * Defines the function that is executed when a request is sent to a Suitelet.
		 * @param {Object} context - The Suitelet context containing request and response objects.
		 */
		function onRequest(context) {
			var request = context.request;
			var response = context.response;
			var method = request.method;

			log.audit('Suitelet Request Method', method);
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
				log.audit('Approval Status Query',`queryResults: ${JSON.stringify(queryResults)} ApprovalListIds id: ${approvalStatusId[0].id}`);
				if (approvalsList.length > 0) {
					var vendorBankDetailsId = approvalsList[0].VBDId;
				}
				else { log.audit('No approvals found in the request parameters'); return JSON.stringify({ error: 'No approvals found in the request parameters' }); }
				var values = { 'custrecord_ci_adv_approval_status': approvalStatusId[0].id };

				//This is used to add the rejection reason to the values object if the action is 'Rejected'
				if (action.toLowerCase() === 'rejected') {
					var rejectedReason = approvalsList[0].rejectionReason;
					values['custrecord_ci_adv_reject_reason'] = rejectedReason;
				}
				else {
					values['custrecord_ci_adv_reject_reason'] = '';
				}
				var systemNoteResult = getApprovalStatusSystemNote(vendorBankDetailsId);
				var lastModifiedAt = systemNoteResult.lastModifiedAt;
				var createdAt = systemNoteResult.createdAt;
				values['custrecord_ci_adv_lastmodified_at'] = lastModifiedAt;
				values['custrecord_ci_adv_created_at'] = createdAt;
				var submitResultId = record.submitFields({ type: 'customrecord_ci_adv_entity_bank_details', id: vendorBankDetailsId, values: values });
				log.audit('Vendor Bank Details Update',`Values to submit ${JSON.stringify(values)} submitResultId ${submitResultId}`);

				// Call the backend Suitelet directly without building an external URL.
				let response = https.requestSuitelet({
					scriptId: 'customscript_ci_adv_bksl_ah',
					deploymentId: 'customdeploy_ci_adv_bksl_ah',
					method: https.Method.POST,
					body: JSON.stringify(requestParams),
					headers: {
						'Content-Type': 'application/json'
					}
				});
				log.audit(`Response from Suitelet`, `Response: ${JSON.stringify(response)}`);
				// Handle the conversion result sent back by the backend Suitelet
				let approvalHistoryId = '';
				let responseBody = {};
				if (response.code === 200) {
					responseBody = JSON.parse(response.body);
					log.debug('Converted Date from Backend', responseBody);
					approvalHistoryId = responseBody.approvalHistoryId;
				} else {
					log.error('Suitelet Error Status Code: ' + response.code, response.body);
					responseBody = response.body
				}
				return JSON.stringify({
					Status: 'Record successfully submitted',
					'actioned at': lastModifiedAt,
					'actioned by': runtime.getCurrentUser().name,
					'approvalHistoryId': approvalHistoryId,
					'responseBody': responseBody
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
				//rutuja changed VBDSearch to VBDSearchData 9th oct
				let filters = new Array();
				filters.push(['custrecord_ci_adv_approval_status1', 'is', approvalStatusId]);
				/* filters.push("AND");
				filters.push(["systemnotes.field", "anyof", "custrecord_ci_adv_approval_status1"]); */
				let columns = new Array();
				columns.push('custrecord_ci_adv_vendor_name');
				columns.push('custrecord_ci_old_values1');
				columns.push('custrecord_ci_edited_values1');
				columns.push('custrecord_ci_adv_createdby1');
				columns.push('custrecord_ci_adv_creator_role1');
				columns.push('created');
				columns.push('custrecord_ci_adv_modified1');
				columns.push('custrecord_ci_adv_modified_by1');
				columns.push('custrecord_ci_adv_modified_by_role1');
				columns.push('lastmodifiedby');
				columns.push('custrecord_ci_adv_reject_reason1');
				columns.push('custrecord_ci_adv_approval_status1');
				columns.push('custrecord_ci_adv_lastmodified_at1');
				columns.push('custrecord_ci_adv_created_at1');
				columns.push(search.createColumn({ name: 'lastmodified', sort: search.Sort.DESC }));

				let VBDSearchData = search.create({ type: 'customrecord_ci_adv_approval_history', filters: filters, columns: columns });
				var pageIndex = context.request.parameters.pageIndex || 0, pageSize = context.request.parameters.pageSize || 100; //rutuja made changes for pagination

				var VBDSearch = getFullResultSet(VBDSearchData, pageIndex, pageSize); //rutuja made changes for pagination
				log.audit('VBDSearch', `VBDSearch: ${JSON.stringify(VBDSearch)} VBDSearch length: ${VBDSearch.length}`);
				const totalPages = VBDSearch.totalPages; //rutuja changes 9th oct
				log.audit('VBD totalPages', totalPages);

				const totalCount = VBDSearch.totalCount; //rutuja changes 9th oct
				log.audit('VBD totalCount', totalCount);

				VBDSearch = VBDSearch.searchData; //rutuja changes 9th oct
				log.audit('VBD VBDSearch', VBDSearch);

				// Executing the code only when the Entitlement Manager search is not empty.
				if (!isEmpty(VBDSearch)) {
					// Traversing in the Entitlement List Array to populate the permissions from Entitlement Manager Search.
					for (let vbd = 0; vbd < VBDSearch.length; vbd++) {
						let modified = VBDSearch[vbd].getValue('custrecord_ci_adv_modified1');
						let modifiedDate;
						//If the record has modified 
						if (modified === false && modified === 'F') { modifiedDate = ''; }
						else {modifiedDate = VBDSearch[vbd].getValue('custrecord_ci_adv_lastmodified_at1');}
						VBDlist.push({
							requestedBy: VBDSearch[vbd].getText('custrecord_ci_adv_createdby1'),
							requestedByRole: VBDSearch[vbd].getText('custrecord_ci_adv_creator_role1'),
							vendorname: VBDSearch[vbd].getText('custrecord_ci_adv_vendor_name'),
							createdAt: VBDSearch[vbd].getValue('custrecord_ci_adv_created_at1'),
							modified: modified,
							modifiedBy: VBDSearch[vbd].getText('custrecord_ci_adv_modified_by1'),
							modifiedByRole: VBDSearch[vbd].getText('custrecord_ci_adv_modified_by_role1'),
							lastModified: modifiedDate,
							oldValue: cleanObject(VBDSearch[vbd].getValue('custrecord_ci_old_values1')),
							newValue: cleanObject(VBDSearch[vbd].getValue('custrecord_ci_edited_values1')),
							actionedAt: VBDSearch[vbd].getValue('lastmodified'),
							actionedBy: VBDSearch[vbd].getText('lastmodifiedby'),
							status: VBDSearch[vbd].getText('custrecord_ci_adv_approval_status1'),
							rejectedReason: VBDSearch[vbd].getValue('custrecord_ci_adv_reject_reason1'),
							VBDId: VBDSearch[vbd].id,
							//isCreatorCurrentUser: isCreatorCurrentUser,

						});
						log.audit('modified', modified)
						if (modified === false || modified === 'F') // For the Create Record only showing the new value by renaming the oldValue key to newValue.
						{
							let item = VBDlist[VBDlist.length - 1];
							if (Object.prototype.hasOwnProperty.call(item, 'oldValue')) {
								item.newValue = item.oldValue;
								delete item.oldValue;
								log.audit('Renamed oldValue to newValue for create record', item);
							}
						}
						log.audit('VBDlist after processing create record', JSON.stringify(VBDlist));
					}
				}
				var bodyVal = { 'totalPages': totalPages, 'totalCount': totalCount, 'approvalHistory': VBDlist };
				log.audit(`Request Body`, 'bodyVal', JSON.stringify(bodyVal))
				context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=UTF-8' });
				context.response.write({ output: JSON.stringify(bodyVal) });

			} catch (error) {
				log.error('Error processing request', error);
				context.response.write({ output: JSON.stringify({ error: error.message }) });
			}

		}
		/**
	* Find who changed Approval Status and when.
	*
	* Your existing Approval Routing API already uses System Notes
	* for this purpose.
	*/
		const getApprovalStatusSystemNote = (recordId) => {
			try {
				const systemNoteSearch = search.create({ type: 'customrecord_ci_adv_entity_bank_details', filters: [['internalid', 'anyof', recordId]], columns: [search.createColumn({ name: 'date', join: 'systemnotes', sort: search.Sort.DESC }), search.createColumn({ name: 'name', join: 'systemnotes' }), search.createColumn({ name: 'newvalue', join: 'systemnotes' }),'created','lastmodified','lastmodifiedby']});
				const result = systemNoteSearch.run().getRange({ start: 0, end: 1 });

				if (!result || result.length === 0) { return { lastModifiedAt: '', lastModifiedBy: '' }; }
				const row = result[0];
				return {
					lastModifiedAt: row.getValue({ name: 'lastmodified' }) || '',
					lastModifiedBy: row.getText({ name: 'lastmodifiedby' }) || row.getValue({ name: 'lastmodifiedby'}) || '',
					createdAt: row.getValue({ name: 'created' }) || ''
				};
			} catch (e) {
				log.error({
					title: 'System Note Search Failed - ' + recordId,
					details: e
				});
				return {
					lastModifiedBy: '',
					lastModifiedAt: '',
					createdAt: ''
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
		 * Retrieves the entire result set
		 * @param {search.Search} mySearch
		 * @returns {Array<search.Result>} searchResults - Returns an array of search results
		 */
		function getFullResultSet(mySearch, pageIndex, pageSize) { //rutuja made changes for pagination
			let searchResults = [];
			let pagedData = mySearch.runPaged({ pageSize: pageSize });

			const totalPages = pagedData.pageRanges.length; //rutuja changes 9th oct
			const totalCount = pagedData.count; //rutuja changes 9th oct

			// Check if the requested page index exists before fetching
			if (pagedData.pageRanges.length > pageIndex) {
				let page = pagedData.fetch({ index: pageIndex });
				page.data.forEach(function (result) {
					searchResults.push(result);
				});
			}
			return { 'totalCount': totalCount, 'totalPages': totalPages, 'searchData': searchResults }; //rutuja changes 9th oct
		}
		//rutuja made changes for pagination

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