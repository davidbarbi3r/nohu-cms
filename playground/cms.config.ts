/**
 * Contenus modifiables dans l'admin du site d'exemple. Les valeurs écrites
 * ici sont les valeurs d'origine : l'admin ne stocke que ce qui en diffère.
 */
import {
  asset,
  collection,
  defineCms,
  email,
  image,
  list,
  page,
  richtext,
  section,
  text,
  textarea,
} from 'nohu-cms';

export default defineCms({
  admin: { title: 'Atelier Exemple', brandColor: '#2f5d50' },
  pages: {
    commun: page('Éléments communs', null, {
      contact: section('Coordonnées', {
        email: email('Adresse email', 'contact@exemple.test'),
        phone: text('Téléphone', '06 00 00 00 00', {
          help: 'Format conseillé : 06 00 00 00 00.',
        }),
      }),
    }),
    accueil: page('Accueil', '/', {
      hero: section('Haut de page', {
        title: text('Titre', 'Un atelier pour apprendre en douceur', {
          max: 70,
        }),
        intro: textarea(
          'Introduction',
          'Des cours en petits groupes, à votre rythme.\nRéservation en ligne.',
        ),
        photo: image(
          'Photo',
          asset('assets/atelier.png', 'Illustration de l’atelier'),
        ),
      }),
      services: section('Prestations', {
        items: list(
          'Prestations',
          {
            itemLabel: 'une prestation',
            itemTitle: 'name',
            fields: {
              name: text('Nom'),
              price: text('Tarif'),
              description: textarea('Description', '', { optional: true }),
              photo: image('Photo', null, { optional: true }),
              ancre: text('Ancre', '', { optional: true, hidden: true }),
            },
          },
          [
            {
              name: 'Séance découverte',
              price: '20 €',
              description: '',
              photo: asset('assets/atelier.png', 'Une séance découverte'),
              ancre: 'decouverte',
            },
            {
              name: 'Carte 10 séances',
              price: '180 €',
              description: '',
              photo: null,
              ancre: 'carte',
            },
          ],
        ),
      }),
      blog: section('Derniers articles', {
        title: text('Titre de la section', 'Les dernières nouvelles'),
        empty: text(
          'Message si aucun article',
          'Aucun article pour le moment.',
        ),
      }),
    }),
  },
  collections: {
    articles: collection('Articles', {
      itemLabel: 'un article',
      path: '/blog/[slug]',
      fields: {
        summary: textarea('Résumé', '', {
          max: 220,
          help: 'Deux ou trois phrases, affichées dans la liste des articles.',
        }),
        cover: image('Photo de couverture'),
        body: richtext('Texte'),
      },
    }),
  },
});
