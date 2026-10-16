import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const photo = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));

/** Attend que la reconstruction locale ait mis la page à jour. */
async function expectOnSite(page: Page, path: string, text: string | RegExp) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(path);
        return response.ok() ? await response.text() : '';
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toMatch(text);
}

test('l’admin se charge, sans problème d’accessibilité majeur', async ({
  page,
}) => {
  await page.goto('/admin/');
  await expect(page.getByRole('link', { name: 'Accueil' })).toBeVisible();
  await expect(page.getByText('admin@example.com')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
});

test('modifier un texte de page met le site à jour', async ({ page }) => {
  const title = `Titre e2e ${Date.now()}`;
  await page.goto('/admin/#/pages/accueil');
  await page.getByLabel('Titre', { exact: true }).fill(title);
  await expect(page.getByText('1 modification non enregistrée')).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer et publier' }).click();
  await expect(page.getByText(/Enregistré/)).toBeVisible();
  await expectOnSite(page, '/', title);
});

test('un champ invalide est refusé avec un message clair', async ({ page }) => {
  await page.goto('/admin/#/pages/commun');
  await page.getByLabel('Adresse email').fill('pas-un-email');
  await page.getByRole('button', { name: 'Enregistrer et publier' }).click();
  await expect(
    page.getByText('« Adresse email » doit être une adresse email valide.'),
  ).toBeVisible();
});

test('quitter une page modifiée demande confirmation', async ({ page }) => {
  await page.goto('/admin/#/pages/accueil');
  await page.getByLabel('Introduction').fill('Brouillon non enregistré');
  await page.getByRole('link', { name: 'Éléments communs' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Quitter sans enregistrer ?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Rester sur la page' }).click();
  await expect(page.getByLabel('Introduction')).toHaveValue(
    'Brouillon non enregistré',
  );
});

test('publier un article avec photo et texte mis en forme', async ({
  page,
}) => {
  const title = `Article e2e ${Date.now()}`;
  await page.goto('/admin/#/collections/articles/nouveau');
  await page.getByLabel('Titre', { exact: true }).fill(title);
  await page.getByLabel('Résumé').fill('Un résumé de test.');

  // Publier sans photo ni texte : refusé, champ par champ.
  await page.getByRole('button', { name: 'Publier sur le site' }).click();
  await expect(
    page.getByText('« Photo de couverture » est obligatoire pour publier.'),
  ).toBeVisible();

  await page.locator('input[type=file]').first().setInputFiles(photo);
  await page.getByLabel('Description de la photo').fill('Un dégradé coloré');
  await page.getByRole('textbox', { name: 'Texte' }).click();
  await page.keyboard.type('Bonjour, voici un article de test !');

  await page.getByRole('button', { name: 'Publier sur le site' }).click();
  await expect(page.getByText(/Enregistré/)).toBeVisible();
  await expect(page.locator('.badge--large')).toHaveText('En ligne');

  const slug = title.toLowerCase().replace(/\s+/g, '-');
  await expectOnSite(page, `/blog/${slug}/`, title);
  const html = await (await page.request.get(`/blog/${slug}/`)).text();
  expect(html).toMatch(/srcset="\/media\/[0-9a-f-]{36}\/640\.(webp|jpg) 640w/);
  expect(html).toContain('alt="Un dégradé coloré"');
  expect(html).toContain('voici un article de test');

  const src = html.match(/src="(\/media\/[^"]+)"/)![1];
  const media = await page.request.get(src);
  expect(media.status()).toBe(200);
  expect(media.headers()['cache-control']).toContain('immutable');
});

test('réordonner une liste garde chaque photo et chaque ancre avec son élément', async ({
  page,
}) => {
  await page.goto('/admin/#/pages/accueil');
  const items = page.locator('.list-item__title');
  const first = (await items.nth(0).textContent())!;
  const second = (await items.nth(1).textContent())!;
  // Le champ technique « Ancre » n'apparaît pas.
  await page.getByRole('button', { name: `Descendre « ${first} »` }).click();
  await expect(items.nth(0)).toHaveText(second);
  await page.getByRole('button', { name: 'Enregistrer et publier' }).click();
  await expect(page.getByText(/Enregistré/)).toBeVisible();

  await expect
    .poll(
      async () => {
        const html = await (await page.request.get('/')).text();
        return (
          html.indexOf(second) < html.indexOf(first) && html.indexOf(second) > 0
        );
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(true);
  const html = await (await page.request.get('/')).text();
  // La photo du projet suit son élément, toujours optimisée au build.
  const moved = html.slice(html.indexOf(first));
  expect(moved).toMatch(/^[\s\S]*?<img src="\/_astro\/atelier\.[^"]+\.webp"/);
  expect(html).toContain('id="decouverte"');

  // Remise dans l'ordre d'origine pour les autres tests.
  await page.goto('/admin/#/pages/accueil');
  await page
    .getByRole('button', { name: 'Rétablir la liste d’origine' })
    .click();
  await page.getByRole('button', { name: 'Enregistrer et publier' }).click();
  await expect(page.getByText(/Enregistré/)).toBeVisible();
});

test('les images du projet ont un aperçu dans l’admin', async ({ page }) => {
  await page.goto('/admin/#/pages/accueil');
  const preview = page.locator('.cover__preview img').first();
  await expect(preview).toHaveAttribute('src', /\/_astro\/atelier\..+\.webp/);
  expect(
    await preview.evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await expect(page.getByText('Ancre')).toHaveCount(0);
});

test('l’admin affiche l’échec réel de la dernière mise en ligne', async ({
  page,
}) => {
  await page.route('**/api/admin/publish', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            lastPublishAt: '2026-10-16T09:00:00.000Z',
            lastPublishBy: 'admin@example.com',
            lastSuccessAt: '2026-10-15T09:00:00.000Z',
            build: { uuid: 'b1', state: 'failure' },
          },
        })
      : route.continue(),
  );
  await page.goto('/admin/');
  await expect(
    page.getByText('La dernière mise en ligne a échoué'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Republier' })).toBeVisible();
});

test('l’admin suit le build en cours jusqu’à la mise en ligne', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/admin/publish', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    calls += 1;
    return route.fulfill({
      json: {
        lastPublishAt: new Date().toISOString(),
        lastPublishBy: 'admin@example.com',
        lastSuccessAt: calls > 1 ? new Date().toISOString() : '',
        build: { uuid: 'b2', state: calls > 1 ? 'success' : 'running' },
      },
    });
  });
  await page.clock.install();
  await page.goto('/admin/');
  await expect(page.getByText(/Mise à jour du site en cours/)).toBeVisible();
  await page.clock.runFor(11_000);
  await expect(page.getByText(/^En ligne depuis le/)).toBeVisible();
});

test('après publication d’un nouvel article, on peut quitter sans confirmation', async ({
  page,
}) => {
  await page.goto('/admin/#/collections/articles/nouveau');
  await page
    .getByLabel('Titre', { exact: true })
    .fill(`Sans confirmation ${Date.now()}`);
  await page.getByLabel('Résumé').fill('Un résumé.');
  await page.locator('input[type=file]').first().setInputFiles(photo);
  await page.getByLabel('Description de la photo').fill('Une photo');
  await page.getByRole('textbox', { name: 'Texte' }).click();
  await page.keyboard.type('Un texte.');
  await page.getByRole('button', { name: 'Publier sur le site' }).click();
  await expect(page.locator('.badge--large')).toHaveText('En ligne');

  await page.getByRole('link', { name: 'Accueil' }).click();
  await expect(
    page.getByRole('heading', { name: 'Accueil', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Même parcours, mais en changeant d'adresse (bouton Précédent, lien direct).
  await page.goto('/admin/#/collections/articles/nouveau');
  await page
    .getByLabel('Titre', { exact: true })
    .fill(`Par l’adresse ${Date.now()}`);
  await page.getByLabel('Résumé').fill('Un résumé.');
  await page.locator('input[type=file]').first().setInputFiles(photo);
  await page.getByLabel('Description de la photo').fill('Une photo');
  await page.getByRole('textbox', { name: 'Texte' }).click();
  await page.keyboard.type('Un texte.');
  await page.getByRole('button', { name: 'Publier sur le site' }).click();
  // Attendre la fin de l'enregistrement (le message « Enregistré » du premier
  // article peut encore être affiché).
  await expect(page.locator('.badge--large')).toHaveText('En ligne');
  await page.goto('/admin/#/pages/accueil');
  await expect(
    page.getByRole('heading', { name: 'Accueil', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
});
