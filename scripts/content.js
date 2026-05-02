import { PROMPTS } from './prompts.js';

const GETHOSTANDSESSION   = "getHostSession";
const GETDATA             = "getData";
const TOOLING_API_VERSION = 'v57.0';

const EXCLUDED_URL_PATTERNS = [
    '/emptyHtmlDoc.html',
    'salesforce.com/login/session',
    '/lightning/setup/ApexClasses/page?address=',
    '/FieldsAndRelationships/',
    '/lightning/setup/ApexTriggers/page?address=',
    '/lightning/setup/ApexPages/page?address=',
    '/setup/ui/listApexTraces.apexp',
    '/lightning/setup/ApexDebugLogDetail/page?address='
];

// Keys that add noise without helping the LLM understand the flow
const BLOCKED_FLOW_KEYS = new Set( [ 'apiVersion', 'locationX', 'locationY' ] );

const url = window.location.href;
if( !EXCLUDED_URL_PATTERNS.some( p => url.includes( p ) ) ) {
    chrome.runtime.onConnect.addListener( port => {
        port.onMessage.addListener( () => {} );
    } );
    chrome.runtime.onMessage.addListener( processRequestMessage );
}

/////////
// FUNCTIONS
/////////

function processRequestMessage( request, sender, sendResponse ) {
    if( request.message !== GETDATA ) {
        return true;
    }

    const currentPageURL = window.location.href;

    // Code Builder (webconsole) — extract from the editor iframe
    if( currentPageURL.includes( '/webconsole' ) ) {
        const resultData = getCodeBuilderContent();
        sendResponse( { currentURL: currentPageURL, resultData, prompt: PROMPTS.codeBuilder } );
        return true;
    }

    // flow pages — fetch definition from Tooling API
    const flowIdArray = currentPageURL.match( /(?:flowId=)(.*?)(?=&|$)/ );
    if( flowIdArray ) {
        const flowId = flowIdArray[ 1 ];
        ( async () => {
            const sessionData = await chrome.runtime.sendMessage( { message: GETHOSTANDSESSION, url: location.href } );
            const sfHost    = sessionData.domain;
            const sessionId = sessionData.session;

            const rawFlow = await getFlowDefinition( sfHost, sessionId, flowId );
            const { resultData, prompt } = prepareFlowForOpenAI( rawFlow );

            sendResponse( { currentURL: currentPageURL, resultData, prompt } );
        } )();
        return true;
    }

    // extract text from the best available container
    const article = document.querySelector( 'div#setupComponent' )
        || document.querySelector( 'article' )
        || document.querySelector( 'div#content' )
        || document.body;

    let pageContent = extractText( article );

    // prefer iframe content when available — Salesforce often renders the real
    // page content inside a same-origin iframe, leaving the parent with only
    // header/navigation UI
    const iframeContent = getIframeTextContent();
    if( iframeContent.length > pageContent.length ) {
        pageContent = iframeContent;
    }

    let prompt    = PROMPTS.default;
    let resultData = pageContent;

    if( pageContent.includes( 'Formula Options\n:' ) ) {
        ( { resultData, prompt } = prepareFormulaForOpenAI( pageContent ) );
    } else if( pageContent.includes( 'Class Body\nClass Summary\n' ) ) {
        ( { resultData, prompt } = prepareClassForOpenAI( pageContent ) );
    } else if( pageContent.includes( 'Apex Trigger\nVersion Settings\nTrace Flags\n' ) ) {
        ( { resultData, prompt } = prepareTriggerForOpenAI( pageContent ) );
    } else if( pageContent.includes( 'Visualforce Markup\nVersion Settings\n' ) ) {
        ( { resultData, prompt } = prepareVisualForceForOpenAI( pageContent ) );
    } else if( pageContent.includes( 'Apex Debug Log Detail\n:\nUser' ) ) {
        ( { resultData, prompt } = prepareDebugLogForOpenAI( pageContent ) );
    }

    sendResponse( { currentURL: currentPageURL, resultData, prompt } );
    return true;
}

function prepareDebugLogForOpenAI( debugData ) {
    let resultData = debugData;
    let positionToTrim = resultData.indexOf( '\nLog\n' );
    if( positionToTrim > 0 ) {
        resultData = resultData.substring( positionToTrim + 4 );
        const endPosition = resultData.indexOf( 'EXECUTION_FINISHED' );
        if( endPosition > 0 ) {
            resultData = resultData.substring( 0, endPosition );
        }
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
        resultData
        , prompt: PROMPTS.debugLog
    };
}

