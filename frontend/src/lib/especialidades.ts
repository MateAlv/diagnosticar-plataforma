export const ESPECIALIDADES_ES: Record<string, string> = {
  "developmental disorders": "Trastornos del desarrollo",
  "renal": "Nefrología",
  "neurology": "Neurología",
  "cardiology": "Cardiología",
  "ophthalmology": "Oftalmología",
  "dermatology": "Dermatología",
  "endocrinology": "Endocrinología",
  "immunology": "Inmunología",
  "hematology": "Hematología",
  "gastroenterology": "Gastroenterología",
  "pulmonology": "Neumonología",
  "musculoskeletal": "Traumatología y ortopedia",
  "metabolic": "Enfermedades metabólicas",
  "oncology": "Oncología",
  "otolaryngology": "Otorrinolaringología",
  "psychiatry": "Psiquiatría",
  "rheumatology": "Reumatología",
  "urology": "Urología",
  "gynecology": "Ginecología",
  "craniofacial": "Anomalías craneofaciales",
};

export function traducirEspecialidad(nombre: string): string {
  return ESPECIALIDADES_ES[nombre.trim().toLowerCase()] ?? nombre;
}
