import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';

import {
  composeFeatureNavigation,
  composeFeatureRoutes,
  resolveFeatureReturnTo,
  type FeatureRouteDescriptor,
} from './featureRoutes';

const uuid = '123e4567-e89b-12d3-a456-426614174000';

function returnToFromRawQuery(rawValue: string): string | null {
  return new URLSearchParams(`returnTo=${rawValue}`).get('returnTo');
}

function route(
  id: string,
  path: string,
  navigation?: FeatureRouteDescriptor['navigation'],
): FeatureRouteDescriptor {
  return {
    id,
    path,
    element: createElement('div'),
    requiresAuth: true,
    navigation,
  };
}

describe('feature route registry', () => {
  it.each([
    ['route ID', [route('same', '/one'), route('same', '/two')]],
    ['path', [route('one', '/same'), route('two', '/same')]],
    [
      'navigation ID',
      [
        route('one', '/one', { id: 'same', label: 'One', to: '/one', placements: ['wide'] }),
        route('two', '/two', { id: 'same', label: 'Two', to: '/two', placements: ['narrow'] }),
      ],
    ],
  ])('%s の重複を拒否する', (_kind, descriptors) => {
    expect(() => composeFeatureRoutes(descriptors)).toThrow(/duplicate/i);
  });

  it('同じnavigationを指定されたwide/narrowへ一度ずつ合成する', () => {
    const descriptor = route('questions.bank', '/questions', {
      id: 'nav.questions.bank',
      label: '設問',
      to: '/questions',
      placements: ['wide', 'narrow', 'wide'],
    });

    expect(composeFeatureNavigation([descriptor])).toEqual({
      wide: [descriptor.navigation],
      narrow: [descriptor.navigation],
    });
  });

  it('route descriptorを順序とReact elementを保ったまま返す', () => {
    const descriptors = [route('one', '/one'), route('two', '/two')] as const;

    const composed = composeFeatureRoutes(descriptors);

    expect(composed).toEqual(descriptors);
    expect(composed[0]?.element).toBe(descriptors[0].element);
  });
});

describe('feature returnTo contract', () => {
  it.each([
    ['%2F', '/'],
    ['%2Fquestions', '/questions'],
    [`%2Fsubjects%2F${uuid}`, `/subjects/${uuid}`],
    [`%2Fmaterials%2F${uuid}%2Fedit`, `/materials/${uuid}/edit`],
  ])(
    'raw query内で一度encodeされた許可path %s を採用する',
    (rawValue, expected) => {
      const fallback = expected === '/' ? '/questions' : '/';
      expect(resolveFeatureReturnTo(returnToFromRawQuery(rawValue), fallback)).toBe(expected);
    },
  );

  it('URLSearchParamsが返すdecode済みpathをそのまま採用する', () => {
    expect(resolveFeatureReturnTo(`/subjects/${uuid}`, '/questions')).toBe(`/subjects/${uuid}`);
  });

  it.each([
    '%252Fquestions',
    `https%3A%2F%2Fexample.com%2Fquestions`,
    `%2F%2Fexample.com%2Fquestions`,
    `%2Fsubjects%2F${uuid}%2F..%2Fquestions`,
    `%2Fsubjects%2F${uuid}%5C..%5Cquestions`,
    `%2Fsubjects%2F${uuid}%23fragment`,
    `%2Fquestions%3FreturnTo%3D%252F`,
    '%2Fsubjects%2Fnot-a-uuid',
  ])('raw query内の許可外値 %s では安全な既定値を返す', (rawValue) => {
    expect(resolveFeatureReturnTo(returnToFromRawQuery(rawValue), '/')).toBe('/');
  });

  it.each([undefined, null, ''])('省略値 %s では安全な既定値を返す', (returnTo) => {
    expect(resolveFeatureReturnTo(returnTo, '/questions')).toBe('/questions');
  });
});

describe('feature route import boundary', () => {
  it('registryがfeature APIや業務型をimportしない', () => {
    const source = readFileSync(resolve('src/app/featureRoutes.ts'), 'utf8');

    expect(source).not.toMatch(/from ['"]@\/features\//);
    expect(source).not.toMatch(/from ['"]\.\.\/features\//);
    expect(source).not.toMatch(/supabase/i);
  });

  it('AppShellだけがregistryを消費するcomposition境界を持つ', () => {
    const srcRoot = resolve('src');
    const productionSources: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name)) {
          productionSources.push(path);
        }
      }
    };
    visit(srcRoot);

    const registryImport = /from\s+['"](?:@\/app\/featureRoutes|(?:\.\.?\/)+(?:app\/)?featureRoutes)['"]/;
    const consumers = productionSources
      .filter((path) => !path.replaceAll('\\', '/').endsWith('/app/featureRoutes.ts'))
      .filter((path) => registryImport.test(readFileSync(path, 'utf8')));

    expect(consumers).toEqual([resolve('src/App.tsx')]);

    const source = readFileSync(consumers[0]!, 'utf8');

    expect(source).toContain("from '@/app/featureRoutes'");
    expect(source).toContain('composeFeatureRoutes(featureRouteDescriptors)');
    expect(source).toContain('featureRoutes.map');
    expect(source).toContain('featureNavigation.wide.map');
    expect(source).toContain('featureNavigation.narrow.map');
  });

  it('AppShellが3つの構造化設問route adapterをregistryへ登録する', () => {
    const source = readFileSync(resolve('src/App.tsx'), 'utf8');

    expect(source).toMatch(/QUESTION_BANK_ROUTE_DESCRIPTOR,\s*QUESTION_STUDY_ROUTE_DESCRIPTOR,\s*QUESTION_EXCHANGE_ROUTE_DESCRIPTOR/);
    expect(source).toContain("from '@/features/questions/QuestionBankRoute'");
    expect(source).toContain("from '@/features/questionStudy/QuestionStudyRoute'");
    expect(source).toContain("from '@/features/questionExchange/QuestionExchangeRoute'");
    expect(source).toMatch(/QUESTION_EXCHANGE_ROUTE_DESCRIPTOR,\s*QUESTION_DISTRIBUTION_ROUTE_DESCRIPTOR,\s*\]/);
    expect(source).toContain("from '@/features/questionStudy/QuestionDistributionRoute'");
    // AppShellは業務型を解釈しない
    expect(source).not.toMatch(/keywordId|scopeId|QuestionStudyScope|QuestionExchangeHierarchy/);
  });
});
