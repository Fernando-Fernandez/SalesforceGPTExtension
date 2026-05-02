import { getModelConfig } from './models.js';

const setKeyButton       = document.querySelector( "button#setKey" );
const sendToGPTButton    = document.querySelector( "button#sendToGPT" );
const errorSpan          = document.querySelector( "#error" );
const responseSpan       = document.querySelector( "#response" );
const spinner            = document.querySelector( "#spinner" );
const gptVersionSelect   = document.getElementById( "gpt-version" );
const customModelWrapper = document.getElementById( "custom-model-wrapper" );
const copyResponseButton = document.getElementById( "copyResponse" );

const GETDATA          = "getData";
const KEY              = 'hashedKey';
const OPENAI_URL       = 'https://api.openai.com/v1/chat/completions';
const CACHE_TTL_MS     = 5 * 60 * 1000;
const MODEL_KEY        = 'selectedModel';
const CUSTOM_MODEL_KEY = 'customModel';

// Inserts (or replaces) a single custom option just above "Custom…"
function addCustomModelToSelect( name ) {
    const existing = gptVersionSelect.querySelector( 'option.custom-entry' );
    if( existing ) existing.remove();
    const option       = document.createElement( 'option' );
    option.value       = name;
    option.textContent = name;
    option.classList.add( 'custom-entry' );
    gptVersionSelect.insertBefore( option, gptVersionSelect.querySelector( 'option[value="custom"]' ) );
}

// Commits the typed name into the select and hides the text input
function commitCustomModel() {
    const name = document.getElementById( 'custom-model' ).value.trim();
    if( !name ) return;
    addCustomModelToSelect( name );
    gptVersionSelect.value = name;
    customModelWrapper.style.display = 'none';
    localStorage.setItem( MODEL_KEY, name );
    localStorage.setItem( CUSTOM_MODEL_KEY, name );
}

// Restore last-used model on open
const savedCustom = localStorage.getItem( CUSTOM_MODEL_KEY );
if( savedCustom ) addCustomModelToSelect( savedCustom );

const savedModel = localStorage.getItem( MODEL_KEY );
if( savedModel && savedModel !== 'custom' ) {
    gptVersionSelect.value = savedModel;
} else if( savedModel === 'custom' ) {
    gptVersionSelect.value = 'custom';
    customModelWrapper.style.display = 'block';
    if( savedCustom ) document.getElementById( 'custom-model' ).value = savedCustom;
}

gptVersionSelect.addEventListener( "change", () => {
    const val = gptVersionSelect.value;
    localStorage.setItem( MODEL_KEY, val );
    if( val === 'custom' ) {
        const currentCustom = localStorage.getItem( CUSTOM_MODEL_KEY );
        if( currentCustom ) document.getElementById( 'custom-model' ).value = currentCustom;
        customModelWrapper.style.display = 'block';
        document.getElementById( 'custom-model' ).focus();
    } else {
        customModelWrapper.style.display = 'none';
    }
} );

const customModelInput = document.getElementById( 'custom-model' );
customModelInput.addEventListener( 'blur',    commitCustomModel );
customModelInput.addEventListener( 'keydown', ( e ) => { if( e.key === 'Enter' ) commitCustomModel(); } );

copyResponseButton.addEventListener( "click", () => {
    navigator.clipboard.writeText( responseSpan.innerText );
    copyResponseButton.classList.add( "copied" );
    setTimeout( () => copyResponseButton.classList.remove( "copied" ), 1500 );
} );

errorSpan.innerText = "";

setKeyButton.addEventListener( "click", () => {
    errorSpan.innerText = "";
    const input   = document.querySelector( "input#openAIKey" );
    const encoded = new TextEncoder().encode( input.value );
    localStorage.setItem( KEY, JSON.stringify( encoded ) );
    localStorage.removeItem( "openAIKey" );
} );

