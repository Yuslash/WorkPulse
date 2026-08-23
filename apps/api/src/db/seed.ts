import { ObjectId } from 'mongodb';
import { AppCategory, EntityStatus, Role } from '@workpulse/shared';
import { closeDatabase, collections, connectDatabase } from './client.js';
import { syncIndexes } from './indexes.js';
import { env } from '../config/env.js';
import { hashPassword } from '../lib/crypto.js';
import { getOrCreatePolicy } from '../modules/policies/service.js';

/**
 * Development seed: one organization, an owner account, a few departments and
 * employees, and a starter set of application categories.
 *
 * Idempotent — re-running updates rather than duplicating, so it is safe to
 * call repeatedly while iterating.
 */

const DEPARTMENTS = ['Engineering', 'Design', 'Marketing', 'Support'];

const EMPLOYEES: Array<{ name: string; email: string; jobTitle: string; department: string }> = [
  { name: 'John Doe', email: 'john.doe@acme.test', jobTitle: 'Software Engineer', department: 'Engineering' },
  { name: 'Sarah Smith', email: 'sarah.smith@acme.test', jobTitle: 'Frontend Engineer', department: 'Engineering' },
  { name: 'Alex Kumar', email: 'alex.kumar@acme.test', jobTitle: 'Platform Engineer', department: 'Engineering' },
  { name: 'Michael Brown', email: 'michael.brown@acme.test', jobTitle: 'Product Designer', department: 'Design' },
  { name: 'Priya Nair', email: 'priya.nair@acme.test', jobTitle: 'Content Strategist', department: 'Marketing' },
  { name: 'David Lee', email: 'david.lee@acme.test', jobTitle: 'Support Lead', department: 'Support' },
];

/**
 * Starter categories. Note that these are *examples an admin can change*,
 * not a built-in verdict: the product ships neutral (spec §15) and this seed
 * exists so the dashboard has something to render in development.
 */
const CATEGORIES: Array<{ exeName: string; displayName: string; category: AppCategory }> = [
  { exeName: 'code.exe', displayName: 'Visual Studio Code', category: AppCategory.Productive },
  { exeName: 'idea64.exe', displayName: 'IntelliJ IDEA', category: AppCategory.Productive },
  { exeName: 'windowsterminal.exe', displayName: 'Windows Terminal', category: AppCategory.Productive },
  { exeName: 'chrome.exe', displayName: 'Google Chrome', category: AppCategory.Neutral },
  { exeName: 'msedge.exe', displayName: 'Microsoft Edge', category: AppCategory.Neutral },
  { exeName: 'slack.exe', displayName: 'Slack', category: AppCategory.Neutral },
  { exeName: 'teams.exe', displayName: 'Microsoft Teams', category: AppCategory.Neutral },
  { exeName: 'explorer.exe', displayName: 'File Explorer', category: AppCategory.Neutral },
  { exeName: 'spotify.exe', displayName: 'Spotify', category: AppCategory.Break },
];

async function main(): Promise<void> {
  const db = await connectDatabase();
  await syncIndexes(db);

  console.log(`Seeding "${db.databaseName}"...`);
  const now = new Date();

  const slug = env.SEED_ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  await collections.organizations().updateOne(
    { slug },
    {
      $set: { name: env.SEED_ORG_NAME, updatedAt: now },
      $setOnInsert: { _id: new ObjectId(), slug, createdAt: now },
    },
    { upsert: true },
  );

  const organization = await collections.organizations().findOne({ slug });
  if (!organization) throw new Error('failed to create organization');
  const organizationId = organization._id;

  const departmentIds = new Map<string, ObjectId>();
  for (const name of DEPARTMENTS) {
    await collections.departments().updateOne(
      { organizationId, name },
      { $setOnInsert: { _id: new ObjectId(), organizationId, name, createdAt: now } },
      { upsert: true },
    );
    const dept = await collections.departments().findOne({ organizationId, name });
    if (dept) departmentIds.set(name, dept._id);
  }

  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);
  await collections.users().updateOne(
    { email: env.SEED_ADMIN_EMAIL },
    {
      $set: {
        organizationId,
        name: 'Acme Owner',
        passwordHash,
        role: Role.OrgOwner,
        departmentId: null,
        status: EntityStatus.Active,
        updatedAt: now,
      },
      $setOnInsert: { _id: new ObjectId(), email: env.SEED_ADMIN_EMAIL, lastLoginAt: null, createdAt: now },
    },
    { upsert: true },
  );

  for (const employee of EMPLOYEES) {
    await collections.employees().updateOne(
      { organizationId, email: employee.email },
      {
        $set: {
          name: employee.name,
          jobTitle: employee.jobTitle,
          departmentId: departmentIds.get(employee.department) ?? null,
          managerId: null,
          status: EntityStatus.Active,
          updatedAt: now,
        },
        $setOnInsert: { _id: new ObjectId(), organizationId, email: employee.email, createdAt: now },
      },
      { upsert: true },
    );
  }

  for (const rule of CATEGORIES) {
    await collections.appCategories().updateOne(
      { organizationId, exeName: rule.exeName },
      {
        $set: { displayName: rule.displayName, category: rule.category, updatedAt: now },
        $setOnInsert: { _id: new ObjectId(), organizationId, exeName: rule.exeName },
      },
      { upsert: true },
    );
  }

  await getOrCreatePolicy(organizationId);

  console.log('\nSeed complete.');
  console.log(`  Organization : ${env.SEED_ORG_NAME}`);
  console.log(`  Admin login  : ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}`);
  console.log(`  Employees    : ${EMPLOYEES.length}`);
  console.log(`  Departments  : ${DEPARTMENTS.length}`);
  console.log('\nGenerate an employee agent login from the dashboard: Employees -> Generate login.');

  await closeDatabase();
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
