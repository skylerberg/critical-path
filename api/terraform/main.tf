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
  project      = "realm-construction"
  domain       = "criticalpath.skylerberg.com"
  gke_node_tag = "gke-cow-cluster-c4b67ea8-node"
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
  load_balancing_scheme           = "EXTERNAL"
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

resource "google_compute_url_map" "critical_path" {
  name            = "critical-path-url-map"
  default_service = google_compute_backend_bucket.web.self_link

  host_rule {
    hosts        = [local.domain]
    path_matcher = "main"
  }

  path_matcher {
    name            = "main"
    default_service = google_compute_backend_bucket.web.self_link

    path_rule {
      paths = [
        "/api/*",
        "/ws",
        "/health",
      ]
      service = google_compute_backend_service.api.self_link
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
  name             = "critical-path-https-proxy"
  url_map          = google_compute_url_map.critical_path.self_link
  ssl_certificates = [google_compute_managed_ssl_certificate.critical_path.self_link]
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

  load_balancing_scheme = "EXTERNAL"
  target                = google_compute_target_https_proxy.critical_path.self_link
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name        = "critical-path-http-redirect-rule"
  ip_protocol = "TCP"
  port_range  = "80"
  ip_address  = google_compute_global_address.critical_path.address

  load_balancing_scheme = "EXTERNAL"
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
