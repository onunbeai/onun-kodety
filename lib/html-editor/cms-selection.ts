type Collection = { slug: string };

/** WordPress has a native post type; an HTML project only has its saved schema. */
export function initialCmsCollection(staticRuntime: boolean, requested = '', initial = ''): string {
  return staticRuntime ? '' : requested || initial || 'post';
}

export function resolveCmsCollection(types: readonly Collection[], current: string, requested: string, initial: string, staticRuntime: boolean): string {
  const available = types.filter(type => type.slug !== 'page');
  for (const candidate of [current, requested, initial]) {
    if (candidate && available.some(type => type.slug === candidate)) return candidate;
  }
  if (!staticRuntime && !available.length) return current;
  return (!staticRuntime && available.find(type => type.slug === 'post')?.slug) || available[0]?.slug || '';
}
