import { Database, FileJson } from 'lucide-vue-next';
import type { Component } from 'vue';

// UI mirror of the managed-database engines; @kubwave/db is the source of truth.
// Keep version lists in sync with packages/db/src/database-engines.ts.

export const DATABASE_ENGINES = ['postgres', 'mysql', 'mariadb', 'mongodb'] as const;

export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

export interface DatabaseEngineUi {
	label: string;
	description: string;
	icon: Component;
	versions: string[];
	defaultVersion: string;
}

export const DATABASE_ENGINE_UI: Record<DatabaseEngine, DatabaseEngineUi> = {
	postgres: { label: 'PostgreSQL', description: 'Relational database.', icon: Database, versions: ['17', '16', '15'], defaultVersion: '16' },
	mysql: { label: 'MySQL', description: 'Relational database.', icon: Database, versions: ['8.4', '8.0'], defaultVersion: '8.4' },
	mariadb: { label: 'MariaDB', description: 'MySQL-compatible database.', icon: Database, versions: ['11.4', '10.11'], defaultVersion: '11.4' },
	mongodb: { label: 'MongoDB', description: 'Document database.', icon: FileJson, versions: ['8', '7'], defaultVersion: '7' }
};

export function isDatabaseEngine(type: string): type is DatabaseEngine {
	return (DATABASE_ENGINES as readonly string[]).includes(type);
}
