/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
/**
 * Copyright (c) 2026, Xoriant Corporation and/or its affiliates. All rights reserved.
 *
 * @author 
 * @nameci_adv_sl_billpaymentprocessing.js
 * Script brief description:
 * This Suitelet is used for:
 * Displaying the React UI
 *
 * Revision History:
 *
 * Date              Issue/Case         Author               	Issue Fix Summary
 * =============================================================================================
 * 2026/02/01                                           	    Initial version
 */
define(['N/file', 'N/record', 'N/runtime', 'N/search', 'N/ui/serverWidget', 'N/query'],
	/**
 * @param{file} file
 * @param{record} record
 * @param{runtime} runtime
 * @param{search} search
 * @param{serverWidget} serverWidget
 */
	(file, record, runtime, search, serverWidget, query) => {

		/**
		 * Defines the Suitelet script trigger point.
		 * @param {Object} scriptContext
		 * @param {ServerRequest} scriptContext.request - Incoming request
		 * @param {ServerResponse} scriptContext.response - Suitelet response
		 * @since 2015.2
		 */
		const onRequest = (scriptContext) => {

			//for updating the js and the css file url in the indexbillpayment.html page

			try {

				// Code to restrict use for Developer Role.
				const userObj = runtime.getCurrentUser();
				const devRole = 55;

				if(userObj.role === devRole) {
					const form = serverWidget.createForm({ title: 'Access Denied' });
					form.addField({
						id: 'custpage_message',
						type: serverWidget.FieldType.INLINEHTML,
						label: ' '
					}).defaultValue = '<p style="color: red;">You do not have permission to view this page.</p>';
                
					scriptContext.response.writePage(form);
					return;
				}

				var jsxmlurl = '';
				var cssxmlurl = '';
				var xmljsinternalId = '';
				var cssxmlinternalId = '';
				var folderjsSearchObj = search.create({
					type: 'folder',
					filters: [
						['file.name', 'is', 'index-61podLzv.js']  // Filter by file name
					],
					columns: [
						'name',
						'foldersize',
						search.createColumn({
							name: 'internalid',
							join: 'file'  // Join to the file record to get its internal ID
						}),
						search.createColumn({
							name: 'url',
							join: 'file'  // Join to the file record to get its internal ID
						})
					]
				});
               log.debug("folderjsSearchObj:",folderjsSearchObj);
				var results = folderjsSearchObj.run().getRange(0, 999);  // Adjust range if needed

				// Log the results
				results.forEach(function (result) {
					var folderName = result.getValue('name');
					var folderSize = result.getValue('foldersize');

					xmljsinternalId = result.getValue({ name: 'internalid', join: 'file' });
					jsxmlurl = result.getValue({ name: 'url', join: 'file' });

					log.debug('Folder Name:', folderName);
					log.debug('Folder Size:', folderSize);
					log.debug('jsxmlurl:', jsxmlurl);
					log.debug('File Internal ID:', xmljsinternalId);
				});



				var foldercssSearchObj = search.create({
					type: 'folder',
					filters: [
						['file.name', 'is', 'index-BkkbB5E1.css']  // Filter by file name
					],
					columns: [
						'name',
						'foldersize',
						search.createColumn({
							name: 'internalid',
							join: 'file'  // Join to the file record to get its internal ID
						}),
						search.createColumn({
							name: 'url',
							join: 'file'  // Join to the file record to get its internal ID
						})
					]
				});
               log.debug("foldercssSearchObj:",foldercssSearchObj);
				var results = foldercssSearchObj.run().getRange(0, 999);  // Adjust range if needed

				// Log the results
				results.forEach(function (result) {
					var folderName = result.getValue('name');
					var folderSize = result.getValue('foldersize');

					cssxmlinternalId = result.getValue({ name: 'internalid', join: 'file' });
					cssxmlurl = result.getValue({ name: 'url', join: 'file' });

					log.debug('Folder Name:', folderName);
					log.debug('Folder Size:', folderSize);
					log.debug('cssxmlurl:', cssxmlurl);
					log.debug('File Internal ID:', cssxmlinternalId);
				});






				var folderSearchObj = search.create({
					type: 'folder',
					filters: [
						['file.name', 'is', 'entitlementmanagerprocess.html']  // Filter by file name
					],
					columns: [
						'name',
						'foldersize',
						search.createColumn({
							name: 'internalid',
							join: 'file'  // Join to the file record to get its internal ID
						})
					]
				});
                log.debug("folderSearchObj:",folderSearchObj);
				var results = folderSearchObj.run().getRange(0, 999);  // Adjust range if needed

				results.forEach(function (result) {
					var folderid = result.id;
					log.debug("folderid", folderid);
					var xmlinternalId = result.getValue({ name: 'internalid', join: 'file' });
					var content = file.load(xmlinternalId).getContents()
					log.debug("content", content)
					var urlData = content.split("src=")[1];
					var urlvalue = urlData.split(">")[0];
					log.debug("urlData", urlData);
					log.debug("urlvalue", urlvalue);

					var urlhrefData = content.split("href=")[1];
					var urlhrefvalue = urlhrefData.split(">")[0];
					log.debug("urlhrefData", urlhrefData);
					log.debug("urlhrefvalue", urlhrefvalue);

					var accountId = runtime.accountId
					log.debug("accountId :", accountId)
					if (accountId) {
						if (accountId.indexOf("_") > -1) {
							accountId = accountId.replace("_", "-")
						}
						log.debug('File Internal ID257: ', xmlinternalId + "account Instance : " + accountId.toLowerCase());
					}
					else{
						log.debug("No accountId:");
					}
					var finalxmlurl = 'https://' + accountId + '.app.netsuite.com' + jsxmlurl;
					var finalcssurl = 'https://' + accountId + '.app.netsuite.com' + cssxmlurl;
					log.debug("finalxmlurl", finalxmlurl);
					log.debug("finalcssurl", finalcssurl);
					finalxmlurl = JSON.stringify(finalxmlurl);
					finalcssurl = JSON.stringify(finalcssurl);

					var replacejscontent = content.replace(urlvalue, finalxmlurl)
					//log.debug("1117",replacejscontent);
					var replacecsscontent = replacejscontent.replace(urlhrefvalue, finalcssurl)
					//log.debug("1117",replacecsscontent);


					var fileObj = file.create({
						name: 'entitlementmanagerprocess.html',
						fileType: file.Type.HTMLDOC,
						contents: replacecsscontent,
						description: 'This is a plain text file.',
						encoding: file.Encoding.UTF8,
						folder: folderid,
						isOnline: true
					});
					var billfile = fileObj.save();
					log.debug("billfile", billfile);
				});
			}
			catch (e) {
				log.debug("Error :", e);
			}

			var fileInternalId = '';
			var folderSearchObj = search.create({
				type: 'folder',
				filters: [
					['file.name', 'is', 'entitlementmanagerprocess.html']  // Filter by file name
				],
				columns: [
					'name',
					'foldersize',
					search.createColumn({
						name: 'internalid',
						join: 'file'  // Join to the file record to get its internal ID
					})
				]
			});
            log.debug("folderSearchObj - ",folderSearchObj);
			var results = folderSearchObj.run().getRange(0, 999);  // Adjust range if needed

			// Log the results
			results.forEach(function (result) {
				var folderName = result.getValue('name');
				var folderSize = result.getValue('foldersize');
				fileInternalId = result.getValue({ name: 'internalid', join: 'file' });

				log.debug('Folder Name:', folderName);
				log.debug('Folder Size:', folderSize);
				log.debug('File Internal ID:', fileInternalId);
			});


			var form = serverWidget.createForm({ title: ' ' });
			// var template = file.load({ id: 974472 }); 
			var template = file.load({ id: fileInternalId }); // 1555058 1554418 
			log.audit('template', template);
			log.audit('template contents', template.getContents());

			form.addField({
				id: 'custpage_sna_bill_payment_processing',
				type: serverWidget.FieldType.INLINEHTML,
				label: 'Bill Payment'
			}).defaultValue = template.getContents();

			// var clientScriptSearch = search.create({ type: 'file', filters: ['name', 'is', 'ci_adv_cs_react_ui.js'] }).run().getRange(0, 1);
			var clientScriptSearch = search.create({ type: 'file', filters: ['name', 'is', 'CIG CS Get Balance Transactions.js'] }).run().getRange(0, 1);
			log.debug("clientScriptSearch:",clientScriptSearch);
			form.clientScriptFileId = clientScriptSearch[0].id;

			scriptContext.response.writePage(form);
			// scriptContext.response.write(template.getContents());
		}

		return { onRequest }
	});