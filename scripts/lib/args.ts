// Tiny argv helpers shared by the scripts that take flags. Each `take*` removes what it
// consumed from the array, so whatever is left is the positional arguments.
export function takeFlag(args: string[], ...names: string[]): boolean {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i >= 0) {
      args.splice(i, 1);
      return true;
    }
  }
  return false;
}

/**
 * Take `--name value`, removing both. Also accepts `--name=value`, since that is the form
 * fingers produce when the docs show the spaced one.
 */
export function takeOpt(args: string[], name: string): string | undefined {
  const eq = args.findIndex((a) => a.startsWith(`${name}=`));
  if (eq >= 0) {
    const [v] = args.splice(eq, 1);
    return v.slice(name.length + 1);
  }
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  args.splice(i, 2);
  return v;
}

/**
 * Refuse anything flag-shaped this command does not understand. Call it once every
 * `takeFlag`/`takeOpt` has removed what it consumed, so whatever remains is positional.
 *
 * Silence is the wrong default here: an unrecognized flag left in the array becomes a
 * positional argument, and `khb export mybundle --force` used to quietly export into a
 * directory named `--force`. A typo should cost an error message, not a mystery folder.
 */
export function rejectUnknownFlags(args: string[], usage: string): void {
  const bad = args.find((a) => a.length > 1 && a.startsWith("-"));
  if (!bad) return;
  console.error(`Unknown option: ${bad}`);
  console.error(`Usage: ${usage}`);
  process.exit(1);
}
