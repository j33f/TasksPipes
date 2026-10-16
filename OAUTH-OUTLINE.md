# Outline OAuth sign-in for TasksPipes

[Français](OAUTH-OUTLINE.fr.md)

Lets members sign in to TasksPipes with their Outline account, without pasting an API key.
It works with the Outline server set in `OUTLINE_URL` only.

## 1. Create the application in Outline

> Only **admins** of the Outline workspace can do this.

1. Sign in to your Outline instance with an admin account.
2. Go to **Settings › Applications**.
3. Click **New application** and fill in:
   - **Name**: `TasksPipes`
   - **Redirect URL**: `<APP_URL>/auth/outline/callback` (e.g. `https://tasks.example.com/auth/outline/callback`)
4. Save, then open the application to copy its **Client ID** and **Client secret** (the secret can be regenerated there).

### Watch out

- No **Applications** menu: the account is not an admin, or the Outline version is too old for OAuth.
  API key sign-in stays available.
- The redirect URL must match **exactly** (including `https`), otherwise sign-in fails on the way back to TasksPipes.

## 2. Fill in `.env`

```dotenv
OUTLINE_OAUTH_CLIENT_ID=<client id>
OUTLINE_OAUTH_CLIENT_SECRET=<client secret>
```

Never commit or share the secret (`.env` is already excluded by `.gitignore`).

Optional: `ALLOW_API_KEY_LOGIN=false` to allow OAuth sign-in only.

## 3. Restart the application

```bash
docker compose up -d
```

The "Continue with Outline" button shows on the sign-in page as soon as both values are set.
