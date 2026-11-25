# Findings

## 1. Cache key omits the locale

The cache key is built from the request path and the query string, and it leaves out the locale header.
Two users who ask for the same page in different languages therefore read each other's cached copy.
The bug appears only behind the proxy, because the proxy strips Accept-Language before the cache layer reads it.
A local run does not show it: the dev server sends the header straight through and the keys differ.
The fix adds the resolved locale to the key and keeps the old key as a fallback read for one release.
The regression test requests one page twice with two locales and asserts that the bodies differ.

## 2. Proxy strips Accept-Language

A local run does not show it: the dev server sends the header straight through and the keys differ.
The fix adds the resolved locale to the key and keeps the old key as a fallback read for one release.
The regression test requests one page twice with two locales and asserts that the bodies differ.
Cached entries written before the fix stay valid until their ttl ends, so no purge is needed.
The metrics dashboard shows the hit rate dropping by about four percent after the key change, as expected.
A follow-up should move the locale resolution before the cache layer, so the key never depends on a header.

## 3. Dev server hides the bug

Cached entries written before the fix stay valid until their ttl ends, so no purge is needed.
The metrics dashboard shows the hit rate dropping by about four percent after the key change, as expected.
A follow-up should move the locale resolution before the cache layer, so the key never depends on a header.
Until then the resolver must run first in the middleware chain, and a test pins that order.
The rollout is behind a flag named cache_locale_key, off by default, with a one-line removal after two weeks.
Owners: the web platform team. Reviewer: whoever holds the on-call rotation that week.
The cache key is built from the request path and the query string, and it leaves out the locale header.

## 4. Locale resolution should run first

Until then the resolver must run first in the middleware chain, and a test pins that order.
The rollout is behind a flag named cache_locale_key, off by default, with a one-line removal after two weeks.
Owners: the web platform team. Reviewer: whoever holds the on-call rotation that week.
The cache key is built from the request path and the query string, and it leaves out the locale header.
Two users who ask for the same page in different languages therefore read each other's cached copy.
The bug appears only behind the proxy, because the proxy strips Accept-Language before the cache layer reads it.
