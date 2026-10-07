import { Pool, type PoolClient } from 'pg';
import { DATABASE_URL } from '../config.js';

export const pool = new Pool({
    connectionString: DATABASE_URL,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const getClient = () => pool.connect();

/**
 * The caps look back five hours at most; the extra days only leave room to
 * see recent usage. Run at boot and with every charged round, so the table
 * stays small even on a backend that is never restarted.
 */
export async function pruneQuestionAgentRounds(db: Pool | PoolClient = pool): Promise<void> {
    await db.query(`DELETE FROM question_agent_rounds WHERE created_at < now() - interval '7 days'`);
}

// Arbitrary but fixed: any caller using the same key serialises against the
// others. Changing it would defeat the lock.
const MIGRATION_LOCK_ID = 8_472_001;

export async function migrate() {
    const client = await pool.connect();
    let locked = false;
    try {
        // `CREATE TABLE IF NOT EXISTS` is not safe to run concurrently: two
        // backends starting at the same moment (a rolling restart, `compose
        // scale`, or parallel test files) both see the table missing, both
        // insert into pg_type, and one dies with
        // "duplicate key value violates unique constraint pg_type_typname_nsp_index".
        // The advisory lock makes the whole migration one-at-a-time; it is
        // released automatically if the connection drops mid-way.
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        locked = true;

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
        // Set when an admin creates an account for someone else. That account
        // holds a password the inviter chose and therefore knows, so it can do
        // nothing but change it until the invitee replaces it.
        await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    `);
        // The express consent Ley 25.326 asks for health data (art. 7) and for
        // sending it abroad (art. 12), and which wording of /terminos it was
        // given for. Null until the account gives it.
        await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS health_data_consent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS health_data_consent_version VARCHAR(32);
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

        // The address and browser of each search were stored without any use,
        // next to a clinical history about a child (Ley 25.326, art. 4: data
        // must not be excessive). Nothing writes them any more; the columns
        // stay so an older image can still insert during a rollback.
        await client.query(`
      UPDATE diagnoses SET source_ip = NULL, user_agent = NULL
       WHERE source_ip IS NOT NULL OR user_agent IS NOT NULL;
    `);

        // Follow-up questions and answers for a diagnosis (routes/questions.ts).
        // Nullable because most diagnoses never start a session.
        await client.query(`
      ALTER TABLE diagnoses
        ADD COLUMN IF NOT EXISTS preguntas_respuestas JSONB;
    `);

        // One row per question-agent round that was sent to the agent, so the
        // spend caps hold across restarts and replicas. Who and when only:
        // nothing clinical belongs here.
        await client.query(`
      CREATE TABLE IF NOT EXISTS question_agent_rounds (
        id          BIGSERIAL PRIMARY KEY,
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS question_agent_rounds_created_idx
        ON question_agent_rounds (created_at);
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS question_agent_rounds_user_created_idx
        ON question_agent_rounds (user_id, created_at);
    `);
        await pruneQuestionAgentRounds(client);

        console.log('Migration completed: users, patients, diagnoses, question_agent_rounds tables created/verified.');
    } catch (err) {
        console.error('Migration failed:', err);
        throw err;
    } finally {
        if (locked) {
            // Best effort: if this fails the connection is already broken, and
            // Postgres drops the lock when the session ends.
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
        }
        client.release();
    }
}
