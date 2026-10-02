# Amazon Linux 2023: the AWS CLI and the SSM agent come installed, and Docker
# is in its repositories. Read through SSM so a plan always sees the current
# image; ignore_changes below keeps a newer AMI from replacing the instance.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# Allocated apart from the instance, so the address (and with it the domain
# compiled into the frontend) survives replacing the instance.
resource "aws_eip" "web" {
  domain = "vpc"
  tags   = { Name = "diagnosticar" }
}

resource "aws_instance" "web" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name

  user_data = templatefile("${path.module}/../stack/user_data.sh.tftpl", {
    bucket = local.bucket
    region = data.aws_region.current.region
  })

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

  lifecycle {
    ignore_changes = [ami, user_data]
  }

  # The stack must be in S3 before the first boot reads it.
  depends_on = [aws_s3_object.stack, aws_ssm_parameter.config]
}

resource "aws_eip_association" "web" {
  instance_id   = aws_instance.web.id
  allocation_id = aws_eip.web.id
}
