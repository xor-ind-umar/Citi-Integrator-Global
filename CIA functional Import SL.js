/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * @file    ci_adv_functional_import_sl.js
 * @description  Suitelet for the Vendor Bank Details (VBD) management UI.
 *               Handles the full lifecycle of VBD records including:
 *                 - Home page listing with pagination and CSV export
 *                 - Create / Edit form with dynamic profile-driven fields
 *                 - Delete action with redirect
 *                 - POST handler to save/update VBD records
 *                 - XML-to-JSON validator parsing for client-side field validation
 *                 - SEPA profile detection for conditional field rendering
 *
 * @author  Pravin Kale
 * @date    2026-04-10
 *
 */
define(['N/ui/serverWidget', 'N/search', 'N/file', 'N/record', 'N/url', 'N/redirect', 'N/format', 'N/xml', 'N/query'],
    function (serverWidget, search, file, record, url, redirect, format, xml, query) {
        var getFieldIdMapped = getFieldsMapping();
        var arrcountry = createArrayCountry();
        var PAGE_SIZE = 25;

        /**
         * Main Suitelet entry point. Routes GET requests to the appropriate page
         * loader and POST requests to the save handler.
         * @param {Object} context - Suitelet request/response context
         */
        function onRequest(context) {
            var request = context.request, response = context.response;
            // home and add vbd button, list of records, edit, delete link
            var profileValue = request.parameters.profileValue;
            var vendorIdvalue = request.parameters.vendorIdvalue;
            var action = request.parameters.action;
            var recId = request.parameters.recId;

            var csvDown = context.request.parameters.csvDown;
            // Executing the code only when the link for CSV Download is being clicked. i.e. csvDown param is not empty.
            if (!isEmpty(csvDown)) { if (csvDown == 'true') { downloadAllVBDDetails(context); return; } }

            log.debug("Start:", JSON.stringify(request.parameters));
            //log.debug("Action:", action);

            if (context.request.method === 'GET') {
                var form = serverWidget.createForm({ title: 'Vendor Bank Details' });
                form.clientScriptModulePath = '../Client/CIA Functional Import CS.js';
                if (!action)
                    action = 'vbdhome';

                if (action === 'vbdhome') {
                    log.debug("Loading home page...");
                    loadVBDHomePage(form, context);
                } else if (action === 'create' || action === 'edit') {
                    log.debug("Loading create page...");
                    loadCreateVBDPage(form, context);
                } else if (action === 'delete' && recId) {
                    if (recId) {
                        try {
                            record.delete({
                                type: 'customrecord_ci_adv_entity_bank_details',
                                id: recId
                            });
                            log.debug('Record deleted', request.parameters.recId);
                        } catch (e) {
                            log.error('Delete failed', e);
                        }
                    }
                    loadVBDHomePage(form, context);
                }
            } else { // POST
                getFormDataAndSave(context);
            }
        }

        /**
        * Streams a CSV file containing all VBD records to the browser.
        * Account numbers are masked (only last 4 digits visible).
        * @param {Object} context - Suitelet request/response context
        */
        function downloadAllVBDDetails(context) {
            // Loading the Vendor Bank Details Data using Saved Search for Domestic Wire Details.
            var vbdSearch = search.create({
                type: 'customrecord_ci_adv_entity_bank_details',
                columns: ['internalid', 'custrecordci_adv_details', 'custrecord_ci_adv_vendor_passport_no', 'custrecord_ci_adv_vendor_fps', 'custrecord_ci_adv_vendor_dob', 'isinactive', 'custrecord_ci_adv_vendor_dob_city', 'custrecord_ci_adv_vendor_dob_country', 'custrecord_ci_adv_vendor_res_status', 'custrecord_ci_adv_vendor_citi_sts', 'custrecord_ci_adv_primary_account', 'custrecord_ci_adv_branch_number', 'custrecord_ci_adv_bank_name', 'custrecord_ci_adv_bank_addr2', 'custrecord_ci_adv_bank_bic', 'custrecord_ci_adv_account_number', 'custrecord_ci_bank_acct_type', 'custrecord_ci_adv_bank_acct_name', 'custrecord_ci_adv_profile_name', 'custrecord_ci_adv_spl_handl_code', 'custrecord_ci_adv_form_code1', 'custrecord_ci_adv_return_addr_logo1', 'custrecord_ci_adv_template_name1', 'custrecord_ci_adv_chq_type1', 'custrecord_ci_adv_beneficiary_typ', 'custrecord_ci_adv_payment_details',
                    'custrecord_ci_adv_vendor_bill_payment', 'custrecord_ci_adv_k_symbol', 'custrecord_ci_adv_vo_motive_code', 'custrecord_ci_adv_duns_eangln', 'custrecord_ci_adv_delivery_methd', 'custrecord_ci_adv_vo_bank_type', 'custrecord_ci_adv_resident_typ', 'custrecord_ci_adv_scheme_name', 'custrecord_ci_adv_delivery_post_urid', 'custrecord_ci_adv_routing_id_vb', 'custrecord_ci_adv_local_intr_cd', 'custrecord_ci_adv_cheque_number', 'custrecord_ci_adv_vbd_bank_iban'
                ],
                filters: []
            }).run().getRange(0, 999);
            log.debug('vbdSearch', vbdSearch);

            var csvContent = 'Internal ID,Vendor Name,Payment Profile Name, Primary Account(Yes/No),Bank Name,Bank Account Number,Routing Identifier(SWIFT / BIC or Bank Branch Number),Bank Branch Number,Bank Instruction Code (BIC),IBAN,Local Instrument Code,Scheme Name\n'; //rutuja added iban 25th aug 2026

            // Traversing through the search to add the Vendor Bank Details.
            for (var loop1 = 0; loop1 < vbdSearch.length; loop1++) {

                var internalId = vbdSearch[loop1].getValue({ name: 'internalid' });
                var vendInternalID = vbdSearch[loop1].getValue({ name: 'custrecordci_adv_details' });
                var vendName = vbdSearch[loop1].getText({ name: 'custrecordci_adv_details' });
                var bankAccountType = vbdSearch[loop1].getValue({ name: 'custrecord_ci_bank_acct_type' });
                var primaryAccount = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_primary_account' });
                var bankAccountName = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_bank_acct_name' });
                var accountNumber = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_account_number' });
                var branchNumber = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_branch_number' });
                var bankBIC = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_bank_bic' });
                var localInstrumentCode = vbdSearch[loop1].getText({ name: 'custrecord_ci_adv_local_intr_cd' });
                var schemeName = vbdSearch[loop1].getText({ name: 'custrecord_ci_adv_scheme_name' });
                var paymentDetails = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_payment_details' });
                var passportNo = vbdSearch[loop1].getText({ name: 'custrecord_ci_adv_vendor_passport_no' });
                var fpsRefNo = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vendor_fps' });
                var vendorDob = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vendor_dob' });
                var isInactive = vbdSearch[loop1].getValue({ name: 'isinactive' });
                var dobCity = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vendor_dob_city' });
                var dobCountry = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vendor_dob_country' });
                var residentialStatus = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vendor_res_status' });
                var citizenshipStatus = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vendor_citi_sts' });
                // var primaryAccount = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_primary_account' });
                var branchNumber = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_branch_number' });
                var bankName = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_bank_name' });
                var chequeNumber = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_cheque_number' });
                var bankAddress2 = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_bank_addr2' });
                var profileName = vbdSearch[loop1].getText({ name: 'custrecord_ci_adv_profile_name' });
                var specialHandlingCode = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_spl_handl_code' });
                var vendorbillPayment = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vendor_bill_payment' });
                var formCode = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_form_code1' });
                var returnAddressLogo = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_return_addr_logo1' });
                var templateName = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_template_name1' });
                var chequeType = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_chq_type1' });
                var beneficiaryType = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_beneficiary_typ' });
                var kSymbol = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_k_symbol' });
                var voMotiveCode = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vo_motive_code' });
                var dunsEangln = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_duns_eangln' });
                var deliveryMethod = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_delivery_methd' });
                var voBankType = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vo_bank_type' });
                var residentType = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_resident_typ' });
                var DelPostUrid = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_delivery_post_urid' });
                var routingId = vbdSearch[loop1].getText({ name: 'custrecord_ci_adv_routing_id_vb' });
                var iban = vbdSearch[loop1].getValue({ name: 'custrecord_ci_adv_vbd_bank_iban' }); //rutuja added iban 25th aug 2026


                // if (primaryAccount == true) { primaryAccount = 'Yes'; } else { primaryAccount = 'No'; }
                if (primaryAccount == true) { primaryAccount = 'Yes'; } else { primaryAccount = 'No'; }
                //if(isEmpty(bankName)) { bankName = financialInstitutionName; }
                if (!isEmpty(bankName)) { bankName = bankName.replace(/[']/g, "'"); bankName = bankName.replace(/[,]/g, " "); }

                accountNumber = maskAccountNumber(accountNumber);

                csvContent += internalId + ',' + vendName + ',' + profileName + ',' + primaryAccount + ',' + bankName + ',' + accountNumber + ',' + routingId + ',' + branchNumber + ',' + bankBIC + ',' + iban + ',' + localInstrumentCode + ',' + schemeName + '\n';
            }
            log.debug('csvContent', csvContent);

            // Creating the file.
            var csvFile = file.create({ name: 'Vendor Bank Details List.csv', fileType: file.Type.CSV, contents: csvContent, encoding: file.Encoding.UTF8 });
            log.debug('csvFile', csvFile);
            context.response.setHeader({ name: 'Content-Disposition', value: 'attachment; filename="Vendor Bank Details List.csv"' });
            context.response.writeFile(csvFile, true);
        }

        /**
        * Reads POST form parameters and either creates a new VBD record or
        * updates the existing one for the same vendor/profile combination.
        * Redirects back to the home page on success.
        */
        function getFormDataAndSave(context) {
            try {
                // get all data
                var paramObj = context.request.parameters;
                log.audit('POST : getFormDataAndSave : ', paramObj);
                var profileValue = paramObj.custpage_profile;
                var profileText = paramObj.inpt_custpage_profile;
                log.debug('POST : profileValue : ', profileValue + '  profileText:' + profileText);
                var isChequeProfile = (profileText.toUpperCase().indexOf('CHEQUE') !== -1);
                log.debug('POST : isChequeProfile : ', isChequeProfile);
                var vendorId = paramObj.custpage_vendor;
                var urlStr = paramObj.entryformquerystring;
                log.audit('POST : urlStr : ', urlStr);
                var temp = urlStr.split('vbdRecId=');
                log.audit('POST : recID  : ', temp[1]);
                var vbdRecId = temp[1];
                log.audit('POST :vbdRecId : ', vbdRecId);
                log.debug('Post : ', '  vendorId:' + vendorId);
                //manually  get all mandatory fields values and save as it has value
                var bankAccountName = paramObj.custpage_bank_account_name;
                var bankAccountNumber = paramObj.custpage_bank_account_number;
                log.debug('bankAccountNumber', bankAccountNumber);

                var bankBranchNumber = paramObj.custpage_bank_branch_number;
                var bankName = paramObj.custpage_bank_name;
                var deliveryMethod = paramObj.custpage_delivery_method;
                var ChequeNumber = paramObj.custpage_cheque_number;
                var SpecialHandlingCode = paramObj.custpage_special_handling_code;
                var FormCode = paramObj.custpage_form_code;
                var ReturnAddressLogo = paramObj.custpage_return_address_logo;
                var bankInstructionCode = paramObj.custpage_bank_instruction_code;
                log.debug('Post  bankInstructionCode : ', bankInstructionCode);
                var bankAccountType = paramObj.custpage_bank_account_type;
                var primaryAccount = paramObj.custpage_bankdetails_primaryacc;
                var vendorBillPayment = paramObj.custpage_vendor_bill_payment;
                // var vendorBillPayment = paramObj.custpage_vendor_bill_payment;
                var branchName = paramObj.custpage_branch_name;
                var bankCountry = paramObj.custpage_bank_country;
                log.debug('bankCountry', bankCountry);

                var bankIban = paramObj.custpage_bank_iban;
                var bankAddress1 = paramObj.custpage_bank_address_1;
                /* REMOVED: var bankAddress2 = paramObj.custpage_bank_address_2; */
                var voBankType = paramObj.custpage_vo_bank_type;
                var intermediaryBic = paramObj.custpage_intermediary_bic;
                var intermediaryCountryCode = paramObj.custpage_intermediary_country_code;
                var intermediaryBankName = paramObj.custpage_intermediary_bank_name;
                var intermediaryCity = paramObj.custpage_intermediary_city;
                var fpsBusnNoRef = paramObj.custpage_fps_busn_no_ref;
                var schemeName = paramObj.custpage_scheme_name;
                var paymentDetails = paramObj.custpage_payment_details;
                // new field: branch/instruction mode dropdown (replaced previous checkboxes) -Jira 822636
                var branchInstrMode = paramObj.custpage_routing_identifier;
                var bankCode = paramObj.custpage_bank_code;
                var email1 = paramObj.custpage_email1;
                var email2 = paramObj.custpage_email2;
                var email3 = paramObj.custpage_email3;
                var email4 = paramObj.custpage_email4;
                var remittanceChkbox = paramObj.custpage_rem_del_method;
                var nidnNum = paramObj.custpage_nidn_num;
                var coidNum = paramObj.custpage_coid_num;
                var vPad = paramObj.custpage_vpad_num;
                var paymentReason = paramObj.custpage_payment_reason;
                var australianBusinessNumber = paramObj.custpage_australian_business_number;
                var creditClassification = paramObj.custpage_credit_classification;
                var transactionType = paramObj.custpage_transaction_type; //Umar has added on 2nd Sept 26
                var isWhtChk = paramObj.custpage_wht_chk;
                var whtPayorCode = paramObj.custpage_wht_payor_code;
                var whtTaxForm = paramObj.custpage_wht_tax_form;
                var whtFormDetails = paramObj.custpage_wht_form_details;
                // AU889 changes by RAG on 9/7/2026
                var additionalLogo = paramObj.custpage_additional_logo;
                var suppAcctNo = paramObj.custpage_supplier_account_number;
                var paymentReasonName = paramObj.custpage_payment_reason_name;
                var bankInstruction1 = paramObj.custpage_bank_instruction_1;



                // convert into preference format
                log.debug('Date conversion ', 'Getting from VBD record');
                var DOB_Raw = paramObj.custpage_dob;
                log.debug('DOB_Raw', DOB_Raw + ' type of DOB_Raw:' + typeof DOB_Raw);
                var dateObj;
                if (DOB_Raw) {
                    dateObj = format.parse({
                        value: DOB_Raw,
                        type: format.Type.DATE
                    });
                    log.debug('dateObj', dateObj + ' type of dateObj:' + typeof dateObj);
                }
                var dob = dateObj;
                var dobCountry = paramObj.custpage_dob_country;
                var dobCity = paramObj.custpage_dob_city;
                var deliveryMethod = paramObj.custpage_delivery_method;
                var localInstrumentCode = paramObj.custpage_local_instrument_code; // 996 field update 4/29 by rag
                log.debug('localInstrumentCode', localInstrumentCode);

                var is392 = (profileText.indexOf('392') !== -1);
                var is821 = (profileText.indexOf('821') !== -1);
                var isCA603 = ((profileText.indexOf('603') !== -1) && (profileText.indexOf('CA') !== -1));
                var isCA604 = ((profileText.indexOf('604') !== -1) && (profileText.indexOf('CA') !== -1));
                var isCA780 = ((profileText.indexOf('780') !== -1) && (profileText.indexOf('CA') !== -1));
                var isUS500 = ((profileText.indexOf('500') !== -1) && (profileText.indexOf('US') !== -1));
                var isGB962 = ((profileText.indexOf('962') !== -1) && (profileText.indexOf('GB') !== -1));
                var isNO116 = ((profileText.indexOf('116') !== -1) && (profileText.indexOf('NO') !== -1));
                var isGB158 = ((profileText.indexOf('158') !== -1) && (profileText.indexOf('GB') !== -1));
                var isGB393 = ((profileText.indexOf('393') !== -1) && (profileText.indexOf('GB') !== -1));
                var isPL555 = ((profileText.indexOf('555') !== -1) && (profileText.indexOf('PL') !== -1));
                var isPL574 = ((profileText.indexOf('574') !== -1) && (profileText.indexOf('PL') !== -1));
                var isNOR599 = ((profileText.indexOf('599') !== -1) && (profileText.indexOf('NOR') !== -1));
                var isSG988 = ((profileText.indexOf('988') !== -1) && (profileText.indexOf('SG') !== -1));
                var isSG989 = ((profileText.indexOf('989') !== -1) && (profileText.indexOf('SG') !== -1));
                var isSG421 = ((profileText.indexOf('421') !== -1) && (profileText.indexOf('SG') !== -1));
                var isSG422 = ((profileText.indexOf('422') !== -1) && (profileText.indexOf('SG') !== -1));
                var isAU391 = ((profileText.indexOf('391') !== -1) && (profileText.indexOf('AU') !== -1)); //Umar has added on 23rd July 26
                var isAU393 = ((profileText.indexOf('393') !== -1) && (profileText.indexOf('AU') !== -1)); //Umar has added on 23rd July 26
                var isAU392 = ((profileText.indexOf('392') !== -1) && (profileText.indexOf('AU') !== -1)); //Umar has added on 23rd July 26
                var isTH391 = ((profileText.indexOf('391') !== -1) && (profileText.indexOf('TH') !== -1)); //Umar has added on 23rd July 26
                var isTH424 = ((profileText.indexOf('424') !== -1) && (profileText.indexOf('TH') !== -1)); //Umar has added on 23rd July 26
                var isAU980 = ((profileText.indexOf('980') !== -1) && (profileText.indexOf('AU') !== -1));
                var isKR392 = ((profileText.indexOf('392') !== -1) && (profileText.indexOf('KR') !== -1)); //Umar has added on 19th Aug 26
                log.debug("isKR392", isKR392)
                var is499 = ((profileText.indexOf('499') !== -1));

                // check if already exists
                // check if user in create or edit mode
                var isEdit = (urlStr.indexOf('edit') !== -1);
                var vbdRecord;
                //var vbdExists = checkVbdExists(vendorId, profileValue);
                if (primaryAccount == "T")
                    var response = updatePrimaryAccounts(vbdRecId, vendorId);

                if (vbdRecId && isEdit) {
                    vbdRecord = record.load({
                        type: 'customrecord_ci_adv_entity_bank_details',
                        id: vbdRecId
                    });
                } else {
                    vbdRecord = record.create({
                        type: 'customrecord_ci_adv_entity_bank_details'
                    });
                }
                // 
                if (profileValue)
                    vbdRecord.setValue('custrecord_ci_adv_profile_name', profileValue);

                if (vendorId) vbdRecord.setValue('custrecordci_adv_details', vendorId);
                if (bankAccountName) vbdRecord.setValue('custrecord_ci_adv_bank_acct_name', bankAccountName);

                // if (bankBranchNumber) vbdRecord.setValue('custrecord_ci_adv_branch_number', bankBranchNumber);
                if (bankName) vbdRecord.setValue('custrecord_ci_adv_bank_name', bankName);
                if (ChequeNumber) vbdRecord.setValue('custrecord_ci_adv_cheque_number', ChequeNumber);
                if (SpecialHandlingCode) vbdRecord.setValue('custrecord_ci_adv_spl_handl_code', SpecialHandlingCode);
                if (FormCode) vbdRecord.setValue('custrecord_ci_adv_form_code1', FormCode);
                if (ReturnAddressLogo) vbdRecord.setValue('custrecord_ci_adv_return_addr_logo1', ReturnAddressLogo);
                // if (bankName) vbdRecord.setValue('custrecord_ci_adv_bank_name', bankName);

                // ── Conditional: only one of branch number OR instruction code is active.
                // Always set both — active one gets its value, inactive one gets cleared.
                //vbdRecord.setValue('custrecord_ci_adv_bank_bic', bankInstructionCode || '');

                /* REMOVED: if (bankAccountType) vbdRecord.setValue('custrecord_ci_bank_acct_type', bankAccountType); */
                // Added bank account type for 996 by pravin on 16/6
                if (bankAccountType) vbdRecord.setValue('custrecord_ci_bank_acct_type', bankAccountType);
                log.debug('primaryAccount before save', primaryAccount);
                if (primaryAccount == "T") vbdRecord.setValue('custrecord_ci_adv_primary_account', true);
                else vbdRecord.setValue('custrecord_ci_adv_primary_account', false);

                log.debug('vendorBillPayment before save', vendorBillPayment);
                if (vendorBillPayment == "T") vbdRecord.setValue('custrecord_ci_adv_vendor_bill_payment', true);
                else vbdRecord.setValue('custrecord_ci_adv_vendor_bill_payment', false);

                // if (branchName) vbdRecord.setValue('custrecord_cig_vbd_branch_name', branchName);
                if (bankCountry) vbdRecord.setValue('custrecord_ci_adv_vbd_bank_country', bankCountry);
                //if (bankAddress1) vbdRecord.setValue('custrecord_cig_vbd_bank_address_1', bankAddress1);
                /* REMOVED: if (bankAddress2) vbdRecord.setValue('custrecord_ci_adv_bank_addr2', bankAddress2); */
                //if (voBankType) vbdRecord.setValue('custrecord_cig_vbd_vo_bank_type_pm_code', voBankType);
                //if (intermediaryBic) vbdRecord.setValue('custrecord_cig_vbd_intermediary_bic', intermediaryBic);
                if (intermediaryCountryCode) vbdRecord.setValue('custrecord_cig_vbd_interm_country_code', intermediaryCountryCode);
                //if (intermediaryBankName) vbdRecord.setValue('custrecord_cig_vbd_interm_bank_name', intermediaryBankName);
                //if (intermediaryCity) vbdRecord.setValue('custrecord_cig_vbd_intermediary_city', intermediaryCity);
                //if (fpsBusnNoRef) vbdRecord.setValue('custrecord_cig_vbd_fps_busn_org_bleii', fpsBusnNoRef);
                if (schemeName) vbdRecord.setValue('custrecord_ci_adv_scheme_name', schemeName);
                if (paymentDetails) vbdRecord.setValue('custrecord_ci_adv_payment_details', paymentDetails);

                var payDetailText = paramObj.inpt_custpage_payment_details;
                var isAUBN = (payDetailText === 'AUBN');
                var isBBAN = (payDetailText === 'BBAN');
                log.debug('australianBusinessNumber: ', australianBusinessNumber + '  isAU980: ' + isAU980 + '  isAUBN:  ' + isAUBN + ' isBBAN: ' + isBBAN)
                if (australianBusinessNumber && isAU980 && isAUBN) {
                    vbdRecord.setValue('custrecord_ci_adv_aus_bus_number', australianBusinessNumber);
                    log.debug('AUBN set ')
                }
                else if (isAU980 && isBBAN) {
                    vbdRecord.setValue('custrecord_ci_adv_aus_bus_number', '');
                    vbdRecord.setValue('custrecord_ci_adv_scheme_name', '');
                } else {
                    vbdRecord.setValue('custrecord_ci_adv_aus_bus_number', '');
                    vbdRecord.setValue('custrecord_ci_adv_scheme_name', '');

                }
                //if (dob) vbdRecord.setValue('custrecord_cig_vbd_dob', dob);
                //if (dobCountry) vbdRecord.setValue('custrecord_cig_vbd_dob_country', dobCountry);
                //if (dobCity) vbdRecord.setValue('custrecord_cig_vbd_dob_city', dobCity);
                log.debug('deliveryMethod', deliveryMethod);

                // added for sg988
                vbdRecord.setValue('custrecord_ci_adv_email1', email1 || '');
                vbdRecord.setValue('custrecord_ci_adv_email2', email2 || '');
                vbdRecord.setValue('custrecord_ci_adv_email3', email3 || '');
                vbdRecord.setValue('custrecord_ci_adv_email4', email4 || '');

                vbdRecord.setValue('custrecord_ci_adv_payment_reason_name', paymentReasonName || '');
                vbdRecord.setValue('custrecord_ci_adv_bank_inst1', bankInstruction1 || '');

                vbdRecord.setValue('custrecord_ci_adv_payment_reason', paymentReason || '');
                vbdRecord.setValue('custrecord_ci_adv_credit_classification', creditClassification || '');
                vbdRecord.setValue('custrecord_ci_adv_transaction_type', transactionType || ''); //Umar has added on 1st Sep 26


                if (deliveryMethod) {
                    vbdRecord.setValue('custrecord_ci_adv_delivery_methd', deliveryMethod);
                }
                else {
                    vbdRecord.setValue('custrecord_ci_adv_delivery_methd', '')
                    vbdRecord.setValue('custrecord_ci_adv_email1', '');
                    vbdRecord.setValue('custrecord_ci_adv_email2', '');
                    vbdRecord.setValue('custrecord_ci_adv_email3', '');
                    vbdRecord.setValue('custrecord_ci_adv_email4', '');
                }

                if (bankCode) vbdRecord.setValue('custrecord_ci_adv_bank_code', bankCode);

                log.debug('remittanceChkbox', remittanceChkbox);

                if (remittanceChkbox == "T") vbdRecord.setValue('custrecord_ci_adv_remittance_chckbox', true);
                else {
                    log.debug('inside else 325');

                    vbdRecord.setValue('custrecord_ci_adv_remittance_chckbox', false);
                    vbdRecord.setValue('custrecord_ci_adv_email1', '');
                    vbdRecord.setValue('custrecord_ci_adv_email2', '');
                    vbdRecord.setValue('custrecord_ci_adv_email3', '');
                    vbdRecord.setValue('custrecord_ci_adv_email4', '');
                }

                if (nidnNum) vbdRecord.setValue('custrecord_ci_adv_nidn_num', nidnNum)
                else
                    vbdRecord.setValue('custrecord_ci_adv_nidn_num', '')

                if (coidNum) vbdRecord.setValue('custrecord_ci_adv_coid_num', coidNum)
                else
                    vbdRecord.setValue('custrecord_ci_adv_coid_num', '')
                if (vPad) vbdRecord.setValue('custrecord_ci_adv_vpad', vPad)
                else
                    vbdRecord.setValue('custrecord_ci_adv_vpad', '')

                // validation error changes 
                if (branchInstrMode)
                    vbdRecord.setText('custrecord_ci_adv_routing_id_vb', branchInstrMode);
                if (localInstrumentCode) vbdRecord.setValue('custrecord_ci_adv_local_intr_cd', localInstrumentCode); // 996 field update 4/29 by rag

                /*  var lookupResult = search.lookupFields({
                     type: 'customrecord_ci_adv_pros_profile',
                     id: profileValue,
                     columns: ['name']
                 });
                 //log.debug('lookupResult', lookupResult);
                 var profileText = lookupResult.name;
                 log.debug('profileText', profileText); */
                log.audit('POST: Check mode and profiles : ', { 'branchInstrMode': branchInstrMode, 'profileText': profileText, 'is392': is392, 'is821': is821, 'isCA603': isCA603, 'isCA604': isCA604, 'isCA780': isCA780, 'isUS500': isUS500, 'isGB962': isGB962, 'isNO116': isNO116, 'isGB158': isGB158, 'isGB393': isGB393, 'isPL555': isPL555, 'isPL574': isPL574, 'isNOR599': isNOR599, 'isSG988': isSG988 });
                // handling set reset based on profiles and mode
                if (branchInstrMode) {
                    if (branchInstrMode === 'Bank Branch Number') {
                        // set branch value reset bic
                        vbdRecord.setValue('custrecord_ci_adv_branch_number', bankBranchNumber || '');
                        vbdRecord.setValue('custrecord_ci_adv_bank_bic', '');
                        // if 821 || 392 || SG988 - set acct no reset IBAN
                        if (is821 || is392 || isSG988 || isSG989 || isCA780 || isNO116 || is499 || isCA604 || isCA603 || isGB962 || isGB158 || isUS500 || isGB393 || isPL574 || isNOR599 || isSG421 || isSG422 || isTH391 || isTH424 || isAU391 || isAU392 || isKR392) { // bug - 780 rag
                            vbdRecord.setValue('custrecord_ci_adv_account_number', bankAccountNumber || '');
                            vbdRecord.setValue('custrecord_ci_adv_vbd_bank_iban', '');
                        }
                    } else { // BIC
                        // set bic reset br
                        vbdRecord.setValue('custrecord_ci_adv_branch_number', '');
                        vbdRecord.setValue('custrecord_ci_adv_bank_bic', bankInstructionCode || '');
                        //if 821 || 392 - reset acct no set IBAN
                        if (is821 || is392 && !isKR392) {
                            vbdRecord.setValue('custrecord_ci_adv_account_number', '');
                            vbdRecord.setValue('custrecord_ci_adv_vbd_bank_iban', bankIban || '');
                        } else if (isCA603 || isCA604 || isCA780 || isUS500 || isGB962 || isNO116 || isGB158 || isGB393 || isPL574 || isNOR599 || isSG988 || isSG989 || is499 || isSG421 || isSG422 || isAU391 || isAU393 || isAU392 || isTH391 || isTH424 || isKR392) { // added is499 - bug - ganesh 07/03/2026
                            // saves account number though mode is BIC or for SG988 BBAN mode
                            log.debug("441", bankAccountNumber)
                            vbdRecord.setValue('custrecord_ci_adv_account_number', bankAccountNumber || '');
                        }
                    }
                } else {// based on values set
                    if (isAU980) {
                        if (isBBAN)
                            vbdRecord.setValue('custrecord_ci_adv_account_number', bankAccountNumber || '');
                        else
                            vbdRecord.setValue('custrecord_ci_adv_account_number', '');
                    } else {
                        vbdRecord.setValue('custrecord_ci_adv_account_number', bankAccountNumber || '');
                    }
                    vbdRecord.setValue('custrecord_ci_adv_bank_bic', bankInstructionCode || '');
                    vbdRecord.setValue('custrecord_ci_adv_branch_number', bankBranchNumber || '');
                    vbdRecord.setValue('custrecord_ci_adv_vbd_bank_iban', bankIban || '');
                }
                if (isPL555)
                    vbdRecord.setValue('custrecord_ci_adv_vbd_bank_iban', bankIban || '');
                //var whtChk = (isWhtChk == "T") ? true : false;
                vbdRecord.setValue('custrecord_ci_adv_wht_check', (isWhtChk == "T") ? true : false);
                vbdRecord.setValue('custrecord_ci_adv_bill_wht_payor_cd', whtPayorCode || '');
                vbdRecord.setValue('custrecord_ci_adv_wht_tax_form_det', whtTaxForm || '');
                vbdRecord.setValue('custrecord_ci_adv_wht_form_details', whtFormDetails || '');
                // AU889 changes by RAG on 9/7/2026
                vbdRecord.setValue('custrecord_ci_adv_additional_logo', additionalLogo || '');
                vbdRecord.setValue('custrecord_ci_adv_supp_acct_number', suppAcctNo || '');

                var vbdRecordId = vbdRecord.save();
                log.debug("VBD saved successfully :  ", "RecordId: " + vbdRecordId);
                // redirect to home page after save
                redirect.toSuitelet({
                    scriptId: 'customscript_ci_adv_functional_import_sl',
                    deploymentId: 'customdeploy_ci_adv_functional_import_sl',
                });
            } catch (e) {
                log.error('Error in loading home page', e);
                context.response.writePage('Error in loading home page: ' + e.message);
            }

        }

        /**
         * Checks whether a primary accounts exists for vendor and reset them.
         */
        function updatePrimaryAccounts(vbdRecId, vendorId) {
            try {
                var filters = [];
                var columns = [];
                // Add filters dynamically
                if (vendorId) {
                    filters.push(['custrecordci_adv_details', 'is', vendorId]);
                } else {
                    log.error('Error : updatePrimaryAccounts', 'vendor id not found');
                    return null;
                }
                if (vbdRecId) {
                    filters.push('AND');
                    filters.push(['internalid', 'noneof', vbdRecId]);
                }

                var vbdSearch = search.create({
                    type: 'customrecord_ci_adv_entity_bank_details',
                    filters: filters,
                    columns: ['internalid']
                });
                const searchResultCount = vbdSearch.runPaged().count;
                log.debug(" updatePrimaryAccounts : searchResultCount", searchResultCount);
                if (searchResultCount > 0) {
                    vbdSearch.run().each(function (result) {
                        var vbdRecordId = result.getValue('internalid');
                        record.submitFields({
                            type: 'customrecord_ci_adv_entity_bank_details',
                            id: vbdRecordId,
                            values: {
                                custrecord_ci_adv_primary_account: false
                            },
                            options: {
                                enableSourcing: false,
                                ignoreMandatoryFields: true
                            }
                        });
                        return true;
                    });
                }
                log.debug(" updatePrimaryAccounts : ", 'Reset success');

                return true;
            } catch (e) {
                log.error('Error in updatePrimaryAccounts', e);
                return null;
            }
        }

        /**
         * Renders the VBD home page: a paginated sublist of all VBD records with
         * Edit / Delete action links, plus the CSV import/export field group.
         */
        function loadVBDHomePage(form, context) {
            try {
                var pageId = context.request.parameters.pageId || 0;
                log.debug("pageId==", pageId);
                form.addButton({ id: 'custpage_home_btn', label: 'Invoice Payments', functionName: 'goHome' });
                form.addButton({ id: 'custpage_add_vbd', label: 'Add Vendor Bank Details', functionName: 'addVBDDetails' });
                // Add sublist
                // start - Changes for Functional CSV Import by Raghini 
                form = addCSVLinkDetails(form);
                // end
                var vendBankDetSubTab = form.addSubtab({ id: 'custpage_subtab_vend_bank_det', label: 'Bank Details' });
                var sublist = form.addSublist({
                    id: 'custpage_bank_table',
                    type: serverWidget.SublistType.LIST,
                    label: ' ',
                    tab: 'custpage_subtab_vend_bank_det'
                });

                // Add columns
                sublist.addField({ id: 'action_value', type: serverWidget.FieldType.TEXTAREA, label: 'Action' });
                sublist.addField({ id: 'custpage_sublist_field_internal_id', type: serverWidget.FieldType.TEXT, label: 'Internal ID' });
                sublist.addField({ id: 'vendor_name', type: serverWidget.FieldType.TEXTAREA, label: 'Vendor Name' });
                sublist.addField({ id: 'profile_name', type: serverWidget.FieldType.TEXTAREA, label: 'Payment Profile Name' });
                sublist.addField({ id: 'primary_account', type: serverWidget.FieldType.CHECKBOX, label: 'Primary Account' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
                //sublist.addField({ id: 'vendor_bill_payment', type: serverWidget.FieldType.CHECKBOX, label: 'Vendor Bill Payment' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
                //sublist.addField({ id: 'accttype', type: serverWidget.FieldType.TEXTAREA, label: 'Bank Account Type' });
                //sublist.addField({ id: 'country', type: serverWidget.FieldType.TEXTAREA, label: 'Country' });
                //sublist.addField({ id: 'accname', type: serverWidget.FieldType.TEXTAREA, label: 'Bank Account Name' });
                sublist.addField({ id: 'bankname', type: serverWidget.FieldType.TEXTAREA, label: 'Bank Name' });
                sublist.addField({ id: 'cheque_number', type: serverWidget.FieldType.TEXTAREA, label: 'Cheque Number' });
                sublist.addField({ id: 'special_handling_code', type: serverWidget.FieldType.TEXTAREA, label: 'Special Handling Code' });
                sublist.addField({ id: 'form_code', type: serverWidget.FieldType.TEXTAREA, label: 'Form Code' });
                sublist.addField({ id: 'return_address_logo', type: serverWidget.FieldType.TEXTAREA, label: 'Return Address Logo' });

                sublist.addField({ id: 'accno', type: serverWidget.FieldType.TEXTAREA, label: 'Bank Account Number' });
                // sublist.addField({ id: 'addr2', type: serverWidget.FieldType.TEXTAREA, label: 'Bank Address 2' });
                sublist.addField({ id: 'branchno', type: serverWidget.FieldType.TEXTAREA, label: 'Bank Branch Number' });
                sublist.addField({ id: 'bic', type: serverWidget.FieldType.TEXTAREA, label: 'Bank Instruction Code (BIC)' });
                sublist.addField({ id: 'iban', type: serverWidget.FieldType.TEXTAREA, label: 'IBAN' });

                //sublist.addField({ id: 'city', type: serverWidget.FieldType.TEXTAREA, label: 'City' });
                //sublist.addField({ id: 'recid', type: serverWidget.FieldType.TEXT, label: 'VBD Record Id' });
                // Load records

                // CR: add pagination 
                var pagedSearch = searchVendorBankDetails(PAGE_SIZE);
                var searchResultCount = pagedSearch.count;
                log.debug('searchResultCount', searchResultCount);

                if (searchResultCount > 0) {
                    var totalPages = pagedSearch.pageRanges.length;
                    log.debug('totalPages', totalPages);

                    var searchResultPage = pagedSearch.fetch({ index: pageId });

                    var pageData = form.addField({ id: 'custpage_page_data', label: 'Page Data', type: serverWidget.FieldType.INLINEHTML, container: 'custpage_subtab_vend_bank_det' });
                    var pageHTML = "<span style=' position: absolute; right: 150px; font-family: Open Sans, Helvetica, sans-serif; font-size: 13px;'>Displaying " + (Number(pageId) + 1) + " of " + totalPages + "</span><div style='height:10px'>";
                    pageData.defaultValue = pageHTML;

                    var prevOptions = form.addField({ id: 'custpage_prev', label: 'Prev', type: serverWidget.FieldType.INLINEHTML, container: 'custpage_subtab_vend_bank_det' });
                    var prevURLString = url.resolveScript({ scriptId: 'customscript_ci_adv_functional_import_sl', deploymentId: 'customdeploy_ci_adv_functional_import_sl', returnExternalUrl: false, params: { 'pageId': (Number(pageId) - 1) } });
                    var prevHTML = "<a style='color: #000080; top: 4px; position: absolute; right: 75px; font-family: Open Sans, Helvetica, sans-serif; font-size: 13px;' href=" + prevURLString + ">Prev Page</a><div style='height:10px'></div>";
                    prevOptions.defaultValue = prevHTML;

                    var nextOptions = form.addField({ id: 'custpage_next', label: 'Next', type: serverWidget.FieldType.INLINEHTML, container: 'custpage_subtab_vend_bank_det' });
                    var nextURLString = url.resolveScript({ scriptId: 'customscript_ci_adv_functional_import_sl', deploymentId: 'customdeploy_ci_adv_functional_import_sl', returnExternalUrl: false, params: { 'pageId': (Number(pageId) + 1) } });
                    var nextHTML = "<a style='color: #000080; position: absolute; right: 0; top: 4px; font-family: Open Sans, Helvetica, sans-serif; font-size: 13px;' href=" + nextURLString + ">Next Page</a><div style='height:10px'>";
                    nextOptions.defaultValue = nextHTML;

                    // Hiding the Previous Option on the first page.
                    if (pageId == 0) { prevOptions.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }); }

                    // Hiding the Next Option on the last page.
                    if ((Number(pageId) + 1) == totalPages) { nextOptions.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }); }

                    // pagination end 

                    // var results = bankSearch.run().getRange({ start: 0, end: 1000 });
                    var results = searchResultPage.data;
                    log.debug("results- searchResultPage :", JSON.stringify(searchResultPage));
                    log.debug("VBD records length:", results.length);

                    for (var i = 0; i < results.length; i++) {
                        var recId = results[i].getValue('internalid');
                        var vendorId = results[i].getValue('custrecordci_adv_details');
                        var profileValue = results[i].getValue('custrecord_ci_adv_profile_name');

                        // Resolve Suitelet URL once
                        var editURLString = url.resolveScript({
                            scriptId: 'customscript_ci_adv_functional_import_sl',
                            deploymentId: 'customdeploy_ci_adv_functional_import_sl',
                            params: {
                                action: "edit",
                                profileValue: profileValue,
                                vendorIdvalue: vendorId,
                                vbdRecId: recId
                            }
                        });
                        var deleteURLString = url.resolveScript({
                            scriptId: 'customscript_ci_adv_functional_import_sl',
                            deploymentId: 'customdeploy_ci_adv_functional_import_sl',
                            params: {
                                action: 'delete',     // 'delete'
                                recId: recId,
                                vendorid: vendorId
                            }
                        });

                        // Create action HTML using links
                        var actionHtml =
                            '<a href="' + editURLString + '" style="color:blue;">Edit</a> | ' +
                            '<a href="' + deleteURLString + '" ' +
                            'onclick="return confirm(\'Are you sure you want to delete this record\');" ' +
                            'style="color:blue; cursor:pointer; text-decoration:underline;">Delete</a>';
                        // Set the sublist value

                        // Action
                        if (actionHtml) {
                            sublist.setSublistValue({
                                id: 'action_value',
                                line: i,
                                value: actionHtml
                            });
                        }

                        if (recId) {
                            sublist.setSublistValue({ id: 'custpage_sublist_field_internal_id', line: i, value: recId });
                        }

                        // Vendor Name (List/Record → getText)
                        var vendorName = results[i].getText('custrecordci_adv_details');
                        if (vendorName) {
                            sublist.setSublistValue({
                                id: 'vendor_name',
                                line: i,
                                value: vendorName
                            });
                        }

                        // Profile Name (List/Record)
                        var profileName = results[i].getText('custrecord_ci_adv_profile_name');
                        if (profileName) {
                            sublist.setSublistValue({
                                id: 'profile_name',
                                line: i,
                                value: profileName
                            });
                        }

                        // Primary Account (Checkbox)
                        var primaryAccount = results[i].getValue('custrecord_ci_adv_primary_account');
                        //log.debug('primaryAccount', primaryAccount);
                        if (primaryAccount == 'T' || primaryAccount == true) { primaryAccount = 'T'; } else { primaryAccount = 'F'; }
                        // if (primaryAccount == 'T' || primaryAccount == true) { primaryAccount = 'Yes'; } else { primaryAccount = 'No'; }

                        if (primaryAccount) {
                            sublist.setSublistValue({
                                id: 'primary_account',
                                line: i,
                                value: primaryAccount
                            });
                        }

                        // Vendor Bill Payment (Checkbox)
                        //var vendorBillPayment = results[i].getValue('custrecord_ci_adv_vendor_bill_payment');
                        //log.debug('vendorBillPayment', vendorBillPayment);
                        //if (vendorBillPayment == 'T' || vendorBillPayment == true) { vendorBillPayment = 'T'; } else { vendorBillPayment = 'F'; }
                        // if (vendorBillPayment == 'T' || vendorBillPayment == true) { vendorBillPayment = 'Yes'; } else { vendorBillPayment = 'No'; }

                       /*  if (vendorBillPayment) {
                            sublist.setSublistValue({
                                id: 'vendor_bill_payment',
                                line: i,
                                value: vendorBillPayment
                            });
                        } */

                        // Account Type (List/Record)
                        //    var acctType = results[i].getText('custrecord_ci_bank_acct_type');
                        //   if (acctType) {
                        //       sublist.setSublistValue({
                        //           id: 'accttype',
                        //           line: i,
                        //           value: acctType
                        //       });
                        //   }

                        // Account Name (Text)
                        /* var accName = results[i].getValue('custrecord_ci_adv_bank_acct_name');
                        if (accName) {
                            sublist.setSublistValue({
                                id: 'accname',
                                line: i,
                                value: accName
                            });
                        } */
                        var bankName = results[i].getValue('custrecord_ci_adv_bank_name');
                        if (bankName) {
                            bankName = bankName.length > 30 ? bankName.substring(0, 30) + '...' : bankName
                            sublist.setSublistValue({
                                id: 'bankname',
                                line: i,
                                value: bankName
                            });
                        }

                        var splhandlingcode = results[i].getValue('custrecord_ci_adv_spl_handl_code');
                        if (splhandlingcode) {
                            sublist.setSublistValue({
                                id: 'special_handling_code',
                                line: i,
                                value: splhandlingcode
                            });
                        }
                        var formcode = results[i].getValue('custrecord_ci_adv_form_code1');
                        if (formcode) {
                            sublist.setSublistValue({
                                id: 'form_code',
                                line: i,
                                value: formcode
                            });
                        }
                        var returnAddressLogo = results[i].getValue('custrecord_ci_adv_return_addr_logo1');
                        if (returnAddressLogo) {
                            sublist.setSublistValue({
                                id: 'return_address_logo',
                                line: i,
                                value: returnAddressLogo
                            });
                        }
                        var chequeNumber = results[i].getValue('custrecord_ci_adv_cheque_number');
                        if (chequeNumber) {
                            sublist.setSublistValue({
                                id: 'cheque_number',
                                line: i,
                                value: chequeNumber
                            });
                        }
                        // Account Number (Text / Number)
                        var accNo = results[i].getValue('custrecord_ci_adv_account_number');
                        if (accNo) {
                            accNo = maskAccountNumber(accNo);
                            sublist.setSublistValue({
                                id: 'accno',
                                line: i,
                                value: accNo
                            });
                        }

                        // Address Line 2
                        /*var addr2 = results[i].getValue('custrecord_ci_adv_bank_addr2');
                            var addr2 = results[i].getValue('custrecord_ci_adv_bank_addr2');
                        if (addr2) {
                            sublist.setSublistValue({
                                id: 'addr2',
                                line: i,
                                value: addr2
                            });
                        } */

                        // Branch Number
                        var branchNo = results[i].getValue('custrecord_ci_adv_branch_number');
                        if (branchNo) {
                            sublist.setSublistValue({
                                id: 'branchno',
                                line: i,
                                value: branchNo
                            });
                        }

                        // Bank Name
                        var BIC = results[i].getValue('custrecord_ci_adv_bank_bic');
                        if (BIC) {
                            sublist.setSublistValue({
                                id: 'bic',
                                line: i,
                                value: BIC
                            });
                        }
                        // IBAN
                        var IBAN = results[i].getValue('custrecord_ci_adv_vbd_bank_iban');
                        if (IBAN) {
                            sublist.setSublistValue({
                                id: 'iban',
                                line: i,
                                value: IBAN
                            });
                        }

                        // -------- Hidden / Data Fields for Client Script --------

                        // Record ID
                        if (recId) {
                            sublist.setSublistValue({
                                id: 'custpage_rec_id_' + i,
                                line: i,
                                value: recId
                            });
                        }

                        // Vendor ID
                        if (vendorId) {
                            sublist.setSublistValue({
                                id: 'custpage_vendor_id_' + i,
                                line: i,
                                value: vendorId
                            });
                        }
                        // Profile Value
                        if (profileValue) {
                            sublist.setSublistValue({
                                id: 'custpage_profile_' + i,
                                line: i,
                                value: profileValue
                            });
                        }
                    }
                }// if got results
                context.response.writePage(form);
            } catch (e) {
                log.error('Error in loading home page', e);
                context.response.writePage('Error in loading home page: ' + e.message);
            }
        }

        /**
         * Runs a paged search of all VBD records, sorted by internal ID descending.
         */
        function searchVendorBankDetails(PAGE_SIZE) {
            var bankSearch = search.create({
                type: 'customrecord_ci_adv_entity_bank_details',
                filters: [],
                columns: [
                    // 'internalid',
                    search.createColumn({ name: 'internalid', sort: search.Sort.DESC }),
                    'custrecordci_adv_details',
                    'custrecord_ci_adv_profile_name',
                    'custrecord_ci_bank_acct_type',
                    // 'custrecord_cig_vbd_bank_country',
                    'custrecord_ci_adv_bank_acct_name',
                    'custrecord_ci_adv_account_number',
                    'custrecord_ci_adv_bank_addr2',
                    'custrecord_ci_adv_branch_number',
                    //'custrecord_cig_vbd_bank_city',
                    'custrecord_ci_adv_bank_name',
                    'custrecord_ci_adv_bank_bic',
                    'custrecord_ci_adv_primary_account',
                    'custrecord_ci_adv_spl_handl_code',
                    'custrecord_ci_adv_form_code1',
                    'custrecord_ci_adv_return_addr_logo1',
                    'custrecord_ci_adv_cheque_number',
                    'custrecord_ci_adv_vbd_bank_iban'
                ]
            });
            return bankSearch.runPaged({ pageSize: PAGE_SIZE });
        }

        /**
         * Attempts to resolve the internal ID of a saved CSV import map by name.
         * Returns null if not found (non-fatal — caller falls back to the generic import list).
         */
        function getCustomImportId(importScriptId) {
            // Resolves the internal ID of a custom import record by its script ID
            try {
                log.debug('Fetching custom import ID for script ID:', importScriptId);
                var importSearch = search.create({
                    type: 'csvimportmap',
                    filters: [
                        ['name', 'is', importScriptId]
                    ],
                    columns: ['internalid', 'name']
                });
                var results = importSearch.run().getRange({ start: 0, end: 1 });
                if (results.length > 0) {
                    var internalId = results[0].getValue('internalid');
                    log.debug('Import Internal ID', internalId);
                }
                return null;
            } catch (e) {
                //log.error('Error fetching custom import ID', e)
                return null;
            }
        }

        /**
         * Injects the CSV Import field group into the form.
         * Renders download-template, preview-template, upload-CSV, and bulk-export links.
         */
        function addCSVLinkDetails(form) {
            form.addFieldGroup({ id: 'custpage_fieldgroup_user_notes', label: 'CSV Import' });
            var linkField = form.addField({ id: 'custpage_sublist_link', type: serverWidget.FieldType.LONGTEXT, label: ' ', container: 'custpage_fieldgroup_user_notes' });
            var fileObj = file.load({ id: '../../Files/Vendor Bank Details Template.csv' }), fileUrl = fileObj.url;
            log.debug('fileUrl', fileUrl);
            var vbdImg = file.load({ id: '../../Images/VBD CSV Import Template.jpg' });
            var vbdImgPath = vbdImg.url;
            var csvDownloadURL = url.resolveScript({ scriptId: 'customscript_ci_adv_functional_import_sl', deploymentId: 'customdeploy_ci_adv_functional_import_sl', returnExternalUrl: false, params: { 'csvDown': 'true' } });
            var vbdIportId = getCustomImportId('CIA Vendor Bank Details CSV Import'); // Retyped to remove any hidden/illegal characters
            if (vbdIportId) {
                var vbdImportUrl = '/app/setup/assistants/nsimport/importassistant.nl?recid=' + vbdIportId + '&new=T';
            }
            else {
                var vbdImportUrl = '/app/setup/assistants/nsimport/savedimports.nl?recordtype=CUSTOMRECORD';
            }
            var uploadIconpath = file.load({ id: '../../Images/Upload Icon.png' }).url;
            var downloadIconpath = file.load({ id: '../../Images/Download Icon.png' }).url;
            var previewIconPath = file.load({ id: '../../Images/Preview Icon.png' }).url;

            var excelLogo = file.load({ id: '../../Images/excel-icon.png' });
            var excelLogoPath = excelLogo.url;

            var linkURL = '<div style="font-size:13px;"> <a href = "' + fileUrl + '" style="text-decoration:none; font-size:13px; color: rgb(38, 38, 38)" target="_blank"><img src="' + downloadIconpath + '" title="Download Vendor Bank Details Template" style="width: 17px; height: 17px; vertical-align: middle; margin-right: 5px; margin-bottom:5px;" /></a><span style=" margin-bottom:5px;"><span style="font-weight: bold;">Download</span> the template for Vendor Bank Details</span><span id ="tooltip-container" style="margin-left:2px; margin-bottom:5px;"><img src="' + previewIconPath + '" title="Download Vendor Bank Details Template" style="width: 17px; height: 17px; margin-bottom:5px; vertical-align: middle; margin-right: 5px;" /><span id="tooltip-content"><img src=' + vbdImgPath + ' id=\'vbdImg\' style=\'max-width: 100%; max-height: 100%; object-fit: contain; border: 2px solid grey; border-radius: 5px;\' ></span></span></div><div style="font-size:13px;"> <a href = "' + vbdImportUrl + '" style="text-decoration:none; font-size:13px; color: rgb(38, 38, 38)" target="_blank"><img src="' + uploadIconpath + '" title="Upload CSV for Vendor Bank Details" style="width: 17px; height: 17px; vertical-align: middle; margin-right: 6px;" /></a><span style=""><span style="font-weight: bold;">Upload</span> the CSV File for Vendor Bank Details</span></div><div><a href="#" onclick="(function(){var iframe=document.createElement(\'iframe\');iframe.style.display=\'none\';iframe.src=\'' + csvDownloadURL + '\';document.body.appendChild(iframe);})()" style="position: absolute; top: 115px; left: 1px; z-index: 99;"><img src="' + excelLogoPath + '" title="Download CSV for Vendor Bank Details" style="width: 17px; height: 17px; margin-bottom: 40px;" /></a></div>';
            linkField.defaultValue = linkURL;
            linkField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });


            var hoverStyles = form.addField({ id: 'custpage_hoverstyles', label: ' ', type: serverWidget.FieldType.INLINEHTML });
            var hoverStylesScript = '<script>';
            hoverStylesScript += 'var subListLink = document.getElementById("custpage_sublist_link_val");';
            hoverStylesScript += 'var subListLinkParent = subListLink.parentElement;';
            hoverStylesScript += 'if (subListLinkParent) { subListLinkParent.style.marginBottom = "58px"; };';
            hoverStylesScript += 'if(subListLink){';
            hoverStylesScript += 'subListLink.style.position = "absolute";';
            hoverStylesScript += 'subListLink.style.top = "134px";';
            hoverStylesScript += '}';
            hoverStylesScript += 'var containerText = document.getElementById("tooltip-container");';
            hoverStylesScript += 'console.log("containerText", containerText);';
            hoverStylesScript += 'if(containerText){containerText.style.cursor="pointer"; containerText.style.fontSize="13px"; containerText.style.textDecoration="underline"; containerText.style.display= "inline-block";};';
            hoverStylesScript += 'var tooltipContent = document.getElementById("tooltip-content");';
            hoverStylesScript += 'console.log("tooltipContent", tooltipContent);';
            hoverStylesScript += 'if(tooltipContent){';
            hoverStylesScript += 'tooltipContent.style.transform = "translateX(-50%)";';
            hoverStylesScript += 'tooltipContent.style.color = "rgb(0, 0, 0)";';
            hoverStylesScript += 'tooltipContent.style.textAlign = "center";';
            hoverStylesScript += 'tooltipContent.style.padding = "10px";';
            hoverStylesScript += 'tooltipContent.style.borderRadius = "5px";';
            hoverStylesScript += 'tooltipContent.style.position = "fixed";';
            hoverStylesScript += 'tooltipContent.style.zIndex = "9999";';
            hoverStylesScript += 'tooltipContent.style.top = "80px";';
            hoverStylesScript += 'tooltipContent.style.left = "50%";';
            hoverStylesScript += 'tooltipContent.style.width = "80vw";';
            hoverStylesScript += 'tooltipContent.style.height = "85vh";';
            hoverStylesScript += 'tooltipContent.style.display = "flex";';
            hoverStylesScript += 'tooltipContent.style.justifyContent = "center";';
            hoverStylesScript += 'tooltipContent.style.alignItems = "center";';
            hoverStylesScript += 'tooltipContent.style.visibility = "hidden";';
            hoverStylesScript += '}';
            hoverStylesScript += 'if(containerText && tooltipContent){';
            hoverStylesScript += 'containerText.addEventListener("mouseover", function(){ tooltipContent.style.visibility = "visible"; });';
            hoverStylesScript += 'containerText.addEventListener("mouseout", function(){ tooltipContent.style.visibility = "hidden"; });';
            hoverStylesScript += '}';
            hoverStylesScript += '</script>';
            hoverStyles.defaultValue = hoverStylesScript;
            return form;
        }

        /**
         * Renders the create/edit VBD form. Populates vendor and profile dropdowns,
         * resolves mandatory fields from the profile JSON, and pre-fills values when
         * editing an existing record.
         */
        function loadCreateVBDPage(form, context) {
            try {
                log.audit('context', context);

                // get parameters if passed from filter
                var profileValue = context.request.parameters.profileValue;
                var vendorIdvalue = context.request.parameters.vendorIdvalue;
                var action = context.request.parameters.action;
                var vbdRecId = context.request.parameters.vbdRecId;
                log.audit('profileValue', profileValue + ' action : ' + action);
                // add function to get profile text
                log.debug('vendorIdvalue', vendorIdvalue);

                // add group for filters

                form.addFieldGroup({ id: 'custpage_fieldgroup_filters', label: 'Select Filters' });

                // Creating vendor and profile dropdowns first. 
                var vendorDropDownField = form.addField({ id: 'custpage_vendor', type: serverWidget.FieldType.SELECT, label: 'Select Vendor', mandatory: true, container: 'custpage_fieldgroup_filters' });
                vendorDropDownField.isMandatory = true;
                vendorDropDownField.addSelectOption({ value: '', text: '--Select--' });

                var ProfileDropDownField = form.addField({ id: 'custpage_profile', type: serverWidget.FieldType.SELECT, label: 'Select Payment Profile', mandatory: true, container: 'custpage_fieldgroup_filters' });
                ProfileDropDownField.updateBreakType({
                    breakType: serverWidget.FieldBreakType.STARTCOL
                });
                var htmlField = form.addField({
                    id: 'custpage_css',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: ' '
                });

                // Widen ONLY the Payment Profile dropdown (field box + its value list).
                htmlField.defaultValue =
                  '<script>' +
                  // 'setTimeout(function(){' +
                   'var inpt = document.getElementById("inpt_custpage_profile_2");' + 
                   'if (inpt) { inpt.style.width =  "450px"; }' +
                     'document.head.appendChild(style);' +
                   // '}, 500);' +
                    '</script>';
                    //inpt_custpage_profile_2
                ProfileDropDownField.addSelectOption({ value: '', text: '--Select--' });
                // Populate Vendor Dropdown and profile dropdown list
                search.create({
                    type: search.Type.VENDOR,
                    filters: [['isinactive', 'is', 'F']],
                    columns: ['entityid', 'isperson', 'firstname', 'lastname', 'companyname']
                }).run().each(function (result) {
                    var name = '', entityID = result.getValue('entityid');
                    var isPerson = result.getValue('isperson'), companyName = result.getValue('companyname');
                    var firstName = result.getValue('firstname'), lastName = result.getValue('lastname');
                    // Getting the Vendor Name.
                    if (isPerson == true) { name = firstName + ' ' + lastName; } else { name = companyName; }
                    if (isEmpty(name)) { name = entityID; }
                    vendorDropDownField.addSelectOption({
                        value: result.id,
                        text: name
                    });
                    return true;
                });

                //Rutuja 11th Sep changes made for fetching profiles according to  vendor country
                var primarySubsidiaryId = '';
                var subsidiaryCountry = '';

                if (vendorIdvalue) {
                    // 1. Look up the primary subsidiary on the vendor record
                    var vendorData = search.lookupFields({
                        type: search.Type.VENDOR,
                        id: vendorIdvalue,
                        columns: ['subsidiary']
                    });

                    primarySubsidiaryId = vendorData.subsidiary[0].value;

                    // 2. Look up the country on the subsidiary record using the primary subsidiary ID
                    var subsidiaryData = search.lookupFields({
                        type: search.Type.SUBSIDIARY,
                        id: primarySubsidiaryId,
                        columns: ['country']
                    });

                    subsidiaryCountry = subsidiaryData.country[0].value;

                    var countryId = null;

                    for (var i = 0; i < arrcountry.length; i++) {
                        if (arrcountry[i][0] === subsidiaryCountry) {
                            countryId = arrcountry[i][1];
                            break;
                        }
                    }

                    var profileTemplateSearch = search.create({
                        type: "customrecord_ci_adv_pros_profile_temp",
                        filters:
                            [
                                ["custrecord_ci_adv_selected_country", "anyof", countryId]
                            ],
                        columns:
                            [
                                search.createColumn({ name: "name", label: "Name" }),
                                search.createColumn({ name: "scriptid", label: "Script ID" }),
                                search.createColumn({ name: "custrecord_ci_adv_selected_country", label: "Country" }),
                                search.createColumn({ name: "custrecord_ci_adv_pmt_pros_profile", label: "Payment Process Profile" })
                            ]
                    });
                    const searchResultCount = profileTemplateSearch.runPaged().count;
                    log.debug("profileTemplateSearch result count", searchResultCount);
                    profileTemplateSearch.run().each(function (result) {
                        ProfileDropDownField.addSelectOption({
                            value: result.getValue('custrecord_ci_adv_pmt_pros_profile'),
                            text: result.getText('custrecord_ci_adv_pmt_pros_profile')
                        });
                        return true;
                    });
                }
                else {
                    search.create({
                        type: 'customrecord_ci_adv_pros_profile',
                        filters: [['isinactive', 'is', 'F']],
                        columns: ['name']
                    }).run().each(function (result) {
                        ProfileDropDownField.addSelectOption({
                            value: result.id,
                            text: result.getValue('name')
                        });
                        return true;
                    });
                }
                //Rutuja 11th Sep changes made for fetching profiles according to  vendor country



                // set passed params
                if (vendorIdvalue) {
                    vendorDropDownField.defaultValue = vendorIdvalue;
                    // NEW CHANGE: Disable vendor when passed from action link to prevent edits. -Jira 822636
                    vendorDropDownField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED }); // vendor passed from list is read-only
                }
                // add submit and cancel button
                // CR: Validation for vbd - 3/10/26
                var validatorField = form.addField({ id: 'custpage_field_validator', type: serverWidget.FieldType.LONGTEXT, label: 'FieldValidators' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });//HIDDEN
                // end 

                form.addSubmitButton({
                    label: 'Save'
                });

                form.addButton({
                    id: 'custpage_cancel_btn',
                    label: 'Cancel',
                    functionName: 'goVBDHomePage'
                });

                // Add Delete button only in edit mode
                if (action === 'edit' && vbdRecId) {
                    form.addButton({
                        id: 'custpage_delete_btn',
                        label: 'Delete',
                        functionName: 'deleteVBDRecord'
                    });
                }

                //if filters passed for prfile then show related fields on page
                // CR: and also get validators details - 3/10/2024
                if (profileValue) {
                    // set field wih validator data
                    validatorField.defaultValue = getValidatorsForProfile(profileValue);
                    log.debug('Set', 'field validators');
                    ProfileDropDownField.defaultValue = profileValue;
                    var mandatoryFields = getMandatoryFields(profileValue);
                    log.debug('Mandatory Fields for profile ' + profileValue, JSON.stringify(mandatoryFields));
                    log.debug('Mandatory Fields length ', mandatoryFields.length);
                    // add all fields to form
                    var sepa = isSepaProfile(profileValue);
                    var is996 = isUs996Profile(profileValue);
                    var isCheque = isChequeProfile(profileValue); //Umar added it up on 20th July 2026.
                    var is2PH = is2PHProfile(profileValue);
                    var is4PH = is4PHProfile(profileValue);
                    var is5PH = is5PHProfile(profileValue);
                    var isNoRouting = isNoRoutingProfile(profileValue);
                    var profileName = getProfileNameById(profileValue);
                    var countryCode = profileName.substring(0, 2);
                    log.debug('getCountryCode', countryCode);
                    var form = addAllMandatoryFieldsToForm(form, mandatoryFields, sepa, is996, is2PH, is4PH, is5PH, isNoRouting, action, isCheque, countryCode);
                    // Ensure Routing Identifier default is set server-side before rendering. -Jira 822636
                    /*  var modeField = form.getField('custpage_branch_instr_mode');
                        if (modeField && !modeField.defaultValue) {
                            modeField.defaultValue = 'Bank Instruction Code';
                        } */
                    log.debug('end', 'added all fields');
                    // check if already present vbd then show data
                    //var vbdExists = checkVbdExists(vendorIdvalue, profileValue);
                    if (action === 'edit' && vbdRecId) {
                        // load record and set values to fields only when it is in edit mode
                        var vbdRecordData = getVbdRecordData(vbdRecId);
                        log.debug('retreived all** vbdRecordData', JSON.stringify(vbdRecordData));
                        form = setValuesToFields(form, vbdRecordData, mandatoryFields);
                    }
                    // else will go in create mode
                }
                context.response.writePage(form);

            } catch (e) {
                log.error('Error in loading home page', e);
                context.response.writePage('Error in loading home page: ' + e.message);
            }
        }

        function getProfileNameById(profileValue) {
            try {
                var profileName;
                search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [['internalid', 'is', profileValue]],
                    columns: ['name']
                }).run().each(function (result) {
                    profileName = result.getValue('name');
                    return false;
                });
                return profileName;
            } catch (e) {
                log.error('Error in getProfileNameById', e);
                return null;
            }
        }

        /**
         * Fetches the XML validator config for the given profile, parses it into a
         * JSON string, and returns it to be stored in the hidden validator field
         * consumed by the client script.
         */
        function getValidatorsForProfile(profileValue) {
            try {
                var validatorDetails;
                search.create({
                    type: 'customrecord_ci_adv_pros_profile_temp',
                    filters: [['custrecord_ci_adv_pmt_pros_profile', 'is', profileValue]],
                    columns: ['custrecord_ci_adv_field_validate']
                }).run().each(function (result) {
                    validatorDetails = result.getValue('custrecord_ci_adv_field_validate');
                    return false;
                });
                log.debug('validatorDetails', JSON.stringify(validatorDetails));


                // Parse XML and convert to JSON here in Suitelet
                if (validatorDetails) {
                    var parsed = parseXMLtoJSON(validatorDetails, xml);
                    log.debug('Parsed Validators JSON', JSON.stringify(parsed));
                    return JSON.stringify(parsed);  // send JSON string to client
                }
                return '{}';
            } catch (e) {
                log.error('Error in getValidatorsForProfile', e);
                return '{}';
            }
        }

        function parseXMLtoJSON(xmlStr, xml) {
            var output = {};
            var doc = xml.Parser.fromString({ text: xmlStr });

            var fieldNodes = xml.XPath.select({
                node: doc,
                xpath: '//fieldValidator'
            });

            fieldNodes.forEach(function (fieldNode) {
                var fieldNameNodes = xml.XPath.select({
                    node: fieldNode,
                    xpath: 'fieldName/text()'
                });
                if (!fieldNameNodes || fieldNameNodes.length === 0) return;

                var fieldName = fieldNameNodes[0].nodeValue;
                // Only include custpage_ fields
                //if (!fieldName || fieldName.indexOf('custpage_') !== 0) return;

                output[fieldName] = {};

                var validators = xml.XPath.select({
                    node: fieldNode,
                    xpath: 'validatorList/validator'
                });

                validators.forEach(function (v) {
                    var type = v.getAttribute('type');
                    if (!type || type === 'custom') return;

                    output[fieldName][type] = {};

                    var params = xml.XPath.select({ node: v, xpath: 'param' });
                    params.forEach(function (p) {
                        var pName = p.getAttribute('name');
                        if (pName) output[fieldName][type][pName] = p.textContent;
                    });
                });

                // Remove if no valid rules
                if (Object.keys(output[fieldName]).length === 0) {
                    delete output[fieldName];
                }
            });

            return output;
        }

        function setValuesToFields(form, vbdRecordData, mandatoryFields) {
            try {
                // Set primary account checkbox
                var primaryfield = form.getField('custpage_bankdetails_primaryacc');
                var primaryValue = vbdRecordData["PRIMARY ACCOUNT"];
                if (primaryValue == true || primaryValue == 'T') primaryValue = 'T';
                else primaryValue = 'F';
                primaryfield.defaultValue = primaryValue;
                // Set vendor bill payment checkbox
                var vendorBillPaymentField = form.getField('custpage_vendor_bill_payment');
                var vendorBillPaymentValue = vbdRecordData["VENDOR BILL PAYMENT"];
                log.debug('vendorBillPaymentValue977', vendorBillPaymentValue);
                if (vendorBillPaymentValue == true || vendorBillPaymentValue == 'T') vendorBillPaymentValue = 'T';
                else vendorBillPaymentValue = 'F';
                if (vendorBillPaymentField) {
                    vendorBillPaymentField.defaultValue = vendorBillPaymentValue;
                }
                // ── ALWAYS handle the two conditional fields directly from record data ──
                // These may or may not appear in mandatoryFields depending on profile config,
                // so we handle them unconditionally here using the raw record values.
                var branchVal = vbdRecordData["BANK BRANCH NUMBER"];
                var instrVal = vbdRecordData["BANK INSTRUCTION CODE"];
                var routingId = vbdRecordData["ROUTING IDENTIFIER"];

                var hasBranch = (branchVal !== null && branchVal !== undefined && branchVal !== '');
                var hasInstr = (instrVal !== null && instrVal !== undefined && instrVal !== '');
                log.debug('hasBranch', hasBranch + ' hasInstr : ' + hasInstr);

                var modeField = form.getField('custpage_routing_identifier');
                if (modeField) {
                    // Derive mode from actual data if routingId wasn't saved correctly (legacy records)
                    if (routingId && (routingId === 'Bank Branch Number' || routingId === 'SWIFT / BIC')) {
                        modeField.defaultValue = routingId;
                    } else if (hasBranch && !hasInstr) {
                        // Fallback: infer mode from which field actually has a value
                        modeField.defaultValue = 'Bank Branch Number';
                    } else {
                        modeField.defaultValue = 'SWIFT / BIC';
                    }
                }
                // If somehow both have values (legacy data before the clear-on-save fix),
                // prefer instruction code since it is the more recently intended value.
                // After the save fix, only one will ever be non-empty.
                if (hasInstr) {
                    var instrField = form.getField('custpage_bank_instruction_code');
                    if (instrField) {
                        instrField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NORMAL });
                        instrField.defaultValue = instrVal;
                    }
                    var branchField = form.getField('custpage_bank_branch_number');
                    if (branchField) {
                        branchField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NODISPLAY });
                    }
                }
                if (hasBranch) {
                    var branchField = form.getField('custpage_bank_branch_number');
                    log.debug('branchField', branchField)
                    if (branchField) {
                        log.debug('branchField', branchField)
                        branchField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NORMAL });
                        branchField.defaultValue = branchVal;
                        log.debug(' set value ', 'for branch1032')

                    }
                    var instrField = form.getField('custpage_bank_instruction_code');
                    if (instrField) {
                        instrField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NODISPLAY });
                    }
                    // var modeField2 = form.getField('custpage_branch_instr_mode');
                    // if (modeField2) modeField2.defaultValue = 'branch'; // mirror data mode to dropdown
                }
                //removed else block because we are adding Routing identifier from JSON now - rag
                // ── END conditional fields ──
                // Note: this logic keeps branch/instruction data mapping while using one dropdown mode field.
                // Loop through remaining mandatory fields (skip the conditional ones — handled above)
                for (var k = 0; k < mandatoryFields.length; k++) {
                    var fieldName = mandatoryFields[k].fieldName;
                    // Skip checkbox fields handled explicitly above the loop to prevent raw boolean overwrite
                    if (fieldName === 'PRIMARY ACCOUNT' || fieldName === 'VENDOR BILL PAYMENT') { continue; }

                    var fieldId = getFieldIdMapped[fieldName];
                    log.debug('Setting values for : ', 'field name: ' + fieldName + ' field Id: ' + fieldId + ' value: ' + vbdRecordData[fieldName]);
                    var field = form.getField(fieldId);
                    var val = vbdRecordData[fieldName];
                    log.debug('Setting field value for ' + fieldName, val);

                    if (val !== '' && val !== null && val !== undefined) {
                        if (val === true || val === 'T') {
                            val = 'T';
                        } else if (val === false || val === 'F') {
                            val = 'F';
                        }
                    }
                    /* if(fieldName == "BANK ACCOUNT NUMBER")
                    {
                        val = maskAccountNumber(val);
                        log.debug('Masked Account Number', val);
                    } */
                    // if (val !== null && val !== undefined && val !== '') {
                    field.defaultValue = val;
                    field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NORMAL });
                    /* } else {
                        field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NODISPLAY });
                    } */
                }
                log.debug('setValuesToFields', 'Done setting values');
                return form;
            } catch (e) {
                log.error('Error in setValuesToFields', e);
            }
        }

        function maskAccountNumber(accountNumber) {
            var maskedPart = ''; const length = accountNumber.length;
            const visibleDigits = 4; // Show only the last 4 digits
            for (var loop1 = 0; loop1 < (length - visibleDigits); loop1++) { maskedPart = maskedPart + 'x'; }
            const visiblePart = accountNumber.slice(-visibleDigits);
            return maskedPart + visiblePart;
        }

        function getVbdRecordData(vbdExists) {
            try {
                log.audit('getVbdRecordData', 'Loading VBD record with ID: ' + vbdExists);
                var vbdRecordData;
                var vbdSearch = record.load({
                    type: 'customrecord_ci_adv_entity_bank_details',
                    id: vbdExists
                });

                log.debug('Date conversion ', 'Getting from VBD record');

                var DOB_Raw = vbdSearch.getValue('custrecord_cig_vbd_dob');
                log.debug('DOB_Raw', DOB_Raw + ' type of DOB_Raw:' + typeof DOB_Raw);
                var profileText = vbdSearch.getText('custrecord_ci_adv_profile_name');
                log.debug('profileText', profileText);
                //var isChequeProfile = (profileText.toUpperCase().indexOf('CHEQUE') !== -1);
                //log.debug('POST : isChequeProfile : ', isChequeProfile);
                vbdRecordData = {
                    "BANK ACCOUNT NAME": vbdSearch.getValue('custrecord_ci_adv_bank_acct_name'),
                    "BANK ACCOUNT NUMBER": vbdSearch.getValue('custrecord_ci_adv_account_number'),
                    "BANK BRANCH NUMBER": vbdSearch.getValue('custrecord_ci_adv_branch_number'),
                    "BANK NAME": vbdSearch.getValue('custrecord_ci_adv_bank_name'),
                    "CHEQUE NUMBER": vbdSearch.getValue('custrecord_ci_adv_cheque_number'),
                    "SPECIAL HANDLING CODE": vbdSearch.getValue('custrecord_ci_adv_spl_handl_code'),
                    "FORM CODE": vbdSearch.getValue('custrecord_ci_adv_form_code1'),
                    "RETURN ADDRESS LOGO": vbdSearch.getValue('custrecord_ci_adv_return_addr_logo1'),
                    "BANK INSTRUCTION CODE": vbdSearch.getValue('custrecord_ci_adv_bank_bic'),
                    // Added for 996 profile
                    "BANK ACCOUNT TYPE": vbdSearch.getValue('custrecord_ci_bank_acct_type'), // REMOVED - field hidden
                    // "BRANCH NAME": vbdSearch.getValue('custrecord_cig_vbd_branch_name'),
                    "BANK COUNTRY": vbdSearch.getValue('custrecord_ci_adv_vbd_bank_country'),
                    "BANK IBAN": vbdSearch.getValue('custrecord_ci_adv_vbd_bank_iban'),
                    // "BANK ADDRESS 1": vbdSearch.getValue('custrecord_cig_vbd_bank_address_1'),
                    /* "BANK ADDRESS 2": vbdSearch.getValue('custrecord_ci_adv_bank_addr2'), */ // REMOVED - field hidden
                    "VO BANK TYPE / PAYMENT MOTIVE CODE": vbdSearch.getValue('custrecord_cig_vbd_vo_bank_type_pm_code'),
                    //"INTERMEDIARY BIC": vbdSearch.getValue('custrecord_cig_vbd_intermediary_bic'),
                    //"INTERMEDIARY COUNTRY CODE": vbdSearch.getValue('custrecord_cig_vbd_interm_country_code'),
                    // "INTERMEDIARY BANK NAME": vbdSearch.getValue('custrecord_cig_vbd_interm_bank_name'),
                    // "INTERMEDIARY CITY": vbdSearch.getValue('custrecord_cig_vbd_intermediary_city'),
                    "FPS | BUSN NO | ORG NO | BLEI | CIG/CUP | UIN/UIP | FI | UEN | BILLER CODE | RECIPIENT REF": vbdSearch.getValue('custrecord_cig_vbd_fps_busn_org_bleii'),
                    "SCHEME NAME": vbdSearch.getValue('custrecord_ci_adv_scheme_name'),
                    "PAYMENT DETAILS": vbdSearch.getValue('custrecord_ci_adv_payment_details'),
                    "DOB": DOB_Raw,
                    //"DOB COUNTRY": vbdSearch.getValue('custrecord_cig_vbd_dob_country'),
                    "DOB CITY": vbdSearch.getValue('custrecord_cig_vbd_dob_city'),
                    "DELIVERY METHOD": vbdSearch.getValue('custrecord_ci_adv_delivery_methd'),

                    // "PROFILE ID": vbdSearch.getValue('custrecord_cig_vbd_profile_id'),
                    //"VENDOR ID": vbdSearch.getValue('custrecord_cig_vbd_vendor_id'),
                    "PRIMARY ACCOUNT": vbdSearch.getValue('custrecord_ci_adv_primary_account'),
                    "VENDOR BILL PAYMENT": vbdSearch.getValue('custrecord_ci_adv_vendor_bill_payment'),
                    "ROUTING IDENTIFIER": vbdSearch.getText('custrecord_ci_adv_routing_id_vb'),
                    "LOCAL INSTRUMENT CODE": vbdSearch.getValue('custrecord_ci_adv_local_intr_cd'),
                    "BANK CODE": vbdSearch.getValue('custrecord_ci_adv_bank_code'),
                    "PAYMENT DETAILS 1": vbdSearch.getValue('custrecord_ci_adv_email1'),
                    "PAYMENT DETAILS 2": vbdSearch.getValue('custrecord_ci_adv_email2'),
                    "PAYMENT DETAILS 3": vbdSearch.getValue('custrecord_ci_adv_email3'),
                    "PAYMENT DETAILS 4": vbdSearch.getValue('custrecord_ci_adv_email4'),
                    "REMITTANCE DELIVERY METHOD": vbdSearch.getValue('custrecord_ci_adv_remittance_chckbox'),
                    "NRIC NUMBER": vbdSearch.getValue('custrecord_ci_adv_nidn_num'),
                    "UEN NUMBER": vbdSearch.getValue('custrecord_ci_adv_coid_num'),
                    "VIRTUAL PAYMENT ADDRESS": vbdSearch.getValue('custrecord_ci_adv_vpad'),
                    "PAYMENT REASON": vbdSearch.getValue('custrecord_ci_adv_payment_reason'), //Umar has added on 23rd July 26
                    "AUSTRALIAN BUSINESS NUMBER": vbdSearch.getValue('custrecord_ci_adv_aus_bus_number'),
                    "CREDIT CLASSIFICATION": vbdSearch.getValue('custrecord_ci_adv_credit_classification'),
                    "TRANSACTION TYPE": vbdSearch.getValue('custrecord_ci_adv_transaction_type'),//Umar has added on 1st Sept 26
                    "ADD WHT DETAILS": vbdSearch.getValue('custrecord_ci_adv_wht_check'),
                    "WHT PAYOR CODE": vbdSearch.getValue('custrecord_ci_adv_bill_wht_payor_cd'),
                    "WHT TAX FORM": vbdSearch.getValue('custrecord_ci_adv_wht_tax_form_det'),
                    "WHT FORM DETAILS": vbdSearch.getValue('custrecord_ci_adv_wht_form_details'),
                    "ADDITIONAL LOGO": vbdSearch.getValue('custrecord_ci_adv_additional_logo'),
                    "SUPPLIER ACCOUNT NUMBER": vbdSearch.getValue('custrecord_ci_adv_supp_acct_number'),
                    "PAYMENT REASON NAME": vbdSearch.getValue('custrecord_ci_adv_payment_reason_name'),
                    "BANK INSTRUCTION 1": vbdSearch.getValue('custrecord_ci_adv_bank_inst1'),

                };
                return vbdRecordData;
            } catch (e) {
                log.error('Error in loading home page', e);
            }
        }

        /**
        * Adds all mandatory fields defined in the profile to the form, along with
        * the Primary Account checkbox and the Routing Identifier mode dropdown.
        */
        function addAllMandatoryFieldsToForm(form, mandatoryFields, isSepa, is996, is2PH, is4PH, is5PH, isNoRouting, action, isCheque, countryCode) {
            try {
                // add a field group for fields
                form.addFieldGroup({ id: 'custpage_field_group', label: ' ' });
                var primaryAccountCheck = form.addField({
                    id: 'custpage_bankdetails_primaryacc',
                    type: serverWidget.FieldType.CHECKBOX,
                    label: 'Primary Account',
                    container: 'custpage_field_group'
                });
                primaryAccountCheck.defaultValue = 'T';
                // primaryAccountCheck.defaultValue = 'Yes';

                for (var k = 0; k < mandatoryFields.length; k++) {
                    var fieldName = mandatoryFields[k].fieldName;
                    log.debug('Processing mandatory field:', fieldName);
                    var fieldType = mandatoryFields[k].fieldType;
                    log.debug("mandatoryFields :" + k, fieldName + ' ' + fieldType);
                    // log.debug("getFieldIdMapped :", getFieldIdMapped);

                    var fieldId = getFieldIdMapped[fieldName];
                    log.debug("form fieldId:", fieldId);
                    var condition = mandatoryFields[k].condition;
                    log.debug("condition:", condition);
                    // add field 
                    var NSFieldType;
                    if (fieldType.indexOf("Drop Down") != -1) {
                        NSFieldType = serverWidget.FieldType.SELECT;
                    }
                    else if (fieldType.indexOf("Text") != -1) {
                        NSFieldType = serverWidget.FieldType.TEXT;
                    }
                    else if (fieldType.indexOf("Date") != -1) {
                        NSFieldType = serverWidget.FieldType.DATE;
                    }
                    else if (fieldType.indexOf("CheckBox") != -1) {
                        NSFieldType = serverWidget.FieldType.CHECKBOX;
                    } else if (fieldType.indexOf("Email") != -1) {
                        NSFieldType = serverWidget.FieldType.EMAIL;
                    }
                    log.debug("NSFieldType:", NSFieldType);
                    var newField = form.addField({
                        id: fieldId,
                        type: NSFieldType,
                        label: fieldName,
                        container: 'custpage_field_group'
                    });
                    //Umar has added the below line on 17July to hide the field from the form.
                    //if(fieldId == 'custpage_email1' || fieldId == 'custpage_email2' || fieldId == 'custpage_email3' || fieldId == 'custpage_email4' || fieldId == 'custpage_delivery_method' ) newField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NODISPLAY });
                    // addd maxlength if specified : rag
                    if (mandatoryFields[k].maxLength) {
                        newField.maxLength = mandatoryFields[k].maxLength;
                    }
                    // set required if requirementtype is M : rag
                    if (mandatoryFields[k].requirementType === 'M') {
                        newField.isMandatory = true;
                    } else if (mandatoryFields[k].requirementType === 'C') {// will show once condition is met 
                        /* if (condition === 'checkBIC' && fieldName === 'BANK IBAN') {// 821 profile Umar Commented on 11th Sept 26
                            newField.isMandatory = true;
                        } else if (condition === 'checkBIC' && fieldName === 'BANK INSTRUCTION CODE') {
                            newField.isMandatory = true;
                        }
                        else {//for dynamic values */
                        newField.isMandatory = false;
                        newField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NODISPLAY });
                        //}
                    } else {// for Optional
                        newField.isMandatory = false;
                    }
                    // Add drop down values for each drop down field.
                    if (fieldType.indexOf("Drop Down") != -1) {
                        if (fieldName == "BANK ACCOUNT TYPE") {
                            /* REMOVED - BANK ACCOUNT TYPE is no longer rendered; block kept for reference */
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                type: 'customrecord_ci_adv_bk_acc_ty_lt',
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                        } else if (fieldName == "DELIVERY METHOD") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            // Start - Umar has added it up on 20 July 2026
                            //if (isCheque) recordType = 'customlist_ci_adv_delivery_channel_lt';
                            recordType = 'customrecord_ci_adv_delivery_method_lst';
                            //ENd - Umar has added it up on 20 July 2026 
                            search.create({
                                type: recordType,
                                filters: [["custrecord_ci_adv_del_mthd_country_code", "contains", countryCode]],
                                columns: ['name']
                            }).run().each(function (result) {
                                if (isCheque && result.getValue('name') === 'Email') { // Skip Email option for Cheque profiles
                                    return true;
                                }
                                else {
                                    newField.addSelectOption({
                                        value: result.id,
                                        text: result.getValue('name')
                                    });
                                    return true;
                                }
                            });
                            log.debug('added delivery method field')
                            if (!isCheque) newField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED });
                        }
                        else if (fieldName == "PAYMENT DETAILS") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                type: 'customrecord_ci_adv_payment_details_list',
                                filters: [["custrecord_ci_adv_country_code", "contains", countryCode],
                                    "AND",
                                ["isinactive", "is", "F"]], //countryCode
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                            log.debug('added Payment details field')
                        }
                        else if (fieldName == "SCHEME NAME") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                // type: 'customrecord_xor_native_schm_name_lt_sdf',
                                type: 'customrecord_ci_adv_schema_name_lst',
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                        } else if (fieldName == "VO BANK TYPE / PAYMENT MOTIVE CODE") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                type: 'customrecord_xor_native_vend_vocdlt_sdf',
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                        } else if (fieldName == "INTERMEDIARY COUNTRY CODE" || fieldName == "BANK COUNTRY" || fieldName == "DOB COUNTRY") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            // Add countries (text = name, value = internal ID)
                            for (var i = 0; i < arrcountry.length; i++) {
                                var iso = arrcountry[i][0];
                                var id = arrcountry[i][1];
                                var countryName = getCountryName(iso);
                                newField.addSelectOption({
                                    value: id,
                                    text: countryName
                                });
                            }
                        }// 996 field update 4/29 by rag
                        else if (fieldName == "LOCAL INSTRUMENT CODE") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                type: 'customlist_ci_adv_local_intr_cd',
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                            // Profile-driven LOCAL INSTRUMENT CODE defaults (locked):
                            //   2PH => CCD (id=2) | 4PH => PPP (id=1) | 5PH => CTX (id=3)
                            var licDefault = null;
                            if (is2PH) { licDefault = '2'; } // CCD
                            else if (is4PH) { licDefault = '1'; } // PPP
                            else if (is5PH) { licDefault = '3'; } // CTX

                            if (licDefault) {
                                newField.defaultValue = licDefault;
                                newField.updateDisplayType({
                                    displayType: serverWidget.FieldDisplayType.DISABLED
                                });
                                log.debug('PH profile LIC default', 'Profile defaulted LOCAL INSTRUMENT CODE to id=' + licDefault + ' and disabled');
                            }
                        }
                        // added routing Identifier dd 
                        else if (fieldName == "ROUTING IDENTIFIER") {
                            newField.addSelectOption({ value: 'Bank Branch Number', text: 'Bank Branch Number' });
                            newField.addSelectOption({ value: 'SWIFT / BIC', text: 'SWIFT / BIC' });

                            // Set default value for Routing Identifier based on action and profile defaults - bug fix - 07/03/2026
                            if (action === 'create' && mandatoryFields[k].defaultValue) {
                                newField.defaultValue = mandatoryFields[k].defaultValue;
                            } else if (action === 'create') {
                                newField.defaultValue = 'SWIFT / BIC';
                            }

                            //get BIC field and set Normal
                            var BICField = form.getField(getFieldIdMapped['BANK INSTRUCTION CODE']);
                            log.debug('BICField', BICField + ' condition: ' + condition);
                            if (BICField) {
                                log.debug('1311');
                                BICField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NORMAL });
                                // if condition is BIC available and field is also added

                            }

                            //and hide branch number field.
                        } else if (fieldName == "CREDIT CLASSIFICATION") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                type: 'customlist_ci_adv_crdt_list',
                                filters: [],
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                            log.debug('added Payment details field')
                        } else if (fieldName == "TRANSACTION TYPE") { // Umar has added on 1st Sep 26
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                type: 'customlist_ci_adv_instructionfordebtor',
                                filters: [],
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                            log.debug('added Payment details field')
                        } else if (fieldName == "WHT PAYOR CODE") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                type: 'customrecord_ci_adv_wht_payor_code_list',
                                filters: [],
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                            log.debug('added Payment details field')
                        } else if (fieldName == "WHT TAX FORM") {
                            newField.addSelectOption({ value: '', text: '--Select--' });
                            search.create({
                                type: 'customrecord_ci_adv_wht_tax_form_list',
                                filters: [],
                                columns: ['name']
                            }).run().each(function (result) {
                                newField.addSelectOption({
                                    value: result.id,
                                    text: result.getValue('name')
                                });
                                return true;
                            });
                            log.debug('added Payment details field')
                        }

                    }


                }// for

                /*   if (isNoRouting) {
                        branchInstructionMode.updateDisplayType({
                            displayType: serverWidget.FieldDisplayType.HIDDEN
                        });
                    } */

                return form;

            } catch (e) {
                log.error('Error addAllMandatoryFieldsToForm', e);
            }
        }

        /**
         * Returns true if the given profile's name contains 'SEPA' (case-insensitive).
         */
        function isSepaProfile(profileValue) {
            if (!profileValue) return false;
            try {
                var profileName = '';
                search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [['internalid', 'is', profileValue]],
                    columns: ['name']
                }).run().each(function (result) {
                    profileName = result.getValue('name') || '';
                    return false;
                });
                log.debug('isSepaProfile', 'profileName: ' + profileName);
                return profileName.toUpperCase().indexOf('SEPA') !== -1;
            } catch (e) {
                log.error('isSepaProfile error', e);
                return false; // safe fallback — don't crash the page
            }
        }

        function isNoRoutingProfile(profileValue) {
            if (!profileValue) return false;
            try {
                var profileName = '';
                search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [['internalid', 'is', profileValue]],
                    columns: ['name']
                }).run().each(function (result) {
                    profileName = result.getValue('name') || '';
                    return false;
                });
                profileName = profileName.toUpperCase();
                return (
                    profileName.indexOf('116') !== -1 ||
                    profileName.indexOf('585') !== -1 || profileName.indexOf('19') !== -1
                );
            } catch (e) {
                log.error('isNoRoutingProfile error', e);
                return false;
            }
        }

        /**
         * Returns true if the given profile's name contains '996' (US ACH 996 profile).
         */
        function isUs996Profile(profileValue) {
            if (!profileValue) return false;
            try {
                var profileName = '';
                search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [['internalid', 'is', profileValue]],
                    columns: ['name']
                }).run().each(function (result) {
                    profileName = result.getValue('name') || '';
                    return false;
                });
                log.debug('isUs996Profile', 'profileName: ' + profileName);
                return profileName.toUpperCase().indexOf('996') !== -1 || profileName.toUpperCase().indexOf('US ACH CCD+ - 2') !== -1 || profileName.toUpperCase().indexOf('US ACH PPD+ - 4') !== -1 || profileName.toUpperCase().indexOf('US ACH CTX - 5') !== -1 || profileName.toUpperCase().indexOf('ACH') !== -1;
            } catch (e) {
                log.error('isUs996Profile error', e);
                return false;
            }
        }

        /**
        * Returns true if the given profile's name contains Cheque.
        */
        function isChequeProfile(profileValue) {
            if (!profileValue) return false;
            try {
                var profileName = '';
                search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [['internalid', 'is', profileValue]],
                    columns: ['name']
                }).run().each(function (result) {
                    profileName = result.getValue('name') || '';
                    return false;
                });
                log.debug('isChequeProfile', 'profileName: ' + profileName);
                var ischk = (profileName.toUpperCase().indexOf('CHEQUE') !== -1 || profileName.toUpperCase().indexOf('CHECK') !== -1)
                return ischk;
            } catch (e) {
                log.error('isChequeProfile error', e);
                return false;
            }
        }

        /**
         * Returns true if the given profile's name contains '2PH'.
         */
        function is2PHProfile(profileValue) {
            if (!profileValue) return false;
            try {
                var profileName = '';
                search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [['internalid', 'is', profileValue]],
                    columns: ['name']
                }).run().each(function (result) {
                    profileName = result.getValue('name') || '';
                    return false;
                });
                log.debug('is2PHProfile', 'profileName: ' + profileName);
                return profileName.toUpperCase().indexOf('US ACH CCD+ - 2') !== -1;
            } catch (e) {
                log.error('is2PHProfile error', e);
                return false;
            }
        }

        /**
         * Returns true if the given profile's name contains '4PH'.
         */
        function is4PHProfile(profileValue) {
            if (!profileValue) return false;
            try {
                var profileName = '';
                search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [['internalid', 'is', profileValue]],
                    columns: ['name']
                }).run().each(function (result) {
                    profileName = result.getValue('name') || '';
                    return false;
                });
                log.debug('is4PHProfile', 'profileName: ' + profileName);
                return profileName.toUpperCase().indexOf('US ACH PPD+ - 4') !== -1;
            } catch (e) {
                log.error('is4PHProfile error', e);
                return false;
            }
        }

        /**
         * Returns true if the given profile's name contains '5PH'.
         */
        function is5PHProfile(profileValue) {
            if (!profileValue) return false;
            try {
                var profileName = '';
                search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [['internalid', 'is', profileValue]],
                    columns: ['name']
                }).run().each(function (result) {
                    profileName = result.getValue('name') || '';
                    return false;
                });
                log.debug('is5PHProfile', 'profileName: ' + profileName);
                return profileName.toUpperCase().indexOf('US ACH CTX - 5') !== -1;
            } catch (e) {
                log.error('is5PHProfile error', e);
                return false;
            }
        }

        /**
         * Reads the profile JSON and returns an array of mandatory fields
         * ({ fieldName, fieldType }) for the given profile.
         */
        function getMandatoryFields(profileValue) {
            try {
                var mandatoryFields = [];
                var profileJson;
                var profileSearch = search.create({
                    type: 'customrecord_ci_adv_pros_profile',
                    filters: [
                        ['internalid', 'is', profileValue]
                    ],
                    columns: ['custrecord_ci_adv_profile_json']
                });

                profileSearch.run().each(function (result) {
                    profileJson = result.getValue('custrecord_ci_adv_profile_json');
                    return true;
                });
                if (profileJson) {
                    profileJson = JSON.parse(profileJson);
                    log.debug("profileJson:", profileJson);
                    log.debug("profileJson1:", profileJson.fieldDetails);
                    mandatoryFields = profileJson.fieldDetails;
                    // Loop through each field in the group
                    /*  for (var j = 0; j < profileJson.fieldDetails.length; j++) {
                            var field = profileJson.fieldDetails[j];
                            // Check if the field is mandatory
                            if (field.requirementType === 'M') {
                                var obj = {};
                                obj.fieldName = field.fieldName;
                                obj.fieldType = field.fieldType;
                                mandatoryFields.push(obj);
                            }
                        }*/
                }
                log.debug("mandatoryFields:", mandatoryFields);
                // console.log('Mandatory Fields:', JSON.stringify(mandatoryFields));
                return mandatoryFields;

            } catch (e) {
                log.error('Error getMandatoryFields', e);
            }
        }

        /**
         * Returns a map of human-readable field labels to their custpage_ field IDs.
         * Fields marked REMOVED are kept for data-integrity reference but are not
         * rendered in the UI.
         */
        function getFieldsMapping() {
            var fieldMapObj = {
                "BANK ACCOUNT NAME": "custpage_bank_account_name",           // REMOVED from UI (kept in mapping for data integrity)
                "BANK ACCOUNT NUMBER": "custpage_bank_account_number",
                "BANK BRANCH NUMBER": "custpage_bank_branch_number",
                "BANK NAME": "custpage_bank_name",
                "CHEQUE NUMBER": "custpage_cheque_number",
                "SPECIAL HANDLING CODE": "custpage_special_handling_code",
                "FORM CODE": "custpage_form_code",
                "RETURN ADDRESS LOGO": "custpage_return_address_logo",
                "BANK INSTRUCTION CODE": "custpage_bank_instruction_code",
                //added for 996 profile
                "BANK ACCOUNT TYPE": "custpage_bank_account_type",            // REMOVED from UI (kept in mapping for data integrity)
                "BRANCH NAME": "custpage_branch_name",
                "BANK COUNTRY": "custpage_bank_country",
                "BANK IBAN": "custpage_bank_iban",
                "BANK ADDRESS 1": "custpage_bank_address_1",
                "BANK ADDRESS 2": "custpage_bank_address_2",                  // REMOVED from UI (kept in mapping for data integrity)
                "VO BANK TYPE / PAYMENT MOTIVE CODE": "custpage_vo_bank_type",
                "INTERMEDIARY BIC": "custpage_intermediary_bic",
                "INTERMEDIARY COUNTRY CODE": "custpage_intermediary_country_code",
                "INTERMEDIARY BANK NAME": "custpage_intermediary_bank_name",
                "INTERMEDIARY CITY": "custpage_intermediary_city",
                "FPS | BUSN NO | ORG NO | BLEI | CIG/CUP | UIN/UIP | FI | UEN | BILLER CODE | RECIPIENT REF": "custpage_fps_busn_no_ref",
                "SCHEME NAME": "custpage_scheme_name",
                "DOB": "custpage_dob",
                "DOB COUNTRY": "custpage_dob_country",
                "DOB CITY": "custpage_dob_city",
                "DELIVERY METHOD": "custpage_delivery_method",
                "PAYMENT DETAILS": "custpage_payment_details",
                "REMITTANCE DELIVERY METHOD": "custpage_rem_del_method",
                "PROFILE ID": "custpage_profile",
                "VENDOR ID": "custpage_vendor",
                "PRIMARY ACCOUNT": "custpage_bankdetails_primaryacc",
                "LOCAL INSTRUMENT CODE": "custpage_local_instrument_code",// 996 field update 4/29 by rag
                "ROUTING IDENTIFIER": "custpage_routing_identifier",
                "BANK CODE": "custpage_bank_code",
                "PAYMENT DETAILS 1": "custpage_email1",//"custrecord_ci_adv_email1",
                "PAYMENT DETAILS 2": "custpage_email2",//"custrecord_ci_adv_email2" ,
                "PAYMENT DETAILS 3": "custpage_email3",// "custrecord_ci_adv_email3" ,
                "PAYMENT DETAILS 4": "custpage_email4",//"custrecord_ci_adv_email4"  
                "VENDOR BILL PAYMENT": "custpage_vendor_bill_payment",
                "NRIC NUMBER": "custpage_nidn_num",
                "UEN NUMBER": "custpage_coid_num",
                "VIRTUAL PAYMENT ADDRESS": "custpage_vpad_num",
                "PAYMENT REASON": "custpage_payment_reason",//"custrecord_ci_adv_payment_reason"
                "AUSTRALIAN BUSINESS NUMBER": "custpage_australian_business_number",
                "CREDIT CLASSIFICATION": "custpage_credit_classification",
                "TRANSACTION TYPE": "custpage_transaction_type",// Umar has added on 1st Sept 26
                "ADD WHT DETAILS": "custpage_wht_chk",
                "WHT PAYOR CODE": "custpage_wht_payor_code",
                "WHT TAX FORM": "custpage_wht_tax_form",
                "WHT FORM DETAILS": "custpage_wht_form_details",
                "ADDITIONAL LOGO": "custpage_additional_logo",
                "SUPPLIER ACCOUNT NUMBER": "custpage_supplier_account_number",
                "PAYMENT REASON NAME": "custpage_payment_reason_name",
                "BANK INSTRUCTION 1": "custpage_bank_instruction_1"

            };
            return fieldMapObj;
        }

        /**
         * Returns the display name for a given ISO 3166-1 alpha-2 country code.
         * Falls back to the raw code if the country is not in the map.
         */
        function getCountryName(isoCode) {
            var names = {
                'AF': 'Afghanistan', 'AX': 'Åland Islands', 'AL': 'Albania', 'DZ': 'Algeria', 'AS': 'American Samoa', 'AD': 'Andorra',
                'AO': 'Angola', 'AI': 'Anguilla', 'AQ': 'Antarctica', 'AG': 'Antigua and Barbuda', 'AR': 'Argentina', 'AM': 'Armenia', 'AW': 'Aruba',
                'AU': 'Australia', 'AT': 'Austria', 'AZ': 'Azerbaijan', 'BS': 'Bahamas', 'BH': 'Bahrain', 'BD': 'Bangladesh', 'BB': 'Barbados', 'BY': 'Belarus',
                'BE': 'Belgium', 'BZ': 'Belize', 'BJ': 'Benin', 'BM': 'Bermuda', 'BT': 'Bhutan', 'BO': 'Bolivia', 'BA': 'Bosnia and Herzegovina',
                'BW': 'Botswana', 'BV': 'Bouvet Island', 'BR': 'Brazil', 'IO': 'British Indian Ocean Territory', 'BN': 'Brunei Darussalam',
                'BG': 'Bulgaria', 'BF': 'Burkina Faso', 'BI': 'Burundi', 'KH': 'Cambodia', 'CM': 'Cameroon', 'CA': 'Canada', 'CV': 'Cape Verde',
                'KY': 'Cayman Islands', 'CF': 'Central African Republic', 'TD': 'Chad', 'CL': 'Chile', 'CN': 'China', 'CX': 'Christmas Island',
                'CC': 'Cocos (Keeling) Islands', 'CO': 'Colombia', 'KM': 'Comoros', 'CD': 'Congo (Democratic Republic)', 'CG': 'Congo (Republic)',
                'CK': 'Cook Islands', 'CR': 'Costa Rica', 'CI': 'Côte d’Ivoire', 'HR': 'Croatia', 'CU': 'Cuba', 'CY': 'Cyprus', 'CZ': 'Czech Republic',
                'DK': 'Denmark', 'DJ': 'Djibouti', 'DM': 'Dominica', 'DO': 'Dominican Republic', 'EC': 'Ecuador', 'EG': 'Egypt', 'SV': 'El Salvador',
                'GQ': 'Equatorial Guinea', 'ER': 'Eritrea', 'EE': 'Estonia', 'ET': 'Ethiopia', 'FK': 'Falkland Islands (Malvinas)', 'FO': 'Faroe Islands',
                'FJ': 'Fiji', 'FI': 'Finland', 'FR': 'France', 'GF': 'French Guiana', 'PF': 'French Polynesia', 'TF': 'French Southern Territories',
                'GA': 'Gabon', 'GM': 'Gambia', 'GE': 'Georgia', 'DE': 'Germany', 'GH': 'Ghana', 'GI': 'Gibraltar', 'GR': 'Greece', 'GL': 'Greenland',
                'GD': 'Grenada', 'GP': 'Guadeloupe', 'GU': 'Guam', 'GT': 'Guatemala', 'GG': 'Guernsey', 'GN': 'Guinea', 'GW': 'Guinea-Bissau',
                'GY': 'Guyana', 'HT': 'Haiti', 'HM': 'Heard Island and McDonald Islands', 'VA': 'Holy See (Vatican City)', 'HN': 'Honduras',
                'HK': 'Hong Kong', 'HU': 'Hungary', 'IS': 'Iceland', 'IN': 'India', 'ID': 'Indonesia', 'IR': 'Iran', 'IQ': 'Iraq', 'IE': 'Ireland',
                'IM': 'Isle of Man', 'IL': 'Israel', 'IT': 'Italy', 'JM': 'Jamaica', 'JP': 'Japan', 'JE': 'Jersey', 'JO': 'Jordan', 'KZ': 'Kazakhstan',
                'KE': 'Kenya', 'KI': 'Kiribati', 'KP': 'North Korea', 'KR': 'South Korea', 'KW': 'Kuwait', 'KG': 'Kyrgyzstan', 'LA': 'Laos', 'LV': 'Latvia',
                'LB': 'Lebanon', 'LS': 'Lesotho', 'LR': 'Liberia', 'LY': 'Libya', 'LI': 'Liechtenstein', 'LT': 'Lithuania', 'LU': 'Luxembourg', 'MO': 'Macao',
                'MK': 'North Macedonia', 'MG': 'Madagascar', 'MW': 'Malawi', 'MY': 'Malaysia', 'MV': 'Maldives', 'ML': 'Mali', 'MT': 'Malta',
                'MH': 'Marshall Islands', 'MQ': 'Martinique', 'MR': 'Mauritania', 'MU': 'Mauritius', 'YT': 'Mayotte', 'MX': 'Mexico', 'FM': 'Micronesia',
                'MD': 'Moldova', 'MC': 'Monaco', 'MN': 'Mongolia', 'ME': 'Montenegro', 'MS': 'Montserrat', 'MA': 'Morocco', 'MZ': 'Mozambique',
                'MM': 'Myanmar (Burma)', 'NA': 'Namibia', 'NR': 'Nauru', 'NP': 'Nepal', 'NL': 'Netherlands', 'NC': 'New Caledonia', 'NZ': 'New Zealand',
                'NI': 'Nicaragua', 'NE': 'Niger', 'NG': 'Nigeria', 'NU': 'Niue', 'NF': 'Norfolk Island', 'MP': 'Northern Mariana Islands',
                'NO': 'Norway', 'OM': 'Oman', 'PK': 'Pakistan', 'PW': 'Palau', 'PS': 'Palestine, State of', 'PA': 'Panama', 'PG': 'Papua New Guinea',
                'PY': 'Paraguay', 'PE': 'Peru', 'PH': 'Philippines', 'PN': 'Pitcairn', 'PL': 'Poland', 'PT': 'Portugal', 'PR': 'Puerto Rico', 'QA': 'Qatar',
                'RE': 'Réunion', 'RO': 'Romania', 'RU': 'Russia', 'RW': 'Rwanda', 'BL': 'Saint Barthélemy', 'SH': 'Saint Helena',
                'KN': 'Saint Kitts and Nevis', 'LC': 'Saint Lucia', 'MF': 'Saint Martin (French part)', 'VC': 'Saint Vincent and the Grenadines',
                'WS': 'Samoa', 'SM': 'San Marino', 'ST': 'Sao Tome and Principe', 'SA': 'Saudi Arabia', 'SN': 'Senegal', 'RS': 'Serbia', 'SC': 'Seychelles',
                'SL': 'Sierra Leone', 'SG': 'Singapore', 'SK': 'Slovakia', 'SI': 'Slovenia', 'SB': 'Solomon Islands', 'SO': 'Somalia', 'ZA': 'South Africa',
                'ES': 'Spain', 'LK': 'Sri Lanka', 'SD': 'Sudan', 'SR': 'Suriname', 'SZ': 'Eswatini (Swaziland)', 'SE': 'Sweden', 'CH': 'Switzerland',
                'SY': 'Syria', 'TW': 'Taiwan', 'TJ': 'Tajikistan', 'TZ': 'Tanzania', 'TH': 'Thailand', 'TG': 'Togo', 'TK': 'Tokelau', 'TO': 'Tonga',
                'TT': 'Trinidad and Tobago', 'TN': 'Tunisia', 'TR': 'Turkey', 'TM': 'Turkmenistan', 'TC': 'Turks and Caicos Islands', 'TV': 'Tuvalu',
                'UG': 'Uganda', 'UA': 'Ukraine', 'AE': 'United Arab Emirates', 'GB': 'United Kingdom', 'US': 'United States', 'UY': 'Uruguay',
                'UZ': 'Uzbekistan', 'VU': 'Vanuatu', 'VE': 'Venezuela', 'VN': 'Vietnam', 'VG': 'Virgin Islands (British)', 'VI': 'Virgin Islands (U.S.)',
                'WF': 'Wallis and Futuna', 'EH': 'Western Sahara', 'YE': 'Yemen', 'ZM': 'Zambia', 'ZW': 'Zimbabwe'
            };

            return names[isoCode] || isoCode;
        }

        /**
        * Returns a two-dimensional array mapping ISO country codes to NetSuite
        * internal country IDs. Used to populate country dropdown fields.
        */
        function createArrayCountry() {
            var arrcountry = new Array();
            arrcountry[0] = new Array("AF", 3); arrcountry[1] = new Array("AX", 247); arrcountry[2] = new Array("AL", 6);
            arrcountry[3] = new Array("DZ", 62); arrcountry[4] = new Array("AS", 12); arrcountry[5] = new Array("AD", 1);
            arrcountry[6] = new Array("AO", 9); arrcountry[7] = new Array("AI", 5); arrcountry[8] = new Array("AQ", 10);
            arrcountry[9] = new Array("AG", 4); arrcountry[10] = new Array("AR", 11); arrcountry[11] = new Array("AM", 7);
            arrcountry[12] = new Array("AW", 15); arrcountry[13] = new Array("AU", 14); arrcountry[14] = new Array("AT", 13);
            arrcountry[15] = new Array("AZ", 16); arrcountry[16] = new Array("BS", 31); arrcountry[17] = new Array("BH", 23);
            arrcountry[18] = new Array("BD", 19); arrcountry[19] = new Array("BB", 18); arrcountry[20] = new Array("BY", 35);
            arrcountry[21] = new Array("BE", 20); arrcountry[22] = new Array("BZ", 36); arrcountry[23] = new Array("BJ", 25);
            arrcountry[24] = new Array("BM", 27); arrcountry[25] = new Array("BT", 32); arrcountry[26] = new Array("BO", 29);
            arrcountry[27] = new Array("BA", 27); arrcountry[28] = new Array("BW", 34); arrcountry[29] = new Array("BV", 33);
            arrcountry[30] = new Array("BR", 30); arrcountry[31] = new Array("IO", 106); arrcountry[32] = new Array("BN", 28);
            arrcountry[33] = new Array("BG", 22); arrcountry[34] = new Array("BF", 21); arrcountry[35] = new Array("BI", 24);
            arrcountry[36] = new Array("KH", 117); arrcountry[37] = new Array("CM", 46); arrcountry[38] = new Array("CA", 37);
            arrcountry[39] = new Array("IC", 249); arrcountry[40] = new Array("CV", 53); arrcountry[41] = new Array("KY", 124);
            arrcountry[42] = new Array("CF", 40); arrcountry[43] = new Array("EA", 248); arrcountry[44] = new Array("TD", 212);
            arrcountry[45] = new Array("CL", 45); arrcountry[46] = new Array("CN", 47); arrcountry[47] = new Array("CX", 54);
            arrcountry[48] = new Array("CC", 38); arrcountry[49] = new Array("CO", 48); arrcountry[50] = new Array("KM", 119);
            arrcountry[51] = new Array("CD", 39); arrcountry[52] = new Array("CG", 41); arrcountry[53] = new Array("CK", 44);
            arrcountry[54] = new Array("CR", 49); arrcountry[55] = new Array("CI", 43); arrcountry[56] = new Array("HR", 98);
            arrcountry[57] = new Array("CU", 52); arrcountry[58] = new Array("CY", 55); arrcountry[59] = new Array("CZ", 56);
            arrcountry[60] = new Array("DK", 59); arrcountry[61] = new Array("DJ", 58); arrcountry[62] = new Array("DM", 60);
            arrcountry[63] = new Array("DO", 61); arrcountry[64] = new Array("TP", 221); arrcountry[65] = new Array("EC", 63);
            arrcountry[66] = new Array("EG", 65); arrcountry[67] = new Array("SV", 208); arrcountry[68] = new Array("GQ", 88);
            arrcountry[69] = new Array("ER", 67); arrcountry[70] = new Array("EE", 64); arrcountry[71] = new Array("ET", 69);
            arrcountry[72] = new Array("FK", 72); arrcountry[73] = new Array("FO", 74); arrcountry[74] = new Array("FJ", 71);
            arrcountry[75] = new Array("FI", 70); arrcountry[76] = new Array("FR", 75); arrcountry[77] = new Array("GF", 80);
            arrcountry[78] = new Array("PF", 175); arrcountry[79] = new Array("TF", 213); arrcountry[80] = new Array("GA", 76);
            arrcountry[81] = new Array("GM", 85); arrcountry[82] = new Array("GE", 79); arrcountry[83] = new Array("DE", 57);
            arrcountry[84] = new Array("GH", 82); arrcountry[85] = new Array("GI", 83); arrcountry[86] = new Array("GR", 89);
            arrcountry[87] = new Array("GL", 84); arrcountry[88] = new Array("GD", 78); arrcountry[89] = new Array("GP", 87);
            arrcountry[90] = new Array("GU", 92); arrcountry[91] = new Array("GT", 91); arrcountry[92] = new Array("GG", 81);
            arrcountry[93] = new Array("GN", 86); arrcountry[94] = new Array("GW", 93); arrcountry[95] = new Array("GY", 94);
            arrcountry[96] = new Array("HT", 99); arrcountry[97] = new Array("HM", 96); arrcountry[98] = new Array("VA", 233);
            arrcountry[99] = new Array("HN", 97); arrcountry[100] = new Array("HK", 95); arrcountry[101] = new Array("HU", 100);
            arrcountry[102] = new Array("IS", 109); arrcountry[103] = new Array("IN", 105); arrcountry[104] = new Array("ID", 101);
            arrcountry[105] = new Array("IR", 108); arrcountry[106] = new Array("IQ", 107); arrcountry[107] = new Array("IE", 102);
            arrcountry[108] = new Array("IM", 104); arrcountry[109] = new Array("IL", 103); arrcountry[110] = new Array("IT", 110);
            arrcountry[111] = new Array("JM", 112); arrcountry[112] = new Array("JP", 114); arrcountry[113] = new Array("JE", 111);
            arrcountry[114] = new Array("JO", 113); arrcountry[115] = new Array("KZ", 125); arrcountry[116] = new Array("KE", 115);
            arrcountry[117] = new Array("KI", 118); arrcountry[118] = new Array("KP", 121); arrcountry[119] = new Array("KR", 122);
            arrcountry[120] = new Array("KW", 123); arrcountry[121] = new Array("KG", 116); arrcountry[122] = new Array("LA", 126);
            arrcountry[123] = new Array("LV", 135); arrcountry[124] = new Array("LB", 127); arrcountry[125] = new Array("LS", 132);
            arrcountry[126] = new Array("LR", 131); arrcountry[127] = new Array("LY", 136); arrcountry[128] = new Array("LI", 129);
            arrcountry[129] = new Array("LT", 133); arrcountry[130] = new Array("LU", 134); arrcountry[131] = new Array("MO", 148);
            arrcountry[132] = new Array("MK", 144); arrcountry[133] = new Array("MG", 142); arrcountry[134] = new Array("MW", 156);
            arrcountry[135] = new Array("MY", 158); arrcountry[136] = new Array("MV", 155); arrcountry[137] = new Array("ML", 145);
            arrcountry[138] = new Array("MT", 153); arrcountry[139] = new Array("MH", 143); arrcountry[140] = new Array("MQ", 150);
            arrcountry[141] = new Array("MR", 151); arrcountry[142] = new Array("MU", 154); arrcountry[143] = new Array("YT", 243);
            arrcountry[144] = new Array("MX", 157); arrcountry[145] = new Array("FM", 73); arrcountry[146] = new Array("MD", 139);
            arrcountry[147] = new Array("MC", 138); arrcountry[148] = new Array("MN", 147); arrcountry[149] = new Array("ME", 140);
            arrcountry[150] = new Array("MS", 152); arrcountry[151] = new Array("MA", 137); arrcountry[152] = new Array("MZ", 159);
            arrcountry[153] = new Array("MM", 146); arrcountry[154] = new Array("NA", 160); arrcountry[155] = new Array("NR", 169);
            arrcountry[156] = new Array("NP", 168); arrcountry[157] = new Array("NL", 166); arrcountry[158] = new Array("AN", 8);
            arrcountry[159] = new Array("NC", 161); arrcountry[160] = new Array("NZ", 171); arrcountry[161] = new Array("NI", 165);
            arrcountry[162] = new Array("NE", 162); arrcountry[163] = new Array("NG", 164); arrcountry[164] = new Array("NU", 170);
            arrcountry[165] = new Array("NF", 163); arrcountry[166] = new Array("MP", 149); arrcountry[167] = new Array("NO", 167);
            arrcountry[168] = new Array("OM", 172); arrcountry[169] = new Array("PK", 178); arrcountry[170] = new Array("PW", 185);
            arrcountry[171] = new Array("PS", 183); arrcountry[172] = new Array("PA", 173); arrcountry[173] = new Array("PG", 176);
            arrcountry[174] = new Array("PY", 186); arrcountry[175] = new Array("PE", 174); arrcountry[176] = new Array("PH", 177);
            arrcountry[177] = new Array("PN", 181); arrcountry[178] = new Array("PL", 179); arrcountry[179] = new Array("PT", 184);
            arrcountry[180] = new Array("PR", 182); arrcountry[181] = new Array("QA", 187); arrcountry[182] = new Array("RE", 188);
            arrcountry[183] = new Array("RO", 189); arrcountry[184] = new Array("RU", 190); arrcountry[185] = new Array("RW", 191);
            arrcountry[186] = new Array("BL", 26); arrcountry[187] = new Array("SH", 198); arrcountry[188] = new Array("KN", 120);
            arrcountry[189] = new Array("LC", 128); arrcountry[190] = new Array("MF", 141); arrcountry[191] = new Array("VC", 234);
            arrcountry[192] = new Array("WS", 241); arrcountry[193] = new Array("SM", 203); arrcountry[194] = new Array("ST", 207);
            arrcountry[195] = new Array("SA", 192); arrcountry[196] = new Array("SN", 204); arrcountry[197] = new Array("RS", 50);
            arrcountry[198] = new Array("CS", 51); arrcountry[199] = new Array("SC", 194); arrcountry[200] = new Array("SL", 202);
            arrcountry[201] = new Array("SG", 197); arrcountry[202] = new Array("SK", 201); arrcountry[203] = new Array("SI", 199);
            arrcountry[204] = new Array("SB", 193); arrcountry[205] = new Array("SO", 205); arrcountry[206] = new Array("ZA", 244);
            arrcountry[207] = new Array("GS", 90); arrcountry[208] = new Array("ES", 68); arrcountry[209] = new Array("LK", 130);
            arrcountry[210] = new Array("PM", 180); arrcountry[211] = new Array("SD", 195); arrcountry[212] = new Array("SR", 206);
            arrcountry[213] = new Array("SJ", 200); arrcountry[214] = new Array("SZ", 210); arrcountry[215] = new Array("SE", 196);
            arrcountry[216] = new Array("CH", 42); arrcountry[217] = new Array("SY", 209); arrcountry[218] = new Array("TW", 225);
            arrcountry[219] = new Array("TJ", 216); arrcountry[220] = new Array("TZ", 226); arrcountry[221] = new Array("TH", 215);
            arrcountry[222] = new Array("TG", 214); arrcountry[223] = new Array("TK", 217); arrcountry[224] = new Array("TO", 220);
            arrcountry[225] = new Array("TT", 223); arrcountry[226] = new Array("TN", 219); arrcountry[227] = new Array("TR", 222);
            arrcountry[228] = new Array("TM", 218); arrcountry[229] = new Array("TC", 211); arrcountry[230] = new Array("TV", 224);
            arrcountry[231] = new Array("UG", 228); arrcountry[232] = new Array("UA", 227); arrcountry[233] = new Array("AE", 2);
            arrcountry[234] = new Array("GB", 77); arrcountry[235] = new Array("US", 230); arrcountry[236] = new Array("UY", 231);
            arrcountry[237] = new Array("UM", 229); arrcountry[238] = new Array("UZ", 232); arrcountry[239] = new Array("VU", 239);
            arrcountry[240] = new Array("VE", 235); arrcountry[241] = new Array("VN", 238); arrcountry[242] = new Array("VG", 236);
            arrcountry[243] = new Array("VI", 237); arrcountry[244] = new Array("WF", 240); arrcountry[245] = new Array("EH", 66);
            arrcountry[246] = new Array("YE", 242); arrcountry[247] = new Array("ZM", 245); arrcountry[248] = new Array("ZW", 246);
            return arrcountry;
        }

        /**
        * Returns true if the value is null, undefined, empty string, empty array,
        * or empty object.
        */
        function isEmpty(stValue) {
            return ((stValue === '' || stValue === null || stValue === undefined) || (stValue.constructor === Array && stValue.length == 0) || (stValue.constructor === Object && (function (v) { for (var k in v) return false; return true; })(stValue)));
        }

        return {
            onRequest: onRequest
        };
    });