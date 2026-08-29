import { ensureTestUser, resetData } from './db';

/** E2E 用ユーザーを用意し、前回の残りを消してから始める。 */
export default async function globalSetup() {
  const ownerId = await ensureTestUser();
  await resetData(ownerId);
  process.env.E2E_OWNER_ID = ownerId;
}
