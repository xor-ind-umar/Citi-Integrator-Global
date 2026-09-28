/**
 *@NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
*/
/**
* Copyright (c) 2026, CitiBank and/or its affiliates. All rights reserved.
*
* @author Umar
*
* Script brief description:
- This script is used to return the pending approval VBD Details to be showed in Approval dashboard for Citi Integrator.
*
*
* Revision History:
*
* Date              Issue/Case         Author               	Issue Fix Summary
* =============================================================================================
* 2026/07/13                          Vishal Pitale        	    Initial version
*/

define(['N/search', 'N/record', 'N/https', 'N/query', 'N/runtime'],
	function (search, record, https, query, runtime) {

		let saveMaxLimit = 25;

		function onRequest(context) {
			log.debug("onRequest Function Start");
			try {

				// Conditional Exection for GET method.
				if (context.request.method == https.Method.GET) {
					getMethod(context);
				}

			} catch (e) { log.error('Error', e); }
		}
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
		// Get Method Function.
		function getMethod(context) {
			try {
				let VBDlist = new Array();
				let userList = new Array();
				let approvalStatusList = 'customlist_ci_adv_approval_status';
				let approvalValue = 'Pending Approval';
				queryApprovaldIds = `SELECT id FROM ${approvalStatusList} WHERE name = '${approvalValue}'`;
				//This is used to retrieve the internal id of the approval status with the name 'Pending Approval'
				let queryResults = query.runSuiteQL({ query: queryApprovaldIds }).asMappedResults();
				log.debug('queryResults', queryResults)
				// Convert each matching list row into the internal ID used by the search filter.
				let approvalStatusId = queryResults.map((result) => result.id);
				log.debug('approvalStatusId', approvalStatusId);
				let currentUser = runtime.getCurrentUser();

				let queryEntitle = `SELECT id FROM customlist_ci_entitlements WHERE name = 'Vendor Bank Details Approver'`;
				//This is used to retrieve the internal id of the entitlement with the name 'Vendor Bank Details Approver' or 'Vendor Bank Details'
				let queryEntitleId = query.runSuiteQL({ query: queryEntitle }).asMappedResults();
				log.debug('queryEntitleId', queryEntitleId);
				queryEntitleId = queryEntitleId.map((result) => result.id);
				log.debug('queryEntitleId mapped', queryEntitleId);

				let queryEntitledResults = [];
				if (queryEntitleId.length > 0) {
					queryEntitledResults = search.create({ type: 'customrecord_ci_entitlement_manager', filters: [['custrecord_ci_ent_mgr_user_permissions', 'anyof', queryEntitleId], 'AND', ['custrecord_ci_ent_mgr_user', 'anyof', currentUser.id], 'AND', ['custrecord_ci_ent_mgr_user_role', 'anyof', currentUser.role]] }).run().getRange({ start: 0, end: 1000 });
					log.debug('queryEntitledResults', queryEntitledResults);
				}
				let isCurrentUserEntitled = false, isCreatorCurrentUser = false;
				if (queryEntitledResults && queryEntitledResults.length > 0) isCurrentUserEntitled = true;
				log.debug('isCurrentUserEntitled', isCurrentUserEntitled);

				// Searching the VBD details table.
				let VBDSearch = search.create({
					type: 'customrecord_ci_adv_entity_bank_details', filters: [['custrecord_ci_adv_approval_status', 'anyof', approvalStatusId]],
					columns: ['custrecordci_adv_details', 'custrecord_ci_old_values', 'custrecord_ci_edited_values', 'custrecord_ci_adv_createdby', 'custrecord_ci_adv_creator_role', 'created', 'custrecord_ci_adv_modified', 'custrecord_ci_adv_modified_by', 'custrecord_ci_adv_modified_by_role', 'lastmodified']
				});

				VBDSearch = getFullResultSet(VBDSearch);
				log.audit('VBDSearch', VBDSearch);
				log.audit('VBDSearch length', VBDSearch.length);
				log.audit('VBDSearch length', VBDSearch.length);

				// Executing the code only when the Entitlement Manager search is not empty.
				if (!isEmpty(VBDSearch)) {
					// Traversing in the Entitlement List Array to populate the permissions from Entitlement Manager Search.
					for (let vbd = 0; vbd < VBDSearch.length; vbd++) {
						log.audit('VBDSearch current record', VBDSearch[vbd].getText('custrecordci_adv_details'));
						log.audit('custrecord_ci_old_values', VBDSearch[vbd].getValue('custrecord_ci_old_values'));
						log.audit('custrecord_ci_edited_values', VBDSearch[vbd].getValue('custrecord_ci_edited_values'));
						log.audit('custrecord_ci_adv_createdby', VBDSearch[vbd].getValue('custrecord_ci_adv_createdby'));
						let modified = VBDSearch[vbd].getValue('custrecord_ci_adv_modified');
						if (VBDSearch[vbd].getText('custrecord_ci_adv_createdby') == currentUser.name) { isCreatorCurrentUser = true; }
						VBDlist.push({
							requestedBy: VBDSearch[vbd].getText('custrecord_ci_adv_createdby'),
							requestedByRole: VBDSearch[vbd].getText('custrecord_ci_adv_creator_role'),
							vendorname: VBDSearch[vbd].getText('custrecordci_adv_details'),
							createdAt: VBDSearch[vbd].getValue('created'),
							modified: modified,
							modifiedBy: VBDSearch[vbd].getText('custrecord_ci_adv_modified_by'),
							modifiedByRole: VBDSearch[vbd].getText('custrecord_ci_adv_modified_by_role'),
							oldValue: cleanObject(VBDSearch[vbd].getValue('custrecord_ci_old_values')),
							newValue: cleanObject(VBDSearch[vbd].getValue('custrecord_ci_edited_values')),
							lastModified: VBDSearch[vbd].getValue('lastmodified'),
							VBDId: VBDSearch[vbd].id,
							isCreatorCurrentUser: isCreatorCurrentUser,

						});
						log.debug('modified', modified)
						if (modified === false || modified === 'F') // For the Create Record only showing the new value by renaming the oldValue key to newValue.
						{
							let item = VBDlist[VBDlist.length - 1];
							if (Object.prototype.hasOwnProperty.call(item, 'oldValue')) {
								item.newValue = item.oldValue;
								delete item.oldValue;
								log.audit('Renamed oldValue to newValue for create record', item);
							}
						}
						log.debug('VBDlist after processing create record', JSON.stringify(VBDlist));
					}
				}
				userList.push({ isCurrentUserEntitled: isCurrentUserEntitled, currentUser: currentUser.name, currentuserId: currentUser.id, CurrentuserRole: currentUser.role });
				var bodyVal = { 'approvalList': VBDlist, 'runtimeUser': userList };
				log.debug('bodyVal', JSON.stringify(bodyVal))
				context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=UTF-8' });
				context.response.write({ output: JSON.stringify(bodyVal) });

			} catch (error) {
				log.error('Error processing request', error);
				context.response.write({ output: JSON.stringify({ error: error.message }) });
			}

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
			return ((stValue == 0 || stValue === '' || stValue == null || stValue == undefined) || (stValue.letructor === Array && stValue.length == 0) || (stValue.letructor === Object && (function (v) {
				for (let k in v)
					return false;
				return true;
			})(stValue)));
		}

		return {
			onRequest: onRequest
		};
	});
