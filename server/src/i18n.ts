/**
 * Server-side translations. Messages are written in English in the code; FR holds their French version.
 * The catalog of pipe and task types is French (it describes French training centres); CATALOG_EN
 * translates it. A request's language comes from the X-Locale header the web app sends, else from
 * Accept-Language.
 */
import type { FastifyRequest } from "fastify";
import { config } from "./config.js";
import type { Params } from "./errors.js";
import { CATALOG_EN } from "./catalog-en.js";
import type { PipeType, TaskType } from "./pipeTypes.js";

export type Locale = "en" | "fr";
export const LOCALES: Locale[] = ["en", "fr"];

export function localeOf(req: FastifyRequest): Locale {
  const h = req.headers["x-locale"];
  if (h === "en" || h === "fr") return h;
  for (const part of String(req.headers["accept-language"] || "").split(",")) {
    const tag = part.trim().slice(0, 2).toLowerCase();
    if (tag === "fr" || tag === "en") return tag;
  }
  return config.defaultLocale;
}

/**
 * A word or label in the given language: English UI words are translated to French, French catalog
 * labels to English; anything else (names, user text) is left as is.
 */
export function localize(lang: Locale, v: string): string {
  return lang === "fr" ? (FR[v] ?? v) : (CATALOG_EN[v] ?? v);
}

/** Translates a message and fills its "{name}" placeholders (known words among the values are translated too). */
export function tr(lang: Locale, msg: string, params?: Params): string {
  const s = lang === "fr" ? (FR[msg] ?? msg) : msg;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (all, k: string) =>
    k in params ? (typeof params[k] === "number" ? String(params[k]) : localize(lang, String(params[k]))) : all
  );
}

/**
 * A task type as shown in a language. Select options keep their stored value in `options`
 * and get their display text in `optionLabels`.
 */
export function localizeTaskType(lang: Locale, t: TaskType) {
  const l = (v: string) => localize(lang, v);
  return {
    ...t,
    label: l(t.label),
    description: l(t.description),
    ...(t.group ? { group: l(t.group) } : {}),
    fields: t.fields.map((f) => ({
      ...f,
      label: l(f.label),
      ...(f.hint ? { hint: l(f.hint) } : {}),
      ...(f.options ? { optionLabels: f.options.map(l) } : {}),
    })),
  };
}

export function localizePipeType(lang: Locale, p: PipeType): PipeType {
  const l = (v: string) => localize(lang, v);
  return {
    ...p,
    label: l(p.label),
    group: l(p.group),
    description: l(p.description),
    columns: p.columns.map((c) => ({ ...c, label: l(c.label) })),
    templates: p.templates.map(l),
  };
}

