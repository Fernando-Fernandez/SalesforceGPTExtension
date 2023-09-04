const setKeyButton = document.querySelector( "button#setKey" );
const sendToGPTButton = document.querySelector( "button#sendToGPT" );
const errorSpan = document.querySelector( "#error" );
const responseSpan = document.querySelector( "#response" );
const spinner = document.querySelector( "#spinner" );
const GETDATA = "getData";
const KEY = 'hashedKey';

errorSpan.innerText = "";
spinner.style.display = "none";

setKeyButton.addEventListener( "click", async () => {
    // console.log( "setKeyButton" );
    errorSpan.innerText = "";
    const openAIKeyInput = document.querySelector( "input#openAIKey" );

    let enc = new TextEncoder();
    let encrypted = enc.encode( openAIKeyInput.value );

    localStorage.setItem( KEY, JSON.stringify( encrypted ) );

    // clear out previous secret key
    localStorage.setItem( "openAIKey", undefined );
});

sendToGPTButton.addEventListener( "click", async () => {
    // console.log( "sendToGPT" );
    spinner.style.display = "inline-block";
    responseSpan.innerText = 'Checking OpenAI Key...';
    errorSpan.innerText = "";

    let storedKey = localStorage.getItem( KEY );
    if( ! storedKey ) {
        spinner.style.display = "none";
        responseSpan.innerText = '';
        errorSpan.innerText = "Please set an OpenAI key!";
        return;
    }

    let encodedKey = JSON.parse( storedKey );
    let keyArray = [];
    Object.keys( encodedKey ).forEach( idx => keyArray.push( encodedKey[ idx ] ) );
    let intArray = new Uint8Array( keyArray );
    let dec = new TextDecoder();
    let openAIKey = dec.decode( intArray );

    responseSpan.innerText = 'Checking current page...';

    // get current page data from the page itself
    ( async () => {
        // get last focused tab
        const tabs = await chrome.tabs.query( { active: true, lastFocusedWindow: true } );

        if( tabs.length <= 0 ) {
            responseSpan.innerText = 'No active tab found...';
            spinner.style.display = "none";
            return;
        }

        responseSpan.innerText = 'Getting page data...';

        // get data from last focused tab
        let tab = tabs[ 0 ];
        // console.log( 'calling getData from focused tab' );
        chrome.tabs.sendMessage( tab.id, { message: GETDATA }, function( response ) {
            // console.log( response );
            responseSpan.innerText = 'Preparing prompt for GPT...';
    
            sendToGPT( response, openAIKey );
        } );
        return;
    } )();

    return;
});

function sendToGPT( dataObject, openAIKey ) {
    try {
        if( ! dataObject ) {
            responseSpan.innerText = 'No data received from current page.';
            spinner.style.display = "none";
            return;
        }

        let { currentURL, resultData, prompt } = dataObject;

        if( ! resultData ) {
            responseSpan.innerText = 'No data to send.';
            spinner.style.display = "none";
            return;
        }

        // attempt to retrieve previously stored response
        const cacheKey = JSON.stringify( { currentURL, resultData, prompt } );
        const cachedResponse = sessionStorage.getItem( cacheKey );
        if( cachedResponse ) {
            let parsedCachedResponse = JSON.parse( cachedResponse );

            // only use cached response if newer than 5 min
            let cacheAgeMs = Math.abs( Date.now() - parsedCachedResponse.cachedDate );
            if( cacheAgeMs < 300000 ) {
                // display response 
                responseSpan.innerText = 'OpenAI (cached response): ' + parsedCachedResponse.parsedResponse;
                spinner.style.display = "none";
                return;
            }
        }

        // use parameters recommended for Code Comment Generation
        let temperature = 0.3;  // was 1;
        let top_p = 0.2; // was 1;
        let max_tokens = 300; // was 256 
        let frequency_penalty = 0;
        let presence_penalty = 0;
        let model = 'gpt-3.5-turbo';
        let systemPrompt = 'You are an expert at troubleshooting and explaining code.';  // was 'You are a helpful assistant.';

        // replace characters that would invalidate the JSON payload‘
        let data = //`Current page URL ${currentURL}\\n` +
                    resultData.replaceAll( '\n', ' ' ).replaceAll( '"', '“' )
                                .replaceAll( '\'', '‘' ).replaceAll( '\\', '\\\\' )
                                .replaceAll( '\t', ' ' ).replaceAll( '   ', ' ' );

        // check size of data and select a bigger model as needed
        if( data.length > 3900 ) {
            // TODO:  check if bigger than 32600 and pick gpt-4-32k

            model = 'gpt-3.5-turbo-16k';
            // truncate data as needed
            if( data.length > 16200 ) {
                data = data.substring( 0, 16200 );
            }
        }

        // build prompt with current page data in a request
        let payload = `{ "model":"${model}","messages":[{"role":"system","content":"${systemPrompt}"},{"role":"user","content":"${prompt} ${data}"}],"temperature": ${temperature},"max_tokens":${max_tokens},"top_p":${top_p},"frequency_penalty":${frequency_penalty},"presence_penalty":${presence_penalty} }`;

        // prepare request
        let url = "https://api.openai.com/v1/chat/completions";
        let xhr = new XMLHttpRequest();
        xhr.open( "POST", url );
        xhr.setRequestHeader( "Content-Type", "application/json" );
        xhr.setRequestHeader( "Authorization", "Bearer " + openAIKey );

        // submit request and receive response
        responseSpan.innerText = 'Waiting for OpenAI response...';
        xhr.onreadystatechange = function () {
            if( xhr.readyState === 4 ) {
                console.log( xhr.status );
                console.log( xhr.responseText );
                let open_ai_response = xhr.responseText;
                console.log( open_ai_response );

                let parsedResponse = JSON.parse( open_ai_response );

                if( parsedResponse.error ) {
                    parsedResponse = parsedResponse.error.message + ` (${parsedResponse.error.type})`;

                } else {
                    let finishReason = parsedResponse.choices[ 0 ].finish_reason;
                    parsedResponse = parsedResponse.choices[ 0 ].message.content;
                    // The token count of prompt + max_tokens will not exceed the model's context length. 
                    if( finishReason == 'length' ) {
                        parsedResponse = parsedResponse + ' (RESPONSE TRUNCATED DUE TO LIMIT)';
                    }
                }

                // store response in local cache
                const cacheKey = JSON.stringify( { currentURL, resultData, prompt } );
                sessionStorage.setItem( cacheKey, JSON.stringify( { 
                                                cachedDate: Date.now() 
                                                , parsedResponse } ) 
                                        );

                // display response 
                responseSpan.innerText = 'OpenAI: ' + parsedResponse;
                spinner.style.display = "none";
            }
        };

        xhr.send( payload );
    } catch( e ) {
        responseSpan.innerText = e.message;
        spinner.style.display = "none";
    }
}