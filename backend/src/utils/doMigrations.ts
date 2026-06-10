/*
usage example: 

private migrations = [
    // Migration 0: Initial schema creation (current live schema)
    () => {
      const logger = getAriseLogger();
      logger.debug('[UserRegistry] Running migration 0: Initial schema');
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          username TEXT,
          role TEXT NOT NULL,
          discordId TEXT UNIQUE,
          universeId TEXT,
          displayName TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_users_discordId ON users(discordId);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
        CREATE INDEX IF NOT EXISTS idx_users_universeId ON users(universeId);
      `);
    },
    // Migration 1: Add discordAvatar field
    () => {
      const logger = getAriseLogger();
      logger.debug('[UserRegistry] Running migration 1: Add discordAvatar field');
      this.sql.exec(`
        ALTER TABLE users ADD COLUMN discordAvatar TEXT;
      `);
    },
    // Future migrations go here...
  ];
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Handle schema migration using the migration system
    migrateSchema(this.sql, 'users', this.migrations);
  }
*/

const logger = {
	// debug: (msg: string, data?: unknown) => console.debug(msg, data ?? ''),
	debug: (_msg: string, _data?: unknown) => {},
	warn: (msg: string, data?: unknown) => console.warn(msg, data ?? ''),
	error: (msg: string, data?: unknown) => console.error(msg, data ?? ''),
};

export const checkTableExists = (sql: SqlStorage, tableName: string): boolean => {
	try {
		const result = sql.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`).toArray();
		return result.length > 0;
	} catch (error) {
		logger.warn(`[Migration] Error checking if table ${tableName} exists:`, { error });
		return false;
	}
};

export const ensureMigrationTable = (sql: SqlStorage): void => {
	sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      table_name TEXT PRIMARY KEY,
      migration_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};

export const getCurrentMigrationVersion = (sql: SqlStorage, tableName: string): number => {
	try {
		ensureMigrationTable(sql);
		const result = sql.exec(`SELECT migration_version FROM schema_migrations WHERE table_name = ?;`, tableName).one();
		if (result && typeof result.migration_version !== 'undefined') {
			return Number(result.migration_version);
		}
		if (checkTableExists(sql, tableName)) {
			logger.debug(`[Migration] Table ${tableName} exists but not tracked in schema_migrations, assuming version 0`);
			return 0;
		}
		return 0;
	} catch (error) {
		logger.warn(`[Migration] Error getting migration version from ${tableName}:`, { error });
		return 0;
	}
};

export const updateMigrationVersion = (sql: SqlStorage, tableName: string, newVersion: number): boolean => {
	try {
		ensureMigrationTable(sql);
		sql.exec(`INSERT OR REPLACE INTO schema_migrations (table_name, migration_version) VALUES (?, ?);`, tableName, newVersion);
		logger.debug(`[Migration] Updated migration version to ${newVersion} for table ${tableName}`);
		return true;
	} catch (error) {
		logger.error(`[Migration] Failed to update migration version to ${newVersion} for table ${tableName}:`, { error });
		return false;
	}
};

export const setMigrationVersion = (sql: SqlStorage, tableName: string, version: number): boolean => {
	try {
		ensureMigrationTable(sql);
		logger.debug(`[Migration] Manually setting migration version to ${version} for table ${tableName}`);
		if (version < 0) {
			throw new Error('Migration version must be non-negative');
		}
		sql.exec(`INSERT OR REPLACE INTO schema_migrations (table_name, migration_version) VALUES (?, ?);`, tableName, version);
		logger.debug(`[Migration] Successfully set migration version to ${version} for table ${tableName}`);
		return true;
	} catch (error) {
		logger.error(`[Migration] Failed to set migration version to ${version} for table ${tableName}:`, { error });
		return false;
	}
};

export const migrateSchema = (sql: SqlStorage, tableName: string, migrations: (() => void)[]): void => {
	try {
		logger.debug(`[Migration] Starting migration for ${tableName}`);
		const tableExists = checkTableExists(sql, tableName);
		let currentVersion = 0;
		if (tableExists) {
			currentVersion = getCurrentMigrationVersion(sql, tableName);
			logger.debug(`[Migration] Table ${tableName} exists, current migration version: ${currentVersion}`);
		} else {
			logger.debug(`[Migration] Table ${tableName} not found, starting fresh migration`);
		}
		const latestVersion = migrations.length;
		if (currentVersion >= latestVersion) {
			logger.debug(`[Migration] Schema up to date (version ${currentVersion}) for table ${tableName}`);
			return;
		}
		logger.debug(`[Migration] Running migrations from version ${currentVersion} to version ${latestVersion} for table ${tableName}`);
		for (let version = currentVersion; version < latestVersion; version++) {
			try {
				const targetVersion = version + 1;
				logger.debug(`[Migration] Executing migration to reach version ${targetVersion} for table ${tableName}`);
				const migration = migrations[version];
				if (!migration) throw new Error(`No migration found at index ${version}`);
				migration();
				const updateSuccess = updateMigrationVersion(sql, tableName, targetVersion);
				if (!updateSuccess) {
					throw new Error(`Failed to update migration version after reaching version ${targetVersion}`);
				}
				logger.debug(`[Migration] Migration to version ${targetVersion} completed successfully for table ${tableName}`);
			} catch (migrationError) {
				const targetVersion = version + 1;
				logger.error(`[Migration] Migration to version ${targetVersion} failed for table ${tableName}:`, { migrationError });
				const errorMessage = migrationError instanceof Error ? migrationError.message : String(migrationError);
				throw new Error(`Migration to version ${targetVersion} failed for table ${tableName}: ${errorMessage}`);
			}
		}
		logger.debug(`[Migration] All migrations completed successfully for table ${tableName}`);
	} catch (error) {
		logger.error(`[Migration] Schema migration error for table ${tableName}:`, { error });
		throw error;
	}
};
