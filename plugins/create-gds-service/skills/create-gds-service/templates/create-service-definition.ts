/**
 * Scaffold from `.claude/skills/create-gds-service/templates/create-service-definition.ts`.
 * Copy to `scripts/d365/create-<slug>.ts` and edit the SLUG constant.
 *
 * Reads the proposed Dataverse row from
 * `public/services/<slug>/dataverse-row.json`, prints what it would POST,
 * and only writes when --commit is passed. Idempotent: if a row already
 * exists with `lcc_servicetype eq '<slug>'`, it logs the existing id and
 * exits without touching it.
 *
 *   Dry run:   npx tsx scripts/d365/create-<slug>.ts
 *   Commit:    npx tsx scripts/d365/create-<slug>.ts --commit
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotenv, readD365Config } from './env';
import { d365Fetch } from './client';
import { getAccessToken } from './auth';

const SLUG = '<slug>';
const ROW_PATH = join(process.cwd(), 'public', 'services', SLUG, 'dataverse-row.json');

interface ListRes<T> { value: T[]; '@odata.count'?: number }
interface ServiceDefRow { lcc_servicedefinitionid: string }

interface RowPayload {
  lcc_servicedisplayname: string;
  lcc_servicedescription?: string;
  lcc_servicetype: string;
  lcc_version?: string;
  lcc_requirecontactdetails?: boolean;
  lcc_servicemanagementtype?: number;
  lcc_servicedataschema: unknown[];
  [extra: string]: unknown;
}

function loadRow(): RowPayload {
  const raw = readFileSync(ROW_PATH, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  for (const key of Object.keys(parsed)) {
    if (key.startsWith('_comment')) delete parsed[key];
  }
  if (typeof parsed.lcc_servicetype !== 'string' || parsed.lcc_servicetype !== SLUG) {
    throw new Error(
      `dataverse-row.json lcc_servicetype must equal "${SLUG}" — got ${JSON.stringify(parsed.lcc_servicetype)}`,
    );
  }
  if (!Array.isArray(parsed.lcc_servicedataschema)) {
    throw new Error('dataverse-row.json lcc_servicedataschema must be an array');
  }
  return parsed as unknown as RowPayload;
}

async function postRow(baseUrl: string, body: Record<string, unknown>): Promise<string> {
  const config = readD365Config();
  const token = await getAccessToken(config);
  const res = await fetch(`${baseUrl}/api/data/v9.2/lcc_servicedefinitions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST failed ${res.status}: ${await res.text()}`);
  }
  const loc = res.headers.get('odata-entityid') ?? res.headers.get('OData-EntityId') ?? '';
  const match = /\(([0-9a-f-]+)\)/i.exec(loc);
  if (!match) throw new Error(`Could not extract id from location header: ${loc}`);
  return match[1];
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  loadDotenv();
  const config = readD365Config();
  const row = loadRow();

  const existing = await d365Fetch<ListRes<ServiceDefRow>>(
    config,
    `lcc_servicedefinitions?$select=lcc_servicedefinitionid&$filter=lcc_servicetype eq '${SLUG}'`,
  );
  if (existing.value[0]) {
    console.log(`Row already exists for ${SLUG}: ${existing.value[0].lcc_servicedefinitionid}`);
    console.log('Nothing to do.');
    return;
  }

  const body: Record<string, unknown> = { ...row };
  // The schema must be sent as a JSON string in the column.
  body.lcc_servicedataschema = JSON.stringify(row.lcc_servicedataschema);

  if (!commit) {
    console.log('Dry run — would POST the following row to lcc_servicedefinitions:');
    console.log(JSON.stringify(body, null, 2));
    console.log('');
    console.log('Re-run with --commit to actually create the row.');
    return;
  }

  console.log(`Creating row for ${SLUG}...`);
  const id = await postRow(config.url, body);
  console.log(`Created. lcc_servicedefinitionid: ${id}`);
  console.log('');
  console.log('The spec generator will pick up the new row on its next sweep.');
  console.log(`Expected operationId: Create-${SLUG}-ServiceRequest-V1`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed: ${msg}`);
  process.exit(1);
});
