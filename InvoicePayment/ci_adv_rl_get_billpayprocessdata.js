/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
/**
* Copyright (c) 2026, Xoriant Corporation and/or its affiliates. All rights reserved.
*
* @author 
* @nameci_adv_rl_get_billpayprocessdata.js
* Script brief description:
* This Restlet is used for:
* Getting data from the NetSuite Backend 
*
* Revision History:
*
* Date              Issue/Case         Author               	Issue Fix Summary
* =============================================================================================
* 2026/02/01                                           	    Initial version
*/
/*
 modified to send rule type param            by ragini      12/06/24
 modified to format date in pref format      by ragini      1/28/25
 modified the audit logs for monitoring studio      by nikhil      1/28/25
 */
define(['N/search', 'N/record', 'N/error', 'N/log', 'N/task', 'N/config', 'N/format', 'N/url', 'N/runtime', 'N/query', 'N/xml'],

    function (search, record, error, log, task, config, format, url, runtime, query, xml) {

        /**
         * Function called upon sending a GET request to the RESTlet.
         *
         * @param {Object} requestParams - Parameters from HTTP request URL; parameters will be passed into function as an Object (for all supported content types)
         * @returns {string | Object} HTTP response body; return string when request Content-Type is 'text/plain'; return Object when request Content-Type is 'application/json'
         * @since 2015.1
         */
        var nameApprovers = [];
        var CONFIG_DATA;
        function doGet(requestParams) {
            log.debug("doGet Function Start");
            var logTitle = "doGet";
            try {
                var data;
                //log.debug(logTitle,"23 - "+JSON.stringify(requestParams));
                log.debug(logTitle, "24 - " + JSON.stringify(requestParams));
                log.debug({
                    title: 'requestParams GET',
                    details: JSON.stringify(requestParams)
                });
                var action = requestParams.action;
                log.debug(logTitle, 'action - ' + action);

                // Executing the code for the action extracted from Parameters.
                if (action == 'getProcessedPaymentsBodyData') {
                    data = getBodyData(requestParams, search, log, url, config, format, runtime);
                } else if (action == 'getProcessedPaymentsSublistData') {
                    data = getProcessedPaymentsSublistData(requestParams, search, log, config, url, runtime);
                } else if (action == 'getUnPaidBillsBodyData') {
                    data = getBodyData(requestParams, search, log, url, config, format, runtime);
                } else if (action == 'getUnPaidBillsSublistData') {
                    data = getUnPaidBillsSublistData(requestParams, search, log, url, runtime, format, record, xml);
                } else if (action == 'getPFIData') {
                    data = getPFIData(requestParams, search, log, url, runtime, search, record, task);
                }
                else if (action == 'triggerSftpDownload') {
                    // This action is used to trigger the SFTP download to get the PSR files from the SFTP server.
                    data = triggerSftpDownload(log, task);
                }
                else {
                    data = 'Incorrect Action.';
                }
                log.debug("doGet Function END");
                return data;
            } catch (err) {
                log.audit({
                    title: 'Payment Initiation Restlet - ' + 'Get Request Error',
                    details: err
                });
                return 'Error';
            }
        }

        /**
         * Function called upon sending a PUT request to the RESTlet.
         *
         * @param {string | Object} requestBody - The HTTP request body; request body will be passed into function as a string when request Content-Type is 'text/plain'
         * or parsed into an Object when request Content-Type is 'application/json' (in which case the body must be a valid JSON)
         * @returns {string | Object} HTTP response body; return string when request Content-Type is 'text/plain'; return Object when request Content-Type is 'application/json'
         * @since 2015.2
         */
        function doPut(requestBody) {
            try {
                log.audit({
                    title: 'PUT requestBody Put',
                    details: requestBody
                });

                var action = requestBody.action;
                var messageId = requestBody.messageId;

                var currentUser = runtime.getCurrentUser();
                var employeeId = currentUser.id;
                var userName = currentUser.name;

                messageId = Number(messageId);

                //log.debug("833",messageId);
                var rejectedValue = [];
                // approval flag reject

                if (action == 'paymentProcessing') {
                    log.debug("RequestBody :", requestBody);
                    var parameters = getParameterValue(requestBody);
                    log.debug('parameters', parameters);

                    var sublistData = getFinalSublistData(requestBody.sublistData, format);
                    log.debug('sublistData', sublistData);

                    var paymentProfileNames = [];
                    var enablePpfvaluelist = [];
                    var paymentProfileId;
                    var enablePpfvalue;

                    // Update the profileid based on the paymentProfileName
                    for (var i = 0; i < sublistData.length; i++) {
                        var profileNameid = sublistData[i].paymentProfileName;


                        var customrecord_xor_native_pros_prfle_sdfSearchObj = search.create({
                            type: "customrecord_ci_adv_pros_profile",
                            filters: [
                                ["name", "is", profileNameid]
                            ],
                            columns: [
                                search.createColumn({
                                    name: "internalid",
                                    label: "Internal ID"
                                }),
                                search.createColumn({
                                    name: "custrecord_ci_adv_enable_pmt_grouping",
                                    label: "Enable Payment Grouping"
                                })
                            ]
                        });
                        var searchResultCount = customrecord_xor_native_pros_prfle_sdfSearchObj.runPaged().count;
                        log.debug("customrecord_xor_native_pros_prfle_sdfSearchObj result count:", searchResultCount);
                        customrecord_xor_native_pros_prfle_sdfSearchObj.run().each(function (result) {
                            paymentProfileId = result.getValue({ name: "internalid" });

                            enablePpfvalue = result.getValue({
                                name: "custrecord_ci_adv_enable_pmt_grouping"
                            });
                            paymentProfileNames.push(paymentProfileId);
                            enablePpfvaluelist.push(enablePpfvalue);

                            // .run().each has a limit of 4,000 results
                            return true;
                        });



                    }

                    log.debug("paymentProfileNames:", paymentProfileNames);
                    log.debug("enablePpfvaluelist:", enablePpfvaluelist);

                    for (var z = 0; z < sublistData.length; z++) {
                        // Set the profileid from the t array sequentially
                        sublistData[z].profileid = paymentProfileNames[z % paymentProfileNames.length];
                        sublistData[z].enablePaymentgrouping = enablePpfvaluelist[z % enablePpfvaluelist.length];
                    }
                    log.debug('sublistData172', sublistData);
                    var profilevalue_id;
                    for (var s = 0; s < sublistData.length; s++) {
                        var billid_Value = sublistData[s].billid;
                        //log.debug("billid_Value", billid_Value);
                        var remamount_Value = sublistData[s].remamount;
                        //log.debug("remamount_Value", remamount_Value);
                        var invamount_Value = sublistData[s].invamount;
                        //log.debug("invamount_Value", invamount_Value);
                        var paymentProfileName_Value = sublistData[s].paymentProfileName;
                        // log.debug("paymentProfileName_Value", paymentProfileName_Value);

                    }

                    var PFIRecID;

                    var apprAlllimit = [];
                    var CUAApproalRoutingDetails = [];

                    PFIRecID = createPFIRecord(record, sublistData, parameters, format, log, search);
                    log.debug('PFIRecID :', PFIRecID);

                    if (!isEmpty(PFIRecID)) {
                        // moving the profilenames to PFIData
                        var set_profilename = [];
                        var set_profileid = [];
                        var set_invamount = [];
                        var set_vendorName = [];
                        for (var i = 0; i < sublistData.length; i++) {
                            var billid_Value = sublistData[i].billid;
                            var profile_Name = sublistData[i].paymentProfileName;
                            var setprofileid = sublistData[i].profileid;
                            var setinvamount = sublistData[i].invamount;
                            var setvendorName = sublistData[i].vendorName;
                            set_profilename.push(profile_Name);
                            set_profileid.push(setprofileid);
                            set_invamount.push(setinvamount);
                            set_vendorName.push(setvendorName);

                            // Determine record type: vendorbill or vendorcredit - Ganesh
                            var recordType = 'vendorbill';
                            try {
                                var lookup = search.lookupFields({
                                    type: 'transaction',
                                    id: billid_Value,
                                    columns: ['type']
                                });
                                if (lookup && lookup.type && lookup.type.length > 0) {
                                    var typeValue = lookup.type[0].value;
                                    if (typeValue === 'VendCred') {
                                        recordType = 'vendorcredit';
                                    } else if (typeValue === 'VendBill') {
                                        recordType = 'vendorbill';
                                    }
                                }
                            } catch (e) {
                                log.debug('Error determining record type for billid ' + billid_Value, e);
                            }


                            try {
                                var vendor_billId = record.submitFields({
                                    type: recordType,
                                    id: billid_Value,
                                    values: {
                                        'custbody_ci_adv_native_paidin_full': true,
                                        'custbody_ci_ad_bill_prof_name': profile_Name
                                    }
                                });
                            } catch (e) {
                                log.debug('Error updating bill record ' + billid_Value, e);
                            }
                        }
                        //log.debug("set_profilename",set_profilename);
                        //log.debug("set_profileid",set_profileid);
                        try {
                            var pfisetUpdate = record.submitFields({
                                type: 'customrecord_ci_adv_pymt_file_info',
                                id: PFIRecID,
                                values: {
                                    'custrecord_ci_adv_selected_profiles': set_profilename,
                                    'custrecord_ci_adv_set_profileids': set_profileid,
                                    'custrecord_ci_adv_sel_inv_amt': set_invamount,
                                    'custrecord_ci_adv_vendor_names': set_vendorName,
                                    'custrecord_ci_adv_payment_json_data': JSON.stringify(sublistData)
                                }
                            });
                        } catch (e) {
                            log.debug("Error in submitting Fields to record:", e);
                        }
                    }

                    var pfiLoadrecord = record.load({
                        type: 'customrecord_ci_adv_pymt_file_info',
                        id: PFIRecID
                    });
                    var jsonString = pfiLoadrecord.getValue({
                        fieldId: 'custrecord_ci_adv_json_string'
                    });
                    var parsejson = JSON.parse(jsonString);
                    log.debug("13700", parsejson);

                    log.debug("16350", parameters.bankAccountId);
                    var emailNotificationId = parameters.emailNotificationId;
                    log.debug("163219", emailNotificationId);
                    var bankId = parameters.bankAccountId;
                    log.debug("16370", bankId);



                    //log.debug("invAllamount191",invAllamount);
                    //log.debug("invAllamount192",invAllamount.length);


                    // Executing the code only when the Payment File Information record id is not empty.
                    if (!isEmpty(PFIRecID)) {
                        log.debug("17888");


                        try {
                            var mrTask = task.create({ taskType: task.TaskType.SCHEDULED_SCRIPT });
                            mrTask.scriptId = 'customscript_ci_adv_ss_generic_payments';
                            mrTask.deploymentId = 'customdeploy_ci_adv_ss_generic_payments';
                            mrTask.params = {
                                custscript_ci_adv_gen_pfi_recid: PFIRecID
                            };
                            var mrTaskId = mrTask.submit();
                            log.debug("744", mrTaskId);
                        }

                        catch (e1) {
                            log.debug("error e1", e1);

                        }

                        var domain = url.resolveDomain({
                            hostType: url.HostType.APPLICATION
                        });
                        log.debug('domain', domain);

                        var recordUrl = url.resolveRecord({
                            recordType: 'customrecord_ci_adv_pymt_file_info',
                            recordId: PFIRecID,
                            isEditMode: false
                        });
                        log.debug('recordUrl', recordUrl);

                        var finalURL = 'https://' + domain + recordUrl;
                        log.debug('finalURL', finalURL);

                        var PFIData = [{
                            "internalID": "65",
                            "id": "00000065",
                            "createdBy": "",
                            "approver": "",
                            "createdDate": "8/8/2023",
                            "bankAccount": "BANK EUROPE PLC FRANCE BRANCH",
                            "subsidiary": "Parent Company : CloudIO France",
                            "date": "8/8/2023",
                            "noOfTransactions": "2",
                            "glBankAccount": "France Bank Account",
                            "paymentAmount": "238.42",
                            "status": ""
                        }];

                        return {
                            'paymentFileInfoURL': finalURL,
                            'PFIRecID': PFIRecID,
                            'PFIData': PFIData,
                            'sublistData': sublistData
                        }
                    } else {
                        var errorMsg = 'Error: The Payment File Information is not generated.';
                        log.error('Error', errorMsg);
                        return errorMsg;
                    }
                }
            }
            catch (err) {
                log.debug("Error:", err);
                /* var cleanMessage = err.message ? err.message.replace(/["\\]/g, "") : "";
                 return {
                    error: err.name,
                    message: cleanMessage    
                }; */
            }
        }




        /**
         * Function called upon sending a POST request to the RESTlet.
         *
         * @param {string | Object} requestBody - The HTTP request body; request body will be passed into function as a string when request Content-Type is 'text/plain'
         * or parsed into an Object when request Content-Type is 'application/json' (in which case the body must be a valid JSON)
         * @returns {string | Object} HTTP response body; return string when request Content-Type is 'text/plain'; return Object when request Content-Type is 'application/json'
         * @since 2015.2
         */
        function doPost(requestBody) {
            log.debug("doPost Function Start");
            var logTitle = "doPost";
            try {
                // log.debug({ title:'jsonRequest', details: JSON.stringify(jsonRequest) });
                //log.debug({ title: logTitle, details: 'requestBody Post -' + requestBody });
                //log.debug({ title: logTitle, details: 'JSON requestBody Post - ' + JSON.stringify(requestBody) });
                var requestData = requestBody;


                log.debug("doPost Function END");
                return 'Success POST';
            } catch (err) {
                log.audit({
                    title: 'Payment Initiation Restlet - ' + logTitle,
                    details: 'Post Request Error - ' + err
                })
                return 'Error';
            }
        }

        /**
         * Function called upon sending a DELETE request to the RESTlet.
         *
         * @param {Object} requestParams - Parameters from HTTP request URL; parameters will be passed into function as an Object (for all supported content types)
         * @returns {string | Object} HTTP response body; return string when request Content-Type is 'text/plain'; return Object when request Content-Type is 'application/json'
         * @since 2015.2
         */
        function doDelete(requestParams) {

        }

        return {
            get: doGet,
            put: doPut,
            post: doPost,
            //'delete': doDelete
        };
    });



// ---------------------------------------------------- getBodyData Function ------------------------------------------------------------

/**
 * Retrieves the data to populate the drop downs from in the React UI.
 * @param {Array<search.Result>} requestParams
 * @param Search Module search
 * @param Log Module log
 * @param Config Module config
 * @returns {Array<search.Result>} searchResults - Returns an array of Subsidiary Data.
 */
