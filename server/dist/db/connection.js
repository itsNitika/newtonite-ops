import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In-memory or file database based on environment
const DB_PATH = process.env.NODE_ENV === 'test'
    ? ':memory:'
    : process.env.DB_PATH || path.join(__dirname, '../../newtonite.db');
export function createDbConnection(customPath) {
    const targetPath = customPath || DB_PATH;
    if (targetPath !== ':memory:') {
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    const db = new Database(targetPath);
    // High-performance operational settings for SQLite
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    return db;
}
// Singleton for main application runtime
let globalDb = null;
export function getDb() {
    if (!globalDb) {
        globalDb = createDbConnection();
    }
    return globalDb;
}
export function closeDb() {
    if (globalDb) {
        globalDb.close();
        globalDb = null;
    }
}
