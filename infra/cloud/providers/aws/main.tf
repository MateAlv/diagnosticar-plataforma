# The AWS adapter: an EC2 instance with a fixed IP and a firewall, handed the
# common cloud-init (../../modules/stack). Everything that runs on the machine,
# and how it deploys, is the same on every provider (../../README.md).
#
# AWS-specific, and only here: the instance, the Elastic IP, the security
# group, and a role that lets the machine write its nightly dumps to S3.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Filled in from backend.hcl, which ./bootstrap writes:
  #   terraform init -backend-config=backend.hcl
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

locals {
  domain = "${replace(aws_eip.web.public_ip, ".", "-")}.sslip.io"
  # Created by ./bootstrap; its lifecycle keeps dumps 14 days.
  backup_bucket = "diagnosticar-artifacts-${data.aws_caller_identity.current.account_id}"
}

# --- What runs on it: the common core ------------------------------------------

module "stack" {
  source          = "../../modules/stack"
  ssh_public_keys = [file(pathexpand(var.ssh_public_key_path))]
  domain          = local.domain
  # Backups to S3 with the instance's own role, so no credential is stored
  # anywhere. stack_settings can still override it.
  settings = merge(
    var.backups_to_s3 ? {
      backup_remote = ":s3,provider=AWS,env_auth=true,region=${var.region},no_check_bucket=true,no_head=true:${local.backup_bucket}/backups"
    } : {},
    var.stack_settings,
  )
}

# --- Network ------------------------------------------------------------------
# The default VPC: one public instance needs nothing more, and a VPC of our own
# would add NAT or endpoint costs for no benefit here.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# Not every zone offers every instance type; pick a subnet in one that does.
data "aws_ec2_instance_type_offerings" "available" {
  location_type = "availability-zone"
  filter {
    name   = "instance-type"
    values = [var.instance_type]
  }
}

data "aws_subnet" "candidate" {
  for_each = toset(data.aws_subnets.default.ids)
  id       = each.value
}

locals {
  subnet_id = sort([
    for s in data.aws_subnet.candidate : s.id
    if contains(data.aws_ec2_instance_type_offerings.available.locations, s.availability_zone)
  ])[0]
}

# 80 (Let's Encrypt and the redirect) and 443 for everyone; 22 only for the
# addresses in admin_cidrs, which is empty unless `remote.sh open` passes one.
resource "aws_security_group" "web" {
  name_prefix = "diagnosticar-cloud-"
  description = "HTTP and HTTPS to Caddy; SSH only while administering"
  vpc_id      = data.aws_vpc.default.id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each          = toset(["80", "443"])
  security_group_id = aws_security_group.web.id
  description       = "tcp/${each.value} from anywhere"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each          = toset(var.admin_cidrs)
  security_group_id = aws_security_group.web.id
  description       = "SSH while administering (remote.sh open)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

# Outbound: image pulls (GHCR), Let's Encrypt, Claude, apt, S3.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- The machine --------------------------------------------------------------

# Canonical's Ubuntu 24.04 for x86-64 (the images are amd64). Read through
# SSM so a plan always sees the current image; ignore_changes below keeps a
# newer one from replacing the instance.
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# Allocated apart from the instance, so the address (and with it the domain)
# survives replacing the instance.
resource "aws_eip" "web" {
  domain = "vpc"
  tags   = { Name = "diagnosticar" }
}

resource "aws_instance" "web" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = var.backups_to_s3 ? aws_iam_instance_profile.backups[0].name : null

  # AWS caps user data at 16 KB; cloud-init reads it gzip'd.
  user_data_base64 = module.stack.cloud_init_base64gzip

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
  }

  # IMDSv2 only, and one hop: the host can ask for the role's credentials,
  # a container (one hop further, behind Docker's bridge) cannot.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  # Unlimited CPU credits can bill beyond the instance price; standard caps
  # it, at the cost of throttling under sustained load.
  credit_specification {
    cpu_credits = "standard"
  }

  tags = { Name = "diagnosticar" }

  # cloud-init runs once; the stack is updated with `remote.sh install-stack`.
  # Changing either must not replace the instance (and its database).
  lifecycle {
    ignore_changes = [ami, user_data_base64]
  }
}

resource "aws_eip_association" "web" {
  instance_id   = aws_instance.web.id
  allocation_id = aws_eip.web.id
  # Moving the address from a previous instance (infra/cloud/providers/aws/README.md, "Migrar").
  allow_reassociation = true
}

# --- Backups: write-only into the artifacts bucket ---------------------------

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "backups" {
  # PutObject only: the machine can add a dump but cannot read the others back
  # or delete them.
  statement {
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.backup_bucket}/backups/*"]
  }
}

resource "aws_iam_role" "backups" {
  count              = var.backups_to_s3 ? 1 : 0
  name_prefix        = "diagnosticar-cloud-"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

resource "aws_iam_role_policy" "backups" {
  count  = var.backups_to_s3 ? 1 : 0
  name   = "write-backups"
  role   = aws_iam_role.backups[0].id
  policy = data.aws_iam_policy_document.backups.json
}

resource "aws_iam_instance_profile" "backups" {
  count       = var.backups_to_s3 ? 1 : 0
  name_prefix = "diagnosticar-cloud-"
  role        = aws_iam_role.backups[0].name
}