function getBodyData(requestParams, search, log, url, config, format, runtime) {
    try {
        log.debug({
            title: 'onRequest',
            details: 'Start'
        });
        var logTitle = "getBodyData";
        var subsidiaryData = new Array(),
            accountData = new Array(),
            paymentProfileData = new Array();
        var vendorData = new Array(),
            apAccountData = new Array(),
            configDetails = new Array();

        var today = new Date();
        var formattedToday = format.format({
            value: today,
            type: format.Type.DATE
        });
        log.debug("formattedToday :", formattedToday);
        var currencyTotals = {};
        log.debug("RequestParams of getBodyData :", requestParams);
        var account = requestParams.account;
        var apAccount = requestParams.apAccount;
        var vendors = requestParams.vendors;
        var subsidiary = requestParams.subsidiary;
        var fromDate = requestParams.fromDate;
        var toDate = requestParams.toDate;
        var paymentProfileId = requestParams.paymentProfileId;
        // log.debug(logTitle, 'paymentProfileId - ' + paymentProfileId);

        // Company Bank Detail Search to populate the Bank Account Drop Down.
        /* var cmpBankDetailSearch = search.create({
            type: 'customrecord_ci_adv_bank_details_sdf',
            filters: [
                ['isinactive', 'is', 'F']
            ],
            columns: ['name', 'custrecord_ci_adv_subsidiary_sdf', 'custrecord_ci_adv_cbd_bank_acct_sdf', 'custrecord_ci_adv_cbd_currency_sdf']
        }).run().getRange(0, 999);
        log.debug(logTitle, 'cmpBankDetailSearch - ' + cmpBankDetailSearch);
    
        for (var loop2 = 0; loop2 < cmpBankDetailSearch.length; loop2++) {
            var accountId = cmpBankDetailSearch[loop2].id;
            var accountName = cmpBankDetailSearch[loop2].getValue({
                name: 'name'
            });
            var accSubsidiaryId = cmpBankDetailSearch[loop2].getValue({
                name: 'custrecord_ci_adv_subsidiary_sdf'
            });
            var accBanknum = cmpBankDetailSearch[loop2].getValue({
                name: 'custrecord_ci_adv_cbd_bank_acct_sdf'
            });
            var accCurrencyid = cmpBankDetailSearch[loop2].getValue({
                name: 'custrecord_ci_adv_cbd_currency_sdf'
            });
            var accCurrValue = cmpBankDetailSearch[loop2].getValue({
                name: 'symbol',
               join: 'custrecord_ci_adv_cbd_currency_sdf'
            });
        	
            accountData.push({
                id: accountId,
                 value: accountName,
                subsidiaryId: accSubsidiaryId
            });
        } */

        //fetch the accounts details from the account record type is Bank
        /*   var cmpBankDetailSearch = search.create({
              type: search.Type.ACCOUNT,
              filters: [
                  ['type', 'anyof', 'Bank']
              ],
              columns: [
                  'name', 'subsidiary'
              ]
          }).run().getRange(0, 999);
          log.debug(logTitle, 'cmpBankDetailSearch - ' + cmpBankDetailSearch); */

        var cmpBankDetailSearch = search.create({
            type: 'customrecord_ci_adv_acct_bank_det_sdf',
            filters: [
                ['isinactive', 'is', 'F']
            ],
            columns: [
                'custrecord_ci_adv_cbd_bank_acct_sdf',
                'internalid',
                search.createColumn({
                    name: 'subsidiary',
                    join: 'custrecord_ci_adv_cbd_bank_acct_sdf'
                })
            ]
        }).run().getRange(0, 999);

        if (cmpBankDetailSearch && cmpBankDetailSearch.length > 0) {
            var subsidiaryIds = [];
            for (var i = 0; i < cmpBankDetailSearch.length; i++) {
                var subId = cmpBankDetailSearch[i].getValue({
                    name: 'subsidiary',
                    join: 'custrecord_ci_adv_cbd_bank_acct_sdf'
                });
                if (subId && subsidiaryIds.indexOf(subId) === -1) {
                    subsidiaryIds.push(subId);
                }
            }
            var activeSubsidiariesMap = {};
            if (subsidiaryIds.length > 0) {
                search.create({
                    type: 'subsidiary',
                    filters: [
                        ['internalid', 'anyof', subsidiaryIds],
                        'AND',
                        ['isinactive', 'is', 'F']
                    ],
                    columns: ['internalid']
                }).run().each(function (result) {
                    // Map active subsidiary IDs to "true"
                    activeSubsidiariesMap[result.id] = true;
                    return true;
                });
            }

            for (var loop2 = 0; loop2 < cmpBankDetailSearch.length; loop2++) {

                var accSubsidiaryId = cmpBankDetailSearch[loop2].getValue({
                    name: 'subsidiary',
                    join: 'custrecord_ci_adv_cbd_bank_acct_sdf'
                });
                if (!activeSubsidiariesMap[accSubsidiaryId]) {
                    continue;
                }

                var accountId = cmpBankDetailSearch[loop2].getValue({
                    name: 'custrecord_ci_adv_cbd_bank_acct_sdf'
                });

                var accountName = cmpBankDetailSearch[loop2].getText({
                    name: 'custrecord_ci_adv_cbd_bank_acct_sdf'
                });

                var accountInternalId = cmpBankDetailSearch[loop2].getValue({
                    name: 'internalid'
                });

                accountData.push({
                    id: accountId,
                    value: accountName,
                    subsidiaryId: accSubsidiaryId,
                    payAcctId: accountInternalId
                });
            }
        }

        log.debug(logTitle, 'Final filtered accountData count: ' + accountData.length);

        // Vendor Search to populate the Vendor Drop Down.
        var vendorSearchFilters = new Array(),
            vendorSearchColumns = new Array();
        vendorSearchFilters.push(search.createFilter({
            name: 'isinactive',
            operator: search.Operator.IS,
            values: 'F'
        }));
        /*  vendorSearchFilters.push(search.createFilter({
             name: 'custentity_ci_adv_bill_payment',
             operator: search.Operator.IS,
             values: 'T'
         })); */
        vendorSearchColumns.push(search.createColumn({
            name: 'entityid',
            sort: search.Sort.ASC
        }));

        if (!isEmpty(subsidiary)) {
            vendorSearchFilters.push(search.createFilter({
                name: 'subsidiary',
                operator: search.Operator.ANYOF,
                values: subsidiary
            }));
            var vendorSearch = search.create({
                type: 'vendor',
                filters: vendorSearchFilters,
                columns: vendorSearchColumns
            }).run().getRange(0, 999);
            log.debug("vendorSearch:", vendorSearch);
            for (var loop4 = 0; loop4 < vendorSearch.length; loop4++) {
                var vendorId = vendorSearch[loop4].id;
                var vendorName = vendorSearch[loop4].getValue({
                    name: 'entityid'
                });
                // log.debug('Primary Bank Account Count', searchCount);
                vendorData.push({
                    id: vendorId,
                    name: vendorName,
                    flag: true,
                    validAlert: '',
                    profileId: ''
                });
            }
        }
        // added code as per shivas's suggestion to resolve api exceeds issue
        var userDateformat = config.load({
            type: config.Type.USER_PREFERENCES
        }).getValue({
            fieldId: 'DATEFORMAT'
        });
        var companyConfig = config.load({
            type: config.Type.COMPANY_INFORMATION
        });

        var companyId = companyConfig.getValue({ fieldId: 'companyid' });
        var currentUser = runtime.getCurrentUser();
        var targetRoleIdacc = currentUser.role;
        log.debug("targetRoleIdacc:", targetRoleIdacc)
        var bodyVal = {
            //'role': targetRoleIdacc,
            'accountOptions': accountData,
            //'paymentProfileOptions': paymentProfileData,
            'vendorsOptions': vendorData,
            'userDateformat': userDateformat,
            'compId': companyId
        };


        log.debug({
            title: 'onRequest',
            details: 'End'
        });
        return JSON.stringify(bodyVal);
    }
    catch (err) {
        log.debug("Error", err);
        /* var currentUser = runtime.getCurrentUser();
        var targetRoleIdacc = currentUser.role;
        log.debug("targetRoleIdacc:",targetRoleIdacc)
            var formatErrorName = function(name) {
            if (!name) return "";
            return name
                .toLowerCase()
                .split('_')
                .map(function(word) {
                    return word.charAt(0).toUpperCase() + word.slice(1);
                })
                .join(' ');
        };

        return JSON.stringify({
            error: formatErrorName(err.name), // Format applied here
            role: targetRoleIdacc,
            message: err.message
        }); */
    }
}




function maskAccountNumber(accountNumber) {
    if (!accountNumber || accountNumber.length <= 4) {
        return accountNumber;
    }

    var last4 = accountNumber.slice(-4);
    return 'xxxx' + last4;
}


// --------------------------------------------------- getCUAConfigData Function ---------------------------------------------------------

/**
 * Retrieves the configuration for CUA.
 * @param Search Module search
 * @param Config Module config
 * @returns [{Array<search.Result>}] searchResults - Returns a JSON of Configuration Data for CUA.
 */
/* function getCUAConfigData(search, config) {
    log.debug("getCUAConfigData function start.");
    var logTitle = "getCUAConfigData";
    var configDetails = new Array();
    var accountingPreferences = config.load({ type: config.Type.ACCOUNTING_PREFERENCES });
    var vendPmtApprRouting = accountingPreferences.getValue({ fieldId: 'CUSTOMAPPROVALVENDPYMT' });

    configDetails.push({
        cuaApprovalRouting: false,
        cuaFuturePayments: '',
        cuaApprovalMailNotify: '',
        cuaPagination: '',
        vendPmtApprRouting: vendPmtApprRouting // true // vendPmtApprRouting
    });

    // Getting the details from CUA Config Record.
    var cuaConfigSearch = search.create({
        type: 'customrecord_xor_pay_config', filters: [['isinactive', 'is', 'F']],
        columns: ['custrecord_xor_pay_cua_approval_routing', 'custrecord_xor_pay_future_payment',
            'custrecord_xor_pay_cua_appr_mail_notify', 'custrecord_xor_pay_cua_is_not_pagination']
    });
    cuaConfigSearch = getFullResultSet(cuaConfigSearch);

    if (!isEmpty(cuaConfigSearch)) {
        if (cuaConfigSearch.length > 0) {
            var cuaApprovalRouting = cuaConfigSearch[0].getValue({ name: 'custrecord_xor_pay_cua_approval_routing' });
            var cuaFuturePayments = cuaConfigSearch[0].getValue({ name: 'custrecord_xor_pay_future_payment' });
            var cuaApprovalMailNotify = cuaConfigSearch[0].getValue({ name: 'custrecord_xor_pay_cua_appr_mail_notify' });
            var cuaPagination = cuaConfigSearch[0].getValue({ name: 'custrecord_xor_pay_cua_is_not_pagination' });
            configDetails[0].cuaApprovalRouting = cuaApprovalRouting;// true;// cuaApprovalRouting;
            configDetails[0].cuaFuturePayments = cuaFuturePayments;
            configDetails[0].cuaApprovalMailNotify = cuaApprovalMailNotify;
            configDetails[0].cuaPagination = cuaPagination;
        }
    }

    // Getting the details from CUA Config Record.
    var cuaConfigSearch = search.create({
        type: 'customrecord_xor_pay_config', filters: [['isinactive', 'is', 'F']],
        columns: ['custrecord_xor_pay_cua_approval_routing', 'custrecord_xor_pay_future_payment',
            'custrecord_xor_pay_cua_appr_mail_notify', 'custrecord_xor_pay_cua_is_not_pagination']
    });
    cuaConfigSearch = getFullResultSet(cuaConfigSearch);

    // Executing the code only when the CUA Config Search is not empty.
    if (!isEmpty(cuaConfigSearch)) {
        if (cuaConfigSearch.length > 0) {
            var cuaApprovalRouting = cuaConfigSearch[0].getValue({ name: 'custrecord_xor_pay_cua_approval_routing' });
            var cuaFuturePayments = cuaConfigSearch[0].getValue({ name: 'custrecord_xor_pay_future_payment' });
            var cuaApprovalMailNotify = cuaConfigSearch[0].getValue({ name: 'custrecord_xor_pay_cua_appr_mail_notify' });
            var cuaPagination = cuaConfigSearch[0].getValue({ name: 'custrecord_xor_pay_cua_is_not_pagination' });
            configDetails[0].cuaApprovalRouting = cuaApprovalRouting;// true;// cuaApprovalRouting;
            configDetails[0].cuaFuturePayments = cuaFuturePayments;
            configDetails[0].cuaApprovalMailNotify = cuaApprovalMailNotify;
            configDetails[0].cuaPagination = cuaPagination;
        }
    }
    log.debug("getCUAConfigData function end.");
    return configDetails;
} */

// --------------------------------------------------- getSubsidiaryData Function ---------------------------------------------------------

/**
 * Retrieves the active subsidiaries.
 * @param Search Module search
 * @param Log Module log
 * @returns [{Array<search.Result>}] searchResults - Returns an array of Subsidiary Data.
 */
function getSubsidiaryData(search, log) {
    log.debug("getSubsidiaryData function start");
    //log.debug("495");
    var subsidiaryData = new Array();
    var subsidiarySearch = search.create({
        type: 'subsidiary',
        filters: [
            ['isinactive', 'is', 'F']
        ],
        columns: ['name']
    }).run().getRange(0, 999);
    log.debug('subsidiarySearch', subsidiarySearch);

    for (var loop1 = 0; loop1 < subsidiarySearch.length; loop1++) {
        var subsidiaryId = subsidiarySearch[loop1].id;
        var subsidiaryName = subsidiarySearch[loop1].getValue({
            name: 'name'
        });
        subsidiaryData.push({
            id: subsidiaryId,
            value: subsidiaryName
        });
    }
    log.debug("getSubsidiaryData function end");
    return subsidiaryData;
}

// ---------------------------------------------------- getAccountData Function ------------------------------------------------------------


/* function getAccountData(search, log) {
    log.debug("getAccountData function start");
    var cmpBankDetailSearch = search.create({
        type: 'customrecord_ci_adv_bank_details_sdf',
        filters: [
            ['isinactive', 'is', 'F']
        ],
        columns: ['name', 'custrecord_ci_adv_subsidiary_sdf']
    }).run().getRange(0, 999);
    log.debug('cmpBankDetailSearch :', cmpBankDetailSearch);

    for (var loop2 = 0; loop2 < cmpBankDetailSearch.length; loop2++) {
        var accountId = cmpBankDetailSearch[loop2].id;
        var accountName = cmpBankDetailSearch[loop2].getValue({
            name: 'name'
        });
        var accSubsidiaryId = cmpBankDetailSearch[loop2].getValue({
            name: 'custrecord_ci_adv_subsidiary_sdf'
        });
        var accSubsidiaryName = cmpBankDetailSearch[loop2].getText({
            name: 'custrecord_ci_adv_subsidiary_sdf'
        });
        accountData.push({
            id: accountId,
            value: accountName,
            subsidiaryId: accSubsidiaryId,
            subsidiaryName: accSubsidiaryName
        });
    }
    //log.debug("getAccountData",'accountData'+ accountData);
    //log.debug("getAccountData function end");
} */

// -------------------------------------- getProcessedPaymentsSublistData Function -------------------------------------------------

