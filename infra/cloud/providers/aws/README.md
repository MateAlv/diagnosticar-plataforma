# Adaptador AWS

Crea en AWS la máquina del [núcleo común](../../README.md) y le pasa su
cloud-init. Todo lo que corre adentro, cómo se despliega y cómo se administra es
lo mismo en cualquier proveedor; esto es solo lo propio de AWS.

## Qué crea

| Recurso | Para qué |
|---|---|
| EC2 `t3.small`, Ubuntu 24.04 x86-64, disco gp3 30 GB cifrado | La máquina. IMDSv2 con un solo salto: los contenedores no pueden pedir las credenciales del rol |
| Elastic IP | La dirección fija; el dominio es `<ip-con-guiones>.sslip.io`. Separada de la instancia: sobrevive a reemplazarla |
| Security group | 80 y 443 para todos; 22 solo mientras `remote.sh open` lo abre para tu IP |
| Rol IAM con solo `s3:PutObject` en `backups/` | Los backups nocturnos al bucket de artefactos, sin guardar credenciales |
| Alarma de gasto (opcional, `budget_email`) | AWS Budgets, por mail |

`bootstrap/` crea, una vez, los dos buckets: el del state de Terraform y el de
artefactos, donde quedan los backups (se borran a los 14 días).

## Costos (us-east-1)

| Qué | Por mes |
|---|---|
| EC2 `t3.small` | ~US$15 |
| Disco 30 GB gp3 | ~US$2,4 |
| IPv4 pública | ~US$3,6 |
| S3 (state y backups) | < US$0,1 |

GHCR, de donde salen las imágenes, no se paga. En el plan gratuito de AWS todo sale
de los créditos. La IP y el disco cobran aunque la instancia esté apagada.

## Primera vez

Requisitos: los del [README común](../../README.md#requisitos) y un perfil de la
AWS CLI llamado `diagnosticar` (o `aws_profile` en `terraform.tfvars`).

```bash
cd infra/cloud/providers/aws

# 1. Los buckets (una vez; costo ≈ 0). El state del bootstrap queda local.
terraform -chdir=bootstrap init
terraform -chdir=bootstrap apply
terraform -chdir=bootstrap output -raw backend_config > backend.hcl

# 2. La máquina
terraform init -backend-config=backend.hcl
terraform apply
terraform output url

# 3. Ponerla en marcha (README común, "Levantarlo")
cd ../..
scripts/remote.sh open
scripts/remote.sh setup
scripts/remote.sh set-secret CLAUDE_CODE_OAUTH_TOKEN < archivo-con-el-token
scripts/remote.sh close
```

## De dónde viene

La copia de https://44-197-71-62.sslip.io se migró a este adaptador el
2026-10-04 desde `infra/aws/`, que usaba ECR, SSM y OIDC, servicios solo de AWS.
Se conservó la URL moviendo la Elastic IP al state nuevo (`terraform import`), y la
base pasó con un backup y un restore. La web estuvo caída unos 20 minutos. Después
se destruyó lo viejo y se borró `infra/aws/`. Por qué y cómo:
[`docs/CLOUD_CAMBIOS.md`](../../../../docs/CLOUD_CAMBIOS.md).

## Apagar todo

```bash
terraform destroy                   # instancia, disco (¡con la base!), IP, rol, alarma
```

Los buckets quedan; borrarlos es aparte (`terraform -chdir=bootstrap destroy`
exige vaciarlos antes).
