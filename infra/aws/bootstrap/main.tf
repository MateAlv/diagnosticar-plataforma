# Two buckets that have to exist before anything else, applied once with a
# local state:
#
#   tfstate    the remote state of ../main. Terraform writes every attribute it
#              manages there in plain text, so it is private, encrypted and
#              versioned (a bad apply can be rolled back to the previous state).
#   artifacts  what the instance reads and git does not hold: genes.db, the
#              compose stack, and the nightly database dumps.
#
# Neither holds a secret by design (secrets live in SSM, see
# ../scripts/make-secrets.sh), but the dumps are the application's data, so both
# get the same treatment.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "aws_profile" {
  description = "AWS CLI profile to deploy with."
  type        = string
  default     = "diagnosticar"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

provider "aws" {
  profile = var.aws_profile
  region  = var.region
  default_tags {
    tags = { Project = "diagnosticar" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  # Bucket names are global across every AWS account; the account id makes
  # them unique without anyone having to pick one.
  account = data.aws_caller_identity.current.account_id
  buckets = {
    tfstate   = "diagnosticar-tfstate-${local.account}"
    artifacts = "diagnosticar-artifacts-${local.account}"
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = each.value
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Old versions of the state and of the stack are only for rolling back a
# mistake; dumps are kept two weeks. Without this, versioning keeps every
# nightly dump forever.
resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.this["artifacts"].id

  rule {
    id     = "expire-backups"
    status = "Enabled"
    filter {
      prefix = "backups/"
    }
    expiration {
      days = 14
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.this["tfstate"].id
  rule {
    id     = "old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

output "artifacts_bucket" {
  value = aws_s3_bucket.this["artifacts"].id
}

# ../main reads its backend settings from a file, because a backend block
# cannot use variables:
#   terraform output -raw backend_config > ../main/backend.hcl
output "backend_config" {
  value = <<-EOT
    bucket       = "${aws_s3_bucket.this["tfstate"].id}"
    key          = "main/terraform.tfstate"
    region       = "${var.region}"
    profile      = "${var.aws_profile}"
    encrypt      = true
    use_lockfile = true
  EOT
}
