/** Administration › Settings: what each setting is called and what it does (shown with t()). */

/** One setting of the instance, as the server shows it (a secret's value never comes back). */
export interface Setting {
  key: string;
  section: "smtp" | "outline" | "outlineOauth" | "signin" | "oidc" | "push" | "updates";
  kind: "string" | "url" | "bool" | "int" | "list" | "secret";
  locked: boolean;
  env: string;
  default: unknown;
  value: unknown;
  isSet?: boolean;
}

/** Label and help of each setting. */
export const LABELS: Record<string, [string, string?]> = {
  "smtp.host": ["SMTP server"],
  "smtp.port": ["Port"],
  "smtp.secure": ["TLS from the start (port 465)"],
  "smtp.user": ["User"],
  "smtp.pass": ["Password"],
  "smtp.from": ["Sender", "An address, or “Name <address>”"],
  "outline.enabled": ["Outline is on", "Off: Outline accounts are signed out and can no longer sign in; their tasks stay."],
  "outline.url": ["Main Outline server", "OAuth sign-in works with it; e.g. https://docs.example.com"],
  "outline.apiUrl": ["Address of its API seen by the server (optional)", "When it differs, e.g. an internal address"],
  "outline.allowedHosts": ["Other Outline servers allowed", "Host names, one per line (*.example.com allowed); empty: any public https server"],
  "outline.allowPrivate": ["Allow servers on an internal address or in plain http"],
  "outline.teamId": ["Only this workspace of the main server (team id, optional)"],
  "outline.apiKeyLogin": ["Sign-in with a personal Outline API key"],
  "outline.oauthClientId": ["OAuth client id"],
  "outline.oauthClientSecret": ["OAuth client secret"],
  "signin.emailSignup": ["Anyone can create an account with an e-mail address", "Needs e-mail sending"],
  "signin.emailInvitations": ["People can invite others by e-mail"],
  "signin.emailDomains": ["E-mail domains allowed to sign up or be invited", "One per line; empty: every domain"],
  "oidc.enabled": ["Company sign-in is on"],
  "oidc.issuer": ["Issuer URL", "e.g. https://sso.example.com/realms/acme"],
  "oidc.clientId": ["Client id"],
  "oidc.clientSecret": ["Client secret"],
  "oidc.name": ["Button label", "Shown as “Continue with …”"],
  "oidc.scopes": ["Scopes"],
  "oidc.allowedDomains": ["E-mail domains allowed (optional)", "One per line; empty: every domain"],
  "push.vapidPublicKey": ["Public key (VAPID)", "base64url; generate a pair below, or leave empty to derive one from the app's secret"],
  "push.vapidPrivateKey": ["Private key (VAPID)"],
  "push.vapidSubject": ["Contact for push services", "A mailto: or https: address; defaults to the app's address"],
  "updates.check": ["Check for new versions", "Asks GitHub for the latest release every hour; administrators are told of a new one"],
};
export const SECTIONS: { id: Setting["section"]; title: string; intro: string }[] = [
  { id: "smtp", title: "E-mail (SMTP)", intro: "Sign-in links, invitations, notifications and reports." },
  { id: "outline", title: "Outline", intro: "Sign-in with Outline, and the documents linked to tasks." },
  { id: "outlineOauth", title: "Outline OAuth", intro: "Sign-in with Outline in one click: create an application in Outline › Settings › Applications with this redirect URL." },
  { id: "signin", title: "Accounts without Outline", intro: "Accounts that sign in with links sent by e-mail." },
  { id: "oidc", title: "Company sign-in (OpenID Connect)", intro: "Any OpenID Connect provider (Keycloak, Okta, Entra ID…): register a confidential client with this redirect URL." },
  { id: "push", title: "Push notifications", intro: "Notifications on people's devices, next to e-mail. Without a key pair, one is derived from the app's secret." },
  { id: "updates", title: "Updates", intro: "New versions of TasksPipes, published on GitHub." },
];
