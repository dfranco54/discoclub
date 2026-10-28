// Business-rule failures, each one with its own type so that the HTTP layer
// (next step) can map them to the right status code.

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

export class MovieNotFoundError extends Error {
  constructor(slug: string) {
    super(`Movie not found: ${slug}`);
    this.name = 'MovieNotFoundError';
  }
}

export class NoCopyAvailableError extends Error {
  constructor(slug: string) {
    super(`No copy available for: ${slug}`);
    this.name = 'NoCopyAvailableError';
  }
}

export class RentalLimitReachedError extends Error {
  constructor(public readonly limit: number) {
    super(`Rental limit reached (${limit} active rentals)`);
    this.name = 'RentalLimitReachedError';
  }
}

export class RentalNotFoundError extends Error {
  constructor(id: string) {
    super(`Rental not found: ${id}`);
    this.name = 'RentalNotFoundError';
  }
}

export class RentalAlreadyReturnedError extends Error {
  constructor(id: string) {
    super(`Rental already returned: ${id}`);
    this.name = 'RentalAlreadyReturnedError';
  }
}