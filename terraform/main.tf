terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.41"
    }
  }

  backend "gcs" {
    bucket = "cow-terraform-state"
    prefix = "critical-path"
  }
}

locals {
  project             = "realm-construction"
  domain              = "criticalpath.skylerberg.com"
  preview_host_suffix = ".${local.domain}"
  gke_node_tag        = "gke-cow-cluster-c4b67ea8-node"
}

provider "google" {
  project = local.project
  region  = "us-west1"
}

resource "google_compute_global_address" "critical_path" {
  name = "critical-path-ip"
}

resource "google_compute_managed_ssl_certificate" "critical_path" {
  name = "critical-path-cert"

  managed {
    domains = [local.domain]
  }
}

# --- Wildcard cert for pr-<n>.criticalpath.skylerberg.com (DNS-01) ---------
# The classic Compute managed cert can't validate a wildcard (its CA connects
# to a concrete hostname via MPIC), so the wildcard is issued by Certificate
# Manager using DNS-01 authorization. One authorization for the parent domain
# covers it and its wildcard; Google publishes the CNAME to add to Route 53 as
# dns_resource_record on the authorization (see the wildcard_cert_dns_validation
# output). The cert is attached to the HTTPS proxy via a certificate map, which
# coexists with the apex cert in ssl_certificates. Requires the Certificate
# Manager API (certificatemanager.googleapis.com).

resource "google_certificate_manager_dns_authorization" "preview" {
  name     = "critical-path-preview-dns-auth"
  location = "global"
  domain   = local.domain
}

resource "google_certificate_manager_certificate" "wildcard" {
  name     = "critical-path-wildcard-cert"
  location = "global"
  scope    = "DEFAULT"

  managed {
    domains            = ["*.${local.domain}"]
    dns_authorizations = [google_certificate_manager_dns_authorization.preview.id]
  }
}

resource "google_certificate_manager_certificate_map" "wildcard" {
  # Certificate Maps are always global (the API pins location to "global"), so
  # there is no location argument on this resource.
  name = "critical-path-wildcard-map"
}

resource "google_certificate_manager_certificate_map_entry" "wildcard" {
  name     = "critical-path-wildcard-entry"
  map      = google_certificate_manager_certificate_map.wildcard.name
  hostname = "*.${local.domain}"

  certificates = [google_certificate_manager_certificate.wildcard.id]
}

# GCLB health checks reach standalone-NEG endpoints at the pod's serving port
# (3001), which the cluster's existing rules only open for 80/443.
resource "google_compute_firewall" "critical_path_health_checks" {
  name    = "critical-path-lb-health-checks"
  network = "default"

  direction = "INGRESS"
  source_ranges = [
    "130.211.0.0/22",
    "35.191.0.0/16",
  ]
  target_tags = [local.gke_node_tag]

  allow {
    protocol = "tcp"
    ports    = ["3001"]
  }
}

resource "google_compute_health_check" "api" {
  name = "critical-path-api-health-check"

  timeout_sec         = 5
  check_interval_sec  = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    request_path       = "/health"
    port_specification = "USE_SERVING_PORT"
  }
}

# GKE creates this NEG from the Service annotation, so on a fresh environment
# the first CI deploy must run before this data source resolves.
data "google_compute_network_endpoint_group" "api" {
  name = "critical-path-api-neg"
  zone = "us-west1-a"
}

resource "google_compute_backend_service" "api" {
  name                            = "critical-path-api-backend"
  protocol                        = "HTTP"
  load_balancing_scheme           = "EXTERNAL_MANAGED"
  timeout_sec                     = 3600
  session_affinity                = "NONE"
  connection_draining_timeout_sec = 60

  backend {
    group                 = data.google_compute_network_endpoint_group.api.self_link
    balancing_mode        = "RATE"
    max_rate_per_endpoint = 100
  }

  health_checks = [google_compute_health_check.api.self_link]

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_service_account" "api" {
  account_id   = "critical-path-api"
  display_name = "Critical Path API (GKE Workload Identity)"
}

# Lets the critical-path/critical-path-api KSA impersonate the GCP SA, which
# is how pods reach the uploads bucket without key files.
resource "google_service_account_iam_member" "api_workload_identity" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${local.project}.svc.id.goog[critical-path/critical-path-api]"
}

resource "google_storage_bucket" "uploads" {
  name     = "critical-path-uploads-prod"
  location = "US"

  uniform_bucket_level_access = true
}

