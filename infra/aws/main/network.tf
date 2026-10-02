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

data "aws_subnet" "chosen" {
  for_each = toset(data.aws_subnets.default.ids)
  id       = each.value
}

locals {
  subnet_id = sort([
    for s in data.aws_subnet.chosen : s.id
    if contains(data.aws_ec2_instance_type_offerings.available.locations, s.availability_zone)
  ])[0]
}

# Only the proxy is reachable: 80 (Let's Encrypt and the redirect) and 443.
# Postgres and the services behind Caddy have no published ports at all, and
# administration goes through SSM Session Manager, so there is no port 22.
resource "aws_security_group" "web" {
  name        = "diagnosticar-web"
  description = "HTTP and HTTPS to Caddy; nothing else"
  vpc_id      = data.aws_vpc.default.id
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

# Outbound: image pulls (ECR), Let's Encrypt, the Anthropic API, SSM.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
