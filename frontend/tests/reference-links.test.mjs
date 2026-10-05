import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/ts-module.mjs';

/**
 * Links to reference pages. Each must open a page that exists: Orphanet and
 * MedlinePlus Genetics answer an unknown gene with an error page, so their
 * links come only from the lists they publish.
 */

const { researchLinks, hpoTermUrl, orphanetGeneUrl, medlinePlusGeneUrl, geneCardsUrl } = await importTs(
  'lib/gene-pages.json',
  'lib/reference-links.ts',
);

const profile = (simbolo, referencias = {}) => ({ simbolo, referencias });

test('an HPO id links to its term page, anything else to nothing', () => {
  assert.equal(hpoTermUrl('HP:0001250'), 'https://hpo.jax.org/browse/term/HP:0001250');
  assert.equal(hpoTermUrl(' hp:0001250 '), 'https://hpo.jax.org/browse/term/HP:0001250');
  for (const bad of ['', null, undefined, 'HP:123', 'ORPHA:558', 'HP:0001250x']) assert.equal(hpoTermUrl(bad), null, String(bad));
});

test('Orphanet and MedlinePlus are linked only for genes they list', () => {
  assert.equal(orphanetGeneUrl('FBN1'), 'https://www.orpha.net/es/disease/gene/FBN1');
  assert.equal(orphanetGeneUrl('fbn1'), 'https://www.orpha.net/es/disease/gene/FBN1');
  assert.equal(medlinePlusGeneUrl('CFTR'), 'https://medlineplus.gov/genetics/gene/cftr/');
  assert.equal(orphanetGeneUrl('NOTAGENE1'), null);
  assert.equal(medlinePlusGeneUrl('NOTAGENE1'), null);
});

test('the reading links lead with the pages written for families', () => {
  const links = researchLinks(profile('CFTR', { 'NCBI Gene': 'https://www.ncbi.nlm.nih.gov/gene/1080' }));
  assert.deepEqual(links.map((l) => [l.label.split(' ')[0], Boolean(l.family), l.spanish]), [
    ['Orphanet', true, true],
    ['MedlinePlus', true, false],
    ['NCBI', false, false],
  ]);
});

test('a gene neither site lists gets only the links the profile carries', () => {
  assert.deepEqual(researchLinks(profile('NOTAGENE1')), []);
});

test('no search pages: every reading link is a page about the gene', () => {
  for (const link of researchLinks(profile('SCN1A'))) assert.doesNotMatch(link.url, /search|query/);
});

test('GeneCards takes the symbol URL-encoded', () => {
  assert.equal(geneCardsUrl('HLA-B'), 'https://www.genecards.org/cgi-bin/carddisp.pl?gene=HLA-B');
});
