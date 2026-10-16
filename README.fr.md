# TasksPipes

[English](README.md)

Gestion de tâches multi-utilisateur·rices adossée à [Outline](https://github.com/outline/outline) : connexion avec
son compte Outline, documents Outline liés aux tâches, interface reprenant le design system d'Outline (tokens de
`shared/styles/theme.ts`, thèmes clair et sombre).

L'interface est disponible en **français et en anglais** : la langue suit celle du navigateur et peut être choisie
dans le profil, de même qu'un thème clair ou sombre. Le catalogue intégré de types de pipes et de tâches est pensé
pour les organismes de formation pour adultes (Qualiopi, RNCP, OPCO…) ; ses libellés sont traduits, et le designer
permet de créer ses propres types.

## Fonctionnalités

- **Espaces** : chaque personne du workspace Outline a son espace personnel ; on voit aussi celui de chacun des autres.
  On crée des **espaces d'équipe** en choisissant leurs membres ; la gouvernance se partage en promouvant d'autres
  membres au rôle *admin* (au moins un admin est toujours conservé).
- **Pipes** : kanbans étendus avec glisser-déposer. Chaque colonne correspond à un état générique — *Backlog, Prêt à
  démarrer, Démarré, En cours, Bloqué, Terminé, Abandonné* — utilisé par l'accueil, les échéances et l'archivage.
  - **Perso** / **Équipe** (privé) : visible uniquement par la personne (espace personnel) ou par les membres de l'équipe.
  - **Open** (public) : visible par tout le monde ; chacun·e peut y ajouter des tâches et commenter, seul·es les
    membres de l'espace les font avancer.
  - Chaque espace personnel a toujours un pipe **« Perso »** (tâches générales), qui ne s'archive ni ne se supprime.
  - **Archivage** : un pipe archivé disparaît des listes, des sélecteurs et de « Mes tâches », et n'accepte plus de
    nouvelles tâches ; il reste consultable (« Voir les pipes archivés ») et peut être désarchivé.
  - **Types** pensés pour un centre de formation pour adultes (`server/src/pipeTypes.ts`) : tâches générales,
    commercial, prospection, communication, ingénierie pédagogique, documentation, formateurs & planning, suivi des
    apprenants, suivi PSH (réservé à une équipe), qualité & Qualiopi, administratif & financier, et des **processus**
    (recrutement / admission, rentrée, examen / certification, fin de session) qui peuvent remplir la première colonne
    avec leurs tâches de départ. Chaque type a **ses colonnes** (ex. commercial : Demande › Qualification du besoin ›
    Devis envoyé › Négociation › En attente de financement › Gagné / Perdu).
- **Types de tâches** propres à chaque type de pipe (création de cours, opportunité, candidature, indicateur Qualiopi,
  facture…), avec leurs champs : texte, montant, liste, date, titre RNCP / RS (lien France Compétences), documents
  Outline, et **fichiers** (syllabus, supports, QCM…, 50 Mo max par fichier, stockés en base).
- **Modèles** (designer) : chacun peut concevoir ses types de pipes (colonnes et leur état, types de tâches proposés,
  confidentialité, tâches de départ) et ses types de tâches (champs, avec aperçu), à partir de zéro ou d'un modèle
  existant. Un modèle naît privé (visible et utilisable par son auteur·rice seulement), peut devenir public, et se
  range dans une catégorie. Seul·e l'auteur·rice le modifie ; un type utilisé ne se supprime pas, et le type d'un
  champ enregistré ne change plus.
- **Propriétaire** : une tâche d'un espace personnel appartient à sa ou son titulaire, sans assignation possible ; pour
  la confier à quelqu'un, on l'envoie dans son incoming. Seules les tâches d'un espace d'équipe ont un propriétaire,
  choisi parmi les membres de l'équipe, y compris au moment de les envoyer à l'équipe.
- **Sous-tâches** : chaque tâche peut contenir une liste de cases à cocher (ajout à la volée, coller plusieurs lignes
  en crée plusieurs, renommage, réordonnancement par glisser-déposer) ; l'avancement (3/5) s'affiche sur les cartes et
  les cases cochées sont historisées.