// getProcessedPaymentsSublistData Function is used to get the values for drop down fields.
function getProcessedPaymentsSublistData(requestParams, search, log, config, url, runtime) {
    try {
        log.debug({
            title: 'getProcessedPaymentsSublistData',
            details: 'Start'
        });
        log.debug("RequestParams of getProcessedPaymentsSublistData :", requestParams);
        var logTitle = "getProcessedPaymentsSublistData";
        var pfiLinkURL = '',
            sublistData = new Array();
        var bankAccount = requestParams.bankAccount;
        var subsidiary = requestParams.subsidiary;
        var glBankAccount = requestParams.glBankAccount;
        var fromDate = requestParams.fromDate;
        var toDate = requestParams.toDate;
        var pageIndex = requestParams.pageIndex;
        var limit = requestParams.limit;


        var searchFilters = new Array(),
            searchColumns = new Array();

        // Applying the Bank Account filter if its the parameter is not empty.
        if (!isEmpty(bankAccount)) {
            searchFilters.push(search.createFilter({
                name: 'custrecord_ci_adv_pfi_bank_acc',
                operator: search.Operator.ANYOF,
                values: bankAccount
            }));
        }

        // Applying the Subsidiary filter if its the parameter is not empty.
        if (!isEmpty(subsidiary)) {
            searchFilters.push(search.createFilter({
                name: 'custrecord_ci_adv_file_subsidiary',
                operator: search.Operator.ANYOF,
                values: subsidiary
            }));
        }

        // Applying the GL Bank Account filter if its the parameter is not empty.
        if (!isEmpty(glBankAccount)) {
            searchFilters.push(search.createFilter({
                name: 'custrecord_ci_adv_gl_bank_acct',
                operator: search.Operator.ANYOF,
                values: glBankAccount
            }));
        }

        // Applying the Date filters if its the parameters are not empty.
        if (!isEmpty(fromDate) && !isEmpty(toDate)) {
            searchFilters.push(search.createFilter({
                name: 'custrecord_ci_adv_file_process_date',
                operator: search.Operator.WITHIN,
                values: [fromDate, toDate]
            }));
        } else if (!isEmpty(fromDate) && isEmpty(toDate)) {
            searchFilters.push(search.createFilter({
                name: 'custrecord_ci_adv_file_process_date',
                operator: search.Operator.ON,
                values: [fromDate]
            }));
        } else if (isEmpty(fromDate) && !isEmpty(toDate)) {
            searchFilters.push(search.createFilter({
                name: 'custrecord_ci_adv_file_process_date',
                operator: search.Operator.ON,
                values: [toDate]
            }));
        } else { }


        // Search Columns.
        searchColumns.push(search.createColumn({
            name: 'internalid',
            label: 'Internal ID',
            sort: search.Sort.DESC
        }));
        searchColumns.push(search.createColumn({
            name: 'name',
            label: 'ID'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_pfi_bank_acc',
            label: 'Bank Account'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_file_subsidiary',
            label: 'Subsidiary'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_file_process_date',
            label: 'Date'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_gl_bank_acct',
            label: 'GL Bank Account'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_pfi_batch_status',
            label: 'Status'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_file_process_amt',
            label: 'Amount'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_pfi_base_cury',
            label: 'Base Currency'
        }));

        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_no_of_trans_rejctd',
            label: 'No.of Transactions Rejected'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_no_of_trans_acptd',
            label: 'No.of Transactions Accepted'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_no_of_trans_pending',
            label: 'No.of Transactions pending'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_transaction_status',
            label: 'Transactions Status'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_payment_tier_status',
            label: 'Payment Tier Status'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_err_det',
            label: 'Script Error Details'
        }));

        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_sel_inv_amt',
            label: 'Selected Invoice Amounts'
        }));
        searchColumns.push(search.createColumn({
            name: 'custrecord_ci_adv_no_of_trans',
            label: 'No.of Transactions'
        }));
        searchColumns.push(search.createColumn({
            name: 'name',
            join: 'custrecord_ci_adv_pfi_base_cury',
            label: 'Currency'
        }));
        searchColumns.push(search.createColumn({
            name: 'symbol',
            join: 'custrecord_ci_adv_pfi_base_cury',
            label: 'CurrencySymbol'
        }));

        // Searching the Payment File Information Record.
        var pfiSearch = search.create({ type: 'customrecord_ci_adv_pymt_file_info', filters: searchFilters, columns: searchColumns });

        var pfiSearchResults = new Array();
        var pagedData = pfiSearch.runPaged({ pageSize: limit });
        var totalPFICount = pagedData.count;

        // Page Index from UI start from 1 whereas when paging in NetSuite it starts from 0.
        if (pageIndex > 0) { pageIndex--; }
        if (pageIndex < 0) { pageIndex = 0; }

        var page = pagedData.fetch({ index: pageIndex });
        page.data.forEach(function (result) { pfiSearchResults.push(result); });
        log.debug("pfiSearchResults", pfiSearchResults);
        pfiSearch = pfiSearchResults;


        // pfiSearch = getFullResultSet(pfiSearch);
        log.debug("pfiSearch value -", pfiSearch);



        // Traversing through the pfiSearch.
        for (var loop1 = 0; loop1 < pfiSearch.length; loop1++) {
            var sublistId = loop1;
            var pfiId = pfiSearch[loop1].id;
            var pfiURL = 'https://' + url.resolveDomain({
                hostType: url.HostType.APPLICATION
            }) + url.resolveRecord({
                recordType: 'customrecord_ci_adv_pymt_file_info',
                recordId: pfiId,
                isEditMode: false
            });;
            var id = pfiSearch[loop1].getValue({
                name: 'name'
            });
            var bankAccount = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_pfi_bank_acc'
            });
            var bankAccountName = pfiSearch[loop1].getText({
                name: 'custrecord_ci_adv_pfi_bank_acc'
            });
            var subsidiary = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_file_subsidiary'
            });
            var subsidiaryName = pfiSearch[loop1].getText({
                name: 'custrecord_ci_adv_file_subsidiary'
            });
            var glBankAccount = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_gl_bank_acct'
            });
            var glBankAccountName = pfiSearch[loop1].getText({
                name: 'custrecord_ci_adv_gl_bank_acct'
            });
            var date = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_file_process_date'
            });
            var status = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_ack_file_sts'
            });
            var statusName = pfiSearch[loop1].getText({
                name: 'custrecord_ci_adv_pfi_batch_status'
            });
            var acceptedCount = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_no_of_trans_acptd'
            });
            var pendingCount = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_no_of_trans_pending'
            });
            var transactionDetail = pfiSearch[loop1].getText({
                name: 'custrecord_ci_adv_transaction_status'
            });
            var tierStatus = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_payment_tier_status'
            });

            var rejectedCount = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_no_of_trans_rejctd'
            });
            var transactionCount = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_no_of_trans'
            });
            var pfierrorDetails = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_err_det'
            });

            var amount = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_file_process_amt'
            });
            var amountinv = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_sel_inv_amt'
            });
            var accCurrencyid = pfiSearch[loop1].getValue({
                name: 'custrecord_ci_adv_pfi_base_cury'
            });
            var currency = pfiSearch[loop1].getValue({
                name: 'name',
                join: 'custrecord_ci_adv_pfi_base_cury'
            });
            var currencySymbol = pfiSearch[loop1].getValue({ name: 'symbol', join: 'custrecord_ci_adv_pfi_base_cury' });



            /* var currencyLookup = search.lookupFields({
                type: search.Type.CURRENCY,
                id: accCurrencyid,
                columns: ['symbol']
            });
    
            var isoCode = currencyLookup.symbol; */

            if (statusName == "Pending") {
                statusName = "Pending"
            }

            //Removing the count of accepted and rejected transactions from the transaction count. - Ganesh
            // var transactionDetail = '';
            /* if (transactionCount > 1) {
                if (rejectedCount == 0) {
                    //transactionDetail = +acceptedCount + ' Accepted'
                    transactionDetail = 'Accepted'
                }
                if (acceptedCount == 0) {
                    //transactionDetail = +rejectedCount + ' Rejected'
                    transactionDetail = 'Rejected'
                }
                if (rejectedCount != 0 && acceptedCount != 0) {
                    //transactionDetail = acceptedCount + ' Accepted,' + rejectedCount + ' Rejected'
                    transactionDetail = 'Partially Accepted'
                }
                if (rejectedCount == 0 && acceptedCount == 0) {
                    transactionDetail = ''
                }
            }
            if (transactionCount == 1) {
                if (acceptedCount == 1) {
                    //transactionDetail = +acceptedCount + ' Accepted'
                    transactionDetail = 'Accepted'
                }
                if (rejectedCount == 1) {
                    //transactionDetail = +rejectedCount + ' Rejected'
                    transactionDetail = 'Rejected'
                }
    
            }
            if (transactionDetail == '') {
                transactionDetail = "In Progress"
            } */

            if (pfierrorDetails) {
                transactionDetail = "Failed"
            }
            if (tierStatus == "ACCP" || tierStatus == "ACTC" || tierStatus == "PDNG") {
                transactionDetail = "Pending";
            }
            if (tierStatus == "ACSP") {
                transactionDetail = "Processed";
            }


            var testamountinv = amountinv.split(" ");
            var valuesString = testamountinv[0];

            var valuesArray = valuesString.split('\n');
            var invCount = valuesArray.length

            sublistData.push({
                number: loop1,
                pfiId: pfiId,
                pfiURL: pfiURL,
                id: id,
                bankAccount: bankAccount,
                //bankAccountName: bankAccountName,
                bankAccountName: glBankAccountName,
                subsidiary: subsidiary,
                subsidiaryName: subsidiaryName,
                glBankAccount: glBankAccount,
                glBankAccountName: glBankAccountName,
                date: date,
                status: status,
                statusName: statusName,
                amount: amount,
                currency: currency,
                currencySymbol: currencySymbol,
                transactionDetail: transactionDetail,
                //vendorNames: newvendorNames,
                invCount: invCount

            });
        }
        log.debug("SublistData of getProcessedPaymentsSublistData:", sublistData);
        var approvedCount = 0;
        var pendingCount = 0;

        // Use a for loop to iterate through the array and count status names
        for (var i = 0; i < sublistData.length; i++) {
            if (sublistData[i].statusName === "Approved") {
                approvedCount++;
            } else if (sublistData[i].statusName === "Pending") {
                pendingCount++;
            }
        }

        var finalSublistData = {
            'processedPaymentsSublistData': sublistData,
            'approvedCount': approvedCount,
            'pendingCount': pendingCount,
            'totalCount': totalPFICount

        };


        log.debug(logTitle, 'finalSublistData - ' + JSON.stringify(finalSublistData));
        log.debug({
            title: 'getProcessedPaymentsSublistData',
            details: 'End'
        });
        return JSON.stringify(finalSublistData);
    }
    catch (err) {
        log.debug("Error", err);
        /* var currentUser = runtime.getCurrentUser();
        var targetRoleIdacc = currentUser.role;
        log.debug("targetRoleIdacc:",targetRoleIdacc)
            var formatErrorName = function(name) {
            if (!name) return "";
            return name
                .toLowerCase()
                .split('_')
                .map(function(word) {
                    return word.charAt(0).toUpperCase() + word.slice(1);
                })
                .join(' ');
        };

        return JSON.stringify({
            error: formatErrorName(err.name), // Format applied here
            role: targetRoleIdacc,
            message: err.message
        }); */
    }
}

	const isFeatureInEffect = () => {
		// Implement the logic to check if the Entitlement feature is enabled.
		// Return true if the feature is enabled, false otherwise.
		// This is a placeholder implementation and should be replaced with actual logic.
		let queryResults = query.runSuiteQL({ query: `SELECT ${CONFIG.entitledCheck} FROM ${CONFIG.configRecordType}` }).asMappedResults();
		
		return (queryResults && queryResults.length > 0 && queryResults[0][CONFIG.entitledCheck])
	};


// -------------------------------------------- getUnPaidBillsSublistData Function -------------------------------------------------

