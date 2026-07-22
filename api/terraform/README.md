# Critical Path infrastructure

Global HTTPS load balancer, web bucket, and supporting resources for
https://criticalpath.skylerberg.com. State lives in
`gs://cow-terraform-state` under the `critical-path` prefix.

```
terraform init
terraform apply
```

## One-time steps after the first apply

1. The Kubernetes Service annotation (`k8s/service.yaml`) makes GKE create the
   zonal NEG `critical-path-api-neg` once the first deploy runs. Attach it to
   the backend service (Terraform intentionally ignores `backend` changes):

   ```
   gcloud compute backend-services add-backend critical-path-api-backend \
     --global \
     --network-endpoint-group=critical-path-api-neg \
     --network-endpoint-group-zone=us-west1-a \
     --balancing-mode=RATE \
     --max-rate-per-endpoint=100
   ```

2. In Route 53 (skylerberg.com zone), create an A record for
   `criticalpath.skylerberg.com` pointing at `terraform output lb_ip`. The
   managed certificate only provisions after the record resolves to that IP
   (typically 15–60 minutes).

## Secrets (never committed)

```
kubectl create namespace critical-path
kubectl -n critical-path create secret generic critical-path-secrets \
  --from-literal=DB_PASSWORD=... \
  --from-literal=PASSWORD_RESET_SECRET=...
```
