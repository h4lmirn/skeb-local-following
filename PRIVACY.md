# Privacy Policy

Last updated: 2026-09-16

Skeb Local Following is a local-only browser extension. It does not operate an external server and does not transmit saved creator information or browsing information to the developer or any third party.

## Information handled by the extension

When the user explicitly presses the save button on a Skeb creator profile, the extension stores the following information already displayed on that page:

- Skeb user ID and display name
- Creator profile URL
- Request availability at the time of saving
- Genres and recommended amounts displayed on the page
- Up to three displayed work-page URLs and thumbnail URLs
- The date and time the information was saved
- Creator IDs that the user individually marks as followed
- User-created local folder names and creator-to-folder assignments

The extension also stores the user's thumbnail-blur and amount-display preferences.

## Storage and transmission

All information is stored in `chrome.storage.local` on the user's device. The extension does not use `chrome.storage.sync`, analytics, advertising services, or a developer-operated server.

The extension does not directly request creator profiles or the Skeb API. When a saved thumbnail is shown in the following list, the browser may request that image from the image host referenced by Skeb, in the same way as an ordinary web image.

## Data sharing and sale

The extension does not sell, share, or transfer saved information to the developer or other third parties.

## Data deletion

Users can remove one creator's saved information from that creator's profile page. Users can remove all saved creator information from the extension popup. Removing the extension also removes its local extension storage according to the browser's behavior.

## Permissions

- `storage`: Stores selected creator information and extension settings locally.
- Access to `https://skeb.jp/*`: Adds the extension interface to Skeb pages and reads the visible page only after the user explicitly chooses to save a creator.

The extension does not request access to cookies, browsing history, authentication tokens, or network interception APIs.

## Changes

Material changes to this policy should be documented in this file and reflected by changing the "Last updated" date.

## Contact

Questions and issue reports should be submitted through the GitHub Issues page of the repository where this extension is published.
