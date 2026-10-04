# --- The adapter contract: every provider has these (../../README.md) --------

output "url" {
  value = "https://${local.domain}"
}

output "ssh_host" {
  description = "Where remote.sh connects, as diagnosticar@<this>."
  value       = aws_eip.web.public_ip
}

# --- AWS ----------------------------------------------------------------------

output "instance_id" {
  value = aws_instance.web.id
}

output "ssh_open_for" {
  description = "Addresses allowed on port 22 right now; empty means closed."
  value       = var.admin_cidrs
}
