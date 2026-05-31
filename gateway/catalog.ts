export interface ServiceEnvVar {
  key: string;
  description: string;
  required: boolean;
}

export interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  envVars: ServiceEnvVar[];
  /** Fed verbatim to the generator as the service description. */
  prompt: string;
}

export const CATALOG: readonly ServiceEntry[] = [
  {
    id: "notion",
    name: "Notion",
    description: "Read and write pages, databases, and blocks in a Notion workspace",
    envVars: [
      { key: "NOTION_API_KEY", description: "Notion integration token (starts with secret_)", required: true },
    ],
    prompt: `Notion workspace connector using the Notion REST API.
Base URL: https://api.notion.com/v1
Auth headers on EVERY request:
  Authorization: Bearer <NOTION_API_KEY from process.env>
  Notion-Version: 2022-06-28
  Content-Type: application/json
Use global fetch (Node 18+ built-in — no import needed).

Generate exactly these 7 tools:

1. list_databases
   POST /search  body: { filter: { value: "database", property: "object" }, page_size: 50 }
   Returns each db as: id, title (from title[0].plain_text).

2. query_database(database_id, filter?, sort?)
   POST /databases/{database_id}/query
   Body: { filter: <JSON.parse(filter) if provided>, sorts: <JSON.parse(sort) if provided>, page_size: 50 }
   Return array of { id, properties summary as JSON string }.

3. get_page(page_id)
   GET /pages/{page_id}
   Return page properties as formatted JSON.

4. get_page_content(page_id)
   GET /blocks/{page_id}/children?page_size=100
   Concatenate rich_text from: paragraph, heading_1, heading_2, heading_3,
   bulleted_list_item, numbered_list_item, to_do, quote, callout blocks.
   Return as readable multiline string.

5. create_page(database_id, properties)
   POST /pages
   Body: { parent: { database_id }, properties: JSON.parse(properties) }
   properties arg is a JSON string (e.g. '{"Name":{"title":[{"text":{"content":"My page"}}]}}')
   Return created page id + url.

6. update_page(page_id, properties)
   PATCH /pages/{page_id}
   Body: { properties: JSON.parse(properties) }

7. search(query)
   POST /search
   Body: { query, sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 20 }
   Return list of { id, object_type, title } for matching pages and databases.

Read NOTION_API_KEY from process.env. If missing, return isError content immediately.
Server name: notion`,
  },

  {
    id: "obsidian",
    name: "Obsidian",
    description: "Read, write, and search markdown notes in a local Obsidian vault",
    envVars: [
      { key: "OBSIDIAN_VAULT_PATH", description: "Absolute path to the Obsidian vault folder", required: true },
    ],
    prompt: `Obsidian local vault connector using the Node.js filesystem.
Read vault path from process.env.OBSIDIAN_VAULT_PATH. Return isError content if unset.
Import: readdir, readFile, writeFile, mkdir from node:fs/promises. Import join, resolve, relative, extname from node:path.
Reject any user-supplied path that resolves outside the vault (path traversal guard: relative path must not start with "..").
No HTTP — this is filesystem-only.

Generate exactly these 5 tools:

1. list_notes
   Recursively list all .md files under vault root (skip dotfiles/dot-dirs).
   Return vault-relative paths, one per line, sorted.

2. read_note(path)
   Read full text of a vault-relative .md file. Validate path. Return text content.

3. write_note(path, content)
   Write markdown to a vault-relative path. Create parent dirs with mkdir recursive.
   Validate path. Return "wrote <path>".

4. search_notes(query)
   Case-insensitive substring search across all note file contents.
   Return matching vault-relative paths (not content), one per line.

5. get_note_metadata(path)
   Read a note and parse its YAML frontmatter (between --- delimiters).
   Return JSON: { frontmatter: <object or null>, wordCount: <int>, lines: <int> }.

Server name: obsidian`,
  },

  {
    id: "github",
    name: "GitHub",
    description: "Manage repositories, issues, pull requests, and files on GitHub",
    envVars: [
      { key: "GITHUB_TOKEN", description: "GitHub personal access token or fine-grained token", required: true },
    ],
    prompt: `GitHub connector using the GitHub REST API.
Base URL: https://api.github.com
Auth headers on EVERY request:
  Authorization: Bearer <GITHUB_TOKEN from process.env>
  Accept: application/vnd.github+json
  X-GitHub-Api-Version: 2022-11-28
Use global fetch.

Generate exactly these 8 tools:

1. list_repos(visibility?)
   GET /user/repos?per_page=100&sort=updated&visibility={visibility|all}
   Return: name, full_name, description, private, language, stars (stargazers_count), updated_at.

2. get_repo(owner, repo)
   GET /repos/{owner}/{repo}
   Return full repo details as JSON.

3. list_issues(owner, repo, state?)
   GET /repos/{owner}/{repo}/issues?state={state|open}&per_page=50
   Return: number, title, state, labels (names), created_at.

4. create_issue(owner, repo, title, body?, labels?)
   POST /repos/{owner}/{repo}/issues
   Body: { title, body, labels: labels ? JSON.parse(labels) : undefined }
   Return: number, url.

5. list_prs(owner, repo, state?)
   GET /repos/{owner}/{repo}/pulls?state={state|open}&per_page=50
   Return: number, title, state, draft, head.ref, base.ref, user.login.

6. get_file(owner, repo, path, ref?)
   GET /repos/{owner}/{repo}/contents/{path}?ref={ref}
   Decode base64 content: Buffer.from(data.content, "base64").toString("utf8")
   Return decoded text + sha.

7. create_or_update_file(owner, repo, path, content, message, sha?)
   PUT /repos/{owner}/{repo}/contents/{path}
   Body: { message, content: Buffer.from(content).toString("base64"), sha }
   sha required when updating an existing file.

8. search_code(query, owner?, repo?)
   GET /search/code?q={encodeURIComponent(query + (repo ? " repo:owner/repo" : ""))}&per_page=20
   Return: items[].path, items[].html_url, items[].repository.full_name.

Read GITHUB_TOKEN from process.env. If missing, return isError content.
Server name: github`,
  },

  {
    id: "slack",
    name: "Slack",
    description: "Send messages, read channels, and search a Slack workspace",
    envVars: [
      { key: "SLACK_BOT_TOKEN", description: "Slack bot token (starts with xoxb-)", required: true },
    ],
    prompt: `Slack connector using the Slack Web API.
Base URL: https://slack.com/api
Auth header: Authorization: Bearer <SLACK_BOT_TOKEN from process.env>
POST endpoints: Content-Type: application/json, JSON body.
Use global fetch.
ALWAYS check response.ok === true (Slack API-level ok, not HTTP). If false, throw new Error(data.error).

Generate exactly these 6 tools:

1. list_channels(exclude_archived?)
   GET /conversations.list?limit=200&exclude_archived={exclude_archived|true}&types=public_channel,private_channel
   Return: id, name, topic.value, purpose.value, is_private, num_members.

2. get_channel_history(channel_id, limit?)
   GET /conversations.history?channel={channel_id}&limit={limit|50}
   Return messages: ts, text, user (id), reactions (if any).

3. post_message(channel_id, text)
   POST /chat.postMessage  body: { channel: channel_id, text }
   Return posted message ts.

4. reply_to_thread(channel_id, thread_ts, text)
   POST /chat.postMessage  body: { channel: channel_id, text, thread_ts }
   Return reply ts.

5. list_users()
   GET /users.list?limit=200
   Return: id, name, real_name, email (profile.email), is_bot.

6. search_messages(query)
   GET /search.messages?query={encodeURIComponent(query)}&count=20
   Return: matches[].text, matches[].channel.name, matches[].ts, matches[].permalink.
   Note: search.messages requires a user token (xoxp-), not a bot token.

Read SLACK_BOT_TOKEN from process.env. If missing, return isError content.
Server name: slack`,
  },

  {
    id: "linear",
    name: "Linear",
    description: "Manage issues, projects, and teams in Linear",
    envVars: [
      { key: "LINEAR_API_KEY", description: "Linear API key from Settings → API → Personal API keys", required: true },
    ],
    prompt: `Linear connector using the Linear GraphQL API.
Endpoint: https://api.linear.app/graphql
Headers on EVERY request:
  Authorization: <LINEAR_API_KEY from process.env>   (no "Bearer" prefix)
  Content-Type: application/json
Use global fetch. Send body: JSON.stringify({ query, variables }).

Generate exactly these 6 tools:

1. list_teams()
   Query: query { teams { nodes { id name key description } } }
   Return: id, name, key, description for each team.

2. list_issues(team_id?, state?, limit?)
   Query with dynamic filter:
   query($filter: IssueFilter, $first: Int) {
     issues(filter: $filter, first: $first, orderBy: updatedAt) {
       nodes { id identifier title state { name } priority assignee { name } createdAt updatedAt }
     }
   }
   Build filter object: include { team: { id: { eq: team_id } } } if team_id provided,
   { state: { name: { eq: state } } } if state provided. Default first: 50.

3. get_issue(issue_id)
   query($id: String!) {
     issue(id: $id) {
       id identifier title description state { name } priority
       assignee { name email } team { name }
       comments { nodes { body createdAt user { name } } }
     }
   }

4. create_issue(title, team_id, description?, priority?)
   mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }
   Input: { title, teamId: team_id, description, priority: priority ? parseInt(priority) : undefined }
   priority: 0=no priority, 1=urgent, 2=high, 3=medium, 4=low

5. update_issue(issue_id, title?, description?)
   mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }
   Only include non-null fields in input.

6. search_issues(query)
   query($term: String!) {
     issueSearch(term: $term, first: 20) {
       nodes { id identifier title state { name } team { name } assignee { name } }
     }
   }

Read LINEAR_API_KEY from process.env. If missing, return isError content.
Server name: linear`,
  },

  {
    id: "airtable",
    name: "Airtable",
    description: "Read and write records in Airtable bases and tables",
    envVars: [
      { key: "AIRTABLE_API_KEY", description: "Airtable personal access token (starts with pat)", required: true },
      { key: "AIRTABLE_BASE_ID", description: "Default base ID (starts with app) — used when base_id arg is omitted", required: false },
    ],
    prompt: `Airtable connector using the Airtable REST API.
Auth header: Authorization: Bearer <AIRTABLE_API_KEY from process.env>
Content-Type: application/json
Use global fetch.

API base for records: https://api.airtable.com/v0/{base_id}/{table}
API base for metadata: https://api.airtable.com/v0/meta

Generate exactly these 6 tools:

1. list_bases()
   GET https://api.airtable.com/v0/meta/bases
   Return: id, name, permissionLevel for each base.

2. list_tables(base_id?)
   GET https://api.airtable.com/v0/meta/bases/{base_id|AIRTABLE_BASE_ID}/tables
   Return: id, name, and field names for each table.
   Default base_id to process.env.AIRTABLE_BASE_ID if not in args.

3. list_records(table, base_id?, view?, max_records?, filter_formula?)
   GET https://api.airtable.com/v0/{base_id}/{encodeURIComponent(table)}
   Query params: view, maxRecords, filterByFormula (URL-encode the formula).
   Return: id, fields for each record.

4. get_record(table, record_id, base_id?)
   GET https://api.airtable.com/v0/{base_id}/{encodeURIComponent(table)}/{record_id}
   Return: id, fields.

5. create_record(table, fields, base_id?)
   POST https://api.airtable.com/v0/{base_id}/{encodeURIComponent(table)}
   Body: { records: [{ fields: JSON.parse(fields) }] }
   fields arg is a JSON string. Return created record id.

6. update_record(table, record_id, fields, base_id?)
   PATCH https://api.airtable.com/v0/{base_id}/{encodeURIComponent(table)}/{record_id}
   Body: { fields: JSON.parse(fields) }

Default base_id to process.env.AIRTABLE_BASE_ID when not provided in args.
Read AIRTABLE_API_KEY from process.env. If missing, return isError content.
Server name: airtable`,
  },

  {
    id: "discord",
    name: "Discord",
    description: "Read and send messages in Discord servers and channels",
    envVars: [
      { key: "DISCORD_BOT_TOKEN", description: "Discord bot token from the Discord Developer Portal", required: true },
    ],
    prompt: `Discord connector using the Discord REST API v10.
Base URL: https://discord.com/api/v10
Auth header: Authorization: Bot <DISCORD_BOT_TOKEN from process.env>
Content-Type: application/json on POST/PATCH.
Use global fetch.

Generate exactly these 6 tools:

1. list_guilds()
   GET /users/@me/guilds
   Return: id, name for each guild/server the bot is in.

2. list_channels(guild_id)
   GET /guilds/{guild_id}/channels
   Filter to type === 0 (text channels) only.
   Return: id, name, topic, parent_id.

3. get_messages(channel_id, limit?)
   GET /channels/{channel_id}/messages?limit={limit|50}
   Return: id, content, author.username, timestamp.

4. send_message(channel_id, content)
   POST /channels/{channel_id}/messages
   Body: { content }
   Return: id of created message.

5. list_guild_members(guild_id, limit?)
   GET /guilds/{guild_id}/members?limit={limit|100}
   Return: user.id, user.username, nick, joined_at.

6. create_thread(channel_id, name, message, auto_archive_duration?)
   POST /channels/{channel_id}/threads
   Body: { name, auto_archive_duration: auto_archive_duration || 1440, type: 11 }
   Then POST /channels/{new_thread_id}/messages  body: { content: message }
   Return: thread id and name.

Read DISCORD_BOT_TOKEN from process.env. If missing, return isError content.
Server name: discord`,
  },

  {
    id: "todoist",
    name: "Todoist",
    description: "Manage tasks and projects in Todoist",
    envVars: [
      { key: "TODOIST_API_TOKEN", description: "Todoist API token from Settings → Integrations → Developer", required: true },
    ],
    prompt: `Todoist connector using the Todoist REST API v2.
Base URL: https://api.todoist.com/rest/v2
Auth header: Authorization: Bearer <TODOIST_API_TOKEN from process.env>
Content-Type: application/json
Use global fetch.

Generate exactly these 6 tools:

1. list_projects()
   GET /projects
   Return: id, name, color, is_favorite, parent_id for each.

2. list_tasks(project_id?, filter?)
   GET /tasks  with query params: project_id (if set), filter (if set, URL-encode).
   Return: id, content, description, due (date string), priority (1-4), is_completed.

3. get_task(task_id)
   GET /tasks/{task_id}
   Return full task details.

4. create_task(content, project_id?, due_string?, priority?, description?)
   POST /tasks
   Body: include only provided non-null fields.
   priority: 1=normal, 2=high, 3=very high, 4=urgent (Todoist reversal: 4 is highest).
   Return created task id + url.

5. complete_task(task_id)
   POST /tasks/{task_id}/close
   Return "task {task_id} completed".

6. update_task(task_id, content?, due_string?, priority?, description?)
   POST /tasks/{task_id}
   Body: include only provided non-null fields.

Read TODOIST_API_TOKEN from process.env. If missing, return isError content.
Server name: todoist`,
  },

  {
    id: "hackernews",
    name: "Hacker News",
    description: "Fetch top stories, new stories, and search HN — no credentials required",
    envVars: [],
    prompt: `Hacker News connector using the public HackerNews Firebase REST API and Algolia search API.
No auth required. Use global fetch.

Firebase base URL: https://hacker-news.firebaseio.com/v0
Algolia search URL: https://hn.algolia.com/api/v1

Helper: async function fetchItem(id) { const r = await fetch(\`https://hacker-news.firebaseio.com/v0/item/\${id}.json\`); return r.json(); }
Helper: async function fetchTopN(endpoint, n) { const r = await fetch(\`https://hacker-news.firebaseio.com/v0/\${endpoint}.json\`); const ids = await r.json(); return Promise.all(ids.slice(0, n).map(fetchItem)); }

Generate exactly these 5 tools:

1. top_stories(limit?)
   Use fetchTopN("topstories", limit||10).
   Return numbered list: "{rank}. {title} ({score} pts, {descendants||0} comments) — {url||'[text post]'}"

2. new_stories(limit?)
   Use fetchTopN("newstories", limit||10). Same format as top_stories.

3. best_stories(limit?)
   Use fetchTopN("beststories", limit||10). Same format.

4. get_story(id)
   GET https://hacker-news.firebaseio.com/v0/item/{id}.json
   Also fetch first 3 comment items (kids array). Format story details + comment previews.

5. search_stories(query, limit?)
   GET https://hn.algolia.com/api/v1/search?query={encodeURIComponent(query)}&tags=story&hitsPerPage={limit||10}
   Return: numbered list of "title (points pts) — url" for each hit.

Server name: hackernews`,
  },

  {
    id: "jira",
    name: "Jira",
    description: "Manage issues, projects, and sprints in Jira Cloud",
    envVars: [
      { key: "JIRA_BASE_URL", description: "Your Jira Cloud URL, e.g. https://yourcompany.atlassian.net", required: true },
      { key: "JIRA_EMAIL", description: "Your Atlassian account email", required: true },
      { key: "JIRA_API_TOKEN", description: "API token from id.atlassian.com/manage-profile/security/api-tokens", required: true },
    ],
    prompt: `Jira Cloud connector using the Jira REST API v3.
Base URL: process.env.JIRA_BASE_URL + "/rest/api/3"
Auth: Basic — compute once at top of file:
  const JIRA_AUTH = Buffer.from((process.env.JIRA_EMAIL ?? "") + ":" + (process.env.JIRA_API_TOKEN ?? "")).toString("base64");
Headers on EVERY request:
  Authorization: Basic <JIRA_AUTH>
  Accept: application/json
  Content-Type: application/json
Use global fetch.

Generate exactly these 7 tools:

1. list_projects()
   GET /project?maxResults=50&orderBy=name&typeKey=software
   Return: key, name, id, projectTypeKey for each.

2. search_issues(jql, max_results?)
   GET /search?jql={encodeURIComponent(jql)}&maxResults={max_results|20}&fields=summary,status,assignee,priority,created,updated
   Return: issues[].key, summary, status.name, assignee.displayName, priority.name.

3. get_issue(issue_key)
   GET /issue/{issue_key}?fields=summary,description,status,assignee,priority,comment,subtasks
   Extract description text from doc format: content[].content[].text joined.
   Return: key, summary, description text, status, assignee, priority, comments list.

4. create_issue(project_key, summary, issue_type?, description?, priority?)
   POST /issue
   Body: { fields: {
     project: { key: project_key },
     summary,
     issuetype: { name: issue_type || "Task" },
     description: description ? { type:"doc", version:1, content:[{ type:"paragraph", content:[{ type:"text", text:description }] }] } : undefined,
     priority: priority ? { name: priority } : undefined
   } }

5. transition_issue(issue_key, status_name)
   First GET /issue/{issue_key}/transitions — find transition whose name matches status_name (case-insensitive).
   Then POST /issue/{issue_key}/transitions  body: { transition: { id: <found_id> } }

6. add_comment(issue_key, body_text)
   POST /issue/{issue_key}/comment
   Body: { body: { type:"doc", version:1, content:[{ type:"paragraph", content:[{ type:"text", text:body_text }] }] } }

7. search_users(query)
   GET /user/search?query={encodeURIComponent(query)}&maxResults=20
   Return: accountId, displayName, emailAddress for each.

Validate JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN — if any missing return isError content.
Server name: jira`,
  },
];

export function findService(id: string): ServiceEntry | undefined {
  return CATALOG.find((s) => s.id === id.toLowerCase().trim());
}

export function listServices(): string {
  return CATALOG.map((s) => {
    const required = s.envVars.filter((v) => v.required).map((v) => v.key).join(", ");
    const optional = s.envVars.filter((v) => !v.required).map((v) => v.key).join(", ");
    const envLine = [required && `required: ${required}`, optional && `optional: ${optional}`]
      .filter(Boolean)
      .join(" | ");
    return `${s.id.padEnd(10)} ${s.name.padEnd(14)} ${s.description}\n           ${envLine}`;
  }).join("\n\n");
}
