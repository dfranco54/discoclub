import { describe, expect, it } from 'vitest';
import { loadSeedMovies, parseSeedMovies } from '../src/modules/movies/movies.seed.js';

const valid = {
  slug: 'test-movie',
  title: 'Test Movie',
  year: 2000,
  director: 'Someone',
  genres: ['Drama'],
  overview: 'A test.',
};

describe('seed file', () => {
  it('the shipped seed file is valid', async () => {
    const movies = await loadSeedMovies();

    expect(movies.length).toBeGreaterThanOrEqual(30);
  });

  it('maps seed fields to the repository shape', () => {
    expect(parseSeedMovies([valid])).toEqual([
      {
        slug: 'test-movie',
        title: 'Test Movie',
        overview: 'A test.',
        releaseYear: 2000,
        director: 'Someone',
        genres: ['Drama'],
      },
    ]);
  });

  it('rejects duplicate slugs', () => {
    expect(() => parseSeedMovies([valid, valid])).toThrow(/Duplicate slug/);
  });

  it('rejects something that is not a list', () => {
    expect(() => parseSeedMovies({ not: 'a list' })).toThrow();
  });

  it.each([
    ['an invalid slug', { ...valid, slug: 'Test Movie' }],
    ['an impossible year', { ...valid, year: 1700 }],
    ['no genres', { ...valid, genres: [] }],
    ['a missing overview', { ...valid, overview: undefined }],
    ['a blank title', { ...valid, title: '   ' }],
  ])('rejects an entry with %s', (_label, entry) => {
    expect(() => parseSeedMovies([entry])).toThrow();
  });
});