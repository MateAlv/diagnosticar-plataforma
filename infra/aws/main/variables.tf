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

variable "recognizer_provider" {
  description = <<-EOT
    How the extractor reaches Claude. "claude-cli" (default since 2026-10-02):
    the claude CLI with Mate's Claude subscription token, as staging does, and
    with staging's limits. "anthropic": an organisation API key, billed per
    call, capped by anthropic_weekly_budget_usd. docs/LLM_EN_LA_COPIA_AWS.md
    has why.
  EOT
  type        = string
  default     = "claude-cli"
  validation {
    condition     = contains(["claude-cli", "anthropic"], var.recognizer_provider)
    error_message = "recognizer_provider must be \"claude-cli\" or \"anthropic\"."
  }
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
  description = <<-EOT
    The whole site's extractions per 5 hours. Unset: 40 with claude-cli
    (staging's limit, Mate 2026-09-28), 5 with an API key.
  EOT
  type        = number
  default     = null
}

variable "global_extractions_per_week" {
  description = <<-EOT
    The whole site's extractions per week with claude-cli. Unset: the 5-hour
    rate over a week (40 x 168 / 5 = 1,344), as staging, so it adds no limit
    of its own. With an API key the week comes from anthropic_weekly_budget_usd.
  EOT
  type        = number
  default     = null
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

variable "github_owner_id" {
  description = "Numeric id of github_owner (gh api users/<owner> -q .id), for GitHub's immutable OIDC subject."
  type        = string
  default     = "92270678"
}

variable "github_repo_ids" {
  description = "Numeric id of each of github_repos (gh api repos/<owner>/<repo> -q .id), for GitHub's immutable OIDC subject."
  type        = map(string)
  default = {
    "diagnostic.ar"               = "1103969821"
    "diagnostic.ar-api"           = "1130640594"
    "spanish-symptoms-recognizer" = "1386307968"
  }
}

variable "create_github_oidc_provider" {
  description = "False when the account already has GitHub's OIDC provider (one per account)."
  type        = bool
  default     = true
}
