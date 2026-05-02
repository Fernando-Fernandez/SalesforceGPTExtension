const GETHOSTANDSESSION = "getHostSession";

chrome.runtime.onMessage.addListener( ( message, sender, responseCallback ) => {
    if( message.message === GETHOSTANDSESSION ) {
        getHostAndSession( message.url, sender.tab.cookieStoreId )
            .then( responseCallback );
        return true;
    }
    return false;
} );

async function getHostAndSession( url, cookieStoreId ) {
    // get the session cookie for the current tab's org
    const cookie = await chrome.cookies.get( { name: 'sid', url, storeId: cookieStoreId } );
    if( !cookie ) return null;

    // the unsecured cookie value is "<orgId>!<token>" — extract the org prefix to
    // match against the secure cookies, since multiple orgs may be open simultaneously
    const [ orgId ] = cookie.value.split( '!' );
    const candidates = await chrome.cookies.getAll( {
        name:    'sid',
        domain:  'salesforce.com',
        secure:  true,
        storeId: cookieStoreId
    } );

    const sessionCookie = candidates.find( c => c.value.startsWith( orgId + '!' ) );
    if( !sessionCookie ) return null;

    return { domain: sessionCookie.domain, session: sessionCookie.value };
}
