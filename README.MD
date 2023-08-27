## Salesforce GPT Extension

# Gets a GPT answer about a Salesforce item (flow, debug, class, formula, etc).

A simple browser extension that reads the page content and requests OpenAI GPT to explain/summarize the content.

The extension runs on the browser and first checks whether a Salesforce page is open.

If a flow is opened, then calls the Salesforce tooling API and gets the flow metadata/definition, otherwise just uses the information already displayed on the page.

The privacy policy is at https://sites.google.com/view/mybrowserextensions/salesforce-gpt-extension

This extension does not handle personal or sensitive user data. It only communicates with Salesforce to request data to display on the screen and OpenAI to send the explanation/summarization request. Nothing else is sent to any other server.

The source code can be found at:  https://github.com/Fernando-Fernandez/SalesforceGPTExtension
