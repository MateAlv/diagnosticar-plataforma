# Private registry for the five images. The instance pulls with its role, so
# no GitHub token ever reaches it. ../scripts/push-images.sh builds and pushes.
locals {
  images = ["backend", "frontend", "hpo-recognizer", "model"]
}

resource "aws_ecr_repository" "this" {
  for_each             = toset(local.images)
  name                 = "diagnosticar-${each.value}"
  image_tag_mutability = "MUTABLE"
  # `terraform destroy` should leave nothing behind, images included.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Storage is billed per GB-month and the extractor is ~1.8 GB compressed, so
# keep only the last three builds of each. A build pushed by BuildKit is three
# entries (the image, its index and an untagged attestation), all counted here,
# so three builds are nine.
resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 3 builds (3 entries each)"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 9
      }
      action = { type = "expire" }
    }]
  })
}
