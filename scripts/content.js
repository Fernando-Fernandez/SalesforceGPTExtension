const GETHOSTANDSESSION = "getHostSession";
const SETDATA = "setData";
const GETDATA = "getData";
const TOOLING_API_VERSION = 'v57.0';

let sfHost, sessionId, flowDefinition, url;

// pages with layout host are just surrounding the iframe that contains relevant information
// Salesforce changed the above
let containsLayoutHost = false; // ( document.querySelector( ".lafAppLayoutHost" ) != null );

// only add message handlers to 
// iframes that contain relevant information
url = window.location.href;
if( ! containsLayoutHost
        && ! url.includes( "/emptyHtmlDoc.html" )
        && ! url.includes( 'salesforce.com/login/session' )
        && ! url.includes( '/lightning/setup/ApexClasses/page?address=' )
        && ! url.includes( '/FieldsAndRelationships/' )
        && ! url.includes( '/lightning/setup/ApexTriggers/page?address=' ) 
        && ! url.includes( '/lightning/setup/ApexPages/page?address=' )
        && ! url.includes( '/setup/ui/listApexTraces.apexp' )
        && ! url.includes( '/lightning/setup/ApexDebugLogDetail/page?address=' ) ) {
    // prime the connection
    chrome.runtime.onConnect.addListener(port => {
        port.onMessage.addListener(msg => {
            console.log( msg );
        });
    });
    // make current window listen to requests from the extension popup window
    chrome.runtime.onMessage.addListener(
        processRequestMessage
    );
}

/////////
// FUNCTIONS
/////////

function processRequestMessage( request, sender, sendResponse ) {
    if( request.message !== GETDATA ) {
        // make asychronous response
        return true;
    }

    // get URL of current page
    let currentPageURL = window.location.href;

    // if on a flow page, return flow definition
    let flowIdArray = currentPageURL.match( /(?:flowId\=)(.*?)(?=&|$)/ );
    if( flowIdArray ) {
        // get flow definition
        ( async () => {
            // request host and session from background script
            let getHostMessage = { message: GETHOSTANDSESSION
                , url: location.href 
            };
            let sessionData = await chrome.runtime.sendMessage( getHostMessage );

            // console.log( sessionData );
            sfHost = sessionData.domain;
            sessionId = sessionData.session;

            // use host/session to get flow definition from Tooling API
            flowDefinition = await getFlowDefinition( sfHost, sessionId );

            // remove unneeded elements
            flowDefinition = purifyFlow( flowDefinition );
            const { resultData, prompt } = prepareFlowForOpenAI( flowDefinition );

            // send flow definition to popup window
            sendResponse( { currentURL: currentPageURL
                        , resultData: resultData
                        , prompt: prompt } );
        } )();

        // make asychronous response
        return true;
    }

    // get article or document node
    let article = document.querySelector( "div#setupComponent" );
    if( ! article ) {
        article = document.querySelector( "article" );
        if( ! article ) {
            article = document.querySelector( "div#content" );
            if( ! article ) {
                article = document.querySelector( "body" );
            }
        }
    }

    // extract all text from document/article
    let textNodes = getChildrenTextNodes( article );
    let pageContent = textNodes.reduce( ( accumulator, currentValue ) => {
        // skip empty lines, lines with only digits
        let theText = currentValue.wholeText.trim();
        if( theText == '\n' || theText == '×' 
                || theText == '' || /^\d+$/.test( theText ) ) {
            return accumulator;
        }
        return accumulator + theText + '\n';
    }, '' );

    let prompt = 'Please summarize the following page.';

    // change prompt depending on the page
    let resultData = pageContent;
    if( pageContent.includes( 'Formula Options\n:' ) ) {
        ( { resultData, prompt } = prepareFormulaForOpenAI( pageContent ) );
    }
    if( pageContent.includes( 'Class Body\nClass Summary\n' ) ) {
        ( { resultData, prompt } = prepareClassForOpenAI( pageContent ) );
    }
    if( pageContent.includes( 'Apex Trigger\nVersion Settings\nTrace Flags\n' ) ) {
        ( { resultData, prompt } = prepareTriggerForOpenAI( pageContent ) );
    }
    if( pageContent.includes( 'Visualforce Markup\nVersion Settings\n' ) ) {
        ( { resultData, prompt } = prepareVisualForceForOpenAI( pageContent ) );
    }
    if( pageContent.includes( 'Apex Debug Log Detail\n:\nUser' ) ) {
        ( { resultData, prompt } = prepareDebugLogForOpenAI( pageContent ) );
    }

    // send page content to popup window
    sendResponse( { currentURL: currentPageURL
                , resultData: resultData
                , prompt: prompt } );

    // make asychronous response
    return true;
}

