/**
 * Link to a term on /methodology, e.g. glossaryHref('b2b') → "/methodology#term-b2b".
 * Its own module so client code that only links to the glossary (the matchup
 * card, table headers) doesn't bundle the full GLOSSARY copy from lib/glossary.
 */
export function glossaryHref(id: string): string {
    return `/methodology#term-${id}`;
}