resource "google_storage_bucket_iam_member" "uploads_api" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket" "web" {
  name     = "critical-path-web-prod"
  location = "US"

  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }
}

resource "google_storage_bucket_iam_member" "web_public" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_storage_bucket_iam_member" "web_deployer" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:github-actions-service@realm-construction.iam.gserviceaccount.com"
}

resource "google_compute_backend_bucket" "web" {
  name             = "critical-path-web-backend"
  bucket_name      = google_storage_bucket.web.name
  enable_cdn       = true
  compression_mode = "AUTOMATIC"

  # Without this, CDN cache_mode defaults to CACHE_ALL_STATIC and its
  # client_ttl caps the browser-facing max-age at 3600, defeating the
  # immutable year-long headers the deploy sets on hashed assets.
  cdn_policy {
    cache_mode = "USE_ORIGIN_HEADERS"
  }
}

# --- Per-PR preview deployments (pr-<n>.criticalpath.skylerberg.com) -------
# A Cloud Run "preview edge" serves each PR's static build from a pr/<n>/
# prefix in the web bucket, with SPA fallback to that PR's index.html. The
# wildcard host *.criticalpath.skylerberg.com (see the url_map below) routes
# to this backend for everything except /api, /ws and /health, which still
# reach the API — so a preview is a full same-origin virtual host and needs
# no CORS. See terraform/README.md for the bootstrap ordering and DNS steps.

# Runtime identity for the edge: read-only on the web bucket (pr/ objects).
resource "google_service_account" "preview_edge" {
  account_id   = "critical-path-preview-edge"
  display_name = "Critical Path preview edge (Cloud Run)"
}

resource "google_storage_bucket_iam_member" "web_preview_edge" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.preview_edge.email}"
}

