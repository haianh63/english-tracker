# English Study Hub - GitHub Pages + Google Sheets

A static HTML/CSS/JavaScript learning dashboard. **Google Sheets is the ONLY persistent storage for learning progress.** No backend server, Google Apps Script, Firebase, browser localStorage, IndexedDB, or JSON progress files.

## Included source

- `index.html`: course dashboard, exercise library, and the progress tracker (single-page hash navigation keeps your Google OAuth session in memory).
- `progress.html`: compatibility redirect to `index.html#progress`.
- `assets/app.js`, `style.css`, `data.js`, `manifest.json`: web UI and course catalog.
- `assets/sheets-api.js`: login + direct Google Sheets API read/write.
- `assets/config.js`: the **only two settings** you need to fill in.
- `exercise/`: ALL original HTML exercises and `course_content.txt` files, unchanged byte-for-byte.
- `ORIGINAL_FILES_SHA256.txt`: SHA-256 hashes of every source file from the uploaded ZIP.

| Course | Course lessons | Exercise HTML files |
| --- | ---: | ---: |
| Master English Intermediate | 54 | 51 |
| Master English Vocabulary | 61 | 76 |
| Master English Conversation - Upper Intermediate | 68 | 53 |
| **Total** | **183** | **180** |

Some lessons have no matching HTML exercise, but they remain trackable.

## Step 1 - Create the Google Sheet

1. Open https://sheets.google.com and create an empty spreadsheet, such as `English Learning Progress`.
2. Copy its **Spreadsheet ID** from its URL:

   `https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit`

3. Leave the spreadsheet editable by your own Google account. It can remain **private**.
4. **Do not create a `Progress` worksheet manually.** The website automatically creates it and adds 363 study items the first time you connect. If a `Progress` worksheet already exists with unrelated data, rename it before you connect.

Google Sheets schema (created automatically):

| Col | Field | Description |
| --- | --- | --- |
| A | `type` | lesson / exercise |
| B | `id` | Stable unique identifier |
| C | `course` | Course identifier |
| D | `title` | Lesson/exercise title |
| E | `status` | todo, doing, done |
| F | `updated_at` | ISO timestamp when changed |
| G | `html_path` | Relative HTML path (exercise only) |

**Important:** Do not reorder, delete, or edit IDs in column B while using the web app. The website dynamically locates the row for each ID upon sign-in and refresh. You may manually change column E (`todo`, `doing`, `done`) and click Refresh from Sheet to read it. `exercise` rows support `todo` or `done` only.

## Step 2 - Create a browser OAuth client in Google Cloud

This solution uses the Google Identity Services *token model* and calls the **Google Sheets REST API directly from your browser**.

1. Go to https://console.cloud.google.com/ and create/select a project.
2. In **APIs & Services > Library**, find **Google Sheets API** and click **Enable**.
3. Open **Google Auth platform > Branding / Audience**. Configure the app for your account. For a personal external testing app, add your Google account under **Test users**. A Google Workspace organization may require administrator approval.
4. Open **Google Auth platform > Clients > Create client > Web application**.
5. Under **Authorized JavaScript origins**, add your exact **origin**, e.g. `https://YOUR_GITHUB_USERNAME.github.io`. Do NOT append the repository name or a trailing slash. For local testing, optionally add `http://localhost:8000`.
6. Copy the **OAuth 2.0 Client ID** ending in `.apps.googleusercontent.com`. Do **not** use or commit an OAuth client secret.
7. If Google requires OAuth verification or additional user authorization for your deployment audience, follow the messages in Google Cloud. This private use setup is intended for your own Google account / approved test users.

Official references:
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/guides/create-credentials
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update

## Step 3 - Configure the website

Edit **`assets/config.js`**:

```js
window.GOOGLE_SHEETS_CONFIG = {
  clientId: 'YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com',
  spreadsheetId: 'YOUR_SPREADSHEET_ID'
};
```

These two IDs are public identifiers, not passwords. The **Google account's authorization** and **Sheet sharing permissions** protect your data. Keep the Sheet private. Never put an access token, Google API key, client secret, or service-account private key in this repository.

## Step 4 - Deploy to GitHub Pages

1. Create a GitHub repository such as `english-study-hub`.
2. Upload the **CONTENTS of this ZIP** into the repository root: `index.html`, `progress.html`, `assets/`, `exercise/`, etc. Do not add another parent `english-study-hub/` folder inside the repository.
3. Go to **Settings > Pages > Build and deployment** and choose **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
4. Open `https://YOUR_GITHUB_USERNAME.github.io/REPOSITORY_NAME/`.
5. Click **Connect Google** and choose the account with edit access to your Google Sheet. Authorize Google Sheets access.
6. The first connection creates `Progress` and initializes all 363 items. Mark a lesson/exercise; column E updates immediately.

If login fails with `origin_mismatch`, check that your OAuth **Authorized JavaScript origins** is the GitHub Pages **origin only** and exactly matches the web browser address's scheme/domain. OAuth works on HTTPS or local `localhost`, not `file://`.

### Optional local development

From the extracted project folder:

```sh
python -m http.server 8000
```

Open `http://localhost:8000/`. In Google Cloud, the OAuth client must authorize `http://localhost:8000` if you use the login locally. The HTML exercises themselves remain unchanged.

## How persistence works

1. The browser loads the 183 lessons and 180 exercises from the static catalog.
2. On **Connect Google**, Google Identity Services obtains a short-lived OAuth access token **in memory**.
3. The website reads `Progress!A:G` via the Google Sheets API. It auto-initializes the sheet if needed and fills in missing catalog rows without overwriting existing progress.
4. When you change a lesson status or mark an HTML exercise done, it writes **only that item's status + timestamp** directly to columns E:F in Google Sheets.
5. The UI confirms success only after the API confirms the write. On error, it retains the previous state and shows an error.
6. On reload or another device, connect again to fetch the up-to-date Sheet. With an expired token, reconnect. For changes made by another device while the current page is open, press **Refresh from Sheet**.

There is **no browser-side progress persistence or offline editing**. An internet connection and a successful Google sign-in are required to view or modify previously saved progress. The exercises are still browsable when disconnected.

Google's Sheets OAuth scope (`https://www.googleapis.com/auth/spreadsheets`) grants spreadsheet access subject to the permissions of the signed-in Google account. Only authorize an app you trust. This project calls only the configured spreadsheet ID.

### Limitations

- Progress/finished flags are **manual**. The original HTML exercises are never changed, so score submissions or quiz completion inside their own code cannot automatically sync to Google Sheets.
- If two devices edit the *same* row simultaneously, the most recent Sheet write wins; use Refresh from Sheet to reconcile.
- Google Cloud setup is required once. This is not a publicly hosted ready-to-sign-in OAuth service.
- OAuth may require consent again depending on Google's policies, your browser, or the token expiry.

## Verify the original files

`ORIGINAL_FILES_SHA256.txt` contains SHA-256 for every uploaded file. You can verify that all the HTML course exercises and `course_content.txt` inputs were copied unchanged.

No tracking data is sent to a third-party service other than Google's OAuth / Sheets APIs. Exercise files may themselves include URLs or scripts supplied in the original ZIP; they are preserved without modification.
