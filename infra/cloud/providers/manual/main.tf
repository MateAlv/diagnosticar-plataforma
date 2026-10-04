# No provider at all: writes the machine's cloud-init to cloud-init.yaml, to
# paste as "user data" (it has other names: "cloud-init", "custom data",
# "startup script") when creating an Ubuntu 24.04 VM by hand, on any provider
# that has no adapter here, or on a local VM:
#
#   terraform init && terraform apply      # -> cloud-init.yaml (gitignored)
#   multipass launch 24.04 --name diagnosticar --memory 4G --disk 30G --cloud-init cloud-init.yaml
#
# Then open ports 80 and 443 to the world in that provider's firewall, and 22
# only for your address while you administer it (infra/cloud/README.md).

terraform {
  required_version = ">= 1.10"
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

variable "ssh_public_key_path" {
  description = "Public half of the key remote.sh logs in with."
  type        = string
  default     = "~/.ssh/diagnosticar_cloud.pub"
}

variable "domain" {
  description = "\"auto\" (<ip>.sslip.io, detected by the machine) or a domain that already points to it."
  type        = string
  default     = "auto"
}

variable "stack_settings" {
  description = "Passed unchanged to modules/stack (README, \"Ajustes\")."
  type        = any
  default     = {}
}

module "stack" {
  source          = "../../modules/stack"
  ssh_public_keys = [file(pathexpand(var.ssh_public_key_path))]
  domain          = var.domain
  settings        = var.stack_settings
}

resource "local_file" "cloud_init" {
  filename        = "${path.module}/cloud-init.yaml"
  content         = module.stack.cloud_init
  file_permission = "0644"
}

output "cloud_init_file" {
  value = abspath(local_file.cloud_init.filename)
}