// getUnPaidBillsSublistData Function is used to get the values for drop down fields.
function getUnPaidBillsSublistData(requestParams, search, log, url, runtime, format, record, xml) {
    try {
        log.debug({
            title: 'getUnPaidBillsSublistData',
            details: 'Start'
        });
        log.debug("RequestParams of getUnPaidBillsSublistData :", requestParams);
        var logTitle = "getUnPaidBillsSublistData";

        var sampleVendBillLink = '', sampleVendCreditLink = '', sublistData = new Array(), vBillList = new Array();
        var account = requestParams.account;
        var apAccount = requestParams.apAccount;
        var vendors = requestParams.vendors;
        var subsidiary = requestParams.subsidiary;
        var fromDate = requestParams.fromDate;
        var toDate = requestParams.toDate;
        var paymentProfileId = requestParams.paymentProfileId;
        var pageIndex = requestParams.pageIndex;
        var limit = requestParams.limit;
        log.debug('pageIndex', pageIndex);
        log.debug('limit', limit);


        var searchFilters = new Array(),
            searchColumns = new Array();

        // Applying the Subsidiary filter if its the parameter is not empty.
        if (!isEmpty(subsidiary)) {
            searchFilters.push(search.createFilter({
                name: 'subsidiary',
                operator: search.Operator.ANYOF,
                values: subsidiary
            }));
        }

        // Applying the Vendors filter if its the parameter is not empty.
        if (!isEmpty(vendors)) {
            vendors = vendors.split(',');
            //log.debug(logTitle,'vendors split - '+ vendors);
            //log.debug("2441",vendors);
            searchFilters.push(search.createFilter({
                name: 'name',
                operator: search.Operator.ANYOF,
                values: vendors
            }));
        }

        // Applying the AP Account filter if its the parameter is not empty.
        if (!isEmpty(apAccount)) {
            searchFilters.push(search.createFilter({
                name: 'account',
                operator: search.Operator.ANYOF,
                values: apAccount
            }));
        }

        // Applying the Payment Profile filter if its the parameter is not empty.


        // var filterDateCol = 'duedate';// - old.
        var filterDateCol = 'trandate';
        log.debug('filterDateCol', filterDateCol);

        // Applying the Date filters if its the parameters are not empty.
        if (!isEmpty(fromDate) && !isEmpty(toDate)) {
            //log.debug("2482");
            searchFilters.push(search.createFilter({
                name: filterDateCol,
                operator: search.Operator.WITHIN,
                values: [fromDate, toDate]
            }));
        } else if (!isEmpty(fromDate) && isEmpty(toDate)) {
            //log.debug("2490");
            searchFilters.push(search.createFilter({
                name: filterDateCol,
                operator: search.Operator.ON,
                values: [fromDate]
            }));
        } else if (isEmpty(fromDate) && !isEmpty(toDate)) {
            //log.debug("2498");
            searchFilters.push(search.createFilter({
                name: filterDateCol,
                operator: search.Operator.ON,
                values: [toDate]
            }));
        } else { }


        // Generic Filters to be applied.
        searchFilters.push(search.createFilter({
            name: 'mainline',
            operator: search.Operator.IS,
            values: ['T']
        }));
        searchFilters.push(search.createFilter({
            name: 'type',
            operator: search.Operator.ANYOF,
            values: ['VendBill', 'VendCred']
        }));
        searchFilters.push(search.createFilter({
            name: 'status',
            operator: search.Operator.NONEOF,
            values: ['VendBill:B', 'VendBill:D', 'VendBill:E', 'VendBill:F', 'VendBill:C']
        }));
        //searchFilters.push(search.createFilter({ name: 'custbody_xor_pay_cua_bill_status', operator: search.Operator.NONEOF, values: ['3', '4', '2'] }));

        searchFilters.push(search.createFilter({
            name: 'amountremaining',
            operator: search.Operator.NOTEQUALTO,
            values: ['0.00']
        }));
        searchFilters.push(search.createFilter({
            name: 'paymenthold',
            operator: search.Operator.IS,
            values: ['F']
        }));
        searchFilters.push(search.createFilter({
            name: 'custbody_ci_adv_native_paidin_full',
            operator: search.Operator.IS,
            values: ['F']
        }));
        /*  searchFilters.push(search.createFilter({
             name: 'custbody_xor_pay_cua_a_pv',
             operator: search.Operator.IS,
             values: ['F']
         }));  */

        // Search Columns.
        searchColumns.push(search.createColumn({
            name: 'entity',
            label: 'Name'
        }));
        searchColumns.push(search.createColumn({
            name: 'type',
            label: 'Type'
        }));
        searchColumns.push(search.createColumn({
            name: 'transactionnumber',
            label: 'Transaction Number'
        }));
        searchColumns.push(search.createColumn({
            name: 'tranid',
            label: 'Document Number'
        }));
        searchColumns.push(search.createColumn({
            name: 'trandate',
            label: 'Date'
        }));
        searchColumns.push(search.createColumn({
            name: 'duedate',
            label: 'Due Date/Receive By',
            sort: search.Sort.ASC
        }));
        searchColumns.push(search.createColumn({
            name: 'fxamount',
            label: 'Amount (Foreign Currency)'
        }));
        /*  searchColumns.push(search.createColumn({
             name: 'custbody_ci_adv_bill_discount_amount',
             label: 'Ci Adv Discount Amount'
         }));
          searchColumns.push(search.createColumn({
             name: 'custbody_ci_adv_bill_tax_amount',
             label: 'Ci Adv Tax Amount'
         })); */
        searchColumns.push(search.createColumn({
            name: 'fxamountremaining',
            label: 'Amount Remaining (Foreign Currency)'
        }));
        searchColumns.push(search.createColumn({
            name: 'memo',
            label: 'Memo'
        }));
        searchColumns.push(search.createColumn({
            name: 'tranid',
            join: 'createdfrom'
        }));
        searchColumns.push(search.createColumn({
            name: 'symbol',
            join: 'currency'
        }));
        searchColumns.push(search.createColumn({
            name: 'account'
        }));
        searchColumns.push(search.createColumn({
            name: 'subsidiary'
        }));
        searchColumns.push(search.createColumn({
            name: 'currency'
        }));

        searchColumns.push(search.createColumn({
            name: 'location'
        }));
        searchColumns.push(search.createColumn({
            name: 'terms'
        }));
        searchColumns.push(search.createColumn({
            name: 'termsdiscountdate'
        }));
        searchColumns.push(search.createColumn({
            name: 'custentity_ci_adv_as',
            join: 'vendor'
        })); // Umar has added on 5th October 2026.
       

        var transactionSearch = search.create({ type: 'transaction', filters: searchFilters, columns: searchColumns });
        var transactionSearchResults = new Array();
        var pagedData = transactionSearch.runPaged({ pageSize: limit });
        var totalTransactionCount = pagedData.count;
        log.debug('totalTransactionCount', totalTransactionCount);

        // Page Index from UI start from 1 whereas when paging in NetSuite it starts from 0.
        if (pageIndex > 0) { pageIndex--; }
        if (pageIndex < 0) { pageIndex = 0; }
        log.debug('pageIndex a4', pageIndex);

        if (totalTransactionCount > 0) {
            var page = pagedData.fetch({ index: pageIndex });
            page.data.forEach(function (result) { transactionSearchResults.push(result); });
            log.debug("transactionSearchResults", transactionSearchResults);
            transactionSearch = transactionSearchResults;
        } else {
            transactionSearch = [];
        }


        // Traversing through the search result to create the JSON Data.
        for (var loop1 = 0; loop1 < transactionSearch.length; loop1++) {
            var sublistId = loop1;
            var bill = transactionSearch[loop1].id;
            var billURL = '';
            var transactionType = transactionSearch[loop1].getValue({
                name: 'type'
            });
            var dueDate = transactionSearch[loop1].getValue({
                name: 'duedate'
            });
            var payee = transactionSearch[loop1].getValue({
                name: 'entity'
            });
            var payeeName = transactionSearch[loop1].getText({
                name: 'entity'
            });
            var billAmount = transactionSearch[loop1].getValue({
                name: 'fxamount'
            });
            var transactionnumber = transactionSearch[loop1].getValue({
                name: 'transactionnumber'
            });
            var approvalStatus = transactionSearch[loop1].getText({
                name: 'custentity_ci_adv_as',
                join: 'vendor'
            }); // Umar has Updated on 5th Oct 2026
            var vendorBillRecord;
            if (transactionnumber && transactionnumber.indexOf('VENDBILL') === 0) {
                // Process only Vendor Bills here
                log.debug({
                    title: 'Vendor Bill Found',
                    details: 'Transaction Number: ' + transactionnumber
                });
                vendorBillRecord = record.load({
                    type: record.Type.VENDOR_BILL,
                    id: bill,
                    isDynamic: true
                });

                var totalTaxAmountvalue = vendorBillRecord.getValue({
                    fieldId: 'taxtotal'
                });

                var totalDiscountvalue = vendorBillRecord.getValue({
                    fieldId: 'discountamount'
                });
                if (totalTaxAmountvalue > 0) {
                    var totalTaxAmount = totalTaxAmountvalue.toFixed(2);
                }
                else {
                    var totalTaxAmount = "0.00";
                }
                if (totalDiscountvalue > 0) {
                    var totalDiscount = totalDiscountvalue.toFixed(2);
                }
                else {
                    var totalDiscount = "0.00";
                }
                log.debug({
                    title: 'Transaction Totals Found via Record Load',
                    details: 'Tax: ' + totalTaxAmount + ' | Discount: ' + totalDiscount
                });

            }
            if (transactionnumber && transactionnumber.indexOf('VENDCRED') === 0) {
                // Process only Vendor Bills here
                log.debug({
                    title: 'Vendor bill credit Found',
                    details: 'Transaction Number: ' + transactionnumber
                });

                var totalTaxAmount = "0.00";

                var totalDiscount = "0.00";
            }

            var amountRemaining = transactionSearch[loop1].getValue({
                name: 'fxamountremaining'
            });
            if (!isEmpty(amountRemaining)) {
                amountRemaining = parseFloat(amountRemaining).toFixed(2);
            }
            else {
                amountRemaining = '';
            }
            var paymentAmount = amountRemaining;
            var currency = transactionSearch[loop1].getValue({
                name: 'symbol',
                join: 'currency'
            });
            var currencyId = transactionSearch[loop1].getValue({
                name: 'currency'
            });
            var referenceNumber = transactionSearch[loop1].getValue({
                name: 'tranid'
            });
            var invoiceDate = transactionSearch[loop1].getValue({
                name: 'trandate'
            });
            var memo = transactionSearch[loop1].getValue({
                name: 'memo'
            });
            log.debug("payee and subsidiary", payee + " " + subsidiary);

            var paymentProfileName = '';
            var paymentProfileSearch = search.create({
                type: 'customrecord_ci_adv_entity_bank_details',
                filters: [
                    ['custrecordci_adv_details', 'is', payee], 'AND', ['custrecord_ci_adv_primary_account', 'is', 'T']/* ,
				'AND',
         ['custrecord_ci_adv_profile_name.isinactive', 'is', 'F'] */
                ],
                columns: ['custrecord_ci_adv_profile_name']
            }).run().getRange(0, 999);
            log.debug(logTitle, 'paymentProfileSearch length - ' + paymentProfileSearch.length);
            log.debug(logTitle, 'paymentProfileSearch - ' + JSON.stringify(paymentProfileSearch));

            var paymentProfileID = '', profId = '';
            for (var loop3 = 0; loop3 < paymentProfileSearch.length; loop3++) {
                paymentProfileID = paymentProfileSearch[loop3].id;
                paymentProfileName = paymentProfileSearch[loop3].getText({
                    name: 'custrecord_ci_adv_profile_name'
                });
                profId = paymentProfileSearch[loop3].getValue({
                    name: 'custrecord_ci_adv_profile_name'
                });
                log.debug(" paymentProfileId", paymentProfileId + '  profId: ' + profId);
            }
            //  STd validation check by rag
            var stdValidData = {
                stdFlag: false,
                stdValidAlert: []
            };
            log.debug("subsidiary and paymentProfileId", subsidiary + " " + profId);

            if (subsidiary && profId) {
                log.debug("subsidiary and paymentProfileId", subsidiary + " " + profId);

                stdValidData = checkStdValidation(payee, profId, subsidiary, record, log, search, xml);
            }
            // check WHT Validation by RAG 
            // check  WHT used for WHT Validation by RAG //  'custcol_4601_witaxapplies'
            var whtValidationObj = checkWHTValidation(vendorBillRecord, record, log, search);
            log.debug('WHT Validation Response : ', JSON.stringify(whtValidationObj));

            if(whtValidationObj.whtFlag)
            {
                log.debug('whtValidationObj.whtValidAlert', whtValidationObj.whtValidAlert);
                var errors = whtValidationObj.whtValidAlert.split('\n');
                var xArray = [];

                log.debug('stdValidData.stdFlag', stdValidData.stdFlag );
                // add wht errors 
                 if(stdValidData.stdFlag) 
                {
                 xArray = stdValidData.stdValidAlert;
                 }else{ // no std errors found but wht found so update stdValidData with wht errors
                    xArray.push('Please review the following fields before proceeding:');
                    stdValidData.stdFlag = true;
                }
                // now update stdValidData with wht errors
                 for (var i = 0; i < errors.length; i++) {
                    if (errors[i] && errors[i].trim() != '') {
                        xArray.push(errors[i]);
                    }
                }
                stdValidData.stdValidAlert = xArray;
            }// update stdvalidData only if wht errors found

            //...end

            log.debug("stdValidData 1504 WHT Validation added : ", stdValidData);

            // end of std validation check by rag
            var paymentProfileNames = []; // new variable to store all profiles
            var paymentProfileList = [];

            var paymentProfileSearch = search.create({
                type: 'customrecord_ci_adv_entity_bank_details',
                filters: [
                    ['custrecordci_adv_details', 'is', payee]/* ,
				'AND',
         ['custrecord_ci_adv_profile_name.isinactive', 'is', 'F'] */
                ],
                columns: ['custrecord_ci_adv_profile_name']
            }).run().getRange(0, 999);

            //log.debug(logTitle, 'paymentProfileSearch length - ' + paymentProfileSearch.length);

            for (var loop3 = 0; loop3 < paymentProfileSearch.length; loop3++) {
                var paymentProfileID = paymentProfileSearch[loop3].getValue({
                    name: 'custrecord_ci_adv_profile_name'
                });

                var profileName = paymentProfileSearch[loop3].getText({
                    name: 'custrecord_ci_adv_profile_name'
                });
                if (profileName) {
                    var profObj = {
                        id: paymentProfileID,
                        name: profileName
                    }
                }

                if (profileName) {
                    paymentProfileNames.push(profileName);
                    paymentProfileList.push(profObj);

                }
            }
            // log.debug("paymentProfileNames: 2215",paymentProfileNames); 
            // log.debug("paymentProfileList: 2215",paymentProfileList); 


            var billPoNum = transactionSearch[loop1].getValue({
                name: 'tranid',
                join: 'createdfrom'
            });
            /* var totalDiscount = transactionSearch[loop1].getValue({
                name: 'custbody_ci_adv_bill_discount_amount'
            });
            var totalTaxAmount = transactionSearch[loop1].getValue({
                name: 'custbody_ci_adv_bill_tax_amount'
            }); */
            var locationVal = transactionSearch[loop1].getValue({
                name: 'location'
            });
            var apAccount = transactionSearch[loop1].getValue({
                name: 'account'
            });
            var subsidiary = transactionSearch[loop1].getValue({
                name: 'subsidiary'
            });
            var discountDate = transactionSearch[loop1].getValue({
                name: 'termsdiscountdate'
            });
            var discountValid = false;

            if (!isEmpty(discountDate)) {
                var discDate = format.parse({ value: discountDate, type: format.Type.DATE });
                var curDate = new Date(); curDate.setHours(0, 0, 0, 0);
                if (discDate >= curDate) { discountValid = true; }
            }

            // Updating the amount to be Negative for Vendor Credits.
            if (transactionType == 'VendCred') {
                amountRemaining = -(amountRemaining);
                amountRemaining = parseFloat(amountRemaining).toFixed(2);
                paymentAmount = amountRemaining;
            }

            // Renaming the Transaction Types according to CITI's standard and getting the link for the transactions.
            if (transactionType == 'VendBill') {
                transactionType = 'Bill';
                billURL = 'https://' + url.resolveDomain({
                    hostType: url.HostType.APPLICATION
                }) + url.resolveRecord({
                    recordType: 'vendorbill',
                    recordId: bill,
                    isEditMode: false
                });
            }

            if (transactionType == 'VendCred') {
                transactionType = 'Bill Credit';
                billURL = 'https://' + url.resolveDomain({
                    hostType: url.HostType.APPLICATION
                }) + url.resolveRecord({
                    recordType: 'vendorcredit',
                    recordId: bill,
                    isEditMode: false
                });
            }



            {
                vBillList.push(bill);
                var profileLink;

                var vendorUrl = 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION }) +
                    url.resolveRecord({ recordType: 'vendor', recordId: payee, isEditMode: false });
                if (paymentProfileName == '' || !paymentProfileName) {

                    var domain = 'https://' + url.resolveDomain({
                        hostType: url.HostType.APPLICATION
                    });

                    profileLink = domain + url.resolveScript({
                        scriptId: 'customscript_ci_adv_functional_import_sl',
                        deploymentId: 'customdeploy_ci_adv_functional_import_sl',
                        returnExternalUrl: false,
                        params: {
                            action: 'create',
                            vendorIdvalue: payee,
                            whence: ''
                        }
                    });

                } else {
                    profileLink = '';

                }
                // for profile active
                var inActive;
                var dynamicUrl;
                var finalUrl;
                var paymentProfilelink = search.create({
                    type: 'customrecord_ci_adv_entity_bank_details',
                    filters: [
                        ['custrecordci_adv_details', 'is', payee],
                        'AND',
                        ['custrecord_ci_adv_profile_name.isinactive', 'is', 'T']
                    ],
                    columns: ['custrecord_ci_adv_profile_name']
                }).run().getRange(0, 999);

                //log.debug(logTitle, 'paymentProfilelink length - ' + paymentProfilelink.length);
                if (paymentProfilelink.length > 0) {
                    for (var loop3 = 0; loop3 < paymentProfilelink.length; loop3++) {
                        var paymentProlinkid = paymentProfilelink[loop3].getValue({
                            name: 'custrecord_ci_adv_profile_name'
                        });

                        var profileName = paymentProfilelink[loop3].getText({
                            name: 'custrecord_ci_adv_profile_name'
                        });
                        var domain = 'https://' + url.resolveDomain({
                            hostType: url.HostType.APPLICATION
                        });
                        var customRecordScriptId = "customrecord_ci_adv_pros_profile"
                        dynamicUrl = url.resolveRecord({
                            recordType: customRecordScriptId,
                            recordId: paymentProlinkid,
                            isAbsolute: true // Set to false if you only want relative path: "/app/common/..."
                        });
                        finalUrl = domain + dynamicUrl;

                        log.debug('Generated URL', dynamicUrl);
                        log.debug('Generated finalUrl', finalUrl);
                        inActive = "inActive";

                    }
                }
                else {
                    inActive = '';
                    finalUrl = '';
                }

                sublistData.push({
                    id: loop1,
                    vendor: payee, // payee: 4840
                    vendorName: payeeName, // payee: Delaware Intercorp - 19
                    type: transactionType, // type: Bill
                    billid: bill, // bill: 9287
                    bill: transactionnumber, // bill: 9287
                    billLink: billURL,
                    docNo: referenceNumber, // referenceNumber: 
                    date: invoiceDate, // date: 8/2/2023
                    duedate: dueDate, // dueDate: 9/1/2023
                    // invamount: billAmount, // Updated to show leftover amount after partially paying a bill .
                    invamount: paymentAmount, // billAmount: 169.92 
                    taxamount: totalTaxAmount, // totalTaxAmount: 0
                    // taxamount: "0.00", // totalTaxAmount: 0
                    invoiceDate: invoiceDate,
                    profileType: inActive,
                    //profilerecUrl: finalUrl,
                    paymentProfileName: paymentProfileName, // Payment Profile Name
                    paymentProfileNames: paymentProfileNames,
                    paymentProfiles: paymentProfileList,
                    //whtamount: WHTAmount, // WHTAmount: 7.08
                    whtamount: "0.00", // WHTAmount: 7.08
                    //remamount: amountRemaining, // amountRemaining: 7.22
                    //remamount2: amountRemaining, // amountRemaining: 7.22
                    discount: totalDiscount, // totalDiscount: 3.40
                    // discount: "0.00", // totalDiscount: 3.40
                    discavailable: totalDiscount, // discavailable: 0
                    // discavailable: "0.00", // discavailable: 0
                    discountFlag: discountValid,
                    discDate: discountDate,
                    // discDate: "",
                    disctaken: totalDiscount, // discountTaken: 0
                    // disctaken: "0.00", // discountTaken: 0
                    billcom: memo, // billComment: US19ZZ2
                    ponum: billPoNum, // poNumber: billPoNum
                    currency: currency, // currency: USD
                    apaccount: apAccount, // apAccount: 431
                    location: locationVal, // location: 
                    subsidiary: subsidiary, // subsidiary: 7
                    billcurrency: currencyId, // currencyId: 1
                    profileid: paymentProfileId, // paymentProfileId: 29
                    bankacct: '', // header level Bank Account ID
                    // pageId: pageid_0, // Not Needed
                    // index: 2, // Not Needed
                    paymentAmount: paymentAmount, // paymentAmount: 7.22
                    paymentAmtToApply: paymentAmount, // paymentAmount: 7.22
                    payment: paymentAmount, // paymentAmount: 7.22
                    creditAmount: paymentAmount, // bill credit paymentAmount,
                    vendorLink: vendorUrl,
                    profileLink: profileLink,
                    stdFlag: stdValidData.stdFlag,
                    stdValidAlert: stdValidData.stdValidAlert,
                    approvalStatus: approvalStatus
                });

            }
        }
        var currencySums = {};

        // Loop through the array to add amounts and count occurrences for each currency
        for (var i = 0; i < sublistData.length; i++) {
            var amount = parseFloat(sublistData[i].invamount); // Convert the invamount to a number
            var currency = sublistData[i].currency;

            // If the currency doesn't exist in the object, initialize it
            if (!currencySums[currency]) {
                currencySums[currency] = {
                    totalAmount: 0,
                    count: 0
                };
            }

            // Add the amount to the corresponding currency sum
            currencySums[currency].totalAmount += amount;

            // Increment the count for the corresponding currency
            currencySums[currency].count += 1;
        }

        // Now convert the sums and counts to an array to display them
        var resultArray = [];
        for (var currency in currencySums) {
            resultArray.push({
                currency: currency,
                totalAmount: currencySums[currency].totalAmount,
                count: currencySums[currency].count
            });
        }

        // Sort the array in descending order based on totalAmount
        resultArray.sort(function (a, b) {
            return b.totalAmount - a.totalAmount; // Compare totalAmount for descending order
        });
        var currentUser = runtime.getCurrentUser();
        var targetRoleIdbill = currentUser.role;
        log.debug("targetRoleIdbill", targetRoleIdbill);

        var finalSublistData = {
            //'role': targetRoleIdbill,
            'sublistData': sublistData,
            'finalamountData': resultArray,
            'totalCount': totalTransactionCount,
            'isFeatureInEffect': isFeatureInEffect() // Umar has Updated on 5th Oct 2026
        };
        log.debug(logTitle, 'finalSublistData - ' + JSON.stringify(finalSublistData));
        log.debug({ title: 'getSublistData', details: 'End' });

        return JSON.stringify(finalSublistData);
    }
    catch (err) {
        log.debug("Error", err);
        /* var currentUser = runtime.getCurrentUser();
        var targetRoleIdacc = currentUser.role;
        log.debug("targetRoleIdacc:",targetRoleIdacc)
            var formatErrorName = function(name) {
            if (!name) return "";
            return name
                .toLowerCase()
                .split('_')
                .map(function(word) {
                    return word.charAt(0).toUpperCase() + word.slice(1);
                })
                .join(' ');
        };

        return JSON.stringify({
            error: formatErrorName(err.name), // Format applied here
            role: targetRoleIdacc,
            message: err.message
        }); */
    }
}

