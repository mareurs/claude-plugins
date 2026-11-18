#!/usr/bin/env python3
"""Second candidate set for the effort dose-response experiment (ES-20), harder than tasks.candidates.json
(all 21 of those were solved 3 of 3 by Sonnet 5.5 at medium). Every answer is COMPUTED here; a literal that
disagrees with the computation aborts. Usage: make-tasks2.py OUTFILE   (writes the same JSON shape)."""
import itertools, json, sys
from functools import lru_cache

SUFFIX = ' End your reply with one final line of the form "ANSWER: <value>".'


def is_prime(n):
    return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))


def collatz(n):
    c = 0
    while n != 1:
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        c += 1
    return c


def coin_ways(total, coins):
    w = [1] + [0] * total
    for c in coins:
        for v in range(c, total + 1):
            w[v] += w[v - c]
    return w[total]


def distinct_partitions(n):
    w = [1] + [0] * n
    for k in range(1, n + 1):
        for v in range(n, k - 1, -1):
            w[v] += w[v - k]
    return w[n]


def seq40():
    a = [None, 1, 1]
    for n in range(3, 41):
        a.append(a[n - 1] + 2 * a[n - 2])
    return a[40] % 1000


def paths_avoiding():
    @lru_cache(None)
    def f(x, y):
        if (x, y) == (4, 4) or x < 0 or y < 0:
            return 0
        if (x, y) == (0, 0):
            return 1
        return f(x - 1, y) + f(x, y - 1)
    return f(9, 9)


def six_digit_distinct_div5():
    return sum(1 for n in range(100000, 1000000) if n % 5 == 0 and len(set(str(n))) == 6)


# (id, prompt, literal answer or None, computed)
T = [
    ('x1', 'How many integers from 1 to 5000 have a digit sum equal to 20?', None, sum(1 for n in range(1, 5001) if sum(map(int, str(n))) == 20)),
    ('x2', 'How many prime numbers are there below 3000?', None, sum(1 for n in range(2, 3000) if is_prime(n))),
    ('x3', 'What is the sum of the decimal digits of 2 to the power 300?', None, sum(map(int, str(2 ** 300)))),
    ('x4', 'Apply this rule repeatedly starting from 97: if the number is even, halve it; if it is odd, multiply it by 3 and add 1. How many applications of the rule does it take to reach 1?', '118', collatz(97)),
    ('x5', 'In how many ways can 40 cents be made from coins of 1, 5, 10 and 25 cents when the order of the coins does not matter?', None, coin_ways(40, [1, 5, 10, 25])),
    ('x6', 'In how many ways can 35 be written as a sum of distinct positive integers when the order does not matter?', None, distinct_partitions(35)),
    ('x7', 'Define a(1) = 1, a(2) = 1 and a(n) = a(n-1) + 2*a(n-2) for n >= 3. What is the remainder when a(40) is divided by 1000?', None, seq40()),
    ('x8', 'How many lattice paths go from (0, 0) to (9, 9) using only steps right (+1, 0) and up (0, +1), without ever passing through the point (4, 4)?', None, paths_avoiding()),
    ('x9', 'How many 6-digit positive integers (the first digit is not 0) have six different digits and are divisible by 5?', None, six_digit_distinct_div5()),
    ('x10', 'What is the remainder when 1^5 + 2^5 + 3^5 + ... + 100^5 is divided by 97?', None, sum(k ** 5 for k in range(1, 101)) % 97),
    ('x11', 'How many pairs of integers (a, b) with 1 <= a < b <= 60 have a + b divisible by 7?', None, sum(1 for a in range(1, 61) for b in range(a + 1, 61) if (a + b) % 7 == 0)),
    ('x12', 'For how many positive integers n <= 1000 is the number n^2 + n + 41 composite?', None, sum(1 for n in range(1, 1001) if not is_prime(n * n + n + 41))),
    ('x13', 'What is 987654321 times 123456789?', '121932631112635269', 987654321 * 123456789),
    ('x14', 'What is the remainder when 7 to the power 77 is divided by 1000?', None, pow(7, 77, 1000)),
]

out = []
for tid, prompt, literal, computed in T:
    if literal is not None and str(computed) != literal:
        sys.exit(f'MISMATCH {tid}: literal {literal} vs computed {computed}')
    out.append({'id': tid, 'stratum': 'hard', 'prompt': prompt + SUFFIX, 'answer': str(computed), 'kind': 'int'})
json.dump({'suffix': SUFFIX.strip(), 'tasks': out}, open(sys.argv[1], 'w'), indent=2)
for t in out:
    print(t['id'], t['answer'])
