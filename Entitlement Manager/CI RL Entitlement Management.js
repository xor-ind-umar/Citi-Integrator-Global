/**
 *@NApiVersion 2.1
 *@NScriptType Restlet
 *@NModuleScope SameAccount
*/
/**
* Copyright (c) 2026, CitiBank and/or its affiliates. All rights reserved.
*
* @author Vishal Pitale
*
* Script brief description:
- This script is used to save the Entitlement Details Data from Entitlement Manager react app for Citi Integrator.
*
*
* Revision History:
*
* Date              Issue/Case         Author               	Issue Fix Summary
* =============================================================================================
* 2026/07/13                          Vishal Pitale        	    Initial version
*/

define(['N/search', 'N/record', 'N/https'],
	function (search, record, https) {


		/**
		 * Defines the function that is executed when a GET request is sent to a RESTlet.
		 * @param {Object} requestParams - The request parameters.
		 * @returns {Object} The request parameters.
		 */
		function doGet(requestParams) {
			log.audit('doGet Function Start');
			log.audit('requestParams', JSON.stringify(requestParams));
			log.audit('doGet Function End');
			return requestParams;
		}
		/**
		 * Defines the function that is executed when a POST request is sent to a RESTlet.
		 * @param {string | Object} requestBody - The HTTP request body; request body is passed as a string when request
		 *     Content-Type is 'text/plain' or parsed into an Object when request Content-Type is 'application/json' (in which case
		 *     the body must be a valid JSON)
		 * @returns {string | Object} HTTP response body; returns a string when request Content-Type is 'text/plain'; returns an
		 *     Object when request Content-Type is 'application/json' or 'application/xml'
		 * @since 2015.2
		 */
		function doPost(requestParams) {
			log.audit("doPost Function Start");
			try {
				let data;
				log.audit('requestParams', JSON.stringify(requestParams));

				let action = requestParams.approvals.action;
				log.audit('action', action);

				// Executing the code for the action extracted from Parameters.
				if (action == 'approve') {
					data = saveVBDRecord(requestParams);
				}
				else {
					data = 'Incorrect Action.';
				}

				log.audit('doPost Function End');
				return data;

			} catch (err) { log.error('error', err); return 'Error: ' + err.name; }
		}
		// Function used to create/update Entitlements for Citi Integrator.
		function saveVBDRecord(requestParams) {
			let approvalsList = requestParams.approvals.approvalList;
			let searchFilters = new Array();
			log.audit('approvalsList', approvalsList);

			// Entitlement List search to get their internal ids.
			const entitlementsSearch = search.create({ type: 'customlist_ci_adv_approval_status', filters: [['isinactive', 'is', 'F']], columns: ['name'] }).run().getRange(0, 999);
			log.audit('entitlementsSearch', entitlementsSearch);

			let queryApprovaldIds = `SELECT id FROM ${approvalStatusList} WHERE name = 'Approved' OR name = 'Rejected'`;
			//This is used to retrieve the internal id of the approval status with the name 'Pending Approval'
			let queryResults = query.runSuiteQL({ query: queryApprovaldIds }).asMappedResults();
			log.debug('queryResults',queryResults)

			// Creating the filter for searching the Entitlement Manager.
			for (let loop1 = 0; loop1 < approvalsList.length; loop1++) {
				let employeeId = approvalsList[loop1].VBDId;
				let employeeRoleId = approvalsList[loop1].employeeRoleId;
				searchFilters.push([['custrecord_ci_ent_mgr_user', 'anyof', employeeId], 'AND', ['custrecord_ci_ent_mgr_user_role', 'anyof', employeeRoleId]]);

				// Adding OR condition only when it is not a last JSON entry.
				if (loop1 < (approvalsList.length - 1)) { searchFilters.push('OR'); }
			}

			entMgrSearch = getFullResultSet(entMgrSearch);
			log.audit('entMgrSearch', entMgrSearch)

			return 'Entitlement Changes Saved';
		}


		// Function to get the permissions in an Array to be updated in Entitlement Manager Record.
		function getEntMgrPermissionSubmitValues(entitlementsSearch, accountsDashboard, invoicePayments, vendorBankDetails, vendorBankDetailsApprover) { //rutuja 21st sept added vendorBankDetailsApprover
			let submitValues = new Array();

			// Traversing through the CI Entitlement List to get the internal ids of the permissions.
			for (let loop4 = 0; loop4 < entitlementsSearch.length; loop4++) {
				let entId = entitlementsSearch[loop4].id;
				let entName = entitlementsSearch[loop4].getValue({ name: 'name' });

				// Creating array to be updated for permission list.
				if (accountsDashboard == true && entName == 'Accounts Dashboard') { submitValues.push(entId); }
				// if (accountsConfiguration == true && entName == 'Accounts Configuration (inactive)') { submitValues.push(entId); }
				// if (dataExportHub == true && entName == 'Data Export Hub (inactive)') { submitValues.push(entId); }
				// if (accountDetails == true && entName == 'Account Details (inactive)') { submitValues.push(entId); }
				if (invoicePayments == true && entName == 'Invoice Payments') { submitValues.push(entId); }
				if (vendorBankDetails == true && entName == 'Vendor Bank Details') { submitValues.push(entId); }
				// if (invoicePaymentsPayNow == true && entName == 'Invoice Payments Pay Now (inactive)') { submitValues.push(entId); }
				if (vendorBankDetailsApprover == true && entName == 'Vendor Bank Details Approver') { submitValues.push(entId); } //rutuja 21st sept

			}

			return submitValues;
		}


		/**
		* Retrieves the entire result set
		* @param {search.Search} mySearch
		* @returns {Array<search.Result>} searchResults - Returns an array of search results
		*/
		function getFullResultSet(mySearch) {
			let searchResults = [],
				pagedData;
			pagedData = mySearch.runPaged({ pageSize: 1000 });
			pagedData.pageRanges.forEach(function (pageRange) {
				let page = pagedData.fetch({ index: pageRange.index });
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
				for (let k in v)
					return false;
				return true;
			})(stValue)));
		}

		return {
			get: doGet,
			post: doPost
		};
	});