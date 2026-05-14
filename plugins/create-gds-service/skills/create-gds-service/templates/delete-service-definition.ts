/**
 * Scaffold from `.claude/skills/create-gds-service/templates/delete-service-definition.ts`.
 * Copy to `scripts/d365/delete-<slug>.ts` and edit the SLUG constant.
 *
 * Removes a service end-to-end:
 *   1. Looks up the lcc_servicedefinition row by lcc_servicetype = SLUG.
 *   2. Prints createdon, modifiedon, and the age in days.
 *   3. Gates on age — services older than 24 h need --confirm-old in
 *      addition to --commit. Without flags, prints the plan and exits.
 *   4. On --commit: DELETE the Dataverse row, then remove the local
 *      public/services/<slug>/ folder.
 *
 *   Dry run:        npx tsx scripts/d365/delete-<slug>.ts
 *   Hot delete:     npx tsx scripts/d365/delete-<slug>.ts --commit
 *   Cold delete:    npx tsx scripts/d365/delete-<slug>.ts --commit --confirm-old
 *   Re-seed:        npx tsx scripts/d365/delete-<slug>.ts --commit --keep-files
 *                   (deletes the DV row but leaves public/services/<slug>/
 *                    intact, so a follow-up create-<slug>.ts --commit posts
 *                    the new schema)
 *
 * After running with --commit, refresh the spec so the operationId
 * drops out:
 *   npx tsx scripts/d365/snapshot-bundled-spec.ts
 */

import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotenv, readD365Config } from './env';
import { d365Fetch } from './client';

const SLUG = '<slug>';
const COLD_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const SERVICE_DIR = join(process.cwd(), 'public', 'services', SLUG);

interface ListRes<T> { value: T[] }
interface ServiceDefRow {
  lcc_servicedefinitionid: string;
  lcc_servicedisplayname?: string;
  lcc_servicetype?: string;
  createdon?: string;
  modifiedon?: string;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '(unknown)';
  return iso.slice(0, 10);
}

function ageDays(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function countLocalPages(): number {
  if (!existsSync(SERVICE_DIR)) return 0;
  return readdirSync(SERVICE_DIR).filter((f) => f.endsWith('.md')).length;
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const confirmOld = process.argv.includes('--confirm-old');
  // Re-seed workflow: delete the DV row but leave the markdown alone so a
  // follow-up `create-<slug>.ts --commit` can post the new schema.
  const keepFiles = process.argv.includes('--keep-files');

  loadDotenv();
  const config = readD365Config();

  const list = await d365Fetch<ListRes<ServiceDefRow>>(
    config,
    `lcc_servicedefinitions?$select=lcc_servicedefinitionid,lcc_servicedisplayname,lcc_servicetype,createdon,modifiedon&$filter=lcc_servicetype eq '${SLUG}'`,
  );
  const row = list.value[0];

  const localPages = countLocalPages();
  const folderExists = existsSync(SERVICE_DIR);

  if (!row && !folderExists) {
    console.log(`Nothing to do — no Dataverse row and no public/services/${SLUG}/ folder.`);
    return;
  }

  console.log(`Service: ${SLUG}`);
  if (row) {
    console.log(`  Display name:    ${row.lcc_servicedisplayname ?? '(unset)'}`);
    console.log(`  Row id:          ${row.lcc_servicedefinitionid}`);
    console.log(`  Created:         ${formatDate(row.createdon)} (~${ageDays(row.createdon)} days ago)`);
    console.log(`  Last modified:   ${formatDate(row.modifiedon)} (~${ageDays(row.modifiedon)} days ago)`);
  } else {
    console.log('  Dataverse row:   none (local folder only)');
  }
  console.log(`  Local folder:    ${folderExists ? `${SERVICE_DIR} (${localPages} page${localPages === 1 ? '' : 's'})` : 'absent'}`);
  console.log('');

  const ageMs = row?.createdon ? Date.now() - new Date(row.createdon).getTime() : 0;
  const isCold = ageMs > COLD_THRESHOLD_MS;

  if (!commit) {
    if (isCold) {
      console.log('This service is older than 24 hours. To delete:');
      console.log(`  npx tsx scripts/d365/delete-${SLUG}.ts --commit --confirm-old`);
    } else {
      console.log('This service is less than 24 hours old. To delete:');
      console.log(`  npx tsx scripts/d365/delete-${SLUG}.ts --commit`);
    }
    return;
  }

  if (isCold && !confirmOld) {
    console.error(
      `Refusing to delete: this service was created on ${formatDate(row?.createdon)}, about ${ageDays(row?.createdon)} days ago.`,
    );
    console.error(
      'Deleting removes the Dataverse row and the public/services/<slug>/ folder. The operationId will disappear from the next spec generation.',
    );
    console.error(`Re-run with --commit --confirm-old to proceed.`);
    process.exit(2);
  }

  if (row) {
    console.log(`Deleting Dataverse row ${row.lcc_servicedefinitionid}...`);
    await d365Fetch(config, `lcc_servicedefinitions(${row.lcc_servicedefinitionid})`, {
      method: 'DELETE',
    });
    console.log('  Deleted.');
  }

  if (folderExists && !keepFiles) {
    console.log(`Removing local folder ${SERVICE_DIR}...`);
    rmSync(SERVICE_DIR, { recursive: true, force: true });
    console.log('  Removed.');
  } else if (folderExists && keepFiles) {
    console.log(`Keeping local folder ${SERVICE_DIR} (--keep-files).`);
  }

  console.log('');
  console.log('Next:');
  console.log('  npx tsx scripts/d365/snapshot-bundled-spec.ts   # drops the operationId from the spec');
  console.log(`  git add -A && git commit -m "Retire '${row?.lcc_servicedisplayname ?? SLUG}'"`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed: ${msg}`);
  process.exit(1);
});
