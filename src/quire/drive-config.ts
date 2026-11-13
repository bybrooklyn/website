// The one setting Google Drive needs: the OAuth client ID of the owner's Google Cloud project. It
// is a public value (it is sent in the address of every sign-in, and is not a secret), made in the
// Google Cloud console under APIs and Services, Credentials, as an OAuth client ID of the type
// "Web application"; docs/mdQuire.md, "Setting up Google Drive", gives every step. While it is
// empty, Google Drive is shown as not set up and does nothing.

/** The OAuth client ID, ending in .apps.googleusercontent.com; empty until it is made. */
export const GOOGLE_CLIENT_ID = "";
