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
