/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/runtime', 'N/search', 'N/query', 'N/record'], (runtime, search, query, record) => {

	// Keep script settings together so record types and field IDs are easy to find.
	const CONFIG = {
		// Identify the entitlement record and the fields used to check a person's access.
		recordType: 'customrecord_ci_entitlement_manager',
		userFieldId: 'custrecord_ci_ent_mgr_user',
		roleFieldId: 'custrecord_ci_ent_mgr_user_role',
		inputFieldId: 'custrecord_ci_ent_mgr_user_permissions',
		// Identify where the script saves the original and edited field values.
		createValuesFieldId: 'custrecord_ci_old_values',
		editedValuesFieldId: 'custrecord_ci_edited_values',
		// Identify the lists and field used to set entitlement approval status.
		entitlementsListId: 'customlist_ci_entitlements',
		approvalStatusListId: 'customlist_ci_adv_approval_status',
		approvalStatusFieldId: 'custrecord_ci_adv_approval_status',
		pendingApprovalName: 'Pending Approval',
		// Name the entitlement needed for bank-detail approval actions.
		createEntitlementName: 'Vendor Bank Details Approver',
		editEntitlementName: 'Vendor Bank Details',
		// Identify the bank-details record and the configuration that enables this feature.
		VBDrecordType: 'customrecord_ci_adv_entity_bank_details',
		configRecordType: 'customrecord_ci_adv_general_config',
		entitledCheck: 'custrecord_ci_adv_enable_entitle'
	};

	// Checks whether the event is a record creation or edit.
	const isCreateOrEdit = (eventType) =>
		// Only record these changes when someone creates a record or edits an existing one.
		eventType === 'create' || eventType === 'edit';

	// Reads a field value and converts missing values to an empty string.
	const getFieldValue = (record, fieldId) => {
		// Ask NetSuite for the field's current value.
		const value = record.getValue({ fieldId });
		// Convert NetSuite's checkbox-on marker into the JSON boolean true.
		if(value === 'T'){return true;}
		// Convert NetSuite's checkbox-off marker into the JSON boolean false.
		if(value === 'F'){return false;}
		// Treat missing values as blank so later checks have one consistent representation.
		return value === null || value === undefined ? '' : value;
	};

	// Gets the readable display value for a field, resolving vendor IDs when needed.
	const getFieldDisplayValue = (record, fieldId) => {
		// Read the stored value first; a blank field has no display label to look up.
		const rawValue = getFieldValue(record, fieldId);
		if (rawValue === '') {
			return '';
		}

		const field = record.getField({ fieldId });
		// Keep the field label so the vendor reference can receive special handling below.
		const fieldLabel = field && field.label;

		try {
			// Ask NetSuite for the user-friendly text instead of showing an internal ID.
			const displayValue = record.getText({ fieldId });
			if (displayValue !== null && displayValue !== undefined && displayValue !== '' && String(displayValue) !== String(rawValue)) {
				// Use that text when it differs from the stored value.
				return displayValue;
			}
		} catch (error) {
			// Record that display text was unavailable; the fallback below may still resolve it.
			log.audit({ title: 'Display text unavailable', details: { fieldId, error } });
		}

		if (fieldLabel === 'Parent Vendor') {
			// Look up the vendor's readable name when NetSuite only returned its internal ID.
			const vendor = search.lookupFields({
				type: search.Type.VENDOR,
				id: rawValue,
				columns: ['entityid']
			});
			// Use the original value if no vendor name could be found.
			return vendor.entityid || rawValue;
		}

		// For ordinary fields, the stored value is already suitable to return.
		return rawValue;
	};

	// Returns a field's readable label, or its ID if no label is available.
	const getFieldLabel = (record, fieldId) => {
		// Ask NetSuite for the label that a person sees beside this field.
		const field = record.getField({ fieldId });
		// Fall back to the technical field ID if the field has no readable label.
		return field && field.label ? field.label : fieldId;
	};

	// Parses stored JSON and returns an empty object if the data is invalid.
	const parseJsonObject = (value) => {
		// There is nothing to parse when no saved JSON value exists.
		if (!value) {
			return {};
		}

		try {
			// Turn the saved JSON text back into a JavaScript value.
			const parsedValue = JSON.parse(value);
			// Accept only a plain object; other JSON shapes cannot hold named field values.
			return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
				? parsedValue
				: {};
		} catch (error) {
			// Log invalid saved data and continue with an empty set of old values.
			log.error({
				title: 'Invalid edited values JSON',
				details: error
			});
			return {};
		}
	};

	// Removes generated UI-only fields from the values being stored.
	const removeGeneratedInputFields = (values) => {
		// Examine each saved key so generated screen-only fields can be removed.
		Object.keys(values).forEach((key) => {
			// These generated keys are interface helpers, not actual record fields.
			if (key.indexOf('inpt_') === 0 || key.slice(-8) === '_display') {
				delete values[key];
			}
		});
		// Return the same object after removing any screen-only entries.
		return values;
	};

	// Searches for an entitlement record matching the current user, role, and input.
	const findLoggedInUserRecord = (userId, roleId, inputValue, entitlementName) => {
		// Find the internal ID of the entitlement required for the current event.
		/* const queryEntitledIds = `SELECT id FROM ${CONFIG.entitlementsListId} WHERE name = '${entitlementName}'`;
		const queryResults = query.runSuiteQL({ query: queryEntitledIds }).asMappedResults();
		// Convert each matching list row into the internal ID used by the search filter.
		const entitlementIds = queryResults.map((result) => result.id);
		log.audit({
			title: 'Entitlement IDs',
			details: entitlementIds
		}); */
		// Start a search for a permission record assigned to this user and role.
		const filters = [
			[CONFIG.userFieldId, 'anyof', userId],
			'AND',
			[CONFIG.roleFieldId, 'anyof', roleId],
			/* 'AND',
			[CONFIG.inputFieldId, 'anyof', entitlementIds] */
		];

		if (inputValue !== '') {
			// If an entitlement input was supplied, require an exact match as well.
			filters.push('AND', [CONFIG.inputFieldId, 'is', inputValue]);
		}

		// Return at most one match because this check only needs to know whether access exists.
		return search.create({
			// Search the entitlement manager custom record.
			type: CONFIG.recordType,
			// Limit results to the user, role, and any supplied entitlement value.
			filters,
			// Read the internal ID only; no other result details are needed.
			columns: ['internalid']
		}).run().getRange({ start: 0, end: 1 });
	};

	// Finds the internal ID for a named entry in a custom list.
	const getListValueId = (listId, listValueName) => {
		// Build a query that finds the selected list entry by its visible name.
		const listQuery = `SELECT id FROM ${listId} WHERE name = '${listValueName}'`;
		// Run the query and return its rows as easy-to-read objects.
		const results = query.runSuiteQL({ query: listQuery }).asMappedResults();
		// Return the matching ID, or a blank value when the name was not found.
		return results.length ? results[0].id : '';
	};

	// Identifies system, approval, and generated fields that should not be recorded.
	const shouldSkipField = (fieldId) => {
		// Exclude audit, status, non-record, and generated interface fields from the JSON.
		return fieldId === CONFIG.createValuesFieldId
			|| fieldId === CONFIG.editedValuesFieldId
			|| fieldId === CONFIG.approvalStatusFieldId
			|| fieldId.indexOf('custrecord') === -1
			|| fieldId.indexOf('inpt_') === 0
			|| fieldId.slice(-8) === '_display';
	};

	// Checks whether a value is an empty array.
	const isEmptyArray = (value) => {
		// An empty list means no values were selected.
		return Array.isArray(value) && value.length === 0;
	};
	// Recognizes false values in the formats NetSuite uses for checkboxes.
	const isFalseValue = (value) => {
		// Treat JavaScript false and NetSuite's F marker as an unchecked box.
		return value === false || String(value).toUpperCase() === 'F';
	};
	// Collects the record's meaningful field values into a readable object.
	const collectValuesToStore = (recordToRead, comparisonRecord) => {
		// Hold the useful field values, using the labels people see on the form as keys.
		const valuesToStore = {};

		// Look at each field on this record one at a time.
		recordToRead.getFields().forEach((fieldId) => {
			// Skip fields used only by the system or by the form interface.
			if (shouldSkipField(fieldId)) {
				return;
			}

			// Read this field's current value and its readable label.
			let fieldValue = getFieldValue(recordToRead, fieldId);
			const fieldLabel = String(getFieldLabel(recordToRead, fieldId) || '').trim();
			// Convert NetSuite's checkbox markers into true/false values for JSON.
			if (fieldValue === 'T') {
				fieldValue = true;
			} else if (fieldValue === 'F') {
				fieldValue = false;
			}
			// Do not include generated labels, empty selections, or system-maintained fields.
			if (fieldLabel.indexOf('inpt_') === 0 || isEmptyArray(fieldValue) || fieldLabel === 'Created By' || fieldLabel === 'Creator Role' || fieldLabel === 'Modified by role' || fieldLabel === 'Creator Role' || fieldLabel === 'Modified by' || fieldLabel === 'Modified' || fieldLabel === 'Last Modified At' || fieldLabel === 'Created At') {
				return;
			}
			// When editing, compare checkbox values with the previously saved record.
			if (typeof fieldValue === 'boolean') {
				if (comparisonRecord) {
					// Read the old checkbox value so unchanged unchecked boxes can be ignored.
					const oldFieldValue = getFieldValue(comparisonRecord, fieldId);
					if (typeof oldFieldValue !== 'boolean' || (oldFieldValue === fieldValue && fieldValue === false)) {
						return;
					}
				} else if (fieldValue === false) {
					// For a new record, leave unchecked boxes out of the initial audit data.
					return;
				}
			}
			// Store checkbox values as the strings "True" or "False" in the JSON.
			if (fieldValue !== '') {
				valuesToStore[fieldLabel] = typeof fieldValue === 'boolean'
					? (fieldValue ? 'True' : 'False')
					: getFieldDisplayValue(recordToRead, fieldId);
			}
		});
		// List important bank details first so the saved JSON has a predictable order.
		const fieldOrder = [
			'Parent Vendor',
			'Payment Processing Profile Name',
			'Primary Account',
			'Delivery Method',
			'Bank Account Number',
			'Bank Name',
			'Routing Identifier',
			'Bank Instruction Code',
			'Bank Branch Number',
			'Payment Details 1',
			'Payment Details 2',
			'Payment Details 3',
			'Payment Details 4'
		];
		// Create a second object to hold the values in the requested order.
		const orderedValues = {};

		// Add each priority field if the record contains it.
		fieldOrder.forEach((fieldLabel) => {
			if (Object.prototype.hasOwnProperty.call(valuesToStore, fieldLabel)) {
				orderedValues[fieldLabel] = valuesToStore[fieldLabel];
			}
		});

		// Add all remaining fields in the order they were collected.
		Object.keys(valuesToStore).forEach((fieldLabel) => {
			if (!Object.prototype.hasOwnProperty.call(orderedValues, fieldLabel)) {
				orderedValues[fieldLabel] = valuesToStore[fieldLabel];
			}
		});

		// Remove any generated form fields and return the final ordered values.
		return removeGeneratedInputFields(orderedValues);
	};

	// Saves creation or edit values as JSON on the record.
	const persistValues = (newRecord, oldRecord, previousValues, currentValues) => {
		// Do not write an empty creation snapshot when there are no values to save.
		if (!oldRecord && Object.keys(currentValues).length === 0) {
			return;
		}

		if (oldRecord) {
			// On edits, store the starting values and this edit's values in separate fields.
			newRecord.setValue({
				fieldId: CONFIG.createValuesFieldId,
				value: JSON.stringify(previousValues)
			});
			newRecord.setValue({
				fieldId: CONFIG.editedValuesFieldId,
				value: JSON.stringify(currentValues)
			});
			return;
		}

		// On creation, save the initial values in the creation-values field.
		newRecord.setValue({
			fieldId: CONFIG.createValuesFieldId,
			value: JSON.stringify(currentValues)
		});
	};

	// Reloads a newly created bank-details record and stores its readable field values.
	const refreshCreatedValuesWithText = (recordId) => {
		// Reopen the saved record so NetSuite can provide readable text for selected values.
		const savedRecord = record.load({
			type: CONFIG.VBDrecordType,
			id: recordId,
			isDynamic: false
		});
		// Collect the saved fields now that NetSuite can return their display labels.
		const createdValues = collectValuesToStore(savedRecord);
		// Find users allowed to approve bank details and log the list for troubleshooting.
		let applist = getApproverList();
		log.audit({ title: 'Approver List', details: applist });
		// Save the approver list and refreshed creation data on the bank-details record.
		savedRecord.setValue({ fieldId: 'customrecord_ci_adv_entity_bank_details', value: applist });
		savedRecord.setValue({ fieldId: [CONFIG.createValuesFieldId], value: JSON.stringify(createdValues) });
		// Save the refreshed record and log the ID returned by NetSuite.
		const savedId = savedRecord.save();
		log.audit({ title: 'Saved Record ID', details: savedId });
		// Update only the creation JSON field with the display values from the saved record.
		/* record.submitFields({
			type: CONFIG.VBDrecordType,
			id: recordId,
			values: {
				[CONFIG.createValuesFieldId]: JSON.stringify(createdValues),
			}
		}); */
	};
	// Finds the users who have the Vendor Bank Details Approver entitlement.
	const getApproverList = () => {
		// Find the internal ID for the approver entitlement using its visible name.
		let queryEntitle = `SELECT id FROM customlist_ci_entitlements WHERE name = 'Vendor Bank Details Approver'`;
		// Run the query and log the matching entitlement rows for troubleshooting.
		let queryEntitleId = query.runSuiteQL({ query: queryEntitle }).asMappedResults();
		log.audit('queryEntitleId', queryEntitleId);
		// Convert the rows into a simple list of entitlement IDs for the search.
		queryEntitleId = queryEntitleId.map((result) => result.id);
		log.audit('queryEntitleId mapped', queryEntitleId);

		// Find entitlement records assigned to one of the approver entitlement IDs.
		var entitlelist = search.create({ type: 'customrecord_ci_entitlement_manager', filters: [['custrecord_ci_ent_mgr_user_permissions', 'anyof', queryEntitleId]], columns: ["custrecord_ci_ent_mgr_user"] })

		// Prepare to collect user IDs across all pages of search results.
		var searchResults = [], pagedData;
		// Read up to 1,000 results per page so large approver lists are included.
		pagedData = entitlelist.runPaged({ pageSize: 1000 });
		// Visit every page returned by the search.
		pagedData.pageRanges.forEach(function (pageRange) {
			var page = pagedData.fetch({ index: pageRange.index });
			// Add each matching person's user ID to the list.
			page.data.forEach(function (result) {
				searchResults.push(result.getValue('custrecord_ci_ent_mgr_user'));
			});
		});
		// Return all users who have the approver entitlement.
		return searchResults;
	};

	// Checks the configuration record to see whether entitlement processing is enabled.
	const isFeatureInEffect = () => {
		// Read the feature on/off setting from the general configuration record.
		let queryResults = query.runSuiteQL({ query: `SELECT ${CONFIG.entitledCheck} FROM ${CONFIG.configRecordType}` }).asMappedResults();

		// Return the setting when a configuration row exists; with no row, treat the feature as off.
		return (queryResults && queryResults.length > 0 && queryResults[0][CONFIG.entitledCheck])
	};
	/**
	 * Runs before an Entitlement Manager record is saved.
	 * @param {Object} context
	 * @param {UserEventContext.UserEventType} context.type
	 * @param {Record} context.newRecord
	 * @param {Record} context.oldRecord
	 */
	// Sets creator or modifier details, approval status, and audit values before saving.
	const beforeSubmit = (context) => {
		// Stop if the feature is off or this event is not a create or edit.
		if (isFeatureInEffect() == false || isFeatureInEffect() == null || isFeatureInEffect() == 'F' || !isCreateOrEdit(context.type)) { return; }
		// Get the values being submitted and, for an edit, the values previously saved.
		const newRecord = context.newRecord;
		const oldRecord = context.oldRecord;
		// Capture the original snapshot when editing; a new record has no old snapshot.
		const previousValues = oldRecord ? collectValuesToStore(oldRecord) : {};
		// Collect submitted values and compare checkboxes against the old record when available.
		const valuesToStore = collectValuesToStore(newRecord,oldRecord);
		// Ask NetSuite which user and role are performing this action.
		const currentUser = runtime.getCurrentUser();
		// If an old record exists, save who edited the record and which role they used.
		if (oldRecord) {
			newRecord.setValue({
				fieldId: 'custrecord_ci_adv_modified_by',
				value: currentUser.id
			});
			newRecord.setValue({
				fieldId: 'custrecord_ci_adv_modified',
				value: true
			});
			newRecord.setValue({
				fieldId: 'custrecord_ci_adv_modified_by_role',
				value: currentUser.role
			});
		}
		// If no old record exists, save who created the record and which role they used.
		else {
			newRecord.setValue({
				fieldId: 'custrecord_ci_adv_createdby',
				// NetSuite list fields must be set with the list value ID.
				value: currentUser.id
			});
			newRecord.setValue({
				fieldId: 'custrecord_ci_adv_creator_role',
				// NetSuite list fields must be set with the list value ID.
				value: currentUser.role
			});
		}
		// Find the internal ID for Pending Approval because NetSuite list fields use IDs.
		const pendingApprovalId = getListValueId(CONFIG.approvalStatusListId, CONFIG.pendingApprovalName);
		if (pendingApprovalId) {
			// Mark the record as waiting for approval before it is saved.
			newRecord.setValue({
				fieldId: CONFIG.approvalStatusFieldId,
				// NetSuite list fields must be set with the list value ID.
				value: pendingApprovalId
			});
		} else {
			// Report a setup problem if the Pending Approval option is missing.
			log.error({
				title: 'Pending Approval status not found',
				details: CONFIG.pendingApprovalName
			});
		}
		// Log the values that will be written to the audit JSON for troubleshooting.
		log.audit('Values to store', `previousValues: ${JSON.stringify(previousValues)}, newValues: ${JSON.stringify(valuesToStore)}`);

		// Save the collected values in the appropriate JSON field.
		persistValues(newRecord, oldRecord, previousValues, valuesToStore);
	};

	/**
	 * Runs after an Entitlement Manager record is saved.
	 * @param {Object} context
	 * @param {UserEventContext.UserEventType} context.type
	 * @param {Record} context.newRecord
	 * @param {Record} context.oldRecord
	 */
	// Refreshes created-record audit values and updates the vendor for primary accounts.
	const afterSubmit = (context) => {
		try {
			// Do nothing further when the entitlement feature is turned off.
			if (isFeatureInEffect() == false || isFeatureInEffect() == null || isFeatureInEffect() == 'F') { return; }
			// After creation, reload the record so its audit JSON can use readable display text.
			if (context.type === 'create' && context.newRecord.id) {
				refreshCreatedValuesWithText(context.newRecord.id);
			}
			// Keep references to the saved version and, when available, the previous version.
			const newRecord = context.newRecord;
			const oldRecord = context.oldRecord;
			// Use the new vendor ID when present; otherwise keep the old record's vendor ID.
			let vendorId = newRecord.getValue('custrecordci_adv_details') ? newRecord.getValue('custrecordci_adv_details') : oldRecord.getValue('custrecordci_adv_details');
			// Read the approval status currently selected on the bank-details record.
			let approvalStatus = newRecord.getValue('custrecord_ci_adv_approval_status');
			// Read whether this bank account is primary, falling back to the old value if needed.
			let isPrimaryAccount = newRecord.getValue('custrecord_ci_adv_primary_account') || oldRecord.getValue('custrecord_ci_adv_primary_account');
			// Log the details used to decide whether to update the vendor.
            log.audit('VBD Details',`Vendor ID: ${vendorId} | Approval Status: ${approvalStatus} | Primary Account: ${isPrimaryAccount}`)
			// Only copy the approval status to the vendor when this is its primary account.
			if(isPrimaryAccount == true || isPrimaryAccount == 'T')
			{
				// Update the vendor's approval-status field with the status on this record.
				let vendorRecordSavedId = record.submitFields({
				type: 'vendor',
				id: vendorId,
				values: {
					'custentity_ci_adv_as': approvalStatus
				}
				});
				// Log the vendor ID returned by NetSuite after saving the change.
				log.audit({title: 'Vendor Record Saved',details: 'Vendor Record ID: ' + vendorRecordSavedId});
			}
			// Explain in the audit log why no vendor update was made for a non-primary account.
			else{ log.audit("Vendor Bank Details : ", `Is not primary account so will not set vendor to pending approval`)}
			
		} catch (e) {
			// Record any error so a failed vendor update can be investigated.
			log.error({
				title: 'Error updating vendor record',
				details: e.message
			});
		}

	};

	// Expose the entry points NetSuite calls for this User Event script.
	return {
		beforeSubmit,
		afterSubmit
	};
});