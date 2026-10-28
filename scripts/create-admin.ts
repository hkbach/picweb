import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { db } from '../src/server/db.ts';
import { hashPassword, passwordProblem } from '../src/server/passwords.ts';
import { cleanEmail, cleanName } from '../src/server/validate.ts';

// Creates an administrator (or turns an existing account into one and sets its password).
//   npm run create-admin -- admin@example.com "First" "Last"
// The password is typed at a hidden prompt, or taken from the ADMIN_PASSWORD environment variable for
// automated setups. It is never an argument (arguments show up in shell history and process lists).
const [emailArg, firstArg = 'Admin', lastArg = 'User'] = process.argv.slice(2);
const email = cleanEmail(emailArg);
const firstName = cleanName(firstArg);
const lastName = cleanName(lastArg);
if (!email || !firstName || !lastName) {
	console.error('Usage: npm run create-admin -- <email> [first name] [last name]');
	process.exit(1);
}

function ask(question: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
		const muted = rl as unknown as { _writeToOutput: (text: string) => void };
		process.stdout.write(question);
		muted._writeToOutput = () => {};
		rl.question('', (answer) => {
			rl.close();
			process.stdout.write('\n');
			resolve(answer);
		});
	});
}

const password = process.env.ADMIN_PASSWORD ?? (process.stdin.isTTY ? await ask('Password: ') : '');
const problem = passwordProblem(password);
if (problem) {
	console.error(problem);
	process.exit(1);
}

const hash = await hashPassword(password);
const existing = db().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
if (existing) {
	db().prepare("UPDATE users SET password_hash = ?, role = 'admin', status = 'active', must_change_password = 0 WHERE id = ?").run(hash, existing.id);
	db().prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
	console.log(`Updated ${email}: now an administrator with the new password.`);
} else {
	db()
		.prepare("INSERT INTO users (id, first_name, last_name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'admin', ?)")
		.run(randomUUID(), firstName, lastName, email, hash, new Date().toISOString());
	console.log(`Created administrator ${email}.`);
}