- **Mes tâches** : tout ce qui m'est attribué et reste à faire, tous pipes confondus, regroupé par état (en cours,
  bloquées, prêtes, à venir) ou par pipe.
- **Prochaine action** (GTD) : capture rapide dans « Perso », rappel des tâches en cours (cocher la sous-tâche
  suivante, terminer), et suggestion de la prochaine tâche à démarrer — en retard ou à échéance proche d'abord, puis
  prête, déjà entamée ou en attente depuis longtemps — avec « Démarrer » ou « Autre suggestion ». Au-delà de 3 tâches
  en cours, l'outil invite à en terminer une d'abord.
- **Incoming bucket** pour chaque personne et chaque équipe : il reçoit les tâches envoyées par d'autres. Un membre
  peut les **accepter** (choix du pipe et de la colonne) ou les **refuser en donnant une raison** : la tâche revient
  alors dans l'incoming de la personne qui l'a envoyée.
- **Temps réel** : une tâche envoyée ou refusée apparaît aussitôt chez son ou ses destinataires (WebSocket), avec une
  notification « Voir ». La connexion se ferme après 5 minutes d'inactivité ou 1 minute en arrière-plan, et se rouvre
  au retour sur la page (les données sont alors rechargées). Le nombre de tâches en attente s'affiche dans le titre de
  l'onglet et, sur mobile, en pastille sur le bouton du menu.
- **Invitations par e-mail** : on peut inviter des personnes sans compte Outline (formateurs, partenaires…). Elles se
  connectent par un lien à usage unique reçu par e-mail (7 jours pour une invitation, 20 minutes pour un lien demandé
  depuis la page de connexion), et peuvent ajouter une double authentification TOTP (Google Authenticator), demandée
  ensuite à chaque connexion (5 essais par lien). Un compte invité ne voit que les personnes qui l'ont invité et celles
  qu'il a invitées ; les comptes Outline ne voient pas les comptes invités, sauf ceux qu'ils ont invités eux-mêmes — et
  la liste des membres d'une équipe commune. Les comptes invités ne voient que leurs équipes et n'ont pas accès à Outline.
- **Abonnement agenda** : « Mon compte » donne un lien personnel (flux iCalendar) pour s'abonner à ses tâches qui ont une
  échéance dans Google Agenda, Calendrier d'Apple ou toute application d'agenda ; il peut être renouvelé en cas de fuite.
- **Plusieurs serveurs Outline** : la page de connexion permet d'ajouter d'autres serveurs Outline et d'en choisir un
  (liste gardée dans le navigateur) ; la connexion se fait alors par clé API sur ce serveur. Les comptes d'un serveur
  ne voient ni les personnes ni les équipes d'un autre.
- **Traçabilité** : chaque changement est historisé avec l'état avant/après : emplacement (pipe ou incoming), colonne,
  propriétaire, échéance, document Outline lié, ainsi que le commentaire associé.