export const FR: Record<string, string> = {
  // Generic validation
  "{label} is required": "{label} requis",
  "{label} is too long": "{label} trop long",
  "{label} is too long ({max} characters at most)": "{label} trop long ({max} caractères au plus)",
  "{label} is invalid": "{label} invalide",
  "{label}: {max} at most": "{label} : {max} au plus",
  "Action not allowed": "Action non autorisée",
  "Not found": "Introuvable",
  "Not signed in": "Non authentifié",
  "Invalid parameter": "Paramètre invalide",
  "Invalid language": "Langue invalide",
  "Invalid theme": "Thème invalide",
  "Internal error": "Erreur interne",
  "Outline: {message}": "Outline : {message}",

  // Labels used in messages
  Title: "Titre",
  Description: "Description",
  Comment: "Commentaire",
  Name: "Nom",
  "E-mail": "E-mail",
  Task: "Tâche",
  Pipe: "Pipe",
  Space: "Espace",
  User: "Utilisateur",
  Team: "Équipe",
  Person: "Personne",
  Owner: "Propriétaire",
  Recipient: "Destinataire",
  "Reason for refusing": "Raison du refus",
  "Sub-task": "Sous-tâche",
  File: "Fichier",
  "File name": "Nom du fichier",
  Collection: "Collection",
  Colour: "Couleur",
  Columns: "Colonnes",
  "Column name": "Nom de colonne",
  "Task types": "Types de tâches",
  Category: "Catégorie",
  Icon: "Icône",
  "Starter tasks": "Tâches de départ",
  "Starter task": "Tâche de départ",
  Fields: "Champs",
  "Field name": "Nom du champ",
  Choices: "Choix",
  Choice: "Choix",
  Help: "Aide",
  column: "colonne",
  field: "champ",
  "Custom models": "Modèles personnalisés",
  Untitled: "Sans titre",

  // Tasks, pipes, spaces
  "Invalid due date": "Date d'échéance invalide",
  "Invalid status": "Statut invalide",
  "Invalid Outline document": "Document Outline invalide",
  "Invalid task type": "Type de tâche invalide",
  "Invalid pipe type": "Type de pipe invalide",
  "Task not found": "Tâche introuvable",
  "Pipe not found": "Pipe introuvable",
  "Space not found": "Espace introuvable",
  "Recipient not found": "Destinataire introuvable",
  "Unknown user": "Utilisateur inconnu",
  "Invalid repetition": "Répétition invalide",
  "Choose at least one day of the week": "Choisissez au moins un jour de la semaine",
  "Only a task in a pipe can repeat": "Seule une tâche dans un pipe peut se répéter",
  "Create it at most {n} days ahead": "Créez-la au plus {n} jours à l'avance",
  "Invalid end date": "Date de fin invalide",
  "The end date comes before the first date": "La date de fin précède la première date",
  "This access token can only read": "Ce jeton d'accès ne permet que la lecture",
  "Choose what the token may do": "Choisissez ce que le jeton peut faire",
  "A token expires within {n} days": "Un jeton expire dans {n} jours au plus",
  "Invalid address": "Adresse invalide",
  "A webhook address must use https://": "L'adresse d'un webhook doit utiliser https://",
  "This address is not allowed (internal address).": "Cette adresse n'est pas autorisée (adresse interne).",
  "Choose at least one event": "Choisissez au moins un événement",
  "A confidential pipe has no webhooks: its content stays in the app.": "Un pipe confidentiel n'a pas de webhooks : son contenu reste dans l'application.",
  "This access token is invalid, expired or revoked": "Ce jeton d'accès n'est pas valide, a expiré ou a été révoqué",
  "Only the space's members can import tasks": "Seuls les membres de l'espace peuvent importer des tâches",
  "Choose a file": "Choisissez un fichier",
  "This is not a Trello board exported as JSON": "Ce n'est pas un tableau Trello exporté en JSON",
  "The file holds no task": "Le fichier ne contient aucune tâche",
  "Unknown person: {name}": "Personne inconnue : {name}",
  "“{field}” is not a field of “{type}”": "« {field} » n'est pas un champ de « {type} »",
  "“{type}” is not a task type of this pipe": "« {type} » n'est pas un type de tâche de ce pipe",
  "Unknown column “{column}”: choose where it goes": "Colonne inconnue « {column} » : choisissez où la placer",
  "{name} is not a member of this space": "{name} n'est pas membre de cet espace",
  "Invalid due date: {date}": "Échéance invalide : {date}",
  "Key": "Clé",
  "Due date": "Échéance",
  "Sub-tasks": "Sous-tâches",
  "Priority": "Priorité",
  "Labels": "Étiquettes",
  "Urgent": "Urgente",
  "High": "Haute",
  "Medium": "Moyenne",
  "Low": "Basse",
  "Author": "Auteur·rice",
  "Created": "Créée le",
  "Updated": "Modifiée le",
  "(ignore)": "(ignorer)",
  "At most {n} lines can be imported at once": "{n} lignes au plus peuvent être importées à la fois",
  "No column holds the title": "Aucune colonne ne contient le titre",
  "{name} on Trello, {date}:": "{name} sur Trello, le {date} :",
  "{n} lines cannot be imported: nothing was imported": "{n} lignes ne peuvent pas être importées : rien n'a été importé",
  "{name} has not signed in to TasksPipes yet: invite them first.": "{name} ne s'est pas encore connecté·e à TasksPipes : invitez cette personne d'abord.",
  "{name} already uses TasksPipes.": "{name} utilise déjà TasksPipes.",
  "{name} would like to share tasks with you on TasksPipes, the task manager that works with your Outline workspace.":
    "{name} aimerait partager des tâches avec vous sur TasksPipes, le gestionnaire de tâches qui fonctionne avec votre espace Outline.",
  "Sign in with your Outline account, on the server {server}.": "Connectez-vous avec votre compte Outline, sur le serveur {server}.",
  "User not found": "Utilisateur introuvable",
  "You cannot disable your own account": "Vous ne pouvez pas désactiver votre propre compte",
  "An administrator cannot be disabled: remove them from ADMIN_EMAILS first": "Un administrateur ne peut pas être désactivé : retirez-le d'abord de ADMIN_EMAILS",
  "This account is disabled on this instance.": "Ce compte est désactivé sur cette instance.",
  "An Outline account cannot be deleted here: it comes from your Outline workspace.": "Un compte Outline ne peut pas être supprimé ici : il vient de votre espace Outline.",
  "Deleting an account needs e-mail or two-factor authentication on this instance.": "Supprimer un compte demande l'e-mail ou la double authentification sur cette instance.",
  "This link is invalid or has expired.": "Ce lien n'est pas valide ou a expiré.",
  "Deleted account": "Compte supprimé",
  "Confirm the deletion of your TasksPipes account": "Confirmez la suppression de votre compte TasksPipes",
  "You asked to delete your TasksPipes account. This link deletes it for good, with your personal space and its tasks; what you did in teams stays in their history, under “Deleted account”. It is valid for {minutes} minutes.":
    "Vous avez demandé la suppression de votre compte TasksPipes. Ce lien le supprime définitivement, avec votre espace personnel et ses tâches ; ce que vous avez fait dans les équipes reste dans leur historique, sous « Compte supprimé ». Il est valable {minutes} minutes.",
  "If you did not ask for it, ignore this e-mail: your account stays as it is.": "Si vous ne l'avez pas demandé, ignorez cet e-mail : votre compte reste tel quel.",
  "Delete my account": "Supprimer mon compte",
  "A user is required": "Utilisateur requis",
  "The owner must be a member of the team": "Le ou la propriétaire doit être membre de l'équipe",
  "A task in a personal space belongs to its holder: send it to someone instead.":
    "Une tâche d'un espace personnel appartient à sa ou son titulaire : envoyez-la plutôt à quelqu'un.",
  "A “{type}” pipe is created in a team space (the PSH team for instance), not in a personal space.":
    "Un pipe « {type} » se crée dans un espace d'équipe (par exemple l'équipe PSH), pas dans un espace personnel.",
  "This task holds confidential data: it cannot leave its space.":
    "Cette tâche contient des données confidentielles : elle ne peut pas quitter son espace.",
  "Personal spaces cannot be changed": "Les espaces personnels ne peuvent pas être modifiés",
  "Only the team's admins can do this": "Seuls les administrateurs de l'équipe peuvent faire cela",
  "The team must keep at least one admin": "L'équipe doit garder au moins un administrateur",
  "The team still holds tasks: move or send them before deleting it.":
    "L'équipe contient encore des tâches : déplacez-les ou envoyez-les avant de la supprimer.",
  "This space cannot be left": "Impossible de quitter cet espace",
  "The default pipe of a personal space cannot be archived": "Le pipe par défaut de l'espace personnel ne peut pas être archivé",
  "This pipe still has {n} open task(s): finish, drop or move them before archiving it.":
    "Ce pipe a encore {n} tâche(s) en cours : terminez-les, abandonnez-les ou déplacez-les avant de l'archiver.",
  "The default pipe of a personal space cannot be deleted": "Le pipe par défaut de l'espace personnel ne peut pas être supprimé",
  "This pipe still holds tasks: move them before deleting it.": "Ce pipe contient encore des tâches : déplacez-les avant de le supprimer.",
  "This pipe is archived": "Ce pipe est archivé",
  "The task is already in this incoming": "La tâche est déjà dans cet incoming",
  "Only a task received in your incoming can be refused": "Seule une tâche reçue dans votre incoming peut être refusée",
  "Invalid sub-tasks": "Sous-tâches invalides",
  "{n} sub-tasks at most": "{n} sous-tâches au maximum",
  "Sub-task not found": "Sous-tâche introuvable",
  "Sub-task: invalid state": "Sous-tâche : état invalide",
  "Invalid position": "Position invalide",
  "This field does not take files": "Ce champ n'accepte pas de fichiers",
  "Empty file": "Fichier vide",
  "File not found": "Fichier introuvable",
  "File too large": "Fichier trop volumineux",

  // Fields of task types
  "Invalid fields": "Champs invalides",
  "Unknown field for “{type}”: {id}": "Champ inconnu pour « {type} » : {id}",
  "{field}: invalid value": "{field} : valeur invalide",
  "{field}: too long": "{field} : trop long",
  "{field}: a number is expected": "{field} : nombre attendu",
  "{field}: invalid date": "{field} : date invalide",
  "{field}: invalid choice": "{field} : choix invalide",
  "{field}: invalid person": "{field} : personne invalide",
  "{field}: expected a code like RNCP12345 or RS1234": "{field} : code attendu au format RNCP12345 ou RS1234",
  "{field}: invalid document": "{field} : document invalide",
  "{field}: files are uploaded separately": "{field} : les fichiers s'envoient à part",

  // Designer
  "Invalid colour": "Couleur invalide",
  "Column {n}: invalid state": "Colonne {n} : état invalide",
  "Column {n}: invalid colour": "Colonne {n} : couleur invalide",
  "At least two columns are needed": "Il faut au moins deux colonnes",
  "At least one “done” column is needed": "Il faut au moins une colonne « terminé »",
  "Unknown task type: {id}": "Type de tâche inconnu : {id}",
  "{what} “{name}”: invalid id": "{what} « {name} » : identifiant invalide",
  "Duplicate {what}: {id}": "{what} en double : {id}",
  "Field “{name}”: invalid type": "Champ « {name} » : type invalide",
  "Field “{name}”: add at least one choice": "Champ « {name} » : ajoutez au moins un choix",
  "Field “{name}”: its type can no longer change (tasks may use it). Create a new field instead.":
    "Champ « {name} » : son type ne peut plus changer (des tâches l'utilisent peut-être). Créez un nouveau champ.",
  "Pipe type not found (built-in types can be duplicated)": "Type de pipe introuvable (les types intégrés se dupliquent)",
  "Task type not found (built-in types can be duplicated)": "Type de tâche introuvable (les types intégrés se dupliquent)",
  "Only the author of this model can change it: duplicate it to make your own version.":
    "Seul·e l'auteur·rice de ce modèle peut le modifier : dupliquez-le pour en faire votre version.",
  "{n} pipe(s) of this type are in personal spaces: it cannot be reserved to a team.":
    "{n} pipe(s) de ce type sont dans des espaces personnels : il ne peut pas être réservé à une équipe.",
  "{n} pipe(s) use this type (archived ones included): it cannot be deleted.":
    "{n} pipe(s) utilisent ce type (archivés compris) : il ne peut pas être supprimé.",
  "{n} task(s) use this type: it cannot be deleted.": "{n} tâche(s) utilisent ce type : il ne peut pas être supprimé.",
  "This type is offered in: {types}. Remove it from these pipe types first.":
    "Ce type est proposé dans : {types}. Retirez-le d'abord de ces types de pipes.",

  // Reports
  "{n} min": "{n} min",
  "{h} h {m}": "{h} h {m}",
  "{h} h": "{h} h",
  "{d} d {h} h": "{d} j {h} h",
  "{d} d": "{d} j",
  "New in the pipe": "Nouvelles dans le pipe",
  "Tasks started": "Tâches démarrées",
  "Tasks done": "Tâches terminées",
  "Tasks blocked": "Tâches bloquées",
  "Tasks dropped": "Tâches abandonnées",
  Done: "Terminées",
  Blocked: "Bloquées",
  "Still in progress": "Toujours en cours",
  "Still blocked": "Toujours bloquées",
  "Activity of {pipe} — {day}": "Activité de {pipe} — {day}",
  "From {start} to {end}.": "Du {start} au {end}.",
  "Task type": "Type de tâche",
  "In progress": "En cours",
  Tasks: "Tâches",
  "No time recorded this week.": "Aucun temps enregistré cette semaine.",
  "Tasks that took the most time": "Les tâches qui ont pris le plus de temps",
  "Time report of {pipe} — week to {day}": "Rapport de temps de {pipe} — semaine au {day}",
  "Time spent on tasks being worked on, from {start} to {end}: {total}.": "Temps passé sur les tâches en cours, du {start} au {end} : {total}.",
  "Open the pipe": "Ouvrir le pipe",
  "You receive this e-mail because the pipe sends its reports to the members of its space.":
    "Vous recevez cet e-mail parce que le pipe envoie ses rapports aux membres de son espace.",

  // Git integrations
  "Unknown provider": "Fournisseur inconnu",

  // Model files
  "Nothing to export": "Rien à exporter",
  "This file is not valid YAML: {error}": "Ce fichier n'est pas un YAML valide : {error}",
  "This file is not a TasksPipes model file": "Ce fichier n'est pas un fichier de modèles TasksPipes",
  "Unsupported model file version: {version}": "Version de fichier de modèles non prise en charge : {version}",
  "This file holds no model": "Ce fichier ne contient aucun modèle",
  "{n} models at most per file": "{n} modèles au plus par fichier",
  "Choose a model file": "Choisissez un fichier de modèles",
  "This file is too large for a model file": "Ce fichier est trop volumineux pour un fichier de modèles",

  // Accounts, invitations, sign-in
  "The name of an Outline account is changed in Outline": "Le nom d'un compte Outline se change dans Outline",
  "Two-factor authentication is for accounts invited by e-mail; an Outline account sets it up in Outline.":
    "La double authentification concerne les comptes invités par e-mail ; un compte Outline la règle dans Outline.",
  "Two-factor authentication is already on": "La double authentification est déjà active",
  "Start the setup again": "Recommencez la configuration",
  "Wrong code: check your phone's clock and try again.": "Code incorrect : vérifiez l'heure de votre téléphone et réessayez.",
  "Wrong code": "Code incorrect",
  "Invalid e-mail address": "Adresse e-mail invalide",
  "That is your own address": "C'est votre propre adresse",
  "Invitation not found": "Invitation introuvable",
  "Account not found": "Compte introuvable",
  "Incompatible account": "Compte incompatible",
  "E-mail sending is not set up: ask the person who invited you for a link.":
    "L'envoi d'e-mails n'est pas configuré : demandez un lien à la personne qui vous a invité·e.",
  "This link is no longer valid (already used or expired). Ask for a new one.":
    "Ce lien n'est plus valable (déjà utilisé ou expiré). Demandez-en un nouveau.",
  "Verification expired or too many attempts: sign in again with a new link.":
    "Vérification expirée ou trop de tentatives : reconnectez-vous avec un nouveau lien.",
  "OAuth is not set up": "OAuth non configuré",
  "Invalid OAuth state, please try again.": "État OAuth invalide, veuillez réessayer.",
  "Sign-in failed": "Connexion impossible",
  "API key sign-in is disabled": "Connexion par clé API désactivée",
  "API key required": "Clé API requise",
  "Invalid Outline API key": "Clé API Outline invalide",
  "Unexpected answer: is this really an Outline server?": "Réponse inattendue : est-ce bien un serveur Outline ?",
  "This account does not belong to the allowed Outline workspace.":
    "Ce compte n'appartient pas à l'espace de travail Outline autorisé.",
  "Outline is not available to accounts invited by e-mail.": "Outline n'est pas accessible aux comptes invités par e-mail.",

  // Outline servers
  "Server not found: {host}": "Serveur introuvable : {host}",
  "This Outline server is not allowed (internal address).": "Ce serveur Outline n'est pas autorisé (adresse interne).",
  "Invalid Outline server address": "Adresse de serveur Outline invalide",
  "The Outline server must use https://": "Le serveur Outline doit être en https://",
  "This Outline server is not allowed here.": "Ce serveur Outline n'est pas autorisé ici.",
  "Outline server unreachable: {cause}": "Serveur Outline injoignable : {cause}",

  // Calendar feed
  Column: "Colonne",
  "Tasks assigned to {name} that have a due date": "Tâches attribuées à {name} qui ont une échéance",
  "Due in 5 days: {title}": "Échéance dans 5 jours : {title}",
  "Due tomorrow: {title}": "Échéance demain : {title}",
  "Due today: {title}": "Échéance aujourd'hui : {title}",

  // Invitations, connection requests, avatars, sign-up
  "Invitations by e-mail are turned off on this instance": "Les invitations par e-mail sont désactivées sur cette instance",
  "{name} wants to connect with you on TasksPipes": "{name} souhaite se connecter avec vous sur TasksPipes",
  "{name} wants to connect with you on TasksPipes, to share tasks. You can accept or refuse from your dashboard.":
    "{name} souhaite se connecter avec vous sur TasksPipes pour partager des tâches. Vous pouvez accepter ou refuser depuis votre tableau de bord.",
  "Open TasksPipes": "Ouvrir TasksPipes",
  "The picture of an Outline account is changed in Outline": "La photo d'un compte Outline se change dans Outline",
  "The picture must be a PNG, JPEG, WebP or GIF image": "La photo doit être une image PNG, JPEG, WebP ou GIF",
  "Sign-up is turned off on this instance": "La création de compte est désactivée sur cette instance",
  "Welcome to TasksPipes": "Bienvenue sur TasksPipes",
  "Your account is ready. This link confirms your address and signs you in; it is valid for {hours} hours and works only once.":
    "Votre compte est prêt. Ce lien confirme votre adresse et vous connecte ; il est valable {hours} heures et ne sert qu'une fois.",
  "You already have an account on TasksPipes with your Outline account: sign in with Outline.":
    "Vous avez déjà un compte TasksPipes avec votre compte Outline : connectez-vous avec Outline.",
  "Outline server address required": "Adresse du serveur Outline requise",

  // E-mails
  "Your TasksPipes sign-in link": "Votre lien de connexion à TasksPipes",
  "Hello {name},": "Bonjour {name},",
  "Here is your link to sign in to TasksPipes. It is valid for {minutes} minutes and works only once.":
    "Voici votre lien pour vous connecter à TasksPipes. Il est valable {minutes} minutes et ne sert qu'une fois.",
  "If you did not ask for this link, just ignore this e-mail.": "Si vous n'avez pas demandé ce lien, ignorez simplement cet e-mail.",
  "Sign in": "Se connecter",
  "{name} invites you to TasksPipes": "{name} vous invite sur TasksPipes",
  "{name} invites you to share tasks with them on TasksPipes.": "{name} vous invite à partager des tâches avec lui ou elle sur TasksPipes.",
  "This link signs you in directly; it is valid for {hours} hours and works only once. Afterwards, ask for a new link from the sign-in page with your e-mail address.":
    "Ce lien vous connecte directement ; il est valable {hours} heures et ne sert qu'une fois. Ensuite, demandez un nouveau lien depuis la page de connexion avec votre adresse e-mail.",
  "Join TasksPipes": "Rejoindre TasksPipes",
  "Or copy this link:": "Ou copiez ce lien :",

  // E-mail notifications
  "Too many requests: please try again later": "Trop de requêtes : réessayez plus tard",
  "Invalid notification settings": "Réglages de notification invalides",
  "Someone": "Quelqu'un",
  "{name} sent you this task": "{name} vous a envoyé cette tâche",
  "{name} sent this task to the incoming of {space}": "{name} a envoyé cette tâche dans l'incoming de {space}",
  "{name} made you the owner of this task": "{name} vous a confié cette tâche",
  "{name} refused this task": "{name} a refusé cette tâche",
  "{name} mentioned you": "{name} vous a mentionné·e",
  "{name} commented": "{name} a commenté",
  "Incoming of {space}": "Incoming de {space}",
  "confidential task: open it to see its content": "tâche confidentielle : ouvrez-la pour voir son contenu",
  "You receive this e-mail because of your notification settings in TasksPipes.": "Vous recevez cet e-mail en raison de vos réglages de notification dans TasksPipes.",
  "Change them": "Les modifier",
  "Unsubscribe": "Se désabonner",
  "New task for you: {task}": "Nouvelle tâche pour vous : {task}",
  "You now own {task}": "{task} vous est confiée",
  "Task refused: {task}": "Tâche refusée : {task}",
  "You were mentioned in {task}": "Vous êtes mentionné·e dans {task}",
  "New comment on {task}": "Nouveau commentaire sur {task}",
  "Activity on {task}": "Activité sur {task}",
  "Your TasksPipes notifications — {day}": "Vos notifications TasksPipes — {day}",
  "Your due dates — {day}": "Vos échéances — {day}",
  "due on {date}": "échéance le {date}",
  "and {n} more": "et {n} autres",
  "Overdue": "En retard",
  "Due today": "À rendre aujourd'hui",
  "Due tomorrow": "À rendre demain",
  "Tasks received": "Tâches reçues",
  "Tasks you now own": "Tâches qui vous sont confiées",
  "Tasks refused": "Tâches refusées",
  "Mentions": "Mentions",
  "Tasks no longer blocked": "Tâches débloquées",
  "The tasks it waited for are finished": "Les tâches qu'elle attendait sont terminées",
  "No longer blocked: {task}": "Débloquée : {task}",
  "Comments": "Commentaires",
  "Due date reminders": "Rappels d'échéance",
  "Invalid link": "Lien invalide",
  "This unsubscribe link is not valid. You can change your e-mail notifications in the settings of TasksPipes.": "Ce lien de désabonnement n'est pas valide. Vous pouvez modifier vos notifications par e-mail dans les réglages de TasksPipes.",
  "Stop the e-mails about: {what}?": "Ne plus recevoir d'e-mails pour : {what} ?",
  "Unsubscribed": "Désabonnement effectué",
  "You will no longer get e-mails about: {what}. You can turn them back on in the settings of TasksPipes.": "Vous ne recevrez plus d'e-mails pour : {what}. Vous pouvez les réactiver dans les réglages de TasksPipes.",

  // Dependencies between tasks
  "A task cannot wait for itself": "Une tâche ne peut pas s'attendre elle-même",
  "This task already waits for this one": "Cette tâche attend déjà celle-ci",
  "A task waits for {n} tasks at most": "Une tâche attend {n} tâches au plus",
  "Blocking task": "Tâche bloquante",
  "This task type fits none of the recipient's pipes": "Ce type de tâche ne correspond à aucun pipe du destinataire",

  // Labels and priority
  "Invalid priority": "Priorité invalide",
  "Invalid label": "Étiquette invalide",
  "Invalid color": "Couleur invalide",
  "Label not found": "Étiquette introuvable",
  "A label with this name already exists": "Une étiquette porte déjà ce nom",
  "A space has {n} labels at most": "Un espace a {n} étiquettes au plus",

  // Data created for the user
  Personal: "Perso",
  "TasksPipes task #{n}": "Tâche TasksPipes #{n}",
};
