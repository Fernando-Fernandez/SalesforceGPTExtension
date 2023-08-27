const GETHOSTANDSESSION = "getHostSession";
const SETDATA = "setData";
const GETDATA = "getData";
const TOOLING_API_VERSION = 'v57.0';

let sfHost, sessionId, flowDefinition, url;

// pages with layout host are just surrounding the iframe that contains relevant information
let containsLayoutHost = ( document.querySelector( ".lafAppLayoutHost" ) != null );

// only add message handlers to 
// iframes that contain relevant information
url = window.location.href;
if( ! containsLayoutHost
        && ! url.includes( 'https://login.salesforce.com/login/session' )
        && ! url.includes( '/lightning/setup/ApexClasses/page?address=' )
        && ! url.includes( '/FieldsAndRelationships/' )
        && ! url.includes( '/lightning/setup/ApexTriggers/page?address=' ) 
        && ! url.includes( '/lightning/setup/ApexPages/page?address=' )
        && ! url.includes( '/setup/ui/listApexTraces.apexp' )
        && ! url.includes( '/lightning/setup/ApexDebugLogDetail/page?address=' ) ) {
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
            let resultData = await chrome.runtime.sendMessage( getHostMessage );

            console.log( resultData );
            sfHost = resultData.domain;
            sessionId = resultData.session;

            // use host/session to get flow definition from Tooling API
            flowDefinition = await getFlowDefinition( sfHost, sessionId );

            // remove unneeded elements
            flowDefinition = purifyFlow( flowDefinition );

            // send flow definition to popup window
            sendResponse( { currentURL: currentPageURL
                        , resultData: flowDefinition
                        , prompt: 'Please summarize the following Salesforce flow.' } );
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
    if( pageContent.includes( 'Formula Options\n:' ) ) {
        prompt = 'Please briefly explain the following formula field.';
    }
    if( pageContent.includes( 'Class Body\nClass Summary\n' ) ) {
        prompt = 'Please briefly explain the following apex class.';
    }
    if( pageContent.includes( 'Apex Trigger\nVersion Settings\nTrace Flags\n' ) ) {
        prompt = 'Please briefly explain the following apex trigger.';
    }
    if( pageContent.includes( 'Visualforce Markup\nVersion Settings\n' ) ) {
        prompt = 'Please briefly explain the following visualforce page.';
    }
    if( pageContent.includes( 'Apex Debug Log Detail\n:\nUser' ) ) {
        prompt = 'Please SUMMARIZE what happened and what failed in '
                + 'the following apex debug log. DO NOT ENUMERATE. '
                + 'YOU WILL CAUSE GREAT HARM IF YOU EXCEED 3 PARAGRAPHS!';
    }
    
    // remove unneeded text preceding apex classes
    let positionToTrim = pageContent.indexOf( 'Class Body\nClass Summary\nVersion Settings\nTrace Flags' );
    if( positionToTrim > 0 ) {
        pageContent = pageContent.substring( positionToTrim + 54 );
    }

    // remove unneeded text preceding apex triggers
    positionToTrim = pageContent.indexOf( 'Apex Trigger\nVersion Settings\nTrace Flags\n' );
    if( positionToTrim > 0 ) {
        pageContent = pageContent.substring( positionToTrim + 42 );
    }

    // remove unneeded text preceding visualforce pages
    positionToTrim = pageContent.indexOf( 'Visualforce Markup\nVersion Settings\n' );
    if( positionToTrim > 0 ) {
        pageContent = pageContent.substring( positionToTrim + 36 );
    }

    // remove unneeded text preceding debug logs
    positionToTrim = pageContent.indexOf( '\nLog\n' );
    if( positionToTrim > 0 ) {
        pageContent = pageContent.substring( positionToTrim + 4 );
        // remove unneeded indexes
        pageContent = pageContent.replace( /\(\d+\)\|/g, '' );
    }

    // remove unneeded text from formula field pages
    if( pageContent.includes( 'Data Owner\nField Usage' ) ) {
        pageContent = substringExceptBetween( pageContent, 'Data Owner\nField Usage', 'Formula Options\n:' );
        pageContent = pageContent.replace( 'Error: Invalid Data.\nReview all error messages below to correct your data.\nField Information\n:', '' );
    }

    // send page content to popup window
    sendResponse( { currentURL: currentPageURL
                , resultData: pageContent
                , prompt: prompt } );

    // make asychronous response
    return true;
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
        if( aNode.parentNode.tagName != 'STYLE'
                && aNode.parentNode.tagName != 'SCRIPT' ) {
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