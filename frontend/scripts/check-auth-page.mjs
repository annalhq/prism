// Narrow HTTP diagnostic for local .env loading. It never submits credentials.
const target = process.argv[2] ?? 'http://localhost:5173';
const response = await fetch(new URL('/auth/sign-in', target), {
	signal: AbortSignal.timeout(30_000)
});
const body = await response.text();
const configured =
	response.ok && body.includes('name="email"') && !body.includes('Sign-in is not configured yet');
console.log(JSON.stringify({ status: response.status, signInFormAvailable: configured }));
process.exitCode = configured ? 0 : 1;
