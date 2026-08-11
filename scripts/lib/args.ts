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
