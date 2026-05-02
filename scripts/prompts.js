export const PROMPTS = {
    default:
        'Please summarize the following page.',

    debugLog:
        'Please identify errors in the apex debug log, then briefly explain it in these aspects: '
        + 'errors occurred and proposed solution, '
        + 'data queried (SOQL) and updated (DML) and how many rows affected, '
        + 'probable purpose of the execution, '
        + 'a list of methods/classes/flows/formulas executed, potential issues.',

    trigger:
        'Please briefly explain the following apex trigger and potential issues.',

    visualforce:
        'Please briefly explain the following visualforce page in the format: '
        + 'the purpose of the page, main input elements, main output elements, relevant Javascript and CSS, potential issues.',

    apexClass:
        'Please briefly explain the following apex class in the format: '
        + '<classname>: purpose of the class, '
        + 'methodA( parameters ): purpose of methodA, '
        + 'what objects are queried/updated, potential issues.',

    formula:
        'Please briefly explain the following formula field in the format: '
        + 'the purpose of the formula, how the formula calculates, whether it references other objects, potential issues.',

    flow:
        'Please summarize the following Salesforce flow in the format: '
        + 'purpose of the flow, what conditions it evaluates, what objects are queried/updated, potential issues.',

    codeBuilder:
        'Please briefly explain the following code in the format: '
        + 'purpose of the code, key logic and methods, what objects or data are queried/updated, potential issues.'
};
