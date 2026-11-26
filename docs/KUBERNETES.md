# TasksPipes on Kubernetes

TasksPipes runs as several instances on one PostgreSQL database with nothing to turn on (see
[Several instances](HOSTING.md#several-instances)): sessions and files are in the database, background work is
claimed in it, live updates and presence are shared through it, and instances starting together take turns to bring
the schema up to date. Kubernetes is an option among others: the [Docker Compose setup](HOSTING.md) stays the
simplest, and the only one with the installer and one-click updates. Without containers, see
[MANUAL-HOSTING.md](MANUAL-HOSTING.md).

Manifests (Kustomize) are in [`deploy/kubernetes/`](../deploy/kubernetes):

| Folder | What it holds |
| --- | --- |
| `base/` | The app: a Deployment (2 replicas, probes, non-root, read-only root file system), a Service, a PodDisruptionBudget. |
| `backup/` | Optional: a daily `pg_dump` into a volume, keeping 14 days. |
| `example/` | A complete example to try it (kind, minikube…): the base and the backup, plus a PostgreSQL, a Redis, a Secret and an Ingress. |

## Trying it

```shell
kind create cluster
cp deploy/kubernetes/example/secret.env.example deploy/kubernetes/example/secret.env
# fill secret.env in: APP_SECRET and POSTGRES_PASSWORD from `openssl rand -hex 32`, the password in DATABASE_URL too
kubectl apply -k deploy/kubernetes/example
kubectl -n taskspipes rollout status deployment/taskspipes
kubectl -n taskspipes port-forward svc/taskspipes 8080:80     # then http://localhost:8080
```

The example's Secret comes from `secret.env`, which git ignores: without it, nothing is applied, so no instance runs
with a secret written in the repository. Its PostgreSQL has no replication: it is for trying, not for production.

## In production

### What you provide

- **PostgreSQL** 15 or later — a managed database is advised. The account must be able to create the `pgcrypto` and
  `unaccent` extensions, or they are created beforehand. Through PgBouncer in transaction mode, also set
  `LISTEN_DATABASE_URL` to a direct connection (live updates use `LISTEN`).
- **Redis** (advised from two replicas): rate limits are then counted once for all instances, not per pod.
- An **Ingress** (or Gateway) serving https, with long timeouts for the WebSocket of live updates (`/api/events`).
- A **Secret** named `taskspipes`, holding the configuration (see below).

### Your overlay

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: taskspipes
resources:
  - github.com/j33f/TasksPipes//deploy/kubernetes/base?ref=v0.34.0
  - github.com/j33f/TasksPipes//deploy/kubernetes/backup?ref=v0.34.0   # optional
  - ingress.yaml                                                        # yours
images:
  - name: ghcr.io/j33f/taskspipes
    newTag: "0.34.0"
```

### The Secret

Every variable of [the configuration](HOSTING.md#configuration) can go in it; at least:

```shell
kubectl -n taskspipes create secret generic taskspipes \
  --from-literal=APP_URL=https://tasks.example.com \
  --from-literal=APP_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DATABASE_URL='postgres://taskspipes:…@db.example.com:5432/taskspipes' \
  --from-literal=REDIS_URL=redis://redis:6379
```

Every replica must have the **same `APP_SECRET`**: it encrypts the secrets kept in the database and derives the keys
of push notifications. Keep a copy outside the cluster: a backup of the database cannot be read without it.

### What the manifests set

- **Probes**: `/livez` for liveness and startup (the process answers; a database outage restarts nothing),
  `/healthz` for readiness (it reaches the database). The startup probe leaves up to five minutes to bring the
  schema up to date.
- **Rolling updates** add a pod before removing one, and a `preStop` pause lets the load balancer drop a pod before
  it stops: open pages reconnect to another instance and reload their data.
- **Security**: non-root (`node`, uid 1000), no privilege escalation, every capability dropped, read-only root file
  system (a writable `/tmp` only). The app writes nothing on disk: files and pictures are in the database.
- **One-click updates** are turned off (`UPDATER_TOKEN` empty): they are for Docker Compose.

### Updating

Change the image's tag (`newTag`) and apply: pods are replaced one by one, the first new one brings the schema up to
date, the others wait for it. Administrators are told of each release (e-mail, *About*). Read the release notes, and
back up first. Going back to an older version after a schema change is not supported: restore the backup instead.

### Backups

The `backup/` CronJob runs `pg_dump -Fc` at 03:15 into its volume and keeps 14 days; run one now with
`kubectl -n taskspipes create job --from=cronjob/taskspipes-backup backup-now`. Copy the dumps out of the cluster
(or rely on your managed database's backups), and keep `APP_SECRET` with them. To restore: scale the Deployment to 0,
`pg_restore --clean --if-exists -d "$DATABASE_URL" taskspipes-….dump`, scale it back.

The *Backups* tab of the administration only follows the backups made by the Docker scripts.

### Other notes

- Behind the Ingress, the app trusts `X-Forwarded-For` for its logs and rate limits: let only the Ingress reach the
  pods (a NetworkPolicy), as the Service is not meant to be exposed directly.
- AI agents over MCP (`/mcp`) and their OAuth endpoints keep nothing between requests: they work across replicas.
- A HorizontalPodAutoscaler can be added on CPU; two replicas suit most teams.
