/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */

/**
 * Approval History API
 *
 * GET:
 *   ?action=getApprovalHistoryCsvData
 *
 * POST:
 *   {
 *      "action": "exportApprovalHistoryExportData",
 *      "status": "All",
 *      "fromDate": "2026-08-01",
 *      "toDate": "2026-08-31"
 *   }
 *
 * Data source:
 *   customrecord_ci_adv_entity_bank_details
 *
 * Approval status:
 *   customrecord_ci_adv_entity_bank_details.custrecord_ci_adv_approval_status
 */

define([
    'N/search',
    'N/query',
    'N/runtime',
    'N/log',
    'N/format',
    'N/file'
], (
    search,
    query,
    runtime,
    log,
    format,
    file
) => {

    const RECORD_TYPE = 'customrecord_ci_adv_entity_bank_details';

    const STATUS_FIELD = 'custrecord_ci_adv_approval_status';

    const REJECTION_REASON_FIELD = 'custrecord_ci_adv_reject_reason';

    const DETAILS_FIELD = 'custrecordci_adv_details';

    const CREATED_BY_FIELD = 'custrecord_ci_adv_createdby';

    const APPROVAL_STATUS_SYSTEM_NOTE_FIELD =
        'CUSTRECORD_CI_ADV_APPROVAL_STATUS';


    /**
     * Entry point
     */
    const onRequest = (context) => {

        try {

            const request = context.request;
            const response = context.response;

            log.debug({
                title: 'Approval History API',
                details: {
                    method: request.method,
                    parameters: request.parameters
                }
            });

            if (request.method === 'GET') {

                handleGet(context);

            } else if (request.method === 'POST') {

                handlePost(context);

            } else {

                writeJson(response, {
                    success: false,
                    message: 'HTTP method not supported.'
                });

            }

        } catch (e) {

            log.error({
                title: 'Approval History API Error',
                details: e
            });

            writeJson(context.response, {
                success: false,
                message: e.name + ': ' + e.message
            });
        }
    };


    /**
     * GET
     *
     * Used by React to load Approval History.
     */
    const handleGet = (context) => {

        const request = context.request;

        const action = request.parameters.action;

        if (action !== 'getApprovalHistoryCsvData') {

            writeJson(context.response, {
                success: false,
                message: 'Invalid action.'
            });

            return;
        }

        const filters = {
            status: request.parameters.status || 'All',
            fromDate: request.parameters.fromDate || '',
            toDate: request.parameters.toDate || ''
        };

        const result = getApprovalHistoryCsvData(filters);

        writeJson(context.response, {
            success: true,
            count: result.length,
            data: result
        });
    };


    /**
     * POST
     *
     * Used by React when Export CSV is clicked.
     */
    const handlePost = (context) => {

       // let requestBody = context.request.body;
	   let requestBody = context.request.parameters.body;
	   requestBody = JSON.parse(requestBody);
        
         log.debug({
            title: 'Approval History Body Data',
            details: requestBody
        });
		
		/*let actionBody = requestBody.action;
		log.debug({
            title: 'Post Action',
            details: actionBody
        }); */
		
        if (!requestBody) {

            writeJson(context.response, {
                success: false,
                message: 'Request body is required.'
            });

            return;
        }
/* 
        if (typeof requestBody === 'string') {
            requestBody = JSON.parse(requestBody);
        } */

        log.debug({
            title: 'Approval History Export Request',
            details: requestBody
        });

        if (requestBody.action !== 'exportApprovalHistoryExportData') {

            writeJson(context.response, {
                success: false,
                message: 'Invalid action.'
            });

            return;
        }

        const filters = {
            status: requestBody.status || 'All',
            fromDate: requestBody.fromDate || '',
            toDate: requestBody.toDate || ''
        };

        const rows = getApprovalHistoryCsvData(filters);

        const csv = buildCsv(rows);

        writeJson(context.response, csv)
            //{
            /* success: true,
            fileName: 'Approval_History.csv',
            contentType: 'text/csv;charset=utf-8',
            count: rows.length, */
            //csv: csv});
    };


    /**
     * Get Approval History records.
     */
    const getApprovalHistoryCsvData = (filters) => {

        const statusIds = getApprovalStatusIds();

        const searchFilters = [];

        /*
         * Only completed approval records.
         *
         * Approved + Rejected
         */
        searchFilters.push([
            STATUS_FIELD,
            search.Operator.ANYOF,
            [
                statusIds.Approved,
                statusIds.Rejected
            ]
        ]);


        /*
         * Optional status filter.
         */
        if (filters.status === 'Approved') {

            searchFilters[0] = [
                STATUS_FIELD,
                search.Operator.ANYOF,
                [statusIds.Approved]
            ];

        } else if (filters.status === 'Rejected') {

            searchFilters[0] = [
                STATUS_FIELD,
                search.Operator.ANYOF,
                [statusIds.Rejected]
            ];
        }


        /*
         * Optional date filter.
         */
        if (filters.fromDate) {

            searchFilters.push('AND');

            searchFilters.push([
                'created',
                search.Operator.ONORAFTER,
                convertIsoDateToNetSuiteDate(filters.fromDate)
            ]);
        }


        if (filters.toDate) {

            searchFilters.push('AND');

            searchFilters.push([
                'created',
                search.Operator.ONORBEFORE,
                convertIsoDateToNetSuiteDate(filters.toDate)
            ]);
        }


        const columns = [

            search.createColumn({
                name: 'internalid'
            }),

            search.createColumn({
                name: 'created',
                sort: search.Sort.DESC
            }),

            search.createColumn({
                name: CREATED_BY_FIELD
            }),

            search.createColumn({
                name: DETAILS_FIELD
            }),

            search.createColumn({
                name: STATUS_FIELD
            }),

            search.createColumn({
                name: REJECTION_REASON_FIELD
            }),

            search.createColumn({
                name: 'custrecord_ci_old_values'
            }),

            search.createColumn({
                name: 'custrecord_ci_edited_values'
            }),
            search.createColumn({
                name: 'custrecord_ci_adv_modified_by'
            }),
            search.createColumn({
                name: 'custrecord_ci_adv_modified'
            }),
            search.createColumn({
                name: 'lastmodified'
            }),
            search.createColumn({
                name: 'lastmodifiedby'
            }),
            search.createColumn({
                name: 'custrecord_ci_adv_modified_by'
            }),
            search.createColumn({
                name: 'custrecord_ci_adv_lastmodified_at'
            })
        ];


        const approvalSearch = search.create({
            type: RECORD_TYPE,
            filters: searchFilters,
            columns: columns
        });


        /*
         * runPaged is used instead of getRange(0, 1000)
         * so the API isn't artificially limited to 1,000 records.
         *
         * NetSuite recommends a deterministic sort when using
         * runPaged.
         */
        const pagedData = approvalSearch.runPaged({
            pageSize: 100
        });


        const history = [];


        pagedData.pageRanges.forEach((pageRange) => {

            const page = pagedData.fetch({
                index: pageRange.index
            });


            page.data.forEach((result) => {

                const recordId = result.getValue({
                    name: 'internalid'
                });
                let requestedAt;
                let requestedBy;
                const modified = result.getValue('custrecord_ci_adv_modified');
                log.debug("Modified", "modified: " + modified);
                if(modified === true || modified === 'T' || modified === null) {
                    requestedAt = result.getValue('custrecord_ci_adv_lastmodified_at');
                    requestedBy = result.getText('custrecord_ci_adv_modified_by');
                }
                else{
                    requestedAt = result.getValue('created');
                    requestedBy = result.getText(CREATED_BY_FIELD);
                }
               /*  const requestedAt = result.getValue({
                    name: 'created'
                }); */


                 /* requestedBy =
                    result.getText({
                        name: CREATED_BY_FIELD
                    }) ||
                    result.getValue({
                        name: CREATED_BY_FIELD
                    }) ||
                    ''; */


                const vendorName =
                    result.getText({
                        name: DETAILS_FIELD
                    }) ||
                    result.getValue({
                        name: DETAILS_FIELD
                    }) ||
                    '';


                const status =
                    result.getText({
                        name: STATUS_FIELD
                    }) ||
                    '';


                const rejectionReason =
                    result.getValue({
                        name: REJECTION_REASON_FIELD
                    }) ||
                    '';


                /*
                 * Get the actual user/time that changed
                 * Approval Status.
                 */
                const actionedInfo =
                    getApprovalStatusSystemNote(recordId);


                history.push({

                    id: recordId,

                    requestedAt: requestedAt || '',

                    requestedBy: requestedBy,

                    vendorName: vendorName,

                    actionedBy: result.getText('lastmodifiedby') || '', //actionedInfo.actionedBy,

                    actionedAt: result.getValue('lastmodified') || '', //actionedInfo.actionedAt,

                    status: status,

                    rejectionReason: rejectionReason,

                    oldValue:
                        result.getValue({
                            name: 'custrecord_ci_old_values'
                        }) || '',

                    newValue:
                        result.getValue({
                            name: 'custrecord_ci_edited_values'
                        }) || ''
                });

            });
        });


        return history;
    };


    /**
     * Find who changed Approval Status and when.
     *
     * Your existing Approval Routing API already uses System Notes
     * for this purpose.
     */
    const getApprovalStatusSystemNote = (recordId) => {

        try {

            const systemNoteSearch = search.create({

                type: RECORD_TYPE,

                filters: [

                    [
                        'internalid',
                        search.Operator.ANYOF,
                        recordId
                    ],

                    'AND',

                    [
                        'systemnotes.field',
                        search.Operator.ANYOF,
                        APPROVAL_STATUS_SYSTEM_NOTE_FIELD
                    ]
                ],

                columns: [

                    search.createColumn({
                        name: 'date',
                        join: 'systemnotes',
                        sort: search.Sort.DESC
                    }),

                    search.createColumn({
                        name: 'name',
                        join: 'systemnotes'
                    }),

                    search.createColumn({
                        name: 'newvalue',
                        join: 'systemnotes'
                    })
                ]
            });


            const result =
                systemNoteSearch.run().getRange({
                    start: 0,
                    end: 1
                });


            if (!result || result.length === 0) {

                return {
                    actionedBy: '',
                    actionedAt: ''
                };
            }


            const row = result[0];


            return {

                actionedAt:
                    row.getValue({
                        name: 'date',
                        join: 'systemnotes'
                    }) || '',

                actionedBy:
                    row.getText({
                        name: 'name',
                        join: 'systemnotes'
                    }) ||
                    row.getValue({
                        name: 'name',
                        join: 'systemnotes'
                    }) ||
                    ''
            };

        } catch (e) {

            log.error({
                title: 'System Note Search Failed - ' + recordId,
                details: e
            });

            return {
                actionedBy: '',
                actionedAt: ''
            };
        }
    };


    /**
     * Get Approved / Rejected custom-list internal IDs.
     *
     * Do not hardcode list IDs.
     */
    const getApprovalStatusIds = () => {

        const result = query.runSuiteQL({
            query: `
                SELECT
                    id,
                    name
                FROM
                    customlist_ci_adv_approval_status
                WHERE
                    name IN ('Approved', 'Rejected')
            `
        }).asMappedResults();


        const statusIds = {
            Approved: null,
            Rejected: null
        };


        result.forEach((row) => {

            if (row.name === 'Approved') {

                statusIds.Approved = String(row.id);

            } else if (row.name === 'Rejected') {

                statusIds.Rejected = String(row.id);
            }
        });


        if (!statusIds.Approved || !statusIds.Rejected) {

            throw new Error(
                'Approved/Rejected approval status IDs could not be found.'
            );
        }


        return statusIds;
    };


    /**
     * Convert:
     *
     * 2026-08-20
     *
     * into the NetSuite user's configured date format.
     */
    const convertIsoDateToNetSuiteDate = (isoDate) => {

        const match =
            /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);


        if (!match) {

            throw new Error(
                'Invalid date. Expected YYYY-MM-DD.'
            );
        }


        const date = new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3])
        );


        return format.format({
            value: date,
            type: format.Type.DATE
        });
    };


    /**
     * Convert JSON rows into CSV.
     */
    const buildCsv = (rows) => {

        const headers = [

            'Requested At',

            'Requested By',

            'Vendor Name',

            'Actioned By',

            'Actioned At',

            'Status',

            'Rejection Reason'
        ];


        const csvLines = [];


        /*
         * UTF-8 BOM helps Excel recognize UTF-8.
         */
        csvLines.push(
            '\uFEFF' +
            headers.map(escapeCsvValue).join(',')
        );


        rows.forEach((row) => {

            csvLines.push([

                row.requestedAt,

                row.requestedBy,

                row.vendorName,

                row.actionedBy,

                row.actionedAt,

                row.status,

                row.rejectionReason

            ].map(escapeCsvValue).join(','));
        });


        return csvLines.join('\r\n');
    };


    /**
     * Proper CSV escaping.
     */
    const escapeCsvValue = (value) => {

        if (
            value === null ||
            value === undefined
        ) {

            return '""';
        }


        const stringValue = String(value);


        return '"' +
            stringValue.replace(/"/g, '""') +
            '"';
    };


    /**
     * JSON response helper.
     */
    const writeJson = (response, data) => {
       /*  response.setHeader({
            name: 'Content-Type',
            value: 'application/json; charset=utf-8'
        }); */
        log.debug({
            title: 'CSV Data',
            details: data
        });
        let fileObj = file.create({name: 'ApprovalHistoryExport.csv',fileType: file.Type.CSV,contents: data});
        response.writeFile({file: fileObj,isInline: false});
        /* response.write({
            output: JSON.stringify(data)
        }); */
    };


    return {
        onRequest: onRequest
    };

});