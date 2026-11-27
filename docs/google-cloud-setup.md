# Google Cloud setup (Drive backup and the read-only viewer)

FlightBook talks to Google Drive straight from the browser: no backend, no secret. You create **one OAuth client**
once; every device and every address the app is served from shares it. This takes about ten minutes.

> The Google Cloud Console is redesigned from time to time ("OAuth consent screen" is now part of "Google Auth
> Platform"), so menu names below may differ slightly. The settings that matter are in **bold**.

## 1. Create a project and enable the Drive API
1. Open <https://console.cloud.google.com/> and create a project (e.g. "FlightBook").
2. **APIs & Services → Library → Google Drive API → Enable.**

## 2. Configure the consent screen (Testing mode)
1. **APIs & Services → OAuth consent screen** (or *Google Auth Platform → Branding / Audience*).
2. User type **External**. App name "FlightBook", your e-mail as support and developer contact.
3. Publishing status: leave it **Testing**.
4. **Test users → add your own Google account** (and any other account that should open the logbook, e.g. a second
   Google account you use on the desktop). Only listed accounts can sign in while the app is in Testing.
5. **Scopes → add `https://www.googleapis.com/auth/drive.file`.** This is the only scope the app asks for. It lets
   the app see and change **only the files it created itself** (the "Logbook backups" folder and its contents), never
   the rest of your Drive.

## 3. Create the OAuth client ID
1. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
2. Application type: **Web application**. Name: "FlightBook web".
3. **Authorised JavaScript origins**: add **every address the app is served from**, with no path and no trailing slash:
   - `https://miningflo.github.io` (the GitHub Pages site)
   - `http://localhost:5173` (`npm run dev`) and `http://localhost:4173` (`npm run preview`) if you test locally
   - any custom domain you may add later
4. **Authorised redirect URIs**: leave empty (the sign-in uses a pop-up, not a redirect).
5. Create, then copy the **Client ID** (`123456789-abc….apps.googleusercontent.com`). It is not a secret: it only
   identifies the app. There is no client secret in this setup.

> Why one client ID for all addresses? With the `drive.file` scope, an app only sees files created by *its own OAuth
> client*. The master (phone) and the viewer (desktop) must therefore use the same client ID, or the viewer would not
> see the backups.

## 4. Give the client ID to the app
- **Local build:** copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID=…`.
- **GitHub Pages:** in the repository, **Settings → Secrets and variables → Actions → Variables → New repository
  variable** named `VITE_GOOGLE_CLIENT_ID`, or from a terminal:
  `gh variable set VITE_GOOGLE_CLIENT_ID --body "<client id>"`. Then re-run the deploy
  (`gh workflow run deploy.yml`) so the new build contains it.

## 5. First connection
1. On the phone (the master): **Settings → Google Drive → Connect Google Drive.** While the app is in Testing mode
   Google shows an "unverified app" warning; choose **Advanced → continue** and approve the single Drive permission.
2. Tap **Backup now.** A folder **Logbook backups** appears in your Drive with `master.json` and the first snapshot.
3. On the desktop: open the app, choose **Read-only viewer**, then **Connect Google Drive**. The logbook appears with
   the banner "Read-only — snapshot from …".

## Things to expect
- **Tokens last about an hour.** There is no refresh token in this flow. Renewing needs Google's small sign-in
  pop-up, which browsers only allow after a tap. The app never opens it by itself: if an automatic backup
  finds it needs one, a banner offers **Sign in and back up**, and a viewer keeps showing its last copy with a
  **Refresh** button; nothing fails silently.
- **Testing mode may ask you to approve again** roughly weekly. Publishing the app ("In production") avoids this;
  because `drive.file` is a restricted-to-own-files scope I believe it needs no Google verification for personal use,
  but check Google's current policy before relying on that.
- **Pop-ups in the installed app on Android** are the part that could only be tested with a fake Google here. If the
  sign-in pop-up does not open when you tap, allow pop-ups for the site in Chrome's site settings and tell me what happens.

## Troubleshooting
| Message | Cause |
|---|---|
| `origin_mismatch` / "not a valid origin" | the address you opened is missing from **Authorised JavaScript origins** |
| `access_denied` / "app not verified, access blocked" | your Google account is not in **Test users** |
| "Google Drive API has not been used in project …" | step 1.2: enable the Drive API |
| Banner "Backups are paused" | another device became the master; take over again or make this device a viewer |
| Viewer says "No backups yet" | nothing was backed up from the master yet, or the master used a different client ID |

## Privacy
Only the browser and Google are involved. The backup files are in *your* Drive, readable by you. The app requests no
access to your other files, e-mail or contacts. **Disconnect Google Drive** in Settings revokes the grant for all your
devices (it may ask you to sign in once more to do so, and says if it could not); you can also remove the app at <https://myaccount.google.com/permissions>.
