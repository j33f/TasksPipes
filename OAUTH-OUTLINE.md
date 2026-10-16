# Connexion OAuth Outline pour TasksPipes

Permet aux membres de se connecter à TasksPipes avec leur compte Outline, sans coller de clé API.

## 1. Créer l'application dans Outline

> Réservé aux **administrateur·ices** de l'espace Outline.

1. Se connecter à <https://ressources.diginamic.fr> avec un compte admin.
2. Aller dans **Paramètres › Applications** (*Settings › Applications*).
3. Cliquer sur **Nouvelle application** et renseigner :
   - **Nom** : `TasksPipes`
   - **URL de redirection** : `https://taskspipes.modulaweb.fr/auth/outline/callback`
4. Enregistrer, puis ouvrir la fiche de l'application pour récupérer le **Client ID** et le **Client secret**
   (le secret peut être régénéré depuis cette fiche).

### Points d'attention

- Pas de menu **Applications** : le compte n'est pas admin, ou la version d'Outline est trop ancienne pour OAuth.
  La connexion par clé API reste alors disponible.
- L'URL de redirection doit correspondre **exactement** (avec `https`), sinon la connexion échoue au retour vers TasksPipes.

## 2. Renseigner le `.env`

Dans `/home/debian/TasksPipes/.env`, compléter :

```dotenv
OUTLINE_OAUTH_CLIENT_ID=<client id>
OUTLINE_OAUTH_CLIENT_SECRET=<client secret>
```

Le secret ne doit jamais être commité ni partagé (le `.env` est déjà exclu par `.gitignore`).

Optionnel : `ALLOW_API_KEY_LOGIN=false` pour n'autoriser que la connexion OAuth.

## 3. Redémarrer l'application

```bash
cd /home/debian/TasksPipes && docker compose up -d
```

Le bouton de connexion via Outline apparaît sur <https://taskspipes.modulaweb.fr> dès que les deux valeurs sont renseignées.
