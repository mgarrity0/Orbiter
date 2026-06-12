// Windows and macOS default filesystems are case-insensitive, so a
// case-sensitive comparison would let "Foo.json" silently overwrite
// "foo.json" on those platforms. Compare case-insensitively.
export function nameExistsCaseInsensitive(
  name: string,
  existing: readonly string[],
): boolean {
  const lower = name.toLowerCase();
  return existing.some((n) => n.toLowerCase() === lower);
}
