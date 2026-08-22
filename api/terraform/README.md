# Critical Path infrastructure

Global HTTPS load balancer, web bucket, and supporting resources for
https://criticalpath.skylerberg.com. State lives in
`gs://cow-terraform-state` under the `critical-path` prefix.

```
terraform init
terraform apply
```

## URL map routing

The `main` path matcher routes with `route_rules`: priorities 1–3 send `/api/`,
`/ws` and `/health` to the API; priority 4 serves `/assets/` from the web
bucket; priority 5 serves `/public/` from it with `X-Robots-Tag: noindex,
nofollow`, so published boards are not indexable even by crawlers that never
run the SPA's JavaScript; priority 6 is the catch-all that carries every other
path to the bucket. A matcher may use `path_rule` or `route_rules` but never
both, so any change to one rule rewrites how all traffic is routed — review the
plan for a single `google_compute_url_map` diff, and after applying confirm both
backends still answer:

```
curl -s -o /dev/null -w '%{http_code}\n' https://criticalpath.skylerberg.com/health
curl -s -o /dev/null -w '%{http_code}\n' https://criticalpath.skylerberg.com/api/openapi.json
curl -sI https://criticalpath.skylerberg.com/public/projects/<project-alias> | grep -i x-robots-tag
```

`<project-alias>` is the 22-character id alias out of a published board's link;
the signed-in SPA paths are `/p/<alias>/<slug>` and `/t/<alias>/<slug>`, which
the catch-all rule serves. The bucket answers an unknown object with a 404, so
the `/public/` and catch-all rules each carry a `custom_error_response_policy`
that serves `/index.html` with `override_response_code = 200` — without it a
shared board link reads as dead to link unfurlers, uptime monitors and strict
HTTP clients even though a browser would render the board. The policies sit on
those two rules rather than on the matcher default, which would also govern the
API rules and turn a genuine API 404 into the app shell with a 200. `/assets/`
deliberately has none: filenames there are hashed, so a miss is a real miss and
must stay a 404 rather than become HTML a `<script>` tag cannot parse.

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

1. Enable the APIs: Cloud Run (`run.googleapis.com`) and Certificate Manager
   (`certificatemanager.googleapis.com`).
2. Publish the first image so terraform can reference it: run the
   `preview-edge-deploy` workflow once (workflow_dispatch, or push a change
   under `preview-edge/`). It builds and pushes `…/preview-edge:latest`.
3. `terraform apply` — creates the service account, the Cloud Run service
   (pointed at `:latest`), the serverless NEG, the `preview_edge` backend
   service, the Certificate Manager wildcard cert + map (attached to the HTTPS
   proxy), and the `previews` matcher.
4. In Route 53:
   - add a wildcard A record `*.criticalpath.skylerberg.com` →
     `terraform output lb_ip`;
   - add the DNS-01 CNAME that validates the wildcard cert — read it from
     `terraform output wildcard_cert_dns_validation` and create that record
     (name → data). The classic Compute managed cert can't validate a
     wildcard, so this uses Certificate Manager DNS-01; one CNAME covers the
     whole `*.…` set.

> **Currently unsatisfied — previews do not work over HTTPS.** As of 2026-08-21
> the `_acme-challenge.criticalpath.skylerberg.com` CNAME does not exist, so the
> wildcard certificate created on 2026-08-01 has sat in `PROVISIONING` with
> `CNAME_MISMATCH` ever since and every `pr-<n>.criticalpath.skylerberg.com`
> fails TLS. Nothing reports this: `preview-deploy` uploads the bundle and posts
> the comment without ever requesting the URL, so each PR gets a preview link
> that cannot be opened. Check with
> `gcloud certificate-manager certificates describe critical-path-wildcard-cert
> --location=global` (managed.state) and `dig +short CNAME
> _acme-challenge.criticalpath.skylerberg.com`, and read the expected value from
> `gcloud certificate-manager dns-authorizations list --location=global`.

   The cert provisions ~15–60 min after both records resolve. Track it with
   `gcloud certificate-manager certificates describe critical-path-wildcard-cert --location=global` (managed.state → ACTIVE).

After that, every push under `preview-edge/` redeploys the edge, and every PR
in the frontend repo publishes a preview with no further infra work. **A
preview reads and writes the real production database** — it is for trying out
UI/flow changes, not for destructive experiments.

Confirm a preview end to end (after a frontend PR has published one):

```
curl -s -o /dev/null -w '%{http_code}\n' https://pr-<n>.criticalpath.skylerberg.com/health   # 200, from the API
curl -sI https://pr-<n>.criticalpath.skylerberg.com/ | grep -i 'content-type\|cache-control' # text/html, no-cache
curl -s -o /dev/null -w '%{http_code}\n' https://pr-<n>.criticalpath.skylerberg.com/my-tasks # 200 (SPA fallback)
```

## CI authentication is not terraform-managed

The four privileged workflows authenticate to GCP by workload identity
federation, and **the per-repository gate is a hand-applied IAM binding that
nothing in this directory manages.** The provider's own attribute condition is
deliberately broad:

```
assertion.repository_owner in ['crucible-of-worlds', 'skylerberg']
  && assertion.ref == 'refs/heads/main'
```

Owner and ref — not repository name. What actually admits one repository is a
`principalSet` member on the `github-actions-service` service account's IAM
policy. The only `workloadIdentityUser` binding in `main.tf` is the GKE one for
the API's runtime identity, which is unrelated.

So **renaming the repository breaks every deploy** until a matching binding is
added: the rename changes `assertion.repository`, the old principalSet stops
matching, and all four workflows fail at their `auth` step. Add the new one
first:

```sh
gcloud iam service-accounts add-iam-policy-binding \
  github-actions-service@realm-construction.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member='principalSet://iam.googleapis.com/projects/1085332810847/locations/global/workloadIdentityPools/default-pool/attribute.repository/skylerberg/<REPO>'
```

Read the current set with `gcloud iam service-accounts get-iam-policy
github-actions-service@realm-construction.iam.gserviceaccount.com`. This was
applied by hand for `skylerberg/critical-path` when the api and web repositories
were merged on 2026-08-21; the bindings for the two old names are still present
and can be removed once nothing references them.

## Secrets (never committed)

```
kubectl create namespace critical-path
kubectl -n critical-path create secret generic critical-path-secrets \
  --from-literal=DB_PASSWORD=... \
  --from-literal=PASSWORD_RESET_SECRET=... \
  --from-literal=REDIS_PASSWORD=... \
  --from-literal=REDIS_URL=redis://:<password>@critical-path-redis:6379 \
  --from-literal=AWS_ACCESS_KEY_ID=... \
  --from-literal=AWS_SECRET_ACCESS_KEY=...
```

The AWS keys belong to an IAM user whose only permission is `ses:SendEmail`
in `SES_REGION`; they are what `EMAIL_DRIVER=ses` authenticates with.