function checkWHTValidation(vendorBillRecord, record, log, search) {
    try {
        var errorList = '';
        var rec = vendorBillRecord;
        log.debug('checkWHTValidation || Start || Vendor Bill Record ID', JSON.stringify(rec));
        var currentSubsidiaryId = rec.getValue({ fieldId: 'subsidiary' });
        var currentSubsidiaryCountry = '';

        if (currentSubsidiaryId) {
            var subsidiaryData = search.lookupFields({
                type: search.Type.SUBSIDIARY,
                id: currentSubsidiaryId,
                columns: ['country']
            });
            currentSubsidiaryCountry = subsidiaryData.country[0].value || '';
        }
        log.debug('Current Subsidiary Country', currentSubsidiaryCountry);

        var vendorId = rec.getValue({ fieldId: 'entity' });
        var hasMatchingCustomRecord = false;

        if (vendorId) {
            var customRecSearch = search.create({
                type: 'customrecord_ci_adv_entity_bank_details', // replace with your custom record type
                filters: [
                    ["formulatext: {custrecord_ci_adv_profile_name}", "contains", "TH"],
                    "AND",
                    [["formulatext: {custrecord_ci_adv_profile_name}", "contains", "424"], "OR", ["formulatext: {custrecord_ci_adv_profile_name}", "contains", "425"]],
                    "AND",
                    ["custrecordci_adv_details", "anyof", vendorId],
                    "AND",
                    ["isinactive", "is", "F"]
                ],
                columns: ['internalid']
            });
            var resultCount = customRecSearch.runPaged({ pageSize: 1 }).count;
            hasMatchingCustomRecord = resultCount > 0;

            log.debug('Vendor Custom Record Result Count', 'Result Count: ' + resultCount);
        }
        // need to add search because unable to retrieve WHT amt using record.load
        var isWHT;
        const vendorbillSearchObj = search.create({
            type: "vendorbill",
            settings: [{ "name": "consolidationtype", "value": "ACCTTYPE" }],
            filters:
                [
                    ["type", "anyof", "VendBill"],
                    "AND",
                    ["mainline", "is", "F"],
                    "AND",
                    ["custcol_4601_witaxapplies", "is", "T"],
                    "AND",
                    ["internalid", "anyof", rec.id]
                ],
            columns:
                [
                    search.createColumn({ name: "transactionnumber", label: "Transaction Number" }),
                    search.createColumn({ name: "custcol_4601_witaxapplies", label: "Apply WH Tax?" }),
                    search.createColumn({ name: "entity", label: "Name" }),
                    search.createColumn({
                        name: "entityid",
                        join: "vendor",
                        label: "Name"
                    }),
                    search.createColumn({ name: "internalid", label: "Internal ID" })
                ]
        });
        const whtCount = vendorbillSearchObj.runPaged().count;
        log.debug("WHT tax applied found :: ", whtCount);

        // check condition for WHT validation
        if (currentSubsidiaryCountry === 'TH' && hasMatchingCustomRecord && whtCount > 0) {
            // WHT validation - WHT tax setup for tax point start
            // get withholding tax setup record for current subsidiary country


            // WHT validation - WHT tax setup for tax point end

            // WHT mandatory fields validation start
            log.debug('WHT Validation Passed', 'All conditions met for WHT validation.');
            var fieldPayorCode = rec.getField({ fieldId: 'custbody_ci_adv_wht_payor_code' });
            var fieldTaxForm = rec.getField({ fieldId: 'custbody_ci_adv_tax_form' });
            var fieldWhtFormDetails = rec.getField({ fieldId: 'custbody_ci_adv_wht_form_details' });

            // check condition if the fields are present
            if (fieldPayorCode && fieldTaxForm && fieldWhtFormDetails) {
                // get values for the fields
                var payorCodeValue = rec.getValue({ fieldId: 'custbody_ci_adv_wht_payor_code' });
                var taxFormValue = rec.getValue({ fieldId: 'custbody_ci_adv_tax_form' });
                var whtFormDetailsValue = rec.getValue({ fieldId: 'custbody_ci_adv_wht_form_details' });
                // use consolidated alerts for all fields   
                if (!payorCodeValue || !taxFormValue || !whtFormDetailsValue) {
                    errorList += 'Please fill values for WHT Tax fields under \'CI WHT Details\' tab: WHT Payor Code, WHT Tax Form, WHT Form Details\n';
                    // alert('Please fill values for WHT Tax fields under \'CI WHT Details\' tab: WHT Payor Code, WHT Tax Form, WHT Form Details');
                    // return false;  // Prevent the record from saving
                    fieldPayorCode.isMandatory = true;
                    fieldTaxForm.isMandatory = true;
                    fieldWhtFormDetails.isMandatory = true;
                }

            }
            // WHT mandatory fields validation start
            // WHT validation - multiple tax codes start
            // check if multiple tax codes are used in the transaction
            var itemLineCount = rec.getLineCount({ sublistId: 'item' });

            var expenseLineCount = rec.getLineCount({ sublistId: 'expense' });
            log.debug('Item Line Count:', itemLineCount);
            log.debug('Expense Line Count:', expenseLineCount);
            var itemTaxCodesSet ='';// new Set();
            var expTaxCodesSet = ''; //new Set();
            var multiFlag = false;

            for (var i = 0; i < itemLineCount; i++) {
                var taxCode = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_4601_witaxcode', line: i });
                log.debug('Item Line ' + i + ' Tax Code:', taxCode);
                if (taxCode && itemTaxCodesSet.indexOf(taxCode) === -1) {
                    //add comma only if the string is not empty to separate multiple tax codes
                    if(itemTaxCodesSet !== '')
                        itemTaxCodesSet += ','  + taxCode;
                    else
                        itemTaxCodesSet += taxCode;
                }
            }

            for (var j = 0; j < expenseLineCount; j++) {
                var taxCode = rec.getSublistValue({ sublistId: 'expense', fieldId: 'custcol_4601_witaxcode', line: j });
                log.debug('Expense Line ' + j + ' Tax Code:', taxCode);

                 if (taxCode && expTaxCodesSet.indexOf(taxCode) === -1) {
                    //add comma only if the string is not empty to separate multiple tax codes
                    if(expTaxCodesSet !== '')
                        expTaxCodesSet += ','  + taxCode;
                    else
                        expTaxCodesSet += taxCode;
                }
            }
            log.debug('Item Tax Codes Set:', itemTaxCodesSet);
            log.debug('Expense Tax Codes Set:', expTaxCodesSet);
            var itemTaxArray = itemTaxCodesSet.split(',').filter(Boolean);
            var expTaxArray = expTaxCodesSet.split(',').filter(Boolean);
            log.debug('Item Tax Codes Array:', itemTaxArray);
            log.debug('Expense Tax Codes Array:', expTaxArray);

            if (itemTaxArray.length > 1 || expTaxArray.length > 1) {
                errorList += 'Multiple WHT tax codes are not supported. Please ensure only one WHT tax code is used';
                // alert('Multiple WHT tax codes are not supported. Please ensure only one WHT tax code is used.');
                //return false;  // Prevent the record from saving
            }

            // WHT validation - multiple tax codes end

        } // WHT mandatory fields validation end
         else if(currentSubsidiaryCountry === 'TH' && hasMatchingCustomRecord && whtCount <= 0) {
             var payorCodeValue = rec.getValue({ fieldId: 'custbody_ci_adv_wht_payor_code' });
                var taxFormValue = rec.getValue({ fieldId: 'custbody_ci_adv_tax_form' });
                var whtFormDetailsValue = rec.getValue({ fieldId: 'custbody_ci_adv_wht_form_details' });

                if (payorCodeValue || taxFormValue || whtFormDetailsValue)
                    errorList += 'Please remove data from WHT Tax fields under \'CI WHT Details\' tab: WHT Payor Code, WHT Tax Form, WHT Form Details';
        }
        if (errorList !== '') {
            return {
                whtFlag: true,
                whtValidAlert: errorList
            };
        }
        return {
            whtFlag: false,
            whtValidAlert: []
        };

    } catch (e) {
        log.debug("Error in checkWHTValidation function: ", e);
        return null;
    }
}
// new function added by RAG to get country from vendor
function getVendorAddressCountry(payee, record) {
    try {
        var vendorRec = record.load({
            type: record.Type.VENDOR,
            id: payee
        });

        var lineCount = vendorRec.getLineCount({
            sublistId: 'addressbook'
        });
        var defBillFound = false;
        var country;
        if (lineCount == 0 && !lineCount) {
            log.debug('');
            return {
                addLineCount: 0, /// to identify no line found // 2nd
                vendCountry: null,
                isDefBill: null
            }
        }

        for (var i = 0; i < lineCount; i++) {
            var addressSubrecord = vendorRec.getSublistSubrecord({
                sublistId: 'addressbook',
                fieldId: 'addressbookaddress',
                line: i
            });
            var defBill = vendorRec.getSublistValue({
                sublistId: 'addressbook',
                fieldId: 'defaultbilling',
                line: i
            });
            if (defBill) {
                defBillFound = true;
                var country = addressSubrecord.getValue({
                    fieldId: 'country'
                });
                log.debug(' getVendorAddressCountry | Country', country);
                return {
                    addLineCount: lineCount,
                    vendCountry: country,    // got country validate // 1st
                    isDefBill: defBill
                }
                // loop will break and return the output
            }
        } // address loop 
        if (!defBillFound) {
            return {
                addLineCount: lineCount, // line != 0 && !ctry && isDefNill == false // 3rd
                vendCountry: null,
                isDefBill: defBillFound
            }
        }
    } catch (e) {
        log.debug("Error in getVendorAddressCountry function: ", e);
    }
}

function checkStdValidation(payee, paymentProfileID, subsidiary, record, log, search, xml) {
    try {
        log.debug("checkStdValidation 1791", paymentProfileID + ": " + subsidiary);

        var errorMsgArray = [];
        var stdFlag = false;
        var hasFormatError = false;
        // get field validators
        var validators = getValidatorsForProfile(paymentProfileID, search, log, xml);
        log.debug("Validators for profile ", paymentProfileID + ": " + validators);

        // Load subsidiary check address
        var subsidiaryRec = record.load({
            type: record.Type.SUBSIDIARY,
            id: subsidiary
        });
        var subRec = subsidiaryRec.getSubrecord({
            fieldId: 'mainaddress'
        });
        validators = JSON.parse(validators);
        log.debug("Validators for profile ", paymentProfileID + ": " + validators);
        for (var fId in validators) {
            log.debug('Checking validators for field', fId);
            var stdFields = "legalname,addr1,addr2,city,zip,state,country";
            // validate only std fields
            if (stdFields.indexOf(fId) == -1) {
                log.debug('Field', fId + 'is not a standard field. Skipping validation.');
                continue;
            }
            var val;
            if (fId === 'legalname') {
                val = subsidiaryRec.getValue({ fieldId: fId });// legal name is company name in vendor record
                log.debug('legal name value from subsidiary record', val);
            }
            else if (fId === 'country') {
                val = getVendorAddressCountry(payee, record);
            }
            else {
                val = subRec.getValue({ fieldId: fId });
                log.debug('value from Address subrecord', val);
            }
            var rules = validators[fId];
            var fieldObj, label;
            if (fId === 'legalname') {
                fieldObj = subsidiaryRec.getField({ fieldId: fId });
                label = (fieldObj && fieldObj.label) ? fieldObj.label : fId;
                label = 'Setup> Company> Subsidiaries> subsidiary>' + label;// to differentiate from same field in main record
                log.debug('fieldid in subsidiary record', fId + ' label ' + label);
            } else if (fId === 'country') {
                var vendCountry = val.vendCountry;
                if (vendCountry)
                    label = 'Vendor> Addresses> Address> Country ';
                else
                    label = 'Vendor> Addresses> Address ';
            } else {
                fieldObj = subRec.getField({ fieldId: fId });
                label = (fieldObj && fieldObj.label) ? fieldObj.label : fId;
                label = 'Setup> Company> Subsidiaries> subsidiary> Addresses> Address> ' + label;
                log.debug('fieldid in address subrecord', fId + ' label ' + label);
            }
            for (var ruleType in rules) {
                log.debug('Validating field', fId, 'with rule', ruleType);
                var msg = validate(val, ruleType, rules[ruleType]);
                if (msg) {
                    if (!hasFormatError) {
                        errorMsgArray.push('Please review the following fields before proceeding:');
                        hasFormatError = true;
                    }
                    errorMsgArray.push(label + ':  ' + msg);
                    break;
                }
            } // rules loop
        }// fields loop
        if (errorMsgArray.length > 0) {
            return {
                stdFlag: true,
                stdValidAlert: errorMsgArray
            };
        } else {
            return {
                stdFlag: false,
                stdValidAlert: errorMsgArray
            };
        }
    } catch (e) {
        log.debug("Error in checkStdValidation function: ", e);
    }
}

function validate(value, type, p) {
    try {
        switch (type) {
            case 'len':
                if (p.minLength && value.length < parseInt(p.minLength))
                    return 'Field length must be at least ' + p.minLength + ' characters';
                if (p.maxLength && value.length > parseInt(p.maxLength))
                    return 'Field length must not exceed ' + p.maxLength + ' characters';
                break;

            case 'fixlen':
                var l1 = p.Length1 ? parseInt(p.Length1, 10) : null;
                var l2 = p.Length2 ? parseInt(p.Length2, 10) : null;
                // calculate length only when value present
                if (value) {
                    var len = value.length;
                    log.debug('current length', len + ' l1 ' + l1 + ' l2 ' + l2);
                    if (l1 !== null && l2 != null && value.length !== l1 && value.length !== l2) {
                        return 'Field length must be either ' + l1 + ' or ' + l2;
                    }
                }
                break;
            case 'num':
                if (!/^[0-9]+$/.test(value))
                    return 'Field must contain numeric values only. Decimals are not allowed';
                break;
            case 'alpha':
                if (!/^[A-Za-z]+$/.test(value))
                    return 'Only alphabets allowed';
                break;
            case 'alphanumeric':
                if (p.pattern && !(new RegExp(p.pattern)).test(value))
                    return 'Field must contain only alphanumeric characters';
                break;
            case 'trim':
                if (p.trimChars) {
                    var trimmed = value.replace(new RegExp('^[' + p.trimChars + ']+|[' + p.trimChars + ']+$', 'g'), '');
                    if (trimmed !== value) return 'Leading/trailing characters not allowed: [' + p.trimChars + ']';
                }
                break;
            case 'suppress':
                if (p.suppressChars) {
                    var suppressed = value.replace(new RegExp('[' + p.suppressChars + ']', 'g'), '');
                    if (suppressed !== value) return 'Field must not contain characters: [' + p.suppressChars + ']';
                }
                break;
            case 'validChars':
                if (p.validChars && !(new RegExp('^[' + p.validChars + ']+$')).test(value))
                    return 'Field must only contain characters: [' + p.validChars + ']';
                break;
            case 'invalidChars':
                if (p.invalidChars && (new RegExp('[' + p.invalidChars + ']')).test(value))
                    return 'Field must not contain characters: [' + p.invalidChars + ']';
                break;
            case 'mandatory':
                if (value === null || value === undefined || value === '')
                    return 'Field is mandatory.';
                break;
            case 'allowedvalue':
                var name = p.value1;
                log.debug('inside validate: ', name + ' values: ' + JSON.stringify(value));
                var vendCountry = value.vendCountry;
                var lineCount = value.addLineCount;
                var defBill = value.isDefBill;

                if (vendCountry) {
                    if (vendCountry !== name) {
                        //return 'Eligible Country for this profile is United Kingdom';
                        return 'The value entered for the selected payment process profile is invalid. Please update vendor country to United Kingdom';
                    }
                } else if (lineCount == 0) {
                    return 'Please add address for this vendor';
                } else {
                    return 'Please select default billing address for this vendor';
                }
                break;
        }
        return '';
    } catch (e) {
        log.debug('Error in validate', e);
        return '';
    }
}

