# TasksPipes

Gestion de tâches multi-utilisateur·rices adossée à [Outline](https://github.com/outline/outline) :
connexion via l'API Outline, documents Outline liés aux tâches, interface reprenant le design system d'Outline
(tokens de `shared/styles/theme.ts`, thème clair/sombre automatique).

## Fonctionnalités

- **Espaces** : chaque personne du workspace Outline a son espace personnel ; on voit aussi celui de chacun des autres.
  On crée des **espaces d'équipe** en choisissant leurs membres ; la gouvernance se partage en promouvant d'autres membres
  au rôle *admin* (au moins un admin est toujours conservé).
- **Pipes** : suites de tâches en kanban étendu — *Backlog, Prêt à démarrer, Démarré, En cours, Bloqué, Terminé, Abandonné* —
  avec glisser-déposer.
  - **Perso** / **Équipe** (privé) : visible uniquement par la personne (espace personnel) ou par les membres de l'équipe.
  - **Open** (public) : visible par tout le monde ; chacun·e peut y ajouter des tâches et commenter, seul·es les membres de l'espace les font avancer.
  - Chaque espace personnel a toujours un pipe **« Perso »** (tâches générales), qui ne s'archive ni ne se supprime.
  - **Archivage** : un pipe archivé disparaît des listes, des sélecteurs et de « Mes tâches », et n'accepte plus
    de nouvelles tâches ; il reste consultable (« Voir les pipes archivés ») et peut être désarchivé.
  - **Types** pensés pour un centre de formation pour adultes (`server/src/pipeTypes.ts`) : tâches générales, commercial,
    prospection, communication, ingénierie pédagogique, documentation, formateurs & planning, suivi des apprenants,
    qualité & Qualiopi, administratif & financier, et des **processus** (recrutement / admission, rentrée,
    examen / certification, fin de session) qui peuvent pré-remplir le backlog avec leurs tâches type.
    Chaque type a **ses colonnes** (ex. commercial : Demande › Qualification › Devis envoyé › Négociation ›
    En attente de financement › Gagné / Perdu) ; chaque colonne correspond à un état générique, utilisé par l'accueil,
    les échéances et l'archivage.
- **Types de tâches** propres à chaque type de pipe (création de cours, opportunité, candidature, indicateur Qualiopi,
  facture…), avec leurs champs : texte, montant, liste, date, titre RNCP / RS (lien France Compétences),
  documents Outline, et **fichiers** (syllabus, supports, QCM, TP, TD…, 50 Mo max par fichier, stockés en base).
- **Propriétaire** : une tâche d'un espace personnel appartient à sa ou son titulaire, sans assignation possible ;
  pour la confier à quelqu'un, on l'envoie dans son incoming. Seules les tâches d'un espace d'équipe ont un
  propriétaire choisi parmi les membres de l'équipe, y compris au moment de les envoyer à l'équipe.
- **Sous-tâches** : chaque tâche peut contenir une liste de cases à cocher (ajout à la volée, coller plusieurs lignes en crée
  plusieurs, renommage, réordonnancement par glisser-déposer) ; l'avancement (3/5) s'affiche sur les cartes et les cases cochées
  sont historisées.
- **Mes tâches** : tout ce qui m'est attribué et reste à faire, tous pipes confondus, regroupé par état (en cours, bloquées,
  prêtes, à venir) ou par pipe.
- **Prochaine action** (GTD) : capture rapide dans « Perso », rappel des tâches en cours (cocher la sous-tâche suivante,
  terminer), et suggestion de la prochaine tâche à démarrer — en retard ou à échéance proche d'abord, puis prête, déjà
  entamée ou en attente depuis longtemps — avec « Démarrer » ou « Autre suggestion ». Au-delà de 3 tâches en cours, l'outil
  invite à en terminer une d'abord.
- **Modèles** (designer) : chacun peut concevoir ses types de pipes (colonnes et leur état, types de tâches proposés,
  confidentialité, tâches de départ) et ses types de tâches (champs, avec aperçu), à partir de zéro ou d'un modèle existant.
  Un modèle naît privé (visible et utilisable par son auteur·rice seulement), peut devenir public, et se range dans une
  catégorie. Seul·e l'auteur·rice le modifie ; un type utilisé ne se supprime pas, et le type d'un champ enregistré ne change plus.
- **Menu** : « Moi » (tableau de bord, mes tâches, prochaine action, incoming, mes pipes), épinglés, mes équipes et leurs
  pipes, autres équipes et personnes (repliées), modèles.
- **Incoming bucket** pour chaque personne et chaque équipe : il reçoit les tâches envoyées par d'autres.
  Un membre peut les **accepter** (choix du pipe et de l'état) ou les **refuser en donnant une raison** : la tâche
  revient alors dans l'incoming de la personne qui l'a envoyée.
- **Traçabilité** : chaque changement est historisé avec l'état avant/après : emplacement (pipe ou incoming), état,
  propriétaire, échéance, document Outline lié, ainsi que le commentaire associé.
- **Outline** : recherche de documents (ou collage d'une URL), liaison/déliaison, création d'un document Outline depuis une tâche.
- **Markdown** partout (descriptions, commentaires, raisons de refus, descriptions d'espace et de pipe) avec aperçu.

## Stack

| Couche | Techno |
| --- | --- |
| Front | Svelte 5 (runes) + Vite 8, TypeScript, `marked` + `DOMPurify` |
| Back | Fastify 5 (logger pino), TypeScript, Node 24 LTS |
| Données | PostgreSQL 17 (schéma créé au démarrage) |
| Hébergement | Docker (image multi-étapes) + docker compose |

## Déploiement

1. Copier la configuration : `cp .env.example .env`, puis renseigner au minimum `APP_URL`, `APP_SECRET`
   (`openssl rand -hex 32`), `POSTGRES_PASSWORD` et `OUTLINE_URL`.
2. Choisir le mode de connexion :
   - **OAuth (recommandé)** : dans Outline, *Paramètres › Applications › Nouvelle application*, avec l'URL de
     redirection `${APP_URL}/auth/outline/callback`. Renseigner `OUTLINE_OAUTH_CLIENT_ID` et `OUTLINE_OAUTH_CLIENT_SECRET`.
   - **Clé API** (`ALLOW_API_KEY_LOGIN=true`) : chaque personne colle une clé API personnelle créée dans Outline.
3. `docker compose up -d --build`, puis ouvrir `APP_URL`.

Placer l'application derrière un reverse proxy HTTPS en production : avec un `APP_URL` en `https://`, les cookies sont `Secure`.
Les jetons Outline sont chiffrés (AES-256-GCM) en base avec `APP_SECRET`.

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

## Règles d'accès

| Action | Qui |
| --- | --- |
| Voir un pipe perso, l'incoming d'un espace | membres de l'espace |
| Voir un pipe open, y créer une tâche, commenter | tout le monde |
| Déplacer, changer l'état, assigner, échéance, document, envoyer | membres de l'espace qui détient la tâche |
| Modifier titre/description | membres, ou l'auteur·rice d'une tâche située dans un pipe open |
| Refuser | membres de l'espace dont l'incoming contient la tâche (sauf si on se l'est envoyée soi-même) |
| Gérer une équipe (nom, membres, rôles, suppression) | admins de l'équipe |

Les tâches ne se suppriment pas (pour garder l'historique) : on les passe en *Abandonné*.
