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
    t3.small (2 GB) is the guide's minimum and lasts the free plan's credits;
    the stack measured ~1.05 GB at rest. If docker stats shows the extractor
    pushing it into swap, c7i-flex.large (4 GB). Changing it stops and starts
    the instance; the data volume survives.
  EOT
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "The extractor image alone is ~3.5 GB; 30 GB leaves room for two releases side by side."
  type        = number
  default     = 30
}

variable "budget_email" {
  description = <<-EOT
    Where AWS Budgets writes when the month's spend crosses the threshold.
    Null (the default) creates no budget here: use it when the account already
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

variable "recognizer_model" {
  description = "Model the extractor calls. The same as staging; confirm the exact id in the Anthropic console."
  type        = string
  default     = "claude-opus-5"
}

variable "anthropic_weekly_budget_usd" {
  description = <<-EOT
    The ceiling on what extraction may spend per week. An extraction costs
    ~US$0.94 on average and up to ~US$1.90 for a long history
    (diagnostic.ar-api docs/EXTRACTION_LIMITS.md), so the weekly cap is this
    divided by 1.90: no surprises even if every history is long.
  EOT
  type        = number
  default     = 20
}

variable "global_extractions_per_5h" {
  description = "How fast a week's budget may go. Must be positive."
  type        = number
  default     = 5
}

variable "user_extractions_per_hour" {
  type    = number
  default = 20
}

variable "user_extractions_per_day" {
  type    = number
  default = 60
}

variable "github_owner" {
  description = "GitHub account that owns the repositories allowed to deploy."
  type        = string
  default     = "MateAlv"
}

variable "github_repos" {
  description = "Repositories whose pushes to main deploy here (docs/AWS_CICD.md)."
  type        = list(string)
  default     = ["diagnostic.ar", "diagnostic.ar-api", "spanish-symptoms-recognizer"]
}

variable "create_github_oidc_provider" {
  description = "False when the account already has GitHub's OIDC provider (one per account)."
  type        = bool
  default     = true
}