function getValidatorsForProfile(profileValue, search, log, xml) {
    try {
        var validatorDetails;
        search.create({
            type: 'customrecord_ci_adv_pros_profile_temp',
            filters: [['custrecord_ci_adv_pmt_pros_profile', 'is', profileValue]],
            columns: ['custrecord_ci_adv_field_validator_cbd'] // accounts validators
        }).run().each(function (result) {
            validatorDetails = result.getValue('custrecord_ci_adv_field_validator_cbd');// accounts validators
            return false;
        });
        log.debug('getValidatorsForProfile', profileValue + ": " + validatorDetails);
        // Parse XML and convert to JSON here in Suitelet
        if (validatorDetails) {
            var parsed = parseXMLtoJSON(validatorDetails, xml);
            return JSON.stringify(parsed);  // send JSON string to client
        }
        return '{}';
    } catch (e) {
        log.debug('Error in getValidatorsForProfile', e);
        return '{}';
    }
}

/* function parseXMLtoJSON(xmlStr, xml) {
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
        // if (!fieldName || fieldName.indexOf('custpage_') !== 0) return;

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
} */

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
        // if (!fieldName || fieldName.indexOf('custpage_') !== 0) return;

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
// --------------------------------------------------- getPFIData Function -------------------------------------------------------

// getPFIData Function is used to get the Payment File Information values.

