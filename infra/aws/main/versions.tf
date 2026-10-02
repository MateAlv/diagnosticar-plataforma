terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Filled in from backend.hcl, which ../bootstrap writes:
  #   terraform init -backend-config=backend.hcl
  # The state holds every attribute Terraform manages in plain text. No secret
  # is managed here (see ../scripts/make-secrets.sh), but the bucket is still
  # private, encrypted and versioned.
  backend "s3" {}
}

provider "aws" {
  profile = var.aws_profile
  region  = var.region
  default_tags {
    tags = { Project = "diagnosticar" }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
