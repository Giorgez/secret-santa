// ყოველ 10 წუთში ამოწმებს, რომელ ჯგუფს მოუვიდა გათამაშების დრო
import { db, autoRollDue } from './lib/core.mjs';

export default async () => {
  const n = await autoRollDue(db());
  console.log(`auto-rolled ${n} group(s)`);
  return new Response('ok');
};

export const config = { schedule: '*/10 * * * *' };
