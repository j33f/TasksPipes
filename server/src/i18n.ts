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
  "This link signs you in directly; it is valid for {days} days and works only once. Afterwards, ask for a new link from the sign-in page with your e-mail address.":
    "Ce lien vous connecte directement ; il est valable {days} jours et ne sert qu'une fois. Ensuite, demandez un nouveau lien depuis la page de connexion avec votre adresse e-mail.",
  "Join TasksPipes": "Rejoindre TasksPipes",
  "Or copy this link:": "Ou copiez ce lien :",

  // Data created for the user
  Personal: "Perso",
  "TasksPipes task #{n}": "Tâche TasksPipes #{n}",
};
