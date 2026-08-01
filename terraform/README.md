# Critical Path infrastructure

Global HTTPS load balancer, web bucket, and supporting resources for
https://criticalpath.skylerberg.com. State lives in
`gs://cow-terraform-state` under the `critical-path` prefix.

```
terraform init
terraform apply
```

## URL map routing

The `main` path matcher routes with `route_rules` (priorities 1–3 send
`/api/`, `/ws` and `/health` to the API; priority 4 serves `/public/` from the
web bucket with `X-Robots-Tag: noindex, nofollow`, so published boards are not
indexable even by crawlers that never run the SPA's JavaScript). A matcher may
use `path_rule` or `route_rules` but never both, so any change to one rule
rewrites how all traffic is routed — review the plan for a single
`google_compute_url_map` diff, and after applying confirm both backends still
answer:

```
curl -s -o /dev/null -w '%{http_code}\n' https://criticalpath.skylerberg.com/health
curl -s -o /dev/null -w '%{http_code}\n' https://criticalpath.skylerberg.com/api/openapi.json
curl -sI https://criticalpath.skylerberg.com/public/projects/<published-id> | grep -i x-robots-tag
```

The third command reports `HTTP/2 404` even on a healthy deploy — check the
header, not the status. Every SPA deep path answers 404: the bucket's
`not_found_page` is a fallback body, not a rewrite, so GCS returns the shell
with a 404 status. Browsers ignore the status and render the board, but link
unfurlers, uptime monitors and strict HTTP clients call a shared board link
dead. Fixing it means a `custom_error_response_policy` on the `/public/` route
rule (match 404, serve `/index.html`, `override_response_code = 200`,
`error_service` on the web backend bucket); it is out of the minimal URL-map
edit because it changes response codes for a path the whole site's routing
rewrite already touches, and it is equally wrong for `/projects/*` today.

A second matcher, `previews`, serves the wildcard host
`*.criticalpath.skylerberg.com` (`pr-<n>.…`) the same way: `/api/`, `/ws` and
`/health` still reach the API, but everything else goes to the Cloud Run
preview edge (below) instead of the web bucket. See "Per-PR preview
deployments."

## Bootstrap ordering (fresh environment only)

Terraform attaches the API backend via a data source over the NEG that GKE
creates from the Service annotation in `k8s/service.yaml`. On a brand-new
environment, run the first CI deploy before `terraform apply` so the NEG
exists; after that, ordering never matters again.

In Route 53 (skylerberg.com zone), the A record for
`criticalpath.skylerberg.com` points at `terraform output lb_ip`. The managed
certificate only provisions after the record resolves to that IP (typically
15–60 minutes).

## Per-PR preview deployments

Each pull request deploys to `pr-<n>.criticalpath.skylerberg.com` so it can be
tried out live before merging. A preview is a full **same-origin virtual
host**: `/api` and `/ws` reach the real production backend (the `previews`
matcher routes them to the API just like prod), so there is no CORS and no
backend change. The frontend repo's workflow uploads each PR's build to a
`pr/<n>/` prefix in the web bucket and a Cloud Run "preview edge" serves it.

**Prerequisites (one-time):**

1. Enable the Cloud Run API (`run.googleapis.com`) in the project.
2. Publish the first image so terraform can reference it: run the
   `preview-edge-deploy` workflow once (workflow_dispatch, or push a change
   under `preview-edge/`). It builds and pushes `…/preview-edge:latest`.
3. `terraform apply` — creates the service account, the Cloud Run service
   (pointed at `:latest`), the serverless NEG, the `preview_edge` backend
   service, the wildcard cert, and the `previews` matcher.
4. In Route 53, add a wildcard A record `*.criticalpath.skylerberg.com` →
   `terraform output lb_ip`, then add the DNS-01 validation CNAME Google
   surfaces for the wildcard cert (`gcloud compute ssl-certificates describe
   critical-path-wildcard-cert`). The cert provisions ~15–60 min after the
   records resolve, same as the apex cert did.

After that, every push under `preview-edge/` redeploys the edge, and every PR
in the frontend repo publishes a preview with no further infra work. **A
preview reads and writes the real production database** — it is for trying out
UI/flow changes, not for destructive experiments.

Confirm a preview end to end (after a frontend PR has published one):

```
curl -s -o /dev/null -w '%{http_code}\n' https://pr-<n>.criticalpath.skylerberg.com/health   # 200, from the API
curl -sI https://pr-<n>.criticalpath.skylerberg.com/ | grep -i 'content-type\|cache-control' # text/html, no-cache
curl -s -o /dev/null -w '%{http_code}\n' https://pr-<n>.criticalpath.skylerberg.com/projects/x # 200 (SPA fallback)
```

## Secrets (never committed)

```
kubectl create namespace critical-path
kubectl -n critical-path create secret generic critical-path-secrets \
  --from-literal=DB_PASSWORD=... \
  --from-literal=PASSWORD_RESET_SECRET=... \
  --from-literal=REDIS_PASSWORD=... \
  --from-literal=REDIS_URL=redis://:<password>@critical-path-redis:6379
```
