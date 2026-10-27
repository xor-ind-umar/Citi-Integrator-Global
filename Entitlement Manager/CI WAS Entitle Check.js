/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @NModuleScope SameAccount
 * @Author Umar
 * @Description Checks if the current user is entitled to create, edit, or view the record based on custom entitlements.
 */
define(['N/runtime', 'N/search', 'N/error', 'N/query'], function (runtime, search, error, query) {
    const isCurrentUserEntitledToEdit = (currentUser) => {
        const entitlementIds = query.runSuiteQL({
            query: 'SELECT id FROM customlist_ci_entitlements WHERE name = ?',
            params: ['Vendor Bank Details']
        }).asMappedResults().map(({ id }) => id);

        const isCurrentUserEntitled = entitlementIds.length > 0 && search.create({
            type: 'customrecord_ci_entitlement_manager',
            filters: [
                ['custrecord_ci_ent_mgr_user_permissions', 'anyof', entitlementIds], 'AND',
                ['custrecord_ci_ent_mgr_user', 'anyof', currentUser.id], 'AND',
                ['custrecord_ci_ent_mgr_user_role', 'anyof', currentUser.role]
            ]
        }).run().getRange({ start: 0, end: 1 }).length > 0;

        log.audit('isCurrentUserEntitled', isCurrentUserEntitled);
        return isCurrentUserEntitled;
    };

    const onAction = (scriptContext) => {
        const currentUser = runtime.getCurrentUser();
        const contextType = String(scriptContext && scriptContext.type || '').toUpperCase();
        const hasPermission = isCurrentUserEntitledToEdit(currentUser);
         let queryResults = query.runSuiteQL({ query: `SELECT custrecord_ci_adv_enable_entitle FROM customrecord_ci_adv_general_config` }).asMappedResults();
         // if entitlement is not enabled, skip further checks
        if (queryResults && queryResults.length > 0 && !queryResults[0]['custrecord_ci_adv_enable_entitle']) {
            return false;
        }
        log.debug('Basic Info', `Context Type: ${contextType} | permission: ${hasPermission}`);

        let notAuthorize = false;

        if (contextType === 'CREATE' && !hasPermission) {
            notAuthorize = true;
        } else if (contextType === 'EDIT' && !hasPermission) {
            notAuthorize = true;
        } else if (contextType === 'VIEW' && !hasPermission) {
            notAuthorize = true;
        }

        log.debug('isUnauthorized', !!notAuthorize);

        if (notAuthorize) {
            throw error.create({
                name: 'ENTITLEMENT_RESTRICTION',
                message: `Access Denied: You are not authorized to ${contextType.toLowerCase()} this record.`,
                notifyOff: true
            });
        }

        return false;
    };

    return {
        onAction: onAction
    };
});