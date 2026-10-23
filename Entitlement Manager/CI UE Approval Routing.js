/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/runtime', 'N/search', 'N/query', 'N/record'], (runtime, search, query, record) => {

	// Store all script configuration in one object for easy maintenance.
	const CONFIG = {
		// Keep all record and field IDs in one place so they can be changed safely.
		recordType: 'customrecord_ci_entitlement_manager',
		userFieldId: 'custrecord_ci_ent_mgr_user',
		roleFieldId: 'custrecord_ci_ent_mgr_user_role',
		inputFieldId: 'custrecord_ci_ent_mgr_user_permissions',
		createValuesFieldId: 'custrecord_ci_old_values',
		editedValuesFieldId: 'custrecord_ci_edited_values',
		entitlementsListId: 'customlist_ci_entitlements',
		approvalStatusListId: 'customlist_ci_adv_approval_status',
		approvalStatusFieldId: 'custrecord_ci_adv_approval_status',
		pendingApprovalName: 'Pending Approval',
		createEntitlementName: 'Vendor Bank Details Approver',
		editEntitlementName: 'Vendor Bank Details',
		VBDrecordType: 'customrecord_ci_adv_entity_bank_details',
		configRecordType: 'customrecord_ci_adv_general_config',
		entitledCheck: 'custrecord_ci_adv_enable_entitle'
	};

	// Checks whether the event is a record creation or edit.
	const isCreateOrEdit = (eventType) =>
		// The change-tracking logic is only relevant when a record is created or edited.
		eventType === 'create' || eventType === 'edit';

	// Reads a field value and converts missing values to an empty string.
	const getFieldValue = (record, fieldId) => {
		// Normalize empty NetSuite values so comparisons and JSON output stay consistent.
		// Read the raw value because IDs are needed when comparing old and new records.
		const value = record.getValue({ fieldId });
		// Convert null and undefined to an empty string for consistent processing.
		return value === null || value === undefined ? '' : value;
	};

	// Gets the readable display value for a field, resolving vendor IDs when needed.
	const getFieldDisplayValue = (record, fieldId) => {
		// getText() returns display labels for list/record fields and the normal value for other fields.
		const rawValue = getFieldValue(record, fieldId);
		if (rawValue === '') {
			return '';
		}

		const field = record.getField({ fieldId });
		// Read the field label so special record-reference fields can be identified.
		const fieldLabel = field && field.label;

		try {
			// For Parent Vendor, this converts the internal ID (for example 403) to the vendor name.
			const displayValue = record.getText({ fieldId });
			if (displayValue !== null && displayValue !== undefined && displayValue !== '' && String(displayValue) !== String(rawValue)) {
				// Return the display text when NetSuite provides a real label.
				return displayValue;
			}
		} catch (error) {
			// Create-mode records may not expose display text until after they are saved.
			log.audit({ title: 'Display text unavailable', details: { fieldId, error } });
		}

		if (fieldLabel === 'Parent Vendor') {
			// Resolve the vendor name directly when getText() returns the create-mode ID.
			// lookupFields converts the selected vendor ID into its entity name.
			const vendor = search.lookupFields({
				type: search.Type.VENDOR,
				id: rawValue,
				columns: ['entityid']
			});
			// Fall back to the original ID if the vendor cannot be resolved.
			return vendor.entityid || rawValue;
		}

		// Return the raw value for text, date, checkbox, and other ordinary fields.
		return rawValue;
	};

	// Returns a field's readable label, or its ID if no label is available.
	const getFieldLabel = (record, fieldId) => {
		// Store a readable field label in the JSON change log instead of only the field ID.
		const field = record.getField({ fieldId });
		// Use the field ID only when NetSuite does not provide a label.
		return field && field.label ? field.label : fieldId;
	};

	// Parses stored JSON and returns an empty object if the data is invalid.
	const parseJsonObject = (value) => {
		// Read previously captured edit values so later edits can be added without losing them.
		if (!value) {
			return {};
		}

		try {
			// Convert the stored JSON string back into an object.
			const parsedValue = JSON.parse(value);
			// Reject arrays and primitive values because the audit data must be an object.
			return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
				? parsedValue
				: {};
		} catch (error) {
			// Ignore malformed old data so the record can still be saved.
			log.error({
				title: 'Invalid edited values JSON',
				details: error
			});
			return {};
		}
	};

	// Removes generated UI-only fields from the values being stored.
	const removeGeneratedInputFields = (values) => {
		// Remove generated inpt_ and *_display entries from previously stored JSON.
		Object.keys(values).forEach((key) => {
			// Check every stored key for generated UI field names.
			if (key.indexOf('inpt_') === 0 || key.slice(-8) === '_display') {
				delete values[key];
			}
		});
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
		// Confirm that the logged-in user has the required role and entitlement.
		const filters = [
			[CONFIG.userFieldId, 'anyof', userId],
			'AND',
			[CONFIG.roleFieldId, 'anyof', roleId],
			/* 'AND',
			[CONFIG.inputFieldId, 'anyof', entitlementIds] */
		];

		if (inputValue !== '') {
			// When the user entered a value, require the entitlement value to match it too.
			filters.push('AND', [CONFIG.inputFieldId, 'is', inputValue]);
		}

		// Return only one matching record because this search is used as an eligibility check.
		return search.create({
			// Search the entitlement manager custom record.
			type: CONFIG.recordType,
			// Apply the user, role, entitlement, and optional input-value filters.
			filters,
			// Only the existence of a matching record matters.
			columns: ['internalid']
		}).run().getRange({ start: 0, end: 1 });
	};

	// Finds the internal ID for a named entry in a custom list.
	const getListValueId = (listId, listValueName) => {
		// Resolve the list label to its internal ID before setting a list field.
		const listQuery = `SELECT id FROM ${listId} WHERE name = '${listValueName}'`;
		// Execute the lookup against the custom list.
		const results = query.runSuiteQL({ query: listQuery }).asMappedResults();
		// Return the first matching internal ID, or blank when the list value is missing.
		return results.length ? results[0].id : '';
	};

	// Identifies system, approval, and generated fields that should not be recorded.
	const shouldSkipField = (fieldId) => {
		// These fields are system or UI fields and must not be included in the audit JSON.
		return fieldId === CONFIG.createValuesFieldId
			|| fieldId === CONFIG.editedValuesFieldId
			|| fieldId === CONFIG.approvalStatusFieldId
			|| fieldId.indexOf('custrecord') === -1
			|| fieldId.indexOf('inpt_') === 0
			|| fieldId.slice(-8) === '_display';
	};

	// Recognizes false values in the formats NetSuite uses for checkboxes.
	const isFalseValue = (value) => {
		// NetSuite checkboxes can return either false or the string F.
		return value === false || String(value).toUpperCase() === 'F';
	};
	// Checks whether a value is an empty array.
	const isEmptyArray = (value) => {
		// Check if the value is an empty array.
		return Array.isArray(value) && value.length === 0;
	};

	// Collects the record's meaningful field values into a readable object.
	const collectValuesToStore = (recordToRead) => {
		// Build a complete snapshot from the record's current values.
		const valuesToStore = {};

		recordToRead.getFields().forEach((fieldId) => {
			// Process each field exposed by the current record.
			if (shouldSkipField(fieldId)) {
				return;
			}

			const fieldValue = getFieldValue(recordToRead, fieldId);
			const fieldLabel = getFieldLabel(recordToRead, fieldId);
			// Some generated input fields expose an inpt_ label even when their ID looks valid.
			if (fieldLabel.indexOf('inpt_') === 0 || isFalseValue(fieldValue) || isEmptyArray(fieldValue) || fieldLabel === 'Created By' || fieldLabel === 'Creator Role' || fieldLabel === 'Modified by role' || fieldLabel === 'Creator Role' || fieldLabel === 'Modified by' || fieldLabel === 'Modified' || fieldLabel === 'Last Modified At') {
				return;
			}

			if (fieldValue !== '') {
				// Use the field label as the key and display text for list/record values.
				valuesToStore[fieldLabel] = getFieldDisplayValue(recordToRead, fieldId);
			}
		});

		return removeGeneratedInputFields(valuesToStore);
	};

	// Saves creation or edit values as JSON on the record.
	const persistValues = (newRecord, oldRecord, previousValues, currentValues) => {
		if (!oldRecord && Object.keys(currentValues).length === 0) {
			return;
		}

		if (oldRecord) {
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

		newRecord.setValue({
			fieldId: CONFIG.createValuesFieldId,
			value: JSON.stringify(currentValues)
		});
	};

	// Reloads a newly created bank-details record and stores its readable field values.
	const refreshCreatedValuesWithText = (recordId) => {
		// Create-mode records can contain list/record IDs before they are persisted.
		// Reloading the saved record allows NetSuite to return the display text.
		const savedRecord = record.load({
			type: CONFIG.VBDrecordType,
			id: recordId,
			isDynamic: false
		});
		const createdValues = collectValuesToStore(savedRecord);
		let applist = getApproverList();
		log.audit({ title: 'Approver List', details: applist });
		savedRecord.setValue({ fieldId: 'customrecord_ci_adv_entity_bank_details', value: applist });
		savedRecord.setValue({ fieldId: [CONFIG.createValuesFieldId], value: JSON.stringify(createdValues) });
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
		let queryEntitle = `SELECT id FROM customlist_ci_entitlements WHERE name = 'Vendor Bank Details Approver'`;
		//This is used to retrieve the internal id of the entitlement with the name 'Vendor Bank Details Approver' or 'Vendor Bank Details'
		let queryEntitleId = query.runSuiteQL({ query: queryEntitle }).asMappedResults();
		log.audit('queryEntitleId', queryEntitleId);
		queryEntitleId = queryEntitleId.map((result) => result.id);
		log.audit('queryEntitleId mapped', queryEntitleId);

		var entitlelist = search.create({ type: 'customrecord_ci_entitlement_manager', filters: [['custrecord_ci_ent_mgr_user_permissions', 'anyof', queryEntitleId]], columns: ["custrecord_ci_ent_mgr_user"] })

		var searchResults = [], pagedData;
		pagedData = entitlelist.runPaged({ pageSize: 1000 });
		pagedData.pageRanges.forEach(function (pageRange) {
			var page = pagedData.fetch({ index: pageRange.index });
			page.data.forEach(function (result) {
				searchResults.push(result.getValue('custrecord_ci_ent_mgr_user'));
			});
		});
		return searchResults;
	};

	// Checks the configuration record to see whether entitlement processing is enabled.
	const isFeatureInEffect = () => {
		// Implement the logic to check if the Entitlement feature is enabled.
		// Return true if the feature is enabled, false otherwise.
		// This is a placeholder implementation and should be replaced with actual logic.
		let queryResults = query.runSuiteQL({ query: `SELECT ${CONFIG.entitledCheck} FROM ${CONFIG.configRecordType}` }).asMappedResults();

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
		// if the Entitlement feature is enabled should this logic run AND create and edit events contain values that need to be recorded.
		if (isFeatureInEffect() == false || isFeatureInEffect() == null || isFeatureInEffect() == 'F' || !isCreateOrEdit(context.type)) { return; }
		// The new record contains values being submitted by the user.
		const newRecord = context.newRecord;
		// The old record contains the previously saved values during edit events.
		const oldRecord = context.oldRecord;
		const previousValues = oldRecord ? collectValuesToStore(oldRecord) : {};
		const valuesToStore = collectValuesToStore(newRecord);
		// Read the user and role of the person performing the operation.
		const currentUser = runtime.getCurrentUser();
		//When the old record exists, it means the current operation is an edit.
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
		// When the old record does not exist, it means the current operation is a create.
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
		// Resolve the Pending Approval list label to its internal ID.
		const pendingApprovalId = getListValueId(CONFIG.approvalStatusListId, CONFIG.pendingApprovalName);
		if (pendingApprovalId) {
			// Set the status before the record is submitted.
			newRecord.setValue({
				fieldId: CONFIG.approvalStatusFieldId,
				// NetSuite list fields must be set with the list value ID.
				value: pendingApprovalId
			});
		} else {
			// Log a configuration problem when the list value cannot be found.
			log.error({
				title: 'Pending Approval status not found',
				details: CONFIG.pendingApprovalName
			});
		}
		// Step 3: collect only the values relevant to this create or edit.
		// Log the final payload for troubleshooting and approval processing.
		log.audit({
			title: 'Values to store',
			details: valuesToStore
		});

		// Step 4: merge the payload with previous edits and save it as JSON.
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
			// Exit early if the Entitlement feature is not in effect.
			if (isFeatureInEffect() == false || isFeatureInEffect() == null || isFeatureInEffect() == 'F') { return; }
			// Normalize list/record values after create because display text is available after save.
			if (context.type === 'create' && context.newRecord.id) {
				refreshCreatedValuesWithText(context.newRecord.id);
			}
			const newRecord = context.newRecord;
			const oldRecord = context.oldRecord;
			// We can not read the value of the vendor ID directly from the new record as the newRecord only contain the modified fields, so we query it from the database.
			let vendorId = newRecord.getValue('custrecordci_adv_details') ? newRecord.getValue('custrecordci_adv_details') : oldRecord.getValue('custrecordci_adv_details');
			let approvalStatus = newRecord.getValue('custrecord_ci_adv_approval_status');
			let isPrimaryAccount = newRecord.getValue('custrecord_ci_adv_primary_account') || oldRecord.getValue('custrecord_ci_adv_primary_account');
            log.audit('VBD Details',`Vendor ID: ${vendorId} | Approval Status: ${approvalStatus} | Primary Account: ${isPrimaryAccount}`)
			if(isPrimaryAccount == true || isPrimaryAccount == 'T')
			{
				let vendorRecordSavedId = record.submitFields({
				type: 'vendor',
				id: vendorId,
				values: {
					'custentity_ci_adv_as': approvalStatus
				}
				});
				log.audit({title: 'Vendor Record Saved',details: 'Vendor Record ID: ' + vendorRecordSavedId});
			}
			else{ log.audit("Vendor Bank Details : ", `Is not primary account so will not set vendor to pending approval`)}
			
		} catch (e) {
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