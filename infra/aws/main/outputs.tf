output "url" {
  value = "https://${local.domain}"
}

output "domain" {
  value = local.domain
}

output "public_ip" {
  value = aws_eip.web.public_ip
}

output "instance_id" {
  value = aws_instance.web.id
}

output "ecr_registry" {
  value = local.config["ECR_REGISTRY"]
}

output "artifacts_bucket" {
  value = local.bucket
}

output "global_extractions_per_week" {
  value = local.config["GLOBAL_EXTRACTIONS_PER_WEEK"]
}

# The one value each repository needs, as the secret AWS_DEPLOY_ROLE_ARN
# (docs/AWS_CICD.md). Not a credential: without GitHub's signed token for main
# of an allowed repository nobody can assume it. Still kept out of sight: a
# secret in GitHub, and sensitive here, so no plan or apply prints it. Read it
# on purpose with:  terraform output -raw github_deploy_role_arn
output "github_deploy_role_arn" {
  value     = aws_iam_role.github_deploy.arn
  sensitive = true
}
