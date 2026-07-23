// Tiny argv helpers shared by the scripts that take flags. Each `take*` removes what it
// consumed from the array, so whatever is left is the positional arguments.
export function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