sendToGPTButton.addEventListener( "click", async () => {
    setStatus( 'Checking OpenAI Key...' );
    errorSpan.innerText = "";
    spinner.style.display = "inline-block";
    copyResponseButton.style.display = "none";

    const storedKey = localStorage.getItem( KEY );
    if( !storedKey ) {
        spinner.style.display = "none";
        responseSpan.innerText = '';
        errorSpan.innerText = "Please set an OpenAI key!";
        return;
    }

    const openAIKey = decodeKey( storedKey );

    setStatus( 'Checking current page...' );

    let tabs = await chrome.tabs.query( { active: true, lastFocusedWindow: true } );
    if( tabs.length === 0 ) {
        tabs = await chrome.tabs.query( { active: true, currentWindow: true } );
    }
    if( tabs.length === 0 ) {
        setStatus( 'No active tab found...' );
        spinner.style.display = "none";
        return;
    }

    setStatus( 'Getting page data...' );
    const tabId = tabs[ 0 ].id;

    chrome.tabs.sendMessage( tabId, { message: GETDATA }, async ( response ) => {
        if( chrome.runtime.lastError ) {
            console.error( chrome.runtime.lastError.message );
        }
        if( !response ) {
            setStatus( 'Could not obtain tab information.' );
            spinner.style.display = "none";
            return;
        }

        setStatus( 'Preparing prompt for GPT...' );

        const gptQuestion = document.getElementById( 'gptQuestion' );
        if( gptQuestion?.value ) {
            response.prompt = gptQuestion.value;
        }

        const gptModel = gptVersionSelect.value === 'custom'
            ? ( document.getElementById( 'custom-model' ).value.trim() || 'gpt-4o' )
            : gptVersionSelect.value;
        await sendToGPT( response, openAIKey, gptModel );
    } );
} );

function decodeKey( storedKey ) {
    const encoded = JSON.parse( storedKey );
    return new TextDecoder().decode( new Uint8Array( Object.values( encoded ) ) );
}

function setStatus( text ) {
    responseSpan.innerText = text;
}

function applyMarkdown() {
    responseSpan.innerHTML = responseSpan.innerHTML.replace( /\*\*(.*?)\*\*/g, "<b>$1</b>" );
}

async function sendToGPT( dataObject, openAIKey, gptModel ) {
    try {
        const { currentURL, resultData, prompt } = dataObject;

        if( !resultData ) {
            setStatus( 'No data found to send to GPT.' );
            spinner.style.display = "none";
            return;
        }

        const cacheKey = JSON.stringify( { currentURL, resultData, prompt } );
        const cached = sessionStorage.getItem( cacheKey );
        if( cached ) {
            const { cachedDate, parsedResponse } = JSON.parse( cached );
            if( Date.now() - cachedDate < CACHE_TTL_MS ) {
                responseSpan.innerText = 'OpenAI (cached): ' + parsedResponse;
                applyMarkdown();
                spinner.style.display = "none";
                copyResponseButton.style.display = "block";
                return;
            }
        }

        let model = gptModel || 'gpt-3.5-turbo';
        let data  = resultData;
        if( data.length > 16200 ) {
            model = 'gpt-4o';
            if( data.length > 130872 ) {
                data = data.substring( 0, 130872 );
            }
        }

        const { tokenLimitParam, temperature, top_p } = getModelConfig( model );

        const payload = JSON.stringify( {
            model,
            messages: [
                { role: 'system', content: [ { type: 'text', text: 'You are an expert at troubleshooting and explaining code.' } ] },
                { role: 'user',   content: [ { type: 'text', text: `${prompt} ${data}` } ] }
            ],
            temperature,
            [ tokenLimitParam ]: 2000,
            top_p,
            frequency_penalty:   0,
            presence_penalty:    0
        } );

        setStatus( 'Waiting for OpenAI response...' );

        const res  = await fetch( OPENAI_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openAIKey },
            body:    payload
        } );
        const json = await res.json();

        let parsedResponse;
        if( json.error ) {
            parsedResponse = `${json.error.message} (${json.error.type})`;
        } else {
            parsedResponse = json.choices[ 0 ].message.content;
            if( json.choices[ 0 ].finish_reason === 'length' ) {
                parsedResponse += ' (RESPONSE TRUNCATED DUE TO LIMIT)';
            }
        }

        sessionStorage.setItem( cacheKey, JSON.stringify( { cachedDate: Date.now(), parsedResponse } ) );

        responseSpan.innerText = parsedResponse;
        applyMarkdown();
        spinner.style.display = "none";
        copyResponseButton.style.display = "block";

    } catch( e ) {
        responseSpan.innerText = e.message;
        spinner.style.display = "none";
    }
}