- **Outline** : recherche de documents (ou collage d'une URL), liaison/déliaison, création d'un document Outline depuis
  une tâche.
- **Markdown** partout (descriptions, commentaires, raisons de refus, descriptions d'espace et de pipe) avec aperçu.

## Stack

| Couche | Techno |
| --- | --- |
| Front | Svelte 5 (runes) + Vite, TypeScript, `marked` + `DOMPurify` |
| Back | Fastify 5 (logger pino), TypeScript, Node 24 LTS, WebSocket (`@fastify/websocket`) |
| Données | PostgreSQL 17 (schéma créé au démarrage) |
| Hébergement | Docker (image multi-étapes) + docker compose |

## Déploiement

1. Copier la configuration : `cp .env.example .env`, puis renseigner au minimum `APP_URL`, `APP_SECRET`
   (`openssl rand -hex 32`), `POSTGRES_PASSWORD` et `OUTLINE_URL`.
2. Choisir le mode de connexion :
   - **OAuth (recommandé)** : voir [OAUTH-OUTLINE.fr.md](OAUTH-OUTLINE.fr.md).
   - **Clé API** (`ALLOW_API_KEY_LOGIN=true`) : chaque personne colle une clé API personnelle créée dans Outline.
   - **Autres serveurs Outline** : seuls les serveurs publics en https sont acceptés (`OUTLINE_ALLOW_PRIVATE=true` pour
     un serveur interne) ; `OUTLINE_ALLOWED_HOSTS` en restreint la liste. OAuth reste réservé au serveur configuré.
   - **E-mail** (comptes invités) : renseigner `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `MAIL_FROM` pour
     envoyer les invitations et les liens de connexion. Sans SMTP, une invitation affiche le lien à transmettre soi-même.
3. Facultatif : `DEFAULT_LOCALE` (`en` ou `fr`), la langue utilisée quand ni le navigateur ni le profil n'en donnent une
   (e-mails, pipe par défaut des personnes importées depuis Outline).
4. `docker compose up -d --build`, puis ouvrir `APP_URL`.

Placer l'application derrière un reverse proxy HTTPS en production : avec un `APP_URL` en `https://`, les cookies sont
`Secure`. Les jetons Outline et les secrets TOTP sont chiffrés en base (AES-256-GCM) avec `APP_SECRET`.

À la première connexion, les membres du workspace Outline sont importé·es (`users.list`) pour qu'on puisse leur envoyer
des tâches avant même qu'ils ou elles se connectent.

## Développement

```bash
# Stack complète avec un faux Outline (clés API : alice-token, bob-token, carol-token)
docker compose --env-file dev/.env.dev -f docker-compose.yml -f dev/docker-compose.dev.yml up --build

# Ou en local (Node 24) :
cd server && npm install && OUTLINE_URL=… DATABASE_URL=… APP_SECRET=… npm run dev   # :3000
cd web && npm install && npm run dev                                                 # :5173, proxy vers :3000
```

Vérifications : `npm run typecheck` (server), `npm run check` (web, svelte-check).

### Traductions

Les textes sont écrits en anglais dans le code et traduits avec `t("…")` :

- application web : `web/src/lib/i18n.svelte.ts`, le français dans `web/src/lib/locales/fr.ts` ;
- serveur (messages d'erreur, e-mails) : `server/src/i18n.ts` ; le serveur répond dans la langue envoyée par
  l'application (en-tête `X-Locale`), sinon dans celle du navigateur (`Accept-Language`) ;
- le catalogue intégré (`server/src/pipeTypes.ts`) est écrit en français et traduit par `server/src/catalog-en.ts` ;
  les choix des listes gardent leur valeur enregistrée (en français) et reçoivent un libellé traduit.

Une traduction manquante affiche le texte source. Pour ajouter une langue, ajouter un dictionnaire et son code à
`LOCALES` des deux côtés.

## Règles d'accès

| Action | Qui |
| --- | --- |
| Voir un pipe privé, l'incoming d'un espace | membres de l'espace |
| Voir un pipe open, y créer une tâche, commenter | toute personne qui voit son espace |
| Déplacer, changer la colonne, assigner, échéance, document, envoyer | membres de l'espace qui détient la tâche |
| Modifier titre/description | membres, ou l'auteur·rice d'une tâche située dans un pipe open |
| Refuser | membres de l'espace dont l'incoming contient la tâche (sauf si on se l'est envoyée soi-même) |
| Gérer une équipe (nom, membres, rôles, suppression) | admins de l'équipe |
| Ajouter quelqu'un à une équipe, lui envoyer une tâche | admins de l'équipe / membres, parmi les personnes qu'on voit |

Les tâches ne se suppriment pas (pour garder l'historique) : on les passe en *Abandonné*.

## Licence

TasksPipes est distribué sous [Business Source License 1.1](LICENSE), comme Outline : vous pouvez l'utiliser, le
modifier et l'héberger, y compris pour votre propre organisme, mais pas le proposer comme service commercial de gestion
de tâches à des tiers. Le 2030-10-16 (Change Date), le code passe sous licence Apache 2.0. D'ici là, c'est une licence
« source disponible », et non une licence open source au sens de l'OSI.
