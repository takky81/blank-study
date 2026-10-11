import type { ReactElement } from 'react';

export type FeatureNavigationPlacement = 'wide' | 'narrow';

export type FeatureNavigationDescriptor = {
  id: string;
  label: string;
  to: string;
  placements: readonly FeatureNavigationPlacement[];
};

export type FeatureRouteDescriptor = {
  id: string;
  path: string;
  element: ReactElement;
  requiresAuth: true;
  navigation?: FeatureNavigationDescriptor;
};

export type FeatureNavigation = Readonly<
  Record<FeatureNavigationPlacement, readonly FeatureNavigationDescriptor[]>
>;

function assertUnique(value: string, seen: Set<string>, kind: string): void {
  if (seen.has(value)) {
    throw new Error(`Duplicate feature ${kind}: ${value}`);
  }
  seen.add(value);
}

/** Validate feature-owned descriptors before AppShell installs any routes. */
export function composeFeatureRoutes(
  descriptors: readonly FeatureRouteDescriptor[],
): readonly FeatureRouteDescriptor[] {
  const routeIds = new Set<string>();
  const paths = new Set<string>();
  const navigationIds = new Set<string>();

  for (const descriptor of descriptors) {
    assertUnique(descriptor.id, routeIds, 'route ID');
    assertUnique(descriptor.path, paths, 'route path');
    if (descriptor.navigation) {
      assertUnique(descriptor.navigation.id, navigationIds, 'navigation ID');
    }
  }

  return descriptors;
}

/** Compose one navigation descriptor into each requested shell placement. */
export function composeFeatureNavigation(
  descriptors: readonly FeatureRouteDescriptor[],
): FeatureNavigation {
  const wide: FeatureNavigationDescriptor[] = [];
  const narrow: FeatureNavigationDescriptor[] = [];

  for (const descriptor of composeFeatureRoutes(descriptors)) {
    const navigation = descriptor.navigation;
    if (!navigation) continue;

    const placements = new Set(navigation.placements);
    if (placements.has('wide')) wide.push(navigation);
    if (placements.has('narrow')) narrow.push(navigation);
  }

  return { wide, narrow };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve URLSearchParams.get() の decode 済み returnTo を共有 allowlist で検証する。 */
export function resolveFeatureReturnTo(
  returnTo: string | null | undefined,
  fallback: string,
): string {
  if (!returnTo) return fallback;

  const decoded = returnTo;

  if (decoded === '/' || decoded === '/questions') return decoded;
  if (decoded.includes('?') || decoded.includes('#') || decoded.includes('\\')) return fallback;
  if (decoded.startsWith('//')) return fallback;

  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return fallback;

  const subjectMatch = decoded.match(/^\/subjects\/([^/]+)$/);
  if (subjectMatch?.[1] && UUID_PATTERN.test(subjectMatch[1])) return decoded;

  const materialMatch = decoded.match(/^\/materials\/([^/]+)\/edit$/);
  if (materialMatch?.[1] && UUID_PATTERN.test(materialMatch[1])) return decoded;

  return fallback;
}
