import { Client } from 'pg';
import { directConnection } from './config';

const subject = process.env.OWNER_SUBJECT;
if (!subject?.trim())
	throw new Error('Configure OWNER_SUBJECT explicitly; no first-visitor ownership.');
const client = new Client({
	connectionString: directConnection(),
	connectionTimeoutMillis: 10_000
});
try {
	await client.connect();
	await client.query(
		'INSERT INTO public.vaults(owner_subject) VALUES ($1) ON CONFLICT (owner_subject) DO NOTHING',
		[subject]
	);
	console.log('Configured owner vault initialized. No content was created.');
} catch {
	console.error('Owner initialization failed. Apply the reviewed schema and check configuration.');
	process.exitCode = 1;
} finally {
	await client.end();
}
