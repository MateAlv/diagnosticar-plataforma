# What every diagnostic.ar machine runs, whatever the provider: this module
# turns a few settings into the machine's cloud-init (../../stack/), and a
# provider adapter (../../providers/<name>/) hands that to a VM it creates.
# The module creates nothing and needs no provider; its only output is text.

terraform {
  required_version = ">= 1.10"
}

variable "ssh_public_keys" {
  description = "Public keys allowed to log in as `diagnosticar` (remote.sh)."
  type        = list(string)
  validation {
    condition     = length(var.ssh_public_keys) > 0
    error_message = "At least one SSH public key is needed to administer the machine."
  }
}

variable "domain" {
  description = <<-EOT
    The site's domain. "auto" (the default): <public-ip-with-dashes>.sslip.io,
    detected by the machine itself, which needs no DNS and is accepted by
    Let's Encrypt. An adapter that knows its static IP passes it explicitly.
  EOT
  type        = string
  default     = "auto"
}

variable "settings" {
  description = <<-EOT
    Everything else, each with a default (README, "Ajustes"). An adapter
    passes its own `stack_settings` variable through unchanged, so adding a
    setting here never touches the adapters.
  EOT
  type = object({
    # Where the images come from, and which tag the machine follows.
    registry     = optional(string, "ghcr.io/matealv")
    image_prefix = optional(string, "diagnosticar-cloud-")
    channel      = optional(string, "cloud")

    # How the extractor reaches Claude (docs/LLM_EN_LA_COPIA_AWS.md):
    # "claude-cli" with a subscription token, or "anthropic" with an API key.
    recognizer_provider = optional(string, "claude-cli")
    recognizer_model    = optional(string, "claude-opus-5")
    # With an API key: the most extraction may spend per week. An extraction
    # costs ~US$0.94 and up to ~US$1.90, so the cap is this / 1.90.
    anthropic_weekly_budget_usd = optional(number, 20)
    # Unset: 40 per 5 hours with claude-cli (staging's), 5 with an API key.
    global_extractions_per_5h = optional(number)
    # Unset: the 5-hour rate over a week (claude-cli), or the budget (API key).
    global_extractions_per_week = optional(number)
    user_extractions_per_hour   = optional(number, 20)
    user_extractions_per_day    = optional(number, 60)

    # Sized for 2 GB; raise on a bigger machine (README, "Memoria").
    max_concurrent_extractions = optional(number, 1)
    recognizer_llm_threads     = optional(number, 2)
    recognizer_mem_limit       = optional(string, "1300m")
    swap_mb                    = optional(number, 2048)

    # Any rclone remote, as a connection string (README, "Backups"). Empty:
    # backups stay on the machine only.
    backup_remote    = optional(string, "")
    backup_keep_days = optional(number, 14)
  })
  default = {}

  validation {
    condition     = contains(["claude-cli", "anthropic"], var.settings.recognizer_provider)
    error_message = "settings.recognizer_provider must be \"claude-cli\" or \"anthropic\"."
  }
}

locals {
  s = var.settings

  subscription  = local.s.recognizer_provider == "claude-cli"
  extraction_5h = coalesce(local.s.global_extractions_per_5h, local.subscription ? 40 : 5)
  # With the subscription the cap is the rate, as on staging; with an API key,
  # what the weekly budget buys at the dearest extraction (~US$1.90).
  extraction_week = (local.subscription
    ? coalesce(local.s.global_extractions_per_week, floor(local.extraction_5h * 168 / 5))
  : max(1, floor(local.s.anthropic_weekly_budget_usd / 1.90)))

  # /etc/diagnosticar/config.env on the machine.
  config = {
    DOMAIN                      = var.domain
    REGISTRY                    = local.s.registry
    IMAGE_PREFIX                = local.s.image_prefix
    CHANNEL                     = local.s.channel
    RECOGNIZER_PROVIDER         = local.s.recognizer_provider
    RECOGNIZER_MODEL            = local.s.recognizer_model
    GLOBAL_EXTRACTIONS_PER_WEEK = tostring(local.extraction_week)
    GLOBAL_EXTRACTIONS_PER_5H   = tostring(local.extraction_5h)
    USER_EXTRACTIONS_PER_HOUR   = tostring(local.s.user_extractions_per_hour)
    USER_EXTRACTIONS_PER_DAY    = tostring(local.s.user_extractions_per_day)
    MAX_CONCURRENT_EXTRACTIONS  = tostring(local.s.max_concurrent_extractions)
    RECOGNIZER_LLM_THREADS      = tostring(local.s.recognizer_llm_threads)
    RECOGNIZER_MEM_LIMIT        = local.s.recognizer_mem_limit
    BACKUP_REMOTE               = local.s.backup_remote
    BACKUP_KEEP_DAYS            = tostring(local.s.backup_keep_days)
  }

  stack = "${path.module}/../../stack"

  cloud_init = templatefile("${local.stack}/cloud-init.yaml.tftpl", {
    ssh_public_keys = [for k in var.ssh_public_keys : trimspace(k)]
    config          = local.config
    swap_mb         = local.s.swap_mb
    # The rest of the stack arrives with `remote.sh setup` (cloud-init.yaml.tftpl).
    files = {
      script = base64gzip(file("${local.stack}/diagnosticar.sh"))
    }
  })
}

output "cloud_init" {
  description = "The machine's cloud-init (#cloud-config). Hand it to the VM as user data."
  value       = local.cloud_init

  # config.env holds values in single quotes, one per line.
  precondition {
    condition     = alltrue([for v in values(local.config) : !strcontains(v, "'") && !strcontains(v, "\n")])
    error_message = "A setting holds a single quote or a newline, which config.env cannot store."
  }
  # Hetzner's limit for user data, the smallest among the providers that take
  # it as text. Every file is already compressed; if this trips, something
  # large slipped into the stack.
  precondition {
    condition     = length(local.cloud_init) < 32768
    error_message = "The cloud-init is over 32 KB, the smallest user-data limit among the providers."
  }
}

# The same document, gzip'd and base64-encoded, for providers that cap user
# data lower (AWS: 16 KB) and accept it compressed; cloud-init detects gzip
# by itself.
output "cloud_init_base64gzip" {
  description = "cloud_init, gzip'd and base64-encoded (aws_instance.user_data_base64)."
  value       = base64gzip(local.cloud_init)

  precondition {
    condition     = length(base64gzip(local.cloud_init)) * 3 / 4 < 16384
    error_message = "The compressed cloud-init is over 16 KB, AWS's limit for user data."
  }
}

output "config" {
  description = "The settings the machine gets, as /etc/diagnosticar/config.env."
  value       = local.config
}
