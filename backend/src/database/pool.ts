import { Pool } from 'pg';
import { DATABASE_URL } from '../config.js';

const pool = new Pool({
    connectionString: DATABASE_URL,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const getClient = () => pool.connect();

export async function migrate() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        organization VARCHAR(255),
        auth_provider VARCHAR(50) DEFAULT 'local',
        google_id VARCHAR(255),
        avatar_url VARCHAR(255),
        role VARCHAR(50) DEFAULT 'user',
        status VARCHAR(50) DEFAULT 'active',
        token_version INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP WITH TIME ZONE,
        verification_token VARCHAR(255),
        verified BOOLEAN DEFAULT FALSE
      );
    `);
        await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'local';
    `);
        await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
    `);
        await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255);
    `);
        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_idx ON users (google_id);
    `);
        // patients — one per completed diagnosis, tied to the authenticated user
        await client.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_email_snapshot   VARCHAR(255),
        nombre                VARCHAR(255) NOT NULL,
        fecha_nacimiento      DATE,
        sexo                  VARCHAR(50),
        localidad             VARCHAR(255),
        pais                  VARCHAR(100),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS patients_user_id_idx
        ON patients (user_id);
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS patients_user_email_snapshot_idx
        ON patients (user_email_snapshot);
    `);

        // diagnoses — full output, created atomically with the patient row
        await client.query(`
      CREATE TABLE IF NOT EXISTS diagnoses (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_email_snapshot   VARCHAR(255),
        historia_clinica      TEXT NOT NULL,
        symptoms_extracted    JSONB NOT NULL DEFAULT '[]',
        phenotypes            JSONB NOT NULL DEFAULT '[]',
        genphen_genes         JSONB NOT NULL DEFAULT '[]',
        genphen_specialties   JSONB,
        genphen_confidence    DOUBLE PRECISION,
        source_ip             VARCHAR(45),
        user_agent            TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS diagnoses_patient_id_idx
        ON diagnoses (patient_id);
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS diagnoses_user_id_created
        ON diagnoses (user_id, created_at DESC);
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS diagnoses_user_email_snapshot_idx
        ON diagnoses (user_email_snapshot);
    `);

        console.log('Migration completed: users, patients, diagnoses tables created/verified.');
    } catch (err) {
        console.error('Migration failed:', err);
        throw err;
    } finally {
        client.release();
    }
}
