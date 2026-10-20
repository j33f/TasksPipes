# Translation

> This guide is also online at [doc.taskspipes.com](https://doc.taskspipes.com) (and the project at [taskspipes.com](https://taskspipes.com)).

TasksPipes is available in English, French, Spanish and Portuguese (Brazil and Portugal). The language follows the
browser, unless chosen in **Settings** (account menu).

## How it works

Texts are written in English in the code and wrapped in `t()` (web app) or `tr()` (server); each language has **one
file**, `locales/<code>.json` at the root of the repository, that maps them to that language. A missing translation
shows the English text.

```ts
t("New task")                                   // "Nouvelle tâche" in French
t("Sent by {name}", { name: task.sender.name }) // placeholders are filled in
tn(count, "{n} task", "{n} tasks")              // plural forms, following the language's rules
```

A language file holds:

```jsonc
{
  "name": "Español",          // the language's own name, in the language menu
  "intl": "es-ES",            // BCP 47 tag for dates and numbers
  "csvSeparator": ";",        // CSV exports for spreadsheets in that language ("," or ";")
  "web": { "New task": "Nueva tarea" },               // the web app
  "server": { "{label} is required": "{label}: obligatorio" }, // errors, e-mails, calendar, reports
  "catalog": { "Tâches générales": "Tareas generales" }        // the built-in pipe and task types
}
```

The web app bundles every file of `locales/` when it is built; the server reads them when it starts. The web app
sends its language with each request (`X-Locale` header); otherwise the server uses the browser's `Accept-Language`,
then `DEFAULT_LOCALE`. A browser language matches a file by its full tag first, then by its first two letters:
`pt-BR` gets `pt-BR.json`, while `pt-PT` or `pt-AO` get `pt.json`.

The built-in catalog is the exception: it describes French training centres, so it is written in French, and the
`catalog` part translates it from French (the French file has none). Choice-list options keep their French value,
which is what tasks store, and get a translated label for display. A catalog label missing in a language shows in
English.

## Adding a language

1. Copy `locales/fr.json` to `locales/<code>.json` (a two- or three-letter code: `de`, `it`, `nl`…, or with a region
   for a variant of a language, like `pt-BR`).
2. Set `name`, `intl` and `csvSeparator`, and translate the values of `web` and `server` (the keys are the English
   texts). Translate `catalog` from `locales/en.json`: its keys are the French labels, its values their English
   version.
3. Rebuild and restart (`docker compose up --build`): the language shows in the menu. No code changes.

Keep the placeholders (`{name}`, `{n}`…) as they are, and keep translations short: they appear in buttons and menus.
A language may be published partly translated: the tests check that every placeholder is kept and that no entry is
stale, and tell how many texts are still shown in English. French must stay complete.
