# Connexion OAuth Outline pour TasksPipes

[English](OAUTH-OUTLINE.md)

Permet aux membres de se connecter à TasksPipes avec leur compte Outline, sans coller de clé API.
Fonctionne uniquement avec le serveur Outline indiqué dans `OUTLINE_URL`.

## 1. Créer l'application dans Outline

> Réservé aux **administrateur·ices** de l'espace Outline.

1. Se connecter à votre instance Outline avec un compte admin.
2. Aller dans **Paramètres › Applications** (*Settings › Applications*).
3. Cliquer sur **Nouvelle application** et renseigner :
   - **Nom** : `TasksPipes`
   - **URL de redirection** : `<APP_URL>/auth/outline/callback` (par ex. `https://tasks.exemple.fr/auth/outline/callback`)
4. Enregistrer, puis ouvrir la fiche de l'application pour récupérer le **Client ID** et le **Client secret**
   (le secret peut être régénéré depuis cette fiche).

### Points d'attention

- Pas de menu **Applications** : le compte n'est pas admin, ou la version d'Outline est trop ancienne pour OAuth.
  La connexion par clé API reste alors disponible.
- L'URL de redirection doit correspondre **exactement** (avec `https`), sinon la connexion échoue au retour vers TasksPipes.

## 2. Renseigner le `.env`

```dotenv
OUTLINE_OAUTH_CLIENT_ID=<client id>
OUTLINE_OAUTH_CLIENT_SECRET=<client secret>
```

Le secret ne doit jamais être commité ni partagé (le `.env` est déjà exclu par `.gitignore`).

Facultatif : `ALLOW_API_KEY_LOGIN=false` pour n'autoriser que la connexion OAuth.

## 3. Redémarrer l'application

```bash
docker compose up -d
```

Le bouton « Continuer avec Outline » apparaît sur la page de connexion dès que les deux valeurs sont renseignées.
