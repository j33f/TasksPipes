# Translation

TasksPipes is available in English and French. The language follows the browser, unless chosen in **Settings** (account menu).

## How it works

Texts are written in English in the code and wrapped in `t()`; dictionaries map them to other languages. A missing
translation shows the English text.

```ts
t("New task")                                   // "Nouvelle tâche" in French
t("Sent by {name}", { name: task.sender.name }) // placeholders are filled in
tn(count, "{n} task", "{n} tasks")              // plural forms, following the language's rules
```

| Part | Code | Dictionaries |
| --- | --- | --- |
| Web app | `web/src/lib/i18n.svelte.ts` | `web/src/lib/locales/fr.ts` |
| Server: error messages, e-mails, calendar | `server/src/i18n.ts` | `FR` in the same file |
| Built-in catalog of pipe and task types | `server/src/pipeTypes.ts` | `server/src/catalog-en.ts` |

The web app sends its language with each request (`X-Locale` header); otherwise the server uses the browser's
`Accept-Language`, then `DEFAULT_LOCALE`.

The built-in catalog is the exception: it describes French training centres, so it is written in French and
translated into English. Choice-list options keep their French value, which is what tasks store, and get a
translated label for display.

## Adding a language

1. Add a dictionary next to `web/src/lib/locales/fr.ts`, and use it in `t()` (`web/src/lib/i18n.svelte.ts`).
2. Add the language to `LOCALES` in `web/src/lib/i18n.svelte.ts` and `server/src/i18n.ts`, and to the `locale`
   check of the `users` table in `server/src/db.ts`.
3. Translate the server messages in `server/src/i18n.ts`, and the catalog if needed.

Keep the placeholders (`{name}`, `{n}`…) as they are, and keep translations short: they appear in buttons and menus.