function getPFIData(requestParams, search, log, url, runtime, search, record, task) {
    try {
        var pfiDatas = new Array(),
            paymentDetailsData = new Array(),
            selTranDetailsData = new Array(),
            errorDetails = new Array();
        var pfiID = requestParams.pfiID,
            recentlyCreated = requestParams.recentlyCreated,
            vendorPaymentID, filesData = new Array();
        var myTaskStatus, statusInquiryFlag = false,
            pfiJSONString, ttsTaskId, billList = new Array();
        var approvalList = [];
        var splitProfile_names = [];
        var paymentDetailsErrorData = new Array();
        var paymentDetailsErrornewData = new Array();
        var allcurrency = new Array();
        var allPsramount = new Array();
        var billpaymentId = new Array();
        var status = '';
        log.debug("RequestParams of getPFIData :", requestParams);
        var currentUser = runtime.getCurrentUser();
        var employeeId = currentUser.id;
        var userName = currentUser.name;
        //log.debug("employeeId1117",employeeId);
        //log.debug("userName1118",userName);

        log.debug('pfiID', pfiID);

        if (!isEmpty(pfiID)) {
            var batchpfiSearch = search.create({
                type: 'customrecord_ci_adv_pymt_file_info',
                filters: [
                    ['internalid', 'anyof', pfiID]
                ],
                columns: [
                    'custrecord_ci_adv_created_by',
                    'created',
                    'custrecord_ci_adv_file_process_date',
                    'custrecord_ci_adv_gl_bank_acct',
                    'custrecord_ci_adv_no_of_trans_acptd',
                    'custrecord_ci_adv_no_of_trans_rejctd',
                    'custrecord_ci_adv_no_of_trans_pending',
                    'custrecord_ci_adv_transaction_status',
                    'custrecord_ci_adv_no_of_trans',
                    'custrecord_ci_adv_no_of_trans_proc',
                    'custrecord_ci_adv_err_det',
                    'custrecord_ci_adv_file_process_amt',
                    'custrecord_ci_adv_file_subsidiary',
                    'custrecord_ci_adv_json_string',
                    'custrecord_ci_adv_mrs_taskid',
                    'custrecord_ci_adv_pfi_batch_status',
                    'custrecord_ci_adv_payment_tier_status',
                    'custrecord_ci_adv_partial_tier_status',
                    'custrecord_ci_adv_no_of_tran_failed',
                    'custrecord_ci_adv_sel_inv_amt',
                    'custrecord_ci_adv_pfi_base_cury',
                    'custrecord_ci_adv_no_of_tran_acknowledge'
                ]
            });

            var results = batchpfiSearch.run().getRange({ start: 0, end: 1000 });

            if (results.length > 0) {
                for (var i = 0; i < results.length; i++) {

                    var createdBy = results[i].getText('custrecord_ci_adv_created_by');
                    var createdDate = results[i].getValue('created');
                    var processDate = results[i].getValue('custrecord_ci_adv_file_process_date');
                    var glBankAccount = results[i].getText('custrecord_ci_adv_gl_bank_acct');
                    var noOfTransactionsFailed = results[i].getValue('custrecord_ci_adv_no_of_tran_failed') || "0";
                    var noOfTransactionsAccepted = results[i].getValue('custrecord_ci_adv_no_of_trans_acptd') || "0";
                    var noOfTransactionsRejected = results[i].getValue('custrecord_ci_adv_no_of_trans_rejctd') || "0";
                    var noOfTransactionsPending = results[i].getValue('custrecord_ci_adv_no_of_trans_pending') || "0";
                    var noOfTransactionsAckdge = results[i].getValue('custrecord_ci_adv_no_of_tran_acknowledge') || "0";
                    var noOfTransactionsstatus = results[i].getText('custrecord_ci_adv_transaction_status') || "0";
                    var noOfTransactions = results[i].getValue('custrecord_ci_adv_no_of_trans') || "0";
                    var noOfTransactionsProcessed = results[i].getValue('custrecord_ci_adv_no_of_trans_proc') || "0";
                    var scriptErrorDetails = results[i].getValue('custrecord_ci_adv_err_det');
                    var paymentAmount = results[i].getValue('custrecord_ci_adv_file_process_amt');
                    var subsidiary = results[i].getText('custrecord_ci_adv_file_subsidiary');
                    pfiJSONString = results[i].getValue('custrecord_ci_adv_json_string');
                    ttsTaskId = results[i].getValue('custrecord_ci_adv_mrs_taskid');
                    var pfiStatus = results[i].getText('custrecord_ci_adv_pfi_batch_status');
                    var statusTier = results[i].getValue('custrecord_ci_adv_payment_tier_status');
                    var partialstatusTier = results[i].getValue('custrecord_ci_adv_partial_tier_status');
                    var baseCurrency = results[i].getText('custrecord_ci_adv_pfi_base_cury');
                    var invAmounts = results[i].getValue('custrecord_ci_adv_sel_inv_amt');
                    log.debug("baseCurrency:", baseCurrency);
                    log.debug("invAmounts:", invAmounts);
                    var allInvCount = invAmounts ? invAmounts.trim().split(/\s+/) : [];
                    log.debug("allInvCount:", allInvCount);
                    log.debug("allInvCount length:", allInvCount.length);
                    var invCountlength = allInvCount.length;
                    log.debug("invCountlength:", invCountlength);
                    var proceesedCount;
                    var acknowledgeCount;
                    if (noOfTransactionsstatus == "In Progress") {
                        noOfTransactionsPending = String(Number(invCountlength));
                    }
                    if (noOfTransactionsstatus == "Acknowledged") {
                        acknowledgeCount = String(Number(invCountlength) - (Number(noOfTransactionsProcessed) + Number(noOfTransactionsRejected)));
                    }
                    log.debug("acknowledgeCount:", acknowledgeCount);
                    log.debug("noOfTransactionsAckdge:", noOfTransactionsAckdge);
                    if (!acknowledgeCount) {
                        acknowledgeCount = String(Number(noOfTransactionsAckdge));
                    }
                    log.debug("acknowledgeCount1806:", acknowledgeCount);
                    if (noOfTransactionsstatus == "Processed") {
                        proceesedCount = "1";
                    } else {
                        proceesedCount = "0";
                    }
                    /* if(noOfTransactionsstatus == "Acknowledge"){
                         acknowledgeCount = "1";
                    }else{
                        acknowledgeCount = "0";
                    } */
                    log.debug("partialstatusTier:", partialstatusTier);
                    if ((noOfTransactionsstatus == "Rejected") && (noOfTransactionsFailed == 0) && (noOfTransactionsAccepted == 0) && (noOfTransactionsRejected == 0) && (noOfTransactionsPending == 0) && (noOfTransactionsProcessed == 0)) {
                        noOfTransactionsRejected = noOfTransactions;
                    }
                    if ((noOfTransactionsstatus == "Failure - Not Acknowledged") && (noOfTransactionsFailed == 0) && (noOfTransactionsAccepted == 0) && (noOfTransactionsRejected == 0) && (noOfTransactionsPending == 0) && (noOfTransactionsProcessed == 0)) {
                        noOfTransactionsFailed = noOfTransactions;
                    }
                    /*  if(partialstatusTier == 'PART' || statusTier == "ACSP" || statusTier == "ACCP" || statusTier == "ACTC" || statusTier == "PDNG" || statusTier == "RJCT" || statusTier == "FAIL")
                    {
                         pfiStatus = "Processed"
                    }
                    if(partialstatusTier == "ACKD" && !statusTier){
                         pfiStatus = "Generated"
                    } */

                    /* if(noOfTransactionsFailed > 0 || noOfTransactionsAccepted > 0 || noOfTransactionsRejected > 0 || noOfTransactionsPending > 0 || noOfTransactionsProcessed > 0 ){
                            pfiStatus = "Processed"
                     }
                     if(partialstatusTier == "ACKD" && noOfTransactionsFailed == 0 && noOfTransactionsAccepted == 0 && noOfTransactionsRejected == 0 &&  noOfTransactionsPending == 0 && noOfTransactionsProcessed == 0 ){
                        pfiStatus = "Generated" 
                     } */
                    if (pfiStatus == "Initiated" && noOfTransactionsstatus == "In Progress") {
                        pfiStatus = "Initiated"
                    }
                    if (pfiStatus == "Generated" && noOfTransactionsstatus == "In Progress") {
                        pfiStatus = "Generated"
                    }
                    if (pfiStatus == "Generated" && noOfTransactionsstatus == "Acknowledged") {
                        pfiStatus = "Generated"
                    }
                    if ((pfiStatus == "Generated") && (noOfTransactionsstatus == "Failure - Not Acknowledged" || noOfTransactionsstatus == "Partially Acknowledged" || noOfTransactionsstatus == "Pending" || noOfTransactionsstatus == "Processed" || noOfTransactionsstatus == "Rejected" || noOfTransactionsstatus == "Partially Processed")) {
                        pfiStatus = "Processed"
                    }

                    if (pfiStatus == "Failure - Not Generated") {
                        pfiStatus = "Failure - Not Generated";
                        noOfTransactionsPending = "0";
                    }


                    if (!isEmpty(createdDate)) {
                        createdDate = createdDate.substring(0, createdDate.indexOf(" "));
                    }



                    pfiDatas.push({
                        internalID: pfiID,
                        id: pfiID,
                        createdBy: createdBy,
                        // createdDate: createdDate,
                        createdDate: processDate,
                        subsidiary: subsidiary,
                        date: processDate,
                        userName: userName,
                        noOfTransactions: noOfTransactions,
                        noOfTranProcessed: noOfTransactionsProcessed,
                        noOfTranAccepted: noOfTransactionsAccepted,
                        noOfTranRejected: noOfTransactionsRejected,
                        noOfTranPending: noOfTransactionsPending,
                        noOfTranFailed: noOfTransactionsFailed,
                        //noOfTranProcessed: proceesedCount,
                        noOfTranAcknowledge: acknowledgeCount,
                        glBankAccount: glBankAccount,
                        paymentAmount: paymentAmount,
                        noerrorDetails: scriptErrorDetails,
                        status: pfiStatus
                    });
                    if ((pfiStatus == "Failure - Not Generated") || (scriptErrorDetails)) {
                        paymentDetailsErrornewData.push({
                            'scriptErrorDetails': "Failure - Not Generated"
                        });
                    }

                    // Executing the code only when the pfiJSONString is not empty.
                    if (!isEmpty(pfiJSONString)) {
                        pfiJSONString = JSON.parse(pfiJSONString);
                    }
                }
            }

            log.debug('pfiData', pfiData);

            log.debug('pfiJSONString', JSON.stringify(pfiJSONString));
            log.debug('ttsTaskId', ttsTaskId);

            try {
                // Getting the Payment Details from Vendor Payment record.
                var vendorPaymentSearchObj = search.create({
                    type: 'vendorpayment',
                    filters: [
                        ['type', 'anyof', 'VendPymt'], 'AND', ['custbody_ci_adv_batch_id', 'anyof', pfiID], 'AND', ['mainline', 'is', 'T']
                    ],
                    columns: [search.createColumn({
                        name: 'trandate',
                        label: 'Date'
                    }),
                    search.createColumn({
                        name: 'type',
                        label: 'Type'
                    }),
                    search.createColumn({
                        name: 'entityid',
                        join: 'vendor',
                        label: 'Name'
                    }),
                    search.createColumn({
                        name: 'amount',
                        label: 'Amount'
                    }),
                    search.createColumn({
                        name: 'memo',
                        label: 'Memo'
                    }),
                    search.createColumn({
                        name: 'symbol',
                        join: 'Currency',
                        label: 'Symbol'
                    }),
                    search.createColumn({
                        name: 'custbody_ci_adv_trans_stat',
                        label: 'File Status1'
                    }),
                    //search.createColumn({ name: 'custbody_native_is_status_enquiry', label: 'Status Enquiry' }),
                    search.createColumn({
                        name: 'custbody_ci_adv_file_comments',
                        label: 'File Comments1'
                    }),

                    search.createColumn({
                        name: 'creditfxamount',
                        label: 'Amount (Credit) (Foreign Currency)'
                    })
                    ]
                });

                vendorPaymentSearchObj = getFullResultSet(vendorPaymentSearchObj);
                log.debug("vendorPaymentSearchObj :", vendorPaymentSearchObj);
            } catch (e) {
                //log.debug("Error :",e);
            }

            try {
                if (!isEmpty(vendorPaymentSearchObj)) {
                    for (var loop2 = 0; loop2 < vendorPaymentSearchObj.length; loop2++) {
                        var internalID = vendorPaymentSearchObj[loop2].id;
                        //log.debug("3185",internalID);

                        var date = vendorPaymentSearchObj[loop2].getValue({
                            name: 'trandate'
                        });
                        var type = vendorPaymentSearchObj[loop2].getText({
                            name: 'type'
                        });
                        var vendor = vendorPaymentSearchObj[loop2].getValue({
                            name: 'entityid',
                            join: 'vendor'
                        });
                        var amount = vendorPaymentSearchObj[loop2].getValue({
                            name: 'creditfxamount'
                        });
                        var memo = vendorPaymentSearchObj[loop2].getValue({
                            name: 'memo'
                        });
                        var currency = vendorPaymentSearchObj[loop2].getValue({
                            name: 'symbol',
                            join: 'Currency'
                        });
                        status = vendorPaymentSearchObj[loop2].getText({
                            name: 'custbody_ci_adv_trans_stat'
                        });
                        var comments = vendorPaymentSearchObj[loop2].getValue({
                            name: 'custbody_ci_adv_file_comments'
                        });
                        //var comments = vendorPaymentSearchObj[loop2].getValue({ name: 'custbody_xor_pay_cua_comments_sdf' });
                        allcurrency.push(currency);
                        if (amount < 1) {
                            amount = "0" + amount;
                        } else {
                            amount = amount;
                        }
                        //log.debug("3081",amount);
                        allPsramount.push(amount);
                    }
                    var pfiData = search.lookupFields({
                        type: "customrecord_ci_adv_pymt_file_info",
                        id: pfiID,
                        columns: ['custrecord_ci_adv_transaction_status', 'custrecord_ci_adv_file_process_amt']
                    });
                    var tranStatusval = pfiData.custrecord_ci_adv_transaction_status[0].text || " ";
                    var tranAmount = pfiData.custrecord_ci_adv_file_process_amt;
                    log.debug("tranStatusval:", tranStatusval);
                    log.debug("tranAmount:", tranAmount);
                    log.debug("allcurrency:", allcurrency);
                    paymentDetailsData.push({
                        amount: tranAmount,
                        currency: allcurrency[0],
                        status: tranStatusval
                    });

                    log.debug('paymentDetailsData :', paymentDetailsData);
                }
                else {
                    var pfiData = search.lookupFields({
                        type: "customrecord_ci_adv_pymt_file_info",
                        id: pfiID,
                        columns: ['custrecord_ci_adv_transaction_status']
                    });
                    var tranStatusval = pfiData.custrecord_ci_adv_transaction_status[0].text || " ";
                    log.debug("tranStatusval:", tranStatusval);

                    paymentDetailsData.push({
                        amount: '',
                        currency: '',
                        status: tranStatusval
                    });

                }
            } catch (e) {
                //log.debug("Error :",e);
            }


            // Code to get the list of the bills to be shown in the Selected Transaction Details.
            // Executing the code only when the pfiJSONString is not empty.
            try {
                if (!isEmpty(pfiJSONString)) {
                    //log.debug("3075");
                    for (var loop4 = 0; loop4 < pfiJSONString.length; loop4++) {
                        var billDetails = pfiJSONString[loop4].billDetails;

                        for (var loop5 = 0; loop5 < billDetails.length; loop5++) {
                            var billId = billDetails[loop5].billid;
                            billList.push(billId);
                        }
                    }
                }
            } catch (e) {
                //log.debug("Error: ",e);
            }
            try {

                var batchSearch = search.create({
                    type: 'customrecord_ci_adv_bill_batch_det',
                    filters: [
                        ['custrecord_ci_adv_batch_id', 'is', pfiID]
                    ],
                    columns: ['internalid', 'custrecord_ci_adv_parent_bill_det', 'custrecord_ci_adv_batch_level_status', 'custrecord_ci_adv_bill_profile_name', 'custrecord_ci_adv_vendor_pmt_det_tex', 'custrecord_ci_adv_bat_file_sts', 'custrecord_ci_adv_batch_comments', 'custrecord_ci_adv_file_cmts', 'custrecord_ci_adv_bill_payment_amount']
                });

                var result = batchSearch.run().getRange({ start: 0, end: 1000 });
                log.debug("result", result);
                log.debug("result length", result.length);

                if (result.length > 0) {
                    for (var k = 0; k < result.length; k++) {
                        log.debug("k", k);

                        var batchDetailsId = result[k].getValue('internalid');
                        var batchBillId = result[k].getValue('custrecord_ci_adv_parent_bill_det');
                        var batchStatus = result[k].getText('custrecord_ci_adv_bat_file_sts');
                        var batchComments = result[k].getValue('custrecord_ci_adv_file_cmts');
                        var batchackComments = result[k].getValue('custrecord_ci_adv_batch_comments');
                        var batchRandomid = result[k].getValue('custrecord_ci_adv_vendor_pmt_det_tex');
                        var profileName = result[k].getValue('custrecord_ci_adv_bill_profile_name');
                        var batchLevelstatus = result[k].getValue('custrecord_ci_adv_batch_level_status');
                        var batchLevelAmount = result[k].getValue('custrecord_ci_adv_bill_payment_amount');
                        if (batchackComments) {
                            batchComments = batchackComments;
                        }
                        else {
                            batchComments = batchComments;
                        }
                        log.debug("batchBillId:", batchBillId);
                        log.debug("batchComments:", batchComments);
                        log.debug("batchRandomid:", batchRandomid);
                        log.debug("profileName:", profileName);
                        log.debug("batchLevelstatus:", batchLevelstatus);
                        if (!batchStatus) {
                            batchStatus = batchLevelstatus
                        }


                        if (isEmpty(batchBillId)) {
                            log.debug('Skipping record ' + k, 'batchBillId is empty');
                            continue;
                        }


                        var recordType = 'vendorbill';
                        try {
                            var typeLookup = search.lookupFields({
                                type: 'transaction',
                                id: batchBillId,
                                columns: ['type']
                            });
                            if (typeLookup && typeLookup.type && typeLookup.type.length > 0) {
                                if (typeLookup.type[0].value === 'VendCred') {
                                    recordType = 'vendorcredit';
                                }
                            }
                        } catch (typeErr) {
                            log.debug('Could not determine type for bill ' + batchBillId, typeErr);
                        }


                        var pfiData = {};
                        try {
                            pfiData = search.lookupFields({
                                type: recordType,
                                id: batchBillId,
                                columns: ['amount', 'fxamount', 'type', 'currency', 'transactionnumber',
                                    'entity', 'custbody_ci_ad_bill_prof_name', 'currency.symbol', 'tranid']
                            });
                        } catch (lookupErr) {
                            log.debug('lookupFields failed for bill ' + batchBillId, lookupErr);
                            continue;
                        }

                        var billValue;
                        var invoiceNo = pfiData.transactionnumber || '';
                        var tranId = pfiData.tranid || '';
                        if (tranId) {
                            billValue = tranId;
                        }
                        else {
                            billValue = invoiceNo;
                        }
                        var vendorName = (pfiData.entity && pfiData.entity.length > 0)
                            ? pfiData.entity[0].text : '';
                        var currency = (pfiData.currency && pfiData.currency.length > 0)
                            ? pfiData.currency[0].text : '';
                        var type = pfiData.type || '';
                        var amount = pfiData.fxamount || 0;
                        var setCurrency = pfiData['currency.symbol'] || '';
                        // var profileName = pfiData.custbody_ci_ad_bill_prof_name || '';

                        // Payment ID lookup
                        var paymentId = null;
                        try {
                            var paymentSearch = search.create({
                                type: search.Type.VENDOR_PAYMENT,
                                filters: [
                                    ['appliedtotransaction.internalid', 'anyof', batchBillId],
                                    'AND',
                                    ['custbody_ci_adv_batch_id', 'is', pfiID]
                                ],
                                columns: ['internalid']
                            });
                            log.debug("paymentSearch", paymentSearch);
                            paymentSearch.run().each(function (res) {
                                paymentId = res.getValue('internalid');
                                return false;
                            });
                        } catch (pmtErr) {
                            log.debug('Payment search failed for bill ' + batchBillId, pmtErr);
                        }

                        log.debug('Bill Payment ID', paymentId);


                        var paymentUrl = '';
                        if (!isEmpty(paymentId)) {
                            paymentUrl = 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION }) +
                                url.resolveRecord({
                                    recordType: 'vendorpayment',
                                    recordId: paymentId,
                                    isEditMode: false
                                });
                        }

                        var billUrl = 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION }) +
                            url.resolveRecord({
                                recordType: recordType,
                                recordId: batchBillId,
                                isEditMode: false
                            });

                        /* var setCurrency;
                            if(currency == "USA"){
                                setCurrency = "USD";
                            }
                            if(currency == "British pound"){
                                setCurrency = "GBP";
                            }
                            if(currency == "Canadian Dollar"){
                                setCurrency = "CAD";
                            }
                            if(currency == "Euro"){
                                setCurrency = "EUR";
                            }
                            if(currency == "Hongkong"){
                                setCurrency = "HKD";
                            } */
                        log.debug("amount:", amount);
                        var billSearch = search.create({
                            type: search.Type.VENDOR_BILL,
                            filters: [
                                ['internalid', 'anyof', batchBillId],
                                'AND',
                                ['mainline', 'is', 'true'] // Crucial to get the body total
                            ],
                            columns: ['fxamountremaining']
                        });

                        var remainingAmount = 0;

                        billSearch.run().each(function (result) {
                            log.debug("result:", result);
                            remainingAmount = parseFloat(result.getValue('fxamountremaining')) || 0;
                            return false; // Stop after the first result
                        });

                        log.debug('Remaining Amount via Search', remainingAmount);
                        log.debug("remainingAmount:", remainingAmount);
                        selTranDetailsData.push({
                            'messageId1': pfiID,
                            'invoiceNo': billValue,
                            'type': type,
                            'billId': batchBillId,
                            'profileName': profileName,
                            'profileid': paymentId,
                            'vendorName': vendorName,
                            'status': batchStatus,
                            'comments': batchComments,
                            'amount': batchLevelAmount,
                            'currency': setCurrency,
                            'linkUrl': billUrl,
                            'paymentUrl': paymentUrl,
                            'endtoendId': batchRandomid
                        });

                        if (batchStatus == "RJCT" || batchStatus == "FAIL") {
                            paymentDetailsErrornewData.push({
                                'scriptErrorDetails': batchComments,
                                'batchRandomid': batchRandomid
                            });
                        }
                    }
                }
                else {
                    var paymentJsonvalue;
                    var paymentJsondata = [];

                    // FIXED: Added missing comma after type string
                    var batchpfiSearch = search.create({
                        type: 'customrecord_ci_adv_pymt_file_info',
                        filters: [
                            ['internalid', 'anyof', pfiID]
                        ],
                        columns: [
                            'custrecord_ci_adv_payment_json_data'
                        ]
                    });

                    var resultsValue = batchpfiSearch.run().getRange({ start: 0, end: 1000 });

                    if (resultsValue.length > 0) {
                        for (var i = 0; i < resultsValue.length; i++) {
                            paymentJsonvalue = resultsValue[i].getValue('custrecord_ci_adv_payment_json_data');
                            paymentJsondata = JSON.parse(paymentJsonvalue);
                        }

                        log.debug("paymentJsondata:", paymentJsondata);

                        for (var r = 0; r < paymentJsondata.length; r++) {
                            selTranDetailsData.push({
                                'messageId1': pfiID,
                                'invoiceNo': paymentJsondata[r].bill,
                                'type': ' ',
                                'billId': paymentJsondata[r].bill,
                                'profileName': paymentJsondata[r].paymentProfileName,
                                'profileid': ' ',
                                'vendorName': paymentJsondata[r].vendorName,
                                'status': ' ',
                                'comments': ' ',
                                'amount': paymentJsondata[r].invamount,
                                'currency': paymentJsondata[r].currency,
                                'linkUrl': paymentJsondata[r].billLink,
                                'paymentUrl': ' ',
                                'endtoendId': ' '
                            });
                        }
                    }
                }

                log.debug('Final Data', selTranDetailsData);

            } catch (e) {
                log.error("Error in Bill Payment Fetch", e);
            }

        }
        /*  log.debug("2235",selTranDetailsData);
         log.debug("allPsramount2585",allPsramount);
         if(selTranDetailsData){
          for (var i = 0; i < selTranDetailsData.length; i++) {
             selTranDetailsData[i].amount = allPsramount[i % allPsramount.length];
         	
           }
         } */
        log.debug("2236", selTranDetailsData);
        var finalData = {
            'userName': userName,
            'pfiData': pfiDatas,
            'paymentDetailsData': paymentDetailsData,
            'paymentDetailsErrornewData': paymentDetailsErrornewData,
            'selTranDetailsData': selTranDetailsData,
        };
        log.debug('finalData :', finalData);
        //log.debug('recentlyCreated', recentlyCreated);

        // Executing the code only when the PFI record is quickly not called after its creation.
        // if(recentlyCreated == false || recentlyCreated == true || recentlyCreated === true)
        {
            log.debug('Inside', 'recently created');
            // Getting the Payment Details.
            var pfiData = search.lookupFields({
                type: "customrecord_ci_adv_pymt_file_info",
                id: pfiID,
                columns: ['custrecord_ci_adv_native_bill_ids', 'custrecord_ci_adv_pfi_batch_status', 'custrecord_ci_adv_err_det']
            });

            var tranBillid = pfiData.custrecord_ci_adv_native_bill_ids;
            var BatchStatus = pfiData.custrecord_ci_adv_pfi_batch_status;
            var BatcherrDtls = pfiData.custrecord_ci_adv_err_det;
            var cleanString = tranBillid.replace(/\u0005/g, ", ");

            var billIdArray = cleanString.split(", ");

            log.debug("cleanString", cleanString);
            log.debug("billIdArray", billIdArray);
            log.debug("BatchStatus", BatchStatus);
            log.debug("BatcherrDtls", BatcherrDtls);
            //var pass_obj = parseInquiryData(pfiJSONString, search);
            var pass_obj = parseInquiryData(billIdArray, search);
            pass_obj.recid = pfiID;
            log.debug('returned pass_obj: ', JSON.stringify(pass_obj));


            // Executing the code only when the task id is not empty.
            if (!isEmpty(ttsTaskId)) {
                myTaskStatus = task.checkStatus({
                    taskId: ttsTaskId
                });
                myTaskStatus = myTaskStatus.status;
                //log.debug('myTaskStatus', myTaskStatus);

                // Updating the status inquiry in PFI record.
                try {
                    var pfiUpdate = record.submitFields({
                        type: 'customrecord_ci_adv_pymt_file_info',
                        id: pfiID,
                        values: {
                            'custrecord_ci_adv_mrs_status': myTaskStatus
                        }
                    });
                } catch (e) {
                    log.debug("Error in submitting Fields to record:", e);
                }

                // Calling the Status Inquiry MR when JSON String is not empty and Status Inquiry is not running in the background.
                if (isEmpty(pass_obj) || pass_obj.flag == 0 || myTaskStatus == 'PENDING' || myTaskStatus == 'PROCESSING') {
                    //log.debug('else condition pass_obj: ', JSON.stringify(pass_obj));
                    //log.debug('MR Status myTaskStatus ', myTaskStatus);
                } else {
                    statusInquiryFlag = true;
                }
            } else {
                statusInquiryFlag = true;
            }

        }


        return JSON.stringify(finalData);
    }
    catch (err) {
        log.debug("Error", err);
        /* var currentUser = runtime.getCurrentUser();
        var targetRoleIdacc = currentUser.role;
        log.debug("targetRoleIdacc:",targetRoleIdacc)
            var formatErrorName = function(name) {
            if (!name) return "";
            return name
                .toLowerCase()
                .split('_')
                .map(function(word) {
                    return word.charAt(0).toUpperCase() + word.slice(1);
                })
                .join(' ');
        };

        return JSON.stringify({
            error: formatErrorName(err.name), // Format applied here
            role: targetRoleIdacc,
            message: err.message
        }); */
    }
}


// --------------------------------------------------- parseInquiryData Function ----------------------------------------------------

// function used to get the parsed data for status inquiry.
// returns = { flag: si_flag, a_pay: a_payment, recid: recid } or null
function parseInquiryData(parsed_json, search) {
    log.debug("parseInquiryData function start");
    var logTitle = "parseInquiryData";
    try {
        var a_payment = new Array(),
            si_flag = 0;
        log.debug(logTitle, 'parseInquiryData : parsed_json.length : ' + parsed_json.length);
        for (var i = 0; i < parsed_json.length; i++) {
            var endid = parsed_json[i];
            // log.debug('parsed_json[i]: ' + i, JSON.stringify(endid));
            //  endid = endid.paymentid;
            // log.debug('EndToEnd ID endid: ', endid + ' i : ' + i);

            if (!isEmpty(endid)) {

                si_flag = 1;
                a_payment.push(endid);
                //}
            } // if only payment id present then seach
        } // loop for all payment objects in PFI record
        var o_payments = {
            flag: si_flag,
            a_pay: a_payment
        }
        log.debug("parseInquiryData function end");
        return o_payments;
    } catch (e) {
        log.audit({
            title: 'Payment Initiation Restlet - ' + 'parseInquiryData',
            details: e.message
        });
        return null;
    }
}

