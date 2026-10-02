# What the instance may do, and nothing more: be managed through SSM, read its
# own parameters, pull its own images, read the stack and genes.db, and write
# database dumps. Containers cannot borrow this role: the metadata endpoint
# answers only the host (hop limit 1 in ec2.tf).

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "diagnosticar-instance"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

# Session Manager (a shell without port 22) and Run Command (../scripts/remote.sh).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

locals {
  param_arn = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/diagnosticar"
  bucket    = "diagnosticar-artifacts-${data.aws_caller_identity.current.account_id}"
}

data "aws_iam_policy_document" "instance" {
  statement {
    sid       = "ReadOwnParameters"
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = [local.param_arn, "${local.param_arn}/*"]
  }

  # SecureString parameters use the AWS-managed aws/ssm key; decrypting is
  # allowed only on SSM's behalf.
  statement {
    sid       = "DecryptViaSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "PullOwnImages"
    actions   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
    resources = [for r in aws_ecr_repository.this : r.arn]
  }

  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "ReadArtifacts"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.bucket}", "arn:aws:s3:::${local.bucket}/*"]
  }

  # Write-only into backups/: the instance can add a dump but cannot read
  # the others back or delete them.
  statement {
    sid       = "WriteBackups"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.bucket}/backups/*"]
  }
}

resource "aws_iam_role_policy" "instance" {
  name   = "diagnosticar-instance"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "diagnosticar-instance"
  role = aws_iam_role.instance.name
}