# Terraform bootstraps the service config; the preview-edge deploy workflow
# pushes the image and rolls it out, so the image is ignored here to keep
# deploys and applies from fighting over it.
resource "google_cloud_run_service" "preview_edge" {
  name     = "critical-path-preview-edge"
  location = "us-west1"

  template {
    spec {
      container_concurrency = 80
      service_account_name  = google_service_account.preview_edge.email
      containers {
        image = "${google_artifact_registry_repository.critical_path.location}-docker.pkg.dev/${local.project}/${google_artifact_registry_repository.critical_path.repository_id}/preview-edge:latest"
        env {
          name  = "WEB_BUCKET"
          value = google_storage_bucket.web.name
        }
        env {
          name  = "PREVIEW_HOST_SUFFIX"
          value = local.preview_host_suffix
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  metadata {
    annotations = {
      # Only the global LB (and internal callers) may reach the edge directly;
      # the public run.app URL is blocked so the auth gate can't be bypassed.
      "run.googleapis.com/ingress" = "internal-and-cloud-load-balancing"
    }
  }

  lifecycle {
    ignore_changes = [template[0].spec[0].containers[0].image]
  }
}

resource "google_compute_region_network_endpoint_group" "preview_edge" {
  name                  = "critical-path-preview-edge-neg"
  region                = "us-west1"
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_service.preview_edge.name
  }
}

# No CDN: previews are low-traffic and a force-push to the same pr/<n>/
# prefix must be picked up immediately. Hashed assets are fetched once per PR.
resource "google_compute_backend_service" "preview_edge" {
  name                            = "critical-path-preview-edge-backend"
  load_balancing_scheme           = "EXTERNAL_MANAGED"
  connection_draining_timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.preview_edge.self_link
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "critical_path" {
  name            = "critical-path-url-map"
  default_service = google_compute_backend_bucket.web.self_link

  host_rule {
    hosts        = [local.domain]
    path_matcher = "main"
  }

  host_rule {
    hosts        = ["*.${local.domain}"]
    path_matcher = "previews"
  }

  path_matcher {
    name            = "main"
    default_service = google_compute_backend_bucket.web.self_link

    # The bucket can't set security headers itself; replace=true keeps this
    # from stacking on the API's own HSTS header.
    header_action {
      response_headers_to_add {
        header_name  = "Strict-Transport-Security"
        header_value = "max-age=31536000; includeSubDomains"
        replace      = true
      }
    }

    # route_rules rather than path_rule because a matcher may use only one of
    # the two, and stamping X-Robots-Tag on /public/ needs a per-rule
    # header_action. The API rules keep the lower priorities so /api/public/*
    # still reaches the API instead of the web bucket.
    route_rules {
      priority = 1
      service  = google_compute_backend_service.api.self_link

      match_rules {
        prefix_match = "/api/"
      }
    }

    route_rules {
      priority = 2
      service  = google_compute_backend_service.api.self_link

      match_rules {
        full_path_match = "/ws"
      }
    }

    route_rules {
      priority = 3
      service  = google_compute_backend_service.api.self_link

      match_rules {
        full_path_match = "/health"
      }
    }

    route_rules {
      priority = 4
      service  = google_compute_backend_bucket.web.self_link

      match_rules {
        prefix_match = "/public/"
      }

      header_action {
        response_headers_to_add {
          header_name  = "X-Robots-Tag"
          header_value = "noindex, nofollow"
          replace      = true
        }
      }
    }
  }

  # pr-<n>.criticalpath.skylerberg.com: same /api, /ws and /health routing as
  # prod so a preview is a same-origin virtual host; every other path is
  # served by the preview edge (which SPA-falls-back to that PR's index.html).
  path_matcher {
    name            = "previews"
    default_service = google_compute_backend_service.preview_edge.self_link

    route_rules {
      priority = 1
      service  = google_compute_backend_service.api.self_link

      match_rules {
        prefix_match = "/api/"
      }
    }

    route_rules {
      priority = 2
      service  = google_compute_backend_service.api.self_link

      match_rules {
        full_path_match = "/ws"
      }
    }

    route_rules {
      priority = 3
      service  = google_compute_backend_service.api.self_link

      match_rules {
        full_path_match = "/health"
      }
    }
  }
}

resource "google_compute_url_map" "http_redirect" {
  name = "critical-path-http-redirect-map"

  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_https_proxy" "critical_path" {
  name    = "critical-path-https-proxy"
  url_map = google_compute_url_map.critical_path.self_link
  # Apex cert; the *.criticalpath wildcard is served via the certificate_map.
  # On EXTERNAL_MANAGED, certificate_map coexists with ssl_certificates (only
  # certificate_manager_certificates is mutually exclusive with ssl_certificates).
  ssl_certificates = [google_compute_managed_ssl_certificate.critical_path.self_link]
  certificate_map  = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.wildcard.id}"
}

resource "google_compute_target_http_proxy" "http_redirect" {
  name    = "critical-path-http-redirect-proxy"
  url_map = google_compute_url_map.http_redirect.self_link
}

resource "google_compute_global_forwarding_rule" "https" {
  name        = "critical-path-https-rule"
  ip_protocol = "TCP"
  port_range  = "443"
  ip_address  = google_compute_global_address.critical_path.address

  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.critical_path.self_link
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name        = "critical-path-http-redirect-rule"
  ip_protocol = "TCP"
  port_range  = "80"
  ip_address  = google_compute_global_address.critical_path.address

  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_http_proxy.http_redirect.self_link
}

resource "google_artifact_registry_repository" "critical_path" {
  location      = "us-west1"
  repository_id = "critical-path"
  format        = "DOCKER"

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }
}

resource "google_monitoring_notification_channel" "email" {
  display_name = "Skyler (email)"
  type         = "email"

  labels = {
    email_address = "skylertheberg@gmail.com"
  }
}

resource "google_monitoring_uptime_check_config" "health" {
  display_name = "critical-path /health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.project
      host       = local.domain
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  display_name = "critical-path /health failing"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failures"

    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.health.uptime_check_id}\" AND resource.type=\"uptime_url\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "60s"

      trigger {
        count = 1
      }

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "lb_5xx" {
  display_name = "critical-path LB 5xx responses"
  combiner     = "OR"

  conditions {
    display_name = "Sustained 5xx from the load balancer"

    condition_threshold {
      filter          = "metric.type=\"loadbalancing.googleapis.com/https/request_count\" AND resource.type=\"https_lb_rule\" AND resource.label.url_map_name=\"critical-path-url-map\" AND metric.label.response_code_class=\"500\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.03
      duration        = "300s"

      trigger {
        count = 1
      }

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

output "lb_ip" {
  description = "Point the Route 53 A record for the domain here"
  value       = google_compute_global_address.critical_path.address
}

output "wildcard_cert_dns_validation" {
  description = "Add this CNAME to Route 53 to validate the *.criticalpath wildcard cert"
  value = {
    name = google_certificate_manager_dns_authorization.preview.dns_resource_record[0].name
    type = google_certificate_manager_dns_authorization.preview.dns_resource_record[0].type
    data = google_certificate_manager_dns_authorization.preview.dns_resource_record[0].data
  }
}
