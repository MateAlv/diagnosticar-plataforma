import { Pool } from 'pg';
import { DATABASE_URL } from '../config.js';

const pool = new Pool({
    connectionString: DATABASE_URL,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

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
        console.log('Migration completed: users table created/verified.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        client.release();
    }
}
