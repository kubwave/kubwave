// Request header the proxy uses to hand the fresh access token to server rendering. Internal only:
// the proxy strips any client-supplied copy, and request headers never reach the browser.
export const ACCESS_TOKEN_HEADER = 'x-kubwave-access-token';
