const operation = process.argv[2];
const milestone = operation === 'maintenance' ? 'Task 16' : 'Task 2';
console.error(
	`${operation} is not implemented yet. Follow ${milestone} in plan.md before running this command. No services were contacted.`
);
process.exitCode = 1;
