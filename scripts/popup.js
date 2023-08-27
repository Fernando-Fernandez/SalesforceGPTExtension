const setKeyButton = document.querySelector( "button#setKey" );
const sendToGPTButton = document.querySelector( "button#sendToGPT" );
const errorSpan = document.querySelector( "#error" );
const responseSpan = document.querySelector( "#response" );
const GETDATA = "getData";

errorSpan.innerText = "";

setKeyButton.addEventListener( "click", async () => {
    // console.log( "setKeyButton" );
    errorSpan.innerText = "";
    const openAIKeyInput = document.querySelector( "input#openAIKey" );
    localStorage.setItem( "openAIKey", openAIKeyInput.value );
});

sendToGPTButton.addEventListener( "click", async () => {
    // console.log( "sendToGPT" );
    responseSpan.innerText = 'Checking OpenAI Key...';
    errorSpan.innerText = "";

    let openAIKey = localStorage.getItem( "openAIKey" );
    if( ! openAIKey ) {
        console.log( "openAIKey is empty!" );
        responseSpan.innerText = '';
        errorSpan.innerText = "Please set an OpenAI key!";
        return;
    }

    responseSpan.innerText = 'Checking current page...';

    // get current page data from the page itself
    ( async () => {
        // get last focused tab
        const tabs = await chrome.tabs.query( { active: true, lastFocusedWindow: true } );

        if( tabs.length <= 0 ) {
            responseSpan.innerText = 'No active tab found...';
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
            return;
        }

        let { currentURL, resultData, prompt } = dataObject;

        if( ! resultData ) {
            responseSpan.innerText = 'No data to send.';
            return;
        }

        // use parameters recommended for Code Comment Generation
        let temperature = 0.3;  // was 1;
        let top_p = 0.2; // was 1;
        let max_tokens = 300; // was 256 
        let frequency_penalty = 0;
        let presence_penalty = 0;
        let model = 'gpt-3.5-turbo';

        // check size of resultData and select a bigger model as needed
        if( resultData.length > 3900 ) {
            // TODO:  check if bigger than 32600 and pick gpt-4-32k

            model = 'gpt-3.5-turbo-16k';
            // truncate data as needed
            if( resultData.length > 16200 ) {
                resultData = resultData.substring( 0, 16200 );
            }
        }

        // replace characters that would invalidate the JSON payload‘
        let data = //`Current page URL ${currentURL}\\n` +
                    resultData.replaceAll( '\n', ' ' ).replaceAll( '"', '“' )
                                .replaceAll( '\'', '‘' ).replaceAll( '\\', '\\\\' );

        // build prompt with current page data in a request
        let payload = `{ "model":"${model}","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"${prompt} ${data}"}],"temperature": ${temperature},"max_tokens":${max_tokens},"top_p":${top_p},"frequency_penalty":${frequency_penalty},"presence_penalty":${presence_penalty} }`;

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
                        parsedResponse = parsedResponse + ' (Truncated due to length limit)';
                    }
                }

                // display response 
                responseSpan.innerText = 'OpenAI: ' + parsedResponse;
            }
        };

        xhr.send( payload );
    } catch( e ) {
        responseSpan.innerText = e.message;
    }
}