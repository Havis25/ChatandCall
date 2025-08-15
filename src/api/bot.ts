export async function askBot(message: string) {
  await new Promise((r) => setTimeout(r, 500));
  return { reply: `BOT: kamu bilang "${message}"` };
}
