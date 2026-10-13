/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * @Author Umar
 * @Description Checks if the current user is entitled to create, edit, or view the record based on custom entitlements.
 */
define(['N/runtime', 'N/search', 'N/error', 'N/query'], function (runtime, search, error, query) {

    const isCurrentUserEntitledToEdit = (currentUser, contextType) => {
        const entitlementIds = query.runSuiteQL({
            query: "SELECT id FROM customlist_ci_entitlements WHERE name = ?",
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

        log.debug('Basic Info', `Context Type: ${contextType} | permission: ${isCurrentUserEntitled}`);
        if (!isCurrentUserEntitled) {
            const action = {
                CREATE: 'create',
                EDIT: 'edit',
                VIEW: 'view'
            }[String(contextType).toUpperCase()];

            if (action) {
                throw `Access Denied: You are not authorized to ${action} this record.`;
            }
        }
        return isCurrentUserEntitled;
    }

    const beforeLoad = (scriptContext) => {
        // Blocks VIEW access if the user is not entitled
        if (scriptContext.type === scriptContext.UserEventType.VIEW) {
            isCurrentUserEntitledToEdit(runtime.getCurrentUser(), scriptContext.type);
        }
    }

    const beforeSubmit = (scriptContext) => {
        // Blocks CREATE and EDIT access if the user is not entitled
        if (scriptContext.type === scriptContext.UserEventType.CREATE ||
            scriptContext.type === scriptContext.UserEventType.EDIT) {
            isCurrentUserEntitledToEdit(runtime.getCurrentUser(), scriptContext.type);
        }
    }
    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit
    };
});