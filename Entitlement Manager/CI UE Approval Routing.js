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
		VBDrecordType : 'customrecord_ci_adv_entity_bank_details'
	};

	const isCreateOrEdit = (eventType) =>
		// The change-tracking logic is only relevant when a record is created or edited.
		eventType === 'create' || eventType === 'edit';

	const getFieldValue = (record, fieldId) => {
		// Normalize empty NetSuite values so comparisons and JSON output stay consistent.
		// Read the raw value because IDs are needed when comparing old and new records.
		const value = record.getValue({ fieldId });
		// Convert null and undefined to an empty string for consistent processing.
		return value === null || value === undefined ? '' : value;
	};

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

	const getFieldLabel = (record, fieldId) => {
		// Store a readable field label in the JSON change log instead of only the field ID.
		const field = record.getField({ fieldId });
		// Use the field ID only when NetSuite does not provide a label.
		return field && field.label ? field.label : fieldId;
	};

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

	const getListValueId = (listId, listValueName) => {
		// Resolve the list label to its internal ID before setting a list field.
		const listQuery = `SELECT id FROM ${listId} WHERE name = '${listValueName}'`;
		// Execute the lookup against the custom list.
		const results = query.runSuiteQL({ query: listQuery }).asMappedResults();
		// Return the first matching internal ID, or blank when the list value is missing.
		return results.length ? results[0].id : '';
	};

	const shouldSkipField = (fieldId) => {
		// These fields are system or UI fields and must not be included in the audit JSON.
		return fieldId === CONFIG.createValuesFieldId
			|| fieldId === CONFIG.editedValuesFieldId
			|| fieldId === CONFIG.approvalStatusFieldId
			|| fieldId.indexOf('custrecord') === -1
			|| fieldId.indexOf('inpt_') === 0
			|| fieldId.slice(-8) === '_display';
	};

	const isFalseValue = (value) => {
		// NetSuite checkboxes can return either false or the string F.
		return value === false || String(value).toUpperCase() === 'F';
	};
	const isEmptyArray = (value) => {
		// Check if the value is an empty array.
		return Array.isArray(value) && value.length === 0;
	};

	const collectValuesToStore = (newRecord, oldRecord) => {
		// Build the payload that belongs to this save.
		// Create: include populated fields. Edit: include only changed fields.
		const valuesToStore = {};

		newRecord.getFields().forEach((fieldId) => {
			// Process each field exposed by the current record.
			if (shouldSkipField(fieldId)) {
				return;
			}

			const newValue = getFieldValue(newRecord, fieldId);
			const fieldLabel = getFieldLabel(newRecord, fieldId);
			const oldValue = oldRecord ? getFieldValue(oldRecord, fieldId) : '';
			// Some generated input fields expose an inpt_ label even when their ID looks valid.
			if (fieldLabel.indexOf('inpt_') === 0 || (!oldRecord && isFalseValue(newValue)) || (!oldRecord && isEmptyArray(newValue)) || fieldLabel === 'Created By' || fieldLabel === 'Creator Role' || fieldLabel === 'Modified by role' || fieldLabel === 'Creator Role' || fieldLabel === 'Modified by' || fieldLabel === 'Modified' ) {
				return;
			}

			// An old record exists only during edit; create has no previous value.
			const fieldWasChanged = oldRecord && String(newValue) !== String(oldValue);
			// Store populated create fields or changed edit fields.
			const shouldStoreField = (!oldRecord && newValue !== '') || fieldWasChanged;

			if (shouldStoreField) {
				// Use the field label as the key and display text for list/record values.
				valuesToStore[fieldLabel] = getFieldDisplayValue(newRecord, fieldId);
			}
		});

		return removeGeneratedInputFields(valuesToStore);
	};

	const collectPreviousValuesToStore = (newRecord, oldRecord, existingValues) => {
		const previousValues = Object.assign({}, existingValues);

		if (!oldRecord) {
			return previousValues;
		}

		newRecord.getFields().forEach((fieldId) => {
			if (shouldSkipField(fieldId)) {
				return;
			}

			const newValue = getFieldValue(newRecord, fieldId);
			const oldValue = getFieldValue(oldRecord, fieldId);
			const fieldLabel = getFieldLabel(newRecord, fieldId);

			if (fieldLabel.indexOf('inpt_') === 0
				|| fieldLabel === 'Created By'
				|| fieldLabel === 'Modified by role'
				|| fieldLabel === 'Creator Role'
				|| fieldLabel === 'Modified by'
				|| fieldLabel === 'Modified'
				|| String(newValue) === String(oldValue)) {
				return;
			}

			// Store the value that existed immediately before this edit.
			previousValues[fieldLabel] = getFieldDisplayValue(oldRecord, fieldId);
		});
		log.audit('243', previousValues);
		return removeGeneratedInputFields(previousValues);
	};

	const persistValues = (newRecord, oldRecord, valuesToStore) => {
		// Creation values and later edits are stored in separate fields.
		if (!oldRecord && Object.keys(valuesToStore).length === 0) {
			return;
		}

		const targetFieldId = oldRecord ? CONFIG.editedValuesFieldId : CONFIG.createValuesFieldId;
		// On edit, read the original create values and any previously saved edit values.
		const originalValues = oldRecord
			? removeGeneratedInputFields(parseJsonObject(getFieldValue(oldRecord, CONFIG.createValuesFieldId)))
			: {};
		const previousEditedValues = oldRecord
			? removeGeneratedInputFields(parseJsonObject(getFieldValue(oldRecord, CONFIG.editedValuesFieldId)))
			: {};
		const previousValues = collectPreviousValuesToStore(newRecord, oldRecord, originalValues);

		// Merge by field label. Duplicate keys are stored once, and the newest edit wins.
		const valuesToPersist = oldRecord
			? Object.assign({}, previousValues, valuesToStore)
			: valuesToStore;
		const editedValuesToPersist = oldRecord
			? Object.assign({}, previousValues, previousEditedValues, valuesToStore)
			: valuesToPersist;

		newRecord.setValue({
			// Write the original values and current changes to separate audit fields.
			fieldId: oldRecord ? CONFIG.createValuesFieldId : targetFieldId,
			value: JSON.stringify(previousValues)
		});
		log.audit('previousValues', previousValues);
		log.audit('editedValuesToPersist', editedValuesToPersist);
		log.audit('valuesToStore', valuesToStore);
		newRecord.setValue({
			fieldId: oldRecord ? CONFIG.editedValuesFieldId : targetFieldId,
			value: JSON.stringify(editedValuesToPersist)/* //oldRecord
			? JSON.stringify(Object.assign({}, editedValuesToPersist, previousValues, valuesToStore))
			: JSON.stringify(valuesToStore)// */
			/*  //  */
		});
	};

	const refreshCreatedValuesWithText = (recordId) => {
		// Create-mode records can contain list/record IDs before they are persisted.
		// Reloading the saved record allows NetSuite to return the display text.
		const savedRecord = record.load({
			type: CONFIG.VBDrecordType,
			id: recordId,
			isDynamic: false
		});
		const createdValues = collectValuesToStore(savedRecord, null);
		let applist = getApproverList();
		log.audit({title: 'Approver List',details: applist});
		// Update only the creation JSON field with the display values from the saved record.
		record.submitFields({
			type: CONFIG.VBDrecordType,
			id: recordId,
			values: {
				[CONFIG.createValuesFieldId]: JSON.stringify(createdValues),
				'customrecord_ci_adv_entity_bank_details': applist
			}
		});
	};
	const getApproverList = () =>{
		let queryEntitle = `SELECT id FROM customlist_ci_entitlements WHERE name = 'Vendor Bank Details Approver'`;
		//This is used to retrieve the internal id of the entitlement with the name 'Vendor Bank Details Approver' or 'Vendor Bank Details'
		let queryEntitleId = query.runSuiteQL({ query: queryEntitle }).asMappedResults();
		log.audit('queryEntitleId', queryEntitleId);
		queryEntitleId = queryEntitleId.map((result) => result.id);
		log.audit('queryEntitleId mapped', queryEntitleId);

		var entitlelist = search.create({type: 'customrecord_ci_entitlement_manager', filters: [['custrecord_ci_ent_mgr_user_permissions', 'anyof', queryEntitleId]], columns:["custrecord_ci_ent_mgr_user"]})

		var searchResults = [],pagedData;
		pagedData = entitlelist.runPaged({ pageSize: 1000 });
		pagedData.pageRanges.forEach(function (pageRange) {
			var page = pagedData.fetch({ index: pageRange.index });
			page.data.forEach(function (result) {
				searchResults.push(result.getValue('custrecord_ci_ent_mgr_user'));
			});
		});
		return searchResults;
	};

	/**
	 * Runs before an Entitlement Manager record is saved.
	 * @param {Object} context
	 * @param {UserEventContext.UserEventType} context.type
	 * @param {Record} context.newRecord
	 * @param {Record} context.oldRecord
	 */
	const beforeSubmit = (context) => {
		// Only create and edit events contain values that need to be recorded.
		if (!isCreateOrEdit(context.type)) {
			return;
		}

		// The new record contains values being submitted by the user.
		const newRecord = context.newRecord;
		// The old record contains the previously saved values during edit events.
		const oldRecord = context.oldRecord;
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
		else
		{
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
		/* // Read the entitlement value entered on the record before checking authorization.
		const inputValue = getFieldValue(newRecord, CONFIG.inputFieldId);
		// Creation and edit operations require different entitlement names.
		const entitlementName = oldRecord ? CONFIG.editEntitlementName : CONFIG.createEntitlementName;
		// Verify that this user, role, and entitlement are allowed together.
		log.audit({
			title: 'Finding matching records for user entitlement',
			details: { userId: currentUser.id, roleId: currentUser.role, inputValue, entitlementName }
		}); */
		/* const matchingRecords = findLoggedInUserRecord(
			currentUser.id,
			currentUser.role,
			inputValue,
			entitlementName
		); */

		//if (!matchingRecords.length) 
			// Do not create an audit payload when the user is not authorized for this entitlement.
			/* log.audit({
				title: 'User is not entitled for VBD operation',
				details: { userId: currentUser.id, roleId: currentUser.role, inputValue, entitlementName }
			}); */
				// Set the approval status using the list entry's internal ID, not the label text.
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
		const valuesToStore = collectValuesToStore(newRecord, oldRecord);
		// Log the final payload for troubleshooting and approval processing.
		log.audit({
			title: 'Values to store',
			details: valuesToStore
		});

		// Step 4: merge the payload with previous edits and save it as JSON.
		persistValues(newRecord, oldRecord, valuesToStore);
	};

	/**
	 * Runs after an Entitlement Manager record is saved.
	 * @param {Object} context
	 * @param {UserEventContext.UserEventType} context.type
	 * @param {Record} context.newRecord
	 * @param {Record} context.oldRecord
	 */
	const afterSubmit = (context) => {
		// Normalize list/record values after create because display text is available after save.
		if (context.type === 'create' && context.newRecord.id) {
			refreshCreatedValuesWithText(context.newRecord.id);
		}
	};

	// Expose the entry points NetSuite calls for this User Event script.
	return {
		beforeSubmit,
		afterSubmit
	};
});