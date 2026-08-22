# Critical Path — preview-edge

The Cloud Run service behind `pr-<n>.criticalpath.skylerberg.com`. It serves one
pull request's web build out of a `pr/<n>/` prefix in the production web bucket,
behind an HTTP Basic gate.

This is the `preview-edge/` package of the Critical Path monorepo, and the
smallest of the four: a server, an auth gate, a test for the gate, a
`Dockerfile`, and its own lockfile like every package here. Nothing else in the
repository imports it, and it imports nothing from the repository.

## How a preview request reaches it

1. A pull request's build is uploaded to `gs://critical-path-web-prod/pr/<n>/`
   by `.github/workflows/web-preview-deploy.yaml`, which also posts the preview
   link as a comment. The build itself happens unprivileged in
   `.github/workflows/web-preview-build.yaml`.
2. The global load balancer's `previews` path matcher sends `/api`, `/ws` and
   `/health` to the **production API** and everything else here, through a
   serverless NEG. A preview is therefore a full same-origin virtual host: no
   CORS, no preview backend, and **real production data behind every write**.
3. `index.ts` reads the PR number out of the `Host` header. A host that does not
   match `pr-<n>.` or does not end in `PREVIEW_HOST_SUFFIX` gets 404 before
   anything else happens — this service is reachable only through that hostname
   shape.
4. The Basic gate runs next, before any bucket read.
5. The path is looked up as `pr/<n><pathname>` in `WEB_BUCKET`. `/` becomes
   `/index.html`. A miss on a route-like path — no extension, or `.html` — falls
   back to that PR's own `index.html` so a deep-link refresh boots the SPA; a
   miss on anything with an extension stays a 404, so a build that dropped an
   asset fails visibly instead of being served a page of HTML. `Content-Type`
   and `Cache-Control` come from the stored object's metadata.

Because `/api` never reaches this service, the API a preview talks to is the one
running `main` — not the pull request's `api/`. An endpoint the pull request adds
is not there.

## The auth gate

`auth.ts` is the whole of it, and it is deliberately **fail-closed**: `authorized`
returns false unless the credential it was handed is present, is not the
placeholder terraform seeds the secret with, and matches the presented one under
a constant-time comparison of SHA-256 digests. Missing configuration therefore
denies everyone rather than admitting everyone.

That direction is load-bearing rather than a preference. What the gate keeps out
is unreviewed, unmerged code on a guessable subdomain of the production domain,
wired to the production API — so an open gate is not a mild default, and an open
gate nobody notices is worse. `PLACEHOLDER_CREDENTIAL` is recognised for the
same reason: a value that lives in this repository must never be presentable as
a credential.

`PREVIEW_AUTH` is the one environment variable the service does **not** require
at startup, unlike `WEB_BUCKET` and `PREVIEW_HOST_SUFFIX`. A revision that
cannot read its secret never starts at all, and one that reads a placeholder
should answer 401s rather than crash-loop.

### Setting the credential

A fresh environment answers 401 on every preview host until the owner runs
these, and that is the intended state rather than a fault:

```sh
printf 'preview:%s' "$(openssl rand -base64 24)" |
  gcloud secrets versions add critical-path-preview-auth \
    --project=realm-construction --data-file=-

gcloud run services update critical-path-preview-edge \
  --project=realm-construction --region=us-west1 \
  --update-secrets=PREVIEW_AUTH=critical-path-preview-auth:latest
```

The second command is not optional: a running revision keeps whatever it booted
with. `infra/terraform/README.md`, under "Preview auth", owns the rest — why the
revision has to roll, how to rotate, the one secret version that must not be
deleted, and the curl sequence that confirms a live preview end to end.

## Previews do not currently work over HTTPS

The wildcard certificate for `*.criticalpath.skylerberg.com` has never finished
provisioning, because the DNS-01 validation record it is waiting on has never
been created. Every `pr-<n>` link posted on a pull request therefore fails TLS
before any of the above runs, and nothing in CI reports it. The prerequisites
list in `infra/terraform/README.md` has the record to add, the state to check
and the commands that read both — fix it there, not here.

## Working on it

```sh
pnpm -C preview-edge install
pnpm -C preview-edge run type-check
pnpm -C preview-edge run test        # node --test over auth.test.ts
```

The tests cover the gate only, which is the part with something to get wrong:
that a missing, empty or placeholder credential is refused, that the scheme
token is matched case-insensitively as RFC 7235 requires, and that a malformed
base64 payload decodes to a mismatch rather than throwing. There is no test
harness for the bucket half — it is exercised by opening a real preview.

`api-ci.yaml` type-checks and tests this package on a pull request that touches
it, and builds its image alongside api's. `.github/workflows/preview-edge.yaml`
is the deploy: on a push to `main` it builds, pushes and rolls out a new
revision, and it re-runs the gate's tests first because that gate is the only
thing standing in front of production data. It updates the **image only** —
terraform owns the service's environment, service account and ingress, so never
set those from the workflow.
