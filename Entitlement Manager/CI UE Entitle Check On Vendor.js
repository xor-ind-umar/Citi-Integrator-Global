/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @Author Umar
 * @Description Checks if the current user is entitled to create, edit, or view the record based on custom entitlements.
 */
define(['N/ui/serverWidget', 'N/query', 'N/search', 'N/runtime'], function (serverWidget, query, search, runtime) {
    function beforeLoad(context) {
        let queryResults = query.runSuiteQL({ query: `SELECT custrecord_ci_adv_enable_entitle FROM customrecord_ci_adv_general_config` }).asMappedResults();
        log.debug("Basic Info",`Query Results: ${JSON.stringify(queryResults)} | context.type: ${context.type}`)
        if (queryResults && queryResults.length > 0 && !queryResults[0]['custrecord_ci_adv_enable_entitle']) { return false; }
        // Ensure this only runs when the user is viewing or editing the record in the UI
        if (context.type.toUpperCase() === context.UserEventType.CREATE || context.type.toUpperCase() === context.UserEventType.VIEW) {
            return;
        }
        let form = context.form;
        // Retrieve the sublist object from the form
        let sublistObj = form.getSublist({id: 'recmachcustrecordci_adv_details'});
        const hasPermission = isCurrentUserEntitledToEdit(runtime.getCurrentUser());
        log.debug("hasPermission", hasPermission);
        //1. Hide the sublist completely if the user does not have permission
        //2. Hide any custom fields residing on that subtab
        if (!hasPermission && sublistObj) {
            sublistObj.displayType = serverWidget.SublistDisplayType.HIDDEN;
            let fieldObj = form.getField({ id: 'custentity_ci_adv_as' });
            if (fieldObj) {fieldObj.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });}
        }
    }
    const isCurrentUserEntitledToEdit = (currentUser) => {
        const entitlementIds = query.runSuiteQL({
            query: 'SELECT id FROM customlist_ci_entitlements WHERE name = ?',
            params: ['Vendor Bank Details']
        }).asMappedResults().map(({ id }) => id);

        return entitlementIds.length > 0 && search.create({
            type: 'customrecord_ci_entitlement_manager',
            filters: [
                ['custrecord_ci_ent_mgr_user_permissions', 'anyof', entitlementIds], 'AND',
                ['custrecord_ci_ent_mgr_user', 'anyof', currentUser.id], 'AND',
                ['custrecord_ci_ent_mgr_user_role', 'anyof', currentUser.role]
            ]
        }).run().getRange(0,1).length > 0;

    };

    return {
        beforeLoad: beforeLoad
    };
});
