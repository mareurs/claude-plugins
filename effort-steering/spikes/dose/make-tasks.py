#!/usr/bin/env python3
"""Candidate tasks for the effort dose-response experiment (ES-19). Ground truth is COMPUTED here and
compared with the literal answer written next to each prompt; a mismatch aborts. Writes tasks.candidates.json."""
import json, math, itertools, sys
from fractions import Fraction

SUFFIX = ' End your reply with one final line of the form "ANSWER: <value>".'

def squarefree(n):
    return all(n % (p * p) for p in range(2, int(n ** 0.5) + 1))

def perms_ok():
    c = 0
    for p in itertools.permutations('ABCDE'):
        pos = {x: i for i, x in enumerate(p)}
        if abs(pos['A'] - pos['B']) != 1 and pos['C'] < pos['D'] and pos['E'] not in (0, 4):
            c += 1
    return c

def prob_two_same():
    balls = ['R'] * 4 + ['B'] * 3 + ['G'] * 2
    good = total = 0
    for combo in itertools.combinations(range(9), 3):
        total += 1
        cols = [balls[i] for i in combo]
        if max(cols.count(c) for c in set(cols)) == 2:
            good += 1
    f = Fraction(good, total)
    return f'{f.numerator}/{f.denominator}'

def is_prime(n):
    return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))

def ways(n):
    w = [1] + [0] * n
    for i in range(1, n + 1):
        w[i] = sum(w[i - k] for k in (1, 2, 3) if i - k >= 0)
    return w[n]

def no_adjacent_ones():
    return sum(1 for b in itertools.product('01', repeat=8) if b.count('1') == 3 and '11' not in ''.join(b))

# (id, stratum, prompt, literal answer, kind, computed answer)
T = [
    ('e1', 'easy', 'What is 17 times 24?', '408', 'int', 17 * 24),
    ('e2', 'easy', 'Convert 3.5 hours to minutes.', '210', 'int', int(3.5 * 60)),
    ('e3', 'easy', 'What is the capital city of Australia?', 'canberra', 'word', 'canberra'),
    ('e4', 'easy', 'What is the sum of the integers from 1 to 10?', '55', 'int', sum(range(1, 11))),
    ('e5', 'easy', 'How many bytes are in 3 kibibytes?', '3072', 'int', 3 * 1024),
    ('e6', 'easy', 'What is the remainder when 1000 is divided by 7?', '6', 'int', 1000 % 7),
    ('m1', 'medium', 'A train leaves at 9:40 and arrives at 13:15 on the same day. It stood still for a 25-minute stop on the way. For how many minutes was it moving?', '190', 'int', (13 * 60 + 15) - (9 * 60 + 40) - 25),
    ('m2', 'medium', 'How many integers from 1 to 500 are divisible by exactly one of 4 and 6 (by 4 or by 6, but not by both)?', None, 'int', sum(1 for n in range(1, 501) if (n % 4 == 0) != (n % 6 == 0))),
    ('m3', 'medium', 'What is the remainder when 7 to the power 100 is divided by 13?', None, 'int', pow(7, 100, 13)),
    ('m4', 'medium', 'The sequence 3, 7, 15, 31, 63, ... continues by the same rule. What is its 12th term?', '8191', 'int', 2 ** 13 - 1),
    ('m5', 'medium', 'A rectangle has perimeter 46 and area 120. What is the length of its diagonal?', '17', 'int', 17 if (8 * 8 + 15 * 15 == 17 * 17 and 2 * (8 + 15) == 46 and 8 * 15 == 120) else None),
    ('m6', 'medium', 'A shop raises a price by 20 percent and then lowers the new price by 20 percent. The final price is 96. What was the original price?', '100', 'int', round(96 / (1.2 * 0.8))),
    ('m7', 'medium', 'How many positive divisors does 360 have?', '24', 'int', sum(1 for d in range(1, 361) if 360 % d == 0)),
    ('h1', 'hard', 'How many 8-bit binary strings have exactly three 1s and no two 1s next to each other?', '20', 'int', no_adjacent_ones()),
    ('h2', 'hard', 'Five people A, B, C, D and E sit in a row of five seats. A does not sit next to B. C sits somewhere to the left of D. E does not sit in either end seat. How many seating arrangements are possible?', None, 'int', perms_ok()),
    ('h3', 'hard', 'A bag holds 4 red, 3 blue and 2 green balls. Three balls are drawn at random without replacement. What is the probability that exactly two of the three balls have the same colour? Give the answer as a reduced fraction a/b.', None, 'fraction', prob_two_same()),
    ('h4', 'hard', 'What is the sum of all two-digit primes whose two digits are both prime digits (2, 3, 5 or 7)?', '186', 'int', sum(n for n in range(10, 100) if is_prime(n) and all(int(d) in (2, 3, 5, 7) for d in str(n)))),
    ('h5', 'hard', 'How many integers n with 1 <= n <= 100 have both n and n+1 free of square factors greater than 1 (both squarefree)?', None, 'int', sum(1 for n in range(1, 101) if squarefree(n) and squarefree(n + 1))),
    ('h6', 'hard', 'How many ordered pairs (a, b) of positive integers satisfy a times b equals 360 and gcd(a, b) equals 1?', '8', 'int', sum(1 for a in range(1, 361) if 360 % a == 0 and math.gcd(a, 360 // a) == 1)),
    ('h7', 'hard', 'What are the last two digits of 3 to the power 2026?', None, 'int2', f'{pow(3, 2026, 100):02d}'),
    ('h8', 'hard', 'A frog starts on step 0 of a staircase. Each jump climbs exactly 1, 2 or 3 steps. In how many different sequences of jumps can it land exactly on step 10?', '274', 'int', ways(10)),
]

out = []
for tid, stratum, prompt, literal, kind, computed in T:
    if literal is not None and str(computed) != literal:
        sys.exit(f'MISMATCH {tid}: literal {literal} vs computed {computed}')
    out.append({'id': tid, 'stratum': stratum, 'prompt': prompt + SUFFIX, 'answer': str(computed), 'kind': kind})
json.dump({'suffix': SUFFIX.strip(), 'tasks': out}, open(sys.argv[1], 'w'), indent=2)
for t in out:
    print(t['id'], t['stratum'], t['answer'])
