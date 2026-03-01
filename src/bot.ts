import { Bot } from 'grammy';
import { config, discoverProjects, getProject } from './config.js';
import { runPrompt, switchProject, getCurrentProject, resetSession } from './claude.js';
import { chunkMessage } from './chunker.js';
import { cloneRepo, listRemoteRepos, createProject } from './github.js';

export function createBot(): Bot {
  const bot = new Bot(config.telegram.botToken);

  // Auth middleware — only allowed users
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !config.telegram.allowedUserIds.includes(userId)) {
      await ctx.reply('Unauthorized. Your user ID is not in the allowlist.');
      return;
    }
    await next();
  });

  // /start — welcome message
  bot.command('start', async (ctx) => {
    const projects = discoverProjects();
    let projectInfo = 'No projects yet. Use /clone <repo> to add one.';
    if (projects.length > 0) {
      try {
        const current = getCurrentProject(ctx.from!.id);
        projectInfo = `Active project: ${current.name}`;
      } catch {
        projectInfo = `${projects.length} project(s) available`;
      }
    }

    await ctx.reply(
      `Claude Code Bridge is ready.\n\n` +
      `${projectInfo}\n\n` +
      `Commands:\n` +
      `/projects — list local projects\n` +
      `/project <name> — switch project\n` +
      `/new <name> [desc] — create a new project\n` +
      `/clone <repo> — clone an existing repo\n` +
      `/repos — list your GitHub repos\n` +
      `/status — current session info\n` +
      `/reset — clear conversation history\n\n` +
      `Send any message to work with Claude on your project.`
    );
  });

  // /projects — list all local projects
  bot.command('projects', async (ctx) => {
    const projects = discoverProjects();
    if (projects.length === 0) {
      await ctx.reply('No projects found. Use /clone <repo> to add one.');
      return;
    }

    let currentName = '';
    try {
      currentName = getCurrentProject(ctx.from!.id).name;
    } catch { /* no current project */ }

    const lines = projects.map((p) => {
      const marker = p.name === currentName ? ' (active)' : '';
      return `  ${p.name}${marker}`;
    });
    await ctx.reply(`Projects on server:\n${lines.join('\n')}`);
  });

  // /repos — list GitHub repos
  bot.command('repos', async (ctx) => {
    if (!config.github.pat) {
      await ctx.reply('GITHUB_PAT not configured. Cannot list repos.');
      return;
    }

    await ctx.replyWithChatAction('typing');
    try {
      const repos = await listRemoteRepos();
      const local = discoverProjects().map((p) => p.name.toLowerCase());
      const lines = repos.map((r) => {
        const cloned = local.includes(r.name.toLowerCase()) ? ' (cloned)' : '';
        return `  ${r.name}${cloned}`;
      });
      await ctx.reply(`Your GitHub repos:\n${lines.join('\n')}\n\nUse /clone <name> to add one.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Failed to list repos: ${msg}`);
    }
  });

  // /clone <repo> — clone a GitHub repo
  bot.command('clone', async (ctx) => {
    const repoName = ctx.match?.trim();
    if (!repoName) {
      await ctx.reply('Usage: /clone <repo-name>\n\nUse /repos to see available repos.');
      return;
    }

    if (!config.github.pat || !config.github.owner) {
      await ctx.reply('GITHUB_PAT and GITHUB_OWNER must be set in .env to clone repos.');
      return;
    }

    // Check if already cloned
    const existing = getProject(repoName);
    if (existing) {
      await ctx.reply(`"${repoName}" is already cloned. Use /project ${repoName} to switch to it.`);
      return;
    }

    await ctx.reply(`Cloning ${repoName}...`);
    await ctx.replyWithChatAction('typing');

    try {
      const project = await cloneRepo(repoName);
      await ctx.reply(`Cloned ${project.name} to ${project.path}\n\nUse /project ${project.name} to switch to it.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Clone failed: ${msg}`);
    }
  });

  // /new <name> [description] — create a new project from scratch
  bot.command('new', async (ctx) => {
    const input = ctx.match?.trim();
    if (!input) {
      await ctx.reply(
        'Usage: /new <repo-name> [description]\n\n' +
        'Example: /new my-cool-app A new TypeScript project\n\n' +
        'Creates a private GitHub repo, clones it, and switches to it.'
      );
      return;
    }

    if (!config.github.pat || !config.github.owner) {
      await ctx.reply('GITHUB_PAT and GITHUB_OWNER must be set in .env.');
      return;
    }

    // Parse name and optional description
    const [name, ...descParts] = input.split(' ');
    const description = descParts.join(' ') || `Created via Claude Telegram Bridge`;

    // Check if already exists
    const existing = getProject(name);
    if (existing) {
      await ctx.reply(`"${name}" already exists. Use /project ${name} to switch to it.`);
      return;
    }

    await ctx.reply(`Creating ${name}...`);
    await ctx.replyWithChatAction('typing');

    try {
      const { project, repoUrl } = await createProject(name, description);

      // Auto-switch to the new project
      switchProject(ctx.from!.id, name);

      await ctx.reply(
        `Project created and active:\n` +
        `  Name: ${project.name}\n` +
        `  Path: ${project.path}\n` +
        `  Repo: ${repoUrl}\n\n` +
        `You're now working in ${project.name}. Start building!`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Failed to create project: ${msg}`);
    }
  });

  // /project <name> — switch project
  bot.command('project', async (ctx) => {
    const name = ctx.match?.trim();
    if (!name) {
      try {
        const current = getCurrentProject(ctx.from!.id);
        await ctx.reply(
          `Current project: ${current.name} (${current.path})\n\n` +
          `Usage: /project <name>`
        );
      } catch {
        await ctx.reply('No project selected. Use /projects to see available projects.');
      }
      return;
    }

    const proj = switchProject(ctx.from!.id, name);
    if (!proj) {
      const names = discoverProjects().map((p) => p.name).join(', ');
      await ctx.reply(`Project "${name}" not found.\nAvailable: ${names || 'none — use /clone <repo>'}`);
      return;
    }

    await ctx.reply(`Switched to: ${proj.name} (${proj.path})`);
  });

  // /status — session info
  bot.command('status', async (ctx) => {
    try {
      const proj = getCurrentProject(ctx.from!.id);
      await ctx.reply(
        `Project: ${proj.name}\n` +
        `Path: ${proj.path}\n` +
        `User ID: ${ctx.from!.id}`
      );
    } catch {
      await ctx.reply(`No project selected.\nUser ID: ${ctx.from!.id}`);
    }
  });

  // /reset — clear conversation
  bot.command('reset', async (ctx) => {
    resetSession(ctx.from!.id);
    await ctx.reply('Session reset. Next message starts a fresh conversation.');
  });

  // Text messages — forward to Claude
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith('/')) return;

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    // Keep typing indicator alive during long operations
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);

    // Status message for tool use updates
    let statusMsgId: number | undefined;

    try {
      const result = await runPrompt(ctx.from!.id, text, async (status) => {
        try {
          if (statusMsgId) {
            await ctx.api.editMessageText(ctx.chat.id, statusMsgId, `⏳ ${status}`);
          } else {
            const msg = await ctx.reply(`⏳ ${status}`);
            statusMsgId = msg.message_id;
          }
        } catch {
          // Edit can fail if message hasn't changed — ignore
        }
      });

      clearInterval(typingInterval);

      // Delete status message
      if (statusMsgId) {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsgId).catch(() => {});
      }

      // Send result in chunks
      const chunks = chunkMessage(result.text);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(async () => {
          // If Markdown parsing fails, send as plain text
          await ctx.reply(chunk);
        });
      }

      // Show tools summary if any were used
      if (result.toolsUsed.length > 0) {
        await ctx.reply(`Tools used: ${result.toolsUsed.join(', ')}`, {
          reply_parameters: { message_id: ctx.message.message_id },
        });
      }
    } catch (err) {
      clearInterval(typingInterval);
      if (statusMsgId) {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsgId).catch(() => {});
      }
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Error: ${msg}`);
    }
  });

  // Handle photos/documents with captions as prompts
  bot.on(['message:photo', 'message:document'], async (ctx) => {
    await ctx.reply(
      'File uploads are not supported yet. Please send text messages to work with Claude.'
    );
  });

  return bot;
}
