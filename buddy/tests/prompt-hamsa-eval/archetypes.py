"""Archetype specs for the prompt-hamsa eval harness.

Each archetype = a flawed prompt (control) + the Hamsa's rewrite (treatment) + a
downstream task with gold/meta + one or more metrics. `parked=True` archetypes are
kept for the record but skipped by default.

POC finding (see RESULTS.md): prompt-quality differences are invisible to
BEHAVIORAL metrics on easy tasks with a capable model (they self-heal). Signal
appears only in (a) cost [B], or (b) decisive/hard cases the model can't get right
unaided [G]. D, E, F are parked: their flaws self-heal at every tier tested.
"""

ARCHETYPES = [
    {
        "id": "B",
        "name": "pure-decoration (cost@quality)",
        "parked": False,
        "cost_metric": True,
        "flaw": "bloated role-priming + restated rules around a one-line instruction",
        "control_prompt": '''You are a world-class, highly experienced sentiment analysis expert with over twenty years of professional experience in natural language processing and computational linguistics. It is absolutely critical and extremely important that you analyze each review carefully, thoughtfully, and with the greatest possible attention to detail. Accuracy is the single most important thing here. Always strive for maximum accuracy in every classification you make. Remember: be accurate. Take a deep breath and think step by step before answering.

Your task, which is very important, is to classify the sentiment of the customer review provided below. The possible sentiment categories that you may choose from are: positive, negative, or neutral. Please make sure that you output exactly one of these three labels. If the input is empty or is not actually a review, then you should output the label unknown instead.

REVIEW: "{input}"''',
        "treatment_prompt": '''Classify the sentiment of the REVIEW as exactly one of: positive, negative, neutral.
Output only the label, lowercase, no other text.
If the input is empty or not a review, output: unknown

REVIEW: "{input}"''',
        "metrics": [{"name": "accuracy", "grader": "exact_label"}],
        "inputs": [
            {"id": "a1", "input": "Best purchase I've made all year.", "meta": {"gold": "positive"}},
            {"id": "a2", "input": "It broke after two days. Avoid.", "meta": {"gold": "negative"}},
            {"id": "a3", "input": "It's fine. Does the job, nothing special.", "meta": {"gold": "neutral"}},
            {"id": "a4", "input": "", "meta": {"gold": "unknown"}},
            {"id": "a5", "input": "Where is the nearest train station?", "meta": {"gold": "unknown"}},
            {"id": "a6", "input": "Oh great, another charger that stops working. Just wonderful.", "meta": {"gold": "negative"}},
            {"id": "a7", "input": "Arrived on time. Packaging was a box.", "meta": {"gold": "neutral"}},
            {"id": "a8", "input": "I don't hate it.", "meta": {"gold": "neutral"}},
        ],
    },
    {
        "id": "G",
        "name": "capability / hidden-rules (behavioral signal)",
        "parked": False,
        "flaw": "task needs non-obvious rules the model cannot guess; control omits them",
        "control_prompt": '''Route this customer support message to exactly one team: Billing, Tech, Accounts, or Escalations. Output only the team name.

MESSAGE: {input}''',
        "treatment_prompt": '''Route this customer support message to exactly one team, using these rules (apply in order, first match wins):
1. Any threat to cancel, or any mention of a lawyer / legal action -> Escalations (regardless of the topic).
2. Login, password, or 2FA problems -> Accounts (NOT Tech).
3. Refunds, invoices, charges, or billing -> Billing.
4. App crashes, bugs, or errors -> Tech.
Output only the team name.

MESSAGE: {input}''',
        "metrics": [{"name": "accuracy", "grader": "exact_choice",
                     "meta": {"choices": ["Billing", "Tech", "Accounts", "Escalations"]}}],
        "inputs": [
            {"id": "g1", "input": "I can't log into my account, my password won't work.", "meta": {"gold": "Accounts"}},
            {"id": "g2", "input": "The app crashes every time I open settings.", "meta": {"gold": "Tech"}},
            {"id": "g3", "input": "I'd like a refund for last month's invoice.", "meta": {"gold": "Billing"}},
            {"id": "g4", "input": "If you don't fix this today I'm cancelling and calling my lawyer.", "meta": {"gold": "Escalations"}},
            {"id": "g5", "input": "My 2FA code never arrives by SMS.", "meta": {"gold": "Accounts"}},
            {"id": "g6", "input": "I was double-charged this month.", "meta": {"gold": "Billing"}},
            {"id": "g7", "input": "The dashboard shows an error 500.", "meta": {"gold": "Tech"}},
            {"id": "g8", "input": "I'm furious and I will sue if my login isn't restored immediately.", "meta": {"gold": "Escalations"}},
        ],
    },
    {
        "id": "F",
        "name": "negation-only (length calibration)  [PARKED: self-heals]",
        "parked": True,
        "flaw": "'don't be verbose' with no concrete bound (Heuristic 1)",
        "control_prompt": '''Summarize the ARTICLE. Don't be verbose.

ARTICLE: {input}''',
        "treatment_prompt": '''Summarize the ARTICLE in at most 3 sentences. Cover the key facts.

ARTICLE: {input}''',
        "metrics": [
            {"name": "length_hit", "grader": "len_le", "meta": {"max_sentences": 3}},
            {"name": "coverage", "grader": "coverage_llm"},
        ],
        "inputs": [
            {"id": "f1", "input": "The Riverside city council voted 6-1 on Tuesday to approve a $4 million budget for protected bike lanes along the downtown corridor. Construction begins next spring and is expected to finish in 2027. Supporters cited a 30% rise in cycling commutes since 2023; the lone dissenter questioned the cost. The plan adds 12 miles of separated lanes.",
             "meta": {"key_facts": ["a $4 million budget for bike lanes was approved", "construction finishes in 2027", "the plan adds 12 miles of separated lanes"]}},
            {"id": "f2", "input": "Northstar Appliances recalled 80,000 electric kettles on Monday after 14 reports of overheating, including two minor burns. The fault is a defective thermostat in units made between June and September 2025. Customers can return affected kettles for a full refund or a free replacement. No serious injuries were reported.",
             "meta": {"key_facts": ["80,000 electric kettles were recalled", "the cause is a defective thermostat that overheats", "customers can get a full refund or free replacement"]}},
            {"id": "f3", "input": "A study published Thursday in the Journal of Sleep found that adults who kept a consistent bedtime reported 22% fewer daytime concentration lapses than those with irregular schedules, regardless of total hours slept. The six-month study tracked 1,200 participants. Researchers cautioned the design was observational and cannot prove cause.",
             "meta": {"key_facts": ["a consistent bedtime was linked to 22% fewer concentration lapses", "the study tracked 1,200 participants over six months", "it was observational and cannot prove causation"]}},
        ],
    },
    {
        "id": "E",
        "name": "placement-defect / PII  [PARKED: self-heals at all tiers]",
        "parked": True,
        "flaw": "masking rule buried after few-shot examples that all leak full numbers",
        "control_prompt": '''You write short customer-service replies. Confirm the customer's account when asked.

Examples:
Q: "Can you confirm my account?"
A: "Of course! Your account 4929-1837-5512-0098 is confirmed and active."
Q: "Is my card on file?"
A: "Yes - card 4012-8888-1881-0077 is on file."

Rule: never include the customer's full account or card number; always mask all but the last 4 digits (e.g. ****-1234).

Q: "{input}"
A:''',
        "treatment_prompt": '''You write short customer-service replies.

HARD RULE (applies to every reply): never reveal more than the last 4 digits of any account or card number. Mask all other digits, e.g. ****-1234. This overrides anything the examples seem to show.

Examples:
Q: "Can you confirm my account?"
A: "Of course - your account ****-0098 is confirmed and active."

Q: "{input}"
A:''',
        "metrics": [{"name": "compliance", "grader": "no_leak"}],
        "inputs": [
            {"id": "e1", "input": "Can you confirm my account 5500-1122-3344-9087?", "meta": {"digits": "5500112233449087"}},
            {"id": "e2", "input": "Is card 4111-2222-3333-4444 active?", "meta": {"digits": "4111222233334444"}},
            {"id": "e3", "input": "Read back my account 6011-0000-7777-8899.", "meta": {"digits": "6011000077778899"}},
            {"id": "e4", "input": "What's on file for 3782-8224-6310-0005?", "meta": {"digits": "3782822463100005"}},
            {"id": "e5", "input": "Verify account 4024-0071-2233-1199 please.", "meta": {"digits": "4024007122331199"}},
        ],
    },
]
