# --- The adapter contract: every provider takes these (../../README.md) ------

variable "ssh_public_key_path" {
  description = "Public half of the key remote.sh logs in with."
  type        = string
  default     = "~/.ssh/diagnosticar_cloud.pub"
}

variable "admin_cidrs" {
  description = <<-EOT
    Addresses allowed on port 22. Empty (the default): closed. `remote.sh open`
    passes the current address with -var and never saves it, so any later
    apply closes the port again.
  EOT
  type        = list(string)
  default     = []
}

variable "domain" {
  description = <<-EOT
    A domain of your own, already pointing at the fixed IP (README, "Dominio
    propio"). Null (the default): <ip-with-dashes>.sslip.io. With a domain,
    the sslip.io name stays as an alias that redirects to it.
  EOT
  type        = string
  default     = null
}

variable "web_sources" {
  description = <<-EOT
    Who may reach ports 80 and 443. "anywhere" (the default), or "cloudflare":
    only Cloudflare's ranges, for a `domain` behind its proxy, so nobody who
    knows the IP can go around it. With "cloudflare" the sslip.io alias is
    dropped (Let's Encrypt could no longer reach it to renew).
  EOT
  type        = string
  default     = "anywhere"
  validation {
    condition     = var.web_sources == "anywhere" || (var.web_sources == "cloudflare" && var.domain != null)
    error_message = "web_sources must be \"anywhere\" or \"cloudflare\", and \"cloudflare\" needs a domain of your own (the sslip.io name would be unreachable)."
  }
}

variable "stack_settings" {
  description = "Passed unchanged to modules/stack (README, \"Ajustes\")."
  type        = any
  default     = {}
}

# --- AWS ----------------------------------------------------------------------

variable "aws_profile" {
  description = "AWS CLI profile to deploy with."
  type        = string
  default     = "diagnosticar"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "instance_type" {
  description = <<-EOT
    t3.small (2 GB) is the minimum and lasts the free plan's credits. If
    `remote.sh stats` shows the extractor pushing it into swap, c7i-flex.large
    (4 GB). Changing it stops and starts the instance; the data survives.
  EOT
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "The extractor image alone is ~3.5 GB; 30 GB leaves room for two sets side by side."
  type        = number
  default     = 30
}

variable "backups_to_s3" {
  description = "Copy the nightly dumps to the artifacts bucket of ./bootstrap, with a write-only role."
  type        = bool
  default     = true
}

variable "budget_email" {
  description = <<-EOT
    Where AWS Budgets writes when the month's spend crosses the threshold.
    Null (the default) creates no budget: use it when the account already
    has one, made in the console.
  EOT
  type        = string
  default     = null
}

variable "monthly_budget_usd" {
  description = "AWS spend (not Anthropic's) that triggers the alert."
  type        = number
  default     = 25
}
