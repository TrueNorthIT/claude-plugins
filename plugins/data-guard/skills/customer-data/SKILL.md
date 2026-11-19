---
name: customer-data
description: TrueNorth's rules for customer systems and data in Claude Code, the detail behind the AI Use Policy. What to query from Dataverse, Dynamics 365, Microsoft Graph, Application Insights and Log Analytics (named columns, IDs, counts, state and status, small pages, no names or free text), how to give someone the readable records without them coming into the session (a script that saves under exports/ and prints counts), logs, Terraform and Bicep state, plans and outputs, secrets, connection strings, .env and certificate files, exports and backups, production changes, and which tools and connectors to use. Use before querying, fetching or reading from a customer's system, tenant or environment by any route (OData, FetchXML, the SQL endpoint, pac, az, the Graph API, KQL, an MCP tool), before reading logs, state or config from one, when the user asks for customer records or a list of names, emails or contacts, or asks whether something is allowed under the AI Use Policy.
---

# Customer systems and data

The AI Use Policy (https://claude.ai/artifact/5zxetmEojVtMsoNsnpEEJE) sets the rules;
this is the detail for Claude Code. Data Guard checks prompts and tool output, but it's
a safety net, not permission: follow these whether it flags anything or not.

The rule under all of them: get the least data the task needs.

## Querying a customer's system

For Dataverse and Dynamics 365, Microsoft Graph, Application Insights and Log
Analytics, by any route (OData, FetchXML, the SQL endpoint, pac, az, KQL, an MCP tool):

- Name the columns, and only those the task needs: IDs, state, status, option-set
  values, schema and field names. When a count or an aggregate answers the question,
  use that.
- No name, email, phone, address or free-text columns, and no formatted values (no
  `odata.include-annotations` header). Get option-set labels from the table's metadata.
- Small pages and tight filters.
- Logs: filter by time range, operation and columns. Counts, error codes and stack
  traces before request bodies and custom dimensions.
- Data of unknown origin is production customer data, and so is a non-production
  environment unless the user confirms it holds only fictional data.
- Use read-only access to production where you can. Prepare production changes for
  the normal change process; don't make them directly.

## When the user needs the records themselves

When they need readable data (names, full records), write a script that saves it under
the project's `exports/` folder and prints only counts. The data must not come back
into the session: not on stdout, not through a `!` command, not pasted, not read back.
Data Guard refuses reads of `exports/` anyway.

## Infrastructure as code

- Terraform, Bicep and ARM, including a customer's network design and diagrams of it,
  are normal work.
- Don't read `*.tfstate`, `*.tfstate.backup` or saved plan files, and don't run
  `terraform show -json`, or `terraform output -json` or `-raw`, against real state.
  `terraform plan`, `state list` and `state show` are fine.

## Secrets

- Don't read `.env` files, certificates or key files, and never print a secret. Refer
  to one by its Key Vault name or environment variable.
- If a password, key, token, connection string or certificate appears in a prompt or
  output, tell the user it's exposed and must be rotated. Don't repeat it.

## Tools

- Work on customer systems belongs here, in Claude Code on a TrueNorth laptop, where
  Data Guard checks it, not in a claude.ai chat. Don't help connect a chat to a
  customer's system with credentials, tokens or browser automation.
- MCP servers, plugins and skills from the TrueNorth marketplace only, and connectors
  TrueNorth has approved. The rules above apply through them too.
- No screenshots of customer records: Data Guard can't read images.
- Keep customer names and details out of web searches and fetches.

## Never

- Citizens' or service users' data, or special category data (health, social care,
  children, criminal records), even if it's already in front of you. Stop, and tell the
  user to report it to security@truenorthit.co.uk the same day without deleting anything.
- Customer exports or backups, or CSV or Excel extracts of customer data.
- Customers' security reports, tenders, contracts or pricing, or anything marked
  (OFFICIAL-SENSITIVE, Commercial in Confidence, Legally privileged and the like).

For made-up data that Data Guard leaves alone, and for its commands, see the `status`
skill.
