# Critical Path infrastructure

Global HTTPS load balancer, web bucket, and supporting resources for
https://criticalpath.skylerberg.com. State lives in
`gs://cow-terraform-state` under the `critical-path` prefix.

```
terraform init
terraform apply
```

## Bootstrap ordering (fresh environment only)

Terraform attaches the API backend via a data source over the NEG that GKE
creates from the Service annotation in `k8s/service.yaml`. On a brand-new
environment, run the first CI deploy before `terraform apply` so the NEG
exists; after that, ordering never matters again.

In Route 53 (skylerberg.com zone), the A record for
`criticalpath.skylerberg.com` points at `terraform output lb_ip`. The managed
certificate only provisions after the record resolves to that IP (typically
15–60 minutes).

## Secrets (never committed)

```
kubectl create namespace critical-path
kubectl -n critical-path create secret generic critical-path-secrets \
  --from-literal=DB_PASSWORD=... \
  --from-literal=PASSWORD_RESET_SECRET=... \
  --from-literal=REDIS_PASSWORD=... \
  --from-literal=REDIS_URL=redis://:<password>@critical-path-redis:6379
```
