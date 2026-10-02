# Settings the instance turns into its .env, beside the secrets.
#
#   /diagnosticar/config/*   here: not secret, so Terraform owns them.
#   /diagnosticar/secrets/*  ../scripts/make-secrets.sh: never in this state.
#
# On the instance every parameter becomes NAME=value under its last path
# segment, so a name must not repeat between the two.

locals {
  domain = "${replace(aws_eip.web.public_ip, ".", "-")}.sslip.io"

  config = {
    DOMAIN       = local.domain
    ECR_REGISTRY = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.region}.amazonaws.com"

    RECOGNIZER_MODEL            = var.recognizer_model
    GLOBAL_EXTRACTIONS_PER_WEEK = tostring(max(1, floor(var.anthropic_weekly_budget_usd / 1.90)))
    GLOBAL_EXTRACTIONS_PER_5H   = tostring(var.global_extractions_per_5h)
    USER_EXTRACTIONS_PER_HOUR   = tostring(var.user_extractions_per_hour)
    USER_EXTRACTIONS_PER_DAY    = tostring(var.user_extractions_per_day)
  }
}

resource "aws_ssm_parameter" "config" {
  for_each = local.config
  name     = "/diagnosticar/config/${each.key}"
  type     = "String"
  value    = each.value
}

# Which build the instance runs. push-images.sh moves it after pushing, so
# Terraform creates it once and then leaves it alone.
resource "aws_ssm_parameter" "image_tag" {
  name  = "/diagnosticar/config/IMAGE_TAG"
  type  = "String"
  value = "none"
  lifecycle {
    ignore_changes = [value]
  }
}

# The stack itself, which the instance syncs on every deploy. An edit here is
# a `terraform apply` plus `scripts/remote.sh deploy`; the instance is never
# rebuilt for it.
locals {
  stack_files = {
    "stack/docker-compose.yml" = "${path.module}/../stack/docker-compose.cloud.yml"
    "stack/Caddyfile"          = "${path.module}/../stack/Caddyfile"
    "stack/diagnosticar.sh"    = "${path.module}/../stack/diagnosticar.sh"
    "stack/ops/seed-admin.sh"  = "${path.module}/../../../ops/seed-admin.sh"
  }
}

resource "aws_s3_object" "stack" {
  for_each = local.stack_files
  bucket   = local.bucket
  key      = each.key
  source   = each.value
  etag     = filemd5(each.value)
}
