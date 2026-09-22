/**
 *@NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
*/
/**
* Copyright (c) 2026, CitiBank and/or its affiliates. All rights reserved.
*
* @author Vishal Pitale
*
* Script brief description:
- This script is used to return the Entitlement Details to be showed in Entitlement Manager for Citi Integrator.
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

		var saveMaxLimit = 25;

		function onRequest(context) {
			log.debug("onRequest Function Start");
			try {

				// Conditional Exection for GET method.
				if (context.request.method == https.Method.GET) {
					getMethod(context);
				}

			} catch (e) { log.error('Error', e); }
		}

		// Get Method Function.
		function getMethod(context) {

			var entitlementList = new Array();

			// Searching active roles which are valid.
			var roleSearch = search.create({ type: search.Type.ROLE, filters: [['isinactive', 'is', 'F']], columns: ['name'] });

			roleSearch = getFullResultSet(roleSearch);
			log.audit('roleSearch', roleSearch);

			// Searching active employees with roles assigned.
			var empSearch = search.create({
				type: search.Type.EMPLOYEE,
				filters: [['isinactive', 'is', 'F'], 'AND', ['role', 'noneof', '@NONE@']],
				columns: ['entityid', 'email', 'role']
			});

			empSearch = getFullResultSet(empSearch);
			log.audit('empSearch', empSearch);

			// Executing the code only when the employee search is not empty.
			if (!isEmpty(empSearch)) {

				// Populating the Entitlement List.
				for (var loop1 = 0; loop1 < empSearch.length; loop1++) {

					var employeeId = empSearch[loop1].id;
					var employeeName = empSearch[loop1].getValue({ name: 'entityid' });
					var employeeEmail = empSearch[loop1].getValue({ name: 'email' });
					var employeeRoleId = empSearch[loop1].getValue({ name: 'role' });
					var employeeRoleName = empSearch[loop1].getText({ name: 'role' });

					// Traversing through the role list to allow acceptable roles only.
					for (var loop11 = 0; loop11 < roleSearch.length; loop11++) {
						var existingRoleId = roleSearch[loop11].id;

						// Allowing only selectable roles from Entitlement Manager record to be shown in the list.
						if (employeeRoleId == existingRoleId) {
							entitlementList.push({
								employeeId: employeeId,
								employeeName: employeeName,
								employeeRoleId: employeeRoleId,
								employeeRoleName: employeeRoleName,
								employeeEmail: employeeEmail,
								accountsDashboard: false,
								// accountsConfiguration: false,
								// dataExportHub: false,
								// accountDetails: false,
								invoicePayments: false,
								vendorBankDetails: false,
								// invoicePaymentsPayNow: false,
								vendorBankDetailsApprover: false //rutuja 21st sept
							});
							break;
						}
					}
				}


				// Searching the Entitlement Management table.
				var entMgrSearch = search.create({
					type: 'customrecord_ci_entitlement_manager', filters: [['isinactive', 'is', 'F']],
					columns: ['custrecord_ci_ent_mgr_user', 'custrecord_ci_ent_mgr_user_role', 'custrecord_ci_ent_mgr_user_permissions']
				});

				entMgrSearch = getFullResultSet(entMgrSearch);
				log.audit('entMgrSearch', entMgrSearch);

				// Executing the code only when the Entitlement Manager search is not empty.
				if (!isEmpty(entMgrSearch)) {

					// Traversing in the Entitlement List Array to populate the permissions from Entitlement Manager Search.
					for (var loop2 = 0; loop2 < entitlementList.length; loop2++) {

						var listEmpId = entitlementList[loop2].employeeId;
						var listEmpRoleId = entitlementList[loop2].employeeRoleId;

						for (var loop3 = 0; loop3 < entMgrSearch.length; loop3++) {

							var mgrEmpId = entMgrSearch[loop3].getValue({ name: 'custrecord_ci_ent_mgr_user' });
							var mgrRoleId = entMgrSearch[loop3].getValue({ name: 'custrecord_ci_ent_mgr_user_role' });

							// Matching the Employee and Roles to apply permissions from Entitlement Manager Search.
							if (listEmpId == mgrEmpId && listEmpRoleId == mgrRoleId) {

								var permissionListVal = entMgrSearch[loop3].getText({ name: 'custrecord_ci_ent_mgr_user_permissions' });

								// Executing the code only when the permissions are not empty.
								if (!isEmpty(permissionListVal)) {
									permissionListVal = permissionListVal.split(',');
									log.audit('mgrEmpId', mgrEmpId);

									log.audit('permissionListVal', permissionListVal);


									// Updating the permissions.
									for (var loop4 = 0; loop4 < permissionListVal.length; loop4++) {
										var permissionValue = permissionListVal[loop4];

										if (permissionValue == 'Accounts Dashboard') { entitlementList[loop2].accountsDashboard = true; }
										// if (permissionValue == 'Accounts Configuration (inactive)') { entitlementList[loop2].accountsConfiguration = true; }
										// if (permissionValue == 'Data Export Hub (inactive)') { entitlementList[loop2].dataExportHub = true; }
										// if (permissionValue == 'Account Details (inactive)') { entitlementList[loop2].accountDetails = true; }
										if (permissionValue == 'Invoice Payments') { entitlementList[loop2].invoicePayments = true; }
										if (permissionValue == 'Vendor Bank Details') { entitlementList[loop2].vendorBankDetails = true; }
										// if (permissionValue == 'Invoice Payments Pay Now (inactive)') { entitlementList[loop2].invoicePaymentsPayNow = true; }
										if (permissionValue == 'Vendor Bank Details Approver') { entitlementList[loop2].vendorBankDetailsApprover = true; } //rutuja 21st sept
									}
								}
							}
						}
					}
				}
			}

			log.audit('entitlementList', entitlementList);

			var bodyVal = { 'saveMaxLimit': saveMaxLimit, 'entitlementList': entitlementList };
			// return JSON.stringify(bodyVal);

			context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
			// context.response.write(JSON.stringify(bodyVal));
			context.response.write(JSON.stringify(bodyVal));
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