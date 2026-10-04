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

## Migrar desde `infra/aws/` (la copia anterior)

La copia anterior usaba ECR, SSM y OIDC, servicios solo de AWS. Para pasarla a
este esquema sin cambiar la URL, se mueve su Elastic IP al state nuevo. La web
queda fuera de servicio desde el paso 4 hasta el 5, unos 15 minutos.

Antes: las imágenes tienen que estar en GHCR (los PR `feat/cloud-publish-ghcr`
mergeados), y hace falta el token de GHCR (`read:packages`).

```bash
cd infra/cloud/providers/aws
OLD=../../../aws

# 1. Un backup de la base actual, y bajarlo
$OLD/scripts/remote.sh backup
BUCKET=$(terraform -chdir=$OLD/main output -raw artifacts_bucket)
KEY=$(aws --profile diagnosticar s3 ls "s3://$BUCKET/backups/" | sort | tail -1 | awk '{print $4}')
aws --profile diagnosticar s3 cp "s3://$BUCKET/backups/$KEY" ./migracion.sql.gz

# 2. El bootstrap: mismo código, otro lugar. Mover su state local; el plan
#    solo debe cambiar el output backend_config.
cp $OLD/bootstrap/terraform.tfstate bootstrap/
terraform -chdir=bootstrap init
terraform -chdir=bootstrap apply
terraform -chdir=bootstrap output -raw backend_config > backend.hcl
terraform init -backend-config=backend.hcl

# 3. La Elastic IP pasa del state viejo al nuevo (en AWS no cambia nada)
ALLOC=$(aws --profile diagnosticar ec2 describe-addresses \
  --public-ips "$(terraform -chdir=$OLD/main output -raw public_ip)" \
  --query 'Addresses[0].AllocationId' --output text)
terraform -chdir=$OLD/main state rm aws_eip_association.web aws_eip.web
terraform import aws_eip.web "$ALLOC"

# 4. La máquina nueva; la IP se mueve a ella (acá se corta la vieja)
terraform apply

# 5. Ponerla en marcha, con el token de Claude y la base de la copia anterior.
#    El token va de SSM a la máquina por un pipe: no se muestra.
cd ../..
scripts/remote.sh open
scripts/remote.sh setup
aws --profile diagnosticar ssm get-parameter --with-decryption \
  --name /diagnosticar/secrets/CLAUDE_CODE_OAUTH_TOKEN --query Parameter.Value --output text \
  | scripts/remote.sh set-secret CLAUDE_CODE_OAUTH_TOKEN
scripts/remote.sh restore providers/aws/migracion.sql.gz
```

6. Verificar con la lista del [README común](../../README.md#verificación-para-cualquier-proveedor).
   Si algo falla, la copia anterior sigue en su state: `terraform import` de la
   IP en `$OLD/main` y `apply` ahí la recupera.
7. Recién entonces, apagar lo viejo:

   ```bash
   terraform -chdir=$OLD/main destroy     # instancia vieja, ECR, rol OIDC, documento SSM, /diagnosticar/config
   # Lo que la copia anterior creó fuera de Terraform:
   for name in $(aws --profile diagnosticar ssm get-parameters-by-path --path /diagnosticar \
                   --recursive --query 'Parameters[].Name' --output text); do
     aws --profile diagnosticar ssm delete-parameter --name "$name"
   done
   aws --profile diagnosticar s3 rm "s3://$BUCKET/data/genes.db"
   rm providers/aws/migracion.sql.gz
   scripts/remote.sh close
   ```

   Y en GitHub (lo hace el dueño de los repositorios): borrar el secreto
   `AWS_DEPLOY_ROLE_ARN` de `diagnostic.ar`, `diagnostic.ar-api` y
   `spanish-symptoms-recognizer`.

## Apagar todo

```bash
terraform destroy                   # instancia, disco (¡con la base!), IP, rol, alarma
```

Los buckets quedan; borrarlos es aparte (`terraform -chdir=bootstrap destroy`
exige vaciarlos antes).
