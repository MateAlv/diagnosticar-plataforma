# Continuous deployment from GitHub Actions (docs/AWS_CICD.md).
#
# A push to main in diagnostic.ar, diagnostic.ar-api or
# spanish-symptoms-recognizer builds that repository's images, pushes them to
# ECR and asks the instance to redeploy. GitHub signs in with OIDC: each run
# gets short-lived credentials for the role below, and no AWS key is stored in
# GitHub at all.
#
# What a run may do, and nothing more:
#   - push to the four ECR repositories;
#   - read the deployment's non-secret settings and move the per-image tags;
#   - run one fixed SSM document on the instance, `diagnosticar deploy`.
# It cannot read /diagnosticar/secrets, and it cannot run arbitrary commands:
# AWS-RunShellScript would be root on the instance, and with it every secret.

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

# One per account and URL. If the account already has it (another project),
# set create_github_oidc_provider = false and this one is reused.
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  github_oidc_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn

  # Only main of these repositories: a branch, a fork or a pull request gets
  # nothing. GitHub sends the subject in one of two forms, chosen per
  # repository: by name (repo:MateAlv/diagnostic.ar:…), or with the numeric
  # ids that survive a rename (repo:MateAlv@92270678/diagnostic.ar@1103969821:…).
  # On 2026-10-02 diagnostic.ar and spanish-symptoms-recognizer sent the
  # second and diagnostic.ar-api the first, so both are accepted. The ids pin
  # the exact account and repositories, so a renamed or recreated repository
  # with the same name does not inherit the role.
  github_subjects = flatten([for repo in var.github_repos : [
    "repo:${var.github_owner}/${repo}:ref:refs/heads/main",
    "repo:${var.github_owner}@${var.github_owner_id}/${repo}@${var.github_repo_ids[repo]}:ref:refs/heads/main",
  ]])

  # The tags a run moves; the instance reads them as BACKEND_TAG etc.
  image_tag_params = ["BACKEND_TAG", "FRONTEND_TAG", "RECOGNIZER_TAG", "MODEL_TAG"]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_subjects
    }
  }
}

# AWS appends a random suffix to the name, so the ARN cannot be guessed; it is
# handed to GitHub as a secret and never printed (outputs.tf).
resource "aws_iam_role" "github_deploy" {
  name_prefix          = "diagnosticar-github-deploy-"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

# The only thing a run may execute on the instance.
resource "aws_ssm_document" "deploy" {
  name            = "diagnosticar-deploy"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Redeploy diagnostic.ar with the tags in SSM (no parameters)."
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "1800"
        runCommand     = ["/usr/local/bin/diagnosticar deploy"]
      }
    }]
  })
}

# What a workflow needs to find things, outside /diagnosticar so the instance
# does not turn it into .env entries.
resource "aws_ssm_parameter" "ci" {
  for_each = {
    INSTANCE_ID  = aws_instance.web.id
    DEPLOY_DOC   = aws_ssm_document.deploy.name
    DOMAIN       = local.domain
    ECR_REGISTRY = local.config["ECR_REGISTRY"]
    PUBLIC_URL   = "https://${local.domain}"
  }
  name  = "/diagnosticar-ci/${each.key}"
  type  = "String"
  value = each.value
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
      "ecr:PutImage", "ecr:DescribeImages",
    ]
    resources = [for r in aws_ecr_repository.this : r.arn]
  }

  statement {
    sid     = "ReadSettings"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = concat(
      ["arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/diagnosticar-ci/*"],
      [for p in concat(local.image_tag_params, ["IMAGE_TAG"]) : "${local.param_arn}/config/${p}"],
    )
  }

  statement {
    sid       = "MoveImageTags"
    actions   = ["ssm:PutParameter", "ssm:DeleteParameter"]
    resources = [for p in local.image_tag_params : "${local.param_arn}/config/${p}"]
  }

  statement {
    sid     = "RunDeployOnly"
    actions = ["ssm:SendCommand"]
    resources = [
      aws_instance.web.arn,
      aws_ssm_document.deploy.arn,
    ]
  }

  statement {
    sid       = "FollowCommand"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "diagnosticar-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
