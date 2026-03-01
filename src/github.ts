import { execSync } from 'child_process';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { config, type ProjectEntry } from './config.js';

interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
}

interface NewProjectResult {
  project: ProjectEntry;
  repoUrl: string;
}

/**
 * List all repos for the configured GitHub owner.
 */
export async function listRemoteRepos(): Promise<GitHubRepo[]> {
  const { pat, owner } = config.github;
  if (!pat || !owner) throw new Error('GITHUB_PAT and GITHUB_OWNER required');

  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.github.com/users/${owner}/repos?per_page=100&page=${page}&sort=updated`,
      { headers: { Authorization: `Bearer ${pat}`, 'User-Agent': 'claude-telegram-bridge' } }
    );

    if (!res.ok) throw new Error(`GitHub API: ${res.status} ${await res.text()}`);

    const batch: GitHubRepo[] = await res.json();
    if (batch.length === 0) break;
    repos.push(...batch);
    page++;
  }

  return repos;
}

/**
 * Clone a repo from GitHub into the projects directory.
 */
export async function cloneRepo(repoName: string): Promise<ProjectEntry> {
  const { pat, owner } = config.github;
  if (!pat || !owner) throw new Error('GITHUB_PAT and GITHUB_OWNER required');

  const cloneUrl = `https://${owner}:${pat}@github.com/${owner}/${repoName}.git`;
  const destPath = join(config.projectsDir, repoName);

  execSync(`git clone ${cloneUrl} ${destPath}`, {
    stdio: 'pipe',
    timeout: 120_000,
  });

  return { name: repoName, path: destPath };
}

/**
 * Create a new GitHub repo and initialize it locally.
 */
export async function createProject(
  name: string,
  description: string,
  isPrivate: boolean = true
): Promise<NewProjectResult> {
  const { pat, owner } = config.github;
  if (!pat || !owner) throw new Error('GITHUB_PAT and GITHUB_OWNER required');

  // Create repo on GitHub
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      'User-Agent': 'claude-telegram-bridge',
    },
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
      auto_init: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API: ${res.status} ${err}`);
  }

  const repo: GitHubRepo = await res.json();

  // Clone it locally
  const project = await cloneRepo(name);

  return { project, repoUrl: repo.html_url };
}