function prepareTriggerForOpenAI( triggerData ) {
    let resultData = triggerData;
    const positionToTrim = resultData.indexOf( 'Apex Trigger\nVersion Settings\nTrace Flags\n' );
    if( positionToTrim > 0 ) {
        resultData = resultData.substring( positionToTrim + 42 );
    }

    return {
        resultData
        , prompt: PROMPTS.trigger
    };
}

function prepareVisualForceForOpenAI( vfData ) {
    let resultData = vfData;
    const positionToTrim = resultData.indexOf( 'Visualforce Markup\nVersion Settings\n' );
    if( positionToTrim > 0 ) {
        resultData = resultData.substring( positionToTrim + 36 );
    }

    return {
        resultData
        , prompt: PROMPTS.visualforce
    };
}

function prepareClassForOpenAI( classData ) {
    let resultData = classData;
    const positionToTrim = resultData.indexOf( 'Class Body\nClass Summary\nVersion Settings\nTrace Flags' );
    if( positionToTrim > 0 ) {
        resultData = resultData.substring( positionToTrim + 54 );
    }

    return {
        resultData
        , prompt: PROMPTS.apexClass
    };
}

function prepareFormulaForOpenAI( formulaData ) {
    let resultData = formulaData;
    if( resultData.includes( 'Data Owner\nField Usage' ) ) {
        resultData = substringExceptBetween( resultData, 'Data Owner\nField Usage', 'Formula Options\n:' );
        resultData = resultData.replace( 'Error: Invalid Data.\nReview all error messages below to correct your data.\nField Information\n:', '' );
    }

    return {
        resultData
        , prompt: PROMPTS.formula
    };
}

function prepareFlowForOpenAI( rawFlow ) {
    return {
        resultData: purifyFlow( rawFlow )
        , prompt: PROMPTS.flow
    };
}

function substringBetween( str, prefix, suffix ) {
    return str.split( prefix ).pop().split( suffix )[ 0 ];
}

function substringExceptBetween( str, prefix, suffix ) {
    return str.replace( substringBetween( str, prefix, suffix ), '' );
}

function extractText( element ) {
    return getChildrenTextNodes( element ).reduce( ( acc, node ) => {
        const text = node.wholeText.trim();
        if( text === '' || text === '\n' || text === '×' || /^\d+$/.test( text ) ) {
            return acc;
        }
        return acc + text + '\n';
    }, '' );
}

function getCodeBuilderContent() {
    const workbench = document.querySelector( 'runtime_developerplatform_codebuilder-vsc-workbench' );
    if( !workbench ) return '';

    const root   = workbench.shadowRoot || workbench;
    const iframe = root.querySelector( 'iframe' );
    if( !iframe ) return '';

    try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if( !iframeDoc ) return '';

        const editorContainer = iframeDoc.querySelector( 'div.editor-container' );
        if( !editorContainer ) return '';

        return extractText( editorContainer );
    } catch( e ) {
        // cross-origin iframe — content not accessible
        return '';
    }
}

function getIframeTextContent() {
    let combined = '';
    for( const iframe of document.querySelectorAll( 'iframe' ) ) {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if( iframeDoc?.body ) {
                combined += extractText( iframeDoc.body );
            }
        } catch( e ) {
            // cross-origin iframe — skip
        }
    }
    return combined;
}

function getChildrenTextNodes( element ) {
    const ownerDoc = element.ownerDocument || document;
    const treeWalker = ownerDoc.createTreeWalker( element, NodeFilter.SHOW_TEXT, null, false );
    const nodeArray = [];
    let aNode = treeWalker.nextNode();
    while( aNode ) {
        const parentTag = aNode?.parentNode?.tagName;
        if( parentTag !== 'STYLE' && parentTag !== 'SCRIPT' ) {
            nodeArray.push( aNode );
        }
        aNode = treeWalker.nextNode();
    }
    return nodeArray;
}

async function getFlowDefinition( baseUrl, sessionId, flowId ) {
    const endpoint = `https://${baseUrl}/services/data/${TOOLING_API_VERSION}/tooling/sobjects/Flow/${flowId}`;
    const res  = await fetch( endpoint, {
        method: 'GET',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + sessionId
        }
    } );
    const data = await res.json();
    return data.Metadata;
}

function replacer( key, value ) {
    if( value == null ) return undefined;
    if( Array.isArray( value ) && value.length === 0 ) return undefined;
    if( BLOCKED_FLOW_KEYS.has( key ) ) return undefined;
    return value;
}

function purifyFlow( flowDefinition ) {
    return JSON.stringify( flowDefinition, replacer, 3 );
}