// --------------------------------------------------- createPFIRecord Function -------------------------------------------------------
// removed last param which never used by ragini
// createPFIRecord Function is used to create Payment File Information Record from the UI.
function createPFIRecord(record, requestParams, parameters, format, log, search) {
    log.debug("createPFIRecord function start");
    log.debug("parameters:", parameters);
    var logTitle = "createPFIRecord";
    try {
        log.debug({
            title: 'createPFIRecord',
            details: requestParams
        });
        //log.debug(logTitle,"1256 - "+requestParams);

        // Replacing 'paymentAmtToApply' amount with 'invamount' amount for partial payments.
        for (var loop7 = 0; loop7 < requestParams.length; loop7++) {
            requestParams[loop7].paymentAmtToApply = requestParams[loop7].invamount;
        }

        // Creating the Payment File Information Record.
        var payFileinfo = record.create({
            type: 'customrecord_ci_adv_pymt_file_info',
            isDynamic: true
        });

        // User can create always a future date.
        // PAYMENT DATE/VALUE DATE from Bill Payment Processing UI.
        // Visible only when 'Enable Future Payments' in the CUA Config record 'customrecord_xor_pay_config' is checked.
        /* if (!isEmpty(parameters.paymentDate)) {
            var formattedPaymentDate = format.parse({
                value: parameters.paymentDate,
                type: format.Type.DATE
            });
            payFileinfo.setValue({
                fieldId: 'custrecord_xor_pay_pmt_date',
                value: formattedPaymentDate,
                ignoreFieldChange: true
            });
        } */

        // Bill Payment Processing - Date to be Processed.
        if (!isEmpty(parameters.dateToBeProcessed)) {
            log.debug("date:", parameters.dateToBeProcessed);
            var dateProcessed = parameters.dateToBeProcessed; // 11/27/2024 str
            //log.debug("3723",dateProcessed);
            //var day = dateProcessed.substring(0, 2), month = dateProcessed.substring(3, 5), year = dateProcessed.substring(6);
            //var finalDate = month + '/' + day + '/' + year;// m/d/yyyy
            //var finalDate = day + '/' + month + '/' + year;
            dateProcessed = new Date(format.parse({
                value: dateProcessed,
                type: format.Type.DATE
            }));
            log.debug("dateProcessed:", dateProcessed);


            //log.debug("3727",dateProcessed.getDate());
            //log.debug("3728",dateProcessed.getMonth() + 1);
            //log.debug("3729",dateProcessed.getFullYear());

            var dd_Value = dateProcessed.getDate();
            if (dd_Value < 10) {
                dd_Value = '0' + dd_Value;
            }
            var mm_Value = dateProcessed.getMonth() + 1;
            if (mm_Value < 10) {
                mm_Value = '0' + mm_Value;
            }
            var yy_Value = dateProcessed.getFullYear();

            var preformatedDate = mm_Value + '/' + dd_Value + '/' + yy_Value; // m/d/yyyy
            log.debug("37455", preformatedDate);

            //var finalDate = getPreferenceDate(preformatedDate, format)  /// added by ragini
            //log.debug({ title: logTitle, details: 'finalDate - ' + finalDate });

            //var formattedDate = format.parse({ value: finalDate, type: format.Type.DATE });
            //log.debug({ title: logTitle, details: 'formattedDate - ' + formattedDate });
            var getDatevalue = new Date();
            //log.debug("3754",getDatevalue);

            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_file_process_date',
                value: dateProcessed,
                ignoreFieldChange: true
            });
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_file_create_date',
                value: dateProcessed,
                ignoreFieldChange: true
            });
            //log.debug({ title: logTitle, details: 'date set successfully '+ formattedDate });


        }
        log.debug("3608")


        // Bill Payment Processing - Bank Account Header Level.
        if (!isEmpty(parameters.bankAccountId)) {
            /* payFileinfo.setValue({
               fieldId: 'custrecord_ci_adv_pfi_bank_acc',
               value: 1,
               ignoreFieldChange: false
           });  */
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_gl_bank_acct',
                value: parameters.bankAccountId,
                ignoreFieldChange: false
            });


            /* var pfiData = search.lookupFields({
                type: "customrecord_ci_adv_bank_details_sdf",
                id: parameters.bankAccountId,
                columns: ['custrecord_ci_adv_cbd_bank_acct_sdf']
            });

            var glBankAccount= pfiData.custrecord_ci_adv_cbd_bank_acct_sdf[0].value;
            log.debug("glBankAccount:",glBankAccount);
             payFileinfo.setValue({
            fieldId: 'custrecord_ci_adv_gl_bank_acct',
            value: glBankAccount,
            ignoreFieldChange: false
        }); */

        }

        // Bill Payment Processing - Total Payment Amount Header Level.
        if (!isEmpty(parameters.totalPaymentAmount)) {
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_file_process_amt',
                value: parameters.totalPaymentAmount,
                ignoreFieldChange: true
            });
        }

        // Bill Payment Processing - Subsidiary ID Header Level.
        if (!isEmpty(parameters.subsidiaryId)) {
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_file_subsidiary',
                value: parameters.subsidiaryId,
                ignoreFieldChange: false
            });
        }

        // Classification Tab. Skipped.
        /*if(parameters.locationid) {
            payFileinfo.setValue({ fieldId: 'custrecord_xor_pay_file_location_sdf', value: parameters.locationid, ignoreFieldChange: true });
        }

        // Classification Tab. Skipped.
        if(parameters.departmentid) {
            payFileinfo.setValue({ fieldId: 'custrecord_xor_pay_file_department_sdf', value: parameters.departmentid, ignoreFieldChange: true });
        }

        // Classification Tab. Skipped.
        if(parameters.classid) {
            payFileinfo.setValue({ fieldId: 'custrecord_xor_pay_file_class_sdf', value: parameters.classid, ignoreFieldChange: true });
        }*/
        log.debug({
            title: logTitle,
            details: 'parameters.emailNotificationId - ' + parameters.emailNotificationId
        });

        // Bill Payment Processing - Enable Email Notifications Header Level.
        if (parameters.emailNotificationId == 'F') {
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_pfi_email_notify',
                value: false,
                ignoreFieldChange: true
            });
        } else if (parameters.emailNotificationId == 'T') {
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_pfi_email_notify',
                value: true,
                ignoreFieldChange: true
            });
        }

        // Line Level Data.
        if (!isEmpty(requestParams)) {
            log.debug(logTitle, "1333");
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_json_string',
                value: JSON.stringify(requestParams),
                ignoreFieldChange: true
            });
        } else {
            log.debug(logTitle, "1336");
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_json_string',
                value: '',
                ignoreFieldChange: true
            });
        }


        // 	PFI Status List - Status is Processing [4].

        // setting zero for three fields accepted, rejected, process
        payFileinfo.setValue({
            fieldId: 'custrecord_ci_adv_no_of_trans_proc',
            value: 0,
            ignoreFieldChange: true
        });
        payFileinfo.setValue({
            fieldId: 'custrecord_ci_adv_no_of_trans_acptd',
            value: 0,
            ignoreFieldChange: true
        });
        payFileinfo.setValue({
            fieldId: 'custrecord_ci_adv_no_of_trans_rejctd',
            value: 0,
            ignoreFieldChange: true
        });
        var statusId;
        var transtatusId;

        var statusSearch = search.create({
            type: 'customrecord_ci_adv_pfi_status_list',
            filters: [
                ['name', 'is', 'Initiated']   // replace with your name value
            ],
            columns: ['internalid']
        });

        var result = statusSearch.run().getRange({
            start: 0,
            end: 1
        });

        if (result.length > 0) {
            statusId = result[0].getValue('internalid');
        }
        var transtatusSearch = search.create({
            type: 'customrecord_ci_adv_pfi_status_list',
            filters: [
                ['name', 'is', 'In Progress']   // replace with your name value
            ],
            columns: ['internalid']
        });

        var result = transtatusSearch.run().getRange({
            start: 0,
            end: 1
        });

        if (result.length > 0) {
            transtatusId = result[0].getValue('internalid');
        }

        log.debug('Status Internal ID', statusId);
        log.debug('Trans Status Internal ID', transtatusId);
        if (statusId) {
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_pfi_batch_status',
                value: statusId,
                ignoreFieldChange: true
            });
            payFileinfo.setValue({
                fieldId: 'custrecord_ci_adv_transaction_status',
                value: transtatusId,
                ignoreFieldChange: true
            });
        }

        var recordId = payFileinfo.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });
        log.audit({
            title: 'Payment Initiation Restlet - ' + logTitle + ' - PFI Record',
            details: recordId
        })


        log.audit('Payment Initiation Restlet - ' + logTitle, 'Payment Information file Record created successfully');
        log.debug("createPFIRecord function end");
        return recordId;
    } catch (err) {
        log.audit({
            title: 'Payment Initiation Restlet - ' + 'createPFIRecord Error',
            details: err
        });
        return;
    }
}

//-------------- Convert Date preference format ----------------------- by ragini
function getPreferenceDate(inputDate, format) {
    try {

        //var inputDate = '01/01/2025';
        log.debug('getPreferenceDate', ' inputDate  ' + inputDate);
        var dateArray = inputDate.split('/');
        var day = dateArray[0]
        var month = dateArray[1] - 1
        var year = dateArray[2]
        log.debug('getPreferenceDate ', 'Split Date :: day : ' + day + ' month: ' + month + ' year: ' + year);

        var newDate = new Date();
        newDate.setDate(day);
        newDate.setMonth(month);
        newDate.setFullYear(year);
        log.debug('getPreferenceDate', 'newDate : ' + newDate);

        var formatDate = format.format({
            value: newDate,
            type: format.Type.DATE
        });
        log.debug('getPreferenceDate', ' formatted Date : ' + formatDate);
        return formatDate;
    } catch (e) {
        log.debug('getPreferenceDate: ', 'Exception: ' + JSON.stringify(e));
        return false;
    }
}

// ----------------------------------------------------- getParameterValue Function -----------------------------------------------------

// Function used to return the existing parameters in the requestBody.
function getParameterValue(requestBody) {
    log.debug("getParameterValue function start");
    var parameters = {};

    // Updating the parameters only when the bankAccountId parameter is not empty.
    if (!isEmpty(requestBody.bankAccountId)) {
        parameters.bankAccountId = requestBody.bankAccountId;
    }

    // Updating the parameters only when the apAccountId paramter is not empty.
    if (!isEmpty(requestBody.apAccountId)) {
        parameters.apAccountId = requestBody.apAccountId;
    }

    // Updating the parameters only when the emailNotificationId parameter is not empty.
    if (!isEmpty(requestBody.emailNotificationId)) {
        if (requestBody.emailNotificationId == true) {
            parameters.emailNotificationId = 'T';
        } else {
            parameters.emailNotificationId = 'false';
        }
    }

    // Updating the parameters only when the dateToBeProcessed parameter is not empty.
    if (!isEmpty(requestBody.dateToBeProcessed)) {
        parameters.dateToBeProcessed = requestBody.dateToBeProcessed;
    }

    // Updating the parameters only when the totalCreditAmount parameter is not empty.
    if (!isEmpty(requestBody.totalCreditAmount)) {
        parameters.totalCreditAmount = requestBody.totalCreditAmount;
    }

    // Updating the parameters only when the subsidiaryId paramter is not empty.
    if (!isEmpty(requestBody.subsidiaryId)) {
        parameters.subsidiaryId = requestBody.subsidiaryId;
    }

    // parameters.custpage_total_amt Updating the parameters only when the totalPaymentAmount paramter is not empty.
    if (!isEmpty(requestBody.totalPaymentAmount)) {
        parameters.totalPaymentAmount = requestBody.totalPaymentAmount;
    }
    log.debug("getParameterValue function end");
    return parameters;
}

// ------------------------------------------------ getFinalSublistData Function --------------------------------------------------------

// Function to create the final data required for Bill Payment Processing.
function getFinalSublistData(sublistData, format) {
    try {

        log.debug("getFinalSublistData", 'function start');
        // Traversing through the JSON Data to create the final data required for Bill Payment Processing.
        for (var loop1 = 0; loop1 < sublistData.length; loop1++) {
            var date = sublistData[loop1].date;
            var duedate = sublistData[loop1].duedate;
            var invoiceDate = sublistData[loop1].invoiceDate;
            log.debug('getFinalSublistData', 'date: ' + date + ' duedate: ' + duedate + ' invoiceDate: ' + invoiceDate)
            // Executing the code only when the date is not empty to convert the date to ISO date.
            if (!isEmpty(date)) {
                //sublistData[loop1].date = new Date(date).toISOString();
                sublistData[loop1].date = format.parse({
                    value: date,
                    type: format.Type.DATE
                });
            }

            // Executing the code only when the duedate is not empty to convert the date to ISO date.
            if (!isEmpty(duedate)) {
                //sublistData[loop1].duedate = new Date(duedate).toISOString();
                sublistData[loop1].duedate = format.parse({
                    value: duedate,
                    type: format.Type.DATE
                });
            }

            // Executing the code only when the invoiceDate is not empty to convert the date to ISO date.
            if (!isEmpty(invoiceDate)) {
                //sublistData[loop1].invoiceDate = new Date(invoiceDate).toISOString();
                sublistData[loop1].invoiceDate = format.parse({
                    value: invoiceDate,
                    type: format.Type.DATE
                });
            }
        }
        log.debug("getFinalSublistData function end");
        return sublistData;
    } catch (e) {
        log.audit('Payment Initiation Restlet - ' + "getFinalSublistData ", 'Exception: ' + JSON.stringify(e));
        return;
    }
}

// -------------------------------------------------------- isEmpty Function ------------------------------------------------------------

/**
 * Retrieves the entire result set
 * @param {search.Search} mySearch
 * @returns {Array<search.Result>} searchResults - Returns an array of search results
 */
function getFullResultSet(mySearch) {
    log.debug("getFullResultSet function start");
    var searchResults = [],
        pagedData;
    pagedData = mySearch.runPaged({
        pageSize: 1000
    });
    pagedData.pageRanges.forEach(function (pageRange) {
        var page = pagedData.fetch({
            index: pageRange.index
        });
        page.data.forEach(function (result) {
            searchResults.push(result);
        });
    });
    log.debug("getFullResultSet function end");
    return searchResults;
}

// -------------------------------------------------------- isEmpty Function ------------------------------------------------------------

// Function to check whether the value is empty or not.
function isEmpty(stValue) {
    return ((stValue === '' || stValue === null || stValue === undefined) || (stValue.constructor === Array && stValue.length == 0) || (stValue.constructor === Object && (function (v) {
        for (var k in v) return false;
        return true;
    })(stValue)));
}

// ------------------------------------------------------------- End --------------------------------------------------------------------


// Function to trigger the SFTP Download Scheduled Script.
function triggerSftpDownload(log, task) {

    try {
        log.debug("triggerSftpDownload function start");

        // Trigger first scheduled script (SFTP Download)
        var sftpDownloadTask = task.create({
            taskType: task.TaskType.SCHEDULED_SCRIPT
        });
        sftpDownloadTask.scriptId = 'customscript_ci_adv_pgp_sftp_download';
        sftpDownloadTask.deploymentId = 'customdeploy_ci_adv_sftp_download_manual';
        var sftpDownloadTaskId = sftpDownloadTask.submit();
        log.debug("SFTP Download Scheduled Script triggered successfully. Task ID: " + sftpDownloadTaskId);

        // Trigger second scheduled script
        var secondTask = task.create({
            taskType: task.TaskType.SCHEDULED_SCRIPT
        });
        secondTask.scriptId = 'customscript_ci_adv_in_pgp_sftp_download';       // Replace with your second script ID
        secondTask.deploymentId = 'customdeploy_ci_adv_in_sftp_dwnld_manual'; // Replace with your second deployment ID
        var secondTaskId = secondTask.submit();
        log.debug("Second Scheduled Script triggered successfully. Task ID: " + secondTaskId);

        log.debug("triggerSftpDownload function end");
        return 'Refreshing status is in progress, please wait for some time and refresh the screen.';
    } catch (e) {
        log.audit('Payment Initiation Restlet - triggerSftpDownload', 'Exception: ' + JSON.stringify(e));

        var message = 'We could not start the file download process. Please try again in a few minutes.';

        if (e.name === 'SSS_MISSING_REQD_ARGUMENT') {
            message = 'Required information is missing. Please contact support.';
        } else if (e.name === 'SSS_PERMISSION_VIOLATION') {
            message = 'You do not have permission to perform this action.';
        }

        return message;
    }
}