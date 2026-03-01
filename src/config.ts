import 'dotenv/config';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';

export interface ProjectEntry {
  name: string;
  path: string;
}

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function parseUserIds(raw: string): number[] {
  return raw.split(',').map((id) => {
    const num = parseInt(id.trim(), 10);
    if (isNaN(num)) throw new Error(`Invalid user ID: "${id}"`);
    return num;
  });
}

const PROJECTS_DIR = process.env.PROJECTS_DIR || '/opt/projects';

/**
 * Scan the projects directory for git repos.
 * Any subdirectory containing a .git folder is a project.
 */
export function discoverProjects(): ProjectEntry[] {
  if (!existsSync(PROJECTS_DIR)) return [];

  return readdirSync(PROJECTS_DIR)
    .filter((name) => {
      const full = join(PROJECTS_DIR, name);
      return statSync(full).isDirectory() && existsSync(join(full, '.git'));
    })
    .map((name) => ({ name, path: join(PROJECTS_DIR, name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const config = {
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    allowedUserIds: parseUserIds(required('ALLOWED_USER_IDS')),
  },
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
  },
  github: {
    pat: process.env.GITHUB_PAT || '',
    owner: process.env.GITHUB_OWNER || '',
  },
  projectsDir: PROJECTS_DIR,
  defaultProject: process.env.DEFAULT_PROJECT || '',
  port: parseInt(process.env.PORT || '3100', 10),
} as const;

export function getProject(name: string): ProjectEntry | undefined {
  return discoverProjects().find((p) => p.name.toLowerCase() === name.toLowerCase());
}

export function getDefaultProject(): ProjectEntry {
  const projects = discoverProjects();
  if (config.defaultProject) {
    const match = projects.find((p) => p.name.toLowerCase() === config.defaultProject.toLowerCase());
    if (match) return match;
  }
  if (projects.length > 0) return projects[0];
  throw new Error('No projects found. Use /clone <repo> to add one.');
}