function prepareDebugLogForOpenAI( debugData ) {
    let resultData = debugData;
    positionToTrim = resultData.indexOf( '\nLog\n' );
    if( positionToTrim > 0 ) {
        resultData = resultData.substring( positionToTrim + 4 );
        let endPosition = resultData.indexOf( 'EXECUTION_FINISHED' );
        if( endPosition > 0 ) {
            resultData = resultData.substring( 0, endPosition );
        }
        // remove unneeded indexes
        resultData = resultData.replace( /\(\d+\)\|/g, '' );
        resultData = resultData.replace( /SOQL_EXECUTE_BEGIN\|\[\d+\]\|Aggregations\:\d+\|/g, 'SOQL: ' );
        resultData = resultData.replace( /SOQL_EXECUTE_END\|\[\d+\]\|Rows\:/g, 'SOQL ROWS: ' );
        resultData = resultData.replace( /HEAP_ALLOCATE\|\[(\d+|EXTERNAL)\]\|/g, '' );
        resultData = resultData.replace( /SYSTEM_MODE_ENTER\|false/g, '' );
        resultData = resultData.replace( /SYSTEM_MODE_EXIT\|false/g, '' );
        resultData = resultData.replace( /FLOW_CREATE_INTERVIEW_BEGIN\|.*?\|.*?\|.*?/g, '' );
        resultData = resultData.replace( /FLOW_CREATE_INTERVIEW_END\|.*?\|/g, '' );
        resultData = resultData.replace( /.*?_LIMIT_USAGE\|/g, '' );
        resultData = resultData.replace( /Bytes:-?\d+/g, '' );
        resultData = resultData.replace( /\|true\|false/g, '' );
        resultData = resultData.replace( /\|0x[a-f0-9]+/g, '' );
        resultData = resultData.replace( /\[EXTERNAL\]/g, '' );
        resultData = resultData.replace( /STATEMENT_EXECUTE\|\[\d+\]/g, '' );
        resultData = resultData.replace( /VARIABLE_SCOPE_BEGIN\|\[\d+\]\|/g, 'NEW VAR: ' );
        resultData = resultData.replace( /VARIABLE_ASSIGNMENT\|\[\d+\]\|/g, 'FIELD/VAR SET: ' );
        resultData = resultData.replace( /(\d+:){2}\d+\.\d \n?/g, '' );
        resultData = resultData.replace( /\|/g, ' ' );
    }

    return {
        resultData: resultData
        , prompt: 'Please identify errors in the apex debug log, then briefly explain it in these aspects:  errors occurred and proposed solution, data queried (SOQL) and updated (DML) and how many rows affected, probable purpose of the execution, a list of methods/classes/flows/formulas executed.'
    }
}

function prepareTriggerForOpenAI( triggerData ) {
    let resultData = triggerData;
    positionToTrim = resultData.indexOf( 'Apex Trigger\nVersion Settings\nTrace Flags\n' );
    if( positionToTrim > 0 ) {
        resultData = resultData.substring( positionToTrim + 42 );
    }

    return {
        resultData: resultData
        , prompt: 'Please briefly explain the following apex trigger.'
    }
}

function prepareVisualForceForOpenAI( vfData ) {
    let resultData = vfData;
    positionToTrim = resultData.indexOf( 'Visualforce Markup\nVersion Settings\n' );
    if( positionToTrim > 0 ) {
        resultData = resultData.substring( positionToTrim + 36 );
    }

    return {
        resultData: resultData
        , prompt: 'Please briefly explain the following visualforce page in the format:  the purpose of the page, main input elements, main output elements, relevant Javascript and CSS.'
    }
}

function prepareClassForOpenAI( classData ) {
    let resultData = classData;
    let positionToTrim = resultData.indexOf( 'Class Body\nClass Summary\nVersion Settings\nTrace Flags' );
    if( positionToTrim > 0 ) {
        resultData = resultData.substring( positionToTrim + 54 );
    }

    return {
        resultData: resultData
        , prompt: 'Please briefly explain the following apex class in the format:  <classname>:  purpose of the class, methodA( parameters ):  purpose of methodA, what objects are queried/updated, etc.'
    }
}

function prepareFormulaForOpenAI( formulaData ) {
    let resultData = formulaData;
    if( resultData.includes( 'Data Owner\nField Usage' ) ) {
        resultData = substringExceptBetween( resultData, 'Data Owner\nField Usage', 'Formula Options\n:' );
        resultData = resultData.replace( 'Error: Invalid Data.\nReview all error messages below to correct your data.\nField Information\n:', '' );
    }

    return {
        resultData: resultData
        , prompt: 'Please briefly explain the following formula field in the format:  the purpose of the formula, how the formula calculates, whether it references other objects.' 
    }
}

function prepareFlowForOpenAI( flowDefinition ) {
    return {
        resultData: purifyFlow( flowDefinition )
        , prompt: 'Please summarize the following Salesforce flow in the format:  purpose of the flow, what conditions it evaluates, what objects are queried/updated, etc..'
    }
}

function substringBetween( str, prefix, suffix ) {
    return str.split( prefix ).pop().split( suffix )[ 0 ];
}

function substringExceptBetween( str, prefix, suffix ) {
    return str.replace( substringBetween( str, prefix, suffix ), '' );
}

function getChildrenTextNodes( element ) {
    let treeWalker = document.createTreeWalker( element, NodeFilter.SHOW_TEXT, null, false );
    let nodeArray = [];
    let aNode = treeWalker.nextNode();
    while( aNode ) {
        // skip STYLE/SCRIPT elements
        let parentTag = aNode?.parentNode?.tagName;
        if( parentTag != 'STYLE'
                && parentTag != 'SCRIPT' ) {
            nodeArray.push( aNode );
        }
        aNode = treeWalker.nextNode();
    }
    return nodeArray;
}

async function getFlowDefinition( baseUrl, sessionId ) {
    let params = location.search; // ?flowId=3013m000000XIygAAG
    let flowIdArray = params.match( /(?:flowId\=)(.*?)(?=&|$)/ );
    if( ! flowIdArray ) {
        return;
    }
    let flowId = flowIdArray[ 1 ];

    // Tooling API endpoint:  /services/data/v35.0/tooling/sobjects/Flow/301...AAG
    let endpoint = "https://" + baseUrl +  "/services/data/" + TOOLING_API_VERSION + "/tooling/sobjects/Flow/" + flowId;
    let request = {
        method: "GET"
        , headers: {
          "Content-Type": "application/json"
          , "Authorization": "Bearer " + sessionId
        }
    };

    let response = await fetch( endpoint, request );
    let data = await response.json();

    return data.Metadata;
}

function replacer( key, value ) {
    // filter nulls
    if( value == null ) {
        return undefined;
    }
    // filter empty arrays
    if( Array.isArray( value ) && value.length == 0 ) {
        return undefined;
    }

    const blockedElements = [ "apiVersion", "locationX", "locationY" ];
    if( blockedElements.includes( key ) ) {
        return undefined;
    }

    return value;
}

function purifyFlow( flowDefinition ) {
    flowDefinition = JSON.stringify( flowDefinition, replacer, 3 );
    return flowDefinition;
}